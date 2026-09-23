import { useEffect, useState, useCallback, useRef } from "react";
import { FOREX_ANALYSIS_URL, FOREX_ANALYSIS_FALLBACK_URL } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { SignalCard, type Signal } from "@/components/SignalCard";
import { DevelopingSetupCard, type DevelopingSetup } from "@/components/DevelopingSetupCard";
import { TradeBook } from "@/components/TradeBook";
import { EquityCurve } from "@/components/EquityCurve";
import { PerPairStats } from "@/components/PerPairStats";
import { Button } from "@/components/ui/button";
import {
  RefreshCw,
  Activity,
  AlertCircle,
  Radar,
  Zap,
  ArrowUp,
  ArrowDown,
  LogOut,
  LayoutDashboard,
  BookOpen,
  TrendingUp,
  Crosshair,
  ShieldCheck,
} from "lucide-react";
import { NotificationToggle, notifyNewSignal, NotificationHint } from "@/components/NotificationToggle";
import { filterTradeableSignals, isSessionBlocked } from "@/lib/marketSession";
import { assetClassOf, assetClassLabel, assetClassHint } from "@/lib/assetClass";
import { getJournal } from "@/lib/tradeJournal";
import { ThemePicker } from "@/components/ThemePicker";
import { cn } from "@/lib/utils";
import { BrandMark, CreatedByJaggy } from "@/components/BrandMark";
import { PropFirmRules } from "@/components/PropFirmRules";

interface AnalysisResponse {
  signals: Signal[];
  developing: DevelopingSetup[];
  scanned: string[];
  errors: { pair: string; error: string }[];
  resolved?: number;
}

const REFRESH_MS = 30 * 1000; // 30s — faster live alerts so entries are less stale
/** Prop-firm mode: only surface high-conviction setups (matches server GATE 11). */
const PROP_MIN_CONF = 85;

type Tab = "overview" | "signals" | "developing" | "book";

const Index = () => {
  const { session, signOut } = useAuth();
  const [data, setData] = useState<AnalysisResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [countdown, setCountdown] = useState(REFRESH_MS / 1000);
  const [tab, setTab] = useState<Tab>("overview");
  // Keep last known prices so open trades still show P/L after leaving Live signals
  const [priceMap, setPriceMap] = useState<Record<string, number>>({});
  const [journalSignals, setJournalSignals] = useState<Signal[]>([]);
  // Stable keys so the same setup is not re-alerted every refresh
  // (timestamp alone changes each scan and caused duplicate Telegram messages)
  
  const isFirstLoad = useRef(true);
const seenSignals = useRef<Set<string>>(
    (() => {
      try {
        const fromLocal = JSON.parse(localStorage.getItem("jaggy_seen_trades") ?? "[]");
        const fromSession = JSON.parse(sessionStorage.getItem("seenSignals") ?? "[]");
        return new Set([
          ...(Array.isArray(fromLocal) ? fromLocal : []),
          ...(Array.isArray(fromSession) ? fromSession : []),
        ]);
      } catch {
        return new Set();
      }
    })(),
  );
  const tradeKey = (s: Signal) =>
    `${s.pair}|${s.direction}|${Number(s.entry).toPrecision(7)}`;

  const fireAlert = useCallback((s: Signal) => {
    notifyNewSignal({
      pair: s.pair,
      direction: s.direction,
      confidence: s.confidence,
      entry: s.entry,
      stopLoss: s.stopLoss,
      takeProfit: s.takeProfit,
    });
  }, []);

  const fetchSignals = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Single accurate scanner (full 35-pair book: FX + indices + crypto).
      // Previously we waited on BOTH Netlify + Lovable in parallel — Netlify often
      // timed out / 429'd and made every refresh feel stuck for 15–30s.
      const controller = new AbortController();
      const timer = window.setTimeout(() => controller.abort(), 55_000);

      // Prefer Vercel /api/forex-analysis (prop-firm gates, Gold 1m/5m, JPN CFD hours).
      // Supabase function is legacy fallback only.
      let res: Response;
      try {
        res = await fetch(FOREX_ANALYSIS_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
          signal: controller.signal,
        });
        if (!res.ok) throw new Error(`primary ${res.status}`);
      } catch (e) {
        res = await fetch(FOREX_ANALYSIS_FALLBACK_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        });
      } finally {
        window.clearTimeout(timer);
      }

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`Scan failed (${res.status})${text ? `: ${text.slice(0, 120)}` : ""}`);
      }

      const result = (await res.json()) as AnalysisResponse;
      if (!result || !Array.isArray(result.signals)) {
        throw new Error("No data returned from scanner");
      }

      // Collect live prices from full scan (before we hide open pairs from Live signals)
      const prices: Record<string, number> = {};
      for (const s of result.signals ?? []) {
        if (s.currentPrice != null && Number.isFinite(s.currentPrice)) {
          prices[s.pair] = s.currentPrice;
        }
      }
      for (const d of result.developing ?? []) {
        if (d.currentPrice != null && Number.isFinite(d.currentPrice)) {
          prices[d.pair] = d.currentPrice;
        }
      }
      setPriceMap((prev) => ({ ...prev, ...prices }));

      // Drop signals outside safe session hours (weekends, near cash close, FX rollover)
      let tradeable = filterTradeableSignals(result.signals ?? []).filter(
        (s) => s.confidence >= PROP_MIN_CONF,
      );
      // Full session-valid list for trade book (before hiding open pairs from Live tab)
      setJournalSignals(tradeable);

      // Pairs that already have an open trade — no more live alerts until closed
      const openPairs = new Set(
        getJournal()
          .filter((j) => j.status === "open")
          .map((j) => j.pair),
      );

      for (const s of tradeable) {
        const key = tradeKey(s);
        if (openPairs.has(s.pair)) {
          // Already live in trade book — do not Telegram / toast again
          seenSignals.current.add(key);
          continue;
        }
        if (!seenSignals.current.has(key)) {
          if (!isFirstLoad.current) fireAlert(s);
          seenSignals.current.add(key);
        }
      }

      // Live signals tab: hide pairs that are already open (they belong in Trade book)
      tradeable = tradeable.filter((s) => !openPairs.has(s.pair));
      result.signals = tradeable;
      const keys = Array.from(seenSignals.current).slice(-300);
      sessionStorage.setItem("seenSignals", JSON.stringify(keys));
      try {
        localStorage.setItem("jaggy_seen_trades", JSON.stringify(keys));
      } catch {
        /* ignore quota */
      }
      isFirstLoad.current = false;

      setData(result);
      setLastUpdated(new Date());
      setCountdown(REFRESH_MS / 1000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load signals");
    } finally {
      setLoading(false);
    }
  }, [fireAlert]);

  useEffect(() => {
    fetchSignals();
    const interval = setInterval(fetchSignals, REFRESH_MS);
    return () => clearInterval(interval);
  }, [fetchSignals]);

  useEffect(() => {
    const t = setInterval(() => setCountdown((c) => Math.max(0, c - 1)), 1000);
    return () => clearInterval(t);
  }, []);

  const mins = Math.floor(countdown / 60);
  const secs = countdown % 60;
  const developing = data?.developing ?? [];
  const signals = data?.signals ?? [];
  const newsCount = developing.filter((d) => d.newsMomentum).length;
  const buyCount = signals.filter((s) => s.direction === "BUY").length;
  const sellCount = signals.filter((s) => s.direction === "SELL").length;
  const avgConf =
    signals.length > 0
      ? Math.round(signals.reduce((a, s) => a + s.confidence, 0) / signals.length)
      : 0;

  const nav = [
    { id: "overview" as const, label: "Overview", icon: LayoutDashboard },
    { id: "signals" as const, label: "Live signals", icon: Crosshair },
    { id: "developing" as const, label: "Developing", icon: Radar },
    { id: "book" as const, label: "Trade book", icon: BookOpen },
  ];

  return (
    <div className="relative min-h-screen flex bg-background">
      <div className="pointer-events-none absolute inset-0 ambient-bg" />

      {/* Sidebar */}
      <aside className="relative z-10 hidden w-60 shrink-0 flex-col border-r border-border/60 surface-1 lg:flex">
        <div className="flex items-center gap-3 border-b border-border/60 px-5 py-5">
          <BrandMark size="sm" showWordmark />
        </div>

        <nav className="flex flex-1 flex-col gap-1 p-3">
          {nav.map((item) => {
            const Icon = item.icon;
            const active = tab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setTab(item.id)}
                className={cn(
                  "flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-left text-sm transition-colors",
                  active
                    ? "bg-gold/15 text-gold font-medium"
                    : "text-muted-foreground hover:bg-surface-2 hover:text-foreground",
                )}
              >
                <Icon className="h-4 w-4 shrink-0" />
                {item.label}
                {item.id === "signals" && signals.length > 0 && (
                  <span className="ml-auto rounded-md bg-bull/20 px-1.5 py-0.5 text-[10px] font-mono text-bull">
                    {signals.length}
                  </span>
                )}
                {item.id === "developing" && developing.length > 0 && (
                  <span className="ml-auto rounded-md bg-gold/15 px-1.5 py-0.5 text-[10px] font-mono text-gold">
                    {developing.length}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        <div className="border-t border-border/60 p-4">
          <div className="mb-3 flex items-center gap-2 rounded-lg surface-2 px-3 py-2">
            <ShieldCheck className="h-3.5 w-3.5 text-bull" />
            <div className="min-w-0">
              <p className="truncate text-[11px] font-medium text-foreground">
                {session?.email || "Authenticated"}
              </p>
              <p className="text-[10px] text-muted-foreground">Secure session</p>
            </div>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start gap-2 text-muted-foreground hover:text-bear"
            onClick={signOut}
          >
            <LogOut className="h-3.5 w-3.5" />
            Sign out
          </Button>
        </div>
      </aside>

      {/* Main */}
      <div className="relative z-10 flex min-w-0 flex-1 flex-col">
        {/* Top bar */}
        <header className="sticky top-0 z-20 border-b border-border/60 surface-1/80 backdrop-blur-md">
          <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
            <div className="flex items-center gap-2.5 lg:hidden">
              <BrandMark size="sm" showWordmark />
            </div>

            <div className="hidden items-center gap-2 text-xs text-muted-foreground sm:flex">
              <span className="relative flex h-2 w-2">
                <span
                  className={cn(
                    "absolute inset-0 rounded-full",
                    loading ? "bg-gold animate-pulse" : "bg-bull pulse-dot",
                  )}
                />
              </span>
              <span className="font-mono tabular-nums">
                {loading
                  ? "Scanning markets…"
                  : `Next scan ${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`}
              </span>
              {lastUpdated && (
                <span className="text-muted-foreground/70">
                  · Updated {lastUpdated.toLocaleTimeString()}
                </span>
              )}
            </div>

            <div className="ml-auto flex items-center gap-2">
              <NotificationToggle />
              <ThemePicker />
              <Button size="sm" onClick={fetchSignals} disabled={loading} className="gap-2">
                <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
                <span className="hidden sm:inline">Refresh</span>
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="gap-1.5 text-muted-foreground lg:hidden"
                onClick={signOut}
              >
                <LogOut className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>

          {/* Mobile tabs */}
          <div className="flex gap-1 overflow-x-auto border-t border-border/40 px-2 py-2 lg:hidden">
            {nav.map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setTab(item.id)}
                  className={cn(
                    "flex shrink-0 items-center gap-1.5 rounded-md px-3 py-1.5 text-xs",
                    tab === item.id
                      ? "bg-gold/15 text-gold font-medium"
                      : "text-muted-foreground",
                  )}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {item.label}
                </button>
              );
            })}
          </div>
        </header>

        <main className="flex-1 overflow-y-auto px-4 py-6 sm:px-6 lg:px-8">
          <NotificationHint />
          {error && (
            <div className="mb-6 flex items-start gap-3 rounded-xl border border-bear/30 bg-bear/10 px-4 py-3 text-sm text-bear">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <div>
                <p className="font-medium">Scanner error</p>
                <p className="mt-0.5 text-xs opacity-90">{error}</p>
              </div>
            </div>
          )}

          {/* KPI strip — always visible on overview */}
          {(tab === "overview" || tab === "signals") && (
            <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
              <Kpi
                label="Live signals"
                value={String(signals.length)}
                hint="A-grade setups"
                icon={Crosshair}
                tone="gold"
              />
              <Kpi
                label="Developing"
                value={String(developing.length)}
                hint={newsCount ? `${newsCount} news-driven` : "Forming structure"}
                icon={Radar}
                tone="neutral"
              />
              <Kpi
                label="Bias split"
                value={`${buyCount}B / ${sellCount}S`}
                hint="Buy vs sell"
                icon={TrendingUp}
                tone="bull"
              />
              <Kpi
                label="Avg confidence"
                value={signals.length ? `${avgConf}%` : "—"}
                hint="Across live signals"
                icon={Zap}
                tone="gold"
              />
            </div>
          )}

          {tab === "overview" && (
            <div className="space-y-8">
              <PropFirmRules />
              <section>
                <SectionHead
                  title="Priority signals"
                  subtitle="Highest-confidence setups from the latest scan"
                />
                {loading && !data && <SkeletonGrid />}
                {data && signals.length === 0 && !loading && <EmptySignals scanned={data.scanned.length} />}
                {signals.length > 0 && (
                  <div className="space-y-6">
                    {groupSignalsByClass(signals.slice(0, 9)).map((group) => (
                      <div key={group.key}>
                        <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                          {group.label}
                          <span className="ml-2 font-normal normal-case text-muted-foreground/70">
                            {group.key === "gold"
                              ? "· 4H trend · 1m/5m entry"
                              : group.key === "index"
                                ? "· 4H+Daily trend · LTF entry"
                                : "· 4H trend · 1H confirm"}
                          </span>
                        </p>
                        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                          {group.items.map((s, i) => (
                            <SignalCard key={`${s.pair}-${s.timestamp}`} signal={s} index={i} />
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                {signals.length > 6 && (
                  <Button variant="outline" className="mt-4" onClick={() => setTab("signals")}>
                    View all {signals.length} signals
                  </Button>
                )}
              </section>

              <section>
                <SectionHead title="Near trigger" subtitle="Setups approaching full confluence" />
                {developing.length === 0 ? (
                  <QuietState />
                ) : (
                  <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                    {developing.slice(0, 6).map((d) => (
                      <DevelopingSetupCard key={d.pair} setup={d} />
                    ))}
                  </div>
                )}
              </section>

              <section className="grid gap-6 xl:grid-cols-2">
                <EquityCurve />
                <PerPairStats />
              </section>
            </div>
          )}

          {tab === "signals" && (
            <section>
              <SectionHead
                title="Live signals"
                subtitle={
                  data
                    ? `Scanned ${data.scanned.length} pairs · ${signals.length} A+ setups · separated by market`
                    : "Waiting for scan"
                }
              />
              {loading && !data && <SkeletonGrid />}
              {data && signals.length === 0 && !loading && <EmptySignals scanned={data.scanned.length} />}
              {signals.length > 0 && (
                <div className="space-y-8">
                  {groupSignalsByClass(signals).map((group) => (
                    <div key={group.key}>
                      <div className="mb-3 flex items-center gap-2">
                        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                          {group.label}
                        </h3>
                        <span className="rounded-md bg-secondary px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                          {group.items.length}
                        </span>
                        <span className="text-[10px] text-muted-foreground/80">
                          {assetClassHint(group.key)}
                        </span>
                      </div>
                      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                        {group.items.map((s, i) => (
                          <SignalCard key={`${s.pair}-${s.timestamp}`} signal={s} index={i} />
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {data && data.errors.length > 0 && (
                <details className="mt-6 rounded-lg border border-border/60 surface-1 p-4 text-xs">
                  <summary className="cursor-pointer text-muted-foreground">
                    {data.errors.length} pair(s) failed to load
                  </summary>
                  <ul className="mt-2 space-y-1 font-mono text-muted-foreground">
                    {data.errors.map((e, i) => (
                      <li key={i}>
                        {e.pair}: {e.error}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </section>
          )}

          {tab === "developing" && (
            <section>
              <SectionHead
                title="Developing setups"
                subtitle="Structure forming — not yet full A-grade"
              />
              {developing.length === 0 ? (
                <QuietState />
              ) : (
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {developing.map((d) => (
                    <DevelopingSetupCard key={d.pair} setup={d} />
                  ))}
                </div>
              )}
            </section>
          )}

          {tab === "book" && (
            <section className="space-y-8">
              <SectionHead title="Trade book" subtitle="Open positions and closed outcomes" />
              <TradeBook priceMap={priceMap} signals={journalSignals} />
              <div className="grid gap-6 xl:grid-cols-2">
                <EquityCurve />
                <PerPairStats />
              </div>
            </section>
          )}

          <footer className="mt-12 space-y-2 border-t border-border/60 pt-6 text-center text-[11px] text-muted-foreground">
            <CreatedByJaggy />
            <p>Educational analysis only. Not financial advice. Confirm every setup on your own charts.</p>
          </footer>
        </main>
      </div>
    </div>
  );
};

function Kpi({
  label,
  value,
  hint,
  icon: Icon,
  tone,
}: {
  label: string;
  value: string;
  hint: string;
  icon: React.ElementType;
  tone: "gold" | "bull" | "neutral";
}) {
  const toneCls =
    tone === "gold" ? "text-gold" : tone === "bull" ? "text-bull" : "text-muted-foreground";
  return (
    <div className="rounded-xl border border-border/60 surface-1 p-4 shadow-card">
      <div className="flex items-center justify-between">
        <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
          {label}
        </p>
        <Icon className={cn("h-3.5 w-3.5", toneCls)} />
      </div>
      <p className="mt-2 font-mono text-2xl font-semibold tabular-nums tracking-tight">{value}</p>
      <p className="mt-1 text-[11px] text-muted-foreground">{hint}</p>
    </div>
  );
}

function SectionHead({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="mb-4">
      <h2 className="text-sm font-semibold tracking-tight text-foreground">{title}</h2>
      <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p>
    </div>
  );
}

function EmptySignals({ scanned }: { scanned: number }) {
  return (
    <div className="rounded-xl border border-border/60 surface-1 p-12 text-center">
      <Activity className="mx-auto h-8 w-8 text-muted-foreground/50" />
      <p className="mt-3 font-medium">No high-probability setups right now</p>
      <p className="mt-1 text-sm text-muted-foreground">
        Scanned {scanned} pairs · waiting for clean BOS structure
      </p>
    </div>
  );
}

function QuietState() {
  return (
    <div className="rounded-xl border border-border/60 surface-1 p-10 text-center">
      <Radar className="mx-auto h-7 w-7 text-muted-foreground/50" />
      <p className="mt-3 text-sm text-muted-foreground">Market is quiet across watched pairs</p>
    </div>
  );
}

const SkeletonGrid = () => (
  <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
    {Array.from({ length: 3 }).map((_, i) => (
      <div
        key={i}
        className="h-64 animate-pulse rounded-xl border border-border/60 surface-1"
        style={{ animationDelay: `${i * 80}ms` }}
      />
    ))}
  </div>
);

function buildPriceMap(data: AnalysisResponse | null): Record<string, number> {
  const map: Record<string, number> = {};
  if (!data) return map;
  for (const s of data.signals) map[s.pair] = s.currentPrice;
  for (const d of data.developing) map[d.pair] = d.currentPrice;
  return map;
}


function groupSignalsByClass(signals: Signal[]) {
  const groups: { key: "forex" | "gold" | "index" | "crypto"; label: string; items: Signal[] }[] = [
    { key: "forex", label: "Forex", items: [] },
    { key: "gold", label: "Gold", items: [] },
    { key: "index", label: "Indices", items: [] },
    { key: "crypto", label: "Crypto", items: [] },
  ];
  for (const s of signals) {
    const cls = s.assetClass ?? assetClassOf(s.pair);
    const g = groups.find((x) => x.key === cls) ?? groups[0];
    g.items.push(s);
  }
  return groups.filter((g) => g.items.length > 0);
}



export default Index;
