# Kalshi BTC 15-minute bot (Vercel)

Vercel Cron hits `/api/cron/predict-and-trade` every minute. Each run:

1. Verifies `Authorization: Bearer $CRON_SECRET` (fails closed if unset).
2. Records outcomes for settled trades (win/loss/PnL → Redis).
3. Finds the open `KXBTC15M` market, reads its strike (`floor_strike`) and ask prices.
4. Pulls BTC spot + 1-min candles from Coinbase.
5. `lib/strategy.ts` models P(YES) = Φ(Δ / (σ·√minutesLeft)), requires aligned delta + 3-min momentum, ask ≤ 70¢, and edge ≥ 5pp after fees, only in the last 5 minutes.
6. Risk gates: daily equity-loss stop, per-trade risk budget, slippage cap, one trade per market (Redis NX lock).
7. Sends an IOC limit order (unless `DRY_RUN`), logs to Redis.

## Safety defaults
`KALSHI_ENV=demo` and `DRY_RUN=true`. Real orders need `DRY_RUN=false`; real money needs `KALSHI_ENV=prod`. Walk the ladder: dry-run on demo → live on demo → dry-run on prod → small live on prod.

## Run locally (free, no accounts needed)
```bash
npm install
npm run dev      # terminal 1: dashboard at http://localhost:3000
npm run bot      # terminal 2: calls the cron route every minute, like Vercel Cron
```
`.env.local` needs `CRON_SECRET` and `DRY_RUN=true`. With no Kalshi keys the bot shows BUY / SELL / HOLD signals from real prod prices without placing or recording trades. History is stored in `data/store.json` (no Redis). The bot only runs while your computer is awake and these terminals are open.

## Setup (Vercel / live trading)
1. **Kalshi key**: Account settings → API Keys → create key, save the key ID (`KALSHI_API_KEY`) and the PEM private key (`KALSHI_PRIVATE_KEY`). Demo keys come from demo.kalshi.co.
2. **Local**: `cp .env.example .env.local`, fill in, `npm install`, `npm run dev`, then
   `curl -H "Authorization: Bearer $CRON_SECRET" localhost:3000/api/cron/predict-and-trade`
3. **Vercel**: push to GitHub → Import project at vercel.com/new. Storage tab → add **Upstash Redis** (Marketplace); it injects `KV_REST_API_URL/TOKEN`. Add `KALSHI_ENV`, `KALSHI_API_KEY`, `KALSHI_PRIVATE_KEY`, `CRON_SECRET`, `DRY_RUN`, and any risk overrides under Settings → Environment Variables. Deploy.
4. **Verify**: Project → Settings → Cron Jobs shows the job; use "Run" there, check Logs. Inspect Redis keys `cycle:last`, `trades:log`, `trades:settled`, `stats`.

## Caveats to read
- **Cron frequency**: per-minute schedules need Vercel **Pro**. Hobby only allows once per day. Vercel also doesn't guarantee exact-second firing, so the entry window is deliberately several minutes wide.
- **Kalshi API drift**: Kalshi has been migrating to fixed-point/sub-penny price fields. If `yes_ask` etc. come back missing, adjust the field names in `lib/kalshi.ts` against https://docs.kalshi.com. Test on demo first.
- **Settlement source**: Kalshi settles on a CF Benchmarks BTC index average, not Coinbase spot. Near the strike this basis can flip the outcome; the edge threshold is your buffer.
- **No backtest was done.** The probability model is a driftless-Gaussian approximation; it is a starting point, not a proven edge. Paper trade (DRY_RUN) and compare `trades:log` against actual results before risking money. Also, markets near 70¢ with strong momentum are usually priced efficiently.
- Daily loss uses equity (cash + positions marked to market) vs. the first reading of the UTC day.
