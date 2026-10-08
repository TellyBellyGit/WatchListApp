// ============================================================================
// JOURNAL CSV + DRAFT — round-trip test (plain Node, no dependencies)
// ============================================================================
// Run it from the StockWatchList folder:
//
//     node tests/journal-csv.test.js
//
// The three journal modules are browser scripts that define globals, so they are
// concatenated into one shared VM context here — that is exactly how
// TradeJournal.html loads them (journal-categories.js → journal-csv.js →
// journal-draft.js), which means the test exercises the real load order.
//
// What it proves: the A–Z letter map is in step with the sheet's 13 columns, the
// example CSV survives a full build → parse → document round trip, a hand-made
// row with only a subset of the letters reads correctly, the P&L / duration /
// R-multiple match hand-computed values (including a trade that crosses
// midnight), and the offline draft never emits "undefined" or "NaN".
// ============================================================================

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const JS_DIR = path.join(__dirname, '..', 'js');
const MODULES = ['journal-categories.js', 'journal-csv.js', 'journal-draft.js'];

const source = MODULES
  .map(f => fs.readFileSync(path.join(JS_DIR, f), 'utf8'))
  .join('\n');

const context = vm.createContext({ console });
vm.runInContext(
  source + '\n;globalThis.__journal = { JournalCSV, JournalDraft, JournalCategories, JOURNAL_COLUMNS };',
  context,
  { filename: 'journal-modules.js' }
);

const { JournalCSV: CSV, JournalDraft: Draft, JOURNAL_COLUMNS } = context.__journal;

// ---- Tiny test harness -----------------------------------------------------
let passed = 0;
const failures = [];

function check(label, condition, detail) {
  if (condition) {
    passed++;
    return true;
  }
  failures.push(label + (detail ? ' — ' + detail : ''));
  return false;
}

function eq(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  return check(label, a === e, 'got ' + a + ', expected ' + e);
}

function close(label, actual, expected, tolerance = 1e-9) {
  const ok = typeof actual === 'number' && Math.abs(actual - expected) <= tolerance;
  return check(label, ok, 'got ' + actual + ', expected ' + expected);
}

function noBadTokens(label, value) {
  const text = JSON.stringify(value);
  const hits = text.match(/undefined|NaN|Infinity/g);
  return check(label, !hits, hits ? 'found ' + [...new Set(hits)].join(', ') : '');
}

console.log('\n=== Journal CSV + Draft round-trip test ===\n');

// ============================================================================
// 1. The letter map A–Z
// ============================================================================
const fields = CSV.fields();
eq('A–Z: 26 lettered columns', CSV.letters().length, 26);
eq('field map: the 26 letters plus the 3 letterless columns', fields.length, 29);
eq('A–Z: letters in order', CSV.letters().join(','),
  'A,B,C,D,E,F,G,H,I,J,K,L,M,N,O,P,Q,R,S,T,U,V,W,X,Y,Z');
check('field map: keys are unique', new Set(CSV.keys()).size === 29);
eq('A–M match the sheet columns (letter + key)',
  CSV.verifyColumns(), []);
eq('A–M keys equal JOURNAL_COLUMNS', CSV.letters().slice(0, 13).map(l => CSV.keyByLetter(l)),
  JOURNAL_COLUMNS.map(c => c.key));
eq('sheet letters equal CSV letters', CSV.letters().slice(0, 13), JOURNAL_COLUMNS.map(c => c.sheet));
eq('N–Z are the timing/price/meta letters',
  fields.slice(13, 26).map(f => f.key),
  ['direction', 'entryDate', 'entryTime', 'entryPrice', 'exitDate', 'exitTime',
   'exitPrice', 'shares', 'fees', 'plannedRiskR', 'strategy', 'tags', 'processScore']);
eq('the letterless fields are matched by name, never by letter', CSV.namedKeys(),
  ['groupId', 'holdMinutes', 'pnlPercent']);
check('no letterless field is addressable by letter',
  CSV.fieldByLetter(null) === null && CSV.letterByKey('groupId') === null &&
  CSV.letterByKey('holdMinutes') === null && CSV.letterByKey('pnlPercent') === null);
check('the named fields are still reachable by name',
  CSV.fieldByKey('groupId') !== null && CSV.fieldByKey('groupId').label === 'Group' &&
  CSV.fieldByKey('holdMinutes').label === 'Hold (min)' &&
  CSV.fieldByKey('pnlPercent').label === 'P&L percent');
// The label check runs BEFORE the alias table (see _keyFromLabel), so a label that
// normalises onto "pnl" would quietly steal the sheet's Outcome / P&L column
check('the P&L% label does not collide with "PnL"', CSV._norm('P&L percent') !== 'pnl');
eq('"PnL" still means the Outcome column', CSV._keyFromLabel('PnL'), 'outcome');
eq('a broker\'s "PnLPct" is the P&L percentage', CSV._keyFromLabel('PnLPct'), 'pnlPercent');
eq('a broker\'s "HoldMinut" is the hold time', CSV._keyFromLabel('HoldMinut'), 'holdMinutes');
eq('csvKeys() is the A–Z subset (the example CSV is unchanged)', CSV.csvKeys().length, 26);
check('csvKeys() keeps sheet order', CSV.csvKeys().join(',') === CSV.keys().slice(0, 26).join(','));

// ============================================================================
// 2. The example CSV: build → parse → documents
// ============================================================================
const example = CSV.buildExample();
const exampleLines = example.trim().split(/\r?\n/);
eq('example: first row is the letters row', exampleLines[0], CSV.letters().join(','));
eq('example: second row is the labels row', exampleLines[1].split(',').length, 26);
eq('example: two data rows', exampleLines.length, 4);
check('example: quotes protect the tags cell', example.indexOf('"chase;opening-range"') !== -1);

const round = CSV.toEntries(example, { defaultDate: '2026-10-01' });
eq('round trip: 2 entries', round.entries.length, 2);
eq('round trip: nothing skipped', round.skipped, 0);
eq('round trip: delimiter detected', round.delimiter, ',');
eq('round trip: header kind', round.header.kind, 'letters');
eq('round trip: two header rows consumed', round.header.headerRows, 2);
eq('round trip: all 26 columns mapped', round.header.columns.length, 26);
noBadTokens('round trip: no undefined/NaN', round.entries);

const [nvda, tsla] = round.entries;
eq('NVDA: ticker', nvda.ticker, 'NVDA');
eq('NVDA: category normalised', nvda.category, 'Poor entry');
eq('NVDA: trade date = column A', nvda.date, '2026-09-29');
eq('NVDA: strategy', nvda.tradeData.strategy, 'ORB — momentum continuation');
eq('NVDA: entry moment', nvda.tradeData.entryTime, '2026-09-29T09:41');
eq('NVDA: exit moment', nvda.tradeData.exitTime, '2026-09-29T09:47');
eq('NVDA: entry date column', nvda.tradeData.entryDate, '2026-09-29');
eq('NVDA: duration', nvda.tradeData.durationMin, 6);
close('NVDA: per-share', nvda.tradeData.exitPrice - nvda.tradeData.entryPrice, -0.85, 1e-9);
close('NVDA: net P&L', nvda.tradeData.pnl, -104.10, 0.005);
close('NVDA: P&L %', nvda.tradeData.pnlPercent, -0.4765, 0.0001);
close('NVDA: realised R', nvda.tradeData.realisedR, -0.694, 0.0001);
eq('NVDA: outcome text derived', nvda.outcome, '-$104.10 (-0.48%)');
eq('NVDA: tags', nvda.tags, ['chase', 'opening-range']);
eq('NVDA: process score', nvda.processScore, 3);
eq('NVDA: symbol mirrors the ticker', nvda.symbol, 'NVDA');
eq('NVDA: dot notation only (no review link)',
  [nvda.reviewId, nvda.content, nvda.mentor.status], [null, null, 'not-reviewed']);

eq('TSLA: direction', tsla.tradeData.direction, 'short');
eq('TSLA: entry moment', tsla.tradeData.entryTime, '2026-09-30T23:58');
eq('TSLA: exit rolled to the next day', tsla.tradeData.exitTime, '2026-10-01T00:05');
eq('TSLA: duration across midnight', tsla.tradeData.durationMin, 7);
close('TSLA: net P&L (short)', tsla.tradeData.pnl, 94.60, 0.005);
eq('TSLA: outcome text derived', tsla.outcome, '+$94.60 (+0.47%)');
check('TSLA: overnight roll warned about',
  round.warnings.some(w => /past midnight/i.test(w)), JSON.stringify(round.warnings));

// ============================================================================
// 3. Every letter lands on the right key
// ============================================================================
const letterProbe = {};
CSV.fields().forEach((f, i) => { letterProbe[f.key] = 'v' + f.letter; });
const allLettersCsv = [
  CSV.lettersLine(),
  CSV.dataLine(letterProbe)
].join('\n');
const probe = CSV.toEntries(allLettersCsv, { defaultDate: '2026-01-01' });
eq('one row with all 26 letters parses', probe.entries.length, 1);
eq('every letter mapped', probe.header.columns.map(c => c.letter).join(','), CSV.letters().join(','));

// A subset of the letters is enough
const subsetCsv = [
  'A,B,D,N,O,P,Q,R,S,T,U,V,W',
  '2026-09-30,TSLA,Poor entry,short,2026-09-30,23:58,254.10,,00:05,252.90,80,1.40,200'
].join('\n');
const subset = CSV.toEntries(subsetCsv, { defaultDate: '2026-01-01' });
eq('subset header: 13 mapped columns', subset.header.columns.length, 13);
eq('subset: one entry', subset.entries.length, 1);
eq('subset: duration across midnight', subset.entries[0].tradeData.durationMin, 7);
close('subset: net P&L', subset.entries[0].tradeData.pnl, 94.60, 0.005);
eq('subset: category matched', subset.entries[0].category, 'Poor entry');

// ============================================================================
// 4. Header forms and separators
// ============================================================================
// Letters with the sheet header behind them: "A · Date"
const prefixedCsv = [
  'A · Date,B · Ticker,D · Category,N · Direction,O · Entry date,P · Entry time,Q · Entry price,R · Exit date,S · Exit time,T · Exit price,U · Shares',
  '2026-09-29,NVDA,FOMO,long,2026-09-29,09:41,100.00,2026-09-29,09:55,100.50,10'
].join('\n');
const prefixed = CSV.toEntries(prefixedCsv, { defaultDate: '2026-01-01' });
eq('letter+label header: kind', prefixed.header.kind, 'letter-labels');
eq('letter+label header: one entry', prefixed.entries.length, 1);
eq('letter+label header: category matched', prefixed.entries[0].category, 'FOMO / Chasing');
eq('letter+label header: duration', prefixed.entries[0].tradeData.durationMin, 14);

// Names only, in a different order, with hand-written spellings
const namedCsv = [
  'Symbol,Category,Date,Entry Price,Exit Price,Qty,Entry Time,Exit Time,Commission,Net P&L',
  'AAPL,management,2026-09-29,200,199.5,50,10:00,10:30,1,24'
].join('\n');
const named = CSV.toEntries(namedCsv, { defaultDate: '2026-01-01' });
eq('named header: kind', named.header.kind, 'names');
eq('named header: keys mapped', named.header.columns.map(c => c.key),
  ['ticker', 'category', 'date', 'entryPrice', 'exitPrice', 'shares', 'entryTime', 'exitTime', 'fees', 'outcome']);
eq('named header: category matched from one word', named.entries[0].category, 'Management error');
// The price fell (200 → 199.5) while the file's own Net P&L column says +24, and
// both can only be true of a SHORT. Deriving the direction turns that +24 winner
// back into +24; reading the row as a long would report it as a -26 loser.
eq('named header: direction derived from the price move and the P&L',
  named.entries[0].tradeData.direction, 'short');
close('named header: P&L computed from the numbers', named.entries[0].tradeData.pnl, 24, 0.005);
eq('named header: outcome text kept as written', named.entries[0].outcome, '24');

// Semicolon separator, with the tags cell quoted
const semiCsv = [
  'A;B;D;N;Q;T;U;Y',
  '2026-09-29;NVDA;Poor entry;long;178.40;177.55;120;"chase;size"'
].join('\n');
const semi = CSV.toEntries(semiCsv, { defaultDate: '2026-01-01' });
eq('semicolon CSV: delimiter', semi.delimiter, ';');
eq('semicolon CSV: quoted tags cell', semi.entries[0].tags, ['chase', 'size']);
close('semicolon CSV: net P&L (no fees column)', semi.entries[0].tradeData.pnl, -102, 0.005);

// No header at all, 13 columns wide → read positionally as A–M
const positionalCsv = [
  '2026-09-29,NVDA,5-min,Poor entry,Opening range break,t1,w1,h1,i1,j1,k1,l1,m1',
  '2026-09-30,TSLA,1-min,Good trade / Win,x,t2,w2,h2,i2,j2,k2,l2,m2'
].join('\n');
const positional = CSV.toEntries(positionalCsv, { defaultDate: '2026-01-01' });
eq('13 columns: read positionally as A–M', positional.header.kind, 'positional');
eq('13 columns: two entries', positional.entries.length, 2);
eq('13 columns: column A is the date', positional.entries[0].date, '2026-09-29');
eq('13 columns: column B is the ticker', positional.entries[1].ticker, 'TSLA');
check('13 columns: warns that no header was found',
  positional.warnings.some(w => /positionally/i.test(w)));

// Nothing recognisable → a clear message, never a crash
const bad = CSV.toEntries('one,two\nthree,four', { defaultDate: '2026-01-01' });
eq('unreadable CSV: no entries', bad.entries.length, 0);
eq('unreadable CSV: header kind', bad.header.kind, 'unknown');
check('unreadable CSV: says how to fix it', bad.warnings.some(w => /header row/i.test(w)));

// ============================================================================
// 5. Dates, times, numbers and vocabularies
// ============================================================================
eq('date: ISO', CSV.normaliseDate('2026-09-29'), '2026-09-29');
eq('date: ISO with a time', CSV.normaliseDate('2026-09-29 09:41:00'), '2026-09-29');
eq('date: slashes, US order', CSV.normaliseDate('09/29/2026'), '2026-09-29');
eq('date: slashes, day first when it must be', CSV.normaliseDate('29/09/2026'), '2026-09-29');
eq('date: written month, day first', CSV.normaliseDate('29 Sep 2026'), '2026-09-29');
eq('date: written month, month first', CSV.normaliseDate('Sep 29, 2026'), '2026-09-29');
eq('date: unformatted Excel serial', CSV.normaliseDate('45000'), '2023-03-15');
eq('date: rubbish is null', CSV.normaliseDate('not a date'), null);

// Display is day-first while storage stays ISO: sorting, the date-range filter and
// session grouping all compare the stored string, so only the print changes
eq('display: an ISO date prints as dd/mm/yyyy', CSV.displayDate('2026-10-07'), '07/10/2026');
eq('display: the first of the month', CSV.displayDate('2026-01-01'), '01/01/2026');
eq('display: an ISO moment keeps only the date', CSV.displayDate('2026-10-07T09:41:33Z'), '07/10/2026');
eq('display: a hand-written month-first date reads month-first', CSV.displayDate('10/07/2026'), '07/10/2026');
eq('display: empty is empty', CSV.displayDate(''), '');
eq('display: null is empty', CSV.displayDate(null), '');
eq('display: rubbish is empty', CSV.displayDate('not a date'), '');

eq('time: HH:MM', CSV.normaliseTime('09:41'), '09:41');
eq('time: inside a full moment', CSV.normaliseTime('2026-09-29T09:41:33'), '09:41');
eq('time: four digits', CSV.normaliseTime('0941'), '09:41');
eq('time: three digits', CSV.normaliseTime('941'), '09:41');
eq('time: am/pm', CSV.normaliseTime('9:41 PM'), '21:41');
eq('time: am/pm midnight', CSV.normaliseTime('12:00 AM'), '00:00');
eq('time: unformatted Excel fraction', CSV.normaliseTime(0.5), '12:00');

eq('number: currency + thousands', CSV.parseNumber('$1,234.56'), 1234.56);
eq('number: negative in parentheses', CSV.parseNumber('(120.50)'), -120.5);
eq('number: leading plus', CSV.parseNumber('+42'), 42);
eq('number: rubbish is null', CSV.parseNumber('n/a'), null);
eq('int: rounds an Excel float cell', CSV.parseInt10('120.0'), 120);

eq('category: exact', CSV.matchCategory('Poor entry'), { name: 'Poor entry', exact: true, known: true });
eq('category: one word (FOMO)', CSV.matchCategory('FOMO').name, 'FOMO / Chasing');
eq('category: one word (management)', CSV.matchCategory('management').name, 'Management error');
eq('category: exact multi-word', CSV.matchCategory('Good trade / Win').name, 'Good trade / Win');
eq('category: kept when unknown', CSV.matchCategory('Mystery').name, 'Mystery');
eq('category: unknown is flagged', CSV.matchCategory('Mystery').known, false);
eq('timeframe: 5min → 5-min', CSV.matchVocabulary('5min', ['10-sec', '1-min', '5-min']), '5-min');
eq('timeframe: "15 minutes" → 15-min',
  CSV.matchVocabulary('15 minutes', ['10-sec', '1-min', '5-min', '15-min']), '15-min');
eq('tags: semicolon, pipe and comma', CSV.parseTags('a;b|c, d'), ['a', 'b', 'c', 'd']);

// ============================================================================
// 6. The arithmetic — one implementation, so assert it closely
// ============================================================================
const long = CSV.computeTradeNumbers({
  direction: 'long', entryDate: '2026-09-29', entryTime: '09:41', entryPrice: '178.40',
  exitDate: '2026-09-29', exitTime: '09:47', exitPrice: '177.55',
  shares: '120', fees: '2.10', plannedRiskR: '150'
});
close('long: per share', long.perShare, -0.85, 1e-9);
close('long: net P&L', long.pnl, -104.10, 0.005);
eq('long: duration', long.durationMin, 6);
close('long: R-multiple', long.realisedR, -0.694, 0.0001);
eq('long: same-day trade', long.crossedMidnight, false);

const short = CSV.computeTradeNumbers({
  direction: 'short', entryDate: '2026-09-30', entryTime: '23:58', entryPrice: '254.10',
  exitTime: '00:05', exitPrice: '252.90', shares: '80', fees: '1.40', plannedRiskR: '200'
});
close('short: per share', short.perShare, 1.2, 1e-9);
eq('short: exit date rolled forward', short.exitDate, '2026-10-01');
eq('short: roll is flagged', short.rolledExitDate, true);
eq('short: midnight crossing flagged', short.crossedMidnight, true);
eq('short: duration across midnight', short.durationMin, 7);
close('short: R-multiple', short.realisedR, 0.473, 0.0001);

// The same trade with the exit date written out gives the same answer
const explicit = CSV.computeTradeNumbers({
  direction: 'short', entryDate: '2026-09-30', entryTime: '23:58', entryPrice: '254.10',
  exitDate: '2026-10-01', exitTime: '00:05', exitPrice: '252.90',
  shares: '80', fees: '1.40', plannedRiskR: '200'
});
eq('explicit next-day exit: duration', explicit.durationMin, 7);
eq('explicit next-day exit: nothing rolled', explicit.rolledExitDate, false);
close('explicit next-day exit: same P&L', explicit.pnl, short.pnl, 1e-9);

// Prices missing: no P&L, but the duration still shows
const timingOnly = CSV.computeTradeNumbers({ entryDate: '2026-09-29', entryTime: '09:41', exitTime: '10:11' });
eq('timing only: no P&L', timingOnly.pnl, null);
eq('timing only: duration still computed', timingOnly.durationMin, 30);
eq('timing only: no R', timingOnly.realisedR, null);

// An exit before the entry is refused, not turned into a negative duration
const backwards = CSV.computeTradeNumbers({
  entryDate: '2026-09-29', entryTime: '10:00', exitDate: '2026-09-29', exitTime: '09:00'
});
eq('backwards times: duration refused', backwards.durationMin, null);

// A date-only day trade has no duration, but it still has a P&L
const noTimes = CSV.computeTradeNumbers({ entryDate: '2026-09-29', entryPrice: '10', exitPrice: '11', shares: '10' });
eq('no times: duration null', noTimes.durationMin, null);
close('no times: P&L still computed', noTimes.pnl, 10, 0.005);

// An entry with no date at all falls back to the caller's default
const defaulted = CSV.computeTradeNumbers({ entryTime: '09:41', exitTime: '10:00', defaultDate: '2026-10-05' });
eq('default date: used for the entry', defaulted.entryDate, '2026-10-05');
eq('default date: duration computed', defaulted.durationMin, 19);

// Prices with no size: ONE share is assumed, so the figures still exist
const assumed = CSV.computeTradeNumbers({
  direction: 'long', entryDate: '2026-09-29', entryTime: '09:41', entryPrice: '178.40',
  exitDate: '2026-09-29', exitTime: '09:47', exitPrice: '177.55'
});
eq('assumed size: the shares fall back to one', assumed.shares, 1);
eq('assumed size: the assumption is declared', assumed.assumedShares, true);
close('assumed size: net P&L is the per-share result', assumed.pnl, -0.85, 1e-9);
close('assumed size: the return is still a percentage', assumed.pnlPercent, -0.4765, 0.0001);
eq('assumed size: no planned 1R, so still no R', assumed.realisedR, null);

const assumedR = CSV.computeTradeNumbers({
  entryDate: '2026-09-29', entryPrice: '10', exitPrice: '11', plannedRiskR: '5'
});
close('assumed size: R divides the P&L by the assumed one share', assumedR.realisedR, 0.2, 1e-9);

// A size the user gave is never overwritten — not even a deliberate zero
const sized = CSV.computeTradeNumbers({ entryDate: '2026-09-29', entryPrice: '10', exitPrice: '11', shares: '120' });
eq('a real size: no assumption', sized.assumedShares, false);
eq('a real size: kept as given', sized.shares, 120);
const zeroed = CSV.computeTradeNumbers({ entryDate: '2026-09-29', entryPrice: '10', exitPrice: '11', shares: '0' });
eq('zero shares: not read as missing', zeroed.assumedShares, false);
eq('zero shares: kept as zero', zeroed.shares, 0);

// One price alone is still not enough for anything, and an entry price of zero
// cannot produce a percentage either — so neither is assumed
const halfPriced = CSV.computeTradeNumbers({ entryDate: '2026-09-29', entryPrice: '10' });
eq('one price only: nothing is assumed', halfPriced.assumedShares, false);
eq('one price only: still no P&L', halfPriced.pnl, null);
eq('one price only: the size stays null', halfPriced.shares, null);
const zeroEntry = CSV.computeTradeNumbers({ entryDate: '2026-09-29', entryPrice: '0', exitPrice: '11' });
eq('zero entry price: nothing is assumed', zeroEntry.assumedShares, false);
eq('zero entry price: no P&L', zeroEntry.pnl, null);

eq('duration text: minutes', CSV.formatDuration(6), '6m');
eq('duration text: hours + minutes', CSV.formatDuration(65), '1h 5m');
eq('duration text: whole hours', CSV.formatDuration(120), '2h');
eq('duration text: days', CSV.formatDuration(1500), '1d 1h');
eq('timing line', CSV.describeTiming({ entryTime: '09:41', exitTime: '09:47', durationMin: 6 }), '09:41 → 09:47 · 6m');
eq('timing line: overnight', CSV.describeTiming({ entryTime: '23:58', exitTime: '00:05', durationMin: 7, rolledExitDate: true }),
  '23:58 → 00:05 (+1d) · 7m');

eq('tradeData keys are the form/import contract',
  Object.keys(CSV.buildTradeData({ direction: 'long' })).sort(),
  ['direction', 'durationMin', 'entryDate', 'entryPrice', 'entryTime', 'exitDate',
   'exitPrice', 'exitTime', 'fees', 'plannedRiskR', 'pnl', 'pnlPercent', 'realisedR',
   'shares', 'strategy'].sort());
eq('outcome text: win', CSV.outcomeText({ pnl: 320, pnlPercent: 1.42 }), '+$320.00 (+1.42%)');
eq('outcome text: loss', CSV.outcomeText({ pnl: -104.1, pnlPercent: -0.4765 }), '-$104.10 (-0.48%)');
eq('outcome text: nothing to show', CSV.outcomeText({ pnl: null }), null);

// ============================================================================
// 7. Rows that cannot be imported say why
// ============================================================================
const mixedCsv = [
  'A,B,D,N,Q,T,U',
  '2026-09-29,NVDA,Poor entry,long,178.40,177.55,120',
  '2026-09-29,,,long,178.40,177.55,120',
  'not-a-date,AMD,Setup error,short,abc,120,10'
].join('\n');
const mixed = CSV.toEntries(mixedCsv, { defaultDate: '2026-10-05' });
eq('mixed: two entries kept', mixed.entries.length, 2);
eq('mixed: one row skipped', mixed.skipped, 1);
check('mixed: the skip is explained', mixed.warnings.some(w => /skipped/i.test(w)));
check('mixed: the unreadable price is explained', mixed.warnings.some(w => /not a number/i.test(w)));
eq('mixed: the fallback date is used', mixed.entries[1].date, '2026-10-05');
eq('mixed: preview keeps the CSV line numbers', mixed.preview.map(p => p.line), [2, 4]);
noBadTokens('mixed: no undefined/NaN', mixed);
eq('empty text: nothing to import', CSV.toEntries('').entries.length, 0);
eq('empty text: header kind', CSV.toEntries('').header.kind, 'empty');

// A priced row with no size imports as one share — and says so
const noSizeCsv = [
  'A,B,D,N,Q,T,U',
  '2026-09-29,NVDA,Poor entry,long,178.40,177.55,'
].join('\n');
const noSize = CSV.toEntries(noSizeCsv, { defaultDate: '2026-10-05' });
eq('no size on import: the row is kept', noSize.entries.length, 1);
eq('no size on import: one share is stored', noSize.entries[0].tradeData.shares, 1);
close('no size on import: the P&L is the per-share figure', noSize.entries[0].tradeData.pnl, -0.85, 0.005);
check('no size on import: the assumption is warned about, with the row number',
  noSize.warnings.some(w => /Row 2:.*1 share assumed/i.test(w)), JSON.stringify(noSize.warnings));
noBadTokens('no size on import: no undefined/NaN', noSize);

// ============================================================================
// 8. The offline draft helper (no network, no key)
// ============================================================================
const draftInput = {
  date: '2026-09-29', ticker: 'nvda', timeframe: '5-min', category: 'Poor entry',
  setup: 'Opening range break', direction: 'long',
  entryDate: '2026-09-29', entryTime: '09:41', entryPrice: '178.40',
  exitDate: '2026-09-29', exitTime: '09:47', exitPrice: '177.55',
  shares: '120', fees: '2.10', plannedRiskR: '150', stopPrice: '177.50', processScore: '3',
  facts: '- Opening range broke with volume\n- I had missed the first push',
  expected: 'Price to hold above the breakout level',
  context: 'Sector was strong'
};
const draft = Draft.build(draftInput);
eq('draft: seven prose fields', draft.fields.length, 7);
eq('draft: field keys in sheet order', draft.fields.map(f => f.key),
  ['entryTrigger', 'whyEntered', 'whatWentWrong', 'whyItWentWrong', 'advice', 'keyLesson', 'review']);
eq('draft: field letters', draft.fields.map(f => f.letter), ['F', 'G', 'H', 'I', 'J', 'K', 'M']);
noBadTokens('draft: no undefined/NaN anywhere', draft);
check('draft: facts carried into column G',
  /Opening range broke with volume/.test(draft.fields[1].text));
check('draft: the category fix lands in column J',
  /retest of the level/.test(draft.fields[4].text));
close('draft: stop distance derived from the stop price', draft.facts.stopDistance, 0.9, 1e-9);
check('draft: stop distance reported as R too',
  draft.notes.some(n => /Stop 0\.90 away \(0\.72R\)/.test(n)), JSON.stringify(draft.notes));
check('draft: the numbers make it into the review line',
  /-\$104\.10 \(-0\.69R\)/.test(draft.fields[6].text), draft.fields[6].text);
check('draft: the fields that need the trader\u2019s own memory carry the marker',
  ['whyItWentWrong', 'advice', 'keyLesson', 'review'].every(k => {
    const f = draft.fields.find(x => x.key === k);
    return f && f.text.indexOf(Draft.editMarker) !== -1;
  }));
check('draft: a fully evidenced field needs no marker',
  draft.fields.find(f => f.key === 'whatWentWrong').text.indexOf(Draft.editMarker) === -1);
eq('draft: focus follows the category',
  draft.fields.filter(f => f.focus).map(f => f.key).join(','),
  'entryTrigger,whatWentWrong,advice');

// A different category reads differently
const fomo = Draft.build({ category: 'FOMO / Chasing', facts: 'price was already moving' });
check('draft: FOMO advice is about chasing', /already left without me/.test(fomo.fields[4].text));
const win = Draft.build({
  category: 'Good trade / Win', direction: 'long',
  entryPrice: '10', exitPrice: '11', shares: '100'
});
check('draft: a win reads as a template', /template/.test(win.fields[4].text));
check('draft: a win keeps the process frame', /process held/.test(win.fields[6].text));

// An empty form still produces a usable skeleton, and never a crash
const emptyDraft = Draft.build({});
eq('draft: empty input still makes seven fields', emptyDraft.fields.length, 7);
noBadTokens('draft: empty input has no bad tokens', emptyDraft);
check('draft: empty input asks for the category',
  emptyDraft.notes.some(n => /No category yet/.test(n)));
check('draft: empty input asks for the facts',
  emptyDraft.notes.some(n => /No facts written yet/.test(n)));

// ---- The prompt for the user's own chat ----
const prompt = Draft.prompt(draftInput);
check('prompt: asks for a single CSV block', /single CSV block/i.test(prompt));
check('prompt: carries the A–Z letter map', /A {2}date/.test(prompt) && /Z {2}processScore/.test(prompt));
check('prompt: carries the facts', /NVDA/.test(prompt) && /Opening range broke with volume/.test(prompt));
check('prompt: shows the example format', prompt.indexOf('A,B,D,N,O,P,Q,R,S,T,U,V,W') !== -1);
check('prompt: forbids invented specifics', /Do not invent/.test(prompt));
noBadTokens('prompt: no undefined/NaN', prompt);

// The example handed to the chat is importable as-is: the round trip closes
const promptCsv = Draft.exampleBlock();
const fromExample = CSV.toEntries(promptCsv, { defaultDate: '2026-10-01' });
eq('prompt example: both sample rows importable', fromExample.entries.length, 2);
eq('prompt example: ticker', fromExample.entries[0].ticker, 'NVDA');
eq('prompt example: category', fromExample.entries[0].category, 'Poor entry');
close('prompt example: net P&L', fromExample.entries[0].tradeData.pnl, -104.10, 0.005);
eq('prompt example: letters row is a subset', promptCsv.trim().split(/\r?\n/)[0].split(',').length, 13);

// ============================================================================
// 8. Sessions — several legs of one ticker on one day are ONE session
// ============================================================================
// A stored row carrying only what grouping and the rollup care about.
const leg = (id, date, ticker, pnl, extra = {}) => Object.assign({
  id, date, ticker,
  tradeData: {
    pnl, realisedR: pnl == null ? null : pnl / 100,
    durationMin: 5, shares: 10, fees: 1
  },
  mentor: {}, tags: []
}, extra);

// ---- The session key: ticker + date ---------------------------------------
eq('session: ticker + date make the key',
  CSV.sessionKey(leg('a', '2026-09-29', 'nvda', 10)), 'NVDA@2026-09-29');
eq('session: the ticker is case-insensitive',
  CSV.sessionKey(leg('b', '2026-09-29', 'NVDA', 10)),
  CSV.sessionKey(leg('c', '2026-09-29', 'nvda', 10)));
check('session: another date is another session',
  CSV.sessionKey(leg('a', '2026-09-29', 'NVDA', 1)) !== CSV.sessionKey(leg('a', '2026-09-30', 'NVDA', 1)));
eq('session: a row with neither ticker nor date has no key',
  CSV.sessionKey({ id: 'x', date: '', ticker: '' }), null);

// ---- The group key: a stored id wins, else the session key ---------------
eq('group key: computed from ticker + date',
  CSV.groupKeyFor(leg('a', '2026-09-29', 'nvda', 10)), 'auto:NVDA@2026-09-29');
eq('group key: a stored id always wins',
  CSV.groupKeyFor(leg('a', '2026-09-29', 'nvda', 10, { groupId: 'grp_1' })), 'g:grp_1');
check('group key: a stored id outranks a different ticker and date',
  CSV.groupKeyFor({ id: 'a', date: '2026-09-29', ticker: 'NVDA', groupId: 'grp_1' }) ===
  CSV.groupKeyFor({ id: 'b', date: '2027-01-04', ticker: 'TSLA', groupId: 'grp_1' }));
check('group key: a split-out row never merges back',
  CSV.groupKeyFor({ id: 'a', date: '2026-09-29', ticker: 'NVDA', groupId: 'solo_a' }) !==
  CSV.groupKeyFor({ id: 'b', date: '2026-09-29', ticker: 'NVDA', groupId: 'solo_b' }));
check('group key: two orphans are not merged with each other',
  CSV.groupKeyFor({ id: 'a' }) !== CSV.groupKeyFor({ id: 'b' }));
eq('isGrouped: a real id counts', CSV.isGrouped({ groupId: 'grp_x' }), true);
eq('isGrouped: a solo id does not', CSV.isGrouped({ groupId: 'solo_x' }), false);
eq('isGrouped: null does not', CSV.isGrouped({ groupId: null }), false);
eq('soloGroupId: built from the row it splits', CSV.soloGroupId('abc'), 'solo_abc');
check('isSoloGroupId: only the solo prefix',
  CSV.isSoloGroupId('solo_abc') && !CSV.isSoloGroupId('grp_abc'));

// ---- Grouping a filtered, sorted list -------------------------------------
const nvdaLegs = [
  leg('n1', '2026-09-29', 'NVDA', 120),
  leg('n2', '2026-09-29', 'NVDA', -40.5),
  leg('n3', '2026-09-29', 'NVDA', 210.5)
];
const mixedRows = [nvdaLegs[0], leg('t1', '2026-09-29', 'TSLA', 300), nvdaLegs[1], nvdaLegs[2]];
const sessions = CSV.groupEntries(mixedRows);

eq('grouping: one session per ticker + date', sessions.length, 2);
eq('grouping: a session holds its legs in the order given', sessions[0].ids, ['n1', 'n2', 'n3']);
eq('grouping: a lone row is a session of one', sessions[1].count, 1);
eq('grouping: first-seen order is kept', sessions.map(g => g.ticker), ['NVDA', 'TSLA']);
eq('grouping: the label reads as ticker · date', sessions[0].label, 'NVDA · 2026-09-29');
check('grouping: the legs are the very rows passed in', sessions[0].legs[2] === nvdaLegs[2]);
eq('grouping: an empty list makes no sessions', CSV.groupEntries([]).length, 0);

const roll = sessions[0].rollup;
eq('rollup: legs counted', roll.count, 3);
eq('rollup: wins and losses', [roll.wins, roll.losses], [2, 1]);
eq('rollup: net P&L is the sum of the legs', roll.netPnl, 290);
eq('rollup: gross win / gross loss', [roll.grossWin, roll.grossLoss], [330.5, 40.5]);
close('rollup: win rate', roll.winRate, 66.6667, 0.001);
close('rollup: average R across the legs', roll.avgR, 2.9 / 3, 0.0001);
eq('rollup: best and worst leg', [roll.bestPnl, roll.worstPnl], [210.5, -40.5]);
eq('rollup: shares and fees summed', [roll.totalShares, roll.totalFees], [30, 3]);
eq('rollup: time in trade summed', roll.totalDurationMin, 15);
eq('rollup: the advice tally starts empty', [roll.adviceTotal, roll.adviceApplied], [0, 0]);
noBadTokens('rollup: no undefined/NaN', roll);

// No price path is stored anywhere, so a session must never claim one
check('rollup: never claims MAE/MFE or a drawdown',
  ['mae', 'mfe', 'maxAdverse', 'maxFavourable', 'drawdown'].every(k => !(k in roll)));

// A session with no numbers at all still rolls up honestly
const blankRoll = CSV.rollup([
  leg('x', '2026-09-29', 'NVDA', null), leg('y', '2026-09-29', 'NVDA', null)
]);
eq('rollup: no numbers → no net P&L', blankRoll.netPnl, null);
eq('rollup: no numbers → win rate unknown, not 0%', blankRoll.winRate, null);
eq('rollup: the untraded legs are still counted', blankRoll.untraded, 2);
noBadTokens('rollup: a numberless session has no bad tokens', blankRoll);

// A stored id holds a session together across the ticker and the date
const overnightGroup = CSV.groupEntries([
  leg('o1', '2026-09-29', 'NVDA', 50, { groupId: 'grp_night' }),
  leg('o2', '2026-09-30', 'NVDA', -20, { groupId: 'grp_night' })
]);
eq('grouping: a stored id survives midnight', overnightGroup.length, 1);
eq('grouping: the date span is spelled out', overnightGroup[0].date, '2026-09-29 → 2026-09-30');
eq('grouping: the overnight net', overnightGroup[0].rollup.netPnl, 30);

// A session that mixes categories counts them, it never guesses one
const multiCat = CSV.groupEntries([
  leg('m1', '2026-09-29', 'NVDA', 10, { category: 'Poor entry', timeframe: '5-min' }),
  leg('m2', '2026-09-29', 'NVDA', 10, { category: 'FOMO / Chasing', timeframe: '1-min' })
]);
eq('grouping: distinct categories counted', multiCat[0].categories.length, 2);
eq('grouping: distinct timeframes listed', multiCat[0].timeframes, ['5-min', '1-min']);

// ---- stats + the one-line description -------------------------------------
const groupStats = CSV.groupStats(sessions);
eq('stats: sessions / multi-leg / single-leg / rows',
  [groupStats.sessions, groupStats.multiLeg, groupStats.singleLeg, groupStats.legs], [2, 1, 1, 4]);
eq('describeRollup: legs, W/L, money and R', CSV.describeRollup(roll),
  '3 legs · 2W / 1L · +$290.00 · +0.97R');
eq('describeRollup: without the count it is the story alone',
  CSV.describeRollup(roll, { noCount: true }), '2W / 1L · +$290.00 · +0.97R');
// A session of one: exactly what the table prints next to "1 trade"
const soloRoll = CSV.rollup([{ tradeData: { pnl: -1.6, realisedR: -0.16 } }]);
eq('describeRollup: a one-trade session still counts its leg by default',
  CSV.describeRollup(soloRoll), '1 leg · 0W / 1L · -$1.60 · -0.16R');
eq('describeRollup: a one-trade session reads as its own result',
  CSV.describeRollup(soloRoll, { noCount: true }), '0W / 1L · -$1.60 · -0.16R');
eq('describeRollup: nothing to describe says nothing', CSV.describeRollup(null), '');

// ---- writing group ids (exactly what the Import dialog does) --------------
const batch = CSV.toEntries([
  'A,B,D,O,P,Q,S,T,U,V',
  '2026-09-29,NVDA,Poor entry,2026-09-29,09:41,178.40,09:47,177.55,100,2',
  '2026-09-29,NVDA,FOMO / Chasing,2026-09-29,10:15,178.90,10:30,179.10,100,2',
  '2026-09-29,TSLA,Poor entry,2026-09-29,11:00,254.00,11:05,254.50,50,1'
].join('\n'), { defaultDate: '2026-09-29' });
eq('assign: three rows read', batch.entries.length, 3);
eq('assign: nothing is grouped before the import runs',
  batch.entries.map(e => e.groupId), [null, null, null]);

const assigned = CSV.assignGroupIds(batch.entries, { makeId: () => 'grp_test' });
eq('assign: the two NVDA rows share one id',
  [batch.entries[0].groupId, batch.entries[1].groupId], ['grp_test', 'grp_test']);
eq('assign: the lone TSLA row stays ungrouped', batch.entries[2].groupId, null);
eq('assign: one group out of two sessions', [assigned.groups, assigned.sessions], [1, 2]);
eq('assign: the batch now reads as two sessions', CSV.groupEntries(batch.entries).length, 2);
eq('assign: one of them has both legs', CSV.groupEntries(batch.entries)[0].count, 2);
eq('assign: a fresh id is opaque, not derived', /^grp_/.test(CSV.newGroupId()), true);

// ---- the Group column: matched by name, never by letter -------------------
const groupCsv = [
  'A,B,D,Group',
  '2026-09-29,NVDA,Poor entry,grp_keep',
  '2026-09-29,NVDA,FOMO / Chasing,grp_keep'
].join('\n');
const withGroup = CSV.toEntries(groupCsv, { defaultDate: '2026-09-29' });
eq('Group column: read by name', withGroup.header.columns.map(c => c.key),
  ['date', 'ticker', 'category', 'groupId']);
eq('Group column: the header row is consumed', withGroup.header.headerRows, 1);
eq('Group column: both rows carry the id', withGroup.entries.map(e => e.groupId),
  ['grp_keep', 'grp_keep']);
eq('Group column: so the file is one session', CSV.groupEntries(withGroup.entries).length, 1);
eq('Group column: the summary names it instead of a letter',
  CSV.summary(withGroup), '2 entries · separator "," · columns A,B,D,Group');
check('Group column: blank means no group id',
  CSV.toEntries('Date,Ticker,Group\n2026-09-29,NVDA,', {}).entries[0].groupId === null);
check('Group column: the name is matched loosely',
  CSV.toEntries('date,ticker,group id\n2026-09-29,NVDA,g1', {}).header.columns.length === 3);

// Writing an entry back out is symmetric: the id round-trips through a file
const reexport = CSV.toEntries([
  CSV.lettersLine(['date', 'ticker', 'groupId']),
  CSV.dataLine({ date: '2026-09-29', ticker: 'NVDA', groupId: 'grp_keep' }, ['date', 'ticker', 'groupId'])
].join('\n'), { defaultDate: '2026-09-29' });
eq('round trip: a written group id comes back', reexport.entries[0].groupId, 'grp_keep');

// The example CSV stays exactly A–Z: no Group column is advertised
check('the example CSV carries no Group column',
  exampleLines[1].indexOf('Group') === -1 && exampleLines[0].indexOf('groupId') === -1);

// ============================================================================
// 9. A broker export: nine columns, no letters, none of the prose
// ============================================================================
// This is the shape a broker hands over — Symbol, Qty, the two moments as
// "mm/dd/yyyy hh:mm", the two prices, and its own HoldMinut / PnL / PnLPct. The
// journal's prose columns (C–K, M, N, R, V–Z) do not exist in the file at all,
// so every one of them has to come out EMPTY: not guessed at, and not left
// holding whatever the previous row put there.
const brokerCsv = [
  'Symbol,Qty,EntryTime,EntryPrice,ExitTime,ExitPrice,HoldMinut,PnL,PnLPct',
  'NVDA,100,10/07/2026 09:41,150.25,10/07/2026 09:47,150.55,6,30.00,0.20',
  'TSLA,80,10/07/2026 23:58,254.10,10/08/2026 00:05,252.90,7,-96.00,-0.47',
  'AMD,50,10/07/2026 11:20,80.10,,79.85,9,12.50,0.31'
].join('\n');
const broker = CSV.toEntries(brokerCsv, { defaultDate: '2026-01-01' });
eq('broker: header matched by name', broker.header.kind, 'names');
eq('broker: nine columns mapped', broker.header.columns.map(c => c.key),
  ['ticker', 'shares', 'entryTime', 'entryPrice', 'exitTime', 'exitPrice',
   'holdMinutes', 'outcome', 'pnlPercent']);
eq('broker: three entries', broker.entries.length, 3);
eq('broker: nothing skipped', broker.skipped, 0);
noBadTokens('broker: no undefined/NaN', broker.entries);

const [b1, b2, b3] = broker.entries;
// There is no date column: the date is read out of the entry moment itself
eq('broker: the date comes from the entry moment', b1.date, '2026-10-07');
eq('broker: and prints day-first', CSV.displayDate(b1.date), '07/10/2026');
eq('broker: ticker', b1.ticker, 'NVDA');
eq('broker: size', b1.tradeData.shares, 100);
eq('broker: entry price', b1.tradeData.entryPrice, 150.25);
eq('broker: entry moment', b1.tradeData.entryTime, '2026-10-07T09:41');
eq('broker: exit moment', b1.tradeData.exitTime, '2026-10-07T09:47');
eq('broker: duration from the two times', b1.tradeData.durationMin, 6);
close('broker: net P&L', b1.tradeData.pnl, 30, 0.005);
close('broker: P&L %', b1.tradeData.pnlPercent, 0.1997, 0.0001);

// Everything the file does not carry stays empty
check('broker: every prose column is left empty',
  [b1.timeframe, b1.category, b1.setup, b1.entryTrigger, b1.whyEntered, b1.whatWentWrong,
   b1.whyItWentWrong, b1.advice, b1.keyLesson, b1.review].every(v => v === null),
  JSON.stringify([b1.timeframe, b1.category, b1.setup, b1.entryTrigger, b1.whyEntered]));
eq('broker: no tags invented', b1.tags, []);
eq('broker: no process score invented', b1.processScore, null);
eq('broker: no mentor review invented', b1.mentor.source, null);
eq('broker: no group id', b1.groupId, null);
eq('broker: no fees column, so no fees', b1.tradeData.fees, null);
eq('broker: no planned risk, so no R-multiple', b1.tradeData.realisedR, null);
eq('broker: no strategy column', b1.tradeData.strategy, null);
// HoldMinut and PnLPct are a second opinion on the arithmetic, not extra columns:
// what the journal stores is still durationMin / pnlPercent, computed itself
check('broker: the check columns are not written onto the document',
  !('holdMinutes' in b1) && !('pnlPercent' in b1));

// No direction column: the two prices and the file's own P&L have to decide, or
// every imported row would be booked as a long and a short would be squandered
eq('broker: a rising price with a positive P&L is a long', b1.tradeData.direction, 'long');
check('broker: the row says the direction was inferred',
  broker.warnings.some(w => /No direction column/.test(w)));
eq('broker: a falling price with a negative P&L is a long loser', b2.tradeData.direction, 'long');
eq('broker: a falling price with a positive P&L can only be a short', b3.tradeData.direction, 'short');
close('broker: the short P&L is the profit the file reports', b3.tradeData.pnl, 12.5, 0.005);
eq('broker: a trade past midnight keeps both dates',
  b2.tradeData.entryDate + '→' + b2.tradeData.exitDate, '2026-10-07→2026-10-08');
eq('broker: the midnight trade still has a duration', b2.tradeData.durationMin, 7);

// The one case the times cannot answer: no exit time at all. The file's HoldMinut
// fills it, and says so, rather than the trade showing no duration
eq('broker: a blank exit time leaves the duration to the file', b3.tradeData.durationMin, 9);
check('broker: and says where that duration came from',
  broker.warnings.some(w => /Duration read from Hold/.test(w)));
check('broker: none of it is reported as a disagreement',
  !broker.warnings.some(w => /disagrees/.test(w)));

// A file whose own arithmetic does not agree is reported, never adopted: the
// prices and the size are the journal's source of truth, so the view, the form
// and the P&L strip can never disagree with one another
const mismatch = CSV.toEntries([
  'Symbol,Qty,EntryTime,EntryPrice,ExitTime,ExitPrice,PnL,PnLPct',
  'NVDA,100,10/07/2026 09:41,150.25,10/07/2026 09:47,150.55,300.00,5.00'
].join('\n'), { defaultDate: '2026-10-07' });
close('broker: the computed P&L wins', mismatch.entries[0].tradeData.pnl, 30, 0.005);
check('broker: the file\'s own P&L is reported, not adopted',
  mismatch.warnings.some(w => /P&L "300\.00" disagrees/.test(w)));
check('broker: the file\'s own P&L % is reported too',
  mismatch.warnings.some(w => /P&L percent "5\.00" disagrees/.test(w)));

// ============================================================================
// Summary
// ============================================================================
console.log(passed + ' checks passed');
if (failures.length) {
  console.log(failures.length + ' FAILED:');
  failures.forEach(f => console.log('  x ' + f));
  process.exitCode = 1;
} else {
  console.log('All good — the letter map, the CSV round trip, the arithmetic and the draft helper agree.\n');
}




