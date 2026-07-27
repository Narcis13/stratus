// One-shot smoke for the Static Coach lane (SC.1–SC.8, plan
// `plans/2026-07-22-static-coach.md`). Mounts the coach + calendar + playbook
// routers in-process (no port, no workers, no X call, no LLM) against the real
// DB and drives the four layers the lane ships:
//
//   (a) the check engine (SC.1) — the plan's own done-when draft, the $0.20 URL
//       line, the blank-draft contract, and the two checks a REPLY skips;
//   (b) the classifier (SC.2) — the fixtures' premises, plus a total pass over
//       every own original the DB actually holds;
//   (c) the format cooldown (SC.6) through `GET /x/posts/cooldowns` — a seeded
//       4-in-window flip, the window edge, `?days=` validation, and the EXEMPT
//       invariant (D156f: `exempt ⇒ clear`, whatever the count says);
//   (d) the Playbook's two new cells (SC.5) — partition invariants over the
//       whole corpus plus the gate moving in both directions;
//   (e) the reach band (SC.8) — the population CONTRACT through
//       `GET /x/coach/reach` (first-snapshot-in-window counts, a post measured
//       only outside the window is dropped) and the provenance invariant that
//       no `insufficient` cell carries a number;
//   (f) the niche lexicon (SC.7) — a channel keyword reaching the payload AND
//       flipping `concrete_detail` when that payload is fed back into the
//       engine, which is the only assertion that catches the route and the
//       engine disagreeing about term shape.
//
// **$0 and it cannot spend**: nothing mounted here has a paid path. There is no
// `--live` flag because there is no billed call to verify — the whole lane is
// pure functions over text stratus already paid for.
//
// Two things are asserted PURELY rather than through a route, on purpose. The
// cooldown's `warming` rung and the reach band's FITTED side both need an exact
// number, and an exact number over a shared real corpus is somebody else's row
// waiting to happen (the GT.9 rule). So the routes prove the wiring and the
// population, and `buildCooldowns` / `buildReachFit` prove the arithmetic on a
// synthetic corpus — including the one assertion that matters most here: a
// 60-sample EXEMPT format still returns no numbers, so sample size alone never
// buys a band.
//
// Real-DB safety is namespace-then-delete (§D98c): every tweet id is
// 889-prefixed (no real snowflake starts there), every seeded `posts_published`
// row is written `retired: true` (NT.7 — an un-retired row is a candidate for
// the daily *billed* metrics pass), and the one channel is `sc9-smoke`. Nothing
// mounted here is a read-that-writes, so unlike `smoke-guardrails.ts` there is
// no closing re-read to pay.
//
// Run: bun run scripts/smoke-coach.ts

import { eq, inArray } from 'drizzle-orm';
import { Hono } from 'hono';
import { db } from '../src/db/client.ts';
import { COACH_DISCLAIMER, type CoachLexicon, scoreDraft } from '../src/shared/postCoach.ts';
import {
  COOLDOWN_EXEMPT_FORMATS,
  COOLDOWN_THRESHOLD,
  type CooldownCell,
  WARMING_THRESHOLD,
  buildCooldowns,
} from '../src/shared/postCooldown.ts';
import { POST_FORMATS, type PostFormat, classifyFormat } from '../src/shared/postFormat.ts';
import {
  REACH_BASE_WINDOW,
  type ReachCell,
  type ReachRow,
  buildReachFit,
} from '../src/x/coach/reach.ts';
import { channels, metricsSnapshots, postsPublished } from '../src/x/db/schema.ts';
import { calendar } from '../src/x/routes/calendar.ts';
import { coachRouter } from '../src/x/routes/coach.ts';
import { playbook } from '../src/x/routes/playbook.ts';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

// 889-prefixed: no real snowflake starts there.
const CTA_IN = [
  '889000000000000001',
  '889000000000000002',
  '889000000000000003',
  '889000000000000004',
];
const CTA_OLD = '889000000000000005'; // same shape, 30 days old — outside every window
const SUB_IN = ['889000000000000006', '889000000000000007'];
const REACH_FIRST = '889000000000000008'; // first snapshot in-window, later one outside
const REACH_LATE = '889000000000000009'; // measured only outside the window
const TWEET_IDS = [...CTA_IN, CTA_OLD, ...SUB_IN, REACH_FIRST, REACH_LATE];
const CHANNEL_SLUG = 'sc9-smoke';

const app = new Hono();
app.route('/x', coachRouter);
app.route('/x', calendar);
app.route('/x', playbook);

function fail(msg: string): never {
  console.error(`FAIL: ${msg}`);
  process.exit(1);
}
function ok(msg: string): void {
  console.log(`ok: ${msg}`);
}

async function cleanup(): Promise<void> {
  await db.delete(metricsSnapshots).where(inArray(metricsSnapshots.tweetId, TWEET_IDS));
  await db.delete(postsPublished).where(inArray(postsPublished.tweetId, TWEET_IDS));
  await db.delete(channels).where(eq(channels.slug, CHANNEL_SLUG));
}

// Start clean in case an earlier run died mid-way.
await cleanup();

// ------------------------------------------------- (a) the check engine (SC.1)

// The plan's own done-when draft: an em-dash, a "thoughts?" closer, and 15 raw
// lines. What it actually produces is worth stating out loud, because the plan
// text says "exactly three Fix rows" and the engine ships two of the three as
// NUDGES: severity is per-rule (D145), and `standard` is a mean over ~20 rules,
// so this draft scores in the 80s while showing a red row (D152b). The contract
// worth asserting is therefore that all three rules FIRE and that the
// show-more one is the only fix — not the plan's row count.
const DONE_WHEN_DRAFT = [
  'The thing nobody tells you about shipping — it is mostly waiting.',
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
  'eleven',
  'twelve',
  'thirteen',
  'thoughts?',
].join('\n');

const graded = scoreDraft(DONE_WHEN_DRAFT);
const statusOf = (id: string): string | undefined => graded.checks.find((c) => c.id === id)?.status;
for (const id of ['em_dash', 'weak_closer', 'show_more']) {
  if (statusOf(id) === undefined) fail(`the done-when draft did not run the \`${id}\` rule at all`);
  if (statusOf(id) === 'pass') fail(`\`${id}\` passed on a draft written to trip it`);
}
if (statusOf('show_more') !== 'fix')
  fail(`show_more should be a fix, got ${statusOf('show_more')}`);
if (graded.counts.fix !== 1) fail(`expected exactly one fix row, got ${graded.counts.fix}`);
ok(
  `check engine: em_dash=${statusOf('em_dash')} weak_closer=${statusOf('weak_closer')} show_more=fix · score ${graded.score} (${graded.band})`,
);

const urlGraded = scoreDraft(
  'I wrote the whole thing up at https://example.com/post over the weekend.',
);
const urlCheck = urlGraded.checks.find((c) => c.id === 'url_cost');
if (!urlCheck || urlCheck.status === 'pass')
  fail('a URL in a standalone post did not trip url_cost');
if (!urlCheck.label.includes('$0.20')) {
  fail(`the url_cost line must name the surcharge: ${urlCheck.label}`);
}
ok(
  'check engine: a standalone URL surfaces the $0.20 line (invariant #1, surfaced never enforced)',
);

// The blank-draft contract the Composer's hidden-when-empty block rests on.
const blank = scoreDraft('   ');
if (blank.checks.length !== 0 || blank.score !== 0) {
  fail(`a blank draft must grade to zero checks, got ${blank.checks.length}`);
}
ok('check engine: a blank draft returns zero checks (the panel has nothing to render)');

// D145b: a reply is graded on a SHORTER checklist — `hook_opener` and
// `breathing_room` are skipped, not auto-passed. Asserted as a delta so no
// count is hardcoded anywhere.
const asPost = scoreDraft('the slow week is usually the one that teaches you the most about it');
const asReply = scoreDraft('the slow week is usually the one that teaches you the most about it', {
  isReply: true,
});
const replyIds = new Set(asReply.checks.map((c) => c.id));
if (replyIds.has('hook_opener') || replyIds.has('breathing_room')) {
  fail('a reply must not be graded on hook_opener / breathing_room');
}
if (asPost.checks.length - asReply.checks.length !== 2) {
  fail(
    `reply checklist should be 2 shorter, got ${asPost.checks.length} vs ${asReply.checks.length}`,
  );
}
ok(
  `check engine: a reply grades on ${asReply.checks.length} checks, a post on ${asPost.checks.length}`,
);

if (!COACH_DISCLAIMER.includes('not verdicts'))
  fail('the floor-not-target disclaimer changed shape');
ok(`check engine: disclaimer is exported verbatim — "${COACH_DISCLAIMER}"`);

// --------------------------------------------------- (b) the classifier (SC.2)

// Premises first (the SC.6 discipline): a classifier change must redden THIS
// line, not silently re-label the arithmetic underneath the steps below.
const CTA_TEXTS = [
  'Reply with the one thing you shipped this week and I will tell you what I would cut.',
  'Drop your handle below and I will read your last three posts properly.',
  'Reply with the tool you would not give up and I will try it this week.',
  'Reply with what broke today and I will tell you what broke on my side.',
];
const SUB_TEXTS = [
  'Some notes from the work today.\nIt kept moving either way.',
  'The build took four hours longer than planned.\nNothing broke, it was just slow.',
];
for (const t of CTA_TEXTS) {
  if (classifyFormat(t) !== 'audience_cta')
    fail(`fixture is ${classifyFormat(t)}, not audience_cta: ${t}`);
}
for (const t of SUB_TEXTS) {
  if (classifyFormat(t) !== 'substance')
    fail(`fixture is ${classifyFormat(t)}, not substance: ${t}`);
}
ok('classifier: the fixtures classify as the arithmetic below assumes');

// A total pass over the real corpus — real stored text, entities and all
// (D146c: rows are passed RAW, the classifier normalizes them itself). On a
// fresh install this is zero rows, and printing the denominator is what keeps
// that honest.
const ownOriginals = await db
  .select({ text: postsPublished.text })
  .from(postsPublished)
  .where(eq(postsPublished.isReply, false));
const tally = new Map<PostFormat, number>();
for (const row of ownOriginals) {
  const format = classifyFormat(row.text);
  if (!POST_FORMATS.includes(format)) fail(`classifyFormat returned an unknown label: ${format}`);
  tally.set(format, (tally.get(format) ?? 0) + 1);
}
ok(
  `classifier: ${ownOriginals.length} own originals classified, no unknown labels · ${
    ownOriginals.length === 0
      ? 'empty corpus (the fresh-install path)'
      : [...tally].map(([f, n]) => `${f} ${n}`).join(', ')
  }`,
);

// ------------------------------------------------ baselines, taken before any
// seed: every route assertion below is a DELTA. Other suites and the operator's
// own history share these tables, so an absolute would be someone else's row.

interface CooldownPayload {
  windowDays: number;
  warmingAt: number;
  cooldownAt: number;
  cells: CooldownCell[];
}
async function cooldowns(query = ''): Promise<CooldownPayload> {
  const res = await app.request(`/x/posts/cooldowns${query}`);
  if (res.status !== 200) fail(`GET /x/posts/cooldowns${query} returned ${res.status}`);
  return (await res.json()) as CooldownPayload;
}
const countOf = (payload: CooldownPayload, format: PostFormat): number =>
  payload.cells.find((c) => c.format === format)?.count ?? 0;

const baseWeek = await cooldowns();
const baseDay = await cooldowns('?days=1');

interface ReachPayload {
  base: number | null;
  measuredPosts: number;
  fittedPosts: number;
  minN: number;
  cells: ReachCell[];
}
async function reach(): Promise<ReachPayload> {
  const res = await app.request('/x/coach/reach');
  if (res.status !== 200) fail(`GET /x/coach/reach returned ${res.status}`);
  return (await res.json()) as ReachPayload;
}
const baseReach = await reach();

// --------------------------------------------------------------------- seeds

const now = Date.now();
const original = (tweetId: string, text: string, daysAgo: number) => ({
  tweetId,
  text,
  postedAt: new Date(now - daysAgo * DAY),
  isReply: false,
  source: 'smoke',
  // NT.7: an un-retired row is a candidate for the daily BILLED metrics pass.
  retired: true,
});

await db.insert(postsPublished).values([
  ...CTA_IN.map((id, i) => original(id, CTA_TEXTS[i] as string, i + 2)), // 2–5 days ago
  original(CTA_OLD, CTA_TEXTS[0] as string, 30),
  ...SUB_IN.map((id, i) => original(id, SUB_TEXTS[i] as string, 2)),
  original(REACH_FIRST, SUB_TEXTS[0] as string, 20),
  original(REACH_LATE, SUB_TEXTS[1] as string, 20),
]);

// The cooldown/Playbook fixtures are measured but carry NO snapshot age: rows
// written before §8.4 look exactly like this, and it keeps them out of the
// reach population so step (e)'s delta stays exactly the two rows it is about.
await db.insert(metricsSnapshots).values(
  [...CTA_IN, CTA_OLD, ...SUB_IN].map((tweetId) => ({
    tweetId,
    publicMetrics: { impression_count: 300, like_count: 2, reply_count: 1 },
    nonPublicMetrics: { user_profile_clicks: 3 },
  })),
);

// The whole point of SC.8's population rule, as two rows: REACH_FIRST was read
// once inside the daily pass's 3–27h window and re-read days later (the winner
// re-read), REACH_LATE only ever late. Reading "the latest snapshot per tweet"
// — the house pattern the plan named to copy — would drop the first and keep
// the second, i.e. exactly backwards (D161a).
await db.insert(metricsSnapshots).values([
  {
    tweetId: REACH_FIRST,
    snapshotAt: new Date(now - 20 * DAY + 10 * HOUR),
    publicMetrics: { impression_count: 250 },
    ageAtSnapshotMin: 600,
  },
  {
    tweetId: REACH_FIRST,
    snapshotAt: new Date(now - 16 * DAY),
    publicMetrics: { impression_count: 4000 },
    ageAtSnapshotMin: 5760,
  },
  {
    tweetId: REACH_LATE,
    snapshotAt: new Date(now - 16 * DAY),
    publicMetrics: { impression_count: 4000 },
    ageAtSnapshotMin: 5760,
  },
]);
console.log(`seeded: ${TWEET_IDS.length} own originals (all retired), 10 snapshots`);

// ----------------------------------------------- (c) the format cooldown (SC.6)

const week = await cooldowns();
if (week.windowDays !== 7) fail(`default window should be 7 days, got ${week.windowDays}`);
const ctaDelta = countOf(week, 'audience_cta') - countOf(baseWeek, 'audience_cta');
if (ctaDelta !== CTA_IN.length) {
  fail(
    `audience_cta moved by ${ctaDelta}, want ${CTA_IN.length} (the 30-day-old one must not count)`,
  );
}
const ctaCell = week.cells.find((c) => c.format === 'audience_cta');
if (ctaCell?.status !== 'cooldown')
  fail(`4 in the window must read cooldown, got ${ctaCell?.status}`);
ok(`cooldown: 4 audience CTAs inside 7 days flip the cell to cooldown (count ${ctaCell.count})`);

const subDelta = countOf(week, 'substance') - countOf(baseWeek, 'substance');
if (subDelta !== SUB_IN.length) fail(`substance moved by ${subDelta}, want ${SUB_IN.length}`);

// D156f — the invariant, not the count: the three "no format detected" labels
// are pinned `clear` no matter how high they climb, so no consumer has to keep
// its own copy of the exempt list.
for (const cell of week.cells) {
  const shouldBeExempt = COOLDOWN_EXEMPT_FORMATS.includes(cell.format);
  if (cell.exempt !== shouldBeExempt)
    fail(`${cell.format}: exempt=${cell.exempt}, want ${shouldBeExempt}`);
  if (cell.exempt && cell.status !== 'clear') {
    fail(`${cell.format} is exempt but reads ${cell.status} at count ${cell.count}`);
  }
}
ok(
  `cooldown: exempt ⇒ clear holds across all ${week.cells.length} cells (${COOLDOWN_EXEMPT_FORMATS.join('/')})`,
);

const day = await cooldowns('?days=1');
if (day.windowDays !== 1) fail(`?days=1 not honored: ${day.windowDays}`);
if (countOf(day, 'audience_cta') !== countOf(baseDay, 'audience_cta')) {
  fail('a 1-day window still sees fixtures posted 2+ days ago');
}
ok('cooldown: ?days= narrows the window (the 2–5 day old fixtures drop out at ?days=1)');

for (const bad of ['?days=0', '?days=91', '?days=2.5']) {
  const res = await app.request(`/x/posts/cooldowns${bad}`);
  if (res.status !== 400) fail(`${bad} expected 400, got ${res.status}`);
}
ok('cooldown: ?days=0 / over the cap / non-integer all 400 invalid_days');

// The rungs, proven exactly on a synthetic corpus — a real shared table can
// only ever support the upward-monotone assertion above.
const at = (daysAgo: number) => new Date(now - daysAgo * DAY);
const pureCells = buildCooldowns(
  [
    ...Array.from({ length: WARMING_THRESHOLD }, (_, i) => ({
      text: CTA_TEXTS[0] as string,
      postedAt: at(i + 1),
    })),
    ...Array.from({ length: COOLDOWN_THRESHOLD + 2 }, (_, i) => ({
      text: SUB_TEXTS[0] as string,
      postedAt: at(i + 1),
    })),
  ],
  new Date(now),
);
const pureCta = pureCells.find((c) => c.format === 'audience_cta');
const pureSub = pureCells.find((c) => c.format === 'substance');
if (pureCta?.status !== 'warming') fail(`${WARMING_THRESHOLD} in a window must read warming`);
if (pureSub?.status !== 'clear' || pureSub.count !== COOLDOWN_THRESHOLD + 2) {
  fail(`an exempt format at ${COOLDOWN_THRESHOLD + 2} must still read clear`);
}
ok(
  `cooldown (pure): ${WARMING_THRESHOLD} → warming, ${COOLDOWN_THRESHOLD} → cooldown, exempt at ${COOLDOWN_THRESHOLD + 2} → still clear`,
);

// ------------------------------------------------ (d) the Playbook cells (SC.5)

// biome-ignore lint/suspicious/noExplicitAny: the smoke walks the whole payload
async function playbookAt(minN: number): Promise<any> {
  const res = await app.request(`/x/playbook?minN=${minN}`);
  if (res.status !== 200) fail(`GET /x/playbook?minN=${minN} returned ${res.status}`);
  return await res.json();
}

const open = await playbookAt(1);
const fmt = open.formatEffectiveness;
const coach = open.coachScoreEffectiveness;

// The three axes see ONE population — that is what makes the two new cells
// comparable to the media cell they were loaded beside (SC.5's single loader).
const cellSum = (cells: Array<{ n: number; posted: number }>) => ({
  n: cells.reduce((s, c) => s + c.n, 0),
  posted: cells.reduce((s, c) => s + c.posted, 0),
});
const fmtSum = cellSum(fmt.cells);
if (fmtSum.n !== fmt.totalMeasured || fmtSum.posted !== fmt.totalPosted) {
  fail(
    `format cells do not partition the corpus: ${JSON.stringify(fmtSum)} vs ${fmt.totalPosted}/${fmt.totalMeasured}`,
  );
}
const bandSum = cellSum(coach.cells);
if (bandSum.n !== coach.totalMeasured || bandSum.posted !== coach.totalPosted) {
  fail('coach-band cells do not partition the corpus');
}
if (coach.clean.n + coach.flagged.n !== coach.totalMeasured) {
  fail('clean + flagged must partition the measured originals');
}
if (fmt.totalPosted !== coach.totalPosted)
  fail('the format and coach axes read different populations');
ok(
  `playbook: format, band and fix axes all partition the same ${fmt.totalPosted} originals (${fmt.totalMeasured} measured)`,
);

const openCta = fmt.cells.find((c: { format: string }) => c.format === 'audience_cta');
if (!openCta || openCta.n < CTA_IN.length + 1)
  fail('the seeded CTAs are missing from the format cell');
if (openCta.sufficient !== true) fail('minN=1 did not open the format gate');
ok(
  `playbook: the seeded CTAs land in the audience_cta cell (n=${openCta.n}, sufficient at minN=1)`,
);

// The gate is a PARAMETER, proven by moving it rather than by a fixture — and
// asserted at a bar no corpus can reach, so a growing account never reddens it.
const shut = await playbookAt(1000);
const stillOpen = [
  ...shut.formatEffectiveness.cells,
  ...shut.coachScoreEffectiveness.cells,
  shut.coachScoreEffectiveness.clean,
  shut.coachScoreEffectiveness.flagged,
].filter((c: { sufficient: boolean }) => c.sufficient);
if (stillOpen.length !== 0) fail(`${stillOpen.length} cells claim sufficiency at minN=1000`);
if (
  shut.coachScoreEffectiveness.spread !== null ||
  shut.coachScoreEffectiveness.fixSpread !== null
) {
  fail('a spread survived a gate nothing can clear');
}
ok('playbook: at minN=1000 every new cell goes insufficient and both spreads go null');

const badGate = await app.request('/x/playbook?minN=0');
if (badGate.status !== 400) fail(`minN=0 expected 400, got ${badGate.status}`);
ok('playbook: minN=0 is refused (invalid_min_n)');

// -------------------------------------------------- (e) the reach band (SC.8)

const seededReach = await reach();
const measuredDelta = seededReach.measuredPosts - baseReach.measuredPosts;
if (measuredDelta !== 1) {
  fail(
    `reach population moved by ${measuredDelta}, want exactly 1 — the first-snapshot row must count and the late-only row must not`,
  );
}
ok(
  'reach: a post whose FIRST snapshot is in-window counts even though its LATEST is not; a post measured only outside the window is dropped (D161a)',
);
if (seededReach.fittedPosts > seededReach.measuredPosts) fail('fittedPosts exceeds the population');

if (seededReach.cells.length !== POST_FORMATS.length) {
  fail(`reach should carry all ${POST_FORMATS.length} formats, got ${seededReach.cells.length}`);
}
if (seededReach.cells.map((c) => c.format).join() !== POST_FORMATS.join()) {
  fail('reach cells are not in POST_FORMATS cascade order');
}
for (const cell of seededReach.cells) {
  if (cell.exempt && cell.weightSource !== 'insufficient') {
    fail(`${cell.format} is exempt but shipped as ${cell.weightSource}`);
  }
  if (cell.weightSource !== 'insufficient') continue;
  const numbers = [
    cell.stallRange,
    cell.escapeThreshold,
    cell.escapeProbability,
    cell.p50Multiplier,
  ];
  if (numbers.some((v) => v !== null)) fail(`an insufficient ${cell.format} cell carries a number`);
}
ok(
  `reach: no insufficient cell carries a number, no exempt format is ever fitted (gate n≥${seededReach.minN}, base ${seededReach.base ?? 'null'})`,
);

// The FITTED side, pure: the padding pins every trailing window at 100 views,
// so a post's ratio is `views / 100` by construction and the quantiles can be
// asserted exactly. The filler is deliberately an exempt format — which makes
// the second half of this step the one that matters: 60 samples of `substance`
// still buy no numbers.
const FILLER = SUB_TEXTS[0] as string;
const LIST = 'Three things that helped:\n- shipping smaller\n- reading the logs\n- asking sooner';
if (classifyFormat(LIST) !== 'list') fail('the pure-fit fixture stopped classifying as a list');
const T0 = Date.UTC(2026, 0, 1);
const synthetic: ReachRow[] = [];
const push = (i: number, text: string, views: number) =>
  synthetic.push({ text, postedAt: new Date(T0 + i * HOUR), views, ageAtSnapshotMin: 600 });
for (let i = 0; i < REACH_BASE_WINDOW; i++) push(i, FILLER, 100);
let cursor = REACH_BASE_WINDOW;
for (const views of [
  10, 20, 30, 400, 40, 50, 60, 400, 70, 80, 90, 400, 100, 110, 120, 400, 130, 140, 150, 400,
]) {
  push(cursor++, LIST, views);
  for (let f = 0; f < 3; f++) push(cursor++, FILLER, 100);
}
const fit = buildReachFit(synthetic, 20);
const listCell = fit.cells.find((c) => c.format === 'list');
if (fit.base !== 100) fail(`pure fit base should be 100, got ${fit.base}`);
if (listCell?.weightSource !== 'fitted') fail('a 20-sample non-exempt format must fit');
if (JSON.stringify(listCell.stallRange) !== '[40,120]') {
  fail(`stall range should be [40,120] views, got ${JSON.stringify(listCell.stallRange)}`);
}
if (listCell.escapeThreshold !== 300 || listCell.escapeProbability !== 0.25) {
  fail(
    `escape should be 300 views at 25%, got ${listCell.escapeThreshold} at ${listCell.escapeProbability}`,
  );
}
const fillerCell = fit.cells.find((c) => c.format === 'substance');
if (!fillerCell || fillerCell.n < 20)
  fail('the filler format should be well past the gate by count');
if (fillerCell.weightSource !== 'insufficient' || fillerCell.p50Multiplier !== null) {
  fail(`an exempt format with n=${fillerCell.n} shipped numbers`);
}
ok(
  `reach (pure): a 20-sample list fits [40,120] views with a 300-view escape at 25%, while an exempt format at n=${fillerCell.n} still ships nothing (SC decision 9)`,
);

// ------------------------------------------------- (f) the niche lexicon (SC.7)

interface LexiconPayload extends CoachLexicon {
  niche: string;
}
async function lexicon(): Promise<LexiconPayload> {
  const res = await app.request('/x/coach/lexicon');
  if (res.status !== 200) fail(`GET /x/coach/lexicon returned ${res.status}`);
  return (await res.json()) as LexiconPayload;
}

const TERM = 'plumbird';
const LEX_DRAFT = `We rewrote the ${TERM} over a weekend and it finally feels calm to work in again.`;
if (scoreDraft(LEX_DRAFT).checks.find((c) => c.id === 'concrete_detail')?.status === 'pass') {
  fail('the lexicon fixture already passes concrete_detail without a lexicon');
}

const beforeLex = await lexicon();
if (beforeLex.specificTerms.includes(TERM))
  fail(`the DB already knows \`${TERM}\` — pick another term`);

// niche: null is the legacy/any-niche scope the route explicitly accepts, so
// this step does not depend on which niche happens to be active.
await db.insert(channels).values({
  slug: CHANNEL_SLUG,
  label: 'Plumbird Ops',
  keywords: [TERM],
  active: true,
  niche: null,
});

const afterLex = await lexicon();
if (!afterLex.specificTerms.includes(TERM)) {
  fail(
    `a channel keyword did not reach specificTerms: ${afterLex.specificTerms.slice(0, 8).join(',')}`,
  );
}
if (!afterLex.tribeTerms.includes(TERM))
  fail('the channel label did not word-split into tribeTerms');
// The assertion that catches the route and the engine disagreeing about term
// shape — the payload is fed straight back into the same function the panel
// calls (D155c).
const withLexicon = scoreDraft(LEX_DRAFT, { lexicon: afterLex });
if (withLexicon.checks.find((c) => c.id === 'concrete_detail')?.status !== 'pass') {
  fail(
    'the route payload did not flip concrete_detail — route and engine disagree about term shape',
  );
}
ok(
  `lexicon: niche \`${afterLex.niche}\` · a channel keyword reaches specificTerms AND flips concrete_detail when fed back (${beforeLex.specificTerms.length} → ${afterLex.specificTerms.length} terms)`,
);

// ------------------------------------------------------------------ cleanup

await cleanup();
const leftPosts = await db
  .select({ id: postsPublished.tweetId })
  .from(postsPublished)
  .where(inArray(postsPublished.tweetId, TWEET_IDS));
const leftSnaps = await db
  .select({ id: metricsSnapshots.id })
  .from(metricsSnapshots)
  .where(inArray(metricsSnapshots.tweetId, TWEET_IDS));
const leftChannels = await db
  .select({ slug: channels.slug })
  .from(channels)
  .where(eq(channels.slug, CHANNEL_SLUG));
if (leftPosts.length + leftSnaps.length + leftChannels.length !== 0) {
  fail(
    `cleanup left rows: posts=${leftPosts.length} snapshots=${leftSnaps.length} channels=${leftChannels.length}`,
  );
}
ok('cleanup: 0 rows left');

// The corpus is back where it started, so the surfaces are too — asserted, not
// assumed, because every step above read a shared table.
const closingReach = await reach();
if (closingReach.measuredPosts !== baseReach.measuredPosts) {
  fail(
    `reach population is ${closingReach.measuredPosts}, want the baseline ${baseReach.measuredPosts}`,
  );
}
const closingWeek = await cooldowns();
if (countOf(closingWeek, 'audience_cta') !== countOf(baseWeek, 'audience_cta')) {
  fail('the cooldown window still sees the fixtures');
}
ok('closing re-read: cooldown and reach are back to their baselines');

console.log('SMOKE PASS');
process.exit(0);
