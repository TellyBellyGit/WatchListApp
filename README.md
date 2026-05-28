# 📈 Stock Watch List — Momentum Trading Tracker

A single-page web application for day/momentum traders to track stocks with auto-stamped EST entry time, frozen noted prices, real-time quote refreshes, volume spike detection, tags, notes, and CSV export. Cloud sync via Firebase Firestore (optional) or localStorage.

## Features

| Feature | Description |
|---|---|
| 🔍 **Stock Search** | Search by symbol or company name, fetches real-time data |
| 📅 **EST Auto-Stamp** | Entry date/time automatically recorded in America/New_York time |
| ❄️ **Noted Price** | Current price frozen at the moment you add the stock — never changes |
| 📊 **Live Quotes** | One-click "Refresh All Prices" pulls real-time quotes from Finnhub |
| 📈 **Gain/Loss Since Noted** | Color-coded P&L showing how price has moved since entry |
| 📉 **Percent Change** | Both noted (frozen) and current % change displayed |
| 📊 **Day Range** | Noted and current High-of-Day / Low-of-Day |
| 🔊 **Volume Spike Detection** | Badge flags when current volume is 2x+ the noted volume |
| 🏷️ **Tags** | Freeform tags (e.g., "Breakout", "Gap Up") with tag filter |
| 📝 **Notes** | Custom trading notes per entry |
| 🔎 **Date Filtering** | Filter entries by date range |
| 📥 **CSV Export** | Download your watch list as a CSV spreadsheet |
| 🌙 **Dark/Light Mode** | Toggle between themes, persisted across sessions |
| 💾 **Cloud Sync** | Firebase Firestore for cross-device access (or localStorage) |
| 📊 **Summary Stats** | Win rate, best/worst performers since noted |

## Quick Start

### 1. Get a Free Finnhub API Key
1. Go to [finnhub.io](https://finnhub.io)
2. Click **"Get free API key"** — sign up with email
3. Copy your API key from the dashboard

### 2. Configure the App
Open `js/finnhub.js` and replace the placeholder:
```javascript
const FINNHUB_API_KEY = 'YOUR_FINNHUB_API_KEY_HERE';
```
With your actual key:
```javascript
const FINNHUB_API_KEY = 'c123456789abcdef';
```

### 3. Open the App
Open `index.html` in any modern browser — no server required.

## Optional: Firebase Cloud Sync

To sync your watch list across devices:

1. Go to [Firebase Console](https://console.firebase.google.com)
2. Create a new project
3. Add a **Web App** to get your config object
4. In **Firestore Database**, create a database (start in test mode)
5. Open `js/firebase-config.js`:
   - Paste your Firebase config object
   - Set `USE_FIREBASE = true`

```javascript
const FIREBASE_CONFIG = {
  apiKey: "AIzaSy...",
  authDomain: "your-project.firebaseapp.com",
  projectId: "your-project-id",
  storageBucket: "your-project.appspot.com",
  messagingSenderId: "123456789",
  appId: "1:123456789:web:abc123"
};

const USE_FIREBASE = true;
```

## File Structure

```
StockWatchList/
├── index.html              ← Main application
├── css/
│   └── style.css           ← All styling (light/dark themes)
├── js/
│   ├── firebase-config.js  ← Firebase credentials + toggle
│   ├── firestore.js        ← Data store (Firestore + localStorage fallback)
│   ├── finnhub.js          ← Finnhub API wrapper + rate limiter
│   ├── utils.js            ← Date formatting (EST), CSV, number formatting
│   └── app.js              ← Main application logic
└── README.md               ← This file
```

## Column Reference

| Column | Description |
|---|---|
| **Symbol** | Stock ticker |
| **Company Name** | Full company name |
| **Noted Price** | Price at entry (❄️ frozen) |
| **Current Price** | Latest real-time price |
| **P&L Since Noted** | % gain/loss from noted price to current |
| **Noted % Chg** | Day's % change at entry (❄️ frozen) |
| **Current % Chg** | Day's % change (live) |
| **Noted Vol** | Volume at entry |
| **Current Vol** | Latest volume |
| **Noted HOD/LOD** | Day high/low at entry (❄️ frozen) |
| **Curr HOD/LOD** | Current day high/low |
| **Shares Out.** | Shares outstanding (proxy for float) |
| **Sector** | Industry sector |
| **Tags** | User-defined tags |
| **Notes** | Trading notes |
| **Entry Date (EST)** | Date/time added in New York time |
| **Actions** | Edit notes/tags, refresh single price, delete |

## API Rate Limits

Finnhub free tier: **60 API calls per minute**. The app includes a rate limiter that pauses automatically if approaching the limit.

- Adding a stock: 2 calls (quote + profile)
- Refreshing prices: 1 call per unique symbol

## Browser Support

Works in all modern browsers: Chrome, Firefox, Safari, Edge.