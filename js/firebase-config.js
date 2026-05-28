// ============================================================================
// FIREBASE CONFIGURATION
// ============================================================================
// Replace the placeholder values below with your actual Firebase project config.
// You can find these in Firebase Console > Project Settings > General > Your apps.
//
// Steps:
// 1. Go to https://console.firebase.google.com
// 2. Create a new project (or use existing)
// 3. Add a Web App to get your config object
// 4. In Firestore Database, create a database in "production" or "test" mode
// 5. Copy the config values below
// ============================================================================

const FIREBASE_CONFIG = {
  apiKey: "AIzaSyYOUR_API_KEY_HERE",
  authDomain: "YOUR_PROJECT.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT.appspot.com",
  messagingSenderId: "000000000000",
  appId: "1:000000000000:web:xxxxxxxxxxxxxxxxxxxx"
};

// Set to false to use localStorage only (no Firebase account needed)
const USE_FIREBASE = false;

// For localStorage-only mode, data persists in this browser only.
// Set USE_FIREBASE = true AND fill in FIREBASE_CONFIG above for cloud sync.