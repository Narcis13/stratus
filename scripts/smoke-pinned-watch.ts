// One-shot smoke test for S0.9 (pinned-post watch). Mounts the brief router
// in-process (no port, no workers, no X API) and drives the two nudges:
//   (a) a pin unchanged >21d reads as stale,
//   (b) a recent original with ≥3× the pinned tweet's views is surfaced.
// Run isolated so it can seed originals + metrics without touching real data
// or perturbing the shared bun:test DB (playbook asserts exact medians):
//   SQLITE_PATH=:memory: bun run scripts/smoke-pinned-watch.ts

import { Hono } from 'hono';
import { db } from '../src/db/client.ts';
import { accountSnapshots, metricsSnapshots, postsPublished } from '../src/x/db/schema.ts';
import { brief } from '../src/x/routes/brief.ts';

if ((process.env.SQLITE_PATH ?? './stratus.db') !== ':memory:') {
  console.error('Refusing to run against a real DB — seeds metrics rows.');
  console.error('Re-run: SQLITE_PATH=:memory: bun run scripts/smoke-pinned-watch.ts');
  process.exit(1);
}

const app = new Hono();
app.route('/x', brief);

function fail(msg: string): never {
  console.error(`FAIL: ${msg}`);
  process.exit(1);
}

const DAY = 24 * 60 * 60 * 1000;
const now = Date.now();
const PIN = '99000000000000001';
const WINNER = '99000000000000002';
const ALSO_RAN = '99000000000000003';

// (a) The pin has been the same for 25 days → stale. Seed a run of daily
// account snapshots all pointing at PIN, plus one older snapshot with no pin
// (pre-S0.9 history — must be ignored by `pinnedSince`).
await db.insert(accountSnapshots).values({
  snapshotAt: new Date(now - 40 * DAY),
  followersCount: 90,
  followingCount: 40,
  tweetCount: 8,
  listedCount: 0,
  pinnedTweetId: null,
});
for (let d = 25; d >= 0; d--) {
  await db.insert(accountSnapshots).values({
    snapshotAt: new Date(now - d * DAY),
    followersCount: 100 + (25 - d),
    followingCount: 40,
    tweetCount: 10,
    listedCount: 0,
    pinnedTweetId: PIN,
  });
}

// The pinned tweet (200 views) and two recent originals: a 4× winner and a
// 1.5× also-ran that must NOT be surfaced.
const posts: Array<[string, number, number]> = [
  [PIN, 200, 26], // the pin, posted 26d ago, tracked
  [WINNER, 800, 5], // 4× → the outperformer
  [ALSO_RAN, 300, 3], // 1.5× → below the ratio
];
for (const [tweetId, views, daysAgo] of posts) {
  await db.insert(postsPublished).values({
    tweetId,
    text: `pinned-watch smoke ${tweetId}`,
    postedAt: new Date(now - daysAgo * DAY),
    isReply: false,
    source: 'test',
    retired: true,
  });
  await db.insert(metricsSnapshots).values({
    tweetId,
    snapshotAt: new Date(now - (daysAgo - 1) * DAY),
    publicMetrics: {
      impression_count: views,
      like_count: 0,
      reply_count: 0,
      retweet_count: 0,
      quote_count: 0,
      bookmark_count: 0,
    },
  });
}

const res = await app.request('/x/brief?tzOffsetMin=0');
if (res.status !== 200) fail(`brief returned ${res.status}: ${await res.text()}`);
const body = (await res.json()) as {
  pinnedWatch: {
    pinnedTweetId: string | null;
    since: string | null;
    ageDays: number | null;
    stale: boolean;
    pinnedViews: number | null;
    outperformer: { tweetId: string; views: number; ratio: number } | null;
  };
};
const w = body.pinnedWatch;
console.log('pinnedWatch:', JSON.stringify(w, null, 2));

if (w.pinnedTweetId !== PIN) fail(`current pin should be ${PIN}, got ${w.pinnedTweetId}`);
if (w.pinnedViews !== 200) fail(`pinnedViews should be 200, got ${w.pinnedViews}`);
// (a) unchanged ~25d > 21d.
if (!w.stale) fail('pin unchanged >21d should be stale');
if ((w.ageDays ?? 0) < 22) fail(`ageDays should be ≥22, got ${w.ageDays}`);
// (b) the 4× winner, not the 1.5× also-ran.
if (w.outperformer?.tweetId !== WINNER) {
  fail(`outperformer should be ${WINNER}, got ${w.outperformer?.tweetId}`);
}
if (w.outperformer?.views !== 800 || w.outperformer?.ratio !== 4) {
  fail(`outperformer views/ratio wrong: ${JSON.stringify(w.outperformer)}`);
}
console.log(
  `(a) stale after ${w.ageDays}d  (b) outperformer ${WINNER} at ${w.outperformer.ratio}×`,
);

// A fresh re-pin to the winner clears both nudges on the next snapshot.
await db.insert(accountSnapshots).values({
  snapshotAt: new Date(now + 60_000),
  followersCount: 130,
  followingCount: 40,
  tweetCount: 10,
  listedCount: 0,
  pinnedTweetId: WINNER,
});
const res2 = await app.request('/x/brief?tzOffsetMin=0');
const body2 = (await res2.json()) as {
  pinnedWatch: { pinnedTweetId: string; stale: boolean; outperformer: unknown };
};
if (body2.pinnedWatch.pinnedTweetId !== WINNER) fail('re-pin not reflected');
if (body2.pinnedWatch.stale) fail('a just-changed pin should not be stale');
if (body2.pinnedWatch.outperformer !== null) fail('winner pinned → no outperformer left');
console.log('re-pin: nudges cleared (fresh pin, best post now pinned)');

console.log('SMOKE OK');
process.exit(0);
