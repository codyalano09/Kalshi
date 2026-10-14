import { redis, keys } from "./store";

export interface DashboardData {
  live: boolean; // false => no bot run recorded yet
  lastCycle: Record<string, any> | null;
  trades: any[];
  settled: any[];
  stats: { wins: number; losses: number; pnlCents: number };
}

const parse = (v: unknown) => (typeof v === "string" ? JSON.parse(v) : v);

export async function loadDashboard(): Promise<DashboardData> {
  try {
    const [cycle, trades, settled, stats] = await Promise.all([
      redis.get(keys.lastCycle),
      redis.lrange(keys.allTrades, 0, 19),
      redis.lrange(keys.settled, 0, 19),
      redis.hgetall<Record<string, number>>(keys.stats),
    ]);
    if (cycle) {
      return {
        live: true,
        lastCycle: parse(cycle),
        trades: trades.map(parse),
        settled: settled.map(parse),
        stats: { wins: Number(stats?.wins ?? 0), losses: Number(stats?.losses ?? 0), pnlCents: Number(stats?.pnlCents ?? 0) },
      };
    }
  } catch {
    /* fall through to sample */
  }
  return { live: false, lastCycle: null, trades: [], settled: [], stats: { wins: 0, losses: 0, pnlCents: 0 } };
}
