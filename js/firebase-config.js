// ============================================================================
// FIREBASE CONFIGURATION — Hardcoded for StockWatchList Momentum Tracker
// ============================================================================
// This app uses Firestore as the primary data store with open access rules.
// No authentication required — anyone using the app can read/write data.
// ============================================================================
//
// IMPORTANT: The apiKey below is an API key, not a secret. It's safe to include
// in client-side code. Firestore security rules (firestore.rules) control access.
// The rules are set to allow open read/write without authentication.
// ============================================================================

window.FIREBASE_CONFIG = {
  apiKey: "AIzaSyBqO1y5oe7B5I9-LtCXF8EFndGefxSzcKE",
  authDomain: "stockwatchlist-momentum.firebaseapp.com",
  projectId: "stockwatchlist-momentum",
  storageBucket: "stockwatchlist-momentum.firebasestorage.app",
  messagingSenderId: "596412825118",
  appId: "1:596412825118:web:6fc383883a5ca07d81380f",
  measurementId: "G-M48ZP6P2VQ"
};

// Firebase is always enabled — this app IS a Firebase app
window.USE_FIREBASE = true;

console.log('[Firebase] Config loaded — project:', window.FIREBASE_CONFIG.projectId);