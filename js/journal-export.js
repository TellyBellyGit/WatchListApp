// ============================================================================
// JOURNAL EXPORT — consolidated strategy review Markdown builder
// ============================================================================
// A pure, self-contained module that turns one strategy (plus its journal
// entries and evaluation notes) into a single Markdown document. It has no
// DOM or Utils dependency so the Node test suite can exercise it directly via
// vm, exactly like js/journal-csv.js and js/journal-draft.js.
//
// The controller (js/journal.js) owns data gathering and the download; this
// module only builds text, so what it writes is what was saved — it never
// rewrites, summarises or reorders rule or note text.
// ============================================================================

const JournalExport = (function () {
  // The 8 rulebook sections, in the order the export presents them. `key` is the
  // Firestore field name under strategy.rules; `title` is the human heading.
  const RULE_SECTIONS = [
    { key: 'objective', title: 'Objective' },
    { key: 'validUpwardTrend', title: 'Valid Upward Trend' },
    { key: 'healthyPullback', title: 'Healthy Pullback' },
    { key: 'continuationEntry', title: 'Continuation Entry' },
    { key: 'continuationTriggers', title: 'Continuation Triggers' },
    { key: 'trendDeteriorationExit', title: 'Trend Deterioration / Exit' },
    { key: 'riskManagement', title: 'Risk Management' },
    { key: 'examplesNotes', title: 'Examples / Notes' }
  ];

  // Rule status keys (as stored) → human labels shown in the document.
  const RULE_STATUS_LABELS = {
    not_defined: 'Not yet defined',
    under_development: 'Under development',
    agreed: 'Agreed',
    under_testing: 'Under testing'
  };

  const NOT_RECORDED = 'Not recorded';

  // ---- formatting helpers (self-contained, no Utils dependency) ----
  function fmt(v) {
    return (v == null || v === '') ? NOT_RECORDED : String(v);
  }

  function money(v) {
    if (v == null || isNaN(v)) return NOT_RECORDED;
    return '$' + Number(v).toFixed(2);
  }

  function pct(v) {
    if (v == null || isNaN(v)) return NOT_RECORDED;
    return (v >= 0 ? '+' : '') + Number(v).toFixed(2) + '%';
  }

  function fmtDate(d) {
    if (d == null || d === '') return NOT_RECORDED;
    const date = d instanceof Date ? d : new Date(d);
    if (isNaN(date.getTime())) return String(d);
    return date.toISOString().slice(0, 10);
  }

  // Same wording as JournalCSV.formatDuration (6m / 1h 5m / 2d 3h), except a
  // missing value reads "Not recorded" instead of the on-screen "—".
  function formatDuration(mins) {
    if (mins == null || isNaN(mins)) return NOT_RECORDED;
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
  }

  function ruleStatusLabel(key) {
    return RULE_STATUS_LABELS[key || 'not_defined'] || 'Not yet defined';
  }

  // A date string (YYYY-MM-DD) is within [from, to] inclusive; empty bounds
  // mean no limit.
  function inRange(dateStr, from, to) {
    if (!from && !to) return true;
    if (from && (!dateStr || String(dateStr) < from)) return false;
    if (to && (!dateStr || String(dateStr) > to)) return false;
    return true;
  }

  // --------------------------------------------------------------------------
  // buildMarkdown(strategy, entries, notes, options) → string
  //   strategy: strategies/{strategyId} document
  //   entries:  journal_entries documents (controller's _entries)
  //   notes:    strategy_notes documents (controller's _strategyNotes)
  //   options:  { includeVersionHistory:boolean, from:'YYYY-MM-DD', to:'YYYY-MM-DD' }
  // --------------------------------------------------------------------------
  function buildMarkdown(strategy, entries, notes, options) {
    options = options || {};
    const includeVersionHistory = options.includeVersionHistory !== false;
    const from = options.from || '';
    const to = options.to || '';

    const sid = strategy.strategyId || 'Unknown';
    const name = strategy.name || 'Untitled strategy';
    const rangeLabel = (from || to) ? ` (${from || '…'} → ${to || '…'})` : '';

    const out = [];

    // Title
    out.push(`# ${name} — Strategy Review`);
    out.push('');
    out.push(`_Strategy ID: ${sid}${rangeLabel}_`);
    out.push('');

    // ---- A. Strategy overview ------------------------------------------------
    out.push('## A. Strategy Overview');
    out.push('');
    out.push(`- **Strategy ID:** ${sid}`);
    out.push(`- **Strategy name:** ${name}`);
    out.push(`- **Description:** ${fmt(strategy.description)}`);
    out.push(`- **Status:** ${fmt(strategy.status)}`);
    out.push(`- **Version:** ${strategy.version != null ? strategy.version : NOT_RECORDED}`);
    out.push(`- **Created:** ${fmtDate(strategy.createdAt)}`);
    out.push(`- **Last updated:** ${fmtDate(strategy.updatedAt)}`);
    out.push('');

    // ---- B. Current rulebook --------------------------------------------------
    out.push('## B. Current Strategy Rulebook');
    out.push('');
    out.push('_Status legend: **Agreed** rules are fixed; Not yet defined / Under development / Under testing are still being shaped._');
    out.push('');
    const rules = strategy.rules || {};
    RULE_SECTIONS.forEach(sec => {
      const rule = rules[sec.key] || {};
      out.push(`### ${sec.title}`);
      out.push('');
      out.push(`**[${ruleStatusLabel(rule.status)}]**`);
      out.push('');
      out.push((rule.text || '').trim() || NOT_RECORDED);
      out.push('');
    });

    // ---- C. Version history --------------------------------------------------
    out.push('## C. Rulebook Version History');
    out.push('');
    const versions = Array.isArray(strategy.versions) ? strategy.versions : [];
    if (!includeVersionHistory) {
      out.push('_Version history omitted._');
      out.push('');
    } else if (versions.length === 0) {
      out.push('No previous versions recorded.');
      out.push('');
    } else {
      versions.forEach(v => {
        out.push(`### Version ${v.version != null ? v.version : '?'}`);
        out.push('');
        out.push(`- **Date updated:** ${fmtDate(v.updatedAt)}`);
        out.push('');
        const vRules = v.rules || {};
        RULE_SECTIONS.forEach(sec => {
          const rule = vRules[sec.key] || {};
          out.push(`#### ${sec.title}`);
          out.push('');
          out.push(`**[${ruleStatusLabel(rule.status)}]**`);
          out.push('');
          out.push((rule.text || '').trim() || NOT_RECORDED);
          out.push('');
        });
      });
    }


    // ---- D. Trading journal ---------------------------------------------------
    out.push('## D. Trading Journal');
    out.push('');
    const filteredEntries = (entries || []).filter(e =>
      e.strategyId === sid && inRange(e.date, from, to));
    if (filteredEntries.length === 0) {
      out.push('No journal entries for this strategy' +
        (from || to ? ' in the selected date range' : '') + '.');
      out.push('');
    } else {
      filteredEntries.forEach((e, i) => {
        const td = e.tradeData || {};
        const mentor = e.mentor || {};
        const realisedR = (td.realisedR != null)
          ? (td.realisedR >= 0 ? '+' : '') + Number(td.realisedR).toFixed(2) + 'R'
          : NOT_RECORDED;
        out.push(`### Trade ${i + 1} — ${fmt(e.ticker || e.symbol)}`);
        out.push('');
        out.push(`- **Date:** ${fmt(e.date)}`);
        out.push(`- **Ticker / symbol:** ${fmt(e.ticker || e.symbol)}`);
        out.push(`- **Company:** ${fmt(e.companyName)}`);
        out.push(`- **Direction:** ${fmt(td.direction)}`);
        out.push(`- **Entry price:** ${money(td.entryPrice)}`);
        out.push(`- **Exit price:** ${money(td.exitPrice)}`);
        out.push(`- **Shares:** ${td.shares != null ? td.shares : NOT_RECORDED}`);
        out.push(`- **Fees / commissions:** ${money(td.fees)}`);
        out.push(`- **Planned risk (1R):** ${money(td.plannedRiskR)}`);
        out.push(`- **Net P&L:** ${money(td.pnl)}${td.pnlPercent != null ? ' (' + pct(td.pnlPercent) + ')' : ''}`);
        out.push(`- **Realised R:** ${realisedR}`);
        out.push(`- **Duration:** ${formatDuration(td.durationMin)}`);
        out.push(`- **Category:** ${fmt(e.category)}`);
        out.push(`- **Strategy label:** ${fmt(td.strategy)}`);
        out.push(`- **Setup:** ${fmt(e.setup)}`);
        out.push(`- **Entry trigger:** ${fmt(e.entryTrigger)}`);
        out.push(`- **Why entered:** ${fmt(e.whyEntered)}`);
        out.push(`- **What went wrong:** ${fmt(e.whatWentWrong)}`);
        out.push(`- **Why it went wrong:** ${fmt(e.whyItWentWrong)}`);
        out.push(`- **Advice / correction:** ${fmt(e.advice)}`);
        out.push(`- **Mentor advice (verbatim):** ${fmt(mentor.raw)}`);
        out.push(`- **Key lesson:** ${fmt(e.keyLesson)}`);
        out.push(`- **Outcome / P&L:** ${fmt(e.outcome)}`);
        out.push(`- **Review:** ${fmt(e.review)}`);
        out.push(`- **Process score:** ${e.processScore != null ? e.processScore : NOT_RECORDED}`);
        out.push(`- **Tags:** ${(Array.isArray(e.tags) && e.tags.length) ? e.tags.join(', ') : NOT_RECORDED}`);
        out.push(`- **Deep-dive notes:** ${(e.contentPlain || '').trim() || NOT_RECORDED}`);
        out.push('');
      });
    }

    // ---- E. Evaluation log ----------------------------------------------------
    out.push('## E. Strategy Evaluation Log');
    out.push('');
    const filteredNotes = (notes || []).filter(n =>
      n.strategyId === sid && inRange(n.date, from, to));
    if (filteredNotes.length === 0) {
      out.push('No evaluation entries for this strategy' +
        (from || to ? ' in the selected date range' : '') + '.');
      out.push('');
    } else {
      filteredNotes.forEach(n => {
        out.push(`### ${fmt(n.entryType)} — ${fmt(n.title)}`);
        out.push('');
        out.push(`- **Date:** ${fmt(n.date)}`);
        out.push(`- **Entry type:** ${fmt(n.entryType)}`);
        out.push(`- **Title:** ${fmt(n.title)}`);
        out.push('');
        out.push((n.content || '').trim() || NOT_RECORDED);
        out.push('');
        const links = Array.isArray(n.linkedEntryIds) ? n.linkedEntryIds : [];
        if (links.length) {
          out.push('**Linked journal entries:**');
          links.forEach(id => {
            const je = (entries || []).find(x => x.id === id);
            const label = je
              ? `${je.ticker || je.symbol || id}${je.date ? ' (' + je.date + ')' : ''}`
              : id;
            out.push(`- ${label}`);
          });
          out.push('');
        }
        out.push('');
      });
    }

    return out.join('\n');
  }

  return {
    buildMarkdown,
    RULE_SECTIONS,
    RULE_STATUS_LABELS,
    formatDuration
  };
})();

