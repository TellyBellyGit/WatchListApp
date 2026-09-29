// ============================================================================
// TRADE JOURNAL APP — standalone controller for TradeJournal.html
// ============================================================================
// This file runs in its OWN browser tab and must work with or without the main
// StockWatchList app. It therefore never touches `window._app`, never loads
// app.js or trade-reviews.js, and degrades gracefully when:
//   • Firebase is unreachable → entries fall back to localStorage
//   • Quill failed to load    → the 13-column form still saves
//   • No Finnhub API key      → ticker is stored as typed, no lookup
//
// Data model: journal_entries/{id} — the 13 columns from Day_Trading_Journal.xlsx
// plus the mentor advice, plus an optional Quill deep dive. See
// js/journal-categories.js for the verbatim category/column definitions.
// ============================================================================

class TradeJournalApp {
  constructor() {
    this._entries = [];            // all loaded entries
    this._filtered = [];           // after filters applied
    this._currentId = null;        // editor target (null = new entry)
    this._isDirty = false;
    this._isNewEntry = false;
    this._isDeleting = false;
    this._quill = null;
    this._fields = {};             // field key → input element
    this._symbolLookupTimer = null;
    this._tags = [];
    this._outcomeTouched = false;
    this._activeCategory = null;   // Review-by-category selection
    this._sort = { key: 'date', dir: 'desc' };
    this._sourceReview = null;     // linked trade review (read-only panel)
    this._isFirstRun = true;
    this._view = 'entries';        // active tab: 'entries' | 'categories'
  }

  // ==========================================================================
  // Boot
  // ==========================================================================
  async init() {
    this._cacheDom();
    this._initTheme();
    this._renderStaticOptions();
    this._initQuill();
    this._bindEvents();

    // Persist an in-progress form before the tab closes (best effort)
    window.addEventListener('beforeunload', () => {
      if (this._isDirty) this._doSave(true);
    });

    // Connect the data store (it falls back to localStorage internally)
    const ok = await dataStore.init();
    this._updateCloudBadge(ok === true);

    await this.loadEntries();
    this._startAutoSave();

    // Prefill AFTER the first render so a fresh entry is not wiped by reload
    this._applyPrefill();
    this._isFirstRun = false;
  }

  _cacheDom() {
    const $ = (id) => document.getElementById(id);

    // Header
    this.cloudBadge      = $('tj-cloud-badge');
    this.saveStatus      = $('tj-save-status');
    this.btnNew          = $('tj-btn-new');
    this.btnRefresh      = $('tj-btn-refresh');
    this.btnTheme        = $('tj-btn-theme');

    // Stats + tabs
    this.statsEl         = $('tj-stats');
    this.tabs            = Array.from(document.querySelectorAll('.tj-tab'));
    this.panelEntries    = $('tj-panel-entries');
    this.panelCategories = $('tj-panel-categories');

    // Filters
    this.searchInput     = $('tj-search');
    this.filterCategory  = $('tj-filter-category');
    this.filterTimeframe = $('tj-filter-timeframe');
    this.filterAdvice    = $('tj-filter-advice');
    this.filterFrom      = $('tj-filter-from');
    this.filterTo        = $('tj-filter-to');
    this.btnClearFilters = $('tj-btn-clear-filters');
    this.resultCount     = $('tj-result-count');

    // Table
    this.tableHead       = $('tj-table-head');
    this.tableBody       = $('tj-table-body');
    this.emptyState      = $('tj-empty-state');

    // Review-by-category
    this.catPivotBody    = $('tj-cat-pivot-body');
    this.catDetail       = $('tj-cat-detail');
    this.catDetailTitle  = $('tj-cat-detail-title');
    this.catDetailMeaning= $('tj-cat-detail-meaning');
    this.catDetailStats  = $('tj-cat-detail-stats');
    this.catList         = $('tj-cat-list');
    this.catAdvice       = $('tj-cat-advice');
    this.catDetailEmpty  = $('tj-cat-detail-empty');

    // Editor
    this.editorOverlay   = $('tj-editor-overlay');
    this.editorHeading   = $('tj-editor-heading');
    this.editorDirty     = $('tj-editor-dirty');
    this.editorSaveBtn   = $('tj-btn-save-editor');
    this.editorDeleteBtn = $('tj-btn-delete-editor');
    this.editorCloseBtn  = $('tj-btn-close-editor');
    this.editorFullscreen= $('tj-btn-fullscreen');
    this.quillContainer  = $('tj-quill');
    this.pnlTotal        = $('tj-pnl-total');
    this.pnlPercent      = $('tj-pnl-percent');
    this.pnlPerShare     = $('tj-pnl-per-share');
    this.durationEl      = $('tj-duration');
    this.realisedREl     = $('tj-realised-r');
    this.tagsInput       = $('tj-tags-input');
    this.tagChips        = $('tj-tag-chips');
    this.adviceHint      = $('tj-advice-hint');
    this.categoryHint    = $('tj-category-hint');
    this.sourceReviewEl  = $('tj-source-review');
    this.sourceReviewBody= $('tj-source-review-body');
    this.linkBadge       = $('tj-link-badge');

    // Confirm dialog
    this.confirmOverlay  = $('tj-confirm-overlay');
    this.confirmText     = $('tj-confirm-text');

    // Field map — every input in the editor carries data-field="<key>"
    this._fields = {};
    this.editorOverlay.querySelectorAll('[data-field]').forEach(el => {
      this._fields[el.dataset.field] = el;
    });
  }

  // ---- Theme (shares the main app's key: stockwatchlist_theme) ----
  _initTheme() {
    const saved = localStorage.getItem('stockwatchlist_theme') || 'dark';
    document.documentElement.setAttribute('data-theme', saved);
    if (this.btnTheme) this.btnTheme.textContent = saved === 'dark' ? '☀️' : '🌙';
  }

  _toggleTheme() {
    const current = document.documentElement.getAttribute('data-theme');
    const next = current === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('stockwatchlist_theme', next);
    if (this.btnTheme) this.btnTheme.textContent = next === 'dark' ? '☀️' : '🌙';
  }

  // ---- Populate selects / datalists from the shared vocabulary ----
  _renderStaticOptions() {
    // Category select — grouped, meaning shown as the option tooltip
    if (this._fields.category) {
      this._fields.category.innerHTML = JournalCategories.buildCategoryOptionsHtml('');
    }

    // Timeframe / Setup suggestions (free text is still allowed)
    const tfList = document.getElementById('tj-timeframe-list');
    if (tfList) {
      tfList.innerHTML = JOURNAL_TIMEFRAMES
        .map(v => `<option value="${JournalText.esc(v)}"></option>`).join('');
    }
    const setupList = document.getElementById('tj-setup-list');
    if (setupList) {
      setupList.innerHTML = JOURNAL_SETUPS
        .map(v => `<option value="${JournalText.esc(v)}"></option>`).join('');
    }

    // Filter dropdowns
    if (this.filterCategory) {
      this.filterCategory.innerHTML = `<option value="">All categories</option>` +
        JOURNAL_CATEGORY_GROUPS.map(g => {
          const items = JournalCategories.byGroup(g.id);
          if (!items.length) return '';
          return `<optgroup label="${JournalText.esc(g.icon + ' ' + g.label)}">` +
            items.map(c => `<option value="${JournalText.esc(c.name)}">${JournalText.esc(c.icon + ' ' + c.name)}</option>`).join('') +
            `</optgroup>`;
        }).join('');
    }
    if (this.filterTimeframe) {
      this.filterTimeframe.innerHTML = `<option value="">All timeframes</option>` +
        JOURNAL_TIMEFRAMES.map(v => `<option value="${JournalText.esc(v)}">${JournalText.esc(v)}</option>`).join('');
    }
  }

  // ---- Quill deep-dive editor (identical config to the Reviews tab) ----
  _initQuill() {
    if (typeof Quill === 'undefined') {
      console.warn('[TradeJournal] Quill not loaded — deep-dive editor unavailable');
      if (this.quillContainer) {
        this.quillContainer.innerHTML =
          '<div class="tj-quill-missing">Rich-text editor unavailable (Quill did not load). ' +
          'The structured fields above still save normally.</div>';
      }
      return;
    }

    this._quill = new Quill(this.quillContainer, {
      theme: 'snow',
      placeholder: 'Deep dive: chart context, annotated screenshots (Ctrl+V to paste), what you saw, what you did…',
      modules: {
        toolbar: [
          [{ header: [1, 2, 3, false] }],
          ['bold', 'italic', 'underline', 'strike'],
          [{ list: 'ordered' }, { list: 'bullet' }],
          ['blockquote', 'code-block'],
          ['link', 'image'],
          [{ color: [] }, { background: [] }],
          ['clean']
        ],
        clipboard: { matchVisual: false }
      }
    });

    // Paste → annotate → upload (same flow as the Reviews tab)
    this._quill.root.addEventListener('paste', (e) => this._handlePaste(e));

    // Track changes for auto-save
    this._quill.on('text-change', () => this._markDirty());

    // Hover ✏️ over an already-inserted image to re-annotate it
    if (typeof imageAnnotator !== 'undefined') {
      imageAnnotator.attachEditorImageEditing(
        this._quill,
        () => this._currentId || dataStore.generateJournalId(),
        () => this._markDirty()
      );
    }
  }

  // ---- Paste an image: annotate, then upload under the entry's folder ----
  async _handlePaste(e) {
    const clipboardData = e.clipboardData || window.clipboardData;
    if (!clipboardData || !clipboardData.items) return;

    const items = clipboardData.items;
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (!item.type.startsWith('image/')) continue;

      e.preventDefault();
      e.stopPropagation();

      const blob = item.getAsFile();
      if (!blob) continue;

      // Let the user draw on the chart before it is inserted
      const annotatedBlob = await imageAnnotator.annotate(blob);
      if (!annotatedBlob) break; // cancelled → drop the paste

      // Allocate the entry ID first so the image lands in its final folder
      if (!this._currentId) {
        this._currentId = dataStore.generateJournalId();
        this._isNewEntry = true;
      }

      const PLACEHOLDER = '[Uploading image to cloud...]';
      try {
        const range = this._quill.getSelection(true);
        this._quill.insertText(range.index, PLACEHOLDER, { color: '#888' });
        const uploadIndex = range.index;

        const downloadUrl = await imageStorage.uploadImage(annotatedBlob, this._currentId);
        if (!downloadUrl || downloadUrl.startsWith('data:')) {
          throw new Error('Upload returned a data URI instead of a Storage URL');
        }

        this._quill.deleteText(uploadIndex, PLACEHOLDER.length);
        this._quill.insertEmbed(uploadIndex, 'image', downloadUrl);
        this._quill.setSelection(uploadIndex + 1);
        this._markDirty();
      } catch (err) {
        console.error('[TradeJournal] Image upload failed:', err.message || err);
        try {
          const range = this._quill.getSelection(true);
          if (range) this._quill.deleteText(Math.max(0, range.index - PLACEHOLDER.length), PLACEHOLDER.length);
        } catch (e2) { /* ignore */ }
        Utils.showToast('Image upload failed — check Firebase Storage is enabled and CORS is configured');
      }
      break;
    }
  }

  // ==========================================================================
  // Event wiring
  // ==========================================================================
  _bindEvents() {
    // Header
    this.btnNew.addEventListener('click', () => this.openEditor(null));
    this.btnRefresh.addEventListener('click', () => this.loadEntries(true));
    this.btnTheme.addEventListener('click', () => this._toggleTheme());

    // View tabs
    this.tabs.forEach(tab => tab.addEventListener('click', () => this._switchView(tab.dataset.tab)));

    // Filters
    this.searchInput.addEventListener('input', () => this._applyFilters());
    [this.filterCategory, this.filterTimeframe, this.filterAdvice, this.filterFrom, this.filterTo]
      .forEach(el => el.addEventListener('change', () => this._applyFilters()));
    this.btnClearFilters.addEventListener('click', () => this._clearFilters());

    // Table: sortable headers + row actions
    this.tableHead.addEventListener('click', (e) => {
      const th = e.target.closest('th[data-sort]');
      if (th) this._toggleSort(th.dataset.sort);
    });
    this.tableBody.addEventListener('click', (e) => {
      const editBtn = e.target.closest('[data-edit]');
      if (editBtn) { this.openEditor(editBtn.dataset.edit); return; }
      const delBtn = e.target.closest('[data-del]');
      if (delBtn) { this._deleteEntryById(delBtn.dataset.del); return; }
      const row = e.target.closest('tr[data-id]');
      if (row) this.openEditor(row.dataset.id);
    });

    // Review-by-category: pivot rows + the two filtered panes
    this.catPivotBody.addEventListener('click', (e) => {
      const cell = e.target.closest('[data-category]');
      if (cell) this._selectCategory(cell.dataset.category);
    });
    [this.catList, this.catAdvice].forEach(host => {
      host.addEventListener('click', (e) => {
        const editBtn = e.target.closest('[data-edit]');
        if (editBtn) { this.openEditor(editBtn.dataset.edit); return; }
        const advBtn = e.target.closest('[data-toggle-advice]');
        if (advBtn) this._toggleAdviceStatus(advBtn.dataset.toggleAdvice);
      });
    });

    // Editor chrome
    this.editorCloseBtn.addEventListener('click', () => this.closeEditor());
    this.editorSaveBtn.addEventListener('click', () => this._doSave());
    this.editorDeleteBtn.addEventListener('click', () => this._doDelete());
    this.editorFullscreen.addEventListener('click', () => {
      const isFs = this.editorOverlay.classList.toggle('fullscreen');
      this.editorFullscreen.title = isFs ? 'Exit full screen' : 'Full screen';
      this.editorFullscreen.textContent = isFs ? '🗗' : '⛶';
    });
    this.editorOverlay.addEventListener('click', (e) => {
      if (e.target === this.editorOverlay) this.closeEditor();
    });

    // Numbers section toggle
    const btnToggleTrade = document.getElementById('tj-btn-toggle-trade');
    if (btnToggleTrade) {
      btnToggleTrade.addEventListener('click', () => {
        const section = document.getElementById('tj-trade-section');
        this._setTradeSectionOpen(section.style.display === 'none');
      });
    }

    // Any field edit marks the form dirty — one listener covers all 13 + extras
    this.editorOverlay.addEventListener('input', () => this._markDirty());
    this.editorOverlay.addEventListener('change', () => this._markDirty());

    // Category → show the sheet's meaning under the select
    if (this._fields.category) {
      this._fields.category.addEventListener('change', () => this._updateCategoryHint());
    }

    // Numbers → live P&L / duration / R
    ['entryPrice', 'exitPrice', 'shares', 'direction', 'entryTime', 'exitTime', 'fees', 'plannedRiskR']
      .forEach(key => {
        const el = this._fields[key];
        if (!el) return;
        el.addEventListener('input', () => this._updatePnl());
        el.addEventListener('change', () => this._updatePnl());
      });

    // Outcome is free text — stop auto-filling once the user types in it
    if (this._fields.outcome) {
      this._fields.outcome.addEventListener('input', () => { this._outcomeTouched = true; });
    }

    // Ticker lookup (optional, degrades silently without an API key)
    if (this._fields.ticker) {
      this._fields.ticker.addEventListener('input', () => this._debounceSymbolLookup());
    }

    // Tags
    this.tagsInput.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      const value = this.tagsInput.value.trim();
      if (value && !this._tags.includes(value)) {
        this._tags.push(value);
        this._renderTagChips();
        this._markDirty();
      }
      this.tagsInput.value = '';
    });
    this.tagChips.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-tag]');
      if (!btn) return;
      this._tags = this._tags.filter(t => t !== btn.dataset.tag);
      this._renderTagChips();
      this._markDirty();
    });

    // Confirm dialog
    document.getElementById('tj-confirm-yes').addEventListener('click', () => this._resolveConfirm(true));
    document.getElementById('tj-confirm-no').addEventListener('click', () => this._resolveConfirm(false));
  }

  // ==========================================================================
  // Views, status + auto-save
  // ==========================================================================
  _switchView(view) {
    this._view = view;
    this.tabs.forEach(t => t.classList.toggle('active', t.dataset.tab === view));
    this.panelEntries.style.display = view === 'entries' ? 'block' : 'none';
    this.panelCategories.style.display = view === 'categories' ? 'block' : 'none';
    if (view === 'categories') this._renderCategoryView();
  }

  _markDirty() {
    this._isDirty = true;
    this._updateSaveStatus('Unsaved changes');
    if (this.editorDirty) this.editorDirty.style.display = 'inline';
  }

  _updateSaveStatus(msg) {
    if (this.saveStatus) this.saveStatus.textContent = msg || '';
  }

  // Cloud badge is a plain honesty indicator: the journal works either way
  _updateCloudBadge(connected) {
    if (!this.cloudBadge) return;
    if (connected) {
      this.cloudBadge.textContent = '☁️ Cloud sync';
      this.cloudBadge.className = 'tj-badge tj-badge-ok';
      this.cloudBadge.title = 'Entries are stored in Firestore (journal_entries)';
    } else {
      this.cloudBadge.textContent = '💾 Local only';
      this.cloudBadge.className = 'tj-badge tj-badge-warn';
      this.cloudBadge.title = 'Firestore unreachable — entries are saved to this browser only';
    }
  }

  _startAutoSave() {
    setInterval(() => this._autoSaveIfDirty(), 5000);
  }

  async _autoSaveIfDirty() {
    if (!this._isDirty) return;
    if (this.editorOverlay.style.display !== 'block' && this.editorOverlay.style.display !== 'flex') return;
    if (this._isDeleting) return;
    // Nothing worth saving yet (no id and no ticker/date typed)
    if (!this._currentId && !this._fields.ticker.value.trim() && !this._fields.category.value) return;
    await this._doSave(true);
  }

  // ---- Category meaning hint (straight from the Categories sheet) ----
  _updateCategoryHint() {
    if (!this.categoryHint) return;
    const name = this._fields.category ? this._fields.category.value : '';
    const meta = JournalCategories.byName(name);
    if (!meta) {
      this.categoryHint.textContent = '';
      this.categoryHint.style.display = 'none';
      return;
    }
    this.categoryHint.innerHTML =
      `<b>${JournalText.esc(meta.icon + ' ' + meta.name)}</b> — ${JournalText.esc(meta.meaning)}`;
    this.categoryHint.style.display = 'block';
  }

  // ---- Tag chips ----
  _renderTagChips() {
    this.tagChips.innerHTML = this._tags.map(tag =>
      `<span class="tag-chip">
        ${JournalText.esc(tag)}
        <button type="button" class="tag-chip-remove" data-tag="${JournalText.esc(tag)}" title="Remove tag">&times;</button>
      </span>`
    ).join('');
  }

  // ==========================================================================
  // Optional symbol enrichment (never blocks: no key → no lookup)
  // ==========================================================================
  _debounceSymbolLookup() {
    if (this._symbolLookupTimer) clearTimeout(this._symbolLookupTimer);
    this._symbolLookupTimer = setTimeout(() => this._lookupSymbol(), 600);
  }

  async _lookupSymbol() {
    const hint = document.getElementById('tj-ticker-hint');
    if (!hint) return;

    const symbol = this._fields.ticker.value.trim().toUpperCase();
    if (!symbol) {
      hint.textContent = '';
      return;
    }

    // Build our own Finnhub client from the shared config — this page must not
    // reach into the main app's internals (it may not even be open).
    let finnhub = null;
    try {
      if (typeof FinnhubAPI !== 'undefined' && typeof ConfigManager !== 'undefined') {
        const key = ConfigManager.getFinnhubKey();
        if (key) finnhub = new FinnhubAPI(key);
      }
    } catch (e) { /* ignore */ }

    if (!finnhub) {
      // No API key configured — show the ticker itself, never a stuck state
      hint.textContent = symbol;
      return;
    }

    hint.textContent = 'Looking up…';
    try {
      const [profile, quote] = await Promise.all([
        finnhub.getCompanyProfile(symbol).catch(() => null),
        finnhub.getQuote(symbol).catch(() => null)
      ]);

      const parts = [];
      if (profile && profile.name) parts.push(profile.name);
      if (profile && profile.finnhubIndustry) parts.push(profile.finnhubIndustry);
      if (quote && quote.c) parts.push('$' + quote.c.toFixed(2));

      hint.textContent = parts.length ? parts.join(' · ') : symbol;
    } catch (e) {
      hint.textContent = symbol;
    }
  }

  // ==========================================================================
  // Live numbers: P&L, duration, R-multiple
  // ==========================================================================
  _setPnlEl(el, text, positive) {
    if (!el) return;
    el.textContent = text;
    const base = 'tj-pnl-value';
    el.className = positive === null ? base : base + (positive ? ' positive' : ' negative');
  }

  _clearPnl() {
    this._setPnlEl(this.pnlPerShare, '—', null);
    this._setPnlEl(this.pnlPercent, '—', null);
    this._setPnlEl(this.pnlTotal, '—', null);
    this._setPnlEl(this.durationEl, '—', null);
    this._setPnlEl(this.realisedREl, '—', null);
  }

  _updatePnl() {
    const entry = parseFloat(this._fields.entryPrice.value);
    const exit = parseFloat(this._fields.exitPrice.value);
    const shares = parseInt(this._fields.shares.value);
    const fees = parseFloat(this._fields.fees.value);
    const plannedRisk = parseFloat(this._fields.plannedRiskR.value);
    const direction = this._fields.direction.value;

    if (isNaN(entry) || isNaN(exit) || isNaN(shares) || entry === 0) {
      this._clearPnl();
      return;
    }

    // Same arithmetic as the Reviews tab so the two views never disagree
    const perShare = direction === 'long' ? exit - entry : entry - exit;
    const percent = (perShare / entry) * 100;
    let total = perShare * shares;
    if (!isNaN(fees)) total -= fees;   // fees are a cost, always subtracted

    const positive = perShare >= 0;
    this._setPnlEl(this.pnlPerShare, Utils.formatCurrency(perShare) + '/share', positive);
    this._setPnlEl(this.pnlPercent, Utils.formatPercent(percent), positive);
    this._setPnlEl(this.pnlTotal, Utils.formatCurrency(total), total >= 0);

    // Duration (entry → exit, from the combined date+time strings)
    const start = this._combinedDateTime('entry');
    const end = this._combinedDateTime('exit');
    const mins = this._durationMinutes(start, end);
    this._setPnlEl(this.durationEl, mins == null ? '—' : this._formatDuration(mins), null);

    // R-multiple against the planned risk (1R) in dollars
    if (!isNaN(plannedRisk) && plannedRisk > 0) {
      const r = total / plannedRisk;
      this._setPnlEl(this.realisedREl, (r >= 0 ? '+' : '') + r.toFixed(2) + 'R', r >= 0);
    } else {
      this._setPnlEl(this.realisedREl, '—', null);
    }

    // Auto-fill Outcome / P&L while the user has not typed their own wording
    if (!this._outcomeTouched && this._fields.outcome) {
      this._fields.outcome.value =
        (total >= 0 ? '+' : '-') + '$' + Math.abs(total).toFixed(2) +
        ' (' + Utils.formatPercent(percent) + ')';
    }
  }

  // ---- Combine the split date + time inputs of a moment into one ISO-ish string ----
  _combinedDateTime(which) {
    const dateVal = this._fields.date ? this._fields.date.value : '';
    const timeEl = this._fields[which === 'entry' ? 'entryTime' : 'exitTime'];
    const timeVal = timeEl ? timeEl.value : '';
    if (!dateVal) return null;
    if (!timeVal) return null;         // a duration needs both sides
    return this._combineDateTime(dateVal, timeVal);
  }

  _combineDateTime(dateVal, timeVal) {
    if (!dateVal) return null;
    if (!timeVal) return dateVal;      // date only
    return dateVal + 'T' + timeVal;
  }

  // ---- Populate the date/time inputs from a stored datetime string ----
  _applyDateTime(which, isoString) {
    const timeEl = this._fields[which === 'entry' ? 'entryTime' : 'exitTime'];
    if (timeEl) timeEl.value = '';
    if (!isoString || !timeEl) return;

    // Handles both "2026-09-29T09:31:00" and datetime-local style values
    const parts = String(isoString).split('T');
    if (parts.length === 2) {
      if (this._fields.date && !this._fields.date.value) this._fields.date.value = parts[0];
      timeEl.value = parts[1].substring(0, 5); // HH:MM
      return;
    }
    if (this._fields.date && String(isoString).length >= 10) {
      this._fields.date.value = String(isoString).substring(0, 10);
    }
  }

  _durationMinutes(startIso, endIso) {
    if (!startIso || !endIso) return null;
    const start = new Date(startIso);
    const end = new Date(endIso);
    if (isNaN(start.getTime()) || isNaN(end.getTime())) return null;
    const mins = Math.round((end - start) / 60000);
    return mins >= 0 ? mins : null;
  }

  _formatDuration(mins) {
    if (mins < 60) return mins + 'm';
    if (mins < 1440) {
      const h = Math.floor(mins / 60);
      const m = mins % 60;
      return m ? `${h}h ${m}m` : `${h}h`;
    }
    const d = Math.floor(mins / 1440);
    const h = Math.floor((mins % 1440) / 60);
    return h ? `${d}d ${h}h` : `${d}d`;
  }

  // ==========================================================================
  // Editor: open / close / collect / save / delete
  // ==========================================================================
  openEditor(entryId) {
    const entry = entryId ? this._entries.find(e => e.id === entryId) : null;

    this._clearForm();

    if (entry) {
      this._currentId = entry.id;
      this._isNewEntry = false;
      this._fillForm(entry);
      this.editorHeading.textContent = entry.ticker ? 'Edit — ' + entry.ticker : 'Edit entry';
      this.editorDeleteBtn.style.display = 'inline-flex';
    } else {
      this._currentId = null;
      this._isNewEntry = true;
      // Default the date to today (matching the Reviews tab behaviour)
      if (this._fields.date) this._fields.date.value = Utils.todayLocal();
      this.editorHeading.textContent = 'New journal entry';
      this.editorDeleteBtn.style.display = 'none';
    }

    this._isDirty = false;
    this.editorDirty.style.display = 'none';
    this._updateSaveStatus('');
    this._updateCategoryHint();
    this.editorOverlay.style.display = 'flex';

    // Load the linked review panel after the form is populated
    this._renderSourceReview(entry ? entry.reviewId : null);

    if (this._fields.ticker) this._fields.ticker.focus();
  }

  closeEditor() {
    if (this._isDeleting) return;   // never auto-save during a delete
    this.editorOverlay.style.display = 'none';
    this._currentId = null;
    this._isNewEntry = false;
    this._isDirty = false;
    this.editorDirty.style.display = 'none';
    this._updateSaveStatus('');
  }

  _clearForm() {
    Object.keys(this._fields).forEach(key => {
      const el = this._fields[key];
      if (el.tagName === 'SELECT') el.selectedIndex = 0;
      else el.value = '';
    });
    if (this._fields.category) {
      this._fields.category.innerHTML = JournalCategories.buildCategoryOptionsHtml('');
    }
    if (this._fields.timeframe) this._fields.timeframe.value = JOURNAL_TIMEFRAMES[1] || '';
    this.categoryHint.style.display = 'none';
    this.categoryHint.textContent = '';
    document.getElementById('tj-ticker-hint').textContent = '';

    this._tags = [];
    this._renderTagChips();
    this._outcomeTouched = false;
    this._setTradeSectionOpen(false);

    if (this._quill) this._quill.setContents([{ insert: '\n' }], 'silent');
  }

  _fillForm(entry) {
    // 1) The 13 columns — verbatim spreadsheet fields
    JOURNAL_COLUMNS.forEach(col => {
      const el = this._fields[col.key];
      if (!el) return;
      el.value = entry[col.key] == null ? '' : entry[col.key];
    });

    // Category select is rebuilt so an off-list saved value stays visible
    if (this._fields.category) {
      this._fields.category.innerHTML = JournalCategories.buildCategoryOptionsHtml(entry.category || '');
    }

    // 2) Numbers
    const td = entry.tradeData || {};
    if (this._fields.direction && td.direction) this._fields.direction.value = td.direction;
    ['entryPrice', 'exitPrice', 'shares', 'strategy', 'fees', 'plannedRiskR'].forEach(k => {
      const el = this._fields[k];
      if (el && td[k] != null) el.value = td[k];
    });
    this._applyDateTime('entry', td.entryTime);
    this._applyDateTime('exit', td.exitTime);
    this._setTradeSectionOpen(!!entry.tradeData);

    // 3) Mentor advice
    const mentor = entry.mentor || {};
    if (this._fields.mentorSource && mentor.source) this._fields.mentorSource.value = mentor.source;
    if (this._fields.mentorRaw) this._fields.mentorRaw.value = mentor.raw || '';
    if (this._fields.adviceStatus && mentor.status) this._fields.adviceStatus.value = mentor.status;
    if (this._fields.processScore && entry.processScore != null) this._fields.processScore.value = entry.processScore;

    // 4) Tags + deep dive
    this._tags = Array.isArray(entry.tags) ? [...entry.tags] : [];
    this._renderTagChips();
    if (this._quill) {
      if (entry.content && Array.isArray(entry.content.ops)) {
        try {
          this._quill.setContents(entry.content, 'silent');
        } catch (e) {
          console.warn('[TradeJournal] Could not load deep-dive delta:', e.message);
          this._quill.setText(entry.contentPlain || '', 'silent');
        }
      } else if (entry.contentPlain) {
        this._quill.setText(entry.contentPlain, 'silent');
      } else {
        this._quill.setContents([{ insert: '\n' }], 'silent');
      }
    }

    this._outcomeTouched = !!(entry.outcome && entry.outcome.trim());
    this._updatePnl();
  }

  _setTradeSectionOpen(open) {
    const section = document.getElementById('tj-trade-section');
    const btn = document.getElementById('tj-btn-toggle-trade');
    if (!section) return;
    section.style.display = open ? 'block' : 'none';
    if (btn) btn.textContent = open ? 'Numbers ▲' : 'Numbers ▼';
  }

  // ---- Read the whole form into the Firestore document shape ----
  _collectForm() {
    const doc = {};

    // 1) The 13 spreadsheet columns (A–M). Empty strings become null so the
    //    table and the "advice missing" filter can test truthiness.
    JOURNAL_COLUMNS.forEach(col => {
      const el = this._fields[col.key];
      const value = el ? String(el.value || '').trim() : '';
      doc[col.key] = value || null;
    });

    // A value that is not one of the 11 sheet categories is kept, not thrown
    if (doc.category && !JournalCategories.isKnown(doc.category)) {
      console.warn('[TradeJournal] Category is not in the sheet vocabulary:', doc.category);
    }

    // 2) Numbers
    const num = (key) => {
      const el = this._fields[key];
      if (!el) return null;
      const v = parseFloat(el.value);
      return isNaN(v) ? null : v;
    };
    const int = (key) => {
      const el = this._fields[key];
      if (!el) return null;
      const v = parseInt(el.value);
      return isNaN(v) ? null : v;
    };

    const direction = this._fields.direction ? this._fields.direction.value : 'long';
    const entryPrice = num('entryPrice');
    const exitPrice = num('exitPrice');
    const shares = int('shares');
    const fees = num('fees');
    const plannedRiskR = num('plannedRiskR');

    let pnl = null;
    let pnlPercent = null;
    if (entryPrice != null && exitPrice != null && shares != null && entryPrice !== 0) {
      const perSharePnl = direction === 'long' ? exitPrice - entryPrice : entryPrice - exitPrice;
      pnl = perSharePnl * shares - (fees != null ? fees : 0);
      pnlPercent = (perSharePnl / entryPrice) * 100;
    }

    const entryTime = this._combineDateTime(doc.date, this._fields.entryTime ? this._fields.entryTime.value : '');
    const exitTime = this._combineDateTime(doc.date, this._fields.exitTime ? this._fields.exitTime.value : '');
    const durationMin = this._durationMinutes(entryTime, exitTime);
    const realisedR = (pnl != null && plannedRiskR && plannedRiskR > 0) ? pnl / plannedRiskR : null;

    doc.tradeData = {
      direction,
      entryPrice,
      exitPrice,
      shares,
      strategy: this._fields.strategy ? (this._fields.strategy.value.trim() || null) : null,
      fees,
      plannedRiskR,
      entryTime,
      exitTime,
      pnl,
      pnlPercent,
      durationMin,
      realisedR
    };

    // 3) AI-mentor advice (who said it, what they said, has it been applied)
    doc.mentor = {
      source: this._fields.mentorSource ? (this._fields.mentorSource.value.trim() || null) : null,
      raw: this._fields.mentorRaw ? (this._fields.mentorRaw.value.trim() || null) : null,
      status: this._fields.adviceStatus ? (this._fields.adviceStatus.value || 'not-reviewed') : 'not-reviewed'
    };

    // 4) Deep dive — Quill Delta serialised to plain JSON for Firestore
    let content = null;
    let contentPlain = '';
    if (this._quill) {
      const rawDelta = this._quill.getContents();
      content = rawDelta ? JSON.parse(JSON.stringify(rawDelta)) : null;
      contentPlain = this._quill.getText().trim().substring(0, 5000);
    }
    doc.content = content;
    doc.contentPlain = contentPlain;

    // 5) Meta
    doc.tags = this._tags.length ? [...this._tags] : [];
    doc.processScore = int('processScore');
    doc.symbol = doc.ticker ? doc.ticker.toUpperCase() : null;
    const hint = document.getElementById('tj-ticker-hint');
    doc.companyName = hint ? (hint.textContent || null) : null;
    doc.reviewId = this._sourceReview ? this._sourceReview.id : (this._linkedReviewId || null);
    doc.sourcePage = 'TradeJournal.html';

    return doc;
  }

  // ---- Read-only panel showing the trade review this entry came from ----
  async _renderSourceReview(reviewId) {
    this._linkedReviewId = reviewId || null;
    if (!this.sourceReviewEl) return;

    if (!reviewId) {
      this._sourceReview = null;
      this.sourceReviewEl.style.display = 'none';
      if (this.linkBadge) this.linkBadge.style.display = 'none';
      return;
    }

    this.sourceReviewEl.style.display = 'block';
    this._sourceReview = null;
    this.sourceReviewBody.innerHTML = '<div class="tj-muted">Loading linked review…</div>';
    if (this.linkBadge) {
      this.linkBadge.style.display = 'inline-block';
      this.linkBadge.textContent = '🔗 Linked review';
    }

    try {
      // Read-only: the review stays owned by the Reviews tab, we only link to it
      const review = await dataStore.getTradeReview(reviewId);
      if (!review) {
        this.sourceReviewBody.innerHTML =
          '<div class="tj-muted">Linked review not found — it may have been deleted.</div>';
        return;
      }
      this._sourceReview = review;

      const td = review.tradeData || {};
      const bits = [];
      if (review.title) bits.push(`<div class="tj-linked-title">${JournalText.esc(review.title)}</div>`);

      const meta = [];
      if (review.date) meta.push(review.date);
      if (td.pnl != null) meta.push('P&L ' + Utils.formatCurrency(td.pnl));
      if (meta.length) bits.push(`<div class="tj-muted">${JournalText.esc(meta.join(' · '))}</div>`);

      const preview = JournalText.preview(review.contentPlain, 300);
      if (preview) bits.push(`<p class="tj-linked-preview">${JournalText.esc(preview)}</p>`);

      // The main app always opens on its own first tab, so this link cannot
      // deep-link into one review — it opens the app and carries the review id
      // in the URL for when that hand-off is added.
      bits.push(
        `<a class="btn btn-secondary tj-btn-sm" href="index.html?review=${encodeURIComponent(review.id)}" ` +
        `target="_blank" rel="noopener" title="Opens the main app — use the Reviews tab there">` +
        `Open the main app ↗</a>`
      );
      this.sourceReviewBody.innerHTML = bits.join('');
    } catch (e) {
      console.warn('[TradeJournal] Linked review lookup failed:', e.message);
      this.sourceReviewBody.innerHTML = '<div class="tj-muted">Could not load the linked review.</div>';
    }
  }


  // ==========================================================================
  // Save
  // ==========================================================================
  async _doSave(silent = false) {
    const doc = this._collectForm();

    // An entry needs at least a ticker or a category to be worth storing
    if (!doc.ticker && !doc.category) {
      if (!silent) Utils.showToast('Add a ticker or a category before saving');
      return;
    }
    if (!doc.date) doc.date = Utils.todayLocal();

    // Allocate the ID up-front so pasted images and the doc share one folder
    if (!this._currentId) this._currentId = dataStore.generateJournalId();
    if (this._isNewEntry) doc.createdAt = new Date().toISOString();

    try {
      const savedId = await dataStore.saveJournalEntry(doc, this._currentId);
      if (savedId) this._currentId = savedId;

      this._isDirty = false;
      this._isNewEntry = false;
      this.editorDirty.style.display = 'none';
      this.editorDeleteBtn.style.display = 'inline-flex';

      if (dataStore.lastWriteBlocked) {
        this._updateSaveStatus('Saved locally only — cloud sync blocked ⚠️');
        if (!silent) Utils.showToast('Saved locally — cloud sync blocked (check ad-blocker)', 'warning');
      } else {
        this._updateSaveStatus('Saved ✅');
        if (!silent) Utils.showToast('Journal entry saved');
      }

      await this.loadEntries();
    } catch (e) {
      console.error('[TradeJournal] Save failed:', e);
      this._updateSaveStatus('Save failed ❌');
      if (!silent) Utils.showToast('Failed to save journal entry', 'error');
    }
  }

  // ==========================================================================
  // Delete
  // ==========================================================================
  async _doDelete() {
    const id = this._currentId;
    if (!id) {
      Utils.showToast('Nothing to delete — this entry has never been saved');
      return;
    }
    const label = this._fields.ticker.value.trim() || this._fields.date.value || 'this entry';
    const ok = await this._confirmDelete(
      `Delete the journal entry for <b>${JournalText.esc(label)}</b>?<br>` +
      `Screenshots pasted into the deep dive are deleted too. This cannot be undone.`
    );
    if (ok) await this._performDelete(id);
  }

  async _deleteEntryById(id) {
    const entry = this._entries.find(e => e.id === id);
    const label = entry ? (entry.ticker || entry.date || 'this entry') : 'this entry';
    const ok = await this._confirmDelete(
      `Delete the journal entry for <b>${JournalText.esc(label)}</b>?<br>` +
      `Screenshots pasted into the deep dive are deleted too. This cannot be undone.`
    );
    if (ok) await this._performDelete(id);
  }

  async _performDelete(id) {
    if (!id) return;
    this._isDeleting = true;    // stops the auto-save from racing the delete

    try {
      // Images live under trade-images/{id}/ — the existing folder helper
      // removes them by folder, so it works for journal entries unchanged.
      await imageStorage.deleteReviewImages(id);
    } catch (e) {
      console.warn('[TradeJournal] Image cleanup failed:', e.message);
    }

    try {
      await dataStore.deleteJournalEntry(id);
      this._entries = this._entries.filter(e => e.id !== id);
      if (this._activeCategory) this._renderCategoryView();
      Utils.showToast('Journal entry deleted');
    } catch (e) {
      console.error('[TradeJournal] Delete failed:', e);
      Utils.showToast('Failed to delete journal entry', 'error');
    } finally {
      this._isDeleting = false;
    }

    // If the deleted entry was open in the editor, get out of the editor
    if (this._currentId === id) {
      this._currentId = null;
      this._isNewEntry = false;
      this._isDirty = false;
      this.editorDirty.style.display = 'none';
      this.editorOverlay.style.display = 'none';
    }

    this._applyFilters();
  }

  _confirmDelete(htmlMessage) {
    this.confirmText.innerHTML = htmlMessage;
    this.confirmOverlay.style.display = 'flex';
    return new Promise(resolve => { this._confirmResolve = resolve; });
  }

  _resolveConfirm(result) {
    this.confirmOverlay.style.display = 'none';
    if (this._confirmResolve) {
      this._confirmResolve(result);
      this._confirmResolve = null;
    }
  }

  // ==========================================================================
  // Loading
  // ==========================================================================
  async loadEntries(manual = false) {
    if (manual) this._updateSaveStatus('Refreshing…');
    try {
      const raw = await dataStore.getAllJournalEntries();
      this._entries = (raw || []).map(e => this._normaliseEntry(e));
    } catch (e) {
      console.error('[TradeJournal] Could not load entries:', e);
      if (manual) Utils.showToast('Could not load journal entries', 'error');
      this._entries = [];
    }

    this._applyFilters();
    if (this._view === 'categories') this._renderCategoryView();

    if (manual) {
      const n = this._entries.length;
      this._updateSaveStatus(`Refreshed — ${n} ${n === 1 ? 'entry' : 'entries'}`);
      Utils.showToast(`Loaded ${n} journal ${n === 1 ? 'entry' : 'entries'}`);
      setTimeout(() => this._updateSaveStatus(''), 3000);
    }
  }

  _normaliseEntry(raw) {
    const e = Object.assign({}, raw);
    e.id = raw.id || raw.docId || dataStore.generateJournalId();
    e.tradeData = raw.tradeData || {};
    e.mentor = raw.mentor || {};
    e.tags = Array.isArray(raw.tags) ? raw.tags : [];
    return e;
  }

  // ==========================================================================
  // Prefill
  // ==========================================================================
  // Two supported hand-offs:
  //   1. URL params (used by links inside the main app)
  //      TradeJournal.html?date=2026-09-29&ticker=NVDA&review=<reviewId>
  //   2. localStorage payload (written by the main app when it can't pass params)
  //      key: JOURNAL_PREFILL_KEY ('swl_journal_prefill')
  //      →  { date, ticker, category, reviewId, ... }
  // Both are consumed once and then cleared, so a refresh never re-injects data.
  // ==========================================================================
  _applyPrefill() {
    let prefill = this._applyUrlPrefill();
    if (!prefill) prefill = this._applyStoredPrefill();
    if (!prefill) return;

    this.openEditor(null);
    this._applyPrefillValues(prefill);

    const banner = document.getElementById('tj-prefill-banner');
    if (banner) {
      banner.style.display = 'block';
      banner.innerHTML =
        `<span>📥 Prefilled${prefill.source ? ' from ' + JournalText.esc(prefill.source) : ''} — ` +
        `check the fields before saving.</span>` +
        `<button type="button" class="tj-banner-close" id="tj-prefill-dismiss" title="Dismiss">&times;</button>`;
      const dismiss = document.getElementById('tj-prefill-dismiss');
      if (dismiss) {
        dismiss.addEventListener('click', () => { banner.style.display = 'none'; });
      }
    }
  }

  _applyUrlPrefill() {
    let params;
    try {
      params = new URLSearchParams(window.location.search);
    } catch (e) {
      return null;
    }
    const date = params.get('date');
    const ticker = params.get('ticker') || params.get('symbol');
    const reviewId = params.get('review') || params.get('reviewId');
    const category = params.get('category');
    if (!date && !ticker && !reviewId && !category) return null;

    // Clean the URL so a refresh does not re-open the editor
    try {
      window.history.replaceState({}, document.title, window.location.pathname);
    } catch (e) { /* ignore */ }

    return { date, ticker: ticker ? ticker.toUpperCase() : null, category, reviewId, source: 'link' };
  }

  _applyStoredPrefill() {
    const raw = localStorage.getItem(JOURNAL_PREFILL_KEY);
    if (!raw) return null;
    localStorage.removeItem(JOURNAL_PREFILL_KEY);
    try {
      const payload = JSON.parse(raw);
      if (!payload || typeof payload !== 'object') return null;
      payload.source = 'the main app';
      return payload;
    } catch (e) {
      console.warn('[TradeJournal] Ignoring malformed prefill payload');
      return null;
    }
  }

  _applyPrefillValues(payload) {
    const setIf = (key, value) => {
      const el = this._fields[key];
      if (el && value) el.value = value;
    };

    setIf('date', payload.date);
    setIf('ticker', payload.ticker);
    setIf('setup', payload.setup);
    setIf('timeframe', payload.timeframe);

    if (payload.mentorSource) setIf('mentorSource', payload.mentorSource);
    if (payload.mentorAdvice || payload.advice) setIf('mentorRaw', payload.mentorAdvice || payload.advice);

    // Category needs the rebuilt option list so an off-list value survives
    if (payload.category && this._fields.category) {
      this._fields.category.innerHTML = JournalCategories.buildCategoryOptionsHtml(payload.category);
    }

    // Numbers from the source trade review
    const td = payload.tradeData || {};
    if (td.direction && this._fields.direction) this._fields.direction.value = td.direction;
    ['entryPrice', 'exitPrice', 'shares', 'strategy'].forEach(k => setIf(k, td[k]));
    if (td.fees != null) setIf('fees', td.fees);
    if (td.entryTime || td.exitTime) {
      this._setTradeSectionOpen(true);
      this._applyDateTime('entry', td.entryTime);
      this._applyDateTime('exit', td.exitTime);
    }

    // Review hand-off: remember the id and show the read-only panel
    if (payload.reviewId) this._renderSourceReview(payload.reviewId);

    this._updateCategoryHint();
    this._updatePnl();
    this._isDirty = true;
    this._markDirty();
  }

  // ==========================================================================
  // Filtering + sorting
  // ==========================================================================
  _applyFilters() {
    const filters = this._readFilters();
    this._filtered = this._entries.filter(e => this._matchesFilters(e, filters));
    this._sortEntries(this._filtered);
    this._renderTable();
    this._renderStats();
  }

  _readFilters() {
    const adviceEl = this.filterAdvice;
    return {
      search: JournalText.normalize(this.searchInput ? this.searchInput.value : ''),
      category: (this.filterCategory ? this.filterCategory.value : '').trim().toLowerCase(),
      timeframe: (this.filterTimeframe ? this.filterTimeframe.value : '').trim().toLowerCase(),
      advice: adviceEl ? adviceEl.value : '',
      from: this.filterFrom ? this.filterFrom.value : '',
      to: this.filterTo ? this.filterTo.value : ''
    };
  }

  _clearFilters() {
    this.searchInput.value = '';
    this.filterCategory.value = '';
    this.filterTimeframe.value = '';
    this.filterAdvice.value = '';
    this.filterFrom.value = '';
    this.filterTo.value = '';
    this._applyFilters();
  }

  _matchesFilters(entry, f) {
    // Free text — searches the columns a trader actually looks things up by
    if (f.search) {
      const haystack = JournalText.normalize([
        entry.ticker,
        entry.setup,
        entry.category,
        entry.timeframe,
        entry.entryTrigger,
        entry.whyEntered,
        entry.whatWentWrong,
        entry.whyItWentWrong,
        entry.advice,
        entry.keyLesson,
        entry.outcome,
        entry.companyName,
        (entry.tags || []).join(' '),
        entry.mentor ? entry.mentor.raw : ''
      ].filter(Boolean).join(' | '));

      if (!haystack.includes(f.search)) return false;
    }

    if (f.category && String(entry.category || '').trim().toLowerCase() !== f.category) return false;
    if (f.timeframe && String(entry.timeframe || '').trim().toLowerCase() !== f.timeframe) return false;

    // Advice filter
    if (f.advice) {
      const hasAdvice = !!(entry.advice && entry.advice.trim()) ||
        !!(entry.mentor && entry.mentor.raw && entry.mentor.raw.trim());
      const status = entry.mentor ? entry.mentor.status : null;
      if (f.advice === 'missing' && hasAdvice) return false;
      if (f.advice === 'unapplied' && (!hasAdvice || status === 'applied' || status === 'n/a')) return false;
      if (f.advice === 'applied' && status !== 'applied') return false;
    }

    // Date range — stored as plain YYYY-MM-DD so string comparison is exact
    const date = entry.date || '';
    if (f.from && (!date || date < f.from)) return false;
    if (f.to && (!date || date > f.to)) return false;

    return true;
  }

  _toggleSort(key) {
    if (this._sort.key === key) {
      this._sort.dir = this._sort.dir === 'asc' ? 'desc' : 'asc';
    } else {
      this._sort.key = key;
      // Dates and money read best newest/largest first
      this._sort.dir = (key === 'date' || key === 'pnl') ? 'desc' : 'asc';
    }
    this._sortEntries(this._filtered);
    this._renderTable();
  }

  _sortEntries(list) {
    const { key, dir } = this._sort;
    const factor = dir === 'asc' ? 1 : -1;

    list.sort((a, b) => {
      let av;
      let bv;

      if (key === 'pnl') {
        av = (a.tradeData && a.tradeData.pnl != null) ? a.tradeData.pnl : null;
        bv = (b.tradeData && b.tradeData.pnl != null) ? b.tradeData.pnl : null;
        // Entries without a P&L always sink to the bottom, in either direction
        if (av == null && bv == null) return 0;
        if (av == null) return 1;
        if (bv == null) return -1;
        return (av - bv) * factor;
      }

      av = a[key] == null ? '' : String(a[key]);
      bv = b[key] == null ? '' : String(b[key]);
      return av.localeCompare(bv, undefined, { numeric: true, sensitivity: 'base' }) * factor;
    });
  }

  // ==========================================================================
  // Table
  // ==========================================================================
  // Column order mirrors the Day_Trading_Journal sheet, left to right, with the
  // derived numbers pinned to the right so the spreadsheet stays recognisable.
  _tableColumns() {
    return [
      { key: 'date',           label: 'Date',              sortable: true },
      { key: 'ticker',         label: 'Ticker',            sortable: true },
      { key: 'timeframe',      label: 'Timeframe',         sortable: true },
      { key: 'category',       label: 'Category',          sortable: true },
      { key: 'setup',          label: 'Setup',             sortable: true,  max: 40 },
      { key: 'entryTrigger',   label: 'Entry Trigger',     sortable: false, max: 60 },
      { key: 'whyEntered',     label: 'Why Entered',       sortable: false, max: 90 },
      { key: 'whatWentWrong',  label: 'What Went Wrong',   sortable: false, max: 90 },
      { key: 'whyItWentWrong', label: 'Why It Went Wrong', sortable: false, max: 90 },
      { key: 'advice',         label: 'Advice',            sortable: false, max: 90 },
      { key: 'keyLesson',      label: 'Key Lesson',        sortable: false, max: 90 },
      { key: 'outcome',        label: 'Outcome / P&L',     sortable: false, max: 70 },
      { key: 'adviceStatus',   label: 'Advice Followed',   sortable: false },
      { key: 'pnl',            label: 'Net P&L',           sortable: true },
      { key: 'star',           label: 'Process',           sortable: false },
      { key: 'actions',        label: '',                  sortable: false }
    ];
  }

  _adviceBadge(status) {
    const map = {
      'applied':           { cls: 'tj-badge tj-badge-ok',    label: '✅ Applied' },
      'partially-applied': { cls: 'tj-badge tj-badge-warn',  label: '🟡 Partial' },
      'not-applied':       { cls: 'tj-badge tj-badge-bad',   label: '❌ Not applied' },
      'n/a':               { cls: 'tj-badge',                label: 'n/a' },
      'not-reviewed':      { cls: 'tj-badge tj-badge-muted', label: '— Not reviewed' }
    };
    const hit = map[status] || map['not-reviewed'];
    return `<span class="${hit.cls}">${hit.label}</span>`;
  }

  _renderTable() {
    const cols = this._tableColumns();

    // Sortable header row
    this.tableHead.innerHTML = '<tr>' + cols.map(c => {
      if (!c.sortable) return `<th>${JournalText.esc(c.label)}</th>`;
      const active = this._sort.key === c.key;
      const arrow = active ? (this._sort.dir === 'asc' ? ' ▲' : ' ▼') : '';
      return `<th data-sort="${c.key}" class="${active ? 'sorted' : ''}" ` +
        `title="Sort by ${JournalText.esc(c.label)}">${JournalText.esc(c.label)}${arrow}</th>`;
    }).join('') + '</tr>';

    // Result counter
    if (this.resultCount) {
      const total = this._entries.length;
      const shown = this._filtered.length;
      this.resultCount.textContent = shown === total
        ? `${total} ${total === 1 ? 'entry' : 'entries'}`
        : `${shown} of ${total} entries`;
    }

    // Body — or the empty state
    if (!this._filtered.length) {
      this.tableBody.innerHTML = '';
      this.emptyState.style.display = 'block';
      if (this._entries.length) {
        this.emptyState.innerHTML =
          `<div class="tj-empty-title">No entries match these filters</div>` +
          `<div class="tj-muted">Try widening the date range or clearing the search.</div>` +
          `<button type="button" class="btn btn-secondary tj-btn-sm" id="tj-empty-clear">Clear filters</button>`;
        const btn = document.getElementById('tj-empty-clear');
        if (btn) btn.addEventListener('click', () => this._clearFilters());
      } else {
        this.emptyState.innerHTML =
          `<div class="tj-empty-title">Your journal is empty</div>` +
          `<div class="tj-muted">Every entry is one row of the Day Trading Journal: the 13 ` +
          `spreadsheet columns, the numbers behind the trade, and an optional annotated deep dive.</div>` +
          `<div class="tj-empty-actions">` +
          `<button type="button" class="btn btn-primary" id="tj-empty-new">+ Add your first entry</button>` +
          `<button type="button" class="btn btn-secondary" id="tj-empty-sample">See an example entry</button>` +
          `</div>`;
        const newBtn = document.getElementById('tj-empty-new');
        if (newBtn) newBtn.addEventListener('click', () => this.openEditor(null));
        const sampleBtn = document.getElementById('tj-empty-sample');
        if (sampleBtn) sampleBtn.addEventListener('click', () => this._loadSampleIntoForm());
      }
      return;
    }

    this.emptyState.style.display = 'none';
    this.tableBody.innerHTML = this._filtered.map(e => this._rowHtml(e, cols)).join('');
  }

  _rowHtml(entry, cols) {
    const td = entry.tradeData || {};
    const meta = JournalCategories.byName(entry.category);

    const cells = cols.map(c => {
      switch (c.key) {
        case 'category': {
          if (!entry.category) return `<td class="tj-muted">—</td>`;
          const label = (meta ? meta.icon + ' ' : '') + entry.category;
          const title = meta ? ` title="${JournalText.esc(meta.meaning)}"` : '';
          return `<td class="tj-cell-category"${title}>${JournalText.esc(label)}</td>`;
        }

        case 'pnl': {
          if (td.pnl == null) return `<td class="tj-num tj-muted">—</td>`;
          const cls = td.pnl >= 0 ? 'positive' : 'negative';
          return `<td class="tj-num ${cls}">${JournalText.esc(Utils.formatCurrency(td.pnl))}</td>`;
        }

        case 'adviceStatus':
          return `<td>${this._adviceBadge(entry.mentor ? entry.mentor.status : null)}</td>`;

        case 'star': {
          const score = entry.processScore != null ? entry.processScore : null;
          if (score == null) return `<td class="tj-num tj-muted">—</td>`;
          return `<td class="tj-num">${JournalText.esc(String(score))}/5</td>`;
        }

        case 'actions':
          return `<td class="tj-actions">` +
            `<button type="button" class="tj-icon-btn" data-edit="${JournalText.esc(entry.id)}" title="Edit">✏️</button>` +
            `<button type="button" class="tj-icon-btn" data-del="${JournalText.esc(entry.id)}" title="Delete">🗑️</button>` +
            `</td>`;

        default: {
          const raw = entry[c.key];
          if (!raw) return `<td class="tj-muted">—</td>`;
          const text = JournalText.preview(raw, c.max || 90);
          return `<td title="${JournalText.esc(String(raw).substring(0, 400))}">${JournalText.esc(text)}</td>`;
        }
      }
    }).join('');

    return `<tr data-id="${JournalText.esc(entry.id)}">${cells}</tr>`;
  }

  // ==========================================================================
  // Stats strip
  // ==========================================================================
  _renderStats() {
    if (!this.statsEl) return;

    // Stats are computed over the FILTERED set, so the strip answers
    // "how am I doing on what I'm currently looking at?"
    const entries = this._filtered;

    const withPnl = entries.filter(e => e.tradeData && e.tradeData.pnl != null);
    const wins = withPnl.filter(e => e.tradeData.pnl > 0);
    const losses = withPnl.filter(e => e.tradeData.pnl < 0);
    const netPnl = withPnl.reduce((sum, e) => sum + e.tradeData.pnl, 0);

    const winRate = withPnl.length ? (wins.length / withPnl.length) * 100 : null;

    const grossWin = wins.reduce((s, e) => s + e.tradeData.pnl, 0);
    const grossLoss = Math.abs(losses.reduce((s, e) => s + e.tradeData.pnl, 0));
    const profitFactor = grossLoss > 0 ? grossWin / grossLoss : (grossWin > 0 ? null : 0);

    const withR = entries.filter(e => e.tradeData && e.tradeData.realisedR != null);
    const avgR = withR.length ? withR.reduce((s, e) => s + e.tradeData.realisedR, 0) / withR.length : null;

    // Advice discipline — only counts entries that actually have mentor advice
    const withAdvice = entries.filter(e =>
      (e.mentor && e.mentor.raw && e.mentor.raw.trim()) || (e.advice && e.advice.trim()));
    const applied = withAdvice.filter(e => e.mentor && e.mentor.status === 'applied').length;
    const appliedPct = withAdvice.length ? (applied / withAdvice.length) * 100 : null;

    // Most frequent category
    const counts = {};
    entries.forEach(e => {
      if (!e.category) return;
      counts[e.category] = (counts[e.category] || 0) + 1;
    });
    const topCategory = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0] || null;

    const card = (label, value, tone, sub) =>
      `<div class="tj-stat">
        <div class="tj-stat-label">${JournalText.esc(label)}</div>
        <div class="tj-stat-value${tone ? ' ' + tone : ''}">${value}</div>
        ${sub ? `<div class="tj-stat-sub">${JournalText.esc(sub)}</div>` : ''}
      </div>`;

    const cards = [];

    cards.push(card('Entries', JournalText.esc(String(entries.length)),
      null, this._filtered.length === this._entries.length ? null : 'filtered view'));

    cards.push(card('Net P&L',
      withPnl.length ? JournalText.esc(Utils.formatCurrency(netPnl)) : '—',
      withPnl.length ? (netPnl >= 0 ? 'positive' : 'negative') : 'tj-muted',
      withPnl.length ? `${wins.length}W / ${losses.length}L` : 'no numbers yet'));

    cards.push(card('Win rate',
      winRate == null ? '—' : JournalText.esc(winRate.toFixed(0) + '%'),
      winRate == null ? 'tj-muted' : (winRate >= 50 ? 'positive' : 'negative'),
      withPnl.length ? `of ${withPnl.length} sized trades` : 'add prices + size'));

    cards.push(card('Profit factor',
      profitFactor == null ? '∞' : (grossLoss > 0 ? JournalText.esc(profitFactor.toFixed(2)) : '—'),
      profitFactor == null ? 'positive' : (profitFactor >= 1 ? 'positive' : 'negative'),
      grossLoss > 0 ? 'gross win ÷ gross loss' : 'no losing entries'));

    cards.push(card('Avg R',
      avgR == null ? '—' : JournalText.esc((avgR >= 0 ? '+' : '') + avgR.toFixed(2) + 'R'),
      avgR == null ? 'tj-muted' : (avgR >= 0 ? 'positive' : 'negative'),
      withR.length ? `over ${withR.length} entries` : 'set planned risk 1R'));

    cards.push(card('Advice followed',
      appliedPct == null ? '—' : JournalText.esc(appliedPct.toFixed(0) + '%'),
      appliedPct == null ? 'tj-muted' : (appliedPct >= 50 ? 'positive' : 'negative'),
      withAdvice.length ? `${applied} of ${withAdvice.length} with advice` : 'no mentor advice logged'));

    cards.push(card('Most common category',
      topCategory ? JournalText.esc(topCategory) : '—',
      null,
      topCategory ? `${counts[topCategory]} ${counts[topCategory] === 1 ? 'entry' : 'entries'}` : null));

    this.statsEl.innerHTML = cards.join('');
  }

  // ==========================================================================
  // Review by category
  // ==========================================================================
  // Answers the question the spreadsheet cannot: "which of my 11 playbook
  // categories actually makes money, and what advice keeps repeating there?"
  // ==========================================================================
  _categoryStats() {
    const groups = new Map();

    this._entries.forEach(entry => {
      const name = (entry.category && entry.category.trim()) || JOURNAL_UNCATEGORISED;
      if (!groups.has(name)) groups.set(name, []);
      groups.get(name).push(entry);
    });

    return Array.from(groups.entries()).map(([name, entries]) => {
      const withPnl = entries.filter(e => e.tradeData && e.tradeData.pnl != null);
      const wins = withPnl.filter(e => e.tradeData.pnl > 0).length;
      const net = withPnl.reduce((s, e) => s + e.tradeData.pnl, 0);

      const withR = entries.filter(e => e.tradeData && e.tradeData.realisedR != null);
      const avgR = withR.length ? withR.reduce((s, e) => s + e.tradeData.realisedR, 0) / withR.length : null;

      const withAdvice = entries.filter(e =>
        (e.mentor && e.mentor.raw && e.mentor.raw.trim()) || (e.advice && e.advice.trim()));
      const applied = withAdvice.filter(e => e.mentor && e.mentor.status === 'applied').length;

      return {
        name,
        isUncategorised: name === JOURNAL_UNCATEGORISED,
        entries,
        count: entries.length,
        withPnl: withPnl.length,
        wins,
        losses: withPnl.length - wins,
        winRate: withPnl.length ? (wins / withPnl.length) * 100 : null,
        net,
        avgR,
        adviceCount: withAdvice.length,
        adviceApplied: applied
      };
    });
  }

  _renderCategoryView() {
    if (!this.catPivotBody) return;

    const rows = this._categoryStats();

    if (!rows.length) {
      this.catPivotBody.innerHTML =
        `<tr><td class="tj-muted">No entries yet — add one to start seeing category performance.</td></tr>`;
      if (this.catDetail) this.catDetail.style.display = 'none';
      if (this.catDetailEmpty) {
        this.catDetailEmpty.style.display = 'block';
        this.catDetailEmpty.textContent = 'The category breakdown appears once you have journal entries.';
      }
      return;
    }

    if (this.catDetailEmpty) this.catDetailEmpty.style.display = 'none';

    // Worst net P&L first — that is the row you need to look at. Uncategorised
    // always sits at the bottom.
    rows.sort((a, b) => {
      if (a.isUncategorised !== b.isUncategorised) return a.isUncategorised ? 1 : -1;
      if (a.net !== b.net) return a.net - b.net;
      return b.count - a.count;
    });

    this.catPivotBody.innerHTML = rows.map(r => {
      const meta = JournalCategories.byName(r.name);
      const label = r.isUncategorised
        ? r.name
        : (meta ? meta.icon + ' ' + r.name : r.name);
      const active = this._activeCategory === r.name ? ' class="active"' : '';

      const winCell = r.winRate == null ? `<span class="tj-muted">—</span>`
        : `<span class="${r.winRate >= 50 ? 'positive' : 'negative'}">${r.winRate.toFixed(0)}%</span>`;
      const netCell = r.withPnl
        ? `<span class="${r.net >= 0 ? 'positive' : 'negative'}">${JournalText.esc(Utils.formatCurrency(r.net))}</span>`
        : `<span class="tj-muted">—</span>`;
      const rCell = r.avgR == null ? `<span class="tj-muted">—</span>`
        : `<span class="${r.avgR >= 0 ? 'positive' : 'negative'}">${JournalText.esc((r.avgR >= 0 ? '+' : '') + r.avgR.toFixed(2) + 'R')}</span>`;

      return `<tr data-category="${JournalText.esc(r.name)}"${active} tabindex="0">
        <td class="tj-cell-category">${JournalText.esc(label)}</td>
        <td class="tj-num">${r.count}</td>
        <td class="tj-num">${winCell}</td>
        <td class="tj-num">${netCell}</td>
        <td class="tj-num">${rCell}</td>
        <td class="tj-num">${r.adviceCount ? `${r.adviceApplied}/${r.adviceCount}` : '<span class="tj-muted">—</span>'}</td>
      </tr>`;
    }).join('');

    // Keep the current selection if it still exists, otherwise prompt to pick
    const stillThere = rows.some(r => r.name === this._activeCategory);
    if (!stillThere) this._activeCategory = null;

    if (this._activeCategory) {
      this._renderCategoryDetail(rows.find(r => r.name === this._activeCategory));
    } else if (this.catDetail) {
      this.catDetail.style.display = 'none';
    }
  }

  _selectCategory(name) {
    this._activeCategory = (this._activeCategory === name) ? null : name;
    this._renderCategoryView();
    if (this._activeCategory && this.catDetail) {
      this.catDetail.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }

  _renderCategoryDetail(row) {
    if (!this.catDetail || !row) return;
    this.catDetail.style.display = 'block';

    const meta = JournalCategories.byName(row.name);
    this.catDetailTitle.innerHTML = meta
      ? JournalText.esc(meta.icon + ' ' + meta.name)
      : JournalText.esc(row.name);

    // Always show where the category definition comes from — the sheet's own wording
    if (meta) {
      const groupLabel = JournalCategories.groupLabelFor(row.name);
      this.catDetailMeaning.innerHTML =
        `<b>Playbook definition:</b> ${JournalText.esc(meta.meaning)}` +
        (groupLabel ? ` <span class="tj-muted">— ${JournalText.esc(groupLabel)}</span>` : '');
    } else if (row.isUncategorised) {
      this.catDetailMeaning.innerHTML =
        `<span class="tj-muted">These entries have no category yet — assign one so they can be reviewed properly.</span>`;
    } else {
      this.catDetailMeaning.innerHTML =
        `<span class="tj-muted">"${JournalText.esc(row.name)}" is not one of the 11 sheet categories, ` +
        `so the playbook has no definition for it.</span>`;
    }

    // Stat chips
    const chip = (label, value, tone) =>
      `<div class="tj-chip">
        <span class="tj-chip-label">${JournalText.esc(label)}</span>
        <span class="tj-chip-value${tone ? ' ' + tone : ''}">${value}</span>
      </div>`;

    this.catDetailStats.innerHTML = [
      chip('Entries', JournalText.esc(String(row.count)), null),
      chip('Win rate',
        row.winRate == null ? '—' : JournalText.esc(row.winRate.toFixed(0) + '%'),
        row.winRate == null ? null : (row.winRate >= 50 ? 'positive' : 'negative')),
      chip('Net P&L',
        row.withPnl ? JournalText.esc(Utils.formatCurrency(row.net)) : '—',
        row.withPnl ? (row.net >= 0 ? 'positive' : 'negative') : null),
      chip('Avg R',
        row.avgR == null ? '—' : JournalText.esc((row.avgR >= 0 ? '+' : '') + row.avgR.toFixed(2) + 'R'),
        row.avgR == null ? null : (row.avgR >= 0 ? 'positive' : 'negative')),
      chip('Wins / losses', JournalText.esc(row.wins + ' / ' + row.losses), null)
    ].join('');

    // Entries in this category, newest first
    const sorted = [...row.entries].sort((a, b) =>
      String(b.date || '').localeCompare(String(a.date || '')));

    this.catList.innerHTML = sorted.map(e => {
      const td = e.tradeData || {};
      const pnl = td.pnl == null
        ? `<span class="tj-muted">—</span>`
        : `<span class="${td.pnl >= 0 ? 'positive' : 'negative'}">${JournalText.esc(Utils.formatCurrency(td.pnl))}</span>`;
      const star = e.processScore != null ? '  ⭐' + e.processScore : '';
      const heading = `${e.date || 'no date'} · ${e.ticker || '—'}${star}`;
      const sub = JournalText.preview(e.outcome || e.keyLesson || e.whyEntered, 110) || 'No outcome recorded';

      return `<div class="tj-cat-item">
        <div class="tj-cat-item-main">
          <div class="tj-cat-item-title">${JournalText.esc(heading)}</div>
          <div class="tj-muted tj-small">${JournalText.esc(sub)}</div>
        </div>
        <div class="tj-cat-item-side">
          ${this._adviceBadge(e.mentor ? e.mentor.status : null)}
          <span class="tj-num">${pnl}</span>
          <button type="button" class="tj-icon-btn" data-toggle-advice="${JournalText.esc(e.id)}" title="Cycle advice status">🔄</button>
          <button type="button" class="tj-icon-btn" data-edit="${JournalText.esc(e.id)}" title="Edit">✏️</button>
        </div>
      </div>`;
    }).join('');

    this.catAdvice.innerHTML = this._adviceGroupsHtml(row.entries);
  }

  // ---- Group the advice given across this category's entries ----
  // The Advice column and the AI-mentor note are pooled: when the same point
  // shows up in three entries, that repetition IS the finding.
  _adviceGroupsHtml(entries) {
    const groups = new Map();

    const add = (text, source, entry) => {
      const clean = String(text || '').trim();
      if (!clean) return;
      const key = JournalText.lessonKey(clean);
      if (!key) return;

      if (!groups.has(key)) {
        groups.set(key, {
          key,
          text: clean,
          sources: {},
          count: 0,
          statuses: {},
          latest: entry.date || ''
        });
      }
      const g = groups.get(key);
      g.count++;
      if (clean.length > g.text.length) g.text = clean;   // keep the fullest wording
      g.sources[source] = (g.sources[source] || 0) + 1;

      const status = (entry.mentor && entry.mentor.status) || 'not-reviewed';
      g.statuses[status] = (g.statuses[status] || 0) + 1;
      if ((entry.date || '') > g.latest) g.latest = entry.date || '';
    };

    entries.forEach(e => {
      if (e.advice) add(e.advice, 'Advice column', e);
      if (e.mentor && e.mentor.raw) add(e.mentor.raw, 'AI mentor', e);
    });

    const list = Array.from(groups.values())
      .sort((a, b) => (b.count - a.count) || a.key.localeCompare(b.key));

    if (!list.length) {
      return `<div class="tj-muted">No advice recorded for this category yet. The <b>Advice</b> ` +
        `column and the AI-mentor note both feed this list.</div>`;
    }

    const statusIcon = {
      'applied': '✅',
      'partially-applied': '🟡',
      'not-applied': '❌',
      'not-reviewed': '⏳',
      'n/a': '–'
    };

    const head = `<div class="tj-advice-count tj-muted">
      ${list.length} distinct ${list.length === 1 ? 'point' : 'points'} of advice
      ${list.some(g => g.count > 1) ? ' — 🔁 marks advice that keeps repeating' : ''}
    </div>`;

    const rows = list.map(g => {
      const sourceBadges = Object.keys(g.sources)
        .map(s => `<span class="tj-badge tj-badge-muted">${JournalText.esc(s)}</span>`).join(' ');

      const statusBadges = Object.keys(g.statuses).map(s => {
        const icon = statusIcon[s] || '•';
        return `<span class="tj-badge tj-badge-muted" title="${JournalText.esc(s)}">` +
          `${icon} ${g.statuses[s]}×</span>`;
      }).join(' ');

      return `<div class="tj-advice-row${g.count > 1 ? ' repeated' : ''}">
        <div class="tj-advice-text">${JournalText.esc(g.text)}</div>
        <div class="tj-advice-meta">
          ${g.count > 1 ? `<span class="tj-badge tj-badge-warn" title="Given in ${g.count} entries">🔁 ×${g.count}</span>` : ''}
          ${sourceBadges}
          ${statusBadges}
        </div>
      </div>`;
    }).join('');

    return head + rows;
  }

  // ---- Advance the advice status of one entry without opening the editor ----
  async _toggleAdviceStatus(entryId) {
    const entry = this._entries.find(e => e.id === entryId);
    if (!entry) return;

    const order = ['not-reviewed', 'applied', 'partially-applied', 'not-applied', 'n/a'];
    entry.mentor = entry.mentor || {};
    const current = order.indexOf(entry.mentor.status || 'not-reviewed');
    entry.mentor.status = order[(current + 1) % order.length];

    // A full-document save keeps the cloud and localStorage copies identical,
    // but the document id must never be written back as a field (it would
    // shadow the real id on the next read).
    const payload = Object.assign({}, entry);
    delete payload.id;
    delete payload._localOnly;

    try {
      await dataStore.saveJournalEntry(payload, entry.id);
      Utils.showToast('Advice status → ' + entry.mentor.status);
      this._renderCategoryView();
      this._applyFilters();
    } catch (e) {
      console.error('[TradeJournal] Could not update advice status:', e);
      Utils.showToast('Could not update the advice status', 'error');
    }
  }

  // ==========================================================================
  // Example entry (empty-state helper)
  // ==========================================================================
  // Fills the editor with one realistic completed row so a first-time user can
  // see what the 13 columns + numbers + deep dive look like together. Nothing is
  // written: the form is left clean, so Save keeps it and Close discards it.
  // Every value comes from the sheet's own vocabulary (categories, timeframes,
  // setups) — see Day_Trading_Journal.xlsx, Categories!A2:B12.
  // ==========================================================================
  _loadSampleIntoForm() {
    this.openEditor(null);

    const set = (key, value) => {
      const el = this._fields[key];
      if (el) el.value = value;
    };

    // A–E: the spreadsheet columns, using the sheet's own lists
    set('date', Utils.todayLocal());
    set('ticker', 'NVDA');
    set('timeframe', '5-min');
    if (this._fields.category) {
      this._fields.category.innerHTML = JournalCategories.buildCategoryOptionsHtml('Poor entry');
    }
    set('setup', 'Opening range break');

    // F–M: the reasoning columns
    set('entryTrigger', 'Break of the opening-range high on above-average volume, 09:41');
    set('whyEntered', 'Opening range broke with volume expanding. The setup was on my plan for the day and the sector was strong.');
    set('whatWentWrong', 'Entered 0.40 above the trigger candle close instead of waiting for the retest of the level. Stop then sat 90c away instead of 35c.');
    set('whyItWentWrong', 'I had missed the first push, so I bought the extension instead of letting price come back to the level I had marked.');
    set('advice', 'When the first push is gone, wait for the retest of the breakout level. If it never comes back, there is no trade — that is the whole entry rule.');
    set('keyLesson', 'The setup was right, the entry location was too late. Location is part of the setup, not a detail of it.');
    set('review', 'Clean structure, correct level, late entry, oversized stop. Next time leave a limit order at the level and let the trade come to me.');

    // Mentor advice — the extra journal fields for the review loop
    set('mentorSource', 'AI mentor review');
    set('mentorRaw', 'Three of your last five losses came from entering after the second push. Wait for the pullback into the level or skip the trade.');
    set('adviceStatus', 'not-applied');
    set('processScore', '3');

    // The numbers behind the trade (the panel is opened so they are visible)
    set('direction', 'long');
    set('entryPrice', '178.40');
    set('exitPrice', '177.55');
    set('shares', '120');
    set('fees', '2.10');
    set('plannedRiskR', '150');
    set('entryTime', '09:41');
    set('exitTime', '09:47');
    set('strategy', 'ORB — momentum continuation');

    // Tags
    this._tags = ['chase', 'opening-range'];
    this._renderTagChips();

    // Deep dive — inserted silently so the example form stays "not yet edited"
    if (this._quill) {
      const delta = {
        ops: [
          { insert: 'Why this is still a mistake even though the level was right' },
          { insert: '\n', attributes: { header: 2 } },
          { insert: 'The opening range broke on volume exactly as the plan described, so the setup was valid. The error was the location of the entry: I bought the extension 0.40 above the level instead of waiting for the retest, which pushed the stop out to 90c and cut the R:R to under 1:1.' },
          { insert: '\n' },
          { insert: 'Entry ' }, { insert: '178.40', attributes: { bold: true } },
          { insert: '  →  Exit ' }, { insert: '177.55', attributes: { bold: true } },
          { insert: '  ·  stop 90c  ·  planned 1R $150' },
          { insert: '\n' },
          { insert: 'Paste a chart screenshot here (Ctrl+V) and the annotator opens so you can mark the level and the entry bar before it is saved.' },
          { insert: '\n' }
        ]
      };
      try {
        this._quill.setContents(delta, 'silent');
      } catch (e) {
        this._quill.setText(
          'The setup was right, the entry location was too late: bought the extension 0.40 above the level instead of the retest.',
          'silent'
        );
      }
    }

    // Reveal the numbers and let the live P&L fill the Outcome column
    this._setTradeSectionOpen(true);
    this._updateCategoryHint();
    this._updatePnl();
    this._isDirty = false;                    // nothing typed by the user yet
    this.editorDirty.style.display = 'none';
    this._updateSaveStatus('Example — press Save to keep it');
    Utils.showToast('Example entry loaded — press Save to keep it, or close to discard');
  }
}

// ============================================================================
// Boot — TradeJournal.html loads this file last (after the shared modules)
// ============================================================================
(function bootTradeJournal() {
  const start = () => {
    const app = new TradeJournalApp();
    window.tradeJournal = app;      // handy for debugging from the console
    app.init().catch(err => {
      console.error('[TradeJournal] Startup failed:', err);
      const status = document.getElementById('tj-save-status');
      if (status) status.textContent = 'Startup error — see the console';
    });
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();   // script injected after the document was parsed
  }
})();
