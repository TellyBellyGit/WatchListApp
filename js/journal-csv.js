// ============================================================================
// JOURNAL CSV — the A–Z import format + the shared trade arithmetic
// ============================================================================
// Two jobs, and this file does no DOM work at load time so it can be loaded by
// TradeJournal.html and exercised straight from Node (see tests/).
//
//   1. Turn a pasted / dropped CSV into journal-entry documents. Every column is
//      addressed by the LETTER the user sees in Day_Trading_Journal.xlsx, so a
//      hand-made sheet, an Excel copy-paste and a row written by any other tool
//      all read the same way.
//   2. Own the arithmetic — per-share P&L, net P&L, %, trade duration and the
//      R-multiple. `computeTradeNumbers()` is called by the live Numbers strip,
//      by _collectForm() and by the import, so the form, an imported row and the
//      summary table can never disagree.
//   3. Own the session maths — several legs of one ticker on one day are ONE
//      session, never one row. See the GROUPS section at the bottom: it rolls a
//      session up from the rows and stamps the group id the import writes.
//
// Accepted CSV shapes (all detected automatically, in this order):
//   A,B,C,…                      letters on their own row (what buildExample writes)
//   A · Date,B · Ticker,…        the letters with the sheet header behind them
//   Date,Ticker,Timeframe,…      names only ("Outcome / P&L", "entry price", …)
// A file with 13 columns and no recognisable header is read positionally as A–M.
//
// Only the columns a row needs must be present: any subset of the 26 letters
// works, in any order, with the missing ones left blank.
//
// Field map (A–M are the 13 journal columns of the sheet, N–Z the timing,
// price and meta fields the sheet keeps beside them):
//   A date         B ticker       C timeframe   D category    E setup
//   F entryTrigger G whyEntered   H whatWentWrong I whyItWentWrong J advice
//   K keyLesson    L outcome      M review
//   N direction    O entryDate    P entryTime   Q entryPrice  R exitDate
//   S exitTime     T exitPrice    U shares      V fees        W plannedRiskR
//   X strategy     Y tags         Z processScore
//
// One field has NO letter: `groupId` (label "Group") carries the opaque id of
// the session a row belongs to. All 26 letters are spoken for by the sheet (and
// the positional fallback counts on that), so it is only ever matched by name —
// a file without the column simply says nothing about grouping.
// ============================================================================

const JOURNAL_CSV_FIELDS = [
  // ---- A–M: the 13 columns of Day_Trading_Journal.xlsx ----
  { letter: 'A', key: 'date',           label: 'Date',              group: 'column', type: 'date',
    hint: 'trade date (YYYY-MM-DD)' },
  { letter: 'B', key: 'ticker',         label: 'Ticker',            group: 'column', type: 'text',
    hint: 'symbol, e.g. NVDA' },
  { letter: 'C', key: 'timeframe',      label: 'Timeframe',         group: 'column', type: 'select',
    hint: 'chart timeframe, e.g. 5-min' },
  { letter: 'D', key: 'category',       label: 'Category',          group: 'column', type: 'select',
    hint: 'one of the 11 sheet categories (rough wording is matched)' },
  { letter: 'E', key: 'setup',          label: 'Setup',             group: 'column', type: 'select',
    hint: 'the setup name, e.g. Opening range break' },
  { letter: 'F', key: 'entryTrigger',   label: 'Entry / Trigger',   group: 'column', type: 'text',
    hint: 'what had to happen to enter' },
  { letter: 'G', key: 'whyEntered',     label: 'Why I Entered',     group: 'column', type: 'textarea',
    hint: 'the reason at the moment of entry' },
  { letter: 'H', key: 'whatWentWrong',  label: 'What Went Wrong',   group: 'column', type: 'textarea',
    hint: 'what price actually did' },
  { letter: 'I', key: 'whyItWentWrong', label: 'Why It Went Wrong', group: 'column', type: 'textarea',
    hint: 'the real cause' },
  { letter: 'J', key: 'advice',         label: 'Advice / Correction', group: 'column', type: 'textarea',
    hint: 'the fix, as one instruction' },
  { letter: 'K', key: 'keyLesson',      label: 'Key Lesson',        group: 'column', type: 'textarea',
    hint: 'one sentence worth remembering' },
  { letter: 'L', key: 'outcome',        label: 'Outcome / P&L',     group: 'column', type: 'text',
    hint: 'optional — computed from N–W when left blank' },
  { letter: 'M', key: 'review',         label: 'Review',            group: 'column', type: 'textarea',
    hint: 'cold look back at the trade' }
];

JOURNAL_CSV_FIELDS.push(
  // ---- N–T: the timing and the prices (always visible in the form) ----
  { letter: 'N', key: 'direction',      label: 'Direction',         group: 'trade', type: 'select',
    hint: 'long or short (buy/sell accepted)' },
  { letter: 'O', key: 'entryDate',      label: 'Entry date',        group: 'trade', type: 'date',
    hint: 'date of the entry (YYYY-MM-DD); defaults to column A' },
  { letter: 'P', key: 'entryTime',      label: 'Entry time',        group: 'trade', type: 'time',
    hint: 'entry clock time, e.g. 09:41' },
  { letter: 'Q', key: 'entryPrice',     label: 'Entry price',       group: 'trade', type: 'number',
    hint: 'fill price of the entry' },
  { letter: 'R', key: 'exitDate',       label: 'Exit date',         group: 'trade', type: 'date',
    hint: 'only needed when the trade runs past midnight' },
  { letter: 'S', key: 'exitTime',       label: 'Exit time',         group: 'trade', type: 'time',
    hint: 'exit clock time, e.g. 09:47' },
  { letter: 'T', key: 'exitPrice',      label: 'Exit price',        group: 'trade', type: 'number',
    hint: 'fill price of the exit' },

  // ---- U–Z: size, risk and meta ----
  { letter: 'U', key: 'shares',         label: 'Shares',            group: 'size', type: 'int',
    hint: 'size, in shares' },
  { letter: 'V', key: 'fees',           label: 'Fees',              group: 'size', type: 'number',
    hint: 'commissions + fees ($, always subtracted)' },
  { letter: 'W', key: 'plannedRiskR',   label: 'Planned risk 1R ($)', group: 'size', type: 'number',
    hint: 'what 1R was worth in dollars, for the R-multiple' },
  { letter: 'X', key: 'strategy',       label: 'Strategy',          group: 'meta', type: 'text',
    hint: 'free label for the playbook, e.g. ORB' },
  { letter: 'Y', key: 'tags',           label: 'Tags',              group: 'meta', type: 'list',
    hint: 'separated with ; or |, e.g. chase;size' },
  { letter: 'Z', key: 'processScore',   label: 'Process score',     group: 'meta', type: 'int',
    hint: 'how clean the execution was, 1–5' }
);

// One field has NO letter, and it is the only one: A–Z are all spoken for by the
// sheet's 26 columns (the positional fallback counts on that, and the tests pin
// it). The session's group id therefore travels as an extra column named
// "Group", matched by name only — a file that does not carry it has nothing to
// say about grouping, which is exactly right for a hand-made sheet.
JOURNAL_CSV_FIELDS.push(
  { letter: null, key: 'groupId', label: 'Group', group: 'meta', type: 'text',
    hint: 'opaque session id written by the app — rows sharing it are one session' }
);

// Hand-written names that mean the same thing as one of the letters above.
// Keys are normalised (lowercase, punctuation removed) by `_norm()`.
const JOURNAL_CSV_ALIASES = {
  date: 'date', tradedate: 'date', day: 'date',
  symbol: 'ticker', stock: 'ticker', sym: 'ticker',
  timeframe: 'timeframe', tf: 'timeframe',
  cat: 'category', categoryname: 'category',
  trigger: 'entryTrigger', entrytrigger: 'entryTrigger', entryrule: 'entryTrigger',
  whyientered: 'whyEntered', whyentered: 'whyEntered', reason: 'whyEntered',
  whatwentwrong: 'whatWentWrong',
  whyitwentwrong: 'whyItWentWrong', rootcause: 'whyItWentWrong',
  advice: 'advice', correction: 'advice', thefix: 'advice',
  lesson: 'keyLesson', keylesson: 'keyLesson', takeaway: 'keyLesson',
  pnl: 'outcome', netpnl: 'outcome', outcomepnl: 'outcome', outcome: 'outcome',
  review: 'review', notes: 'review',
  dir: 'direction', side: 'direction',
  entrydate: 'entryDate', entryday: 'entryDate',
  entrytime: 'entryTime',
  entryprice: 'entryPrice', entrypx: 'entryPrice', fillprice: 'entryPrice', entryfill: 'entryPrice',
  exitdate: 'exitDate', exitday: 'exitDate',
  exittime: 'exitTime',
  exitprice: 'exitPrice', exitpx: 'exitPrice',
  qty: 'shares', quantity: 'shares', size: 'shares',
  fees: 'fees', commissions: 'fees', commission: 'fees', costs: 'fees',
  risk: 'plannedRiskR', plannedrisk: 'plannedRiskR', plannedrisk1r: 'plannedRiskR', r1: 'plannedRiskR',
  strategy: 'strategy', playbook: 'strategy',
  tags: 'tags', tag: 'tags', labels: 'tags',
  score: 'processScore', processscore: 'processScore', process: 'processScore',
  // The letterless Group column (see JOURNAL_CSV_FIELDS) — reachable by name only
  group: 'groupId', groupid: 'groupId', session: 'groupId', sessionid: 'groupId',
  groupkey: 'groupId'
};

// Canonical example rows. Row 1 is the long NVDA trade the app already shows as
// its sample entry; row 2 is a short position entered late and closed after
// midnight, which is exactly what the separate exit date (column R) is for.
const JOURNAL_CSV_EXAMPLES = [
  {
    date: '2026-09-29', ticker: 'NVDA', timeframe: '5-min', category: 'Poor entry',
    setup: 'Opening range break',
    entryTrigger: 'Break of the opening-range high on above-average volume, 09:41',
    whyEntered: 'Opening range broke with volume expanding. The setup was on my plan for the day and the sector was strong.',
    whatWentWrong: 'Entered 0.40 above the trigger candle close instead of waiting for the retest of the level. Stop then sat 90c away instead of 35c.',
    whyItWentWrong: 'I had missed the first push, so I bought the extension instead of letting price come back to the level I had marked.',
    advice: 'When the first push is gone, wait for the retest of the breakout level. If it never comes back, there is no trade.',
    keyLesson: 'The setup was right, the entry location was too late. Location is part of the setup, not a detail of it.',
    outcome: '', review: 'Clean structure, correct level, late entry, oversized stop.',
    direction: 'long', entryDate: '2026-09-29', entryTime: '09:41', entryPrice: '178.40',
    exitDate: '2026-09-29', exitTime: '09:47', exitPrice: '177.55',
    shares: '120', fees: '2.10', plannedRiskR: '150', strategy: 'ORB — momentum continuation',
    tags: 'chase;opening-range', processScore: '3'
  },
  {
    date: '2026-09-30', ticker: 'TSLA', timeframe: '1-min', category: 'Good trade / Win',
    setup: 'Failed breakdown / reclaim',
    entryTrigger: 'Reclaim of the pre-market low with a higher low on the 1-min, 23:58',
    whyEntered: 'The breakdown failed and price reclaimed the level immediately, so the expectation flipped back up.',
    whatWentWrong: '', whyItWentWrong: '',
    advice: 'Late-session reclaims work, but hold them overnight only at half size.',
    keyLesson: 'A failed breakdown is information: the side that could not hold the level is the weaker one.',
    outcome: '', review: 'Small, patient, planned. Exit taken into the first push after midnight.',
    direction: 'short', entryDate: '2026-09-30', entryTime: '23:58', entryPrice: '254.10',
    exitDate: '', exitTime: '00:05', exitPrice: '252.90',
    shares: '80', fees: '1.40', plannedRiskR: '200', strategy: 'Failed breakdown fade',
    tags: 'reclaim;late-session', processScore: '4'
  }
];

// The letters the minimal example carries: enough for a row with prose and
// numbers, and proof that a subset of columns is perfectly legal.
const JOURNAL_CSV_MINIMAL_KEYS = [
  'date', 'ticker', 'category', 'direction',
  'entryDate', 'entryTime', 'entryPrice', 'exitDate', 'exitTime', 'exitPrice',
  'shares', 'fees', 'plannedRiskR'
];

// ============================================================================
// JournalCSV — the parser, the writers and the shared arithmetic
// ============================================================================

const JournalCSV = {
  // ---- Field map access -------------------------------------------------
  fields()  { return JOURNAL_CSV_FIELDS.slice(); },
  // A–Z only: the letterless Group column cannot be addressed by a letter, so it
  // is left out of every letter-shaped answer (lettersLine, the example CSV, …).
  letters() { return JOURNAL_CSV_FIELDS.filter(f => f.letter).map(f => f.letter); },
  keys()    { return JOURNAL_CSV_FIELDS.map(f => f.key); },
  // The keys that own a real column, in sheet order: everything A–Z
  csvKeys() { return JOURNAL_CSV_FIELDS.filter(f => f.letter).map(f => f.key); },
  // The keys that only exist as a named column (matched by name, never letter)
  namedKeys() { return JOURNAL_CSV_FIELDS.filter(f => !f.letter).map(f => f.key); },

  fieldByLetter(letter) {
    const l = String(letter == null ? '' : letter).trim().toUpperCase();
    return JOURNAL_CSV_FIELDS.find(f => f.letter === l) || null;
  },

  fieldByKey(key) {
    const k = String(key == null ? '' : key).trim();
    return JOURNAL_CSV_FIELDS.find(f => f.key === k) || null;
  },

  keyByLetter(letter) {
    const f = this.fieldByLetter(letter);
    return f ? f.key : null;
  },

  letterByKey(key) {
    const f = this.fieldByKey(key);
    return f ? f.letter : null;
  },

  // Sanity check against JOURNAL_COLUMNS (js/journal-categories.js): columns A–M
  // here must be the same keys, in the same order, as the sheet's 13 columns.
  // Returns a list of human-readable problems (empty = in sync).
  verifyColumns() {
    const problems = [];
    if (typeof JOURNAL_COLUMNS === 'undefined' || !Array.isArray(JOURNAL_COLUMNS)) return problems;
    JOURNAL_COLUMNS.forEach((col, i) => {
      const f = JOURNAL_CSV_FIELDS[i];
      if (!f) { problems.push(`No CSV field for sheet column ${col.sheet} (${col.key})`); return; }
      if (f.letter !== col.sheet) problems.push(`Position ${i + 1}: CSV has ${f.letter} but the sheet has ${col.sheet}`);
      if (f.key !== col.key) problems.push(`Column ${col.sheet}: CSV has ${f.key} but the sheet has ${col.key}`);
    });
    return problems;
  },

  // ---- Small text helpers ----------------------------------------------
  // lowercase, punctuation-free form used for every fuzzy comparison.
  // "P&L" collapses to "pnl" (not "pl") so the sheet's own "Outcome / P&L"
  // header, a hand-typed "Net P&L" and the key name all land on the same field.
  _norm(value) {
    return String(value == null ? '' : value)
      .toLowerCase()
      .replace(/p\s*&\s*l/g, 'pnl')
      .replace(/[^a-z0-9]+/g, '');
  },

  // Words worth matching on (short and structural words are dropped)
  _tokens(value) {
    const stop = ['the', 'and', 'a', 'an', 'of', 'to', 'in', 'on', 'at', 'for', 'with', 'or', 'is', 'it', 'my', 'was'];
    return String(value == null ? '' : value)
      .toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(' ')
      .filter(t => t.length >= 3 && stop.indexOf(t) === -1);
  },

  _pad2(n) { return String(n).padStart(2, '0'); },

  // Build YYYY-MM-DD from parts, rejecting impossible dates
  _iso(year, month, day) {
    const y = Number(year), m = Number(month), d = Number(day);
    if (!y || !m || !d) return null;
    if (m < 1 || m > 12 || d < 1 || d > 31) return null;
    if (y < 1900 || y > 2200) return null;
    return `${y}-${this._pad2(m)}-${this._pad2(d)}`;
  },

  // ---- Dates, times, numbers -------------------------------------------
  // Every date that leaves this module is YYYY-MM-DD, and every time is HH:MM.
  // Tolerant on the way in: the sheet, Excel, and a hand-typed cell all differ.
  normaliseDate(value) {
    if (value == null) return null;
    if (value instanceof Date) {
      if (isNaN(value.getTime())) return null;
      return this._iso(value.getFullYear(), value.getMonth() + 1, value.getDate());
    }
    const raw = String(value).trim();
    if (!raw) return null;

    // 2026-09-29 / 2026/09/29 / 2026.09.29, optionally with a time behind it
    let m = raw.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[T ].*)?$/);
    if (m) return this._iso(m[1], m[2], m[3]);

    // 29/09/2026, 09/29/2026 — month first unless that is impossible, which is
    // how the sheet is written (US order)
    m = raw.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})(?:[T ].*)?$/);
    if (m) {
      const a = +m[1], b = +m[2];
      let y = +m[3];
      if (y < 100) y += 2000;
      return a > 12 ? this._iso(y, b, a) : this._iso(y, a, b);
    }

    // 29 Sep 2026 / Sep 29, 2026 / Sep-29-26
    const months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
    let name = null, dd = null, mm = null, yy = null;
    let mmMatch = raw.match(/^(\d{1,2})[\s-]*([A-Za-z]{3,9})[\s,-]*(\d{2,4})?/);
    if (mmMatch) { dd = +mmMatch[1]; name = mmMatch[2]; yy = mmMatch[3] ? +mmMatch[3] : new Date().getFullYear(); }
    if (!name) {
      mmMatch = raw.match(/^([A-Za-z]{3,9})[\s-]*(\d{1,2})[\s,-]*(\d{2,4})?/);
      if (mmMatch) { name = mmMatch[1]; dd = +mmMatch[2]; yy = mmMatch[3] ? +mmMatch[3] : new Date().getFullYear(); }
    }
    if (name && dd) {
      mm = months.indexOf(String(name).toLowerCase().substring(0, 3)) + 1;
      if (mm > 0) return this._iso(yy < 100 ? yy + 2000 : yy, mm, dd);
    }

    // An unformatted Excel cell arrives as its serial number
    m = raw.match(/^(\d{5})(?:\.\d+)?$/);
    if (m) {
      const serial = +m[1];
      if (serial > 20000 && serial < 80000) {
        const d = new Date(Date.UTC(1899, 11, 30) + serial * 86400000);
        return this._iso(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
      }
    }

    // Last resort: whatever the engine can read ("Sep 29 2026 14:00")
    const parsed = new Date(raw);
    if (!isNaN(parsed.getTime())) {
      return this._iso(parsed.getFullYear(), parsed.getMonth() + 1, parsed.getDate());
    }
    return null;
  },

  // Split "2026-09-29 09:41" / "09:41" / "2026-09-29T09:41:00" into its halves
  parseMoment(value) {
    if (value == null) return { date: null, time: null };
    const raw = String(value).trim();
    if (!raw) return { date: null, time: null };

    let datePart = raw;
    let timePart = '';
    const sep = raw.indexOf('T') >= 0 ? raw.indexOf('T') : raw.indexOf(' ');
    if (sep > 0 && /\d/.test(raw.substring(0, sep))) {
      datePart = raw.substring(0, sep);
      timePart = raw.substring(sep + 1);
    }

    // A clock time on its own is not a date
    if (!timePart && /^\d{1,2}[:.]\d{1,2}(:\d{2})?\s*([ap]\.?m\.?)?$/i.test(raw)) {
      datePart = '';
      timePart = raw;
    }

    return { date: this.normaliseDate(datePart), time: this.normaliseTime(timePart) };
  },

  // 09:41, 9:41, 9.41, 0941, 941, 9:41 AM, 09:41:30 → HH:MM.
  // The whole cell is tried first, so "9:41 PM" is a time and not a date, and
  // only then is the time half of a full moment ("2026-09-29T09:41") taken.
  normaliseTime(value) {
    if (value == null) return null;
    if (typeof value === 'number') {
      // An unformatted Excel time cell is a fraction of a day
      if (value >= 0 && value < 1) {
        const mins = Math.round(value * 1440) % 1440;
        return `${this._pad2(Math.floor(mins / 60))}:${this._pad2(mins % 60)}`;
      }
      value = String(value);
    }
    const raw = String(value).trim();
    if (!raw) return null;

    const direct = this._timeFromFragment(raw);
    if (direct) return direct;

    const sep = raw.indexOf('T') >= 0 ? raw.indexOf('T') : raw.indexOf(' ');
    if (sep > 0 && /\d/.test(raw.substring(0, sep))) {
      return this._timeFromFragment(raw.substring(sep + 1));
    }
    return null;
  },

  _timeFromFragment(fragment) {
    let raw = String(fragment == null ? '' : fragment).replace(/\s+/g, '').toLowerCase();
    if (!raw) return null;

    let ampm = '';
    const tail = raw.match(/(am|pm|a|p)$/);
    if (tail) { ampm = tail[1]; raw = raw.substring(0, raw.length - tail[1].length); }

    let hh = null, mm = null;
    let m = raw.match(/^(\d{1,2})[:.](\d{1,2})(?::?(\d{2}))?$/);
    if (m) { hh = +m[1]; mm = +m[2]; }
    if (hh == null) {
      m = raw.match(/^(\d{3,4})$/);          // 941 / 0941
      if (m) {
        const digits = m[1].padStart(4, '0');
        hh = +digits.substring(0, 2);
        mm = +digits.substring(2, 4);
      }
    }
    if (hh == null) {
      m = raw.match(/^(\d{1,2})$/);          // "9" alone only makes sense with am/pm
      if (m && ampm) { hh = +m[1]; mm = 0; }
    }
    if (hh == null || mm == null || mm > 59) return null;

    if (ampm) {
      const pm = ampm.charAt(0) === 'p';
      if (hh === 12) hh = pm ? 12 : 0;
      else if (pm) hh += 12;
    }
    if (hh > 23) return null;
    return `${this._pad2(hh)}:${this._pad2(mm)}`;
  },

  _timeToMinutes(hhmm) {
    if (!hhmm) return null;
    const parts = String(hhmm).split(':');
    if (parts.length < 2) return null;
    return (+parts[0]) * 60 + (+parts[1]);
  },

  // Days since the epoch from a YYYY-MM-DD string, in whole days. Doing the
  // duration in wall-clock minutes rather than Date arithmetic keeps a trade
  // that crosses a DST switch honest.
  _dayNumber(isoDate) {
    const m = String(isoDate || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return null;
    return Math.round(Date.UTC(+m[1], +m[2] - 1, +m[3]) / 86400000);
  },

  _addDays(isoDate, days) {
    const n = this._dayNumber(isoDate);
    if (n == null) return isoDate;
    const d = new Date((n + days) * 86400000);
    return this._iso(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
  },

  // "2026-09-29" + "09:41" → "2026-09-29T09:41" (the shape the journal stores)
  joinMoment(dateVal, timeVal) {
    const date = this.normaliseDate(dateVal);
    if (!date) return null;
    const time = this.normaliseTime(timeVal);
    return time ? `${date}T${time}` : date;
  },

  // $-signs, thousands separators, (parentheses) for negatives, 1.2K → number
  parseNumber(value) {
    if (value == null || value === '') return null;
    if (typeof value === 'number') return isFinite(value) ? value : null;
    if (typeof value === 'boolean') return null;
    let raw = String(value).trim();
    if (!raw) return null;

    let sign = 1;
    if (/^\(.*\)$/.test(raw)) { sign = -1; raw = raw.substring(1, raw.length - 1); }
    let mult = 1;
    if (/[0-9]k$/i.test(raw)) mult = 1000;
    else if (/[0-9]m$/i.test(raw)) mult = 1000000;
    raw = raw.replace(/[kKmM]$/, '');
    raw = raw.replace(/[$£€,\s]/g, '').replace(/%$/, '').replace(/^\+/, '');
    if (!/^-?(\d+(\.\d+)?|\.\d+)$/.test(raw)) return null;

    const n = parseFloat(raw);
    return isNaN(n) ? null : sign * n * mult;
  },

  parseInt10(value) {
    const n = this.parseNumber(value);
    return n == null ? null : Math.round(n);
  },

  // "chase;size" / "chase|size" / "chase, size" → ['chase', 'size']
  parseTags(value) {
    if (value == null) return [];
    const raw = String(value).trim();
    if (!raw) return [];
    const seen = [];
    raw.split(/[;|,]/).forEach(part => {
      const tag = part.trim();
      if (tag && seen.indexOf(tag) === -1) seen.push(tag);
    });
    return seen;
  },

  normaliseDirection(value) {
    const n = this._norm(value);
    if (!n) return null;
    if (['long', 'l', 'buy', 'b', 'bull', 'bullish', 'longentry'].indexOf(n) !== -1) return 'long';
    if (['short', 's', 'sell', 'bear', 'bearish', 'shortentry'].indexOf(n) !== -1) return 'short';
    return null;
  },

  // The Group cell is opaque: the app writes it, the CSV carries it, nothing
  // reads its shape. Blank means "this row never said which session it is in",
  // which is the normal case for a hand-made file. Capped so a pasted novel
  // cannot become a document field.
  normaliseGroupId(value) {
    if (value == null) return null;
    const raw = String(value).trim();
    if (!raw) return null;
    return raw.substring(0, 120);
  },

  // ---- Fuzzy matching against the sheet's own vocabularies --------------
  // "FOMO", "poor entry", "management" and "Good trade / Win" all resolve to the
  // exact category string the app groups on. `known: false` means the text goes
  // in as typed (with a warning) so nothing is ever silently discarded.
  matchCategory(value) {
    const raw = String(value == null ? '' : value).trim();
    if (!raw) return null;
    if (typeof JournalCategories === 'undefined' || !JournalCategories.names) {
      return { name: raw, exact: false, known: false };
    }
    const names = JournalCategories.names();
    const norm = this._norm(raw);

    const exact = names.find(n => this._norm(n) === norm);
    if (exact) return { name: exact, exact: true, known: true };

    const tokens = this._tokens(raw);
    let best = null;
    names.forEach(name => {
      const nNorm = this._norm(name);
      const hits = tokens.filter(t => nNorm.indexOf(t) !== -1).length;
      const score = tokens.length ? hits / tokens.length : 0;
      if (score >= 0.6 && (!best || score > best.score)) best = { name, score, exact: false, known: true };
    });
    if (best) return best;

    const partial = names.filter(n => this._norm(n).indexOf(norm) === 0 || norm.indexOf(this._norm(n)) === 0);
    if (partial.length === 1) return { name: partial[0], exact: false, known: true };

    return { name: raw, exact: false, known: false };
  },

  // Timeframe / Setup: "5 min" and "5m" both land on the sheet's "5-min"
  matchVocabulary(value, list) {
    const raw = String(value == null ? '' : value).trim();
    if (!raw) return null;
    if (!Array.isArray(list) || !list.length) return raw;

    const norm = this._norm(raw);
    const exact = list.find(v => this._norm(v) === norm);
    if (exact) return exact;

    const unit = norm.match(/^(\d+)(sec|second|seconds|min|minute|minutes|m|hour|hours|h|hr|hrs|day|days|d)$/);
    if (unit) {
      const n = unit[1];
      const tail = unit[2].charAt(0);
      const candidates = {
        s: [`${n}-sec`, `${n}-second`],
        m: [`${n}-min`, `${n}-minute`],
        h: [`${n}-hour`, `${n}-hr`],
        d: [`${n}-day`, 'Daily']
      }[tail] || [];
      const hit = candidates
        .map(c => list.find(v => this._norm(v) === this._norm(c)))
        .find(Boolean);
      if (hit) return hit;
    }

    const loose = list.find(v => this._norm(v).indexOf(norm) === 0 || norm.indexOf(this._norm(v)) === 0);
    return loose || raw;
  },

  // ========================================================================
  // The arithmetic — ONE implementation shared by the form, the import and
  // the summary table. Nothing here touches the DOM.
  // ========================================================================
  // values: { direction, entryDate, entryTime, entryPrice, exitDate, exitTime,
  //           exitPrice, shares, fees, plannedRiskR, defaultDate }
  // Every value may be a raw string straight out of a cell or an input.
  computeTradeNumbers(values = {}) {
    const direction = this.normaliseDirection(values.direction) || 'long';
    const entryPrice = this.parseNumber(values.entryPrice);
    const exitPrice = this.parseNumber(values.exitPrice);
    let shares = this.parseInt10(values.shares);
    const fees = this.parseNumber(values.fees);
    const plannedRiskR = this.parseNumber(values.plannedRiskR);

    // Both halves of a moment, whichever column they arrived in. The exit side
    // deliberately gets NO date fallback: that is what lets the times alone
    // reveal a trade that ran past midnight.
    const entry = this._resolveMoment(values.entryDate, values.entryTime, values.defaultDate);
    const exit = this._resolveMoment(values.exitDate, values.exitTime, null, null);

    // A trade that runs past midnight is only knowable from the two times, so
    // roll the exit date forward by a day instead of reporting -1450 minutes.
    let exitDate = exit.date;
    let crossedMidnight = false;
    let rolledExitDate = false;
    if (entry.date && entry.time && exit.time) {
      if (!exitDate) {
        exitDate = entry.date;
        if (this._timeToMinutes(exit.time) < this._timeToMinutes(entry.time)) {
          exitDate = this._addDays(entry.date, 1);
          rolledExitDate = true;
        }
      }
      crossedMidnight = exitDate !== entry.date;
    }

    let durationMin = null;
    if (entry.date && entry.time && exitDate && exit.time) {
      const from = this._dayNumber(entry.date);
      const to = this._dayNumber(exitDate);
      const mins = (to - from) * 1440 + this._timeToMinutes(exit.time) - this._timeToMinutes(entry.time);
      durationMin = mins >= 0 ? mins : null;
    }

    // Same arithmetic as the Reviews tab so the two views never disagree
    let perShare = null;
    if (entryPrice != null && exitPrice != null) {
      perShare = direction === 'short' ? entryPrice - exitPrice : exitPrice - entryPrice;
    }
    // A price pair with no size still has a per-share result but no dollar P&L.
    // Instead of a blank strip the journal assumes ONE share: the chips, the
    // Return and the R-multiple populate, the form writes that 1 into the
    // Shares field where the user can see and replace it, and `assumedShares`
    // lets the callers label the figure as the assumption it is.
    const assumedShares = perShare != null && entryPrice !== 0 && shares == null;
    if (assumedShares) shares = 1;

    let pnl = null;
    let pnlPercent = null;
    if (perShare != null && shares != null && entryPrice !== 0) {
      // fees are a cost, always subtracted; rounded to cents so no float dust
      // like -104.09999999999931 ever reaches Firestore
      pnl = Math.round((perShare * shares - (fees != null ? fees : 0)) * 100) / 100;
      pnlPercent = Math.round((perShare / entryPrice) * 100 * 10000) / 10000;
    }
    const realisedR = (pnl != null && plannedRiskR != null && plannedRiskR > 0)
      ? Math.round((pnl / plannedRiskR) * 10000) / 10000
      : null;

    return {
      direction,
      entryPrice, exitPrice, shares, fees, plannedRiskR, assumedShares,
      entryDate: entry.date, entryTime: entry.time,
      exitDate, exitTime: exit.time,
      entryAt: this.joinMoment(entry.date, entry.time),
      exitAt: this.joinMoment(exitDate, exit.time),
      perShare, pnl, pnlPercent, durationMin, realisedR,
      crossedMidnight, rolledExitDate,
      hasNumbers: pnl != null
    };
  },

  // Date + time from either column, falling back sensibly when only one is given
  _resolveMoment(dateValue, timeValue, defaultDate, fallbackDate) {
    const fromDate = this.parseMoment(dateValue);
    const fromTime = this.parseMoment(timeValue);
    const dateValue2 = fromTime.date || this.normaliseDate(defaultDate) || this.normaliseDate(fallbackDate) || null;
    return {
      date: fromDate.date || dateValue2,
      time: fromDate.time || fromTime.time || null
    };
  },

  // The tradeData object as it is stored on journal_entries/{id}. The form and
  // the CSV import both go through here, so an imported row is byte-for-byte the
  // shape a hand-typed row produces.
  buildTradeData(values = {}, numbers = null) {
    const n = numbers || this.computeTradeNumbers(values);
    const strategy = values.strategy == null ? '' : String(values.strategy).trim();
    return {
      direction: n.direction,
      entryDate: n.entryDate,
      entryTime: n.entryAt,
      entryPrice: n.entryPrice,
      exitDate: n.exitDate,
      exitTime: n.exitAt,
      exitPrice: n.exitPrice,
      shares: n.shares,
      strategy: strategy || null,
      fees: n.fees,
      plannedRiskR: n.plannedRiskR,
      pnl: n.pnl,
      pnlPercent: n.pnlPercent,
      durationMin: n.durationMin,
      realisedR: n.realisedR
    };
  },

  // The text the Outcome column gets: "+$320.00 (+1.42%)"
  outcomeText(numbers) {
    if (!numbers || numbers.pnl == null) return null;
    const money = (numbers.pnl >= 0 ? '+' : '-') + '$' + Math.abs(numbers.pnl).toFixed(2);
    if (numbers.pnlPercent == null) return money;
    const pct = (numbers.pnlPercent >= 0 ? '+' : '') + numbers.pnlPercent.toFixed(2) + '%';
    return `${money} (${pct})`;
  },

  // 6m / 1h 5m / 2d 3h — the same wording the editor shows in the chips
  formatDuration(mins) {
    if (mins == null || isNaN(mins)) return '—';
    const m = Math.round(mins);
    if (m < 60) return m + 'm';
    if (m < 1440) {
      const h = Math.floor(m / 60);
      const rest = m % 60;
      return rest ? `${h}h ${rest}m` : `${h}h`;
    }
    const d = Math.floor(m / 1440);
    const h = Math.floor((m % 1440) / 60);
    return h ? `${d}d ${h}h` : `${d}d`;
  },

  // "09:41 → 09:47 · 6m" (and a +1d note when the exit is on another day)
  describeTiming(numbers) {
    if (!numbers || !numbers.entryTime || !numbers.exitTime) return '';
    const span = this.formatDuration(numbers.durationMin);
    const rolled = numbers.rolledExitDate ? ' (+1d)' : '';
    return `${numbers.entryTime} → ${numbers.exitTime}${rolled} · ${span}`;
  },

  // ========================================================================
  // Reading CSV
  // ========================================================================
  // The separator is guessed from the first few lines: a semicolon CSV written
  // by a European Excel is just as importable as a comma one.
  detectDelimiter(text) {
    const sample = String(text == null ? '' : text)
      .split(/\r?\n/).filter(l => l.trim()).slice(0, 5).join('\n');
    let best = ',';
    let bestCount = 0;
    [',', ';', '\t'].forEach(d => {
      const n = this._countOutsideQuotes(sample, d);
      if (n > bestCount) { bestCount = n; best = d; }
    });
    return best;
  },

  _countOutsideQuotes(text, ch) {
    let n = 0;
    let inQuotes = false;
    for (let i = 0; i < text.length; i++) {
      const c = text.charAt(i);
      if (c === '"') { inQuotes = !inQuotes; continue; }
      if (!inQuotes && c === ch) n++;
    }
    return n;
  },

  // RFC-4180 style reader: quoted cells, "" for a literal quote, and newlines
  // inside a quoted cell all survive. Returns [{ line, cells }].
  _parseGrid(text, delimiter) {
    const rows = [];
    let cells = [];
    let cell = '';
    let inQuotes = false;
    let line = 1;
    let rowLine = 1;
    const src = String(text == null ? '' : text).replace(/^\uFEFF/, '');
    const endRow = () => { cells.push(cell); rows.push({ line: rowLine, cells }); cells = []; cell = ''; };

    for (let i = 0; i < src.length; i++) {
      const ch = src.charAt(i);
      if (inQuotes) {
        if (ch === '"') {
          if (src.charAt(i + 1) === '"') { cell += '"'; i++; }
          else inQuotes = false;
        } else {
          if (ch === '\n') line++;
          cell += ch;
        }
        continue;
      }
      if (ch === '"') { inQuotes = true; continue; }
      if (ch === delimiter) { cells.push(cell); cell = ''; continue; }
      if (ch === '\r') continue;
      if (ch === '\n') { line++; endRow(); rowLine = line; continue; }
      cell += ch;
    }
    if (cell !== '' || cells.length) endRow();
    return rows;
  },

  // A cell that is nothing but a column letter
  _letterFromCell(cell) {
    const t = String(cell == null ? '' : cell).trim();
    return /^[A-Za-z]$/.test(t) ? t.toUpperCase() : null;
  },

  // "A · Date" / "O: Entry date" / "P - Entry time" → { letter: 'O', label: '…' }
  _letterPrefix(cell) {
    const t = String(cell == null ? '' : cell).trim();
    const m = t.match(/^([A-Za-z])\s*[).:\-–—·]\s*(.+)$/);
    return m ? { letter: m[1].toUpperCase(), label: m[2].trim() } : null;
  },

  // "Ticker" / "ticker" / "Outcome / P&L" / "entry price" → the field key
  _keyFromLabel(cell) {
    const norm = this._norm(cell);
    if (!norm) return null;
    let hit = JOURNAL_CSV_FIELDS.find(f => this._norm(f.key) === norm);
    if (hit) return hit.key;
    hit = JOURNAL_CSV_FIELDS.find(f => this._norm(f.label) === norm);
    if (hit) return hit.key;
    if (JOURNAL_CSV_ALIASES[norm]) return JOURNAL_CSV_ALIASES[norm];
    if (norm.length >= 4) {
      const loose = JOURNAL_CSV_FIELDS.filter(f =>
        this._norm(f.label).indexOf(norm) !== -1 || norm.indexOf(this._norm(f.label)) !== -1);
      if (loose.length === 1) return loose[0].key;
    }
    return null;
  },

  // A row where two or more cells name a known column (used to skip the label
  // line that often sits under the letters line in a hand-made sheet)
  _looksLikeLabelRow(row) {
    if (!row) return false;
    const hits = row.cells.filter(c => !!this._keyFromLabel(c)).length;
    return hits >= 2;
  },

  // A cell that names one of the letterless columns (only the Group column
  // exists in that shape). Everything else has to be addressed by a letter.
  _namedKeyFromCell(cell) {
    const key = this._keyFromLabel(cell);
    return key && this.namedKeys().indexOf(key) !== -1 ? key : null;
  },

  // Work out which column letters/keys a file is addressed by.
  // Returns { kind, columns: [{ index, letter, key, label }], headerRows, warnings }
  detectColumns(rows) {
    const warnings = [];
    const informative = (rows || []).filter(r => r.cells.some(c => String(c).trim() !== ''));
    if (!informative.length) {
      return { kind: 'empty', columns: [], headerRows: 0, warnings: ['The CSV is empty — nothing to import.'] };
    }

    const build = (index, letter, label, kind) => {
      const field = this.fieldByLetter(letter);
      if (!field) {
        warnings.push(`Column ${letter} is not part of the A–Z journal format — ignored.`);
        return null;
      }
      return { index, letter, key: field.key, label: label || field.label, kind };
    };

    const first = informative[0];
    const cells = first.cells.map(c => String(c).trim());
    const filled = cells.filter(c => c !== '');

    // 1) Letters on their own row: A,B,C,… — plus any column that has no letter
    //    to write and was therefore named by hand ("…,Z,Group"). Widening this
    //    only ever ADDS a column that the letters could not address: the A–Z
    //    detection itself is unchanged.
    const bare = cells.map(c => this._letterFromCell(c));
    const namedHere = cells.map(c => this._namedKeyFromCell(c));
    const allBareLetters = filled.length >= 2 &&
      filled.every(c => !!this._letterFromCell(c) || !!this._namedKeyFromCell(c));
    if (allBareLetters) {
      const columns = [];
      let namedOnly = 0;
      cells.forEach((c, i) => {
        const letter = bare[i];
        if (letter) {
          const col = build(i, letter, null, 'letters');
          if (col) columns.push(col);
          return;
        }
        const key = namedHere[i];
        if (!key) return;
        const field = this.fieldByKey(key);
        columns.push({ index: i, letter: null, key, label: field.label, kind: 'named' });
        namedOnly++;
      });
      let headerRows = 1;
      if (this._looksLikeLabelRow(informative[1])) {
        headerRows = 2;
        columns.forEach(col => {
          const label = String(informative[1].cells[col.index] == null ? '' : informative[1].cells[col.index]).trim();
          if (label) col.label = label;
        });
      }
      if (columns.length) {
        warnings.push(namedOnly
          ? 'Column letters found in the first row (A–Z), plus ' + namedOnly +
            ' column' + (namedOnly === 1 ? '' : 's') + ' named by hand — no letter to address them by.'
          : 'Column letters found in the first row (A–Z).');
        return { kind: 'letters', columns, headerRows, warnings };
      }
    }

    // 2) Letters with the sheet header behind them: "A · Date", "O: Entry date"
    const prefixed = cells.map(c => this._letterPrefix(c));
    const prefixedHits = prefixed.filter(p => p && this.fieldByLetter(p.letter)).length;
    if (prefixedHits >= 2) {
      const columns = [];
      prefixed.forEach((p, i) => {
        if (!p) return;
        const col = build(i, p.letter, p.label, 'letter-labels');
        if (col) columns.push(col);
      });
      if (columns.length) {
        warnings.push('Letter + header cells found in the first row.');
        return { kind: 'letter-labels', columns, headerRows: 1, warnings };
      }
    }

    // 3) Names only: Date,Ticker,Timeframe,…
    const named = cells.map(c => this._keyFromLabel(c));
    if (named.filter(Boolean).length >= 2) {
      const columns = [];
      named.forEach((key, i) => {
        if (!key) return;
        const field = this.fieldByKey(key);
        columns.push({ index: i, letter: field.letter, key, label: cells[i] || field.label, kind: 'names' });
      });
      if (columns.length) {
        warnings.push('Header row matched by column name.');
        return { kind: 'names', columns, headerRows: 1, warnings };
      }
    }

    // 4) Nothing recognisable, but the file is exactly as wide as the sheet
    if (cells.length === JOURNAL_CSV_FIELDS.length || cells.length === 13) {
      const columns = cells.map((c, i) => {
        const field = JOURNAL_CSV_FIELDS[i];
        return { index: i, letter: field.letter, key: field.key, label: field.label, kind: 'positional' };
      });
      warnings.push('No header row found — read positionally as A–M (13 columns). Check the first row is data, not headers.');
      return { kind: 'positional', columns, headerRows: 0, warnings };
    }

    return {
      kind: 'unknown', columns: [], headerRows: 0,
      warnings: warnings.concat([
        'Could not find a header row. Put the column letters in the first row (A,B,C,…), ' +
        'the column names (Date,Ticker,Category,…), or download the example CSV and replace the sample rows.'
      ])
    };
  },

  // ========================================================================
  // One row → one journal entry
  // ========================================================================
  // values: raw cell text per field key. Returns { entry, preview, warnings }.
  // The entry it produces has exactly the shape _collectForm() produces, so an
  // imported row and a typed row are the same document.
  buildEntry(values = {}, options = {}) {
    const warnings = [];
    const line = options.line || null;
    const at = (msg) => (line ? `Row ${line}: ${msg}` : msg);
    const text = (key) => {
      const v = values[key];
      return v == null ? '' : String(v).trim();
    };

    // 1) The columns with a fixed vocabulary are matched back to the sheet's own
    //    wording, and anything that had to be translated is reported.
    const category = this.matchCategory(text('category'));
    if (category && !category.exact) {
      warnings.push(category.known
        ? at(`Category "${text('category')}" read as "${category.name}".`)
        : at(`Category "${text('category')}" is not one of the sheet categories — imported as typed.`));
    }

    const timeframeRaw = text('timeframe');
    const timeframe = timeframeRaw
      ? this.matchVocabulary(timeframeRaw, (typeof JOURNAL_TIMEFRAMES !== 'undefined' ? JOURNAL_TIMEFRAMES : []))
      : null;
    if (timeframe && timeframe !== timeframeRaw) warnings.push(at(`Timeframe "${timeframeRaw}" read as "${timeframe}".`));

    const setupRaw = text('setup');
    const setup = setupRaw
      ? this.matchVocabulary(setupRaw, (typeof JOURNAL_SETUPS !== 'undefined' ? JOURNAL_SETUPS : []))
      : null;
    if (setup && setup !== setupRaw) warnings.push(at(`Setup "${setupRaw}" read as "${setup}".`));

    // 2) Numbers, timing and everything derived from them
    //    Column A may carry a time as well ("2026-09-29 09:41"), which is the entry
    const aCell = this.parseMoment(text('date'));
    const direction = this.normaliseDirection(text('direction'));

    const numbers = this.computeTradeNumbers({
      direction: direction || 'long',
      entryDate: text('entryDate') || text('date'),
      entryTime: text('entryTime') || aCell.time || '',
      exitDate: text('exitDate'),
      exitTime: text('exitTime'),
      entryPrice: text('entryPrice'),
      exitPrice: text('exitPrice'),
      shares: text('shares'),
      fees: text('fees'),
      plannedRiskR: text('plannedRiskR'),
      defaultDate: options.defaultDate || null
    });

    // 3) A value that was there but unreadable is worth a warning, not silence
    const expectNumber = (key, label) => {
      if (text(key) && this.parseNumber(text(key)) == null) {
        warnings.push(at(`${label} "${text(key)}" is not a number — left blank.`));
      }
    };
    expectNumber('entryPrice', 'Entry price');
    expectNumber('exitPrice', 'Exit price');
    expectNumber('shares', 'Shares');
    expectNumber('fees', 'Fees');
    expectNumber('plannedRiskR', 'Planned risk');
    if (numbers.assumedShares) {
      warnings.push(at('Both prices but no share count — 1 share assumed for the P&L. Type the real size in column U.'));
    }

    if (text('direction') && !direction) {
      warnings.push(at(`Direction "${text('direction')}" not understood — read as long.`));
    }
    if (numbers.entryTime && numbers.exitTime && numbers.durationMin == null) {
      warnings.push(at('The exit time is before the entry time — check columns O–S.'));
    }
    if (numbers.rolledExitDate) {
      warnings.push(at(`Trade runs past midnight — exit read as ${numbers.exitDate}.`));
    }

    let processScore = this.parseInt10(text('processScore'));
    if (processScore != null && (processScore < 1 || processScore > 5)) {
      warnings.push(at(`Process score ${processScore} is outside 1–5 — clamped.`));
      processScore = Math.min(5, Math.max(1, processScore));
    }

    // 4) The trade date: column A, else the entry date, else the caller's default
    let date = aCell.date || numbers.entryDate || numbers.exitDate || null;
    if (!date) date = this.normaliseDate(options.defaultDate);
    if (!date) warnings.push(at('No date on this row — today is used.'));

    // 5) A row needs an identity: a ticker or a category
    const ticker = text('ticker');
    if (!ticker && !category) {
      warnings.push(at('Neither a ticker nor a category — the row is skipped.'));
      return { entry: null, preview: null, warnings };
    }

    // 6) Build the document
    const tags = this.parseTags(text('tags'));
    const outcomeText = text('outcome') || this.outcomeText(numbers);
    const groupId = this.normaliseGroupId(text('groupId'));

    const entry = {
      date,
      ticker: ticker || null,
      timeframe: timeframe || null,
      category: category ? category.name : null,
      setup: setup || null,
      entryTrigger: text('entryTrigger') || null,
      whyEntered: text('whyEntered') || null,
      whatWentWrong: text('whatWentWrong') || null,
      whyItWentWrong: text('whyItWentWrong') || null,
      advice: text('advice') || null,
      keyLesson: text('keyLesson') || null,
      outcome: outcomeText || null,
      review: text('review') || null,
      tradeData: this.buildTradeData({ direction: direction || 'long', strategy: text('strategy') }, numbers),
      mentor: { source: null, raw: null, status: 'not-reviewed' },
      content: null,
      contentPlain: '',
      tags,
      processScore,
      symbol: ticker ? ticker.toUpperCase() : null,
      companyName: null,
      reviewId: null,
      sourcePage: 'TradeJournal.html',
      // Carried through when the file has a Group column, else null: null means
      // "never grouped", so the ticker+date key decides at render time.
      groupId
    };

    const preview = {
      line,
      date,
      ticker: ticker || null,
      category: category ? category.name : null,
      direction: numbers.direction,
      timing: this.describeTiming(numbers),
      durationMin: numbers.durationMin,
      entryPrice: numbers.entryPrice,
      exitPrice: numbers.exitPrice,
      pnl: numbers.pnl,
      pnlText: this.moneyText(numbers.pnl),
      // Which session the row claims, so the preview can count sessions before
      // a single document is written
      groupId,
      warnCount: 0
    };

    return { entry, preview, warnings };
  },

  moneyText(value) {
    if (value == null || isNaN(value)) return '';
    return (value >= 0 ? '+' : '-') + '$' + Math.abs(value).toFixed(2);
  },

  // ========================================================================
  // A whole file → a list of entries (this is what the Import dialog calls)
  // ========================================================================
  toEntries(text, options = {}) {
    const source = String(text == null ? '' : text);
    const delimiter = options.delimiter || this.detectDelimiter(source);
    const rows = this._parseGrid(source, delimiter);
    const header = this.detectColumns(rows);
    const warnings = header.warnings.slice();
    const entries = [];
    const preview = [];
    let skipped = 0;

    if (!header.columns.length) {
      return { entries, preview, warnings, skipped, delimiter, header, rowCount: 0 };
    }

    const informative = rows.filter(r => r.cells.some(c => String(c).trim() !== ''));
    const dataRows = informative.slice(header.headerRows);

    dataRows.forEach(row => {
      const values = {};
      header.columns.forEach(col => {
        const raw = row.cells[col.index];
        values[col.key] = raw == null ? '' : String(raw).trim();
      });

      const before = warnings.length;
      const built = this.buildEntry(values, { defaultDate: options.defaultDate, line: row.line });
      warnings.push(...built.warnings);
      if (!built.entry) { skipped++; return; }
      built.preview.warnCount = warnings.length - before;
      entries.push(built.entry);
      preview.push(built.preview);
    });

    if (!dataRows.length) warnings.push('The file has a header row but no data rows below it.');

    return { entries, preview, warnings, skipped, delimiter, header, rowCount: dataRows.length };
  },

  // ========================================================================
  // Writing CSV — the downloadable example and any row built by the app
  // ========================================================================
  _csvCell(value) {
    const s = value == null ? '' : String(value);
    return /[",\r\n;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  },

  // The letters row of a file — but a column with no letter writes its label
  // instead ("…,Z,Group"), which the reader accepts straight back: the
  // letterless columns are matched by name, exactly as they are written here.
  lettersLine(keys) {
    return (keys || this.csvKeys()).map(k => {
      const f = this.fieldByKey(k);
      if (!f) return '';
      return f.letter || f.label;
    }).join(',');
  },

  labelsLine(keys) {
    return (keys || this.csvKeys()).map(k => {
      const f = this.fieldByKey(k);
      return this._csvCell(f ? f.label : k);
    }).join(',');
  },

  dataLine(values, keys) {
    return (keys || this.csvKeys())
      .map(k => this._csvCell(values[k] == null ? '' : values[k]))
      .join(',');
  },

  // The canonical example: the letter row, the label row, then two trades. Row 2
  // of the data is a short position that crosses midnight on purpose.
  // The letterless Group column is deliberately absent — A–Z is the format the
  // sheet uses, and a row that has no group id has nothing to say in it.
  buildExample(options = {}) {
    const keys = options.keys || this.csvKeys();
    const rows = [this.lettersLine(keys), this.labelsLine(keys)];
    JOURNAL_CSV_EXAMPLES.forEach(sample => rows.push(this.dataLine(sample, keys)));
    return rows.join('\r\n') + '\r\n';
  },

  // A shorter example showing that a subset of the letters is enough
  buildMinimalExample() {
    return this.buildExample({ keys: JOURNAL_CSV_MINIMAL_KEYS });
  },

  // Plain-text map of the letters — used by the Draft helper's prompt
  letterTable() {
    const width = this.keys().reduce((max, k) => Math.max(max, k.length), 0);
    return JOURNAL_CSV_FIELDS.map(f =>
      (f.letter || '(name)') + '  ' + f.key.padEnd(width) + '  ' + f.label + ' — ' + f.hint
    ).join('\n');
  },

  exampleFilename() { return 'trade-journal-import-example.csv'; },

  downloadExample(filename, text) {
    const name = filename || this.exampleFilename();
    const body = text || this.buildExample();
    const blob = new Blob([body], { type: 'text/csv;charset=utf-8;' });
    if (typeof Utils !== 'undefined' && Utils.downloadBlob) {
      Utils.downloadBlob(blob, name);
      return name;
    }
    // Standalone fallback, in case the shared Utils module is not on the page
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    return name;
  },

  // One line for the Import dialog header:
  // 11 entries · separator "," · columns A,B,C,… ,P,Q,T,U
  summary(result) {
    if (!result) return '';
    const letters = (result.header && result.header.columns)
      ? result.header.columns.map(c => c.letter || c.label || '?').join(',')
      : '';
    const parts = [
      result.entries.length + (result.entries.length === 1 ? ' entry' : ' entries'),
      'separator "' + (result.delimiter === '\t' ? 'tab' : result.delimiter) + '"'
    ];
    if (letters) parts.push('columns ' + letters);
    if (result.skipped) parts.push(result.skipped + ' skipped');
    return parts.join(' · ');
  },

  // ========================================================================
  // GROUPS — one ticker on one day is ONE session, however many legs it took
  // ========================================================================
  // The store holds one document per TRADE (that is what the sheet's 13 columns
  // are), so a session is a view over several documents, never a document of its
  // own. Two rows belong together when:
  //
  //   • both carry the same stored `groupId` — explicit, and what the import
  //     writes; it survives an edit to the ticker or the date, and
  //   • otherwise both carry the same ticker on the same date — computed, which
  //     is why grouping works on entries stored long before groups existed.
  //
  // A stored id beginning `solo_` is the exception that proves the rule: the row
  // was deliberately split out and must never be merged with anything.
  // ========================================================================

  // null when the row has neither a ticker nor a date to pair on
  sessionKey(entry) {
    const ticker = String((entry && entry.ticker) || '').trim().toUpperCase();
    const date = String((entry && entry.date) || '').trim();
    if (!ticker && !date) return null;
    return (ticker || '—') + '@' + (date || '—');
  },

  // The id a deliberately split row carries. Built from the entry's own id, so
  // two split rows can never collide.
  soloGroupId(entryId) {
    return 'solo_' + String(entryId == null ? '' : entryId).trim();
  },

  isSoloGroupId(value) {
    return /^solo_/.test(String(value == null ? '' : value).trim());
  },

  // A row that carries a real, explicitly stored group id
  isGrouped(entry) {
    return !!(entry && entry.groupId && !this.isSoloGroupId(entry.groupId));
  },

  // The key the table groups on. Prefixed so a stored id can never collide with
  // a computed one, and so a row that pairs with nothing still gets a key of its
  // own rather than being merged with the next orphan.
  groupKeyFor(entry) {
    if (!entry) return 'g:row:';
    const stored = entry.groupId == null ? '' : String(entry.groupId).trim();
    if (stored) {
      return this.isSoloGroupId(stored)
        ? 'g:' + stored + ':' + (entry.id || '')
        : 'g:' + stored;
    }
    const session = this.sessionKey(entry);
    if (!session) return 'g:row:' + (entry.id || '');
    return 'auto:' + session;
  },

  // A fresh opaque id for one session. Nothing reads its shape — it only has to
  // be unique — and `grp_` keeps it greppable in the console while debugging.
  newGroupId() {
    return 'grp_' + Date.now().toString(36) + '_' + Math.random().toString(36).substr(2, 9);
  },

  // entries (already filtered and sorted) → the sessions to draw, in the order
  // their first leg appears. Legs keep the order they arrived in, so whatever
  // the table is sorted by also orders the legs inside each session.
  groupEntries(entries) {
    const order = [];
    const bucket = new Map();

    (entries || []).forEach(entry => {
      const key = this.groupKeyFor(entry);
      if (!bucket.has(key)) { bucket.set(key, []); order.push(key); }
      bucket.get(key).push(entry);
    });

    return order.map(key => this.describeGroup(key, bucket.get(key)));
  },

  // Everything the table needs about one session, all of it derived from the
  // legs: nothing is stored on the row, so a session can never disagree with the
  // rows it is made of.
  describeGroup(key, legs) {
    const dates = this._distinct(legs, 'date').sort();
    let date = '';
    if (dates.length === 1) date = dates[0];
    else if (dates.length > 1) date = dates[0] + ' → ' + dates[dates.length - 1];

    const tickers = this._distinct(legs, 'ticker');
    const group = {
      key,
      legs,
      ids: legs.map(e => e.id),
      count: legs.length,
      single: legs.length === 1,
      stored: this.isGrouped(legs[0]),
      ticker: tickers[0] || '',
      tickers,
      date,
      dates,
      categories: this._distinct(legs, 'category'),
      timeframes: this._distinct(legs, 'timeframe'),
      setups: this._distinct(legs, 'setup')
    };
    group.rollup = this.rollup(legs);
    group.label = group.ticker || '—';
    if (group.date) group.label += ' · ' + group.date;
    return group;
  },

  _distinct(legs, key) {
    const seen = [];
    (legs || []).forEach(e => {
      const value = e[key] == null ? '' : String(e[key]).trim();
      if (value && seen.indexOf(value) === -1) seen.push(value);
    });
    return seen;
  },

  // ========================================================================
  // The session arithmetic
  // ========================================================================
  // Session arithmetic is computed OVER the legs. It deliberately reports
  // NOTHING that needs a price series — there is no MAE, no MFE and no equity
  // curve here, because a leg only ever stored its entry, its exit and its
  // result. Everything below is a sum or a ratio of figures the legs already
  // computed, so a session can never contradict them.
  rollup(entries) {
    const legs = entries || [];

    const withPnl = legs.filter(e => e.tradeData && e.tradeData.pnl != null);
    const pnls = withPnl.map(e => e.tradeData.pnl);
    const wins = pnls.filter(p => p > 0);
    const losses = pnls.filter(p => p < 0);
    const grossWin = wins.reduce((s, p) => s + p, 0);
    const grossLoss = Math.abs(losses.reduce((s, p) => s + p, 0));
    const net = pnls.reduce((s, p) => s + p, 0);

    const withR = legs.filter(e => e.tradeData && e.tradeData.realisedR != null);
    const avgR = withR.length
      ? withR.reduce((s, e) => s + e.tradeData.realisedR, 0) / withR.length
      : null;

    const all = (key) => legs
      .map(e => (e.tradeData ? e.tradeData[key] : null))
      .filter(v => v != null && !isNaN(v));

    const durations = all('durationMin');
    const shareCounts = all('shares');
    const feeAmounts = all('fees');
    const scores = legs.map(e => (e.processScore == null ? null : e.processScore)).filter(v => v != null);

    const withAdvice = legs.filter(e =>
      (e.mentor && e.mentor.raw && e.mentor.raw.trim()) || (e.advice && e.advice.trim()));

    return {
      count: legs.length,
      traded: withPnl.length,
      untraded: legs.length - withPnl.length,
      wins: wins.length,
      losses: losses.length,
      flat: pnls.filter(p => p === 0).length,
      netPnl: withPnl.length ? Math.round(net * 100) / 100 : null,
      grossWin: Math.round(grossWin * 100) / 100,
      grossLoss: Math.round(grossLoss * 100) / 100,
      winRate: withPnl.length ? (wins.length / withPnl.length) * 100 : null,
      avgR,
      bestPnl: pnls.length ? Math.max.apply(null, pnls) : null,
      worstPnl: pnls.length ? Math.min.apply(null, pnls) : null,
      totalShares: shareCounts.length ? shareCounts.reduce((a, b) => a + b, 0) : null,
      totalFees: feeAmounts.length
        ? Math.round(feeAmounts.reduce((a, b) => a + b, 0) * 100) / 100 : null,
      totalDurationMin: durations.length ? durations.reduce((a, b) => a + b, 0) : null,
      avgProcessScore: scores.length
        ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10 : null,
      adviceTotal: withAdvice.length,
      adviceApplied: withAdvice.filter(e => e.mentor && e.mentor.status === 'applied').length
    };
  },

  // "5 legs · 3W / 2L · +$412.30 · +0.42R" — the one-line story of a session.
  // `opts.noCount` leaves the leading leg count off, for the callers that print
  // it right next to this line already: "3 trades" over "3 legs · …" said the
  // same thing twice.
  describeRollup(roll, opts = {}) {
    if (!roll) return '';
    const bits = [];
    if (!opts.noCount) bits.push(roll.count + (roll.count === 1 ? ' leg' : ' legs'));
    if (roll.traded) bits.push(roll.wins + 'W / ' + roll.losses + 'L');
    if (roll.netPnl != null) bits.push(this.moneyText(roll.netPnl));
    if (roll.avgR != null) bits.push((roll.avgR >= 0 ? '+' : '') + roll.avgR.toFixed(2) + 'R');
    return bits.join(' · ');
  },

  // How many sessions a filtered view holds. `legs` is the row count, so a
  // caller can say "5 of 5 entries · 1 session" without doing the arithmetic.
  groupStats(groups) {
    const list = groups || [];
    const multiLeg = list.filter(g => g.count > 1).length;
    return {
      sessions: list.length,
      multiLeg,
      singleLeg: list.length - multiLeg,
      legs: list.reduce((n, g) => n + g.count, 0)
    };
  },

  // ========================================================================
  // Writing group ids (the Import dialog and the editor's session strip)
  // ========================================================================
  // Rows that share a ticker and a date get ONE id, so a session is explicit
  // from the moment it exists and keeps holding together if either field is
  // edited later. A row that is on its own keeps `null`: it is not a session of
  // one, it is simply a row, and the computed key groups it with nothing.
  assignGroupIds(entries, options = {}) {
    const makeId = options.makeId || (() => this.newGroupId());
    const list = entries || [];
    const buckets = new Map();

    list.forEach(entry => {
      const session = this.sessionKey(entry);
      if (!session) return;
      if (!buckets.has(session)) buckets.set(session, []);
      buckets.get(session).push(entry);
    });

    let groups = 0;
    buckets.forEach(legs => {
      if (legs.length < 2) return;
      const id = makeId();
      legs.forEach(leg => { leg.groupId = id; });
      groups++;
    });

    return { entries: list, groups, sessions: buckets.size };
  }
};


