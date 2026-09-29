// ============================================================================
// JOURNAL CATEGORIES — the 11 categories from Day_Trading_Journal.xlsx
// ============================================================================
// The Category / Meaning pairs below are copied VERBATIM from the "Categories"
// sheet of Day_Trading_Journal.xlsx (rows 2-12, A1:B12). Keep the wording
// exactly as-is — it is the shared vocabulary between the spreadsheet and the
// app, and the Review-by-Category view groups on these exact strings.
//
// On top of the verbatim text this module adds presentation metadata so the
// same list can drive a grouped <select>, colour-coded chips in the summary
// table, and the grouping axis of the Review-by-Category view:
//
//   group — which <optgroup> the category belongs to
//   tone  — 'mistake' | 'risk' | 'good' (drives chip colour + summary stats)
//   icon  — short glyph used on chips and category tabs
//   focus — which of the 13 journal fields matter most for this category, so
//           the filtered entry list can show the relevant prose first
//   good  — true when the category means "the process was correct"
// ============================================================================

const JOURNAL_CATEGORY_GROUPS = [
  { id: 'entry', label: 'Before the trade — entry & planning', icon: '🎯' },
  { id: 'risk',  label: 'During the trade — risk & management', icon: '🛡️' },
  { id: 'good',  label: 'Good process', icon: '✅' }
];

// Column order mirrors rows 2-12 of the Categories sheet (sheetRow is the
// 1-based spreadsheet row, kept so the app can always be re-synced by hand).
const JOURNAL_CATEGORIES = [
  {
    name: 'Unplanned trade / No thesis',
    meaning: 'Entered without a clearly defined reason, setup, or invalidation point.',
    group: 'entry', tone: 'mistake', icon: '🎲', good: false,
    focus: ['entryTrigger', 'whyEntered', 'advice', 'keyLesson'], sheetRow: 2
  },
  {
    name: 'FOMO / Chasing',
    meaning: 'Entered because price was moving and there was fear of missing the move.',
    group: 'entry', tone: 'mistake', icon: '🏃', good: false,
    focus: ['whyEntered', 'entryTrigger', 'advice', 'keyLesson'], sheetRow: 3
  },
  {
    name: 'Poor entry',
    meaning: 'Valid setup, but entry was late, extended, or otherwise poorly located.',
    group: 'entry', tone: 'risk', icon: '📍', good: false,
    focus: ['entryTrigger', 'whatWentWrong', 'advice'], sheetRow: 4
  },
  {
    name: 'Poor structural stop',
    meaning: 'Stop did not sit beyond the point where the trade thesis was invalidated.',
    group: 'risk', tone: 'risk', icon: '🚧', good: false,
    focus: ['whatWentWrong', 'advice', 'keyLesson'], sheetRow: 5
  },
  {
    name: 'Premature exit',
    meaning: 'Thesis remained valid but position was closed because of discomfort or short-term noise.',
    group: 'risk', tone: 'risk', icon: '✂️', good: false,
    focus: ['whatWentWrong', 'advice', 'keyLesson'], sheetRow: 6
  },
  {
    name: 'Letting loser run',
    meaning: 'Thesis was invalidated but the position was held instead of exiting.',
    group: 'risk', tone: 'mistake', icon: '⏳', good: false,
    focus: ['whatWentWrong', 'whyItWentWrong', 'keyLesson'], sheetRow: 7
  },
  {
    name: 'Good trade / Loss',
    meaning: 'Process and risk management were sound; trade simply lost.',
    group: 'good', tone: 'good', icon: '🎖️', good: true,
    focus: ['whyEntered', 'keyLesson', 'review'], sheetRow: 8
  },
  {
    name: 'Good trade / Win',
    meaning: 'Process was sound and the trade worked.',
    group: 'good', tone: 'good', icon: '🏆', good: true,
    focus: ['whyEntered', 'keyLesson', 'review'], sheetRow: 9
  },
  {
    name: 'Context error',
    meaning: 'Broader market/stock context was misunderstood or ignored.',
    group: 'entry', tone: 'mistake', icon: '🧭', good: false,
    focus: ['whyItWentWrong', 'whyEntered', 'advice'], sheetRow: 10
  },
  {
    name: 'Setup error',
    meaning: 'The supposed setup did not actually meet the planned criteria.',
    group: 'entry', tone: 'mistake', icon: '📐', good: false,
    focus: ['setup', 'whyItWentWrong', 'advice'], sheetRow: 11
  },
  {
    name: 'Management error',
    meaning: 'Entry was reasonable, but management after entry was poor.',
    group: 'risk', tone: 'mistake', icon: '🕹️', good: false,
    focus: ['whatWentWrong', 'whyItWentWrong', 'keyLesson'], sheetRow: 12
  }
];

// ============================================================================
// THE 13 JOURNAL COLUMNS — headers copied VERBATIM from 'Trade Journal' row 1
// ============================================================================
// `key` is the Firestore field name. `sheet` is the spreadsheet column letter
// so the form, the table and the export can all be traced back to the sheet.
// `type` drives the input control: date | text | select | textarea.
// `table` is the relative column width in the summary table (P2).
// `prose` marks the free-text columns G-M, which is what the Review-by-Category
// view reads when detecting recurring lessons.
// ============================================================================

const JOURNAL_COLUMNS = [
  { sheet: 'A', key: 'date',         header: 'Date',            type: 'date',     table: 1.0, prose: false },
  { sheet: 'B', key: 'ticker',       header: 'Ticker',          type: 'text',     table: 0.7, prose: false },
  { sheet: 'C', key: 'timeframe',    header: 'Timeframe',       type: 'select',   table: 0.7, prose: false },
  { sheet: 'D', key: 'category',     header: 'Category',        type: 'select',   table: 1.6, prose: false },
  { sheet: 'E', key: 'setup',        header: 'Setup',           type: 'select',   table: 1.2, prose: false },
  { sheet: 'F', key: 'entryTrigger', header: 'Entry / Trigger', type: 'text',     table: 1.4, prose: false },
  { sheet: 'G', key: 'whyEntered',   header: 'Why I Entered',   type: 'textarea', table: 2.2, prose: true },
  { sheet: 'H', key: 'whatWentWrong',  header: 'What Went Wrong',   type: 'textarea', table: 2.2, prose: true },
  { sheet: 'I', key: 'whyItWentWrong', header: 'Why It Went Wrong', type: 'textarea', table: 2.2, prose: true },
  { sheet: 'J', key: 'advice',       header: 'Advice / Correction', type: 'textarea', table: 2.4, prose: true },
  { sheet: 'K', key: 'keyLesson',    header: 'Key Lesson',      type: 'textarea', table: 1.8, prose: true },
  { sheet: 'L', key: 'outcome',      header: 'Outcome / P&L',   type: 'text',     table: 1.0, prose: false },
  { sheet: 'M', key: 'review',       header: 'Review',          type: 'textarea', table: 2.0, prose: true }
];

// ---- Simple vocabularies (suggestions only — every field stays free text) ----
const JOURNAL_TIMEFRAMES = [
  '10-sec', '1-min', '2-min', '5-min', '15-min', '1-hour', '4-hour', 'Daily', 'Swing'
];

const JOURNAL_SETUPS = [
  'No defined setup', 'VWAP reclaim', 'Opening range break', 'First pullback after spike',
  'Failed breakdown / reclaim', 'Halt / LULD spike fade', 'Breakout above pre-market high',
  'Trend continuation', 'Reversal at key level'
];

// Rows-per-page style constants shared by the table renderer
const JOURNAL_PREFILL_KEY = 'swl_journal_prefill';
const JOURNAL_TABLE_PREVIEW_CHARS = 90;

// UI-only bucket for entries whose Category is still blank. It is never written
// to Firestore — it exists so the Review-by-Category pivot can still show
// orphaned entries instead of silently dropping them from the totals.
const JOURNAL_UNCATEGORISED = 'No category set';

// ============================================================================
// JournalCategories — lookup / presentation helpers
// ============================================================================
// Everything the UI needs to know about a category string, in one place. All
// lookups are tolerant of case and surrounding whitespace so a category typed
// by hand (or imported from the spreadsheet) still resolves.
// ============================================================================

const JournalCategories = {
  // ---- Raw access ----
  all()    { return JOURNAL_CATEGORIES; },
  groups() { return JOURNAL_CATEGORY_GROUPS; },
  names()  { return JOURNAL_CATEGORIES.map(c => c.name); },
  columns(){ return JOURNAL_COLUMNS; },
  count()  { return JOURNAL_CATEGORIES.length; },

  // ---- Lookup ----
  byName(name) {
    if (!name) return null;
    const needle = String(name).trim().toLowerCase();
    return JOURNAL_CATEGORIES.find(c => c.name.toLowerCase() === needle) || null;
  },

  byGroup(groupId) {
    return JOURNAL_CATEGORIES.filter(c => c.group === groupId);
  },

  // The <optgroup> a category belongs to (null when the name is unknown)
  groupFor(name) {
    const c = this.byName(name);
    if (!c) return null;
    return JOURNAL_CATEGORY_GROUPS.find(g => g.id === c.group) || null;
  },

  groupLabelFor(name) {
    const g = this.groupFor(name);
    return g ? g.label : '';
  },

  // ---- Field accessors (all null-safe: an unknown category never throws) ----
  label(name)   { const c = this.byName(name); return c ? c.icon + ' ' + c.name : (name || ''); },
  iconFor(name) { const c = this.byName(name); return c ? c.icon : '•'; },
  meaningFor(name) { const c = this.byName(name); return c ? c.meaning : ''; },
  toneFor(name) { const c = this.byName(name); return c ? c.tone : 'unknown'; },
  focusFor(name) {
    const c = this.byName(name);
    // Fall back to the free-text columns that carry the reasoning
    return c ? c.focus : ['whyEntered', 'whatWentWrong', 'keyLesson'];
  },
  isGood(name)  { const c = this.byName(name); return !!(c && c.good); },
  isKnown(name) { return !!this.byName(name); },

  // ---- Column lookup by field key (used by the form + table renderers) ----
  columnFor(key) { return JOURNAL_COLUMNS.find(col => col.key === key) || null; },
  headerFor(key) { const col = this.columnFor(key); return col ? col.header : key; },

  // ---- Presentation ----
  // Colour token class used for chips and the category pivot rows.
  toneClass(name) {
    const tone = this.toneFor(name);
    return tone === 'good' ? 'jcat-good' : tone === 'risk' ? 'jcat-risk' : tone === 'mistake' ? 'jcat-mistake' : 'jcat-unknown';
  },

  // <optgroup>-grouped options for the Category field. `selected` is matched
  // case-insensitively; if the saved value is not one of the 11 it is prepended
  // as its own option so nothing is ever silently lost.
  buildCategoryOptionsHtml(selected) {
    const html = [];
    const known = this.isKnown(selected);

    // Blank / off-list first option. The blank entry matters: it gives "" a real
    // option, so clearing the form (selectedIndex = 0) really empties the field
    // instead of silently defaulting to the first category in the sheet.
    if (!selected) {
      html.push(`<option value="" selected>— Select a category —</option>`);
    } else if (!known) {
      html.push(`<option value="${JournalText.esc(selected)}" selected>${JournalText.esc(selected)} (not in list)</option>`);
    }

    JOURNAL_CATEGORY_GROUPS.forEach(group => {
      const items = this.byGroup(group.id);
      if (!items.length) return;
      html.push(`<optgroup label="${JournalText.esc(group.icon + ' ' + group.label)}">`);
      items.forEach(c => {
        const isSel = known && c.name.toLowerCase() === String(selected).trim().toLowerCase();
        html.push(
          `<option value="${JournalText.esc(c.name)}"${isSel ? ' selected' : ''} title="${JournalText.esc(c.meaning)}">` +
          `${JournalText.esc(c.icon + ' ' + c.name)}</option>`
        );
      });
      html.push('</optgroup>');
    });

    return html.join('');
  },

  // Plain <option> list for Timeframe / Setup suggestions
  buildPlainOptionsHtml(values, selected) {
    return values.map(v => {
      const isSel = selected && String(selected).trim().toLowerCase() === v.toLowerCase();
      return `<option value="${JournalText.esc(v)}"${isSel ? ' selected' : ''}>${JournalText.esc(v)}</option>`;
    }).join('');
  }
};

// ============================================================================
// JournalText — text helpers used by every template in TradeJournal.html
// ============================================================================
// NOTE ON ESCAPING: the shared `Utils.escapeAttr()` helper is a no-op — its
// replacement strings are literal characters (`&` → `&`, `<` → `<`) rather than
// HTML entities, so it does not actually escape anything. Existing screens
// inherit that behaviour, but new markup should not. `JournalText.esc()` below
// does the real escaping and is used for every piece of user text the journal
// renders into innerHTML.
// ============================================================================

const JournalText = {
  // Real HTML escaping for text and attribute values
  esc(value) {
    if (value == null) return '';
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  },

  // Multi-line text -> escaped HTML with <br> line breaks preserved
  escLines(value) {
    if (value == null) return '';
    return this.esc(value).replace(/\r?\n/g, '<br>');
  },

  // Collapse whitespace and clip for table cells
  preview(value, max = JOURNAL_TABLE_PREVIEW_CHARS) {
    if (value == null) return '';
    const flat = String(value).replace(/\s+/g, ' ').trim();
    if (flat.length <= max) return flat;
    return flat.substring(0, max - 1).trimEnd() + '…';
  },

  // Lowercase, whitespace-collapsed string for search / lesson matching
  normalize(value) {
    if (value == null) return '';
    return String(value).toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
  },

  // Truncate a long lesson/advice line into a stable grouping key
  lessonKey(value) {
    const norm = this.normalize(value);
    if (!norm) return '';
    const words = norm.split(' ').slice(0, 8);
    return words.join(' ');
  }
};
