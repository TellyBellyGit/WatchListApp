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

console.log(passed + ' checks passed');
if (failures.length) {
  console.log(failures.length + ' FAILED:');
  failures.forEach(f => console.log('  x ' + f));
  process.exitCode = 1;
} else {
  console.log('All good — the page and js/journal.js agree on every element.\n');
}

