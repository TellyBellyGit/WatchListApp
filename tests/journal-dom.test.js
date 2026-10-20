// ============================================================================
// TRADE JOURNAL — page wiring check (plain Node, no dependencies)
// ============================================================================
// Run it from the StockWatchList folder:
//
//     node tests/journal-dom.test.js
//
// The journal page is one HTML file plus one controller, and a single mistyped
// id is a silent no-op in the browser. This checks, from the files themselves:
//
//   • every element id js/journal.js looks up exists in TradeJournal.html
//   • every data-field="…" in the page is unique and matches a field key the
//     controller writes into the Firestore document
//   • the tj-* classes used by the page — and the ones js/journal.js writes for
//     the grouped table — have styles
//   • the container tags balance (a rough well-formedness check)
// ============================================================================

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'TradeJournal.html'), 'utf8');
const js = fs.readFileSync(path.join(ROOT, 'js', 'journal.js'), 'utf8');
const csvJs = fs.readFileSync(path.join(ROOT, 'js', 'journal-csv.js'), 'utf8');
const css = fs.readFileSync(path.join(ROOT, 'css', 'style.css'), 'utf8');
const fsJs = fs.readFileSync(path.join(ROOT, 'js', 'firestore.js'), 'utf8');

let passed = 0;
const failures = [];

function check(label, condition, detail) {
  if (condition) { passed++; return true; }
  failures.push(label + (detail ? ' — ' + detail : ''));
  return false;
}

console.log('\n=== Trade Journal page wiring check ===\n');

// ---- Ids declared by the page (comments stripped, so prose cannot fool it) ----
const markup = html.replace(/<!--[\s\S]*?-->/g, '');
const idsInHtml = new Set();
const idRegex = /\sid="([^"]+)"/g;
let m;
while ((m = idRegex.exec(markup)) !== null) idsInHtml.add(m[1]);

// Ids the controller creates itself (empty state, prefill banner) count as owned
const dynamic = new Set();
while ((m = idRegex.exec(js)) !== null) dynamic.add(m[1]);

// ---- Ids the controller looks up ----
const looked = new Set();
const lookRegex = /(?:getElementById|\$)\(\s*'([^']+)'\s*\)/g;
while ((m = lookRegex.exec(js)) !== null) looked.add(m[1]);

const missing = [...looked].filter(id => !idsInHtml.has(id) && !dynamic.has(id)).sort();
check('every id the controller looks up exists in the page', missing.length === 0, missing.join(', '));

// Duplicate ids are illegal HTML and would make getElementById ambiguous
const allIds = (markup.match(/\sid="([^"]+)"/g) || []).map(s => s.match(/id="([^"]+)"/)[1]);
const duplicates = allIds.filter((id, i) => allIds.indexOf(id) !== i);
check('ids are unique in the page', duplicates.length === 0, [...new Set(duplicates)].join(', '));

// ---- data-field wiring ----
const fieldKeys = [...markup.matchAll(/data-field="([^"]+)"/g)].map(x => x[1]);
const EXTRA_FIELDS = ['mentorSource', 'adviceStatus', 'mentorRaw', 'processScore'];
const knownField = (k) => csvJs.indexOf("key: '" + k + "'") !== -1 || EXTRA_FIELDS.indexOf(k) !== -1;

check('data-field keys are unique', new Set(fieldKeys).size === fieldKeys.length,
  fieldKeys.filter((k, i) => fieldKeys.indexOf(k) !== i).join(', '));
check('the timing + price fields are on the page',
  ['direction', 'entryDate', 'entryTime', 'entryPrice', 'exitDate', 'exitTime', 'exitPrice']
    .every(k => fieldKeys.indexOf(k) !== -1),
  fieldKeys.join(', '));
check('the size + risk fields are still on the page',
  ['shares', 'fees', 'plannedRiskR', 'strategy'].every(k => fieldKeys.indexOf(k) !== -1));
check('every data-field is an A–Z letter or a known extra',
  fieldKeys.every(knownField),
  fieldKeys.filter(k => !knownField(k)).join(', '));

// ---- The timing section must not be inside the collapsed Numbers panel ----
const timingIdx = html.indexOf('id="tj-field-entryDate"');
const numbersIdx = html.indexOf('id="tj-trade-section"');
check('the timing fields come before the collapsed Numbers panel',
  timingIdx !== -1 && numbersIdx !== -1 && timingIdx < numbersIdx);
check('the P&L chips are outside the collapsed panel',
  numbersIdx !== -1 && html.indexOf('id="tj-pnl-total"') < numbersIdx);

// ---- Dialogs exist with the elements the controller binds ----
['tj-import-overlay', 'tj-draft-overlay', 'tj-confirm-overlay'].forEach(id => {
  check('dialog present: ' + id, idsInHtml.has(id));
});
['tj-draft-panel-skeleton', 'tj-draft-panel-prompt', 'tj-import-paste'].forEach(id => {
  check('dialog element present: ' + id, idsInHtml.has(id));
});

// ---- The broker step: a Schwab/thinkorswim export is fills, not journal rows,
// so the import dialog has to point at the converter before a file is dropped.
// A mistyped id or filename here is silent in the browser.
check('the import dialog offers the broker converter', idsInHtml.has('tj-import-matcher'));
check('the converter page ships with the app', fs.existsSync(path.join(ROOT, 'trade-matcher.html')));
check('the converter opens in its own tab',
  /importMatcherBtn[\s\S]{0,240}window\.open\('trade-matcher\.html', '_blank'\)/.test(js));
check('the import dialog offers the account statement converter',
  idsInHtml.has('tj-import-statement-matcher'));
check('the account statement converter page ships with the app',
  fs.existsSync(path.join(ROOT, 'account-statement-matcher.html')));
check('the account statement converter opens in its own tab',
  /importStatementMatcherBtn[\s\S]{0,240}window\.open\('account-statement-matcher\.html', '_blank'\)/.test(js));
check('the broker links name the file they expect',
  /🔀 Open Trade Matcher \(TradeActivity\)/.test(html) &&
  /🔀 Open Trade Matcher \(Account Summary\)/.test(html));
check('the draft dialog has exactly two tabs',
  (html.match(/data-draft-tab="/g) || []).length === 2);

// ---- Script load order ----
const SCRIPTS = ['js/journal-categories.js', 'js/journal-csv.js', 'js/journal-draft.js', 'js/journal.js'];
const order = SCRIPTS.map(f => html.indexOf('src="' + f));
check('scripts load in dependency order',
  order.every(idx => idx !== -1) && order.slice().sort((a, b) => a - b).join(',') === order.join(','),
  order.join(', '));
check('the new scripts are cache-busted',
  /journal-csv\.js\?v=/.test(html) && /journal-draft\.js\?v=/.test(html) && /journal\.js\?v=/.test(html));
check('utils.js is cache-busted too', /utils\.js\?v=/.test(html));
check('the stylesheet is cache-busted too', /style\.css\?v=/.test(html));

// ---- Styles exist for the new classes ----
['tj-timing', 'tj-cell-sub', 'tj-dialog-overlay', 'tj-dialog', 'tj-drop', 'tj-warn-list',
 'tj-dialog-tabs', 'tj-draft-fields', 'tj-draft-text', 'tj-link-btn', 'tj-mono', 'tj-import-summary'
].forEach(cls => {
  check('style present: .' + cls, css.indexOf('.' + cls) !== -1);
});

// Classes used in the page markup should have a rule somewhere
const pageClasses = new Set();
(html.match(/class="([^"]+)"/g) || []).forEach(attr => {
  attr.replace(/class="/, '').replace(/"$/, '').split(/\s+/).forEach(c => c && pageClasses.add(c));
});
const unstyled = [...pageClasses].filter(c => c.indexOf('tj-') === 0 && css.indexOf('.' + c) === -1);
check('every tj-* class in the page has a style', unstyled.length === 0, unstyled.join(', '));

// The sessions view writes its own classes from js/journal.js — the session row,
// its legs, and the one-trade row that opens a block of its own. They ARE the
// hierarchy, so every one of them needs a rule to draw it: a mistyped class here
// is silent in the browser and the nesting simply stops reading.
['tj-session-row', 'tj-session-cell', 'tj-session-count', 'tj-session-sub',
 'tj-session-blank', 'tj-group-toggle', 'tj-group-start', 'tj-single-arrow',
 'tj-leg-row', 'tj-leg-mark'
].forEach(cls => {
  check('style present: .' + cls, css.indexOf('.' + cls) !== -1);
});

// ---- Sessions: every grouped-table control must be wired -------------------
// A mistyped id here is silent in the browser: the select would do nothing and
// the table would never offer its nested legs.
['tj-group-by', 'tj-group-actions', 'tj-btn-expand-groups', 'tj-btn-collapse-groups',
 'tj-session-strip', 'tj-session-strip-text', 'tj-btn-group-session', 'tj-btn-split-session',
 'tj-import-group-session', 'tj-import-group-note'
].forEach(id => check('session control present: ' + id, idsInHtml.has(id)));

check('the grouping select offers both shapes',
  /id="tj-group-by"[^>]*>\s*<option value="session">/.test(markup) &&
  /<option value="none">/.test(markup));
check('the grouping choice is remembered per browser',
  /localStorage\.setItem\('stockwatchlist_journal_group_by'/.test(js));
check('the grouping select is restored from the saved choice',
  /this\.groupBySelect\.value = this\._groupMode\(\)/.test(js));
check('the controller caches every session control',
  /this\.sessionStrip\s*=\s*\$\('tj-session-strip'\)/.test(js) &&
  /this\.importGroupCheck\s*=\s*\$\('tj-import-group-session'\)/.test(js));
check('the strip is rendered from state, not read back out of the DOM',
  /_clearForm\(\)[\s\S]{0,1400}this\._currentGroupId = null/.test(js) &&
  /_renderSessionStrip\(\)[\s\S]{0,900}this\._currentGroupId/.test(js));
check('the table body tests the session toggle before edit/delete',
  /data-toggle-group[\s\S]{0,500}data-edit/.test(js),
  'a session row carries data-group, so the order of the branches matters');
check('a session row is drawn above its legs',
  /_sessionRowHtml\(group, cols, open\)/.test(js) && /tj-leg-row/.test(js));
check('a leg is drawn with a line that ends in an arrow, not a bare corner',
  /tj-leg-mark[^>]*>└[─]+[→▶]</.test(js),
  'the run and the head are what carry the eye from the session above into its leg');
check('both session-column marks are decoration, not content',
  /tj-leg-mark[^>]*aria-hidden="true"/.test(js) &&
  /tj-single-arrow[^>]*aria-hidden="true"/.test(js));
check('the editor writes the group id into the document',
  /doc\.groupId = this\._resolveGroupId\(\)/.test(js));
check('the import stamps one id per ticker and date',
  /assignGroupIds\(result\.entries/.test(js) && /importGroupCheck/.test(js));
check('the store owns the group id generator', /generateGroupId\(\)/.test(fsJs));

// ---- Columns: the ☰ Columns picker ----------------------------------------
// One more control a mistyped id would silently disable. It sits in the filter
// row above the table, and it is built from the same array the table draws, so
// the two can never disagree about a column's name or order.
check('the picker sits in the filter row above the table',
  idsInHtml.has('tj-columns') && idsInHtml.has('tj-columns-list') &&
  html.indexOf('id="tj-columns"') < html.indexOf('class="table-wrapper tj-table-wrapper"'));
check('the picker offers its two buttons and its hint',
  idsInHtml.has('tj-columns-all') && idsInHtml.has('tj-columns-prose') &&
  idsInHtml.has('tj-columns-count'));
check('the summary counts what is hidden',
  /class="tj-columns-count" id="tj-columns-count"/.test(html));
check('the controller caches every picker element',
  /this\.columnsDetails\s*=\s*\$\('tj-columns'\)/.test(js) &&
  /this\.columnsList\s*=\s*\$\('tj-columns-list'\)/.test(js) &&
  /this\.columnsAllBtn\s*=\s*\$\('tj-columns-all'\)/.test(js) &&
  /this\.columnsProseBtn\s*=\s*\$\('tj-columns-prose'\)/.test(js));
check('the controller draws the list from the columns the table draws',
  /_tableColumns\(showSession = false\)\s*\{[\s\S]{0,120}_allTableColumns\(showSession\)/.test(js));
check('the picker is rendered on start-up',
  /this\._bindEvents\(\);[\s\S]{0,120}this\._renderColumnPicker\(\)/.test(js));
check('the choice is remembered per browser like Group by session',
  /localStorage\.setItem\('stockwatchlist_journal_columns'/.test(js) &&
  /localStorage\.getItem\('stockwatchlist_journal_columns'\)/.test(js));
check('the session and actions columns are locked',
  /key: 'session'[^}]*lock: true/.test(js) && /key: 'actions'[^}]*lock: true/.test(js));
check('a hidden sort column hands the order back to newest first',
  /this\._sort\.key === key[\s\S]{0,160}this\._sort = \{ key: 'date', dir: 'desc' \}/.test(js));
check('the panel paints above the sticky table header',
  /\.tj-columns\s*\{[\s\S]{0,120}z-index:\s*10/.test(css) &&
  /\.tj-columns-panel\s*\{[\s\S]{0,400}z-index:\s*50/.test(css));
['tj-columns-group', 'tj-columns-group-label', 'tj-columns-item', 'tj-columns-locked',
 'tj-columns-lock', 'tj-columns-list'].forEach(cls => {
  check('style present: .' + cls, css.indexOf('.' + cls) !== -1);
});

// ---- Figures are right-aligned in the header, not just in the cells -------
// Net P&L and Process hold numbers, so their titles sit over the figures they
// name. The rule that does it is in the stylesheet, and the controller has to
// put the class on the header for it to apply.
check('the header has a right-aligned rule for numeric columns',
  /\.tj-table thead th\.tj-num\s*\{\s*text-align:\s*right/.test(css));
check('the figure columns mark themselves numeric',
  /key: 'pnl'[^}]*num: true/.test(js) && /key: 'star'[^}]*num: true/.test(js));
check('the header passes the mark on to the th',
  /const classes = \[c\.num \? 'tj-num' : ''/.test(js));

// ---- Nothing may be silently lost to U+FFFD ------------------------------
// An old save once decoded 4-byte characters as a narrower encoding: the page
// kept the bytes but not the glyph, and every run of them became U+FFFD. No
// runtime check can see a lost character, so the files themselves are checked.
const damaged = [['TradeJournal.html', html], ['js/journal.js', js], ['css/style.css', css]]
  .filter(pair => pair[1].indexOf('\uFFFD') !== -1)
  .map(pair => pair[0]);
check('no character in the page, the controller or the stylesheet is U+FFFD',
  damaged.length === 0, damaged.join(', '));
check('the icons the journal writes are the ones it always had',
  js.indexOf("'☀️' : '🌙'") !== -1 &&
  js.indexOf('🟡 Partial') !== -1 &&
  js.indexOf('🗑️</button>') !== -1);

// ---- Rough well-formedness: container tags must balance ----
['div', 'table', 'thead', 'tbody', 'tr', 'td', 'th', 'textarea', 'select', 'option', 'label',
 'span', 'button', 'ul', 'li', 'h1', 'h2', 'h3', 'p', 'a', 'datalist', 'optgroup', 'form'
].forEach(tag => {
  const open = (html.match(new RegExp('<' + tag + '(\\s|>)', 'g')) || []).length;
  const close = (html.match(new RegExp('</' + tag + '>', 'g')) || []).length;
  check('balanced <' + tag + '> tags', open === close, open + ' open vs ' + close + ' close');
});

// ---- The editor form must still carry all 13 sheet columns ----
const sheetKeys = ['date', 'ticker', 'timeframe', 'category', 'setup', 'entryTrigger',
  'whyEntered', 'whatWentWrong', 'whyItWentWrong', 'advice', 'keyLesson', 'outcome', 'review'];
check('all 13 sheet columns are still in the form',
  sheetKeys.every(k => fieldKeys.indexOf(k) !== -1),
  sheetKeys.filter(k => fieldKeys.indexOf(k) === -1).join(', '));

// ---- The editor head must reach New entry + Import on its own --------------
// The editor overlay is `position: fixed` over the whole page (z-index 9000), so
// the header buttons are unreachable while a form is open. The editor head has
// to carry its own copies or there is no way to start a second entry.
const headRight = (html.match(/tj-editor-head-right[\s\S]*?<\/div>/) || [''])[0];
check('the editor head offers a New entry button', headRight.indexOf('id="tj-editor-new"') !== -1);
check('the editor head offers an Import button', headRight.indexOf('id="tj-editor-import"') !== -1);
check('the controller looks both buttons up',
  /this\.editorNewBtn\s*=\s*\$\('tj-editor-new'\)/.test(js) &&
  /this\.editorImportBtn\s*=\s*\$\('tj-editor-import'\)/.test(js));
check('the controller binds both buttons',
  /this\.editorNewBtn\.addEventListener\('click',[\s\S]{0,60}_startAnotherEntry\(\)/.test(js) &&
  /this\.editorImportBtn\.addEventListener\('click',[\s\S]{0,60}openImport\(\)/.test(js));
check('starting another entry confirms before discarding unsaved work',
  /async _startAnotherEntry\(\)[\s\S]{0,400}this\._isDirty[\s\S]{0,400}await this\._confirm\(/.test(js));
check('the editor overlay really does cover the page header',
  /\.tj-editor-overlay\s*\{[\s\S]{0,200}position:\s*fixed/.test(css), 'the editor must be a full-screen overlay');

// ---- P&L panel: one card, two readings, three controls --------------------
// The card is rebuilt on every stats render, so its controls are wired through
// one delegated listener on the grid; per-button bindings would be thrown away
// with the markup. The arrows must also be clamped, or they scroll into months
// that hold nothing — and past today into months that cannot exist yet.
check('the P&L card has one entry point per reading',
  /_pnlPanelHtml\(entries\)\s*\{[\s\S]{0,200}_pnlYearHtml\(series\)[\s\S]{0,80}_pnlMonthHtml\(series\)/.test(js));
check('the stats grid delegates the panel controls',
  /this\.statsEl\.addEventListener\('click', \(e\) => this\._onPnlNav\(e\)\)/.test(js));
check('the view and both anchors live on the instance',
  /this\._pnlView\s*=\s*'months'/.test(js) &&
  /this\._pnlMonthEnd\s*=\s*null/.test(js) &&
  /this\._pnlYearEnd\s*=\s*null/.test(js));
check('one button names the reading it switches to',
  /data-pnl-view="\$\{parts\.viewTarget\}"/.test(js) &&
  /this\._pnlView = view\.dataset\.pnlView === 'years' \? 'years' : 'months'/.test(js));
check('both arrows step one unit and are clamped to the bounds',
  /from \+ dir, bounds/.test(js) && /_clampStep\(value, bounds\)/.test(js));
check('an edge turns its arrow off',
  /prevOff: end <= bounds\.min/.test(js) &&
  /nextOff: end >= bounds\.max/.test(js) &&
  /off \? ' disabled' : ''/.test(js));
check('the window never runs past the current month',
  /const last = Math\.max\(series\.newest, series\.todayIndex\)/.test(js));
check('the year reading is summed from the month buckets, so this year is YTD',
  /const byYear = new Map\(\)[\s\S]{0,320}sum\.pnl \+= bucket\.pnl/.test(js));
check('a first bar and every January name their year',
  /i === 0 \|\| m\.month === 0/.test(js));
check('focus follows the pressed arrow through the re-render',
  /_focusPnlControl\(`\[data-pnl-step="\$\{dir\}"\]`\)/.test(js));
['tj-months-head', 'tj-months-view', 'tj-month-step'].forEach(cls => {
  check('style present: .' + cls, css.indexOf('.' + cls) !== -1);
});
check('a disabled arrow reads as disabled',
  /\.tj-month-step:disabled\s*\{[\s\S]{0,80}opacity/.test(css));

console.log(passed + ' checks passed');
if (failures.length) {
  console.log(failures.length + ' FAILED:');
  failures.forEach(f => console.log('  x ' + f));
  process.exitCode = 1;
} else {
  console.log('All good — the page and js/journal.js agree on every element.\n');
}

