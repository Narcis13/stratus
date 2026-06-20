// Seed a discovery high-water mark so the daily metrics worker tracks tweets
// GOING FORWARD only — no costly backfill of the existing timeline. The worker
// derives its since_id from max(tweet_id) in posts_published, so this inserts the
// account's CURRENT latest own tweet as a RETIRED row (retired = excluded from
// snapshotting). The next pass then discovers only tweets newer than it.
//
// Cost: one timeline read (~$0.005 — X's min page size is 5). Idempotent: a no-op
// if posts_published already has rows (the max(tweet_id) checkpoint already exists).
//
//   bun run scripts/seed-metrics-checkpoint.ts
//
// Requires X_CLIENT_ID/SECRET + SELF_X_USER_ID + a valid token row. Run with the
// service STOPPED (it calls getValidAccessToken — single-writer, invariant #3).

import { sql } from 'drizzle-orm';
import { db } from '../src/db/client.ts';
import { postsPublished } from '../src/x/db/schema.ts';
import { type XTweet, getUserTweets } from '../src/x/endpoints.ts';
import { getValidAccessToken } from '../src/x/token-store.ts';

const clientId = process.env.X_CLIENT_ID;
const clientSecret = process.env.X_CLIENT_SECRET;
const selfId = process.env.SELF_X_USER_ID;
if (!clientId || !clientSecret || !selfId) {
  console.error('FATAL: need X_CLIENT_ID + X_CLIENT_SECRET + SELF_X_USER_ID.');
  process.exit(1);
}

const [existing] = await db.select({ n: sql<number>`count(*)` }).from(postsPublished);
if ((existing?.n ?? 0) > 0) {
  console.log(
    `posts_published already has ${existing?.n} row(s) — since_id checkpoint exists; nothing to do.`,
  );
  process.exit(0);
}

const token = await getValidAccessToken({ clientId, clientSecret });

let latest: XTweet | null = null;
for await (const t of getUserTweets(token, selfId, { maxResults: 1 })) {
  latest = t;
  break;
}
if (!latest) {
  console.log(
    'no tweets for this user — no checkpoint needed; the worker picks up your first new tweet.',
  );
  process.exit(0);
}

await db
  .insert(postsPublished)
  .values({
    tweetId: latest.id,
    text: latest.text ?? '(metrics checkpoint)',
    postedAt: latest.created_at ? new Date(latest.created_at) : new Date(),
    isReply: latest.in_reply_to_user_id != null,
    inReplyToTweetId: latest.referenced_tweets?.find((r) => r.type === 'replied_to')?.id ?? null,
    conversationId: latest.conversation_id ?? null,
    source: 'checkpoint',
    retired: true,
  })
  .onConflictDoNothing();

console.log(
  `checkpoint set at tweet ${latest.id} (retired) — daily metrics will snapshot only tweets newer than this.`,
);
process.exit(0);
