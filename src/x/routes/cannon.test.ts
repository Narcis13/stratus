// CQ.2 cannon roster routes over the real (in-memory, auto-migrated) SQLite DB;
// bun test runs with SQLITE_PATH=:memory:. The DB is shared across suites, so
// every cannon_target and every harvest run/row this file creates is deleted in
// afterAll.

import { afterAll, describe, expect, test } from 'bun:test';
import { eq, inArray } from 'drizzle-orm';
import { Hono } from 'hono';
import { db } from '../../db/client.ts';
import { CANNON_MIN_SAMPLE } from '../cannon/roster.ts';
import { cannonTargets, harvestRows, harvestRuns } from '../db/schema.ts';
import { cannonRouter } from './cannon.ts';

const app = new Hono();
app.route('/x', cannonRouter);

const createdHandles: string[] = [];
const createdRunIds: string[] = [];

// Distinctive enough not to collide with another suite's fixtures in the shared DB.
const H_RICH = 'cq2rich';
const H_THIN = 'cq2thin';
const H_CAND = 'cq2cand';

async function send<T>(
  path: string,
  method: string,
  body?: unknown,
): Promise<{ status: number; body: T }> {
  const res = await app.request(path, {
    method,
    ...(body !== undefined
      ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }
      : {}),
  });
  const parsed = res.status === 204 ? (undefined as T) : ((await res.json()) as T);
  return { status: res.status, body: parsed };
}

interface TargetView {
  handle: string;
  displayName: string | null;
  language: string | null;
  notes: string | null;
  score: number | null;
  medianViews: number | null;
  medianComments: number | null;
  sampleN: number;
  scoredAt: string | null;
  active: boolean;
  addedAt: string;
  staleDays: number | null;
  belowFloor: boolean;
}

async function addTarget(body: Record<string, unknown>): Promise<TargetView> {
  const res = await send<TargetView>('/x/cannon/targets', 'POST', body);
  expect(res.status).toBe(201);
  createdHandles.push(res.body.handle);
  return res.body;
}

/** Seed `count` harvested posts for a handle. `mode` is the discriminator the
 *  scorer filters on — 'replies' rows must never be counted. */
async function seedHarvest(
  handle: string,
  count: number,
  opts: { mode?: string; views?: number; comments?: number; idPrefix?: string } = {},
): Promise<void> {
  const mode = opts.mode ?? 'posts';
  const [run] = await db
    .insert(harvestRuns)
    .values({ handle, mode, scope: 'all' })
    .returning({ id: harvestRuns.id });
  if (!run) throw new Error('harvest_run_insert_failed');
  createdRunIds.push(run.id);

  const prefix = opts.idPrefix ?? `${handle}-${mode}`;
  await db.insert(harvestRows).values(
    Array.from({ length: count }, (_, i) => ({
      runId: run.id,
      tweetId: `${prefix}-${i}`,
      handle,
      mode,
      text: `post ${i}`,
      views: opts.views ?? 1000,
      comments: opts.comments ?? 4,
      tweetTime: new Date(1_700_000_000_000 + i * 60_000),
      capturedAt: new Date(1_700_000_100_000 + i * 60_000),
    })),
  );
}

afterAll(async () => {
  if (createdRunIds.length > 0) {
    await db.delete(harvestRows).where(inArray(harvestRows.runId, createdRunIds));
    await db.delete(harvestRuns).where(inArray(harvestRuns.id, createdRunIds));
  }
  if (createdHandles.length > 0) {
    await db.delete(cannonTargets).where(inArray(cannonTargets.handle, createdHandles));
  }
});

describe('cannon targets CRUD', () => {
  test('create → list → patch → delete round-trip', async () => {
    const created = await addTarget({ handle: 'cq2crud', displayName: 'Crud', notes: 'camp them' });
    expect(created.handle).toBe('cq2crud');
    expect(created.active).toBe(true);
    // Never scored: null score, null staleDays, and belowFloor is FALSE —
    // absent is not below (§7.11).
    expect(created.score).toBeNull();
    expect(created.sampleN).toBe(0);
    expect(created.staleDays).toBeNull();
    expect(created.belowFloor).toBe(false);

    const listed = await send<{ floor: number; targets: TargetView[] }>('/x/cannon/targets', 'GET');
    expect(listed.status).toBe(200);
    expect(typeof listed.body.floor).toBe('number');
    expect(listed.body.targets.some((t) => t.handle === 'cq2crud')).toBe(true);

    const patched = await send<TargetView>('/x/cannon/targets/cq2crud', 'PATCH', {
      active: false,
      language: 'ro',
    });
    expect(patched.status).toBe(200);
    expect(patched.body.active).toBe(false);
    expect(patched.body.language).toBe('ro');

    const filtered = await send<{ targets: TargetView[] }>('/x/cannon/targets?active=true', 'GET');
    expect(filtered.body.targets.some((t) => t.handle === 'cq2crud')).toBe(false);

    const deleted = await send('/x/cannon/targets/cq2crud', 'DELETE');
    expect(deleted.status).toBe(204);
    const gone = await send('/x/cannon/targets/cq2crud', 'DELETE');
    expect(gone.status).toBe(404);
  });

  test('@Handle normalizes to handle on create and on the :handle routes', async () => {
    const created = await addTarget({ handle: '@CQ2Norm' });
    expect(created.handle).toBe('cq2norm');

    const patched = await send<TargetView>('/x/cannon/targets/@CQ2Norm', 'PATCH', {
      notes: 'same row',
    });
    expect(patched.status).toBe(200);
    expect(patched.body.handle).toBe('cq2norm');
  });

  test('re-POST is fill-only — a scored row keeps its score and added_at', async () => {
    const first = await addTarget({ handle: 'cq2fill', notes: 'original' });

    await db
      .update(cannonTargets)
      .set({
        score: 412.5,
        medianViews: 1650,
        medianComments: 3,
        sampleN: 12,
        scoredAt: new Date(),
      })
      .where(eq(cannonTargets.handle, 'cq2fill'));

    const again = await send<TargetView>('/x/cannon/targets', 'POST', {
      handle: 'cq2fill',
      notes: 'a different note',
      displayName: 'Filled In',
    });
    expect(again.status).toBe(201);
    expect(again.body.score).toBe(412.5);
    expect(again.body.sampleN).toBe(12);
    expect(again.body.addedAt).toBe(first.addedAt);
    // notes were already set → untouched; displayName was null → filled.
    expect(again.body.notes).toBe('original');
    expect(again.body.displayName).toBe('Filled In');
  });

  test('validation: invalid_handle / empty_patch / 404 on an absent handle', async () => {
    expect((await send('/x/cannon/targets', 'POST', { handle: 'no spaces!' })).status).toBe(400);
    expect(
      (await send<{ error: string }>('/x/cannon/targets', 'POST', { handle: '' })).body.error,
    ).toBe('invalid_handle');
    expect(
      (await send<{ error: string }>('/x/cannon/targets/not!a!handle', 'PATCH', { active: true }))
        .body.error,
    ).toBe('invalid_handle');

    await addTarget({ handle: 'cq2valid' });
    expect(
      (await send<{ error: string }>('/x/cannon/targets/cq2valid', 'PATCH', {})).body.error,
    ).toBe('empty_patch');
    expect(
      (await send<{ error: string }>('/x/cannon/targets/cq2absent', 'PATCH', { active: true })).body
        .error,
    ).toBe('not_found');
  });
});

describe('rescore', () => {
  test('scores from harvest_rows, ignores mode=replies, gates a thin sample', async () => {
    // 10 posts at 1000 views / 4 comments → median 1000 / (4+1) = 200.
    await seedHarvest(H_RICH, 10, { views: 1000, comments: 4 });
    // Reply rows for the SAME handle, wildly different numbers: if the mode
    // filter regressed, the medians below would move.
    await seedHarvest(H_RICH, 20, { mode: 'replies', views: 50, comments: 0 });
    // Under the gate.
    await seedHarvest(H_THIN, 3, { views: 5000, comments: 0 });

    await addTarget({ handle: H_RICH });
    await addTarget({ handle: H_THIN });

    const res = await send<{
      scored: number;
      skipped: { handle: string; sampleN: number; reason: string }[];
      samplePosts: number;
      minSample: number;
    }>('/x/cannon/rescore', 'POST', { handles: [H_RICH, H_THIN] });

    expect(res.status).toBe(200);
    expect(res.body.scored).toBe(1);
    expect(res.body.minSample).toBe(CANNON_MIN_SAMPLE);
    expect(res.body.skipped).toEqual([
      { handle: H_THIN, sampleN: 3, reason: 'insufficient_sample' },
    ]);

    const listed = await send<{ floor: number; targets: TargetView[] }>('/x/cannon/targets', 'GET');
    const rich = listed.body.targets.find((t) => t.handle === H_RICH) as TargetView;
    expect(rich.medianViews).toBe(1000);
    expect(rich.medianComments).toBe(4);
    expect(rich.score).toBe(200);
    expect(rich.sampleN).toBe(10);
    expect(rich.staleDays).toBe(0);

    // "We looked and there wasn't enough" — null score, but scored_at and
    // sample_n are both written (§7.11).
    const thin = listed.body.targets.find((t) => t.handle === H_THIN) as TargetView;
    expect(thin.score).toBeNull();
    expect(thin.sampleN).toBe(3);
    expect(thin.scoredAt).not.toBeNull();
    expect(thin.staleDays).toBe(0);
    expect(thin.belowFloor).toBe(false);

    // Roster order: scored first, unscored last.
    const handles = listed.body.targets.map((t) => t.handle);
    expect(handles.indexOf(H_RICH)).toBeLessThan(handles.indexOf(H_THIN));
  });

  test('an empty roster answers {scored: 0, skipped: []} without an in ()', async () => {
    const res = await send<{ scored: number; skipped: unknown[] }>('/x/cannon/rescore', 'POST', {
      handles: ['cq2nobody'],
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ scored: 0, skipped: [] });
  });

  test('rejects a malformed handles list', async () => {
    expect(
      (await send<{ error: string }>('/x/cannon/rescore', 'POST', { handles: 'nope' })).body.error,
    ).toBe('invalid_handles');
    expect(
      (await send<{ error: string }>('/x/cannon/rescore', 'POST', { handles: ['bad handle'] })).body
        .error,
    ).toBe('invalid_handle');
  });
});

describe('candidates', () => {
  test('excludes existing targets, clamps limit, rejects a bad one', async () => {
    await seedHarvest(H_CAND, 12, { views: 2000, comments: 1 });

    const res = await send<{
      limit: number;
      minSample: number;
      candidates: { handle: string; score: number; sampleN: number }[];
    }>('/x/cannon/candidates?limit=50', 'GET');
    expect(res.status).toBe(200);
    const hit = res.body.candidates.find((c) => c.handle === H_CAND);
    expect(hit?.score).toBe(1000);
    expect(hit?.sampleN).toBe(12);
    // H_RICH is on the roster from the rescore suite → not a candidate.
    expect(res.body.candidates.some((c) => c.handle === H_RICH)).toBe(false);
    // H_THIN is under the gate anyway.
    expect(res.body.candidates.some((c) => c.handle === H_THIN)).toBe(false);

    // Out of range clamps; a non-positive-integer is a 400 (the affinity contract).
    const clamped = await send<{ limit: number }>('/x/cannon/candidates?limit=999', 'GET');
    expect(clamped.body.limit).toBe(50);
    expect((await send('/x/cannon/candidates?limit=0', 'GET')).status).toBe(400);
    expect((await send('/x/cannon/candidates?limit=abc', 'GET')).status).toBe(400);
    expect((await send('/x/cannon/candidates?minSample=-2', 'GET')).status).toBe(400);
  });

  test('minSample only ever raises the module floor', async () => {
    const low = await send<{ minSample: number }>('/x/cannon/candidates?minSample=2', 'GET');
    expect(low.body.minSample).toBe(CANNON_MIN_SAMPLE);

    const high = await send<{
      minSample: number;
      candidates: { handle: string }[];
    }>('/x/cannon/candidates?minSample=100', 'GET');
    expect(high.body.minSample).toBe(100);
    expect(high.body.candidates.some((c) => c.handle === H_CAND)).toBe(false);
  });

  test('a target added mid-session drops out of candidates', async () => {
    await addTarget({ handle: H_CAND });
    const res = await send<{ candidates: { handle: string }[] }>('/x/cannon/candidates', 'GET');
    expect(res.body.candidates.some((c) => c.handle === H_CAND)).toBe(false);
  });
});
