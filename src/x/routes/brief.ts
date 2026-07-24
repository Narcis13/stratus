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
import { type ActiveTimesGrid, audienceScoreFor } from '../../shared/activeTimes.ts';
import { type ConversionTweet, computeConversion } from '../conversion.ts';
import {
  accountSnapshots,
  audienceActivity,
  mentions,
  metricsSnapshots,
  postsPublished,
  replyDrafts,
  scheduledPosts,
  streaks,
  voiceAuthors,
} from '../db/schema.ts';
import { runMonitor, worstOf } from '../monitor.ts';
import { loadDoctrine } from '../niche/store.ts';
import {
  allQuestsDone,
  completedMap,
  computeQuests,
  computeStreak,
  launchesAttended,
  localDayKey,
  neglectedTargetsAtDayStart,
} from '../quests.ts';
import { getSetting } from '../settings/registry.ts';
import { type CommitmentView, loadCommitmentsWithDebt, loadGoalsWithPacing } from './goals.ts';
import { type BestTimeCell, bestTimeCellFor, bestTimeScore, loadBestTimeCells } from './metrics.ts';
import { loadMonitorInputs } from './monitor.ts';
import { targetBand } from './voice.ts';

const DAY_MS = 24 * 60 * 60 * 1000;

// Cadence anchors from md_to_schedule.ts — 3/day and 4/day local hours. These are
// the module DEFAULTS; the brief route overrides them per request from the mirrored
// x.doctrine.anchors3/anchors4/ladderSwitchAt settings (UI.2). The former
// SPARKLINE_DAYS / LEADER_COUNT constants now live in the settings store's `display`
// group (x.display.sparklineDays / x.display.leaderCount).
const ANCHORS_3 = [9, 13, 18];
const ANCHORS_4 = [8, 12, 16, 20];
const LADDER_SWITCH_AT = 4;

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

/** The cadence config the brief passes down — anchor hours for each ladder and the
 *  filled-slot count at which the 4/day ladder takes over. Defaults are the module
 *  constants; the route overrides them from the settings store (UI.2). */
export interface AnchorConfig {
  anchors3: number[];
  anchors4: number[];
  ladderSwitchAt: number;
}
const ANCHOR_DEFAULTS: AnchorConfig = {
  anchors3: ANCHORS_3,
  anchors4: ANCHORS_4,
  ladderSwitchAt: LADDER_SWITCH_AT,
};

/** Compare today's filled slots against the cadence that best matches them —
 *  `ladderSwitchAt`+ filled slots means the 4/day ladder, otherwise the 3/day one. */
export function pickAnchors(
  filledSlotCount: number,
  cfg: AnchorConfig = ANCHOR_DEFAULTS,
): number[] {
  return filledSlotCount >= cfg.ladderSwitchAt ? cfg.anchors4 : cfg.anchors3;
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

/** S0.4: one gap = an empty local anchor hour + its best-times score. `n` is
 *  how many measured posts fell in that (weekday, hour) cell; `sufficient` is
 *  n ≥ the advice gate — below it the extension renders "no data", never a
 *  recommendation. Sorted highest-value-first (sufficient before "no data",
 *  then by score, ties by hour) so the strategist fills the best hole first. */
export interface AnnotatedGap {
  hour: number;
  n: number;
  avgViewsPerDay: number | null;
  avgViews: number | null;
  score: number | null;
  sufficient: boolean;
  /** A3.4: captured audience presence for this local (weekday, hour), 0..1, or
   *  null with no capture. Display data for the TodayPlan row — NEVER a reorder
   *  key (§7.19/decision 10: own measured cells rank; audience is labeled). */
  audienceScore: number | null;
}

export function annotateGaps(
  gapHours: number[],
  cells: BestTimeCell[],
  localWeekday: number,
  audience?: ActiveTimesGrid | null,
): AnnotatedGap[] {
  return gapHours
    .map((hour) => {
      const cell = bestTimeCellFor(cells, localWeekday, hour);
      const score = bestTimeScore(cell);
      return {
        hour,
        n: cell?.posts ?? 0,
        avgViewsPerDay: cell?.avgViewsPerDay ?? null,
        avgViews: cell?.avgViews ?? null,
        score,
        sufficient: score != null,
        audienceScore: audience ? audienceScoreFor(audience, localWeekday, hour) : null,
      };
    })
    .sort((a, b) => {
      if (a.sufficient !== b.sufficient) return a.sufficient ? -1 : 1;
      if (a.score != null && b.score != null && a.score !== b.score) return b.score - a.score;
      return a.hour - b.hour;
    });
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

// ------------------------------------------------------- pinned watch (S0.9)

// Profile visits land on the pinned tweet, so a stale or out-performed pin
// leaks the account's best first impression. Two nudges, never an action
// (pinning stays manual in the X app): warn when the pin hasn't changed in
// >21 days, or when a recent post has ≥3× its measured views. Both thresholds
// are settings-backed (UI.3, the `pinned` group); buildPinnedWatch takes them as
// params defaulted here, and the brief handler reads the overrides.
const PIN_STALE_DAYS = 21;
const PIN_OUTPERFORM_RATIO = 3;
const PIN_DEFAULTS = { staleDays: PIN_STALE_DAYS, outperformRatio: PIN_OUTPERFORM_RATIO };
/** Only originals posted this recently count as "your best work isn't pinned"
 *  candidates — an old post the user already chose not to pin isn't news. */
const PIN_CANDIDATE_DAYS = 30;

export interface PinSeriesPoint {
  snapshotAt: Date;
  pinnedTweetId: string | null;
}

/** The current pin and when it was first observed. Walks the chronological
 *  account-snapshot series: the current pin is the latest non-null
 *  `pinned_tweet_id`, and `since` is the earliest snapshot in the latest
 *  contiguous run of that same id. Snapshots with a null pin (every row before
 *  the S0.9 column, plus days with nothing pinned) are ignored — `since` is
 *  therefore never earlier than the first day we recorded a pin, so the >21d
 *  warning can't fire on backfilled history. null when no pin recorded yet. */
export function pinnedSince(series: PinSeriesPoint[]): {
  pinnedTweetId: string | null;
  since: Date | null;
} {
  const withPin = series
    .filter((p) => p.pinnedTweetId != null)
    .sort((a, b) => a.snapshotAt.getTime() - b.snapshotAt.getTime());
  if (withPin.length === 0) return { pinnedTweetId: null, since: null };
  const current = withPin[withPin.length - 1] as PinSeriesPoint;
  let since = current.snapshotAt;
  for (let i = withPin.length - 1; i >= 0; i--) {
    const p = withPin[i] as PinSeriesPoint;
    if (p.pinnedTweetId === current.pinnedTweetId) since = p.snapshotAt;
    else break;
  }
  return { pinnedTweetId: current.pinnedTweetId, since };
}

export interface PinnedWatchPost {
  tweetId: string;
  text: string;
  postedAt: Date;
  views: number | null;
}

export interface PinnedWatch {
  pinnedTweetId: string | null;
  since: Date | null;
  ageDays: number | null;
  /** (a) the pin is unchanged > 21 days. */
  stale: boolean;
  pinnedViews: number | null;
  /** (b) a last-30d post with ≥3× the pinned tweet's measured views. */
  outperformer: {
    tweetId: string;
    text: string;
    postedAt: Date;
    views: number;
    ratio: number;
  } | null;
}

export function buildPinnedWatch(
  pin: { pinnedTweetId: string | null; since: Date | null },
  pinnedViews: number | null,
  recentPosts: PinnedWatchPost[],
  now: Date,
  opts: { staleDays: number; outperformRatio: number } = PIN_DEFAULTS,
): PinnedWatch {
  const ageDays =
    pin.since === null ? null : Math.floor((now.getTime() - pin.since.getTime()) / DAY_MS);
  const stale = ageDays !== null && ageDays > opts.staleDays;

  let outperformer: PinnedWatch['outperformer'] = null;
  // Need a known pin and a positive view count to compare against.
  if (pin.pinnedTweetId !== null && pinnedViews !== null && pinnedViews > 0) {
    const best = recentPosts
      .filter(
        (p) =>
          p.tweetId !== pin.pinnedTweetId &&
          p.views !== null &&
          p.views >= pinnedViews * opts.outperformRatio,
      )
      .sort((a, b) => (b.views ?? 0) - (a.views ?? 0))[0];
    if (best && best.views !== null) {
      outperformer = {
        tweetId: best.tweetId,
        text: best.text,
        postedAt: best.postedAt,
        views: best.views,
        ratio: Math.round((best.views / pinnedViews) * 10) / 10,
      };
    }
  }

  return {
    pinnedTweetId: pin.pinnedTweetId,
    since: pin.since,
    ageDays,
    stale,
    pinnedViews,
    outperformer,
  };
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

  // Doctrine numbers (OVERHAUL-PLAN §9), now owned by the active niche (N0.5):
  // the reply band (default 10–20/day) and the week reply-ratio target (default
  // 70%). Loaded once per request — one sync SELECT, no caching needed.
  const doctrine = loadDoctrine();
  const replyTarget = { min: doctrine.replyTargetMin, max: doctrine.replyTargetMax };

  // UI.2: display, cadence and quest knobs from the settings store (app_settings).
  // The reply band/ratio above stay NICHE-owned (loadDoctrine); these are genuinely
  // app-level. Sync Map lookups (override cache), no new reads billed.
  const sparklineDays = getSetting<number>('x.display.sparklineDays');
  const leaderCount = getSetting<number>('x.display.leaderCount');
  const anchorCfg: AnchorConfig = {
    anchors3: getSetting<number[]>('x.doctrine.anchors3'),
    anchors4: getSetting<number[]>('x.doctrine.anchors4'),
    ladderSwitchAt: getSetting<number>('x.doctrine.ladderSwitchAt'),
  };
  const questOpts = {
    originalsTarget: getSetting<number>('x.quests.originalsTarget'),
    neglectedTargetsCount: getSetting<number>('x.quests.neglectedTargetsCount'),
  };
  const neglectedTargetDays = getSetting<number>('x.quests.neglectedTargetDays');
  const launchAttendWindowMs = getSetting<number>('x.quests.launchAttendWindowMin') * 60_000;

  const now = new Date();
  const todayStart = localDayStart(now, tzOffsetMin);
  const tomorrowStart = new Date(todayStart.getTime() + DAY_MS);
  const yesterdayStart = new Date(todayStart.getTime() - DAY_MS);
  const weekAgo = new Date(now.getTime() - 7 * DAY_MS);
  const utcDayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const utcDayEnd = new Date(utcDayStart.getTime() + DAY_MS);

  const [
    snaps,
    convSnaps,
    convPublished,
    published,
    scheduled,
    postedDraftRows,
    costRows,
    bestTimes,
    monitorInputs,
    commitmentViews,
    goalViews,
    audienceRows,
  ] = await Promise.all([
    db
      .select({
        snapshotAt: accountSnapshots.snapshotAt,
        followersCount: accountSnapshots.followersCount,
      })
      .from(accountSnapshots)
      .where(gte(accountSnapshots.snapshotAt, new Date(now.getTime() - sparklineDays * DAY_MS)))
      .orderBy(asc(accountSnapshots.snapshotAt)),
    // S0.1: follower series over the conversion horizon (superset of the
    // sparkline window, so the 28d baseline exists). S0.9 rides on the same
    // 30d window for the pinned-post series (30d > the 21d staleness gate).
    db
      .select({
        snapshotAt: accountSnapshots.snapshotAt,
        followersCount: accountSnapshots.followersCount,
        pinnedTweetId: accountSnapshots.pinnedTweetId,
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
      .where(gte(postsPublished.postedAt, new Date(now.getTime() - CONVERSION_TWEET_DAYS * DAY_MS)))
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
        // S3: "visual made" marker — Today renders the amber post-manually chip.
        mediaNote: scheduledPosts.mediaNote,
      })
      .from(scheduledPosts)
      .where(
        and(
          gte(scheduledPosts.scheduledFor, todayStart),
          lt(scheduledPosts.scheduledFor, tomorrowStart),
          // A3.5: a `manual` row is a filled slot like any pending one — it
          // shows in the plan and its anchor must not be re-proposed as a gap.
          inArray(scheduledPosts.status, ['pending', 'manual', 'posted', 'failed']),
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
    // S0.4: best-times cells bucketed by the viewer's local clock so each
    // cadence gap can carry the score of its (weekday, hour) cell.
    loadBestTimeCells(tzOffsetMin),
    // GR.6: the activity monitor's own loader, imported rather than re-written
    // here — the windows and column choices are decisions, and a second copy of
    // that SQL would be a second set of them (the `loadBestTimeCells` precedent
    // one line up). $0: read-time SQL over rows already collected.
    loadMonitorInputs(now),
    // GR.8: the accountability pair, both through the loaders `GET /x/goals`
    // and `GET /x/commitments` use — same reason as the monitor one line up.
    // The debt window ends yesterday, so reading the diary here (before this
    // request rewrites today's streaks row further down) changes nothing.
    loadCommitmentsWithDebt(now, tzOffsetMin),
    // NOTE this one WRITES: it settles `active → achieved | missed` on read
    // (GR.7's lazy flip). Opening Today is now what advances a finished goal.
    loadGoalsWithPacing(now),
    // A3.4: newest audience Active-times capture ($0 select). The gap
    // annotation blends its intensity below own measured cells; absent when
    // X Analytics was never visited, in which case audienceScore stays null.
    db
      .select()
      .from(audienceActivity)
      .orderBy(desc(audienceActivity.capturedAt), desc(audienceActivity.id))
      .limit(1),
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

  // S0.9 pinned-post watch: the pin series comes from the same 30d account
  // snapshots. Compare the pinned tweet's measured views against recent
  // originals — one metrics read covers the pinned tweet and every candidate.
  const pin = pinnedSince(
    convSnaps.map((s) => ({ snapshotAt: s.snapshotAt, pinnedTweetId: s.pinnedTweetId })),
  );
  const pinCandidates = await db
    .select({
      tweetId: postsPublished.tweetId,
      text: postsPublished.text,
      postedAt: postsPublished.postedAt,
    })
    .from(postsPublished)
    .where(
      and(
        eq(postsPublished.isReply, false),
        gte(postsPublished.postedAt, new Date(now.getTime() - PIN_CANDIDATE_DAYS * DAY_MS)),
      ),
    );
  const pinViewIds = [
    ...new Set([
      ...(pin.pinnedTweetId ? [pin.pinnedTweetId] : []),
      ...pinCandidates.map((p) => p.tweetId),
    ]),
  ];
  const pinSnapRows = pinViewIds.length
    ? await db
        .select({
          tweetId: metricsSnapshots.tweetId,
          publicMetrics: metricsSnapshots.publicMetrics,
        })
        .from(metricsSnapshots)
        .where(inArray(metricsSnapshots.tweetId, pinViewIds))
        .orderBy(sql`${metricsSnapshots.snapshotAt} desc`)
    : [];
  const pinViewsByTweet = new Map<string, number | null>();
  for (const s of pinSnapRows) {
    if (pinViewsByTweet.has(s.tweetId)) continue;
    const pub = (s.publicMetrics ?? null) as Record<string, number> | null;
    pinViewsByTweet.set(s.tweetId, pub?.impression_count ?? null);
  }
  const pinnedWatch = buildPinnedWatch(
    pin,
    pin.pinnedTweetId ? (pinViewsByTweet.get(pin.pinnedTweetId) ?? null) : null,
    pinCandidates.map((p) => ({
      tweetId: p.tweetId,
      text: p.text,
      postedAt: p.postedAt,
      views: pinViewsByTweet.get(p.tweetId) ?? null,
    })),
    now,
    {
      staleDays: getSetting<number>('x.pinned.staleDays'),
      outperformRatio: getSetting<number>('x.pinned.outperformRatio'),
    },
  );

  // GR.6: account health. `runMonitor` is the same call `GET /x/monitor` makes,
  // over the same inputs — the Today card and the MCP tool can never disagree.
  const monitorAlerts = runMonitor(monitorInputs);

  const yesterdayTweets = weekTweets.filter(
    (t) => t.postedAt >= yesterdayStart && t.postedAt < todayStart,
  );
  const profileClickLeaders = weekTweets
    .filter((t) => (t.metrics?.profileVisits ?? 0) > 0)
    .sort((a, b) => (b.metrics?.profileVisits ?? 0) - (a.metrics?.profileVisits ?? 0))
    .slice(0, leaderCount);

  // Gaps compare against pending/manual/posted only — a failed row still
  // occupies the list (so the user sees what to fix) but its slot reads as
  // unfilled.
  const slotted = scheduled.filter((s) => s.status !== 'failed' && s.scheduledFor !== null);
  const anchors = pickAnchors(slotted.length, anchorCfg);
  const gapHours = findScheduleGaps(
    slotted.map((s) => localMinuteOfDay(s.scheduledFor as Date, tzOffsetMin)),
    anchors,
  );
  // S0.4: annotate each empty anchor with its best-times score for today's
  // local weekday, highest-value hole first. `todayStart` is local midnight as
  // a UTC instant, so shifting it back yields today's local weekday.
  const todayLocalWeekday = new Date(todayStart.getTime() - tzOffsetMin * 60_000).getUTCDay();
  // A3.4: the newest capture is a full audience_activity row — a structural
  // superset of ActiveTimesGrid, so audienceScoreFor reads it directly.
  const audienceGrid: ActiveTimesGrid | null = audienceRows[0] ?? null;
  const gaps = annotateGaps(gapHours, bestTimes.cells, todayLocalWeekday, audienceGrid);

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
    const band = targetBand(myFollowers, {
      minX: doctrine.targetBandMinX,
      maxX: doctrine.targetBandMaxX,
    });
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
  const neglectedAtStart = neglectedTargetsAtDayStart(
    targetHandles,
    priorOutbound,
    todayStart,
    neglectedTargetDays,
  );
  const repliedTodayHandles = new Set(
    postedDraftRows.map((d) => d.sourceAuthorUsername.toLowerCase()),
  );
  let targetsTouched = 0;
  for (const h of neglectedAtStart) if (repliedTodayHandles.has(h)) targetsTouched++;

  // GR.8: a daily commitment is a promise I made to myself, so it outranks the
  // doctrine default — but only while it is ACTIVE. An absent or paused row
  // changes nothing, which is why the table ships with no seed.
  const activeCommitment = (key: string): CommitmentView | undefined =>
    commitmentViews.find((c) => c.key === key && c.active);
  const repliesCommitment = activeCommitment('replies');
  const originalsCommitment = activeCommitment('originals');

  const questItems = computeQuests(
    {
      repliesPostedToday: postedDraftRows.length,
      repliesTarget: repliesCommitment?.dailyTarget ?? replyTarget.min,
      originalsPostedToday: originalsToday.length,
      // Undefined ⇒ computeQuests falls back to questOpts.originalsTarget (the
      // configured default); an active commitment still overrides it (GR.8).
      originalsTarget: originalsCommitment?.dailyTarget,
      neglectedTargetsAtDayStart: neglectedAtStart.size,
      neglectedTargetsTouched: targetsTouched,
      loopsClosedToday: Number(answeredToday?.n ?? 0),
      openLoopsNow: Number(unansweredNow?.n ?? 0),
      launchesToday: originalsToday.length,
      launchesAttended: launchesAttended(
        originalsToday.map((p) => p.postedAt),
        replyPasteTimes,
        launchAttendWindowMs,
      ),
    },
    questOpts,
  );

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
    // S0.9: pinned-post watch — stale or out-performed pin, a nudge to re-pin.
    pinnedWatch,
    // GR.6: activity monitor — empty `alerts` (and null `worst`) is the normal,
    // silent case; the Today card renders nothing then.
    monitor: { alerts: monitorAlerts, worst: worstOf(monitorAlerts) },
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
      target: replyTarget,
    },
    quests: {
      day: dayKey,
      items: questItems,
      streak,
    },
    // GR.8: accountability (Guardrails §C). ACTIVE goals only — the loader has
    // already settled anything that hit its target or ran out of days on this
    // very read, and a finished goal belongs to the Me tab's ledger, not to the
    // coach surface. Empty is the normal case; the Today card renders nothing.
    goals: goalViews.filter((g) => g.status === 'active'),
    // Both keys, active or not: the panel needs the paused ones to show what
    // the debt was measured against before it stopped counting.
    commitments: commitmentViews,
    week: {
      from: weekAgo,
      to: now,
      posts: weekPosts,
      replies: weekReplies,
      replyPct: weekTotal === 0 ? null : Math.round((weekReplies / weekTotal) * 100),
      targetReplyPct: doctrine.weekReplyTargetPct,
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
