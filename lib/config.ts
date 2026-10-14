const num = (key: string, fallback: number): number => {
  const v = process.env[key];
  if (v === undefined || v === "") return fallback;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`Env ${key} is not a number: ${v}`);
  return n;
};

const isProd = process.env.KALSHI_ENV === "prod";

export const config = {
  env: isProd ? "prod" : "demo",
  kalshiBase: isProd
    ? "https://api.elections.kalshi.com/trade-api/v2"
    : "https://demo-api.kalshi.co/trade-api/v2",
  // Market reads are public. Paper trading uses real prod prices even if orders would go to demo.
  dataBase: process.env.DRY_RUN !== "false" ? "https://api.elections.kalshi.com/trade-api/v2" : (isProd ? "https://api.elections.kalshi.com/trade-api/v2" : "https://demo-api.kalshi.co/trade-api/v2"),
  seriesTicker: "KXBTC15M",
  // Orders are sent only when DRY_RUN is exactly "false".
  dryRun: process.env.DRY_RUN !== "false",

  maxRiskPerTradeUsd: num("MAX_RISK_PER_TRADE_USD", 5),
  maxDailyLossUsd: num("MAX_DAILY_LOSS_USD", 15),
  maxContracts: num("MAX_CONTRACTS", 20),
  maxEntryPriceCents: num("MAX_ENTRY_PRICE_CENTS", 70),
  slippageCents: num("SLIPPAGE_CENTS", 2),

  maxMinutesLeft: num("MAX_MINUTES_LEFT", 5),
  minMinutesLeft: num("MIN_MINUTES_LEFT", 0.75),
  minEdge: num("MIN_EDGE", 0.05),
  minMomentumZ: num("MIN_MOMENTUM_Z", 0.5),
};

export type Config = typeof config;
