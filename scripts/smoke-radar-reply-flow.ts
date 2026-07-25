// One-shot smoke for Overhaul 7.7 (Radar ↔ Reply Master unification, RU.1–RU.9).
// Mounts the radar + replies routers in-process (no port, no workers, no Grok by
// default) against the real DB. Seeds a radar_drafts row carrying 3 angle
// variants the way /replies/generate-batch → persistRadarDrafts does, GETs it by
// tweetId, confirms it into a reply_drafts row (source='radar', status='copied',
// variants + contextSnapshot intact), confirms again (idempotent 200), PATCHes it
// posted with an edited variant + our reply's own postedTweetId, then asserts
// classifyReplyOrigin attributes the posted reply to `radar` BY SOURCE (RU.9 —
// the exact, no-longer-text-matched batch-vs-single Playbook split; the edited
// text deliberately matches no variant, so a passing test proves source beats the
// heuristic). Deletes every row it created. $0.
// --live adds ONE 2-tweet generate-batch Grok call (~$0.01) asserting 3
// variants/tweet + radar_drafts persistence.
// Run: bun run scripts/smoke-radar-reply-flow.ts [--live]

import { and, eq, inArray, isNotNull } from 'drizzle-orm';
import { Hono } from 'hono';
import { db } from '../src/db/client.ts';
import { llmConfigured } from '../src/llm/index.ts';
import { radarDrafts, replyDrafts } from '../src/x/db/schema.ts';
import { classifyReplyOrigin } from '../src/x/playbook.ts';
import { persistRadarDrafts, radar } from '../src/x/routes/radar.ts';
import { replies } from '../src/x/routes/replies.ts';

const LIVE = process.argv.includes('--live');

const SRC = '880000000000000001'; // the tweet we reply TO (radar target)
const POSTED = '880000000000000009'; // our reply's own tweet id (postedTweetId)
const L1 = '880000000000000011';
const L2 = '880000000000000012';
const LIVE_IDS = [L1, L2];

const app = new Hono();
app.route('/x', radar);
app.route('/x', replies);

function fail(msg: string): never {
  console.error(`FAIL: ${msg}`);
  process.exit(1);
}
function ok(msg: string): void {
  console.log(`ok: ${msg}`);
}

async function cleanup(): Promise<void> {
  await db.delete(radarDrafts).where(inArray(radarDrafts.tweetId, [SRC, ...LIVE_IDS]));
  await db.delete(replyDrafts).where(inArray(replyDrafts.sourceTweetId, [SRC, ...LIVE_IDS]));
}

// Start clean in case an earlier run died mid-way.
await cleanup();

// 1. Seed a radar_drafts row carrying all 3 angle variants, exactly as
//    /replies/generate-batch → persistRadarDrafts does after a batch call.
const PRIMARY_TEXT = 'smoke primary — extends the point';
const PRIMARY_ANGLE = 'extends';
const VARIANTS = [
  { text: PRIMARY_TEXT, angle: PRIMARY_ANGLE },
  { text: 'smoke contrarian take', angle: 'contrarian' },
  { text: 'smoke debate prompt', angle: 'debate' },
];
await persistRadarDrafts(
  [
    {
      tweetId: SRC,
      handle: 'smoke_target',
      author: 'Smoke Target',
      text: 'the tweet we are replying to',
      url: `https://x.com/smoke_target/status/${SRC}`,
      band: 'hot',
      signals: { views: 1800, replies: 9, ageMin: 18, vpm: 100, bait: false },
    },
  ],
  [{ tweetId: SRC, text: PRIMARY_TEXT, angle: PRIMARY_ANGLE, variants: VARIANTS }],
  'grok-smoke',
);

// 2. GET ?tweetId= returns the tweet's non-expired rows with their 3 variants.
let r = await app.request(`/x/radar/drafts?tweetId=${SRC}`);
if (r.status !== 200) fail(`GET ?tweetId= returned ${r.status}`);
const list = (await r.json()) as {
  count: number;
  drafts: Array<{ tweetId: string; variants: unknown[] | null }>;
};
const seeded = list.drafts.find((d) => d.tweetId === SRC);
if (!seeded) fail('seeded radar draft not returned by ?tweetId=');
if (!Array.isArray(seeded.variants) || seeded.variants.length !== 3) {
  fail('3 variants not persisted on the radar draft');
}
ok('radar draft seeded with 3 variants; GET ?tweetId= returns it');

// 3. Confirm → new reply_drafts row (source='radar', status='copied', variants,
//    contextSnapshot rebuilt from the captured snippet/signals/band).
r = await app.request(`/x/radar/drafts/${SRC}/confirm`, { method: 'POST' });
if (r.status !== 201) fail(`first confirm returned ${r.status} (want 201)`);
const draft = (await r.json()) as {
  id: string;
  source: string | null;
  status: string;
  replyText: string;
  variants: Array<{ text: string; angle: string }> | null;
  contextSnapshot: {
    tweetId?: string;
    metrics?: { views: number; replies: number };
    signals?: { band: string | null } | undefined;
  };
};
if (draft.source !== 'radar') fail(`confirmed draft source=${draft.source} (want 'radar')`);
if (draft.status !== 'copied') fail(`confirmed draft status=${draft.status} (want 'copied')`);
if (!draft.variants || draft.variants.length !== 3) fail('confirmed draft lost its 3 variants');
if (draft.replyText !== PRIMARY_TEXT) fail('confirmed replyText is not the primary variant');
if (draft.contextSnapshot?.tweetId !== SRC) fail('contextSnapshot.tweetId mismatch');
if (draft.contextSnapshot?.metrics?.views !== 1800)
  fail('contextSnapshot.metrics.views not rebuilt');
// band='hot' stays hot in the snapshot (only a 'manual' pin is coerced to null,
// so it never lands in the Playbook's hot/warm band cells — §7.19 / RU.8).
if (draft.contextSnapshot?.signals?.band !== 'hot')
  fail('contextSnapshot.signals.band not preserved');
ok(`confirm 201: reply_drafts ${draft.id.slice(0, 8)}… source=radar status=copied variants=3`);

// 4. Confirm again → idempotent (200, same reply_drafts id, no second row).
r = await app.request(`/x/radar/drafts/${SRC}/confirm`, { method: 'POST' });
if (r.status !== 200) fail(`second confirm returned ${r.status} (want 200 idempotent)`);
const again = (await r.json()) as { id: string };
if (again.id !== draft.id) fail('idempotent confirm returned a different reply_drafts id');
ok('confirm idempotent: 200, same reply_drafts row');

// 5. PATCH copied→posted with an edited variant + our reply's own postedTweetId
//    (paste-time semantics — same as Reply Master's Done).
const EDITED = 'smoke debate prompt — lightly edited before posting';
r = await app.request(`/x/replies/${draft.id}`, {
  method: 'PATCH',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ status: 'posted', postedTweetId: POSTED, replyTextEdited: EDITED }),
});
if (r.status !== 200) fail(`PATCH posted returned ${r.status}: ${await r.text()}`);
const posted = (await r.json()) as {
  status: string;
  postedTweetId: string | null;
  replyTextEdited: string | null;
};
if (posted.status !== 'posted') fail('draft did not flip to posted');
if (posted.postedTweetId !== POSTED) fail('postedTweetId not stamped');
if (posted.replyTextEdited !== EDITED) fail('replyTextEdited not stored');
ok('PATCH copied→posted: postedTweetId stamped, edited text stored');

// 6. Origin classification (RU.9). loadOriginRows builds a
//    postedTweetId → reply_drafts.source map over posted+postedTweetId rows;
//    classifyReplyOrigin reads it. Rebuild the map the same way and assert the
//    posted reply attributes to 'radar' by SOURCE — with an empty text-match
//    fallback map, so a pass proves source beats the heuristic (the edited text
//    matches no variant).
const originRows = await db
  .select({ postedTweetId: replyDrafts.postedTweetId, source: replyDrafts.source })
  .from(replyDrafts)
  .where(and(eq(replyDrafts.status, 'posted'), isNotNull(replyDrafts.postedTweetId)));
const sourceMap = new Map<string, string | null>();
for (const d of originRows) if (d.postedTweetId) sourceMap.set(d.postedTweetId, d.source ?? null);
if (sourceMap.get(POSTED) !== 'radar') fail('source map did not record radar for our posted reply');
const origin = classifyReplyOrigin(
  { tweetId: POSTED, inReplyToTweetId: SRC, text: EDITED },
  sourceMap,
  new Map(),
  new Set(), // no canned uses either — the source map is the only evidence
);
if (origin !== 'radar') fail(`classifyReplyOrigin returned ${origin} (want 'radar')`);
ok('classifyReplyOrigin: posted radar reply attributes to radar by source (RU.9)');

// 7. Cleanup.
await cleanup();
ok('cleanup');

if (LIVE) {
  if (!llmConfigured()) {
    fail('--live needs an LLM provider (set XAI_API_KEY or OPENROUTER_API_KEY)');
  }
  console.log('--live: one 2-tweet generate-batch Grok call (~$0.01)…');
  const lr = await app.request('/x/replies/generate-batch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      tweets: [
        {
          tweetId: L1,
          handle: 'smoke_live_a',
          author: 'Smoke Live A',
          text: 'shipping beats planning — most of the time',
          url: `https://x.com/smoke_live_a/status/${L1}`,
        },
        {
          tweetId: L2,
          handle: 'smoke_live_b',
          author: 'Smoke Live B',
          text: 'AI will not replace developers who use AI',
          url: `https://x.com/smoke_live_b/status/${L2}`,
        },
      ],
    }),
  });
  if (lr.status !== 200) fail(`generate-batch returned ${lr.status}: ${await lr.text()}`);
  const batch = (await lr.json()) as {
    replies: Array<{ tweetId: string; variants?: unknown[] }>;
    count: number;
    costUsd: number;
    model: string;
  };
  for (const id of LIVE_IDS) {
    const rep = batch.replies.find((x) => x.tweetId === id);
    if (!rep) fail(`generate-batch missing a reply for ${id}`);
    if (!Array.isArray(rep.variants) || rep.variants.length !== 3) {
      fail(`generate-batch reply for ${id} lacks 3 variants (got ${rep.variants?.length ?? 0})`);
    }
  }
  const persisted = await db
    .select()
    .from(radarDrafts)
    .where(inArray(radarDrafts.tweetId, LIVE_IDS));
  if (persisted.length !== 2)
    fail(`generate-batch persisted ${persisted.length} radar_drafts (want 2)`);
  ok(
    `generate-batch: 3 variants/tweet, radar_drafts persisted, cost $${batch.costUsd} model=${batch.model}`,
  );
  await cleanup();
  ok('live cleanup');
}

console.log('SMOKE PASS');
process.exit(0);
