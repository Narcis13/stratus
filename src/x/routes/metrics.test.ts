// S0.4 — GET /x/metrics/best-times route wiring over the real (in-memory,
// auto-migrated) SQLite DB, which is SHARED across test files. This route
// aggregates over *every* own original in that shared DB, so seeding measured
// originals here would skew other files' exact-median assertions (e.g. the
// playbook media buckets). It therefore asserts only wiring invariants that
// hold for any DB contents — tz echo/validation and the n-gate on `top`. The
// bucketing/gate math itself is covered by the pure-function suites in
// src/test.test.ts (buildBestTimes tzOffset, rankBestTimes, bestTimeScore).

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { inArray } from 'drizzle-orm';
import { Hono } from 'hono';
import { db } from '../../db/client.ts';
import { harvestRows, harvestRuns } from '../db/schema.ts';
import { resetSettings, setSettings } from '../settings/registry.ts';
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

  // UI.4: the advice gate is `x.gates.bestTimeMinN`. Raising it can only shrink
  // `top`, which holds for any DB contents — the assertion this file can make.
  test('honors a PATCHed best-time gate', async () => {
    try {
      setSettings({ 'x.gates.bestTimeMinN': 20 });
      const res = await app.request('/x/metrics/best-times?tzOffsetMin=0');
      const body = (await res.json()) as BestTimesBody;
      expect(body.minN).toBe(20);
      expect(body.top.every((c) => c.posts >= 20)).toBe(true);
    } finally {
      resetSettings({ keys: ['x.gates.bestTimeMinN'] });
    }
  });
});

// ---------------------------------------------------------------------------
// GET /x/metrics/own-posts — the Studio hype reel's data source. Unlike the
// best-times route above, this one filters on `x.identity.selfHandle`, so it
// can seed a handle nobody else in the shared DB uses and assert exact numbers.

describe('GET /x/metrics/own-posts', () => {
  const HANDLE = 'hypereeltester';
  const runIds: string[] = [];

  async function seed(
    rows: Array<{
      tweetId: string;
      mode?: string;
      handle?: string;
      views?: number;
      likes?: number;
      comments?: number;
      reposts?: number;
      bookmarks?: number;
      tweetTime?: Date | null;
      capturedAt?: Date;
      text?: string;
    }>,
  ): Promise<void> {
    const [run] = await db
      .insert(harvestRuns)
      .values({ handle: HANDLE, mode: 'posts', scope: 'all' })
      .returning({ id: harvestRuns.id });
    if (!run) throw new Error('harvest_run_insert_failed');
    runIds.push(run.id);
    await db.insert(harvestRows).values(
      rows.map((r) => ({
        runId: run.id,
        tweetId: r.tweetId,
        handle: r.handle ?? HANDLE,
        mode: r.mode ?? 'posts',
        text: r.text ?? `own post ${r.tweetId}`,
        views: r.views ?? 0,
        likes: r.likes ?? 0,
        comments: r.comments ?? 0,
        reposts: r.reposts ?? 0,
        bookmarks: r.bookmarks ?? 0,
        tweetTime: r.tweetTime === undefined ? new Date(1_750_000_000_000) : r.tweetTime,
        capturedAt: r.capturedAt ?? new Date(1_750_000_100_000),
      })),
    );
  }

  beforeAll(async () => {
    await seed([
      // Two captures of the same tweet — the LATEST one is the outcome.
      { tweetId: 'own-a', views: 100, likes: 2, capturedAt: new Date(1_750_000_100_000) },
      {
        tweetId: 'own-a',
        views: 4200,
        likes: 61,
        comments: 9,
        reposts: 3,
        bookmarks: 11,
        capturedAt: new Date(1_750_900_000_000),
      },
      // Newer post — must sort first.
      { tweetId: 'own-b', views: 900, tweetTime: new Date(1_759_000_000_000) },
      // A reply of mine, and somebody else's post: neither belongs to this list.
      { tweetId: 'own-c', mode: 'replies', views: 77 },
      { tweetId: 'other-a', handle: 'someoneelse', views: 88 },
    ]);
  });

  afterAll(async () => {
    await db.delete(harvestRows).where(inArray(harvestRows.runId, runIds));
    await db.delete(harvestRuns).where(inArray(harvestRuns.id, runIds));
    resetSettings({ keys: ['x.identity.selfHandle'] });
  });

  interface OwnPostsBody {
    handle: string | null;
    count: number;
    posts: Array<{
      tweetId: string;
      text: string;
      tweetTime: string | null;
      views: number;
      likes: number;
      replies: number;
      reposts: number;
      bookmarks: number;
    }>;
  }

  async function fetchOwnPosts(qs = ''): Promise<OwnPostsBody> {
    const res = await app.request(`/x/metrics/own-posts${qs}`);
    expect(res.status).toBe(200);
    return (await res.json()) as OwnPostsBody;
  }

  test('newest first, one row per tweet, latest capture wins', async () => {
    setSettings({ 'x.identity.selfHandle': HANDLE });
    const body = await fetchOwnPosts();

    expect(body.handle).toBe(HANDLE);
    expect(body.posts.map((p) => p.tweetId)).toEqual(['own-b', 'own-a']);

    const a = body.posts.find((p) => p.tweetId === 'own-a');
    // The 100-view first sighting is NOT the answer — the final count is.
    expect(a).toMatchObject({ views: 4200, likes: 61, replies: 9, reposts: 3, bookmarks: 11 });
  });

  test('the mode pin and the handle filter both hold', async () => {
    setSettings({ 'x.identity.selfHandle': HANDLE });
    const ids = (await fetchOwnPosts()).posts.map((p) => p.tweetId);
    expect(ids).not.toContain('own-c'); // my reply — mode 'replies'
    expect(ids).not.toContain('other-a'); // someone else's post
  });

  test("a '@'-prefixed handle setting still matches the stored lowercase form", async () => {
    setSettings({ 'x.identity.selfHandle': `@${HANDLE.toUpperCase()}` });
    expect((await fetchOwnPosts()).count).toBe(2);
  });

  test('limit clamps the list', async () => {
    setSettings({ 'x.identity.selfHandle': HANDLE });
    const body = await fetchOwnPosts('?limit=1');
    expect(body.posts.map((p) => p.tweetId)).toEqual(['own-b']);
  });

  test('no configured handle → empty, never somebody else’s corpus', async () => {
    setSettings({ 'x.identity.selfHandle': '' });
    const body = await fetchOwnPosts();
    expect(body).toEqual({ handle: null, count: 0, posts: [] });
  });
});
