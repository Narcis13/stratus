// One-shot smoke test for CIRCLES-PLAN C4 (the Playbook). Mounts the playbook
// router in-process (no port, no workers, no Grok) against the real DB: seeds
// a measured single-draft reply, a radar-attributed reply, a drafter original
// with pillar+register, and an own-winner template; verifies every stat of
// GET /x/playbook sees them, the minN knob, the gate, and the guidance
// loaders' silence under the default gate; then deletes every row it created.
// $0 — extract-winners (the only Grok path) is NOT called.
// Run: bun run scripts/smoke-playbook.ts

import { eq, inArray } from 'drizzle-orm';
import { Hono } from 'hono';
import { db } from '../src/db/client.ts';
import {
  metricsSnapshots,
  postTemplates,
  postsPublished,
  radarDrafts,
  replyDrafts,
  scheduledPosts,
} from '../src/x/db/schema.ts';
import { loadPostGuidance, loadReplyGuidance, playbook } from '../src/x/routes/playbook.ts';

const R1 = '980000000000000001'; // my posted reply (single draft)
const R2 = '980000000000000002'; // my posted reply (radar batch)
const P1 = '980000000000000003'; // my published original (drafter)
const SRC = '980000000000000009'; // radar target tweet
const TWEET_IDS = [R1, R2, P1];
const DRAFT_ID = '99999999-0000-4000-8000-000000000001';
const SCHED_ID = '99999999-0000-4000-8000-000000000002';

const app = new Hono();
app.route('/x', playbook);

function fail(msg: string): never {
  console.error(`FAIL: ${msg}`);
  process.exit(1);
}

async function cleanup(): Promise<void> {
  await db.delete(metricsSnapshots).where(inArray(metricsSnapshots.tweetId, TWEET_IDS));
  await db.delete(postTemplates).where(eq(postTemplates.tweetId, P1));
  await db.delete(replyDrafts).where(eq(replyDrafts.id, DRAFT_ID));
  await db.delete(scheduledPosts).where(eq(scheduledPosts.id, SCHED_ID));
  await db.delete(radarDrafts).where(eq(radarDrafts.tweetId, SRC));
  await db.delete(postsPublished).where(inArray(postsPublished.tweetId, TWEET_IDS));
}

// Start clean in case an earlier run died mid-way.
await cleanup();

const now = Date.now();

// 1. A posted single-draft reply with a measured snapshot + relationship block.
await db.insert(replyDrafts).values({
  id: DRAFT_ID,
  sourceTweetId: SRC,
  sourceAuthorUsername: 'smoke_playbook',
  sourceText: 'What is your take on agents?',
  sourceUrl: `https://x.com/smoke_playbook/status/${SRC}`,
  sourcePostedAt: new Date(now - 6 * 3_600_000),
  contextSnapshot: {
    signals: { band: 'hot', views: 4000, replies: 6, ageMin: 15, vpm: 260, bait: true },
    metrics: { views: 4000, replies: 6, reposts: 2, likes: 30 },
    relationship: '## My history with @smoke_playbook',
  },
  replyText: 'smoke playbook reply',
  variants: [{ text: 'smoke playbook reply', angle: 'contrarian' }],
  model: 'smoke',
  status: 'posted',
  postedTweetId: R1,
});
await db.insert(postsPublished).values([
  {
    tweetId: R1,
    text: 'smoke playbook reply',
    postedAt: new Date(now - 5 * 3_600_000),
    isReply: true,
    inReplyToTweetId: SRC,
    source: 'smoke',
  },
  // 2. A radar-drafted reply: same target, text matches the drafted reply,
  // no reply_drafts link.
  {
    tweetId: R2,
    text: 'smoke  radar reply',
    postedAt: new Date(now - 4 * 3_600_000),
    isReply: true,
    inReplyToTweetId: SRC,
    source: 'smoke',
  },
  // 3. A drafter original.
  {
    tweetId: P1,
    text: 'smoke original post',
    postedAt: new Date(now - 3 * 3_600_000),
    isReply: false,
    source: 'smoke',
  },
]);
await db.insert(radarDrafts).values({
  tweetId: SRC,
  handle: 'smoke_playbook',
  snippet: 'What is your take on agents?',
  replyText: 'smoke radar reply',
  angle: 'extends',
  status: 'clicked',
});
await db.insert(scheduledPosts).values({
  id: SCHED_ID,
  text: 'smoke original post',
  status: 'posted',
  source: 'drafter',
  pillar: 'ai-craft',
  register: 'spicy',
  postedTweetId: P1,
});
await db.insert(postTemplates).values({
  tweetId: P1,
  hookType: 'smoke stat hook',
  skeleton: 'hook -> claim -> close',
  lineBreakPattern: 'one-liner',
  templateLength: 'short',
  device: 'smoke direct address',
});
await db.insert(metricsSnapshots).values([
  {
    tweetId: R1,
    publicMetrics: { impression_count: 420, like_count: 3, reply_count: 1 },
    nonPublicMetrics: { user_profile_clicks: 5 },
  },
  { tweetId: R2, publicMetrics: { impression_count: 90, like_count: 1, reply_count: 0 } },
  { tweetId: P1, publicMetrics: { impression_count: 800, like_count: 6, reply_count: 2 } },
]);
console.log('seeded: 1 single reply, 1 radar reply, 1 drafter original, 1 template');

// 4. GET /x/playbook — every stat sees the seeds, gated at the default n≥20.
const res = await app.request('/x/playbook');
if (res.status !== 200) fail(`GET /x/playbook returned ${res.status}`);
// biome-ignore lint/suspicious/noExplicitAny: smoke walks the whole payload
const body = (await res.json()) as any;

if (body.minN !== 20) fail(`default minN expected 20, got ${body.minN}`);
const contrarian = body.angleEffectiveness.overall.find(
  (c: { angle: string | null }) => c.angle === 'contrarian',
);
if (!contrarian || contrarian.n < 1) fail('contrarian angle cell missing the seeded reply');
if (contrarian.sufficient !== false) fail('1-row cell must be insufficient at n>=20');

const pr = body.pillarRegister.cells.find(
  (c: { pillar: string | null; register: string | null }) =>
    c.pillar === 'ai-craft' && c.register === 'spicy',
);
if (!pr || pr.medianViews !== 800) fail('pillar × register cell missing/wrong');

const hook = body.structures.hooks.find((h: { key: string }) => h.key === 'smoke stat hook');
if (!hook || hook.medianViews !== 800) fail('structure hook cell missing/wrong');

if (body.batchVsSingle.single.n < 1) fail('single-draft reply not counted');
if (body.batchVsSingle.radar.n < 1) fail('radar reply not attributed (text+target match)');

if (body.bandCalibration.totalMeasured < 1) fail('band calibration saw no measured replies');
const hot = body.bandCalibration.bands.find((b: { band: string | null }) => b.band === 'hot');
if (!hot) fail('hot band cell missing');

if (body.relationshipLift.withRelationship.n < 1) fail('relationship-aware reply not counted');
if (body.relationshipLift.viewsLift !== null) fail('lift must stay null under the gate');
console.log('GET /x/playbook: all six stats see the seeds, gates hold');

// 5. minN knob + validation.
const open = await app.request('/x/playbook?minN=1');
// biome-ignore lint/suspicious/noExplicitAny: smoke walks the whole payload
const openBody = (await open.json()) as any;
const openCell = openBody.angleEffectiveness.overall.find(
  (c: { angle: string | null }) => c.angle === 'contrarian',
);
if (openCell.sufficient !== true) fail('minN=1 did not open the gate');
const bad = await app.request('/x/playbook?minN=0');
if (bad.status !== 400) fail(`minN=0 expected 400, got ${bad.status}`);
console.log('minN knob + validation OK');

// 6. Guidance loaders: silent under the default gate (real data volume is
// whatever the DB holds — the seeds alone can't clear n>=20, and if the live
// history someday does, a non-null line here is correct too).
const replyGuidance = await loadReplyGuidance();
const postGuidance = await loadPostGuidance();
console.log(`guidance: reply=${replyGuidance ?? '(silent)'} post=${postGuidance ?? '(silent)'}`);

// 7. extract-winners without a key must refuse with 503, never spend.
if (!process.env.XAI_API_KEY) {
  const r = await app.request('/x/playbook/extract-winners', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  if (r.status !== 503) fail(`extract-winners without key expected 503, got ${r.status}`);
  console.log('extract-winners refuses without XAI_API_KEY (503)');
} else {
  console.log('extract-winners skipped (XAI_API_KEY set; it would spend — run by hand)');
}

// 8. Cleanup.
await cleanup();
console.log('cleanup: removed all seeded rows');
console.log('SMOKE PASS');
process.exit(0);
