// One-shot smoke for the LLM Judge lane (JD.1–JD.7, plan
// `plans/2026-07-22-llm-judge.md`). Mounts the judge + playbook routers
// in-process (no port, no workers, no X call) against the real DB and drives
// the three layers the lane ships:
//
//   (a) `POST /x/judge`'s refuse-before-spend ladder (JD.4) — every bad body
//       refused by its own code, and then a VALID body reaching
//       **503 `llm_not_configured`** with both provider keys force-unset. That
//       503 is the load-bearing assertion of the whole file (the GT.9 rule): it
//       is the only status that says everything before the money passed, and it
//       is unspendable by construction rather than by remembering not to pass a
//       flag.
//   (b) `POST /x/judge/apply`'s guards (JD.5) — 404 `judgment_not_found`, the
//       409 pair, and the QUALIFIER that is the entire reset-on-edit reading: a
//       double space is NOT an edit, so the same request lands on
//       `nothing_to_apply` and never on `stale_verdict`. A count of refusals
//       would have said nothing; which refusal fires is the feature.
//   (c) the Playbook's `judgeEffectiveness` cell (JD.7) through
//       `GET /x/playbook?minN=` — the read-time text-hash join, newest verdict
//       per hash, the `surface='post'` filter, the partition invariants, and
//       the gate moving in both directions.
//
// **$0 by default and it cannot spend** — every judge/apply step above sits on
// the pre-spend ladder or behind force-unset keys. `--live` adds **exactly one**
// real `POST /x/judge` (~$0.003) and is the only way to verify the things a
// keyless run structurally cannot: that `JUDGE_MAX_OUTPUT_TOKENS` is sized big
// enough for the provider to close the JSON, that all thirteen dimensions come
// back, and that the persisted row's `text_hash` is the one JD.7's join probes.
//
// Real-DB safety is namespace-then-delete (§D98c): every tweet id is
// 890-prefixed (no real snowflake starts there), every seeded `posts_published`
// row is written `retired: true` (NT.7 — an un-retired row is a candidate for
// the daily *billed* metrics pass) and dated 400 days back (the JD.1 fixture
// rule — clear of the brief/digest/monitor windows), and judgments are deleted
// by the **hash of their own fixture text**, which is deterministic across runs
// and can never reach a real draft. Nothing mounted here is a read-that-writes,
// so unlike `smoke-guardrails.ts` there is no closing repair to pay — the
// closing re-read is a cleanup proof.
//
// Run: bun run scripts/smoke-judge.ts   (add --live for the one paid call)

import { desc, eq, inArray } from 'drizzle-orm';
import { Hono } from 'hono';
import { db } from '../src/db/client.ts';
import {
  JUDGE_DIMENSIONS,
  JUDGE_VERDICT_ORDER,
  type JudgeAnnotation,
  type JudgeScores,
  type JudgeVerdictLabel,
  deriveApproved,
  deriveVerdictBand,
} from '../src/shared/judge.ts';
import { draftJudgments, metricsSnapshots, postsPublished } from '../src/x/db/schema.ts';
import { MAX_JUDGE_TEXT, judgeTextHash } from '../src/x/judge/prompt.ts';
import type { JudgeEffectiveness } from '../src/x/playbook.ts';
import { judgeRouter } from '../src/x/routes/judge.ts';
import { playbook } from '../src/x/routes/playbook.ts';

const LIVE = process.argv.includes('--live');
const DAY = 86_400_000;

// 890-prefixed: no real snowflake starts there.
const P_NOW = '890000000000000001';
const P_SLIGHT = '890000000000000002';
const P_DNP = '890000000000000003';
const P_UNJUDGED = '890000000000000004';
const P_REPLY_SURFACE = '890000000000000005';
const TWEET_IDS = [P_NOW, P_SLIGHT, P_DNP, P_UNJUDGED, P_REPLY_SURFACE];
const MEASURED_IDS = [P_NOW, P_SLIGHT, P_DNP, P_UNJUDGED];

// The published text of each fixture. P_SLIGHT's carries a DOUBLE SPACE that its
// stored judgment does not: if both were spelled the same way the join would
// pass on identity and prove nothing about `normalizeJudgeText` (JD.7).
const TEXT_NOW = 'jd8 smoke: the fixture whose second verdict is the one that counts.';
const TEXT_SLIGHT_PUBLISHED = 'jd8 smoke: this  one shipped with a stray double space.';
const TEXT_SLIGHT_JUDGED = 'jd8 smoke: this one shipped with a stray double space.';
const TEXT_DNP = 'jd8 smoke: the fixture the judge told me not to post.';
const TEXT_UNJUDGED = 'jd8 smoke: nobody ever judged this one.';
const TEXT_REPLY_SURFACE = 'jd8 smoke: judged as a reply, published as an original.';

// Apply-path fixtures. Deliberately never published, so they cannot disturb (c).
const TEXT_APPLYABLE = 'jd8 smoke: a draft with one anchored fix waiting on it.';
const TEXT_NOTHING_TO_APPLY = 'jd8 smoke: a draft the judge had nothing to say about.';
const TEXT_LIVE =
  'jd8 smoke: shipping the boring version on Tuesday beat shipping the clever one never.';

// Every judgment this script can create, keyed by the one thing that is stable
// across runs — the hash of its own text. `--live` judges TEXT_LIVE, so its row
// is covered by the same list and needs no id bookkeeping.
const FIXTURE_HASHES = [
  TEXT_NOW,
  TEXT_SLIGHT_JUDGED,
  TEXT_DNP,
  TEXT_REPLY_SURFACE,
  TEXT_APPLYABLE,
  TEXT_NOTHING_TO_APPLY,
  TEXT_LIVE,
].map((t) => judgeTextHash(t));

const app = new Hono();
app.route('/x', judgeRouter);
app.route('/x', playbook);

function cleanup(): void {
  db.delete(metricsSnapshots).where(inArray(metricsSnapshots.tweetId, TWEET_IDS)).run();
  db.delete(postsPublished).where(inArray(postsPublished.tweetId, TWEET_IDS)).run();
  db.delete(draftJudgments).where(inArray(draftJudgments.textHash, FIXTURE_HASHES)).run();
}

function fail(msg: string): never {
  console.error(`FAIL: ${msg}`);
  cleanup();
  process.exit(1);
}
function ok(msg: string): void {
  console.log(`ok: ${msg}`);
}

// Start clean in case an earlier run died mid-way.
cleanup();

// ------------------------------------------------------------------- helpers

async function post<T>(
  path: string,
  body: unknown,
): Promise<{ status: number; body: T & { error?: string } }> {
  const res = await app.request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as T & { error?: string } };
}

/** The GT.9 recipe: force-unset BOTH provider keys so a request that clears
 *  every guard lands on the LLM layer's own refusal instead of on a network
 *  call. biome `noDelete` — unset is `''`, never `delete process.env.X`. */
async function keyless<T>(fn: () => Promise<T>): Promise<T> {
  const xai = process.env.XAI_API_KEY;
  const openrouter = process.env.OPENROUTER_API_KEY;
  process.env.XAI_API_KEY = '';
  process.env.OPENROUTER_API_KEY = '';
  try {
    return await fn();
  } finally {
    process.env.XAI_API_KEY = xai ?? '';
    process.env.OPENROUTER_API_KEY = openrouter ?? '';
  }
}

async function expectRefusal(
  label: string,
  path: string,
  body: unknown,
  status: number,
  code: string,
): Promise<void> {
  const res = await post(path, body);
  if (res.status !== status || res.body.error !== code) {
    fail(`${label}: expected ${status} ${code}, got ${res.status} ${res.body.error}`);
  }
}

/** An overall that lands in each band, asserted against `deriveVerdictBand`
 *  rather than assumed — a fixture whose own premise drifts silently re-labels
 *  every assertion below it (the SC.9 rule). */
const OVERALL_FOR: Record<JudgeVerdictLabel, number> = {
  post_now: 92,
  slight_rework: 76,
  major_rework: 55,
  do_not_post: 20,
};
for (const band of JUDGE_VERDICT_ORDER) {
  const overall = OVERALL_FOR[band];
  if (deriveVerdictBand(overall) !== band) {
    fail(`fixture premise broken: overall ${overall} is no longer ${band}`);
  }
}

function scoresFor(overall: number): JudgeScores {
  return {
    overall,
    replies: 60,
    profileClicks: 55,
    impressions: 50,
    bookmarkValue: 45,
    dwellProxy: 50,
    voiceMatch: 70,
    negativeRisk: 10,
    answerEffort: 40,
    strangerAnswerability: 45,
    statusDependency: 20,
    replyVsQuoteOrientation: 60,
    audienceMatch: 65,
  };
}

const judgmentIds: string[] = [];

async function seedJudgment(opts: {
  text: string;
  verdict: JudgeVerdictLabel;
  /** `judged_at`'s column default resolves to the same millisecond for a batch,
   *  so "newest per hash wins" is a coin flip unless the fixture stamps it
   *  (JD.7). Every seed here is explicit. */
  judgedAt: Date;
  surface?: string;
  annotations?: JudgeAnnotation[];
  improvements?: string[];
}): Promise<string> {
  const overall = OVERALL_FOR[opts.verdict];
  const inserted = await db
    .insert(draftJudgments)
    .values({
      textHash: judgeTextHash(opts.text),
      text: opts.text,
      surface: opts.surface ?? 'post',
      verdict: opts.verdict,
      overall,
      headline: 'jd8 smoke fixture',
      confidence: 'medium',
      scores: scoresFor(overall),
      annotations: opts.annotations ?? [],
      strengths: [],
      improvements: opts.improvements ?? [],
      model: 'jd8-smoke-model',
      provider: 'grok',
      costUsd: 0,
      judgedAt: opts.judgedAt,
    })
    .returning({ id: draftJudgments.id });
  const id = inserted[0]?.id;
  if (id === undefined) fail('seeding a judgment returned no id');
  judgmentIds.push(id);
  return id;
}

async function judgeCellAt(minN: number): Promise<JudgeEffectiveness> {
  const res = await app.request(`/x/playbook?minN=${minN}`);
  if (res.status !== 200) fail(`GET /x/playbook?minN=${minN} returned ${res.status}`);
  const body = (await res.json()) as { judgeEffectiveness?: JudgeEffectiveness };
  const cell = body.judgeEffectiveness;
  if (!cell) fail('GET /x/playbook returned no judgeEffectiveness block');
  return cell;
}

const postedIn = (cell: JudgeEffectiveness, band: JudgeVerdictLabel): number => {
  const found = cell.cells.find((c) => c.band === band);
  if (!found) fail(`the playbook cell has no \`${band}\` bucket`);
  return found.posted;
};

// ------------------------------------------------------- baselines, read FIRST

// `draft_judgments` lost its exact-count freedom the moment the Playbook joined
// it (JD.4/JD.7): everything below is a DELTA against numbers read before the
// first seed, which is also what survives a fresh install where they are all 0.
const base = await judgeCellAt(1);
console.log(
  `baseline: ${base.totalPosted} own originals, ${base.totalMeasured} measured, ${base.unjudged.posted} unjudged`,
);

// --------------------------------------- (a) POST /x/judge refuses before spend

await expectRefusal('non-JSON body', '/x/judge', 'not json at all', 400, 'invalid_body');
await expectRefusal('array body', '/x/judge', [], 400, 'invalid_body');
await expectRefusal('missing text', '/x/judge', {}, 400, 'invalid_text');
await expectRefusal('blank text', '/x/judge', { text: '   ' }, 400, 'invalid_text');
await expectRefusal(
  'over-long text',
  '/x/judge',
  { text: 'a'.repeat(MAX_JUDGE_TEXT + 1) },
  400,
  'invalid_text',
);
// Decision 2: the COLUMN is wider than the validator on purpose, so a future
// `'reply'` needs no migration — but nothing may write one in v1.
await expectRefusal(
  'reply surface',
  '/x/judge',
  { text: TEXT_APPLYABLE, surface: 'reply' },
  400,
  'invalid_surface',
);
await expectRefusal(
  'blank model',
  '/x/judge',
  { text: TEXT_APPLYABLE, model: '  ' },
  400,
  'invalid_model',
);
await expectRefusal(
  'unknown provider',
  '/x/judge',
  { text: TEXT_APPLYABLE, provider: 'anthropic' },
  400,
  'invalid_provider',
);
ok('/x/judge: all seven pre-spend refusals fire with their own code (nothing reached askLLM)');

// The one that matters: a body with nothing wrong with it, refused by the LLM
// layer itself. Reaching a 503 IS the proof every guard above it passed.
const gated = await keyless(() => post('/x/judge', { text: TEXT_APPLYABLE }));
if (gated.status !== 503 || gated.body.error !== 'llm_not_configured') {
  fail(
    `a valid judge body returned ${gated.status} ${gated.body.error}, want 503 llm_not_configured`,
  );
}
ok('/x/judge: a VALID body reaches 503 llm_not_configured — everything before the money passed');

// ------------------------------------------- (b) POST /x/judge/apply guards

await expectRefusal(
  'missing judgmentId',
  '/x/judge/apply',
  { text: 'x' },
  400,
  'invalid_judgment_id',
);
await expectRefusal(
  'missing text',
  '/x/judge/apply',
  { judgmentId: 'anything' },
  400,
  'invalid_text',
);
await expectRefusal(
  'unknown judgment',
  '/x/judge/apply',
  { judgmentId: 'jd8-no-such-judgment', text: TEXT_APPLYABLE },
  404,
  'judgment_not_found',
);

const applyableId = await seedJudgment({
  text: TEXT_APPLYABLE,
  verdict: 'slight_rework',
  judgedAt: new Date(Date.now() - 60_000),
  annotations: [
    { quote: 'one anchored fix', severity: 'warning', recommendation: 'name the thing it fixes' },
  ],
});
const nothingId = await seedJudgment({
  text: TEXT_NOTHING_TO_APPLY,
  verdict: 'post_now',
  judgedAt: new Date(Date.now() - 60_000),
});

await expectRefusal(
  'edited draft',
  '/x/judge/apply',
  { judgmentId: applyableId, text: `${TEXT_APPLYABLE} and then I changed a word.` },
  409,
  'stale_verdict',
);
await expectRefusal(
  'nothing flagged',
  '/x/judge/apply',
  { judgmentId: nothingId, text: TEXT_NOTHING_TO_APPLY },
  409,
  'nothing_to_apply',
);
// The QUALIFIER, and the reason this pair is worth two assertions instead of
// one: the same request with a whitespace-only difference must get PAST the
// hash check and land on the *next* refusal. A `stale_verdict` here would mean
// reflowing a draft silently costs you the verdict you paid for.
await expectRefusal(
  'whitespace-only edit',
  '/x/judge/apply',
  { judgmentId: nothingId, text: TEXT_NOTHING_TO_APPLY.replace(' a draft', '  a draft') },
  409,
  'nothing_to_apply',
);
ok(
  '/x/judge/apply: 404 + stale_verdict + nothing_to_apply, and a double space is not an edit (it still reads nothing_to_apply)',
);

// The only paid path in the file, proven unreached. `judge_invalid` from the
// plan's error table was never shipped (D165) — these are the codes that exist.
const applyGated = await keyless(() =>
  post('/x/judge/apply', { judgmentId: applyableId, text: TEXT_APPLYABLE }),
);
if (applyGated.status !== 503 || applyGated.body.error !== 'llm_not_configured') {
  fail(
    `an applyable judgment returned ${applyGated.status} ${applyGated.body.error}, want 503 llm_not_configured`,
  );
}
ok(
  '/x/judge/apply: a valid, applyable request reaches 503 llm_not_configured (no rewrite call made)',
);

// ------------------------------------- (c) the Playbook cell (JD.7) end to end

const postedAt = new Date(Date.now() - 400 * DAY);
const original = (tweetId: string, text: string) => ({
  tweetId,
  text,
  postedAt,
  isReply: false,
  source: 'smoke',
  // NT.7: an un-retired row is a candidate for the daily BILLED metrics pass.
  retired: true,
});

await db
  .insert(postsPublished)
  .values([
    original(P_NOW, TEXT_NOW),
    original(P_SLIGHT, TEXT_SLIGHT_PUBLISHED),
    original(P_DNP, TEXT_DNP),
    original(P_UNJUDGED, TEXT_UNJUDGED),
    original(P_REPLY_SURFACE, TEXT_REPLY_SURFACE),
  ]);
// Four of the five are measured, so `posted` and `n` cannot be read as the same
// number by accident. No `ageAtSnapshotMin` — these rows stay out of SC.8's
// reach population, whose smoke owns that delta.
await db.insert(metricsSnapshots).values(
  MEASURED_IDS.map((tweetId) => ({
    tweetId,
    publicMetrics: { impression_count: 400, like_count: 3, reply_count: 1 },
    nonPublicMetrics: { user_profile_clicks: 5 },
  })),
);

// P_NOW is judged TWICE on the same text: the older verdict is the one that must
// lose. Stamped explicitly — the column default would resolve both to the same
// millisecond and the assertion would be a coin flip (JD.7).
await seedJudgment({
  text: TEXT_NOW,
  verdict: 'do_not_post',
  judgedAt: new Date(Date.now() - 200 * 60_000),
});
await seedJudgment({
  text: TEXT_NOW,
  verdict: 'post_now',
  judgedAt: new Date(Date.now() - 10 * 60_000),
});
// Judged WITHOUT the double space the published row carries.
await seedJudgment({
  text: TEXT_SLIGHT_JUDGED,
  verdict: 'slight_rework',
  judgedAt: new Date(Date.now() - 60_000),
});
await seedJudgment({
  text: TEXT_DNP,
  verdict: 'do_not_post',
  judgedAt: new Date(Date.now() - 60_000),
});
// A verdict that DOES hash to a published original but was given on the reply
// surface. Asserting "it did not match" and "it was filtered out" are different
// claims, and only the second one is the code — so the row's existence and its
// hash are asserted first.
const replySurfaceId = await seedJudgment({
  text: TEXT_REPLY_SURFACE,
  verdict: 'post_now',
  judgedAt: new Date(Date.now() - 60_000),
  surface: 'reply',
});
const replyRow = await db
  .select({ textHash: draftJudgments.textHash, surface: draftJudgments.surface })
  .from(draftJudgments)
  .where(eq(draftJudgments.id, replySurfaceId))
  .get();
if (
  !replyRow ||
  replyRow.surface !== 'reply' ||
  replyRow.textHash !== judgeTextHash(TEXT_REPLY_SURFACE)
) {
  fail('the reply-surface fixture is not what it claims to be — the filter test would be vacuous');
}
console.log(
  `seeded: 5 own originals (all retired, 400 d back), 4 snapshots, ${judgmentIds.length} judgments`,
);

const open = await judgeCellAt(1);

// The bands render worst→best off ONE exported list — a route that re-orders or
// drops one is the twin `JUDGE_VERDICT_ORDER` exists to prevent (§7 rule 4c).
const bands = open.cells.map((c) => c.band);
if (bands.join(',') !== JUDGE_VERDICT_ORDER.join(',')) {
  fail(`band order is ${bands.join(',')}, want ${JUDGE_VERDICT_ORDER.join(',')}`);
}

if (open.totalPosted - base.totalPosted !== 5) {
  fail(`totalPosted moved by ${open.totalPosted - base.totalPosted}, want 5`);
}
if (open.totalMeasured - base.totalMeasured !== 4) {
  fail(`totalMeasured moved by ${open.totalMeasured - base.totalMeasured}, want 4`);
}
for (const [band, want] of [
  ['post_now', 1],
  ['slight_rework', 1],
  ['do_not_post', 1],
  ['major_rework', 0],
] as Array<[JudgeVerdictLabel, number]>) {
  const moved = postedIn(open, band) - postedIn(base, band);
  if (moved !== want) fail(`${band} moved by ${moved}, want ${want}`);
}
ok(
  'playbook: the newest verdict per hash wins (an older do_not_post on the same text does not claim it)',
);
ok(
  'playbook: a post published with a double space still lands in its judged band (whitespace is not an edit)',
);

if (open.unjudged.posted - base.unjudged.posted !== 2) {
  fail(`unjudged moved by ${open.unjudged.posted - base.unjudged.posted}, want 2`);
}
ok(
  'playbook: the never-judged post AND the reply-surface one both read unjudged (surface=post filters the join)',
);

// `deriveApproved`: post_now + slight_rework are approved, do_not_post is not.
if (open.approved.posted - base.approved.posted !== 2) {
  fail(`approved moved by ${open.approved.posted - base.approved.posted}, want 2`);
}
if (open.rejected.posted - base.rejected.posted !== 1) {
  fail(`rejected moved by ${open.rejected.posted - base.rejected.posted}, want 1`);
}

// Invariants — true on any corpus, including an empty one.
const sum = (pick: (c: { posted: number; n: number }) => number) =>
  open.cells.reduce((s, c) => s + pick(c), 0);
if (sum((c) => c.posted) + open.unjudged.posted !== open.totalPosted) {
  fail('the four bands plus unjudged do not partition the posted originals');
}
if (sum((c) => c.n) + open.unjudged.n !== open.totalMeasured) {
  fail('the four bands plus unjudged do not partition the measured originals');
}
if (open.approved.posted + open.rejected.posted !== sum((c) => c.posted)) {
  fail('approved + rejected do not partition the JUDGED originals');
}
if (open.approved.n + open.rejected.n !== sum((c) => c.n)) {
  fail('approved + rejected do not partition the judged MEASURED originals');
}
ok(
  `playbook: bands+unjudged and approved+rejected each partition the same ${open.totalPosted} originals (${open.totalMeasured} measured)`,
);

// The gate is a PARAMETER, proven by moving it to a bar no account can ever
// reach — so a growing corpus never reddens this (the UI.17 rule).
const shut = await judgeCellAt(1000);
const stillOpen = [...shut.cells, shut.unjudged, shut.approved, shut.rejected].filter(
  (c) => c.sufficient,
);
if (stillOpen.length !== 0) fail(`${stillOpen.length} judge cells claim sufficiency at minN=1000`);
if (
  shut.spread !== null ||
  shut.profileVisitsSpread !== null ||
  shut.spreadBands !== null ||
  shut.approvedSpread !== null ||
  shut.approvedProfileVisitsSpread !== null
) {
  fail('a spread survived a gate nothing can clear');
}
ok('playbook: at minN=1000 every judge cell goes insufficient and all five spreads go null');

const badGate = await app.request('/x/playbook?minN=0');
if (badGate.status !== 400) fail(`minN=0 expected 400, got ${badGate.status}`);
ok('playbook: minN=0 is refused');

// ------------------------------------------------- (d) --live: ONE paid call

if (LIVE) {
  console.log('--live: making ONE real judge call (~$0.003)…');
  const live = await post<{
    id: string | null;
    textHash: string;
    verdict: JudgeVerdictLabel;
    approved: boolean;
    scores: JudgeScores;
    annotations: JudgeAnnotation[];
    model: string;
    provider: string;
    costUsd: number;
  }>('/x/judge', { text: TEXT_LIVE });
  if (live.status !== 200) fail(`live judge returned ${live.status} ${live.body.error}`);

  // The claim a keyless run cannot make: the provider closed the JSON inside
  // JUDGE_MAX_OUTPUT_TOKENS and every dimension survived the parser.
  const missing = JUDGE_DIMENSIONS.filter((d) => live.body.scores[d] === undefined);
  if (missing.length > 0) fail(`live verdict is missing dimensions: ${missing.join(',')}`);
  for (const d of JUDGE_DIMENSIONS) {
    const v = live.body.scores[d];
    if (v === null) continue; // audienceMatch is legitimately null with no niche
    if (typeof v !== 'number' || v < 0 || v > 100) fail(`live ${d} is out of range: ${v}`);
  }
  if (live.body.annotations.length > 12) {
    fail(`live verdict carried ${live.body.annotations.length} annotations, cap is 12`);
  }
  // Decision 3: the label and the number can never disagree, because nothing
  // downstream of `parseVerdict` derives a second one.
  if (live.body.verdict !== deriveVerdictBand(live.body.scores.overall)) {
    fail(`live band ${live.body.verdict} does not match overall ${live.body.scores.overall}`);
  }
  if (live.body.approved !== deriveApproved(live.body.verdict)) {
    fail('live approved does not match its own band');
  }
  if (live.body.textHash !== judgeTextHash(TEXT_LIVE)) fail('live textHash is not the draft hash');

  const stored = await db
    .select()
    .from(draftJudgments)
    .where(eq(draftJudgments.textHash, judgeTextHash(TEXT_LIVE)))
    .orderBy(desc(draftJudgments.judgedAt))
    .get();
  if (!stored) fail('the live verdict was not persisted');
  if (stored.id !== live.body.id) fail('the returned id is not the persisted row');
  if (stored.surface !== 'post') fail(`persisted surface is ${stored.surface}`);
  if (stored.verdict !== live.body.verdict || stored.overall !== live.body.scores.overall) {
    fail('the persisted row disagrees with the response about the verdict');
  }
  if (stored.model.trim() === '' || stored.provider.trim() === '') {
    fail('the persisted row did not stamp its grader (decision 11)');
  }
  ok(
    `live: ${live.body.verdict} at overall ${live.body.scores.overall} · ${live.body.annotations.length} fixes · graded by ${live.body.model} (${live.body.provider}) · $${live.body.costUsd.toFixed(5)} · row persisted`,
  );
} else {
  console.log('skipped: --live (one real judge call, ~$0.003)');
}

// ------------------------------------------------------------------ cleanup

cleanup();
const leftPosts = await db
  .select({ id: postsPublished.tweetId })
  .from(postsPublished)
  .where(inArray(postsPublished.tweetId, TWEET_IDS));
const leftSnaps = await db
  .select({ id: metricsSnapshots.id })
  .from(metricsSnapshots)
  .where(inArray(metricsSnapshots.tweetId, TWEET_IDS));
const leftJudgments = await db
  .select({ id: draftJudgments.id })
  .from(draftJudgments)
  .where(inArray(draftJudgments.textHash, FIXTURE_HASHES));
if (leftPosts.length + leftSnaps.length + leftJudgments.length !== 0) {
  fail(
    `cleanup left rows: posts=${leftPosts.length} snapshots=${leftSnaps.length} judgments=${leftJudgments.length}`,
  );
}
ok(`cleanup: 0 rows left (${judgmentIds.length} judgments + 5 posts + 4 snapshots removed)`);

// Every step above read a shared table, so the baseline coming back is asserted
// rather than assumed — here it is a cleanup proof, not a repair.
const closing = await judgeCellAt(1);
if (
  closing.totalPosted !== base.totalPosted ||
  closing.totalMeasured !== base.totalMeasured ||
  closing.unjudged.posted !== base.unjudged.posted
) {
  fail(
    `the judge cell is ${closing.totalPosted}/${closing.totalMeasured}, want the baseline ${base.totalPosted}/${base.totalMeasured}`,
  );
}
ok('closing re-read: judgeEffectiveness is back to its baseline');

console.log('SMOKE PASS');
process.exit(0);
