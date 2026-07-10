// S0.4 — GET /x/metrics/best-times route wiring over the real (in-memory,
// auto-migrated) SQLite DB, which is SHARED across test files. This route
// aggregates over *every* own original in that shared DB, so seeding measured
// originals here would skew other files' exact-median assertions (e.g. the
// playbook media buckets). It therefore asserts only wiring invariants that
// hold for any DB contents — tz echo/validation and the n-gate on `top`. The
// bucketing/gate math itself is covered by the pure-function suites in
// src/test.test.ts (buildBestTimes tzOffset, rankBestTimes, bestTimeScore).

import { describe, expect, test } from 'bun:test';
import { Hono } from 'hono';
import { metrics } from './metrics.ts';

const app = new Hono();
app.route('/x', metrics);

interface Cell {
  weekday: number;
  hour: number;
  posts: number;
  avgViews: number | null;
  avgViewsPerDay: number | null;
}

interface BestTimesBody {
  measuredPosts: number;
  tzOffsetMin: number;
  minN: number;
  top: Cell[];
  cells: Cell[];
}

describe('GET /x/metrics/best-times (S0.4)', () => {
  test('echoes tz + minN, gates and ranks `top`', async () => {
    const res = await app.request('/x/metrics/best-times?tzOffsetMin=0');
    expect(res.status).toBe(200);
    const body = (await res.json()) as BestTimesBody;

    expect(body.minN).toBe(3);
    expect(body.tzOffsetMin).toBe(0);
    expect(Array.isArray(body.cells)).toBe(true);

    // `top` is the advice list: every entry clears the n≥3 gate…
    expect(body.top.every((c) => c.posts >= body.minN)).toBe(true);
    // …and is sorted best-first by the age-normalized rate (raw views fallback).
    for (let i = 1; i < body.top.length; i++) {
      const prev = body.top[i - 1] as Cell;
      const cur = body.top[i] as Cell;
      const prevScore = prev.avgViewsPerDay ?? prev.avgViews ?? 0;
      const curScore = cur.avgViewsPerDay ?? cur.avgViews ?? 0;
      expect(prevScore).toBeGreaterThanOrEqual(curScore);
    }
    // Every cell in the grid is well-formed (weekday 0-6, hour 0-23).
    for (const c of body.cells) {
      expect(c.weekday).toBeGreaterThanOrEqual(0);
      expect(c.weekday).toBeLessThanOrEqual(6);
      expect(c.hour).toBeGreaterThanOrEqual(0);
      expect(c.hour).toBeLessThanOrEqual(23);
    }
  });

  test('echoes a valid non-zero tz offset', async () => {
    const res = await app.request('/x/metrics/best-times?tzOffsetMin=-180');
    expect(res.status).toBe(200);
    const body = (await res.json()) as BestTimesBody;
    expect(body.tzOffsetMin).toBe(-180);
  });

  test('defaults to UTC when tz is omitted', async () => {
    const res = await app.request('/x/metrics/best-times');
    expect(res.status).toBe(200);
    const body = (await res.json()) as BestTimesBody;
    expect(body.tzOffsetMin).toBe(0);
  });

  test('rejects a nonsense tz offset', async () => {
    const res = await app.request('/x/metrics/best-times?tzOffsetMin=99999');
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('invalid_tz_offset_min');
  });
});
