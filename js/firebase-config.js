// ============================================================================
// FIREBASE CONFIGURATION
// ============================================================================
// FIREBASE_CONFIG and USE_FIREBASE are expected to be defined in config.js (gitignored).
// Copy config.template.js to config.js and insert your real Firebase config values.
// You can find these in Firebase Console > Project Settings > General > Your apps.
//
// Steps:
// 1. Go to https://console.firebase.google.com
// 2. Create a new project (or use existing)
// 3. Add a Web App to get your config object
// 4. In Firestore Database, create a database in "production" or "test" mode
// 5. Copy the config values into js/config.js
// ============================================================================

if (typeof FIREBASE_CONFIG === 'undefined') {
  console.warn('[Config] FIREBASE_CONFIG not found. Firebase features disabled. Copy js/config.template.js to js/config.js to enable cloud sync.');
}

if (typeof USE_FIREBASE === 'undefined') {
  const USE_FIREBASE = false;
}
