"use client";

import { useEffect, useState } from "react";

interface Live {
  ts: number;
  spot: number;
  closes: number[];
  error?: string;
  market: null | { ticker: string; strike: number; closeTime: string; yesBid: number; yesAsk: number; noBid: number; noAsk: number };
  signal?: { action: "BUY_YES" | "BUY_NO" | "HOLD"; reason: string; pYes: number; deltaUsd: number; momentumZ: number; edge: number };
}

const POLL_MS = 3000;

function Spark({ closes, strike }: { closes: number[]; strike?: number }) {
  if (closes.length < 2) return null;
  const all = strike ? [...closes, strike] : closes;
  const lo = Math.min(...all), hi = Math.max(...all), span = hi - lo || 1;
  const x = (i: number) => (i / (closes.length - 1)) * 600;
  const y = (v: number) => 70 - ((v - lo) / span) * 64;
  const pts = closes.map((c, i) => `${x(i).toFixed(1)},${y(c).toFixed(1)}`).join(" ");
  return (
    <svg viewBox="0 0 600 76" style={{ width: "100%", height: 76, marginTop: 8 }} role="img" aria-label="BTC price, last 40 minutes, with strike line">
      {strike !== undefined && <line x1="0" x2="600" y1={y(strike)} y2={y(strike)} stroke="var(--hold)" strokeDasharray="5 4" />}
      <polyline points={pts} fill="none" stroke="var(--accent)" strokeWidth="2" />
    </svg>
  );
}

export default function LivePanel() {
  const [d, setD] = useState<Live | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    let stop = false;
    const pull = async () => {
      try {
        const r = await fetch("/api/live", { cache: "no-store" });
        const j = (await r.json()) as Live;
        if (stop) return;
        if (!r.ok || j.error) setErr(j.error ?? `HTTP ${r.status}`);
        else { setD(j); setErr(null); }
      } catch (e) {
        if (!stop) setErr(e instanceof Error ? e.message : "network error");
      }
    };
    pull();
    const a = setInterval(pull, POLL_MS);
    const b = setInterval(() => setNow(Date.now()), 1000);
    return () => { stop = true; clearInterval(a); clearInterval(b); };
  }, []);

  if (!d) return <div className="card lbl">{err ? `Live feed error: ${err}` : "Connecting to live feed…"}</div>;

  const m = d.market;
  const secs = m ? Math.max(0, Math.round((new Date(m.closeTime).getTime() - now) / 1000)) : 0;
  const gap = m ? d.spot - m.strike : 0;
  const s = d.signal;
  const pill = s?.action === "BUY_YES" ? "yes" : s?.action === "BUY_NO" ? "no" : "hold";
  const age = Math.round((now - d.ts) / 1000);

  return (
    <>
      <div className="grid">
        <div className="card">
          <div className="lbl">BTC now (Coinbase)</div>
          <div className="num">${d.spot.toLocaleString(undefined, { maximumFractionDigits: 0 })}</div>
          <div className="lbl">{m ? <>strike ${m.strike.toLocaleString(undefined, { maximumFractionDigits: 0 })} · <span className={gap >= 0 ? "pos" : "neg"}>{gap >= 0 ? "+" : "−"}${Math.abs(Math.round(gap))}</span></> : "no open market"}</div>
        </div>
        <div className="card">
          <div className="lbl">Window closes in</div>
          <div className="num">{m ? `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}` : "–"}</div>
          <div className="lbl">{m ? (secs / 60 <= 5 ? "inside the 5-min trading window" : "waiting for the last 5 min") : ""}</div>
        </div>
        <div className="card">
          <div className="lbl">Kalshi asks</div>
          <div className="num" style={{ fontSize: 22 }}>{m ? <>YES {m.yesAsk}¢ · NO {m.noAsk}¢</> : "–"}</div>
          <div className="lbl">{m ? `bids ${m.yesBid}¢ / ${m.noBid}¢` : ""}</div>
        </div>
        <div className="card">
          <div className="lbl">Signal</div>
          <div className="num">{s ? <span className={`pill ${pill}`}>{s.action === "BUY_YES" ? "BUY" : s.action === "BUY_NO" ? "SELL" : "HOLD"}</span> : "–"}</div>
          <div className="lbl">{s ? (s.action === "BUY_YES" ? "bet BTC finishes above strike" : s.action === "BUY_NO" ? "bet BTC finishes below strike" : `model YES chance ${(s.pYes * 100).toFixed(0)}%`) : ""}</div>
        </div>
      </div>
      <div className="card" style={{ marginTop: 12 }}>
        <div className="lbl">BTC, last 40 minutes (dashed = strike)</div>
        <Spark closes={[...d.closes, d.spot]} strike={m?.strike} />
        {s && <p className="lbl" style={{ margin: "8px 0 0" }}>Why: {s.reason}</p>}
      </div>
      <p className="lbl" style={{ marginTop: 8 }}>
        {err ? <span className="neg">Feed hiccup ({err}), showing last good data. </span> : null}
        Live · refreshed {age}s ago · every {POLL_MS / 1000}s. Read-only: this never places trades.
      </p>
    </>
  );
}
