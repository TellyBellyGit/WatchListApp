// ============================================================================
// TRADE JOURNAL — form ⇄ document integration check (plain Node)
// ============================================================================
// Run it from the StockWatchList folder:
//
//     node tests/journal-form.test.js
//
// js/journal.js is the real controller, so this loads it for real — with a small
// document stub in place of the browser, because the page only boots on
// DOMContentLoaded. Then it calls the real methods with stubbed inputs:
//
//   _collectForm()   the live form → the Firestore document
//   _fillForm()      a stored document → the form (including old rows that only
//                    have a combined entryTime string)
//   _updatePnl()     the visible P&L strip
//   _rowHtml()       the table row, with the timing line under the date and the
//                    session column that tells a leg from a session of one
//   _draftInput()    what the offline draft helper is handed
// ============================================================================

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const JS_DIR = path.join(__dirname, '..', 'js');
const MODULES = ['utils.js', 'journal-categories.js', 'journal-csv.js', 'journal-draft.js', 'journal.js'];

// A document that does nothing: the controller must not need a real one to be
// exercised method by method.
const documentStub = {
  readyState: 'loading',
  addEventListener() {},
  getElementById() { return null; },
  querySelectorAll() { return []; },
  createElement() { return { style: {}, setAttribute() {}, click() {}, appendChild() {} }; },
  body: { appendChild() {}, removeChild() {} }
};

const context = vm.createContext({ console, document: documentStub, window: { addEventListener() {} } });
vm.runInContext(
  MODULES.map(f => fs.readFileSync(path.join(JS_DIR, f), 'utf8')).join('\n') +
  '\n;globalThis.__api = { TradeJournalApp, JournalCSV, JournalDraft, Utils };',
  context,
  { filename: 'journal-page.js' }
);

const { TradeJournalApp, JournalCSV: CSV, Utils } = context.__api;

let passed = 0;
const failures = [];
function check(label, condition, detail) {
  if (condition) { passed++; return true; }
  failures.push(label + (detail ? ' — ' + detail : ''));
  return false;
}
function eq(label, actual, expected) {
  return check(label, JSON.stringify(actual) === JSON.stringify(expected),
    'got ' + JSON.stringify(actual) + ', expected ' + JSON.stringify(expected));
}
function close(label, actual, expected, tolerance = 1e-9) {
  return check(label, typeof actual === 'number' && Math.abs(actual - expected) <= tolerance,
    'got ' + actual + ', expected ' + expected);
}

console.log('\n=== Trade Journal form integration check ===\n');

// ---- Stub inputs -----------------------------------------------------------
const input = (value, tagName = 'INPUT') => ({ tagName, value, style: {}, dataset: {} });
const chip = () => ({ textContent: '', className: '' });

// A NEW app object with only the inputs the methods need
function appWith(values) {
  const app = new TradeJournalApp();
  app._fields = {};
  Object.keys(values).forEach(k => { app._fields[k] = input(values[k]); });
  app._quill = null;
  app._tags = ['chase'];
  app._sourceReview = null;
  app._linkedReviewId = null;
  app._outcomeTouched = false;
  app.pnlTotal = chip();
  app.pnlPercent = chip();
  app.pnlPerShare = chip();
  app.durationEl = chip();
  app.realisedREl = chip();
  app.durationHint = { textContent: '', style: {} };
  return app;
}

// ============================================================================
// 1. A cross-midnight trade typed into the form
// ============================================================================
const typed = appWith({
  date: '2026-09-30', ticker: 'tsla', timeframe: '1-min', category: 'Good trade / Win',
  setup: 'Failed breakdown / reclaim', entryTrigger: 'Reclaim of the level', outcome: '',
  direction: 'short', entryDate: '2026-09-30', entryTime: '23:58', entryPrice: '254.10',
  exitDate: '', exitTime: '00:05', exitPrice: '252.90',
  shares: '80', fees: '1.40', plannedRiskR: '200', strategy: 'Failed breakdown fade'
});
const doc = typed._collectForm();

eq('document: ticker upper-cased for the symbol field', doc.symbol, 'TSLA');
eq('document: column A kept', doc.date, '2026-09-30');
eq('document: direction', doc.tradeData.direction, 'short');
eq('document: entry moment', doc.tradeData.entryTime, '2026-09-30T23:58');
eq('document: exit moment rolled to the next day', doc.tradeData.exitTime, '2026-10-01T00:05');
eq('document: duration across midnight', doc.tradeData.durationMin, 7);
close('document: net P&L', doc.tradeData.pnl, 94.60, 0.005);
close('document: realised R', doc.tradeData.realisedR, 0.473, 0.0001);
eq('document: outcome text auto-filled', doc.outcome, '+$94.60 (+0.47%)');
eq('document: tags carried through', doc.tags, ['chase']);
eq('document: tradeData shape matches the CSV import',
  Object.keys(doc.tradeData).sort(),
  Object.keys(CSV.buildTradeData({ direction: 'short' })).sort());

// ============================================================================
// 2. The visible P&L strip
// ============================================================================
typed._updatePnl();
eq('strip: net P&L', typed.pnlTotal.textContent, Utils.formatCurrency(94.60));
eq('strip: positive class', typed.pnlTotal.className, 'tj-pnl-value positive');
eq('strip: return', typed.pnlPercent.textContent, Utils.formatPercent(0.4723));
eq('strip: per share', typed.pnlPerShare.textContent, Utils.formatCurrency(1.2) + '/share');
eq('strip: duration', typed.durationEl.textContent, '7m');
eq('strip: realised R', typed.realisedREl.textContent, '+0.47R');
check('strip: overnight explained', /next day/i.test(typed.durationHint.textContent),
  typed.durationHint.textContent);
eq('strip: outcome re-derived', typed._fields.outcome.value, '+$94.60 (+0.47%)');

// Clearing the prices empties the derived outcome again
typed._fields.exitPrice.value = '';
typed._updatePnl();
eq('strip: no exit price → P&L placeholder', typed.pnlTotal.textContent, '—');
eq('strip: no exit price → outcome cleared', typed._fields.outcome.value, '');
eq('strip: duration survives a missing price', typed.durationEl.textContent, '7m');

// ============================================================================
// 3. Column A follows the entry date until the user takes it over
// ============================================================================
const sync = appWith({
  date: '', entryDate: '', entryTime: '', entryPrice: '', exitDate: '', exitTime: '',
  exitPrice: '', shares: '', fees: '', plannedRiskR: '', direction: 'long', outcome: ''
});
sync._lastEntryDate = '';
sync._fields.entryDate.value = '2026-09-30';
sync._syncTiming('entryDate');
eq('column A follows the entry date', sync._fields.date.value, '2026-09-30');

sync._fields.date.value = '2026-09-01';       // the user types their own trade date
sync._lastEntryDate = '2026-09-30';
sync._fields.entryDate.value = '2026-10-02';
sync._syncTiming('entryDate');
eq('column A is left alone once the user sets it', sync._fields.date.value, '2026-09-01');

// ============================================================================
// 4. Loading a stored document back into the form
// ============================================================================
function formFields() {
  const values = {};
  ['date', 'ticker', 'timeframe', 'category', 'setup', 'entryTrigger', 'whyEntered',
   'whatWentWrong', 'whyItWentWrong', 'advice', 'keyLesson', 'outcome', 'review',
   'direction', 'entryDate', 'entryTime', 'entryPrice', 'exitDate', 'exitTime', 'exitPrice',
   'shares', 'fees', 'plannedRiskR', 'strategy', 'processScore', 'mentorSource', 'mentorRaw',
   'adviceStatus'].forEach(k => { values[k] = ''; });
  return values;
}

const target = appWith(formFields());
target.tagChips = { innerHTML: '' };
target.categoryHint = { textContent: '', style: {}, innerHTML: '' };
target._fields.category.innerHTML = '';
target._fields.category.value = '';

target._fillForm({
  id: 'e1', date: '2026-09-30', ticker: 'TSLA', category: 'Good trade / Win',
  tradeData: {
    direction: 'short', entryDate: '2026-09-30', entryTime: '2026-09-30T23:58',
    exitDate: '2026-10-01', exitTime: '2026-10-01T00:05',
    entryPrice: 254.10, exitPrice: 252.90, shares: 80, fees: 1.40,
    plannedRiskR: 200, strategy: 'Failed breakdown fade', pnl: 94.6, durationMin: 7
  },
  mentor: { status: 'applied' }, tags: ['reclaim'], processScore: 4, outcome: '+$94.60 (+0.47%)'
});
eq('fill: entry date', target._fields.entryDate.value, '2026-09-30');
eq('fill: entry time', target._fields.entryTime.value, '23:58');
eq('fill: exit date (the next day)', target._fields.exitDate.value, '2026-10-01');
eq('fill: exit time', target._fields.exitTime.value, '00:05');
eq('fill: entry price', target._fields.entryPrice.value, 254.10);
eq('fill: direction', target._fields.direction.value, 'short');
eq('fill: strategy', target._fields.strategy.value, 'Failed breakdown fade');
eq('fill: process score', target._fields.processScore.value, 4);
eq('fill: the stored outcome text is kept', target._fields.outcome.value, '+$94.60 (+0.47%)');
eq('fill: the imported outcome counts as the user\u2019s own text', target._outcomeTouched, true);

// A row saved before entry/exit dates existed must still load
const legacy = appWith(formFields());
legacy.tagChips = { innerHTML: '' };
legacy.categoryHint = { textContent: '', style: {}, innerHTML: '' };
legacy._fields.category.innerHTML = '';
legacy._fillForm({
  id: 'e2', date: '2026-09-29', ticker: 'NVDA',
  tradeData: { direction: 'long', entryTime: '2026-09-29T09:41', exitTime: '2026-09-29T09:47', entryPrice: 178.4, exitPrice: 177.55, shares: 120 },
  mentor: {}, tags: []
});
eq('legacy fill: entry date recovered from the combined moment', legacy._fields.entryDate.value, '2026-09-29');
eq('legacy fill: entry time', legacy._fields.entryTime.value, '09:41');
eq('legacy fill: exit time', legacy._fields.exitTime.value, '09:47');
// The stored moment carried its own date, so it is shown rather than hidden —
// and because it matches the entry date, nothing is treated as overnight
eq('legacy fill: exit date shown from the stored moment', legacy._fields.exitDate.value, '2026-09-29');
check('legacy fill: not mistaken for an overnight trade',
  legacy.durationHint.textContent.indexOf('Crosses midnight') === -1, legacy.durationHint.textContent);
eq('legacy fill: P&L still derived', legacy.pnlTotal.textContent, Utils.formatCurrency(-102));

// ============================================================================
// 5. The table row carries the timing under the date
// ============================================================================
const rowApp = typed;
const rowHtml = rowApp._rowHtml({
  id: 'x1', date: '2026-09-29', ticker: 'NVDA', category: 'Poor entry',
  tradeData: {
    direction: 'long', entryDate: '2026-09-29', entryTime: '2026-09-29T09:41',
    exitDate: '2026-09-29', exitTime: '2026-09-29T09:47',
    entryPrice: 178.4, exitPrice: 177.55, shares: 120, fees: 2.1, pnl: -104.1, durationMin: 6
  },
  mentor: { status: 'applied' }, tags: [], processScore: 3
}, rowApp._tableColumns());
check('row: date cell shows the date', rowHtml.indexOf('2026-09-29') !== -1);
check('row: date cell has the timing line', rowHtml.indexOf('09:41 → 09:47 · 6m') !== -1, rowHtml);
check('row: timing line is a sub-line', rowHtml.indexOf('tj-cell-sub') !== -1);
check('row: net P&L cell', rowHtml.indexOf('$-104.10') !== -1, rowHtml);

// A row with no timing shows the date alone, with no empty sub-line
const plainRow = rowApp._rowHtml({
  id: 'x2', date: '2026-09-28', ticker: 'AMD', category: null,
  tradeData: {}, mentor: {}, tags: []
}, rowApp._tableColumns());
check('row: no timing → no sub-line', plainRow.indexOf('tj-cell-sub') === -1, plainRow);
check('row: unknown category is a dash', plainRow.indexOf('tj-muted') !== -1);

// ============================================================================
// 6. What the draft helper is handed
// ============================================================================
typed._fields.exitPrice.value = '252.90';   // section 2 cleared it on purpose
const draftInput = typed._draftInput();
eq('draft input: the form values are carried over', draftInput.category, 'Good trade / Win');
eq('draft input: the timing comes from the form', draftInput.entryTime, '23:58');
eq('draft input: so do the numbers', draftInput.exitPrice, 252.90);
check('draft input: the dialog facts start empty',
  draftInput.facts === '' && draftInput.stopPrice === '');
const drafted = context.__api.JournalDraft.build(draftInput);
eq('draft over the form: seven fields', drafted.fields.length, 7);
check('draft over the form: ticker upper-cased', drafted.facts.ticker === 'TSLA');
check('draft over the form: no bad tokens',
  !/undefined|NaN/.test(JSON.stringify(drafted)), JSON.stringify(drafted).substring(0, 200));

// ============================================================================
// 7. Both prices and no size: one share is assumed, visibly
// ============================================================================
const assumedApp = appWith({
  date: '2026-09-30', ticker: 'NVDA', timeframe: '5-min', category: 'Poor entry',
  setup: '', entryTrigger: '', whyEntered: '', whatWentWrong: '', whyItWentWrong: '',
  advice: '', keyLesson: '', outcome: '', review: '',
  direction: 'long', entryDate: '2026-09-30', entryTime: '09:41', entryPrice: '178.40',
  exitDate: '', exitTime: '09:47', exitPrice: '177.55',
  shares: '', fees: '', plannedRiskR: '', strategy: ''
});
assumedApp.numbersHint = { textContent: '', style: {} };
assumedApp._updatePnl();

eq('assumed size: the Shares box is filled in', assumedApp._fields.shares.value, '1');
eq('assumed size: recorded as the journal\u2019s own number', assumedApp._sharesAssumed, true);
check('assumed size: the field says it is an assumption',
  /assumed/i.test(assumedApp._fields.shares.title), assumedApp._fields.shares.title);
eq('assumed size: net P&L for the one share', assumedApp.pnlTotal.textContent, Utils.formatCurrency(-0.85));
eq('assumed size: the return shows too', assumedApp.pnlPercent.textContent, Utils.formatPercent(-0.4765));
eq('assumed size: so does the per-share chip',
  assumedApp.pnlPerShare.textContent, Utils.formatCurrency(-0.85) + '/share');
check('assumed size: the strip explains itself',
  /1 share is assumed/i.test(assumedApp.numbersHint.textContent), assumedApp.numbersHint.textContent);
eq('assumed size: the document carries the one share', assumedApp._collectForm().tradeData.shares, 1);
eq('assumed size: the outcome line follows it',
  assumedApp._fields.outcome.value, '-$0.85 (-0.48%)');

// The draft helper is told the size is unknown, not that it is one share
const assumedDraft = context.__api.JournalDraft.build(assumedApp._draftInput());
eq('assumed size: the helper is handed no size', assumedApp._draftInput().shares, '');
eq('assumed size: the draft sees the assumed one share underneath', assumedDraft.facts.shares, 1);
eq('assumed size: the draft knows it was assumed', assumedDraft.facts.assumedShares, true);
check('assumed size: the draft says so in its notes',
  assumedDraft.notes.some(n => /1 share/i.test(n)), JSON.stringify(assumedDraft.notes));
check('assumed size: the review line claims no share count',
  assumedDraft.fields.find(f => f.key === 'review').text.indexOf('shares') === -1,
  assumedDraft.fields.find(f => f.key === 'review').text);
const assumedPrompt = context.__api.JournalDraft.prompt(assumedApp._draftInput());
check('assumed size: the prompt admits the size is missing',
  /not entered/i.test(assumedPrompt) && !/\(Shares\): 1/.test(assumedPrompt), assumedPrompt.substring(0, 400));

// A size the user types wins, and the strip follows it
assumedApp._fields.shares.value = '120';
assumedApp._dropAssumedSize();          // what the input listener does
assumedApp._updatePnl();
eq('assumed size: a typed size replaces it', assumedApp._fields.shares.value, '120');
eq('assumed size: the strip follows the real size', assumedApp.pnlTotal.textContent, Utils.formatCurrency(-102));
eq('assumed size: no longer flagged', assumedApp._sharesAssumed, false);
eq('assumed size: the note goes away', assumedApp.numbersHint.style.display, 'none');

// While the caret is in the Shares box the value belongs to the user
const typingShares = appWith({
  date: '2026-09-30', direction: 'long', entryDate: '2026-09-30', entryPrice: '178.40',
  exitPrice: '177.55', shares: '', fees: '', plannedRiskR: ''
});
typingShares.numbersHint = { textContent: '', style: {} };
documentStub.activeElement = typingShares._fields.shares;
typingShares._updatePnl();
eq('assumed size: never typed over while the caret is in the field',
  typingShares._fields.shares.value, '');
documentStub.activeElement = null;

// Losing a price takes the assumption back with it
const lostPrice = appWith({
  date: '2026-09-30', direction: 'long', entryDate: '2026-09-30', entryPrice: '178.40',
  exitPrice: '177.55', shares: '', fees: '', plannedRiskR: ''
});
lostPrice.numbersHint = { textContent: '', style: {} };
lostPrice._updatePnl();
eq('assumed size: applied in the first place', lostPrice._fields.shares.value, '1');
lostPrice._fields.exitPrice.value = '';
lostPrice._updatePnl();
eq('assumed size: dropped when a price goes', lostPrice._fields.shares.value, '');

// A one-share size that is really the user's own survives a stale flag
const storedOne = appWith({
  date: '2026-09-30', direction: 'long', entryDate: '2026-09-30', entryPrice: '178.40',
  exitPrice: '177.55', shares: '1', fees: '', plannedRiskR: ''
});
storedOne.numbersHint = { textContent: '', style: {} };
storedOne._sharesAssumed = true;                 // left over from an earlier row
storedOne._updatePnl();
eq('assumed size: a real one-share size is never cleared', storedOne._fields.shares.value, '1');
eq('assumed size: and the stale flag is dropped', storedOne._sharesAssumed, false);

// A stored row that never had a size loads the same way
const legacyNoSize = appWith(formFields());
legacyNoSize.tagChips = { innerHTML: '' };
legacyNoSize.categoryHint = { textContent: '', style: {}, innerHTML: '' };
legacyNoSize._fields.category.innerHTML = '';
legacyNoSize.numbersHint = { textContent: '', style: {} };
legacyNoSize._fillForm({
  id: 'e3', date: '2026-09-29', ticker: 'NVDA', category: 'Poor entry',
  tradeData: {
    direction: 'long', entryDate: '2026-09-29', entryTime: '2026-09-29T09:41',
    exitTime: '2026-09-29T09:47', entryPrice: 178.4, exitPrice: 177.55
  },
  mentor: {}, tags: []
});
eq('fill: a stored row with no size gets one share', legacyNoSize._fields.shares.value, '1');
eq('fill: and its strip fills in', legacyNoSize.pnlTotal.textContent, Utils.formatCurrency(-0.85));

// ============================================================================
// 9. Sessions — the group id a row saves with, and who it groups with
// ============================================================================
// The two methods under test reach for a toast and nothing else; the toast is
// stubbed so the checks can read what was said.
const toasts = [];
Utils.showToast = (msg) => { toasts.push(msg); };

const sess = appWith({ date: '2026-09-29', ticker: 'nvda' });
sess._quill = null;
sess._tags = [];
eq('session: the strip knows the ticker and the date', sess._formSessionKey(), 'NVDA@2026-09-29');
eq('session: a fresh row saves ungrouped', sess._resolveGroupId(), null);
eq('session: so the document carries no group id', sess._collectForm().groupId, null);

sess._currentId = 'e9';
sess._currentGroupId = 'grp_abc';
eq('session: a stored id is saved back unchanged', sess._collectForm().groupId, 'grp_abc');

// Split out: the solo id is built from the row's own entry id, so two split rows
// can never share one
sess._groupIntent = 'solo';
sess._currentGroupId = null;
eq('session: split out builds a solo id from the entry id',
  sess._collectForm().groupId, 'solo_e9');
check('session: and that id is recognised as a split',
  CSV.isSoloGroupId(sess._collectForm().groupId));

// A brand new row has no id until it is saved, so the solo id is resolved then
const brandNew = appWith({ date: '2026-09-29', ticker: 'NVDA' });
brandNew._quill = null;
brandNew._tags = [];
brandNew._currentId = 'fresh_id';
brandNew._groupIntent = 'solo';
eq('session: an unsaved row splits under the id it will be stored with',
  brandNew._resolveGroupId(), 'solo_fresh_id');

// ---- Who the open row would be grouped with --------------------------------
const sib = appWith({ date: '2026-09-29', ticker: 'NVDA' });
sib._quill = null;
sib._tags = [];
sib._currentId = 'e2';
sib._entries = [
  { id: 'e1', date: '2026-09-29', ticker: 'NVDA', groupId: null },       // a sibling
  { id: 'e2', date: '2026-09-29', ticker: 'NVDA', groupId: null },       // the open row
  { id: 'e3', date: '2026-09-29', ticker: 'TSLA', groupId: null },       // another ticker
  { id: 'e4', date: '2026-09-30', ticker: 'NVDA', groupId: null },       // another day
  { id: 'e5', date: '2026-09-29', ticker: 'NVDA', groupId: 'grp_x' },    // already explicit
  { id: 'e6', date: '2026-09-29', ticker: 'NVDA', groupId: 'solo_e6' }   // split out
];
eq('session: siblings are the same ticker on the same day, nobody else',
  sib._sessionSiblings().map(e => e.id), ['e1']);

// ---- The strip says what saving will do ------------------------------------
const strip = appWith({ date: '2026-09-29', ticker: 'NVDA' });
strip._quill = null;
strip._tags = [];
strip._currentId = 'e2';
strip._entries = sib._entries;
strip.sessionStrip = { style: {} };
strip.sessionStripText = { innerHTML: '' };
strip.groupSessionBtn = { textContent: '', title: '' };
strip.splitSessionBtn = { textContent: '', title: '', disabled: false };

strip._renderSessionStrip();
const stripText = () => strip.sessionStripText.innerHTML;
check('strip: names the session', /NVDA · 2026-09-29/.test(stripText()), stripText());
check('strip: says who else is in it', /1 other row share/.test(stripText()), stripText());
eq('strip: is visible', strip.sessionStrip.style.display, 'flex');
check('strip: offers to store the group id', /Store the group id/.test(strip.groupSessionBtn.textContent));
eq('strip: splitting is available', strip.splitSessionBtn.disabled, false);

strip._splitCurrentSession();
eq('strip: split is remembered as an intent', strip._groupIntent, 'solo');
check('strip: says the row is on its own now', /this row only/.test(stripText()), stripText());
check('strip: offers the way back', /Join the session/.test(strip.groupSessionBtn.textContent));
eq('strip: splitting is no longer offered', strip.splitSessionBtn.disabled, true);
check('strip: the split was explained', /Split out/.test(toasts[toasts.length - 1]), toasts[toasts.length - 1]);
eq('strip: a split row saves under its solo id', strip._resolveGroupId(), 'solo_e2');

// A row with neither a ticker nor a date has no session to show
const orphan = appWith({ date: '', ticker: '' });
orphan._quill = null;
orphan._tags = [];
orphan.sessionStrip = { style: { display: 'flex' } };
orphan.sessionStripText = { innerHTML: 'stale' };
orphan.groupSessionBtn = { textContent: '', title: '' };
orphan.splitSessionBtn = { textContent: '', title: '', disabled: false };
orphan._renderSessionStrip();
eq('strip: hidden when there is nothing to pair on', orphan.sessionStrip.style.display, 'none');
eq('strip: and the open row saves ungrouped', orphan._resolveGroupId(), null);

// ============================================================================
// 10. Sessions — the table row above its legs
// ============================================================================
const tableApp = appWith(formFields());
tableApp._quill = null;
tableApp._tags = [];

const sessCols = tableApp._tableColumns(true);
eq('columns: the session column comes first', sessCols[0].key, 'session');
eq('columns: it is not sortable', sessCols[0].sortable, false);
eq('columns: the flat table is untouched', tableApp._tableColumns().length, 16);
eq('columns: grouped adds exactly one column', sessCols.length, 17);

const legRows = [
  { id: 'l1', date: '2026-09-29', ticker: 'NVDA', category: 'Poor entry',
    tradeData: { pnl: 120, realisedR: 1.2, entryPrice: 10, exitPrice: 11 }, mentor: {}, tags: [] },
  { id: 'l2', date: '2026-09-29', ticker: 'NVDA', category: 'FOMO / Chasing',
    tradeData: { pnl: -40.5, realisedR: -0.405, entryPrice: 10, exitPrice: 9.9 }, mentor: {}, tags: [] }
];
const session = CSV.groupEntries(legRows)[0];

const closedHead = tableApp._sessionRowHtml(session, sessCols, false);
check('session row: the caret carries the session key',
  closedHead.indexOf('data-toggle-group="auto:NVDA@2026-09-29"') !== -1, closedHead.substring(0, 300));
check('session row: closed shows the closed caret', closedHead.indexOf('▸') !== -1);
check('session row: says how many legs', /2 trades/.test(closedHead));
check('session row: carries the rollup line',
  /1W \/ 1L/.test(closedHead) && closedHead.indexOf('+$79.50') !== -1, closedHead);
check('session row: the net P&L cell is the session total',
  closedHead.indexOf(Utils.formatCurrency(79.5)) !== -1);
check('session row: the date and ticker are the session\'s own',
  closedHead.indexOf('2026-09-29') !== -1 && closedHead.indexOf('NVDA') !== -1);
check('session row: the prose columns are left empty', closedHead.indexOf('tj-session-blank') !== -1);
check('session row: offers to store the group id',
  closedHead.indexOf('data-stamp-group="auto:NVDA@2026-09-29"') !== -1);
check('session row: several categories are counted', /2 categories/.test(closedHead));
check('session row: and their names sit on the title',
  closedHead.indexOf('title="Poor entry, FOMO / Chasing"') !== -1, closedHead);

// The prose lives on the legs. A session row must never repeat — or invent — any
// of it, which is why its prose cells are empty rather than filled with dashes.
const proseSession = CSV.groupEntries([
  Object.assign({}, legRows[0], {
    entryTrigger: 'SECRET-1', whyEntered: 'SECRET-2', whatWentWrong: 'SECRET-3',
    whyItWentWrong: 'SECRET-4', advice: 'SECRET-5', keyLesson: 'SECRET-6',
    outcome: 'SECRET-7', review: 'SECRET-8', setup: 'Opening range break'
  }),
  Object.assign({}, legRows[1], { whyEntered: 'SECRET-9' })
])[0];
const proseHead = tableApp._sessionRowHtml(proseSession, sessCols, false);
check('session row: never repeats a leg\'s prose', proseHead.indexOf('SECRET-') === -1, proseHead);
eq('session row: one setup is shown as it stands', (proseHead.match(/Opening range break/) || []).length, 1);

const openHead = tableApp._sessionRowHtml(session, sessCols, true);
check('session row: open shows the open caret', openHead.indexOf('▾') !== -1);
check('session row: open is announced', openHead.indexOf('aria-expanded="true"') !== -1);

const legHtml = tableApp._rowHtml(legRows[0], sessCols, session);
check('leg row: marked as a leg', legHtml.indexOf('tj-leg-row') !== -1);
check('leg row: marked with a line that runs into it and ends in an arrow',
  /tj-leg-mark[^>]*>└[─]+[→▶]</.test(legHtml), legHtml.substring(0, 280));
check('leg row: the mark is decoration, never something to read out',
  /tj-leg-mark[^>]*aria-hidden="true"/.test(legHtml), legHtml.substring(0, 280));
check('leg row: the mark opens nothing — only a session row is a toggle',
  legHtml.indexOf('data-toggle-group') === -1, legHtml.substring(0, 280));
check('leg row: still opens its own entry', legHtml.indexOf('data-id="l1"') !== -1);
check('leg row: keeps its own edit and delete buttons',
  legHtml.indexOf('data-edit="l1"') !== -1 && legHtml.indexOf('data-del="l1"') !== -1);
check('plain row (no session): not marked as a leg',
  tableApp._rowHtml(legRows[0], sessCols).indexOf('tj-leg-row') === -1);

// ---- When the table groups at all ------------------------------------------
const groupMode = appWith(formFields());
groupMode._quill = null;
groupMode._tags = [];
groupMode._filtered = legRows;
eq('groups: two legs of one session make one session', groupMode._buildGroups().length, 1);

groupMode._filtered = [legRows[0]];
eq('groups: a view of one-leg sessions stays flat', groupMode._buildGroups(), null);

groupMode._filtered = legRows;
groupMode._groupBy = 'none';
eq('groups: turned off, the view is flat', groupMode._buildGroups(), null);

// A stored group keeps two legs together even on different days
groupMode._groupBy = 'session';
groupMode._filtered = [
  { id: 'g1', date: '2026-09-29', ticker: 'NVDA', groupId: 'grp_night', tradeData: { pnl: 5 }, mentor: {}, tags: [] },
  { id: 'g2', date: '2026-09-30', ticker: 'NVDA', groupId: 'grp_night', tradeData: { pnl: -1 }, mentor: {}, tags: [] }
];
const nightGroup = groupMode._buildGroups()[0];
eq('groups: a stored id holds one session over midnight', nightGroup.count, 2);
eq('groups: the stored session knows it is explicit', nightGroup.stored, true);
check('groups: and its session row offers no stamp button',
  groupMode._sessionRowHtml(nightGroup, sessCols, false).indexOf('data-stamp-group') === -1);

// A "group" of one is not a session summary: it is a whole entry of its own, so
// it stays the real trade row and is marked with the right-pointing arrow. That
// marker is what stops it being read as a leg of the session above it.
const soloRow = groupMode._groupHtml(CSV.groupEntries([legRows[0]])[0], sessCols);
eq('one trade: no session row and nothing to expand', soloRow.indexOf('tj-session-row'), -1);
check('one trade: marked with a right-pointing arrow that is not a control',
  soloRow.indexOf('tj-single-arrow') !== -1 && soloRow.indexOf('▶') !== -1 &&
  soloRow.indexOf('aria-hidden="true"') !== -1, soloRow.substring(0, 220));
check('one trade: says how many trades it is', />1 trade</.test(soloRow), soloRow.substring(0, 220));
check('one trade: carries its own one-line story',
  /1W \/ 0L/.test(soloRow) && soloRow.indexOf('+$120.00') !== -1 &&
  soloRow.indexOf('+1.20R') !== -1, soloRow);
check('one trade: opens a block of its own', soloRow.indexOf('tj-group-start') !== -1, soloRow);
check('one trade: is not a leg', soloRow.indexOf('tj-leg-row') === -1);
check('one trade: never offers a toggle', soloRow.indexOf('data-toggle-group') === -1);
check('one trade: stays the real trade row, buttons and all',
  soloRow.indexOf('data-id="l1"') !== -1 && soloRow.indexOf('data-edit="l1"') !== -1 &&
  soloRow.indexOf('data-del="l1"') !== -1, soloRow);

// ---- The rendered table: collapsed, expanded, then turned off --------------
const renderApp = appWith(formFields());
renderApp._quill = null;
renderApp._tags = [];
renderApp._entries = legRows.concat([
  { id: 'l3', date: '2026-09-30', ticker: 'TSLA', tradeData: { pnl: 10 }, mentor: {}, tags: [] }
]);
renderApp._filtered = renderApp._entries.slice();
renderApp.tableHead = { innerHTML: '' };
renderApp.tableBody = { innerHTML: '' };
renderApp.emptyState = { style: {}, innerHTML: '' };
renderApp.resultCount = { textContent: '' };
renderApp.groupActionBar = { style: {} };
renderApp._openGroups = new Set();

const body = () => renderApp.tableBody.innerHTML;

renderApp._renderTable();
eq('table: one session row for the two NVDA legs',
  (body().match(/tj-session-row/g) || []).length, 1);
check('table: the legs stay hidden while the session is closed',
  body().indexOf('tj-leg-row') === -1, body().substring(0, 300));
check('table: the lone TSLA row is drawn as a plain row, with its buttons',
  body().indexOf('data-id="l3"') !== -1 && body().indexOf('data-edit="l3"') !== -1);
check('table: and it opens a block of its own instead of hanging off the session',
  body().indexOf('tj-group-start') !== -1 && body().indexOf('tj-single-arrow') !== -1,
  body().substring(0, 400));
eq('table: only the lone row is marked as a session of one',
  (body().match(/tj-single-arrow/g) || []).length, 1);
check('table: the header carries the session column',
  renderApp.tableHead.innerHTML.indexOf('Session') !== -1);
check('table: the session column is not sortable',
  renderApp.tableHead.innerHTML.indexOf('data-sort="session"') === -1);
eq('table: the counter counts rows and sessions', renderApp.resultCount.textContent, '3 entries · 2 sessions');
eq('table: expand all is offered', renderApp.groupActionBar.style.display, 'inline-flex');

renderApp._toggleGroup('auto:NVDA@2026-09-29');
eq('table: opening the session shows both legs',
  (body().match(/tj-leg-row/g) || []).length, 2);
check('table: the legs keep their own row ids',
  body().indexOf('data-id="l1"') !== -1 && body().indexOf('data-id="l2"') !== -1);
check('table: the session row is still above them',
  body().indexOf('tj-session-row') < body().indexOf('tj-leg-row'));

renderApp._groupBy = 'none';
renderApp._renderTable();
check('table: one row per trade when grouping is off',
  body().indexOf('tj-session-row') === -1 && (body().match(/data-id="/g) || []).length === 3, body());
eq('table: no session markers left behind either', body().indexOf('tj-single-arrow'), -1);
eq('table: and no block separators', body().indexOf('tj-group-start'), -1);
eq('table: the counter is flat again', renderApp.resultCount.textContent, '3 entries');
eq('table: expand all is hidden again', renderApp.groupActionBar.style.display, 'none');
check('table: the session column goes with it',
  renderApp.tableHead.innerHTML.indexOf('Session') === -1);

// ============================================================================
// Summary
// ============================================================================
console.log(passed + ' checks passed');
if (failures.length) {
  console.log(failures.length + ' FAILED:');
  failures.forEach(f => console.log('  x ' + f));
  process.exitCode = 1;
} else {
  console.log('All good — the form, the document and the table row agree.\n');
}


