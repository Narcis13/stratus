// Audience Active-times captures (Authoring 3.0, A3.2) — the storage half of
// the $0 X Analytics heatmap scrape. The extension's content script (A3.3)
// POSTs a normalized grid whenever the user happens to visit X Analytics;
// consumers (Composer slot blending, brief gaps — A3.4) read the newest row.
// Mounted under `/x` by `mountX` in ../index.ts — always mounted, $0: nothing
// here can reach the X API or an LLM.
//
// Routes:
//   POST /analytics/active-times   {metric, tzOffsetMin, cols, rows, grid} → 201
//   GET  /analytics/active-times   → {capture} | {capture: null}
//                                  ?history=n (cap 30) → {count, captures[]} newest-first
//
// Validation bounds come from src/shared/activeTimes.ts (A3.1's canonical pure
// core, D114) — the parser that produced the grid and the route that stores it
// must never disagree on what a plausible grid is.

import { desc } from 'drizzle-orm';
import { Hono } from 'hono';
import { db } from '../../db/client.ts';
import {
  ACTIVE_TIMES_COLS,
  ACTIVE_TIMES_MAX_ROWS,
  ACTIVE_TIMES_MIN_ROWS,
} from '../../shared/activeTimes.ts';
import { audienceActivity } from '../db/schema.ts';

const MAX_METRIC_LEN = 40;
// UTC−14:00 .. UTC+14:00 — the real-world timezone envelope.
const MAX_TZ_OFFSET_MIN = 840;
const MAX_HISTORY = 30;

export const analyticsRouter = new Hono();

analyticsRouter.post('/analytics/active-times', async (c) => {
  const raw = await c.req.json().catch(() => null);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return c.json({ error: 'invalid_body' }, 400);
  }
  const body = raw as Record<string, unknown>;

  const metric = typeof body.metric === 'string' ? body.metric.trim() : null;
  if (!metric || metric.length === 0 || metric.length > MAX_METRIC_LEN) {
    return c.json({ error: 'invalid_metric' }, 400);
  }

  const tzOffsetMin = body.tzOffsetMin;
  if (
    typeof tzOffsetMin !== 'number' ||
    !Number.isInteger(tzOffsetMin) ||
    Math.abs(tzOffsetMin) > MAX_TZ_OFFSET_MIN
  ) {
    return c.json({ error: 'invalid_tz_offset_min' }, 400);
  }

  const cols = body.cols;
  if (cols !== ACTIVE_TIMES_COLS) return c.json({ error: 'invalid_cols' }, 400);

  const rows = body.rows;
  if (
    typeof rows !== 'number' ||
    !Number.isInteger(rows) ||
    rows < ACTIVE_TIMES_MIN_ROWS ||
    rows > ACTIVE_TIMES_MAX_ROWS
  ) {
    return c.json({ error: 'invalid_rows' }, 400);
  }

  // grid must be exactly cols arrays of rows finite numbers; values are clamped
  // to [0,1] server-side (the parser already normalizes, but the transport is
  // untrusted) rather than rejected — an out-of-range intensity is a rounding
  // artifact, not a malformed capture.
  const grid = body.grid;
  if (!Array.isArray(grid) || grid.length !== ACTIVE_TIMES_COLS) {
    return c.json({ error: 'invalid_grid' }, 400);
  }
  const clamped: number[][] = [];
  for (const col of grid) {
    if (!Array.isArray(col) || col.length !== rows) return c.json({ error: 'invalid_grid' }, 400);
    const out: number[] = [];
    for (const v of col) {
      if (typeof v !== 'number' || !Number.isFinite(v)) {
        return c.json({ error: 'invalid_grid' }, 400);
      }
      out.push(Math.min(1, Math.max(0, v)));
    }
    clamped.push(out);
  }

  // Append-only; capturedAt is server-stamped — client clocks lie.
  const [created] = await db
    .insert(audienceActivity)
    .values({ capturedAt: new Date(), metric, tzOffsetMin, cols, rows, grid: clamped })
    .returning();
  return c.json({ capture: created }, 201);
});

analyticsRouter.get('/analytics/active-times', async (c) => {
  const historyRaw = c.req.query('history');
  const history = historyRaw === undefined ? null : intParam(historyRaw, MAX_HISTORY);
  if (historyRaw !== undefined && history === null) {
    return c.json({ error: 'invalid_history' }, 400);
  }

  // Same-millisecond captures are real under test and harmless in prod; id is
  // the append order, so it breaks the tie in favor of the later insert.
  const rowsOut = await db
    .select()
    .from(audienceActivity)
    .orderBy(desc(audienceActivity.capturedAt), desc(audienceActivity.id))
    .limit(history ?? 1);

  if (history !== null) return c.json({ count: rowsOut.length, captures: rowsOut });
  return c.json({ capture: rowsOut[0] ?? null });
});

// The harvest.ts query-param rule, minus the default: anything that isn't a
// positive integer → null so the caller can 400; over the cap → clamped.
function intParam(raw: string, max: number): number | null {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) return null;
  return Math.min(max, n);
}
