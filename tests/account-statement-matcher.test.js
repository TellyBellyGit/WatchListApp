// ============================================================================
// ACCOUNT STATEMENT MATCHER - FIFO conversion check (plain Node, no deps)
// ============================================================================
// Run it from the StockWatchList folder:
//
//     node tests/account-statement-matcher.test.js
//
// The converter is a standalone page, so its inline script is DOM-free below the
// "Core logic" banner. This loads that script in a VM context and checks the real
// parser and matcher against the Schwab statement kept in tests/:
//
//   - the execution block is preferred over the order-history block
//   - all 111 executions are read, matched FIFO, and reconciled to the statement
//   - the output CSV keeps the exact column order the journal importer expects
//   - the order-history fallback ignores CANCELED orders and reports `~` prices
// ============================================================================

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'account-statement-matcher.html'), 'utf8');
const statement = fs.readFileSync(path.join(__dirname, '2026-10-20-AccountStatement.csv'), 'utf8');

const scriptMatch = html.match(/<script>([\s\S]*?)<\/script>/);
if (!scriptMatch) throw new Error('account-statement-matcher.html has no inline script');

const context = vm.createContext({ console });
vm.runInContext(
  scriptMatch[1] + '\n;globalThis.__matcher = { buildTrades, readAccountTrades, toCsv, OUT_COLS };',
  context,
  { filename: 'account-statement-matcher.html' }
);

const { buildTrades, readAccountTrades, toCsv, OUT_COLS } = context.__matcher;

let passed = 0;
const failures = [];

function check(label, condition, detail) {
  if (condition) { passed++; return true; }
  failures.push(label + (detail ? ' - ' + detail : ''));
  return false;
}

console.log('\n=== Account statement matcher check ===\n');

// ---- Execution block: one order per cash TRD row ----
const parsed = readAccountTrades(statement);
check('reads every execution in Account Trade History', parsed.orders.length === 111, String(parsed.orders.length));
check('reads the execution block without notes', parsed.notes.length === 0, parsed.notes.join('; '));
check('the execution block is preferred over order history',
  parsed.orders.some(o => o.timeStr === '10/19/26 12:53:11' && o.symbol === 'MASK' && o.price === 1.012));

// ---- FIFO matching ----
const result = buildTrades(statement);
check('matches every closing fill to an opening buy', result.rows.length === 60, String(result.rows.length));
check('leaves no unmatched sells or open lots', result.notes.length === 0, result.notes.join('; '));

const total = result.rows.reduce((sum, r) => sum + r.PnL, 0);
check('total PnL reconciles with the statement', Math.abs(total - (-37.1502)) < 1e-6, total.toFixed(4));

const symbols = [...new Set(result.rows.map(r => r.Symbol))].sort();
check('matches only the symbols traded in the statement',
  JSON.stringify(symbols) === JSON.stringify(['AIBZ', 'CHOW', 'EXYN', 'FUFU', 'MASK', 'WORX', 'XLAB']),
  symbols.join(','));

const first = result.rows[0];
check('first row is the first MASK round trip',
  first.Symbol === 'MASK' && first.Qty === 10 &&
  first.EntryTime === '10/19/26 12:53:06' && first.EntryPrice === 0.96848 &&
  first.ExitTime === '10/19/26 12:53:11' && first.ExitPrice === 1.012 &&
  first.HoldMinutes === 0 && first.PnL === 0.4352 && first.PnLPct === 4.49 &&
  first.Direction === 'Long',
  JSON.stringify(first));

const last = result.rows[result.rows.length - 1];
check('last row is the AIBZ loss',
  last.Symbol === 'AIBZ' && last.Qty === 30 &&
  last.EntryPrice === 3.235 && last.ExitPrice === 3.16 && last.PnL === -2.25,
  JSON.stringify(last));

check('cancelled orders are not matched',
  !result.rows.some(r => [r.EntryPrice, r.ExitPrice].some(p => p === 2.89 || p === 2.9)));

// ---- Output contract: unchanged from trade-matcher.html ----
check('column order is the journal import order',
  OUT_COLS.join(',') === 'Symbol,Qty,EntryTime,EntryPrice,ExitTime,ExitPrice,HoldMinutes,PnL,PnLPct,Direction',
  OUT_COLS.join(','));

const out = toCsv(result.rows);
const lines = out.trim().split(/\r\n/);
check('CSV starts with the expected header',
  lines[0] === 'Symbol,Qty,EntryTime,EntryPrice,ExitTime,ExitPrice,HoldMinutes,PnL,PnLPct,Direction',
  lines[0]);
check('CSV has one line per matched trade plus the header',
  lines.length === result.rows.length + 1, String(lines.length));
check('every CSV row has ten columns', lines.every(l => l.split(',').length === 10));

// ---- Order-history fallback ----
// Older statements may not have the execution block. The order history has limit
// prices but shows `~` for market fills, so it must use only the priced FILLED
// orders and report the unpriced one.
const fallback = [
  'Account Summary',
  'Account Order History',
  'Notes,,Time Placed,Spread,Side,Qty,Pos Effect,Symbol,Exp,Strike,Type,PRICE,,TIF,Status',
  ',,10/19/26 10:01:00,STOCK,SELL,-10,TO CLOSE,ABCD,,,STOCK,1.30,LMT,DAY,FILLED',
  ',,10/19/26 10:00:00,STOCK,BUY,+10,TO OPEN,ABCD,,,STOCK,1.25,LMT,DAY,FILLED',
  ',,10/19/26 09:59:00,STOCK,BUY,+10,TO OPEN,ABCD,,,STOCK,1.20,LMT,DAY,CANCELED',
  ',,10/19/26 09:58:00,STOCK,SELL,-10,TO CLOSE,ABCD,,,STOCK,~,MKT,DAY,FILLED',
  ''
].join('\r\n');

const fb = buildTrades(fallback);
check('order-history fallback matches priced filled orders', fb.rows.length === 1, String(fb.rows.length));
check('order-history fallback computes the same PnL',
  fb.rows.length === 1 && fb.rows[0].PnL === 0.5, fb.rows[0] && String(fb.rows[0].PnL));
check('order-history fallback ignores CANCELED orders',
  fb.rows.every(r => r.EntryPrice !== 1.2 && r.ExitPrice !== 1.2));
check('order-history fallback reports the order with no fill price',
  fb.notes.some(n => n.indexOf('No fill price') === 0), fb.notes.join('; '));


// ---- The real journal importer reads the generated file ----
const MODULES = ['journal-categories.js', 'journal-csv.js', 'journal-draft.js'];
const journalSource = MODULES
  .map(f => fs.readFileSync(path.join(ROOT, 'js', f), 'utf8'))
  .join('\n');
const journalContext = vm.createContext({ console });
vm.runInContext(
  journalSource + '\n;globalThis.__journal = { JournalCSV };',
  journalContext,
  { filename: 'journal-modules.js' }
);
const imported = journalContext.__journal.JournalCSV.toEntries(out);
check('the journal importer reads every matched row', imported.entries.length === result.rows.length,
  String(imported.entries.length));
check('the journal importer skips no rows', imported.skipped === 0, String(imported.skipped));
check('the imported entry keeps the statement prices',
  imported.entries.length > 0 &&
  imported.entries[0].tradeData.entryPrice === 0.96848 &&
  imported.entries[0].tradeData.exitPrice === 1.012);

// ---- Summary ----
console.log(passed + ' checks passed');
if (failures.length) {
  console.log(failures.length + ' FAILED:');
  failures.forEach(f => console.log('  x ' + f));
  process.exitCode = 1;
} else {
  console.log('All good - the statement converts to the same import CSV.\n');
}