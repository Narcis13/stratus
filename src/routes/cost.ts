// Cross-platform spend dashboard. `cost_events` carries a `platform` column
// (see src/middleware/costTracker.ts) so this stays platform-agnostic — when
// LinkedIn lands, its rows show up here without touching this file.
//
// "Today" = the current UTC day. The X billing window is UTC, so anchoring
// here matches what the X dashboard reports.

import { sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { db } from '../db/client.ts';
import { costEvents } from '../db/shared-schema.ts';

export const cost = new Hono();

cost.get('/cost/today', async (c) => {
  const from = startOfUtcDay(new Date());
  const to = new Date(from.getTime() + 24 * 60 * 60 * 1000);

  const rows = await db
    .select({
      platform: costEvents.platform,
      endpoint: costEvents.endpoint,
      costUsd: sql<string>`coalesce(sum(${costEvents.costUsd}), 0)`,
      calls: sql<string>`count(*)`,
    })
    .from(costEvents)
    .where(sql`${costEvents.ts} >= ${from} and ${costEvents.ts} < ${to}`)
    .groupBy(costEvents.platform, costEvents.endpoint);

  type PlatformAgg = {
    platform: string;
    costUsd: number;
    calls: number;
    byEndpoint: Array<{ endpoint: string | null; costUsd: number; calls: number }>;
  };

  const platforms = new Map<string, PlatformAgg>();
  let totalUsd = 0;
  let totalCalls = 0;

  for (const row of rows) {
    const usd = Number(row.costUsd);
    const calls = Number(row.calls);
    totalUsd += usd;
    totalCalls += calls;

    let p = platforms.get(row.platform);
    if (!p) {
      p = { platform: row.platform, costUsd: 0, calls: 0, byEndpoint: [] };
      platforms.set(row.platform, p);
    }
    p.costUsd += usd;
    p.calls += calls;
    p.byEndpoint.push({ endpoint: row.endpoint, costUsd: usd, calls });
  }

  const byPlatform = Array.from(platforms.values())
    .map((p) => ({
      ...p,
      costUsd: round5(p.costUsd),
      byEndpoint: p.byEndpoint
        .map((e) => ({ ...e, costUsd: round5(e.costUsd) }))
        .sort((a, b) => b.costUsd - a.costUsd),
    }))
    .sort((a, b) => b.costUsd - a.costUsd);

  return c.json({
    from,
    to,
    totalUsd: round5(totalUsd),
    totalCalls,
    byPlatform,
  });
});

function startOfUtcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

// cost_events.cost_usd is numeric(10,5); keep the same precision in the response
// so summing on the client matches what's in the DB.
function round5(n: number): number {
  return Math.round(n * 1e5) / 1e5;
}
