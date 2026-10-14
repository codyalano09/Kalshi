import type { Config } from "./config";

export type Action = "BUY_YES" | "BUY_NO" | "HOLD";

export interface StrategyInput {
  spot: number;
  strike: number;
  minutesLeft: number;
  closes: number[]; // 1-min closes, oldest first
  yesAskCents: number;
  noAskCents: number;
}

export interface Signal {
  action: Action;
  reason: string;
  /** Model probability that the market resolves YES (spot >= strike at expiry). */
  pYes: number;
  deltaUsd: number;
  momentumZ: number;
  edge: number;
  askCents: number;
}

/** Standard normal CDF (Abramowitz-Stegun 7.1.26 via erf). */
export function normCdf(x: number): number {
  const t = 1 / (1 + 0.3275911 * Math.abs(x) / Math.SQRT2);
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp((-x * x) / 2);
  return 0.5 * (1 + (x >= 0 ? y : -y));
}

/** Kalshi taker fee per contract in cents: ceil(7% * P * (1-P)) with P in dollars, approximated per contract. */
export function feeCents(priceCents: number): number {
  const p = priceCents / 100;
  return Math.ceil(0.07 * p * (1 - p) * 100);
}

function perMinuteVol(closes: number[]): number {
  const rets: number[] = [];
  for (let i = 1; i < closes.length; i++) rets.push(Math.log(closes[i] / closes[i - 1]));
  if (rets.length < 5) return 0.0004; // ~4bp/min fallback
  const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
  const v = rets.reduce((a, b) => a + (b - mean) ** 2, 0) / (rets.length - 1);
  return Math.max(Math.sqrt(v), 0.00015); // floor avoids absurd certainty in dead markets
}

export type Rules = Pick<Config, "maxMinutesLeft" | "minMinutesLeft" | "minMomentumZ" | "maxEntryPriceCents" | "minEdge">;

export function evaluate(input: StrategyInput, cfg: Rules): Signal {
  const { spot, strike, minutesLeft, closes, yesAskCents, noAskCents } = input;
  const sigmaMin = perMinuteVol(closes);
  // Momentum: 3-minute return in units of its own expected std dev.
  const n = closes.length;
  const ret3 = n >= 4 ? Math.log(closes[n - 1] / closes[n - 4]) : 0;
  const momentumZ = ret3 / (sigmaMin * Math.sqrt(3));
  return decide({ spot, strike, minutesLeft, sigmaMin, momentumZ, yesAskCents, noAskCents }, cfg);
}

/** Core rules, given already-computed volatility and momentum. Shared by the bot and the UI simulator. */
export function decide(
  s: { spot: number; strike: number; minutesLeft: number; sigmaMin: number; momentumZ: number; yesAskCents: number; noAskCents: number },
  cfg: Rules,
): Signal {
  const { spot, strike, minutesLeft, sigmaMin, momentumZ, yesAskCents, noAskCents } = s;
  const delta = spot - strike;
  const sigmaUsd = spot * sigmaMin * Math.sqrt(Math.max(minutesLeft, 0.25));
  const pYes = normCdf(delta / sigmaUsd);

  const base = { pYes, deltaUsd: delta, momentumZ, edge: 0, askCents: 0 };
  const hold = (reason: string): Signal => ({ action: "HOLD", reason, ...base });

  if (minutesLeft > cfg.maxMinutesLeft) return hold(`${minutesLeft.toFixed(1)}m left > window ${cfg.maxMinutesLeft}m`);
  if (minutesLeft < cfg.minMinutesLeft) return hold(`${minutesLeft.toFixed(1)}m left < min ${cfg.minMinutesLeft}m (too late to fill safely)`);

  const candidates: { action: Action; ask: number; p: number; ok: boolean }[] = [
    { action: "BUY_YES", ask: yesAskCents, p: pYes, ok: delta > 0 && momentumZ >= cfg.minMomentumZ },
    { action: "BUY_NO", ask: noAskCents, p: 1 - pYes, ok: delta < 0 && momentumZ <= -cfg.minMomentumZ },
  ];

  for (const c of candidates) {
    if (!c.ok) continue;
    if (!(c.ask > 0 && c.ask <= 99)) continue; // no ask / illiquid
    if (c.ask > cfg.maxEntryPriceCents) return hold(`${c.action} ask ${c.ask}c > cap ${cfg.maxEntryPriceCents}c`);
    const edge = c.p - (c.ask + feeCents(c.ask)) / 100;
    if (edge < cfg.minEdge)
      return hold(`${c.action} edge ${(edge * 100).toFixed(1)}pp < min ${(cfg.minEdge * 100).toFixed(1)}pp (model p=${c.p.toFixed(2)}, ask ${c.ask}c)`);
    return {
      action: c.action,
      reason: `delta $${delta.toFixed(0)}, momZ ${momentumZ.toFixed(2)}, model p=${c.p.toFixed(2)} vs ask ${c.ask}c, edge ${(edge * 100).toFixed(1)}pp`,
      pYes,
      deltaUsd: delta,
      momentumZ,
      edge,
      askCents: c.ask,
    };
  }
  return hold(`no aligned delta+momentum (delta $${delta.toFixed(0)}, momZ ${momentumZ.toFixed(2)})`);
}

/** Contracts affordable under the per-trade risk budget (worst case = lose the full premium + fee). */
export function sizePosition(limitCents: number, cfg: Config): number {
  const perContract = limitCents + feeCents(limitCents);
  return Math.max(0, Math.min(cfg.maxContracts, Math.floor((cfg.maxRiskPerTradeUsd * 100) / perContract)));
}
