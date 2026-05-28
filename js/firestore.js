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

  // ---- CRUD: Create ----
  async addEntry(entry) {
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
    if (this.mode === 'firestore') {
      await this.db.collection(this.collectionName).doc(id).delete();
    } else {
      const entries = this._getLocal();
      this._setLocal(entries.filter(e => e.id !== id));
    }
  }

  // ---- Check online status ----
  isCloudConnected() {
    return this.mode === 'firestore';
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