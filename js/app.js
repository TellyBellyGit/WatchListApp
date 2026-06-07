// ============================================================================
// STOCK WATCH LIST — Main Application Logic
// ============================================================================

// ---- Extensible Watch List Definitions ----
// To add a new list: add an entry here, then add a matching
// <button id="list-toggle-{id}"> in index.html.
const KNOWN_LISTS = [
  { id: 'main',  label: 'Main',  emoji: '📋' },
  { id: 'swing', label: 'Swing', emoji: '💹' },
  { id: 'temp',  label: 'Temp',  emoji: '📝' }
];

class StockWatchApp {
  constructor() {
    this.entries = [];
    this.filteredEntries = [];
    this.filterDateFromVal = null;
    this.filterTag = '';
    this.dateFilterMode = 'today'; // 'today' or 'all'
    this.sortColumn = 'entryDateEST';
    this.sortDirection = 'desc';
    this.currentList = 'main';

    // DOM refs
    this.tableBody = document.getElementById('watchlist-body');
    this.searchInput = document.getElementById('symbol-search');
    this.searchBtn = document.getElementById('search-btn');
    this.searchResults = document.getElementById('search-results');
    this.refreshBtn = document.getElementById('refresh-btn');
    this.exportBtn = document.getElementById('export-btn');
    this.filterDateFromEl = document.getElementById('filter-date-from');
    this.dayArrowLeft = document.getElementById('day-arrow-left');
    this.dayArrowRight = document.getElementById('day-arrow-right');
    this.btnTodayAll = document.getElementById('btn-today-all');
    this.toggleAddSectionBtn = document.getElementById('toggle-add-section');
    this.addStockSection = document.getElementById('add-stock-section');
    this.globalToggleAddSectionBtn = document.getElementById('toggle-add-section-global');
    this.statsBar = document.getElementById('stats-bar');
    this.connectionDot = document.getElementById('connection-dot');
    this.connectionText = document.getElementById('connection-text');
    this.themeLightBtn = document.getElementById('theme-light');
    this.themeDarkBtn = document.getElementById('theme-dark');
    this.loadingOverlay = document.getElementById('loading-overlay');

    // List toggle buttons (dynamic — one per KNOWN_LISTS entry)
    this.listToggleButtons = {};
    for (const list of KNOWN_LISTS) {
      const btn = document.getElementById('list-toggle-' + list.id);
      if (btn) this.listToggleButtons[list.id] = btn;
    }

    // Daily Notes refs
    this.dailyNotesPanel = document.getElementById('daily-notes-panel');
    this.dailyNotesContent = document.getElementById('daily-notes-content');
    this.dailyNotesDate = document.getElementById('daily-notes-date');
    this.dailyNotesSentiment = document.getElementById('daily-notes-sentiment');
    this.dailyNotesWordCount = document.getElementById('daily-notes-word-count');
    this.btnDailyNotes = document.getElementById('btn-daily-notes');
    this.dailyNotesEditBtn = document.getElementById('daily-notes-edit-btn');
    this.dailyNotesClose = document.getElementById('daily-notes-close');
    this.notesEditorOverlay = document.getElementById('notes-editor-overlay');
    this.notesEditorTextarea = document.getElementById('notes-editor-textarea');
    this.notesEditorDate = document.getElementById('notes-editor-date');
    this.notesEditorSaveStatus = document.getElementById('notes-editor-save-status');
    this.notesEditorCharCount = document.getElementById('notes-editor-char-count');
    this.notesEditorClose = document.getElementById('notes-editor-close');
    this.sentimentBullish = document.getElementById('sentiment-bullish');
    this.sentimentNeutral = document.getElementById('sentiment-neutral');
    this.sentimentBearish = document.getElementById('sentiment-bearish');

    // Daily Notes state
    this._dailyNoteDates = new Set();     // dates that have notes (for indicator dots)
    this._dailyNoteSentiment = null;       // current sentiment for open editor
    this._dailyNoteSaveTimer = null;       // debounce timer for auto-save
    this._dailyNoteDirty = false;          // unsaved changes flag
    this._dailyNoteDisplayDate = null;     // date currently shown in panel
  }

  // ---- Initialize ----
  async init() {
    // Load theme preference
    this._initTheme();

    // Check if API keys are configured — show setup if not
    if (!ConfigManager.hasFinnhubKey()) {
      this._showSetup(true); // first-run mode
      return;
    }

    await this._bootApp();
  }

  // ---- Boot the main app (called after setup is confirmed) ----
  async _bootApp() {
    // Init data store FIRST (must complete before loading entries)
    const cloudConnected = await dataStore.init();
    this._updateConnectionStatus(cloudConnected);

    // Init WebSocket
    this._initWebSocket();

    // Load entries from data store (now that Firestore is initialized)
    await this.loadEntries();

    // Restore add-stock section collapse state (default: visible)
    this._initAddSectionToggle();

    // Bind events
    this._bindEvents();

    // Default to today's date
    const today = Utils.formatESTDateOnly(new Date());
    this.filterDateFromEl.value = today;
    this.filterDateFromVal = today;
    this.dateFilterMode = 'today';
    this._updateDayNavUI();
    this._updateDayBadge();

    // Init daily notes system
    await this._initDailyNotes();

    // Apply initial filter and render
    this.applyFilters();
    this.updateStats();
  }

  // ---- WebSocket Initialization ----
  _initWebSocket() {
    // Status change handler
    wsClient.onStatusChange((payload) => {
      this._updateWsStatus(payload);
    });

    // Trade handler
    wsClient.onTrade((trade) => {
      this._handleWsTrade(trade);
    });

    // Connect WebSocket
    wsClient.connect();
    this._updateWsStatus({ status: wsClient.status, count: wsClient.subscriptionCount, max: wsClient.MAX_SYMBOLS });
  }

  // ---- Update WebSocket Status Badge ----
  _updateWsStatus(payload) {
    const el = document.getElementById('ws-status');
    if (!el) return;
    el.className = 'ws-status ' + payload.status;
    const textEl = el.querySelector('.ws-text');
    if (textEl) {
      if (payload.status === 'connected') {
        textEl.textContent = `WS ${payload.count}/${payload.max}`;
      } else if (payload.status === 'connecting' || payload.status === 'reconnecting') {
        textEl.textContent = `WS .../${payload.max}`;
      } else {
        textEl.textContent = 'WS Off';
      }
    }
  }

  // ---- Handle Incoming WebSocket Trade ----
  _handleWsTrade(trade) {
    // Find matching entries (could be multiple entries for same symbol)
    let updated = false;
    for (const entry of this.entries) {
      if (entry.symbol.toUpperCase() === trade.symbol.toUpperCase()) {
        const oldPrice = entry.currentPrice;
        entry.currentPrice = trade.price;
        entry.currentChange = trade.price - (entry.notedPreviousClose || entry.currentPreviousClose || trade.price);
        entry.currentPercentChange = entry.notedPreviousClose
          ? ((trade.price - entry.notedPreviousClose) / entry.notedPreviousClose) * 100
          : entry.currentPercentChange;
        entry.currentVolume = (entry.currentVolume || 0) + (trade.volume || 0);
        entry.quoteTimestamp = new Date(trade.timestamp).toISOString();
        updated = true;

        // Flash the row if price changed
        if (oldPrice !== trade.price) {
          this._flashRow(trade.symbol);
        }
      }
    }

    if (updated) {
      // Re-render affected rows only (full re-render for simplicity)
      this.render();
    }
  }

  // ---- Flash a Row on Price Update ----
  _flashRow(symbol) {
    // Find the row and add flash class, then remove it
    const rows = this.tableBody.querySelectorAll('tr');
    for (const row of rows) {
      const symbolCell = row.querySelector('.symbol-cell');
      if (symbolCell && symbolCell.textContent.trim().toUpperCase() === symbol.toUpperCase()) {
        row.classList.add('flash-update');
        setTimeout(() => row.classList.remove('flash-update'), 600);
        break;
      }
    }
  }

  // ---- Detect if a stock is OTC (exchange contains OTC markers) ----
  _isOTC(exchange) {
    if (!exchange) return false;
    const ex = exchange.toUpperCase();
    return ex.includes('OTC') || ex.includes('OTCMKTS') || ex.includes('OTCQB') || 
           ex.includes('OTCQX') || ex.includes('PINK') || ex.includes('GREY');
  }

  // ---- Normalize exchange name for display ----
  _formatExchange(exchange) {
    if (!exchange) return '—';
    const ex = exchange.toUpperCase();
    if (ex.includes('NASDAQ')) return 'NASDAQ';
    if (ex.includes('NYSE')) return 'NYSE';
    if (ex.includes('OTC')) return 'OTC';
    if (ex.includes('PINK')) return 'OTC';
    if (ex.includes('GREY')) return 'OTC';
    // Truncate long exchange names to 8 chars
    if (exchange.length > 8) return exchange.substring(0, 8);
    return exchange;
  }

  // ---- Toggle WebSocket/Polling from the dot ----
  _toggleWsSubscription(symbol, isOTC) {
    const sym = symbol.toUpperCase();
    const entry = this.entries.find(e => e.symbol.toUpperCase() === sym);

    if (isOTC) {
      // OTC stock: toggle polling
      if (entry._polling) {
        this._stopPolling(sym);
      } else {
        this._startPolling(sym);
      }
    } else {
      // Regular stock: toggle WebSocket
      if (wsClient.isSubscribed(sym)) {
        wsClient.unsubscribe(sym);
      } else {
        const result = wsClient.subscribe(sym);
        if (!result.success && result.reason === 'limit') {
          Utils.showToast(`WebSocket limit reached (${result.current}/${result.max}). Unsubscribe another stock first.`, 'error', 4000);
        }
      }
    }
    this.render();
  }

  // ---- Polling Engine (for OTC stocks) ----
  _startPolling(symbol) {
    const sym = symbol.toUpperCase();
    const entry = this.entries.find(e => e.symbol.toUpperCase() === sym);
    if (!entry) return;

    entry._polling = true;
    if (!this._pollTimer) {
      this._pollQueue = new Set();
      this._pollTimer = setInterval(() => this._pollTick(), 20000); // 20 seconds
      console.log('[Poll] Polling engine started (20s interval)');
    }
    this._pollQueue.add(sym);
    console.log(`[Poll] Started polling ${sym} (${this._pollQueue.size} symbols)`);
    Utils.showToast(`🟣 Polling ${sym} every 20s (OTC)`);
  }

  _stopPolling(symbol) {
    const sym = symbol.toUpperCase();
    this._pollQueue.delete(sym);

    const entry = this.entries.find(e => e.symbol.toUpperCase() === sym);
    if (entry) entry._polling = false;

    console.log(`[Poll] Stopped polling ${sym} (${this._pollQueue.size} remaining)`);
    Utils.showToast(`Polling stopped for ${sym}`);

    // Clean up timer if queue is empty
    if (this._pollQueue.size === 0 && this._pollTimer) {
      clearInterval(this._pollTimer);
      this._pollTimer = null;
      console.log('[Poll] Polling engine stopped (empty queue)');
    }
  }

  async _pollTick() {
    if (!this._pollQueue || this._pollQueue.size === 0) return;

    const symbols = Array.from(this._pollQueue);
    for (const sym of symbols) {
      try {
        const data = await finnhub.refreshQuote(sym);
        if (!data._error) {
          // Update all entries with this symbol
          for (const entry of this.entries) {
            if (entry.symbol.toUpperCase() === sym) {
              Object.assign(entry, data);
              entry.quoteTimestamp = new Date().toISOString();
            }
          }
        }
      } catch (e) {
        console.warn(`[Poll] Failed to poll ${sym}:`, e.message);
      }
      // Small gap between polls to respect rate limit
      if (symbols.length > 1) {
        await new Promise(r => setTimeout(r, 2000)); // 2s gap
      }
    }
    // Re-render to show updated prices
    this.render();
  }

  // ---- Theme ----
  _initTheme() {
    const savedTheme = localStorage.getItem('stockwatchlist_theme') || 'dark';
    document.documentElement.setAttribute('data-theme', savedTheme);
    this._updateThemeToggle(savedTheme);
  }

  _toggleTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('stockwatchlist_theme', theme);
    this._updateThemeToggle(theme);
  }

  _updateThemeToggle(active) {
    if (this.themeLightBtn) {
      this.themeLightBtn.classList.toggle('active', active === 'light');
    }
    if (this.themeDarkBtn) {
      this.themeDarkBtn.classList.toggle('active', active === 'dark');
    }
  }

  // ---- Connection Status ----
  _updateConnectionStatus(connected) {
    if (this.connectionDot) {
      this.connectionDot.className = 'connection-dot ' + (connected ? 'online' : 'offline');
    }
    if (this.connectionText) {
      this.connectionText.textContent = connected ? 'Cloud Synced' : 'Local Storage';
    }
  }

  // ---- Load Entries from Store ----
  async loadEntries() {
    this.entries = await dataStore.getAllEntries();
  }

  // ---- Update Day Navigation UI (arrows, today/all button) ----
  _updateDayNavUI() {
    const isToday = this.dateFilterMode === 'today';

    // Arrow buttons: disabled when in 'all' mode
    if (this.dayArrowLeft) this.dayArrowLeft.disabled = !isToday;
    if (this.dayArrowRight) this.dayArrowRight.disabled = !isToday;

    // All toggle button — always says "📅 All", blue background when All mode is ON
    if (this.btnTodayAll) {
      this.btnTodayAll.textContent = '📅 All';
      if (isToday) {
        this.btnTodayAll.classList.remove('active');
      } else {
        this.btnTodayAll.classList.add('active');
      }
    }
  }

  // ---- Update Day Badge (day of week pill) ----
  _updateDayBadge() {
    const badge = document.getElementById('day-badge');
    if (!badge) return;

    if (this.dateFilterMode === 'today' && this.filterDateFromVal) {
      const parts = this.filterDateFromVal.split('-');
      if (parts.length === 3) {
        const y = parseInt(parts[0]);
        const m = parseInt(parts[1]) - 1;
        const d = parseInt(parts[2]);
        const date = new Date(y, m, d);
        const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
        badge.textContent = dayNames[date.getDay()];
        return;
      }
    }

    // All mode or invalid date — clear the badge (CSS hides empty)
    badge.textContent = '';
  }

  // ---- Navigate date by offset days (uses UTC to avoid timezone shifting) ----
  _navigateDay(offset) {
    if (!this.filterDateFromVal) return;

    const parts = this.filterDateFromVal.split('-');
    if (parts.length !== 3) return;

    const y = parseInt(parts[0]);
    const m = parseInt(parts[1]);
    const d = parseInt(parts[2]);

    // Use pure date arithmetic on the YYYY-MM-DD string — no Date object
    const date = new Date(Date.UTC(y, m - 1, d));
    date.setUTCDate(date.getUTCDate() + offset);

    const ny = date.getUTCFullYear();
    const nm = String(date.getUTCMonth() + 1).padStart(2, '0');
    const nd = String(date.getUTCDate()).padStart(2, '0');
    const newDateStr = `${ny}-${nm}-${nd}`;

    this.filterDateFromEl.value = newDateStr;
    this.filterDateFromVal = newDateStr;
    this.dateFilterMode = 'today';
    this._updateDayNavUI();
    this._updateDayBadge();
    this.applyFilters();
  }

  // ---- Toggle between Today and All mode ----
  _toggleTodayAll() {
    if (this.dateFilterMode === 'today') {
      // Switch to All
      this.dateFilterMode = 'all';
      this.filterDateFromEl.value = '';
      this.filterDateFromVal = null;
    } else {
      // Switch to Today
      this.dateFilterMode = 'today';
      const today = Utils.formatESTDateOnly(new Date());
      this.filterDateFromEl.value = today;
      this.filterDateFromVal = today;
    }
    this._updateDayNavUI();
    this._updateDayBadge();
    this.applyFilters();
  }

  // ---- Bind Events ----
  _bindEvents() {
    // Search
    this.searchInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') this.searchSymbol();
    });
    this.searchBtn.addEventListener('click', () => this.searchSymbol());

    // Refresh
    this.refreshBtn.addEventListener('click', () => this.refreshAllPrices());

    // Export
    this.exportBtn.addEventListener('click', () => this.exportCSV());

    // Delete All
    const deleteAllBtn = document.getElementById('delete-all-btn');
    if (deleteAllBtn) {
      deleteAllBtn.addEventListener('click', () => this.deleteAllEntries());
    }

    // Date filter input — single date picker, filters for exact day
    this.filterDateFromEl.addEventListener('change', () => {
      this.filterDateFromVal = this.filterDateFromEl.value;
      this.dateFilterMode = 'today';
      this._updateDayNavUI();
      this._updateDayBadge();
      this.applyFilters();
    });

    // Day navigation arrows
    if (this.dayArrowLeft) {
      this.dayArrowLeft.addEventListener('click', () => this._navigateDay(-1));
    }
    if (this.dayArrowRight) {
      this.dayArrowRight.addEventListener('click', () => this._navigateDay(1));
    }

    // Today/All toggle
    if (this.btnTodayAll) {
      this.btnTodayAll.addEventListener('click', () => this._toggleTodayAll());
    }

    // Toggle date columns
    const table = document.querySelector('table');
    const dateColumnsHidden = localStorage.getItem('stockwatchlist_hide-dates') === 'true';
    if (dateColumnsHidden) {
      table.classList.add('hide-dates');
    }
    const toggleDatesBtn = document.getElementById('toggle-dates-btn');
    if (toggleDatesBtn) {
      toggleDatesBtn.addEventListener('click', () => {
        table.classList.toggle('hide-dates');
        localStorage.setItem('stockwatchlist_hide-dates', table.classList.contains('hide-dates'));
      });
    }

    // Settings gear
    const settingsBtn = document.getElementById('settings-btn');
    if (settingsBtn) {
      settingsBtn.addEventListener('click', () => this._showSetup(false));
    }

    // Theme toggle
    document.getElementById('theme-light').addEventListener('click', () => this._toggleTheme('light'));
    document.getElementById('theme-dark').addEventListener('click', () => this._toggleTheme('dark'));

    // Sortable headers (delegation)
    document.querySelector('thead').addEventListener('click', (e) => {
      const th = e.target.closest('th.sortable');
      if (!th) return;
      const col = th.dataset.sort;
      this._toggleSort(col);
    });

    // List toggle buttons (in filters bar) — dynamic from KNOWN_LISTS
    for (const list of KNOWN_LISTS) {
      const btn = document.getElementById('list-toggle-' + list.id);
      if (!btn) continue;
      btn.addEventListener('click', () => {
        this.currentList = list.id;
        this._updateListToggleActive();
        this.applyFilters();
      });
    }

    // Tag filter dropdown
    const tagFilter = document.getElementById('filter-tag');
    if (tagFilter) {
      tagFilter.addEventListener('change', () => {
        this.filterTag = tagFilter.value;
        this.applyFilters();
      });
    }

    // Toggle add-stock section visibility
    if (this.toggleAddSectionBtn && this.addStockSection) {
      this.toggleAddSectionBtn.addEventListener('click', () => {
        const collapsed = this.addStockSection.classList.toggle('collapsed');
        this.toggleAddSectionBtn.textContent = collapsed ? '▶' : '▼';
        localStorage.setItem('stockwatchlist_add-section-collapsed', collapsed);
      });
    }

    // Global toggle — hide/show entire Add Stock section from title bar
    if (this.globalToggleAddSectionBtn && this.addStockSection) {
      this.globalToggleAddSectionBtn.addEventListener('click', () => {
        const hidden = this.addStockSection.classList.toggle('hidden');
        this.globalToggleAddSectionBtn.textContent = hidden ? '🔎' : '🔍';
        this.globalToggleAddSectionBtn.title = hidden ? 'Show Add Stock Section' : 'Hide Add Stock Section';
        localStorage.setItem('stockwatchlist_add-section-hidden', hidden);
      });
    }

    // Daily Notes button — toggle editor
    if (this.btnDailyNotes) {
      this.btnDailyNotes.addEventListener('click', () => this._openDailyNotesEditor());
    }

    // Daily Notes Edit button in panel
    if (this.dailyNotesEditBtn) {
      this.dailyNotesEditBtn.addEventListener('click', () => this._openDailyNotesEditor());
    }

    // Daily Notes Hide button
    if (this.dailyNotesClose) {
      this.dailyNotesClose.addEventListener('click', () => this._hideDailyNotesPanel());
    }

    // Notes Editor — Close button
    if (this.notesEditorClose) {
      this.notesEditorClose.addEventListener('click', () => this._closeDailyNotesEditor());
    }

    // Notes Editor — Close on overlay click
    if (this.notesEditorOverlay) {
      this.notesEditorOverlay.addEventListener('click', (e) => {
        if (e.target === this.notesEditorOverlay) {
          this._closeDailyNotesEditor();
        }
      });
    }

    // Notes Editor — auto-save on input with debounce
    if (this.notesEditorTextarea) {
      this.notesEditorTextarea.addEventListener('input', () => this._onNoteEditorInput());
      // Word/char counter
      this.notesEditorTextarea.addEventListener('input', () => this._updateNoteCharCount());
    }

    // Formatting toolbar buttons
    const toolbar = document.getElementById('notes-editor-toolbar');
    if (toolbar) {
      toolbar.addEventListener('click', (e) => {
        const btn = e.target.closest('.fmt-btn');
        if (!btn) return;
        const fmt = btn.dataset.fmt;
        this._applyFormatting(fmt);
      });
    }

    // Sentiment buttons
    if (this.sentimentBullish) {
      this.sentimentBullish.addEventListener('click', () => this._setSentiment('bullish'));
    }
    if (this.sentimentNeutral) {
      this.sentimentNeutral.addEventListener('click', () => this._setSentiment('neutral'));
    }
    if (this.sentimentBearish) {
      this.sentimentBearish.addEventListener('click', () => this._setSentiment('bearish'));
    }
  }

  // ---- Init Add-Stock Section Toggle State ----
  _initAddSectionToggle() {
    // Restore collapsed state
    const collapsed = localStorage.getItem('stockwatchlist_add-section-collapsed') === 'true';
    if (collapsed && this.addStockSection && this.toggleAddSectionBtn) {
      this.addStockSection.classList.add('collapsed');
      this.toggleAddSectionBtn.textContent = '▶';
    }

    // Restore fully hidden state (title bar toggle)
    const hidden = localStorage.getItem('stockwatchlist_add-section-hidden') === 'true';
    if (hidden && this.addStockSection && this.globalToggleAddSectionBtn) {
      this.addStockSection.classList.add('hidden');
      this.globalToggleAddSectionBtn.textContent = '🔎';
      this.globalToggleAddSectionBtn.title = 'Show Add Stock Section';
    }
  }

  // ---- Look up list info by id (fallback to first known list) ----
  _getListInfo(listId) {
    return KNOWN_LISTS.find(l => l.id === listId) || KNOWN_LISTS[0];
  }

  // ---- Update list toggle button active states ----
  _updateListToggleActive() {
    for (const list of KNOWN_LISTS) {
      const btn = this.listToggleButtons[list.id];
      if (btn) btn.classList.toggle('active', this.currentList === list.id);
    }
  }

  // ---- Switch List (set active toggle, then re-apply filters) ----
  switchList(listName) {
    this.currentList = listName;
    this._updateListToggleActive();
    this.applyFilters();
  }

  // ---- Search Symbol ----
  async searchSymbol() {
    const query = this.searchInput.value.trim().toUpperCase();
    if (!query) return;

    if (!ConfigManager.hasFinnhubKey()) {
      this.searchResults.innerHTML = `
        <div style="padding:12px;color:var(--negative);background:var(--negative-bg);border-radius:6px;">
          ⚠️ No Finnhub API key configured. Click the ⚙️ settings icon to add one.
        </div>`;
      return;
    }

    // Disable search input & button during search
    this.searchInput.disabled = true;
    this.searchBtn.disabled = true;
    this._searchCancelled = false;

    // Show cancelable "retrieving data" overlay
    this.searchResults.innerHTML = `
      <div class="search-loading-overlay" style="padding:24px;text-align:center;background:var(--surface);border:1px solid var(--border);border-radius:8px;">
        <span class="spinner" style="display:inline-block;margin-bottom:12px;"></span>
        <div style="font-weight:600;margin-bottom:8px;">Retrieving data for ${query}...</div>
        <button class="btn btn-secondary" id="search-cancel-btn">Cancel</button>
      </div>
    `;

    // Bind cancel button
    const cancelBtn = document.getElementById('search-cancel-btn');
    if (cancelBtn) {
      cancelBtn.addEventListener('click', () => {
        this._searchCancelled = true;
        this.searchResults.innerHTML = '';
        this._enableSearchInput();
      });
    }

    try {
      const result = await finnhub.searchSymbol(query);
      if (this._searchCancelled) return;

      const results = (result.result || []).filter(r => r.type === 'Common Stock' && !r.symbol.includes('.'));

      if (results.length === 0) {
        // Try direct quote lookup if search returns nothing
        try {
          const stockData = await finnhub.getFullStockData(query);
          if (this._searchCancelled) return;

          // Validate: Finnhub often returns a 0-price response for non-existent tickers
          // Check if the data looks like a real stock (has a price > 0 or a distinct company name)
          const isValid = (stockData.currentPrice > 0) || 
                          (stockData.companyName && stockData.companyName.toUpperCase() !== query);
          if (isValid) {
            this._renderSingleSearchResult(query, stockData);
          } else {
            this._showNotFoundDialog(query);
          }
          this._enableSearchInput();
          return;
        } catch {
          if (this._searchCancelled) return;
          // Direct quote also failed — show "not found" dialog with manual add option
          this._showNotFoundDialog(query);
          this._enableSearchInput();
          return;
        }
      }

      if (this._searchCancelled) return;

      // Collect all unique tags from existing entries for the datalist
      const allTags = [...new Set(this.entries.flatMap(e => e.tags || []))].sort();
      const tagDatalistId = 'tag-suggestions';

      this.searchResults.innerHTML = results.slice(0, 8).map(r => {
        const desc = r.description || r.symbol;
        const truncatedDesc = desc.length > 30 ? desc.substring(0, 30) + '…' : desc;
        const activeInfo = this._getListInfo(this.currentList);
        return `
        <div class="search-result-item" data-symbol="${r.symbol}">
          <span class="symbol">${r.symbol}</span>
          <span class="name" title="${Utils.escapeAttr(desc)}">${Utils.escapeAttr(truncatedDesc)}</span>
          <input type="text" class="tag-input-inline" placeholder="Tags (e.g. Pre-market)..." list="${tagDatalistId}" data-symbol="${r.symbol}" autocomplete="off">
          <input type="text" class="note-input-inline" placeholder="Optional note..." data-symbol="${r.symbol}" maxlength="200">
          <button class="btn btn-sm btn-add" title="Add to ${activeInfo.label} List">${activeInfo.emoji} Add</button>
        </div>
        `;
      }).join('');

      // Append a hidden datalist for tag suggestions
      const existingDatalist = document.getElementById(tagDatalistId);
      if (existingDatalist) existingDatalist.remove();
      const datalist = document.createElement('datalist');
      datalist.id = tagDatalistId;
      datalist.innerHTML = allTags.map(t => `<option value="${Utils.escapeAttr(t)}">`).join('');
      this.searchResults.appendChild(datalist);

      // Helper: add stock to the currently active list
      const addTo = async (btn) => {
        const item = btn.closest('.search-result-item');
        const symbol = item.dataset.symbol;
        const tagInput = item.querySelector('.tag-input-inline');
        const tagStr = tagInput ? tagInput.value.trim() : '';
        const tags = tagStr ? tagStr.split(',').map(t => t.trim()).filter(Boolean) : [];
        const noteInput = item.querySelector('.note-input-inline');
        const note = noteInput ? noteInput.value.trim() : '';
        const listName = this.currentList;

        // Immediately disable card to prevent duplicate clicks and give instant feedback
        const originalBtnText = btn.textContent;
        item.querySelectorAll('button').forEach(b => b.disabled = true);
        btn.textContent = '\u23F3 Adding\u2026';
        item.querySelectorAll('input').forEach(i => i.disabled = true);
        item.style.opacity = '0.5';
        item.style.pointerEvents = 'none';

        const enableCard = () => {
          if (!item.isConnected) return; // card already removed on success
          item.querySelectorAll('button').forEach(b => b.disabled = false);
          btn.textContent = originalBtnText;
          item.querySelectorAll('input').forEach(i => i.disabled = false);
          item.style.opacity = '1';
          item.style.pointerEvents = 'auto';
        };

        try {
          await this._fetchAndConfirmAdd(symbol, listName, tags, note);
          enableCard(); // re-enables if add was aborted (e.g. duplicate)
          this._updateListToggleActive();
        } catch (error) {
          enableCard();
          this._hideLoading();
          Utils.showToast(error.message, 'error');
        }
      };

      // Bind single Add button
      this.searchResults.querySelectorAll('.btn-add').forEach(btn => {
        btn.addEventListener('click', (e) => { e.stopPropagation(); addTo(btn); });
      });

      // Allow Enter key on the note input (adds to current list by default)
      this.searchResults.querySelectorAll('.note-input-inline').forEach(input => {
        input.addEventListener('keypress', (e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            const item = input.closest('.search-result-item');
            const symbol = item.dataset.symbol;
            const note = input.value.trim();
            this._addBySymbolDirect(symbol, note);
            this.searchInput.value = '';
            this.searchResults.innerHTML = '';
          }
        });
        // Prevent click on input from bubbling up
        input.addEventListener('click', (e) => e.stopPropagation());
      });

      this._enableSearchInput();
    } catch (error) {
      if (this._searchCancelled) return;
      this.searchResults.innerHTML = `<div style="padding:12px;color:var(--negative);">Error: ${error.message}</div>`;
      this._enableSearchInput();
    }
  }

  // ---- Re-enable search input & button, focus cursor ----
  _enableSearchInput() {
    this.searchInput.disabled = false;
    this.searchBtn.disabled = false;
    this.searchInput.focus();
  }

  // ---- Render a single search result (used when Finnhub search returns 0 but direct quote succeeds) ----
  _renderSingleSearchResult(symbol, stockData) {
    const allTags = [...new Set(this.entries.flatMap(e => e.tags || []))].sort();
    const tagDatalistId = 'tag-suggestions';
    const activeInfo = this._getListInfo(this.currentList);

    this.searchResults.innerHTML = `
      <div class="search-result-item" data-symbol="${symbol}">
        <span class="symbol">${symbol}</span>
        <span class="name" title="${Utils.escapeAttr(stockData.companyName || symbol)}">${Utils.escapeAttr((stockData.companyName || symbol).length > 30 ? (stockData.companyName || symbol).substring(0, 30) + '…' : (stockData.companyName || symbol))}</span>
        <span class="exchange-badge" style="font-size:0.75rem;color:var(--text-muted);margin-left:8px;">${this._formatExchange(stockData.exchange)}</span>
        <input type="text" class="tag-input-inline" placeholder="Tags (e.g. Pre-market)..." list="${tagDatalistId}" data-symbol="${symbol}" autocomplete="off">
        <input type="text" class="note-input-inline" placeholder="Optional note..." data-symbol="${symbol}" maxlength="200">
        <button class="btn btn-sm btn-add" title="Add to ${activeInfo.label} List">${activeInfo.emoji} Add</button>
      </div>
    `;

    // Append hidden datalist for tag suggestions
    const existingDatalist = document.getElementById(tagDatalistId);
    if (existingDatalist) existingDatalist.remove();
    const datalist = document.createElement('datalist');
    datalist.id = tagDatalistId;
    datalist.innerHTML = allTags.map(t => `<option value="${Utils.escapeAttr(t)}">`).join('');
    this.searchResults.appendChild(datalist);

    // Helper: add stock to the currently active list
    const addTo = async (btn) => {
      const item = btn.closest('.search-result-item');
      const symbol = item.dataset.symbol;
      const tagInput = item.querySelector('.tag-input-inline');
      const tagStr = tagInput ? tagInput.value.trim() : '';
      const tags = tagStr ? tagStr.split(',').map(t => t.trim()).filter(Boolean) : [];
      const noteInput = item.querySelector('.note-input-inline');
      const note = noteInput ? noteInput.value.trim() : '';
      const listName = this.currentList;

      // Immediately disable card to prevent duplicate clicks and give instant feedback
      const originalBtnText = btn.textContent;
      item.querySelectorAll('button').forEach(b => b.disabled = true);
      btn.textContent = '\u23F3 Adding\u2026';
      item.querySelectorAll('input').forEach(i => i.disabled = true);
      item.style.opacity = '0.5';
      item.style.pointerEvents = 'none';

      const enableCard = () => {
        if (!item.isConnected) return; // card already removed on success
        item.querySelectorAll('button').forEach(b => b.disabled = false);
        btn.textContent = originalBtnText;
        item.querySelectorAll('input').forEach(i => i.disabled = false);
        item.style.opacity = '1';
        item.style.pointerEvents = 'auto';
      };

      try {
        await this._addFromExistingData(symbol, stockData, listName, tags, note);
        enableCard(); // re-enables if add was aborted (e.g. duplicate)
        this._updateListToggleActive();
      } catch (error) {
        enableCard();
        this._hideLoading();
        Utils.showToast(error.message, 'error');
      }
    };

    // Bind single Add button
    this.searchResults.querySelectorAll('.btn-add').forEach(btn => {
      btn.addEventListener('click', (e) => { e.stopPropagation(); addTo(btn); });
    });
  }

  // ---- Show "Not Found" dialog with manual add option ----
  _showNotFoundDialog(symbol) {
    this.searchResults.innerHTML = `
      <div class="not-found-dialog" style="padding:16px;background:var(--surface);border:1px solid var(--border);border-radius:8px;text-align:center;">
        <div style="font-size:1.5rem;margin-bottom:8px;">🔍</div>
        <div style="font-weight:600;margin-bottom:4px;">Ticker Not Found</div>
        <div style="color:var(--text-muted);margin-bottom:12px;">"${symbol}" was not found via the Finnhub API. It may be listed on an exchange not covered by Finnhub.</div>
        <div style="margin-bottom:12px;font-size:0.85rem;color:var(--text-muted);">Would you like to add it manually?</div>
        <div style="display:flex;gap:8px;justify-content:center;">
          <button class="btn btn-secondary" id="not-found-cancel">Cancel</button>
          <button class="btn btn-primary" id="not-found-manual">✏️ Add Manually</button>
        </div>
      </div>
    `;

    document.getElementById('not-found-cancel').addEventListener('click', () => {
      this.searchResults.innerHTML = '';
    });

    document.getElementById('not-found-manual').addEventListener('click', () => {
      this._showManualAddForm(symbol);
    });
  }

  // ---- Show Manual Add Form (when ticker not found via API) ----
  _showManualAddForm(symbol) {
    const allTags = [...new Set(this.entries.flatMap(e => e.tags || []))].sort();
    const tagDatalistId = 'tag-suggestions-manual';

    this.searchResults.innerHTML = `
      <div class="manual-add-form" style="padding:16px;background:var(--surface);border:1px solid var(--border);border-radius:8px;">
        <div style="font-weight:600;margin-bottom:12px;">✏️ Manual Add — ${symbol}</div>
        <div style="display:flex;flex-direction:column;gap:10px;">
          <div>
            <label style="display:block;font-size:0.8rem;color:var(--text-muted);margin-bottom:3px;">Symbol</label>
            <input type="text" id="manual-symbol" value="${symbol}" style="width:100%;padding:6px 10px;border:1px solid var(--border);border-radius:4px;background:var(--bg);color:var(--text);" readonly>
          </div>
          <div>
            <label style="display:block;font-size:0.8rem;color:var(--text-muted);margin-bottom:3px;">Company Name</label>
            <input type="text" id="manual-company-name" placeholder="e.g. My Company Inc." style="width:100%;padding:6px 10px;border:1px solid var(--border);border-radius:4px;background:var(--bg);color:var(--text);">
          </div>
          <div>
            <label style="display:block;font-size:0.8rem;color:var(--text-muted);margin-bottom:3px;">Exchange</label>
            <input type="text" id="manual-exchange" placeholder="e.g. NASDAQ, NYSE, OTC" style="width:100%;padding:6px 10px;border:1px solid var(--border);border-radius:4px;background:var(--bg);color:var(--text);">
          </div>
          <div>
            <label style="display:block;font-size:0.8rem;color:var(--text-muted);margin-bottom:3px;">Current Price</label>
            <input type="number" id="manual-price" placeholder="e.g. 150.25" min="0" step="0.01" style="width:100%;padding:6px 10px;border:1px solid var(--border);border-radius:4px;background:var(--bg);color:var(--text);">
          </div>
          <div>
            <label style="display:block;font-size:0.8rem;color:var(--text-muted);margin-bottom:3px;">Tags (comma-separated)</label>
            <input type="text" id="manual-tags" placeholder="e.g. Breakout, Momentum" list="${tagDatalistId}" autocomplete="off" style="width:100%;padding:6px 10px;border:1px solid var(--border);border-radius:4px;background:var(--bg);color:var(--text);">
          </div>
          <div>
            <label style="display:block;font-size:0.8rem;color:var(--text-muted);margin-bottom:3px;">Notes</label>
            <input type="text" id="manual-notes" placeholder="Optional note..." maxlength="200" style="width:100%;padding:6px 10px;border:1px solid var(--border);border-radius:4px;background:var(--bg);color:var(--text);">
          </div>
        </div>
        <div style="display:flex;gap:8px;margin-top:14px;justify-content:flex-end;">
          <button class="btn btn-secondary" id="manual-cancel">Cancel</button>
          <button class="btn btn-sm btn-add" id="manual-add-btn" style="margin:0;">${this._getListInfo(this.currentList).emoji} Add</button>
        </div>
      </div>
    `;

    // Append hidden datalist for tag suggestions
    const existingDatalist = document.getElementById(tagDatalistId);
    if (existingDatalist) existingDatalist.remove();
    const datalist = document.createElement('datalist');
    datalist.id = tagDatalistId;
    datalist.innerHTML = allTags.map(t => `<option value="${Utils.escapeAttr(t)}">`).join('');
    document.getElementById('search-results').appendChild(datalist);

    // Cancel button
    document.getElementById('manual-cancel').addEventListener('click', () => {
      this.searchResults.innerHTML = '';
    });

    // Helper to perform manual add
    const manualAddTo = async (listName) => {
      const sym = document.getElementById('manual-symbol').value.trim().toUpperCase();
      const companyName = document.getElementById('manual-company-name').value.trim();
      const exchange = document.getElementById('manual-exchange').value.trim();
      const priceStr = document.getElementById('manual-price').value.trim();
      const priceVal = priceStr === '' ? 0 : parseFloat(priceStr);
      const tagsStr = document.getElementById('manual-tags').value.trim();
      const tags = tagsStr ? tagsStr.split(',').map(t => t.trim()).filter(Boolean) : [];
      const notes = document.getElementById('manual-notes').value.trim();

      if (!sym) return;

      // Check cross-list duplicate
      if (!this._checkCrossListDuplicate(sym, listName)) return;

      // Build manual stock data using user-entered price
      const stockData = {
        symbol: sym,
        companyName: companyName || sym,
        exchange: exchange || '',
        sector: '',
        notedPrice: priceVal,
        notedPercentChange: 0,
        notedChange: 0,
        notedVolume: 0,
        notedDayHigh: priceVal,
        notedDayLow: priceVal,
        notedOpen: priceVal,
        notedPreviousClose: priceVal,
        currentPrice: priceVal,
        currentPercentChange: 0,
        currentChange: 0,
        currentVolume: 0,
        currentDayHigh: priceVal,
        currentDayLow: priceVal,
        currentOpen: priceVal,
        currentPreviousClose: priceVal,
        hasNewsOnEntry: false,
        newsHeadlines: '',
        quoteTimestamp: null,
        sharesFloat: null,
        sharesOutstanding: null,
        impliedSharesOutstanding: null,
        heldPercentInsiders: null,
        heldPercentInstitutions: null,
      };

      const floatData = {
        sharesOutstanding: null,
        impliedSharesOutstanding: null,
        sharesFloat: null,
        heldPercentInsiders: null,
        heldPercentInstitutions: null,
      };

      await this._addEntryFromData(sym, stockData, listName, tags, notes, floatData);

      this._updateListToggleActive();
    };

    // Bind single Add button
    document.getElementById('manual-add-btn').addEventListener('click', () => manualAddTo(this.currentList));

    // Enter key on notes field submits to current list
    document.getElementById('manual-notes').addEventListener('keypress', (e) => {
      if (e.key === 'Enter') manualAddTo(this.currentList);
    });
  }

  // ---- Add from pre-fetched data without refetching (used by single result card) ----
  async _addFromExistingData(symbol, stockData, listName, tags = [], note = '') {
    // Check cross-list duplicate
    if (!this._checkCrossListDuplicate(symbol, listName)) return;

    // Try Alpha Vantage for float data (non-blocking; fall back to null)
    let floatData = {
      sharesOutstanding: null,
      impliedSharesOutstanding: null,
      sharesFloat: null,
      heldPercentInsiders: null,
      heldPercentInstitutions: null,
    };

    const av = alphavantage;
    if (av) {
      try {
        const avData = await av.getFloatData(symbol);
        if (avData && !avData._error) {
          // Enrich stockData with Alpha Vantage fundamentals
          if (avData.sector && !stockData.sector) stockData.sector = avData.sector;
          if (avData.companyName && stockData.companyName === symbol.toUpperCase()) stockData.companyName = avData.companyName;
          if (avData.exchange && !stockData.exchange) stockData.exchange = avData.exchange;
          floatData = avData;
        }
      } catch (err) {
        console.warn(`[App] Alpha Vantage exception in _addFromExistingData for ${symbol}:`, err.message);
      }
    }

    await this._addEntryFromData(symbol, stockData, listName, tags, note, floatData);
  }

  // ---- Check cross-list duplicate: return true if allowed, false if blocked ----
  // Allows the same ticker in the same list as long as the entry date is different.
  _checkCrossListDuplicate(symbol, listName) {
    const sym = symbol.toUpperCase();
    const targetList = listName || 'main';
    const todayEST = Utils.formatESTDateOnly(new Date());

    const existsInTarget = this.entries.some(e => {
      if (e.symbol.toUpperCase() !== sym) return false;
      if ((e.list || 'main') !== targetList) return false;
      const entryDate = Utils.formatESTDateOnly(e.entryDateEST || e.createdAt);
      return entryDate === todayEST;
    });

    if (existsInTarget) {
      const listLabel = this._getListInfo(targetList).label;
      Utils.showToast(`${sym} is already in the ${listLabel} list for ${todayEST}. It can be added again on a different date.`, 'error', 5000);
      return false;
    }

    return true;
  }

  // ---- Fetch data with Alpha Vantage → Finnhub fallback ----
  async _fetchAndConfirmAdd(symbol, listName, tags = [], note = '') {
    if (!ConfigManager.hasFinnhubKey()) {
      Utils.showToast('No Finnhub API key configured. Click the ⚙️ settings icon to add one.', 'error');
      return;
    }

    // Check cross-list duplicate
    if (!this._checkCrossListDuplicate(symbol, listName)) return;

    this._showLoading(`Fetching ${symbol.toUpperCase()}...`);

    // Step 1: Try Alpha Vantage for float/fundamental data
    let avData = null;
    const sym = symbol.toUpperCase();
    const av = alphavantage;
    if (av) {
      try {
        avData = await av.getFloatData(sym);
        if (avData._error) {
          console.warn(`[App] Alpha Vantage failed for ${sym}: ${avData._reason}, falling back to Finnhub only`);
          avData = null;
        }
      } catch (err) {
        console.warn(`[App] Alpha Vantage exception for ${sym}:`, err.message);
        avData = null;
      }
    }

    // Step 2: Fetch Finnhub data (always needed for price/quote)
    const stockData = await finnhub.getFullStockData(symbol);
    this._hideLoading();

    // Step 3: Merge — use Alpha Vantage float data if available, enrich sector/name
    if (avData && !avData._error) {
      // Use Alpha Vantage fundamental data where Finnhub may be sparse
      if (avData.sector && !stockData.sector) stockData.sector = avData.sector;
      if (avData.companyName && stockData.companyName === sym) stockData.companyName = avData.companyName;
      if (avData.exchange && !stockData.exchange) stockData.exchange = avData.exchange;

      const floatData = {
        sharesOutstanding: avData.sharesOutstanding,
        impliedSharesOutstanding: avData.impliedSharesOutstanding,
        sharesFloat: avData.sharesFloat,
        heldPercentInsiders: avData.heldPercentInsiders,
        heldPercentInstitutions: avData.heldPercentInstitutions,
      };
      await this._addEntryFromData(symbol, stockData, listName, tags, note, floatData);
    } else {
      // Alpha Vantage unavailable or failed — add with null float (user can edit manually)
      const floatData = {
        sharesOutstanding: null,
        impliedSharesOutstanding: null,
        sharesFloat: null,
        heldPercentInsiders: null,
        heldPercentInstitutions: null,
      };
      await this._addEntryFromData(symbol, stockData, listName, tags, note, floatData);
    }
  }

  // ---- Show Float Data Popup (manual entry) ----
  async _showFloatPopup(symbol, stockData, listName, tags, note) {
    document.querySelector('.float-popup-overlay')?.remove();

    const listInfo = this._getListInfo(listName);
    const listLabel = listInfo.label;
    const listEmoji = listInfo.emoji;

    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.className = 'float-popup-overlay';
      overlay.innerHTML = `
        <div class="float-popup">
          <div class="float-popup-header">
            <h2>${symbol} — Float & Ownership Data</h2>
            <p class="float-popup-subtitle">Adding to <strong>${listEmoji} ${listLabel} List</strong></p>
          </div>
          <div class="float-status float-status-info">ℹ️ Enter float/ownership data manually (from Yahoo Finance or your broker)</div>
          <table class="float-table">
            <thead>
              <tr><th>Field</th><th>Value</th></tr>
            </thead>
            <tbody>
              <tr>
                <td class="float-label">Shares Outstanding</td>
                <td><input type="number" class="float-input" id="float-sharesOutstanding" placeholder="e.g. 16000000000" min="0" step="1"></td>
              </tr>
              <tr>
                <td class="float-label">Implied Shares Outstanding</td>
                <td><input type="number" class="float-input" id="float-impliedSO" placeholder="e.g. 15800000000" min="0" step="1"></td>
              </tr>
              <tr>
                <td class="float-label">Float</td>
                <td><input type="number" class="float-input" id="float-sharesFloat" placeholder="e.g. 15500000000" min="0" step="1"></td>
              </tr>
              <tr>
                <td class="float-label">% Held by Insiders</td>
                <td><input type="number" class="float-input" id="float-insiders" placeholder="e.g. 0.15" min="0" max="100" step="0.01"></td>
              </tr>
              <tr>
                <td class="float-label">% Held by Institutions</td>
                <td><input type="number" class="float-input" id="float-institutions" placeholder="e.g. 65.3" min="0" max="100" step="0.01"></td>
              </tr>
            </tbody>
          </table>
          <div class="float-popup-actions">
            <button class="btn btn-secondary float-popup-cancel">Cancel</button>
            <button class="btn btn-primary float-popup-confirm">✅ Confirm Add to ${listLabel}</button>
          </div>
        </div>
      `;

      document.body.appendChild(overlay);

      // Helpers to read inputs
      const getNum = (id) => {
        const val = overlay.querySelector(`#${id}`).value.trim();
        return val === '' ? null : parseFloat(val);
      };

      // Close on overlay click
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) {
          overlay.remove();
          resolve();
        }
      });

      // Cancel
      overlay.querySelector('.float-popup-cancel').addEventListener('click', () => {
        overlay.remove();
        resolve();
      });

      // Confirm — read manual values and add
      overlay.querySelector('.float-popup-confirm').addEventListener('click', async () => {
        const floatData = {
          sharesOutstanding: getNum('float-sharesOutstanding'),
          impliedSharesOutstanding: getNum('float-impliedSO'),
          sharesFloat: getNum('float-sharesFloat'),
          heldPercentInsiders: getNum('float-insiders'),
          heldPercentInstitutions: getNum('float-institutions'),
        };
        overlay.remove();
        await this._addEntryFromData(symbol, stockData, listName, tags, note, floatData);
        resolve();
      });

      // Focus first input
      setTimeout(() => overlay.querySelector('#float-sharesOutstanding')?.focus(), 100);
    });
  }

  // ---- Add entry using pre-fetched data with manual float values ----
  async _addEntryFromData(symbol, stockData, listName, tags, note, floatData) {
    const listLabel = this._getListInfo(listName).label;

    const entry = {
      ...stockData,
      sharesOutstanding: floatData.sharesOutstanding,
      impliedSharesOutstanding: floatData.impliedSharesOutstanding,
      sharesFloat: floatData.sharesFloat,
      heldPercentInsiders: floatData.heldPercentInsiders,
      heldPercentInstitutions: floatData.heldPercentInstitutions,
      entryDateEST: Utils.getCurrentESTISO(),
      notes: note,
      tags: tags,
      list: listName,
    };

    const id = await dataStore.addEntry(entry);
    entry.id = id;
    this.entries.unshift(entry);

    const isOTC = this._isOTC(entry.exchange);
    entry.isOTC = isOTC;

    // No auto WebSocket subscription or polling — user must manually enable via WebS column button
    Utils.showToast(`✅ ${symbol.toUpperCase()} added to ${listLabel} list — click WebS dot to enable live prices`);

    this.currentList = listName;
    this.applyFilters();
    this.updateStats();
    this.searchInput.value = '';
    this.searchResults.innerHTML = '';
  }

  // ---- Add Stock by Symbol Directly (Alpha Vantage → Finnhub fallback) ----
  async _addBySymbolDirect(symbol, note = '', tags = []) {
    if (!ConfigManager.hasFinnhubKey()) {
      Utils.showToast('No Finnhub API key configured. Click the ⚙️ settings icon to add one.', 'error');
      return;
    }

    // Check cross-list duplicate
    if (!this._checkCrossListDuplicate(symbol, this.currentList)) return;

    const listLabel = this._getListInfo(this.currentList).label;
    this._showLoading('Fetching ' + symbol.toUpperCase() + '...');

    try {
      const sym = symbol.toUpperCase();

      // Try Alpha Vantage for float data (non-blocking)
      let avData = null;
      const av = alphavantage;
      if (av) {
        try {
          avData = await av.getFloatData(sym);
          if (avData._error) avData = null;
        } catch (err) {
          console.warn(`[App] Alpha Vantage exception in _addBySymbolDirect for ${sym}:`, err.message);
        }
      }

      const stockData = await finnhub.getFullStockData(symbol);

      // Merge Alpha Vantage data if available
      if (avData && !avData._error) {
        if (avData.sector && !stockData.sector) stockData.sector = avData.sector;
        if (avData.companyName && stockData.companyName === sym) stockData.companyName = avData.companyName;
        if (avData.exchange && !stockData.exchange) stockData.exchange = avData.exchange;
      }

      // Build entry with EST timestamp, list assignment, tags, and optional note
      const entry = {
        ...stockData,
        sharesOutstanding: avData ? avData.sharesOutstanding : null,
        impliedSharesOutstanding: avData ? avData.impliedSharesOutstanding : null,
        sharesFloat: avData ? avData.sharesFloat : null,
        heldPercentInsiders: avData ? avData.heldPercentInsiders : null,
        heldPercentInstitutions: avData ? avData.heldPercentInstitutions : null,
        entryDateEST: Utils.getCurrentESTISO(),
        notes: note,
        tags: tags,
        list: this.currentList,
      };

      const id = await dataStore.addEntry(entry);
      entry.id = id;
      this.entries.unshift(entry);

      this._hideLoading();

      // Detect OTC stocks
      const isOTC = this._isOTC(entry.exchange);
      entry.isOTC = isOTC;

      // No auto WebSocket subscription or polling — user must manually enable via WebS column button
      Utils.showToast(`✅ ${symbol.toUpperCase()} added to ${listLabel} list — click WebS dot to enable live prices`);

      this.applyFilters();
      this.updateStats();
    } catch (error) {
      this._hideLoading();
      Utils.showToast(error.message, 'error');
    }
  }

  // ---- Promote Entry from Temp to Main ----
  async promoteEntry(id) {
    const entry = this.entries.find(e => e.id === id);
    if (!entry) return;

    entry.list = 'main';
    await dataStore.updateEntry(id, { list: 'main' });
    this.applyFilters();
    this.updateStats();
    Utils.showToast(`✅ ${entry.symbol} promoted to Main List`);
  }

  // ---- Collect all unique tags across all entries ----
  _getAllTags() {
    return [...new Set(this.entries.flatMap(e => e.tags || []))].sort();
  }

  // ---- Apply Filters ----
  applyFilters() {
    let filtered = [...this.entries];

    // List filter (always applied)
    filtered = filtered.filter(e => (e.list || 'main') === this.currentList);

    // Tag filter
    if (this.filterTag) {
      filtered = filtered.filter(e => (e.tags || []).includes(this.filterTag));
    }

    // Single date filter — exact day match
    if (this.filterDateFromVal) {
      filtered = filtered.filter(e => {
        const entryDate = Utils.formatESTDateOnly(e.entryDateEST || e.createdAt);
        return entryDate === this.filterDateFromVal;
      });
    }

    // Update the tag filter dropdown options
    this._updateTagFilterDropdown();

    this.filteredEntries = filtered;
    this._applySort();
    this.render();
    this._updateNotesButtonIndicator();
  }

  // ---- Update the tag filter dropdown with all available tags ----
  _updateTagFilterDropdown() {
    const tagFilter = document.getElementById('filter-tag');
    if (!tagFilter) return;
    const selectedVal = tagFilter.value;
    const allTags = this._getAllTags();
    tagFilter.innerHTML = '<option value="">All Tags</option>' + allTags.map(t => `<option value="${Utils.escapeAttr(t)}">${Utils.escapeAttr(t)}</option>`).join('');
    tagFilter.value = selectedVal;
  }

  // ---- Sort ----
  _toggleSort(column) {
    if (this.sortColumn === column) {
      this.sortDirection = this.sortDirection === 'asc' ? 'desc' : 'asc';
    } else {
      this.sortColumn = column;
      this.sortDirection = 'desc';
    }
    this._applySort();
    this.render();
  }

  _applySort() {
    const list = this.filteredEntries;

    const col = this.sortColumn;
    const dir = this.sortDirection === 'asc' ? 1 : -1;

    list.sort((a, b) => {
      let valA, valB;

      switch (col) {
        case 'symbol':
          valA = a.symbol || '';
          valB = b.symbol || '';
          return dir * valA.localeCompare(valB);
        case 'notedPrice':
          valA = a.notedPrice || 0;
          valB = b.notedPrice || 0;
          return dir * (valA - valB);
        case 'currentPrice':
          valA = a.currentPrice || 0;
          valB = b.currentPrice || 0;
          return dir * (valA - valB);
        case 'notedPercentChange':
          valA = a.notedPercentChange || 0;
          valB = b.notedPercentChange || 0;
          return dir * (valA - valB);
        case 'currentPercentChange':
          valA = a.currentPercentChange || 0;
          valB = b.currentPercentChange || 0;
          return dir * (valA - valB);
        case 'notedVolume':
          valA = a.notedVolume || 0;
          valB = b.notedVolume || 0;
          return dir * (valA - valB);
        case 'sector':
          valA = a.sector || '';
          valB = b.sector || '';
          return dir * valA.localeCompare(valB);
        case 'entryDateEST':
        default:
          valA = a.entryDateEST || a.createdAt || '';
          valB = b.entryDateEST || b.createdAt || '';
          return dir * valA.localeCompare(valB);
      }
    });
  }

  get isFiltered() {
    return !!(this.filterDateFromVal || this.filterTag);
  }

  get displayEntries() {
    // filterForList always applies; additional criteria add to isFiltered
    const listEntries = this.entries.filter(e => (e.list || 'main') === this.currentList);
    return this.isFiltered ? this.filteredEntries : listEntries;
  }

  // ---- Render Table ----
  render() {
    const entries = this.displayEntries;

    // Update sort indicators
    document.querySelectorAll('th.sortable .sort-arrow').forEach(el => { el.textContent = ''; });
    const activeTh = document.querySelector(`th[data-sort="${this.sortColumn}"] .sort-arrow`);
    if (activeTh) {
      activeTh.textContent = this.sortDirection === 'asc' ? ' ▲' : ' ▼';
    }

    if (entries.length === 0) {
      this.tableBody.innerHTML = `
        <tr>
          <td colspan="15" class="empty-state">
            <div class="empty-icon">📊</div>
            <div>No stocks in your watch list</div>
            <div style="font-size:0.8rem;margin-top:6px;">Search for a symbol above to add one</div>
          </td>
        </tr>`;
      return;
    }

    this.tableBody.innerHTML = entries.map(e => this._renderRow(e)).join('');

    // Bind action buttons
    this.tableBody.querySelectorAll('.btn-delete').forEach(btn => {
      btn.addEventListener('click', () => this.deleteEntry(btn.dataset.id));
    });
    this.tableBody.querySelectorAll('.btn-edit-notes').forEach(btn => {
      btn.addEventListener('click', () => this._openEditModal(btn.dataset.id));
    });
    this.tableBody.querySelectorAll('.btn-refresh-one').forEach(btn => {
      btn.addEventListener('click', () => this.refreshOnePrice(btn.dataset.id, btn.dataset.symbol));
    });
    this.tableBody.querySelectorAll('.btn-promote').forEach(btn => {
      btn.addEventListener('click', () => this.promoteEntry(btn.dataset.id));
    });
    this.tableBody.querySelectorAll('.ws-toggle').forEach(dot => {
      dot.addEventListener('click', () => {
        const otc = dot.dataset.otc === '1';
        this._toggleWsSubscription(dot.dataset.symbol, otc);
      });
    });
  }

  // ---- Render Single Row ----
  _renderRow(entry) {
    const notesPreview = entry.notes
      ? entry.notes.length > 60 ? entry.notes.substring(0, 60) + '...' : entry.notes
      : 'Click to add notes';
    const hasNotes = entry.notes && entry.notes.trim().length > 0;
    const isTemp = (entry.list || 'main') === 'temp';

    const promoteBtn = isTemp
      ? `<button class="btn btn-sm btn-promote" data-id="${entry.id}" title="Move to Main List">⬆</button>`
      : '';

    // Render tags as badges
    const tagsHtml = (entry.tags && entry.tags.length > 0)
      ? `<div class="tag-badges-row">${entry.tags.map(t => `<span class="tag-badge">${Utils.escapeAttr(t)}</span>`).join(' ')}</div>`
      : '';

    return `
      <tr>
        <td>
          ${promoteBtn}
          <button class="btn btn-sm btn-secondary btn-edit-notes" data-id="${entry.id}" title="Notes: ${Utils.escapeAttr(notesPreview)}">📝</button>
          <button class="btn btn-sm btn-secondary btn-refresh-one" data-id="${entry.id}" data-symbol="${entry.symbol}" title="Refresh Price">🔄</button>
          <button class="btn btn-sm btn-secondary btn-delete" data-id="${entry.id}" title="Delete">🗑</button>
        </td>
        <td class="symbol-cell"><a href="https://www.tradingview.com/chart/?symbol=${entry.symbol}&interval=${(entry.list === 'swing') ? 'D' : '1'}" target="_blank" rel="noopener" class="chart-link" title="Open ${entry.symbol} ${(entry.list === 'swing') ? 'daily' : '1-min'} chart on TradingView">${entry.symbol}</a></td>
        <td class="company-cell"><a href="https://finance.yahoo.com/quote/${entry.symbol}" target="_blank" rel="noopener" class="yahoo-link" title="Open ${entry.symbol} on Yahoo Finance">${entry.companyName || entry.symbol}</a></td>
        <td class="price-cell">${Utils.formatCurrency(entry.currentPrice)}</td>
        <td class="${Utils.valueClass(entry.currentPercentChange)}">${Utils.formatPercent(entry.currentPercentChange)}</td>
        <td class="price-cell">${Utils.formatCurrency(entry.notedPrice)}</td>
        <td class="${Utils.valueClass(Utils.calcGainLoss(entry.notedPrice, entry.currentPrice))}">${Utils.formatPercent(Utils.calcGainLoss(entry.notedPrice, entry.currentPrice))}</td>
        <td>${entry.sharesFloat ? Utils.formatVolume(entry.sharesFloat) : '—'}</td>
        <td title="${Utils.escapeAttr((entry.sector || '').length > 20 ? entry.sector : '')}">${entry.sector ? (entry.sector.length > 20 ? entry.sector.substring(0, 20) + '…' : entry.sector) : '—'}</td>
        <td class="exchange-cell">${this._formatExchange(entry.exchange)}</td>
        <td class="note-dot-cell" title="${Utils.escapeAttr(entry.notes || '')}"><span class="note-dot ${hasNotes ? 'note-dot-active' : ''}"></span>${tagsHtml}</td>
        <td class="news-cell">${entry.newsHeadlines ? `<span title="${Utils.escapeAttr(entry.newsHeadlines)}" style="cursor:pointer;font-size:1.1rem;">📰</span>` : '—'}</td>
        <td class="col-date" style="font-size:0.75rem;color:var(--text-muted);">${Utils.formatEST(entry.entryDateEST || entry.createdAt, { showSeconds: false })}</td>
        <td class="col-date" style="font-size:0.7rem;color:var(--text-muted);">${entry.quoteTimestamp ? Utils.formatEST(entry.quoteTimestamp, { showSeconds: true }) : '—'}</td>
        <td class="ws-cell">
          <span class="ws-toggle ${entry.isOTC && entry._polling ? 'polling' : wsClient.isSubscribed(entry.symbol) ? 'active' : 'inactive'}"
                data-symbol="${entry.symbol}"
                data-otc="${entry.isOTC ? '1' : '0'}"
                title="${entry._polling ? 'Stop polling (OTC)' : wsClient.isSubscribed(entry.symbol) ? 'Unsubscribe from live prices' : entry.isOTC ? 'Start 20s polling (OTC)' : 'Subscribe to live prices'}"></span>
        </td>
      </tr>
    `;
  }

  // ---- Edit Notes Modal ----
  _openEditModal(id) {
    const entry = this.entries.find(e => e.id === id);
    if (!entry) return;

    // Remove existing modal
    document.querySelector('.modal-overlay')?.remove();

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal">
        <h3>Edit — ${entry.symbol}</h3>
        <div class="form-group">
          <label>Notes</label>
          <textarea id="edit-notes" rows="3" placeholder="Add your trading notes...">${(entry.notes || '').replace(/"/g, '"')}</textarea>
        </div>
          <div class="form-group">
          <label>Tags (comma-separated, e.g., Breakout, Gap Up, High Volume)</label>
          <input type="text" id="edit-tags" value="${(entry.tags || []).join(', ')}" placeholder="e.g., Breakout, Momentum">
        </div>
        <div class="form-group">
          <label>Float (Shares Float)</label>
          <input type="number" id="edit-float" value="${entry.sharesFloat || ''}" placeholder="e.g. 15500000000" min="0" step="1">
        </div>
        <div class="modal-buttons">
          <button class="btn btn-secondary" id="modal-cancel">Cancel</button>
          <button class="btn btn-primary" id="modal-save">Save Changes</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    // Close on overlay click
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) overlay.remove();
    });

    // Cancel
    overlay.querySelector('#modal-cancel').addEventListener('click', () => overlay.remove());

    // Save
    overlay.querySelector('#modal-save').addEventListener('click', async () => {
      const notes = overlay.querySelector('#edit-notes').value.trim();
      const tagsStr = overlay.querySelector('#edit-tags').value.trim();
      const tags = tagsStr ? tagsStr.split(',').map(t => t.trim()).filter(Boolean) : [];
      const floatVal = overlay.querySelector('#edit-float').value.trim();
      const sharesFloat = floatVal === '' ? null : parseFloat(floatVal);

      // Update entry
      entry.notes = notes;
      entry.tags = tags;
      entry.sharesFloat = sharesFloat;

      await dataStore.updateEntry(id, { notes, tags, sharesFloat });
      this.render();
      overlay.remove();
      Utils.showToast('Notes & tags updated');
    });

    // Focus notes field
    setTimeout(() => overlay.querySelector('#edit-notes').focus(), 100);
  }

  // ---- Delete All Entries (current list) ----
  async deleteAllEntries() {
    const listLabel = this._getListInfo(this.currentList).label;
    const count = this.entries.filter(e => (e.list || 'main') === this.currentList).length;

    if (count === 0) {
      Utils.showToast(`No entries in ${listLabel} list to delete`);
      return;
    }

    // Show custom confirmation modal (prompt is unreliable across browsers)
    const confirmed = await new Promise((resolve) => {
      // Remove any existing confirm modal
      document.querySelector('.confirm-overlay')?.remove();

      const overlay = document.createElement('div');
      overlay.className = 'confirm-overlay';
      overlay.innerHTML = `
        <div class="confirm-box">
          <div class="confirm-icon">⚠️</div>
          <h3>Delete ALL ${count} entries from ${listLabel} list?</h3>
          <p class="confirm-warning">This cannot be undone. All ${count} stock${count !== 1 ? 's' : ''} will be permanently deleted from the cloud.</p>
          <div class="confirm-input-group">
            <label>Type <strong>${count}</strong> to confirm:</label>
            <input type="text" class="confirm-input" placeholder="${count}" autocomplete="off">
          </div>
          <div class="confirm-error" style="display:none;">Number does not match</div>
          <div class="confirm-buttons">
            <button class="btn btn-secondary confirm-cancel">Cancel</button>
            <button class="btn btn-danger confirm-delete" disabled>Delete All</button>
          </div>
        </div>
      `;

      document.body.appendChild(overlay);

      const input = overlay.querySelector('.confirm-input');
      const deleteBtn = overlay.querySelector('.confirm-delete');
      const errorEl = overlay.querySelector('.confirm-error');

      // Enable/disable delete button based on input match
      input.addEventListener('input', () => {
        const match = input.value.trim() === String(count);
        deleteBtn.disabled = !match;
        errorEl.style.display = input.value.trim() && !match ? 'block' : 'none';
      });

      // Enter key to confirm
      input.addEventListener('keypress', (e) => {
        if (e.key === 'Enter' && input.value.trim() === String(count)) {
          resolve(true);
          overlay.remove();
        }
      });

      // Close on overlay click
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) {
          resolve(false);
          overlay.remove();
        }
      });

      // Cancel button
      overlay.querySelector('.confirm-cancel').addEventListener('click', () => {
        resolve(false);
        overlay.remove();
      });

      // Delete button
      deleteBtn.addEventListener('click', () => {
        if (input.value.trim() === String(count)) {
          resolve(true);
          overlay.remove();
        }
      });

      // Focus input
      setTimeout(() => input.focus(), 100);
    });

    if (!confirmed) {
      return;
    }

    this._showLoading(`Deleting ${count} entries from ${listLabel} list...`);

    try {
      // Unsubscribe all symbols from WebSocket & stop polling
      const symbols = new Set();
      for (const entry of this.entries) {
        if ((entry.list || 'main') === this.currentList) {
          symbols.add(entry.symbol);
          if (entry._polling) {
            this._stopPolling(entry.symbol);
          }
        }
      }
      for (const sym of symbols) {
        wsClient.unsubscribe(sym);
      }

      // Delete from data store
      const deleted = await dataStore.deleteAllEntries(this.currentList);

      // Remove from local array
      this.entries = this.entries.filter(e => (e.list || 'main') !== this.currentList);

      this._hideLoading();
      this.applyFilters();
      this.updateStats();
      Utils.showToast(`🗑 Deleted ${deleted} entries from ${listLabel} list`);
    } catch (error) {
      this._hideLoading();
      Utils.showToast(`Error: ${error.message}`, 'error');
    }
  }

  // ---- Delete Entry ----
  async deleteEntry(id) {
    const entry = this.entries.find(e => e.id === id);
    if (!entry) return;

    if (!confirm(`Remove ${entry.symbol} from your watch list?`)) return;

    await dataStore.deleteEntry(id);
    this.entries = this.entries.filter(e => e.id !== id);

    // Auto-unsubscribe from WebSocket
    wsClient.unsubscribe(entry.symbol);

    // Stop polling if OTC
    if (entry._polling) {
      this._stopPolling(entry.symbol);
    }

    this.applyFilters();
    this.updateStats();
    Utils.showToast(`🗑 ${entry.symbol} removed`);
  }

  // ---- Refresh Single Price ----
  async refreshOnePrice(id, symbol) {
    if (!ConfigManager.hasFinnhubKey()) {
      Utils.showToast('No Finnhub API key configured. Click the ⚙️ settings icon to add one.', 'error');
      return;
    }

    const row = this.tableBody.querySelector(`button[data-id="${id}"]`)?.closest('tr');
    if (row) {
      const td = row.querySelector('td:nth-child(4)'); // Current price cell
      if (td) td.innerHTML = '<span class="spinner"></span>';
    }

    const data = await finnhub.refreshQuote(symbol);

    if (!data._error) {
      const entry = this.entries.find(e => e.id === id);
      if (entry) {
        Object.assign(entry, data);
        await dataStore.updateEntry(id, data);
      }
    }

    this.applyFilters();
    this.updateStats();
  }

  // ---- Refresh All Prices ----
  async refreshAllPrices() {
    if (!ConfigManager.hasFinnhubKey()) {
      Utils.showToast('No Finnhub API key configured. Click the ⚙️ settings icon to add one.', 'error');
      return;
    }

    if (this.entries.length === 0) return;

    this._showLoading('Refreshing prices...');

    let updated = 0;
    const symbols = [...new Set(this.entries.map(e => e.symbol))];

    for (const symbol of symbols) {
      const data = await finnhub.refreshQuote(symbol);
      if (!data._error) {
        // Update all entries with this symbol
        this.entries.forEach(e => {
          if (e.symbol.toUpperCase() === symbol.toUpperCase()) {
            Object.assign(e, data);
          }
        });
        updated++;
      }
      // Small delay between calls to respect rate limit
      if (symbols.length > 1) {
        await new Promise(r => setTimeout(r, 200));
      }
    }

    // Batch update to store
    if (updated > 0) {
      for (const entry of this.entries) {
        await dataStore.updateEntry(entry.id, {
          currentPrice: entry.currentPrice,
          currentPercentChange: entry.currentPercentChange,
          currentChange: entry.currentChange,
          currentVolume: entry.currentVolume,
          currentDayHigh: entry.currentDayHigh,
          currentDayLow: entry.currentDayLow,
          currentOpen: entry.currentOpen,
          currentPreviousClose: entry.currentPreviousClose,
          quoteTimestamp: entry.quoteTimestamp,
          updatedAt: new Date().toISOString()
        });
      }
    }

    this._hideLoading();
    this.applyFilters();
    this.updateStats();
    Utils.showToast(`✅ Refreshed ${updated} stock${updated !== 1 ? 's' : ''}`);
  }

  // ---- Update Summary Stats (disabled - removed from UI) ----
  updateStats() {
    // Stats bar removed; kept as no-op for compatibility
  }

  // ---- Show Setup Overlay (first-run or settings) ----
  _showSetup(isFirstRun = false) {
    const overlay = document.getElementById('setup-overlay');
    const errorEl = document.getElementById('setup-error');
    const finnhubInput = document.getElementById('setup-finnhub-key');
    const avInput = document.getElementById('setup-alphavantage-key');
    const saveBtn = document.getElementById('setup-save');

    overlay.style.display = 'flex';

    // Pre-fill if already saved
    if (!isFirstRun) {
      const config = ConfigManager.get();
      if (config) {
        finnhubInput.value = config.finnhubKey || '';
        if (avInput) avInput.value = config.alphaVantageKey || '';
      }
      document.querySelector('.setup-header h2').textContent = '⚙️ API Settings';
      document.querySelector('.setup-header p').textContent = 'Update your API keys. Cloud sync via Firebase is always on.';
      saveBtn.textContent = 'Save Changes';
    }

    // Save handler
    const saveHandler = () => {
      const finnhubKey = finnhubInput.value.trim();
      const avKey = avInput ? avInput.value.trim() : '';

      if (!finnhubKey) {
        errorEl.textContent = 'Finnhub API key is required to use this app.';
        errorEl.style.display = 'block';
        return;
      }

      errorEl.style.display = 'none';

      // Save to localStorage
      ConfigManager.saveFinnhubKey(finnhubKey);
      if (avKey) {
        ConfigManager.saveAlphaVantageKey(avKey);
      }

      overlay.style.display = 'none';

      // Reset singletons so they pick up the new keys
      delete window._finnhub;
      Object.defineProperty(window, 'finnhub', {
        get() { return getFinnhub(); },
        configurable: true
      });
      delete window._alphavantage;
      Object.defineProperty(window, 'alphavantage', {
        get() { return getAlphaVantage(); },
        configurable: true
      });

      if (isFirstRun) {
        // Boot the app for the first time
        this._bootApp();
      } else {
        // Re-init data store and reload
        this.loadEntries().then(() => {
          const today = Utils.formatESTDateOnly(new Date());
          this.filterDateFromEl.value = today;
          this.filterDateFromVal = today;
          this.dateFilterMode = 'today';
          this._updateDayNavUI();
          this._updateDayBadge();
          this.applyFilters();
          this.updateStats();
        });
      }
    };

    // Save button
    const boundSave = saveHandler.bind(this);
    saveBtn.addEventListener('click', boundSave);

    // Enter key on inputs
    overlay.querySelectorAll('input').forEach(input => {
      input.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') boundSave();
      });
    });
  }

  // ==========================================================================
  // Daily Notes Methods
  // ==========================================================================

  // ---- Initialize daily notes (called once at boot) ----
  async _initDailyNotes() {
    try {
      const dates = await dataStore.getAllNoteDates();
      this._dailyNoteDates = new Set(dates);
      this._updateNotesButtonIndicator();
    } catch (e) {
      console.warn('[DailyNotes] Failed to load note dates:', e.message);
    }
  }

  // ---- Update the Notes button — blue background when current date has a note ----
  _updateNotesButtonIndicator() {
    if (!this.btnDailyNotes) return;
    const dateStr = this.filterDateFromVal || Utils.formatESTDateOnly(new Date());
    if (this._dailyNoteDates.has(dateStr)) {
      this.btnDailyNotes.classList.add('has-note');
    } else {
      this.btnDailyNotes.classList.remove('has-note');
    }
  }

  // ---- Open the daily notes editor modal ----
  async _openDailyNotesEditor() {
    const dateStr = this.filterDateFromVal || Utils.formatESTDateOnly(new Date());

    // Format date for display
    const parts = dateStr.split('-');
    const displayDate = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]))
      .toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

    this.notesEditorDate.textContent = displayDate;
    this._dailyNoteSentiment = null;
    this._dailyNoteDirty = false;
    this._updateSentimentButtons();

    // Load existing note for this date
    try {
      const note = await dataStore.getDailyNote(dateStr);
      if (note) {
        this.notesEditorTextarea.value = note.content || '';
        this._dailyNoteSentiment = note.sentiment || null;
      } else {
        this.notesEditorTextarea.value = '';
        this._dailyNoteSentiment = null;
      }
      this._updateSentimentButtons();
    } catch (e) {
      console.warn('[DailyNotes] Failed to load note:', e.message);
      this.notesEditorTextarea.value = '';
    }

    this._updateNoteCharCount();
    this.notesEditorSaveStatus.textContent = '';
    this.notesEditorSaveStatus.className = 'notes-editor-save-status';
    this.notesEditorOverlay.style.display = 'flex';

    // Focus textarea
    setTimeout(() => this.notesEditorTextarea.focus(), 100);
  }

  // ---- Close the daily notes editor (save if dirty) ----
  async _closeDailyNotesEditor() {
    // Clear any pending auto-save
    if (this._dailyNoteSaveTimer) {
      clearTimeout(this._dailyNoteSaveTimer);
      this._dailyNoteSaveTimer = null;
    }

    // Save if dirty
    if (this._dailyNoteDirty) {
      await this._doSaveDailyNote();
    }

    this.notesEditorOverlay.style.display = 'none';
  }

  // ---- Apply text formatting from toolbar ----
  _applyFormatting(fmt) {
    const ta = this.notesEditorTextarea;
    if (!ta) return;

    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const selected = ta.value.substring(start, end);

    let prefix = '', suffix = '', replacement = '';
    const lineStart = ta.value.lastIndexOf('\n', start - 1) + 1;
    const lineEnd = ta.value.indexOf('\n', end);
    const lineEndPos = lineEnd === -1 ? ta.value.length : lineEnd;
    const lineContent = ta.value.substring(lineStart, lineEndPos);

    switch (fmt) {
      case 'bold':
        prefix = '**'; suffix = '**';
        replacement = selected ? `**${selected}**` : '**bold text**';
        break;
      case 'italic':
        prefix = '*'; suffix = '*';
        replacement = selected ? `*${selected}*` : '*italic text*';
        break;
      case 'heading':
        replacement = selected ? `## ${selected}` : `## Heading`;
        ta.setRangeText(replacement + '\n', lineStart, lineEndPos);
        this._onNoteEditorInput();
        this._updateNoteCharCount();
        return;
      case 'bullet':
        replacement = selected ? selected.split('\n').map(l => `- ${l}`).join('\n') : '- List item';
        ta.setRangeText(replacement, start, end);
        this._onNoteEditorInput();
        this._updateNoteCharCount();
        return;
      case 'number':
        replacement = selected ? selected.split('\n').map((l, i) => `${i + 1}. ${l}`).join('\n') : '1. List item';
        ta.setRangeText(replacement, start, end);
        this._onNoteEditorInput();
        this._updateNoteCharCount();
        return;
      case 'code':
        prefix = '`'; suffix = '`';
        replacement = selected ? `\`${selected}\`` : '`code`';
        break;
      case 'link':
        prefix = '['; suffix = '](url)';
        replacement = selected ? `[${selected}](url)` : '[link text](url)';
        break;
      default:
        return;
    }

    ta.setRangeText(replacement, start, end);
    // Select the placeholder text if nothing was selected
    if (!selected) {
      const newStart = start + prefix.length;
      const newEnd = newStart + replacement.length - prefix.length - suffix.length;
      ta.selectionStart = prefix === '[' ? newStart : newEnd;
      ta.selectionEnd = newEnd;
    }
    ta.focus();
    this._onNoteEditorInput();
    this._updateNoteCharCount();
  }

  // ---- Input handler — trigger auto-save with 2s debounce ----
  _onNoteEditorInput() {
    this._dailyNoteDirty = true;

    if (this._dailyNoteSaveTimer) {
      clearTimeout(this._dailyNoteSaveTimer);
    }

    this.notesEditorSaveStatus.textContent = 'Unsaved changes...';
    this.notesEditorSaveStatus.className = 'notes-editor-save-status unsaved';

    this._dailyNoteSaveTimer = setTimeout(async () => {
      await this._doSaveDailyNote();
    }, 2000);
  }

  // ---- Update word/character count in editor ----
  _updateNoteCharCount() {
    if (!this.notesEditorCharCount || !this.notesEditorTextarea) return;
    const text = this.notesEditorTextarea.value;
    const wordCount = text.trim() ? text.trim().split(/\s+/).length : 0;
    const charCount = text.length;
    this.notesEditorCharCount.textContent = `${wordCount} words / ${charCount} chars`;
  }

  // ---- Set sentiment in the editor ----
  _setSentiment(sentiment) {
    if (this._dailyNoteSentiment === sentiment) {
      this._dailyNoteSentiment = null;
    } else {
      this._dailyNoteSentiment = sentiment;
    }
    this._updateSentimentButtons();
    this._dailyNoteDirty = true;

    // Trigger auto-save
    if (this._dailyNoteSaveTimer) clearTimeout(this._dailyNoteSaveTimer);
    this.notesEditorSaveStatus.textContent = 'Unsaved changes...';
    this.notesEditorSaveStatus.className = 'notes-editor-save-status unsaved';
    this._dailyNoteSaveTimer = setTimeout(async () => {
      await this._doSaveDailyNote();
    }, 2000);
  }

  // ---- Update sentiment button active states ----
  _updateSentimentButtons() {
    if (this.sentimentBullish) {
      this.sentimentBullish.classList.toggle('active', this._dailyNoteSentiment === 'bullish');
    }
    if (this.sentimentNeutral) {
      this.sentimentNeutral.classList.toggle('active', this._dailyNoteSentiment === 'neutral');
    }
    if (this.sentimentBearish) {
      this.sentimentBearish.classList.toggle('active', this._dailyNoteSentiment === 'bearish');
    }
  }

  // ---- Actually save the daily note ----
  async _doSaveDailyNote() {
    if (!this._dailyNoteDirty) return;

    const dateStr = this.filterDateFromVal || Utils.formatESTDateOnly(new Date());
    const content = this.notesEditorTextarea.value;

    try {
      await dataStore.saveDailyNote(dateStr, {
        content: content,
        sentiment: this._dailyNoteSentiment
      });

      this._dailyNoteDirty = false;
      this._dailyNoteDates.add(dateStr);
      this._updateNotesButtonIndicator();

      this.notesEditorSaveStatus.textContent = 'Saved';
      this.notesEditorSaveStatus.className = 'notes-editor-save-status saved';

      // Refresh the display panel if it's showing this date
      if (this._dailyNoteDisplayDate === dateStr && this.dailyNotesPanel.style.display !== 'none') {
        this._renderDailyNotePanel(dateStr, content, this._dailyNoteSentiment);
      }
    } catch (e) {
      console.warn('[DailyNotes] Failed to save:', e.message);
      this.notesEditorSaveStatus.textContent = 'Save failed';
      this.notesEditorSaveStatus.className = 'notes-editor-save-status unsaved';
    }
  }

  // ---- Load and display daily note in the panel for the current date ----
  async _loadDailyNotePanel() {
    const dateStr = this.filterDateFromVal;
    if (!dateStr) {
      this._hideDailyNotesPanel();
      return;
    }

    this._dailyNoteDisplayDate = dateStr;

    // Format date for display
    const parts = dateStr.split('-');
    const displayDate = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]))
      .toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    this.dailyNotesDate.textContent = displayDate;

    try {
      const note = await dataStore.getDailyNote(dateStr);
      if (note && note.content) {
        this._renderDailyNotePanel(dateStr, note.content, note.sentiment);
        this.dailyNotesPanel.style.display = 'block';
      } else {
        this._renderDailyNotePanel(dateStr, '', null);
        this.dailyNotesPanel.style.display = 'block';
      }
    } catch (e) {
      console.warn('[DailyNotes] Failed to load note for panel:', e.message);
      this.dailyNotesPanel.style.display = 'none';
    }
  }

  // ---- Render the daily note content in the panel ----
  _renderDailyNotePanel(dateStr, content, sentiment) {
    // Sentiment badge
    if (this.dailyNotesSentiment) {
      if (sentiment) {
        const labels = { bullish: 'Bullish', neutral: 'Neutral', bearish: 'Bearish' };
        this.dailyNotesSentiment.textContent = labels[sentiment] || '';
        this.dailyNotesSentiment.className = 'daily-notes-sentiment ' + sentiment;
      } else {
        this.dailyNotesSentiment.textContent = '';
        this.dailyNotesSentiment.className = 'daily-notes-sentiment';
      }
    }

    // Word count
    if (this.dailyNotesWordCount) {
      const wordCount = content.trim() ? content.trim().split(/\s+/).length : 0;
      this.dailyNotesWordCount.textContent = wordCount > 0 ? `${wordCount} words` : '';
    }

    // Render content with formatting
    if (content) {
      this.dailyNotesContent.innerHTML = this._renderFormattedContent(content);
    } else {
      this.dailyNotesContent.innerHTML = '<span class="empty-notes">No notes for this date. Click Edit to add notes.</span>';
    }
  }

  // ---- Render formatted note content (simple markdown-like syntax) ----
  _renderFormattedContent(content) {
    // Escape HTML first
    let html = content
      .replace(/&/g, '&')
      .replace(/</g, '<')
      .replace(/>/g, '>');

    // Code blocks (```...```)
    html = html.replace(/```([\s\S]*?)```/g, '<pre><code>$1</code></pre>');

    // Inline code (`...`)
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

    // Bold (**...**)
    html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

    // Italic (*...*)
    html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');

    // Headings (## ...)
    html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');

    // Links [text](url)
    html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');

    // Bullet lists — group consecutive "- " lines into <ul>
    html = html.replace(/((?:^- .+(?:\n|$))+)/gm, (match) => {
      const items = match.trim().split('\n').map(line =>
        '<li>' + line.replace(/^- /, '') + '</li>'
      ).join('');
      return '<ul>' + items + '</ul>';
    });

    // Numbered lists — group consecutive "1. ", "2. "... lines into <ol>
    html = html.replace(/((?:^\d+\. .+(?:\n|$))+)/gm, (match) => {
      const items = match.trim().split('\n').map(line =>
        '<li>' + line.replace(/^\d+\. /, '') + '</li>'
      ).join('');
      return '<ol>' + items + '</ol>';
    });

    // Double newlines to paragraph breaks
    html = html.replace(/\n\n/g, '<br><br>');

    return html;
  }

  // ---- Hide the daily notes panel ----
  _hideDailyNotesPanel() {
    if (this.dailyNotesPanel) {
      this.dailyNotesPanel.style.display = 'none';
    }
    this._dailyNoteDisplayDate = null;
  }

  // ---- Export CSV ----
  exportCSV() {
    const entries = this.displayEntries;
    if (entries.length === 0) {
      Utils.showToast('No entries to export', 'error');
      return;
    }
    Utils.exportCSV(entries);
    Utils.showToast(`📤 Exported ${entries.length} entries as CSV`);
  }

  // ---- Loading Overlay ----
  _showLoading(message) {
    this.loadingOverlay.innerHTML = `
      <div class="loading-box">
        <span class="spinner"></span>
        <span>${message}</span>
      </div>`;
    this.loadingOverlay.style.display = 'flex';
  }

  _hideLoading() {
    this.loadingOverlay.style.display = 'none';
  }
}

// ---- Boot ----
document.addEventListener('DOMContentLoaded', () => {
  window.app = new StockWatchApp();
  window.app.init();
});