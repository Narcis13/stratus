// One-shot smoke for the Mika growth-tactics lane (GT.1–GT.8, plan
// `plans/2026-07-22-mika-growth-tactics.md`). Mounts the replies + brief +
// radar routers in-process (no port, no workers, no X call) against the real DB
// and drives the four things the lane actually decides:
//
//   (a) the band gate's people-layer carve-out (GT.6) — a dead post by someone
//       in my circle clears the gate, a stranger's and a retired person's do
//       not, and a client-sent `gateBypass` is dropped by `parseContext`;
//   (b) `buildMilestoneWatch` (GT.4) — pure, on synthetic series, incl. the
//       witnessed-crossing rule the studio twin does not have;
//   (c) the reciprocity quest's arithmetic through `GET /x/brief` (GT.7) — and
//       specifically its QUALIFIER, which is the whole feature: the same posted
//       reply counts or doesn't depending only on whether the author was
//       already mine when the day started;
//   (d) `radar_drafts.band = 'roster'` (GT.8) coerced to null on confirm while
//       the real metrics survive (§7.19).
//
// **$0 and it can never spend**, which is the interesting constraint here: the
// exempt draft is proven by how FAR it gets, not by a draft coming back — both
// LLM keys are force-unset in a `finally` so a request that clears the gate
// lands on `503 llm_not_configured` (the `drafter.test.ts` trick). There is no
// `--live` flag: the only paid thing in reach would be the Grok call this
// script exists to prove we did not make.
//
// The format cooldown the plan's Task 9 also lists is NOT asserted here — GT.5
// was superseded by SC.6 (masterplan D142) and `smoke-coach.ts` (SC.9) owns
// that arithmetic.
//
// Real-DB safety is namespace-then-delete (§D98c): every handle is `gt9*`
// (≤15 chars, or `normalizePersonHandle` silently drops it and the assertions
// go vacuous) and every tweet id is 887-prefixed — no real snowflake starts
// there. Nothing here is a global read-that-writes except `GET /x/brief`, which
// settles goals and rewrites today's C9 streak diary, so the run CLOSES on one
// more brief read over clean data (the `smoke-guardrails.ts` rule).
//
// Run: bun run scripts/smoke-growth-tactics.ts

import { eq, inArray } from 'drizzle-orm';
import { Hono } from 'hono';
import { db } from '../src/db/client.ts';
import { people, radarDrafts, replyDrafts } from '../src/x/db/schema.ts';
import { loadDoctrine } from '../src/x/niche/store.ts';
import { RECIPROCITY_MIN_STAGE, loadReciprocityHandles } from '../src/x/people/reciprocity.ts';
import { MILESTONES, brief, buildMilestoneWatch } from '../src/x/routes/brief.ts';
import { persistRadarDrafts, radar } from '../src/x/routes/radar.ts';
import { parseContext, replies } from '../src/x/routes/replies.ts';

const DAY = 24 * 60 * 60 * 1000;

// Handles: ≤15 chars each (normalizePersonHandle drops longer ones).
const MINE = 'gt9mine';
const GONE = 'gt9gone';
const STRANGER = 'gt9stranger';
const HANDLES = [MINE, GONE, STRANGER];

// Tweet ids: 887-prefixed, no real snowflake starts there.
const DEAD_TWEET = '887000000000000001'; // the quiet post the gate judges
const REPLIED_TO = '887000000000000002'; // what the seeded posted reply answered
const ROSTER_TWEET = '887000000000000003'; // the roster sighting
const TWEET_IDS = [DEAD_TWEET, REPLIED_TO, ROSTER_TWEET];

const app = new Hono();
app.route('/x', replies);
app.route('/x', brief);
app.route('/x', radar);

function fail(msg: string): never {
  console.error(`FAIL: ${msg}`);
  process.exit(1);
}
function ok(msg: string): void {
  console.log(`ok: ${msg}`);
}

async function cleanup(): Promise<void> {
  await db.delete(radarDrafts).where(inArray(radarDrafts.tweetId, TWEET_IDS));
  await db.delete(replyDrafts).where(inArray(replyDrafts.sourceTweetId, TWEET_IDS));
  await db.delete(people).where(inArray(people.handle, HANDLES));
}

// Start clean in case an earlier run died mid-way.
await cleanup();

// `fn` returns `Response | Promise<Response>` — app.request's own type (NT.7).
async function keyless<T>(fn: () => T | Promise<T>): Promise<T> {
  const xai = process.env.XAI_API_KEY;
  const openrouter = process.env.OPENROUTER_API_KEY;
  // biome `noDelete`: unset is '' (falsy), never `delete process.env.X`.
  process.env.XAI_API_KEY = '';
  process.env.OPENROUTER_API_KEY = '';
  try {
    return await fn();
  } finally {
    process.env.XAI_API_KEY = xai ?? '';
    process.env.OPENROUTER_API_KEY = openrouter ?? '';
  }
}

// A post with 40 views an hour old: `classifyBand` says null (dead), so the
// gate refuses unless the author is my people.
const deadContext = (handle: string) => ({
  tweetId: DEAD_TWEET,
  handle,
  author: 'Growth Tactics Smoke',
  text: 'a quiet thought nobody saw.',
  url: `https://x.com/${handle}/status/${DEAD_TWEET}`,
  postedAt: new Date(Date.now() - 60 * 60_000).toISOString(),
  metrics: { views: 40, replies: 1, reposts: 0, likes: 2 },
  topComments: [],
});

const generate = (handle: string) =>
  app.request('/x/replies/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ context: deadContext(handle) }),
  });

// ------------------------------------------------------- (a) the gate (GT.6)

// Stamped well before today so the SAME row also satisfies the quest's
// `{asOf: todayStart}` reading in step (c) — the gate asks unscoped.
await db.insert(people).values({
  handle: MINE,
  stage: RECIPROCITY_MIN_STAGE,
  stageUpdatedAt: new Date(Date.now() - 30 * DAY),
  source: 'manual',
});
await db.insert(people).values({
  handle: GONE,
  stage: RECIPROCITY_MIN_STAGE,
  stageUpdatedAt: new Date(Date.now() - 30 * DAY),
  retired: true,
  source: 'manual',
});

const memberSet = await loadReciprocityHandles();
if (!memberSet.has(MINE)) fail(`${MINE} at stage ${RECIPROCITY_MIN_STAGE} is not in the set`);
if (memberSet.has(GONE)) fail('a retired person is still in the reciprocity set');
ok(`reciprocity set: ${memberSet.size} handles, floor = ${RECIPROCITY_MIN_STAGE}`);

let res = await keyless(() => generate(MINE));
if (res.status !== 503) {
  fail(`exempt handle: /replies/generate returned ${res.status} (want 503): ${await res.text()}`);
}
if (((await res.json()) as { error: string }).error !== 'llm_not_configured') {
  fail('exempt handle did not reach the LLM layer — the gate refused it');
}
ok('gate exemption: a dead post by my people reaches 503 llm_not_configured (nothing spent)');

res = await generate(STRANGER);
if (res.status !== 422) fail(`stranger: expected 422, got ${res.status}`);
let refused = (await res.json()) as { error: string; band: unknown };
if (refused.error !== 'band_gate' || refused.band !== null) {
  fail(`stranger refusal shape wrong: ${JSON.stringify(refused)}`);
}
ok('an unknown handle keeps the refusal default (422 band_gate, band null)');

res = await generate(GONE);
if (res.status !== 422) fail(`retired person: expected 422, got ${res.status}`);
refused = (await res.json()) as { error: string; band: unknown };
if (refused.error !== 'band_gate') fail('retired person did not get band_gate');
ok('a retired person is not my people — the dead post still 422s');

// §7.16: `gateBypass` is server-stamped. parseContext builds from an explicit
// allowlist, so a client that sends one is refused by construction.
const parsed = parseContext({ ...deadContext(MINE), gateBypass: 'roster' });
if ('error' in parsed) fail(`parseContext rejected a valid context: ${JSON.stringify(parsed)}`);
if ('gateBypass' in parsed) fail('parseContext let a client-supplied gateBypass through');
ok('gateBypass is never accepted from the client (§7.16)');

// Nothing above may have written a draft — every arm returned before the insert.
const strayDrafts = await db
  .select({ id: replyDrafts.id })
  .from(replyDrafts)
  .where(eq(replyDrafts.sourceTweetId, DEAD_TWEET));
if (strayDrafts.length !== 0) fail(`the gate steps wrote ${strayDrafts.length} reply_drafts rows`);
ok('the gate steps wrote no rows');

// --------------------------------------------------- (b) milestones (GT.4)

const now = new Date();
const at = (daysAgo: number, followers: number) => ({
  snapshotAt: new Date(now.getTime() - daysAgo * DAY),
  followers,
});

const crossed = buildMilestoneWatch([at(10, 900), at(4, 980), at(2, 1007), at(0, 1012)], now);
if (crossed?.milestone !== 1000) fail(`witnessed crossing: got ${JSON.stringify(crossed)}`);
if (crossed.followers !== 1007) {
  // The CROSSING snapshot's count, not today's — all three fields describe one
  // event, so a dip after the crossing can't make the triple incoherent.
  fail(`followers should be the crossing reading (1007), got ${crossed.followers}`);
}
ok(`milestone: crossed ${crossed.milestone} at ${crossed.followers} followers`);

if (buildMilestoneWatch([at(2, 1007), at(1, 1010), at(0, 1012)], now) !== null) {
  fail('an unwitnessed crossing (first snapshot already past the rung) must be silent');
}
ok('milestone: a fresh install already past a rung is never congratulated');

if (buildMilestoneWatch([at(20, 900), at(9, 1007), at(0, 1100)], now) !== null) {
  fail('a crossing older than the nudge window must go quiet');
}
ok('milestone: a crossing older than the 3-day window goes quiet');

if (buildMilestoneWatch([at(10, 5), at(0, 40)], now) !== null) {
  fail(`below the lowest rung (${MILESTONES[0]}) must be null`);
}
ok(`milestone: below the lowest rung (${MILESTONES[0]}) → null`);

// ------------------------------------------- (c) the reciprocity quest (GT.7)

interface BriefQuests {
  quests: { items: Array<{ key: string; n: number; target: number; note: string | null }> };
}
async function reciprocityQuest(): Promise<{ n: number; target: number; note: string | null }> {
  const r = await app.request('/x/brief?tzOffsetMin=0');
  if (r.status !== 200) fail(`GET /x/brief returned ${r.status}: ${await r.text()}`);
  const body = (await r.json()) as BriefQuests;
  const q = body.quests.items.find((i) => i.key === 'reciprocity');
  if (!q) fail('the brief has no `reciprocity` quest — QUEST_KEYS regressed');
  return { n: q.n, target: q.target, note: q.note };
}

// Baseline over whatever the real DB already holds — never an absolute: other
// posted replies today are legitimately someone else's.
const before = await reciprocityQuest();

// A reply posted TODAY to the handle seeded above (stage stamped 30 days ago).
await db.insert(replyDrafts).values({
  sourceTweetId: REPLIED_TO,
  sourceAuthorUsername: MINE,
  sourceText: 'their quiet post',
  sourceUrl: `https://x.com/${MINE}/status/${REPLIED_TO}`,
  contextSnapshot: {},
  replyText: 'gt9 smoke reply',
  model: 'gt9-smoke',
  status: 'posted',
  updatedAt: new Date(),
});

const counted = await reciprocityQuest();
if (counted.n !== before.n + 1) {
  fail(`reciprocity n should be ${before.n + 1}, got ${counted.n}`);
}
const doctrineTarget = loadDoctrine().reciprocityTargetMin;
if (counted.target !== doctrineTarget) {
  fail(`quest target ${counted.target} ≠ loadDoctrine().reciprocityTargetMin ${doctrineTarget}`);
}
ok(
  `reciprocity quest: ${counted.n}/${counted.target} (target is niche-owned, not a registry knob)`,
);

// The qualifier, and the reason this quest is not a copy of the replies quest:
// `engaged` means "I have replied to them", so posting the reply is what
// creates the membership. Re-stamp the same person to NOW and the same posted
// reply stops counting — one rule (`loadReciprocityHandles`) at two instants.
await db.update(people).set({ stageUpdatedAt: new Date() }).where(eq(people.handle, MINE));

const requalified = await reciprocityQuest();
if (requalified.n !== before.n) {
  fail(`a person who became mine TODAY must not count today: n=${requalified.n}, want ${before.n}`);
}
ok('reciprocity qualifier: a first contact made today is not reciprocity (GT.7 / D158)');

// ------------------------------------------------ (d) the roster band (GT.8)

const ROSTER_TEXT = 'gt9 roster sighting — quiet post by someone in my circle';
await persistRadarDrafts(
  [
    {
      tweetId: ROSTER_TWEET,
      handle: MINE,
      author: 'Growth Tactics Smoke',
      text: ROSTER_TEXT,
      url: `https://x.com/${MINE}/status/${ROSTER_TWEET}`,
      band: 'roster',
      signals: { views: 37, replies: 0, ageMin: 42, vpm: 0.9, bait: false },
    },
  ],
  [
    {
      tweetId: ROSTER_TWEET,
      text: 'gt9 roster draft',
      angle: 'extends',
      variants: [{ text: 'gt9 roster draft', angle: 'extends' }],
    },
  ],
  'gt9-smoke',
);

res = await app.request(`/x/radar/drafts?tweetId=${ROSTER_TWEET}`);
if (res.status !== 200) fail(`GET /x/radar/drafts returned ${res.status}`);
const queued = (await res.json()) as { drafts: Array<{ tweetId: string; band: string | null }> };
const rosterRow = queued.drafts.find((d) => d.tweetId === ROSTER_TWEET);
if (rosterRow?.band !== 'roster') fail(`roster band not stored: ${JSON.stringify(rosterRow)}`);
ok("radar queue accepts band='roster' (a quiet post by my people enters the queue)");

res = await app.request(`/x/radar/drafts/${ROSTER_TWEET}/confirm`, { method: 'POST' });
if (res.status !== 201) fail(`roster confirm returned ${res.status}: ${await res.text()}`);
const confirmed = (await res.json()) as {
  contextSnapshot: {
    metrics?: { views: number };
    signals?: { band: string | null; views: number };
  };
};
// §7.19: a roster capture is queue metadata, not a classifier verdict — it is
// coerced away exactly like a `manual` ⊕ pin, so it can never land in the
// Playbook's hot/warm band cells. The measured numbers are untouched.
if (confirmed.contextSnapshot.signals?.band !== null) {
  fail(`roster band survived confirm as ${confirmed.contextSnapshot.signals?.band} (want null)`);
}
if (confirmed.contextSnapshot.signals?.views !== 37) {
  fail('the roster row lost its real view count in the snapshot');
}
if (confirmed.contextSnapshot.metrics?.views !== 37) fail('metrics.views not rebuilt');
ok('confirm coerces roster → null band while the real metrics survive (§7.19)');

// ------------------------------------------------------------------ cleanup

await cleanup();
const leftPeople = await db
  .select({ h: people.handle })
  .from(people)
  .where(inArray(people.handle, HANDLES));
const leftDrafts = await db
  .select({ id: replyDrafts.id })
  .from(replyDrafts)
  .where(inArray(replyDrafts.sourceTweetId, TWEET_IDS));
const leftRadar = await db
  .select({ id: radarDrafts.id })
  .from(radarDrafts)
  .where(inArray(radarDrafts.tweetId, TWEET_IDS));
if (leftPeople.length + leftDrafts.length + leftRadar.length !== 0) {
  fail(
    `cleanup left rows: people=${leftPeople.length} drafts=${leftDrafts.length} radar=${leftRadar.length}`,
  );
}
ok('cleanup: 0 rows left');

// `GET /x/brief` WRITES (it settles goals and overwrites today's C9 streak
// diary), and the last one above ran with fixtures in the table. Close on a
// clean read so the diary describes the operator's real day.
const closing = await reciprocityQuest();
if (closing.n !== before.n)
  fail(`closing brief read: n=${closing.n}, want the baseline ${before.n}`);
ok(`closing brief re-read: reciprocity back to the baseline ${before.n} (C9 diary is clean)`);

console.log('SMOKE PASS');
process.exit(0);
