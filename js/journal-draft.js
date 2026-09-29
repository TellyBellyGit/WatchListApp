// ============================================================================
// JOURNAL DRAFT — the offline writing helper (no network, no API key)
// ============================================================================
// The Trade Journal already records what happened. This module helps with the
// harder half: saying it in words. It runs entirely in the page — nothing is
// sent anywhere and there is no key to configure — and it does two things:
//
//   1. `build(input)` turns the facts already in the form into a GUIDED SKELETON
//      for the seven prose columns (F–K and M). Anything this code cannot know
//      is left as an explicit `— EDIT` marker rather than invented, and the
//      wording of the "why" and the "fix" follows the category, so a FOMO entry
//      reads differently from a Good trade / Win.
//   2. `prompt(input)` writes a ready-to-paste prompt for whatever AI chat the
//      user already has. The prompt carries the A–Z letter map and the exact
//      CSV format, so the answer can be pasted straight back into
//      Import → Paste CSV (see js/journal-csv.js).
//
// Dependencies: js/journal-csv.js (arithmetic + the letter map) and, when the
// page has it, js/journal-categories.js (the 11 categories and their focus).
// Both are looked up at call time so the module can also be loaded in Node.
// ============================================================================

// What each category actually means for the write-up, in three lines:
//   angle  — the sentence the "why it went wrong" column is really about
//   fix    — the advice/correction column, as one instruction
//   lesson — the memorable one-liner for the key-lesson column
const JOURNAL_DRAFT_ANGLES = {
  'Unplanned trade / No thesis': {
    angle: 'there was no written thesis and no invalidation level before the order went in',
    fix: 'Write the thesis and the invalidation level before the order goes in. No thesis, no trade.',
    lesson: 'If it cannot be written down before the entry, it is not a trade, it is a reaction.'
  },
  'FOMO / Chasing': {
    angle: 'price was already moving and the fear of missing the move made the decision',
    fix: 'If the move has already left without me, the trade is gone — wait for the pullback into the level or skip it.',
    lesson: 'Missing a move costs nothing. Chasing one costs money.'
  },
  'Poor entry': {
    angle: 'the setup was valid but the entry was taken late, at an extended price',
    fix: 'When the first push is gone, wait for the retest of the level. If it never comes back, there is no trade.',
    lesson: 'Location is part of the setup, not a detail of it.'
  },
  'Poor structural stop': {
    angle: 'the stop was set by price distance instead of by the level that invalidates the idea',
    fix: 'Place the stop beyond the level that proves the idea wrong, then size the position from that distance.',
    lesson: 'The stop belongs to the structure, and the size belongs to the stop.'
  },
  'Premature exit': {
    angle: 'the thesis was still intact when the position was closed',
    fix: 'Exit only on the plan: the target, the stop, or a genuine invalidation — never on discomfort.',
    lesson: 'Discomfort is not information about the trade.'
  },
  'Letting loser run': {
    angle: 'the idea was already invalidated and the position was held anyway',
    fix: 'When the invalidation level trades, the trade is over. Take the loss at the level, not after it.',
    lesson: 'The cheap loss is the one taken at the level.'
  },
  'Good trade / Loss': {
    angle: 'the process and the risk were right, and the trade lost anyway',
    fix: 'Repeat this trade exactly as it was taken. A planned loss is a cost of doing business.',
    lesson: 'Judge the trade by the decisions, not by the result.'
  },
  'Good trade / Win': {
    angle: 'the plan was followed from the entry through to the exit',
    fix: 'Keep this entry, this size and this exit rule — this is the template to repeat.',
    lesson: 'This is what a correct trade looks like, whatever the next one does.'
  },
  'Context error': {
    angle: 'the wider market or stock context was misread, or never checked',
    fix: 'Check the index, the sector and the time of day before the entry, and write the context down first.',
    lesson: 'The same setup is a different trade in a different context.'
  },
  'Setup error': {
    angle: 'the trade did not actually meet the planned criteria for the setup',
    fix: 'Read the setup checklist before the entry. If one condition is missing, there is no setup.',
    lesson: 'Almost the setup is not the setup.'
  },
  'Management error': {
    angle: 'the entry was reasonable but the position was managed badly afterwards',
    fix: 'Decide the management rule before the entry: where to take partials, where to move the stop, when to leave.',
    lesson: 'Management is planned before the entry, not improvised during it.'
  }
};

// Fallback wording for a row whose category is blank or off-list
const JOURNAL_DRAFT_DEFAULT_ANGLE = {
  angle: 'the trade was taken and the outcome below is what price actually did',
  fix: 'Name the rule that was broken here, and the one condition that would have made this trade a pass.',
  lesson: 'The journal entry is only useful if it ends in one instruction.'
};

const JOURNAL_DRAFT_EDIT = '— EDIT';

// The seven prose columns the helper writes into, in sheet order
const JOURNAL_DRAFT_FIELD_KEYS = ['entryTrigger', 'whyEntered', 'whatWentWrong', 'whyItWentWrong', 'advice', 'keyLesson', 'review'];

const JournalDraft = {
  editMarker: JOURNAL_DRAFT_EDIT,

  // js/journal-csv.js is loaded before this file on TradeJournal.html
  _csv() { return (typeof JournalCSV !== 'undefined') ? JournalCSV : null; },

  _cap(text) {
    const s = String(text == null ? '' : text);
    return s ? s.charAt(0).toUpperCase() + s.substring(1) : '';
  },

  _categoryMeta(name) {
    if (typeof JournalCategories === 'undefined' || !JournalCategories.byName) return null;
    return JournalCategories.byName(name);
  },

  // The category's angle/fix/lesson, falling back to neutral wording
  _angle(name) {
    if (name && JOURNAL_DRAFT_ANGLES[name]) return JOURNAL_DRAFT_ANGLES[name];
    return JOURNAL_DRAFT_DEFAULT_ANGLE;
  },

  // ========================================================================
  // Everything the facts can honestly say about this trade
  // ========================================================================
  _describe(values = {}) {
    const csv = this._csv();
    const text = (v) => (v == null ? '' : String(v).trim());
    const notes = [];

    const numbers = csv ? csv.computeTradeNumbers({
      direction: values.direction,
      entryDate: values.entryDate,
      entryTime: values.entryTime,
      entryPrice: values.entryPrice,
      exitDate: values.exitDate,
      exitTime: values.exitTime,
      exitPrice: values.exitPrice,
      shares: values.shares,
      fees: values.fees,
      plannedRiskR: values.plannedRiskR,
      defaultDate: values.defaultDate || values.date
    }) : {};

    const stopPrice = csv ? csv.parseNumber(values.stopPrice) : null;
    const entryPrice = numbers.entryPrice != null ? numbers.entryPrice : null;
    const exitPrice = numbers.exitPrice != null ? numbers.exitPrice : null;
    const shares = numbers.shares != null ? numbers.shares : null;
    const assumedShares = !!numbers.assumedShares;
    const plannedRiskR = numbers.plannedRiskR != null ? numbers.plannedRiskR : null;
    const perShare = numbers.perShare != null ? numbers.perShare : null;

    const stopDistance = (entryPrice != null && stopPrice != null) ? Math.abs(entryPrice - stopPrice) : null;
    const riskPerShare = (plannedRiskR != null && shares && !assumedShares) ? plannedRiskR / shares : null;
    const stopInR = (stopDistance != null && riskPerShare) ? stopDistance / riskPerShare : null;

    // A stop on the wrong side of the entry is worth flagging before it is saved
    if (stopDistance != null) {
      const wrongSide = (numbers.direction === 'long' && stopPrice > entryPrice) ||
                        (numbers.direction === 'short' && stopPrice < entryPrice);
      if (wrongSide) notes.push('The stop price sits on the same side as the entry — check it before saving.');
      else notes.push('Stop ' + stopDistance.toFixed(2) + ' away' + (stopInR ? ' (' + stopInR.toFixed(2) + 'R)' : '') + '.');
    }

    // Where in the session the entry happened, from the clock time alone
    const minutes = (csv && numbers.entryTime) ? csv._timeToMinutes(numbers.entryTime) : null;
    let session = '';
    if (minutes != null) {
      if (numbers.rolledExitDate) session = 'held past midnight';
      else if (minutes < 9 * 60 + 30) session = 'pre-market';
      else if (minutes < 9 * 60 + 45) session = 'at the open';
      else if (minutes < 12 * 60) session = 'in the morning';
      else if (minutes < 14 * 60) session = 'around midday';
      else if (minutes < 16 * 60) session = 'in the afternoon';
      else session = 'after the close';
    }

    const category = csv ? (csv.matchCategory(values.category) || {}).name : text(values.category);
    const meta = this._categoryMeta(category);
    const isGood = meta ? !!meta.good : false;
    const tone = meta ? meta.tone : 'unknown';
    const focus = (typeof JournalCategories !== 'undefined' && JournalCategories.focusFor)
      ? JournalCategories.focusFor(category)
      : [];

    const factLines = String(values.facts == null ? '' : values.facts)
      .split(/\r?\n/).map(l => l.trim()).filter(Boolean);

    if (!category) notes.push('No category yet — the wording below is generic. Pick one of the 11 so this entry can be grouped.');
    if (!factLines.length) notes.push('No facts written yet — add one line per fact and the skeleton gets concrete.');
    if (numbers.pnl == null) notes.push('No usable prices and size yet — the P&L sentence is left out.');
    if (assumedShares) notes.push('No size entered — the result below assumes 1 share. Add the real size before the P&L or the R-multiple is trusted.');

    if (numbers.pnl != null && meta) {
      if (numbers.pnl >= 0 && !isGood) {
        notes.push('Won anyway — a mistake category with a green result pays for the wrong behaviour, so it stays a mistake.');
      }
      if (numbers.pnl < 0 && isGood) {
        notes.push('A planned loss in a good-process category: the decision was right, the result was not.');
      }
    }
    if (perShare != null && stopDistance != null && shares && !assumedShares && perShare < 0 && Math.abs(perShare) > stopDistance * 1.2) {
      notes.push('The loss per share (' + Math.abs(perShare).toFixed(2) + ') is larger than the stop distance (' +
        stopDistance.toFixed(2) + ') — the stop was moved, widened or skipped.');
    }
    if (numbers.rolledExitDate) notes.push('The exit is on the next calendar day — say in the write-up that it was held past midnight.');
    if (numbers.durationMin == null && numbers.entryTime && numbers.exitTime) {
      notes.push('The exit time is before the entry time — check the times before saving.');
    }

    return {
      notes,
      csv,
      direction: numbers.direction || 'long',
      date: text(values.date) || numbers.entryDate || '',
      ticker: text(values.ticker).toUpperCase(),
      timeframe: text(values.timeframe),
      setup: text(values.setup),
      strategy: text(values.strategy),
      category,
      tone,
      isGood,
      focus,
      factLines,
      expected: text(values.expected),
      didInstead: text(values.didInstead),
      context: text(values.context),
      stopPrice,
      stopDistance,
      stopInR,
      riskPerShare,
      entryTime: numbers.entryTime || '',
      exitTime: numbers.exitTime || '',
      entryPrice,
      exitPrice,
      shares,
      assumedShares,
      fees: numbers.fees != null ? numbers.fees : null,
      plannedRiskR,
      perShare,
      perShareText: perShare == null ? '' : (perShare >= 0 ? '+' : '') + perShare.toFixed(2) + '/share',
      pnl: numbers.pnl != null ? numbers.pnl : null,
      pnlText: numbers.pnl != null ? csv.moneyText(numbers.pnl) : '',
      pnlPercent: numbers.pnlPercent != null ? numbers.pnlPercent : null,
      realisedR: numbers.realisedR != null ? numbers.realisedR : null,
      rText: numbers.realisedR != null ? (numbers.realisedR >= 0 ? '+' : '') + numbers.realisedR.toFixed(2) + 'R' : '',
      durationMin: numbers.durationMin != null ? numbers.durationMin : null,
      durationText: numbers.durationMin != null ? csv.formatDuration(numbers.durationMin) : '',
      rolled: !!numbers.rolledExitDate,
      session,
      processScore: csv ? csv.parseInt10(values.processScore) : null,
      outcomeText: numbers.pnl != null ? csv.outcomeText(numbers) : ''
    };
  },
  // ========================================================================
  // The guided skeleton for the seven prose columns
  // ========================================================================
  // Everything that is knowable from the form is filled in; everything that
  // needs the trader's own memory is left as an explicit — EDIT marker, never
  // invented.
  _fields(f, angle) {
    const csv = f.csv;
    const edit = JOURNAL_DRAFT_EDIT;
    const out = [];
    const priceText = (v) => (v == null ? '' : v.toFixed(2));
    const push = (key, lines) => {
      const meta = csv ? csv.fieldByKey(key) : null;
      out.push({
        key,
        letter: meta ? meta.letter : '',
        label: meta ? meta.label : key,
        text: lines.filter(Boolean).join('\n').trim(),
        focus: f.focus.indexOf(key) !== -1
      });
    };

    // F · Entry / Trigger — what had to happen, and what actually did
    let trigger = f.setup ? f.setup + ' — ' + f.direction + ' entry' : this._cap(f.direction) + ' entry';
    if (f.entryPrice != null) trigger += ' at ' + priceText(f.entryPrice);
    if (f.entryTime) trigger += ' (' + f.entryTime + (f.session ? ', ' + f.session : '') + ')';
    if (f.timeframe) trigger += ' on the ' + f.timeframe + ' chart';
    push('entryTrigger', [trigger + '.', edit + ': the level and the condition that had to print before the order went in.']);

    // G · Why I entered
    const why = [];
    if (f.factLines.length) {
      why.push(f.factLines.map(l => '- ' + l.replace(/^[-*\u2022]\s*/, '')).join('\n'));
    } else {
      why.push(edit + ': the level, the volume and the context that made this look like a trade today.');
    }
    why.push('Context: ' + (f.context || edit + ': index, sector and time of day at the entry.'));
    why.push('Stated plainly: ' + angle.angle + '.');
    push('whyEntered', why);

    // H · What went wrong — the facts, side by side
    const wrong = ['Expected: ' + (f.expected || edit + ': what you thought price would do from the entry.')];
    if (f.didInstead) wrong.push('What I actually did: ' + f.didInstead);
    if (f.entryPrice != null && f.exitPrice != null) {
      wrong.push('Price went ' + priceText(f.entryPrice) + ' \u2192 ' + priceText(f.exitPrice) +
        ' (' + f.perShareText + ')' + (f.durationText ? ' over ' + f.durationText : '') + '.');
    }
    if (f.rolled) wrong.push('The exit was taken after midnight, on the next calendar day.');
    if (!f.expected && !f.didInstead && f.entryPrice == null && f.exitPrice == null) {
      wrong.push(edit + ': what price actually did versus the level you had marked.');
    }
    push('whatWentWrong', wrong);

    // I · Why it went wrong — the category's angle, plus the arithmetic when it
    //     says something the category cannot
    const cause = [this._cap(angle.angle) + '.'];
    if (f.stopDistance != null && f.shares && !f.assumedShares && f.perShare != null && f.perShare < 0 &&
        Math.abs(f.perShare) > f.stopDistance * 1.2) {
      cause.push('The exit was further away than the stop allowed (' + Math.abs(f.perShare).toFixed(2) +
        ' against a ' + f.stopDistance.toFixed(2) + ' stop), so the stop was part of the problem.');
    }
    cause.push(f.isGood
      ? edit + ': what the market did that no plan could control.'
      : edit + ': the honest cause in one sentence — chase, size, timing, no level, ignored plan.');
    push('whyItWentWrong', cause);

    // J · Advice, K · Key lesson — straight from the category
    push('advice', [angle.fix, edit + ': tighten the wording to what you will actually do next time.']);
    push('keyLesson', [angle.lesson, edit + ': keep it to one sentence you will remember next week.']);

    // M · Review — the numbers first, then the process
    const review = [];
    if (f.pnlText) {
      review.push('Result: ' + f.pnlText + (f.rText ? ' (' + f.rText + ')' : '') +
        (f.shares != null && !f.assumedShares ? ' on ' + f.shares + ' shares' : '') + ', ' + f.direction + '.');
    }
    if (f.durationText) review.push('In trade: ' + f.durationText + (f.rolled ? ' (held overnight)' : '') + '.');
    if (f.processScore != null) review.push('Process score: ' + f.processScore + '/5.');
    review.push(f.isGood
      ? 'The process held: nothing about the outcome changes what was done here.'
      : 'The process broke here, so the outcome is a symptom rather than the lesson.');
    review.push(edit + ': one thing to repeat and one thing to change next session.');
    push('review', review);

    return out;
  },

  // ========================================================================
  // Input → the drafts the dialog shows
  // ========================================================================
  build(input = {}) {
    const facts = this._describe(input);
    return {
      fields: this._fields(facts, this._angle(facts.category)),
      notes: facts.notes,
      facts
    };
  },

  // ========================================================================
  // The prompt for the user's own AI chat, and the example it must match
  // ========================================================================
  // Nothing here calls a network. The text is meant to be copied into whatever
  // chat the user already has open, with the example CSV pasted after it, so the
  // answer comes back in the A–Z format that Import → Paste CSV can read.
  factBlock(input = {}, facts = null) {
    const csv = this._csv();
    const f = facts || this._describe(input);
    const rows = [];
    const put = (key, value) => {
      if (value == null || value === '') return;
      const meta = csv ? csv.fieldByKey(key) : null;
      rows.push((meta ? meta.letter + ' (' + meta.label + ')' : key) + ': ' + value);
    };

    put('date', f.date);
    put('ticker', f.ticker);
    put('timeframe', f.timeframe);
    put('category', f.category);
    put('setup', f.setup);
    put('direction', f.direction);
    put('entryTime', f.entryTime);
    put('entryPrice', f.entryPrice);
    put('exitTime', f.exitTime);
    put('exitPrice', f.exitPrice);
    // A size the journal assumed is not the user's size, so the prompt says so
    put('shares', f.assumedShares ? '' : f.shares);
    if (f.assumedShares) rows.push('Size: not entered — the result is quoted for 1 share, so a real size is needed before the numbers mean much.');
    put('fees', f.fees);
    put('plannedRiskR', f.plannedRiskR);
    put('strategy', f.strategy);
    put('outcome', f.outcomeText);

    if (f.stopPrice != null) rows.push('My stop was at: ' + f.stopPrice + ' (not a CSV column)');
    if (f.stopDistance != null) rows.push('Distance entry → stop: ' + f.stopDistance.toFixed(2));
    if (f.durationText) rows.push('Time in trade: ' + f.durationText + (f.rolled ? ' (crossed midnight)' : ''));
    if (f.session) rows.push('Session: ' + f.session);
    if (f.factLines.length) {
      rows.push('What happened, in my own words:');
      f.factLines.forEach(l => rows.push('  - ' + l.replace(/^[-*\u2022]\s*/, '')));
    }
    if (f.expected) rows.push('What I expected: ' + f.expected);
    if (f.didInstead) rows.push('What I actually did instead: ' + f.didInstead);
    if (f.context) rows.push('Context: ' + f.context);
    if (f.processScore != null) rows.push('My process score for this trade: ' + f.processScore + '/5');

    return rows.join('\n');
  },

  exampleBlock() {
    const csv = this._csv();
    return csv ? csv.buildMinimalExample().trim() : '';
  },

  prompt(input = {}) {
    const csv = this._csv();
    const facts = this._describe(input);
    const lines = [];

    lines.push('Help me write up ONE day-trading journal entry. Reply with a single CSV block and nothing else.');
    lines.push('');
    lines.push('Format: one header row with the column letters, then ONE data row, using only the letters below.');
    lines.push('Leave a letter empty when you have no basis for it. Do not invent prices, times, sizes or facts —');
    lines.push('use what I give you verbatim, and keep what I wrote in my own words.');
    lines.push('');
    lines.push('The letters:');
    lines.push(csv ? csv.letterTable() : '(js/journal-csv.js is not loaded)');
    lines.push('');
    lines.push('Rules:');
    lines.push('- D (category) must be exactly one of the 11 categories in the letter map.');
    lines.push('- F, G, H, I, J, K and M are prose. No filler, no motivational language.');
    lines.push('- J (advice) is ONE instruction, written as an instruction.');
    lines.push('- K (key lesson) is ONE sentence.');
    lines.push('- Y (tags) are separated with a semicolon. Z (process score) is 1–5.');
    lines.push('- A row needs at least B (ticker) or D (category), otherwise it is skipped.');
    lines.push('');
    lines.push('Facts I already have:');
    lines.push(this.factBlock(input, facts));
    lines.push('');
    lines.push('This is the exact format to match (letters row, label row, one data row):');
    lines.push(this.exampleBlock());
    return lines.join('\n');
  }
};

