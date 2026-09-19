# Future Enhancements

**Feature:** Multi-user support with 4-digit PIN identification
**Status:** Proposal only — **nothing in this document is implemented**. No code, rules or configuration were changed when this document was written.
**Last updated:** 17 September 2026
**Related files:** `AI_SUMMARY.md`, `README.md`, `firestore.rules`, `storage.rules`, `js/firestore.js`, `js/storage.js`, `js/app.js`, `js/config-manager.js`, `functions/src/index.ts`

> **Summary.** Today TradrDash is a single-page, **single-user** app whose Firestore and Firebase
> Storage rules are fully open (`allow read, write: if true`). This document specifies how to evolve
> it into a **multi-user** app in which each person is identified by a **4-digit PIN**, with per-user
> data isolation, server-verified PIN entry, idle auto-lock, and a migration path that does not lose
> existing data. It is written so the work can be picked up later without repeating the analysis.

---

## 0. How to use this document

* Sections 1–2 are **fact-finding** (what exists today, and what a 4-digit PIN can and cannot do).
* Sections 3–6 are the **design** (options, wireframes, data model, rules, flows).
* Sections 7–12 are **delivery** (ops/cost, migration, code-touch map, tests, risks, phases).
* Section 13 lists the **open decisions**. Sections 3.4 and 12 exist specifically so that the
  implementation can start **before** the auth-model decision is made.

---

## 1. Current architecture (verified from source)

### 1.1 Runtime and deployment

| Item | Value |
|---|---|
| Hosting | Firebase Hosting, project `stockwatchlist-momentum`, `public: "StockWatchList"`, no rewrites, `Cache-Control: no-cache` on `**/*.html` |
| Public URL | `https://stockwatchlist-momentum.web.app` |
| Build step | none — vanilla ES6 classes, plain `<script>` tags in `index.html` |
| Backend | Firestore, Firebase Storage, one public Cloud Function (`yahooKeyStats`, v2 `onRequest`, `cors: true`, `invoker: "public"`) |
| Billing | Blaze (required by Cloud Functions, already in use) |

### 1.2 Client modules

| File | Role |
|---|---|
| `index.html` (771 lines) | entire UI including all overlays (setup, daily notes, stock review, trade reviews, image annotator) |
| `js/app.js` (4 455 lines) | `StockWatchApp` — all application state and behaviour |
| `js/firestore.js` (685 lines) | `DataStore` singleton: Firestore primary, `localStorage` fallback |
| `js/storage.js` | `ImageStorage` singleton: resize to 1200 px / JPEG 0.8, upload, delete |
| `js/trade-reviews.js` (43 KB) | trade-review grid + editor |
| `js/image-annotator.js` | image annotation modal |
| `js/config-manager.js` | Finnhub + Alpha Vantage API keys (device-level) |
| `js/firebase-config.js` | hardcoded Firebase project config |
| `js/utils.js`, `js/finnhub.js`, `js/alphavantage.js`, `js/websocket.js` | helpers, API wrappers, live price socket |

### 1.3 Data layer

| Store | Details |
|---|---|
| Firestore collections | `watchlist`, `daily_notes`, `trade_reviews` (top level, shared by everyone) |
| Firestore offline | `db.enablePersistence({ synchronizeTabs: true })` |
| Fallback | every write failure falls back to `localStorage` with a `_localOnly` flag; `lastWriteBlocked` tracks it |
| Storage path | `trade-images/{reviewId}/{timestamp}.jpg|png` |
| Local cache keys | `stockwatchlist_data`, `stockwatchlist_daily_notes`, `stockwatchlist_trade_reviews`, `stockwatchlist_theme`, `stockwatchlist_hide-dates`, `stockwatchlist_add-section-collapsed`, `stockwatchlist_risk_settings`, `stockwatchlist_config` |
| API keys | Finnhub / Alpha Vantage in `localStorage['stockwatchlist_config']` (per browser, never server-side) |

### 1.4 Boot sequence (`app.js`)

```
DOMContentLoaded → new StockWatchApp() → init()
  ├─ _initTheme()
  ├─ _bindPriceActionEvents()                     (works with no API key set)
  ├─ if (!ConfigManager.hasFinnhubKey()) → _showSetup(true)  → STOP
  └─ _bootApp()
       ├─ dataStore.init()      → firebase.initializeApp + enablePersistence + connectivity probe
       │                          + one-time localStorage→Firestore migration
       ├─ _initWebSocket()
       ├─ loadEntries()
       ├─ _computeDataDates()
       ├─ _initAddSectionToggle()
       └─ _bindEvents()
```

### 1.5 Security posture today

```javascript
// firestore.rules  (and storage.rules — identical policy)
match /{document=**} { allow read, write: if true; }
```

* **No Firebase Auth usage anywhere in the client.**
* Anyone who knows the project id can read and write everything with the public API key.
* This is why the app needs *no login* — and why "multi-user" cannot be done with rules alone.

### 1.6 Not user data (unchanged by this proposal)

Static knowledge-base pages are public assets with no user data: `Patterns.html`, `patterns4.html`,
`patterns-kb.js`, `level2v2.html`, `VPA.html`, `vpa-core.html`, `vpa_learning.html`,
`Structural Stop 1.html`, `VPA Case Study 1.html`. They are opened in new tabs from the
VPA / Learning / Price Action menus and are not affected by this design.

---

## 2. The 4-digit PIN reality check

### 2.1 Entropy and cracking cost

A 4-digit PIN has 10 000 combinations = **13.29 bits** of entropy.

| Attacker capability | Time to exhaust the keyspace |
|---|---|
| Offline fast hash (MD5/SHA-1, single GPU) | **under 1 millisecond** |
| Offline PBKDF2-SHA256, 600 000 iterations (~100 ms/guess) | ~17 minutes |
| Offline Argon2id, 64 MB, t=3 (~500 ms/guess) | ~83 minutes (and 500 GB RAM for parallel guessing) |
| Online, no throttling | seconds |
| Online, throttled: 5 attempts then exponential lockout | years |

### 2.2 Consequences

1. A 4-digit PIN is only as strong as its **verifier's throttling**, so the verifier must not live in
   the browser for any data worth protecting.
2. The PIN is an *"unlock this trusted device for this person"* factor, **not** an account password.
   The real security boundary is a **server-issued session** (Firebase Auth ID token) plus
   **deny-by-default rules**.
3. Because the PIN is short, unlock sessions should be reasonably long-lived (do not re-prompt every
   few minutes) and device-loss cases must be handled by **auto-lock + sign-out**.

### 2.3 Attack surface: before → after

| Vector | Today | After (Option A or B) |
|---|---|---|
| Stranger with the URL + project id calls the Firestore REST API | **full read/write of all data** | denied — requires a live ID token |
| Guessing PINs | n/a (no gate exists) | rate-limited / locked server-side |
| Reading a stored PIN hash on a shared laptop | n/a | nothing secret stored locally (only a `sessionStorage` unlock flag) |
| Stolen unlocked browser | n/a | 15-minute idle auto-lock, `signOut()` on lock and on user switch |
| Static knowledge-base pages | public | public (accepted — they contain no user data) |

---

## 3. Design options

### 3.1 Option A — Auth-backed PIN (smallest change, real server verification)

Each profile maps to a Firebase Auth **email/password** account:

* `profileId = "dan"` → email `dan@tradrdash.local`
* password = `pin + PROFILE_SALT` (a constant such as `"$TradrDash!"`, because Firebase Auth requires
  at least 6 characters)
* flow: `firebase.auth().signInWithEmailAndPassword(email, pin + SALT)` → ID token → rules use
  `request.auth.uid`

**Pros:** no Cloud Functions and **no PIN hash stored anywhere**; Firebase Auth performs the hashing
(scrypt) and has built-in abuse throttling (`auth/too-many-requests`); smallest code footprint.

**Cons:** the PIN→password mapping is visible in client JS (it does not reveal the PIN, but it is
public); PIN change needs a recent login; profile creation is client-side
(`createUserWithEmailAndPassword`) unless a small admin function is added; the lockout policy is
Firebase's and there is no audit trail.

### 3.2 Option B — Server-verified PIN with custom tokens (strongest control)

* `profiles/{profileId}` holds display metadata plus auth metadata.
* PIN material lives in a **client-unreadable** document: `pin_secrets/{profileId}`
  (`allow read, write: if false` → Admin SDK only), so it can never be downloaded and brute-forced
  offline.
* Cloud Function `verifyPin(profileId, pin)`: lockout check → Argon2id verify → counters →
  `admin.auth().createCustomToken(profileId, { profileId, role })`.
* Client: `signInWithCustomToken(token)` → ID token → per-user rules.
* Supporting functions: `createProfile`, `changePin`, `resetPin`, `migrateOwner`.

**Pros:** your own lockout policy, Argon2id, audit log, admin reset tooling; the uid is
**deterministic** (`= profileId`) so data paths are stable across devices; nothing client-visible.

**Cons:** more code and moving parts (Admin SDK, Secret Manager for a pepper), needs Blaze (already
enabled), roughly 2.5 days of extra work.

### 3.3 Option C — Local-only PIN (convenience profile switcher, no security)

Profiles and PINs live only in the browser; data separation is local; Firestore keeps its current
open rules unless the migration is also performed.

**Pros:** fastest to ship, zero backend risk.
**Cons:** **no cloud data isolation at all** — every browser with the URL still sees everything.

### 3.4 The verifier abstraction (why the decision can be deferred)

The lock UI, session/idle model, data paths, cache keys, rules shape and migration are **identical**
in all three options. The only real difference is *where the PIN is checked*, so the client should
depend on a one-method interface and select the implementation with a config flag.

```js
// js/auth.js  (new file)
/** @typedef {{ verify(profileId: string, pin: string): Promise<{uid: string, claims: object}> }} PinVerifier */

const AuthPasswordVerifier = {           // Option A — Firebase Auth email/password
  async verify(profileId, pin) {
    const cred = await firebase.auth()
      .signInWithEmailAndPassword(`${profileId}@tradrdash.local`, pin + PROFILE_SALT);
    return { uid: cred.user.uid, claims: {} };
  }
};

const CloudFunctionVerifier = {          // Option B — verifyPin → custom token
  async verify(profileId, pin) {
    const fn = firebase.functions().httpsCallable('verifyPin');
    const { data } = await fn({ profileId, pin });   // throws resource-exhausted when locked
    const cred = await firebase.auth().signInWithCustomToken(data.customToken);
    return { uid: cred.user.uid, claims: data.claims };
  }
};

const LocalPinVerifier = {               // Option C — dev / UX prototype only (no real security)
  async verify(profileId, pin) { /* compare a PBKDF2 verifier held in localStorage */ }
};

// selected via a single config value:
//   window.AUTH_MODE = 'auth-password' | 'cloud-pin' | 'local'
```

**Consequence:** switching from A to B later is a config change plus one deployed function — no UI,
rules or data-model rework.

### 3.5 Weighted decision matrix

Scores 1–5 (5 = best). Weights assume a private family/team dashboard.

| Criterion | Weight | A (Auth password) | B (Function + custom token) | C (local only) |
|---|---|---|---|---|
| Data privacy vs a determined outsider | 30 % | 5 | **5** | **1** |
| Protection on a shared or lost device | 20 % | 4 | 4 | 2 |
| Control of lockout / audit / admin reset | 15 % | 2 | **5** | 1 |
| Fits "no accounts, no emails, just a PIN" | 15 % | 4 | **5** | 5 |
| Effort / complexity | 10 % | **4** | 2 | **5** |
| Cost | 5 % | **5** | 4 | 5 |
| Reversibility | 5 % | 4 | 4 | **5** |
| **Weighted total** | | **4.15** | **4.35** | **2.20** |

Rules of thumb:

* **Choose B** if anyone other than you will use this and their notes/reviews must stay private, or
  if you want your own lockout policy, PIN-reset flow and audit trail.
* **Choose A** for a real lock with the least code, accepting Firebase's throttling and no audit log.
* **Choose C** only while prototyping the UX — it protects nothing in the cloud.

---

## 4. Wireframes

### 4.1 Lock overlay

Shown on top of the app at start-up when there is no live unlock session. The dashboard behind it is
blurred and non-interactive (`filter: blur(6px); pointer-events: none`).

```
┌────────────────────────────────────────────────────────────────────────────┐
│   (dashboard behind, blurred + inert)                                      │
│                                                                            │
│      ┌──────────────────────────────────────────────────────────────┐      │
│      │                    📈 TradrDash                              │      │
│      │               Who's trading today?                           │      │
│      │                                                              │      │
│      │      ┌────────┐   ┌────────┐   ┌────────┐                    │      │
│      │      │   D    │   │   A    │   │   J    │                    │      │
│      │      │  Dan   │   │  Ana   │   │  Jae   │  ← profile chips   │      │
│      │      └────────┘   └────────┘   └────────┘    (profiles/{id}) │      │
│      │                                                              │      │
│      │                    Enter PIN for Dan                         │      │
│      │                     ● ● ○ ○                                │      │
│      │                                                              │      │
│      │            ┌─────┬─────┬─────┐                             │      │
│      │            │  1  │  2  │  3  │                             │      │
│      │            │  4  │  5  │  6  │   also accepts the          │      │
│      │            │  7  │  8  │  9  │   physical number keys      │      │
│      │            │  ⌫  │  0  │  ⏎  │                             │      │
│      │            └─────┴─────┴─────┘                             │      │
│      │                                                              │      │
│      │   ⚠ Incorrect PIN — 4 attempts left                          │      │
│      │   [ Switch profile ]                            [ Lock now ]  │      │
│      └──────────────────────────────────────────────────────────────┘      │
└────────────────────────────────────────────────────────────────────────────┘
```

### 4.2 Locked-out state (after 5 failures)

Server-driven, survives a page refresh, and disables the keypad until the countdown expires.

```
│      │   🔒 Too many attempts. Try again in  4:58                     │
│      │   Forgot your PIN? Ask the owner to reset it.                  │
```

### 4.3 First-run profile creation

Shown once per profile. Creating the **owner** profile is gated by an owner code; later profiles can
be created by the owner (`createProfile` function) or by open signup — see §13.

```
│  Create your profile                                                  │
│  Display name  [ Dan____________________ ]                            │
│  Your PIN      [ ●  ●  ○  ○ ]   (4 digits)                            │
│  Confirm PIN   [ ●  ●  ○  ○ ]                                         │
│  ℹ This PIN unlocks your own watch list, notes and reviews on any     │
│    device. Because it is only 4 digits, guesses are rate-limited.      │
│  [ Create profile ]      [ Cancel ]                                    │
```

### 4.4 Header and menu additions

```
header-right:  [ Wisdom ▾ ][ VPA ▾ ][ Learning ▾ ][ Price Action ▾ ][ ⚙️ ][ 🔍 ][ ☀️ ][ 👤 Dan ▾ ]
                                                                                        │
        👤 Dan ▾ ──┬─ Switch user…                                                      │
                   ├─ Change PIN…                                                       │
                   └─ Lock now                                                          │
                                                                                        │
⚙️ settings dropdown gains:   🔒 Lock now          🔑 Change PIN
```

### 4.5 PIN entry rules

* PIN is never echoed — only four masked dots.
* No `autocomplete`, no browser password manager involvement, `inputmode="numeric"`.
* Physical number keys work (desktop) in addition to the on-screen keypad (touch).
* `Enter` (or the ⏎ key) submits automatically once four digits are entered.
* After 5 failures the keypad is disabled and the countdown banner is shown, preventing key mashing.
* The unlock flag lives in `sessionStorage`, so a browser restart always requires the PIN again.

---

## 5. Target architecture

### 5.1 Components

```
Browser (per device): index.html + app.js
 ├─ NEW  js/auth.js        AuthManager { init, listProfiles, createProfile, unlock, lock,
 │                                        switchUser, changePin, onIdle, currentUid }
 │         └── PinVerifier strategy: AuthPasswordVerifier | CloudFunctionVerifier | LocalPinVerifier
 ├─ MOD  js/firestore.js   DataStore.setProfile(uid) → users/{uid}/{watchlist|daily_notes|trade_reviews}
 ├─ MOD  js/storage.js     uploadImage → trade-images/{uid}/{reviewId}/{file}
 ├─ MOD  js/config-manager.js / index.html / css/style.css  (lock overlay, profile chip, menu items)
 └─ boot gate              await AuthManager.requireUnlocked()  →  then the existing API-key gate

Firebase Auth ──► ID token ──► Firestore + Storage rules (deny by default, per-uid paths)

Cloud Functions (v2, TypeScript)
 ├─ yahooKeyStats        (existing — unchanged)
 └─ verifyPin, createProfile, changePin, resetPin, migrateOwner   (new)
```

### 5.2 Identity and profile model

```jsonc
// profiles/{profileId}            ← world-readable BUT non-sensitive only (profile picker)
{ "profileId": "dan", "displayName": "Dan", "avatarColor": "#3b82f6",
  "active": true, "role": "member",        // 'owner' | 'member'
  "createdAt": "2026-09-17T...", "lastSeenAt": "2026-09-17T...",
  "authUid": "…" }                          // Option A only (Auth uid is random)

// pin_secrets/{profileId}         ← rules: allow read, write: if false  (Admin SDK only)
{ "pinHash": "<argon2id or scrypt>", "salt": "<random 16 bytes>", "algo": "argon2id",
  "iterations": 3, "memoryKib": 65536,
  "failedAttempts": 0, "lockedUntil": null, "updatedAt": "…" }
```

**Why two collections:** the PIN verifier must never be downloadable — otherwise the 13-bit space
becomes an offline brute force. `profiles` feeds the lock-screen picker; `pin_secrets` is server-only.
With Option A there is no `pin_secrets` document at all.

### 5.3 Per-user data model

| Today | Target |
|---|---|
| `watchlist/{entryId}` | `users/{uid}/watchlist/{entryId}` |
| `daily_notes/{noteId}` | `users/{uid}/daily_notes/{noteId}` |
| `trade_reviews/{reviewId}` | `users/{uid}/trade_reviews/{reviewId}` |
| Storage `trade-images/{reviewId}/…` | Storage `trade-images/{uid}/{reviewId}/…` |

Document **shapes are unchanged** (no field renames), so `DataStore` methods and all UI code keep
working — only the collection paths become scoped. Subcollections are preferred over a `profileId`
field on shared collections because the rules stay trivial and no composite indexes are required.

Local cache keys become profile-scoped:

```
stockwatchlist_{uid}_data
stockwatchlist_{uid}_daily_notes
stockwatchlist_{uid}_trade_reviews
stockwatchlist_theme                         ← device-level (recommended)
stockwatchlist_hide-dates                    ← device-level (recommended)
stockwatchlist_add-section-collapsed         ← device-level (recommended)
stockwatchlist_{uid}_risk_settings           ← per-profile (recommended)
stockwatchlist_config                        ← device-level API keys (recommended)
```

### 5.4 Security rules (draft — do not deploy before §8 phase P3)

```javascript
// firestore.rules
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    // Profile directory — safe fields only, used by the lock screen
    match /profiles/{profileId} {
      allow read: if true;
      allow write: if false;              // Cloud Functions (Admin SDK) bypass rules
    }

    // PIN material — never readable or writable from any client
    match /pin_secrets/{profileId} {
      allow read, write: if false;
    }

    // Private per-user data (watchlist, daily_notes, trade_reviews)
    match /users/{uid}/{doc=**} {
      allow read, write: if request.auth != null && request.auth.uid == uid;
    }

    // Everything else (incl. the legacy top-level collections) is closed
    match /{document=**} { allow read, write: if false; }
  }
}
```

```javascript
// storage.rules
rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {
    match /trade-images/{uid}/{allPaths=**} {
      allow read, write: if request.auth != null && request.auth.uid == uid;
    }
    // legacy images stay readable so screenshots in old notes/reviews keep loading
    match /trade-images/{legacyId}/{allPaths=**} {
      allow read: if true;
      allow write: if false;
    }
  }
}
```

### 5.5 Session, lock and idle model

| Concern | Design |
|---|---|
| What unlocks | `verify()` success — `signInWithEmailAndPassword` (A) or `verifyPin` + `signInWithCustomToken` (B) |
| Session lifetime | Firebase ID token (1 h, auto-refreshed while the tab is open); the *unlock* flag lives in **`sessionStorage`** so closing the browser requires the PIN again |
| Auto-lock | Idle timer, default **15 min** (configurable), plus lock when the tab is hidden longer than the timeout → flush pending debounced saves → `signOut()` → overlay |
| Switch user | Header chip → "Switch user" → flush → `signOut()` → clear that profile's local cache → lock overlay |
| Change PIN | Settings → Change PIN: current PIN re-verified, then new PIN + confirm (B: `changePin` function; A: `reauth` + `updatePassword`) |
| Forgot PIN | `resetPin` function callable only by `role == 'owner'`, or a console-side Admin action; both append to `auth_log` |
| Token revocation | `admin.auth().revokeRefreshTokens(uid)` on PIN reset; note an already-issued ID token stays valid up to 1 h (acceptable, or gate sensitive writes on `auth_time` in rules) |
| Offline | A or B: unlock requires connectivity; the last unlocked profile keeps working offline through the persisted token + Firestore offline cache. Optional offline unlock: cache a PBKDF2-SHA256 (≥ 600 000 iterations, per-device salt) verifier for the last profile only — explicitly UX-only, disabled by default |

### 5.6 Client module changes

| File | Change |
|---|---|
| **NEW** `js/auth.js` | `AuthManager` singleton: `init`, `listProfiles`, `createProfile`, `unlock`, `lock`, `switchUser`, `changePin`, `onIdle`, `currentUid`, `currentProfile`, `isUnlocked`, events `auth:unlocked` / `auth:locked` |
| **MOD** `js/firestore.js` | add `setProfile(uid)`; replace the 3 hard-coded collection names and `collectionName`; namespace the 4 localStorage helpers; add `clearLocalCacheFor(uid)` |
| **MOD** `js/storage.js` | prefix paths with the uid; fix `deleteReviewImages` folder lookup |
| **MOD** `js/app.js` | boot gate `await AuthManager.requireUnlocked()` before the API-key check; handle `auth:locked` (flush + clear in-memory state + show overlay); wire the header chip |
| **MOD** `index.html` | lock overlay markup, profile chip, "Lock now" / "Change PIN" menu items, `firebase-auth-compat.js` script tag |
| **MOD** `css/style.css` | overlay, chips, keypad, dots, lockout banner, blur backdrop |
| **MOD** `js/config-manager.js` | unchanged if API keys stay device-level (recommended); otherwise `stockwatchlist_{uid}_config` |
| **MOD** `functions/src/index.ts` | add `verifyPin`, `createProfile`, `changePin`, `resetPin`, `migrateOwner` (Option B); leave `yahooKeyStats` untouched |
| **MOD** `firestore.rules`, `storage.rules` | per §5.4 |

---

## 6. Data flow

### 6.1 Unlock → read → write

```
[PIN entered] → AuthManager.unlock(profileId, pin)
    → verify()  (Firebase Auth  |  verifyPin Cloud Function → custom token)
    → getIdToken()  →  DataStore.setProfile(user.uid)  →  sessionStorage.setItem('td_unlocked','1')
    → app._bootApp()  →  dataStore.init()
    → Firestore: users/{uid}/watchlist  orderBy createdAt desc
    → WebSocket / OTC polling unchanged  →  render

[write]  dataStore.updateEntry(id, patch)
    → users/{uid}/watchlist/{id}                      (rules: request.auth.uid == uid)
    → on failure → localStorage['stockwatchlist_{uid}_data'] with _localOnly (unchanged behaviour)
```

### 6.2 Lock / switch

```
idle 15 min or "Lock now" or "Switch user"
    → flush debounced saves (daily notes, stock review, trade review)
    → firebase.auth().signOut()
    → sessionStorage.removeItem('td_unlocked')   (and localStorage cache cleared on switch)
    → blur dashboard + show lock overlay
```

---

## 7. Operations and cost

### 7.1 Cost model

Assumptions: 5 profiles, ~50 watchlist entries each, ~300 daily notes, ~200 trade reviews,
~600 screenshots (~300 KB each ≈ 180 MB).

| Service | Forecast usage | Free tier (at time of writing) | Verdict |
|---|---|---|---|
| Firestore reads | ~200–400 per app load; ~15–40 k/month | 50 k/day | free — but see §7.2 |
| Firestore writes | ~2–5 k/month | 20 k/day | free |
| Firestore storage | < 20 MB | 1 GiB | free |
| Firebase Auth | 5 MAU | 50 k MAU | free |
| Cloud Functions | `verifyPin` ~20/day + a few admin calls | 2 M invocations, 400 k GB-s/month | free (Blaze already enabled) |
| Storage | ~180 MB stored, ~2 GB/month egress | 5 GB stored, ~1 GB/day egress | free |
| Secret Manager (Argon2 pepper) | 1 secret, thousands of accesses | 6 versions free, negligible access cost | ~free |
| App Check (reCAPTCHA v3) | all Firestore/Functions/Storage calls | free | **enable it** — blocks scripted abuse |
| Cloud Logging / Monitoring | audit log + alerts | 50 GiB/month | free |

**Bottom line:** at this scale the feature should stay inside the free tier; the only genuinely new
"cost" is a possible 1–2 s cold start on `verifyPin`. Mitigation: ping a lightweight `ping` function
when the lock overlay renders (one extra invocation per unlock attempt, still negligible) instead of
paying for `minInstances`.

### 7.2 Performance and cost hot spots to fix while migrating

1. `DataStore.getAllNotes()` / `getAllNoteDates()` fetch **every** note document; with per-user paths
   this is at least scoped, but add a bounded date range.
2. `enablePersistence({ synchronizeTabs: true })` is per browser, not per user — clear the previous
   profile's cache on user switch or a second user can see stale rows.
3. `ImageStorage.deleteReviewImages()` lists a folder by id; it must use the new
   `trade-images/{uid}/{reviewId}` prefix or it will fail under the new rules.
4. Two tabs with two different profiles: enforce a single-profile-per-browser invariant via a
   `storage` event listener that forces a switch.

### 7.3 Operations runbook

| Task | How |
|---|---|
| Add a profile | `createProfile` function (owner-gated) or open signup if enabled |
| Disable a profile | server-side `profiles/{id}.active = false` (blocks `verifyPin` and sign-in) |
| Reset a forgotten PIN | owner → `resetPin`; append to `auth_log` |
| Force everyone to re-authenticate | `admin.auth().revokeRefreshTokens(uid)` per profile |
| Rotate the Argon2 pepper | new Secret Manager version; re-hash on next successful unlock (`changePin` path) |
| Detect brute-force attempts | query `auth_log`: failures per profile per hour; alert above ~20/h |
| Backup | weekly Firestore managed export + bucket lifecycle (90 days); export before **any** rules change |
| Deploy | existing `deploy.bat` → `firebase deploy --only hosting,firestore:rules,storage,functions` |
| Rollback rules | keep a copy of today's open rules (e.g. `firestore.open.rules.bak`) and redeploy them |
| Rollback client | Hosting version rollback in the Firebase console |
| Environments | keep prod `stockwatchlist-momentum`; add a dev project + local `firebase emulators:start` |

### 7.4 Service-level objectives

| Metric | Target |
|---|---|
| Unlock (warm function) p95 | < 1.5 s |
| App boot after unlock p95 | < 2.5 s |
| Cross-user read errors | 0 |
| Failed PIN attempts triggering lockout | 100 % logged in `auth_log` |
| Firestore/Auth error rate | < 0.5 % of operations |

### 7.5 Configuration decisions with cost/perf impact

* Keep `enablePersistence` on (offline UX) but clear cache per profile switch.
* Keep `serializeTabs` semantics; do not open two profiles in one browser.
* Keep the static KB pages public (no auth) — they are plain HTML with no user data.

---

## 8. Migration plan (existing shared data → first profile)

Phases are independently deployable and reversible. **Rules are only tightened after the copy is
verified.**

| Phase | Steps | Verification | Rollback |
|---|---|---|---|
| **P0 Prep** | enable Firebase Auth; add `firebase-auth-compat.js`; deploy `migrateOwner` with `dryRun: true` | function deployed; Auth enabled | redeploy previous function set |
| **P1 Copy** | run `migrateOwner` (dry-run → real): additive copy of `watchlist`, `daily_notes`, `trade_reviews` into `users/{ownerUid}/…`; copy Storage objects to `trade-images/{uid}/…`; rewrite image URLs inside note/review bodies | count parity per collection; open ~5 notes and ~5 reviews and confirm images render | additive only — delete the new subcollections |
| **P2 Client** | ship `js/auth.js` + lock overlay + `DataStore.setProfile()`; client reads per-user paths; legacy collections are a read-only fallback | E2E: unlock, add/edit/delete entry, note, review, image paste | Hosting rollback; data untouched |
| **P3 Lockdown** | deploy the §5.4 rules | direct REST call with the API key and **no token** → denied; profile B cannot read profile A's data | redeploy the open rules copy |
| **P4 Cleanup** | after a cooling-off period, delete the legacy top-level collections and the old local cache keys | — | restore from the P1 export |
| **P5 Harden** | audit log alerts, App Check, optional 6-digit PIN, optional passkey/WebAuthn | synthetic 20-guess attack test | — |

**Pre-flight:** take a Firestore managed export and a copy of the Storage bucket **before P1**, and
keep them until P4.

### 8.1 Migration pseudocode

```js
// functions/src/migration.ts  (Admin SDK; dryRun defaults to true)
async function migrateOwner(ownerUid, { dryRun }) {
  for (const coll of ['watchlist', 'daily_notes', 'trade_reviews']) {
    const docs = await db.collection(coll).get();
    for (const doc of docs.docs) {
      const body = doc.data();
      // rewrite Storage URLs so screenshots keep working after the path move
      body.notesHtml = rewriteImageUrls(body.notesHtml, doc.id, ownerUid);
      body.contentMd  = rewriteImageUrls(body.contentMd,  doc.id, ownerUid);
      if (!dryRun) {
        await db.doc(`users/${ownerUid}/${coll}/${doc.id}`).set(body, { merge: true });
      }
    }
    logger.info(`${coll}: ${docs.size} docs ${dryRun ? 'would be' : ''} copied`);
  }
  // then copy objects trade-images/{legacyId}/** → trade-images/{ownerUid}/{legacyId}/**
}
```

**Parity gate before P3:** document counts match per collection, images render in spot-checked
records, and both a fresh browser and a returning browser behave correctly.

---

## 9. Code-touch map (size of the change)

| File | Change | Rough size |
|---|---|---|
| `js/auth.js` *(new)* | `AuthManager` + 3 verifier strategies + idle timer + profile cache | ~350 lines |
| `index.html` | lock overlay markup, profile chip, 2 menu items, `firebase-auth-compat.js` tag | ~90 lines |
| `css/style.css` | lock overlay, chips, keypad, dots, lockout banner, blur backdrop | ~180 lines |
| `js/firestore.js` | `setProfile(uid)`; scoped collection names; namespaced local keys; cache clear on switch | ~60 lines changed |
| `js/storage.js` | uid prefix on upload/delete paths | ~15 lines changed |
| `js/app.js` | boot gate in `init()`; `auth:locked` handler; header chip wiring | ~70 lines added |
| `js/config-manager.js` | only if API keys become per-profile (recommended: leave unchanged) | 0–20 lines |
| `firestore.rules`, `storage.rules` | per §5.4 | ~30 lines total |
| `functions/src/index.ts` | `verifyPin`, `createProfile`, `changePin`, `resetPin`, `migrateOwner` (Option B) | ~400 lines TS |
| Tests | rules-emulator suite + headless-Edge E2E + attack script | ~250 lines |

---

## 10. Test matrix

| # | Test | Expected |
|---|---|---|
| T1 | Unauthenticated Firestore REST read of `users/*/watchlist` | `PERMISSION_DENIED` |
| T2 | Profile A's token reads `users/{B}/trade_reviews` | `PERMISSION_DENIED` |
| T3 | Any client reads `pin_secrets/{id}` | `PERMISSION_DENIED` |
| T4 | Any client writes `profiles/{id}` | `PERMISSION_DENIED` |
| T5 | 25 sequential wrong PINs | 5th failure locks; `423` + countdown; `auth_log` rows written |
| T6 | Correct PIN after the lockout window | unlocks; counters reset |
| T7 | Switch A → B, then inspect DOM + local cache | no trace of A's data in B's session |
| T8 | Idle beyond the timeout | overlay shown, pending saves flushed, token revoked |
| T9 | Offline with a valid token / offline without | boots from cache / prompts for a connection |
| T10 | Image paste as A, then as B | stored under `trade-images/{A}/…`, invisible to B |
| T11 | Delete a review that has images | folder under `{uid}` deleted, no orphans |
| T12 | Migration parity | counts equal; spot-checked notes/reviews render images |
| T13 | `node --check` + headless-Edge smoke test on every deploy | 0 console errors |

Test harness notes:

* **Rules tests** — Firebase Emulator Suite with `@firebase/rules-unit-testing` (T1–T4, T10).
* **UI tests** — the headless-Edge pattern already used in this repo: copy the app to `%TEMP%`,
  inject a harness script, stub `firebase.auth()` / `window.open`, assert on
  `document.title = "RESULT|…"`, then delete the harness (T5–T11).
* **Attack test** — scripted loop of 25 bad PINs against a staging profile (T5).

---

## 11. Risks and mitigations

| Risk | Severity | Mitigation |
|---|---|---|
| Rules tightened before/during the data copy → "lost data" | High | additive copy first, parity gate, export before P1 and P3 |
| Two profiles open in two tabs of one browser | High | single-profile-per-browser invariant; `storage` event listener forces a switch + cache clear |
| Legacy image URLs 404 after the Storage path move | Medium | keep the legacy read path **or** rewrite URLs in P1 (both documented) |
| Local cache bleed between profiles | High | key namespacing + test T7 |
| Cloud Function cold start on unlock | Low | ping-warm on overlay render; `maxInstances: 5` |
| `verifyPin` abuse / cost | Medium | App Check + lockout table + per-IP quota |
| 4-digit PIN shoulder-surfed | Medium | masked dots, 15-min session, auto-lock, optional 6-digit upgrade |
| Non-owner resets someone's PIN | Medium | server-side `role == 'owner'` check + audit log |
| Offline unlock weakens the model | Medium | off by default; if enabled, use a strong KDF verifier and warn in the UI |
| Firebase Auth provider not enabled / domain not authorised | Low | test in the emulator; enable the provider and App Check before deploy |
| Cloud Functions require Blaze | Low | already on Blaze (existing function + Storage) |
| A stale ID token remains valid after a PIN reset (≤ 1 h) | Low | accept, or check `auth_time` in rules for sensitive writes |

---

## 12. Phased delivery — what is protected after each phase

| Phase | Ships | Protection gained | Effort |
|---|---|---|---|
| **P0** | Auth enabled; `profiles` + `pin_secrets` collections; `js/auth.js` with `LocalPinVerifier`; lock overlay; profile chip | UX separation only (Option C behaviour) | 1.5 d |
| **P1** | `DataStore` / `ImageStorage` scoping; cache namespacing; migration dry-run | correct per-user layout (still an open gateway until P3) | 1 d |
| **P2** | **either** `AuthPasswordVerifier` **or** `verifyPin` + custom tokens, selected by `AUTH_MODE` | **real PIN gate** | 1 d (A) / 2.5 d (B) |
| **P3** | migration executed; rules tightened; legacy read-only | cloud data is no longer world-readable | 0.5 d |
| **P4** | PIN change, owner reset, audit log, idle/auto-lock tuning, App Check | admin + hardening | 1 d |
| **P5** | optional 6-digit PIN, passkeys/WebAuthn, per-profile API keys | future-proofing | 1–3 d |

**Key ordering insight:** P0 and P1 are option-independent and can be built at any time; the
A-vs-B decision only lands at P2 and is a one-line `AUTH_MODE` change plus (for B) one function
deployment.

---

## 13. Open questions (to decide before P2)

1. **Auth model** — Option A, B or C? (deferrable to P2 via `AUTH_MODE`)
2. **Who may create profiles** — owner code only, or open signup for anyone who opens the app?
3. **API keys** — device-level (recommended, one set per browser) or per-profile?
4. **Preference scoping** — `theme` / `hide-dates` / `add-section-collapsed` device-level
   (recommended) and `risk settings` per-profile?
5. **Idle auto-lock timeout** — 5 / 15 / 30 / 60 minutes, or off?
6. **Offline unlock** — allow for the last profile (weaker) or require connectivity (stronger)?
7. **Migration target** — move today's shared data into one "Owner" profile, or start clean?
8. **Do we rename the app/branding** in the UI as part of this work, or keep TradrDash as is?

---

## Appendix — small related items deferred

These were noticed during recent work and are unrelated to multi-user; they are recorded here only so
they are not forgotten:

1. `js/app.js` still contains two now-unreachable branches for the removed Price Action menu entries
   (`action === 'volume-analysis'` and `action === 'volume-price-analysis'`, around lines 3243–3245).
   They cannot fire because the buttons no longer exist; safe to delete whenever convenient.
2. The first-run setup overlay heading (`index.html`, ~line 22) still reads
   "Welcome to Stock Watch List" after the rename to TradrDash.
3. `README.md` and `AI_SUMMARY.md` still describe the app as "Stock Watch List" and describe the
   learning dropdowns as "Wisdom / Rules / Playbook" without the newer Learning hub and VPA items.
