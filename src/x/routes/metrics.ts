// Read-only view over `metrics_snapshots` — the chart-ready time series for
// one of my published tweets. Mounted under `/x` by `mountX` in ../index.ts.
//
// Snapshots are returned oldest-first so a chart consumer can plot them
// directly. The wrapper carries `postedAt`/`retired`/`pollCount` so the UI
// doesn't have to make a second call to render axes and "tracking stopped"
// state.

import { asc, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { db } from '../../db/client.ts';
import { metricsSnapshots, postsPublished } from '../db/schema.ts';

const TWEET_ID_RE = /^\d{1,32}$/;

export const metrics = new Hono();

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
