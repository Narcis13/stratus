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
import { getDailyBudgetUsd } from '../middleware/costTracker.ts';

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
    .map((p) => {
      const budget = getDailyBudgetUsd(p.platform);
      return {
        ...p,
        costUsd: round5(p.costUsd),
        ...(budget != null ? { dailyBudgetUsd: budget, overBudget: p.costUsd >= budget } : {}),
        byEndpoint: p.byEndpoint
          .map((e) => ({ ...e, costUsd: round5(e.costUsd) }))
          .sort((a, b) => b.costUsd - a.costUsd),
      };
    })
    .sort((a, b) => b.costUsd - a.costUsd);

  return c.json({
    from,
    to,
    totalUsd: round5(totalUsd),
    totalCalls,
    byPlatform,
  });
});

// Daily spend series for the trailing `days` UTC days (default 30, max 90),
// today included, zero-filled so charts get a continuous series.
cost.get('/cost/daily', async (c) => {
  const daysRaw = Number.parseInt(c.req.query('days') ?? '30', 10);
  if (Number.isNaN(daysRaw)) return c.json({ error: 'invalid_days' }, 400);
  const days = Math.min(90, Math.max(1, daysRaw));

  const today = startOfUtcDay(new Date());
  const from = new Date(today.getTime() - (days - 1) * 24 * 60 * 60 * 1000);

  const rows = await db
    .select({
      day: sql<string>`to_char(${costEvents.ts} at time zone 'UTC', 'YYYY-MM-DD')`,
      platform: costEvents.platform,
      costUsd: sql<string>`coalesce(sum(${costEvents.costUsd}), 0)`,
      calls: sql<string>`count(*)`,
    })
    .from(costEvents)
    .where(sql`${costEvents.ts} >= ${from}`)
    .groupBy(sql`1`, costEvents.platform);

  type DayAgg = {
    day: string;
    totalUsd: number;
    totalCalls: number;
    byPlatform: Array<{ platform: string; costUsd: number; calls: number }>;
  };

  const byDay = new Map<string, DayAgg>();
  for (let i = 0; i < days; i++) {
    const d = new Date(from.getTime() + i * 24 * 60 * 60 * 1000);
    const key = d.toISOString().slice(0, 10);
    byDay.set(key, { day: key, totalUsd: 0, totalCalls: 0, byPlatform: [] });
  }

  for (const row of rows) {
    const agg = byDay.get(row.day);
    if (!agg) continue;
    const usd = round5(Number(row.costUsd));
    const calls = Number(row.calls);
    agg.totalUsd = round5(agg.totalUsd + usd);
    agg.totalCalls += calls;
    agg.byPlatform.push({ platform: row.platform, costUsd: usd, calls });
  }

  const budgets: Record<string, number> = {};
  for (const agg of byDay.values()) {
    for (const p of agg.byPlatform) {
      const b = getDailyBudgetUsd(p.platform);
      if (b != null) budgets[p.platform] = b;
    }
  }

  return c.json({ from, days, budgets, daily: Array.from(byDay.values()) });
});

function startOfUtcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

// cost_events.cost_usd is numeric(10,5); keep the same precision in the response
// so summing on the client matches what's in the DB.
function round5(n: number): number {
  return Math.round(n * 1e5) / 1e5;
}
