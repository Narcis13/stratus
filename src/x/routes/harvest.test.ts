// HV.1 passive timeline ingest: the synthetic per-UTC-day run, the recapture
// gate, the daily cap and the retention prune — over the real (in-memory) DB.
// The prune must never reach a hand-run harvest, so a `posts`-mode run of the
// same age is seeded beside the stale timeline one and asserted intact.

import { afterAll, describe, expect, test } from 'bun:test';
import { eq, inArray } from 'drizzle-orm';
import { Hono } from 'hono';
import { db } from '../../db/client.ts';
import { harvestRows, harvestRuns } from '../db/schema.ts';
import { harvest, utcDayStart } from './harvest.ts';

const app = new Hono();
app.route('/x', harvest);

const AUTHOR = 'hv1_author';
const KEEP_HANDLE = 'hv1_keep';
const DAY_MS = 24 * 60 * 60 * 1000;
const DAILY_CAP = 2000;

let runId = '';
let keepRunId = '';

function row(tweetId: string, extra: Record<string, unknown> = {}) {
  return {
    tweetId,
    handle: AUTHOR,
    text: 'passive timeline row',
    comments: 2,
    reposts: 1,
    likes: 9,
    bookmarks: 0,
    views: 1500,
    time: '2026-07-23T09:00:00Z',
    ...extra,
  };
}

interface PassiveBody {
  runId: string;
  inserted: number;
  skippedRecent: number;
  skippedCap: number;
}

async function post<T = PassiveBody>(body: unknown): Promise<{ status: number; body: T }> {
  const res = await app.request('/x/harvest/passive', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as T };
}

async function runById(id: string) {
  const [r] = await db.select().from(harvestRuns).where(eq(harvestRuns.id, id));
  return r;
}

afterAll(async () => {
  const timeline = await db
    .select({ id: harvestRuns.id })
    .from(harvestRuns)
    .where(eq(harvestRuns.mode, 'timeline'));
  const ids = timeline.map((r) => r.id);
  if (keepRunId) ids.push(keepRunId);
  if (ids.length > 0) {
    await db.delete(harvestRows).where(inArray(harvestRows.runId, ids));
    await db.delete(harvestRuns).where(inArray(harvestRuns.id, ids));
  }
});

describe('utcDayStart', () => {
  test('floors to midnight UTC regardless of the local clock', () => {
    expect(utcDayStart(new Date('2026-07-23T23:59:59.999Z')).toISOString()).toBe(
      '2026-07-23T00:00:00.000Z',
    );
    expect(utcDayStart(new Date('2026-07-23T00:00:00.000Z')).toISOString()).toBe(
      '2026-07-23T00:00:00.000Z',
    );
  });
});

describe('POST /x/harvest/passive', () => {
  test('rejects malformed bodies before touching the DB', async () => {
    expect((await post([])).status).toBe(400);
    expect((await post({})).status).toBe(400);
    expect((await post({ rows: [] })).status).toBe(400);

    const tooMany = Array.from({ length: 101 }, (_, i) => row(String(77100000 + i)));
    const over = await post<{ error: string; max: number }>({ rows: tooMany });
    expect(over.status).toBe(400);
    expect(over.body.error).toBe('too_many_rows');
    expect(over.body.max).toBe(100);

    const bad = await post<{ error: string; index: number }>({
      rows: [row('77000001'), row('not-an-id')],
    });
    expect(bad.status).toBe(400);
    expect(bad.body.error).toBe('invalid_row_tweet_id');
    expect(bad.body.index).toBe(1);

    const runs = await db.select().from(harvestRuns).where(eq(harvestRuns.mode, 'timeline'));
    expect(runs.length).toBe(0);
  });

  test('creates one server-owned run per UTC day and inserts the batch', async () => {
    const { status, body } = await post({
      rows: [row('77000001'), row('77000002'), row('77000003')],
    });
    expect(status).toBe(201);
    expect(body.inserted).toBe(3);
    expect(body.skippedRecent).toBe(0);
    expect(body.skippedCap).toBe(0);
    runId = body.runId;

    const run = await runById(runId);
    expect(run?.handle).toBe('timeline');
    expect(run?.mode).toBe('timeline');
    expect(run?.scope).toBe('passive');
    expect(run?.rowCount).toBe(3);
    expect(run?.createdAt.getTime()).toBeGreaterThanOrEqual(utcDayStart(new Date()).getTime());

    const rows = await db.select().from(harvestRows).where(eq(harvestRows.runId, runId));
    expect(rows.length).toBe(3);
    const first = rows.find((r) => r.tweetId === '77000001');
    expect(first?.mode).toBe('timeline');
    expect(first?.views).toBe(1500);
    expect(first?.origHandle).toBeNull();
    expect(first?.groupPosition).toBeNull();
    expect(first?.matchedDraftId).toBeNull();
  });

  test('reuses the same run for a second same-day batch', async () => {
    const { body } = await post({ rows: [row('77000004'), row('77000005')] });
    expect(body.runId).toBe(runId);
    expect(body.inserted).toBe(2);
    expect((await runById(runId))?.rowCount).toBe(5);
  });

  test('skips re-captures inside the window and in-batch duplicates', async () => {
    const { body } = await post({
      rows: [row('77000001'), row('77000006'), row('77000006')],
    });
    expect(body.inserted).toBe(1);
    expect(body.skippedRecent).toBe(2);
    expect(body.skippedCap).toBe(0);
    expect((await runById(runId))?.rowCount).toBe(6);

    const seen = await db.select().from(harvestRows).where(eq(harvestRows.tweetId, '77000001'));
    expect(seen.length).toBe(1);
  });

  test('accepts a re-capture once the window has passed', async () => {
    await db
      .update(harvestRows)
      .set({ capturedAt: new Date(Date.now() - 31 * 60 * 1000) })
      .where(eq(harvestRows.tweetId, '77000002'));

    const { body } = await post({ rows: [row('77000002')] });
    expect(body.inserted).toBe(1);
    expect(body.skippedRecent).toBe(0);

    const series = await db.select().from(harvestRows).where(eq(harvestRows.tweetId, '77000002'));
    expect(series.length).toBe(2);
  });

  test('caps the day and reports the overflow', async () => {
    const before = (await runById(runId))?.rowCount ?? 0;
    await db
      .update(harvestRuns)
      .set({ rowCount: DAILY_CAP - 1 })
      .where(eq(harvestRuns.id, runId));

    const { body } = await post({
      rows: [row('77000101'), row('77000102'), row('77000103')],
    });
    expect(body.inserted).toBe(1);
    expect(body.skippedCap).toBe(2);
    expect((await runById(runId))?.rowCount).toBe(DAILY_CAP);

    await db
      .update(harvestRuns)
      .set({ rowCount: before + 1 })
      .where(eq(harvestRuns.id, runId));
  });

  test('prunes stale timeline runs only — a hand-run harvest of the same age survives', async () => {
    const old = new Date(Date.now() - 61 * DAY_MS);

    const [stale] = await db
      .insert(harvestRuns)
      .values({ handle: 'timeline', mode: 'timeline', scope: 'passive', createdAt: old })
      .returning();
    const staleId = stale?.id ?? '';
    await db.insert(harvestRows).values({
      runId: staleId,
      tweetId: '77000901',
      handle: AUTHOR,
      mode: 'timeline',
      text: 'stale',
      capturedAt: old,
    });

    const [keep] = await db
      .insert(harvestRuns)
      .values({ handle: KEEP_HANDLE, mode: 'posts', scope: 'all', createdAt: old })
      .returning();
    keepRunId = keep?.id ?? '';
    await db.insert(harvestRows).values({
      runId: keepRunId,
      tweetId: '77000902',
      handle: KEEP_HANDLE,
      mode: 'posts',
      text: 'hand-run harvest',
      capturedAt: old,
    });

    const { body } = await post({ rows: [row('77000201')] });
    expect(body.runId).toBe(runId);
    expect(body.inserted).toBe(1);

    expect(await runById(staleId)).toBeUndefined();
    expect((await db.select().from(harvestRows).where(eq(harvestRows.runId, staleId))).length).toBe(
      0,
    );

    expect((await runById(keepRunId))?.mode).toBe('posts');
    expect(
      (await db.select().from(harvestRows).where(eq(harvestRows.runId, keepRunId))).length,
    ).toBe(1);
  });
});

describe('POST /x/harvest/runs', () => {
  test('still refuses to create a timeline run (passive runs are server-only)', async () => {
    const res = await app.request('/x/harvest/runs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ handle: KEEP_HANDLE, mode: 'timeline', scope: 'all' }),
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe('invalid_mode');
  });
});
