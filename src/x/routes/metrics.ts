// Read-only view over `metrics_snapshots` — the chart-ready time series for
// one of my published tweets. Mounted under `/x` by `mountX` in ../index.ts.
//
// Snapshots are returned oldest-first so a chart consumer can plot them
// directly. The wrapper carries `postedAt`/`retired`/`pollCount` so the UI
// doesn't have to make a second call to render axes and "tracking stopped"
// state.

import { asc, desc, eq, inArray } from 'drizzle-orm';
import { Hono } from 'hono';
import { db } from '../../db/client.ts';
import { metricsSnapshots, postsPublished } from '../db/schema.ts';

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

metrics.get('/metrics/:tweetId', async (c) => {
  const tweetId = c.req.param('tweetId');
  if (!TWEET_ID_RE.test(tweetId)) return c.json({ error: 'invalid_tweet_id' }, 400);

  const [post] = await db
    .select()
    .from(postsPublished)
    .where(eq(postsPublished.tweetId, tweetId));
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
