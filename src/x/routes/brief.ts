// The Daily Brief (OVERHAUL-PLAN §6.4) — one $0 JSON for the side panel's
// Today tab: follower trend, yesterday's numbers, today's schedule + gaps,
// reply quota, 70/30 ratio, and today's spend. Pure SQL over already-billed
// or DOM-captured data; no X API calls. Mounted under `/x` by ../index.ts.
//
// Day boundaries: posts/replies/schedule/quota use the *user's local day*
// (the panel passes `tzOffsetMin` = JS `Date.getTimezoneOffset()`, e.g. -180
// for UTC+3). Spend stays anchored to the UTC day so the number matches
// /cost/today and the X billing window.

import { and, asc, desc, eq, gte, inArray, lt, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { db } from '../../db/client.ts';
import { costEvents } from '../../db/shared-schema.ts';
import { type ConversionTweet, computeConversion } from '../conversion.ts';
import {
  accountSnapshots,
  mentions,
  metricsSnapshots,
  postsPublished,
  replyDrafts,
  scheduledPosts,
  streaks,
  voiceAuthors,
} from '../db/schema.ts';
import {
  allQuestsDone,
  completedMap,
  computeQuests,
  computeStreak,
  launchesAttended,
  localDayKey,
  neglectedTargetsAtDayStart,
} from '../quests.ts';
import { targetBand } from './voice.ts';

const DAY_MS = 24 * 60 * 60 * 1000;

// Doctrine numbers (OVERHAUL-PLAN §9): 10–20 band-gated replies/day, 70%
// replies / 30% originals over the week.
const REPLY_TARGET = { min: 10, max: 20 } as const;
const WEEK_REPLY_TARGET_PCT = 70;

// Cadence anchors from md_to_schedule.ts — 3/day and 4/day local hours.
const ANCHORS_3 = [9, 13, 18];
const ANCHORS_4 = [8, 12, 16, 20];

const SPARKLINE_DAYS = 14;
const LEADER_COUNT = 3;

// S0.1 conversion needs a longer horizon than the 14-day sparkline: the 28-day
// window wants a follower baseline ~28d old (fetch a little extra for it) plus
// every own tweet's profile clicks over the last 28 days. Kept as dedicated
// reads so widening them can't skew the sparkline, the week ratio, or quests.
const CONVERSION_TWEET_DAYS = 28;
const CONVERSION_SNAPSHOT_DAYS = 30;

export const brief = new Hono();

// ------------------------------------------------------------ pure helpers

/** Midnight of the local day `daysBack` days ago, as a UTC instant.
 *  `tzOffsetMin` follows JS `Date.getTimezoneOffset()` sign (UTC − local). */
export function localDayStart(now: Date, tzOffsetMin: number, daysBack = 0): Date {
  const shifted = new Date(now.getTime() - tzOffsetMin * 60_000);
  const utcMidnight = Date.UTC(
    shifted.getUTCFullYear(),
    shifted.getUTCMonth(),
    shifted.getUTCDate() - daysBack,
  );
  return new Date(utcMidnight + tzOffsetMin * 60_000);
}

export function localMinuteOfDay(t: Date, tzOffsetMin: number): number {
  const shifted = new Date(t.getTime() - tzOffsetMin * 60_000);
  return shifted.getUTCHours() * 60 + shifted.getUTCMinutes();
}

/** Compare today's filled slots against the cadence that best matches them —
 *  4+ filled slots means the 4/day ladder, otherwise the 3/day one. */
export function pickAnchors(filledSlotCount: number): number[] {
  return filledSlotCount >= 4 ? ANCHORS_4 : ANCHORS_3;
}

/** Assign each scheduled time (local minutes since midnight) to its nearest
 *  anchor hour; anchors left unclaimed are the day's empty slots. Ties go to
 *  the earlier anchor. */
export function findScheduleGaps(postMinutes: number[], anchors: number[]): number[] {
  const filled = new Set<number>();
  for (const m of postMinutes) {
    let best = anchors[0] ?? 0;
    for (const a of anchors) {
      if (Math.abs(m - a * 60) < Math.abs(m - best * 60)) best = a;
    }
    filled.add(best);
  }
  return anchors.filter((a) => !filled.has(a));
}

export interface FollowerPoint {
  snapshotAt: Date;
  followers: number;
}

/** Latest follower count + change vs the newest snapshot at least 7 days old
 *  (falls back to the oldest point when history is shorter; null with <2
 *  points — there is nothing to diff against). */
export function followerTrend(
  points: FollowerPoint[],
  now: Date,
): { followers: number | null; measuredAt: Date | null; delta7d: number | null } {
  if (points.length === 0) return { followers: null, measuredAt: null, delta7d: null };
  const ordered = [...points].sort((a, b) => a.snapshotAt.getTime() - b.snapshotAt.getTime());
  const latest = ordered.at(-1) as FollowerPoint;
  const weekAgo = now.getTime() - 7 * DAY_MS;
  let baseline = ordered[0] as FollowerPoint;
  for (const p of ordered) {
    if (p.snapshotAt.getTime() <= weekAgo) baseline = p;
  }
  return {
    followers: latest.followers,
    measuredAt: latest.snapshotAt,
    delta7d: baseline === latest ? null : latest.followers - baseline.followers,
  };
}

interface PublishedRow {
  tweetId: string;
  text: string;
  postedAt: Date;
  isReply: boolean;
}

interface SnapRow {
  tweetId: string;
  snapshotAt: Date;
  publicMetrics: unknown;
  nonPublicMetrics: unknown;
}

export interface BriefTweet {
  tweetId: string;
  text: string;
  postedAt: Date;
  isReply: boolean;
  measuredAt: Date | null;
  metrics: {
    views: number | null;
    likes: number | null;
    replies: number | null;
    retweets: number | null;
    quotes: number | null;
    bookmarks: number | null;
    profileVisits: number | null;
  } | null;
}

/** Attach each tweet's latest snapshot. `snaps` must arrive newest-first —
 *  the first row seen per tweet wins (same pattern as metrics.ts). */
export function attachLatestSnapshots(posts: PublishedRow[], snaps: SnapRow[]): BriefTweet[] {
  const latest = new Map<string, SnapRow>();
  for (const s of snaps) if (!latest.has(s.tweetId)) latest.set(s.tweetId, s);

  return posts.map((p) => {
    const s = latest.get(p.tweetId);
    const pub = (s?.publicMetrics ?? null) as Record<string, number> | null;
    const priv = (s?.nonPublicMetrics ?? null) as Record<string, number> | null;
    return {
      tweetId: p.tweetId,
      text: p.text,
      postedAt: p.postedAt,
      isReply: p.isReply,
      measuredAt: s?.snapshotAt ?? null,
      metrics: s
        ? {
            views: pub?.impression_count ?? priv?.impression_count ?? null,
            likes: pub?.like_count ?? null,
            replies: pub?.reply_count ?? null,
            retweets: pub?.retweet_count ?? null,
            quotes: pub?.quote_count ?? null,
            bookmarks: pub?.bookmark_count ?? null,
            profileVisits: priv?.user_profile_clicks ?? null,
          }
        : null,
    };
  });
}

// ------------------------------------------------------------------ route

brief.get('/brief', async (c) => {
  const tzStr = c.req.query('tzOffsetMin');
  let tzOffsetMin = 0;
  if (tzStr !== undefined) {
    const n = Number(tzStr);
    if (!Number.isInteger(n) || Math.abs(n) > 16 * 60) {
      return c.json({ error: 'invalid_tz_offset_min' }, 400);
    }
    tzOffsetMin = n;
  }

  const now = new Date();
  const todayStart = localDayStart(now, tzOffsetMin);
  const tomorrowStart = new Date(todayStart.getTime() + DAY_MS);
  const yesterdayStart = new Date(todayStart.getTime() - DAY_MS);
  const weekAgo = new Date(now.getTime() - 7 * DAY_MS);
  const utcDayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const utcDayEnd = new Date(utcDayStart.getTime() + DAY_MS);

  const [snaps, convSnaps, convPublished, published, scheduled, postedDraftRows, costRows] =
    await Promise.all([
      db
        .select({
          snapshotAt: accountSnapshots.snapshotAt,
          followersCount: accountSnapshots.followersCount,
        })
        .from(accountSnapshots)
        .where(gte(accountSnapshots.snapshotAt, new Date(now.getTime() - SPARKLINE_DAYS * DAY_MS)))
        .orderBy(asc(accountSnapshots.snapshotAt)),
      // S0.1: follower series over the conversion horizon (superset of the
      // sparkline window, so the 28d baseline exists).
      db
        .select({
          snapshotAt: accountSnapshots.snapshotAt,
          followersCount: accountSnapshots.followersCount,
        })
        .from(accountSnapshots)
        .where(
          gte(
            accountSnapshots.snapshotAt,
            new Date(now.getTime() - CONVERSION_SNAPSHOT_DAYS * DAY_MS),
          ),
        )
        .orderBy(asc(accountSnapshots.snapshotAt)),
      // S0.1: every own tweet (posts AND replies — each earns profile visits)
      // posted in the last 28 days; clicks come from their latest snapshot below.
      db
        .select({ tweetId: postsPublished.tweetId, postedAt: postsPublished.postedAt })
        .from(postsPublished)
        .where(
          gte(postsPublished.postedAt, new Date(now.getTime() - CONVERSION_TWEET_DAYS * DAY_MS)),
        )
        .orderBy(asc(postsPublished.postedAt)),
      db
        .select({
          tweetId: postsPublished.tweetId,
          text: postsPublished.text,
          postedAt: postsPublished.postedAt,
          isReply: postsPublished.isReply,
        })
        .from(postsPublished)
        .where(gte(postsPublished.postedAt, weekAgo))
        .orderBy(asc(postsPublished.postedAt)),
      db
        .select({
          id: scheduledPosts.id,
          text: scheduledPosts.text,
          scheduledFor: scheduledPosts.scheduledFor,
          status: scheduledPosts.status,
        })
        .from(scheduledPosts)
        .where(
          and(
            gte(scheduledPosts.scheduledFor, todayStart),
            lt(scheduledPosts.scheduledFor, tomorrowStart),
            inArray(scheduledPosts.status, ['pending', 'posted', 'failed']),
          ),
        )
        .orderBy(asc(scheduledPosts.scheduledFor)),
      // A posted draft is near-terminal (only → discarded), so updatedAt is in
      // effect "when the human pasted it" — the only realtime posted signal we
      // have; manual replies posted outside Reply Master only show up after the
      // next 03:00 discovery pass. Full rows (not a count) since C9: the quest
      // block needs paste times (launch attendance) and handles (targets quest).
      db
        .select({
          updatedAt: replyDrafts.updatedAt,
          sourceAuthorUsername: replyDrafts.sourceAuthorUsername,
        })
        .from(replyDrafts)
        .where(
          and(
            eq(replyDrafts.status, 'posted'),
            gte(replyDrafts.updatedAt, todayStart),
            lt(replyDrafts.updatedAt, tomorrowStart),
          ),
        ),
      db
        .select({
          platform: costEvents.platform,
          costUsd: sql<string>`coalesce(sum(${costEvents.costUsd}), 0)`,
          calls: sql<string>`count(*)`,
        })
        .from(costEvents)
        .where(and(gte(costEvents.ts, utcDayStart), lt(costEvents.ts, utcDayEnd)))
        .groupBy(costEvents.platform),
    ]);

  const tweetIds = published.map((p) => p.tweetId);
  const metricSnaps = tweetIds.length
    ? await db
        .select({
          tweetId: metricsSnapshots.tweetId,
          snapshotAt: metricsSnapshots.snapshotAt,
          publicMetrics: metricsSnapshots.publicMetrics,
          nonPublicMetrics: metricsSnapshots.nonPublicMetrics,
        })
        .from(metricsSnapshots)
        .where(inArray(metricsSnapshots.tweetId, tweetIds))
        .orderBy(sql`${metricsSnapshots.snapshotAt} desc`)
    : [];

  const weekTweets = attachLatestSnapshots(published, metricSnaps);

  // S0.1: profile-click sum per own tweet over the 28-day horizon (latest
  // snapshot per tweet — same newest-first, first-wins read as everywhere).
  const convTweetIds = convPublished.map((p) => p.tweetId);
  const convSnapRows = convTweetIds.length
    ? await db
        .select({
          tweetId: metricsSnapshots.tweetId,
          nonPublicMetrics: metricsSnapshots.nonPublicMetrics,
        })
        .from(metricsSnapshots)
        .where(inArray(metricsSnapshots.tweetId, convTweetIds))
        .orderBy(sql`${metricsSnapshots.snapshotAt} desc`)
    : [];
  const clicksByTweet = new Map<string, number | null>();
  for (const s of convSnapRows) {
    if (clicksByTweet.has(s.tweetId)) continue;
    const priv = (s.nonPublicMetrics ?? null) as Record<string, number> | null;
    clicksByTweet.set(s.tweetId, priv?.user_profile_clicks ?? null);
  }
  const conversionTweets: ConversionTweet[] = convPublished.map((p) => ({
    postedAt: p.postedAt,
    profileVisits: clicksByTweet.get(p.tweetId) ?? null,
  }));
  const conversion = computeConversion(
    convSnaps.map((s) => ({ snapshotAt: s.snapshotAt, followers: s.followersCount })),
    conversionTweets,
    now,
  );

  const yesterdayTweets = weekTweets.filter(
    (t) => t.postedAt >= yesterdayStart && t.postedAt < todayStart,
  );
  const profileClickLeaders = weekTweets
    .filter((t) => (t.metrics?.profileVisits ?? 0) > 0)
    .sort((a, b) => (b.metrics?.profileVisits ?? 0) - (a.metrics?.profileVisits ?? 0))
    .slice(0, LEADER_COUNT);

  // Gaps compare against pending/posted only — a failed row still occupies the
  // list (so the user sees what to fix) but its slot reads as unfilled.
  const slotted = scheduled.filter((s) => s.status !== 'failed' && s.scheduledFor !== null);
  const anchors = pickAnchors(slotted.length);
  const gaps = findScheduleGaps(
    slotted.map((s) => localMinuteOfDay(s.scheduledFor as Date, tzOffsetMin)),
    anchors,
  );

  const weekReplies = published.filter((p) => p.isReply).length;
  const weekPosts = published.length - weekReplies;
  const weekTotal = published.length;

  let xUsd = 0;
  let grokUsd = 0;
  let totalUsd = 0;
  const byPlatform = costRows
    .map((r) => {
      const usd = round5(Number(r.costUsd));
      if (r.platform === 'x') xUsd = usd;
      if (r.platform === 'grok') grokUsd = usd;
      totalUsd += usd;
      return { platform: r.platform, costUsd: usd, calls: Number(r.calls) };
    })
    .sort((a, b) => b.costUsd - a.costUsd);

  // ---------------------------------------------------------- quests (C9)
  // All from rows already collected by other surfaces — no new reads billed.

  const todayPublished = published.filter(
    (p) => p.postedAt >= todayStart && p.postedAt < tomorrowStart,
  );
  const originalsToday = todayPublished.filter((p) => !p.isReply);
  const replyPasteTimes = postedDraftRows.map((d) => d.updatedAt);

  const [voiceRows, [answeredToday], [unansweredNow]] = await Promise.all([
    db
      .select({ handle: voiceAuthors.handle, followersCount: voiceAuthors.followersCount })
      .from(voiceAuthors)
      .where(eq(voiceAuthors.retired, false)),
    db
      .select({ n: sql<string>`count(*)` })
      .from(mentions)
      .where(
        and(
          eq(mentions.status, 'answered'),
          gte(mentions.answeredAt, todayStart),
          lt(mentions.answeredAt, tomorrowStart),
        ),
      ),
    db.select({ n: sql<string>`count(*)` }).from(mentions).where(eq(mentions.status, 'unanswered')),
  ]);

  // Target roster = the same 2–10x band as /voice/targets; empty until the
  // first daily pass writes an account snapshot.
  const myFollowers = snaps.at(-1)?.followersCount ?? null;
  const targetHandles = new Set<string>();
  if (myFollowers !== null) {
    const band = targetBand(myFollowers);
    for (const a of voiceRows) {
      if (a.followersCount !== null && a.followersCount >= band.min && a.followersCount <= band.max)
        targetHandles.add(a.handle);
    }
  }

  // Each target's last pasted reply BEFORE today — "neglected at day start"
  // must not be erased by the very reply that satisfies the quest.
  const priorOutbound = new Map<string, Date>();
  if (targetHandles.size > 0) {
    const priorRows = await db
      .select({
        handle: sql<string>`lower(${replyDrafts.sourceAuthorUsername})`,
        last: sql`max(${replyDrafts.updatedAt})`.mapWith(replyDrafts.updatedAt),
      })
      .from(replyDrafts)
      .where(
        and(
          eq(replyDrafts.status, 'posted'),
          lt(replyDrafts.updatedAt, todayStart),
          inArray(sql`lower(${replyDrafts.sourceAuthorUsername})`, [...targetHandles]),
        ),
      )
      .groupBy(sql`lower(${replyDrafts.sourceAuthorUsername})`);
    for (const r of priorRows) priorOutbound.set(r.handle, r.last);
  }
  const neglectedAtStart = neglectedTargetsAtDayStart(targetHandles, priorOutbound, todayStart);
  const repliedTodayHandles = new Set(
    postedDraftRows.map((d) => d.sourceAuthorUsername.toLowerCase()),
  );
  let targetsTouched = 0;
  for (const h of neglectedAtStart) if (repliedTodayHandles.has(h)) targetsTouched++;

  const questItems = computeQuests({
    repliesPostedToday: postedDraftRows.length,
    repliesTarget: REPLY_TARGET.min,
    originalsPostedToday: originalsToday.length,
    neglectedTargetsAtDayStart: neglectedAtStart.size,
    neglectedTargetsTouched: targetsTouched,
    loopsClosedToday: Number(answeredToday?.n ?? 0),
    openLoopsNow: Number(unansweredNow?.n ?? 0),
    launchesToday: originalsToday.length,
    launchesAttended: launchesAttended(
      originalsToday.map((p) => p.postedAt),
      replyPasteTimes,
    ),
  });

  // Idempotent per day: every brief read overwrites today's row with the
  // freshest quest state — the streak table is a diary, not an event log.
  const dayKey = localDayKey(now, tzOffsetMin);
  const completed = completedMap(questItems);
  const allDone = allQuestsDone(questItems);
  await db
    .insert(streaks)
    .values({ day: dayKey, completed, allDone, updatedAt: now })
    .onConflictDoUpdate({
      target: streaks.day,
      set: { completed, allDone, updatedAt: now },
    });
  const streakRows = await db
    .select({ day: streaks.day, allDone: streaks.allDone })
    .from(streaks)
    .orderBy(desc(streaks.day))
    .limit(400);
  const streak = computeStreak(streakRows, dayKey);

  return c.json({
    generatedAt: now,
    tzOffsetMin,
    account: {
      ...followerTrend(
        snaps.map((s) => ({ snapshotAt: s.snapshotAt, followers: s.followersCount })),
        now,
      ),
      sparkline: snaps.map((s) => ({ snapshotAt: s.snapshotAt, followers: s.followersCount })),
      // S0.1: earned-visit → follow conversion, 7d and 28d (null rate < 20 clicks).
      conversion,
    },
    yesterday: {
      from: yesterdayStart,
      to: todayStart,
      posts: yesterdayTweets.filter((t) => !t.isReply),
      replies: yesterdayTweets.filter((t) => t.isReply),
      // Best earned-profile-visit tweets over the trailing week, not just
      // yesterday — yesterday's rows usually haven't been snapshotted yet.
      profileClickLeaders,
    },
    today: {
      from: todayStart,
      to: tomorrowStart,
      scheduled,
      anchors,
      gaps,
    },
    replyQuota: {
      postedToday: postedDraftRows.length,
      target: REPLY_TARGET,
    },
    quests: {
      day: dayKey,
      items: questItems,
      streak,
    },
    week: {
      from: weekAgo,
      to: now,
      posts: weekPosts,
      replies: weekReplies,
      replyPct: weekTotal === 0 ? null : Math.round((weekReplies / weekTotal) * 100),
      targetReplyPct: WEEK_REPLY_TARGET_PCT,
    },
    spend: {
      from: utcDayStart,
      to: utcDayEnd,
      xUsd,
      grokUsd,
      totalUsd: round5(totalUsd),
      byPlatform,
    },
  });
});

function round5(n: number): number {
  return Math.round(n * 1e5) / 1e5;
}
