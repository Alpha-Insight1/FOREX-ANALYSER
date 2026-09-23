/** Local trade journal — used when Supabase DB is not configured. */

export type ProtectionMode = "none" | "breakeven" | "lock_1r" | "lock_2r";

export interface JournalTrade {
  id: string;
  pair: string;
  direction: "BUY" | "SELL";
  entry: number;
  stop_loss: number;
  /** Original signal SL (never moved by protection — used for R size) */
  original_stop_loss?: number;
  take_profit: number;
  take_profit_2?: number | null;
  risk_reward: number;
  confidence: number;
  structure: string;
  status: "open" | "win" | "loss";
  opened_at: string;
  closed_at: string | null;
  close_price: number | null;
  tp1_hit?: boolean;
  protection?: ProtectionMode;
}

const KEY = "jaggy_trade_journal_v1";
const MAX = 200;

function read(): JournalTrade[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function write(trades: JournalTrade[]) {
  localStorage.setItem(KEY, JSON.stringify(trades.slice(0, MAX)));
}

export function getJournal(): JournalTrade[] {
  return read();
}

/** 1R size from original stop (preferred) or current stop */
export function riskUnit(t: JournalTrade): number {
  const sl = t.original_stop_loss ?? t.stop_loss;
  return Math.abs(t.entry - sl) || 1e-9;
}

export function floatingR(t: JournalTrade, price: number | undefined): number | null {
  if (price == null) return null;
  const r = riskUnit(t);
  const raw = t.direction === "BUY" ? price - t.entry : t.entry - price;
  return raw / r;
}

export function upsertOpenFromSignal(s: {
  pair: string;
  direction: "BUY" | "SELL";
  entry: number;
  stopLoss: number;
  takeProfit: number;
  takeProfit2?: number;
  riskReward: number;
  confidence: number;
  structure: string;
  timestamp: string;
}): JournalTrade {
  const trades = read();
  // One live trade per pair — stable id so rescans do not thrash open/close
  const id =
    s.pair + "|" + s.direction + "|" + Number(s.entry).toPrecision(7);
  const existingOpen = trades.find(
    (t) => t.pair === s.pair && t.status === "open",
  );
  if (existingOpen) return existingOpen;
  const existingSame = trades.find((t) => t.id === id);
  if (existingSame) return existingSame;

  const withoutOpenPair = trades.map((t) =>
    t.pair === s.pair && t.status === "open"
      ? {
          ...t,
          status: "loss" as const,
          closed_at: new Date().toISOString(),
          close_price: t.entry,
        }
      : t,
  );

  const risk = Math.abs(s.entry - s.stopLoss) || 1;
  // Prefer runner TP in 5–10R band when signal TP2 is set; else scale TP1 toward 5R min
  let tp = s.takeProfit;
  let tp2 = s.takeProfit2 ?? null;
  if (tp2 == null) {
    const sign = s.direction === "BUY" ? 1 : -1;
    tp2 = s.entry + sign * risk * 8; // default runner ~8R
  }

  const row: JournalTrade = {
    id,
    pair: s.pair,
    direction: s.direction,
    entry: s.entry,
    stop_loss: s.stopLoss,
    original_stop_loss: s.stopLoss,
    take_profit: tp,
    take_profit_2: tp2,
    risk_reward: s.riskReward,
    confidence: s.confidence,
    structure: s.structure,
    status: "open",
    // Wall-clock time when Jaggy took/recorded the trade (not candle open time)
    opened_at: new Date().toISOString(),
    closed_at: null,
    close_price: null,
    tp1_hit: false,
    protection: "none",
  };
  write([row, ...withoutOpenPair]);
  return row;
}

export function closeTrade(
  id: string,
  status: "win" | "loss",
  closePrice: number,
): JournalTrade | null {
  const trades = read();
  const idx = trades.findIndex((t) => t.id === id);
  if (idx < 0) return null;
  const updated: JournalTrade = {
    ...trades[idx],
    status,
    close_price: closePrice,
    closed_at: new Date().toISOString(),
  };
  trades[idx] = updated;
  write(trades);
  return updated;
}

/**
 * Move stop to protect profit. Does not close the trade.
 * - breakeven: SL → entry
 * - lock_1r: SL locks +1R
 * - lock_2r: SL locks +2R
 */
export function applyProtection(
  id: string,
  mode: Exclude<ProtectionMode, "none">,
  currentPrice?: number,
): JournalTrade | null {
  const trades = read();
  const idx = trades.findIndex((t) => t.id === id && t.status === "open");
  if (idx < 0) return null;
  const t = trades[idx];
  const r = riskUnit(t);
  // Break-even and locks only when trade has reached +2R
  if (currentPrice != null) {
    const pnlR = floatingR(t, currentPrice);
    if (pnlR == null || pnlR < 2) return null;
  }
  const isBuy = t.direction === "BUY";
  let newSl = t.entry;
  if (mode === "lock_1r") newSl = isBuy ? t.entry + r : t.entry - r;
  if (mode === "lock_2r") newSl = isBuy ? t.entry + 2 * r : t.entry - 2 * r;

  const updated: JournalTrade = {
    ...t,
    original_stop_loss: t.original_stop_loss ?? t.stop_loss,
    stop_loss: newSl,
    protection: mode,
  };
  trades[idx] = updated;
  write(trades);
  return updated;
}

/** Extend take-profit to a multiple of R (5–10 recommended). Keeps position open. */
export function setTakeProfitR(id: string, rr: number): JournalTrade | null {
  const trades = read();
  const idx = trades.findIndex((t) => t.id === id && t.status === "open");
  if (idx < 0) return null;
  const t = trades[idx];
  const r = riskUnit(t);
  const isBuy = t.direction === "BUY";
  const tp = isBuy ? t.entry + rr * r : t.entry - rr * r;
  const updated: JournalTrade = {
    ...t,
    take_profit: tp,
    take_profit_2: isBuy
      ? Math.max(t.take_profit_2 ?? tp, t.entry + Math.min(10, rr + 3) * r)
      : Math.min(t.take_profit_2 ?? tp, t.entry - Math.min(10, rr + 3) * r),
    risk_reward: rr,
  };
  trades[idx] = updated;
  write(trades);
  return updated;
}

export function markToMarketJournal(
  priceMap: Record<string, number>,
): JournalTrade[] {
  let trades = read();
  let changed = false;

  trades = trades.map((t) => {
    if (t.status !== "open") return t;
    const px = priceMap[t.pair];
    if (px == null) return t;
    const isBuy = t.direction === "BUY";
    const r = riskUnit(t);
    const raw = isBuy ? px - t.entry : t.entry - px;
    const pnlR = raw / r;

    // Auto break-even only once floating P/L reaches +2R (does not close the trade)
    if ((t.protection === "none" || !t.protection) && pnlR >= 2) {
      changed = true;
      t = {
        ...t,
        original_stop_loss: t.original_stop_loss ?? t.stop_loss,
        stop_loss: t.entry,
        protection: "breakeven" as const,
      };
    }

    const hitSL = isBuy ? px <= t.stop_loss : px >= t.stop_loss;
    const tp = t.take_profit;
    const hitTP = isBuy ? px >= tp : px <= tp;
    if (hitSL) {
      changed = true;
      return {
        ...t,
        status: "loss" as const,
        close_price: t.stop_loss,
        closed_at: new Date().toISOString(),
      };
    }
    if (hitTP) {
      changed = true;
      return {
        ...t,
        status: "win" as const,
        close_price: tp,
        closed_at: new Date().toISOString(),
      };
    }
    return t;
  });

  if (changed) write(trades);
  return trades;
}
