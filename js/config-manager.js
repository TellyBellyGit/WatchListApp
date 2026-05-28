// ============================================================================
// CONFIG MANAGER — Stores Finnhub API key in localStorage (never in source code)
// ============================================================================
// Firebase is always configured via firebase-config.js (project-level).
// The Finnhub API key is stored per-browser, per-device and never touches a server.
// To use across devices, enter the same Finnhub key on each device.
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
    if (config && config.finnhubKey && config.finnhubKey !== 'YOUR_FINNHUB_API_KEY_HERE') return true;
    // Fallback to global var for local dev with config.js
    if (typeof FINNHUB_API_KEY !== 'undefined' && FINNHUB_API_KEY && FINNHUB_API_KEY !== 'YOUR_FINNHUB_API_KEY_HERE') return true;
    return false;
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
  }
};