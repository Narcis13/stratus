// M1 Me / My Profile: entry + goal CRUD, per-entry inWindow, followers-goal
// progress over a seeded snapshot, the rendered-context endpoint + the
// best-effort loader — all over the real (in-memory, auto-migrated) SQLite DB.
// The me_* tables are exclusive to this feature, so afterAll wipes them; the
// seeded account_snapshots row uses a year-3000 date (later than doctrine.test's
// 2999-12-01) so it wins `desc(snapshotAt) limit 1` while this suite runs, and
// is deleted by exact-date match in afterAll (other suites assert exact numbers).

import { afterAll, describe, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { db } from '../../db/client.ts';
import { accountSnapshots, meEntries, meGoals } from '../db/schema.ts';
import { loadMeContextSafe, me } from './me.ts';

const app = new Hono();
app.route('/x', me);

const SNAP_FUTURE = new Date('3000-01-01T00:00:00Z');
const DAY = 86_400_000;

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

interface EntryRow {
  id: string;
  kind: string;
  text: string;
  happenedAt: string | null;
  pinned: boolean;
  active: boolean;
  inWindow?: boolean;
}
interface GoalRow {
  id: string;
  label: string;
  kind: string;
  target: number;
  unit: string | null;
  currentValue: number | null;
  status: string;
  progress?: { current: number; pct: number; daysLeft: number | null } | null;
}

afterAll(() => {
  db.delete(meEntries).run();
  db.delete(meGoals).run();
  db.delete(accountSnapshots).where(eq(accountSnapshots.snapshotAt, SNAP_FUTURE)).run();
});

// Runs first (declaration order) while the me_* tables are still empty.
describe('empty profile', () => {
  test('context is null and the loader returns null', async () => {
    const post = await send<{ mode: string; block: string | null }>(
      '/x/me/context?mode=post',
      'GET',
    );
    expect(post.status).toBe(200);
    expect(post.body.mode).toBe('post');
    expect(post.body.block).toBeNull();

    const reply = await send<{ block: string | null }>('/x/me/context?mode=reply', 'GET');
    expect(reply.body.block).toBeNull();

    expect(await loadMeContextSafe('post')).toBeNull();
    expect(await loadMeContextSafe('reply')).toBeNull();
  });
});

describe('entry CRUD + validation', () => {
  test('create every kind, 400 codes, patch, window flag, delete', async () => {
    const fact = await send<EntryRow>('/x/me/entries', 'POST', {
      kind: 'fact',
      text: 'I ship in public',
    });
    expect(fact.status).toBe(201);
    expect(fact.body.kind).toBe('fact');
    expect(fact.body.active).toBe(true);

    const emotion = await send<EntryRow>('/x/me/entries', 'POST', {
      kind: 'emotion',
      text: 'frustrated with the ANAF portal',
    });
    expect(emotion.status).toBe(201);

    // 400 codes.
    expect((await send('/x/me/entries', 'POST', { kind: 'bogus', text: 'x' })).status).toBe(400);
    expect((await send('/x/me/entries', 'POST', { kind: 'fact', text: '' })).status).toBe(400);
    expect(
      (await send('/x/me/entries', 'POST', { kind: 'fact', text: 'a'.repeat(1001) })).status,
    ).toBe(400);
    expect(
      (await send('/x/me/entries', 'POST', { kind: 'event', text: 'x', happenedAt: 'not-a-date' }))
        .status,
    ).toBe(400);

    // A fresh event is in-window; a 40-day-old event is not (30d window).
    const freshEvent = await send<EntryRow>('/x/me/entries', 'POST', {
      kind: 'event',
      text: 'shipped the studio',
      happenedAt: new Date(Date.now() - 3 * DAY).toISOString(),
    });
    expect(freshEvent.status).toBe(201);
    const staleEvent = await send<EntryRow>('/x/me/entries', 'POST', {
      kind: 'event',
      text: 'old milestone',
      happenedAt: new Date(Date.now() - 40 * DAY).toISOString(),
    });
    expect(staleEvent.status).toBe(201);

    const list = await send<{ entries: EntryRow[] }>('/x/me', 'GET');
    expect(list.status).toBe(200);
    const byId = (id: string) => list.body.entries.find((e) => e.id === id);
    expect(byId(freshEvent.body.id)?.inWindow).toBe(true);
    expect(byId(staleEvent.body.id)?.inWindow).toBe(false);
    expect(byId(fact.body.id)?.inWindow).toBe(true); // evergreen

    // kind filter.
    const onlyFacts = await send<{ entries: EntryRow[] }>('/x/me?kind=fact', 'GET');
    expect(onlyFacts.body.entries.every((e) => e.kind === 'fact')).toBe(true);

    // PATCH: pin the stale event → still not in window (pinned overrides window),
    // then clear its date.
    const patched = await send<EntryRow>(`/x/me/entries/${staleEvent.body.id}`, 'PATCH', {
      pinned: true,
    });
    expect(patched.status).toBe(200);
    expect(patched.body.pinned).toBe(true);
    const afterPin = await send<{ entries: EntryRow[] }>('/x/me', 'GET');
    expect(afterPin.body.entries.find((e) => e.id === staleEvent.body.id)?.inWindow).toBe(true);

    // PATCH invalid + 404.
    expect((await send(`/x/me/entries/${fact.body.id}`, 'PATCH', { kind: 'bogus' })).status).toBe(
      400,
    );
    expect((await send('/x/me/entries/nope', 'PATCH', { text: 'x' })).status).toBe(404);
    expect((await send('/x/me/entries/nope', 'DELETE')).status).toBe(404);

    // Context now renders (non-null) with active entries present.
    const ctx = await send<{ block: string | null }>('/x/me/context?mode=post', 'GET');
    expect(ctx.body.block).not.toBeNull();
    expect(ctx.body.block).toContain('frustrated with the ANAF portal');
    // The 40-day event should be excluded (out of window, not pinned)...
    // it was pinned above, so it IS present now — assert the pinned one shows.
    expect(ctx.body.block).toContain('old milestone');

    // Delete all created entries → back to empty.
    for (const id of [fact.body.id, emotion.body.id, freshEvent.body.id, staleEvent.body.id]) {
      expect((await send(`/x/me/entries/${id}`, 'DELETE')).status).toBe(200);
    }
    const empty = await send<{ block: string | null }>('/x/me/context?mode=post', 'GET');
    expect(empty.body.block).toBeNull();
  });
});

describe('goal CRUD + progress', () => {
  test('followers auto-progress, mrr manual, status flips', async () => {
    // Seed a winning snapshot (year 3000) so loadLatestFollowers → 500 here.
    db.insert(accountSnapshots)
      .values({
        snapshotAt: SNAP_FUTURE,
        followersCount: 500,
        followingCount: 100,
        tweetCount: 10,
        listedCount: 1,
      })
      .run();

    const followers = await send<GoalRow>('/x/me/goals', 'POST', {
      label: 'reach 1000 followers',
      kind: 'followers',
      target: 1000,
    });
    expect(followers.status).toBe(201);

    const mrr = await send<GoalRow>('/x/me/goals', 'POST', {
      label: '5K MRR',
      kind: 'mrr',
      target: 5000,
      unit: 'USD',
      currentValue: 800,
    });
    expect(mrr.status).toBe(201);

    // 400 codes.
    expect((await send('/x/me/goals', 'POST', { label: '', kind: 'mrr', target: 1 })).status).toBe(
      400,
    );
    expect(
      (await send('/x/me/goals', 'POST', { label: 'x', kind: 'bogus', target: 1 })).status,
    ).toBe(400);
    expect((await send('/x/me/goals', 'POST', { label: 'x', kind: 'mrr', target: 0 })).status).toBe(
      400,
    );
    expect(
      (await send('/x/me/goals', 'POST', { label: 'x', kind: 'mrr', target: 1, deadline: 'nope' }))
        .status,
    ).toBe(400);

    const list = await send<{ goals: GoalRow[] }>('/x/me', 'GET');
    const f = list.body.goals.find((g) => g.id === followers.body.id);
    const m = list.body.goals.find((g) => g.id === mrr.body.id);
    expect(f?.progress?.current).toBe(500);
    expect(f?.progress?.pct).toBe(50); // 500 / 1000
    expect(m?.progress?.current).toBe(800);
    expect(m?.progress?.pct).toBe(16); // 800 / 5000

    // The post block mentions goal progress.
    const ctx = await send<{ block: string | null }>('/x/me/context?mode=post', 'GET');
    expect(ctx.body.block).toContain('5K MRR');

    // PATCH currentValue + status flip; an achieved goal drops from the block.
    const bumped = await send<GoalRow>(`/x/me/goals/${mrr.body.id}`, 'PATCH', {
      currentValue: 2500,
    });
    expect(bumped.status).toBe(200);
    const relisted = await send<{ goals: GoalRow[] }>('/x/me', 'GET');
    expect(relisted.body.goals.find((g) => g.id === mrr.body.id)?.progress?.pct).toBe(50);

    const flipped = await send<GoalRow>(`/x/me/goals/${followers.body.id}`, 'PATCH', {
      status: 'achieved',
    });
    expect(flipped.status).toBe(200);
    expect(flipped.body.status).toBe('achieved');
    const ctx2 = await send<{ block: string | null }>('/x/me/context?mode=post', 'GET');
    // followers goal is achieved (renderFor loads status='active' only) → gone.
    expect(ctx2.body.block ?? '').not.toContain('reach 1000 followers');

    expect((await send('/x/me/goals/nope', 'PATCH', { status: 'active' })).status).toBe(404);
    expect(
      (await send(`/x/me/goals/${followers.body.id}`, 'PATCH', { status: 'bogus' })).status,
    ).toBe(400);
    expect((await send('/x/me/goals/nope', 'DELETE')).status).toBe(404);

    expect((await send(`/x/me/goals/${followers.body.id}`, 'DELETE')).status).toBe(200);
    expect((await send(`/x/me/goals/${mrr.body.id}`, 'DELETE')).status).toBe(200);
  });
});
