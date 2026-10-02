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

## Trade Journal (standalone page)

`TradeJournal.html` is its own page: the 13 columns of `Day_Trading_Journal.xlsx`, the numbers behind
each trade, the advice loop, an optional annotated deep dive and a Review-by-category pivot. It never
touches the main app's internals and degrades gracefully with no Firebase, no Quill and no API keys.

| File | Role |
| --- | --- |
| `js/journal.js` | Page controller (`TradeJournalApp`) |
| `js/journal-categories.js` | The 11 categories, the 13 column definitions, `JournalText` |
| `js/journal-csv.js` | A–Z CSV import/export **and the single implementation of the P&L / duration / R arithmetic** |
| `js/journal-draft.js` | Offline write-up helper: guided skeleton + prompt for the user's own AI chat |
| `tests/journal-*.test.js` | Plain-Node checks (`node tests/journal-csv.test.js`, `journal-form`, `journal-dom`) |

### Import format — column letters
A–M are the sheet's 13 columns; N–Z carry the timing, the prices and the meta fields:

```
A date         B ticker      C timeframe   D category    E setup
F entryTrigger G whyEntered  H whatWentWrong I whyItWentWrong J advice
K keyLesson    L outcome     M review
N direction    O entryDate   P entryTime   Q entryPrice  R exitDate
S exitTime     T exitPrice   U shares      V fees        W plannedRiskR
X strategy     Y tags        Z processScore
```

Any subset of letters works, in any order. Accepted header shapes: a letters row (`A,B,C,…`), letters
with the sheet header behind them (`A · Date,…`), plain names (`Date,Ticker,Outcome / P&L,…`) and a
headerless 13-column file (read positionally as A–M). The separator (`,` `;` or tab) is detected, as are
Excel-shaped dates, times and serial numbers, and rough category names (`FOMO` → `FOMO / Chasing`).

One column has **no letter**: `Group` (field `groupId`) carries the session id. All 26 letters belong to
the sheet, so it is matched **by name only** (`A,B,D,Group` and `Date,Ticker,Group` both work) — a file
without the column simply says nothing about grouping. `JournalCSV.csvKeys()` is the A–Z subset, which is
why the downloadable example stays exactly A–Z.

- **Timing & prices** are always visible (columns N–T). The collapsed *Numbers* panel only holds size,
  costs and the planned 1R; it opens itself the first time the 1-share default lands in the size box.
  Column A follows the entry date until the user types their own.
- **Cross-midnight trades**: from the two times alone an exit before the entry rolls the exit date
  forward a day, and `durationMin` is computed in wall-clock minutes, so a DST switch cannot skew it.
- **One arithmetic path**: `JournalCSV.computeTradeNumbers()` feeds the live P&L strip, `_collectForm()`
  and the CSV import, so the form, an imported row and the summary table cannot disagree.
- **No size entered**: both prices with a blank size assume **1 share** (`assumedShares` from
  `computeTradeNumbers()`), so Net P&L / Return / per-share / R populate instead of the strip going blank.
  The form writes that `1` into the Shares box, tints it (`.tj-input-assumed` + a tooltip), opens the Numbers
  panel and explains itself in `#tj-numbers-hint`; a size the user types always wins, and the draft helper
  and the CSV import report the size as missing rather than quoting a figure the user never gave.
- **Draft** runs entirely in the page — no key, no network. Tab 1 builds a skeleton for columns F–K and M
  from the facts already in the form, marking what only the trader can write with `— EDIT`; tab 2 writes
  a prompt plus the example CSV for the user's own AI chat and pipes the answer back through Import.
- **An open form is never a dead end**: the editor is a full-screen overlay (`z-index: 9000`), so while it is
  open the header's `+ New entry` / `Import` / `Refresh` are covered and unreachable. The editor head therefore
  carries its own `＋ New` button (`#tj-editor-new` → `_startAnotherEntry()`, which confirms through
  `_confirm()` before dropping unsaved changes) and `📥 Import` (`#tj-editor-import` → `openImport()`; the import
  dialog sits at `z-index: 10500`, above the editor, so it opens on top). The header buttons stay the primary
  entry point everywhere else, and `.tj-editor-head-right` wraps so six head buttons never overflow.
- **Sessions, not single trades**: one ticker on one day is ONE session however many legs it took (1–10 a
  day). The table lists **one row per session** by default — collapsed, with the legs nested underneath and
  opened by the caret — and `🧩 Group by session` / `▤ One row per trade` (`#tj-group-by`, remembered per
  browser) switches back to the flat list. A session row is a summary: the leg count, W/L, net P&L, average
  R, the distinct categories/timeframes, the summed size, fees and time in trade and the average process
  score, all derived by `JournalCSV.groupEntries()` / `rollup()` from the legs on every render (nothing is
  stored on it), and it deliberately claims **no MAE/MFE** — a leg stores no price path. Its prose columns
  are left empty: what was written about a trade stays on the leg that traded it.
- **How a session is decided**: rows carrying the same **stored `groupId`** belong together; otherwise rows
  that share a ticker and a date do — so entries stored long before groups existed group correctly with no
  migration and no extra index. A `solo_…` id is the exception that proves the rule: the row was
  deliberately split out and is never merged again. Import writes one `groupId` per ticker+date
  (`JournalCSV.assignGroupIds()` + `newGroupId()` → `grp_…`; tick box *Store a group id on rows that share a
  ticker and a date*, on by default, with a live "5 rows → 3 sessions" note), a lone row keeps
  `groupId: null` ("never grouped"). Unticking the box only stops the ids being written — the table still
  reads a ticker on a date as one session, because that is a view, not a stored fact.
  The editor's session strip says which session the open row will save into and offers the only two ways to
  change it: store the group id on the whole session in one click (a field-level merge, the only back-fill
  in the app) or **split out** a single row.
- **Filtering stays trade-level and comes first**: the grouped table is built from `this._filtered`, so a
  session only ever shows the legs the filters kept and the counter reads `2 of 5 entries · 1 session`.
  Stats and the Review-by-category pivot are unchanged (still per trade); the Entries card adds the session
  count beside the row count so the two numbers never look like a contradiction.
- **A session of one is still a whole entry**: it is drawn as its own row, never as a summary above a copy of
  itself. It keeps its prose, its numbers and its buttons, and the Session column marks it with `▶ 1 trade`
  plus its one-line result (`1W / 0L · +$120.00 · +1.20R`) with a rule drawn above the row. The marks are the
  whole grammar: `└───→` runs out of the session above into a leg, `▶` opens a block of its own — and since
  there is nothing underneath it to open, it carries no toggle and is `aria-hidden`. Flat mode (*One row per
  trade*)
  draws neither, so a journal with nothing to group looks exactly the way it always did.
- `JournalCSV.describeRollup(roll, { noCount: true })` leaves the leading leg count off, for the callers that
  already print it next to the line: the Session column says `3 trades` over `3 legs · …` otherwise.
