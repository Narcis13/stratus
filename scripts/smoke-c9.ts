// One-shot smoke test for CIRCLES-PLAN C9 (quests & streaks, Sunday Digest,
// icebreakers). Mounts the brief + digest + people routers in-process against
// the real DB: seeds a launched original, a reply pasted inside its 30-min
// window, and two people (bare / grounded); checks the quest block, the
// idempotent streak write, the digest facts + cache path, and the
// icebreakers' $0 refusals — then deletes every row it created. $0 by
// default: the digest uses ?factsOnly=true and icebreaker generation only
// runs with --live (~$0.005 + ~$0.01 if you also pass --live-digest).
// Run: bun run scripts/smoke-c9.ts [--live]
//
// Note: the brief read overwrites TODAY's streaks row while the seeds exist;
// the next real brief read recomputes it from real rows — idempotent per day
// by design, so nothing is left dirty.

import { and, eq, like } from 'drizzle-orm';
import { Hono } from 'hono';
import { db } from '../src/db/client.ts';
import {
  digests,
  people,
  personEvents,
  postsPublished,
  replyDrafts,
  streaks,
} from '../src/x/db/schema.ts';
import { localDayKey } from '../src/x/quests.ts';
import { brief } from '../src/x/routes/brief.ts';
import { digest } from '../src/x/routes/digest.ts';
import { peopleRouter } from '../src/x/routes/people.ts';

const LIVE = process.argv.includes('--live');

const ORIGINAL_ID = '99000000000000001';
const TARGET = 'smoke_c9_target';
// Handles must fit X's 15-char username rule or the route 400s them.
const BARE = 'smoke_c9_bare';
const GROUNDED = 'smoke_c9_warm';
const CACHED_WEEK = '2024-01-01'; // a Monday far in the past — never a live week

const app = new Hono();
app.route('/x', brief);
app.route('/x', digest);
app.route('/x', peopleRouter);

function fail(msg: string): never {
  console.error(`FAIL: ${msg}`);
  process.exit(1);
}

async function cleanup(): Promise<void> {
  await db.delete(replyDrafts).where(like(replyDrafts.sourceAuthorUsername, 'smoke_c9_%'));
  await db.delete(postsPublished).where(eq(postsPublished.tweetId, ORIGINAL_ID));
  await db.delete(digests).where(eq(digests.weekKey, CACHED_WEEK));
  for (const h of [TARGET, BARE, GROUNDED]) {
    await db.delete(personEvents).where(eq(personEvents.handle, h));
    await db.delete(people).where(eq(people.handle, h));
  }
}

await cleanup(); // start clean in case an earlier run died mid-way

const now = new Date();

// 1. Seed: an original launched 5 minutes ago + a reply pasted 2 minutes ago
//    (inside the 30-min launch window).
await db.insert(postsPublished).values({
  tweetId: ORIGINAL_ID,
  text: 'smoke c9: launched original',
  postedAt: new Date(now.getTime() - 5 * 60_000),
  isReply: false,
  source: 'smoke',
});
await db.insert(replyDrafts).values({
  sourceTweetId: '99000000000000009',
  sourceAuthorUsername: TARGET,
  sourceText: 'smoke c9 source',
  sourceUrl: `https://x.com/${TARGET}/status/99000000000000009`,
  contextSnapshot: {},
  replyText: 'smoke c9 reply',
  model: 'smoke',
  status: 'posted',
  updatedAt: new Date(now.getTime() - 2 * 60_000),
});

// 2. Quest block on the brief.
interface Quest {
  key: string;
  done: boolean;
  target: number;
  note: string | null;
}
let res = await app.request('/x/brief?tzOffsetMin=0');
if (res.status !== 200) fail(`GET /x/brief returned ${res.status}`);
const briefBody = (await res.json()) as {
  quests: { day: string; items: Quest[]; streak: { current: number; todayComplete: boolean } };
};
const q = new Map(briefBody.quests.items.map((i) => [i.key, i]));
if (briefBody.quests.items.length !== 5)
  fail(`expected 5 quests, got ${briefBody.quests.items.length}`);
if (!q.get('original')?.done) fail('original quest should be done (seeded post today)');
if (!q.get('launch')?.done) fail('launch quest should be done (reply pasted in the window)');
if (q.get('launch')?.target !== 1) fail('launch quest should be applicable today');
console.log('quests: original + launch-attended read from seeded rows OK');

// 3. Streak write is idempotent per day.
await app.request('/x/brief?tzOffsetMin=0');
const dayKey = localDayKey(new Date(), 0);
const dayRows = await db.select().from(streaks).where(eq(streaks.day, dayKey));
if (dayRows.length !== 1)
  fail(`expected exactly 1 streaks row for ${dayKey}, got ${dayRows.length}`);
if (typeof dayRows[0]?.completed?.replies !== 'boolean')
  fail('streaks.completed missing quest keys');
console.log(`streaks: one idempotent row for ${dayKey} OK`);

// 4. Digest facts ($0 — factsOnly skips narration entirely).
res = await app.request('/x/digest?tzOffsetMin=0&factsOnly=true');
if (res.status !== 200) fail(`GET /x/digest returned ${res.status}`);
const digestBody = (await res.json()) as {
  weekKey: string;
  narrative: string | null;
  facts: { activity: { posts: number }; quests: { daysTracked: number } };
};
if (digestBody.narrative !== null) fail('factsOnly must not narrate');
if (digestBody.facts.activity.posts < 1) fail('digest facts missing the seeded post');
if (digestBody.facts.quests.daysTracked < 1) fail('digest facts missing the streak day');
console.log(
  `digest: facts for week ${digestBody.weekKey} OK (posts=${digestBody.facts.activity.posts})`,
);

// 5. Digest cache path serves without Grok.
await db.insert(digests).values({
  weekKey: CACHED_WEEK,
  facts: { weekKey: CACHED_WEEK },
  narrative: 'smoke: a cached coach note',
  model: 'smoke',
  costUsd: 0,
});
res = await app.request(`/x/digest?week=${CACHED_WEEK}&tzOffsetMin=0`);
const cached = (await res.json()) as { cached: boolean; narrative: string | null };
if (!cached.cached || cached.narrative !== 'smoke: a cached coach note') {
  fail('stored digest was not served from cache');
}
console.log('digest: cache path OK');

// 6. Icebreakers — the $0 refusal ladder.
await db.insert(people).values({ handle: BARE, source: 'smoke' });
await db.insert(people).values({
  handle: GROUNDED,
  source: 'smoke',
  notes: 'smoke: we talked about bun:sqlite migrations',
});
res = await app.request(`/x/people/${BARE}/icebreakers`, { method: 'POST' });
if (res.status !== 422) fail(`bare person should 422, got ${res.status}`);
res = await app.request('/x/people/smoke_c9_gone/icebreakers', { method: 'POST' });
if (res.status !== 404) fail(`missing person should 404, got ${res.status}`);
console.log('icebreakers: 404/422 refusals decided before any Grok spend OK');

if (LIVE) {
  if (!process.env.XAI_API_KEY) fail('--live needs XAI_API_KEY');
  res = await app.request(`/x/people/${GROUNDED}/icebreakers`, { method: 'POST' });
  if (res.status !== 200) fail(`grounded icebreakers returned ${res.status}`);
  const ice = (await res.json()) as {
    icebreakers: { reply: string; dm: string };
    costUsd: number;
    grounding: string;
  };
  if (!ice.icebreakers.reply || !ice.icebreakers.dm) fail('live icebreakers came back empty');
  if (!ice.grounding.includes('bun:sqlite')) fail('grounding lost my notes');
  console.log(`icebreakers live: reply="${ice.icebreakers.reply.slice(0, 60)}…" ($${ice.costUsd})`);
} else {
  console.log('icebreakers: live generation skipped (pass --live, ~$0.005)');
}

// 7. Cleanup.
await cleanup();
console.log('cleanup: removed smoke rows');
console.log('SMOKE PASS');
process.exit(0);
