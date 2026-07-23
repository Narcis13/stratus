// GR.7 — goals pacing + commitments over the real (in-memory, auto-migrated)
// SQLite DB. Two disciplines the shared DB forces on this file:
//
//  • **Baseline-relative counting** (D103e). `posted_replies` counts every
//    posted reply_draft since the goal's baseline, and other suites legitimately
//    own rows in that range — so the flow assertions read the number, seed, and
//    read again, asserting the DELTA.
//  • **Out-of-window fixtures.** The seeded drafts sit ~150 days back so they
//    can never perturb the monitor's 3h/24h/14d rules, the brief's today or the
//    digest's week (the NT.2 rule), and the account snapshots use year-3000
//    dates so they win `desc(snapshotAt) limit 1` while this file runs
//    (the me.test.ts idiom) and are deleted by exact date.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { eq, inArray } from 'drizzle-orm';
import { Hono } from 'hono';
import { db } from '../../db/client.ts';
import { accountSnapshots, commitments, meGoals, replyDrafts, streaks } from '../db/schema.ts';
import { shiftDayKey } from '../goals.ts';
import { localDayKey } from '../quests.ts';
import { goalsRouter } from './goals.ts';
import { me } from './me.ts';

const app = new Hono();
app.route('/x', goalsRouter);
app.route('/x', me);

const DAY = 86_400_000;
// Later than me.test.ts's 3000-01-01 and doctrine.test.ts's 2999-12-01, so
// whichever order the files run in, these two are the newest while this one does.
const SNAP_OLD = new Date('3000-03-01T00:00:00Z');
const SNAP_NEW = new Date('3000-03-08T00:00:00Z');
const DRAFT_IDS = ['gr7-draft-1', 'gr7-draft-2', 'gr7-draft-3'];
const TODAY_KEY = localDayKey(new Date(), 0);
const STREAK_DAY = shiftDayKey(TODAY_KEY, -2);

const createdGoalIds: string[] = [];

interface Pacing {
  current: number | null;
  pctComplete: number | null;
  daysLeft: number | null;
  requiredPerDay: number | null;
  actualPerDay: number | null;
  verdict: string;
  projectedAt: string | null;
}
interface GoalView {
  id: string;
  label: string;
  kind: string;
  target: number;
  status: string;
  baselineValue: number | null;
  baselineAt: string | null;
  pacing: Pacing;
}
interface CommitmentView {
  key: string;
  dailyTarget: number;
  active: boolean;
  activeSince: string;
  debt: { missedLast7: number; missedLast30: number; trackedLast7: number; tier: number };
}

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
  return { status: res.status, body: (await res.json()) as T };
}

async function createGoal(payload: Record<string, unknown>): Promise<GoalView> {
  const { status, body } = await send<GoalView>('/x/me/goals', 'POST', payload);
  expect(status).toBe(201);
  createdGoalIds.push(body.id);
  return body;
}

async function getGoals(): Promise<{ goals: GoalView[]; commitments: CommitmentView[] }> {
  const { status, body } = await send<{ goals: GoalView[]; commitments: CommitmentView[] }>(
    '/x/goals',
    'GET',
  );
  expect(status).toBe(200);
  return body;
}

function findGoal(goals: GoalView[], id: string): GoalView {
  const g = goals.find((x) => x.id === id);
  if (!g) throw new Error(`goal ${id} missing from GET /x/goals`);
  return g;
}

beforeAll(async () => {
  await db.insert(accountSnapshots).values([
    {
      snapshotAt: SNAP_OLD,
      followersCount: 1000,
      followingCount: 100,
      tweetCount: 10,
      listedCount: 0,
    },
    {
      snapshotAt: SNAP_NEW,
      followersCount: 1070,
      followingCount: 100,
      tweetCount: 10,
      listedCount: 0,
    },
  ]);
});

afterAll(async () => {
  if (createdGoalIds.length > 0)
    await db.delete(meGoals).where(inArray(meGoals.id, createdGoalIds));
  await db.delete(commitments);
  await db.delete(replyDrafts).where(inArray(replyDrafts.id, DRAFT_IDS));
  await db
    .delete(accountSnapshots)
    .where(inArray(accountSnapshots.snapshotAt, [SNAP_OLD, SNAP_NEW]));
  await db.delete(streaks).where(eq(streaks.day, STREAK_DAY));
});

describe('POST /x/me/goals stamps a baseline (GR.7)', () => {
  test('a followers goal records where the account stood', async () => {
    const goal = await createGoal({
      label: 'gr7 followers',
      kind: 'followers',
      target: 2000,
      deadline: new Date(Date.now() + 100 * DAY).toISOString(),
    });
    expect(goal.baselineValue).toBe(1070);
    expect(goal.baselineAt).not.toBeNull();
  });

  test('a counted goal starts at zero and counts forward', async () => {
    const goal = await createGoal({ label: 'gr7 replies', kind: 'posted_replies', target: 500 });
    expect(goal.kind).toBe('posted_replies');
    expect(goal.baselineValue).toBe(0);
  });

  test('an unknown kind is still refused', async () => {
    const { status, body } = await send<{ error: string }>('/x/me/goals', 'POST', {
      label: 'nope',
      kind: 'vibes',
      target: 10,
    });
    expect(status).toBe(400);
    expect(body.error).toBe('invalid_kind');
  });
});

describe('GET /x/goals pacing', () => {
  test('a followers goal reads the snapshot and prices the remaining days', async () => {
    const created = await createGoal({
      label: 'gr7 pacing',
      kind: 'followers',
      target: 1170,
      deadline: new Date(Date.now() + 10 * DAY).toISOString(),
    });
    const goal = findGoal((await getGoals()).goals, created.id);
    expect(goal.pacing.current).toBe(1070);
    expect(goal.pacing.daysLeft).toBe(10);
    expect(goal.pacing.requiredPerDay).toBeCloseTo(10, 5);
    // The rate itself is NOT asserted exactly: people.test.ts leaves undated
    // snapshots in the shared DB, so which row wins "oldest inside the window"
    // depends on file order. That it is measured at all is the contract here.
    expect(goal.pacing.actualPerDay).not.toBeNull();
    expect(goal.pacing.actualPerDay ?? 0).toBeGreaterThan(0);
  });

  test('a counted goal counts posted replies since its baseline (delta)', async () => {
    const created = await createGoal({
      label: 'gr7 flow',
      kind: 'posted_replies',
      target: 100_000,
    });
    // Backdate the baseline so the seeded out-of-window drafts are inside it.
    const baselineAt = new Date(Date.now() - 200 * DAY);
    await db.update(meGoals).set({ baselineAt }).where(eq(meGoals.id, created.id));

    const before = findGoal((await getGoals()).goals, created.id).pacing.current ?? 0;

    await db.insert(replyDrafts).values(
      DRAFT_IDS.map((id, i) => ({
        id,
        sourceTweetId: `77${i}`,
        sourceAuthorUsername: 'gr7_author',
        sourceText: 'seed',
        sourceUrl: `https://x.com/gr7_author/status/77${i}`,
        contextSnapshot: {},
        replyText: `gr7 fixture reply ${i}`,
        model: 'test',
        status: 'posted',
        // 150 days back: inside the goal's baseline, outside every live window.
        updatedAt: new Date(Date.now() - 150 * DAY),
      })),
    );

    const after = findGoal((await getGoals()).goals, created.id).pacing.current ?? 0;
    expect(after).toBe(before + 3);
    // Nothing was pasted this week, so the measured rate is a real zero.
    expect(findGoal((await getGoals()).goals, created.id).pacing.actualPerDay).toBe(0);
  });

  test('a goal with no deadline is unknown, not behind', async () => {
    const created = await createGoal({
      label: 'gr7 open ended',
      kind: 'custom',
      target: 100,
      currentValue: 10,
    });
    const goal = findGoal((await getGoals()).goals, created.id);
    expect(goal.pacing.current).toBe(10);
    expect(goal.pacing.pctComplete).toBe(10);
    expect(goal.pacing.verdict).toBe('unknown');
    expect(goal.pacing.requiredPerDay).toBeNull();
  });
});

describe('GET /x/goals settles goals on read (lazy flip)', () => {
  test('active → achieved once the metric passes target', async () => {
    const created = await createGoal({
      label: 'gr7 achieved',
      kind: 'custom',
      target: 100,
      currentValue: 100,
    });
    expect(created.status).toBe('active');

    const goal = findGoal((await getGoals()).goals, created.id);
    expect(goal.status).toBe('achieved');
    expect(goal.pacing.verdict).toBe('achieved');

    const [stored] = await db.select().from(meGoals).where(eq(meGoals.id, created.id));
    expect(stored?.status).toBe('achieved');
  });

  test('active → missed once the deadline is behind us, and it stays put', async () => {
    const created = await createGoal({
      label: 'gr7 missed',
      kind: 'custom',
      target: 100,
      currentValue: 5,
      deadline: new Date(Date.now() - 2 * DAY).toISOString(),
    });
    expect(findGoal((await getGoals()).goals, created.id).status).toBe('missed');

    // A second read is idempotent — the flip only ever advances an active row.
    const again = findGoal((await getGoals()).goals, created.id);
    expect(again.status).toBe('missed');
    expect(again.pacing.verdict).toBe('overdue');
  });

  test('a live goal is left alone', async () => {
    const created = await createGoal({
      label: 'gr7 live',
      kind: 'custom',
      target: 100,
      currentValue: 5,
      deadline: new Date(Date.now() + 30 * DAY).toISOString(),
    });
    expect(findGoal((await getGoals()).goals, created.id).status).toBe('active');
  });
});

describe('commitments', () => {
  test('PUT validates the key and the daily target', async () => {
    const bad = [
      [{ key: 'tweets', dailyTarget: 5 }, 'invalid_key'],
      [{ key: 'replies', dailyTarget: 0 }, 'invalid_daily_target'],
      [{ key: 'replies', dailyTarget: 101 }, 'invalid_daily_target'],
      [{ key: 'replies', dailyTarget: 1.5 }, 'invalid_daily_target'],
      [{ key: 'replies', dailyTarget: '10' }, 'invalid_daily_target'],
      [{ key: 'replies', dailyTarget: 10, active: 'yes' }, 'invalid_active'],
    ] as const;
    for (const [body, error] of bad) {
      const res = await send<{ error: string }>('/x/commitments', 'PUT', body);
      expect(res.status).toBe(400);
      expect(res.body.error).toBe(error);
    }
  });

  test('a fresh commitment carries no debt — the promise starts today', async () => {
    const { status, body } = await send<CommitmentView>('/x/commitments', 'PUT', {
      key: 'replies',
      dailyTarget: 15,
    });
    expect(status).toBe(200);
    expect(body.dailyTarget).toBe(15);
    expect(body.active).toBe(true);
    expect(body.debt).toEqual({ missedLast7: 0, missedLast30: 0, trackedLast7: 0, tier: 0 });
  });

  test('editing the target does not restart the debt clock', async () => {
    const first = await send<CommitmentView>('/x/commitments', 'PUT', {
      key: 'originals',
      dailyTarget: 1,
    });
    const second = await send<CommitmentView>('/x/commitments', 'PUT', {
      key: 'originals',
      dailyTarget: 2,
    });
    expect(second.body.dailyTarget).toBe(2);
    expect(second.body.activeSince).toBe(first.body.activeSince);
  });

  test('re-activating restarts it', async () => {
    const before = await send<CommitmentView>('/x/commitments', 'PUT', {
      key: 'originals',
      dailyTarget: 2,
      active: false,
    });
    const after = await send<CommitmentView>('/x/commitments', 'PUT', {
      key: 'originals',
      dailyTarget: 2,
      active: true,
    });
    expect(after.body.active).toBe(true);
    expect(Date.parse(after.body.activeSince)).toBeGreaterThanOrEqual(
      Date.parse(before.body.activeSince),
    );
  });

  test('debt counts the days since the promise, and a diary hit clears one', async () => {
    await send('/x/commitments', 'PUT', { key: 'replies', dailyTarget: 15 });
    // Backdate the promise by 3 days: yesterday, -2 and -3 are now on the hook.
    await db
      .update(commitments)
      .set({ activeSince: new Date(Date.now() - 3 * DAY) })
      .where(eq(commitments.key, 'replies'));
    await db.insert(streaks).values({
      day: STREAK_DAY,
      completed: { replies: true, original: false },
      allDone: false,
    });

    const { body } = await send<{ commitments: CommitmentView[] }>('/x/commitments', 'GET');
    const replies = body.commitments.find((c) => c.key === 'replies');
    expect(replies?.debt.trackedLast7).toBe(3);
    // Two days have no diary row at all; the seeded one counts as kept.
    expect(replies?.debt.missedLast7).toBe(2);
    expect(replies?.debt.tier).toBe(1);
  });

  test('GET /x/goals carries the same commitments block', async () => {
    const body = await getGoals();
    expect(body.commitments.map((c) => c.key).sort()).toEqual(['originals', 'replies']);
    expect(body.goals.length).toBeGreaterThan(0);
  });
});
