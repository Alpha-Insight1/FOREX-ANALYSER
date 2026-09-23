import { useEffect, useState, useMemo } from "react";
import { supabase, supabaseConfigured } from "@/integrations/supabase/client";
import {
  ArrowDown,
  ArrowUp,
  BookOpen,
  CheckCircle2,
  XCircle,
  Clock,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { Signal } from "@/components/SignalCard";
import {
  getJournal,
  upsertOpenFromSignal,
  markToMarketJournal,
  applyProtection,
  setTakeProfitR,
  riskUnit,
  floatingR,
  type JournalTrade,
  type ProtectionMode,
} from "@/lib/tradeJournal";
import { isSessionBlocked } from "@/lib/marketSession";

interface Trade {
  id: string;
  pair: string;
  direction: "BUY" | "SELL";
  entry: number;
  stop_loss: number;
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

interface TradeBookProps {
  priceMap?: Record<string, number>;
  signals?: Signal[];
}

const RECENT_CLOSED = 5;

export const TradeBook = ({ priceMap = {}, signals = [] }: TradeBookProps) => {
  const [openTrades, setOpenTrades] = useState<Trade[]>([]);
  const [closedTrades, setClosedTrades] = useState<Trade[]>([]);
  const [allClosed, setAllClosed] = useState<Trade[]>([]);
  const [loading, setLoading] = useState(true);
  const [source, setSource] = useState<"db" | "local">("local");

  const applyJournal = (journal: JournalTrade[]) => {
    const open = journal
      .filter((t) => t.status === "open")
      .sort((a, b) => +new Date(b.opened_at) - +new Date(a.opened_at));
    const closed = journal
      .filter((t) => t.status !== "open")
      .sort(
        (a, b) =>
          +new Date(b.closed_at || b.opened_at) - +new Date(a.closed_at || a.opened_at),
      );
    setOpenTrades(open as Trade[]);
    setAllClosed(closed as Trade[]);
    setClosedTrades(closed.slice(0, RECENT_CLOSED) as Trade[]);
  };

  useEffect(() => {
    if (supabaseConfigured) return;
    for (const s of signals) {
      if (isSessionBlocked(s.pair).blocked) continue;
      upsertOpenFromSignal({
        pair: s.pair,
        direction: s.direction,
        entry: s.entry,
        stopLoss: s.stopLoss,
        takeProfit: s.takeProfit,
        takeProfit2: s.takeProfit2,
        riskReward: s.riskReward,
        confidence: s.confidence,
        structure: s.structure,
        timestamp: s.timestamp,
      });
    }
    applyJournal(markToMarketJournal(priceMap));
    setLoading(false);
    setSource("local");
  }, [signals, priceMap]);

  useEffect(() => {
    if (!supabaseConfigured) {
      applyJournal(getJournal());
      setLoading(false);
      return;
    }

    const load = async () => {
      setLoading(true);
      const { data } = await supabase
        .from("trades")
        .select("*")
        .order("opened_at", { ascending: false })
        .limit(100);
      if (data) {
        const open = data.filter((t: Trade) => t.status === "open");
        const closed = data.filter((t: Trade) => t.status !== "open");
        setOpenTrades(open);
        setAllClosed(closed);
        setClosedTrades(closed.slice(0, RECENT_CLOSED));
        setSource("db");
      }
      setLoading(false);
    };
    void load();
  }, []);

  useEffect(() => {
    if (supabaseConfigured) return;
    setOpenTrades((prev) => {
      const stillOpen: Trade[] = [];
      const newlyClosed: Trade[] = [];
      for (const t of prev) {
        const px = priceMap[t.pair];
        if (px == null) {
          stillOpen.push(t);
          continue;
        }
        const isBuy = t.direction === "BUY";
        const hitSL = isBuy ? px <= t.stop_loss : px >= t.stop_loss;
        const hitTP = isBuy ? px >= t.take_profit : px <= t.take_profit;
        if (hitSL) {
          newlyClosed.push({
            ...t,
            status: "loss",
            close_price: t.stop_loss,
            closed_at: new Date().toISOString(),
          });
        } else if (hitTP) {
          newlyClosed.push({
            ...t,
            status: "win",
            close_price: t.take_profit,
            closed_at: new Date().toISOString(),
          });
        } else {
          stillOpen.push(t);
        }
      }
      if (newlyClosed.length) {
        setClosedTrades((c) => [...newlyClosed, ...c].slice(0, RECENT_CLOSED));
        setAllClosed((c) => [...newlyClosed, ...c]);
      }
      return stillOpen;
    });
  }, [priceMap, supabaseConfigured]);

  const stats = useMemo(() => {
    const wins = allClosed.filter((t) => t.status === "win").length;
    const losses = allClosed.filter((t) => t.status === "loss").length;
    const total = wins + losses;
    const winRate = total ? Math.round((wins / total) * 100) : 0;
    let totalR = 0;
    for (const t of allClosed) {
      if (t.close_price == null) continue;
      const risk = Math.abs(t.entry - t.stop_loss) || 1;
      const pnl = t.direction === "BUY" ? t.close_price - t.entry : t.entry - t.close_price;
      totalR += pnl / risk;
    }
    let openPnl = 0;
    for (const t of openTrades) {
      const px = priceMap[t.pair];
      if (px == null) continue;
      const risk = Math.abs(t.entry - t.stop_loss) || 1;
      const pnl = t.direction === "BUY" ? px - t.entry : t.entry - px;
      openPnl += pnl / risk;
    }
    return { wins, losses, winRate, totalR, openPnl, open: openTrades.length };
  }, [allClosed, openTrades, priceMap]);

  return (
    <div>
      <div className="mb-4 flex items-baseline justify-between gap-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold tracking-tight">
          <BookOpen className="h-4 w-4 text-gold" />
          Trade book
        </h2>
        <span className="text-xs text-muted-foreground">
          {stats.open} open · {allClosed.length} closed
          {source === "local" && (
            <span className="ml-1.5 text-muted-foreground/70">(device journal)</span>
          )}
        </span>
      </div>

      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-5">
        <Stat label="Win rate" value={`${stats.winRate}%`} tone="gold" />
        <Stat label="Wins" value={String(stats.wins)} tone="bull" />
        <Stat label="Losses" value={String(stats.losses)} tone="bear" />
        <Stat
          label="Net R (closed)"
          value={`${stats.totalR >= 0 ? "+" : ""}${stats.totalR.toFixed(1)}R`}
          tone={stats.totalR >= 0 ? "bull" : "bear"}
        />
        <Stat
          label="Open P/L"
          value={`${stats.openPnl >= 0 ? "+" : ""}${stats.openPnl.toFixed(2)}R`}
          tone={stats.openPnl >= 0 ? "bull" : "bear"}
        />
      </div>

      {loading ? (
        <div className="rounded-xl border border-border/60 surface-1 p-8 text-center text-sm text-muted-foreground">
          Loading trades…
        </div>
      ) : (
        <div className="space-y-6">
          {/* Current open trades — full table */}
          <OpenTradesTable
            trades={openTrades}
            priceMap={priceMap}
            onChange={() => applyJournal(getJournal())}
          />

          {/* Recent closed */}
          <TradeSection
            title="Recent closed"
            empty="No closed trades yet."
            trades={closedTrades}
            priceMap={priceMap}
            mode="closed"
          />
        </div>
      )}
    </div>
  );
};

/** Table of all currently open trades with live P/L and discretionary protection */
function OpenTradesTable({
  trades,
  priceMap,
  onChange,
}: {
  trades: Trade[];
  priceMap: Record<string, number>;
  onChange?: () => void;
}) {
  const protect = (
    id: string,
    mode: "breakeven" | "lock_1r" | "lock_2r",
    price?: number,
  ) => {
    applyProtection(id, mode, price);
    onChange?.();
  };
  const setRr = (id: string, rr: number) => {
    setTakeProfitR(id, rr);
    onChange?.();
  };

  return (
    <div className="overflow-hidden rounded-xl border border-border/60 surface-1">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/50 surface-2 px-4 py-2.5">
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Live open trades
        </h3>
        <span className="font-mono text-[10px] text-muted-foreground">
          {trades.length} open · protect at 2R · target 5–10R
        </span>
      </div>

      {trades.length === 0 ? (
        <div className="p-8 text-center text-xs text-muted-foreground">
          No open trades. When a signal is taken, it appears here with live floating P/L.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[880px] text-left text-xs">
            <thead>
              <tr className="border-b border-border/40 text-[10px] uppercase tracking-wider text-muted-foreground">
                <th className="px-3 py-2.5 font-semibold">Pair</th>
                <th className="px-3 py-2.5 font-semibold">Side</th>
                <th className="px-3 py-2.5 font-semibold">Entry</th>
                <th className="px-3 py-2.5 font-semibold">Current</th>
                <th className="px-3 py-2.5 font-semibold">Float P/L</th>
                <th className="px-3 py-2.5 font-semibold">Float (R)</th>
                <th className="px-3 py-2.5 font-semibold">SL</th>
                <th className="px-3 py-2.5 font-semibold">TP</th>
                <th className="px-3 py-2.5 font-semibold">Protect</th>
                <th className="px-3 py-2.5 font-semibold">Triggered</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/30">
              {trades.map((t) => {
                const isBuy = t.direction === "BUY";
                const px = priceMap[t.pair];
                const r0 = riskUnit(t as JournalTrade);
                const pnlR = floatingR(t as JournalTrade, px);
                const rawPnl =
                  px != null ? (isBuy ? px - t.entry : t.entry - px) : null;
                const positive = (pnlR ?? 0) >= 0;
                const canProtect = (pnlR ?? 0) >= 2; // Break-even / locks only from +2R
                const prot = t.protection || "none";

                return (
                  <tr key={t.id} className="hover:bg-surface-2/50 align-top">
                    <td className="px-3 py-3">
                      <span className="font-semibold text-foreground">{t.pair}</span>
                      {prot !== "none" && (
                        <div className="mt-0.5 text-[9px] font-medium text-gold">
                          {prot === "breakeven"
                            ? "BE locked"
                            : prot === "lock_1r"
                              ? "+1R locked"
                              : "+2R locked"}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-3">
                      <span
                        className={cn(
                          "inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] font-bold",
                          isBuy
                            ? "bg-bull/15 text-bull"
                            : "bg-bear/15 text-bear",
                        )}
                      >
                        {isBuy ? (
                          <ArrowUp className="h-3 w-3" />
                        ) : (
                          <ArrowDown className="h-3 w-3" />
                        )}
                        {t.direction}
                      </span>
                    </td>
                    <td className="px-3 py-3 font-mono tabular-nums">{fmt(t.entry)}</td>
                    <td className="px-3 py-3 font-mono tabular-nums text-foreground">
                      {px != null ? fmt(px) : "—"}
                    </td>
                    <td
                      className={cn(
                        "px-3 py-3 font-mono tabular-nums",
                        rawPnl == null
                          ? "text-muted-foreground"
                          : positive
                            ? "text-bull"
                            : "text-bear",
                      )}
                    >
                      {rawPnl == null
                        ? "—"
                        : `${rawPnl >= 0 ? "+" : ""}${fmtPnl(rawPnl, t.pair)}`}
                    </td>
                    <td
                      className={cn(
                        "px-3 py-3 font-mono font-semibold tabular-nums",
                        pnlR == null
                          ? "text-muted-foreground"
                          : positive
                            ? "text-bull"
                            : "text-bear",
                      )}
                    >
                      {pnlR == null
                        ? "—"
                        : `${pnlR >= 0 ? "+" : ""}${pnlR.toFixed(2)}R`}
                    </td>
                    <td className="px-3 py-3 font-mono tabular-nums text-muted-foreground">
                      {fmt(t.stop_loss)}
                    </td>
                    <td className="px-3 py-3 font-mono tabular-nums text-muted-foreground">
                      <div>{fmt(t.take_profit)}</div>
                      <div className="text-[9px] text-muted-foreground/80">
                        ~{(Math.abs(t.take_profit - t.entry) / r0).toFixed(1)}R
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex min-w-[140px] flex-col gap-1">
                        {canProtect ? (
                          <div className="flex flex-wrap gap-1">
                            <button
                              type="button"
                              onClick={() => protect(t.id, "breakeven", px)}
                              className="rounded border border-border/70 bg-surface-2 px-1.5 py-0.5 text-[9px] font-semibold hover:border-gold/50 hover:text-gold"
                              title="Move SL to entry — position stays open"
                            >
                              BE
                            </button>
                            <button
                              type="button"
                              onClick={() => protect(t.id, "lock_1r", px)}
                              className="rounded border border-border/70 bg-surface-2 px-1.5 py-0.5 text-[9px] font-semibold hover:border-gold/50 hover:text-gold"
                              title="Lock +1R — position stays open"
                            >
                              +1R
                            </button>
                            <button
                              type="button"
                              onClick={() => protect(t.id, "lock_2r", px)}
                              className="rounded border border-border/70 bg-surface-2 px-1.5 py-0.5 text-[9px] font-semibold hover:border-gold/50 hover:text-gold"
                              title="Lock +2R — position stays open"
                            >
                              +2R
                            </button>
                          </div>
                        ) : (
                          <span className="text-[9px] text-muted-foreground">
                            BE unlocks at +2R
                          </span>
                        )}
                        <div className="flex flex-wrap gap-1">
                          {[5, 8, 10].map((rr) => (
                            <button
                              key={rr}
                              type="button"
                              onClick={() => setRr(t.id, rr)}
                              className="rounded border border-border/50 px-1.5 py-0.5 text-[9px] text-muted-foreground hover:border-bull/40 hover:text-bull"
                              title={`Set take-profit to ${rr}R (position stays open)`}
                            >
                              TP {rr}R
                            </button>
                          ))}
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex flex-col gap-0.5">
                        <span className="inline-flex items-center gap-1 text-[10px] font-medium text-gold">
                          <Clock className="h-3 w-3" />
                          Open
                        </span>
                        <span className="font-mono text-[10px] text-muted-foreground">
                          {formatTimeFull(t.opened_at)}
                        </span>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function TradeSection({
  title,
  empty,
  trades,
  priceMap,
  mode,
}: {
  title: string;
  empty: string;
  trades: Trade[];
  priceMap: Record<string, number>;
  mode: "open" | "closed";
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-border/60 surface-1">
      <div className="flex items-center justify-between border-b border-border/50 surface-2 px-4 py-2.5">
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          {title}
        </h3>
        <span className="font-mono text-[10px] text-muted-foreground">
          {trades.length}/{RECENT_CLOSED}
        </span>
      </div>
      {trades.length === 0 ? (
        <div className="p-8 text-center text-xs text-muted-foreground">{empty}</div>
      ) : (
        <ul className="divide-y divide-border/40">
          {trades.map((t) => (
            <TradeRow key={t.id} trade={t} priceMap={priceMap} mode={mode} />
          ))}
        </ul>
      )}
    </div>
  );
}

function TradeRow({
  trade: t,
  priceMap,
  mode,
}: {
  trade: Trade;
  priceMap: Record<string, number>;
  mode: "open" | "closed";
}) {
  const isBuy = t.direction === "BUY";
  const px = priceMap[t.pair];
  const risk = Math.abs(t.entry - t.stop_loss) || 1;
  let pnlR: number | null = null;
  if (mode === "open" && px != null) {
    pnlR = (isBuy ? px - t.entry : t.entry - px) / risk;
  } else if (mode === "closed" && t.close_price != null) {
    pnlR = (isBuy ? t.close_price - t.entry : t.entry - t.close_price) / risk;
  }

  return (
    <li className="flex flex-col gap-1.5 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 items-center gap-2.5">
        <div
          className={cn(
            "flex h-7 w-7 shrink-0 items-center justify-center rounded-md",
            isBuy ? "bg-bull/15 text-bull" : "bg-bear/15 text-bear",
          )}
        >
          {isBuy ? <ArrowUp className="h-3.5 w-3.5" /> : <ArrowDown className="h-3.5 w-3.5" />}
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold">{t.pair}</span>
            <span
              className={cn(
                "rounded px-1.5 py-0.5 text-[9px] font-bold uppercase",
                isBuy ? "bg-bull/15 text-bull" : "bg-bear/15 text-bear",
              )}
            >
              {t.direction}
            </span>
            <StatusBadge status={t.status} />
          </div>
          <p className="mt-0.5 font-mono text-[10px] tabular-nums text-muted-foreground">
            Entry {fmt(t.entry)} · SL {fmt(t.stop_loss)} · TP {fmt(t.take_profit)}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-3 self-end sm:self-auto">
        {pnlR != null && (
          <span
            className={cn(
              "font-mono text-xs font-semibold tabular-nums",
              pnlR >= 0 ? "text-bull" : "text-bear",
            )}
          >
            {pnlR >= 0 ? "+" : ""}
            {pnlR.toFixed(2)}R
          </span>
        )}
        <span className="font-mono text-[10px] text-muted-foreground">
          {formatTimeFull(mode === "closed" ? t.closed_at || t.opened_at : t.opened_at)}
        </span>
      </div>
    </li>
  );
}

function StatusBadge({ status }: { status: Trade["status"] }) {
  if (status === "open") {
    return (
      <span className="inline-flex items-center gap-1 rounded-md bg-gold/15 px-1.5 py-0.5 text-[9px] font-bold uppercase text-gold">
        <Clock className="h-2.5 w-2.5" /> Open
      </span>
    );
  }
  if (status === "win") {
    return (
      <span className="inline-flex items-center gap-1 rounded-md bg-bull/15 px-1.5 py-0.5 text-[9px] font-bold uppercase text-bull">
        <CheckCircle2 className="h-2.5 w-2.5" /> Win
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-md bg-bear/15 px-1.5 py-0.5 text-[9px] font-bold uppercase text-bear">
      <XCircle className="h-2.5 w-2.5" /> Loss
    </span>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "gold" | "bull" | "bear";
}) {
  const c =
    tone === "gold" ? "text-gold" : tone === "bull" ? "text-bull" : "text-bear";
  return (
    <div className="rounded-lg border border-border/50 surface-1 px-3 py-2.5">
      <p className="text-[9px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className={cn("mt-0.5 font-mono text-sm font-semibold tabular-nums", c)}>{value}</p>
    </div>
  );
}

function fmt(n: number) {
  if (!Number.isFinite(n)) return "—";
  if (n >= 1000) return n.toFixed(1);
  if (n >= 10) return n.toFixed(3);
  return n.toFixed(5);
}

/** Format raw price move for display */
function fmtPnl(n: number, pair: string) {
  const abs = Math.abs(n);
  // Indices / JPY-style larger numbers
  if (pair.includes("JPY") || abs >= 1) return n.toFixed(2);
  if (abs >= 0.01) return n.toFixed(4);
  return n.toFixed(5);
}

function formatTimeFull(iso: string) {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "—";
    // Nigeria WAT (UTC+1) — accurate trigger time on the trade book
    return d.toLocaleString("en-GB", {
      timeZone: "Africa/Lagos",
      weekday: "short",
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
      timeZoneName: "short",
    });
  } catch {
    return "—";
  }
}
