(() => {
/**
 * Candlestick Pattern Knowledge Base Data Array
 */
const PATTERNS = [
  {
    id: 'marubozu',
    name: 'Marubozu',
    category: 'continuation',
    bias: 'both',
    description:
      'A candle with little to no upper or lower wick — the open sits at (or very near) the low, ' +
      'and the close sits at (or very near) the high for a bullish marubozu (reversed for bearish). ' +
      'One side was in full control for the entire candle, with essentially no pushback.',
    contextNote:
      'Most meaningful at a breakout point or after a period of consolidation. Less meaningful in the ' +
      'middle of an already-established trend, where it just confirms "more of the same."',
    volumeNote: {
      strong: 'Volume is visibly elevated above recent average, confirming broad participation and genuine buying/selling pressure rather than thin order book noise.',
      weak: 'Volume is at or below average, signaling the wide body formed from a single large print or thin book rather than true market conviction.',
      confirmation: 'Watch the next few candles for sustained volume in the same direction. A sharp volume drop-off immediately after suggests a single push rather than a sustained trend.'
    },
    pitfall:
      'Can appear on low-volume prints where a single large trade skews the whole candle — check volume ' +
      'alongside candle shape before treating it as a strong signal.',
    shapes: [
      { bias: 'bullish', bodyTopPct: 0, bodyBottomPct: 1, label: 'Buyers in control' },
      { bias: 'bearish', bodyTopPct: 0, bodyBottomPct: 1, label: 'Sellers in control' }
    ]
  },
  {
    id: 'hammer',
    name: 'Hammer',
    category: 'reversal',
    bias: 'bullish',
    description:
      'A single candle with a small real body near the top of its range and a long lower wick ' +
      '(at least twice the body length), with little or no upper wick. Appears after a downtrend and ' +
      'suggests sellers pushed price down during the session but buyers stepped in and drove it back ' +
      'up near the open.',
    contextNote:
      'Only meaningful as a reversal signal when it appears after a clear downtrend or at a support ' +
      'level — the same shape appearing mid-uptrend or in a sideways range carries no particular meaning.',
    volumeNote: {
      strong: 'Volume is noticeably higher than on preceding down candles, proving the rejection of lower prices involved aggressive, broad-based buying.',
      weak: 'Volume is unusually low, indicating the hammer shape reflects a lack of trading activity rather than a decisive tug-of-war.',
      confirmation: 'The subsequent candle must close higher on above-average volume. Continued selling on elevated volume invalidates the signal.'
    },
    pitfall:
      'A hammer that forms without a preceding downtrend is not a reversal signal — it is just a candle ' +
      'shape. Also watch for hammers forming right into a level that has already provided support ' +
      'multiple times; the "signal" may just be the level doing what it always does, not new buying interest.',
    shapes: [
      { bias: 'bullish', bodyTopPct: 0.05, bodyBottomPct: 0.35, label: 'Small body near high, long lower wick' }
    ]
  },
  {
    id: 'inverted-hammer',
    name: 'Inverted Hammer',
    category: 'reversal',
    bias: 'bullish',
    description:
      'A single candle with a small real body near the bottom of its range and a long upper wick, with ' +
      'little or no lower wick. Appears after a downtrend and suggests buyers attempted to push price ' +
      'higher during the session even though the close ended up near the open.',
    contextNote:
      'A tentative bullish reversal signal, weaker than a hammer, since the long upper wick shows the ' +
      'higher prices were rejected rather than held. Needs a bullish confirmation candle afterward to ' +
      'be taken seriously.',
    volumeNote: {
      strong: 'Volume picks up above recent down candles during the initial push, with the long upper wick forming on lighter rejection volume.',
      weak: 'The upper wick forms on heavy rejection volume, indicating active sellers are still dominating and rejecting higher prices.',
      confirmation: 'Look for a strong upward close on the very next candle on volume clearly exceeding the inverted hammer\'s own print.'
    },
    pitfall:
      'Easy to confuse with a shooting star, which looks visually identical but occurs after an uptrend ' +
      'and means the opposite thing. Always check the preceding trend before naming the pattern.',
    shapes: [
      { bias: 'bullish', bodyTopPct: 0.65, bodyBottomPct: 0.95, label: 'Small body near low, long upper wick' }
    ]
  },
  {
    id: 'shooting-star',
    name: 'Shooting Star',
    category: 'reversal',
    bias: 'bearish',
    description:
      'Visually identical to an inverted hammer — small real body near the bottom of the range, long ' +
      'upper wick — but forms after an uptrend rather than a downtrend. Shows buyers pushed price ' +
      'notably higher during the session before sellers took back control and drove it back down near ' +
      'the open.',
    contextNote:
      'The trend context is what makes this a bearish reversal signal rather than a bullish one. A ' +
      'shooting star at a resistance level or after an extended run-up carries more weight than one ' +
      'appearing mid-trend.',
    volumeNote: {
      strong: 'Elevated overall volume expands into the high and fails, showing larger participants using the rally to unload shares (institutional distribution).',
      weak: 'Low volume indicates the short high-low range with a small body is just normal noise on a quiet, low-liquidity session.',
      confirmation: 'Watch for a lower close on heavy volume during the next session. Low-volume drift afterward suggests minimal selling interest.'
    },
    pitfall:
      'The most common mistake is calling this pattern without confirming the prior trend was actually ' +
      'up — without that context it is just an inverted hammer shape and implies the opposite outcome.',
    shapes: [
      { bias: 'bearish', bodyTopPct: 0.65, bodyBottomPct: 0.95, label: 'Small body near low, long upper wick' }
    ]
  },
  {
    id: 'hanging-man',
    name: 'Hanging Man',
    category: 'reversal',
    bias: 'bearish',
    description:
      'Visually identical to a hammer — small real body near the top of the range, long lower wick — ' +
      'but forms after an uptrend rather than a downtrend. Despite the long lower wick showing buyers ' +
      'stepped in during the session, the pattern is a bearish warning because it shows sellers were ' +
      'able to push price down significantly for the first time in a while.',
    contextNote:
      'Only meaningful after a sustained uptrend. The long lower wick can look encouraging at a glance, ' +
      'but the fact that sellers were able to move price that far down within an uptrend is the actual ' +
      'signal — it needs bearish confirmation on the next candle to be taken seriously.',
    volumeNote: {
      strong: 'Volume prints at or above recent average during the intraday sell-off, proving sellers mounted a serious challenge to the uptrend.',
      weak: 'Light volume shows the long lower wick formed from thin trading depth rather than genuine, aggressive seller conviction.',
      confirmation: 'Requires a lower close on the following candle with volume surpassing the hanging man. A higher close on heavy volume invalidates it.'
    },
    pitfall:
      'Many traders react to the lower wick alone and read it as bullish support, missing that the ' +
      'context (an established uptrend) makes this pattern a warning sign, not a buy signal.',
    shapes: [
      { bias: 'bearish', bodyTopPct: 0.05, bodyBottomPct: 0.35, label: 'Small body near high, long lower wick' }
    ]
  },
  {
    id: 'bullish-engulfing',
    name: 'Bullish Engulfing',
    category: 'reversal',
    bias: 'bullish',
    description:
      'A two-candle pattern where a smaller bearish candle is followed by a larger bullish candle whose ' +
      'real body completely engulfs the body of the prior candle — the second candle opens at or below ' +
      'the first candle\'s close and closes above the first candle\'s open.',
    contextNote:
      'More significant after a downtrend or at a support level, where it suggests a sharp shift in ' +
      'control from sellers to buyers within a single session.',
    volumeNote: {
      strong: 'Candle 1: Moderate/fading volume on the down candle. Candle 2: Volume surges significantly higher than Candle 1, showing an overwhelming influx of buyers.',
      weak: 'Candle 2 volume is flat or lower than Candle 1, suggesting the engulfing body was driven by wide spread/thin order book rather than increased demand.',
      confirmation: 'Follow-through buying on Candle 3 with volume maintaining above the recent multi-day average solidifies the trend reversal.'
    },
    pitfall:
      'A common false read is calling an engulfing pattern when the second candle\'s body only engulfs ' +
      'the first candle\'s body by a small margin, or when it engulfs the wick range but not the actual ' +
      'open/close of the prior candle — the real-body engulfment is what matters, not the high-low range.',
    shapes: [
      { bias: 'bearish', bodyTopPct: 0.35, bodyBottomPct: 0.55, label: 'Small down candle' },
      { bias: 'bullish', bodyTopPct: 0.1, bodyBottomPct: 0.9, label: 'Larger up candle engulfs it' }
    ]
  },
  {
    id: 'bearish-engulfing',
    name: 'Bearish Engulfing',
    category: 'reversal',
    bias: 'bearish',
    description:
      'The mirror of bullish engulfing — a smaller bullish candle is followed by a larger bearish candle ' +
      'whose real body completely engulfs the prior candle\'s body, opening at or above the first ' +
      'candle\'s close and closing below the first candle\'s open.',
    contextNote:
      'Carries more weight after an uptrend or at a resistance level, where it suggests buyers who had ' +
      'been in control were suddenly and decisively overwhelmed by sellers.',
    volumeNote: {
      strong: 'Candle 1: Average volume on the up candle. Candle 2: Volume expands sharply past Candle 1, indicating heavy, decisive institutional selling.',
      weak: 'Candle 2 volume matches or falls below Candle 1, pointing to a lack of genuine seller conviction despite the larger real body.',
      confirmation: 'Check for volume back-loaded toward the close on Candle 2 and continued heavy selling volume on Candle 3 for reliable follow-through.'
    },
    pitfall:
      'Watch for engulfing patterns forming after only a very short uptrend of one or two candles — the ' +
      '"reversal" may just be normal chop rather than a genuine change in trend, since the pattern needs ' +
      'an actual trend to reverse.',
    shapes: [
      { bias: 'bullish', bodyTopPct: 0.35, bodyBottomPct: 0.55, label: 'Small up candle' },
      { bias: 'bearish', bodyTopPct: 0.1, bodyBottomPct: 0.9, label: 'Larger down candle engulfs it' }
    ]
  },
  {
    id: 'morning-star',
    name: 'Morning Star',
    category: 'reversal',
    bias: 'bullish',
    description:
      'A three-candle bullish reversal pattern: a long bearish candle, followed by a small-bodied candle ' +
      'that gaps or trades lower (showing indecision), followed by a long bullish candle that closes ' +
      'well into the body of the first candle.',
    contextNote:
      'One of the more reliable multi-candle reversal patterns because it shows a full narrative — ' +
      'strong selling, a pause, then strong buying — rather than relying on a single candle\'s shape. ' +
      'Works best after an extended downtrend.',
    volumeNote: {
      strong: 'Candle 1: High volume down. Candle 2: Volume dries up completely (seller exhaustion). Candle 3: Heavy volume surge exceeding Candle 1 as buyers take control.',
      weak: 'Candle 3 volume is lighter than Candle 1, indicating the bullish bounce lacks the aggressive participation seen in the prior downtrend.',
      confirmation: 'Candle 4 should hold the gain and show sustained above-average volume to confirm the new upward move.'
    },
    pitfall:
      'The middle candle\'s small body is the key structural requirement — if it has a body similar in ' +
      'size to the surrounding candles, this is not a morning star, just three candles in a row. Also ' +
      'watch for the third candle failing to close meaningfully into the first candle\'s body, which ' +
      'weakens the pattern considerably.',
    shapes: [
      { bias: 'bearish', bodyTopPct: 0.1, bodyBottomPct: 0.7, label: 'Long down candle' },
      { bias: 'neutral', bodyTopPct: 0.72, bodyBottomPct: 0.85, label: 'Small-bodied pause' },
      { bias: 'bullish', bodyTopPct: 0.15, bodyBottomPct: 0.75, label: 'Strong up candle' }
    ]
  },
  {
    id: 'evening-star',
    name: 'Evening Star',
    category: 'reversal',
    bias: 'bearish',
    description:
      'The bearish mirror of the morning star: a long bullish candle, followed by a small-bodied candle ' +
      'showing indecision, followed by a long bearish candle that closes well into the body of the first candle.',
    contextNote:
      'Most significant after an extended uptrend, particularly at resistance, where the three-candle ' +
      'sequence tells a clear story of buying exhaustion followed by a decisive move down.',
    volumeNote: {
      strong: 'Candle 1: Strong uptrend volume. Candle 2: Low, lull volume (buyer exhaustion). Candle 3: Heavy volume expansion equaling or topping Candle 1.',
      weak: 'Candle 3 prints on quiet, below-average volume, suggesting the drop may be a routine pause in the uptrend rather than distribution.',
      confirmation: 'Look for Candle 4 to continue lower on expanding volume to validate that sellers remain firmly in control.'
    },
    pitfall:
      'As with the morning star, the middle candle needs a genuinely small body relative to the other ' +
      'two — and traders should be cautious calling this pattern in a market that has not had a clear ' +
      'uptrend to reverse in the first place.',
    shapes: [
      { bias: 'bullish', bodyTopPct: 0.1, bodyBottomPct: 0.7, label: 'Long up candle' },
      { bias: 'neutral', bodyTopPct: 0.72, bodyBottomPct: 0.85, label: 'Small-bodied pause' },
      { bias: 'bearish', bodyTopPct: 0.15, bodyBottomPct: 0.75, label: 'Strong down candle' }
    ]
  },
  {
    id: 'doji',
    name: 'Doji',
    category: 'reversal',
    bias: 'neutral',
    description:
      'A candle where the open and close are at or very near the same price, leaving little to no real ' +
      'body — essentially just a wick line with a thin body at its center. Represents a session where ' +
      'buyers and sellers reached a standstill. Common variants: standard doji (wicks roughly balanced on ' +
      'both sides), dragonfly doji (long lower wick, little to no upper wick, open/close near the high), ' +
      'and gravestone doji (long upper wick, little to no lower wick, open/close near the low).',
    contextNote:
      'A doji\'s meaning depends entirely on where it appears. After an extended trend, it can signal the ' +
      'trend is losing momentum — a dragonfly doji after a downtrend and a gravestone doji after an ' +
      'uptrend are read similarly to a hammer and shooting star respectively. In a sideways or choppy ' +
      'market, a doji is largely meaningless noise.',
    volumeNote: {
      strong: 'Unusually high volume indicates a major, high-stakes tug-of-war between aggressive buyers and sellers, signaling severe trend exhaustion.',
      weak: 'Very low volume shows the near-even open and close occurred simply due to an absence of trading activity and interest.',
      confirmation: 'Because a doji is neutral, wait for the next 1–2 candles to break directionally on expanding volume before taking a bias.'
    },
    pitfall:
      'Dojis are extremely common on quiet, low-volatility instruments and sessions, and traders new to ' +
      'candlestick analysis often over-read them as reversal signals when they appear constantly ' +
      'throughout an already-choppy period rather than at a genuine turning point.',
    shapes: [
      { bias: 'neutral', bodyTopPct: 0.47, bodyBottomPct: 0.53, label: 'Standard doji' },
      { bias: 'neutral', bodyTopPct: 0.06, bodyBottomPct: 0.14, label: 'Dragonfly doji' },
      { bias: 'neutral', bodyTopPct: 0.86, bodyBottomPct: 0.94, label: 'Gravestone doji' }
    ]
  },
  {
    id: 'piercing-line',
    name: 'Piercing Line',
    category: 'reversal',
    bias: 'bullish',
    description:
      'A two-candle bullish reversal pattern: a bearish candle is followed by a bullish candle that opens ' +
      'below the prior candle\'s low and then closes above the midpoint of the prior candle\'s real body ' +
      '(but not all the way above its open).',
    contextNote:
      'A more modest version of bullish engulfing — the second candle does not need to fully engulf the ' +
      'first, just close convincingly above its midpoint. Most meaningful after a downtrend.',
    volumeNote: {
      strong: 'Candle 1: Standard down volume. Candle 2: Volume expands past Candle 1, proving the recovery from the lower open had aggressive buyer backing.',
      weak: 'Candle 2 trades on flat or declining volume, signaling a half-hearted bounce that is vulnerable to continued selling.',
      confirmation: 'Candle 3 must hold above Candle 2\'s midpoint on steady or rising volume to validate the structural shift.'
    },
    pitfall:
      'If the second candle closes only slightly above the midpoint of the first candle\'s body, the ' +
      'pattern is much weaker than a close near the first candle\'s open — treat "just barely above the ' +
      'midpoint" piercing lines with more caution than clean, deep closes into the prior body.',
    shapes: [
      { bias: 'bearish', bodyTopPct: 0.1, bodyBottomPct: 0.6, label: 'Down candle' },
      { bias: 'bullish', bodyTopPct: 0.35, bodyBottomPct: 0.85, label: 'Closes above midpoint' }
    ]
  },
  {
    id: 'dark-cloud-cover',
    name: 'Dark Cloud Cover',
    category: 'reversal',
    bias: 'bearish',
    description:
      'The bearish mirror of the piercing line: a bullish candle is followed by a bearish candle that ' +
      'opens above the prior candle\'s high and then closes below the midpoint of the prior candle\'s real body.',
    contextNote:
      'Most meaningful after an uptrend or at a resistance level, where the failed gap-up followed by a ' +
      'deep close back into the prior candle\'s body suggests sellers decisively took control during the session.',
    volumeNote: {
      strong: 'Candle 1: Normal up volume. Candle 2: Volume expands above Candle 1 as sellers aggressively push price down from the gap high.',
      weak: 'Candle 2 volume is unremarkable or light, suggesting the deep close into the prior body was merely a wide-spread anomaly on low interest.',
      confirmation: 'Watch Candle 3 for continued selling on rising volume. A quick recovery on light volume invalidates the dark cloud setup.'
    },
    pitfall:
      'As with the piercing line, a close only just below the midpoint is a much weaker version of this ' +
      'pattern than a close deep into the prior candle\'s body — do not treat all "technically qualifying" ' +
      'dark cloud covers as equally significant.',
    shapes: [
      { bias: 'bullish', bodyTopPct: 0.1, bodyBottomPct: 0.6, label: 'Up candle' },
      { bias: 'bearish', bodyTopPct: 0.35, bodyBottomPct: 0.85, label: 'Closes below midpoint' }
    ]
  },
  {
    id: 'rising-three-methods',
    name: 'Rising Three Methods',
    category: 'continuation',
    bias: 'bullish',
    description:
      'A five-candle bullish continuation pattern: a long bullish candle, followed by three small-bodied ' +
      'candles that trade within the high-low range of the first candle without breaking below its low, ' +
      'followed by a final long bullish candle that closes at a new high above the first candle\'s close.',
    contextNote:
      'Confirms an existing uptrend is likely to continue after a brief pause or consolidation, rather ' +
      'than signalling a new trend. The three middle candles represent a controlled pullback, not a ' +
      'genuine change in control.',
    volumeNote: {
      strong: 'Candle 1: Heavy volume. Candles 2–4: Volume contracts noticeably during consolidation. Candle 5: Volume surges back to or above Candle 1.',
      weak: 'Volume increases during the middle three pullback candles, or Candle 5 breaks out on weak, below-average volume.',
      confirmation: 'Watch for subsequent candles to maintain higher highs with volume staying well above the middle consolidation period average.'
    },
    pitfall:
      'If any of the three middle candles closes below the low of the first candle, the pattern is ' +
      'invalidated — that is no longer a controlled pullback but a potential trend change, and should ' +
      'not be forced into this pattern.',
    shapes: [
      { bias: 'bullish', bodyTopPct: 0.1, bodyBottomPct: 0.9, label: 'Long up candle' },
      { bias: 'bearish', bodyTopPct: 0.3, bodyBottomPct: 0.5, label: 'Small pullback' },
      { bias: 'bearish', bodyTopPct: 0.35, bodyBottomPct: 0.55, label: 'Small pullback' },
      { bias: 'bearish', bodyTopPct: 0.3, bodyBottomPct: 0.5, label: 'Small pullback' },
      { bias: 'bullish', bodyTopPct: 0.05, bodyBottomPct: 0.85, label: 'Strong up candle, new high close' }
    ]
  },
  {
    id: 'falling-three-methods',
    name: 'Falling Three Methods',
    category: 'continuation',
    bias: 'bearish',
    description:
      'The bearish mirror of Rising Three Methods: a long bearish candle, followed by three small-bodied ' +
      'candles that trade within the high-low range of the first candle without breaking above its high, ' +
      'followed by a final long bearish candle that closes at a new low below the first candle\'s close.',
    contextNote:
      'Confirms an existing downtrend is likely to continue after a brief bounce or consolidation, rather ' +
      'than signalling a reversal. The three middle candles represent a controlled bounce, not a genuine ' +
      'change in control.',
    volumeNote: {
      strong: 'Candle 1: Heavy volume. Candles 2–4: Volume contracts during the small bounce. Candle 5: Volume re-expands sharply as downtrend resumes.',
      weak: 'Middle bounce candles show expanding volume (indicating buying interest), or Candle 5 breaks down on weak volume.',
      confirmation: 'Candle 6 should expand to new low prices accompanied by sustained high volume to lock in trend continuation.'
    },
    pitfall:
      'If any of the three middle candles closes above the high of the first candle, the pattern is ' +
      'invalidated — that is no longer a controlled bounce but a potential trend change, and should not ' +
      'be forced into this pattern.',
    shapes: [
      { bias: 'bearish', bodyTopPct: 0.1, bodyBottomPct: 0.9, label: 'Long down candle' },
      { bias: 'bullish', bodyTopPct: 0.3, bodyBottomPct: 0.5, label: 'Small bounce' },
      { bias: 'bullish', bodyTopPct: 0.35, bodyBottomPct: 0.55, label: 'Small bounce' },
      { bias: 'bullish', bodyTopPct: 0.3, bodyBottomPct: 0.5, label: 'Small bounce' },
      { bias: 'bearish', bodyTopPct: 0.05, bodyBottomPct: 0.85, label: 'Strong down candle, new low close' }
    ]
  },
  {
    id: 'bullish-harami',
    name: 'Bullish Harami',
    category: 'continuation',
    bias: 'bullish',
    description:
      'A two-candle pattern where a large bearish candle is followed by a small bullish candle whose ' +
      'entire real body is contained within the body of the first candle — the opposite of an engulfing ' +
      'pattern. Shows that strong selling momentum has suddenly stalled.',
    contextNote:
      'A more tentative signal than bullish engulfing since it reflects indecision — a sudden drop in ' +
      'range and momentum — rather than a decisive shift to buying. Best treated as an early warning that ' +
      'a downtrend may be losing steam, needing confirmation before acting.',
    volumeNote: {
      strong: 'Candle 1: High down volume. Candle 2: Volume contracts sharply alongside the smaller body, confirming selling momentum has stalled.',
      weak: 'Candle 2 volume remains high or higher than Candle 1, signaling heavy churn and active distribution rather than a quiet pause.',
      confirmation: 'Requires a move higher on Candle 3 with expanding volume to confirm a true reversal rather than a brief pause.'
    },
    pitfall:
      'Traders sometimes treat any small candle after a large one as a harami — the requirement is that ' +
      'the second candle\'s entire body sits within the first candle\'s body, not just that it is smaller.',
    shapes: [
      { bias: 'bearish', bodyTopPct: 0.1, bodyBottomPct: 0.9, label: 'Long down candle' },
      { bias: 'bullish', bodyTopPct: 0.4, bodyBottomPct: 0.6, label: 'Small body contained within it' }
    ]
  },
  {
    id: 'bearish-harami',
    name: 'Bearish Harami',
    category: 'continuation',
    bias: 'bearish',
    description:
      'The mirror of bullish harami: a large bullish candle is followed by a small bearish candle whose ' +
      'entire real body is contained within the body of the first candle. Shows that strong buying ' +
      'momentum has suddenly stalled.',
    contextNote:
      'A more tentative signal than bearish engulfing since it reflects indecision rather than a decisive ' +
      'shift to selling. Best treated as an early warning that an uptrend may be losing steam, needing ' +
      'confirmation before acting.',
    volumeNote: {
      strong: 'Candle 1: High up volume. Candle 2: Volume drops off significantly, showing buyers have stopped pushing and momentum is spent.',
      weak: 'Candle 2 prints elevated volume, showing active disagreement and buying effort rather than typical fading momentum.',
      confirmation: 'Look for Candle 3 to break lower on rising volume to validate that sellers are taking control after the pause.'
    },
    pitfall:
      'Traders sometimes treat any small candle after a large one as a harami — the requirement is that ' +
      'the second candle\'s entire body sits within the first candle\'s body, not just that it is smaller.',
    shapes: [
      { bias: 'bullish', bodyTopPct: 0.1, bodyBottomPct: 0.9, label: 'Long up candle' },
      { bias: 'bearish', bodyTopPct: 0.4, bodyBottomPct: 0.6, label: 'Small body contained within it' }
    ]
  }
];

const CANDLE_COLORS = {
  bullish: { body: '#26a69a', stroke: '#26a69a', text: '#26a69a' },
  bearish: { body: '#ef5350', stroke: '#ef5350', text: '#ef5350' },
  neutral: { body: '#a0a5af', stroke: '#a0a5af', text: '#a0a5af' }
};

function generateCandleSVG(pattern) {
  const candleWidth = 90;
  const gap = 180;
  const drawTop = 70;
  const drawBottom = 270;
  const drawHeight = drawBottom - drawTop;

  const totalWidth = pattern.shapes.length * candleWidth + (pattern.shapes.length - 1) * gap + 160;
  const svgHeight = 340;

  let x = 80;
  const parts = [];

  pattern.shapes.forEach((shape) => {
    const colors = CANDLE_COLORS[shape.bias];
    const bodyTop = drawTop + shape.bodyTopPct * drawHeight;
    const bodyBottom = drawTop + shape.bodyBottomPct * drawHeight;
    const centerX = x + candleWidth / 2;

    if (bodyTop > drawTop + 2) {
      parts.push(`<line x1="${centerX}" y1="${drawTop}" x2="${centerX}" y2="${bodyTop}" stroke="${colors.stroke}" stroke-width="1.5"/>`);
    }
    if (bodyBottom < drawBottom - 2) {
      parts.push(`<line x1="${centerX}" y1="${bodyBottom}" x2="${centerX}" y2="${drawBottom}" stroke="${colors.stroke}" stroke-width="1.5"/>`);
    }

    parts.push(
      `<rect x="${x}" y="${bodyTop}" width="${candleWidth}" height="${Math.max(bodyBottom - bodyTop, 3)}" rx="3" fill="${colors.body}" fill-opacity="0.25" stroke="${colors.stroke}" stroke-width="1.5"/>`
    );
    const biasTag = shape.bias === 'bullish' ? 'Bullish' : shape.bias === 'bearish' ? 'Bearish' : 'Neutral';
    parts.push(
      `<text x="${centerX}" y="300" text-anchor="middle" font-size="12" font-family="sans-serif" font-weight="600" fill="${colors.text}">${biasTag}</text>`
    );
    parts.push(
      `<text x="${centerX}" y="320" text-anchor="middle" font-size="12" font-family="sans-serif" fill="#9aa0a6">${shape.label}</text>`
    );

    x += candleWidth + gap;
  });

  return `<svg viewBox="0 0 ${totalWidth} ${svgHeight}" role="img" xmlns="http://www.w3.org/2000/svg">
    <title>${pattern.name} candlestick diagram</title>
    ${parts.join('\n    ')}
  </svg>`;
}

const BIAS_LABELS = {
  bullish: 'Bullish',
  bearish: 'Bearish',
  both: 'Bullish / Bearish',
  neutral: 'Neutral'
};

function renderPatternIndex(patterns) {
  const rows = patterns
    .map(
      (p) => `
      <li>
        <a href="#pattern-${p.id}" class="pattern-index__link pattern-index__link--${p.bias}">
          <span class="pattern-index__name">${p.name}</span>
          <span class="pattern-index__bias">${BIAS_LABELS[p.bias]}</span>
        </a>
      </li>`
    )
    .join('');
  return `
    <nav id="pattern-index-top" class="pattern-index" aria-label="Candlestick pattern index">
      <h2 class="pattern-index__title">Candlestick Patterns Index</h2>
      <ul class="pattern-index__list">${rows}</ul>
      <a href="index.html" class="pattern-index__back-btn">← Back to Watchlist</a>
    </nav>
  `;
}

function renderPatternCard(pattern) {
  const catLabel = pattern.category === 'reversal' ? 'Reversal' : 'Continuation';
  const biasLabel = BIAS_LABELS[pattern.bias];
  
  return `
    <div class="pattern-card" id="pattern-${pattern.id}" data-pattern-id="${pattern.id}">
      <div class="pattern-card__header">
        <div class="pattern-card__title-group">
          <h3 class="pattern-card__name">${pattern.name}</h3>
        </div>
        <div class="pattern-card__badges">
          <span class="badge badge--category">${catLabel}</span>
          <span class="badge badge--${pattern.bias}">${biasLabel}</span>
        </div>
      </div>

      <div class="pattern-card__body">
        <div class="pattern-card__diagram">
          ${generateCandleSVG(pattern)}
        </div>

        <div class="pattern-card__content">
          <p class="pattern-card__description">${pattern.description}</p>
          
          <div class="pattern-card__section">
            <div class="pattern-card__label">Context:</div> ${pattern.contextNote}
          </div>

          <div class="pattern-card__volume-box">
            <div class="pattern-card__volume-title">📊 Volume Behavior & VPA Notes</div>
            <div class="pattern-card__volume-text">
              <div style="margin-bottom: 6px;"><strong style="color: #26a69a;">▲ Strong signal:</strong> ${pattern.volumeNote.strong}</div>
              <div style="margin-bottom: 6px;"><strong style="color: #ef5350;">▼ Weak signal:</strong> ${pattern.volumeNote.weak}</div>
              <div><strong style="color: #8ab4f8;">↻ Confirmation:</strong> ${pattern.volumeNote.confirmation}</div>
            </div>
          </div>

          <div class="pattern-card__pitfall-box">
            <div class="pattern-card__label" style="color: #ef5350;">Watch Out:</div> ${pattern.pitfall}
          </div>

          <div class="pattern-card__footer">
            <a href="#pattern-index-top" class="pattern-card__back-to-top">↑ Back to index</a>
          </div>
        </div>
      </div>
    </div>
  `;
}

window.CandlePatterns = { PATTERNS, renderPatternCard, renderPatternIndex, generateCandleSVG };

})();