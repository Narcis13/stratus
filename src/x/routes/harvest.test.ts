// HV.1 passive timeline ingest: the synthetic per-UTC-day run, the recapture
// gate, the daily cap and the retention prune — over the real (in-memory) DB.
// The prune must never reach a hand-run harvest, so a `posts`-mode run of the
// same age is seeded beside the stale timeline one and asserted intact.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { eq, inArray } from 'drizzle-orm';
import { Hono } from 'hono';
import { db } from '../../db/client.ts';
import { harvestRows, harvestRuns, people, voiceAuthors } from '../db/schema.ts';
import {
  type AffinityAuthor,
  type ThreadDetail,
  type ThreadSummary,
  harvest,
  utcDayStart,
} from './harvest.ts';

const app = new Hono();
app.route('/x', harvest);

const AUTHOR = 'hv1_author';
const KEEP_HANDLE = 'hv1_keep';

// HV.4 affinity seeds — one handle per case the roster has to get right.
const MULTI = 'hv4_multi';
const SINGLE = 'hv4_single';
const ROSTER = 'hv4_roster';
const VOICE = 'hv4_voice';
const RETIRED = 'hv4_retired';
const OLD = 'hv4_old';
const HAND = 'hv4_hand';
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
    .where(inArray(harvestRuns.mode, ['timeline', 'thread']));
  const ids = timeline.map((r) => r.id);
  if (keepRunId) ids.push(keepRunId);
  if (ids.length > 0) {
    await db.delete(harvestRows).where(inArray(harvestRows.runId, ids));
    await db.delete(harvestRuns).where(inArray(harvestRuns.id, ids));
  }
  // Shared in-memory DB (§9): the affinity seeds live in tables other suites read.
  await db.delete(people).where(inArray(people.handle, [ROSTER, RETIRED]));
  await db.delete(voiceAuthors).where(eq(voiceAuthors.handle, VOICE));
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
  const created: string[] = [];

  async function createRun(body: unknown): Promise<{ status: number; body: { error?: string } }> {
    const res = await app.request('/x/harvest/runs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const parsed = (await res.json()) as { id?: string; error?: string };
    if (parsed.id) created.push(parsed.id);
    return { status: res.status, body: parsed };
  }

  afterAll(async () => {
    if (created.length > 0) await db.delete(harvestRuns).where(inArray(harvestRuns.id, created));
  });

  test('still refuses to create a timeline run (passive runs are server-only)', async () => {
    const { status, body } = await createRun({
      handle: KEEP_HANDLE,
      mode: 'timeline',
      scope: 'all',
    });
    expect(status).toBe(400);
    expect(body.error).toBe('invalid_mode');
  });

  // The extension's rolling 48h window. `scope` is free text in the column, so
  // this whitelist is the only thing standing between the preset and a 400.
  test('accepts the recent scope', async () => {
    const { status } = await createRun({ handle: KEEP_HANDLE, mode: 'replies', scope: 'recent' });
    expect(status).toBe(201);
    const [run] = await db
      .select()
      .from(harvestRuns)
      .where(eq(harvestRuns.id, created[created.length - 1] ?? ''));
    expect(run?.scope).toBe('recent');
  });

  test('still refuses a scope outside the whitelist', async () => {
    for (const scope of ['last-48h', 'passive', '', 48]) {
      const { status, body } = await createRun({ handle: KEEP_HANDLE, mode: 'replies', scope });
      expect(status).toBe(400);
      expect(body.error).toBe('invalid_scope');
    }
  });
});

// HV.4. Seeded directly (not through the ingest) so capturedAt can span days:
// distinct UTC days are the ranking signal and the noise floor, and both need a
// history the 30-minute recapture gate would never let one request build.
describe('GET /x/harvest/affinity', () => {
  let seedRunId = '';
  let nextTweetId = 78000000;

  async function seed(handle: string, dayOffsets: number[], views = 1000): Promise<void> {
    await db.insert(harvestRows).values(
      dayOffsets.map((d) => ({
        runId: seedRunId,
        tweetId: String(nextTweetId++),
        handle,
        mode: 'timeline',
        text: 'affinity seed',
        views,
        capturedAt: new Date(Date.now() - d * DAY_MS),
      })),
    );
  }

  interface AffinityBody {
    days: number;
    minDays: number;
    authors: AffinityAuthor[];
  }

  async function get(qs = ''): Promise<{ status: number; body: AffinityBody }> {
    const res = await app.request(`/x/harvest/affinity${qs}`);
    return { status: res.status, body: (await res.json()) as AffinityBody };
  }

  const find = (b: AffinityBody, handle: string): AffinityAuthor | undefined =>
    b.authors.find((a) => a.handle === handle);
  const rank = (b: AffinityBody, handle: string): number =>
    b.authors.findIndex((a) => a.handle === handle);

  beforeAll(async () => {
    // Its own run, created NOW — the rows are backdated, the run is not, so the
    // 60-day prune on the passive path can never take these out from under us.
    const [run] = await db
      .insert(harvestRuns)
      .values({ handle: 'timeline', mode: 'timeline', scope: 'passive' })
      .returning();
    seedRunId = run?.id ?? '';

    await seed(MULTI, [1, 2, 3, 4]);
    await seed(SINGLE, [1, 1]);
    await seed(ROSTER, [1, 1, 2, 3, 3]);
    // Same 3 days as ROSTER but fewer sightings — the tiebreak under test. The
    // fourth row is a different view count so avgViews is not just `views`.
    await seed(VOICE, [1, 2, 3], 100);
    await seed(VOICE, [1], 500);
    await seed(RETIRED, [1, 2, 3]);
    await seed(OLD, [40, 41, 42]);

    await db.insert(people).values([
      { handle: ROSTER, stage: 'engaged', source: 'manual' },
      { handle: RETIRED, stage: 'mutual', source: 'manual', retired: true },
    ]);
    await db.insert(voiceAuthors).values({ handle: VOICE });
  });

  test('ranks by distinct days, then sightings, and floors the noise', async () => {
    const { status, body } = await get();
    expect(status).toBe(200);
    expect(body.days).toBe(30);
    expect(body.minDays).toBe(3);

    // 4 distinct days beats 3; the two 3-day authors break the tie on sightings.
    expect(rank(body, MULTI)).toBeLessThan(rank(body, ROSTER));
    expect(rank(body, ROSTER)).toBeLessThan(rank(body, VOICE));
    expect(find(body, SINGLE)).toBeUndefined();

    const multi = find(body, MULTI);
    expect(multi?.distinctDays).toBe(4);
    expect(multi?.sightings).toBe(4);
    expect(new Date(multi?.lastSeenAt ?? 0).getTime()).toBeGreaterThan(Date.now() - 2 * DAY_MS);

    const roster = find(body, ROSTER);
    expect(roster?.distinctDays).toBe(3);
    expect(roster?.sightings).toBe(5);
  });

  test('joins stage and roster membership; a retired person is known, not a candidate', async () => {
    const { body } = await get();

    expect(find(body, ROSTER)?.stage).toBe('engaged');
    expect(find(body, ROSTER)?.inRoster).toBe(true);

    // Voice-only: worth flagging as known, but there is no relationship stage.
    expect(find(body, VOICE)?.stage).toBeNull();
    expect(find(body, VOICE)?.inRoster).toBe(true);
    expect(find(body, VOICE)?.avgViews).toBe(200); // (100+100+100+500)/4

    expect(find(body, RETIRED)?.stage).toBeNull();
    expect(find(body, RETIRED)?.inRoster).toBe(true);

    // The whole point of the surface: someone the algorithm pushes who has no file.
    expect(find(body, MULTI)?.stage).toBeNull();
    expect(find(body, MULTI)?.inRoster).toBe(false);
  });

  test('honours the window, the floor and the limit', async () => {
    const dflt = await get();
    expect(find(dflt.body, OLD)).toBeUndefined();

    const wide = await get('?days=90');
    expect(wide.body.days).toBe(90);
    expect(find(wide.body, OLD)?.distinctDays).toBe(3);

    const floored = await get('?minDays=1');
    expect(floored.body.minDays).toBe(1);
    expect(find(floored.body, SINGLE)?.sightings).toBe(2);

    const capped = await get('?limit=1');
    expect(capped.body.authors.length).toBe(1);

    // Out of range clamps rather than 400s (the runs-limit rule).
    expect((await get('?days=1')).body.days).toBe(7);
    expect((await get('?limit=999')).body.authors.length).toBeLessThanOrEqual(50);
  });

  test('refuses params that are not positive integers', async () => {
    for (const [qs, error] of [
      ['?days=0', 'invalid_days'],
      ['?days=abc', 'invalid_days'],
      ['?days=1.5', 'invalid_days'],
      ['?limit=0', 'invalid_limit'],
      ['?minDays=0', 'invalid_min_days'],
    ] as const) {
      const res = await app.request(`/x/harvest/affinity${qs}`);
      expect(res.status).toBe(400);
      expect(((await res.json()) as { error: string }).error).toBe(error);
    }
  });

  test('never mixes hand-run harvests into the ambient corpus', async () => {
    await db.insert(harvestRows).values(
      [1, 2, 3].map((d) => ({
        runId: keepRunId,
        tweetId: String(nextTweetId++),
        handle: HAND,
        mode: 'posts',
        text: 'hand-run harvest',
        views: 500,
        capturedAt: new Date(Date.now() - d * DAY_MS),
      })),
    );

    expect(find((await get('?minDays=1')).body, HAND)).toBeUndefined();
  });
});

// TH.1: one atomic capture — the server owns the pairing and the ordering.
describe('POST /x/harvest/thread', () => {
  const ROOT_ID = '79000000';
  const ROOT_AUTHOR = 'th1_root';

  interface ThreadBody {
    runId: string;
    rootTweetId: string;
    inserted: number;
    replies: number;
    skippedDuplicate: number;
  }

  function threadRow(tweetId: string, extra: Record<string, unknown> = {}) {
    return {
      tweetId,
      handle: 'th1_replier',
      text: `reply ${tweetId}`,
      comments: 1,
      reposts: 0,
      likes: 4,
      bookmarks: 1,
      views: 900,
      time: '2026-08-13T10:00:00Z',
      ...extra,
    };
  }

  const rootRow = () =>
    threadRow(ROOT_ID, {
      handle: ROOT_AUTHOR,
      text: 'the root of the thread',
      comments: 42,
      reposts: 3,
      likes: 120,
      bookmarks: 9,
      views: 30000,
      time: '2026-08-13T09:00:00Z',
    });

  async function postThread<T = ThreadBody>(body: unknown): Promise<{ status: number; body: T }> {
    const res = await app.request('/x/harvest/thread', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    return { status: res.status, body: (await res.json()) as T };
  }

  async function rowsOf(runId: string) {
    return db
      .select()
      .from(harvestRows)
      .where(eq(harvestRows.runId, runId))
      .orderBy(harvestRows.groupPosition);
  }

  test('writes one run and 1 + n rows, all mode=thread', async () => {
    const { status, body } = await postThread({
      root: rootRow(),
      replies: ['79000001', '79000002', '79000003'].map((id) => threadRow(id)),
    });
    expect(status).toBe(201);
    expect(body.inserted).toBe(4);
    expect(body.replies).toBe(3);
    expect(body.skippedDuplicate).toBe(0);
    expect(body.rootTweetId).toBe(ROOT_ID);

    const run = await runById(body.runId);
    expect(run?.mode).toBe('thread');
    expect(run?.scope).toBe('all');
    expect(run?.handle).toBe(ROOT_AUTHOR);
    expect(run?.rootTweetId).toBe(ROOT_ID);
    expect(run?.rowCount).toBe(4);

    const rows = await rowsOf(body.runId);
    expect(rows.length).toBe(4);
    expect(rows.every((r) => r.mode === 'thread')).toBe(true);

    const root = rows[0];
    expect(root?.tweetId).toBe(ROOT_ID);
    expect(root?.groupPosition).toBe(0);
    expect(root?.views).toBe(30000);
    expect(root?.origTweetId).toBeNull();
    expect(root?.origHandle).toBeNull();
    expect(root?.matchedDraftId).toBeNull();

    expect(rows.slice(1).map((r) => r.groupPosition)).toEqual([1, 2, 3]);
    expect(rows.slice(1).map((r) => r.tweetId)).toEqual(['79000001', '79000002', '79000003']);
    for (const r of rows.slice(1)) {
      expect(r.origTweetId).toBe(ROOT_ID);
      expect(r.origHandle).toBe(ROOT_AUTHOR);
      expect(r.origText).toBe('the root of the thread');
      expect(r.origComments).toBe(42);
      expect(r.origLikes).toBe(120);
      expect(r.origViews).toBe(30000);
      expect(r.origTime?.toISOString()).toBe('2026-08-13T09:00:00.000Z');
    }
  });

  test('ignores client-supplied groupPosition and orig — the server stamps both', async () => {
    const { status, body } = await postThread({
      root: rootRow(),
      replies: [
        threadRow('79000101', {
          groupPosition: 47,
          orig: { tweetId: '12345', handle: 'someone_else', text: 'forged', views: 1 },
        }),
      ],
    });
    expect(status).toBe(201);

    const rows = await rowsOf(body.runId);
    const reply = rows[1];
    expect(reply?.groupPosition).toBe(1);
    expect(reply?.origTweetId).toBe(ROOT_ID);
    expect(reply?.origHandle).toBe(ROOT_AUTHOR);
    expect(reply?.origText).toBe('the root of the thread');
    expect(reply?.origViews).toBe(30000);
  });

  test('drops duplicate replies and any reply equal to the root', async () => {
    const { status, body } = await postThread({
      root: rootRow(),
      replies: [
        threadRow('79000201'),
        threadRow('79000201'), // re-sighted while scrolling
        threadRow(ROOT_ID), // the root renders inside the conversation
      ],
    });
    expect(status).toBe(201);
    expect(body.inserted).toBe(2);
    expect(body.replies).toBe(1);
    expect(body.skippedDuplicate).toBe(2);

    const rows = await rowsOf(body.runId);
    expect(rows.map((r) => r.tweetId)).toEqual([ROOT_ID, '79000201']);
    expect((await runById(body.runId))?.rowCount).toBe(2);
  });

  test('accepts a thread nobody has replied to yet', async () => {
    const { status, body } = await postThread({ root: rootRow(), replies: [] });
    expect(status).toBe(201);
    expect(body.inserted).toBe(1);
    expect(body.replies).toBe(0);

    const rows = await rowsOf(body.runId);
    expect(rows.length).toBe(1);
    expect(rows[0]?.groupPosition).toBe(0);
  });

  test('rejects malformed payloads before touching the DB', async () => {
    const before = await db
      .select({ id: harvestRuns.id })
      .from(harvestRuns)
      .where(eq(harvestRuns.mode, 'thread'));

    expect((await postThread([])).status).toBe(400);
    expect((await postThread({ replies: [] })).status).toBe(400);
    expect((await postThread({ root: rootRow() })).status).toBe(400);

    const badRoot = await postThread<{ error: string; reason: string }>({
      root: threadRow('not-an-id'),
      replies: [],
    });
    expect(badRoot.status).toBe(400);
    expect(badRoot.body.error).toBe('invalid_root');
    expect(badRoot.body.reason).toBe('invalid_row_tweet_id');

    const badReply = await postThread<{ error: string; index: number }>({
      root: rootRow(),
      replies: [threadRow('79000301'), threadRow('79000302'), threadRow('nope')],
    });
    expect(badReply.status).toBe(400);
    expect(badReply.body.error).toBe('invalid_row_tweet_id');
    expect(badReply.body.index).toBe(2);

    const tooMany = await postThread<{ error: string; max: number }>({
      root: rootRow(),
      replies: Array.from({ length: 500 }, (_, i) => threadRow(String(79100000 + i))),
    });
    expect(tooMany.status).toBe(400);
    expect(tooMany.body.error).toBe('too_many_rows');
    expect(tooMany.body.max).toBe(500);

    const after = await db
      .select({ id: harvestRuns.id })
      .from(harvestRuns)
      .where(eq(harvestRuns.mode, 'thread'));
    expect(after.length).toBe(before.length);
  });

  test('a client cannot forge a thread run through POST /harvest/runs', async () => {
    const res = await app.request('/x/harvest/runs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ handle: ROOT_AUTHOR, mode: 'thread', scope: 'all' }),
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe('invalid_mode');
  });
});

// TH.2 — the read layer over the TH.1 corpus. Every case here is about the two
// things the write side made possible: grouping repeated captures of one root,
// and reading a named earlier capture (the longitudinal axis).
describe('GET /x/harvest/threads', () => {
  const ROOT_A = '79500000';
  const ROOT_B = '79500100';
  const AUTHOR_A = 'th2_root_a';
  const AUTHOR_B = 'th2_root_b';
  const OTHER = 'th2_other';
  const HOUR_MS = 60 * 60 * 1000;

  let runA1 = '';
  let runA2 = '';
  let runB = '';

  function post(tweetId: string, handle: string, extra: Record<string, unknown> = {}) {
    return {
      tweetId,
      handle,
      text: `text ${tweetId}`,
      comments: 1,
      reposts: 0,
      likes: 3,
      bookmarks: 0,
      views: 700,
      time: '2026-08-13T10:00:00Z',
      ...extra,
    };
  }

  async function capture(body: unknown): Promise<string> {
    const res = await app.request('/x/harvest/thread', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    expect(res.status).toBe(201);
    return ((await res.json()) as { runId: string }).runId;
  }

  // The run clock is second-resolution, so back-to-back captures would tie on
  // created_at — stamp the axis explicitly instead of racing it.
  async function backdate(id: string, msAgo: number) {
    await db
      .update(harvestRuns)
      .set({ createdAt: new Date(Date.now() - msAgo) })
      .where(eq(harvestRuns.id, id));
  }

  async function deleteThreadRuns() {
    const runs = await db
      .select({ id: harvestRuns.id })
      .from(harvestRuns)
      .where(eq(harvestRuns.mode, 'thread'));
    const ids = runs.map((r) => r.id);
    if (ids.length === 0) return;
    await db.delete(harvestRows).where(inArray(harvestRows.runId, ids));
    await db.delete(harvestRuns).where(inArray(harvestRuns.id, ids));
  }

  beforeAll(async () => {
    // The write-side suite above left its own captures behind; this suite asserts
    // over the WHOLE thread corpus, so start from a known-empty one.
    await deleteThreadRuns();

    runA1 = await capture({
      root: post(ROOT_A, AUTHOR_A, { views: 1000, comments: 40 }),
      replies: [post('79500001', OTHER), post('79500002', OTHER)],
    });
    runB = await capture({
      root: post(ROOT_B, AUTHOR_B, { views: 55 }),
      replies: [post('79500101', OTHER)],
    });
    runA2 = await capture({
      root: post(ROOT_A, AUTHOR_A, { views: 2000, comments: 41 }),
      replies: [
        post('79500001', OTHER),
        post('79500003', AUTHOR_A), // the author continuing their own thread
        post('79500004', OTHER),
      ],
    });

    await backdate(runA1, 3 * HOUR_MS);
    await backdate(runB, 2 * HOUR_MS);
    await backdate(runA2, 1 * HOUR_MS);
  });

  async function get<T>(path: string): Promise<{ status: number; body: T }> {
    const res = await app.request(path);
    return { status: res.status, body: (await res.json()) as T };
  }

  test('groups repeated captures per root and reports the latest one', async () => {
    const { status, body } = await get<{ threads: ThreadSummary[] }>('/x/harvest/threads');
    expect(status).toBe(200);
    expect(body.threads.length).toBe(2);

    const [first, second] = body.threads;
    expect(first?.rootTweetId).toBe(ROOT_A);
    expect(first?.captures).toBe(2);
    expect(first?.runId).toBe(runA2);
    expect(first?.rootViews).toBe(2000); // the latest capture's numbers
    expect(first?.rootComments).toBe(41);
    expect(first?.replyCount).toBe(3);
    expect(first?.handle).toBe(AUTHOR_A);
    expect(Date.parse(first?.capturedAt ?? '')).toBeGreaterThan(
      Date.parse(second?.capturedAt ?? ''),
    );

    expect(second?.rootTweetId).toBe(ROOT_B);
    expect(second?.captures).toBe(1);
    expect(second?.replyCount).toBe(1);
  });

  test('limit is clamped and a non-integer is refused', async () => {
    const one = await get<{ threads: ThreadSummary[] }>('/x/harvest/threads?limit=1');
    expect(one.body.threads.length).toBe(1);
    expect(one.body.threads[0]?.rootTweetId).toBe(ROOT_A);

    const huge = await get<{ threads: ThreadSummary[] }>('/x/harvest/threads?limit=9999');
    expect(huge.body.threads.length).toBe(2);

    const bad = await get<{ error: string }>('/x/harvest/threads?limit=abc');
    expect(bad.status).toBe(400);
    expect(bad.body.error).toBe('invalid_limit');
  });

  test('detail defaults to the latest capture, ordered by position', async () => {
    const { status, body } = await get<ThreadDetail>(`/x/harvest/threads/${ROOT_A}`);
    expect(status).toBe(200);
    expect(body.runId).toBe(runA2);
    expect(body.rootTweetId).toBe(ROOT_A);
    expect(body.root.position).toBe(0);
    expect(body.root.views).toBe(2000);
    expect(body.root.isAuthor).toBe(true);

    expect(body.replies.map((r) => r.position)).toEqual([1, 2, 3]);
    expect(body.replies.map((r) => r.tweetId)).toEqual(['79500001', '79500003', '79500004']);
    expect(body.replies.map((r) => r.isAuthor)).toEqual([false, true, false]);
    expect(body.replyCount).toBe(3);

    // Every capture of this root, newest first — the axis ?runId reads along.
    expect(body.captures.map((c) => c.runId)).toEqual([runA2, runA1]);
    expect(body.captures.map((c) => c.rowCount)).toEqual([4, 3]);
    expect(body.capturedAt).toBe(body.captures[0]?.capturedAt ?? '');
  });

  test('?runId reads a named earlier capture', async () => {
    const { status, body } = await get<ThreadDetail>(`/x/harvest/threads/${ROOT_A}?runId=${runA1}`);
    expect(status).toBe(200);
    expect(body.runId).toBe(runA1);
    expect(body.root.views).toBe(1000); // …and the metrics are that capture's
    expect(body.root.comments).toBe(40);
    expect(body.replies.map((r) => r.tweetId)).toEqual(['79500001', '79500002']);
    expect(body.replyCount).toBe(2);
  });

  test('rejects a malformed root id and unknown thread/capture', async () => {
    const badId = await get<{ error: string }>('/x/harvest/threads/abc');
    expect(badId.status).toBe(400);
    expect(badId.body.error).toBe('invalid_root_tweet_id');

    const unknown = await get<{ error: string }>('/x/harvest/threads/79599999');
    expect(unknown.status).toBe(404);
    expect(unknown.body.error).toBe('thread_not_found');

    // A well-formed runId that belongs to the OTHER thread is not a capture here.
    const foreign = await get<{ error: string }>(`/x/harvest/threads/${ROOT_A}?runId=${runB}`);
    expect(foreign.status).toBe(404);
    expect(foreign.body.error).toBe('capture_not_found');

    const notUuid = await get<{ error: string }>(`/x/harvest/threads/${ROOT_A}?runId=nope`);
    expect(notUuid.status).toBe(404);
    expect(notUuid.body.error).toBe('capture_not_found');
  });

  // Last on purpose: it empties the corpus the tests above read.
  test('an empty corpus answers with an empty list, never an in ()', async () => {
    await deleteThreadRuns();
    const { status, body } = await get<{ threads: ThreadSummary[] }>('/x/harvest/threads');
    expect(status).toBe(200);
    expect(body.threads).toEqual([]);
  });
});
