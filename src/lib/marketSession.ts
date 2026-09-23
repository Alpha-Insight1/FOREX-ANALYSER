/** Client-side session guards — block new entries when spreads / hours are unsafe. */

function isIndex(pair: string): boolean {
  return (
    pair === "GER40" ||
    pair === "US30" ||
    pair === "NAS100" ||
    pair === "SPX500" ||
    pair === "UK100" ||
    pair === "JPN225"
  );
}

function isCrypto(pair: string): boolean {
  return pair.startsWith("BTC") || pair.startsWith("ETH");
}
function isGold(pair: string): boolean {
  return pair === "XAUUSD" || pair === "GOLD" || pair === "XAU/USD";
}

/** Classify pair for UI separation: Forex | Gold | Indices | Crypto */
export function assetClassOf(pair: string): "forex" | "gold" | "index" | "crypto" {
  if (isGold(pair)) return "gold";
  if (isIndex(pair)) return "index";
  if (isCrypto(pair)) return "crypto";
  return "forex";
}

export function assetClassLabel(cls: "forex" | "gold" | "index" | "crypto"): string {
  if (cls === "gold") return "Gold";
  if (cls === "index") return "Indices";
  if (cls === "crypto") return "Crypto";
  return "Forex";
}

export function displayPair(pair: string): string {
  if (pair === "XAUUSD" || pair === "GOLD") return "XAU/USD";
  return pair;
}

/**
 * JPN225 on most CFD brokers trades ~Sun 22:00–Fri 20:00 UTC.
 * Cash Tokyo is only ~00:00–06:00 UTC — that was blocking the index most of the day
 * and made it look "stopped for months".
 */
export function isSessionBlocked(
  pair: string,
  now = new Date(),
): { blocked: boolean; reason: string } {
  if (isCrypto(pair)) return { blocked: false, reason: "" };

  const dow = now.getUTCDay(); // 0=Sun … 6=Sat
  const h = now.getUTCHours();
  const m = now.getUTCMinutes();
  const mins = h * 60 + m;

  // Weekend / gap risk for FX + indices
  const weekend =
    dow === 6 || (dow === 5 && h >= 19) || (dow === 0 && h < 22);
  if (weekend) {
    return { blocked: true, reason: "Weekend / market close — spreads unsafe" };
  }

  // FX bank rollover — spreads spike (not gold / indices)
  if (!isIndex(pair) && !isGold(pair) && !isCrypto(pair) && h >= 20 && h < 22) {
    return { blocked: true, reason: "FX daily rollover — spreads widened" };
  }

  if (pair === "JPN225") {
    // CFD hours: allow whenever market is open (not weekend).
    // Extra buffer Friday after 18:00 UTC before weekend gap.
    if (dow === 5 && h >= 18) {
      return { blocked: true, reason: "JPN225 Friday late — weekend gap risk" };
    }
    return { blocked: false, reason: "" };
  }

  if (pair === "UK100") {
    // London cash ~08:00–16:30 UTC + small buffers
    const open = 8 * 60 + 15;
    const closeBuf = 16 * 60 + 15;
    if (mins < open || mins >= closeBuf) {
      return { blocked: true, reason: "UK100 outside London cash hours" };
    }
  }

  if (pair === "GER40") {
    const open = 7 * 60 + 15;
    const closeBuf = 15 * 60 + 30;
    if (mins < open || mins >= closeBuf) {
      return { blocked: true, reason: "GER40 outside Xetra cash hours" };
    }
  }

  if (pair === "US30" || pair === "NAS100" || pair === "SPX500") {
    // US RTH ~13:30–20:00 UTC
    const open = 13 * 60 + 45;
    const closeBuf = 19 * 60 + 45;
    if (mins < open || mins >= closeBuf) {
      return { blocked: true, reason: "US index outside regular cash hours" };
    }
  }

  return { blocked: false, reason: "" };
}

export function filterTradeableSignals<T extends { pair: string }>(signals: T[]): T[] {
  return signals.filter((s) => !isSessionBlocked(s.pair).blocked);
}
