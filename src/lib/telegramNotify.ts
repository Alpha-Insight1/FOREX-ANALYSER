/** Fire-and-forget Telegram alert when a trade is taken. */

const SENT_KEY = "jaggy_tg_sent_v1";
const TTL_MS = 12 * 60 * 60 * 1000; // 12h — same setup won't re-alert

function alreadySent(key: string): boolean {
  try {
    const raw = localStorage.getItem(SENT_KEY);
    const map: Record<string, number> = raw ? JSON.parse(raw) : {};
    const now = Date.now();
    // prune old
    for (const k of Object.keys(map)) {
      if (now - map[k] > TTL_MS) delete map[k];
    }
    localStorage.setItem(SENT_KEY, JSON.stringify(map));
    return map[key] != null && now - map[key] < TTL_MS;
  } catch {
    return false;
  }
}

function markSent(key: string) {
  try {
    const raw = localStorage.getItem(SENT_KEY);
    const map: Record<string, number> = raw ? JSON.parse(raw) : {};
    map[key] = Date.now();
    const entries = Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, 200);
    localStorage.setItem(SENT_KEY, JSON.stringify(Object.fromEntries(entries)));
  } catch {
    /* ignore */
  }
}

function hasOpenTradeForPair(pair: string): boolean {
  try {
    const raw = localStorage.getItem("jaggy_trade_journal_v1");
    if (!raw) return false;
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return false;
    return arr.some(
      (t: { pair?: string; status?: string }) =>
        t.pair === pair && t.status === "open",
    );
  } catch {
    return false;
  }
}

export async function sendTelegramTradeAlert(opts: {
  pair: string;
  direction: string;
  confidence: number;
  entry: number;
  stopLoss: number;
  takeProfit: number;
}): Promise<void> {
  // No more alerts while this pair still has a live open trade
  if (hasOpenTradeForPair(opts.pair)) return;

  const key =
    opts.pair + "|" + opts.direction + "|" + Number(opts.entry).toPrecision(7);
  if (alreadySent(key)) return;
  markSent(key);

  try {
    await fetch("/api/telegram-notify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(opts),
    });
  } catch {
    // Never break the dashboard for notify failures
  }
}

export async function sendTelegramTestMessage(): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch("/api/telegram-notify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: "✅ Jaggy Analyser connected.\nYou will receive TRADE TAKEN alerts here.\n\n_Created by JAGGY_",
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { ok: false, error: data.error || data.detail || `HTTP ${res.status}` };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Network error" };
  }
}
