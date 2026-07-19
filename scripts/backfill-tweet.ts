// One-shot backfill for a single OWN tweet that the daily discovery pass never
// ingested (see the since_id gap in workers/dailyMetrics.ts::discover). Fetches
// the tweet's current metrics with ONE owned read (~$0.001) and writes exactly
// what discover()+snapshotDue() would have: one posts_published row (source
// 'manual', retired) plus one metrics_snapshots row. Idempotent — re-running
// against an already-tracked tweet takes no read and writes nothing.
//
//   X_CLIENT_ID=… X_CLIENT_SECRET=… bun run scripts/backfill-tweet.ts <tweetId>
//
// Defaults to the "Learn to code (2010s) → 2030s?" post (2078076276561093110)
// that blew up to ~1.7M impressions and slipped through discovery.

import { eq } from 'drizzle-orm';
import { db } from '../src/db/client.ts';
import { metricsSnapshots, postsPublished } from '../src/x/db/schema.ts';
import { getTweetsByIds } from '../src/x/endpoints.ts';
import { getValidAccessToken } from '../src/x/token-store.ts';

const DEFAULT_TWEET_ID = '2078076276561093110';

function requireEnv(key: string): string {
  const v = process.env[key];
  if (!v) throw new Error(`missing env: ${key}`);
  return v;
}

const tweetId = (process.argv[2] ?? DEFAULT_TWEET_ID).trim();
if (!/^\d+$/.test(tweetId)) {
  console.error(`Not a numeric tweet id: "${tweetId}"`);
  process.exit(1);
}

// Idempotency: if it's already tracked, don't spend a read or double-write.
const [existing] = await db
  .select({ tweetId: postsPublished.tweetId, retired: postsPublished.retired })
  .from(postsPublished)
  .where(eq(postsPublished.tweetId, tweetId));
if (existing) {
  const [snap] = await db
    .select({ id: metricsSnapshots.id })
    .from(metricsSnapshots)
    .where(eq(metricsSnapshots.tweetId, tweetId));
  console.log(
    `Already in posts_published (retired=${existing.retired}, ` +
      `snapshot=${snap ? 'present' : 'MISSING'}). Nothing to do.`,
  );
  process.exit(0);
}

const token = await getValidAccessToken({
  clientId: requireEnv('X_CLIENT_ID'),
  clientSecret: requireEnv('X_CLIENT_SECRET'),
});

// The one billed call (~$0.001). ownedPrivate → non_public/organic metrics too,
// valid because the tweet is inside X's 30-day private-fields window.
const { found, missing } = await getTweetsByIds(token, [tweetId], { ownedPrivate: true });
const tweet = found[0];
if (missing.length > 0 || !tweet) {
  console.error(`X returned no data for ${tweetId} (deleted, suspended, or not yours).`);
  process.exit(1);
}
const postedAt = tweet.created_at ? new Date(tweet.created_at) : new Date();
const now = new Date();
const ageMin = Math.max(0, Math.round((now.getTime() - postedAt.getTime()) / 60_000));

// Write the discover()+snapshotDue() pair in one txn. retired=true so the daily
// pass never re-reads it (once-and-only-once, invariant #7); pollCount=1 mirrors
// a normal first snapshot so §8.4 winner re-read can still pick it up at day 7+.
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
console.log(`Backfilled ${tweet.id}`);
console.log(`  posted:   ${postedAt.toISOString()} (age ${Math.round(ageMin / 60)}h at snapshot)`);
console.log(`  text:     ${tweet.text.slice(0, 80).replace(/\n/g, ' ')}`);
console.log(
  `  views:    ${pm?.impression_count ?? '?'}  likes:${pm?.like_count ?? '?'}  ` +
    `replies:${pm?.reply_count ?? '?'}  rts:${pm?.retweet_count ?? '?'}  ` +
    `quotes:${pm?.quote_count ?? '?'}  bookmarks:${pm?.bookmark_count ?? '?'}`,
);
if (npm) {
  console.log(`  profile clicks:${npm.user_profile_clicks}  url clicks:${npm.url_link_clicks}`);
}
console.log('Done. It will now appear in /x/metrics, /x/playbook and best-times.');
process.exit(0);
