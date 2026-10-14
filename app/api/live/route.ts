import { NextResponse } from "next/server";
import { config } from "@/lib/config";
import { getActiveMarketPublic } from "@/lib/kalshi";
import { getSpotSnapshot } from "@/lib/prices";
import { evaluate } from "@/lib/strategy";

export const dynamic = "force-dynamic";

/** Public, read-only: live market data + what the strategy would do right now. No secrets, never trades. */
export async function GET() {
  try {
    const [market, snap] = await Promise.all([getActiveMarketPublic(), getSpotSnapshot()]);
    if (!market || market.floor_strike === undefined) {
      return NextResponse.json({ ts: Date.now(), spot: snap.spot, closes: snap.closes, market: null });
    }
    const minutesLeft = (new Date(market.close_time).getTime() - Date.now()) / 60000;
    const signal = evaluate(
      { spot: snap.spot, strike: market.floor_strike, minutesLeft, closes: snap.closes, yesAskCents: market.yes_ask, noAskCents: market.no_ask },
      config,
    );
    return NextResponse.json({
      ts: Date.now(),
      spot: snap.spot,
      closes: snap.closes,
      market: {
        ticker: market.ticker,
        strike: market.floor_strike,
        closeTime: market.close_time,
        yesBid: market.yes_bid,
        yesAsk: market.yes_ask,
        noBid: market.no_bid,
        noAsk: market.no_ask,
      },
      signal,
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 502 });
  }
}
