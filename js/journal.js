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
    this._sharesAssumed = false;   // true while the 1-share default is in the box
    this._tags = [];
    this._outcomeTouched = false;
    this._activeCategory = null;   // Review-by-category selection
    this._sort = { key: 'date', dir: 'desc' };
    this._sourceReview = null;     // linked trade review (read-only panel)
    this._isFirstRun = true;
    this._view = 'entries';        // active tab: 'entries' | 'categories'
    this._lastEntryDate = '';      // so column A can follow the entry date
    this._importResult = null;     // last CSV read (preview + parsed entries)
    this._draftResult = null;      // last generated write-up skeleton
    this._draftTab = 'skeleton';   // draft dialog tab: 'skeleton' | 'prompt'

    // Sessions — several legs of one ticker on one day are ONE row
    this._groupBy = 'session';     // 'session' = one row per session | 'none'
    this._groupByLoaded = false;   // read from localStorage on first use
    this._openGroups = new Set();  // session keys the user has expanded
    this._lastGroups = null;       // sessions of the last render (Expand all)
    this._currentGroupId = null;   // stored groupId of the entry in the editor
    this._groupIntent = null;      // 'solo' once Split out has been pressed
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

    // The CSV letter map (A–M) has to stay identical to the sheet's 13 columns
    if (typeof JournalCSV === 'undefined') {
      console.warn('[TradeJournal] js/journal-csv.js did not load — the CSV import and the Draft helper are unavailable.');
    } else {
      const columnProblems = JournalCSV.verifyColumns();
      if (columnProblems.length) {
        console.warn('[TradeJournal] CSV column map is out of step with the sheet:', columnProblems);
      }
    }

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
    this.btnImport       = $('tj-btn-import');
    this.btnDraft        = $('tj-btn-draft');

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

    // Sessions (the grouped table)
    this.groupBySelect     = $('tj-group-by');
    this.groupActionBar    = $('tj-group-actions');
    this.btnExpandGroups   = $('tj-btn-expand-groups');
    this.btnCollapseGroups = $('tj-btn-collapse-groups');

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
    this.editorNewBtn    = $('tj-editor-new');
    this.editorImportBtn = $('tj-editor-import');
    this.quillContainer  = $('tj-quill');
    this.pnlTotal        = $('tj-pnl-total');
    this.pnlPercent      = $('tj-pnl-percent');
    this.pnlPerShare     = $('tj-pnl-per-share');
    this.durationEl      = $('tj-duration');
    this.realisedREl     = $('tj-realised-r');
    this.durationHint    = $('tj-duration-hint');
    this.numbersHint     = $('tj-numbers-hint');
    this.tagsInput       = $('tj-tags-input');
    this.tagChips        = $('tj-tag-chips');
    this.adviceHint      = $('tj-advice-hint');
    this.categoryHint    = $('tj-category-hint');
    this.sourceReviewEl  = $('tj-source-review');
    this.sourceReviewBody= $('tj-source-review-body');
    this.linkBadge       = $('tj-link-badge');

    // Session strip (the group id the open entry saves with)
    this.sessionStrip     = $('tj-session-strip');
    this.sessionStripText = $('tj-session-strip-text');
    this.groupSessionBtn  = $('tj-btn-group-session');
    this.splitSessionBtn  = $('tj-btn-split-session');

    // Confirm dialog
    this.confirmOverlay  = $('tj-confirm-overlay');
    this.confirmText     = $('tj-confirm-text');
    this.confirmOkBtn    = $('tj-confirm-yes');
    this.confirmCancelBtn= $('tj-confirm-no');

    // Import dialog (CSV → entries)
    this.importOverlay   = $('tj-import-overlay');
    this.importDrop      = $('tj-import-drop');
    this.importFile      = $('tj-import-file');
    this.importPaste     = $('tj-import-paste');
    this.importSummary   = $('tj-import-summary');
    this.importWarnings  = $('tj-import-warnings');
    this.importPreviewWrap = $('tj-import-preview-wrap');
    this.importPreviewBody = $('tj-import-preview-body');
    this.importLoadFormBtn = $('tj-import-load-form');
    this.importRunBtn    = $('tj-import-run');
    this.importGroupCheck= $('tj-import-group-session');
    this.importGroupNote = $('tj-import-group-note');

    // Draft dialog (offline write-up helper)
    this.draftOverlay    = $('tj-draft-overlay');
    this.draftTabs       = Array.from(document.querySelectorAll('[data-draft-tab]'));
    this.draftPanelSkeleton = $('tj-draft-panel-skeleton');
    this.draftPanelPrompt   = $('tj-draft-panel-prompt');
    this.draftNotes      = $('tj-draft-notes');
    this.draftFields     = $('tj-draft-fields');
    this.draftApplyBtn   = $('tj-draft-apply');
    this.draftPromptBox  = $('tj-draft-prompt');
    this.draftAnswerBox  = $('tj-draft-answer');
    // Draft inputs are not editor fields, so they are cached by hand
    this.draftInputs = {
      facts:     $('tj-draft-facts'),
      expected:  $('tj-draft-expected'),
      didInstead:$('tj-draft-didInstead'),
      context:   $('tj-draft-context'),
      stopPrice: $('tj-draft-stop')
    };

    // Field map — every input in the editor carries data-field="<key>"
    this._fields = {};
    this.editorOverlay.querySelectorAll('[data-field]').forEach(el => {
      this._fields[el.dataset.field] = el;
    });

    // The grouping choice is a per-browser preference, restored before the
    // first render so the table never flashes the other shape
    if (this.groupBySelect) this.groupBySelect.value = this._groupMode();
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

    // How the table is listed: one row per session (the default) or one row per
    // trade. Remembered per browser, because it is a reading preference.
    if (this.groupBySelect) {
      this.groupBySelect.addEventListener('change', () => {
        this._groupBy = this.groupBySelect.value === 'none' ? 'none' : 'session';
        this._groupByLoaded = true;
        this._openGroups.clear();
        try { localStorage.setItem('stockwatchlist_journal_group_by', this._groupBy); }
        catch (e) { /* private mode — the choice simply is not remembered */ }
        this._renderTable();
        this._renderStats();
      });
    }
    if (this.btnExpandGroups) this.btnExpandGroups.addEventListener('click', () => this._setAllGroups(true));
    if (this.btnCollapseGroups) this.btnCollapseGroups.addEventListener('click', () => this._setAllGroups(false));

    // Table: sortable headers + row actions
    this.tableHead.addEventListener('click', (e) => {
      const th = e.target.closest('th[data-sort]');
      if (th) this._toggleSort(th.dataset.sort);
    });
    this.tableBody.addEventListener('click', (e) => {
      // The session branches come FIRST. A session row carries data-group and
      // its legs carry data-id, so an edit/delete branch tested earlier would
      // swallow the toggle click and open an editor instead.
      const toggle = e.target.closest('[data-toggle-group]');
      if (toggle) { this._toggleGroup(toggle.dataset.toggleGroup); return; }
      const stamp = e.target.closest('[data-stamp-group]');
      if (stamp) { this._stampSession(stamp.dataset.stampGroup); return; }
      const sessionRow = e.target.closest('tr.tj-session-row');
      if (sessionRow && !e.target.closest('button, a')) {
        this._toggleGroup(sessionRow.dataset.group);
        return;
      }
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
    // The overlay covers the page header, so the header's Import / New entry
    // buttons cannot be reached while a form is open — the editor head carries
    // its own copies so a second entry or an import never needs a detour.
    if (this.editorNewBtn) this.editorNewBtn.addEventListener('click', () => this._startAnotherEntry());
    if (this.editorImportBtn) this.editorImportBtn.addEventListener('click', () => this.openImport());

    // Session strip — the group id the open entry saves with. The strip reads
    // this._currentGroupId, never the DOM, because _clearForm() wipes every
    // [data-field] input on the way in.
    if (this.groupSessionBtn) this.groupSessionBtn.addEventListener('click', () => this._groupCurrentSession());
    if (this.splitSessionBtn) this.splitSessionBtn.addEventListener('click', () => this._splitCurrentSession());
    // The strip follows the two fields the session key is made of
    ['ticker', 'date'].forEach(key => {
      const el = this._fields[key];
      if (el) el.addEventListener('change', () => this._renderSessionStrip());
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

    // Timing & prices → the live P&L strip, the duration and the R-multiple.
    // They also keep column A (the trade date) following the entry date.
    ['direction', 'entryDate', 'entryTime', 'entryPrice',
     'exitDate', 'exitTime', 'exitPrice',
     'shares', 'fees', 'plannedRiskR'].forEach(key => {
      const el = this._fields[key];
      if (!el) return;
      el.addEventListener('input', () => { if (key === 'shares') this._dropAssumedSize(); this._syncTiming(key); });
      el.addEventListener('change', () => this._syncTiming(key));
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

    // Confirm dialog (one generic dialog serves delete, import and discard)
    this.confirmOkBtn.addEventListener('click', () => this._resolveConfirm(true));
    this.confirmCancelBtn.addEventListener('click', () => this._resolveConfirm(false));
    this.confirmOverlay.addEventListener('click', (e) => {
      if (e.target === this.confirmOverlay) this._resolveConfirm(false);
    });

    // Header: import + draft dialogs
    if (this.btnImport) this.btnImport.addEventListener('click', () => this.openImport());
    if (this.btnDraft) this.btnDraft.addEventListener('click', () => this.openDraft());

    this._bindImportDialog();
    this._bindDraftDialog();
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

  // ---- Live numbers: read the form, let JournalCSV do the arithmetic ----
  // One implementation (js/journal-csv.js) serves the live strip, the saved
  // document and the CSV import, so they cannot drift apart.
  _updatePnl() {
    const values = this._readNumberFields();
    const fallback = this._fields.date ? this._fields.date.value : '';
    const numbers = JournalCSV.computeTradeNumbers(Object.assign({}, values, {
      defaultDate: values.entryDate || fallback
    }));

    // A price pair with no size gets 1 share so the strip is not blank — the
    // write happens before the chips are drawn, so the two always agree
    this._applyAssumedShares(numbers);
    this._renderPnlChips(numbers);
    this._renderTimingHint(numbers);
    this._renderNumbersHint(numbers);

    // Auto-fill Outcome / P&L while the user has not typed their own wording
    if (!this._outcomeTouched && this._fields.outcome) {
      this._fields.outcome.value = JournalCSV.outcomeText(numbers) || '';
    }
  }

  // The tradeData object for whatever is in the form right now — the same shape
  // the CSV import writes, because both go through JournalCSV.
  _buildTradeData(values, fallbackDate) {
    const numbers = JournalCSV.computeTradeNumbers(Object.assign({}, values, {
      defaultDate: values.entryDate || fallbackDate || values.date || ''
    }));
    return { tradeData: JournalCSV.buildTradeData(values, numbers), numbers };
  }

  // Every timing/numbers input, already typed
  _readNumberFields() {
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
    const txt = (key) => {
      const el = this._fields[key];
      return el ? String(el.value || '').trim() : '';
    };
    return {
      direction: txt('direction') || 'long',
      entryDate: txt('entryDate'),
      entryTime: txt('entryTime'),
      entryPrice: num('entryPrice'),
      exitDate: txt('exitDate'),
      exitTime: txt('exitTime'),
      exitPrice: num('exitPrice'),
      shares: int('shares'),
      fees: num('fees'),
      plannedRiskR: num('plannedRiskR'),
      strategy: txt('strategy'),
      processScore: int('processScore'),
      date: txt('date')
    };
  }

  _renderPnlChips(numbers) {
    if (numbers.perShare == null || numbers.pnl == null) {
      this._clearPnl();
    } else {
      this._setPnlEl(this.pnlPerShare, Utils.formatCurrency(numbers.perShare) + '/share', numbers.perShare >= 0);
      this._setPnlEl(this.pnlPercent,
        numbers.pnlPercent == null ? '—' : Utils.formatPercent(numbers.pnlPercent), numbers.pnlPercent >= 0);
      this._setPnlEl(this.pnlTotal, Utils.formatCurrency(numbers.pnl), numbers.pnl >= 0);
      this._setPnlEl(this.realisedREl,
        numbers.realisedR == null ? '—' : (numbers.realisedR >= 0 ? '+' : '') + numbers.realisedR.toFixed(2) + 'R',
        numbers.realisedR == null ? null : numbers.realisedR >= 0);
    }
    this._setPnlEl(this.durationEl,
      numbers.durationMin == null ? '—' : JournalCSV.formatDuration(numbers.durationMin), null);
  }

  // The line under the timing grid: what the two moments add up to
  _renderTimingHint(numbers) {
    if (!this.durationHint) return;
    const bits = [];
    if (numbers.entryTime && numbers.exitTime) {
      bits.push(numbers.entryTime + ' → ' + numbers.exitTime +
        (numbers.rolledExitDate ? ' (next day)' : '') + ' · ' +
        JournalCSV.formatDuration(numbers.durationMin));
    }
    if (numbers.rolledExitDate) bits.push('Crosses midnight — the exit is read as the next calendar day.');
    if (numbers.entryTime && numbers.exitTime && numbers.durationMin == null) {
      bits.push('The exit time is before the entry time.');
    }
    const entryDate = this._fields.entryDate ? this._fields.entryDate.value : '';
    const tradeDate = this._fields.date ? this._fields.date.value : '';
    if (entryDate && tradeDate && entryDate === tradeDate) bits.push('Column A follows the entry date.');

    this.durationHint.textContent = bits.join(' · ');
    this.durationHint.style.display = bits.length ? 'block' : 'none';
  }

  // The line under the strip: why a figure is there that the user never typed
  _renderNumbersHint(numbers) {
    if (!this.numbersHint) return;
    const bits = [];
    if (numbers.assumedShares) {
      bits.push('No size entered, so 1 share is assumed for this figure — the Numbers panel below holds it; change it to the real size.');
    }
    this.numbersHint.textContent = bits.join(' · ');
    this.numbersHint.style.display = bits.length ? 'block' : 'none';
  }

  // ---- The 1-share default ------------------------------------------------
  // Both prices with no size still has a per-share answer, so the Shares field
  // is filled with 1 instead of being left blank: the strip populates, the
  // assumption is on screen in the Numbers panel, and the user types over it.
  // The value lives in the field, so a save stores the same number the strip
  // showed — the document can never disagree with what was on screen.
  _applyAssumedShares(numbers) {
    const el = this._fields.shares;
    if (!el) return;
    // The caret is in the field: it belongs to the user, not to us
    if (typeof document !== 'undefined' && document.activeElement === el) return;

    const current = String(el.value == null ? '' : el.value).trim();

    if (numbers.assumedShares) {
      if (current) return;                        // a real size is already there
      el.value = '1';
      this._sharesAssumed = true;
      el.title = 'Assumed from the prices: 1 share. Replace it with the real size for a true P&L.';
      if (el.classList) el.classList.add('tj-input-assumed');
      this._setTradeSectionOpen(true);            // so the assumed 1 is on screen
      return;
    }

    // A size in the field now ends the assumption, whoever put it there. Only a
    // 1 that we wrote is ever cleared, and only once the prices behind it are
    // gone — the one thing that can void the assumption. A size the user typed
    // drops the flag in the input listener first; a size applied from a draft or
    // an imported row is left exactly as it is.
    if (this._sharesAssumed) {
      const ours = numbers.perShare == null && current === '1';
      this._dropAssumedSize();
      if (ours) el.value = '';
    }
  }

  // Stop calling the size an assumption (the user typed their own, or the
  // prices went away)
  _dropAssumedSize() {
    this._sharesAssumed = false;
    const el = this._fields.shares;
    if (!el) return;
    el.title = '';
    if (el.classList) el.classList.remove('tj-input-assumed');
  }

  // Entry date → column A (the trade date), until the user types their own date
  _syncTiming(changedKey) {
    if (changedKey === 'entryDate' && this._fields.date && this._fields.entryDate) {
      const next = this._fields.entryDate.value;
      if (next && (!this._fields.date.value || this._fields.date.value === this._lastEntryDate)) {
        this._fields.date.value = next;
      }
      this._lastEntryDate = next;
    }
    this._updatePnl();
  }

  // ---- Populate a date + time pair from a stored moment ----
  _applyMoment(which, dateValue, timeValue) {
    const dateEl = this._fields[which === 'entry' ? 'entryDate' : 'exitDate'];
    const timeEl = this._fields[which === 'entry' ? 'entryTime' : 'exitTime'];
    if (dateEl) dateEl.value = '';
    if (timeEl) timeEl.value = '';

    // Both shapes have to load: the current one (a date column plus a time
    // column, entryTime holding the full moment) and the older one, where the
    // whole moment sat in the time field alone.
    const fromDate = JournalCSV.parseMoment(dateValue);
    const fromTime = JournalCSV.parseMoment(timeValue);
    const date = fromDate.date || fromTime.date || '';
    const time = fromDate.time || fromTime.time || '';
    if (dateEl && date) dateEl.value = date;
    if (timeEl && time) timeEl.value = time;
    if (which === 'entry') this._lastEntryDate = dateEl ? dateEl.value : '';
  }

  _formatDuration(mins) {
    return JournalCSV.formatDuration(mins);
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
      // Default the dates to today (matching the Reviews tab behaviour) so the
      // timing fields and column A start in agreement
      const today = Utils.todayLocal();
      if (this._fields.date) this._fields.date.value = today;
      if (this._fields.entryDate) this._fields.entryDate.value = today;
      this._lastEntryDate = today;
      this.editorHeading.textContent = 'New journal entry';
      this.editorDeleteBtn.style.display = 'none';
    }

    this._isDirty = false;
    this.editorDirty.style.display = 'none';
    this._updateSaveStatus('');
    this._updateCategoryHint();
    this.editorOverlay.style.display = 'flex';

    // The session strip is rendered with the ticker and the date already in
    // place, so it can say how many stored rows share this ticker and date
    this._renderSessionStrip();

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

  // ---- "＋ New" / "📥 Import" in the editor head ---------------------------
  // The overlay covers the whole page, so the header's "+ New entry" and
  // "Import" buttons are out of reach the moment a form is open. These two
  // start a second entry (or an import) from inside the form; unsaved work is
  // confirmed first, never dropped silently.
  async _startAnotherEntry() {
    if (this._isDirty) {
      const ok = await this._confirm(
        'This entry has <b>unsaved changes</b>.<br>' +
        'Start a new entry and discard them?',
        { okLabel: 'Discard and start new', danger: true });
      if (!ok) return;
    }
    this.openEditor(null);
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
    this._lastEntryDate = '';
    this._setTradeSectionOpen(false);
    this._dropAssumedSize();
    if (this.durationHint) {
      this.durationHint.textContent = '';
      this.durationHint.style.display = 'none';
    }
    this._clearPnl();

    // The session strip reads this._currentGroupId, never the DOM: _clearForm
    // wipes every [data-field] input, so the group state has to go with them.
    this._currentGroupId = null;
    this._groupIntent = null;
    this._renderSessionStrip();

    if (this._quill) this._quill.setContents([{ insert: '\n' }], 'silent');
  }

  _fillForm(entry) {
    // The stored session id is carried into the form untouched — the strip's two
    // buttons are the only things that ever change it
    this._currentGroupId = entry.groupId ? String(entry.groupId) : null;
    this._groupIntent = null;

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

    // 2) Timing, prices and the numbers behind the trade
    const td = entry.tradeData || {};
    if (this._fields.direction && td.direction) this._fields.direction.value = td.direction;
    ['entryPrice', 'exitPrice', 'shares', 'strategy', 'fees', 'plannedRiskR'].forEach(k => {
      const el = this._fields[k];
      if (el && td[k] != null) el.value = td[k];
    });
    this._applyMoment('entry', td.entryDate, td.entryTime);
    this._applyMoment('exit', td.exitDate, td.exitTime);

    // The collapsed Numbers panel only holds size, costs and the planned risk now
    this._setTradeSectionOpen(!!(td.shares != null || td.fees != null || td.plannedRiskR != null || td.strategy));

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

    // 2) Timing, prices and the numbers behind the trade — built by the one
    //    shared implementation in js/journal-csv.js that the CSV import uses too
    const values = this._readNumberFields();
    const built = this._buildTradeData(values, doc.date);
    doc.tradeData = built.tradeData;

    // Column A is the trade date: it follows the entry date unless the user
    // typed their own
    if (!doc.date && built.numbers.entryDate) doc.date = built.numbers.entryDate;

    // Column L stays a faithful restatement of the numbers
    if (!doc.outcome) {
      const derived = JournalCSV.outcomeText(built.numbers);
      if (derived) doc.outcome = derived;
    }

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
    doc.processScore = values.processScore;
    doc.symbol = doc.ticker ? doc.ticker.toUpperCase() : null;
    const hint = document.getElementById('tj-ticker-hint');
    doc.companyName = hint ? (hint.textContent || null) : null;
    doc.reviewId = this._sourceReview ? this._sourceReview.id : (this._linkedReviewId || null);
    doc.sourcePage = 'TradeJournal.html';

    // 6) The session this row belongs to:
    //      null      never grouped — the ticker+date key decides at render time
    //      'grp_…'   an explicit session, shared with the rows it was imported with
    //      'solo_…'  deliberately split out of its session: never merged again
    doc.groupId = this._resolveGroupId();

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
    // The entry id is allocated before the form is read, because a row that was
    // split out stores a solo id built from its own id (see _resolveGroupId),
    // and because pasted images and the document share one folder.
    if (!this._currentId) this._currentId = dataStore.generateJournalId();

    const doc = this._collectForm();

    // An entry needs at least a ticker or a category to be worth storing
    if (!doc.ticker && !doc.category) {
      if (!silent) Utils.showToast('Add a ticker or a category before saving');
      return;
    }
    if (!doc.date) doc.date = Utils.todayLocal();

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

  // ---- Generic confirm dialog (delete, import and discard all reuse it) ----
  // opts: { okLabel, cancelLabel, danger }
  _confirm(htmlMessage, opts = {}) {
    this.confirmText.innerHTML = htmlMessage;
    this.confirmOkBtn.textContent = opts.okLabel || 'Yes';
    this.confirmCancelBtn.textContent = opts.cancelLabel || 'Cancel';
    this.confirmOkBtn.className = 'btn btn-sm ' + (opts.danger === false ? 'btn-primary' : 'btn-danger');
    this.confirmOverlay.style.display = 'flex';
    return new Promise(resolve => { this._confirmResolve = resolve; });
  }

  // Delete keeps its own name so the two call sites stay readable
  _confirmDelete(htmlMessage) {
    return this._confirm(htmlMessage, { okLabel: '🗑️ Delete', danger: true });
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
    // `groupId` is null on every row stored before sessions existed, which is
    // exactly what "never grouped" means — no migration, the ticker+date key
    // groups those rows instead.
    e.groupId = raw.groupId ? String(raw.groupId) : null;
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
    if (td.entryTime || td.exitTime || td.entryDate || td.exitDate) {
      this._applyMoment('entry', td.entryDate, td.entryTime);
      this._applyMoment('exit', td.exitDate, td.exitTime);
      if (td.shares != null || td.fees != null || td.plannedRiskR != null) this._setTradeSectionOpen(true);
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
  _tableColumns(showSession = false) {
    const cols = [
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

    // Grouped views gain one column on the left: the disclosure triangle that
    // opens a session's legs, and the line-and-arrow mark that keeps the legs
    // readable. It is not sortable — a session has no single date or ticker to
    // sort by.
    if (showSession) cols.unshift({ key: 'session', label: 'Session', sortable: false });
    return cols;
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
    // Sessions are grouped AFTER filtering and sorting, on the rows the current
    // filters kept: a session can therefore show a subset of its legs, which is
    // what makes a category filter honest about what it is hiding.
    const groups = this._buildGroups();
    this._lastGroups = groups;
    const cols = this._tableColumns(!!groups);

    // Sortable header row
    this.tableHead.innerHTML = '<tr>' + cols.map(c => {
      if (!c.sortable) return `<th>${JournalText.esc(c.label)}</th>`;
      const active = this._sort.key === c.key;
      const arrow = active ? (this._sort.dir === 'asc' ? ' ▲' : ' ▼') : '';
      return `<th data-sort="${c.key}" class="${active ? 'sorted' : ''}" ` +
        `title="Sort by ${JournalText.esc(c.label)}">${JournalText.esc(c.label)}${arrow}</th>`;
    }).join('') + '</tr>';

    // Expand / collapse all only means anything while there is a session to open
    if (this.groupActionBar) this.groupActionBar.style.display = groups ? 'inline-flex' : 'none';

    // Result counter — rows first, then how many sessions those rows make up
    if (this.resultCount) {
      const total = this._entries.length;
      const shown = this._filtered.length;
      let text = shown === total
        ? `${total} ${total === 1 ? 'entry' : 'entries'}`
        : `${shown} of ${total} entries`;
      if (groups) {
        const stats = JournalCSV.groupStats(groups);
        text += ` · ${stats.sessions} ${stats.sessions === 1 ? 'session' : 'sessions'}`;
      }
      this.resultCount.textContent = text;
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
          `<button type="button" class="btn btn-secondary" id="tj-empty-import">📥 Import a CSV</button>` +
          `<button type="button" class="btn btn-secondary" id="tj-empty-sample">See an example entry</button>` +
          `</div>`;
        const newBtn = document.getElementById('tj-empty-new');
        if (newBtn) newBtn.addEventListener('click', () => this.openEditor(null));
        const importBtn = document.getElementById('tj-empty-import');
        if (importBtn) importBtn.addEventListener('click', () => this.openImport());
        const sampleBtn = document.getElementById('tj-empty-sample');
        if (sampleBtn) sampleBtn.addEventListener('click', () => this._loadSampleIntoForm());
      }
      return;
    }

    this.emptyState.style.display = 'none';
    this.tableBody.innerHTML = groups
      ? groups.map(g => this._groupHtml(g, cols)).join('')
      : this._filtered.map(e => this._rowHtml(e, cols)).join('');
  }

  // One trade row.
  //   group  set when the row is a leg drawn under a session row: it gains a
  //          line-and-arrow mark in the session column and a class, so it never
  //          looks like a session of its own.
  //   solo   set when the row IS its own session — one trade that repeats itself
  //          nowhere. It stays the real trade row, with its prose, its numbers
  //          and its buttons, and is marked with a right-pointing arrow and its
  //          one-line story so it can never be read as a leg of the session
  //          above it. There is nothing underneath it to open, so the arrow is
  //          not a button and carries no toggle.
  _rowHtml(entry, cols, group = null, solo = null) {
    const td = entry.tradeData || {};
    const meta = JournalCategories.byName(entry.category);

    const cells = cols.map(c => {
      switch (c.key) {
        case 'session':
          if (group) {
            // The mark is the grammar in one glyph run: `└───→` is a line that
            // leaves the session above and points into this leg. A bare corner
            // reads as a stray character, and a long dash run without a head
            // reads as a rule — the arrow is what says "child of the row above".
            return `<td class="tj-session-cell">` +
              `<span class="tj-leg-mark" aria-hidden="true" title="One leg of the session above">└───→</span>` +
              `</td>`;
          }
          if (solo) {
            const story = JournalCSV.describeRollup(solo.rollup, { noCount: true });
            return `<td class="tj-session-cell" ` +
              `title="A session of one trade — this row is the whole entry, there is nothing to open">` +
              `<span class="tj-single-arrow" aria-hidden="true">▶</span>` +
              `<span class="tj-session-count">${solo.count} ${solo.count === 1 ? 'trade' : 'trades'}</span>` +
              (story ? `<span class="tj-session-sub">${JournalText.esc(story)}</span>` : '') +
              `</td>`;
          }
          return `<td class="tj-session-cell"></td>`;

        case 'date': {
          // The trade date, with the timing and the time in trade under it
          const numbers = JournalCSV.computeTradeNumbers({
            direction: td.direction, entryDate: td.entryDate, entryTime: td.entryTime,
            exitDate: td.exitDate, exitTime: td.exitTime,
            entryPrice: td.entryPrice, exitPrice: td.exitPrice, shares: td.shares,
            fees: td.fees, plannedRiskR: td.plannedRiskR, defaultDate: entry.date
          });
          const timing = JournalCSV.describeTiming(numbers);
          if (!entry.date && !timing) return `<td class="tj-muted">—</td>`;
          const main = entry.date ? `<div class="tj-cell-main">${JournalText.esc(JournalCSV.displayDate(entry.date))}</div>` : '';
          const sub = timing
            ? `<div class="tj-cell-sub" title="Entry time → exit time and time in trade">${JournalText.esc(timing)}</div>`
            : '';
          if (!entry.date) return `<td><div class="tj-cell-sub">${JournalText.esc(timing)}</div></td>`;
          return `<td>${main}${sub}</td>`;
        }

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

    // A leg hangs under its session; a session of one opens a block of its own,
    // which the CSS marks with the line above it.
    const rowClass = group ? 'tj-leg-row' : (solo ? 'tj-group-start' : '');
    const classAttr = rowClass ? ' class="' + rowClass + '"' : '';
    return `<tr data-id="${JournalText.esc(entry.id)}"${classAttr}>${cells}</tr>`;
  }

  // ==========================================================================
  // Sessions — several legs of one ticker on one day, as one row
  // ==========================================================================
  // The store keeps one document per TRADE, so a session is a VIEW: the legs are
  // the rows, and the session row above them is derived on every render. Two
  // rows are in the same session when they carry the same stored groupId, or —
  // when neither says anything — when they share a ticker and a date, which is
  // what makes grouping work on entries stored before groups existed.
  // js/journal-csv.js owns that logic; this section draws it and writes the ids.
  // No session figure is ever stored, so a session can never disagree with the
  // legs it is made of.
  // ==========================================================================

  // 'session' (the default) or 'none'. Read lazily: the controller is built in
  // the Node tests with no localStorage in sight.
  _groupMode() {
    if (!this._groupByLoaded) {
      this._groupByLoaded = true;
      try {
        const saved = localStorage.getItem('stockwatchlist_journal_group_by');
        if (saved === 'none' || saved === 'session') this._groupBy = saved;
      } catch (e) { /* private mode — the default stands */ }
    }
    return this._groupBy === 'none' ? 'none' : 'session';
  }

  // The sessions to draw, or null when the view stays flat. Flat means either the
  // reader turned grouping off or there is nothing to group: a journal where
  // every session has one leg looks exactly as it always did.
  _buildGroups() {
    if (this._groupMode() === 'none') return null;
    const groups = JournalCSV.groupEntries(this._filtered);
    return groups.some(g => g.count > 1) ? groups : null;
  }

  _groupHtml(group, cols) {
    // A session of one is still a whole entry, so it is drawn as its own row —
    // the real trade row, marked with the right-pointing arrow — rather than
    // turned into a summary above a copy of itself. No session row, nothing to
    // open: that is what keeps a journal with nothing to group looking exactly
    // the way it always did.
    if (group.single) return this._rowHtml(group.legs[0], cols, null, group);

    const open = this._isGroupOpen(group.key);
    const head = this._sessionRowHtml(group, cols, open);
    if (!open) return head;
    return head + group.legs.map(e => this._rowHtml(e, cols, group)).join('');
  }

  _isGroupOpen(key) {
    return this._openGroups.has(key);
  }

  _toggleGroup(key) {
    if (!key) return;
    if (this._openGroups.has(key)) this._openGroups.delete(key);
    else this._openGroups.add(key);
    this._renderTable();
  }

  _setAllGroups(open) {
    if (!open) this._openGroups.clear();
    else (this._lastGroups || []).forEach(g => this._openGroups.add(g.key));
    this._renderTable();
  }

  // A column of the session row: one value is shown as it stands, several are
  // counted. Never a guess at which one "matters".
  _distinctCell(values, noun) {
    if (!values || !values.length) return `<td class="tj-muted">—</td>`;
    if (values.length === 1) return `<td>${JournalText.esc(values[0])}</td>`;
    return `<td class="tj-muted" title="${JournalText.esc(values.join(', '))}">` +
      `${values.length} ${noun}</td>`;
  }

  // The session row: the caret, the leg count and the session's own figures. The
  // prose columns are deliberately left empty — what was written about a trade
  // lives on the leg that traded it, and a session row must never repeat or
  // invent any of it.
  _sessionRowHtml(group, cols, open) {
    const roll = group.rollup || {};
    const esc = (v) => JournalText.esc(v);

    const cells = cols.map(c => {
      switch (c.key) {
        case 'session': {
          const title = (open ? 'Collapse' : 'Expand') + ' the ' + group.count + ' legs of this session';
          return `<td class="tj-session-cell">` +
            `<button type="button" class="tj-group-toggle" data-toggle-group="${esc(group.key)}" ` +
            `aria-expanded="${open ? 'true' : 'false'}" title="${esc(title)}">${open ? '▾' : '▸'}</button>` +
            `<span class="tj-session-count">${group.count} ${group.count === 1 ? 'trade' : 'trades'}</span>` +
            `<span class="tj-session-sub">${esc(JournalCSV.describeRollup(roll, { noCount: true }))}</span>` +
            `</td>`;
        }

        case 'date':
          return `<td class="tj-session-main">${esc(JournalCSV.displayDate(group.date) || '—')}</td>`;

        case 'ticker':
          return `<td class="tj-session-main">${esc(group.ticker || '—')}</td>`;

        case 'timeframe': return this._distinctCell(group.timeframes, 'timeframes');
        case 'category':  return this._distinctCell(group.categories, 'categories');
        case 'setup':     return this._distinctCell(group.setups, 'setups');

        case 'outcome':
          return roll.netPnl == null
            ? `<td class="tj-muted">—</td>`
            : `<td>${esc(JournalCSV.moneyText(roll.netPnl))}</td>`;

        case 'adviceStatus':
          if (!roll.adviceTotal) return `<td class="tj-muted">—</td>`;
          return `<td class="tj-muted">${roll.adviceApplied} of ${roll.adviceTotal} applied</td>`;

        case 'pnl': {
          if (roll.netPnl == null) return `<td class="tj-num tj-muted">—</td>`;
          const cls = roll.netPnl >= 0 ? 'positive' : 'negative';
          return `<td class="tj-num ${cls}">${esc(Utils.formatCurrency(roll.netPnl))}</td>`;
        }

        case 'star':
          if (roll.avgProcessScore == null) return `<td class="tj-num tj-muted">—</td>`;
          return `<td class="tj-num" title="Average process score of the legs">` +
            `${esc(roll.avgProcessScore.toFixed(1))}/5</td>`;

        case 'actions':
          // A session keyed by ticker+date is implicit: nothing is stored yet, so
          // offer to make it explicit. A stored one needs no button — its id is
          // already the statement.
          if (group.stored) return `<td class="tj-actions"></td>`;
          return `<td class="tj-actions">` +
            `<button type="button" class="tj-icon-btn" data-stamp-group="${esc(group.key)}" ` +
            `title="Store one group id on all ${group.count} rows, so this session survives an edit to the ticker or the date">🔗</button>` +
            `</td>`;

        default:
          return `<td class="tj-session-blank"></td>`;
      }
    }).join('');

    return `<tr class="tj-session-row" data-group="${esc(group.key)}" ` +
      `title="${esc('Session ' + group.label + ' — ' + JournalCSV.describeRollup(roll))}">${cells}</tr>`;
  }

  // ---- The session of the row in the editor ---------------------------------
  // null when the form has neither a ticker nor a date to pair on
  _formSessionKey() {
    return JournalCSV.sessionKey({
      ticker: this._fields.ticker ? this._fields.ticker.value : '',
      date: this._fields.date ? this._fields.date.value : ''
    });
  }

  // The stored rows the computed ticker+date key would put with the open one.
  // Rows that already carry an id of their own — a real group or a solo split —
  // are left out: that id is an explicit statement about where they belong.
  _sessionSiblings() {
    const session = this._formSessionKey();
    if (!session) return [];
    const key = 'auto:' + session;
    return this._entries.filter(e => e.id !== this._currentId && JournalCSV.groupKeyFor(e) === key);
  }

  // The groupId the open row is saved with:
  //   null       never grouped — the ticker+date key does the work
  //   'grp_…'    an explicit session, shared with the rows around it
  //   'solo_…'   split out on purpose: never merged with anything again
  _resolveGroupId() {
    if (this._groupIntent === 'solo') {
      return JournalCSV.soloGroupId(this._currentId || dataStore.generateJournalId());
    }
    return this._currentGroupId || null;
  }

  // The strip above the form: which session this row will save into, and the two
  // ways to change that. It reads this._currentGroupId, never the DOM — see
  // _clearForm().
  _renderSessionStrip() {
    if (!this.sessionStrip) return;

    const session = this._formSessionKey();
    if (!session) {
      // Nothing to pair on: a row with no ticker and no date is its own session
      this.sessionStrip.style.display = 'none';
      return;
    }

    const ticker = (this._fields.ticker ? this._fields.ticker.value : '').trim().toUpperCase();
    const date = (this._fields.date ? this._fields.date.value : '').trim();
    const siblings = this._sessionSiblings();
    const count = siblings.length;
    const plural = count === 1 ? 'row' : 'rows';
    const solo = this._groupIntent === 'solo' || JournalCSV.isSoloGroupId(this._currentGroupId);
    const stored = !solo && JournalCSV.isGrouped({ groupId: this._currentGroupId });

    const bits = [`Session <b>${JournalText.esc((ticker || '—') + ' · ' + (date || 'no date'))}</b>`];
    if (solo) {
      bits.push('<span class="tj-session-flag">this row only</span>');
      bits.push(`<span class="tj-muted">split out — it saves on its own, never with the ${count} other ${plural} on this ticker and date</span>`);
    } else if (stored) {
      bits.push('<span class="tj-session-flag tj-session-flag-ok">stored group</span>');
      bits.push(count
        ? `<span class="tj-muted">${count} other ${plural} share this ticker and date and join it</span>`
        : `<span class="tj-muted">no other row shares this ticker and date yet</span>`);
    } else if (count) {
      bits.push(`<span class="tj-muted">${count} other ${plural} share this ticker and date — they read as one session</span>`);
    } else {
      bits.push('<span class="tj-muted">no other row shares this ticker and date</span>');
    }

    this.sessionStripText.innerHTML = bits.join(' · ');
    this.sessionStrip.style.display = 'flex';

    if (this.groupSessionBtn) {
      this.groupSessionBtn.textContent = solo ? '↩ Join the session' : '🔗 Store the group id';
      this.groupSessionBtn.title = solo
        ? 'Drop the split: this row joins its ticker and date again'
        : 'Write one group id onto this row and every stored row on this ticker and date, so the session no longer depends on both fields staying put';
    }
    if (this.splitSessionBtn) {
      this.splitSessionBtn.disabled = solo;
      this.splitSessionBtn.title = 'Keep this row out of the session it would otherwise join';
    }
  }

  // ---- Writing the group id -------------------------------------------------
  // One id generator, so a session id is created in exactly one place
  _newGroupId() {
    return (dataStore && typeof dataStore.generateGroupId === 'function')
      ? dataStore.generateGroupId()
      : JournalCSV.newGroupId();
  }

  // "🔗 Store the group id" — and "↩ Join the session" once the row is split out.
  // Joining is local (dropping the id is enough, the row groups by ticker+date
  // again). Storing writes ONE new id onto this row and onto every stored row
  // that shares its ticker and date: that back-fill is the only thing in the app
  // that touches an existing row's grouping, it only ever moves the id field,
  // and it only happens because the reader asked for it.
  async _groupCurrentSession() {
    const session = this._formSessionKey();
    if (!session) {
      Utils.showToast('Add a ticker and a date before grouping a session');
      return;
    }

    if (this._groupIntent === 'solo') {
      this._groupIntent = null;
      this._currentGroupId = null;
      this._markDirty();
      this._renderSessionStrip();
      Utils.showToast('Rejoined — this row saves back into its session');
      return;
    }

    const id = this._newGroupId();
    const siblings = this._sessionSiblings();

    this._currentGroupId = id;
    this._markDirty();
    this._renderSessionStrip();

    let stamped = 0;
    for (const sibling of siblings) {
      try {
        // A field-level merge, never a re-write: only the id moves
        await dataStore.saveJournalEntry({ groupId: id }, sibling.id);
        sibling.groupId = id;
        stamped++;
      } catch (e) {
        console.warn('[TradeJournal] Could not stamp ' + sibling.id + ' with the group id:', e);
      }
    }

    Utils.showToast(stamped
      ? `Session grouped — ${stamped} stored ${stamped === 1 ? 'row' : 'rows'} stamped, save this one to join them`
      : 'Session grouped — save this row to keep it');
    this._applyFilters();
  }

  // "✂️ Split out" — the row saves with a solo id built from its own entry id, so
  // it stays out of the session even after a reload. It is not a delete: the row
  // keeps every other field exactly as it is.
  _splitCurrentSession() {
    const session = this._formSessionKey();
    if (!session) {
      Utils.showToast('Add a ticker and a date before splitting a row out');
      return;
    }
    const siblings = this._sessionSiblings();

    this._groupIntent = 'solo';
    this._currentGroupId = null;
    this._markDirty();
    this._renderSessionStrip();

    Utils.showToast(siblings.length
      ? `Split out — this row saves on its own, the other ${siblings.length} stay together`
      : 'Split out — this row saves on its own');
  }

  // "🔗" on a session row in the table — the same job as the strip's button, for
  // a session the reader picked out of the list instead of opening a leg in the
  // editor.
  async _stampSession(autoKey) {
    const session = String(autoKey || '').replace(/^auto:/, '');
    if (!session) return;

    const legs = this._entries.filter(e => JournalCSV.groupKeyFor(e) === 'auto:' + session);
    if (legs.length < 2) {
      Utils.showToast('This session has one row — nothing to group');
      return;
    }

    const ok = await this._confirm(
      `Store one group id on the <b>${legs.length}</b> rows of ` +
      `<b>${JournalText.esc(session.replace('@', ' · '))}</b>?<br>` +
      `The session then keeps holding together even if the ticker or the date of a row is edited later.`,
      { okLabel: '🔗 Group them', danger: false }
    );
    if (!ok) return;

    const id = this._newGroupId();
    let stamped = 0;
    for (const leg of legs) {
      try {
        await dataStore.saveJournalEntry({ groupId: id }, leg.id);
        leg.groupId = id;
        stamped++;
      } catch (e) {
        console.warn('[TradeJournal] Could not stamp ' + leg.id + ' with the group id:', e);
      }
    }

    if (!stamped) {
      Utils.showToast('Nothing could be stored — the session still groups by ticker and date');
      return;
    }

    // The reader just asked for this session, so open it as they find it
    this._openGroups.add('g:' + id);
    await this.loadEntries(false);
    Utils.showToast(`Session grouped — ${stamped} ${stamped === 1 ? 'row' : 'rows'} now share one group id`);
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

    // The Entries card counts ROWS, because that is what the table's rows are
    // backed by — but when the view is grouped it also says how many sessions
    // those rows make up, so the two numbers never look like a contradiction.
    const viewGroups = this._buildGroups();
    const subBits = [];
    if (viewGroups) {
      const stats = JournalCSV.groupStats(viewGroups);
      subBits.push(`${stats.sessions} ${stats.sessions === 1 ? 'session' : 'sessions'}`);
      if (stats.multiLeg) subBits.push(`${stats.multiLeg} with several legs`);
    }
    if (this._filtered.length !== this._entries.length) subBits.push('filtered view');

    cards.push(card('Entries', JournalText.esc(String(entries.length)),
      null, subBits.length ? subBits.join(' · ') : null));

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
      const heading = `${JournalCSV.displayDate(e.date) || 'no date'} · ${e.ticker || '—'}${star}`;
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
  // CSV IMPORT — "Import" in the header (js/journal-csv.js does the reading)
  // ==========================================================================
  // Three ways in, all optional: drop a file, choose a file, or paste text. The
  // preview shows exactly what would be written, including every warning, and
  // nothing is saved until the Import button is pressed.
  _bindImportDialog() {
    if (!this.importOverlay) return;
    const $ = (id) => document.getElementById(id);

    $('tj-import-close').addEventListener('click', () => this.closeImport());
    this.importOverlay.addEventListener('click', (e) => {
      if (e.target === this.importOverlay) this.closeImport();
    });

    // Drag and drop onto the drop zone
    ['dragenter', 'dragover'].forEach(evt => this.importDrop.addEventListener(evt, (e) => {
      e.preventDefault();
      this.importDrop.classList.add('hover');
    }));
    ['dragleave', 'drop'].forEach(evt => this.importDrop.addEventListener(evt, (e) => {
      e.preventDefault();
      this.importDrop.classList.remove('hover');
    }));
    this.importDrop.addEventListener('drop', (e) => {
      const file = e.dataTransfer && e.dataTransfer.files ? e.dataTransfer.files[0] : null;
      if (file) this._readImportFile(file);
    });

    $('tj-import-pick').addEventListener('click', () => this.importFile.click());
    this.importFile.addEventListener('change', () => {
      const file = this.importFile.files ? this.importFile.files[0] : null;
      if (file) this._readImportFile(file);
    });

    // Pasted text is read on demand (and re-read when it changes)
    this.importPaste.addEventListener('input', () => this._resetImportPreview());
    $('tj-import-preview').addEventListener('click', () => this._readImportText(this.importPaste.value));
    $('tj-import-clear').addEventListener('click', () => {
      this.importPaste.value = '';
      this._resetImportPreview();
    });

    $('tj-import-example').addEventListener('click', () => {
      this.importPaste.value = JournalCSV.buildExample();
      this._readImportText(this.importPaste.value);
      Utils.showToast('Example CSV loaded — press Import to keep it');
    });
    $('tj-import-download').addEventListener('click', () => {
      const name = JournalCSV.downloadExample();
      Utils.showToast('Example CSV downloaded: ' + name);
    });
    $('tj-import-copy').addEventListener('click', async () => {
      const ok = await Utils.copyToClipboard(JournalCSV.buildExample());
      Utils.showToast(ok ? 'Example CSV copied' : 'Could not copy — use Download instead', ok ? 'success' : 'error');
    });

    this.importRunBtn.addEventListener('click', () => this._importEntries());
    this.importLoadFormBtn.addEventListener('click', () => this._loadImportRowIntoForm());

    // Sessions: one stored group id per ticker+date in the file (see
    // _importEntries). Ticking or unticking re-reads the note, so the count on
    // screen always matches what Import will do.
    if (this.importGroupCheck) {
      this.importGroupCheck.addEventListener('change', () => this._renderImportGroups(this._importResult));
    }
  }

  openImport(prefillText) {
    if (!this.importOverlay) return;
    if (this.draftOverlay) this.draftOverlay.style.display = 'none';
    this.importOverlay.style.display = 'flex';

    if (typeof prefillText === 'string' && prefillText.trim()) {
      this.importPaste.value = prefillText;
      this._readImportText(prefillText);
    } else if (!this.importPaste.value.trim()) {
      this._resetImportPreview();
    }
    this.importPaste.focus();
  }

  closeImport() {
    if (this.importOverlay) this.importOverlay.style.display = 'none';
  }

  _readImportFile(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result || '');
      this.importPaste.value = text;
      Utils.showToast('Read ' + file.name);
      this._readImportText(text);
    };
    reader.onerror = () => Utils.showToast('Could not read that file', 'error');
    reader.readAsText(file);
  }

  // Parse the paste box and show what would be imported
  _readImportText(text) {
    const source = String(text == null ? '' : text);
    if (!source.trim()) {
      this._resetImportPreview();
      if (this.importSummary) this.importSummary.textContent = 'Nothing to read yet.';
      return null;
    }

    let result;
    try {
      result = JournalCSV.toEntries(source, { defaultDate: Utils.todayLocal() });
    } catch (e) {
      console.error('[TradeJournal] CSV read failed:', e);
      this._resetImportPreview();
      if (this.importSummary) this.importSummary.textContent = 'That CSV could not be read: ' + e.message;
      return null;
    }

    this._importResult = result;
    this._renderImportPreview(result);
    return result;
  }

  _renderImportPreview(result) {
    const n = result.entries.length;
    if (this.importSummary) {
      this.importSummary.textContent = JournalCSV.summary(result) +
        ' — ' + (n ? 'ready to import' : 'nothing importable');
    }
    this._renderImportGroups(result);

    // Notes: they never block an import, they explain what was read
    const warnings = result.warnings || [];
    if (this.importWarnings) {
      if (warnings.length) {
        this.importWarnings.style.display = 'block';
        this.importWarnings.innerHTML =
          '<div class="tj-warn-title">' + warnings.length + (warnings.length === 1 ? ' note' : ' notes') + '</div>' +
          '<ul>' + warnings.slice(0, 40).map(w => '<li>' + JournalText.esc(w) + '</li>').join('') + '</ul>' +
          (warnings.length > 40 ? '<div class="tj-muted tj-small">…and ' + (warnings.length - 40) + ' more</div>' : '');
      } else {
        this.importWarnings.style.display = 'none';
        this.importWarnings.innerHTML = '';
      }
    }

    // One preview row per parsed entry, so the numbers are visible before saving
    if (n && this.importPreviewWrap && this.importPreviewBody) {
      this.importPreviewWrap.style.display = 'block';
      this.importPreviewBody.innerHTML = result.preview.map(p => {
        const cls = p.pnl == null ? 'tj-muted' : (p.pnl >= 0 ? 'positive' : 'negative');
        const cat = p.category ? JournalCategories.iconFor(p.category) + ' ' + p.category : '—';
        const price = (v) => (v == null ? '—' : String(v));
        return '<tr>' +
          '<td class="tj-muted">' + JournalText.esc(p.line == null ? '' : String(p.line)) + '</td>' +
          '<td>' + JournalText.esc(JournalCSV.displayDate(p.date) || '—') + '</td>' +
          '<td>' + JournalText.esc(p.ticker || '—') + '</td>' +
          '<td title="' + JournalText.esc(p.category || '') + '">' + JournalText.esc(cat) + '</td>' +
          '<td>' + JournalText.esc(p.direction) + '</td>' +
          '<td>' + JournalText.esc(p.timing || '—') + '</td>' +
          '<td class="tj-num">' + JournalText.esc(price(p.entryPrice)) + '</td>' +
          '<td class="tj-num">' + JournalText.esc(price(p.exitPrice)) + '</td>' +
          '<td class="tj-num ' + cls + '">' + JournalText.esc(p.pnlText || '—') + '</td>' +
          '</tr>';
      }).join('');
    } else if (this.importPreviewWrap && this.importPreviewBody) {
      this.importPreviewWrap.style.display = 'none';
      this.importPreviewBody.innerHTML = '';
    }

    if (this.importRunBtn) {
      this.importRunBtn.disabled = n === 0;
      this.importRunBtn.textContent = 'Import ' + n + (n === 1 ? ' entry' : ' entries');
    }
    if (this.importLoadFormBtn) this.importLoadFormBtn.disabled = n === 0;
  }

  // Is the file about to be read as sessions (one stored group id per ticker+date)?
  // The checkbox is the reader's call and is on by default.
  _importGroupsOn() {
    return !this.importGroupCheck || this.importGroupCheck.checked !== false;
  }

  // "5 rows → 3 sessions · 1 with more than one leg" under the tick box. Always
  // derived from the parsed rows, so the note and the import cannot disagree.
  _renderImportGroups(result) {
    if (!this.importGroupNote) return;
    if (!result || !result.entries.length || !this._importGroupsOn()) {
      this.importGroupNote.textContent = '';
      return;
    }

    const groups = JournalCSV.groupEntries(result.entries);
    const stats = JournalCSV.groupStats(groups);
    const sessionWord = stats.sessions === 1 ? 'session' : 'sessions';
    const sameAsRows = stats.multiLeg === 0;
    this.importGroupNote.textContent = sameAsRows
      ? `${stats.legs} ${stats.legs === 1 ? 'row' : 'rows'} → ${stats.sessions} ${sessionWord} · ` +
        `no ticker and date repeats, so each row stays on its own`
      : `${stats.legs} ${stats.legs === 1 ? 'row' : 'rows'} → ${stats.sessions} ${sessionWord} · ` +
        `${stats.multiLeg} ${stats.multiLeg === 1 ? 'session shares' : 'sessions share'} a ticker and a date`;
  }

  _resetImportPreview() {
    this._importResult = null;
    if (this.importSummary) this.importSummary.textContent = '';
    if (this.importGroupNote) this.importGroupNote.textContent = '';
    if (this.importWarnings) {
      this.importWarnings.style.display = 'none';
      this.importWarnings.innerHTML = '';
    }
    if (this.importPreviewWrap) this.importPreviewWrap.style.display = 'none';
    if (this.importPreviewBody) this.importPreviewBody.innerHTML = '';
    if (this.importRunBtn) {
      this.importRunBtn.disabled = true;
      this.importRunBtn.textContent = 'Import 0 entries';
    }
    if (this.importLoadFormBtn) this.importLoadFormBtn.disabled = true;
  }

  // Write every parsed row as its own journal entry
  async _importEntries() {
    const result = this._importResult || this._readImportText(this.importPaste.value);
    if (!result || !result.entries.length) {
      Utils.showToast('Nothing to import — read the rows first', 'error');
      return;
    }

    const n = result.entries.length;

    // Rows that share a ticker and a date are one session, and get one stored
    // group id between them (see JournalCSV.assignGroupIds). A row that repeats
    // nothing keeps `null`, i.e. "never grouped": it is not a session of one.
    const groupOn = this._importGroupsOn();
    const batch = groupOn
      ? JournalCSV.assignGroupIds(result.entries, { makeId: () => this._newGroupId() })
      : { entries: result.entries, groups: 0, sessions: n };
    const groupNote = (groupOn && batch.groups)
      ? `<br>The rows read as <b>${batch.sessions === 1 ? 'one session' : batch.sessions + ' sessions'}</b>, ` +
        `${batch.groups === 1 ? 'one of them' : batch.groups + ' of them'} sharing a ticker and a date.`
      : '';

    const ok = await this._confirm(
      'Import <b>' + n + '</b> ' + (n === 1 ? 'entry' : 'entries') + ' into the journal?<br>' +
      'Each row becomes its own entry, with the P&amp;L, the duration and the R-multiple computed from its own numbers.' +
      groupNote,
      { okLabel: '📥 Import ' + n, danger: false }
    );
    if (!ok) return;

    this.importRunBtn.disabled = true;
    this.importRunBtn.textContent = 'Importing…';
    const stamp = new Date().toISOString();
    let saved = 0;
    let failed = 0;

    for (let i = 0; i < batch.entries.length; i++) {
      const doc = Object.assign({}, batch.entries[i], { createdAt: stamp });
      try {
        const id = await dataStore.saveJournalEntry(doc, null);
        if (id) saved++; else failed++;
      } catch (e) {
        console.error('[TradeJournal] Import of row ' + (i + 1) + ' failed:', e);
        failed++;
      }
    }

    this.closeImport();
    await this.loadEntries(false);
    const msg = 'Imported ' + saved + (saved === 1 ? ' entry' : ' entries') + (failed ? ' — ' + failed + ' failed' : '');
    Utils.showToast(msg, failed ? 'error' : 'success');
    this._updateSaveStatus(msg);
  }

  // Take one parsed row into the editor so it can be checked before saving
  _loadImportRowIntoForm() {
    const result = this._importResult || this._readImportText(this.importPaste.value);
    if (!result || !result.entries.length) {
      Utils.showToast('Read the rows first', 'error');
      return;
    }

    const entry = result.entries[0];
    this.closeImport();
    this.openEditor(null);
    this._fillForm(entry);

    // The outcome text came from the CSV, not from the user's own typing, so it
    // keeps following the numbers until they edit it themselves
    this._outcomeTouched = false;
    this._updatePnl();
    this._markDirty();
    Utils.showToast('Row 1 loaded into the form — check it, then Save');
  }

  // ==========================================================================
  // DRAFT HELPER — "Draft" in the header (js/journal-draft.js, offline)
  // ==========================================================================
  // Tab 1 writes a guided skeleton from the facts in the form. Tab 2 hands the
  // job to whatever AI chat the user already has: it writes the prompt, shows
  // the exact CSV format, and pipes the answer straight back into Import.
  _bindDraftDialog() {
    if (!this.draftOverlay) return;
    const $ = (id) => document.getElementById(id);

    $('tj-draft-close').addEventListener('click', () => this.closeDraft());
    $('tj-draft-close-foot').addEventListener('click', () => this.closeDraft());
    this.draftOverlay.addEventListener('click', (e) => {
      if (e.target === this.draftOverlay) this.closeDraft();
    });

    this.draftTabs.forEach(tab => tab.addEventListener('click', () => this._switchDraftTab(tab.dataset.draftTab)));

    $('tj-draft-generate').addEventListener('click', () => this._generateDraft());
    $('tj-draft-clear').addEventListener('click', () => {
      Object.keys(this.draftInputs).forEach(k => {
        const el = this.draftInputs[k];
        if (el) el.value = '';
      });
      this._draftResult = null;
      this._renderDraftFields(null);
      this._renderDraftNotes([]);
      this._refreshDraftPrompt();
    });
    this.draftApplyBtn.addEventListener('click', () => this._applyDraft());

    $('tj-draft-copy-prompt').addEventListener('click', () => this._copyDraftPrompt());
    $('tj-draft-refresh-prompt').addEventListener('click', () => this._refreshDraftPrompt());
    $('tj-draft-copy-example').addEventListener('click', () => this._copyDraftExample());
    $('tj-draft-download-example').addEventListener('click', () => this._downloadDraftExample());
    $('tj-draft-to-import').addEventListener('click', () => this._sendDraftToImport());
  }

  openDraft() {
    if (!this.draftOverlay) return;
    this.draftOverlay.style.display = 'flex';
    this._switchDraftTab(this._draftTab || 'skeleton');
    this._refreshDraftPrompt();
  }

  closeDraft() {
    if (this.draftOverlay) this.draftOverlay.style.display = 'none';
  }

  _switchDraftTab(tab) {
    this._draftTab = tab === 'prompt' ? 'prompt' : 'skeleton';
    this.draftTabs.forEach(t => t.classList.toggle('active', t.dataset.draftTab === this._draftTab));
    if (this.draftPanelSkeleton) this.draftPanelSkeleton.style.display = this._draftTab === 'skeleton' ? 'block' : 'none';
    if (this.draftPanelPrompt) this.draftPanelPrompt.style.display = this._draftTab === 'prompt' ? 'block' : 'none';
    if (this._draftTab === 'prompt') this._refreshDraftPrompt();
  }

  // The facts the helper builds from: the form's own values plus whatever was
  // typed in the dialog. Nothing is invented when a field is empty.
  _draftInput() {
    const values = this._readNumberFields();
    const v = this.draftInputs || {};
    const read = (el) => (el ? String(el.value || '').trim() : '');
    const field = (key) => (this._fields[key] ? String(this._fields[key].value || '').trim() : '');
    return Object.assign({}, values, {
      // A size the journal assumed is not a size the user gave, so the helper is
      // told there is none: it says so instead of quoting a fake 1-share result
      shares: this._sharesAssumed ? '' : values.shares,
      ticker: field('ticker'),
      timeframe: field('timeframe'),
      setup: field('setup'),
      category: field('category'),
      processScore: field('processScore'),
      facts: read(v.facts),
      expected: read(v.expected),
      didInstead: read(v.didInstead),
      context: read(v.context),
      stopPrice: read(v.stopPrice)
    });
  }

  _generateDraft() {
    this._draftResult = JournalDraft.build(this._draftInput());

    const notes = this._draftResult.notes.slice();
    if (!this._isEditorOpen()) {
      notes.unshift('The entry editor was closed, so this draft was built from the values left in the form. ' +
        'Apply it to open an entry, and check the ticker, the category and the prices first.');
    }

    this._renderDraftFields(this._draftResult);
    this._renderDraftNotes(notes);
    this._refreshDraftPrompt();
    Utils.showToast(this._draftResult.fields.length + ' fields drafted — untick anything you disagree with');
  }

  // The editor is the only place the draft can write to
  _isEditorOpen() {
    return !!(this.editorOverlay && this.editorOverlay.style.display !== 'none');
  }

  _renderDraftFields(result) {
    if (!this.draftFields) return;
    const fields = (result && result.fields) ? result.fields : [];
    if (!fields.length) {
      this.draftFields.innerHTML = '<div class="tj-muted tj-small">Nothing generated yet.</div>';
      if (this.draftApplyBtn) this.draftApplyBtn.disabled = true;
      return;
    }

    this.draftFields.innerHTML = fields.map(f => {
      const existing = this._fields[f.key] && this._fields[f.key].value.trim();
      const tags = (f.focus ? '<span class="tj-badge tj-badge-ok">most important for this category</span>' : '') +
        (existing ? '<span class="tj-badge tj-muted">the form already has text here</span>' : '');
      return '<div class="tj-draft-field">' +
        '<label class="tj-draft-head">' +
          '<input type="checkbox" data-draft-use="' + JournalText.esc(f.key) + '" checked>' +
          '<b>' + JournalText.esc(f.letter + ' · ' + f.label) + '</b>' + tags +
        '</label>' +
        '<textarea class="tj-input tj-draft-text" data-draft-text="' + JournalText.esc(f.key) + '" rows="4">' +
          JournalText.esc(f.text) +
        '</textarea>' +
        '</div>';
    }).join('');

    if (this.draftApplyBtn) this.draftApplyBtn.disabled = false;
  }

  _renderDraftNotes(notes) {
    if (!this.draftNotes) return;
    const list = notes || [];
    if (!list.length) {
      this.draftNotes.style.display = 'none';
      this.draftNotes.innerHTML = '';
      return;
    }
    this.draftNotes.style.display = 'block';
    this.draftNotes.innerHTML = '<div class="tj-warn-title">What the numbers say</div><ul>' +
      list.map(n => '<li>' + JournalText.esc(n) + '</li>').join('') + '</ul>';
  }

  _applyDraft() {
    if (!this.draftFields) return;

    // Collect first: opening the editor clears the form, so nothing may be
    // written until the editor is up
    const picked = [];
    Array.from(this.draftFields.querySelectorAll('[data-draft-use]')).forEach(box => {
      if (!box.checked) return;
      const key = box.dataset.draftUse;
      const area = this.draftFields.querySelector('[data-draft-text="' + key + '"]');
      const text = area ? String(area.value).trim() : '';
      if (text) picked.push({ key, text });
    });

    if (!picked.length) {
      Utils.showToast('Tick at least one field with text in it', 'error');
      return;
    }

    this.closeDraft();
    if (!this._isEditorOpen()) this.openEditor(null);

    let applied = 0;
    let overwritten = 0;
    picked.forEach(item => {
      const el = this._fields[item.key];
      if (!el) return;
      if (el.value.trim()) overwritten++;
      el.value = item.text;
      applied++;
    });

    this._markDirty();
    this._updatePnl();
    Utils.showToast('Applied ' + applied + (applied === 1 ? ' field' : ' fields') +
      (overwritten ? ' — ' + overwritten + ' replaced existing text' : ''));
  }

  // ---- Tab 2: the prompt and the round trip through the user's own AI ----
  _refreshDraftPrompt() {
    if (!this.draftPromptBox) return;
    try {
      this.draftPromptBox.value = JournalDraft.prompt(this._draftInput());
    } catch (e) {
      console.error('[TradeJournal] Could not build the draft prompt:', e);
      this.draftPromptBox.value = 'Could not build the prompt — see the console.';
    }
  }

  async _copyDraftPrompt() {
    this._refreshDraftPrompt();
    const ok = await Utils.copyToClipboard(this.draftPromptBox.value);
    Utils.showToast(ok ? 'Prompt copied — paste it into your chat' : 'Could not copy the prompt', ok ? 'success' : 'error');
  }

  async _copyDraftExample() {
    const ok = await Utils.copyToClipboard(JournalCSV.buildExample());
    Utils.showToast(ok ? 'Example CSV copied' : 'Could not copy — use Download instead', ok ? 'success' : 'error');
  }

  _downloadDraftExample() {
    const name = JournalCSV.downloadExample();
    Utils.showToast('Example CSV downloaded: ' + name);
  }

  // The answer from the chat comes back in through the same paste box the CSV
  // import uses, so the letters are read by exactly the same parser
  _sendDraftToImport() {
    const text = this.draftAnswerBox ? this.draftAnswerBox.value.trim() : '';
    if (!text) {
      Utils.showToast('Paste the CSV your chat wrote back first', 'error');
      return;
    }
    this.openImport(text);
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

    // The numbers behind the trade (timing + prices are the visible section)
    set('direction', 'long');
    set('entryDate', Utils.todayLocal());
    set('entryTime', '09:41');
    set('entryPrice', '178.40');
    set('exitDate', Utils.todayLocal());
    set('exitTime', '09:47');
    set('exitPrice', '177.55');
    set('shares', '120');
    set('fees', '2.10');
    set('plannedRiskR', '150');
    set('strategy', 'ORB — momentum continuation');
    this._lastEntryDate = Utils.todayLocal();

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
