# StockWatchList — Summary for AI

## What It Is
A **single-page web application** for day/momentum traders to track stocks with real-time prices, entry time stamping, notes, tags, and trade journaling. No build tools or server required — just open `index.html` in a browser.

## Core Features
- **Stock Search & Add** — Search by symbol/company name via Finnhub API, add stocks with frozen "noted" price, tags, and notes
- **Multiple Watch Lists** — Main, Swing, and Temp lists with one-click promotion of entries between lists
- **Real-Time Prices** — WebSocket connection for live price updates; polling engine for OTC stocks (20s interval)
- **Entry Time Stamping** — All entries auto-stamped in America/New York (EST) timezone
- **Volume Spike Detection** — Badge when current volume is 2x+ noted volume
- **Tags & Filtering** — Freeform tags with filter dropdown, date range filtering with calendar strip
- **Daily Notes** — Markdown journal with formatting toolbar, image paste-to-storage, sentiment tracking, per-date notes
- **Trade Reviews** — Full trade journaling: direction, entry/exit price, shares, strategy, P&L calculation, risk management (account size, % risk, R:R)
- **Strength Scoring** — 6-signal checklist (pre-market hold, higher low, VWAP reclaim, volume pattern, EMA stack, distribution) with automatic bias recommendation
- **Stock Review Overlay** — Rich text editor (Quill.js) for per-stock notes, tag management, chart links, trade tracking
- **CSV Export** — Download watch list as CSV
- **Dark/Light Theme** — Persisted across sessions
- **Education Dropdowns** — Built-in trading wisdom, rules, and setup playbook

## Implementation Architecture

### File Structure
```
StockWatchList/
├── index.html                 ← Main app (695 lines), all UI + overlays
├── css/style.css              ← All styling, light/dark CSS variables
├── js/
│   ├── firebase-config.js     ← Firebase credentials + toggle
│   ├── firestore.js           ← DataStore class (Firestore + localStorage)
│   ├── finnhub.js             ← Finnhub API wrapper + rate limiter
│   ├── utils.js               ← Date formatting (EST), CSV, number formatting
│   ├── app.js                 ← Main application logic (4181 lines)
│   └── ... (alphavantage.js, websocket.js, config.js, etc.)
└── README.md
```

### Key Design Patterns
- **Singleton DataStore** — `DataStore` class in `firestore.js` handles all CRUD. Firebase Firestore is primary; localStorage is fallback. Offline persistence enabled via Firestore's `enablePersistence({ synchronizeTabs: true })`.
- **Main Controller** — `StockWatchApp` class in `app.js` manages all state (entries, filters, sort, list selection, WebSocket, polling). Method-based architecture (~4181 lines).
- **API Abstraction** — `finnhub.js` wraps Finnhub's search/quote/profile endpoints with rate limiting (60 req/min free tier). `alphavantage.js` provides float/fundamental data.
- **WebSocket Client** — Real-time price updates via `wsClient` singleton. Subscribes/unsubscribes symbols. OTC stocks use polling instead.
- **Config Manager** — API keys stored in `localStorage`, managed through a setup overlay.

### Data Flow
1. User searches symbol → Finnhub API (with Alpha Vantage fallback for float data)
2. Entry created with frozen "noted" price, EST timestamp, tags, notes, list assignment
3. Entry saved to Firestore (or localStorage) → re-renders table
4. WebSocket subscribes for real-time price updates → flashes row on price change
5. Filters (date, tag, list) applied client-side on the entries array

### Data Model (Watchlist Entry)
```javascript
{
  symbol, companyName, exchange, sector,
  notedPrice, notedPercentChange, notedVolume, notedDayHigh, notedDayLow, notedOpen, notedPreviousClose,
  currentPrice, currentPercentChange, currentVolume, currentDayHigh, currentDayLow, currentOpen, currentPreviousClose,
  entryDateEST, entryLocalDate,
  notes, tags, list,                    // User metadata
  sharesOutstanding, sharesFloat,       // From Alpha Vantage
  heldPercentInsiders, heldPercentInstitutions,
  quoteTimestamp,                       // When price was last updated
  id, createdAt, updatedAt              // Auto-generated
}
```

### Key Technical Details
- **No build step** — Vanilla JS, ES6 classes, no bundler
- **Quill.js** (1.3.7) — Rich text editor for stock review notes
- **EST Timezone** — Manual UTC offset calculation in `utils.js` (not relying on browser locale)
- **Debounce auto-save** — Daily notes and stock reviews auto-save with debounce timer
- **Image paste** — Handles image paste in textarea, uploads to Firebase Storage, inserts as markdown
- **Calendar strip** — Collapsible date dot strip with full month grid view, smart date navigation skipping to days with data
- **Sort state** — Column sort persisted in `sortColumn`/`sortDirection`; sortable headers via `data-sort` attributes
- **WiFi/connection status** — Visual indicator showing cloud sync vs local storage mode