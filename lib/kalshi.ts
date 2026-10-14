import crypto from "node:crypto";
import { config } from "./config";

export interface KalshiMarket {
  ticker: string;
  event_ticker: string;
  status: string; // initialized | active | closed | settled ...
  open_time: string;
  close_time: string;
  floor_strike?: number; // BTC reference price this 15-min market compares against
  yes_bid: number; // cents
  yes_ask: number;
  no_bid: number;
  no_ask: number;
  result?: "yes" | "no" | "";
}

export interface OrderbookLevels {
  yes: [number, number][]; // [price cents, qty] resting bids
  no: [number, number][];
}

export interface OrderRequest {
  ticker: string;
  side: "yes" | "no";
  action: "buy" | "sell";
  count: number;
  limitPriceCents: number;
  clientOrderId: string;
}

const toCents = (dollars: unknown, legacyCents: unknown): number => {
  if (dollars !== undefined && dollars !== null && dollars !== "") return Math.round(parseFloat(String(dollars)) * 100);
  return typeof legacyCents === "number" ? legacyCents : 0;
};

/** Kalshi now returns prices as dollar strings (yes_ask_dollars). Normalize to integer cents; accept legacy fields too. */
function normalizeMarket(r: any): KalshiMarket {
  return {
    ticker: r.ticker,
    event_ticker: r.event_ticker,
    status: r.status,
    open_time: r.open_time,
    close_time: r.close_time,
    floor_strike: r.floor_strike,
    yes_bid: toCents(r.yes_bid_dollars, r.yes_bid),
    yes_ask: toCents(r.yes_ask_dollars, r.yes_ask),
    no_bid: toCents(r.no_bid_dollars, r.no_bid),
    no_ask: toCents(r.no_ask_dollars, r.no_ask),
    result: r.result,
  };
}

function privateKeyPem(): string {
  const raw = process.env.KALSHI_PRIVATE_KEY;
  if (!raw) throw new Error("KALSHI_PRIVATE_KEY is not set");
  return raw.replace(/\\n/g, "\n").trim();
}

/** Kalshi signs `timestamp + METHOD + path` (path includes /trade-api/v2, excludes query) with RSA-PSS/SHA256. */
function authHeaders(method: string, fullPath: string): Record<string, string> {
  const keyId = process.env.KALSHI_API_KEY;
  if (!keyId) throw new Error("KALSHI_API_KEY is not set");
  const ts = Date.now().toString();
  const msg = `${ts}${method.toUpperCase()}${fullPath.split("?")[0]}`;
  const signature = crypto
    .sign("sha256", Buffer.from(msg), {
      key: privateKeyPem(),
      padding: crypto.constants.RSA_PKCS1_PSS_PADDING,
      saltLength: crypto.constants.RSA_PSS_SALTLEN_DIGEST,
    })
    .toString("base64");
  return {
    "KALSHI-ACCESS-KEY": keyId,
    "KALSHI-ACCESS-TIMESTAMP": ts,
    "KALSHI-ACCESS-SIGNATURE": signature,
  };
}

async function request<T>(method: "GET" | "POST" | "DELETE", path: string, body?: unknown, publicRead = false): Promise<T> {
  const url = new URL((publicRead ? config.dataBase : config.kalshiBase) + path);
  const res = await fetch(url, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(publicRead ? {} : authHeaders(method, url.pathname)),
    },
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store",
    signal: AbortSignal.timeout(8000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Kalshi ${method} ${path} -> ${res.status}: ${text.slice(0, 500)}`);
  return JSON.parse(text) as T;
}

/** The currently open KXBTC15M market closing soonest. */
export async function getActiveMarket(): Promise<KalshiMarket | null> {
  const data = await request<{ markets: any[] }>(
    "GET",
    `/markets?series_ticker=${config.seriesTicker}&status=open&limit=20`,
    undefined,
    true,
  );
  const now = Date.now();
  const live = data.markets
    .map(normalizeMarket)
    .filter((m) => new Date(m.close_time).getTime() > now && new Date(m.open_time).getTime() <= now)
    .sort((a, b) => new Date(a.close_time).getTime() - new Date(b.close_time).getTime());
  return live[0] ?? null;
}

/** Unauthenticated read of the live market. Kalshi market data is public, and prod is where KXBTC15M lives. */
export async function getActiveMarketPublic(): Promise<KalshiMarket | null> {
  const res = await fetch(
    `https://api.elections.kalshi.com/trade-api/v2/markets?series_ticker=${config.seriesTicker}&status=open&limit=20`,
    { cache: "no-store", signal: AbortSignal.timeout(6000) },
  );
  if (!res.ok) throw new Error(`Kalshi public markets ${res.status}`);
  const { markets } = (await res.json()) as { markets: any[] };
  const now = Date.now();
  return (
    markets
      .map(normalizeMarket)
      .filter((m) => new Date(m.close_time).getTime() > now && new Date(m.open_time).getTime() <= now)
      .sort((a, b) => new Date(a.close_time).getTime() - new Date(b.close_time).getTime())[0] ?? null
  );
}

export async function getMarket(ticker: string): Promise<KalshiMarket> {
  return normalizeMarket((await request<{ market: any }>("GET", `/markets/${ticker}`, undefined, true)).market);
}

export async function getOrderbook(ticker: string): Promise<OrderbookLevels> {
  const data = await request<{ orderbook_fp?: { yes_dollars?: string[][]; no_dollars?: string[][] } }>(
    "GET",
    `/markets/${ticker}/orderbook`,
  );
  const conv = (lv?: string[][]): [number, number][] =>
    (lv ?? []).map(([p, q]) => [Math.round(parseFloat(p) * 100), parseFloat(q)]);
  return { yes: conv(data.orderbook_fp?.yes_dollars), no: conv(data.orderbook_fp?.no_dollars) };
}

/** Best ask for a side and the size available there. A YES ask is 100 - best NO bid (and vice versa). */
export function bestAsk(book: OrderbookLevels, side: "yes" | "no"): { price: number; qty: number } | null {
  const opposing = side === "yes" ? book.no : book.yes;
  if (!opposing.length) return null;
  const top = opposing.reduce((a, b) => (b[0] > a[0] ? b : a));
  return { price: 100 - top[0], qty: top[1] };
}

/** Equity in cents = cash + mark-to-market value of open positions. */
export async function getEquityCents(): Promise<number> {
  const b = await request<{ balance: number; portfolio_value?: number }>("GET", "/portfolio/balance");
  return b.balance + (b.portfolio_value ?? 0);
}

export async function placeOrder(o: OrderRequest): Promise<{ orderId: string; filled: number; status: string }> {
  const body = {
    ticker: o.ticker,
    action: o.action,
    side: o.side,
    count: o.count,
    time_in_force: "immediate_or_cancel", // never leave a resting order near expiry
    client_order_id: o.clientOrderId,
    ...(o.side === "yes" ? { yes_price: o.limitPriceCents } : { no_price: o.limitPriceCents }),
  };
  const res = await request<{
    order: { order_id: string; status: string; fill_count_fp?: string };
  }>("POST", "/portfolio/orders", body);
  return {
    orderId: res.order.order_id,
    status: res.order.status,
    filled: Math.floor(parseFloat(res.order.fill_count_fp ?? "0")),
  };
}
