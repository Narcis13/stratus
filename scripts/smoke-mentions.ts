// One-shot smoke test for §7.5 (mention inbox). Mounts the mentions router
// in-process (no port, no workers) against the real DB. The default path is
// $0 — seeds a fake mention + fake parent post, checks the list join, PATCH
// transitions, and the answered backfill, then cleans up after itself.
//
// `--live` additionally runs one real POST /x/mentions/refresh capped at
// maxResults=10 (≤ $0.01, owned reads) AFTER cleanup — fake ids sit above
// every real snowflake and would poison the since_id checkpoint otherwise.
// Run: bun run scripts/smoke-mentions.ts [--live]

import { eq, inArray } from 'drizzle-orm';
import { Hono } from 'hono';
import { db } from '../src/db/client.ts';
import { mentions, postsPublished } from '../src/x/db/schema.ts';
import { backfillAnswered } from '../src/x/mentions.ts';
import { createMentionsRouter } from '../src/x/routes/mentions.ts';

const LIVE = process.argv.includes('--live');

// Inside bigint range (pullMentions casts tweet_id::bigint) but far above any
// real 2026 snowflake (~1.9e18), so they can't collide with real tweets.
const FAKE_MENTION = '9000000000000000001';
const FAKE_MENTION_2 = '9000000000000000002';
const FAKE_PARENT = '9000000000000000003';
const FAKE_MY_REPLY = '9000000000000000004';

const app = new Hono();
app.route(
  '/x',
  createMentionsRouter({
    selfXUserId: process.env.SELF_X_USER_ID ?? '0',
    clientId: process.env.X_CLIENT_ID ?? '',
    clientSecret: process.env.X_CLIENT_SECRET ?? '',
  }),
);

function fail(msg: string): never {
  console.error(`FAIL: ${msg}`);
  process.exit(1);
}

async function cleanup(): Promise<void> {
  await db.delete(mentions).where(inArray(mentions.tweetId, [FAKE_MENTION, FAKE_MENTION_2]));
  await db
    .delete(postsPublished)
    .where(inArray(postsPublished.tweetId, [FAKE_PARENT, FAKE_MY_REPLY]));
}

await cleanup(); // a previous crashed run must not poison this one

// Seed: my (fake) post, a mention replying to it, and a second mention that my
// (fake) published reply targets — retired so dailyMetrics never bills a read.
await db.insert(postsPublished).values([
  {
    tweetId: FAKE_PARENT,
    text: 'smoke: my original post about shipping',
    postedAt: new Date(Date.now() - 60 * 60_000),
    source: 'manual',
    retired: true,
  },
  {
    tweetId: FAKE_MY_REPLY,
    text: 'smoke: my reply to mention 2',
    postedAt: new Date(),
    isReply: true,
    inReplyToTweetId: FAKE_MENTION_2,
    source: 'manual',
    retired: true,
  },
]);
await db.insert(mentions).values([
  {
    tweetId: FAKE_MENTION,
    authorId: '12345',
    authorUsername: 'smoke_author',
    authorName: 'Smoke Author',
    text: 'smoke: hey @me what did you ship?',
    postedAt: new Date(Date.now() - 30 * 60_000),
    inReplyToTweetId: FAKE_PARENT,
  },
  {
    tweetId: FAKE_MENTION_2,
    authorId: '12346',
    authorUsername: 'smoke_author2',
    text: 'smoke: second mention, already replied on X',
    postedAt: new Date(Date.now() - 20 * 60_000),
  },
]);

// List: both fake rows unanswered, the first carrying my parent post's text.
const l0 = await app.request('/x/mentions?status=unanswered&limit=200');
if (l0.status !== 200) fail(`list returned ${l0.status}`);
const inbox = (await l0.json()) as {
  counts: { unanswered: number };
  mentions: Array<{ tweetId: string; parentText: string | null; status: string }>;
};
const m1 = inbox.mentions.find((m) => m.tweetId === FAKE_MENTION);
const m2 = inbox.mentions.find((m) => m.tweetId === FAKE_MENTION_2);
if (!m1 || !m2) fail(`seeded mentions missing from list (got ${inbox.mentions.length})`);
if (m1.parentText !== 'smoke: my original post about shipping') {
  fail(`parentText join wrong: ${JSON.stringify(m1.parentText)}`);
}
if (m2.parentText !== null) fail('mention 2 should have no parent');
console.log(`list: ${inbox.counts.unanswered} unanswered, parentText join OK`);

// Backfill: my published reply targets FAKE_MENTION_2 → flips to answered.
const flipped = await backfillAnswered();
const [m2After] = await db.select().from(mentions).where(eq(mentions.tweetId, FAKE_MENTION_2));
if (m2After?.status !== 'answered' || m2After.answeredAt === null) {
  fail(`backfill did not answer mention 2: ${JSON.stringify(m2After)}`);
}
console.log(`backfill: ${flipped} flipped, mention 2 answered OK`);

// PATCH: dismiss, then re-open, then answer by hand.
for (const [status, wantAnsweredAt] of [
  ['dismissed', false],
  ['unanswered', false],
  ['answered', true],
] as const) {
  const r = await app.request(`/x/mentions/${FAKE_MENTION}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status }),
  });
  if (r.status !== 200) fail(`PATCH ${status} returned ${r.status}: ${await r.text()}`);
  const row = (await r.json()) as { status: string; answeredAt: string | null };
  if (row.status !== status) fail(`PATCH ${status} → ${row.status}`);
  if ((row.answeredAt !== null) !== wantAnsweredAt) {
    fail(`answeredAt wrong after ${status}: ${row.answeredAt}`);
  }
}
console.log('patch: dismissed → unanswered → answered OK');

const bad = await app.request('/x/mentions/not-a-tweet-id', {
  method: 'PATCH',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ status: 'answered' }),
});
if (bad.status !== 400) fail(`bad id returned ${bad.status}`);

await cleanup();
console.log('cleanup: fake rows removed');

if (LIVE) {
  // One real pull, capped at 10 results (≤ $0.01). Whatever it inserts is real
  // inbox data — exactly what the feature exists to hold, so it stays.
  const r = await app.request('/x/mentions/refresh', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ maxResults: 10 }),
  });
  if (r.status !== 200) fail(`live refresh returned ${r.status}: ${await r.text()}`);
  const result = await r.json();
  console.log(`live refresh: ${JSON.stringify(result)}`);
}

console.log('SMOKE OK');
process.exit(0);
