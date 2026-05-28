// ============================================================================
// STOCK WATCH LIST — Main Application Logic
// ============================================================================

class StockWatchApp {
  constructor() {
    this.entries = [];
    this.filteredEntries = [];
    this.filterDateFromVal = null;
    this.filterDateToVal = null;
    this.filterTag = '';
    this.sortColumn = 'entryDateEST';
    this.sortDirection = 'desc';

    // DOM refs
    this.tableBody = document.getElementById('watchlist-body');
    this.searchInput = document.getElementById('symbol-search');
    this.searchBtn = document.getElementById('search-btn');
    this.searchResults = document.getElementById('search-results');
    this.refreshBtn = document.getElementById('refresh-btn');
    this.exportBtn = document.getElementById('export-btn');
    this.filterDateFromEl = document.getElementById('filter-date-from');
    this.filterDateToEl = document.getElementById('filter-date-to');
    this.tagFilterEl = document.getElementById('tag-filter');
    this.statsBar = document.getElementById('stats-bar');
    this.connectionDot = document.getElementById('connection-dot');
    this.connectionText = document.getElementById('connection-text');
    this.themeLightBtn = document.getElementById('theme-light');
    this.themeDarkBtn = document.getElementById('theme-dark');
    this.loadingOverlay = document.getElementById('loading-overlay');
  }

  // ---- Initialize ----
  async init() {
    // Load theme preference
    this._initTheme();

    // Init data store
    const cloudConnected = await dataStore.init();
    this._updateConnectionStatus(cloudConnected);

    // Load entries
    await this.loadEntries();

    // Default date filter to today
    const today = Utils.formatESTDateOnly(new Date());
    this.filterDateFromEl.value = today;
    this.filterDateFromVal = today;

    // Bind events
    this._bindEvents();

    // Apply initial filter and render
    this.applyFilters();
    this.updateStats();
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

  // ---- Bind Events ----
  _bindEvents() {
    // Search
    this.searchInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') this.searchSymbol();
    });
    this.searchBtn.addEventListener('click', () => this.searchSymbol());

    // Debounced search on input
    this.searchInput.addEventListener('input', Utils.debounce(() => {
      if (this.searchInput.value.length >= 2) {
        this.searchSymbol();
      } else {
        this.searchResults.innerHTML = '';
      }
    }, 400));

    // Refresh
    this.refreshBtn.addEventListener('click', () => this.refreshAllPrices());

    // Export
    this.exportBtn.addEventListener('click', () => this.exportCSV());

    // Filter by date
    this.filterDateFromEl.addEventListener('change', () => {
      this.filterDateFromVal = this.filterDateFromEl.value;
      this.applyFilters();
    });
    this.filterDateToEl.addEventListener('change', () => {
      this.filterDateToVal = this.filterDateToEl.value;
      this.applyFilters();
    });
    document.getElementById('clear-filters-btn').addEventListener('click', () => {
      const today = Utils.formatESTDateOnly(new Date());
      this.filterDateFromEl.value = today;
      this.filterDateToEl.value = '';
      this.filterDateFromVal = today;
      this.filterDateToVal = null;
      this.filterTag = '';
      this.tagFilterEl.value = '';
      this.applyFilters();
    });

    // Filter by tag
    if (this.tagFilterEl) {
      this.tagFilterEl.addEventListener('change', () => {
        this.filterTag = this.tagFilterEl.value;
        this.applyFilters();
      });
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
  }

  // ---- Search Symbol ----
  async searchSymbol() {
    const query = this.searchInput.value.trim().toUpperCase();
    if (!query) return;

    if (FINNHUB_API_KEY === 'YOUR_FINNHUB_API_KEY_HERE') {
      this.searchResults.innerHTML = `
        <div style="padding:12px;color:var(--negative);background:var(--negative-bg);border-radius:6px;">
          ⚠️ Please set your Finnhub API key in <code>js/finnhub.js</code>
        </div>`;
      return;
    }

    this.searchResults.innerHTML = '<div style="padding:12px;color:var(--text-muted);"><span class="spinner"></span> Searching...</div>';

    try {
      const result = await finnhub.searchSymbol(query);
      const results = (result.result || []).filter(r => r.type === 'Common Stock' && !r.symbol.includes('.'));

      if (results.length === 0) {
        // Try direct quote lookup if search returns nothing
        try {
          await this._addBySymbolDirect(query);
          this.searchInput.value = '';
          return;
        } catch {
          this.searchResults.innerHTML = '<div style="padding:12px;color:var(--text-muted);">No results found for "' + query + '"</div>';
          return;
        }
      }

      this.searchResults.innerHTML = results.slice(0, 8).map(r => `
        <div class="search-result-item" data-symbol="${r.symbol}">
          <span class="symbol">${r.symbol}</span>
          <span class="name">${r.description || r.symbol}</span>
          <button class="btn btn-primary btn-sm">+ Add</button>
        </div>
      `).join('');

      // Bind click handlers
      this.searchResults.querySelectorAll('.search-result-item').forEach(item => {
        item.addEventListener('click', async () => {
          const symbol = item.dataset.symbol;
          await this._addBySymbolDirect(symbol);
          this.searchInput.value = '';
          this.searchResults.innerHTML = '';
        });
      });
    } catch (error) {
      this.searchResults.innerHTML = `<div style="padding:12px;color:var(--negative);">Error: ${error.message}</div>`;
    }
  }

  // ---- Add Stock by Symbol Directly ----
  async _addBySymbolDirect(symbol) {
    if (FINNHUB_API_KEY === 'YOUR_FINNHUB_API_KEY_HERE') {
      Utils.showToast('Please set your Finnhub API key in js/finnhub.js', 'error');
      return;
    }

    // Check if already in list
    const exists = this.entries.some(e => e.symbol.toUpperCase() === symbol.toUpperCase());
    if (exists) {
      Utils.showToast(`${symbol.toUpperCase()} is already in your watch list`, 'error');
      return;
    }

    this._showLoading('Fetching ' + symbol.toUpperCase() + '...');

    try {
      const stockData = await finnhub.getFullStockData(symbol);

      // Build entry with EST timestamp
      const entry = {
        ...stockData,
        entryDateEST: Utils.getCurrentESTISO(),
        notes: '',
        tags: [],
      };

      const id = await dataStore.addEntry(entry);
      entry.id = id;
      this.entries.unshift(entry);

      this._hideLoading();
      this.applyFilters();
      this.updateStats();
      this.updateTagFilter();
      Utils.showToast(`✅ ${symbol.toUpperCase()} added to watch list`);
    } catch (error) {
      this._hideLoading();
      Utils.showToast(error.message, 'error');
    }
  }

  // ---- Apply Filters ----
  applyFilters() {
    let filtered = [...this.entries];

    // Date range filter
    if (this.filterDateFromVal) {
      filtered = filtered.filter(e => {
        const entryDate = Utils.formatESTDateOnly(e.entryDateEST || e.createdAt);
        return entryDate >= this.filterDateFromVal;
      });
    }
    if (this.filterDateToVal) {
      filtered = filtered.filter(e => {
        const entryDate = Utils.formatESTDateOnly(e.entryDateEST || e.createdAt);
        return entryDate <= this.filterDateToVal;
      });
    }

    // Tag filter
    if (this.filterTag) {
      filtered = filtered.filter(e =>
        (e.tags || []).some(t => t.toLowerCase() === this.filterTag.toLowerCase())
      );
    }

    this.filteredEntries = filtered;
    this._applySort();
    this.render();
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
    const list = this.filteredEntries.length || this.isFiltered ? this.filteredEntries :
      (this.filteredEntries = [...this.entries]);

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
    return !!(this.filterDateFromVal || this.filterDateToVal || this.filterTag);
  }

  get displayEntries() {
    return this.isFiltered ? this.filteredEntries : this.entries;
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
          <td colspan="13" class="empty-state">
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
  }

  // ---- Render Single Row ----
  _renderRow(entry) {
    const notesPreview = entry.notes
      ? entry.notes.length > 60 ? entry.notes.substring(0, 60) + '...' : entry.notes
      : 'Click to add notes';
    const hasNotes = entry.notes && entry.notes.trim().length > 0;

    return `
      <tr>
        <td>
          <button class="btn btn-sm btn-secondary btn-edit-notes" data-id="${entry.id}" title="Notes: ${notesPreview}">📝</button>
          <button class="btn btn-sm btn-secondary btn-refresh-one" data-id="${entry.id}" data-symbol="${entry.symbol}" title="Refresh Price">🔄</button>
          <button class="btn btn-sm btn-danger btn-delete" data-id="${entry.id}" title="Delete">🗑</button>
        </td>
        <td class="symbol-cell">${entry.symbol}</td>
        <td class="company-cell" title="${entry.companyName || ''}">${entry.companyName || entry.symbol}</td>
        <td class="price-cell">${Utils.formatCurrency(entry.currentPrice)}</td>
        <td class="${Utils.valueClass(entry.currentPercentChange)}">${Utils.formatPercent(entry.currentPercentChange)}</td>
        <td class="price-cell">${Utils.formatCurrency(entry.notedPrice)}</td>
        <td class="${Utils.valueClass(entry.notedPercentChange)}">${Utils.formatPercent(entry.notedPercentChange)}</td>
        <td>${entry.sharesOutstanding ? Utils.formatVolume(entry.sharesOutstanding) : '—'}</td>
        <td>${entry.sector || '—'}</td>
        <td>${(entry.tags || []).length ? entry.tags.map(t => `<span class="tag-badge">${t}</span>`).join('') : '—'}</td>
        <td class="note-dot-cell" title="${entry.notes || ''}"><span class="note-dot ${hasNotes ? 'note-dot-active' : ''}"></span></td>
        <td class="news-cell">${entry.newsHeadlines ? `<span title="${Utils.escapeAttr(entry.newsHeadlines)}" style="cursor:pointer;font-size:1.1rem;">📰</span>` : '—'}</td>
        <td style="font-size:0.75rem;color:var(--text-muted);">${Utils.formatEST(entry.entryDateEST || entry.createdAt, { showSeconds: false })}</td>
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

      // Update entry
      entry.notes = notes;
      entry.tags = tags;

      await dataStore.updateEntry(id, { notes, tags });
      this.render();
      this.updateTagFilter();
      overlay.remove();
      Utils.showToast('Notes & tags updated');
    });

    // Focus notes field
    setTimeout(() => overlay.querySelector('#edit-notes').focus(), 100);
  }

  // ---- Delete Entry ----
  async deleteEntry(id) {
    const entry = this.entries.find(e => e.id === id);
    if (!entry) return;

    if (!confirm(`Remove ${entry.symbol} from your watch list?`)) return;

    await dataStore.deleteEntry(id);
    this.entries = this.entries.filter(e => e.id !== id);
    this.applyFilters();
    this.updateStats();
    this.updateTagFilter();
    Utils.showToast(`🗑 ${entry.symbol} removed`);
  }

  // ---- Refresh Single Price ----
  async refreshOnePrice(id, symbol) {
    if (FINNHUB_API_KEY === 'YOUR_FINNHUB_API_KEY_HERE') {
      Utils.showToast('Please set your Finnhub API key in js/finnhub.js', 'error');
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
    if (FINNHUB_API_KEY === 'YOUR_FINNHUB_API_KEY_HERE') {
      Utils.showToast('Please set your Finnhub API key in js/finnhub.js', 'error');
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

  // ---- Update Tag Filter Dropdown ----
  updateTagFilter() {
    if (!this.tagFilterEl) return;

    const allTags = new Set();
    this.entries.forEach(e => {
      (e.tags || []).forEach(t => allTags.add(t));
    });

    const currentVal = this.tagFilterEl.value;
    this.tagFilterEl.innerHTML = '<option value="">All Tags</option>' +
      [...allTags].sort().map(t => `<option value="${t}">${t}</option>`).join('');

    this.tagFilterEl.value = currentVal;
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