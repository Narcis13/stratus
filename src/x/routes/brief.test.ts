// C9 quest-block wiring over the real (in-memory, auto-migrated) SQLite DB.
// The DB is shared across test files, so assertions check this file's
// distinctive rows and structural invariants, never exact totals.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { eq, inArray } from 'drizzle-orm';
import { Hono } from 'hono';
import { db } from '../../db/client.ts';
import {
  commitments,
  meGoals,
  mentions,
  postsPublished,
  replyDrafts,
  scheduledPosts,
  streaks,
} from '../db/schema.ts';
import { localDayKey } from '../quests.ts';
import { brief } from './brief.ts';

const app = new Hono();
app.route('/x', brief);

const ORIGINAL_ID = '97000000000000001';
const MENTION_ID = '97000000000000002';
// GR.6: a pending pair used to prove the monitor block is wired. Deliberately
// ~200 days out — far from every other suite's calendar fixture, outside the
// brief's own today-window, and `scheduleCluster` reads no clock, so the alert
// it produces is deterministic rather than baseline-relative.
const SLOT_IDS = ['gr6-brief-slot-a', 'gr6-brief-slot-b'];

interface Quest {
  key: string;
  label: string;
  n: number;
  target: number;
  done: boolean;
  note: string | null;
}

interface ConversionWindow {
  windowDays: number;
  profileClicks: number;
  followerDelta: number | null;
  rate: number | null;
}

interface BriefGap {
  hour: number;
  n: number;
  avgViewsPerDay: number | null;
  avgViews: number | null;
  score: number | null;
  sufficient: boolean;
}

interface PinnedWatchBody {
  pinnedTweetId: string | null;
  since: string | null;
  ageDays: number | null;
  stale: boolean;
  pinnedViews: number | null;
  outperformer: { tweetId: string; text: string; views: number; ratio: number } | null;
}

interface MonitorBlock {
  alerts: Array<{ rule: string; severity: string; message: string }>;
  worst: string | null;
}

interface GoalBlock {
  id: string;
  label: string;
  status: string;
  target: number;
  pacing: {
    current: number | null;
    pctComplete: number | null;
    daysLeft: number | null;
    requiredPerDay: number | null;
    actualPerDay: number | null;
    verdict: string;
    projectedAt: string | null;
  };
}

interface CommitmentBlock {
  key: string;
  dailyTarget: number;
  active: boolean;
  debt: { missedLast7: number; missedLast30: number; trackedLast7: number; tier: number };
}

interface BriefBody {
  account: { conversion: { d7: ConversionWindow; d28: ConversionWindow } };
  pinnedWatch: PinnedWatchBody;
  monitor: MonitorBlock;
  replyQuota: { postedToday: number; target: { min: number; max: number } };
  today: { anchors: number[]; gaps: BriefGap[] };
  quests: {
    day: string;
    items: Quest[];
    streak: { current: number; todayComplete: boolean };
  };
  goals: GoalBlock[];
  commitments: CommitmentBlock[];
}

async function getBrief(): Promise<BriefBody> {
  const res = await app.request('/x/brief?tzOffsetMin=0');
  expect(res.status).toBe(200);
  return (await res.json()) as BriefBody;
}

describe('brief quests (C9)', () => {
  beforeAll(async () => {
    const now = new Date();
    // An original that went live 5 minutes ago…
    await db
      .insert(postsPublished)
      .values({
        tweetId: ORIGINAL_ID,
        text: 'c9 brief test original',
        postedAt: new Date(now.getTime() - 5 * 60_000),
        isReply: false,
        source: 'test',
      })
      .onConflictDoNothing();
    // …and a reply pasted 2 minutes ago — inside the 30-min launch window.
    await db.insert(replyDrafts).values({
      sourceTweetId: '97000000000000009',
      sourceAuthorUsername: 'c9_brief_target',
      sourceText: 'c9 source',
      sourceUrl: 'https://x.com/c9_brief_target/status/97000000000000009',
      contextSnapshot: {},
      replyText: 'c9 reply',
      model: 'test',
      status: 'posted',
      updatedAt: new Date(now.getTime() - 2 * 60_000),
    });
    // One open loop closed today.
    await db
      .insert(mentions)
      .values({
        tweetId: MENTION_ID,
        authorUsername: 'c9_brief_fan',
        text: 'c9 mention',
        postedAt: new Date(now.getTime() - 3 * 3600_000),
        status: 'answered',
        answeredAt: now,
      })
      .onConflictDoNothing();

    const far = now.getTime() + 200 * 24 * 3_600_000;
    await db.insert(scheduledPosts).values([
      {
        id: SLOT_IDS[0] as string,
        text: 'gr6 brief monitor slot one',
        scheduledFor: new Date(far),
        status: 'pending',
        source: 'test',
      },
      {
        id: SLOT_IDS[1] as string,
        text: 'gr6 brief monitor slot two',
        scheduledFor: new Date(far + 30 * 60_000),
        status: 'pending',
        source: 'test',
      },
    ]);
  });

  afterAll(async () => {
    await db.delete(scheduledPosts).where(inArray(scheduledPosts.id, SLOT_IDS));
  });

  test('quest block has all five quests and reads the seeded rows', async () => {
    const body = await getBrief();
    const byKey = new Map(body.quests.items.map((q) => [q.key, q]));
    expect([...byKey.keys()].sort()).toEqual(['launch', 'loop', 'original', 'replies', 'targets']);

    expect(byKey.get('original')?.done).toBe(true);
    expect(byKey.get('replies')?.n).toBeGreaterThanOrEqual(1);
    expect(byKey.get('replies')?.n).toBe(body.replyQuota.postedToday);
    // The seeded mention was answered today → loop quest hit.
    expect(byKey.get('loop')?.done).toBe(true);
    // A launch happened and a reply was pasted inside its window.
    expect(byKey.get('launch')?.done).toBe(true);
    expect(byKey.get('launch')?.target).toBe(1);
  });

  test('today.gaps are best-times-annotated objects, sorted highest-value first (S0.4)', async () => {
    const body = await getBrief();
    expect(Array.isArray(body.today.gaps)).toBe(true);
    // Rank: any sufficient gap (by score) outranks any "no data" gap.
    let prevRank: number | null = null;
    for (const g of body.today.gaps) {
      expect(typeof g.hour).toBe('number');
      expect(typeof g.n).toBe('number');
      expect(typeof g.sufficient).toBe('boolean');
      // Below the n≥3 gate a gap carries no score (renders as "no data").
      if (!g.sufficient) expect(g.score).toBeNull();
      else expect(typeof g.score).toBe('number');
      const rank = g.sufficient ? 1_000_000 + (g.score ?? 0) : 0;
      if (prevRank !== null) expect(rank).toBeLessThanOrEqual(prevRank);
      prevRank = rank;
    }
  });

  test('account carries S0.9 pinned-watch, all-quiet when no pin is recorded', async () => {
    const body = await getBrief();
    const w = body.pinnedWatch;
    expect(typeof w).toBe('object');
    expect(w.pinnedTweetId === null || typeof w.pinnedTweetId === 'string').toBe(true);
    expect(typeof w.stale).toBe('boolean');
    expect(w.ageDays === null || typeof w.ageDays === 'number').toBe(true);
    expect(w.pinnedViews === null || typeof w.pinnedViews === 'number').toBe(true);
    expect(w.outperformer === null || typeof w.outperformer === 'object').toBe(true);
    // No test seeds a pinned_tweet_id, so the series has no pin → nothing to warn.
    if (w.pinnedTweetId === null) {
      expect(w.stale).toBe(false);
      expect(w.outperformer).toBeNull();
      expect(w.since).toBeNull();
    }
  });

  test('account carries S0.1 conversion for both windows', async () => {
    const body = await getBrief();
    for (const w of [body.account.conversion.d7, body.account.conversion.d28]) {
      expect(typeof w.windowDays).toBe('number');
      expect(typeof w.profileClicks).toBe('number');
      expect(w.profileClicks).toBeGreaterThanOrEqual(0);
      // followerDelta/rate are number-or-null; rate is null under 20 clicks.
      expect(w.followerDelta === null || typeof w.followerDelta === 'number').toBe(true);
      expect(w.rate === null || typeof w.rate === 'number').toBe(true);
      if (w.profileClicks < 20) expect(w.rate).toBeNull();
    }
    expect(body.account.conversion.d7.windowDays).toBe(7);
    expect(body.account.conversion.d28.windowDays).toBe(28);
  });

  test('carries the GR.6 monitor block, one alert per rule, worst derived from it', async () => {
    const body = await getBrief();
    expect(Array.isArray(body.monitor.alerts)).toBe(true);
    // The alert contract the Today card keys on: never two rows for one rule.
    const rules = body.monitor.alerts.map((a) => a.rule);
    expect(new Set(rules).size).toBe(rules.length);
    // `worst` is derived from the alerts shipped alongside it, never stale —
    // and they arrive severity-desc, so it is the first one's severity.
    if (body.monitor.alerts.length === 0) expect(body.monitor.worst).toBeNull();
    else expect(body.monitor.worst).toBe(body.monitor.alerts[0]?.severity as string);

    // The wiring claim: the seeded pending pair is 30 min apart, so the brief
    // must be running the same rules over the same rows as GET /x/monitor.
    const cluster = body.monitor.alerts.find((a) => a.rule === 'scheduleCluster');
    expect(cluster?.severity).toBe('info');
    expect(typeof cluster?.message).toBe('string');
  });

  test('streak row is written idempotently — one row per day', async () => {
    await getBrief();
    await getBrief();
    const dayKey = localDayKey(new Date(), 0);
    const rows = await db.select().from(streaks).where(eq(streaks.day, dayKey));
    expect(rows.length).toBe(1);
    expect(rows[0]?.completed).toHaveProperty('replies');
    const body = await getBrief();
    expect(body.quests.day).toBe(dayKey);
    expect(typeof body.quests.streak.current).toBe('number');
  });
});

// GR.8 — the accountability blocks. Every test sets up the commitments state it
// needs at its own start (the table is tiny and only this file and
// goals.test.ts ever write it), so no assertion depends on test order.
describe('brief accountability blocks (GR.8)', () => {
  const GOAL_ID = 'gr8-brief-goal';
  const DAY = 86_400_000;

  beforeAll(async () => {
    const now = Date.now();
    await db.delete(commitments);
    // A `custom` goal so the pacing arithmetic is fully seeded here and can't
    // move with whatever account_snapshots other suites leave behind: 40 of 100
    // in 10 days (4/day measured) with 30 days left (2/day required) = ahead.
    await db.insert(meGoals).values({
      id: GOAL_ID,
      label: 'gr8 brief goal',
      kind: 'custom',
      target: 100,
      currentValue: 40,
      baselineValue: 0,
      baselineAt: new Date(now - 10 * DAY),
      deadline: new Date(now + 30 * DAY),
      status: 'active',
    });
  });

  afterAll(async () => {
    await db.delete(commitments);
    await db.delete(meGoals).where(eq(meGoals.id, GOAL_ID));
  });

  test('with no commitments the quest targets are the shipped defaults', async () => {
    await db.delete(commitments);
    const body = await getBrief();
    const byKey = new Map(body.quests.items.map((q) => [q.key, q]));
    expect(byKey.get('replies')?.target).toBe(body.replyQuota.target.min);
    expect(byKey.get('original')?.target).toBe(1);
    expect(body.commitments).toEqual([]);
  });

  test('an active replies commitment outranks the doctrine quota target', async () => {
    await db.delete(commitments);
    await db
      .insert(commitments)
      .values({ key: 'replies', dailyTarget: 17, active: true, updatedAt: new Date() });
    const body = await getBrief();
    const replies = body.quests.items.find((q) => q.key === 'replies');
    expect(replies?.target).toBe(17);
    expect(replies?.label).toBe('17 quality replies');
    // The doctrine band itself is untouched — the commitment is a personal
    // minimum, not a redefinition of the 10–20/day reply doctrine.
    expect(body.replyQuota.target.min).not.toBe(17);
  });

  test('a paused commitment changes nothing', async () => {
    await db.delete(commitments);
    await db
      .insert(commitments)
      .values({ key: 'replies', dailyTarget: 17, active: false, updatedAt: new Date() });
    const body = await getBrief();
    const replies = body.quests.items.find((q) => q.key === 'replies');
    expect(replies?.target).toBe(body.replyQuota.target.min);
    // …but it still ships, so the panel can show what is paused.
    expect(body.commitments.find((c) => c.key === 'replies')?.active).toBe(false);
  });

  test('an active originals commitment raises the original quest', async () => {
    await db.delete(commitments);
    await db
      .insert(commitments)
      .values({ key: 'originals', dailyTarget: 3, active: true, updatedAt: new Date() });
    const body = await getBrief();
    const original = body.quests.items.find((q) => q.key === 'original');
    expect(original?.target).toBe(3);
    expect(original?.label).toBe('3 original posts');
  });

  test('commitments carry the debt tier over the streak diary', async () => {
    await db.delete(commitments);
    // Promised three days ago → exactly three days are on the hook (the window
    // ends yesterday; today is still in progress and can never be a miss).
    await db.insert(commitments).values({
      key: 'replies',
      dailyTarget: 12,
      active: true,
      activeSince: new Date(Date.now() - 3 * DAY),
      updatedAt: new Date(),
    });
    const body = await getBrief();
    const c = body.commitments.find((x) => x.key === 'replies');
    expect(c?.dailyTarget).toBe(12);
    expect(c?.debt.trackedLast7).toBe(3);
    expect(c?.debt.missedLast7).toBeLessThanOrEqual(3);
    // Tier ladder (cutoffs 1/3/5) — asserted against whatever the shared diary
    // actually holds rather than a fixed count other suites could perturb.
    const missed = c?.debt.missedLast7 ?? 0;
    expect(c?.debt.tier).toBe(missed >= 5 ? 3 : missed >= 3 ? 2 : missed >= 1 ? 1 : 0);
  });

  test('goals arrive active-only with live pacing', async () => {
    const body = await getBrief();
    for (const g of body.goals) expect(g.status).toBe('active');
    const g = body.goals.find((x) => x.id === GOAL_ID);
    expect(g?.pacing.current).toBe(40);
    expect(g?.pacing.pctComplete).toBe(40);
    expect(g?.pacing.daysLeft).toBe(30);
    expect(g?.pacing.requiredPerDay).toBeCloseTo(2, 5);
    expect(g?.pacing.actualPerDay).toBeCloseTo(4, 1);
    expect(g?.pacing.verdict).toBe('ahead');
  });
});
