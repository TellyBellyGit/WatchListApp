// ============================================================================
// DATA STORE — Firebase Firestore (primary) with localStorage fallback
// ============================================================================
// Firebase is the primary data store. The app pre-initializes Firebase from
// hardcoded config in firebase-config.js. No auth required — Firestore rules
// allow open read/write access. localStorage is used only as an offline cache.
// ============================================================================

class DataStore {
  constructor() {
    this.db = null;          // Firestore instance (if connected)
    this.collectionName = 'watchlist';
    this.mode = 'local';     // 'local' | 'firestore'
    this._initPromise = null;
  }

  // ---- Initialize ----
  async init() {
    if (this._initPromise) return this._initPromise;

    this._initPromise = this._doInit();
    return this._initPromise;
  }

  async _doInit() {
    // Firebase is always configured — no optional flag needed
    const fbConfig = window.FIREBASE_CONFIG;
    if (!fbConfig || !fbConfig.apiKey || fbConfig.apiKey === 'YOUR_FIREBASE_API_KEY') {
      console.warn('[DataStore] Firebase not configured — using localStorage only');
      this.mode = 'local';
      return false;
    }

    if (typeof firebase === 'undefined') {
      console.warn('[DataStore] Firebase SDK not loaded — using localStorage only');
      this.mode = 'local';
      return false;
    }

    try {
      if (!firebase.apps.length) {
        firebase.initializeApp(fbConfig);
      }
      this.db = firebase.firestore();

      // Enable offline persistence for seamless local/cloud sync
      try {
        await this.db.enablePersistence({ synchronizeTabs: true });
        console.log('[DataStore] Offline persistence enabled');
      } catch (e) {
        if (e.code === 'failed-precondition') {
          console.warn('[DataStore] Offline persistence failed (multiple tabs) — continuing with online-only');
        } else if (e.code === 'unimplemented') {
          console.warn('[DataStore] Offline persistence not supported in this browser');
        } else {
          console.warn('[DataStore] Offline persistence error:', e.message);
        }
      }

      // Quick connectivity test
      await this.db.collection(this.collectionName).limit(1).get();
      this.mode = 'firestore';
      console.log('[DataStore] ✅ Connected to Firestore (cloud sync active)');

      // Migrate any existing localStorage data to Firestore on first connect
      await this._migrateLocalToCloud();

      return true;
    } catch (e) {
      console.warn('[DataStore] Firestore connection failed, using localStorage fallback:', e.message);
      this.mode = 'local';
      return false;
    }
  }

  // ---- Migrate existing localStorage entries to Firestore ----
  async _migrateLocalToCloud() {
    if (this.mode !== 'firestore') return;

    const localEntries = this._getLocal();
    if (localEntries.length === 0) return;

    try {
      const existingIds = new Set();
      const snapshot = await this.db.collection(this.collectionName).get();
      snapshot.forEach(doc => existingIds.add(doc.id));

      let migrated = 0;
      for (const entry of localEntries) {
        const id = entry.id || ('local_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5));
        if (!existingIds.has(id)) {
          const { id: _id, ...data } = entry;
          await this.db.collection(this.collectionName).doc(id).set(data);
          migrated++;
        }
      }

      if (migrated > 0) {
        console.log(`[DataStore] Migrated ${migrated} entries from localStorage to Firestore`);
        // Clear localStorage after successful migration
        localStorage.removeItem('stockwatchlist_data');
      }
    } catch (e) {
      console.warn('[DataStore] Migration failed:', e.message);
    }
  }

  // ---- Ensure init is complete before any operation ----
  async _ensureInit() {
    if (this._initPromise) {
      await this._initPromise;
    }
  }

  // ---- CRUD: Create ----
  async addEntry(entry) {
    await this._ensureInit();
    const doc = {
      ...entry,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    if (this.mode === 'firestore') {
      const ref = await this.db.collection(this.collectionName).add(doc);
      return ref.id;
    } else {
      const id = 'local_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);
      doc.id = id;
      const entries = this._getLocal();
      entries.push(doc);
      this._setLocal(entries);
      return id;
    }
  }

  // ---- CRUD: Read All ----
  async getAllEntries(listFilter = null) {
    await this._ensureInit();
    if (this.mode === 'firestore') {
      let query = this.db.collection(this.collectionName)
        .orderBy('createdAt', 'desc');

      if (listFilter) {
        query = query.where('list', '==', listFilter);
      }

      const snapshot = await query.get();

      const entries = [];
      snapshot.forEach(doc => {
        entries.push({ id: doc.id, ...doc.data() });
      });
      return entries;
    } else {
      const entries = this._getLocal();
      if (listFilter) {
        return entries.filter(e => (e.list || 'main') === listFilter);
      }
      return entries;
    }
  }

  // ---- CRUD: Update ----
  async updateEntry(id, updates) {
    await this._ensureInit();
    updates.updatedAt = new Date().toISOString();

    if (this.mode === 'firestore') {
      await this.db.collection(this.collectionName).doc(id).update(updates);
    } else {
      const entries = this._getLocal();
      const idx = entries.findIndex(e => e.id === id);
      if (idx !== -1) {
        entries[idx] = { ...entries[idx], ...updates };
        this._setLocal(entries);
      }
    }
  }

  // ---- CRUD: Delete ----
  async deleteEntry(id) {
    await this._ensureInit();
    if (this.mode === 'firestore') {
      await this.db.collection(this.collectionName).doc(id).delete();
    } else {
      const entries = this._getLocal();
      this._setLocal(entries.filter(e => e.id !== id));
    }
  }

  // ---- Delete All Entries (optionally filtered by list) ----
  async deleteAllEntries(listFilter = null) {
    await this._ensureInit();
    if (this.mode === 'firestore') {
      const snapshot = await this.db.collection(this.collectionName).get();
      const batch = this.db.batch();
      let deletedCount = 0;
      snapshot.forEach(doc => {
        const entry = doc.data();
        // Apply same client-side filter used in the UI: entries without a
        // 'list' field are treated as belonging to the 'main' list.
        const entryList = entry.list || 'main';
        if (!listFilter || entryList === listFilter) {
          batch.delete(doc.ref);
          deletedCount++;
        }
      });
      await batch.commit();
      return deletedCount;
    } else {
      const entries = this._getLocal();
      if (listFilter) {
        const matching = entries.filter(e => (e.list || 'main') === listFilter);
        this._setLocal(entries.filter(e => (e.list || 'main') !== listFilter));
        return matching.length;
      }
      const count = entries.length;
      this._setLocal([]);
      return count;
    }
  }

  // ---- Check online status ----
  isCloudConnected() {
    return this.mode === 'firestore';
  }

  // ==========================================================================
  // Daily Notes — keyed by date string "YYYY-MM-DD"
  // ==========================================================================

  // ---- Get a daily note by date ----
  async getDailyNote(dateStr) {
    await this._ensureInit();
    if (this.mode === 'firestore') {
      try {
        const doc = await this.db.collection('daily_notes').doc(dateStr).get();
        if (doc.exists) {
          return { date: dateStr, ...doc.data() };
        }
        return null;
      } catch (e) {
        console.warn('[DataStore] Failed to get daily note:', e.message);
        return this._getLocalNote(dateStr);
      }
    } else {
      return this._getLocalNote(dateStr);
    }
  }

  // ---- Save a daily note ----
  async saveDailyNote(dateStr, data) {
    await this._ensureInit();
    const doc = {
      content: data.content || '',
      sentiment: data.sentiment || null,  // 'bullish' | 'neutral' | 'bearish'
      updatedAt: new Date().toISOString()
    };

    if (this.mode === 'firestore') {
      try {
        await this.db.collection('daily_notes').doc(dateStr).set(doc, { merge: true });
      } catch (e) {
        console.warn('[DataStore] Failed to save daily note to Firestore, falling back to local:', e.message);
        this._setLocalNote(dateStr, doc);
      }
    } else {
      this._setLocalNote(dateStr, doc);
    }
  }

  // ---- Get all dates that have notes (for indicator dots) ----
  async getAllNoteDates() {
    await this._ensureInit();
    if (this.mode === 'firestore') {
      try {
        const snapshot = await this.db.collection('daily_notes').get();
        const dates = [];
        snapshot.forEach(doc => dates.push(doc.id));
        return dates;
      } catch (e) {
        console.warn('[DataStore] Failed to get all note dates:', e.message);
        return Object.keys(this._getLocalNotes());
      }
    } else {
      return Object.keys(this._getLocalNotes());
    }
  }

  // ---- Local Storage Helpers for Daily Notes ----
  _getLocalNotes() {
    try {
      const raw = localStorage.getItem('stockwatchlist_daily_notes');
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  }

  _setLocalNotes(notes) {
    localStorage.setItem('stockwatchlist_daily_notes', JSON.stringify(notes));
  }

  _getLocalNote(dateStr) {
    const notes = this._getLocalNotes();
    if (notes[dateStr]) {
      return { date: dateStr, ...notes[dateStr] };
    }
    return null;
  }

  _setLocalNote(dateStr, data) {
    const notes = this._getLocalNotes();
    notes[dateStr] = { ...notes[dateStr], ...data };
    this._setLocalNotes(notes);
  }

  // ==========================================================================
  // Trade Reviews — keyed by auto-generated Firestore doc ID
  // ==========================================================================

  // ---- Get all trade reviews ----
  async getAllTradeReviews() {
    await this._ensureInit();
    if (this.mode === 'firestore') {
      try {
        // Use simpler query — single orderBy to avoid needing a composite index
        const snapshot = await this.db.collection('trade_reviews')
          .orderBy('createdAt', 'desc')
          .get();
        const reviews = [];
        snapshot.forEach(doc => {
          reviews.push({ id: doc.id, ...doc.data() });
        });
        // Client-side sort by date then createdAt for consistent ordering
        reviews.sort((a, b) => {
          const dateA = a.date || '';
          const dateB = b.date || '';
          if (dateA !== dateB) return dateB.localeCompare(dateA);
          return (b.createdAt || '').localeCompare(a.createdAt || '');
        });
        return reviews;
      } catch (e) {
        console.warn('[DataStore] Failed to fetch trade reviews:', e.message);
        return this._getLocalTradeReviews();
      }
    } else {
      return this._getLocalTradeReviews();
    }
  }

  // ---- Get a single trade review by ID ----
  async getTradeReview(id) {
    await this._ensureInit();
    if (this.mode === 'firestore') {
      try {
        const doc = await this.db.collection('trade_reviews').doc(id).get();
        if (doc.exists) {
          return { id: doc.id, ...doc.data() };
        }
        return null;
      } catch (e) {
        console.warn('[DataStore] Failed to get trade review:', e.message);
        const local = this._getLocalTradeReviews();
        return local.find(r => r.id === id) || null;
      }
    } else {
      const local = this._getLocalTradeReviews();
      return local.find(r => r.id === id) || null;
    }
  }

  // ---- Save (create or update) a trade review ----
  async saveTradeReview(id, data) {
    await this._ensureInit();
    const doc = {
      ...data,
      updatedAt: new Date().toISOString()
    };

    if (!doc.createdAt) {
      doc.createdAt = new Date().toISOString();
    }

    if (this.mode === 'firestore') {
      try {
        if (id) {
          // Update existing
          await this.db.collection('trade_reviews').doc(id).set(doc, { merge: true });
          return id;
        } else {
          // Create new
          const ref = await this.db.collection('trade_reviews').add(doc);
          return ref.id;
        }
      } catch (e) {
        console.warn('[DataStore] Failed to save trade review:', e.message);
        return this._saveLocalTradeReview(id, doc);
      }
    } else {
      return this._saveLocalTradeReview(id, doc);
    }
  }

  // ---- Delete a trade review ----
  async deleteTradeReview(id) {
    await this._ensureInit();
    if (this.mode === 'firestore') {
      try {
        await this.db.collection('trade_reviews').doc(id).delete();
      } catch (e) {
        console.warn('[DataStore] Failed to delete trade review from Firestore:', e.message);
        this._deleteLocalTradeReview(id);
      }
    } else {
      this._deleteLocalTradeReview(id);
    }
  }

  // ---- Get review count for a given watchlist entry ----
  async getTradeReviewCountForEntry(watchlistEntryId) {
    const reviews = await this.getAllTradeReviews();
    return reviews.filter(r => r.watchlistEntryId === watchlistEntryId).length;
  }

  // ---- Local Storage Helpers for Trade Reviews ----
  _getLocalTradeReviews() {
    try {
      const raw = localStorage.getItem('stockwatchlist_trade_reviews');
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  }

  _setLocalTradeReviews(reviews) {
    localStorage.setItem('stockwatchlist_trade_reviews', JSON.stringify(reviews));
  }

  _saveLocalTradeReview(id, data) {
    const reviews = this._getLocalTradeReviews();
    if (id) {
      const idx = reviews.findIndex(r => r.id === id);
      if (idx !== -1) {
        reviews[idx] = { ...reviews[idx], ...data, id };
      }
    } else {
      id = 'local_review_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);
      reviews.push({ id, ...data });
    }
    this._setLocalTradeReviews(reviews);
    return id;
  }

  _deleteLocalTradeReview(id) {
    const reviews = this._getLocalTradeReviews();
    this._setLocalTradeReviews(reviews.filter(r => r.id !== id));
  }

  // ---- Local Storage Helpers (fallback/cache) ----
  _getLocal() {
    try {
      const raw = localStorage.getItem('stockwatchlist_data');
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  }

  _setLocal(entries) {
    localStorage.setItem('stockwatchlist_data', JSON.stringify(entries));
  }
}

// Global singleton
const dataStore = new DataStore();
