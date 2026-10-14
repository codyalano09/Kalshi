import fs from "node:fs";
import path from "node:path";
import { Redis } from "@upstash/redis";

export interface TradeRecord {
  ts: string;
  ticker: string;
  side: "yes" | "no";
  count: number;
  limitPriceCents: number;
  filled: number;
  orderId?: string;
  dryRun: boolean;
  reason: string;
  closeTime: string;
  strike: number;
  spot: number;
  pModel: number;
}

export const keys = {
  tradedLock: (ticker: string) => `traded:${ticker}`,
  dayStartEquity: (day: string) => `equity:start:${day}`,
  openTrades: "trades:open", // hash ticker -> TradeRecord JSON
  allTrades: "trades:log", // list, newest first
  settled: "trades:settled", // list, newest first
  stats: "stats", // hash
  lastCycle: "cycle:last",
};

/** The small subset of Redis commands the bot uses. */
export interface Kv {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown, opts?: { nx?: boolean; ex?: number }): Promise<"OK" | null>;
  del(key: string): Promise<unknown>;
  lpush(key: string, value: string): Promise<unknown>;
  ltrim(key: string, start: number, stop: number): Promise<unknown>;
  lrange(key: string, start: number, stop: number): Promise<unknown[]>;
  hset(key: string, fields: Record<string, unknown>): Promise<unknown>;
  hgetall<T>(key: string): Promise<T | null>;
  hdel(key: string, field: string): Promise<unknown>;
  hincrby(key: string, field: string, by: number): Promise<unknown>;
}

/** Zero-setup local store: one JSON file (data/store.json). Re-read on every call so Next's separate module contexts stay consistent. */
class FileKv implements Kv {
  private file = path.join(process.cwd(), "data", "store.json");

  private load(): { d: Record<string, any>; exp: Record<string, number> } {
    try {
      const j = JSON.parse(fs.readFileSync(this.file, "utf8"));
      const now = Date.now();
      for (const k of Object.keys(j.exp ?? {})) if (j.exp[k] <= now) { delete j.d[k]; delete j.exp[k]; }
      return { d: j.d ?? {}, exp: j.exp ?? {} };
    } catch {
      return { d: {}, exp: {} };
    }
  }
  private save(s: { d: Record<string, any>; exp: Record<string, number> }) {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = this.file + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(s));
    fs.renameSync(tmp, this.file);
  }
  private mut<T>(fn: (s: { d: Record<string, any>; exp: Record<string, number> }) => T): T {
    const s = this.load();
    const r = fn(s);
    this.save(s);
    return r;
  }

  async get(key: string) { return this.load().d[key] ?? null; }
  async set(key: string, value: unknown, opts?: { nx?: boolean; ex?: number }) {
    return this.mut((s) => {
      if (opts?.nx && key in s.d) return null;
      s.d[key] = value;
      if (opts?.ex) s.exp[key] = Date.now() + opts.ex * 1000; else delete s.exp[key];
      return "OK" as const;
    });
  }
  async del(key: string) { this.mut((s) => { delete s.d[key]; delete s.exp[key]; }); }
  async lpush(key: string, value: string) { this.mut((s) => { (s.d[key] ??= []).unshift(value); }); }
  async ltrim(key: string, start: number, stop: number) { this.mut((s) => { if (s.d[key]) s.d[key] = s.d[key].slice(start, stop + 1); }); }
  async lrange(key: string, start: number, stop: number) { return (this.load().d[key] ?? []).slice(start, stop + 1); }
  async hset(key: string, fields: Record<string, unknown>) { this.mut((s) => { Object.assign((s.d[key] ??= {}), fields); }); }
  async hgetall<T>(key: string) { return (this.load().d[key] as T) ?? null; }
  async hdel(key: string, field: string) { this.mut((s) => { if (s.d[key]) delete s.d[key][field]; }); }
  async hincrby(key: string, field: string, by: number) { this.mut((s) => { const h = (s.d[key] ??= {}); h[field] = (h[field] ?? 0) + by; }); }
}

function createStore(): Kv {
  const url = process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN;
  if (url && token) return new Redis({ url, token }) as unknown as Kv;
  if (process.env.VERCEL) throw new Error("Redis REST URL/token env vars are required on Vercel (its filesystem is not persistent)");
  return new FileKv();
}

export const redis: Kv = createStore();
