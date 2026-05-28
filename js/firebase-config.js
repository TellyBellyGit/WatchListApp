// ============================================================================
// FIREBASE CONFIGURATION
// ============================================================================
// Firebase config is loaded from ConfigManager (localStorage setup screen).
// Falls back to values defined in config.js for local development.
// ============================================================================

(function _initFirebaseConfig() {
  // Check ConfigManager (localStorage) first
  const storedConfig = ConfigManager.getFirebaseConfig();
  const shouldUse = ConfigManager.shouldUseFirebase();

  if (storedConfig && storedConfig.apiKey) {
    // Override global values from localStorage setup
    if (typeof FIREBASE_CONFIG !== 'undefined') {
      // config.js pre-defined it; we override by reassigning properties
      Object.assign(FIREBASE_CONFIG, storedConfig);
    } else {
      window.FIREBASE_CONFIG = storedConfig;
    }
    window.USE_FIREBASE = true;
  }
  // Otherwise, leave whatever config.js set (or defaults)
})();