// C9 digest route wiring over the real (in-memory, auto-migrated) SQLite DB.
// XAI_API_KEY is forced off for these tests — the route must degrade to
// facts-with-a-note, and the cached path must never call Grok at all.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { eq, inArray } from 'drizzle-orm';
import { Hono } from 'hono';
import { db } from '../../db/client.ts';
import { digests, meGoals, postsPublished, streaks } from '../db/schema.ts';
import type { DigestFacts } from '../digest.ts';
import { digest } from './digest.ts';

const app = new Hono();
app.route('/x', digest);

const WEEK_KEY = '2025-11-03'; // a Monday, far from other tests' data
const CACHED_WEEK_KEY = '2025-11-10';
const TWEET_ID = '98000000000000001';
const GOAL_ID = 'd1900000-0000-4000-8000-000000000001';
const GOAL_LABEL = 'c9 digest goal';

// GR.9 scorecard weeks, all Mondays far from any other suite's data. WEEK_KEY
// gets 5 tracked days and a graded predecessor; THIN_WEEK_KEY stays under the
// 4-day gate; SOLO_WEEK_KEY is gradeable but its predecessor was never
// generated, so it must report no delta rather than a comparison against zero.
const PREV_WEEK_KEY = '2025-10-27';
const THIN_WEEK_KEY = '2025-11-17';
const SOLO_WEEK_KEY = '2025-11-24';
const PREV_SCORE = 60;
const STREAK_DAYS = [
  { day: '2025-11-03', allDone: true },
  { day: '2025-11-04', allDone: true },
  { day: '2025-11-05', allDone: true },
  { day: '2025-11-06', allDone: false },
  { day: '2025-11-07', allDone: false },
  { day: '2025-11-17', allDone: true },
  { day: '2025-11-18', allDone: true },
  { day: '2025-11-19', allDone: false },
  { day: '2025-11-24', allDone: true },
  { day: '2025-11-25', allDone: true },
  { day: '2025-11-26', allDone: true },
  { day: '2025-11-27', allDone: false },
];

let savedKey: string | undefined;
let savedOrKey: string | undefined;

interface DigestBody {
  weekKey: string;
  facts: DigestFacts;
  narrative: string | null;
  narrativeError?: string;
  cached: boolean;
}

async function get(path: string): Promise<{ status: number; body: DigestBody }> {
  const res = await app.request(path);
  return { status: res.status, body: (await res.json()) as DigestBody };
}

describe('digest route', () => {
  beforeAll(async () => {
    savedKey = process.env.XAI_API_KEY;
    savedOrKey = process.env.OPENROUTER_API_KEY;
    // AI.6: the gate is now llmConfigured() (either provider) — force BOTH off
    // so the route degrades. '' is falsy for the check; assigning undefined
    // would coerce to the string "undefined" and read as configured.
    process.env.XAI_API_KEY = '';
    process.env.OPENROUTER_API_KEY = '';
    await db
      .insert(postsPublished)
      .values({
        tweetId: TWEET_ID,
        text: 'c9 digest test post',
        postedAt: new Date('2025-11-05T10:00:00Z'),
        isReply: false,
        source: 'test',
      })
      .onConflictDoNothing();
    await db
      .insert(digests)
      .values({
        weekKey: CACHED_WEEK_KEY,
        facts: { weekKey: CACHED_WEEK_KEY } as never,
        narrative: 'A cached coach note.',
        model: 'test-model',
        costUsd: 0.01,
      })
      .onConflictDoNothing();
    // An active mrr goal with a manual value → deterministic 16% progress,
    // independent of whatever account snapshot other suites left as "latest".
    await db
      .insert(meGoals)
      .values({
        id: GOAL_ID,
        label: GOAL_LABEL,
        kind: 'mrr',
        target: 5000,
        unit: 'MRR',
        currentValue: 800,
        status: 'active',
      })
      .onConflictDoNothing();
    // GR.9: the diary the scorecard's quest component is graded from, plus a
    // graded predecessor for WEEK_KEY to take a delta against.
    for (const d of STREAK_DAYS) {
      await db
        .insert(streaks)
        .values({ day: d.day, completed: {}, allDone: d.allDone })
        .onConflictDoNothing();
    }
    await db
      .insert(digests)
      .values({
        weekKey: PREV_WEEK_KEY,
        facts: { weekKey: PREV_WEEK_KEY, scorecard: { score: PREV_SCORE } } as never,
        narrative: 'Last week, graded.',
        model: 'test-model',
        costUsd: 0.01,
      })
      .onConflictDoNothing();
  });

  afterAll(async () => {
    process.env.XAI_API_KEY = savedKey ?? '';
    process.env.OPENROUTER_API_KEY = savedOrKey ?? '';
    await db.delete(streaks).where(
      inArray(
        streaks.day,
        STREAK_DAYS.map((d) => d.day),
      ),
    );
    await db.delete(digests).where(eq(digests.weekKey, PREV_WEEK_KEY));
    await db.delete(digests).where(eq(digests.weekKey, CACHED_WEEK_KEY));
    await db.delete(postsPublished).where(eq(postsPublished.tweetId, TWEET_ID));
    await db.delete(meGoals).where(eq(meGoals.id, GOAL_ID));
  });

  test('rejects malformed params', async () => {
    expect((await get('/x/digest?week=nope')).status).toBe(400);
    expect((await get('/x/digest?tzOffsetMin=abc')).status).toBe(400);
    expect((await get('/x/digest?tzOffsetMin=5000')).status).toBe(400);
  });

  test('builds the week facts and degrades gracefully without an LLM key', async () => {
    const { status, body } = await get(`/x/digest?week=${WEEK_KEY}&tzOffsetMin=0`);
    expect(status).toBe(200);
    expect(body.weekKey).toBe(WEEK_KEY);
    expect(body.narrative).toBeNull();
    expect(body.narrativeError).toBe('llm_not_configured');
    expect(body.facts.activity.posts).toBeGreaterThanOrEqual(1);
    expect(body.facts.followers).toBeDefined();
    // §S0.7 roster coverage rides in the facts (this old week has no replies →
    // an all-zero, verdict-null partition; the shape is what matters here).
    const rc = body.facts.rosterCoverage;
    expect(typeof rc.total).toBe('number');
    expect(rc.known + rc.counts.unknown).toBe(rc.total);
    expect(rc.majorityInBand).toBeNull();
  });

  test('any day of the week resolves to the same weekKey', async () => {
    const { body } = await get('/x/digest?week=2025-11-09&tzOffsetMin=0'); // the Sunday
    expect(body.weekKey).toBe(WEEK_KEY);
  });

  test('factsOnly never attempts narration', async () => {
    const { status, body } = await get(`/x/digest?week=${WEEK_KEY}&factsOnly=true`);
    expect(status).toBe(200);
    expect(body.narrative).toBeNull();
    expect(body.narrativeError).toBeUndefined();
  });

  test('active Me goals ride in the facts with computed progress (M1/ME.5)', async () => {
    const { body } = await get(`/x/digest?week=${WEEK_KEY}&factsOnly=true`);
    expect(Array.isArray(body.facts.goals)).toBe(true);
    const goal = body.facts.goals?.find((g) => g.label === GOAL_LABEL);
    expect(goal).toMatchObject({
      label: GOAL_LABEL,
      unit: 'MRR',
      target: 5000,
      current: 800,
      pct: 16,
    });
  });

  test('GR.9: a tracked week is graded and compared with the week before', async () => {
    const { body } = await get(`/x/digest?week=${WEEK_KEY}&tzOffsetMin=0&factsOnly=true`);
    const sc = body.facts.scorecard;
    expect(sc?.sufficient).toBe(true);
    expect(sc?.daysTracked).toBe(5);
    // 3 of 5 days all-done — the one component this suite fully owns.
    expect(sc?.components.questAdherence).toBe(60);
    expect(typeof sc?.score).toBe('number');
    expect(sc?.score).toBeGreaterThanOrEqual(0);
    expect(sc?.score).toBeLessThanOrEqual(100);
    expect(sc?.prevScore).toBe(PREV_SCORE);
    expect(sc?.delta).toBe((sc?.score ?? 0) - PREV_SCORE);
  });

  test('GR.9: under the 4-day gate the whole card is null, not a null score', async () => {
    const { body } = await get(`/x/digest?week=${THIN_WEEK_KEY}&tzOffsetMin=0&factsOnly=true`);
    expect(body.facts.quests.daysTracked).toBe(3);
    expect(body.facts.scorecard).toBeNull();
  });

  test('GR.9: an ungenerated previous week leaves the delta null', async () => {
    const { body } = await get(`/x/digest?week=${SOLO_WEEK_KEY}&tzOffsetMin=0&factsOnly=true`);
    expect(body.facts.scorecard?.sufficient).toBe(true);
    expect(body.facts.scorecard?.prevScore).toBeNull();
    expect(body.facts.scorecard?.delta).toBeNull();
  });

  test('a stored digest is served from cache', async () => {
    const { status, body } = await get(`/x/digest?week=${CACHED_WEEK_KEY}&tzOffsetMin=0`);
    expect(status).toBe(200);
    expect(body.cached).toBe(true);
    expect(body.narrative).toBe('A cached coach note.');
  });
});
