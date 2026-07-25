// One-shot CLI wrapper over backfillTweet() for a single OWN tweet the daily
// discovery pass never ingested (see the since_id gap in
// workers/dailyMetrics.ts::discover). One owned read (~$0.001); idempotent.
//
// PREFER the in-process route `POST /x/posts/backfill { tweetId }` when the
// service is live — it needs no service stop (single process owns the token
// mutex + SQLite connection). This script is for local/offline use, and if run
// against the live server's DB it must be the sole process (stop the service
// first) to respect invariant #3.
//
//   X_CLIENT_ID=… X_CLIENT_SECRET=… bun run scripts/backfill-tweet.ts <tweetId>
//
// Defaults to the "Learn to code (2010s) → 2030s?" post (2078076276561093110).

import { backfillTweet, isTweetId } from '../src/x/backfill.ts';
import { getValidAccessToken } from '../src/x/token-store.ts';

const DEFAULT_TWEET_ID = '2078076276561093110';

function requireEnv(key: string): string {
  const v = process.env[key];
  if (!v) throw new Error(`missing env: ${key}`);
  return v;
}

const tweetId = (process.argv[2] ?? DEFAULT_TWEET_ID).trim();
if (!isTweetId(tweetId)) {
  console.error(`Not a numeric tweet id: "${tweetId}"`);
  process.exit(1);
}

const token = await getValidAccessToken({
  clientId: requireEnv('X_CLIENT_ID'),
  clientSecret: requireEnv('X_CLIENT_SECRET'),
});

const result = await backfillTweet(token, tweetId);

if (result.status === 'already_tracked') {
  console.log(
    `Already tracked (snapshot=${result.hadSnapshot ? 'present' : 'MISSING'}). Nothing to do.`,
  );
  process.exit(0);
}
if (result.status === 'not_found') {
  console.error(`X returned no data for ${tweetId} (deleted, suspended, or not yours).`);
  process.exit(1);
}

const m = result.metrics;
console.log(`Backfilled ${result.tweetId}`);
console.log(`  posted:   ${m.postedAt} (age ${Math.round(m.ageAtSnapshotMin / 60)}h at snapshot)`);
console.log(`  text:     ${result.text.slice(0, 80).replace(/\n/g, ' ')}`);
console.log(
  `  views:    ${m.views ?? '?'}  likes:${m.likes ?? '?'}  replies:${m.replies ?? '?'}  ` +
    `rts:${m.retweets ?? '?'}  quotes:${m.quotes ?? '?'}  bookmarks:${m.bookmarks ?? '?'}`,
);
console.log(`  profile clicks:${m.profileClicks ?? '?'}`);
console.log('Done. It will now appear in /x/metrics, /x/playbook and best-times.');
process.exit(0);
