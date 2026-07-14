// C9 quest-block wiring over the real (in-memory, auto-migrated) SQLite DB.
// The DB is shared across test files, so assertions check this file's
// distinctive rows and structural invariants, never exact totals.

import { beforeAll, describe, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { db } from '../../db/client.ts';
import { mentions, postsPublished, replyDrafts, streaks } from '../db/schema.ts';
import { localDayKey } from '../quests.ts';
import { brief } from './brief.ts';

const app = new Hono();
app.route('/x', brief);

const ORIGINAL_ID = '97000000000000001';
const MENTION_ID = '97000000000000002';

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

interface BriefBody {
  account: { conversion: { d7: ConversionWindow; d28: ConversionWindow } };
  pinnedWatch: PinnedWatchBody;
  replyQuota: { postedToday: number };
  today: { anchors: number[]; gaps: BriefGap[] };
  quests: {
    day: string;
    items: Quest[];
    streak: { current: number; todayComplete: boolean };
  };
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
