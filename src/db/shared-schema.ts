import { sql } from 'drizzle-orm';
import { index, integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const costEvents = sqliteTable(
  'cost_events',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    ts: integer('ts', { mode: 'timestamp_ms' }).default(sql`(unixepoch() * 1000)`).notNull(),
    platform: text('platform').notNull(),
    endpoint: text('endpoint'),
    status: integer('status'),
    items: integer('items'),
    // Was numeric(10,5) on Postgres; SQLite has no decimal type — REAL is plenty
    // for sub-cent sums (callers round to 5 dp before storing/displaying).
    costUsd: real('cost_usd'),
    durationMs: integer('duration_ms'),
    attempts: integer('attempts'),
    requestId: text('request_id'),
  },
  (t) => [
    index('cost_events_ts_idx').on(t.ts),
    index('cost_events_platform_ts_idx').on(t.platform, t.ts),
  ],
);
