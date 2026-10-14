// Coinbase is used because Binance geo-blocks US-hosted serverless regions (HTTP 451).
const EXCHANGE = "https://api.exchange.coinbase.com";

export interface SpotSnapshot {
  spot: number;
  /** Closes of the last ~40 one-minute candles, oldest first. Last element is the in-progress minute. */
  closes: number[];
}

export async function getSpotSnapshot(): Promise<SpotSnapshot> {
  const [tickerRes, candlesRes] = await Promise.all([
    fetch(`${EXCHANGE}/products/BTC-USD/ticker`, { cache: "no-store", signal: AbortSignal.timeout(5000) }),
    fetch(`${EXCHANGE}/products/BTC-USD/candles?granularity=60`, { cache: "no-store", signal: AbortSignal.timeout(5000) }),
  ]);
  if (!tickerRes.ok) throw new Error(`Coinbase ticker ${tickerRes.status}`);
  if (!candlesRes.ok) throw new Error(`Coinbase candles ${candlesRes.status}`);
  const ticker = (await tickerRes.json()) as { price: string };
  // Rows: [time, low, high, open, close, volume], newest first.
  const candles = (await candlesRes.json()) as number[][];
  const closes = candles.slice(0, 40).reverse().map((c) => c[4]);
  return { spot: Number(ticker.price), closes };
}
