# Supplementary Trading Strategy Rulebooks

## Working drafts for import into the trading app

**Purpose:** These are starting documents for education and strategy
development. They are not validated trading systems and should not be
treated as permission to trade them live.

**Status convention:** Start each rulebook as **Educational** or **Under
Development**. Move individual sections through the app's workflow only
when the rules are clear enough to test. Do not mark a strategy as
agreed or tested merely because the examples look convincing.

**Common trading constraints** - US-listed stocks only; long positions
only. - Cash account: no margin and no short selling. - Focus universe:
generally stocks priced below \$10. - Risk per trade: maximum planned
risk of 1% of account equity, subject to the app's risk controls. -
Evaluate entries and exits during the regular US session unless a
strategy's rules explicitly define otherwise. - A setup must have
adequate liquidity, manageable spread and enough room to the intended
target to justify the risk. - No trade is compulsory. If the pattern is
unclear, the stock is thin, or the stop cannot be placed sensibly, pass.

**Important distinction:** A setup name is not an entry signal. Every
strategy requires a recognisable market context, a specific trigger, a
defined invalidation point and a realistic exit plan. The descriptions
below deliberately avoid pretending that untested numeric thresholds are
established facts.

------------------------------------------------------------------------

# Strategy 1 --- Intraday Trend Continuation

**Role:** Primary strategy\
**Initial status:** Under Development\
**Core idea:** Participate in a stock's next upward leg after it has
already demonstrated genuine intraday strength, then pauses or pulls
back in a controlled way, and subsequently shows evidence that buyers
are taking control again.

## 1. Strategy objective

Trade long continuation opportunities in US-listed micro-cap stocks,
generally below \$10, when an established intraday uptrend pauses and
then resumes.

The aim is to enter after a healthy pullback or consolidation, not to
chase an extended candle or predict the beginning of a move. The
strategy should favour clear structure, orderly price behaviour and
sufficient remaining upside.

This is the primary strategy. Supplementary strategies must not dilute
its development or change its rules.

## 2. Valid upward trend criteria

A candidate should demonstrate an established upward structure before a
continuation setup is considered.

Assess: - **Price structure:** higher highs and higher lows, or a clear
sequence of upward pushes separated by orderly pauses. - **Moving
averages:** 9 EMA above 21 EMA, with both rising, is a useful supporting
condition. A 34 EMA may provide additional context. Do not treat an EMA
stack as proof of a trend by itself. - **VWAP:** price generally holding
above VWAP supports the long case. A brief dip below it is not
automatically disqualifying, but repeated failure to reclaim it is a
warning. - **Volume:** meaningful participation on upward pushes.
Compare volume with the stock's own recent activity and the time of day;
do not rely on a single arbitrary RVOL number. - **Context:** identify
nearby daily, pre-market and intraday resistance. A trend with little
room before major resistance may not offer a worthwhile trade.

Reject or downgrade: - A single vertical spike with no established
structure. - Repeated upper wicks and failed attempts at new highs. -
Heavy selling volume, deteriorating lows or loss of important support. -
Thin, erratic price action where the apparent trend is not tradable.

## 3. Healthy pullback / consolidation criteria

A pullback should look like a pause within the upward structure, not an
obvious reversal.

Favour: - A controlled retracement after an upward impulse. -
Overlapping or smaller candles, a shelf, flag or orderly drift. -
Selling volume that generally contracts relative to the preceding upward
push. - Support holding at a prior breakout area, short-term structure,
VWAP or a rising moving average. - No decisive break of the most recent
meaningful higher low.

Warning signs: - Large, persistent red candles with expanding volume. -
Repeated failed attempts to bounce. - A lower low that breaks the
structure supporting the trend. - Heavy upper wicks or a clear rejection
at resistance immediately before the pullback.

Do not judge a pullback by the colour or size of its first candle alone.
Judge it by what happens afterwards: selling follow-through, volume,
support and the response of buyers.

## 4. Continuation entry patterns

Patterns to study and define: - **First-red / first-pullback:** first
meaningful pause after an upward impulse, followed by evidence of
renewed buying. - **Micro-flag or shelf:** compact consolidation near
the highs, with price holding its structure. - **Pullback towards the 9
EMA:** price approaches a rising 9 EMA and stabilises without materially
damaging the trend. - **Breakout retest:** price breaks a clear intraday
level, returns to test it and holds.

A pattern is not valid merely because it resembles a flag or touches an
EMA. It must occur within a valid upward trend and show that the
pullback is ending.

## 5. Continuation triggers

Potential triggers to test: - Break above the pullback's local high. -
Break above the top of a defined shelf or flag. - Reclaim of a relevant
short-term level followed by a higher low. - A strong green response
candle with meaningful volume, provided the entry is not already
extended.

Entry rules must specify: - The exact price level that activates the
trade. - Whether entry is a stop order, limit order or other defined
method. - Maximum acceptable distance from the invalidation point. -
Whether the trigger candle is too extended to enter safely.

Do not enter solely because an indicator changes colour, an EMA is
crossed, or one candle is green.

## 6. Trend deterioration and exit criteria

Exit or reduce exposure when the reason for holding the continuation
trade is no longer present.

Study: - Failure to hold the pullback low or the structural higher
low. - Repeated lower highs and lower lows. - Loss of the breakout level
followed by failure to reclaim it. - A decisive move below relevant
support or VWAP, where the trade thesis depends on holding it. - Strong
selling volume and poor recovery attempts. - Failure to make progress
within a pre-defined time, if testing supports a time-based exit.

Define the protective stop before entry. Do not widen it to avoid taking
a loss. Profit-taking may use the next resistance, prior high, measured
risk/reward or a tested trailing method. Record the reason for every
discretionary exit.

## 7. Risk management

-   Maximum planned risk: 1% of account equity per trade.
-   Position size = maximum cash risk divided by the distance between
    entry and stop, adjusted for fees and likely slippage.
-   Never use margin or short positions.
-   Do not enter if the spread, liquidity or volatility makes the
    planned stop unreliable.
-   Avoid adding to a losing position.
-   Set a daily loss limit and maximum number of trades during
    development; determine the exact limits in the app before live use.
-   Account for halts, fast moves and slippage: a stop price is not a
    guarantee of execution at that price.
-   Do not take a trade if the next resistance leaves insufficient
    potential reward relative to the risk.

## 8. Examples and supporting notes

For every example, save: - Stock, date, session time and chart
timeframe. - Daily and intraday context. - Evidence that an upward trend
was established before the pullback. - Pullback shape, volume behaviour
and support level. - Trigger price, entry, stop, target and actual
exit. - Screenshot before entry and after exit. - Whether the trade
followed every rule; record rule violations separately from strategy
outcomes.

Include both successful and unsuccessful examples. Keep a separate
collection of attractive-looking setups that failed the criteria. Do not
change rules based on one or two trades; review a meaningful sample.

------------------------------------------------------------------------

# Strategy 2 --- Range / Support-Bounce Trading

**Role:** Supplementary strategy\
**Initial status:** Educational\
**Core idea:** Buy near the lower boundary of a clearly established
intraday range only after price tests the area and shows evidence of
rejection or reclaim. Aim to exit into the range rather than assume a
breakout.

## 1. Strategy objective

Capture a move from a well-defined support area towards the middle or
upper portion of an established trading range.

This is a range-trading strategy, not a disguised trend-continuation
trade. It does not require a sustained uptrend, but it does require a
range with boundaries that are visible and repeatedly respected.

The strategy is unsuitable when price is trending strongly, the range is
poorly defined, or support is breaking down.

## 2. Valid upward trend criteria

A sustained upward trend is not required. Instead, establish that the
stock is genuinely ranging.

Look for: - At least two reasonably clear reactions around a lower
boundary and two around an upper boundary, where practical. - A
recognisable horizontal or gently sloping range. - Price moving between
the boundaries rather than making persistent lower lows. - Sufficient
trading activity and reasonably consistent spreads. - Enough distance
between support and resistance to offer a worthwhile trade after costs
and slippage.

Do not call a stock range-bound simply because it has paused after a
sharp decline. A falling stock making lower highs is not a healthy
range.

## 3. Healthy pullback / consolidation criteria

For this strategy, assess the approach to support rather than an uptrend
pullback.

Favour: - Price returning towards a previously defended lower
boundary. - Selling pressure slowing as price approaches support. -
Smaller candles, reduced downside follow-through or rejection wicks near
the level. - No sustained acceptance below support. - A clear nearby
invalidation level.

Reject: - Repeated heavy-volume tests that weaken the support area. - A
sharp approach with expanding selling volume and no sign of
stabilisation. - A range so narrow that the potential move cannot
justify the risk. - A range with erratic boundaries or large spreads.

## 4. Continuation entry patterns

The relevant patterns are support reactions: - **Support rejection:**
price tests the lower boundary and leaves a clear rejection. - **Failed
breakdown and reclaim:** price briefly trades below support, then
reclaims it. - **Higher low at support:** after the initial reaction,
price pulls back but holds above the test low.

Do not buy the first touch automatically. A level is an area of
interest, not an instruction to enter.

## 5. Continuation triggers

The preferred trigger is evidence that the support test has succeeded,
such as: - A reclaim of the support area after a brief breakdown. - A
break above the high of the rejection or confirmation candle. - A higher
low followed by a break of the intervening short-term high.

Before entry, identify: - The range support zone. - The confirmation
level. - The invalidation level below the failed test or support area. -
The next resistance and realistic profit-taking area.

Avoid entering if price has already travelled most of the way towards
the range midpoint or upper boundary.

## 6. Trend deterioration and exit criteria

The range thesis is invalidated when: - Price breaks below support and
fails to reclaim it. - A candle closes decisively below the support zone
and subsequent action accepts lower prices. - Selling volume expands and
recovery attempts fail. - The range structure changes into a sequence of
lower highs and lower lows.

Potential exits: - A pre-defined target near the range midpoint for a
conservative approach. - The upper third or upper boundary when the
range is wide and price action remains constructive. - Earlier exit if
price stalls or rejects before the planned target.

Do not hold through resistance in the hope that a range trade becomes a
breakout trade. A breakout is a separate thesis.

## 7. Risk management

-   Maximum planned risk: 1% of account equity per trade.
-   Place the stop beyond the level that invalidates the
    support-reaction thesis, allowing only a pre-defined and tested
    buffer.
-   Position size from entry-to-stop distance, including likely
    slippage.
-   Require adequate room from entry to target; define a minimum
    reward-to-risk requirement during testing rather than inventing one
    in advance.
-   Do not average down when support fails.
-   Avoid thin names where a small order can move price or where the
    spread consumes the expected gain.
-   Do not repeatedly buy every test of a weakening support level.

## 8. Examples and supporting notes

Collect examples of: - Clean support holds with a tradable bounce. -
Support tests that fail. - False breakdowns that reclaim support. -
Ranges that are too narrow or too erratic to trade.

For each, mark range boundaries, test count, approach speed, volume,
entry trigger, stop, target and outcome. Record whether the target was
reached before price returned to support. This helps establish whether
the range offers a repeatable edge.

------------------------------------------------------------------------

# Strategy 3 --- VWAP Reclaim and Hold

**Role:** Supplementary strategy\
**Initial status:** Educational\
**Core idea:** After trading below VWAP, a stock reclaims VWAP,
demonstrates acceptance above it and offers a controlled long entry for
a recovery leg towards a known resistance level.

## 1. Strategy objective

Capture a defined intraday recovery after price has been trading below
VWAP.

The expected trade is the first recovery leg, potentially towards the
pre-market high, opening-range high or another nearby resistance. The
strategy does not assume that the stock will become a trend day.

A VWAP cross alone is not a setup.

## 2. Valid upward trend criteria

A pre-existing upward trend is not mandatory, but the stock must show
conditions that make a recovery plausible.

Prefer: - A meaningful intraday catalyst or clear reason for elevated
participation, where present. - Adequate relative volume and liquidity
for the time of day. - A prior upward move or identifiable support area
from which the recovery develops. - Price no longer making persistent
lower lows. - A clear overhead target with sufficient room from VWAP.

Be cautious when the broader chart is in a strong downtrend, the stock
is below major resistance, or VWAP is repeatedly crossed in both
directions.

## 3. Healthy pullback / consolidation criteria

Assess the sell-off or period below VWAP.

Favour: - Selling pressure slowing near a meaningful support area. - A
base, higher low or failed attempt to continue lower. - Reduced downside
follow-through. - A recovery that begins with improving price action and
participation.

Reject: - Continuous heavy selling and fresh lows. - A weak drift above
VWAP with no buying follow-through. - Repeated VWAP crosses in a choppy,
directionless session. - A reclaim directly into nearby resistance with
insufficient upside.

## 4. Continuation entry patterns

Patterns to study: - **Reclaim and hold:** price moves above VWAP and
remains above it rather than immediately falling back below. - **VWAP
retest:** after reclaiming, price returns to VWAP, holds and turns
higher. - **Higher-low reclaim:** price reclaims VWAP, pulls back
without losing the recovery structure, then forms a higher low.

The retest is often easier to define than chasing the initial cross, but
it may not occur. Do not force an entry if the stock runs without
offering a controlled setup.

## 5. Continuation triggers

Potential triggers: - Break above the high of the VWAP reclaim candle or
short consolidation. - Break above the local high after a successful
VWAP retest. - A higher-low confirmation followed by renewed buying.

Require: - VWAP reclaim to be clear, not a momentary tick above the
line. - Evidence of acceptance above VWAP. - A defined invalidation
point, usually below the retest low or recovery structure. - Enough room
to the next resistance to justify the risk.

Do not enter simply because price touches or crosses VWAP.

## 6. Trend deterioration and exit criteria

The recovery thesis weakens or fails when: - Price loses VWAP and cannot
promptly reclaim it. - The retest low or recovery higher low breaks. -
Price makes a lower high and rolls over. - Buying volume fades while
selling pressure increases. - The stock reaches the planned resistance
or first-leg target.

Treat the first-leg target as a legitimate exit. Do not turn a short
recovery trade into a trend-continuation hold unless a separate
continuation setup forms and is independently valid.

## 7. Risk management

-   Maximum planned risk: 1% of account equity per trade.
-   Stop below the structural level that invalidates the reclaim, not at
    an arbitrary distance from VWAP.
-   Calculate size from entry-to-stop distance and include slippage.
-   Identify overhead resistance before entry; do not take a reclaim
    with inadequate reward potential.
-   Avoid repeated attempts after multiple failed VWAP reclaims.
-   Avoid trading when VWAP is flat and price is crossing it repeatedly
    without direction.
-   No averaging down and no widening stops.

## 8. Examples and supporting notes

Save examples of: - Strong reclaim followed by a clean hold and
recovery. - Reclaim, retest and continuation. - False reclaim that
quickly loses VWAP. - Multiple-cross chop that should be avoided.

Record time of day, distance from VWAP, volume during reclaim, retest
behaviour, overhead resistance, entry, stop, target and outcome. Compare
initial-cross entries with retest entries rather than assuming one is
better.

------------------------------------------------------------------------

# Strategy 4 --- Failed Breakdown / Bear-Trap Reversal

**Role:** Supplementary strategy\
**Initial status:** Educational\
**Core idea:** Price breaks below a well-observed support level but
fails to attract sustained selling, reclaims the level and confirms that
the breakdown has failed. Enter only after the reclaim provides evidence
of buyers returning.

## 1. Strategy objective

Capture a reversal from a failed downside break at a meaningful support
level.

The setup is based on the failure of sellers to maintain control below
support. It is not an attempt to predict the low or buy a stock merely
because it has fallen sharply.

This setup can occur within a range or near a significant prior low. It
may overlap with the range/support-bounce strategy, but the defining
event here is the failed breakdown.

## 2. Valid upward trend criteria

A prior uptrend is not required. The stock must, however, have a
meaningful reference level and the potential to recover.

Prefer: - A clearly identifiable support level, such as a range low,
prior intraday low, pre-market level or relevant daily level. - A stock
with sufficient liquidity and active participation. - A downside break
that does not develop into sustained acceptance below support. - A
plausible upside target, such as VWAP, range midpoint or the next
resistance.

Avoid treating every new low as a bear trap. If price continues to
accept below support, the breakdown has not failed.

## 3. Healthy pullback / consolidation criteria

Study the behaviour around the breakdown: - Price briefly trades below
an established support area. - Selling fails to produce sustained
downside progress. - Price rejects the lower prices and returns towards
or above support. - The recovery is supported by improving buying
activity or a clear change in short-term structure.

Warning signs: - Heavy selling continues below support. - Price
repeatedly retests the low and cannot recover. - The reclaim is weak and
immediately rejected. - The stock is halted, extremely illiquid or
moving too erratically to define risk.

## 4. Continuation entry patterns

Patterns to study: - **Break-and-reclaim:** a brief move below support
followed by a reclaim. - **Reclaim and retest:** price reclaims support,
returns to test it from above and holds. - **Reclaim with higher low:**
after recovering, price pulls back but holds above the breakdown low and
turns higher.

The key evidence is that price has rejected the breakdown area. Do not
buy while price is still falling below support.

## 5. Continuation triggers

Potential triggers: - Break above the high of the reclaim candle. -
Break above the local high formed after the reclaim. - A higher low
above the breakdown low followed by a break of the short-term pivot.

Define: - The original support zone. - The lowest price of the failed
breakdown. - The reclaim level. - The confirmation trigger. - The
invalidation level and first overhead target.

Avoid a late entry if most of the recovery has already occurred or the
next resistance is too close.

## 6. Trend deterioration and exit criteria

The failed-breakdown thesis fails when: - Price falls back below support
and cannot reclaim it. - The breakdown low is revisited and then
decisively breaks. - The recovery produces a lower high and renewed
selling. - Buying activity disappears and price accepts below the
original level.

Take profits into logical resistance. A move to VWAP or the range
midpoint may be a reasonable first objective, depending on context. Do
not assume a failed breakdown automatically becomes a sustained uptrend.

## 7. Risk management

-   Maximum planned risk: 1% of account equity per trade.
-   The stop must be beyond the level that invalidates the
    failed-breakdown thesis, usually related to the breakdown low or
    failed reclaim structure.
-   Calculate size from entry-to-stop distance and allow for slippage.
-   Do not enter if the distance to the stop is too large for sensible
    position sizing.
-   Do not average down if price falls below the invalidation level.
-   Avoid repeated attempts at the same support after the setup has
    failed.
-   Be particularly cautious around halts, low-float volatility and wide
    spreads.

## 8. Examples and supporting notes

Collect: - Genuine failed breakdowns followed by recoveries. -
Breakdowns that looked like traps but continued lower. - Reclaims that
failed on the first retest. - Late entries with poor remaining reward.

Mark the support level before the break, the breakdown low, reclaim time
and price, confirmation trigger, volume behaviour, stop, target and
outcome. Compare the quality of immediate-reclaim entries with
reclaim-and-retest entries.

------------------------------------------------------------------------

# Strategy 5 --- Oversold Flush into Higher-Timeframe Support

**Role:** Supplementary strategy\
**Initial status:** Educational --- lower priority\
**Core idea:** A sharp sell-off reaches a pre-identified daily or hourly
support area, selling pressure appears to exhaust, and price forms a
confirmed short-term reversal that can be traded as a relief bounce.

## 1. Strategy objective

Capture a short, defined relief bounce after an aggressive decline into
significant higher-timeframe support.

This is not a bottom-fishing strategy. The trader does not buy because
an oscillator is oversold, because a candle is unusually large, or
because the stock has already fallen a lot.

The trade is considered only after price reaches a level identified in
advance and then demonstrates a reversal.

## 2. Valid upward trend criteria

A prior intraday uptrend is not required. Higher-timeframe context is
essential.

Before the session, identify: - Significant daily or hourly support. -
Prior swing lows, consolidation zones or major breakout areas. - The
distance from current price to the support area. - Nearby overhead
resistance and likely bounce destination.

Prefer stocks with enough liquidity and participation to make a reversal
tradable. Avoid stocks in a sustained fundamental or technical collapse
where the apparent support is arbitrary or likely to fail.

## 3. Healthy pullback / consolidation criteria

This strategy concerns an aggressive flush rather than a normal
pullback.

Evidence worth studying: - A rapid decline into pre-marked support. - A
climactic increase in selling activity followed by reduced downside
progress. - Rejection of prices below support. - A failed attempt to
continue lower. - A base or short-term higher low after the flush.

High volume alone does not prove capitulation. It can also represent
genuine distribution and continued selling.

## 4. Continuation entry patterns

Patterns to study: - **Flush and reclaim:** price briefly moves through
support, then recovers the level. - **Selling climax and base:** the
sharp decline stops making progress and price builds a short base. -
**Higher-low reversal:** after the initial bounce, price retests but
holds above the flush low.

Do not enter during the vertical decline. Wait for price to show that
the selling pressure has changed.

## 5. Continuation triggers

Potential triggers: - Reclaim of the pre-identified support zone. -
Break above the high of the first convincing reversal candle. - Break
above the base formed after the flush. - Higher low followed by a break
of the intervening pivot.

The entry must leave enough room to the first meaningful resistance. If
the bounce has already travelled most of the likely distance, pass.

## 6. Trend deterioration and exit criteria

The relief-bounce thesis is invalidated when: - Price loses the
reclaimed support and cannot recover it. - The flush low breaks. - The
reversal forms a lower high and resumes the decline. - Selling pressure
returns and downside progress accelerates.

Take profits conservatively at pre-identified resistance, VWAP, a prior
breakdown area or another tested objective. Do not assume the bounce
marks the start of a new uptrend.

## 7. Risk management

-   Maximum planned risk: 1% of account equity per trade.
-   The stop belongs beyond the reversal structure that invalidates the
    bounce, not at an arbitrary percentage.
-   Size the position from entry-to-stop distance, allowing for
    slippage.
-   Do not catch a falling knife or add to a losing position.
-   Avoid trading through halts or when spreads and volatility make the
    stop unreliable.
-   Require a realistic target and adequate reward relative to risk.
-   This setup may need a smaller practical risk allowance during early
    testing because of its volatility; any reduction should be defined
    in advance, not improvised during a trade.

## 8. Examples and supporting notes

Collect: - Flushes into major support that produce a clean bounce. -
Flushes that break support and continue lower. - High-volume bars that
do not mark exhaustion. - Reversals that occur too late to offer a
sensible entry.

Record the higher-timeframe level, decline size and speed, volume
pattern, evidence of exhaustion, reclaim or reversal trigger, stop,
target and outcome. Review whether the support level was genuinely
significant before the flush or only appeared important afterwards.

------------------------------------------------------------------------

# Cross-strategy review notes

## Keep the strategies separate

A trade must be assigned to the strategy whose rules actually justified
the entry. Do not relabel a losing trade after the fact to make it fit
another rulebook.

If a stock changes character, a new setup may form later, but it must
independently satisfy that strategy's criteria. An initial failed setup
does not grant permission to enter a different one without a fresh
signal.

## Suggested development sequence

1.  Keep Trend Continuation as the primary strategy and continue its
    existing development and testing.
2.  Study Range / Support-Bounce first. Collect chart examples before
    attempting paper trades.
3.  Study VWAP Reclaim and Hold next.
4.  Study Failed Breakdown / Bear-Trap Reversal. Note its overlap with
    support-bounce trading.
5.  Leave Oversold Flush as a lower-priority research topic until the
    other supplementary setups are better understood.

## Minimum evidence before promotion

Before a supplementary strategy is considered ready for live trading: -
Its market context and setup can be identified consistently in real
time. - Entry, invalidation, exit and risk rules are written clearly
enough that two reviews would classify the same chart similarly. - A
meaningful sample of paper trades has been recorded, including losses,
missed trades and no-trade examples. - Results include fees, spread and
realistic slippage assumptions. - Performance is reviewed by market
condition and time of day, not just by headline win rate. - Rule changes
are documented and the sample is not misleadingly combined across
different versions.

**Final reminder:** The purpose of these additional rulebooks is to make
quiet sessions educational and structured, not to ensure that a trade is
always available. Doing nothing remains a valid outcome.
