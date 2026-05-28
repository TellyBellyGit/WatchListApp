// ============================================================================
// CONFIG MANAGER — Stores API keys in localStorage (never in source code)
// ============================================================================
// Keys are stored per-browser, per-device. They never touch the server.
// To use across devices, enter the same keys on each device.
// ============================================================================

const ConfigManager = {
  _STORAGE_KEY: 'stockwatchlist_config',

  // ---- Get current config ----
  get() {
    try {
      const raw = localStorage.getItem(this._STORAGE_KEY);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch {
      return null;
    }
  },

  // ---- Save config ----
  save(config) {
    localStorage.setItem(this._STORAGE_KEY, JSON.stringify(config));
  },

  // ---- Clear config ----
  clear() {
    localStorage.removeItem(this._STORAGE_KEY);
  },

  // ---- Check if Finnhub key is configured ----
  hasFinnhubKey() {
    const config = this.get();
    return !!(config && config.finnhubKey && config.finnhubKey !== 'YOUR_FINNHUB_API_KEY_HERE');
  },

  // ---- Get Finnhub key (tries localStorage first, then global var) ----
  getFinnhubKey() {
    const config = this.get();
    if (config && config.finnhubKey) return config.finnhubKey;
    // Fallback to global var for local dev with config.js
    if (typeof FINNHUB_API_KEY !== 'undefined' && FINNHUB_API_KEY !== 'YOUR_FINNHUB_API_KEY_HERE') {
      return FINNHUB_API_KEY;
    }
    return null;
  },

  // ---- Save Finnhub key ----
  saveFinnhubKey(key) {
    const config = this.get() || {};
    config.finnhubKey = key;
    this.save(config);
  },

  // ---- Get Firebase config (tries localStorage first, then global var) ----
  getFirebaseConfig() {
    const config = this.get();
    if (config && config.firebaseApiKey) {
      return {
        apiKey: config.firebaseApiKey,
        authDomain: config.firebaseAuthDomain || '',
        projectId: config.firebaseProjectId || '',
        storageBucket: (config.firebaseProjectId ? config.firebaseProjectId + '.appspot.com' : ''),
        messagingSenderId: '',
        appId: ''
      };
    }
    // Fallback to global var for local dev with config.js
    if (typeof FIREBASE_CONFIG !== 'undefined' && FIREBASE_CONFIG.apiKey && FIREBASE_CONFIG.apiKey !== 'YOUR_FIREBASE_API_KEY') {
      return FIREBASE_CONFIG;
    }
    return null;
  },

  // ---- Save Firebase config ----
  saveFirebaseConfig(apiKey, authDomain, projectId) {
    const config = this.get() || {};
    config.firebaseApiKey = apiKey;
    config.firebaseAuthDomain = authDomain;
    config.firebaseProjectId = projectId;
    this.save(config);
  },

  // ---- Check if Firebase is configured ----
  hasFirebaseConfig() {
    const config = this.get();
    return !!(config && config.firebaseApiKey && config.firebaseProjectId);
  },

  // ---- Should use Firebase? (configured AND enabled) ----
  shouldUseFirebase() {
    // Try localStorage config first
    const config = this.get();
    if (config && config.firebaseApiKey && config.firebaseProjectId) {
      return true;
    }
    // Fallback to global var
    if (typeof USE_FIREBASE !== 'undefined' && USE_FIREBASE === true &&
        typeof FIREBASE_CONFIG !== 'undefined' && FIREBASE_CONFIG.apiKey && FIREBASE_CONFIG.apiKey !== 'YOUR_FIREBASE_API_KEY') {
      return true;
    }
    return false;
  }
};