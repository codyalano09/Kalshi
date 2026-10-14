import { NextResponse } from "next/server";
import { config } from "@/lib/config";
import { redis, keys, type TradeRecord } from "@/lib/store";
import { getActiveMarket, getMarket, getEquityCents, placeOrder } from "@/lib/kalshi";
import { getSpotSnapshot } from "@/lib/prices";
import { evaluate, sizePosition, feeCents } from "@/lib/strategy";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** Record outcomes for trades whose markets have settled. */
async function settleOpenTrades() {
  const open = (await redis.hgetall<Record<string, TradeRecord | string>>(keys.openTrades)) ?? {};
  for (const [ticker, raw] of Object.entries(open)) {
    const trade = (typeof raw === "string" ? JSON.parse(raw) : raw) as TradeRecord;
    if (new Date(trade.closeTime).getTime() > Date.now()) continue;
    if (trade.filled === 0) {
      await redis.hdel(keys.openTrades, ticker);
      continue;
    }
    const m = await getMarket(ticker);
    if (m.result !== "yes" && m.result !== "no") continue; // not settled yet
    const won = m.result === trade.side;
    const fee = feeCents(trade.limitPriceCents) * trade.filled;
    const pnlCents = won
      ? (100 - trade.limitPriceCents) * trade.filled - fee
      : -trade.limitPriceCents * trade.filled - fee;
    await redis.lpush(keys.settled, JSON.stringify({ ...trade, result: m.result, won, pnlCents }));
    await redis.ltrim(keys.settled, 0, 999);
    await redis.hincrby(keys.stats, won ? "wins" : "losses", 1);
    await redis.hincrby(keys.stats, "pnlCents", pnlCents);
    await redis.hdel(keys.openTrades, ticker);
  }
}

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const cycle: Record<string, unknown> = { ts: new Date().toISOString(), env: config.env, dryRun: config.dryRun };
  try {
    await settleOpenTrades();

    const market = await getActiveMarket();
    if (!market) return finish(cycle, { status: "no_active_market" });
    cycle.ticker = market.ticker;

    const strike = market.floor_strike;
    if (strike === undefined) return finish(cycle, { status: "no_strike" });

    const minutesLeft = (new Date(market.close_time).getTime() - Date.now()) / 60000;
    const { spot, closes } = await getSpotSnapshot();
    const signal = evaluate(
      { spot, strike, minutesLeft, closes, yesAskCents: market.yes_ask, noAskCents: market.no_ask },
      config,
    );
    Object.assign(cycle, { spot, strike, minutesLeft: +minutesLeft.toFixed(2), signal });
    if (signal.action === "HOLD") return finish(cycle, { status: "hold" });
    // Signal-only mode: report BUY/SELL/HOLD but never place or record a trade.
    if (config.dryRun) return finish(cycle, { status: "signal_only" });

    // --- Risk gates ---
    const day = new Date().toISOString().slice(0, 10);
    const equity = await getEquityCents();
    await redis.set(keys.dayStartEquity(day), equity, { nx: true, ex: 60 * 60 * 36 });
    const startEquity = Number(await redis.get(keys.dayStartEquity(day)));
    const dayLossCents = startEquity - equity;
    cycle.dayLossUsd = dayLossCents / 100;
    if (dayLossCents >= config.maxDailyLossUsd * 100) return finish(cycle, { status: "daily_loss_stop" });

    const side = signal.action === "BUY_YES" ? "yes" : "no";
    const limit = Math.min(signal.askCents + config.slippageCents, config.maxEntryPriceCents);
    if (limit < signal.askCents) return finish(cycle, { status: "ask_above_cap_after_slippage" });
    const count = sizePosition(limit, config);
    if (count < 1) return finish(cycle, { status: "risk_budget_too_small" });

    // One trade per market. NX lock makes concurrent/overlapping invocations safe.
    const locked = await redis.set(keys.tradedLock(market.ticker), "1", { nx: true, ex: 3600 });
    if (!locked) return finish(cycle, { status: "already_traded_this_market" });

    let filled = 0;
    let orderId: string | undefined;
    {
      try {
        const order = await placeOrder({
          ticker: market.ticker,
          side,
          action: "buy",
          count,
          limitPriceCents: limit,
          clientOrderId: `${market.ticker}-${side}`,
        });
        filled = order.filled;
        orderId = order.orderId;
      } catch (err) {
        await redis.del(keys.tradedLock(market.ticker)); // allow retry next minute
        throw err;
      }
    }

    const record: TradeRecord = {
      ts: new Date().toISOString(),
      ticker: market.ticker,
      side,
      count,
      limitPriceCents: limit,
      filled,
      orderId,
      dryRun: config.dryRun,
      reason: signal.reason,
      closeTime: market.close_time,
      strike,
      spot,
      pModel: signal.pYes,
    };
    await redis.lpush(keys.allTrades, JSON.stringify(record));
    await redis.ltrim(keys.allTrades, 0, 999);
    if (record.filled > 0) await redis.hset(keys.openTrades, { [market.ticker]: JSON.stringify(record) });
    return finish(cycle, { status: "order_sent", trade: record });
  } catch (err) {
    return finish(cycle, { status: "error", error: err instanceof Error ? err.message : String(err) }, 500);
  }
}

async function finish(cycle: Record<string, unknown>, extra: Record<string, unknown>, httpStatus = 200) {
  const body = { ...cycle, ...extra };
  try {
    await redis.set(keys.lastCycle, JSON.stringify(body), { ex: 3600 });
  } catch {
    /* logging must never mask the result */
  }
  return NextResponse.json(body, { status: httpStatus });
}
