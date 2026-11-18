// ============================================================================
// JOURNAL EXPORT — consolidated Markdown builder test (plain Node, no deps)
// ============================================================================
// Run it from the StockWatchList folder:
//
//     node tests/journal-export.test.js
//
// journal-export.js is a self-contained browser script that defines one global
// (JournalExport), so it is loaded into a VM exactly as js/journal-csv.js is in
// the other suites. What it proves: the exported Markdown contains the correct
// overview, all eight rulebook sections verbatim, the full version history, and
// only the journal entries / evaluation notes whose strategyId matches the
// selected strategy — with correct date filtering, all entry types (including
// Parking Lot), and "Not recorded" for empty fields without ever throwing.
// ============================================================================

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const JS_DIR = path.join(__dirname, '..', 'js');
const source = fs.readFileSync(path.join(JS_DIR, 'journal-export.js'), 'utf8');

const context = vm.createContext({ console });
vm.runInContext(
  source + '\n;globalThis.__journal = { JournalExport };',
  context,
  { filename: 'journal-export.js' }
);
const { JournalExport } = context.__journal;

// ---- Tiny test harness -----------------------------------------------------
let passed = 0;
const failures = [];

function check(label, condition, detail) {
  if (condition) { passed++; return true; }
  failures.push(label + (detail ? ' — ' + detail : ''));
  return false;
}

function has(label, haystack, needle) {
  return check(label, haystack.indexOf(needle) !== -1, JSON.stringify(needle));
}

function missing(label, haystack, needle) {
  return check(label, haystack.indexOf(needle) === -1, JSON.stringify(needle));
}

// ---- Fixtures -------------------------------------------------------------
function fullRules(prefix) {
  return {
    objective:              { text: prefix + 'objective text', status: 'agreed' },
    validUpwardTrend:       { text: prefix + 'trend text', status: 'agreed' },
    healthyPullback:        { text: prefix + 'pullback text', status: 'under_development' },
    continuationEntry:      { text: prefix + 'entry text', status: 'under_testing' },
    continuationTriggers:   { text: prefix + 'trigger text', status: 'agreed' },
    trendDeteriorationExit: { text: prefix + 'exit text', status: 'not_defined' },
    riskManagement:         { text: prefix + 'risk text', status: 'agreed' },
    examplesNotes:          { text: prefix + 'examples text', status: 'under_development' }
  };
}

const strategy = {
  strategyId: 'TC001',
  name: 'US Micro-cap Trend Continuation',
  description: 'Buy pullbacks in an uptrend and enter on continuation triggers.',
  status: 'Active Testing',
  version: 2,
  rules: fullRules(''),
  versions: [
    { version: 1, updatedAt: '2026-11-01T00:00:00.000Z', rules: fullRules('Old ') }
  ],
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-11-15T00:00:00.000Z'
};

const entries = [
  {
    id: 'e1', strategyId: 'TC001', date: '2026-11-10', ticker: 'ABC', symbol: 'ABC',
    companyName: 'ABC Corp', category: 'Good trade / Win', setup: 'VWAP reclaim',
    entryTrigger: 'break', whyEntered: 'trend', whatWentWrong: '',
    whyItWentWrong: '', advice: 'wait for retest', keyLesson: 'location',
    outcome: '+$100.00', review: '', processScore: 4, tags: ['test'],
    mentor: { source: 'AI', raw: 'Good entry', status: 'applied' },
    contentPlain: 'Deep dive notes here',
    tradeData: {
      direction: 'long', entryPrice: 10, exitPrice: 11, shares: 100,
      fees: 1, plannedRiskR: 50, pnl: 100, pnlPercent: 10,
      realisedR: 2, durationMin: 30, strategy: 'Trend continuation'
    }
  },
  { id: 'e2', strategyId: 'TC002', date: '2026-11-10', ticker: 'XYZ', tradeData: { pnl: -50 } },
  { id: 'e3', strategyId: 'TC001', date: '2026-11-20', ticker: 'DEF' }
];

const notes = [
  { id: 'n1', strategyId: 'TC001', date: '2026-11-10', entryType: 'Observation', title: 'Observe', content: 'Observation content', linkedEntryIds: ['e1'] },
  { id: 'n2', strategyId: 'TC002', date: '2026-11-10', entryType: 'Weekly Review', title: 'Other strategy', content: 'x' },
  { id: 'n3', strategyId: 'TC001', date: '2026-11-11', entryType: 'Parking Lot', title: 'Idea', content: 'Parking lot idea' }
];

console.log('\n=== Journal export (Markdown) test ===\n');

// ---- 1. Strategy overview -------------------------------------------------
const md = JournalExport.buildMarkdown(strategy, entries, notes, {});
has('overview: strategy name', md, 'US Micro-cap Trend Continuation');
has('overview: strategy ID', md, '**Strategy ID:** TC001');
has('overview: status', md, 'Active Testing');
has('overview: version', md, '**Version:** 2');
has('overview: description preserved', md, 'Buy pullbacks in an uptrend');

// ---- 2. All eight current rulebook sections ------------------------------
check('rulebook: eight section titles defined', JournalExport.RULE_SECTIONS.length === 8,
  String(JournalExport.RULE_SECTIONS.length));
JournalExport.RULE_SECTIONS.forEach(sec => {
  has('rulebook section included: ' + sec.title, md, '### ' + sec.title);
});
has('rulebook: agreed status label rendered', md, '**[Agreed]**');
has('rulebook: under-development label rendered', md, '**[Under development]**');
has('rulebook: under-testing label rendered', md, '**[Under testing]**');
has('rulebook: not-defined label rendered', md, '**[Not yet defined]**');
has('rulebook: exact wording preserved', md, 'exit text');
has('rulebook: objective wording preserved', md, 'objective text');

// ---- 3. Version history --------------------------------------------------
has('version history: version number', md, '### Version 1');
has('version history: old rule wording preserved', md, 'Old objective text');
JournalExport.RULE_SECTIONS.forEach(sec => {
  has('version history contains: ' + sec.title, md, '#### ' + sec.title);
});

// ---- 4. Only matching-strategy journal entries ----------------------------
has('journal: matching entry included', md, 'ABC');
missing('journal: other-strategy entry excluded', md, 'XYZ');

// ---- 5. Only matching-strategy evaluation notes ---------------------------
has('evaluation: matching note included', md, 'Observation content');
has('evaluation: Parking Lot included', md, 'Parking lot idea');
missing('evaluation: other-strategy note excluded', md, 'Other strategy');

// ---- 6. All entry types included -----------------------------------------
const allTypes = ['Observation', 'Weekly Review', 'Improvement Being Tested', 'Strategy Rule Change', 'Parking Lot'];
const typedNotes = allTypes.map((t, i) => ({
  id: 't' + i, strategyId: 'TC001', date: '2026-11-10', entryType: t, title: 'T' + i, content: 'c' + i
}));
const mdTypes = JournalExport.buildMarkdown(strategy, [], typedNotes, {});
allTypes.forEach(t => {
  has('entry type included: ' + t, mdTypes, t);
});

// ---- 7. Date filtering ----------------------------------------------------
const mdRange = JournalExport.buildMarkdown(strategy, entries, notes, { from: '2026-11-09', to: '2026-11-11' });
has('date filter: in-range entry kept', mdRange, 'ABC');
missing('date filter: out-of-range entry dropped', mdRange, 'DEF');
has('date filter: in-range note kept', mdRange, 'Parking lot idea');

// ---- 8. No date range → complete history ---------------------------------
const mdAll = JournalExport.buildMarkdown(strategy, entries, notes, {});
has('no range: full history includes later entry', mdAll, 'DEF');

// ---- 9. Empty / missing fields do not fail -------------------------------
const emptyStrategy = { strategyId: 'TC999', name: 'Empty', rules: {}, versions: [] };
let mdEmpty = null;
let threw = false;
try { mdEmpty = JournalExport.buildMarkdown(emptyStrategy, [{ strategyId: 'TC999', date: '' }], [{ strategyId: 'TC999' }], {}); }
catch (e) { threw = true; }
check('empty fields: no throw', !threw);
has('empty fields: missing description → Not recorded', mdEmpty, '**Description:** Not recorded');
has('empty fields: missing rule text → Not recorded', mdEmpty, 'Not recorded');
has('empty fields: missing status → default label', mdEmpty, 'Not yet defined');

console.log('\n' + passed + ' checks passed' + (failures.length ? ', ' + failures.length + ' FAILED' : ''));
if (failures.length) {
  console.log('FAILURES:');
  failures.forEach(f => console.log('  x ' + f));
  process.exit(1);
}

