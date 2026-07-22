// ============================================================================
// TRADE REVIEWS — Rich text editor with Quill.js, image upload, export
// ============================================================================

class TradeReviewManager {
  constructor() {
    this._reviews = [];
    this._currentReviewId = null;
    this._quill = null;
    this._currentSentiment = null;
    this._currentTags = [];
    this._saveTimer = null;
    this._isDirty = false;

    // DOM refs
    this.container = document.getElementById('trade-reviews-container');
    this.grid = document.getElementById('trade-reviews-grid');
    this.searchInput = document.getElementById('trade-reviews-search');
    this.filterSentiment = document.getElementById('trade-reviews-filter-sentiment');
    this.btnNewReview = document.getElementById('btn-new-review');
    this.btnExportCsv = document.getElementById('btn-export-reviews-csv');
    this.btnExportZip = document.getElementById('btn-export-reviews-zip');

    // Editor overlay refs
    this.editorOverlay = document.getElementById('trade-review-editor-overlay');
    this.editorTitle = document.getElementById('trade-review-title');
    this.editorDate = document.getElementById('trade-review-date');
    this.editorSymbol = document.getElementById('trade-review-symbol-link');
    this.editorSymbolSuggestions = document.getElementById('trade-review-symbol-suggestions');
    this.editorSaveStatus = document.getElementById('trade-review-save-status');
    this.editorClose = document.getElementById('trade-review-close');
    this.editorSave = document.getElementById('trade-review-save');
    this.editorDelete = document.getElementById('trade-review-delete');
    this.quillContainer = document.getElementById('trade-review-quill-editor');

    // Sentiment buttons
    this.sentimentBullish = document.getElementById('tr-sentiment-bullish');
    this.sentimentNeutral = document.getElementById('tr-sentiment-neutral');
    this.sentimentBearish = document.getElementById('tr-sentiment-bearish');

    // Tags
    this.tagsInput = document.getElementById('trade-review-tags');
    this.tagChips = document.getElementById('trade-review-tag-chips');

    // Trade data
    this.tradeDataSection = document.getElementById('trade-review-trade-data');
    this.trDirection = document.getElementById('tr-trade-direction');
    this.trEntry = document.getElementById('tr-trade-entry');
    this.trExit = document.getElementById('tr-trade-exit');
    this.trShares = document.getElementById('tr-trade-shares');
    this.trStrategy = document.getElementById('tr-trade-strategy');
    this.trEntryTime = document.getElementById('tr-trade-entry-time');
    this.trExitTime = document.getElementById('tr-trade-exit-time');
    this.trPnl = document.getElementById('tr-trade-pnl');

    this._init();
  }

  // ---- Initialize ----
  async _init() {
    // Init Quill editor
    this._initQuill();

    // Bind events
    this._bindEvents();

    // Set default date to today
    this.editorDate.value = new Date().toISOString().split('T')[0];
  }

  // ---- Quill Editor Setup ----
  _initQuill() {
    if (typeof Quill === 'undefined') {
      console.warn('[TradeReviews] Quill not loaded — rich text editor unavailable');
      return;
    }

    this._quill = new Quill(this.quillContainer, {
      theme: 'snow',
      placeholder: 'Write your trade review here... Paste images with Ctrl+V',
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
        clipboard: {
          matchVisual: false
        }
      }
    });

    // Handle image paste via custom handler — upload to Firebase Storage
    this._quill.root.addEventListener('paste', (e) => {
      this._handlePaste(e);
    });

    // Track changes for auto-save
    this._quill.on('text-change', () => {
      this._markDirty();
    });
  }

  // ---- Handle paste for image upload (Firebase Storage only) ----
  async _handlePaste(e) {
    const clipboardData = e.clipboardData || window.clipboardData;
    if (!clipboardData || !clipboardData.items) return;

    const items = clipboardData.items;
    for (let i = 0; i < items.length; i++) {
      const item = items[i];

      if (item.type.startsWith('image/')) {
        e.preventDefault();
        e.stopPropagation();

        const blob = item.getAsFile();
        if (!blob) continue;

        // Ensure we have a review ID for uploading
        if (!this._currentReviewId) {
          this._currentReviewId = 'temp_' + Date.now();
        }

        try {
          // Show uploading indicator
          const range = this._quill.getSelection(true);
          this._quill.insertText(range.index, '[Uploading image to cloud...]', { color: '#888' });
          const uploadIndex = range.index;
          const uploadLength = 28;

          // Upload to Firebase Storage — must succeed
          const downloadUrl = await imageStorage.uploadImage(blob, this._currentReviewId);

          if (!downloadUrl || downloadUrl.startsWith('data:')) {
            throw new Error('Upload returned a data URI instead of Storage URL');
          }

          // Remove the placeholder text and insert the image
          this._quill.deleteText(uploadIndex, uploadLength);
          this._quill.insertEmbed(uploadIndex, 'image', downloadUrl);
          this._quill.setSelection(uploadIndex + 1);

          this._markDirty();
        } catch (err) {
          console.error('[TradeReviews] Image upload failed:', err.message || err);
          // Remove placeholder text
          try {
            const range = this._quill.getSelection(true);
            if (range && range.length >= 27) {
              this._quill.deleteText(range.index - 27, 28);
            }
          } catch (e2) { /* ignore */ }
          Utils.showToast('Image upload failed — check Firebase Storage is enabled and CORS is configured');
        }
        break;
      }
    }
  }

  // ---- Bind Events ----
  _bindEvents() {
    // Toggle to reviews view is handled by app.js via btn-trade-reviews click

    // New review button
    this.btnNewReview.addEventListener('click', () => this.openEditor(null));

    // Search
    this.searchInput.addEventListener('input', () => this._renderReviewCards());
    this.filterSentiment.addEventListener('change', () => this._renderReviewCards());

    // Export
    this.btnExportCsv.addEventListener('click', () => this._exportCSV());
    this.btnExportZip.addEventListener('click', () => this._exportMarkdownZip());

    // Editor overlay
    this.editorClose.addEventListener('click', () => this.closeEditor());
    this.editorSave.addEventListener('click', () => this._doSave());
    this.editorDelete.addEventListener('click', () => this._doDelete());

    // Close overlay on background click
    this.editorOverlay.addEventListener('click', (e) => {
      if (e.target === this.editorOverlay) this.closeEditor();
    });

    // Sentiment buttons
    this.sentimentBullish.addEventListener('click', () => this._setSentiment('bullish'));
    this.sentimentNeutral.addEventListener('click', () => this._setSentiment('neutral'));
    this.sentimentBearish.addEventListener('click', () => this._setSentiment('bearish'));

    // Tags input
    this.tagsInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const value = this.tagsInput.value.trim();
        if (value && !this._currentTags.includes(value)) {
          this._currentTags.push(value);
          this._renderTagChips();
          this._markDirty();
        }
        this.tagsInput.value = '';
      }
    });

    // Trade data — auto-calc P&L
    [this.trEntry, this.trExit, this.trShares].forEach(el => {
      el.addEventListener('input', () => this._updatePnl());
    });

    // Symbol input — populate suggestions from watchlist
    this.editorSymbol.addEventListener('focus', () => this._populateSymbolSuggestions());

    // Auto-save on title change
    this.editorTitle.addEventListener('input', () => this._markDirty());
    this.editorDate.addEventListener('input', () => this._markDirty());
    this.editorSymbol.addEventListener('input', () => this._markDirty());
  }

  // ---- Setup auto-save polling (call after data loaded) ----
  _startAutoSave() {
    setInterval(() => this._autoSaveIfDirty(), 5000);
  }

  _markDirty() {
    this._isDirty = true;
    this._updateSaveStatus('Unsaved changes');
  }

  async _autoSaveIfDirty() {
    if (!this._isDirty || !this.editorOverlay.style.display || this.editorOverlay.style.display === 'none') return;
    if (!this._currentReviewId && !this.editorTitle.value.trim()) return;

    await this._doSave(true); // silent save
  }

  _updateSaveStatus(msg) {
    this.editorSaveStatus.textContent = msg || '';
  }

  // ---- Set sentiment ----
  _setSentiment(sentiment) {
    this._currentSentiment = sentiment;
    this.sentimentBullish.classList.toggle('active', sentiment === 'bullish');
    this.sentimentNeutral.classList.toggle('active', sentiment === 'neutral');
    this.sentimentBearish.classList.toggle('active', sentiment === 'bearish');
    this._markDirty();
  }

  // ---- Tag Chips ----
  _renderTagChips() {
    this.tagChips.innerHTML = this._currentTags.map(tag =>
      `<span class="tag-chip">
        ${Utils.escapeAttr(tag)}
        <button class="tag-chip-remove" data-tag="${Utils.escapeAttr(tag)}" title="Remove tag">&times;</button>
      </span>`
    ).join('');

    this.tagChips.querySelectorAll('.tag-chip-remove').forEach(btn => {
      btn.addEventListener('click', () => {
        this._currentTags = this._currentTags.filter(t => t !== btn.dataset.tag);
        this._renderTagChips();
        this._markDirty();
      });
    });
  }

  // ---- Symbol Suggestions ----
  _populateSymbolSuggestions() {
    // Get symbols from the main app's entries if available
    let symbols = [];
    if (window._app && window._app.entries) {
      symbols = [...new Set(window._app.entries.map(e => e.symbol).filter(Boolean))];
    }
    this.editorSymbolSuggestions.innerHTML = symbols.map(s =>
      `<option value="${Utils.escapeAttr(s)}">`
    ).join('');
  }

  // ---- P&L Calculation ----
  _updatePnl() {
    const entry = parseFloat(this.trEntry.value);
    const exit = parseFloat(this.trExit.value);
    const shares = parseInt(this.trShares.value);
    const direction = this.trDirection.value;

    if (isNaN(entry) || isNaN(exit) || isNaN(shares) || entry === 0) {
      this.trPnl.textContent = '—';
      this.trPnl.className = 'trade-review-pnl-value';
      return;
    }

    let pnl;
    if (direction === 'long') {
      pnl = (exit - entry) * shares;
    } else {
      pnl = (entry - exit) * shares;
    }

    const pnlPercent = ((pnl / (entry * shares)) * 100);

    const formattedPnl = Utils.formatCurrency(pnl);
    const formattedPct = Utils.formatPercent(pnlPercent);

    this.trPnl.textContent = `${formattedPnl} (${formattedPct})`;
    this.trPnl.className = 'trade-review-pnl-value ' + (pnl >= 0 ? 'positive' : 'negative');
  }

  // ---- Open Editor ----
  async openEditor(reviewId, prefillData = null) {
    this._currentReviewId = reviewId;
    this._currentSentiment = null;
    this._currentTags = [];

    // Show overlay
    this.editorOverlay.style.display = 'flex';

    // Clear all sentiment buttons
    this.sentimentBullish.classList.remove('active');
    this.sentimentNeutral.classList.remove('active');
    this.sentimentBearish.classList.remove('active');

    // Reset form
    this.editorTitle.value = '';
    this.editorDate.value = new Date().toISOString().split('T')[0];
    this.editorSymbol.value = '';
    this.tagsInput.value = '';
    this._renderTagChips();

    // Reset trade data
    this.tradeDataSection.style.display = 'none';
    this.trDirection.value = 'long';
    this.trEntry.value = '';
    this.trExit.value = '';
    this.trShares.value = '';
    this.trStrategy.value = '';
    this.trEntryTime.value = '';
    this.trExitTime.value = '';
    this.trPnl.textContent = '—';
    this.trPnl.className = 'trade-review-pnl-value';

    // Clear Quill
    if (this._quill) {
      this._quill.setContents([]);
      this._quill.enable();
    }

    // If loading existing review
    if (reviewId) {
      const review = await dataStore.getTradeReview(reviewId);
      if (review) {
        this.editorTitle.value = review.title || '';
        this.editorDate.value = review.date || '';
        this.editorSymbol.value = review.symbol || '';

        if (review.sentiment) {
          this._setSentiment(review.sentiment);
        }

        if (review.tags && review.tags.length) {
          this._currentTags = [...review.tags];
          this._renderTagChips();
        }

        // Load Quill content
        if (this._quill && review.content) {
          try {
            this._quill.setContents(review.content);
          } catch (e) {
            // If delta parsing fails, try as plain text
            console.warn('[TradeReviews] Failed to parse Quill delta, trying HTML fallback');
            if (review.contentPlain) {
              this._quill.setText(review.contentPlain);
            }
          }
        }

        // Load trade data
        if (review.tradeData) {
          this.tradeDataSection.style.display = 'block';
          this.trDirection.value = review.tradeData.direction || 'long';
          this.trEntry.value = review.tradeData.entryPrice || '';
          this.trExit.value = review.tradeData.exitPrice || '';
          this.trShares.value = review.tradeData.shares || '';
          this.trStrategy.value = review.tradeData.strategy || '';
          this.trEntryTime.value = review.tradeData.entryTime || '';
          this.trExitTime.value = review.tradeData.exitTime || '';
          this._updatePnl();
        }
      }
    }

    // Apply prefill data (from watchlist link)
    if (prefillData) {
      if (prefillData.symbol) this.editorSymbol.value = prefillData.symbol;
      if (prefillData.tradeData) {
        this.tradeDataSection.style.display = 'block';
        if (prefillData.tradeData.direction) this.trDirection.value = prefillData.tradeData.direction;
        if (prefillData.tradeData.entryPrice != null) this.trEntry.value = prefillData.tradeData.entryPrice;
        if (prefillData.tradeData.exitPrice != null) this.trExit.value = prefillData.tradeData.exitPrice;
        if (prefillData.tradeData.shares != null) this.trShares.value = prefillData.tradeData.shares;
        if (prefillData.tradeData.strategy) this.trStrategy.value = prefillData.tradeData.strategy;
        if (prefillData.tradeData.entryTime) this.trEntryTime.value = prefillData.tradeData.entryTime;
        if (prefillData.tradeData.exitTime) this.trExitTime.value = prefillData.tradeData.exitTime;
        if (prefillData.watchlistEntryId) this._prefillWatchlistEntryId = prefillData.watchlistEntryId;
        this._updatePnl();
      }
    }

    this._isDirty = false;
    this._updateSaveStatus('');
    this.editorTitle.focus();
  }

  // ---- Close Editor ----
  async closeEditor() {
    // Don't auto-save if a delete is in progress
    if (this._isDeleting) return;

    // Auto-save if dirty and wait for it to complete before refreshing
    if (this._isDirty && (this.editorTitle.value.trim() || this._currentReviewId)) {
      await this._doSave(true);
    }

    this.editorOverlay.style.display = 'none';
    this._currentReviewId = null;
    this._prefillWatchlistEntryId = null;
    this._isDirty = false;
    this._updateSaveStatus('');
    // Re-fetch from Firestore to pick up the newly saved review
    await this.loadAndRender();
  }

  // ---- Save Review ----
  async _doSave(silent = false) {
    const title = this.editorTitle.value.trim();

    // Don't save empty reviews (no title and no content)
    if (!title && !this._currentReviewId) {
      if (!silent) Utils.showToast('Please enter a title before saving');
      return;
    }

    // Get Quill content — serialize Delta to plain JSON for Firestore
    let content = null;
    let contentPlain = '';
    if (this._quill) {
      const rawDelta = this._quill.getContents();
      // Quill Delta is a custom class — strip to plain object for Firestore
      content = rawDelta ? JSON.parse(JSON.stringify(rawDelta)) : null;
      contentPlain = this._quill.getText().trim().substring(0, 5000);
    }

    // Build trade data object
    let tradeData = null;
    if (this.tradeDataSection.style.display !== 'none') {
      const entryPrice = parseFloat(this.trEntry.value);
      const exitPrice = parseFloat(this.trExit.value);
      const shares = parseInt(this.trShares.value);
      const direction = this.trDirection.value;

      let pnl = null;
      let pnlPercent = null;
      if (!isNaN(entryPrice) && !isNaN(exitPrice) && !isNaN(shares) && entryPrice !== 0) {
        pnl = direction === 'long'
          ? (exitPrice - entryPrice) * shares
          : (entryPrice - exitPrice) * shares;
        pnlPercent = (pnl / (entryPrice * shares)) * 100;
      }

      tradeData = {
        direction,
        entryPrice: isNaN(entryPrice) ? null : entryPrice,
        exitPrice: isNaN(exitPrice) ? null : exitPrice,
        shares: isNaN(shares) ? null : shares,
        strategy: this.trStrategy.value.trim() || null,
        entryTime: this.trEntryTime.value || null,
        exitTime: this.trExitTime.value || null,
        pnl,
        pnlPercent
      };
    }

    // Build doc
    const doc = {
      title,
      date: this.editorDate.value || null,
      symbol: this.editorSymbol.value.trim().toUpperCase() || null,
      sentiment: this._currentSentiment,
      tags: this._currentTags.length ? [...this._currentTags] : [],
      tradeData,
      content,
      contentPlain,
      watchlistEntryId: this._prefillWatchlistEntryId || null
    };

    try {
      const savedId = await dataStore.saveTradeReview(this._currentReviewId, doc);

      if (!this._currentReviewId) {
        this._currentReviewId = savedId;
      }

      this._isDirty = false;
      this._updateSaveStatus('Saved ✅');
      if (!silent) Utils.showToast('Review saved');

      // Re-fetch from Firestore to keep grid in sync
      await this.loadAndRender();

    } catch (e) {
      console.error('[TradeReviews] Save failed:', e);
      this._updateSaveStatus('Save failed ❌');
      if (!silent) Utils.showToast('Failed to save review');
    }
  }

  // ---- Delete Review ----
  async _doDelete() {
    const reviewId = this._currentReviewId;

    // Show confirm dialog ABOVE the editor overlay
    const confirmed = await this._confirmDelete();
    if (!confirmed) return;

    // Set flag to prevent closeEditor auto-save from interfering
    this._isDeleting = true;

    try {
      // Delete images and Firestore doc (only if review was ever saved)
      if (reviewId && !reviewId.startsWith('temp_')) {
        await imageStorage.deleteReviewImages(reviewId);
        await dataStore.deleteTradeReview(reviewId);
      }

      // Immediately remove from local array so grid reflects the deletion
      this._reviews = this._reviews.filter(r => r.id !== reviewId);

      Utils.showToast('Review deleted');
    } catch (e) {
      console.error('[TradeReviews] Delete failed:', e);
      // Even on error, remove from local array so it disappears from grid
      this._reviews = this._reviews.filter(r => r.id !== reviewId);
      Utils.showToast('Failed to delete review');
      this._isDeleting = false;
      return;
    }

    // Close editor only after successful delete
    this.editorOverlay.style.display = 'none';
    this._currentReviewId = null;
    this._isDirty = false;
    this._isDeleting = false;

    // Re-render from local array (already spliced) to avoid Firestore cache staleness
    this._renderReviewCards();
  }

  // ---- Confirm Delete (shown above editor at z-index 11000) ----
  _confirmDelete() {
    return new Promise((resolve) => {
      document.querySelector('.confirm-overlay')?.remove();

      const overlay = document.createElement('div');
      overlay.className = 'confirm-overlay';
      overlay.style.cssText = 'position:fixed; top:0; left:0; width:100%; height:100%; z-index:11000; display:flex; align-items:center; justify-content:center;';
      overlay.innerHTML = `
        <div class="confirm-box">
          <div class="confirm-icon">⚠️</div>
          <h3>Delete this trade review?</h3>
          <p class="confirm-warning">This cannot be undone. The review and its images will be permanently deleted.</p>
          <div class="confirm-buttons">
            <button class="btn btn-secondary confirm-cancel">Cancel</button>
            <button class="btn btn-danger confirm-delete">Delete</button>
          </div>
        </div>
      `;

      document.body.appendChild(overlay);

      overlay.querySelector('.confirm-cancel').addEventListener('click', () => {
        overlay.remove();
        resolve(false);
      });

      overlay.querySelector('.confirm-delete').addEventListener('click', () => {
        overlay.remove();
        resolve(true);
      });

      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) {
          overlay.remove();
          resolve(false);
        }
      });
    });
  }

  // ---- Load reviews and render cards ----
  async loadAndRender() {
    this._reviews = await dataStore.getAllTradeReviews();
    this._renderReviewCards();
  }

  _renderReviewCards() {
    // Apply filters
    let filtered = [...this._reviews];
    const search = (this.searchInput.value || '').toLowerCase();
    const sentimentFilter = this.filterSentiment.value;

    if (search) {
      filtered = filtered.filter(r =>
        (r.title && r.title.toLowerCase().includes(search)) ||
        (r.symbol && r.symbol.toLowerCase().includes(search)) ||
        (r.contentPlain && r.contentPlain.toLowerCase().includes(search)) ||
        (r.tags && r.tags.some(t => t.toLowerCase().includes(search)))
      );
    }

    if (sentimentFilter) {
      filtered = filtered.filter(r => r.sentiment === sentimentFilter);
    }

    if (filtered.length === 0) {
      this.grid.innerHTML = `
        <div class="trade-reviews-empty">
          <div class="empty-icon">📝</div>
          <div>${this._reviews.length === 0 ? 'No trade reviews yet. Click "New Review" to create one.' : 'No reviews match your filters.'}</div>
        </div>
      `;
      return;
    }

    this.grid.innerHTML = filtered.map(review => this._renderCard(review)).join('');

    // Bind card click events
    this.grid.querySelectorAll('.trade-review-card').forEach(card => {
      card.addEventListener('click', (e) => {
        // Don't open if clicking a button/link
        if (e.target.closest('button') || e.target.closest('a')) return;
        this.openEditor(card.dataset.id);
      });
    });
  }

  _renderCard(review) {
    const sentimentBadge = review.sentiment
      ? `<span class="tr-card-sentiment ${review.sentiment}">${{ bullish: 'Bullish', neutral: 'Neutral', bearish: 'Bearish' }[review.sentiment]}</span>`
      : '';

    const symbolBadge = review.symbol
      ? `<span class="tr-card-symbol">${Utils.escapeAttr(review.symbol)}</span>`
      : '';

    // P&L display
    let pnlHtml = '';
    if (review.tradeData && review.tradeData.pnl != null) {
      const pnlClass = review.tradeData.pnl >= 0 ? 'positive' : 'negative';
      pnlHtml = `<span class="tr-card-pnl ${pnlClass}">${Utils.formatCurrency(review.tradeData.pnl)}</span>`;
    }

    // Image thumbnail — extract first image from Quill delta
    let thumbnailHtml = '';
    if (review.content && review.content.ops) {
      for (const op of review.content.ops) {
        if (op.insert && op.insert.image) {
          thumbnailHtml = `<div class="tr-card-thumb"><img src="${op.insert.image}" alt="Review image" loading="lazy"></div>`;
          break;
        }
      }
    }

    // Preview text
    const preview = (review.contentPlain || review.title || '').substring(0, 150);

    // Tags
    const tagsHtml = (review.tags && review.tags.length)
      ? `<div class="tr-card-tags">${review.tags.map(t => `<span class="tag-badge-sm">${Utils.escapeAttr(t)}</span>`).join('')}</div>`
      : '';

    // Date
    const dateDisplay = review.date
      ? Utils.formatESTDateOnly(new Date(review.date + 'T12:00:00'))
      : 'No date';

    return `
      <div class="trade-review-card" data-id="${review.id}">
        ${thumbnailHtml}
        <div class="tr-card-body">
          <div class="tr-card-header">
            <span class="tr-card-date">${dateDisplay}</span>
            ${sentimentBadge}
            ${symbolBadge}
            ${pnlHtml}
          </div>
          <h3 class="tr-card-title">${Utils.escapeAttr(review.title || 'Untitled Review')}</h3>
          <p class="tr-card-preview">${Utils.escapeAttr(preview)}</p>
          ${tagsHtml}
        </div>
      </div>
    `;
  }

  // ---- Export: CSV (P&L data only) ----
  _exportCSV() {
    const reviewsWithTrades = this._reviews.filter(r => r.tradeData && r.tradeData.pnl != null);

    if (reviewsWithTrades.length === 0) {
      Utils.showToast('No reviews with trade data to export');
      return;
    }

    const headers = ['Date', 'Symbol', 'Title', 'Direction', 'Entry Price', 'Exit Price', 'Shares', 'P&L', 'P&L %', 'Strategy', 'Sentiment', 'Tags'];
    const rows = reviewsWithTrades.map(r => [
      r.date || '',
      r.symbol || '',
      (r.title || '').replace(/"/g, '""'),
      r.tradeData.direction || '',
      r.tradeData.entryPrice != null ? r.tradeData.entryPrice : '',
      r.tradeData.exitPrice != null ? r.tradeData.exitPrice : '',
      r.tradeData.shares != null ? r.tradeData.shares : '',
      r.tradeData.pnl != null ? r.tradeData.pnl.toFixed(2) : '',
      r.tradeData.pnlPercent != null ? r.tradeData.pnlPercent.toFixed(2) + '%' : '',
      (r.tradeData.strategy || '').replace(/"/g, '""'),
      r.sentiment || '',
      (r.tags || []).join(';')
    ]);

    const csvContent = [headers.join(','), ...rows.map(row => '"' + row.join('","') + '"')].join('\n');

    Utils.downloadBlob(csvContent, 'trade_reviews_pnl.csv', 'text/csv');
    Utils.showToast(`Exported ${reviewsWithTrades.length} trade records`);
  }

  // ---- Export: Markdown + Images ZIP ----
  async _exportMarkdownZip() {
    if (this._reviews.length === 0) {
      Utils.showToast('No reviews to export');
      return;
    }

    if (typeof JSZip === 'undefined') {
      Utils.showToast('JSZip not loaded — cannot create ZIP');
      return;
    }

    try {
      const zip = new JSZip();
      const imageCache = new Map(); // url → blob
      let imageIndex = 0;
      const imageMap = new Map(); // url → filename

      for (const review of this._reviews) {
        // Convert Quill delta to Markdown
        let markdown = '';
        markdown += `# ${review.title || 'Untitled Review'}\n\n`;
        markdown += `**Date:** ${review.date || 'N/A'}\n`;
        if (review.symbol) markdown += `**Symbol:** ${review.symbol}\n`;
        if (review.sentiment) markdown += `**Sentiment:** ${review.sentiment}\n`;
        if (review.tags && review.tags.length) markdown += `**Tags:** ${review.tags.join(', ')}\n`;

        // Trade data
        if (review.tradeData && review.tradeData.pnl != null) {
          markdown += `\n## Trade Data\n\n`;
          markdown += `- **Direction:** ${review.tradeData.direction}\n`;
          markdown += `- **Entry:** ${Utils.formatCurrency(review.tradeData.entryPrice)}\n`;
          markdown += `- **Exit:** ${Utils.formatCurrency(review.tradeData.exitPrice)}\n`;
          markdown += `- **Shares:** ${review.tradeData.shares}\n`;
          markdown += `- **P&L:** ${Utils.formatCurrency(review.tradeData.pnl)} (${review.tradeData.pnlPercent != null ? review.tradeData.pnlPercent.toFixed(2) + '%' : '—'})\n`;
          if (review.tradeData.strategy) markdown += `- **Strategy:** ${review.tradeData.strategy}\n`;
        }

        markdown += `\n---\n\n`;

        // Convert Quill delta to Markdown text
        if (review.content && review.content.ops) {
          let inList = false;
          let listType = null;

          for (const op of review.content.ops) {
            if (!op.insert) continue;

            if (typeof op.insert === 'string') {
              const text = op.insert;
              const attrs = op.attributes || {};

              // Handle images (extracted above)
              // Handle line breaks
              if (text === '\n') {
                if (inList && (!attrs || !attrs.list)) {
                  markdown += '\n';
                  inList = false;
                  listType = null;
                }
                markdown += '\n';
                continue;
              }

              let formatted = text;

              // Headers
              if (attrs.header === 1) formatted = `# ${text}`;
              else if (attrs.header === 2) formatted = `## ${text}`;
              else if (attrs.header === 3) formatted = `### ${text}`;

              // Bold/Italic
              if (attrs.bold && attrs.italic) formatted = `***${text}***`;
              else if (attrs.bold) formatted = `**${text}**`;
              else if (attrs.italic) formatted = `*${text}*`;

              // Underline (Markdown doesn't support, use <u>)
              if (attrs.underline) formatted = `<u>${formatted}</u>`;

              // Strike
              if (attrs.strike) formatted = `~~${formatted}~~`;

              // Code
              if (attrs.code) formatted = '`' + text + '`';

              // Links
              if (attrs.link) formatted = `[${text}](${attrs.link})`;

              // Lists
              if (attrs.list === 'bullet') {
                if (!inList || listType !== 'bullet') {
                  inList = true;
                  listType = 'bullet';
                }
                formatted = `- ${formatted}`;
              } else if (attrs.list === 'ordered') {
                if (!inList || listType !== 'ordered') {
                  inList = true;
                  listType = 'ordered';
                }
                formatted = `1. ${formatted}`;
              }

              // Blockquote
              if (attrs.blockquote) formatted = `> ${formatted}`;

              markdown += formatted;
            } else if (op.insert.image) {
              // Collect image for ZIP
              const imgUrl = op.insert.image;
              if (!imageMap.has(imgUrl)) {
                imageIndex++;
                const ext = imgUrl.includes('firebasestorage') ? '.jpg' : '.png';
                const filename = `images/img_${String(imageIndex).padStart(3, '0')}${ext}`;
                imageMap.set(imgUrl, filename);
              }
              const imgFilename = imageMap.get(imgUrl);
              markdown += `![image](./${imgFilename})`;
            }
          }
        }

        markdown += `\n\n`;

        // Add review to zip
        const safeTitle = (review.title || 'untitled').replace(/[^a-zA-Z0-9-_ ]/g, '').trim() || 'untitled';
        const filename = `review_${safeTitle.substring(0, 40)}.md`;
        zip.file(filename, markdown);
      }

      // Add images folder
      if (imageMap.size > 0) {
        const imgFolder = zip.folder('images');
        for (const [url, filename] of imageMap) {
          const blob = await imageStorage.downloadImageAsBlob(url);
          if (blob) {
            imgFolder.file(filename, blob);
          }
        }
      }

      // Generate ZIP
      const zipBlob = await zip.generateAsync({ type: 'blob' });
      const timestamp = new Date().toISOString().split('T')[0];
      Utils.downloadBlob(zipBlob, `trade_reviews_${timestamp}.zip`, 'application/zip');
      Utils.showToast(`Exported ${this._reviews.length} reviews as Markdown + ZIP`);
    } catch (e) {
      console.error('[TradeReviews] ZIP export failed:', e);
      Utils.showToast('Failed to export ZIP');
    }
  }

  // ---- Show/hide the reviews view ----
  show() {
    this.container.style.display = 'block';
    // Hide watchlist table
    const tableWrapper = document.querySelector('.table-wrapper');
    if (tableWrapper) tableWrapper.style.display = 'none';
    // Hide add stock section
    const addSection = document.getElementById('add-stock-section');
    if (addSection) addSection.style.display = 'none';
    // Hide daily notes panel
    const notesPanel = document.getElementById('daily-notes-panel');
    if (notesPanel) notesPanel.style.display = 'none';

    this.loadAndRender();
  }

  hide() {
    this.container.style.display = 'none';
    // Show watchlist table
    const tableWrapper = document.querySelector('.table-wrapper');
    if (tableWrapper) tableWrapper.style.display = '';
    // Show add stock section
    const addSection = document.getElementById('add-stock-section');
    if (addSection) addSection.style.display = '';
  }

  // ---- Get review count for a watchlist entry ----
  async getReviewCountForEntry(watchlistEntryId) {
    return dataStore.getTradeReviewCountForEntry(watchlistEntryId);
  }
}

// Global singleton
const tradeReviewManager = new TradeReviewManager();