// Local scheduler: calls the cron route once a minute, like Vercel Cron would.
// Usage: npm run bot   (the Next server must be running: npm run dev, or npm run build && npm start)
const base = process.env.BOT_URL ?? "http://localhost:3000";
const secret = process.env.CRON_SECRET;
if (!secret) {
  console.error("CRON_SECRET is not set (put it in .env.local)");
  process.exit(1);
}

async function tick() {
  const t = new Date().toLocaleTimeString();
  try {
    const res = await fetch(`${base}/api/cron/predict-and-trade`, {
      headers: { authorization: `Bearer ${secret}` },
      signal: AbortSignal.timeout(30000),
    });
    const j = await res.json();
    const sig = j.signal;
    console.log(
      `[${t}] ${j.status ?? res.status}${j.dryRun ? " (dry-run)" : ""}` +
        (j.spot ? ` spot=${Math.round(j.spot)} strike=${Math.round(j.strike)} left=${j.minutesLeft}m` : "") +
        (sig ? ` -> ${sig.action}: ${sig.reason}` : "") +
        (j.error ? ` ERROR: ${j.error}` : ""),
    );
  } catch (e) {
    console.log(`[${t}] request failed: ${e.message} (is the server running at ${base}?)`);
  }
}

console.log(`Bot loop started against ${base}. Ctrl+C to stop.`);
await tick();
// Re-align to the top of each minute so runs are evenly spaced.
setTimeout(function loop() {
  tick();
  setTimeout(loop, 60000 - (Date.now() % 60000));
}, 60000 - (Date.now() % 60000));
