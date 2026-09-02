// One-shot smoke for the X ranker port (XR.1–XR.7) — the published For You
// weights as a second, measurable signal. Mounts `playbook` + the voice router
// in-process (no port, no workers) against the REAL DB and drives the whole
// wave at **$0**.
//
// **There is no `--live` flag, and the absence is the finding** (D171c, the
// `smoke-outliers.ts` / `smoke-own-harvest.ts` answer). Nothing in this lane
// can reach `xFetch` or `askLLM`: `xRanker.ts` and `xRankerSignals.ts` are
// dependency-free arithmetic, the Playbook cell is SQL over rows the DOM
// harvest already stored, and the swipe-file save scores what the page sent.
// A `--live` flag here could only mean someone added a billed read back to get
// a count the DOM did not give us (CLAUDE.md invariant #8), which is a decision
// made out loud, not a flag.
//
//   1. **All 26 published weights + their `param.rs` names**, against a table
//      hardcoded here. **What this claim is:** a SECOND copy of XR.1's
//      transcription, so an edit to `X_HEADS` reddens a script as well as a
//      unit test. **What it is not:** a second reading of X's source — the
//      oracle for that is `xai-org/x-algorithm` @ `7ba77684` and re-verifying
//      against a newer commit is its own task. Plus the arithmetic that has bit
//      before: `positive_sum`'s exclusions, both `offsetScore` branches, and
//      the two `diversityMultiplier` values the plan pins by hand.
//   2. Three fixture drafts scored through **C** with their top contributions
//      and the modifiers that moved them, plus the band/score identity.
//   3. `GET /x/playbook` → the real `rankerScoreEffectiveness` quartile table
//      and **one verdict line**. On a box whose own profile has never been
//      harvested this reads `totalPosted: 0`, and the script says so as an
//      answer rather than as a failure (D238) — the population is own harvested
//      originals (`harvest_rows mode='posts'`, my own handle), and widening it
//      to the frozen `metrics_snapshots` is forbidden by plan Decision 6.
//   4. **The same cell over a corpus that DOES exist** — nine namespaced
//      `harvest_rows` under a fake handle, read through the REAL loader
//      (`latestOwnPostRows`) into the REAL builder. This is the step that tells
//      an instrument reading zero apart from a broken one, which is the whole
//      reason step 3 is allowed to print zeros.
//   5. The swipe-file identity XR.7 shipped and every later reader assumes:
//      `voice_tweets.ranker_e === scoreMeasured(the four columns beside it)`,
//      across a first save, a re-save carrying nothing, and a re-save carrying
//      new counts — because the five columns are ONE observation (D243). Read
//      BACK from the DB, never off the 201 (D184a: a green POST is not proof a
//      column exists — `scrapeSave` would have persisted a null silently).
//   6. The provenance stamps, printed on every run: `X_OBSERVED_RATES` and
//      `RANKER_BAND_CUTS` both say where their numbers came from, so a baseline
//      that ever ships un-recalibrated is visible without reading the module.
//
//   bun run scripts/smoke-x-ranker.ts     # $0, rerunnable
//
// Every fixture is namespaced (`xr8ranker` handle, `90090xx` tweet ids) and
// deleted from `fail()` as well as from the success path (D113d). The route
// read in step 3 runs BEFORE anything is seeded, so it answers over untouched
// production data.

import { eq, inArray } from 'drizzle-orm';
import { Hono } from 'hono';
import { db } from '../src/db/client.ts';
import {
  type XHeadName,
  X_HEADS,
  X_WEIGHT_SUMS,
  diversityMultiplier,
  offsetScore,
} from '../src/shared/xRanker.ts';
import {
  RANKER_BAND_CUTS,
  RANKER_BAND_CUTS_PROVENANCE,
  RANKER_BAND_CUTS_SAMPLE,
  X_OBSERVED_RATES,
  X_OBSERVED_RATES_PROVENANCE,
  X_OBSERVED_RATES_SAMPLE,
  rankerDraftBand,
  scoreDraftRanker,
  scoreMeasured,
} from '../src/shared/xRankerSignals.ts';
import {
  harvestRows,
  harvestRuns,
  people,
  personEvents,
  voiceAuthors,
  voiceTweets,
} from '../src/x/db/schema.ts';
import {
  type RankerScoreCell,
  type RankerScoreEffectiveness,
  buildRankerScoreEffectiveness,
} from '../src/x/playbook.ts';
import { latestOwnPostRows, playbook } from '../src/x/routes/playbook.ts';
import { createVoiceRouter } from '../src/x/routes/voice.ts';

const app = new Hono();
app.route('/x', playbook);
app.route('/x', createVoiceRouter());

// ≤15 chars or `normalizeHandle` drops the row and every assertion below goes
// vacuous (the Wave-3 fixture rule).
const HANDLE = 'xr8ranker';
const HARVEST_IDS = [
  '9009001',
  '9009002',
  '9009003',
  '9009004',
  '9009005',
  '9009006',
  '9009007',
  '9009008',
  '9009009',
];
const VOICE_ID = '9009101';
let runId: string | null = null;

// --------------------------------------------------------------- scaffolding

function cleanup(): void {
  try {
    db.delete(harvestRows).where(inArray(harvestRows.tweetId, HARVEST_IDS)).run();
    db.delete(harvestRuns).where(eq(harvestRuns.handle, HANDLE)).run();
    db.delete(voiceTweets).where(eq(voiceTweets.tweetId, VOICE_ID)).run();
    // The scrape fires the people-layer side hooks; a leaked `people` row is
    // exactly the fixture that breaks a different suite's count elsewhere.
    db.delete(personEvents).where(eq(personEvents.handle, HANDLE)).run();
    db.delete(people).where(eq(people.handle, HANDLE)).run();
    db.delete(voiceAuthors).where(eq(voiceAuthors.handle, HANDLE)).run();
  } catch (err) {
    console.error('cleanup failed:', err instanceof Error ? err.message : err);
  }
}

function fail(msg: string): never {
  console.error(`FAIL: ${msg}`);
  cleanup();
  process.exit(1);
}

function ok(msg: string): void {
  console.log(`  ok · ${msg}`);
}

/** `app.request` is typed `Response | Promise<Response>`, so this is async or
 *  root typecheck (which covers `scripts/`) rejects the return type (NT.7). */
async function send(
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await app.request(path, {
    method,
    ...(body === undefined
      ? {}
      : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
  });
  if (res.status === 204) return { status: 204, body: {} };
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

function near(a: number, b: number, eps = 1e-9): boolean {
  return Math.abs(a - b) <= eps;
}

cleanup();

// ============================================================================
// 1. the 26 published weights, their param names, and the arithmetic
// ============================================================================
console.log('1. xRanker.ts — the transcription and the arithmetic');

// Declaration order is production scoring order (`compute_weighted_parts`'s
// `terms` array), so this table is asserted in order as well as by name.
const EXPECTED: readonly [XHeadName, number, string][] = [
  ['favorite', 0.5, 'rust_home_mixer_favorite_weight'],
  ['reply', 5, 'rust_home_mixer_reply_weight'],
  ['retweet', 1, 'rust_home_mixer_retweet_weight'],
  ['photo_expand', 0.05, 'rust_home_mixer_photo_expand_weight'],
  ['video_open', 0.07, 'rust_home_mixer_video_open_weight'],
  ['click', 0.4, 'rust_home_mixer_click_weight'],
  ['open_link', 0.2, 'rust_home_mixer_open_link_weight'],
  ['profile_click', 0, 'rust_home_mixer_profile_click_weight'],
  ['vqv', 0, 'rust_home_mixer_vqv_weight'],
  ['share', 2, 'rust_home_mixer_share_weight'],
  ['share_via_dm', 5, 'rust_home_mixer_share_via_dm_weight'],
  ['share_via_copy_link', 20, 'rust_home_mixer_share_via_copy_link_weight'],
  ['dwell', 0.05, 'rust_home_mixer_dwell_weight'],
  ['quote', 5, 'rust_home_mixer_quote_weight'],
  ['quoted_click', 0.05, 'rust_home_mixer_quoted_click_weight'],
  ['quoted_vqv', 0, 'rust_home_mixer_quoted_vqv_weight'],
  ['cont_dwell_time', 0.004, 'rust_home_mixer_cont_dwell_time_weight'],
  ['cont_click_dwell_time', 0, 'rust_home_mixer_cont_click_dwell_time_weight'],
  [
    'cont_active_secs_5m_residual_norm',
    0,
    'rust_home_mixer_cont_active_secs_5m_residual_norm_weight',
  ],
  ['follow_author', 4, 'rust_home_mixer_follow_author_weight'],
  ['not_interested', -43.2, 'rust_home_mixer_not_interested_weight'],
  ['block_author', -31.2, 'rust_home_mixer_block_author_weight'],
  ['mute_author', -58.8, 'rust_home_mixer_mute_author_weight'],
  ['report', -234, 'rust_home_mixer_report_weight'],
  ['not_dwelled', -0.02, 'rust_home_mixer_not_dwelled_weight'],
  ['post_unexplored', 0.02, 'rust_home_mixer_post_unexplored_weight'],
];

{
  const live = Object.keys(X_HEADS) as XHeadName[];
  if (live.length !== EXPECTED.length)
    fail(`X_HEADS has ${live.length} heads, expected ${EXPECTED.length}`);
  EXPECTED.forEach(([name, weight, param], i) => {
    if (live[i] !== name) fail(`head ${i} is ${live[i]}, expected ${name} (scoring order moved)`);
    const head = X_HEADS[name];
    // The param STRING is asserted beside the value because 0.05 appears three
    // times and 0.0 five times — a value-only check passes with two heads
    // swapped.
    if (head.weight !== weight) fail(`${name}: weight ${head.weight}, expected ${weight}`);
    if (head.param !== param) fail(`${name}: param ${head.param}, expected ${param}`);
  });
  ok(`all ${EXPECTED.length} weights + param names match, in scoring order`);

  const observable = (Object.keys(X_HEADS) as XHeadName[]).filter((n) => X_HEADS[n].observable);
  if (observable.join(',') !== 'favorite,reply,retweet')
    fail(`observable heads are ${observable.join(',')}, expected favorite,reply,retweet`);
  ok('three observable heads — the rest are X-private and are absent, never zero');

  // `positive_sum` excludes the three `cont_*` heads and both bidirectional
  // boosts. It only shows on the negative branch, so getting it wrong is
  // invisible to a test that scores good posts.
  if (!near(X_WEIGHT_SUMS.positive, 43.34) || !near(X_WEIGHT_SUMS.negative, 367.22))
    fail(
      `X_WEIGHT_SUMS ${JSON.stringify(X_WEIGHT_SUMS)}, expected positive 43.34 / negative 367.22`,
    );
  if (!near(X_WEIGHT_SUMS.total, X_WEIGHT_SUMS.positive + X_WEIGHT_SUMS.negative))
    fail('X_WEIGHT_SUMS.total is not positive + negative');
  ok(
    `sums positive ${X_WEIGHT_SUMS.positive.toFixed(2)} / negative ${X_WEIGHT_SUMS.negative.toFixed(2)} — the cont_* heads excluded`,
  );

  if (offsetScore(0) !== 0.001) fail(`offsetScore(0) is ${offsetScore(0)}, expected 0.001`);
  if (offsetScore(0.4) !== 0.401) fail(`offsetScore(0.4) is ${offsetScore(0.4)}, expected 0.401`);
  if (offsetScore(-X_WEIGHT_SUMS.negative) !== 0)
    fail(
      `offsetScore(-negative_sum) is ${offsetScore(-X_WEIGHT_SUMS.negative)}, expected exactly 0`,
    );
  // The negative branch SQUASHES rather than clamps (D229): the deepest
  // negative lands on 0 and everything above it stays strictly under the
  // supremum, so negatives keep their order relative to each other.
  const sup = (X_WEIGHT_SUMS.negative / X_WEIGHT_SUMS.total) * 0.001;
  const tiny = offsetScore(-1e-9);
  if (!(tiny > 0 && tiny < sup))
    fail(`offsetScore(-1e-9) is ${tiny}, expected strictly inside (0, ${sup})`);
  if (!(sup < offsetScore(0)))
    fail('a net-negative post can reach the score of a zero-sum post — the squash is broken');
  ok(`negative branch squashes into [0, ${sup.toFixed(9)}), strictly below every positive post`);

  if (diversityMultiplier(1) !== 0.625 || diversityMultiplier(2) !== 0.4375)
    fail(
      `diversityMultiplier 1/2 are ${diversityMultiplier(1)}/${diversityMultiplier(2)}, expected 0.625/0.4375`,
    );
  ok('diversityMultiplier(1) = 0.625, (2) = 0.4375');
}

// ============================================================================
// 2. C — three fixture drafts through the estimator
// ============================================================================
console.log('\n2. xRankerSignals.ts — C over three drafts');

const DRAFTS: readonly [string, string][] = [
  [
    'concrete + story',
    'Shipped the publisher worker today: 41 smoke scripts, 0 billed reads. The whole metrics layer is a DOM scrape now, and it reads more accurately than the API pass it replaced.',
  ],
  [
    'hedged + canned closer',
    'Maybe this is just me but I think we should probably rethink all of it — thoughts?',
  ],
  ['bare link drop', 'New post up, check it out https://example.com/thing'],
];

for (const [label, text] of DRAFTS) {
  const r = scoreDraftRanker(text);
  if (!Number.isFinite(r.score) || r.score <= 0 || r.score >= 100)
    fail(`${label}: C is ${r.score}, expected strictly inside (0, 100)`);
  // The band is derived from the score, never carried separately — a surface
  // that renders one and colours by the other is the bug this catches.
  if (r.band !== rankerDraftBand(r.score))
    fail(`${label}: band ${r.band} disagrees with rankerDraftBand(${r.score})`);
  const top = r.contributions
    .slice(0, 3)
    .map((c) => `${c.head} ${c.contribution >= 0 ? '+' : ''}${c.contribution.toFixed(4)}`)
    .join(', ');
  const up = r.modifiers.filter((m) => m.direction === 'up').map((m) => m.label);
  const down = r.modifiers.filter((m) => m.direction === 'down').map((m) => m.label);
  console.log(`  C ${String(r.score).padStart(3)} · ${r.band.padEnd(7)} · ${label}`);
  console.log(`        format ${r.format} · coach ${r.coachScore} · netNegative ${r.netNegative}`);
  console.log(`        heads  ${top}`);
  console.log(`        up     ${up.length > 0 ? up.join(' · ') : '—'}`);
  console.log(`        down   ${down.length > 0 ? down.join(' · ') : '—'}`);
}
ok('three drafts scored locally — no fetch, no spend, no row written');

// ============================================================================
// 3. GET /x/playbook — the falsification cell over the REAL corpus
// ============================================================================
console.log('\n3. GET /x/playbook — does the ranker score predict our views?');

/** RA.6: a smoke casts `await res.json()`, so NOTHING type-checks these field
 *  names. Every one is checked before it is read, and a missing one fails
 *  loudly rather than printing `undefined`. */
function asEffectiveness(value: unknown, what: string): RankerScoreEffectiveness {
  if (!value || typeof value !== 'object') fail(`${what}: no rankerScoreEffectiveness object`);
  const v = value as Record<string, unknown>;
  for (const key of ['totalPosted', 'totalMeasured', 'totalScoredE']) {
    if (typeof v[key] !== 'number') fail(`${what}: ${key} is ${typeof v[key]}, expected number`);
  }
  for (const key of ['cells', 'contentCells']) {
    if (!Array.isArray(v[key])) fail(`${what}: ${key} is not an array`);
  }
  for (const key of ['spread', 'contentSpread']) {
    if (v[key] !== null && typeof v[key] !== 'number')
      fail(`${what}: ${key} is ${typeof v[key]}, expected number|null`);
  }
  return value as RankerScoreEffectiveness;
}

function printCells(title: string, cells: RankerScoreCell[]): void {
  console.log(`  ${title}`);
  if (cells.length === 0) {
    console.log('     (no rows)');
    return;
  }
  console.log('     q   posted  n    score range    median score   median views   gated');
  for (const cell of cells) {
    console.log(
      `     ${cell.quartile}  ${String(cell.posted).padStart(6)}  ${String(cell.n).padStart(3)}   ${`${cell.range.lo}–${cell.range.hi}`.padEnd(12)}  ${String(cell.medianScore ?? '—').padStart(12)}   ${String(cell.medianViews ?? '—').padStart(12)}   ${cell.sufficient ? 'yes' : 'no'}`,
    );
  }
}

/** The one line this script exists to print. Both spreads are reported and the
 *  wording keeps them apart on purpose: **C is the non-circular test**. Views
 *  is the denominator of every rate E is built from, so a strong E spread says
 *  the arithmetic is wired up, never that the ranker predicts reach. */
function verdict(cell: RankerScoreEffectiveness): string {
  const parts: string[] = [];
  if (cell.contentSpread !== null && cell.contentSpreadQuartiles !== null) {
    parts.push(
      `C spread ${cell.contentSpread.toFixed(2)}x (q${cell.contentSpreadQuartiles.high} over q${cell.contentSpreadQuartiles.low})`,
    );
  }
  if (cell.spread !== null && cell.spreadQuartiles !== null) {
    parts.push(
      `E spread ${cell.spread.toFixed(2)}x (q${cell.spreadQuartiles.high} over q${cell.spreadQuartiles.low}, circular — views is E's own denominator)`,
    );
  }
  if (parts.length === 0) {
    return `no measurable spread (posted ${cell.totalPosted}, measured ${cell.totalMeasured}, E-scored ${cell.totalScoredE}; no two quartiles clear the cell gate) — the score stays context, not advice`;
  }
  return `${parts.join(' · ')} over ${cell.totalMeasured} measured of ${cell.totalPosted} posted`;
}

{
  const res = await send('GET', '/x/playbook');
  if (res.status !== 200) fail(`GET /x/playbook → ${res.status}`);
  const cell = asEffectiveness(res.body.rankerScoreEffectiveness, 'GET /x/playbook');
  printCells('E quartiles (measured counts):', cell.cells);
  printCells('C quartiles (text alone, same rows):', cell.contentCells);
  console.log(`  verdict · ${verdict(cell)}`);
  if (cell.totalPosted === 0) {
    // Not a failure and not a defect (D238). The population is own harvested
    // originals and this box has never run a `posts`-mode harvest on its own
    // profile; the corpus is one harvest away, and step 4 proves the
    // instrument works meanwhile.
    ok('cell reads empty — the own-profile corpus has no rows yet, which is an answer');
  } else {
    ok(`cell reads ${cell.totalPosted} own posted originals`);
  }
}

// ============================================================================
// 4. the same cell over a corpus that exists
// ============================================================================
console.log('\n4. latestOwnPostRows → buildRankerScoreEffectiveness over seeded rows');

{
  const [run] = await db
    .insert(harvestRuns)
    .values({ handle: HANDLE, mode: 'posts', scope: 'all', rowCount: HARVEST_IDS.length })
    .returning({ id: harvestRuns.id });
  if (!run) fail('harvest_runs insert returned nothing');
  runId = run.id;

  const now = Date.now();
  // Eight scorable rows whose measured rates AND text shapes both fan out —
  // both cells are cut over the same rows, so a fixture that varies only the
  // counts leaves the C table as one undifferentiated bucket and proves nothing
  // about it. Plus a ninth the harvest caught with no view count: it has no
  // rate and therefore no E, and it is not a zero.
  const SEED = [
    { views: 400, likes: 3, comments: 1, reposts: 0, text: 'thoughts?' },
    { views: 900, likes: 12, comments: 2, reposts: 0, text: 'big if true — thoughts?' },
    {
      views: 1500,
      likes: 30,
      comments: 6,
      reposts: 1,
      text: 'Most people ship the feature. Almost nobody ships the measurement that says whether it worked.',
    },
    {
      views: 2200,
      likes: 70,
      comments: 14,
      reposts: 3,
      text: 'Would you rather ship 3 posts a week you measured, or 15 you never looked at again?',
    },
    {
      views: 3100,
      likes: 120,
      comments: 26,
      reposts: 6,
      text: 'The 03:00 pass billed $0.10 a day to re-read my own timeline. I deleted it. The DOM scrape reads the same posts more accurately, for nothing.',
    },
    {
      views: 4800,
      likes: 210,
      comments: 55,
      reposts: 12,
      text: 'Three things a $0 harvest gets right that the paid snapshot did not:\n1. it reads at the right hour\n2. it carries the parent post\n3. it never double-bills',
    },
    {
      views: 7000,
      likes: 400,
      comments: 110,
      reposts: 25,
      text: 'I spent $3.71 reading one tweet 3,712 times. The bug was ordering: I billed the read before I retired the row, so every retry paid again. Retire first, then spend.',
    },
    {
      views: 11000,
      likes: 900,
      comments: 240,
      reposts: 60,
      text: 'Ported X’s published For You weights today. 26 heads, one report cancels nothing like the number of likes you would guess, and the reply head is 10x the like head.',
    },
    {
      views: 0,
      likes: 0,
      comments: 0,
      reposts: 0,
      text: 'a post the harvest caught with no numbers',
    },
  ];
  await db.insert(harvestRows).values(
    SEED.map((s, i) => ({
      runId: run.id,
      tweetId: HARVEST_IDS[i] as string,
      handle: HANDLE,
      mode: 'posts',
      text: s.text,
      likes: s.likes,
      comments: s.comments,
      reposts: s.reposts,
      views: s.views,
      hasPhoto: false,
      hasVideo: false,
      isQuote: false,
      capturedAt: new Date(now - 3_600_000),
    })),
  );

  // Latest capture wins — a re-harvest of the same tweet must not double-count
  // it, and the row the loader keeps is the fresher view count.
  await db.insert(harvestRows).values({
    runId: run.id,
    tweetId: HARVEST_IDS[0] as string,
    handle: HANDLE,
    mode: 'posts',
    text: 'thoughts?',
    likes: 5,
    comments: 1,
    reposts: 0,
    views: 650,
    hasPhoto: false,
    hasVideo: false,
    isQuote: false,
    capturedAt: new Date(now),
  });

  const rows = await latestOwnPostRows(HANDLE);
  if (rows.length !== SEED.length)
    fail(`latestOwnPostRows returned ${rows.length} rows, expected ${SEED.length} (one per tweet)`);
  const refreshed = rows.find((r) => r.counts.views === 650);
  if (!refreshed)
    fail('latestOwnPostRows kept the older capture — max(captured_at) is not winning');
  ok(`${rows.length} rows, one per tweet id, latest capture winning`);

  const viewless = rows.filter((r) => r.outcome === null);
  if (viewless.length !== 1) fail(`${viewless.length} rows have no outcome, expected exactly 1`);
  ok('a row the DOM caught with no view count has no outcome — 0 views is not a measurement');

  // minN 2 so the gate can actually clear on nine rows; the production default
  // is the operator's `Playbook cell gate` knob and is much higher.
  const cell = buildRankerScoreEffectiveness(rows, 2);
  if (cell.totalPosted !== rows.length)
    fail(`totalPosted ${cell.totalPosted}, expected ${rows.length}`);
  if (cell.totalScoredE !== rows.length - 1)
    fail(
      `totalScoredE ${cell.totalScoredE}, expected ${rows.length - 1} (the viewless row has no E)`,
    );

  // `posted` is the rows in the cell; `n` is the subset with a measured
  // outcome, and the gate is on `n`. Summing the wrong one is how a partition
  // check silently stops checking a partition.
  const partitions = (cells: RankerScoreCell[], expected: number, what: string): void => {
    const total = cells.reduce((sum, c) => sum + c.posted, 0);
    if (total !== expected) fail(`${what}: cells hold ${total} rows, expected ${expected}`);
    let prevHi = Number.NEGATIVE_INFINITY;
    let prevQ = 0;
    for (const c of cells) {
      if (c.quartile <= prevQ) fail(`${what}: quartiles out of order at q${c.quartile}`);
      if (c.range.lo > c.range.hi) fail(`${what}: q${c.quartile} range is inverted`);
      if (c.range.lo <= prevHi && prevQ !== 0)
        fail(`${what}: q${c.quartile} overlaps q${prevQ} — ties landed in two cells`);
      prevHi = c.range.hi;
      prevQ = c.quartile;
    }
  };
  partitions(cell.cells, cell.totalScoredE, 'E cells');
  partitions(cell.contentCells, cell.totalPosted, 'C cells');
  ok('every scorable row lands in exactly one quartile, ranges ascending and disjoint');

  if (cell.spread !== null) {
    const pair = cell.spreadQuartiles;
    if (!pair) fail('spread is a number but spreadQuartiles is null');
    const high = cell.cells.find((c) => c.quartile === pair.high);
    const low = cell.cells.find((c) => c.quartile === pair.low);
    if (!high?.medianViews || !low?.medianViews) fail('spread names a pair with no median views');
    if (!high.sufficient || !low.sufficient) fail('spread was built from a cell below the gate');
    // The cell rounds to two places, so the check is against the rounded ratio
    // rather than the raw one.
    if (!near(cell.spread, Math.round((high.medianViews / low.medianViews) * 100) / 100, 1e-9))
      fail(`spread ${cell.spread} is not ${high.medianViews} / ${low.medianViews}`);
    ok(
      `spread names its gated pair and is its arithmetic (${cell.spread.toFixed(2)}x, q${pair.high} over q${pair.low})`,
    );
  } else {
    ok('no two quartiles cleared the gate on the fixture — spread stays null rather than guessing');
  }

  printCells('E quartiles over the seeded corpus:', cell.cells);
  printCells('C quartiles over the seeded corpus:', cell.contentCells);
  // Labelled, because the fixture was BUILT to fan out on both axes: the spread
  // below demonstrates the arithmetic and is not evidence about anything. The
  // only reading that could be evidence is step 3's, over real own posts.
  console.log(
    `  fixture verdict (built to fan out — arithmetic, not a finding) · ${verdict(cell)}`,
  );
  ok('the loader → cell chain answers over rows that exist — step 3 read empty, not broken');
}

// ============================================================================
// 5. the swipe-file identity — ranker_e is the score of its own columns
// ============================================================================
console.log('\n5. POST /x/voice/scrape — the five columns move as one observation');

interface StoredMetrics {
  views: number | null;
  likes: number | null;
  replies: number | null;
  reposts: number | null;
  rankerE: number | null;
}

async function storedMetrics(): Promise<StoredMetrics> {
  const [row] = await db
    .select({
      views: voiceTweets.views,
      likes: voiceTweets.likes,
      replies: voiceTweets.replies,
      reposts: voiceTweets.reposts,
      rankerE: voiceTweets.rankerE,
    })
    .from(voiceTweets)
    .where(eq(voiceTweets.tweetId, VOICE_ID));
  if (!row) fail('the saved voice_tweets row is gone');
  return row;
}

/** The identity every later analysis assumes: the score stored beside the four
 *  counts is the score OF those four counts, re-derived here through the same
 *  shared module the server called (§7.27) rather than against a literal. */
function assertIdentity(m: StoredMetrics, what: string): void {
  const r = scoreMeasured({
    views: m.views,
    likes: m.likes,
    replies: m.replies,
    reposts: m.reposts,
  });
  const expected = r.available ? r.score : null;
  if (m.rankerE !== expected)
    fail(`${what}: ranker_e is ${m.rankerE}, but scoreMeasured of its own columns is ${expected}`);
}

async function scrape(metrics?: Record<string, unknown>): Promise<void> {
  const res = await send('POST', '/x/voice/scrape', {
    tweet: {
      tweetId: VOICE_ID,
      handle: HANDLE,
      displayName: 'XR8',
      text: 'a hunted post worth keeping the numbers of',
      url: `https://x.com/${HANDLE}/status/${VOICE_ID}`,
    },
    ...(metrics === undefined ? {} : { metrics }),
  });
  if (res.status !== 201) fail(`POST /x/voice/scrape → ${res.status} (expected 201)`);
}

{
  // A `rankerE` on the wire is ignored — the score is the server's (§7.16) and
  // 99 is a number this service could not re-derive or defend.
  await scrape({ views: 5000, likes: 90, replies: 20, reposts: 4, rankerE: 99 });
  const first = await storedMetrics();
  if (first.views !== 5000 || first.likes !== 90 || first.replies !== 20 || first.reposts !== 4)
    fail(`first save stored ${JSON.stringify(first)}`);
  if (first.rankerE === null) fail('first save stored no ranker_e for a post with views');
  if (first.rankerE === 99) fail('the client-supplied rankerE was persisted — §7.16 is broken');
  assertIdentity(first, 'first save');
  ok(`first save: five columns written together, E ${first.rankerE}, client rankerE ignored`);

  // A re-save that read no card leaves all five alone — refreshing counts while
  // keeping an older score is what D243 exists to prevent, and so is the
  // reverse: zeroing a reading because this save could not take one.
  await scrape();
  const untouched = await storedMetrics();
  if (JSON.stringify(untouched) !== JSON.stringify(first))
    fail(`a metrics-free re-save moved the columns: ${JSON.stringify(untouched)}`);
  ok('a re-save carrying no metrics leaves all five untouched');

  // Same for a block with nothing usable in it — `parseScrapedMetrics` returns
  // null rather than a row of zeros, which is what makes "not at all"
  // expressible (§7.11).
  await scrape({ views: 'lots', likes: null });
  const stillUntouched = await storedMetrics();
  if (JSON.stringify(stillUntouched) !== JSON.stringify(first))
    fail(`an unusable metrics block moved the columns: ${JSON.stringify(stillUntouched)}`);
  ok('an unparseable metrics block degrades to null — the save survives, the reading does not');

  await scrape({ views: 12000, likes: 640, replies: 95, reposts: 31 });
  const refreshed = await storedMetrics();
  if (refreshed.views !== 12000 || refreshed.likes !== 640)
    fail(`re-save did not refresh the counts: ${JSON.stringify(refreshed)}`);
  if (refreshed.rankerE === first.rankerE)
    fail('the counts moved and ranker_e did not — the score is stale');
  assertIdentity(refreshed, 're-save');
  ok(
    `a re-save carrying new counts moves all five together, E ${first.rankerE} → ${refreshed.rankerE}`,
  );
}

// ============================================================================
// 6. provenance — printed on every run
// ============================================================================
console.log('\n6. where the numbers came from');

console.log(
  `  X_OBSERVED_RATES     provenance ${X_OBSERVED_RATES_PROVENANCE} · favorite ${X_OBSERVED_RATES.favorite} · reply ${X_OBSERVED_RATES.reply} · retweet ${X_OBSERVED_RATES.retweet}`,
);
console.log(
  `                       n=${X_OBSERVED_RATES_SAMPLE.n} · ${X_OBSERVED_RATES_SAMPLE.source} · ${X_OBSERVED_RATES_SAMPLE.collected}`,
);
console.log(
  `  RANKER_BAND_CUTS     provenance ${RANKER_BAND_CUTS_PROVENANCE} · draft ${RANKER_BAND_CUTS.draft.typical}/${RANKER_BAND_CUTS.draft.strong} (n=${RANKER_BAND_CUTS_SAMPLE.draft.n}) · measured ${RANKER_BAND_CUTS.measured.typical}/${RANKER_BAND_CUTS.measured.strong} (n=${RANKER_BAND_CUTS_SAMPLE.measured.n})`,
);

// The module's own refusal rule, restated where a run can see it: a baseline
// calling itself measured must carry a corpus big enough to have measured it.
if (X_OBSERVED_RATES_PROVENANCE === 'measured' && X_OBSERVED_RATES_SAMPLE.n < 100)
  fail(
    `X_OBSERVED_RATES claims 'measured' on n=${X_OBSERVED_RATES_SAMPLE.n}, below the n=100 floor`,
  );
ok('both baselines are measured off our own corpus and carry their sample stamps');

// ----------------------------------------------------------------- teardown

cleanup();

{
  const left = await db
    .select({ id: harvestRows.id })
    .from(harvestRows)
    .where(inArray(harvestRows.tweetId, HARVEST_IDS));
  if (left.length > 0) fail(`${left.length} seeded harvest rows survived cleanup`);
  const leftRuns = await db
    .select({ id: harvestRuns.id })
    .from(harvestRuns)
    .where(eq(harvestRuns.handle, HANDLE));
  if (leftRuns.length > 0) fail(`${leftRuns.length} seeded harvest runs survived cleanup`);
  const leftVoice = await db
    .select({ id: voiceTweets.tweetId })
    .from(voiceTweets)
    .where(eq(voiceTweets.tweetId, VOICE_ID));
  if (leftVoice.length > 0) fail('the seeded voice_tweets row survived cleanup');
}

console.log(
  `\nPASS — the X ranker port answers end to end at $0 (run ${runId ? 'seeded and swept' : 'unseeded'}).`,
);
