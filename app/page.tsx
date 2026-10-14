import { loadDashboard } from "@/lib/dashboard";
import LivePanel from "./LivePanel";

export const dynamic = "force-dynamic";

const label = (a: string) => (a === "BUY_YES" ? "BUY" : a === "BUY_NO" ? "SELL" : "HOLD");
const usd = (cents: number) => `${cents < 0 ? "−" : ""}$${(Math.abs(cents) / 100).toFixed(2)}`;
const ago = (iso: string) => {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  return m < 1 ? "just now" : m < 90 ? `${m}m ago` : `${Math.round(m / 60)}h ago`;
};

export default async function Home() {
  const d = await loadDashboard();
  const c = d.lastCycle;
  const sig = c?.signal;
  const total = d.stats.wins + d.stats.losses;
  const pill = sig?.action === "BUY_YES" ? "yes" : sig?.action === "BUY_NO" ? "no" : "hold";

  return (
    <main className="wrap">
      <h1>Kalshi BTC 15-minute bot</h1>
      <p className="sub">Bets on whether Bitcoin finishes above or below a price at the end of each 15-minute window.</p>

      {!d.live && (
        <div className="banner">The bot hasn't reported yet. Run `npm run bot` and its checks show up here.</div>
      )}
      {c && (
        <div className="banner" style={{ background: c.dryRun ? "var(--yes-bg)" : "var(--no-bg)", color: c.dryRun ? "var(--yes)" : "var(--no)" }}>
          {c.dryRun ? "Signals only: shows BUY / SELL / HOLD, places and records no trades." : "LIVE: real orders are being sent."}
        </div>
      )}

      <h2>How a decision is made</h2>
      <div className="card">
        <ol className="steps">
          <li><b>Look at the contract.</b> Kalshi sets a strike (BTC's price at the start of the window). YES pays $1 if BTC ends at or above it; NO pays $1 if below. A 60¢ price means the market thinks ~60%.</li>
          <li><b>Estimate the odds ourselves.</b> From how far BTC is from the strike, how jumpy it's been, and how many minutes remain.</li>
          <li><b>Wait for the last 5 minutes</b> and for the recent trend to point the same way as the gap.</li>
          <li><b>Signal only if it's cheap enough:</b> price ≤ 70¢ and our odds beat price + fee by 5+ points. BUY = bet BTC finishes above the strike, SELL = bet it finishes below.</li>
          <li><b>Limit the damage (live mode only):</b> $5 max per trade, one trade per window, stop for the day after a $15 loss.</li>
        </ol>
      </div>

      <h2>Live market right now</h2>
      <LivePanel />

      <h2>Bot's last run {c ? `· ${ago(c.ts)}` : ""}</h2>
      {c ? (
        <div className="grid">
          <div className="card"><div className="lbl">BTC now vs strike</div><div className="num">{c.spot ? `$${Math.round(c.spot).toLocaleString()}` : "–"}</div><div className="lbl">strike {c.strike ? `$${Math.round(c.strike).toLocaleString()}` : "–"}{sig ? ` · gap ${sig.deltaUsd >= 0 ? "+" : "−"}$${Math.abs(Math.round(sig.deltaUsd))}` : ""}</div></div>
          <div className="card"><div className="lbl">Time left</div><div className="num">{c.minutesLeft != null ? `${c.minutesLeft} min` : "–"}</div><div className="lbl">{c.ticker ?? c.status}</div></div>
          <div className="card"><div className="lbl">Bot's call</div><div className="num"><span className={`pill ${pill}`}>{sig ? label(sig.action) : c.status}</span></div><div className="lbl">{sig ? `model YES chance ${(sig.pYes * 100).toFixed(0)}%` : ""}</div></div>
          <div className="card"><div className="lbl">Today's P&L (equity)</div><div className={`num ${c.dayLossUsd > 0 ? "neg" : "pos"}`}>{c.dayLossUsd != null ? usd(-c.dayLossUsd * 100) : "–"}</div><div className="lbl">stops at −$15</div></div>
        </div>
      ) : (
        <div className="card lbl">No runs recorded yet.</div>
      )}
      {sig?.reason && <p className="lbl">Why: {sig.reason}</p>}

      <h2>Results</h2>
      <div className="grid">
        <div className="card"><div className="lbl">Settled trades</div><div className="num">{total}</div></div>
        <div className="card"><div className="lbl">Win rate</div><div className="num">{total ? `${Math.round((d.stats.wins / total) * 100)}%` : "–"}</div><div className="lbl">{d.stats.wins} won · {d.stats.losses} lost</div></div>
        <div className="card"><div className="lbl">Total profit</div><div className={`num ${d.stats.pnlCents < 0 ? "neg" : "pos"}`}>{usd(d.stats.pnlCents)}</div><div className="lbl">after estimated fees</div></div>
      </div>

      <h2>Recent trades</h2>
      <div className="card">
        {d.trades.length === 0 ? (
          <span className="lbl">None yet.</span>
        ) : (
          <table>
            <thead><tr><th>When</th><th>Bet</th><th>Size</th><th>Outcome</th><th>Why</th></tr></thead>
            <tbody>
              {d.trades.map((t) => {
                const s = d.settled.find((x) => x.ticker === t.ticker);
                return (
                  <tr key={t.ticker + t.ts}>
                    <td>{ago(t.ts)}</td>
                    <td><span className={`pill ${t.side}`}>{t.side.toUpperCase()}</span></td>
                    <td>{t.filled}× @ {t.limitPriceCents}¢{t.dryRun ? " (practice)" : ""}</td>
                    <td>{s ? <span className={s.won ? "pos" : "neg"}>{s.won ? "Won" : "Lost"} {usd(s.pnlCents)}</span> : <span className="lbl">pending</span>}</td>
                    <td className="lbl">{t.reason}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </main>
  );
}
