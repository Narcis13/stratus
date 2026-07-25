// GR.1 following ledger over the real (in-memory) DB. The matrix that matters is
// the complete-run reconcile: absence from a full pass is the only evidence that
// a follow ended, so a partial run must be provably inert and an empty run must
// not even count as complete.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { eq, inArray } from 'drizzle-orm';
import { Hono } from 'hono';
import { db } from '../../db/client.ts';
import { WINDOW_CAP_MAX, WINDOW_CAP_MIN } from '../connections.ts';
import { following, followingRuns, people } from '../db/schema.ts';
import { type FollowingIngestRow, followingRouter, parseFollowingRow } from './following.ts';

const app = new Hono();
app.route('/x', followingRouter);

const ALICE = 'gr1_alice';
const BOB = 'gr1_bob';
const CAROL = 'gr1_carol';
const DAVE = 'gr1_dave';
const EVE = 'gr1_eve';
const HANDLES = [ALICE, BOB, CAROL, DAVE, EVE];

interface RunRow {
  id: string;
  rowsSeen: number;
  complete: boolean;
  completedAt: string | null;
}

interface RowsBody {
  runId: string;
  received: number;
  applied: number;
  inserted: number;
  updated: number;
  rowsSeen: number;
  complete: boolean;
  reconcile: { gone: number; confirmed: number; requeued: number } | null;
}

function scraped(handle: string, extra: Record<string, unknown> = {}) {
  return { handle, displayName: `${handle} display`, followsBack: false, ...extra };
}

async function newRun(): Promise<string> {
  const res = await app.request('/x/following/runs', { method: 'POST' });
  expect(res.status).toBe(201);
  return ((await res.json()) as RunRow).id;
}

async function postRows<T = RowsBody>(body: unknown): Promise<{ status: number; body: T }> {
  const res = await app.request('/x/following/rows', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as T };
}

async function patch<T>(handle: string, body: unknown): Promise<{ status: number; body: T }> {
  const res = await app.request(`/x/following/${handle}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as T };
}

async function ledgerRow(handle: string) {
  const [row] = await db.select().from(following).where(eq(following.handle, handle));
  return row;
}

async function setStatus(handle: string, status: string): Promise<void> {
  await db.update(following).set({ status }).where(eq(following.handle, handle));
}

afterAll(async () => {
  await db.delete(following).where(inArray(following.handle, HANDLES));
  // FK: rows first, then the runs they point at.
  const runs = await db.select({ id: followingRuns.id }).from(followingRuns);
  if (runs.length > 0) {
    await db.delete(followingRuns).where(
      inArray(
        followingRuns.id,
        runs.map((r) => r.id),
      ),
    );
  }
});

describe('parseFollowingRow', () => {
  test('normalizes the handle and keeps the optional fields optional', () => {
    const ok = parseFollowingRow({ handle: '@GR1_Alice', followsBack: true }) as FollowingIngestRow;
    expect(ok.handle).toBe(ALICE);
    expect(ok.followsBack).toBe(true);
    expect(ok.displayName).toBeNull();
    expect(ok.listPosition).toBeNull();

    const full = parseFollowingRow({
      handle: BOB,
      displayName: '  Bob  ',
      followsBack: false,
      listPosition: 12,
    }) as FollowingIngestRow;
    expect(full.displayName).toBe('Bob');
    expect(full.listPosition).toBe(12);
  });

  test('refuses anything it cannot trust', () => {
    expect(parseFollowingRow(null)).toEqual({ error: 'invalid_row' });
    expect(parseFollowingRow([])).toEqual({ error: 'invalid_row' });
    expect(parseFollowingRow({ followsBack: true })).toEqual({ error: 'invalid_handle' });
    expect(parseFollowingRow({ handle: 'way_too_long_a_handle', followsBack: true })).toEqual({
      error: 'invalid_handle',
    });
    // The follows-back flag is the whole second half of the scrape — a build that
    // can't report it must fail, never default to "they don't follow me".
    expect(parseFollowingRow({ handle: ALICE })).toEqual({ error: 'invalid_follows_back' });
    expect(parseFollowingRow({ handle: ALICE, followsBack: 'yes' })).toEqual({
      error: 'invalid_follows_back',
    });
    expect(parseFollowingRow({ handle: ALICE, followsBack: true, displayName: 7 })).toEqual({
      error: 'invalid_display_name',
    });
    expect(parseFollowingRow({ handle: ALICE, followsBack: true, listPosition: -1 })).toEqual({
      error: 'invalid_list_position',
    });
    expect(parseFollowingRow({ handle: ALICE, followsBack: true, listPosition: 1.5 })).toEqual({
      error: 'invalid_list_position',
    });
  });
});

describe('POST /x/following/rows — validation', () => {
  test('refuses malformed batches before touching the ledger', async () => {
    const runId = await newRun();

    expect((await postRows([])).status).toBe(400);
    expect((await postRows({ rows: [scraped(ALICE)] })).body).toMatchObject({
      error: 'invalid_run_id',
    });
    expect((await postRows({ runId: 'nope', rows: [scraped(ALICE)] })).body).toMatchObject({
      error: 'invalid_run_id',
    });
    expect((await postRows({ runId, rows: [] })).body).toMatchObject({ error: 'rows_required' });
    expect((await postRows({ runId, rows: {} })).body).toMatchObject({ error: 'rows_required' });
    expect((await postRows({ runId, rows: [scraped(ALICE)], done: 'yes' })).body).toMatchObject({
      error: 'invalid_done',
    });

    const tooMany = Array.from({ length: 501 }, (_, i) => scraped(`gr1_x${i}`));
    const over = await postRows<{ error: string; max: number }>({ runId, rows: tooMany });
    expect(over.status).toBe(400);
    expect(over.body.error).toBe('too_many_rows');
    expect(over.body.max).toBe(500);

    const bad = await postRows<{ error: string; index: number }>({
      runId,
      rows: [scraped(ALICE), { handle: '', followsBack: true }],
    });
    expect(bad.status).toBe(400);
    expect(bad.body.error).toBe('invalid_handle');
    expect(bad.body.index).toBe(1);

    const missing = await postRows({
      runId: '11111111-2222-3333-4444-555555555555',
      rows: [scraped(ALICE)],
    });
    expect(missing.status).toBe(404);

    expect((await db.select().from(following)).length).toBe(0);
    const [run] = await db.select().from(followingRuns).where(eq(followingRuns.id, runId));
    expect(run?.rowsSeen).toBe(0);
  });
});

// One continuous lifecycle: seed → mark → reconcile → revive. Every assertion
// below depends on the state the previous test left behind, which is the point —
// the ledger's whole value is what survives across runs.
describe('following ledger lifecycle', () => {
  let runA = '';
  let runB = '';

  test('run A seeds the ledger and dedupes within a batch', async () => {
    runA = await newRun();
    const { status, body } = await postRows({
      runId: runA,
      rows: [
        scraped(ALICE, { followsBack: true, listPosition: 0 }),
        scraped(BOB, { listPosition: 1 }),
        scraped(CAROL, { listPosition: 2 }),
        // Same handle twice in one batch: first occurrence wins (top-down order).
        scraped(CAROL, { listPosition: 99, displayName: 'later duplicate' }),
        scraped(DAVE, { listPosition: 3 }),
        scraped(EVE, { listPosition: 4 }),
      ],
    });

    expect(status).toBe(201);
    expect(body.received).toBe(6);
    expect(body.applied).toBe(5);
    expect(body.inserted).toBe(5);
    expect(body.updated).toBe(0);
    expect(body.rowsSeen).toBe(5);
    expect(body.complete).toBe(false);
    expect(body.reconcile).toBeNull();

    const alice = await ledgerRow(ALICE);
    expect(alice?.status).toBe('active');
    expect(alice?.followsBack).toBe(true);
    expect(alice?.keep).toBe(false);
    expect(alice?.lastRunId).toBe(runA);
    expect(alice?.unfollowMarkedAt).toBeNull();

    const carol = await ledgerRow(CAROL);
    expect(carol?.listPosition).toBe(2);
    expect(carol?.displayName).toBe(`${CAROL} display`);
  });

  test('a second batch upserts: first_seen is fill-only, follows_back refreshes', async () => {
    // Backdate so the fill-only assertion can't pass on a millisecond tie.
    const seeded = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    await db.update(following).set({ firstSeenAt: seeded }).where(eq(following.handle, BOB));

    const { body } = await postRows({
      runId: runA,
      // followsBack flipped, displayName + listPosition not reported this pass.
      rows: [{ handle: BOB, followsBack: true }],
    });
    expect(body.inserted).toBe(0);
    expect(body.updated).toBe(1);
    expect(body.rowsSeen).toBe(6);

    const bob = await ledgerRow(BOB);
    expect(bob?.followsBack).toBe(true);
    expect(bob?.firstSeenAt.getTime()).toBe(seeded.getTime());
    expect(bob?.lastSeenAt.getTime()).toBeGreaterThan(seeded.getTime());
    // A field this scrape didn't report is left alone, never nulled (§7.11).
    expect(bob?.displayName).toBe(`${BOB} display`);
    expect(bob?.listPosition).toBe(1);

    // Restore the state the reconcile matrix expects.
    await postRows({ runId: runA, rows: [{ handle: BOB, followsBack: false }] });
  });

  test('closing run A stamps it complete and reconciles nothing', async () => {
    // Empty closing batch: a scrape that lands on an exact batch boundary still
    // has to be able to close its run.
    const { status, body } = await postRows({ runId: runA, rows: [], done: true });
    expect(status).toBe(201);
    expect(body.complete).toBe(true);
    expect(body.reconcile).toEqual({ gone: 0, confirmed: 0, requeued: 0 });

    const [run] = await db.select().from(followingRuns).where(eq(followingRuns.id, runA));
    expect(run?.complete).toBe(true);
    expect(run?.completedAt).not.toBeNull();

    for (const handle of HANDLES) expect((await ledgerRow(handle))?.status).toBe('active');
  });

  test('a completed run refuses further rows', async () => {
    const late = await postRows({ runId: runA, rows: [scraped(ALICE)] });
    expect(late.status).toBe(409);
    expect(late.body).toMatchObject({ error: 'run_already_complete' });
  });

  test('PATCH is the user ratchet: queued→done only, keep is independent', async () => {
    // GR.3 owns the active→queued release; stand in for it here.
    await setStatus(CAROL, 'queued');
    await setStatus(DAVE, 'queued');
    await setStatus(EVE, 'queued');

    const marked = await patch<{ status: string; unfollowMarkedAt: number }>(CAROL, {
      status: 'done',
    });
    expect(marked.status).toBe(200);
    expect(marked.body.status).toBe('done');
    expect(marked.body.unfollowMarkedAt).not.toBeNull();
    await patch(EVE, { status: 'done' });

    // Nothing else may be set from the outside — every other edge is the
    // reconcile's, and re-ticking a done row is not idempotent on purpose.
    expect((await patch<{ error: string }>(ALICE, { status: 'done' })).status).toBe(409);
    expect((await patch<{ error: string }>(CAROL, { status: 'done' })).body.error).toBe(
      'invalid_transition',
    );
    expect((await patch<{ error: string }>(DAVE, { status: 'gone' })).body.error).toBe(
      'invalid_transition',
    );
    expect((await patch<{ error: string }>(DAVE, { status: 'banana' })).body.error).toBe(
      'invalid_status',
    );
    expect((await patch<{ error: string }>(DAVE, {})).body.error).toBe('empty_patch');
    expect((await patch<{ error: string }>(DAVE, { keep: 'yes' })).body.error).toBe('invalid_keep');
    expect((await patch<{ error: string }>('gr1_nobody', { keep: true })).status).toBe(404);

    // keep pins a row without moving its status: the queue filters kept rows out.
    const kept = await patch<{ keep: boolean; status: string }>(DAVE, { keep: true });
    expect(kept.body.keep).toBe(true);
    expect(kept.body.status).toBe('queued');
  });

  test('a partial run updates what it sees and flips nothing', async () => {
    const partial = await newRun();
    const { body } = await postRows({
      runId: partial,
      rows: [scraped(ALICE, { followsBack: true })],
    });
    expect(body.complete).toBe(false);
    expect(body.reconcile).toBeNull();

    expect((await ledgerRow(ALICE))?.status).toBe('active');
    expect((await ledgerRow(BOB))?.status).toBe('active');
    expect((await ledgerRow(CAROL))?.status).toBe('done');
    expect((await ledgerRow(DAVE))?.status).toBe('queued');
    expect((await ledgerRow(EVE))?.status).toBe('done');
  });

  test('an empty complete run closes without becoming complete or reconciling', async () => {
    const empty = await newRun();
    const { body } = await postRows({ runId: empty, rows: [], done: true });
    expect(body.rowsSeen).toBe(0);
    expect(body.complete).toBe(false);
    expect(body.reconcile).toBeNull();

    const [run] = await db.select().from(followingRuns).where(eq(followingRuns.id, empty));
    expect(run?.completedAt).not.toBeNull();
    expect(run?.complete).toBe(false);

    // The whole ledger survived a scrape that extracted nothing.
    expect((await ledgerRow(BOB))?.status).toBe('active');
    expect((await ledgerRow(DAVE))?.status).toBe('queued');
  });

  test('run B: the complete-run reconcile matrix', async () => {
    runB = await newRun();
    const { body } = await postRows({
      runId: runB,
      // Seen: alice (active), carol (done — the unfollow never happened).
      // Unseen: bob (active), dave (queued), eve (done).
      rows: [scraped(ALICE, { followsBack: true }), scraped(CAROL)],
      done: true,
    });

    expect(body.complete).toBe(true);
    expect(body.reconcile).toEqual({ gone: 2, confirmed: 1, requeued: 1 });

    expect((await ledgerRow(ALICE))?.status).toBe('active');
    expect((await ledgerRow(BOB))?.status).toBe('gone');
    expect((await ledgerRow(DAVE))?.status).toBe('gone');
    expect((await ledgerRow(EVE))?.status).toBe('confirmed');

    // The reverse edge: still there, so it goes back in the batch — but the mark
    // survives, because a failed tick must not hand back churn budget.
    const carol = await ledgerRow(CAROL);
    expect(carol?.status).toBe('queued');
    expect(carol?.unfollowMarkedAt).not.toBeNull();
  });

  test('a later sighting revives a written-off row without resetting its age', async () => {
    const before = await ledgerRow(EVE);
    const runC = await newRun();
    await postRows({ runId: runC, rows: [scraped(EVE, { followsBack: true })], done: true });

    const eve = await ledgerRow(EVE);
    expect(eve?.status).toBe('active');
    expect(eve?.followsBack).toBe(true);
    // first_seen_at is the only follow-age signal there is — reviving never
    // rewrites it, so a bad reconcile can't erase the grace window.
    expect(eve?.firstSeenAt.getTime()).toBe(before?.firstSeenAt.getTime() ?? -1);
    expect(eve?.unfollowMarkedAt?.getTime() ?? null).toBe(
      before?.unfollowMarkedAt?.getTime() ?? null,
    );

    // Run C saw only eve, so everyone else is unseen — already-terminal rows stay
    // put and alice/carol get written off.
    expect((await ledgerRow(ALICE))?.status).toBe('gone');
    expect((await ledgerRow(CAROL))?.status).toBe('gone');
    expect((await ledgerRow(BOB))?.status).toBe('gone');
  });
});

describe('GET /x/following', () => {
  interface ListBody {
    count: number;
    total: number;
    lastCompleteRunAt: string | null;
    following: Array<{ handle: string; status: string }>;
  }

  async function list(qs = ''): Promise<{ status: number; body: ListBody }> {
    const res = await app.request(`/x/following${qs}`);
    return { status: res.status, body: (await res.json()) as ListBody };
  }

  test('filters by status, searches handle and display name, caps the page', async () => {
    const all = await list();
    expect(all.status).toBe(200);
    expect(all.body.total).toBe(5);
    expect(all.body.lastCompleteRunAt).not.toBeNull();

    const gone = await list('?status=gone');
    expect(gone.body.total).toBe(4);
    expect(gone.body.following.every((r) => r.status === 'gone')).toBe(true);

    // `_` is a legal handle character, so the search must not read it as a LIKE
    // wildcard: this matches literally, and matches nothing outside the fixture.
    expect((await list('?q=gr1_car')).body.total).toBe(1);
    expect((await list('?q=GR1_Alice')).body.total).toBe(1);
    expect((await list('?q=alice display')).body.total).toBe(1);
    expect((await list('?q=gr1%eve')).body.total).toBe(0);

    const capped = await list('?limit=2');
    expect(capped.body.count).toBe(2);
    expect(capped.body.total).toBe(5);
  });

  test('refuses params it cannot honour', async () => {
    expect((await list('?status=banana')).status).toBe(400);
    expect((await list('?limit=0')).status).toBe(400);
    expect((await list('?limit=abc')).status).toBe(400);
  });
});

// The queue owns a clean slate: `releaseBudget` reads `unfollow_marked_at` across
// the WHOLE table, so the lifecycle fixture's marks would perturb the budget.
// Deleting following here is safe — every describe above has already asserted.
describe('GET /x/following/queue', () => {
  const OLDER = 'gr3_older';
  const OLD = 'gr3_old';
  const FOLLOWER = 'gr3_follower';
  const FRESH = 'gr3_fresh';
  const KEPT = 'gr3_kept';
  const MUTUAL = 'gr3_mutual';
  const G3 = [OLDER, OLD, FOLLOWER, FRESH, KEPT, MUTUAL];
  const now = Date.now();
  const days = (n: number) => new Date(now - n * 24 * 60 * 60 * 1000);

  interface QueueBody {
    batch: Array<{ handle: string; displayName: string | null; firstSeenAt: string; url: string }>;
    eligibleTotal: number;
    releasedNow: number;
    windowUsed: number;
    windowCap: number;
    dailyUsed: number;
    dailyCeiling: number;
    lastCompleteRunAt: string | null;
  }

  async function queue(): Promise<{ status: number; body: QueueBody }> {
    const res = await app.request('/x/following/queue');
    return { status: res.status, body: (await res.json()) as QueueBody };
  }

  beforeAll(async () => {
    await db.delete(following);
    const runId = await newRun();
    await db.insert(following).values([
      {
        handle: OLDER,
        followsBack: false,
        firstSeenAt: days(40),
        lastSeenAt: days(1),
        lastRunId: runId,
        status: 'active',
        listPosition: 5,
      },
      {
        handle: OLD,
        followsBack: false,
        firstSeenAt: days(30),
        lastSeenAt: days(1),
        lastRunId: runId,
        status: 'active',
        listPosition: 10,
      },
      {
        handle: FOLLOWER,
        followsBack: true,
        firstSeenAt: days(40),
        lastSeenAt: days(1),
        lastRunId: runId,
        status: 'active',
      },
      {
        handle: FRESH,
        followsBack: false,
        firstSeenAt: days(1),
        lastSeenAt: days(1),
        lastRunId: runId,
        status: 'active',
      },
      {
        handle: KEPT,
        followsBack: false,
        firstSeenAt: days(40),
        lastSeenAt: days(1),
        lastRunId: runId,
        status: 'active',
        keep: true,
      },
      {
        handle: MUTUAL,
        followsBack: false,
        firstSeenAt: days(40),
        lastSeenAt: days(1),
        lastRunId: runId,
        status: 'active',
      },
    ]);
    // MUTUAL is a real relationship in the CRM — it must never surface for
    // unfollow even though it doesn't follow back and is well past grace.
    await db.insert(people).values({ handle: MUTUAL, stage: 'mutual', retired: false });
  });

  afterAll(async () => {
    await db.delete(following).where(inArray(following.handle, G3));
    await db.delete(people).where(inArray(people.handle, [MUTUAL, OLD]));
  });

  test('releases eligible non-followers oldest first, skipping followers/fresh/kept/whitelisted', async () => {
    const { status, body } = await queue();
    expect(status).toBe(200);
    expect(body.batch.map((r) => r.handle)).toEqual([OLDER, OLD]);
    expect(body.batch[0]?.url).toBe(`https://x.com/${OLDER}`);
    expect(body.releasedNow).toBe(2);
    expect(body.eligibleTotal).toBe(2);
    expect(body.windowUsed).toBe(0);
    expect(body.dailyUsed).toBe(0);
    expect(body.windowCap).toBeGreaterThanOrEqual(WINDOW_CAP_MIN);
    expect(body.windowCap).toBeLessThanOrEqual(WINDOW_CAP_MAX);

    // The release is persisted so it survives the page reload.
    for (const h of [OLDER, OLD]) {
      const [row] = await db.select().from(following).where(eq(following.handle, h));
      expect(row?.status).toBe('queued');
    }
    // Everyone excluded stays active and un-touched.
    for (const h of [FOLLOWER, FRESH, KEPT, MUTUAL]) {
      const [row] = await db.select().from(following).where(eq(following.handle, h));
      expect(row?.status).toBe('active');
    }
  });

  test('re-read returns the same batch and releases nothing new', async () => {
    const { body } = await queue();
    expect(body.batch.map((r) => r.handle)).toEqual([OLDER, OLD]);
    expect(body.releasedNow).toBe(0);
    expect(body.eligibleTotal).toBe(2);
  });

  test('a person who becomes mutual after release is revoked back to active', async () => {
    await db.insert(people).values({ handle: OLD, stage: 'mutual', retired: false });
    const { body } = await queue();

    expect(body.batch.map((r) => r.handle)).toEqual([OLDER]);
    expect(body.releasedNow).toBe(0);
    expect(body.eligibleTotal).toBe(1);

    const [old] = await db.select().from(following).where(eq(following.handle, OLD));
    expect(old?.status).toBe('active');
    const [older] = await db.select().from(following).where(eq(following.handle, OLDER));
    expect(older?.status).toBe('queued');
  });
});
