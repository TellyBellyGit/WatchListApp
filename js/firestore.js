// ============================================================================
// DATA STORE — Firebase Firestore OR localStorage fallback
// ============================================================================

class DataStore {
  constructor() {
    this.db = null;          // Firestore instance (if connected)
    this.collectionName = 'watchlist';
    this.mode = 'local';     // 'local' | 'firestore'
  }

  // ---- Initialize ----
  async init() {
    if (typeof USE_FIREBASE !== 'undefined' && USE_FIREBASE && typeof firebase !== 'undefined') {
      try {
        if (!firebase.apps.length) {
          firebase.initializeApp(FIREBASE_CONFIG);
        }
        this.db = firebase.firestore();
        // Quick connectivity test
        await this.db.collection(this.collectionName).limit(1).get();
        this.mode = 'firestore';
        console.log('[DataStore] Connected to Firestore');
        return true;
      } catch (e) {
        console.warn('[DataStore] Firebase connection failed, falling back to localStorage:', e.message);
        this.mode = 'local';
      }
    } else {
      console.log('[DataStore] Using localStorage (offline mode)');
      this.mode = 'local';
    }
    return false;
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
  async getAllEntries() {
    if (this.mode === 'firestore') {
      const snapshot = await this.db.collection(this.collectionName)
        .orderBy('createdAt', 'desc')
        .get();

      const entries = [];
      snapshot.forEach(doc => {
        entries.push({ id: doc.id, ...doc.data() });
      });
      return entries;
    } else {
      return this._getLocal();
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

  // ---- Local Storage Helpers ----
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