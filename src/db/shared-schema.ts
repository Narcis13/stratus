import { bigserial, index, integer, numeric, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

export const costEvents = pgTable(
  'cost_events',
  {
    id: bigserial('id', { mode: 'bigint' }).primaryKey(),
    ts: timestamp('ts', { withTimezone: true }).defaultNow().notNull(),
    platform: text('platform').notNull(),
    endpoint: text('endpoint'),
    status: integer('status'),
    items: integer('items'),
    costUsd: numeric('cost_usd', { precision: 10, scale: 5 }),
    durationMs: integer('duration_ms'),
    attempts: integer('attempts'),
    requestId: text('request_id'),
  },
  (t) => [
    index('cost_events_ts_idx').on(t.ts.desc()),
    index('cost_events_platform_ts_idx').on(t.platform, t.ts.desc()),
  ],
);
