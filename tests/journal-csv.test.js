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
eq('A–Z: 26 columns', fields.length, 26);
eq('A–Z: letters in order', CSV.letters().join(','),
  'A,B,C,D,E,F,G,H,I,J,K,L,M,N,O,P,Q,R,S,T,U,V,W,X,Y,Z');
check('A–Z: keys are unique', new Set(CSV.keys()).size === 26);
eq('A–M match the sheet columns (letter + key)',
  CSV.verifyColumns(), []);
eq('A–M keys equal JOURNAL_COLUMNS', CSV.letters().slice(0, 13).map(l => CSV.keyByLetter(l)),
  JOURNAL_COLUMNS.map(c => c.key));
eq('sheet letters equal CSV letters', CSV.letters().slice(0, 13), JOURNAL_COLUMNS.map(c => c.sheet));
eq('N–Z are the timing/price/meta letters',
  fields.slice(13).map(f => f.key),
  ['direction', 'entryDate', 'entryTime', 'entryPrice', 'exitDate', 'exitTime',
   'exitPrice', 'shares', 'fees', 'plannedRiskR', 'strategy', 'tags', 'processScore']);

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
close('named header: P&L computed from the numbers', named.entries[0].tradeData.pnl, -26, 0.005);
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




