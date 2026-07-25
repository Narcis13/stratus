// Ingest a single OWN tweet that the daily discovery pass never captured (the
// since_id gap fixed in workers/dailyMetrics.ts). One owned read (~$0.001) →
// writes exactly what discover()+snapshotDue() would have: one posts_published
// row (source 'manual', retired) plus one metrics_snapshots row. Idempotent —
// an already-tracked tweet takes no read and writes nothing.
//
// Shared by the in-process route (`POST /x/posts/backfill`) and the one-shot
// scripts/backfill-tweet.ts. The route is the preferred path: it runs inside
// the live service, so it needs no service stop (single process owns the
// token-rotation mutex — invariant #3 — and the SQLite connection).

import { eq } from 'drizzle-orm';
import { db } from '../db/client.ts';
import { metricsSnapshots, postsPublished } from './db/schema.ts';
import { getTweetsByIds } from './endpoints.ts';

export interface BackfillMetrics {
  postedAt: string;
  ageAtSnapshotMin: number;
  views: number | null;
  likes: number | null;
  replies: number | null;
  retweets: number | null;
  quotes: number | null;
  bookmarks: number | null;
  profileClicks: number | null;
}

export type BackfillResult =
  | { status: 'already_tracked'; tweetId: string; hadSnapshot: boolean }
  | { status: 'not_found'; tweetId: string }
  | { status: 'backfilled'; tweetId: string; text: string; metrics: BackfillMetrics };

/** True for a bare numeric snowflake id. */
export function isTweetId(v: unknown): v is string {
  return typeof v === 'string' && /^\d+$/.test(v);
}

/**
 * `token` must be resolved by the caller (the route passes the in-process
 * token via getValidAccessToken — safe because it's the same process that owns
 * the rotation mutex).
 */
export async function backfillTweet(token: string, tweetId: string): Promise<BackfillResult> {
  const [existing] = await db
    .select({ tweetId: postsPublished.tweetId })
    .from(postsPublished)
    .where(eq(postsPublished.tweetId, tweetId));
  if (existing) {
    const [snap] = await db
      .select({ id: metricsSnapshots.id })
      .from(metricsSnapshots)
      .where(eq(metricsSnapshots.tweetId, tweetId));
    return { status: 'already_tracked', tweetId, hadSnapshot: snap != null };
  }

  // The one billed call (~$0.001). ownedPrivate → non_public/organic metrics
  // too, valid because we only ever call this on the user's own tweets and the
  // caller is expected to backfill tweets inside X's 30-day private window.
  const { found, missing } = await getTweetsByIds(token, [tweetId], { ownedPrivate: true });
  const tweet = found[0];
  if (missing.length > 0 || !tweet) return { status: 'not_found', tweetId };

  const postedAt = tweet.created_at ? new Date(tweet.created_at) : new Date();
  const now = new Date();
  const ageMin = Math.max(0, Math.round((now.getTime() - postedAt.getTime()) / 60_000));

  // discover()+snapshotDue() pair in one txn. retired=true so the daily pass
  // never re-reads it (once-and-only-once, invariant #7); pollCount=1 mirrors a
  // normal first snapshot so §8.4 winner re-read can still pick it up at day 7+.
  db.transaction((tx) => {
    tx.insert(postsPublished)
      .values({
        tweetId: tweet.id,
        text: tweet.text,
        postedAt,
        isReply: tweet.in_reply_to_user_id != null,
        inReplyToTweetId: tweet.referenced_tweets?.find((r) => r.type === 'replied_to')?.id ?? null,
        conversationId: tweet.conversation_id ?? null,
        source: 'manual',
        hasMedia: (tweet.attachments?.media_keys?.length ?? 0) > 0,
        pollCount: 1,
        lastSeenAt: now,
        nextPollAt: null,
        retired: true,
      })
      .onConflictDoNothing()
      .run();
    tx.insert(metricsSnapshots)
      .values({
        tweetId: tweet.id,
        snapshotAt: now,
        publicMetrics: tweet.public_metrics ?? null,
        nonPublicMetrics: tweet.non_public_metrics ?? null,
        organicMetrics: tweet.organic_metrics ?? null,
        ageAtSnapshotMin: ageMin,
      })
      .run();
  });

  const pm = tweet.public_metrics;
  const npm = tweet.non_public_metrics;
  return {
    status: 'backfilled',
    tweetId: tweet.id,
    text: tweet.text,
    metrics: {
      postedAt: postedAt.toISOString(),
      ageAtSnapshotMin: ageMin,
      views: pm?.impression_count ?? null,
      likes: pm?.like_count ?? null,
      replies: pm?.reply_count ?? null,
      retweets: pm?.retweet_count ?? null,
      quotes: pm?.quote_count ?? null,
      bookmarks: pm?.bookmark_count ?? null,
      profileClicks: npm?.user_profile_clicks ?? null,
    },
  };
}
