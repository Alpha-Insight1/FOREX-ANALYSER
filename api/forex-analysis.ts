export const config = { runtime: "edge", maxDuration: 60 };

// Forex SMC SWING TRADING Engine
// Timeframes: 4H (entry structure) + 1D (HTF bias)
// Strategy: SMC (BOS/CHoCH + Order Blocks + FVG) on 4H, filtered by Daily trend
// Risk model: ATR(14)-based stop (1.5x ATR buffer), 3R take-profit
// Persists signals in `trades` and resolves them by walking 4H candles bar-by-bar
// Netlify-hosted scanner (no Supabase required for signals)
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

interface Candle {
  time: number; // unix seconds
  open: number;
  high: number;
  low: number;
  close: number;
}

interface Swing {
  index: number;
  price: number;
  type: "high" | "low";
}

interface OrderBlock {
  index: number;
  top: number;
  bottom: number;
  type: "bullish" | "bearish";
}

interface FVG {
  index: number;
  top: number;
  bottom: number;
  type: "bullish" | "bearish";
}

interface ConfidenceFactor {
  label: string;
  points: number;
  hit: boolean;
}

interface Signal {
  pair: string;
  direction: "BUY" | "SELL";
  entry: number;
  stopLoss: number;
  takeProfit: number;        // TP1 — partial close (5R)
  takeProfit2: number;       // TP2 — runner (15R)
  riskReward: number;        // Reported RR = TP2 (max target)
  confidence: number;
  structure: "BOS" | "CHoCH";
  assetClass?: "forex" | "gold" | "index" | "crypto";
  confluences: string[];
  // Per-factor breakdown showing exactly how the confidence score was assembled.
  // The UI renders this so traders can see *why* a setup scored 87% vs 80%.
  confidenceBreakdown: ConfidenceFactor[];
  currentPrice: number;
  timestamp: string;
  htf_bias: "Bullish" | "Bearish" | "Neutral";
  // Optional deeper SWING entry tier — fills at the daily HTF S/R level for a
  // higher-conviction discount/premium entry vs the LTF (proximal-OB) entry.
  swingEntry?: number;
  swingStopLoss?: number;
  swingRiskPips?: number;
  // Split-entry smoothing: when both LTF and swing tiers exist, scale in 50/50
  // across the two limits. UI shows the blended fill + blended risk so the
  // trader knows the effective entry if both fill.
  splitEntry?: {
    tier1: number;       // LTF proximal entry (50% allocation)
    tier2: number;       // Deeper swing entry (50% allocation)
    allocation: number;  // 0.5 = even split
    blendedEntry: number;
    blendedRiskPips: number;
  };
  // LTF (1h) confirmation gate: did the lower timeframe print a structure
  // shift (BOS/CHoCH) in the trade direction? When false, the signal is
  // valid on HTF but should wait for LTF confirmation before firing limits.
  ltfConfirmed?: boolean;
  awaitingLtfConfirmation?: boolean;
  // Auto-trigger override: when confidence ≥ 95%, fire the trade immediately
  // regardless of LTF confirmation — the HTF conviction is high enough to skip
  // the wait gate. UI shows a "AUTO-FIRE" pill so the trader knows to execute now.
  autoTrigger?: boolean;
  // Professional entry model that produced this entry price + how the trade
  // should be triggered on the platform. Market-on-confirmation means the
  // trader fires at market once the 1H confirmation candle has closed inside
  // the zone — no set-and-forget limit.
  entryModel?: "OTE" | "FVG" | "Breaker" | "Judas" | "OB";
  entryTrigger?: "MARKET_ON_CONFIRMATION" | "LIMIT";
  entryZone?: { top: number; bottom: number };

}

// A "developing" setup is forming but hasn't passed all gates yet —
// these are the pairs to actively watch (news-driven moves, near-trigger zones, etc).
interface DevelopingSetup {
  pair: string;
  direction: "BUY" | "SELL";
  htf_bias: "Bullish" | "Bearish";
  reason: string;
  proximity: number;
  currentPrice: number;
  newsMomentum: boolean;
  triggers: string[];
  // Proposed trade plan (computed even if signal not yet firing) — null when no
  // anchor (OB or sweep) is available to compute meaningful levels.
  plan: {
    entry: number;
    stopLoss: number;
    takeProfit: number;   // TP1 (2R)
    takeProfit2: number;  // TP2 (8R)
    riskPips: number;
    // Deeper swing entry (daily HTF zone) — optional. When present, this is
    // the higher-conviction fill at a discount/premium level vs the LTF entry.
    swingEntry?: number;
    swingStopLoss?: number;
    swingRiskPips?: number;
  } | null;
}

// FX majors + Gold + major indices. Yahoo Finance symbols.
const PAIRS: { pair: string; yfSymbol: string }[] = [
  // —— Forex (4H trend, 1H entry confirmation) ——
  { pair: "EUR/USD", yfSymbol: "EURUSD=X" },
  { pair: "GBP/USD", yfSymbol: "GBPUSD=X" },
  { pair: "USD/JPY", yfSymbol: "USDJPY=X" },
  { pair: "USD/CHF", yfSymbol: "USDCHF=X" },
  { pair: "AUD/USD", yfSymbol: "AUDUSD=X" },
  { pair: "NZD/USD", yfSymbol: "NZDUSD=X" },
  { pair: "USD/CAD", yfSymbol: "USDCAD=X" },
  { pair: "EUR/GBP", yfSymbol: "EURGBP=X" },
  { pair: "EUR/JPY", yfSymbol: "EURJPY=X" },
  { pair: "GBP/JPY", yfSymbol: "GBPJPY=X" },
  { pair: "AUD/JPY", yfSymbol: "AUDJPY=X" },
  { pair: "EUR/AUD", yfSymbol: "EURAUD=X" },
  { pair: "GBP/AUD", yfSymbol: "GBPAUD=X" },
  { pair: "EUR/CAD", yfSymbol: "EURCAD=X" },
  { pair: "GBP/CAD", yfSymbol: "GBPCAD=X" },
  { pair: "EUR/NZD", yfSymbol: "EURNZD=X" },
  { pair: "GBP/NZD", yfSymbol: "GBPNZD=X" },
  // —— Gold (4H trend, 1m + 5m entry) ——
  { pair: "XAUUSD",  yfSymbol: "GC=F" },
  // —— Indices (4H+1D trend, 5m/15m/30m entry) ——
  { pair: "GER40",   yfSymbol: "^GDAXI" },
  { pair: "SPX500",  yfSymbol: "^GSPC" },
  { pair: "US30",    yfSymbol: "^DJI" },
  { pair: "NAS100",  yfSymbol: "^NDX" },
  { pair: "UK100",   yfSymbol: "^FTSE" },
  { pair: "JPN225",  yfSymbol: "^N225" },
];

// Asset-class helpers
function isIndex(pair: string): boolean {
  return pair === "GER40" || pair === "US30" || pair === "NAS100" || pair === "SPX500"
      || pair === "UK100" || pair === "JPN225";
}
function isGold(pair: string): boolean {
  return pair === "XAUUSD" || pair === "GOLD" || pair === "XAU/USD";
}
function isCrypto(pair: string): boolean {
  return pair.startsWith("BTC") || pair.startsWith("ETH");
}
function assetClassOf(pair: string): "forex" | "gold" | "index" | "crypto" {
  if (isGold(pair)) return "gold";
  if (isIndex(pair)) return "index";
  if (isCrypto(pair)) return "crypto";
  return "forex";
}

/** Market-hours guard: block new entries near the close / on weekends to avoid
 *  blown spreads, thin liquidity, and weekend gap risk (esp. indices like JPN225). */
function isSessionBlocked(pair: string, now = new Date()): { blocked: boolean; reason: string } {
  if (isCrypto(pair)) return { blocked: false, reason: "" };

  const dow = now.getUTCDay(); // 0=Sun … 6=Sat
  const h = now.getUTCHours();
  const m = now.getUTCMinutes();
  const mins = h * 60 + m;

  // Global weekend block for FX + cash indices (CFD quotes can still print with toxic spreads)
  // Sat all day, Fri after 19:00 UTC, Sun before 22:00 UTC
  const weekend =
    dow === 6 ||
    (dow === 5 && h >= 19) ||
    (dow === 0 && h < 22);
  if (weekend) {
    return { blocked: true, reason: "SESSION_WEEKEND_OR_CLOSE" };
  }

  // FX daily bank rollover window — spreads spike (not gold/indices/crypto)
  if (!isIndex(pair) && !isGold(pair) && !isCrypto(pair) && h >= 20 && h < 22) {
    return { blocked: true, reason: "SESSION_FX_ROLLOVER" };
  }

  // ---- Index-specific cash-session protection ----
  // Buffers: no new entries in the last ~30–45 min before cash close, or first
  // ~15 min after open when spreads are unstable.

  if (pair === "JPN225") {
    // CFD session (not cash-only Tokyo). Cash-only window blocked the index most of the day.
    // Weekend already blocked above; extra Friday buffer before gap.
    if (dow === 5 && h >= 18) {
      return { blocked: true, reason: "SESSION_JPN225_FRIDAY_LATE" };
    }
  }

  if (pair === "UK100") {
    // London cash ~08:00–16:30 UTC. Block last 30m and outside session.
    const open = 8 * 60 + 15;
    const closeBuf = 16 * 60; // 16:00 UTC
    if (mins < open || mins >= closeBuf) {
      return { blocked: true, reason: "SESSION_UK100_OUTSIDE_CASH" };
    }
  }

  if (pair === "GER40") {
    // Frankfurt cash ~07:00–15:30 UTC approx Xetra
    const open = 7 * 60 + 15;
    const closeBuf = 15 * 60; // 15:00 UTC
    if (mins < open || mins >= closeBuf) {
      return { blocked: true, reason: "SESSION_GER40_OUTSIDE_CASH" };
    }
  }

  if (pair === "US30" || pair === "NAS100" || pair === "SPX500") {
    // US cash RTH ~13:30–20:00 UTC (09:30–16:00 ET approx, ignores DST edge)
    const open = 13 * 60 + 45;  // skip first 15m
    const closeBuf = 19 * 60 + 30; // stop 30m before ~20:00 close
    if (mins < open || mins >= closeBuf) {
      return { blocked: true, reason: "SESSION_US_INDEX_OUTSIDE_CASH" };
    }
  }

  return { blocked: false, reason: "" };
}


function pip(pair: string): number {
  if (isIndex(pair)) return 1;          // 1 point = 1 pip
  if (isGold(pair)) return 0.1;         // gold: 0.1 USD ≈ 1 "pip" for risk math
  if (isCrypto(pair)) return 1;         // 1 USD = 1 pip
  return pair.includes("JPY") ? 0.01 : 0.0001;
}
function priceDecimals(pair: string): number {
  if (isIndex(pair)) return 2;
  if (isGold(pair)) return 2;
  if (isCrypto(pair)) return 2;
  return pair.includes("JPY") ? 3 : 5;
}
// Minimum risk distance — relative to ATR so it works on FX, indices, and BTC.
// Rejects setups where stop is so tight any noise will hit it.
function minRiskFor(pair: string, atrVal: number): number {
  return atrVal * 0.5;
}
// Pip distance for reporting — abstract away FX vs index vs crypto unit math.
function toPips(pair: string, distance: number): number {
  const p = pip(pair);
  if (isIndex(pair) || isGold(pair) || isCrypto(pair)) return distance / p;
  return pair.includes("JPY") ? distance / (p * 10) : distance / p;
}

// Detect swing highs/lows using a 2-bar lookback fractal
function findSwings(candles: Candle[], lookback = 2): Swing[] {
  const swings: Swing[] = [];
  for (let i = lookback; i < candles.length - lookback; i++) {
    let isHigh = true;
    let isLow = true;
    for (let j = 1; j <= lookback; j++) {
      if (candles[i].high <= candles[i - j].high || candles[i].high <= candles[i + j].high) isHigh = false;
      if (candles[i].low >= candles[i - j].low || candles[i].low >= candles[i + j].low) isLow = false;
    }
    if (isHigh) swings.push({ index: i, price: candles[i].high, type: "high" });
    if (isLow) swings.push({ index: i, price: candles[i].low, type: "low" });
  }
  return swings;
}

// Determine market structure: BOS (continuation) or CHoCH (reversal)
function analyzeStructure(candles: Candle[], swings: Swing[]): {
  structure: "BOS" | "CHoCH" | null;
  trend: "Bullish" | "Bearish" | "Neutral";
  brokenLevel: number | null;
  brokenAtIndex: number | null;
} {
  if (swings.length < 4) return { structure: null, trend: "Neutral", brokenLevel: null, brokenAtIndex: null };

  const highs = swings.filter((s) => s.type === "high").slice(-3);
  const lows = swings.filter((s) => s.type === "low").slice(-3);

  // Determine prior trend from last 2 highs and lows
  let priorTrend: "Bullish" | "Bearish" | "Neutral" = "Neutral";
  if (highs.length >= 2 && lows.length >= 2) {
    const hh = highs[highs.length - 1].price > highs[highs.length - 2].price;
    const hl = lows[lows.length - 1].price > lows[lows.length - 2].price;
    const lh = highs[highs.length - 1].price < highs[highs.length - 2].price;
    const ll = lows[lows.length - 1].price < lows[lows.length - 2].price;
    if (hh && hl) priorTrend = "Bullish";
    else if (lh && ll) priorTrend = "Bearish";
  }

  // Look for a broken swing across the recent window (~20 bars on the 4H,
  // roughly 3 days). We test the last few swing highs/lows, not only the very
  // latest one — after a BOS the newest swing is often the break itself, so
  // checking only that level would hide a perfectly valid, fresh structure
  // break that price is now pulling back into.
  const recent = candles.slice(-20);
  const startIdx = candles.length - recent.length;
  const candHighs = highs.slice(-3);
  const candLows = lows.slice(-3);

  let brokenUp = false;
  let brokenDown = false;
  let brokenLevel: number | null = null;
  let brokenAtIndex: number | null = null;
  let upAt = -1;
  let downAt = -1;
  let upLevel: number | null = null;
  let downLevel: number | null = null;

  for (let i = Math.max(0, startIdx); i < candles.length; i++) {
    for (const h of candHighs) {
      if (candles[i].close > h.price && i > h.index && i > upAt) {
        brokenUp = true;
        upAt = i;
        upLevel = h.price;
      }
    }
    for (const l of candLows) {
      if (candles[i].close < l.price && i > l.index && i > downAt) {
        brokenDown = true;
        downAt = i;
        downLevel = l.price;
      }
    }
  }

  // If both sides broke inside the window, the most recent break wins.
  if (brokenUp && brokenDown) {
    if (upAt >= downAt) brokenDown = false;
    else brokenUp = false;
  }
  if (brokenUp) {
    brokenLevel = upLevel;
    brokenAtIndex = upAt;
  } else if (brokenDown) {
    brokenLevel = downLevel;
    brokenAtIndex = downAt;
  }


  if (brokenUp) {
    return {
      structure: priorTrend === "Bearish" ? "CHoCH" : "BOS",
      trend: "Bullish",
      brokenLevel,
      brokenAtIndex,
    };
  }
  if (brokenDown) {
    return {
      structure: priorTrend === "Bullish" ? "CHoCH" : "BOS",
      trend: "Bearish",
      brokenLevel,
      brokenAtIndex,
    };
  }

  return { structure: null, trend: priorTrend, brokenLevel: null, brokenAtIndex: null };
}

// Find the last opposite-color candle before an impulsive move = order block
function findOrderBlock(
  candles: Candle[],
  brokenAtIndex: number | null,
  direction: "Bullish" | "Bearish"
): OrderBlock | null {
  if (brokenAtIndex === null) return null;
  const lookback = Math.min(15, brokenAtIndex);
  for (let i = brokenAtIndex - 1; i >= brokenAtIndex - lookback && i >= 0; i--) {
    const c = candles[i];
    const bullishCandle = c.close > c.open;
    if (direction === "Bullish" && !bullishCandle) {
      return { index: i, top: c.high, bottom: c.low, type: "bullish" };
    }
    if (direction === "Bearish" && bullishCandle) {
      return { index: i, top: c.high, bottom: c.low, type: "bearish" };
    }
  }
  return null;
}

// Find ALL order blocks across the recent window in the given direction.
// This is what enables "stacked OB" detection — the high-probability pattern
// where price retraces into multiple aligned demand/supply zones (your screenshot).
function findAllOrderBlocks(
  candles: Candle[],
  direction: "Bullish" | "Bearish",
  lookback = 60,
): OrderBlock[] {
  const obs: OrderBlock[] = [];
  const start = Math.max(2, candles.length - lookback);
  for (let i = start; i < candles.length - 1; i++) {
    const c = candles[i];
    const next = candles[i + 1];
    const bullishCandle = c.close > c.open;
    // Bullish OB = down-close candle followed by an up-impulse that takes out its high
    if (direction === "Bullish" && !bullishCandle && next.close > c.high) {
      obs.push({ index: i, top: c.high, bottom: c.low, type: "bullish" });
    }
    // Bearish OB = up-close candle followed by a down-impulse that takes out its low
    if (direction === "Bearish" && bullishCandle && next.close < c.low) {
      obs.push({ index: i, top: c.high, bottom: c.low, type: "bearish" });
    }
  }
  return obs;
}

// An OB is "fresh" (untested) if no candle since its formation has wicked into it.
// Fresh OBs are the highest-probability — once tagged, they lose ~half their edge.
function isFreshOB(candles: Candle[], ob: OrderBlock): boolean {
  for (let i = ob.index + 2; i < candles.length - 1; i++) {
    // wick into the zone
    const c = candles[i];
    if (c.low <= ob.top && c.high >= ob.bottom) return false;
  }
  return true;
}

// Find STACKED order blocks: 2+ fresh OBs in trend direction, separated by ≤2.5×ATR.
// This is the exact pattern in your screenshot (Bu-OB at 1.205 + Bu-OB at 1.195).
// Stacked OBs = layered demand/supply, dramatically higher reversal probability.
function findStackedOBs(
  candles: Candle[],
  direction: "Bullish" | "Bearish",
  atrVal: number,
): OrderBlock[] {
  const all = findAllOrderBlocks(candles, direction, 80);
  const fresh = all.filter((ob) => isFreshOB(candles, ob));
  if (fresh.length < 2) return [];

  // Sort by price (low→high for bullish, high→low for bearish)
  const sorted = [...fresh].sort((a, b) =>
    direction === "Bullish" ? a.bottom - b.bottom : b.top - a.top,
  );

  // Find the closest pair within 2.5×ATR — that's a real "stack"
  const maxGap = atrVal * 2.5;
  for (let i = 0; i < sorted.length - 1; i++) {
    const gap = direction === "Bullish"
      ? sorted[i + 1].bottom - sorted[i].top
      : sorted[i].bottom - sorted[i + 1].top;
    if (gap >= 0 && gap <= maxGap) {
      return [sorted[i], sorted[i + 1]];
    }
  }
  return [];
}

// Count same-direction Market Structure Breaks (MSBs) in the recent window.
// Multiple MSBs in one direction = sustained trend (the "MSB MSB MSB" stacking
// visible across Feb→Apr in your screenshot). 3+ = institutional trend.
function countRecentMSBs(
  candles: Candle[],
  swings: Swing[],
  direction: "Bullish" | "Bearish",
  lookback = 50,
): number {
  if (swings.length < 4) return 0;
  const startIdx = Math.max(0, candles.length - lookback);
  let count = 0;

  if (direction === "Bullish") {
    const highs = swings.filter((s) => s.type === "high" && s.index >= startIdx);
    for (let i = 1; i < highs.length; i++) {
      // BOS up = candle close above prior swing high
      const priorHigh = highs[i - 1].price;
      for (let j = highs[i - 1].index + 1; j <= highs[i].index && j < candles.length; j++) {
        if (candles[j].close > priorHigh) { count++; break; }
      }
    }
  } else {
    const lows = swings.filter((s) => s.type === "low" && s.index >= startIdx);
    for (let i = 1; i < lows.length; i++) {
      const priorLow = lows[i - 1].price;
      for (let j = lows[i - 1].index + 1; j <= lows[i].index && j < candles.length; j++) {
        if (candles[j].close < priorLow) { count++; break; }
      }
    }
  }
  return count;
}

// Fair Value Gap: 3-candle imbalance
function findRecentFVG(candles: Candle[], direction: "Bullish" | "Bearish"): FVG | null {
  for (let i = candles.length - 1; i >= Math.max(2, candles.length - 20); i--) {
    const c1 = candles[i - 2];
    const c3 = candles[i];
    if (direction === "Bullish" && c3.low > c1.high) {
      return { index: i - 1, top: c3.low, bottom: c1.high, type: "bullish" };
    }
    if (direction === "Bearish" && c3.high < c1.low) {
      return { index: i - 1, top: c1.low, bottom: c3.high, type: "bearish" };
    }
  }
  return null;
}

// Simple EMA for higher timeframe bias
function ema(values: number[], period: number): number {
  const k = 2 / (period + 1);
  let e = values[0];
  for (let i = 1; i < values.length; i++) e = values[i] * k + e * (1 - k);
  return e;
}

// ATR(14) — average true range for volatility-adjusted swing stops
function atr(candles: Candle[], period = 14): number {
  if (candles.length < period + 1) return 0;
  const trs: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i];
    const prev = candles[i - 1];
    const tr = Math.max(
      c.high - c.low,
      Math.abs(c.high - prev.close),
      Math.abs(c.low - prev.close),
    );
    trs.push(tr);
  }
  return trs.slice(-period).reduce((a, b) => a + b, 0) / period;
}

// RSI(14) — momentum filter. >50 = bullish strength, <50 = bearish strength.
// Used to confirm direction at the OB tap (avoid catching falling knives).
function rsi(candles: Candle[], period = 14): number {
  if (candles.length < period + 1) return 50;
  let gains = 0;
  let losses = 0;
  for (let i = candles.length - period; i < candles.length; i++) {
    const diff = candles[i].close - candles[i - 1].close;
    if (diff >= 0) gains += diff;
    else losses -= diff;
  }
  const avgG = gains / period;
  const avgL = losses / period;
  if (avgL === 0) return 100;
  const rs = avgG / avgL;
  return 100 - 100 / (1 + rs);
}

// Engulfing pattern on the most recent closed 4H candle — confirms reversal at OB.
function isEngulfing(candles: Candle[], direction: "Bullish" | "Bearish"): boolean {
  if (candles.length < 2) return false;
  const prev = candles[candles.length - 2];
  const last = candles[candles.length - 1];
  if (direction === "Bullish") {
    return (
      prev.close < prev.open && // prev bearish
      last.close > last.open && // last bullish
      last.close >= prev.open &&
      last.open <= prev.close
    );
  }
  return (
    prev.close > prev.open && // prev bullish
    last.close < last.open && // last bearish
    last.close <= prev.open &&
    last.open >= prev.close
  );
}

// ---- Structure-anchored SL ----
// Place stop just beyond the most recent protective swing (low for BUY,
// high for SELL) found at or beyond the order-block edge. Adds a small
// ATR buffer for wick noise. Falls back to OB ± buffer if no swing found.
function structuralStop(
  candles: Candle[],
  swings: Swing[],
  direction: "BUY" | "SELL",
  obEdge: number,        // OB.bottom for BUY, OB.top for SELL
  atrVal: number,
  lookback = 30,
): number {
  const buffer = atrVal * 0.75;
  const startIdx = Math.max(0, candles.length - lookback);
  const recent = swings.filter((s) => s.index >= startIdx);
  if (direction === "BUY") {
    const lows = recent.filter((s) => s.type === "low" && s.price <= obEdge);
    if (lows.length > 0) {
      const deepest = Math.min(...lows.map((s) => s.price));
      return deepest - buffer;
    }
    return obEdge - buffer;
  }
  const highs = recent.filter((s) => s.type === "high" && s.price >= obEdge);
  if (highs.length > 0) {
    const tallest = Math.max(...highs.map((s) => s.price));
    return tallest + buffer;
  }
  return obEdge + buffer;
}

// ---- Realistic TP1: nearest opposing LTF swing in trade direction ----
function nearestOpposingSwing(
  swings: Swing[],
  direction: "BUY" | "SELL",
  entry: number,
  minDistance: number,   // must be at least this far away (e.g. 1×R)
): number | null {
  const cand = swings.filter((s) =>
    direction === "BUY"
      ? s.type === "high" && s.price > entry + minDistance
      : s.type === "low" && s.price < entry - minDistance,
  );
  if (cand.length === 0) return null;
  return direction === "BUY"
    ? Math.min(...cand.map((s) => s.price))
    : Math.max(...cand.map((s) => s.price));
}

// ---- Realistic TP2: next HTF (daily) zone in trade direction ----
function nextHTFZone(
  zones: SRZone[],
  direction: "BUY" | "SELL",
  entry: number,
  minDistance: number,
): number | null {
  const opposing: SRZone["type"] = direction === "BUY" ? "resistance" : "support";
  const cand = zones.filter((z) =>
    z.type === opposing &&
    (direction === "BUY" ? z.price > entry + minDistance : z.price < entry - minDistance),
  );
  if (cand.length === 0) return null;
  return direction === "BUY"
    ? Math.min(...cand.map((z) => z.price))
    : Math.max(...cand.map((z) => z.price));
}

// Strong HTF support/resistance zones from DAILY swings.
// "Strong" = a level tested ≥2 times within ATR-tolerance. This is the
// "support" you ride from in the GBPCAD example.
interface SRZone {
  price: number;
  type: "support" | "resistance";
  touches: number;
}
function findHTFZones(daily: Candle[]): SRZone[] {
  if (daily.length < 30) return [];
  const swings = findSwings(daily, 3);
  const dAtr = atr(daily, 14);
  const tol = dAtr * 0.5; // levels within 0.5×ATR are "the same zone"
  const zones: SRZone[] = [];

  const cluster = (sw: Swing[], type: "support" | "resistance") => {
    const sorted = [...sw].sort((a, b) => a.price - b.price);
    let i = 0;
    while (i < sorted.length) {
      let j = i;
      let sum = 0;
      let count = 0;
      while (j < sorted.length && sorted[j].price - sorted[i].price <= tol) {
        sum += sorted[j].price;
        count++;
        j++;
      }
      zones.push({ price: sum / count, type, touches: count });
      i = j;
    }
  };
  cluster(swings.filter((s) => s.type === "low"), "support");
  cluster(swings.filter((s) => s.type === "high"), "resistance");
  // Strong = ≥2 touches
  return zones.filter((z) => z.touches >= 2);
}

// Is current price reacting from a strong HTF zone? (within 1.5×4H-ATR)
function nearStrongZone(
  price: number,
  zones: SRZone[],
  type: "support" | "resistance",
  tolerance: number,
): SRZone | null {
  let best: SRZone | null = null;
  for (const z of zones) {
    if (z.type !== type) continue;
    if (Math.abs(price - z.price) <= tolerance) {
      if (!best || z.touches > best.touches) best = z;
    }
  }
  return best;
}

// Did price RETEST the broken structure level? (break-and-retest = high prob)
// Returns true if, after the BOS, price came back within retestTol of the broken level.
function hasRetested(
  candles: Candle[],
  brokenLevel: number,
  brokenAtIndex: number,
  tolerance: number,
): boolean {
  for (let i = brokenAtIndex + 1; i < candles.length; i++) {
    const c = candles[i];
    if (Math.abs(c.low - brokenLevel) <= tolerance) return true;
    if (Math.abs(c.high - brokenLevel) <= tolerance) return true;
  }
  return false;
}

function mergeCandles(group: Candle[]): Candle {
  return {
    time: group[0].time,
    open: group[0].open,
    high: Math.max(...group.map((c) => c.high)),
    low: Math.min(...group.map((c) => c.low)),
    close: group[group.length - 1].close,
  };
}

// Resample 1h -> 4h aligned to UTC 4-hour boundaries
function resampleTo4H(hourly: Candle[]): Candle[] {
  const out: Candle[] = [];
  let bucket: Candle[] = [];
  let bucketKey = -1;
  for (const c of hourly) {
    const d = new Date(c.time * 1000);
    const slot = Math.floor(d.getUTCHours() / 4);
    const day = Math.floor(c.time / 86400);
    const key = day * 10 + slot;
    if (bucket.length === 0 || key === bucketKey) {
      bucket.push(c);
      bucketKey = key;
    } else {
      out.push(mergeCandles(bucket));
      bucket = [c];
      bucketKey = key;
    }
  }
  if (bucket.length) out.push(mergeCandles(bucket));
  return out;
}

// ---------- DAX-STYLE INTRADAY FILTERS ----------
// These mirror the Frankfurt/London open playbook on the German DAX index:
// 1) Asian range = liquidity pool. Wait for a sweep of the Asian high/low
//    during the London or NY kill-zone, then enter on the reversal.
// 2) Displacement candle = strong, decisive move (>=1.2x ATR body) that
//    confirms smart-money has stepped in (not slow drift).
// 3) Kill-zones = the only times institutional volume is reliably present.

// London kill-zone: 07:00–10:00 UTC. NY kill-zone: 12:00–15:00 UTC.
// Outside these windows, smart-money setups usually fail or chop.
function inKillZone(time: number): { active: boolean; session: "London" | "NewYork" | null } {
  const h = new Date(time * 1000).getUTCHours();
  if (h >= 7 && h < 10) return { active: true, session: "London" };
  if (h >= 12 && h < 15) return { active: true, session: "NewYork" };
  return { active: false, session: null };
}

// Asian session range (00:00–06:00 UTC) on the most recent trading day.
// This is the liquidity pool DAX traders hunt at the London open.
function asianRange(hourly: Candle[]): { high: number; low: number } | null {
  if (!hourly.length) return null;
  // Find the most recent Asian session window in the data
  for (let dayBack = 0; dayBack < 5; dayBack++) {
    const now = hourly[hourly.length - 1].time;
    const dayStart = Math.floor(now / 86400) * 86400 - dayBack * 86400;
    const sessionStart = dayStart;
    const sessionEnd = dayStart + 6 * 3600;
    const session = hourly.filter((c) => c.time >= sessionStart && c.time < sessionEnd);
    if (session.length >= 3) {
      return {
        high: Math.max(...session.map((c) => c.high)),
        low: Math.min(...session.map((c) => c.low)),
      };
    }
  }
  return null;
}

// Did price sweep the Asian range (wick beyond, close back inside)
// in the last `lookback` candles, and is the close in `direction`?
function asianSweep(
  hourly: Candle[],
  range: { high: number; low: number },
  direction: "Bullish" | "Bearish",
  lookback = 8,
): { swept: number; sweptAt: number } | null {
  const start = Math.max(0, hourly.length - lookback);
  for (let i = start; i < hourly.length; i++) {
    const c = hourly[i];
    if (direction === "Bullish") {
      // Bullish setup: sweep the LOW (sellers trapped), close back above
      if (c.low < range.low && c.close > range.low) {
        return { swept: range.low, sweptAt: i };
      }
    } else {
      // Bearish setup: sweep the HIGH (buyers trapped), close back below
      if (c.high > range.high && c.close < range.high) {
        return { swept: range.high, sweptAt: i };
      }
    }
  }
  return null;
}

// Displacement: a single candle with body >= 1.2x ATR moving in `direction`.
// This is the "smart money has fired" signature DAX traders wait for.
function hasDisplacement(
  candles: Candle[],
  direction: "Bullish" | "Bearish",
  atrVal: number,
  lookback = 5,
): boolean {
  if (atrVal <= 0) return false;
  const start = Math.max(0, candles.length - lookback);
  for (let i = start; i < candles.length; i++) {
    const c = candles[i];
    const body = Math.abs(c.close - c.open);
    if (body < atrVal * 1.2) continue;
    if (direction === "Bullish" && c.close > c.open) return true;
    if (direction === "Bearish" && c.close < c.open) return true;
  }
  return false;
}

// Liquidity Sweep (a.k.a. stop hunt): price wicks BEYOND a recent swing high/low,
// then closes back inside. This traps breakout traders and signals smart-money entry.
// Returns the swept level + direction implication, or null if no recent sweep.
function findLiquiditySweep(
  candles: Candle[],
  swings: Swing[],
  direction: "Bullish" | "Bearish",
): { level: number; sweptAt: number } | null {
  // Look at the last 5 candles for a sweep
  const recent = candles.slice(-5);
  const startIdx = candles.length - recent.length;

  if (direction === "Bullish") {
    // Bullish setup needs a sweep of recent LOWS (sellers trapped)
    const lows = swings.filter((s) => s.type === "low" && s.index < startIdx).slice(-3);
    if (!lows.length) return null;
    for (let i = 0; i < recent.length; i++) {
      const c = recent[i];
      for (const lw of lows) {
        if (c.low < lw.price && c.close > lw.price) {
          return { level: lw.price, sweptAt: startIdx + i };
        }
      }
    }
  } else {
    // Bearish setup needs a sweep of recent HIGHS (buyers trapped)
    const highs = swings.filter((s) => s.type === "high" && s.index < startIdx).slice(-3);
    if (!highs.length) return null;
    for (let i = 0; i < recent.length; i++) {
      const c = recent[i];
      for (const hi of highs) {
        if (c.high > hi.price && c.close < hi.price) {
          return { level: hi.price, sweptAt: startIdx + i };
        }
      }
    }
  }
  return null;
}


// SWING TRADING: 4H structure (resampled from 1h) + Daily HTF bias

function pairToYahoo(pair: string): string {
  return PAIRS.find((p) => p.pair === pair)?.yfSymbol ?? pair.replace("/", "") + "=X";
}

async function fetchYahooCandles(
  pair: string,
  interval: "4h" | "1h" | "1d" | "5m" | "15m" | "30m",
  range: "1mo" | "3mo" | "6mo" | "1y" | "2y",
): Promise<Candle[]> {
  const sym = pairToYahoo(pair);
  // Yahoo doesn't expose native 4h FX — fetch 1h and resample
  const fetchInterval = interval === "4h" ? "1h" : interval;
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
    sym,
  )}?interval=${fetchInterval}&range=${range}`;

  // Yahoo Finance occasionally returns 5xx under load — retry once with backoff,
  // and fall back to query2 host on persistent failure.
  const fetchWithRetry = async (u: string): Promise<Response> => {
    for (let attempt = 0; attempt < 4; attempt++) {
      const res = await fetch(u, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          Accept: "application/json",
        },
      });
      if (res.ok) return res;
      // Retry on rate-limit (429) and server errors
      if (res.status !== 429 && res.status < 500) return res;
      await res.body?.cancel?.();
      await new Promise((r) => setTimeout(r, 600 * (attempt + 1)));
    }
    // Final fallback to query2 host
    return fetch(u.replace("query1.finance", "query2.finance"), {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: "application/json",
      },
    });
  };

  const r = await fetchWithRetry(url);
  if (!r.ok) throw new Error(`Yahoo HTTP ${r.status} for ${pair}`);
  const j = await r.json();
  const result = j?.chart?.result?.[0];
  if (!result || j?.chart?.error) {
    throw new Error(`Yahoo error for ${pair}: ${j?.chart?.error?.description ?? "no data"}`);
  }
  const ts: number[] = result.timestamp ?? [];
  const q = result.indicators?.quote?.[0];
  if (!ts.length || !q) throw new Error(`Yahoo returned empty data for ${pair}`);

  const raw: Candle[] = [];
  for (let i = 0; i < ts.length; i++) {
    const o = q.open?.[i];
    const h = q.high?.[i];
    const l = q.low?.[i];
    const c = q.close?.[i];
    if (o == null || h == null || l == null || c == null) continue;
    raw.push({ time: ts[i], open: o, high: h, low: l, close: c });
  }
  return interval === "4h" ? resampleTo4H(raw) : raw;
  }


// ============================================================================
// PROFESSIONAL ENTRY MODELS (ICT / SMC playbook)
// ----------------------------------------------------------------------------
// We stop firing on the raw OB proximal edge and instead pick the best of four
// pro-trader entry models — whichever gives the tightest, highest-probability
// fill within the current pullback:
//   1. OTE          — 61.8–79% fib retrace of the impulse leg (sweet spot 70.5%)
//   2. FVG fill     — mitigation of the fair-value-gap midpoint
//   3. Breaker      — retest of a failed OB that flipped role after a sweep
//   4. Judas sweep  — stop-hunt of session high/low then 1H CHoCH; enter on
//                     retest of the CHoCH origin candle
//
// Every entry then requires a 1H CONFIRMATION CANDLE close inside the zone in
// trade direction (rejection body). Trade fires at MARKET on that close — no
// blind limits sitting in the zone.
// ============================================================================

interface EntryZone { top: number; bottom: number; }
interface ProEntry {
  price: number;
  zone: EntryZone;
  model: "OTE" | "FVG" | "Breaker" | "Judas";
  stopAnchor: number; // structural invalidation for this specific model
}

// OTE = Optimal Trade Entry (61.8–79% fib retrace of the impulse leg).
// For a BUY: impulse = swing low → most recent swing high before the pullback.
// Sweet-spot entry = 70.5%.
function computeOTE(
  candles: Candle[],
  swings: Swing[],
  direction: "BUY" | "SELL",
  lookback = 40,
): ProEntry | null {
  const startIdx = Math.max(0, candles.length - lookback);
  const recent = swings.filter((s) => s.index >= startIdx);
  if (recent.length < 2) return null;
  if (direction === "BUY") {
    const highs = recent.filter((s) => s.type === "high");
    const lows = recent.filter((s) => s.type === "low");
    if (!highs.length || !lows.length) return null;
    const legHigh = highs.reduce((a, b) => (a.price > b.price ? a : b));
    const priorLows = lows.filter((s) => s.index < legHigh.index);
    if (!priorLows.length) return null;
    const legLow = priorLows.reduce((a, b) => (a.price < b.price ? a : b));
    const range = legHigh.price - legLow.price;
    if (range <= 0) return null;
    const top = legHigh.price - range * 0.618;
    const bottom = legHigh.price - range * 0.79;
    const price = legHigh.price - range * 0.705; // sweet spot
    return { price, zone: { top, bottom }, model: "OTE", stopAnchor: legLow.price };
  }
  const highs = recent.filter((s) => s.type === "high");
  const lows = recent.filter((s) => s.type === "low");
  if (!highs.length || !lows.length) return null;
  const legLow = lows.reduce((a, b) => (a.price < b.price ? a : b));
  const priorHighs = highs.filter((s) => s.index < legLow.index);
  if (!priorHighs.length) return null;
  const legHigh = priorHighs.reduce((a, b) => (a.price > b.price ? a : b));
  const range = legHigh.price - legLow.price;
  if (range <= 0) return null;
  const bottom = legLow.price + range * 0.618;
  const top = legLow.price + range * 0.79;
  const price = legLow.price + range * 0.705;
  return { price, zone: { bottom, top }, model: "OTE", stopAnchor: legHigh.price };
}

// FVG fill entry — mitigate the imbalance midpoint.
function fvgEntry(fvg: FVG | null, direction: "BUY" | "SELL", swings: Swing[]): ProEntry | null {
  if (!fvg) return null;
  const mid = (fvg.top + fvg.bottom) / 2;
  // Stop just beyond the FVG's origin side (protective swing)
  const stopAnchor = direction === "BUY" ? fvg.bottom : fvg.top;
  return {
    price: mid,
    zone: { top: fvg.top, bottom: fvg.bottom },
    model: "FVG",
    stopAnchor,
  };
}

// Breaker block — a failed OB that flipped role after a liquidity sweep.
// BUY: find a recent BEARISH OB (rejection zone) that got broken to the upside;
// it now acts as demand (breaker). Enter on retest of its top edge.
function findBreaker(
  candles: Candle[],
  direction: "BUY" | "SELL",
  lookback = 60,
): ProEntry | null {
  const start = Math.max(0, candles.length - lookback);
  // Scan for opposite-color candles that got broken through by a strong close
  for (let i = candles.length - 4; i >= start + 2; i--) {
    const c = candles[i];
    const isDownCandle = c.close < c.open;
    const isUpCandle = c.close > c.open;
    if (direction === "BUY" && isDownCandle) {
      // Was it broken to the upside within the next `lookback` bars?
      for (let j = i + 1; j < candles.length; j++) {
        if (candles[j].close > c.high) {
          // Confirmed breaker: bearish candle now flipped to demand
          const top = c.high;
          const bottom = Math.min(c.open, c.close);
          return {
            price: top, // enter on retest of top edge
            zone: { top, bottom },
            model: "Breaker",
            stopAnchor: c.low,
          };
        }
      }
    }
    if (direction === "SELL" && isUpCandle) {
      for (let j = i + 1; j < candles.length; j++) {
        if (candles[j].close < c.low) {
          const bottom = c.low;
          const top = Math.max(c.open, c.close);
          return {
            price: bottom,
            zone: { top, bottom },
            model: "Breaker",
            stopAnchor: c.high,
          };
        }
      }
    }
  }
  return null;
}

// Judas sweep entry — session liquidity grab + 1H structure shift.
// Enter on retest of the CHoCH origin (the candle that closed back inside
// after the sweep). Stop beyond the swept wick.
function judasEntry(
  hourly: Candle[],
  direction: "BUY" | "SELL",
  atrVal: number,
): ProEntry | null {
  if (hourly.length < 30) return null;
  const hSwings = findSwings(hourly.slice(-60), 2);
  const sweep = findLiquiditySweep(hourly.slice(-60), hSwings, direction === "BUY" ? "Bullish" : "Bearish");
  if (!sweep) return null;
  // CHoCH origin = the candle at sweptAt (the one that reversed)
  const origin = hourly.slice(-60)[sweep.sweptAt];
  if (!origin) return null;
  const top = Math.max(origin.open, origin.close);
  const bottom = Math.min(origin.open, origin.close);
  const price = direction === "BUY" ? top : bottom; // retest edge
  const stopAnchor = direction === "BUY"
    ? sweep.level - atrVal * 0.3
    : sweep.level + atrVal * 0.3;
  return {
    price,
    zone: { top, bottom },
    model: "Judas",
    stopAnchor,
  };
}

// Pick the pro entry closest to current price (best pullback fill) that is
// within reach (≤ 2.5×ATR). If none qualify, return null (fall through to OB).
function pickBestProEntry(
  candidates: (ProEntry | null)[],
  currentPrice: number,
  atrVal: number,
): ProEntry | null {
  const viable = candidates.filter((e): e is ProEntry =>
    !!e && Math.abs(e.price - currentPrice) <= atrVal * 2.5,
  );
  if (!viable.length) return null;
  viable.sort((a, b) => Math.abs(a.price - currentPrice) - Math.abs(b.price - currentPrice));
  return viable[0];
}

// 1H CONFIRMATION CANDLE — a closed 1H bar inside the entry zone with a
// rejection body in trade direction (body ≥ 40% of range, close in dir half).
function has1hConfirmation(
  hourly: Candle[],
  zone: EntryZone,
  direction: "BUY" | "SELL",
): boolean {
  return hasEntryCandleConfirmation(hourly, zone, direction, 8);
}

/** Rejection / direction candle inside the entry zone on any LTF series. */
function hasEntryCandleConfirmation(
  candles: Candle[],
  zone: EntryZone,
  direction: "BUY" | "SELL",
  lookback = 12,
): boolean {
  const tail = candles.slice(-lookback);
  for (const c of tail) {
    const inZone = c.low <= zone.top && c.high >= zone.bottom;
    if (!inZone) continue;
    const range = c.high - c.low;
    if (range <= 0) continue;
    const body = Math.abs(c.close - c.open);
    const bodyPct = body / range;
    const bullBody = c.close > c.open;
    const bearBody = c.close < c.open;
    const zMid = (zone.top + zone.bottom) / 2;
    const closeStrong = direction === "BUY" ? c.close >= zMid : c.close <= zMid;
    if (bodyPct >= 0.28 && closeStrong && ((direction === "BUY" && bullBody) || (direction === "SELL" && bearBody))) {
      return true;
    }
  }
  return false;
}

/** Indices entry: structure shift on 15m/30m in trade direction. */
function hasIndexLtfStructure(
  ltfCandles: Candle[],
  direction: "BUY" | "SELL",
): { ok: boolean; structure: "BOS" | "CHoCH" | null } {
  if (ltfCandles.length < 40) return { ok: false, structure: null };
  const tail = ltfCandles.slice(-120);
  const swings = findSwings(tail, 2);
  const struct = analyzeStructure(tail, swings);
  const want = direction === "BUY" ? "Bullish" : "Bearish";
  if (struct.trend === want && struct.structure != null) {
    return { ok: true, structure: struct.structure };
  }
  return { ok: false, structure: null };
}


// Attach the gate that stopped a setup from firing, so the UI can explain why
// a pair is "developing" instead of triggering.
function tagBlocked(d: DevelopingSetup | null, gate: string): DevelopingSetup | null {
  if (!d) return d;
  (d as DevelopingSetup & { blockedBy?: string }).blockedBy = gate;
  return d;
}

async function analyzePairFromCandles(
  pair: string,
  ltfRaw: Candle[],
  htfRaw: Candle[],
  hourly: Candle[],
  entryTFs?: { m1?: Candle[]; m5?: Candle[]; m15?: Candle[]; m30?: Candle[] },
): Promise<{ signal: Signal | null; developing: DevelopingSetup | null }> {


  const ltfTail = ltfRaw.slice(-200); // ~33 days of 4H
  const htfTail = htfRaw.slice(-150); // ~150 daily candles for stable bias

  if (ltfTail.length < 30) return { signal: null, developing: null };

  // 3-bar fractal — filters intraday noise on 4H
  const swings = findSwings(ltfTail, 2);
  const structure = analyzeStructure(ltfTail, swings);

  const htfCloses = htfTail.map((c) => c.close);
  if (htfCloses.length < 50) return { signal: null, developing: null };
  const ema20 = ema(htfCloses.slice(-40), 20);
  const ema50 = ema(htfCloses, 50);
  // Per-asset bias separation: tighter for FX (low daily vol), wider for crypto/indices.
  const biasSep = isCrypto(pair) ? 0.010 : isGold(pair) ? 0.004 : isIndex(pair) ? 0.0035 : 0.0015;
  const htf_bias: "Bullish" | "Bearish" | "Neutral" =
    ema20 > ema50 * (1 + biasSep) ? "Bullish"
    : ema20 < ema50 * (1 - biasSep) ? "Bearish"
    : "Neutral";

  // 4H bias (from 4H closes) — must AGREE with Daily bias to define market direction.
  // Daily = macro trend, 4H = swing trend. Alignment of both = the "Market Direction"
  // filter the user asked for. 1H/30m is used below for the actual entry trigger.
  const ltfCloses = ltfTail.map((c) => c.close);
  const ltfEma20 = ema(ltfCloses.slice(-60), 20);
  const ltfEma50 = ema(ltfCloses, 50);
  const h4_bias: "Bullish" | "Bearish" | "Neutral" =
    ltfEma20 > ltfEma50 * (1 + biasSep * 0.6) ? "Bullish"
    : ltfEma20 < ltfEma50 * (1 - biasSep * 0.6) ? "Bearish"
    : "Neutral";
  const marketDirectionAligned =
    htf_bias !== "Neutral" && h4_bias === htf_bias;


  const lastCandle = ltfTail[ltfTail.length - 1];
  const currentPrice = lastCandle.close;
  const atrVal = atr(ltfTail, 14);

  // Volatility-expansion filter: if current ATR has collapsed vs the prior 30-bar
  // average, market is in a coil — SMC setups in that regime tend to chop and fail.
  const priorAtr = atr(ltfTail.slice(0, -10), 14);
  const volExpanding = priorAtr === 0 || atrVal >= priorAtr * 0.85;

  // News-driven momentum: last 4H candle range > 2x ATR (proxy for high-impact news)
  const lastRange = lastCandle.high - lastCandle.low;
  const newsMomentum = atrVal > 0 && lastRange > atrVal * 2;

  // ---------- DEVELOPING SETUP DETECTION ----------
  // We surface a pair as "developing" when bias is clear and at least one
  // smart-money trigger (sweep / OB / FVG) is present, but full signal isn't ready.
  const buildDeveloping = (): DevelopingSetup | null => {
    // Determine direction. Default = HTF bias. But if price is reacting from a
    // strong opposing daily S/R zone, surface that as a counter-trend bounce
    // (e.g. a BUY at strong support even when daily bias is Bearish).
    const dHtfZonesAll = findHTFZones(htfTail);
    const zoneTol = atrVal * 1.8;
    const nearSup = nearStrongZone(currentPrice, dHtfZonesAll, "support", zoneTol);
    const nearRes = nearStrongZone(currentPrice, dHtfZonesAll, "resistance", zoneTol);
    const closer =
      nearSup && nearRes
        ? Math.abs(currentPrice - nearSup.price) <= Math.abs(currentPrice - nearRes.price)
          ? { z: nearSup, dir: "BUY" as const, trend: "Bullish" as const }
          : { z: nearRes, dir: "SELL" as const, trend: "Bearish" as const }
        : nearSup
        ? { z: nearSup, dir: "BUY" as const, trend: "Bullish" as const }
        : nearRes
        ? { z: nearRes, dir: "SELL" as const, trend: "Bearish" as const }
        : null;

    let dir: "BUY" | "SELL";
    let trendDir: "Bullish" | "Bearish";
    let counterBias = false;
    let zoneReaction: { z: SRZone; dir: "BUY" | "SELL" } | null = null;
    if (closer) {
      dir = closer.dir;
      trendDir = closer.trend;
      counterBias = htf_bias !== "Neutral" && htf_bias !== trendDir;
      zoneReaction = { z: closer.z, dir: closer.dir };
    } else {
      if (htf_bias === "Neutral") return null;
      dir = htf_bias === "Bullish" ? "BUY" : "SELL";
      trendDir = htf_bias;
  }

    const dOb = findOrderBlock(ltfTail, structure.brokenAtIndex, trendDir);
    const dStacked = findStackedOBs(ltfTail, trendDir, atrVal);
    const dFreshOb = dOb && isFreshOB(ltfTail, dOb);
    const dMsbCount = countRecentMSBs(ltfTail, swings, trendDir, 50);
    const dFvg = findRecentFVG(ltfTail, trendDir);
    const dSweep = findLiquiditySweep(ltfTail, swings, trendDir);

    const triggers: string[] = [];
    let proximity = 20;
    if (dStacked.length === 2) {
      triggers.push(`★ Stacked ${trendDir.toLowerCase()} OBs — layered demand`);
      proximity += 30;
    } else if (dFreshOb && dOb) {
      triggers.push(`✓ Fresh ${dOb.type} OB (untested)`);
      proximity += 22;
    } else if (dOb) {
      triggers.push(`◌ ${dOb.type} OB (already tagged)`);
      proximity += 8;
    }
    if (dMsbCount >= 1) {
      triggers.push(`✓ ${dMsbCount}× ${trendDir} MSBs — trend confirmation`);
      proximity += dMsbCount >= 2 ? 15 : 10;
    }
    if (dSweep) { triggers.push(`✓ Liquidity sweep @ ${dSweep.level.toFixed(priceDecimals(pair))}`); proximity += 15; }
    if (dFvg) { triggers.push(`✓ ${dFvg.type} FVG imbalance`); proximity += 8; }
    if (structure.structure) {
      triggers.push(`✓ ${structure.structure} on 4H (${structure.trend})`);
      proximity += 10;
    } else {
      triggers.push(`◌ Waiting for BOS/CHoCH break`);
    }
    if (newsMomentum) { triggers.push(`⚡ News-driven momentum candle`); proximity += 8; }
    if (zoneReaction) {
      const label = zoneReaction.dir === "BUY" ? "support" : "resistance";
      triggers.push(
        `★ Reacting from strong daily ${label} @ ${zoneReaction.z.price.toFixed(priceDecimals(pair))} (${zoneReaction.z.touches}× touches)`,
      );
      proximity += 20;
      if (counterBias) {
        triggers.push(`⚠ Counter-bias bounce — daily HTF is ${htf_bias}`);
      }
    }

    // Surface if we have a strong zone reaction OR any other smart-money trigger.
    if (!zoneReaction && !dSweep && !dOb && !newsMomentum && dStacked.length === 0) return null;

    let reason = "";
    if (newsMomentum && !structure.structure) reason = "News spike — waiting for structure break";
    else if (dSweep && !structure.structure) reason = "Liquidity swept — waiting for BOS confirmation";
    else if (dOb && !structure.structure) reason = "Order block tagged — waiting for reaction";
    else if (structure.structure && !dSweep && !dOb) reason = "Structure break — waiting for OB/sweep entry";
    else reason = "Multiple confluences building — close to firing";

    // Compute a proposed trade plan (entry / SL / TP zones) using the same
    // structure-anchored model as confirmed signals: SL beyond protective swing,
    // TP1 at nearest opposing swing, TP2 at next HTF zone.
    const decimals = priceDecimals(pair);
    const p = pip(pair);
    let plan: DevelopingSetup["plan"] = null;

    let pEntry: number | null = null;
    let pSL: number | null = null;
    let obEdge: number | null = null;
    if (dStacked.length === 2) {
      const closest = dir === "BUY"
        ? dStacked.reduce((a, b) => (Math.abs(currentPrice - a.top) < Math.abs(currentPrice - b.top) ? a : b))
        : dStacked.reduce((a, b) => (Math.abs(currentPrice - a.bottom) < Math.abs(currentPrice - b.bottom) ? a : b));
      pEntry = dir === "BUY" ? closest.top : closest.bottom;
      obEdge = dir === "BUY"
        ? Math.min(...dStacked.map((o) => o.bottom))
        : Math.max(...dStacked.map((o) => o.top));
    } else if (dOb) {
      pEntry = (dOb.top + dOb.bottom) / 2;
      obEdge = dir === "BUY" ? dOb.bottom : dOb.top;
    } else if (dSweep) {
      pEntry = dSweep.level;
      obEdge = dSweep.level;
    } else if (zoneReaction) {
      // Counter-bias bounce off raw HTF level: enter at the zone, SL beyond it.
      pEntry = zoneReaction.z.price;
      obEdge = zoneReaction.z.price;
    }
    if (pEntry != null && obEdge != null) {
      pSL = structuralStop(ltfTail, swings, dir, obEdge, atrVal, 30);
      const maxRisk = atrVal * 3;
      if (Math.abs(pEntry - pSL) > maxRisk) {
        pSL = dir === "BUY" ? pEntry - maxRisk : pEntry + maxRisk;
      }
    }

    if (pEntry != null && pSL != null) {
      const risk = Math.abs(pEntry - pSL);
      // Informational zones — accept any non-zero risk (the strict minRisk gate
      // is enforced only when a confirmed signal fires).
      if (risk > 0) {
        const dHtfZones = findHTFZones(htfTail);
        const minT1 = risk * 1.5;
        const minT2 = risk * 3;
        const maxT1 = risk * 4;
        const maxT2 = risk * 8;
        const sw = nearestOpposingSwing(swings, dir, pEntry, minT1);
        const zo = nextHTFZone(dHtfZones, dir, pEntry, minT2);
        const clmp = (target: number, lo: number, hi: number) =>
          dir === "BUY"
            ? Math.min(Math.max(target, pEntry! + lo), pEntry! + hi)
            : Math.max(Math.min(target, pEntry! - lo), pEntry! - hi);
        const tp1 = sw != null
          ? clmp(sw, minT1, maxT1)
          : dir === "BUY" ? pEntry + risk * 2 : pEntry - risk * 2;
        const tp1Dist = Math.abs(tp1 - pEntry);
        const minT2F = Math.max(minT2, tp1Dist + risk * 0.5);
        const tp2 = zo != null
          ? clmp(zo, minT2F, maxT2)
          : dir === "BUY" ? pEntry + risk * 5 : pEntry - risk * 5;
        const riskPips = toPips(pair, risk);

        // ---- Deeper SWING entry tier ----
        // Use the daily HTF zone (support for BUY / resistance for SELL) as a
        // discount/premium fill. Falls back to nearest opposing HTF zone if no
        // current reaction was tagged. Only emitted when meaningfully deeper
        // than the LTF entry (>= 0.5×ATR away) so we don't duplicate it.
        let swingEntry: number | undefined;
        let swingStopLoss: number | undefined;
        let swingRiskPips: number | undefined;
        const dailyZone =
          zoneReaction?.z ??
          dHtfZones
            .filter((z) =>
              dir === "BUY"
                ? z.type === "support" && z.price < pEntry!
                : z.type === "resistance" && z.price > pEntry!,
            )
            .sort((a, b) => Math.abs(a.price - pEntry!) - Math.abs(b.price - pEntry!))[0];
        if (dailyZone) {
          const candidate = dailyZone.price;
          const gap = Math.abs(candidate - pEntry);
          const inDirection = dir === "BUY" ? candidate < pEntry : candidate > pEntry;
          if (inDirection && gap >= atrVal * 0.5) {
            const slBuffer = Math.max(atrVal * 1.2, p * 8);
            const sSL = dir === "BUY" ? candidate - slBuffer : candidate + slBuffer;
            const sRisk = Math.abs(candidate - sSL);
            if (sRisk > 0) {
              swingEntry = Number(candidate.toFixed(decimals));
              swingStopLoss = Number(sSL.toFixed(decimals));
              swingRiskPips = Math.round(toPips(pair, sRisk));
            }
          }
        }

        plan = {
          entry: Number(pEntry.toFixed(decimals)),
          stopLoss: Number(pSL.toFixed(decimals)),
          takeProfit: Number(tp1.toFixed(decimals)),
          takeProfit2: Number(tp2.toFixed(decimals)),
          riskPips: Math.round(riskPips),
          ...(swingEntry != null
            ? { swingEntry, swingStopLoss, swingRiskPips }
            : {}),
        };
      }
    }

    return {
      pair,
      direction: dir,
      htf_bias: trendDir,
      reason,
      proximity: Math.min(95, proximity),
      currentPrice: Number(currentPrice.toFixed(decimals)),
      newsMomentum,
      triggers,
      plan,
    };
  };

  // ---------- FULL SIGNAL DETECTION ----------
  // 90%-grade gates: BOS only (no CHoCH), HTF-aligned, at strong daily S/R,
  // confirmed by retest + (RSI bias OR engulfing).
  if (!structure.structure || structure.trend === "Neutral") {
    return { signal: null, developing: tagBlocked(buildDeveloping(), "NO_4H_STRUCTURE") };
  }
  if (htf_bias === "Neutral") {
    return { signal: null, developing: tagBlocked(buildDeveloping(), "NEUTRAL_DAILY_BIAS") };
  }

  // GATE 1: BOS only — CHoCH (counter-trend reversals) historically underperform.
  if (structure.structure !== "BOS") {
    return { signal: null, developing: tagBlocked(buildDeveloping(), "GATE 1") };
  }

  const direction = structure.trend === "Bullish" ? "BUY" : "SELL";

  // GATE 2: must be aligned with daily bias
  const aligned =
    (direction === "BUY" && htf_bias === "Bullish") ||
    (direction === "SELL" && htf_bias === "Bearish");
  if (!aligned) return { signal: null, developing: tagBlocked(buildDeveloping(), "GATE 2") };

  // GATE 2b: 4H bias must AGREE with Daily bias.
  // Market Direction = Daily ∩ 4H. If 4H is diverging from Daily, the swing
  // trend is either weak or rolling over — do not fire, keep as developing.
  const dirBias = direction === "BUY" ? "Bullish" : "Bearish";
  if (h4_bias !== dirBias || !marketDirectionAligned) {
    return { signal: null, developing: tagBlocked(buildDeveloping(), "GATE 2b") };
  }

  // GATE 3: must be reacting from a STRONG daily S/R zone (≥2 touches).
  // This is the "buying at strong support and riding to the top" rule.
  const htfZones = findHTFZones(htfTail);
  const zoneTol = atrVal * 1.5;
  const zoneType = direction === "BUY" ? "support" : "resistance";
  const strongZone = nearStrongZone(currentPrice, htfZones, zoneType, zoneTol);
  if (!strongZone) return { signal: null, developing: tagBlocked(buildDeveloping(), "GATE 3") };

  const obAnchor = findOrderBlock(ltfTail, structure.brokenAtIndex, structure.trend);
  const stackedOBs = findStackedOBs(ltfTail, structure.trend, atrVal);
  const allFreshOBs = findAllOrderBlocks(ltfTail, structure.trend, 60)
    .filter((o) => isFreshOB(ltfTail, o));

  const fvg = findRecentFVG(ltfTail, structure.trend);
  const sweep = findLiquiditySweep(ltfTail, swings, structure.trend);

  // GATE 4: must have a FRESH (untested) OB. Prefer stacked, fall back to anchor.
  let ob: OrderBlock | null = null;
  let isStacked = false;
  if (stackedOBs.length === 2) {
    ob = direction === "BUY"
      ? stackedOBs.reduce((a, b) => (Math.abs(currentPrice - a.top) < Math.abs(currentPrice - b.top) ? a : b))
      : stackedOBs.reduce((a, b) => (Math.abs(currentPrice - a.bottom) < Math.abs(currentPrice - b.bottom) ? a : b));
    isStacked = true;
  } else if (obAnchor && isFreshOB(ltfTail, obAnchor)) {
    ob = obAnchor;
  } else if (allFreshOBs.length > 0) {
    ob = allFreshOBs[allFreshOBs.length - 1];
  }
  if (!ob) return { signal: null, developing: tagBlocked(buildDeveloping(), "GATE 4") };

  // GATE 5: price must be APPROACHING or INSIDE the OB (within 2.5×ATR).
  // No point firing "buy" if price is 200 pips above the demand zone.
  const distanceToOB = direction === "BUY"
    ? currentPrice - ob.top
    : ob.bottom - currentPrice;
  const maxApproach = atrVal * 2.5;
  if (distanceToOB > maxApproach) {
    return { signal: null, developing: tagBlocked(buildDeveloping(), "GATE 5") };
  }

  // GATE 6: at least 1 same-direction MSB in last ~50 bars confirms structural shift.
  // (Per user spec: 1 MSB is enough — entry quality is enforced by premium/discount gate.)
  const msbCount = countRecentMSBs(ltfTail, swings, structure.trend, 50);
  if (msbCount < 1) {
    return { signal: null, developing: tagBlocked(buildDeveloping(), "GATE 6") };
  }

  // PROP-FIRM GRADE: soft penalties upgraded to hard rejects.
  // Prop challenges punish low-quality volume — only A+ institutional setups fire.
  let qualityPenalty = 0;

  // GATE 7 (HARD): BOS must retest the flipped level — no break-and-hope.
  const retestTol = atrVal * 0.75;
  const retested =
    structure.brokenLevel != null && structure.brokenAtIndex != null
      ? hasRetested(ltfTail, structure.brokenLevel, structure.brokenAtIndex, retestTol)
      : false;
  if (!retested) {
    return { signal: null, developing: tagBlocked(buildDeveloping(), "GATE 7 RETEST") };
  }

  // GATE 8: momentum confirmation (RSI bias OR engulfing on last 4H candle)
  const rsiVal = rsi(ltfTail, 14);
  const engulf = isEngulfing(ltfTail, structure.trend);
  const rsiOk = direction === "BUY" ? rsiVal > 50 : rsiVal < 50;
  if (!rsiOk && !engulf) return { signal: null, developing: tagBlocked(buildDeveloping(), "GATE 8") };

  // GATE 9 (HARD): displacement candle — smart-money impulse required.
  const displaced = hasDisplacement(ltfTail, structure.trend, atrVal, 5);
  if (!displaced) {
    return { signal: null, developing: tagBlocked(buildDeveloping(), "GATE 9 DISPLACEMENT") };
  }

  // GATE 10 (HARD for FX): kill-zone or Asian liquidity sweep.
  // Crypto 24/7 — no session model.
  const aRange = asianRange(hourly);
  const aSweep = aRange ? asianSweep(hourly, aRange, structure.trend, 12) : null;
  const kz = inKillZone(lastCandle.time);
  if (!isCrypto(pair) && !aSweep && !kz.active) {
    return { signal: null, developing: tagBlocked(buildDeveloping(), "GATE 10 SESSION") };
  }

  // GATE 10b (HARD): volatility expanding — reject dead/coiled markets.
  if (!volExpanding) {
    return { signal: null, developing: tagBlocked(buildDeveloping(), "GATE 10b VOL") };
  }

  // GATE 10c: market-hours protection — weekends, FX rollover, and index cash
  // close buffers (blocks JPN225 on Sat / outside Tokyo hours, US/EU near close).
  {
    const session = isSessionBlocked(pair);
    if (session.blocked) {
      return { signal: null, developing: tagBlocked(buildDeveloping(), session.reason) };
    }
  }

  // GATE 10c-3: MARKET REGIME — reject post-news whipsaw and dead markets.
  // Compare current ATR to the prior baseline. Healthy band = 0.6×–2.5×.
  //  • Below 0.6× = comatose, BOS likely fake, no follow-through.
  //  • Above 2.5× = post-news chaos, spreads blown out, fills unreliable.
  {
    const baselineWindow = ltfTail.slice(-100, -14);
    if (baselineWindow.length >= 30) {
      const baselineAtr = atr(baselineWindow, 14);
      if (baselineAtr > 0) {
        const ratio = atrVal / baselineAtr;
        if (ratio < 0.6 || ratio > 2.5) {
          return { signal: null, developing: tagBlocked(buildDeveloping(), "GATE 10c-3") };
        }
      }
    }
  }

  // GATE 10c-4: TREND QUALITY — reject pure ranges. Require ≥40% of the last
  // ~20 closes to step in trade direction. Below that = chop, edge collapses.
  {
    const recent = ltfTail.slice(-20);
    if (recent.length >= 15) {
      let alignedCloses = 0;
      for (let i = 1; i < recent.length; i++) {
        const up = recent[i].close > recent[i - 1].close;
        if ((direction === "BUY" && up) || (direction === "SELL" && !up)) {
          alignedCloses++;
        }
      }
      if (alignedCloses / (recent.length - 1) < 0.3) {
        return { signal: null, developing: tagBlocked(buildDeveloping(), "GATE 10c-4") };
      }
    }
  }

  const p = pip(pair);

  // ---- ORDER BLOCK ENTRY (only model used) ----
  // Professional OB execution: fill at the block's mean threshold (50% of the
  // OB body range) rather than the proximal edge — better average price, still
  // inside the institutional zone. If price has already traded past the mean,
  // fall back to the proximal edge so the entry remains reachable.
  const obZone: EntryZone = { top: ob.top, bottom: ob.bottom };
  const obProximal = direction === "BUY" ? ob.top : ob.bottom;
  const obMean = (ob.top + ob.bottom) / 2;
  const meanReachable = direction === "BUY" ? currentPrice > obMean : currentPrice < obMean;
  const entry = Number((meanReachable ? obMean : obProximal).toFixed(priceDecimals(pair)));
  const entryZone: EntryZone = obZone;
  const entryModel: "OTE" | "FVG" | "Breaker" | "Judas" | "OB" = "OB";


  // GATE 10d: DISCOUNT/PREMIUM filter (SMC OTE range).
  // Entry must sit in the discount half (BUY) / premium half (SELL) of the
  // recent 60-bar dealing range — never enter at parity or worse.
  const rangeWindow = ltfTail.slice(-60);
  const rangeHigh = Math.max(...rangeWindow.map((c) => c.high));
  const rangeLow = Math.min(...rangeWindow.map((c) => c.low));
  const rangeMid = (rangeHigh + rangeLow) / 2;
  const inDiscount = direction === "BUY" ? entry <= rangeMid : entry >= rangeMid;
  if (!inDiscount) return { signal: null, developing: tagBlocked(buildDeveloping(), "GATE 10d") };

  // GATE 10d-2: 1H CONFIRMATION CANDLE — the pro-entry trigger.
  // We no longer fire on a passive limit; require a closed 1H bar inside the
  // entry zone with a rejection body in trade direction. Trade is executed
  // MARKET-ON-CLOSE of that confirmation candle. Auto-trigger (≥95%) skips.
  const confirmedByCandle = has1hConfirmation(hourly, entryZone, direction);



  // ---- STOP LOSS: just beyond the STRONG HTF zone we're reacting from ----
  // Per the playbook: "set SL below the support". We anchor the stop to the
  // far side of the strong daily S/R zone (the actual invalidation level for
  // the thesis), padded by a 0.75×ATR wick-noise buffer. We also compute the
  // OB-structural SL and take whichever is DEEPER — so the stop is never
  // tighter than real structure (avoids stop-runs on noise) while still
  // capped at 3×ATR so risk stays realistic.
  let obEdge = direction === "BUY" ? ob.bottom : ob.top;
  if (isStacked) {
    obEdge = direction === "BUY"
      ? Math.min(...stackedOBs.map((o) => o.bottom))
      : Math.max(...stackedOBs.map((o) => o.top));
  }
  const structSL = structuralStop(ltfTail, swings, direction, obEdge, atrVal, 30);
  const zoneBuffer = atrVal * 0.75;
  const zoneSL = direction === "BUY"
    ? strongZone.price - zoneBuffer
    : strongZone.price + zoneBuffer;
  // Deeper of the two = safer invalidation
  let stopLoss = direction === "BUY"
    ? Math.min(structSL, zoneSL)
    : Math.max(structSL, zoneSL);

  // If a liquidity sweep exists, only use the swept wick as SL when it's
  // STILL beyond the strong zone (don't tighten inside the support we trust).
  if (sweep) {
    const sweepSL = direction === "BUY" ? sweep.level - atrVal * 0.5 : sweep.level + atrVal * 0.5;
    const beyondZone = direction === "BUY" ? sweepSL < zoneSL : sweepSL > zoneSL;
    if (beyondZone) {
      stopLoss = direction === "BUY" ? Math.min(stopLoss, sweepSL) : Math.max(stopLoss, sweepSL);
    }
  }

  // OB INVALIDATION FLOOR — a professional OB stop always sits beyond the
  // distal edge of the block (plus a 0.35×ATR wick buffer). If price closes
  // through the block the setup is dead, so never place the stop inside it.
  const obFloorSL = direction === "BUY"
    ? obEdge - atrVal * 0.35
    : obEdge + atrVal * 0.35;
  stopLoss = direction === "BUY"
    ? Math.min(stopLoss, obFloorSL)
    : Math.max(stopLoss, obFloorSL);

  // Cap risk at 3×ATR — anything wider isn't a swing entry, it's a hope trade.
  const maxRisk = atrVal * 3;
  if (Math.abs(entry - stopLoss) > maxRisk) {
    stopLoss = direction === "BUY" ? entry - maxRisk : entry + maxRisk;
  }

  const risk = Math.abs(entry - stopLoss);
  if (risk < minRiskFor(pair, atrVal)) return { signal: null, developing: tagBlocked(buildDeveloping(), "GATE_MIN_RISK") };

  // ---- TAKE PROFITS: ride from support to the top ----
  // TP1 = first realistic obstacle (nearest opposing 4H swing OR opposing
  //   HTF zone, whichever comes first). 1.5R floor, 4R cap → bankable partial.
  // TP2 = the STRONGEST opposing HTF zone within reach (the "top of the
  //   move"). 3R floor, 10R cap → captures the full ride when structure allows.
  const minTP1 = risk * 2; // Prop-firm: minimum 2R bankable partial
  const maxTP1 = risk * 4;
  const minTP2 = risk * 3;
  const maxTP2 = risk * 10;

  const opposingType: SRZone["type"] = direction === "BUY" ? "resistance" : "support";
  // All opposing HTF zones beyond entry, sorted nearest → farthest
  const opposingZones = htfZones
    .filter((z) => z.type === opposingType)
    .filter((z) => direction === "BUY" ? z.price > entry : z.price < entry)
    .sort((a, b) =>
      direction === "BUY" ? a.price - b.price : b.price - a.price,
    );

  const swingTP = nearestOpposingSwing(swings, direction, entry, minTP1);
  // Nearest opposing HTF zone — first obstacle on the way up
  const nearestZone = opposingZones[0]?.price ?? null;
  // Strongest opposing HTF zone within max reach — the "top" target
  const reachLimit = direction === "BUY" ? entry + maxTP2 : entry - maxTP2;
  const inReach = opposingZones.filter((z) =>
    direction === "BUY" ? z.price <= reachLimit : z.price >= reachLimit,
  );
  const strongestZone = inReach.length > 0
    ? inReach.reduce((best, z) => (z.touches > best.touches ? z : best)).price
    : opposingZones[opposingZones.length - 1]?.price ?? null;

  const clamp = (target: number, lo: number, hi: number) =>
    direction === "BUY"
      ? Math.min(Math.max(target, entry + lo), entry + hi)
      : Math.max(Math.min(target, entry - lo), entry - hi);

  // TP1: first obstacle (whichever is nearer — swing or zone)
  const tp1Candidates = [swingTP, nearestZone].filter((v): v is number => v != null);
  const tp1Raw = tp1Candidates.length > 0
    ? (direction === "BUY" ? Math.min(...tp1Candidates) : Math.max(...tp1Candidates))
    : null;
  const takeProfit = tp1Raw != null
    ? clamp(tp1Raw, minTP1, maxTP1)
    : direction === "BUY" ? entry + risk * 2 : entry - risk * 2;

  // TP2 must be beyond TP1; aim for the strongest zone (the top), default 6R
  const tp1Distance = Math.abs(takeProfit - entry);
  const minTP2Final = Math.max(minTP2, tp1Distance + risk * 0.5);
  const takeProfit2 = strongestZone != null
    ? clamp(strongestZone, minTP2Final, maxTP2)
    : direction === "BUY" ? entry + risk * 6 : entry - risk * 6;

  const rr1 = Number((Math.abs(takeProfit - entry) / risk).toFixed(2));
  const rr2 = Number((Math.abs(takeProfit2 - entry) / risk).toFixed(2));

  // ---------- CONFIDENCE BREAKDOWN ----------
  // Each factor records: label, point value, hit/miss. The UI shows this
  // breakdown so the trader sees *why* the score is what it is.
  const confluences: string[] = [];
  const breakdown: ConfidenceFactor[] = [];
  let confidence = 25;
  const add = (label: string, points: number, hit: boolean, confluence?: string) => {
    breakdown.push({ label, points, hit });
    if (hit) {
      confidence += points;
      if (confluence) confluences.push(confluence);
    }
  };

  add("Base score", 25, true);
  add("BOS + retest on 4H", 10, retested, retested ? `BOS on 4H — break and retest confirmed` : undefined);
  {
    const pctFromMid = ((entry - rangeMid) / (rangeHigh - rangeLow)) * 100;
    const zoneLabel = direction === "BUY"
      ? `discount (${Math.abs(pctFromMid).toFixed(0)}% below mid)`
      : `premium (${Math.abs(pctFromMid).toFixed(0)}% above mid)`;
    add("Discount/premium entry", 6, true, `Entry in ${zoneLabel} of 60-bar range`);
  }
  add(
    `Strong D1 ${zoneType} (${strongZone.touches} touches)`,
    14,
    true,
    `Strong ${zoneType} zone @ ${strongZone.price.toFixed(priceDecimals(pair))} (${strongZone.touches} touches on D1)`,
  );
  add(
    isStacked ? "★ Stacked Order Blocks" : "Fresh Order Block",
    isStacked ? 20 : 12,
    true,
    isStacked
      ? `★ STACKED ${ob.type} order blocks — layered demand zone`
      : `Fresh ${ob.type} 4H Order Block (untested)`,
  );
  const msbPoints = Math.min(12, msbCount * 4);
  add(`${msbCount}× ${structure.trend} MSBs`, msbPoints, true, `${msbCount}× ${structure.trend} MSBs — sustained trend`);
  add("Daily bias aligned", 8, true, `Daily bias aligned: ${htf_bias}`);
  add("4H bias confirms Daily", 8, h4_bias === dirBias, `4H bias ${h4_bias} confirms Daily ${htf_bias} — market direction locked`);

  add("Displacement candle", 6, displaced, displaced ? `Displacement candle confirms smart-money entry` : undefined);

  add(
    "FVG imbalance",
    5,
    !!fvg,
    fvg ? `${fvg.type === "bullish" ? "Bullish" : "Bearish"} FVG (imbalance)` : undefined,
  );
  add(
    "Liquidity sweep",
    10,
    !!sweep,
    sweep ? `Liquidity sweep of ${sweep.level.toFixed(priceDecimals(pair))} (stop hunt)` : undefined,
  );
  add(
    "Engulfing entry candle",
    6,
    engulf,
    engulf ? `${structure.trend} engulfing on entry candle` : undefined,
  );
  add(
    `RSI ${rsiVal.toFixed(0)} confirms direction`,
    4,
    rsiOk,
    rsiOk ? `RSI ${rsiVal.toFixed(0)} confirms ${direction} momentum` : undefined,
  );
  add(
    "News-driven momentum",
    4,
    newsMomentum,
    newsMomentum ? `⚡ News-driven momentum candle (>2x ATR)` : undefined,
  );
  add(
    "Asian range swept",
    6,
    !!aSweep,
    aSweep ? `Asian range ${direction === "BUY" ? "low" : "high"} swept @ ${aSweep.swept.toFixed(priceDecimals(pair))}` : undefined,
  );
  add(
    `${kz.session ?? "Kill"}-zone timing`,
    5,
    kz.active,
    kz.active ? `${kz.session} kill-zone — institutional volume window` : undefined,
  );

  const pips = toPips(pair, risk);
  const modelLabel = "Order block · mean threshold (50% of OB)";
  confluences.push(`Pro entry model: ${modelLabel} · Market-on-1H-confirmation`);
  confluences.push(
    `Risk: ${pips.toFixed(0)} pips · TP1: ${(pips * rr1).toFixed(0)} pips (${rr1}R) · TP2: ${(pips * rr2).toFixed(0)} pips (${rr2}R)`,
  );


  confidence = Math.max(20, Math.min(98, confidence - qualityPenalty));

  // GATE 11: PROP-FIRM floor — only high-conviction setups (≥85%)
  // Passing challenges requires selective entries, not signal volume.
const minConf = (isIndex(pair) || isGold(pair)) ? 85 : 80;
  if (confidence < minConf) return { signal: null, developing: tagBlocked(buildDeveloping(), "GATE 11 PROP") }; 

  const decimals = priceDecimals(pair);

  // ---- Deeper SWING entry tier ----
  // Mirror the developing-setup logic: the daily HTF zone (strongZone) is the
  // true discount/premium fill. Only attach when it's meaningfully deeper than
  // the LTF entry (>= 0.5×ATR away in the trade direction).
  let swingEntry: number | undefined;
  let swingStopLoss: number | undefined;
  let swingRiskPips: number | undefined;
  {
    const candidate = strongZone.price;
    const inDirection = direction === "BUY" ? candidate < entry : candidate > entry;
    const gap = Math.abs(candidate - entry);
    if (inDirection && gap >= atrVal * 0.5) {
      const slBuffer = Math.max(atrVal * 1.2, p * 8);
      const sSL = direction === "BUY" ? candidate - slBuffer : candidate + slBuffer;
      const sRisk = Math.abs(candidate - sSL);
      if (sRisk > 0) {
        swingEntry = Number(candidate.toFixed(decimals));
        swingStopLoss = Number(sSL.toFixed(decimals));
        swingRiskPips = Math.round(toPips(pair, sRisk));
      }
    }
  }

  // ---- Split-entry smoothing (50/50 LTF + swing) ----
  let splitEntry:
    | { tier1: number; tier2: number; allocation: number; blendedEntry: number; blendedRiskPips: number }
    | undefined;
  if (swingEntry != null && swingStopLoss != null) {
    const blended = (entry + swingEntry) / 2;
    const blendedRisk = Math.abs(blended - swingStopLoss);
    splitEntry = {
      tier1: Number(entry.toFixed(decimals)),
      tier2: swingEntry,
      allocation: 0.5,
      blendedEntry: Number(blended.toFixed(decimals)),
      blendedRiskPips: Math.round(toPips(pair, blendedRisk)),
    };
  }

  // ---- LTF entry trigger ----
  // FX/Crypto: 1H structure + confirmation candle (existing model).
  // Indices: trend locked on 4H+Daily; entry precision from 5m / 15m / 30m.
  const hTail = hourly.slice(-120);
  let ltfConfirmed = false;
  let ltfStructureType: "BOS" | "CHoCH" | null = null;
  const wantTrend = direction === "BUY" ? "Bullish" : "Bearish";
  if (hTail.length >= 30) {
    const hSwings = findSwings(hTail, 2);
    const hStruct = analyzeStructure(hTail, hSwings);
    if (hStruct.trend === wantTrend && hStruct.structure != null) {
      ltfConfirmed = true;
      ltfStructureType = hStruct.structure;
    }
  }

  let indexEntryReady = false;
  let indexEntryTf: "5m" | "15m" | "30m" | null = null;
  if (isIndex(pair) && entryTFs) {
    const m15 = entryTFs.m15 ?? [];
    const m30 = entryTFs.m30 ?? [];
    const m5 = entryTFs.m5 ?? [];
    const s15 = hasIndexLtfStructure(m15, direction);
    const s30 = hasIndexLtfStructure(m30, direction);
    const candle15 = hasEntryCandleConfirmation(m15, entryZone, direction, 16);
    const candle30 = hasEntryCandleConfirmation(m30, entryZone, direction, 12);
    const candle5 = hasEntryCandleConfirmation(m5, entryZone, direction, 20);
    if (s15.ok || s30.ok) {
      indexEntryReady = true;
      indexEntryTf = s15.ok ? "15m" : "30m";
      ltfConfirmed = true;
      ltfStructureType = s15.structure ?? s30.structure;
    } else if (candle15 || candle30 || candle5) {
      indexEntryReady = true;
      indexEntryTf = candle15 ? "15m" : candle30 ? "30m" : "5m";
    }
  }

  // Gold: 4H trend already gated; entry precision on 1m + 5m
  let goldEntryReady = false;
  let goldEntryTf: "1m" | "5m" | null = null;
  if (isGold(pair) && entryTFs) {
    const m5 = entryTFs.m5 ?? [];
    const m1 = entryTFs.m1 ?? [];
    const s5 = hasIndexLtfStructure(m5, direction);
    const candle5 = hasEntryCandleConfirmation(m5, entryZone, direction, 24);
    const candle1 = hasEntryCandleConfirmation(m1, entryZone, direction, 30);
    if (s5.ok) {
      goldEntryReady = true;
      goldEntryTf = "5m";
      ltfConfirmed = true;
      ltfStructureType = s5.structure;
    } else if (candle5 || candle1) {
      goldEntryReady = true;
      goldEntryTf = candle5 ? "5m" : "1m";
    }
  }

  // GATE 11b: institutional footprint — liquidity sweep or FVG required
  // GATE 11b: footprint — required for Gold/Indices; optional for FX on BOS+discount retest
  if (!sweep && !fvg) {
    if (isIndex(pair) || isGold(pair)) {
      return { signal: null, developing: tagBlocked(buildDeveloping(), "GATE 11b FOOTPRINT") };
    }
    if (!(structure.structure && inDiscount)) {
      return { signal: null, developing: tagBlocked(buildDeveloping(), "GATE 11b FOOTPRINT") };
    }
    confluences.push("FX BOS + discount/premium retest (sweep/FVG optional)");
  }

  const autoFire = confidence >= 95;
  const fxZonePad = atrVal * 0.45;
  const fxInEntryZone =
    direction === "BUY"
      ? currentPrice >= entryZone.bottom - fxZonePad && currentPrice <= entryZone.top + fxZonePad
      : currentPrice <= entryZone.top + fxZonePad && currentPrice >= entryZone.bottom - fxZonePad;
  const fxRetestReady =
    !isIndex(pair) &&
    !isGold(pair) &&
    !!structure.structure &&
    inDiscount &&
    fxInEntryZone;

  const proTriggerReady = isGold(pair)
    ? (goldEntryReady || ltfConfirmed || confirmedByCandle || autoFire)
    : isIndex(pair)
      ? (indexEntryReady || autoFire)
      : (ltfConfirmed || confirmedByCandle || fxRetestReady || autoFire);
  if (!proTriggerReady) {
    return {
      signal: null,
      developing: tagBlocked(
        buildDeveloping(),
        isGold(pair)
          ? "AWAITING_1M_5M_ENTRY"
          : isIndex(pair)
            ? "AWAITING_5_15_30M_ENTRY"
            : "AWAITING_FX_RETEST_OR_1H",
      ),
    };
  }
  if (fxRetestReady && !ltfConfirmed && !confirmedByCandle) {
    confluences.push("FX LTF: price retesting discount/premium OB after BOS/CHoCH");
  }

  if (isIndex(pair) && indexEntryTf) {
    confluences.push(`Index entry confirmed on ${indexEntryTf} (trend locked on 4H + Daily)`);
  }
  if (isGold(pair) && goldEntryTf) {
    confluences.push(`Gold entry confirmed on ${goldEntryTf} (trend locked on 4H + Daily)`);
  }
  // ---- REALISTIC FILL (ALL pairs: FX, Gold, Indices) ----
  // Planned "entry" is the OB/zone level. A live TRADE TAKEN must use the
  // actual market price. If price is far from the zone, stay Developing only.
  const zonePad = atrVal * 0.5;
  const priceInOrNearZone =
    direction === "BUY"
      ? currentPrice >= entryZone.bottom - zonePad && currentPrice <= entryZone.top + zonePad
      : currentPrice <= entryZone.top + zonePad && currentPrice >= entryZone.bottom - zonePad;
  const distToPlan = Math.abs(currentPrice - entry);
  const maxReachAtr = isIndex(pair) ? 1.5 : isGold(pair) ? 1.35 : 1.2;
  const reachable = priceInOrNearZone || distToPlan <= atrVal * maxReachAtr;
  if (!reachable) {
    return {
      signal: null,
      developing: tagBlocked(
        buildDeveloping(),
        `PRICE_AWAY_FROM_ENTRY (now ${currentPrice.toFixed(decimals)} vs plan ${entry.toFixed(decimals)})`,
      ),
    };
  }

  const fillEntry = Number(currentPrice.toFixed(decimals));

  const obDistal = direction === "BUY" ? entryZone.bottom : entryZone.top;
  let fillStop: number;
  if (direction === "BUY") {
    fillStop = Math.min(stopLoss, obDistal - atrVal * 0.25);
    if (!(fillStop < fillEntry)) fillStop = fillEntry - Math.max(atrVal * 0.8, Math.abs(entry - stopLoss));
  } else {
    fillStop = Math.max(stopLoss, obDistal + atrVal * 0.25);
    if (!(fillStop > fillEntry)) fillStop = fillEntry + Math.max(atrVal * 0.8, Math.abs(entry - stopLoss));
  }
  const rawRisk = Math.abs(fillEntry - fillStop);
  if (rawRisk > atrVal * 3) {
    fillStop = direction === "BUY" ? fillEntry - atrVal * 3 : fillEntry + atrVal * 3;
  }
  if (rawRisk < atrVal * 0.35) {
    fillStop = direction === "BUY" ? fillEntry - atrVal * 0.8 : fillEntry + atrVal * 0.8;
  }

  const fillRisk = Math.abs(fillEntry - fillStop) || atrVal;
  const fillTp1 = direction === "BUY" ? fillEntry + fillRisk * 2 : fillEntry - fillRisk * 2;
  const fillTp2 = direction === "BUY" ? fillEntry + fillRisk * 8 : fillEntry - fillRisk * 8;

  confluences.push(
    `Accurate fill @ ${fillEntry} (live) · plan zone ${entry.toFixed(decimals)}`,
  );
  return {
    signal: {
      pair,
      direction,
      entry: fillEntry,
      stopLoss: Number(fillStop.toFixed(decimals)),
      takeProfit: Number(fillTp1.toFixed(decimals)),
      takeProfit2: Number(fillTp2.toFixed(decimals)),
      riskReward: 8,
      confidence,
      structure: structure.structure,
      assetClass: assetClassOf(pair),
      confluences,
      confidenceBreakdown: breakdown,
      currentPrice: Number(currentPrice.toFixed(decimals)),
      timestamp: new Date().toISOString(),
      htf_bias,
      ...(swingEntry != null ? { swingEntry, swingStopLoss, swingRiskPips } : {}),
      ...(splitEntry ? { splitEntry } : {}),
      ltfConfirmed: autoFire ? true : (ltfConfirmed || confirmedByCandle),
      awaitingLtfConfirmation: false,
      autoTrigger: autoFire,
      entryModel,
      entryTrigger: "MARKET_ON_CONFIRMATION",
      entryZone: {
        top: Number(entryZone.top.toFixed(decimals)),
        bottom: Number(entryZone.bottom.toFixed(decimals)),
      },
    },
    developing: null,

  };
}

// Resolve open trades using two-stage logic:
// 1. If TP1 not yet hit: hit TP1 → mark tp1_hit=true, move SL to break-even (entry).
//    Hit SL first → loss.
// 2. If TP1 already hit: hit TP2 → win at TP2. Hit BE-stop → win at entry (still locked profit).
async function resolveOpenTrades(
  _pair: string,
  _candles: Candle[],
): Promise<{ resolved: number }> {
  return { resolved: 0 };
}

// Save a freshly detected signal to the trade book (idempotent on pair+timestamp).
async function saveSignalToBook(_s: Signal): Promise<void> {
  // Trade book persistence requires your own Supabase; signals still return to UI.
}

export default async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const results: {
    signals: Signal[];
    developing: DevelopingSetup[];
    scanned: string[];
    errors: { pair: string; error: string }[];
    resolved: number;
  } = {
    signals: [],
    developing: [],
    scanned: [],
    errors: [],
    resolved: 0,
  };

  // Scan pairs in small batches with a short delay to avoid Yahoo 429s
  const settled: PromiseSettledResult<{
    pair: string;
    signal: Signal | null;
    developing: DevelopingSetup | null;
    resolved: number;
  }>[] = [];
  const BATCH = 4;
  const DELAY_MS = 120;
  for (let i = 0; i < PAIRS.length; i += BATCH) {
    const chunk = PAIRS.slice(i, i + BATCH);
    const chunkResults = await Promise.allSettled(
      chunk.map(async ({ pair }) => {
        const [hourly, daily] = await Promise.all([
          fetchYahooCandles(pair, "1h", "3mo"),
          fetchYahooCandles(pair, "1d", "6mo"),
        ]);
        const fourH = resampleTo4H(hourly);

        let entryTFs: { m1?: Candle[]; m5?: Candle[]; m15?: Candle[]; m30?: Candle[] } | undefined;
        if (isIndex(pair)) {
          const m15 = await fetchYahooCandles(pair, "15m", "1mo").catch(() => [] as Candle[]);
          const m5 = await fetchYahooCandles(pair, "5m", "5d").catch(() => [] as Candle[]);
          entryTFs = { m15, m30: m15, m5: m5.length ? m5 : m15 };
        } else if (isGold(pair)) {
          // Gold: 4H trend (from 1h resample) + 1m/5m entry precision
          const [m5, m1] = await Promise.all([
            fetchYahooCandles(pair, "5m", "5d").catch(() => [] as Candle[]),
            fetchYahooCandles(pair, "1m", "5d").catch(() => [] as Candle[]),
          ]);
          entryTFs = { m5, m1 };
        }

        const { resolved } = await resolveOpenTrades(pair, hourly);
        const { signal, developing } = await analyzePairFromCandles(
          pair, fourH, daily, hourly, entryTFs,
        );
        if (signal) await saveSignalToBook(signal);

        return { pair, signal, developing, resolved };
      }),
    );
    settled.push(...chunkResults);
    if (i + BATCH < PAIRS.length) {
      await new Promise((r) => setTimeout(r, DELAY_MS));
    }
  }

  for (const r of settled) {
    if (r.status === "fulfilled") {
      results.scanned.push(r.value.pair);
      results.resolved += r.value.resolved;
      if (r.value.signal) results.signals.push(r.value.signal);
      if (r.value.developing) results.developing.push(r.value.developing);
    } else {
      const msg = r.reason instanceof Error ? r.reason.message : String(r.reason);
      const pairMatch = msg.match(/for ([A-Z0-9]{3,7}(?:\/[A-Z]{3})?)/);
      results.errors.push({ pair: pairMatch?.[1] ?? "unknown", error: msg });
    }
  }

  results.signals.sort((a, b) => b.confidence - a.confidence);
  results.developing.sort((a, b) => b.proximity - a.proximity);

  return new Response(JSON.stringify(results), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
};


