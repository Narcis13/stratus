// Read-only view over `metrics_snapshots` — the chart-ready time series for
// one of my published tweets. Mounted under `/x` by `mountX` in ../index.ts.
//
// Snapshots are returned oldest-first so a chart consumer can plot them
// directly. The wrapper carries `postedAt`/`retired`/`pollCount` so the UI
// doesn't have to make a second call to render axes and "tracking stopped"
// state.

import { and, asc, desc, eq, gte, inArray, isNotNull } from 'drizzle-orm';
import { Hono } from 'hono';
import { db } from '../../db/client.ts';
import {
  accountSnapshots,
  metricsSnapshots,
  postsPublished,
  replyDrafts,
  scheduledPosts,
} from '../db/schema.ts';

const TWEET_ID_RE = /^\d{1,32}$/;

export const metrics = new Hono();

// Performance list of my published tweets with their latest snapshot — used by
// the two endpoints below (replies vs. non-reply posts). A reply to someone
// else is still my own tweet, so it's an owned $0.001 read like any post; the
// only difference is the `isReply` filter and which fields are worth surfacing.
function clampLimit(raw: string | undefined): number {
  const n = Number(raw ?? '50');
  return Number.isFinite(n) ? Math.min(200, Math.max(1, Math.trunc(n))) : 50;
}

async function listPerformance(isReply: boolean, limit: number) {
  const posts = await db
    .select({
      tweetId: postsPublished.tweetId,
      text: postsPublished.text,
      inReplyToTweetId: postsPublished.inReplyToTweetId,
      conversationId: postsPublished.conversationId,
      postedAt: postsPublished.postedAt,
      retired: postsPublished.retired,
      pollCount: postsPublished.pollCount,
    })
    .from(postsPublished)
    .where(eq(postsPublished.isReply, isReply))
    .orderBy(desc(postsPublished.postedAt))
    .limit(limit);

  const ids = posts.map((p) => p.tweetId);
  const snaps = ids.length
    ? await db
        .select({
          tweetId: metricsSnapshots.tweetId,
          snapshotAt: metricsSnapshots.snapshotAt,
          publicMetrics: metricsSnapshots.publicMetrics,
          nonPublicMetrics: metricsSnapshots.nonPublicMetrics,
        })
        .from(metricsSnapshots)
        .where(inArray(metricsSnapshots.tweetId, ids))
        .orderBy(desc(metricsSnapshots.snapshotAt))
    : [];

  // Snapshots come newest-first, so the first row seen per tweet is its latest.
  const latest = new Map<string, (typeof snaps)[number]>();
  for (const s of snaps) if (!latest.has(s.tweetId)) latest.set(s.tweetId, s);

  return posts.map((p) => {
    const s = latest.get(p.tweetId);
    const pub = (s?.publicMetrics ?? null) as Record<string, number> | null;
    const priv = (s?.nonPublicMetrics ?? null) as Record<string, number> | null;
    return {
      tweetId: p.tweetId,
      text: p.text,
      inReplyToTweetId: p.inReplyToTweetId,
      conversationId: p.conversationId,
      postedAt: p.postedAt,
      retired: p.retired,
      pollCount: p.pollCount,
      measuredAt: s?.snapshotAt ?? null,
      // null until the 24h snapshot lands (tweet posted < ~24h ago).
      metrics: s
        ? {
            views: pub?.impression_count ?? priv?.impression_count ?? null,
            likes: pub?.like_count ?? null,
            replies: pub?.reply_count ?? null,
            retweets: pub?.retweet_count ?? null,
            quotes: pub?.quote_count ?? null,
            bookmarks: pub?.bookmark_count ?? null,
            profileVisits: priv?.user_profile_clicks ?? null,
            urlLinkClicks: priv?.url_link_clicks ?? null,
          }
        : null,
    };
  });
}

// My replies to other people's tweets, newest first, with latest views/metrics.
// Registered before `/metrics/:tweetId` so "replies" isn't caught as a tweet id.
metrics.get('/metrics/replies', async (c) => {
  const replies = await listPerformance(true, clampLimit(c.req.query('limit')));
  return c.json({ count: replies.length, replies });
});

// My non-reply posts, newest first, with latest views/metrics. Same shape as
// /metrics/replies; `inReplyToTweetId`/`conversationId` are null here.
metrics.get('/metrics/posts', async (c) => {
  const posts = await listPerformance(false, clampLimit(c.req.query('limit')));
  return c.json({ count: posts.length, posts });
});

const DAY_MS = 24 * 60 * 60 * 1000;

export interface AccountSnapshotRow {
  snapshotAt: Date;
  followersCount: number;
  followingCount: number;
  tweetCount: number;
  listedCount: number;
}

export interface AccountSeriesPoint extends AccountSnapshotRow {
  /** Change since the previous snapshot; null on the first point. */
  deltas: { followers: number; following: number; tweets: number; listed: number } | null;
  /** My posts/replies published in (prev snapshot, this snapshot] — what a
   *  followers delta is attributable to. First point uses a 24h lookback. */
  activity: { posts: number; replies: number };
}

export function buildAccountSeries(
  snapshots: AccountSnapshotRow[],
  published: Array<{ postedAt: Date; isReply: boolean }>,
): AccountSeriesPoint[] {
  const ordered = [...snapshots].sort((a, b) => a.snapshotAt.getTime() - b.snapshotAt.getTime());

  return ordered.map((s, i) => {
    const prev = i > 0 ? ordered[i - 1] : undefined;
    const windowStart = prev ? prev.snapshotAt.getTime() : s.snapshotAt.getTime() - DAY_MS;
    const windowEnd = s.snapshotAt.getTime();

    let posts = 0;
    let replies = 0;
    for (const p of published) {
      const t = p.postedAt.getTime();
      if (t > windowStart && t <= windowEnd) {
        if (p.isReply) replies++;
        else posts++;
      }
    }

    return {
      ...s,
      deltas: prev
        ? {
            followers: s.followersCount - prev.followersCount,
            following: s.followingCount - prev.followingCount,
            tweets: s.tweetCount - prev.tweetCount,
            listed: s.listedCount - prev.listedCount,
          }
        : null,
      activity: { posts, replies },
    };
  });
}

// The mission KPI: daily follower counts with deltas, each day joined against
// how many posts/replies went out in that snapshot window so a spike is
// attributable. One row per UTC day, written by the dailyMetrics 03:00 pass.
metrics.get('/metrics/account', async (c) => {
  const snaps = await db
    .select({
      snapshotAt: accountSnapshots.snapshotAt,
      followersCount: accountSnapshots.followersCount,
      followingCount: accountSnapshots.followingCount,
      tweetCount: accountSnapshots.tweetCount,
      listedCount: accountSnapshots.listedCount,
    })
    .from(accountSnapshots)
    .orderBy(asc(accountSnapshots.snapshotAt));

  const first = snaps[0];
  const published = first
    ? await db
        .select({ postedAt: postsPublished.postedAt, isReply: postsPublished.isReply })
        .from(postsPublished)
        .where(gte(postsPublished.postedAt, new Date(first.snapshotAt.getTime() - DAY_MS)))
    : [];

  const series = buildAccountSeries(snaps, published);
  return c.json({ count: series.length, latest: series.at(-1) ?? null, series });
});

// ----------------------------------------------------------- best times §8.4

export interface BestTimeInput {
  postedAt: Date;
  views: number | null;
  likes: number | null;
  profileVisits: number | null;
  ageAtSnapshotMin: number | null;
}

export interface BestTimeCell {
  /** 0 = Sunday … 6 = Saturday. UTC unless `buildBestTimes` was given a
   *  `tzOffsetMin`, in which case it's the viewer's local weekday. */
  weekday: number;
  /** 0–23. UTC or local, mirroring `weekday`. */
  hour: number;
  posts: number;
  avgViews: number | null;
  /** Views normalized to a per-day rate by age-at-snapshot — the daily pass
   *  reads tweets at 3–27h old, so raw counts aren't comparable (§8.4). Null
   *  when no post in the cell carries age data (pre-8.4 snapshots). */
  avgViewsPerDay: number | null;
  avgLikes: number | null;
  avgProfileVisits: number | null;
}

// Advice gate (S0.4): a cell with fewer than this many measured posts is "no
// data", never a recommendation — same min-sample discipline as everywhere.
export const BEST_TIME_MIN_N = 3;

// Pure — exported for unit tests. One cell per (weekday, hour) that has posts.
// `tzOffsetMin` follows JS `Date.getTimezoneOffset()` (UTC − local); pass it to
// bucket by the viewer's local wall clock instead of UTC (S0.4 — the composer
// and brief schedule in local time). Default 0 keeps the raw UTC behavior.
export function buildBestTimes(rows: BestTimeInput[], tzOffsetMin = 0): BestTimeCell[] {
  const cells = new Map<
    string,
    {
      weekday: number;
      hour: number;
      posts: number;
      views: number[];
      viewsPerDay: number[];
      likes: number[];
      profileVisits: number[];
    }
  >();

  for (const r of rows) {
    const shifted = new Date(r.postedAt.getTime() - tzOffsetMin * 60_000);
    const weekday = shifted.getUTCDay();
    const hour = shifted.getUTCHours();
    const key = `${weekday}:${hour}`;
    let cell = cells.get(key);
    if (!cell) {
      cell = { weekday, hour, posts: 0, views: [], viewsPerDay: [], likes: [], profileVisits: [] };
      cells.set(key, cell);
    }
    cell.posts++;
    if (r.views != null) {
      cell.views.push(r.views);
      if (r.ageAtSnapshotMin != null && r.ageAtSnapshotMin > 0) {
        cell.viewsPerDay.push((r.views * 1440) / r.ageAtSnapshotMin);
      }
    }
    if (r.likes != null) cell.likes.push(r.likes);
    if (r.profileVisits != null) cell.profileVisits.push(r.profileVisits);
  }

  return Array.from(cells.values())
    .map((cell) => ({
      weekday: cell.weekday,
      hour: cell.hour,
      posts: cell.posts,
      avgViews: mean(cell.views),
      avgViewsPerDay: mean(cell.viewsPerDay),
      avgLikes: mean(cell.likes),
      avgProfileVisits: mean(cell.profileVisits),
    }))
    .sort((a, b) => a.weekday - b.weekday || a.hour - b.hour);
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 100) / 100;
}

// The single scalar a cell is ranked/advised by: the age-normalized rate when
// present, else raw average views. Null when the cell has no view data OR fewer
// than `minN` measured posts (S0.4 gate — below the gate is "no data").
export function bestTimeScore(
  cell: BestTimeCell | undefined,
  minN = BEST_TIME_MIN_N,
): number | null {
  if (!cell || cell.posts < minN) return null;
  return cell.avgViewsPerDay ?? cell.avgViews ?? null;
}

// Cells that clear the gate, best-first — the advice list. Pure, exported.
export function rankBestTimes(cells: BestTimeCell[], minN = BEST_TIME_MIN_N): BestTimeCell[] {
  return cells
    .filter((cell) => bestTimeScore(cell, minN) != null)
    .sort((a, b) => (bestTimeScore(b, minN) ?? 0) - (bestTimeScore(a, minN) ?? 0));
}

// The cell for one (weekday, hour), or undefined if none. Pure, exported —
// the brief looks up each cadence gap's cell by its local anchor hour.
export function bestTimeCellFor(
  cells: BestTimeCell[],
  weekday: number,
  hour: number,
): BestTimeCell | undefined {
  return cells.find((c) => c.weekday === weekday && c.hour === hour);
}

// The best-times query + build, shared by the route and the brief's gap
// annotation. `tzOffsetMin` buckets by the viewer's local wall clock. $0 —
// pure SQL over already-billed snapshots.
export async function loadBestTimeCells(
  tzOffsetMin = 0,
): Promise<{ measuredPosts: number; cells: BestTimeCell[] }> {
  const posts = await db
    .select({ tweetId: postsPublished.tweetId, postedAt: postsPublished.postedAt })
    .from(postsPublished)
    .where(eq(postsPublished.isReply, false))
    .orderBy(desc(postsPublished.postedAt))
    .limit(1000);

  const ids = posts.map((p) => p.tweetId);
  const snaps = ids.length
    ? await db
        .select({
          tweetId: metricsSnapshots.tweetId,
          snapshotAt: metricsSnapshots.snapshotAt,
          publicMetrics: metricsSnapshots.publicMetrics,
          nonPublicMetrics: metricsSnapshots.nonPublicMetrics,
          ageAtSnapshotMin: metricsSnapshots.ageAtSnapshotMin,
        })
        .from(metricsSnapshots)
        .where(inArray(metricsSnapshots.tweetId, ids))
        .orderBy(desc(metricsSnapshots.snapshotAt))
    : [];

  const latest = new Map<string, (typeof snaps)[number]>();
  for (const s of snaps) if (!latest.has(s.tweetId)) latest.set(s.tweetId, s);

  const rows: BestTimeInput[] = [];
  for (const p of posts) {
    const s = latest.get(p.tweetId);
    if (!s) continue;
    const pub = (s.publicMetrics ?? null) as Record<string, number> | null;
    const priv = (s.nonPublicMetrics ?? null) as Record<string, number> | null;
    rows.push({
      postedAt: p.postedAt,
      views: pub?.impression_count ?? priv?.impression_count ?? null,
      likes: pub?.like_count ?? null,
      profileVisits: priv?.user_profile_clicks ?? null,
      ageAtSnapshotMin: s.ageAtSnapshotMin,
    });
  }

  return { measuredPosts: rows.length, cells: buildBestTimes(rows, tzOffsetMin) };
}

// Engagement by posted hour × weekday over my non-reply posts — the composer's
// slot suggestions (S0.4). `?tzOffsetMin=` (JS getTimezoneOffset semantics)
// buckets by the viewer's local clock so "Wed 17:xx" means 17:xx *local*;
// omitted → raw UTC. `top` is gated at n≥3 (advice, not noise); `cells` is the
// full unfiltered grid so a consumer can gate differently. $0.
metrics.get('/metrics/best-times', async (c) => {
  const tzStr = c.req.query('tzOffsetMin');
  let tzOffsetMin = 0;
  if (tzStr !== undefined) {
    const n = Number(tzStr);
    if (!Number.isInteger(n) || Math.abs(n) > 16 * 60) {
      return c.json({ error: 'invalid_tz_offset_min' }, 400);
    }
    tzOffsetMin = n;
  }

  const { measuredPosts, cells } = await loadBestTimeCells(tzOffsetMin);

  return c.json({
    measuredPosts,
    tzOffsetMin,
    minN: BEST_TIME_MIN_N,
    top: rankBestTimes(cells).slice(0, 5),
    cells,
  });
});

// -------------------------------------------------------------- pillars §8.4

export interface PillarInput {
  pillar: string | null;
  isReply: boolean;
  views: number | null;
  likes: number | null;
  profileVisits: number | null;
}

export interface PillarAgg {
  pillar: string;
  posts: number;
  replies: number;
  measured: number;
  views: number;
  avgViews: number | null;
  likes: number;
  profileVisits: number;
  avgProfileVisits: number | null;
}

// Pure — exported for unit tests. Monthly pillar reweighting as a query.
export function aggregatePillars(rows: PillarInput[]): PillarAgg[] {
  const byPillar = new Map<string, PillarInput[]>();
  for (const r of rows) {
    const key = r.pillar ?? 'unassigned';
    const list = byPillar.get(key) ?? [];
    list.push(r);
    byPillar.set(key, list);
  }

  return Array.from(byPillar.entries())
    .map(([pillar, list]) => {
      const measured = list.filter((r) => r.views != null);
      const views = measured.reduce((a, r) => a + (r.views ?? 0), 0);
      const withVisits = list.filter((r) => r.profileVisits != null);
      const profileVisits = withVisits.reduce((a, r) => a + (r.profileVisits ?? 0), 0);
      return {
        pillar,
        posts: list.filter((r) => !r.isReply).length,
        replies: list.filter((r) => r.isReply).length,
        measured: measured.length,
        views,
        avgViews: measured.length ? Math.round(views / measured.length) : null,
        likes: list.reduce((a, r) => a + (r.likes ?? 0), 0),
        profileVisits,
        avgProfileVisits: withVisits.length
          ? Math.round((profileVisits / withVisits.length) * 100) / 100
          : null,
      };
    })
    .sort((a, b) => b.views - a.views);
}

// Which pillar earns views/profile clicks — joins the drafter's pillar stamp
// (scheduled_posts for originals, reply_drafts for replies) to each published
// tweet's latest snapshot. $0, pure SQL.
metrics.get('/metrics/pillars', async (c) => {
  const posts = await db
    .select({
      tweetId: postsPublished.tweetId,
      pillar: scheduledPosts.pillar,
    })
    .from(postsPublished)
    .innerJoin(scheduledPosts, eq(scheduledPosts.id, postsPublished.scheduledPostId))
    .where(eq(postsPublished.isReply, false));

  const replies = await db
    .select({
      tweetId: replyDrafts.postedTweetId,
      pillar: replyDrafts.pillar,
    })
    .from(replyDrafts)
    .where(and(eq(replyDrafts.status, 'posted'), isNotNull(replyDrafts.postedTweetId)));

  const tagged: Array<{ tweetId: string; pillar: string | null; isReply: boolean }> = [
    ...posts.map((p) => ({ tweetId: p.tweetId, pillar: p.pillar, isReply: false })),
    ...replies.flatMap((r) =>
      r.tweetId ? [{ tweetId: r.tweetId, pillar: r.pillar, isReply: true }] : [],
    ),
  ];

  const ids = tagged.map((t) => t.tweetId);
  const snaps = ids.length
    ? await db
        .select({
          tweetId: metricsSnapshots.tweetId,
          snapshotAt: metricsSnapshots.snapshotAt,
          publicMetrics: metricsSnapshots.publicMetrics,
          nonPublicMetrics: metricsSnapshots.nonPublicMetrics,
        })
        .from(metricsSnapshots)
        .where(inArray(metricsSnapshots.tweetId, ids))
        .orderBy(desc(metricsSnapshots.snapshotAt))
    : [];

  const latest = new Map<string, (typeof snaps)[number]>();
  for (const s of snaps) if (!latest.has(s.tweetId)) latest.set(s.tweetId, s);

  const rows: PillarInput[] = tagged.map((t) => {
    const s = latest.get(t.tweetId);
    const pub = (s?.publicMetrics ?? null) as Record<string, number> | null;
    const priv = (s?.nonPublicMetrics ?? null) as Record<string, number> | null;
    return {
      pillar: t.pillar,
      isReply: t.isReply,
      views: pub?.impression_count ?? priv?.impression_count ?? null,
      likes: pub?.like_count ?? null,
      profileVisits: priv?.user_profile_clicks ?? null,
    };
  });

  return c.json({ count: rows.length, pillars: aggregatePillars(rows) });
});

metrics.get('/metrics/:tweetId', async (c) => {
  const tweetId = c.req.param('tweetId');
  if (!TWEET_ID_RE.test(tweetId)) return c.json({ error: 'invalid_tweet_id' }, 400);

  const [post] = await db.select().from(postsPublished).where(eq(postsPublished.tweetId, tweetId));
  if (!post) return c.json({ error: 'not_found' }, 404);

  const snapshots = await db
    .select({
      snapshotAt: metricsSnapshots.snapshotAt,
      publicMetrics: metricsSnapshots.publicMetrics,
      nonPublicMetrics: metricsSnapshots.nonPublicMetrics,
      organicMetrics: metricsSnapshots.organicMetrics,
    })
    .from(metricsSnapshots)
    .where(eq(metricsSnapshots.tweetId, tweetId))
    .orderBy(asc(metricsSnapshots.snapshotAt));

  return c.json({
    tweetId: post.tweetId,
    postedAt: post.postedAt,
    retired: post.retired,
    pollCount: post.pollCount,
    nextPollAt: post.nextPollAt,
    lastSeenAt: post.lastSeenAt,
    snapshots,
  });
});
