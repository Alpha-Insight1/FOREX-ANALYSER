export type AssetClass = "forex" | "gold" | "index" | "crypto";

export function assetClassOf(pair: string): AssetClass {
  if (pair === "XAUUSD" || pair === "GOLD" || pair === "XAU/USD") return "gold";
  if (
    pair === "GER40" ||
    pair === "US30" ||
    pair === "NAS100" ||
    pair === "SPX500" ||
    pair === "UK100" ||
    pair === "JPN225"
  )
    return "index";
  if (pair.startsWith("BTC") || pair.startsWith("ETH")) return "crypto";
  return "forex";
}

export function assetClassLabel(cls: AssetClass): string {
  if (cls === "gold") return "Gold";
  if (cls === "index") return "Indices";
  if (cls === "crypto") return "Crypto";
  return "Forex";
}

export function displayPair(pair: string): string {
  if (pair === "XAUUSD" || pair === "GOLD") return "XAU/USD";
  return pair;
}

export function assetClassHint(cls: AssetClass): string {
  if (cls === "gold") return "4H trend · 1m & 5m entry";
  if (cls === "index") return "4H + Daily trend · 5m / 15m / 30m entry";
  if (cls === "crypto") return "24/7 · structure + confirmation";
  return "4H structure · 1H confirmation";
}
