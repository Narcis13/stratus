// One-shot $0 smoke for the own-activity harvest read layer (plan
// `plans/2026-08-06-own-harvest-read-layer.md`, Tasks 1–6). Mounts the harvest,
// playbook and brief routers in-process against the REAL DB (no port, no
// workers, no X API, no LLM) and drives the whole path the plan ships:
//
//   (a) `POST /harvest/runs {scope:'recent'}` is accepted — Task 5's server-side
//       whitelist edit, without which the panel's "My replies" preset 400s at
//       its last step;
//   (b) the SAME tweet ids are ingested TWICE with higher view counts on the
//       second pass — the re-capture that `harvest_rows` stores on purpose and
//       that every consumer must reduce. `ownReplyPerformance.totalMeasured`
//       must count each reply ONCE and every total must use the LATER capture.
//       That is the deliverable: without the dedup, harvesting a day twice
//       silently doubles the number the §8 two-week test is read off;
//   (c) the four gated tables (parent band / latency / crowding / arm), asserted
//       cell by cell in canonical order, including a 20-row cell clearing the
//       n≥20 gate with numbers and a 4-row cell reporting its count with NULL
//       averages, and `unknown` standing as its own bucket on all four axes;
//   (d) the §8 mode filter — a `posts`-mode row from the same handle with
//       999,999 views must not move a single number;
//   (e) the Today brief fact for the last COMPLETE local day;
//   (f) §7.11 — with `x.identity.selfHandle` unset, every surface answers empty
//       and the brief fact goes `null` (never `0`), before any query runs.
//
// **$0, and there is no `--live` flag.** Nothing mounted here can reach
// `xFetch` or `askLLM`: every read is SQL over rows the DOM already scraped for
// free. A flag would be theatre — there is no billed call to verify (D171c).
//
// Real-DB safety is namespace-then-delete (§D98c). Every tweet id is
// 887-prefixed (18 digits — no real snowflake starts there), the self handle is
// the fixture `oh7_self` (so the loader's own `handle =` filter isolates this
// corpus from the operator's real harvests by construction), and every parent
// handle is `oh7_*`. The operator's own `x.identity.selfHandle` is snapshotted
// and restored — including from `fail()`, which exits and would skip a finally.
// `replies`-mode ingest also writes `people`/`person_events` for each parent
// (C1) and its reconcile scans `reply_drafts`; the fixture texts are unique
// smoke strings, so no real unlinked draft can text-match one.
//
// Run: bun run scripts/smoke-own-harvest.ts

import { eq, inArray, like } from 'drizzle-orm';
import { Hono } from 'hono';
import { db } from '../src/db/client.ts';
import {
  cannonTargets,
  harvestRows,
  harvestRuns,
  people,
  personEvents,
} from '../src/x/db/schema.ts';
import type { OwnReplyPerformance } from '../src/x/playbook.ts';
import { brief } from '../src/x/routes/brief.ts';
import { harvest } from '../src/x/routes/harvest.ts';
import { playbook } from '../src/x/routes/playbook.ts';
import { resetSettings, resolveSetting, setSettings } from '../src/x/settings/registry.ts';

const app = new Hono();
app.route('/x', harvest);
app.route('/x', playbook);
app.route('/x', brief);

// 18 digits, all ours: real tweet ids are 19-digit snowflakes starting 1/2, so
// the LIKE in cleanup() can never sweep a genuine row.
const TWEET_PREFIX = '887000000000000';
const tid = (n: number): string => `${TWEET_PREFIX}${String(n).padStart(3, '0')}`;

// ≤15 chars, lowercase, [A-Za-z0-9_] — the USERNAME_RE every wire handle is
// validated against, and handles are lowercased on every side.
const SELF = 'oh7_self';
const ROSTER_JA = 'oh7_ja';
const ROSTER_EN = 'oh7_en';
const OFF_ROSTER = 'oh7_wild';
const PARENT_HANDLES = [ROSTER_JA, ROSTER_EN, OFF_ROSTER];

const DAY_MS = 24 * 60 * 60 * 1000;
const MIN_N = 20;

// Yesterday noon UTC: inside the 14-day own-reply window, and — at
// `tzOffsetMin=0` — the most recent COMPLETE local day, which is the only day
// the brief fact will report (today is excluded there by design, because its
// replies are still accruing views).
const utcMidnight = new Date();
utcMidnight.setUTCHours(0, 0, 0, 0);
const REPLY_AT = new Date(utcMidnight.getTime() - DAY_MS + 12 * 60 * 60 * 1000);
const REPLY_DAY = REPLY_AT.toISOString().slice(0, 10);

// ------------------------------------------------------------- fixture corpus

interface Shape {
  label: string;
  count: number;
  /** First capture, then the re-capture. Only the second may be counted. */
  views1: number;
  views2: number;
  parentHandle: string | null;
  parentText: string | null;
  parentViews: number | null;
  parentComments: number | null;
  /** How long the parent had been up when I replied, in minutes. */
  parentAgeMin: number | null;
}

const SHAPES: Shape[] = [
  {
    // The one cell that clears the n≥20 gate — every other cell must report its
    // count with null averages, which is what makes the gate assertable.
    label: 'roster-ja / 10k-50k / 15-60m / 10-50',
    count: 20,
    views1: 100,
    views2: 200,
    parentHandle: ROSTER_JA,
    parentText: 'ローンチの話をもう少し具体的に書いてみた。',
    parentViews: 20_000,
    parentComments: 25,
    parentAgeMin: 30,
  },
  {
    label: 'roster-en / <1k / 1-6h / <10',
    count: 4,
    views1: 50,
    views2: 90,
    parentHandle: ROSTER_EN,
    parentText: 'shipped the boring version and it worked',
    parentViews: 500,
    parentComments: 5,
    parentAgeMin: 180,
  },
  {
    // No parent at all: the scrape missed it. `unknown` on all four axes — a
    // different fact from "small parent" (§7.11), never folded into a neighbour.
    label: 'no parent / unknown on every axis',
    count: 1,
    views1: 5,
    views2: 10,
    parentHandle: null,
    parentText: null,
    parentViews: null,
    parentComments: null,
    parentAgeMin: null,
  },
  {
    // Off roster, non-Latin parent text: arm comes from `detectScript`, which
    // only works because `orig_text` survived the round-trip un-translated.
    label: 'off-roster-nonlatin / 200k+ / <15m / 200+',
    count: 1,
    views1: 7,
    views2: 14,
    parentHandle: OFF_ROSTER,
    parentText: 'これはテストの投稿です。日本語の本文。',
    parentViews: 300_000,
    parentComments: 500,
    parentAgeMin: 10,
  },
  {
    label: 'off-roster-en / 50k-200k / >24h / 50-200',
    count: 1,
    views1: 8,
    views2: 16,
    parentHandle: OFF_ROSTER,
    parentText: 'a plain english post with no other script in it',
    parentViews: 60_000,
    parentComments: 100,
    parentAgeMin: 30 * 60,
  },
];

const TOTAL_REPLIES = SHAPES.reduce((n, s) => n + s.count, 0);
const TOTAL_VIEWS = SHAPES.reduce((n, s) => n + s.count * s.views2, 0);
const FIRST_CAPTURE_VIEWS = SHAPES.reduce((n, s) => n + s.count * s.views1, 0);

interface WireRow {
  tweetId: string;
  handle: string;
  text: string;
  comments: number;
  reposts: number;
  likes: number;
  bookmarks: number;
  views: number;
  time: string;
  orig?: {
    tweetId: string;
    handle: string;
    text: string;
    time: string;
    comments: number;
    likes: number;
    views: number;
  };
}

/** The same corpus twice, differing only in `views` — that IS the re-capture. */
function corpus(pass: 1 | 2): WireRow[] {
  const rows: WireRow[] = [];
  let i = 0;
  for (const shape of SHAPES) {
    for (let k = 0; k < shape.count; k++) {
      i += 1;
      // Each reply a minute apart, all comfortably inside the same UTC day.
      const at = new Date(REPLY_AT.getTime() + i * 60_000);
      const row: WireRow = {
        tweetId: tid(i),
        handle: SELF,
        text: `oh7 smoke reply ${i} (${shape.label})`,
        comments: 0,
        reposts: 0,
        likes: 1,
        bookmarks: 0,
        views: pass === 1 ? shape.views1 : shape.views2,
        time: at.toISOString(),
      };
      if (shape.parentHandle !== null && shape.parentAgeMin !== null) {
        row.orig = {
          tweetId: tid(500 + i),
          handle: shape.parentHandle,
          text: shape.parentText ?? '',
          time: new Date(at.getTime() - shape.parentAgeMin * 60_000).toISOString(),
          comments: shape.parentComments ?? 0,
          likes: 3,
          views: shape.parentViews ?? 0,
        };
      }
      rows.push(row);
    }
  }
  return rows;
}

// --------------------------------------------------------- teardown scaffolding

const runIds: string[] = [];
// Set the moment the smoke owns the operator's handle setting, so a mid-run
// failure still puts it back (fail() exits — no finally would run).
let restoreHandle: (() => void) | null = null;

function cleanup(): void {
  try {
    db.delete(harvestRows)
      .where(like(harvestRows.tweetId, `${TWEET_PREFIX}%`))
      .run();
    for (const id of runIds) db.delete(harvestRuns).where(eq(harvestRuns.id, id)).run();
    // `replies`-mode ingest logs a harvest_seen per parent (C1). person_events
    // references people, so events go first.
    db.delete(personEvents).where(inArray(personEvents.handle, PARENT_HANDLES)).run();
    db.delete(people).where(inArray(people.handle, PARENT_HANDLES)).run();
    db.delete(cannonTargets).where(inArray(cannonTargets.handle, PARENT_HANDLES)).run();
  } catch (err) {
    console.error(`  (cleanup failed: ${err instanceof Error ? err.message : err})`);
  }
  try {
    restoreHandle?.();
    restoreHandle = null;
  } catch (err) {
    console.error(`  (handle restore failed: ${err instanceof Error ? err.message : err})`);
  }
}

function fail(msg: string): never {
  cleanup();
  console.error(`FAIL: ${msg}`);
  process.exit(1);
}
function ok(msg: string): void {
  console.log(`  ok: ${msg}`);
}
function eq2(actual: unknown, expected: unknown, what: string): void {
  if (actual !== expected) fail(`${what}: got ${String(actual)}, expected ${String(expected)}`);
}

async function postJson<T = Record<string, unknown>>(
  path: string,
  body: unknown,
): Promise<{ status: number; json: T }> {
  const res = await app.request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, json: (text ? JSON.parse(text) : null) as T };
}

async function ownReplies(query = ''): Promise<OwnReplyPerformance> {
  const res = await app.request(`/x/playbook?minN=${MIN_N}${query}`);
  if (res.status !== 200) fail(`GET /x/playbook → ${res.status}: ${await res.text()}`);
  const body = (await res.json()) as { ownReplyPerformance?: OwnReplyPerformance };
  const perf = body.ownReplyPerformance;
  if (!perf) fail('GET /x/playbook no longer carries ownReplyPerformance');
  return perf;
}

interface CellBody {
  n: number;
  totalViews: number;
  avgYield: number | null;
  avgParentViews: number | null;
  sharePct: number;
  sufficient: boolean;
}

/** Every axis is asserted the same way: exact keys in CANONICAL order, exact
 *  counts, and the gate — a cell at or above n≥20 carries numbers, one under it
 *  carries its count and nulls. */
function assertAxis<T extends CellBody>(
  axis: string,
  cells: T[],
  keyOf: (cell: T) => string,
  expected: Array<[string, number]>,
): void {
  const got = cells.map((c) => `${keyOf(c)}=${c.n}`).join(' ');
  const want = expected.map(([k, n]) => `${k}=${n}`).join(' ');
  if (got !== want) fail(`${axis} cells: got [${got}], expected [${want}]`);
  for (const cell of cells) {
    const key = keyOf(cell);
    if (cell.sufficient !== cell.n >= MIN_N) fail(`${axis} ${key}: sufficient disagrees with n`);
    if (cell.sufficient) {
      if (cell.avgYield === null) fail(`${axis} ${key}: sufficient cell has no avgYield`);
    } else if (cell.avgYield !== null || cell.avgParentViews !== null) {
      fail(`${axis} ${key}: insufficient cell (n=${cell.n}) reported an average`);
    }
  }
  const share = cells.reduce((sum, c) => sum + c.sharePct, 0);
  if (Math.abs(share - 100) > 0.5) fail(`${axis} sharePct sums to ${share}, expected ~100`);
  const total = cells.reduce((sum, c) => sum + c.totalViews, 0);
  eq2(total, TOTAL_VIEWS, `${axis} cell views total`);
}

// ------------------------------------------------------------------ 1. setup

console.log('own-harvest smoke — latest-per-tweet read layer ($0, nothing here can spend)');

const prevHandle = resolveSetting('x.identity.selfHandle');
setSettings({ 'x.identity.selfHandle': SELF });
restoreHandle = (): void => {
  if (prevHandle.isDefault) resetSettings({ keys: ['x.identity.selfHandle'] });
  else setSettings({ 'x.identity.selfHandle': prevHandle.value });
};
ok(`x.identity.selfHandle → '${SELF}' (operator value snapshotted for restore)`);

// The roster the arm axis is derived against. `language: null` = English.
db.insert(cannonTargets)
  .values([
    { handle: ROSTER_JA, language: 'ja', active: true },
    { handle: ROSTER_EN, language: null, active: true },
  ])
  .onConflictDoNothing()
  .run();

// --------------------------------------------- 2. the run + the two captures

const run = await postJson<{ id: string; scope: string }>('/x/harvest/runs', {
  handle: SELF,
  mode: 'replies',
  scope: 'recent',
});
// Task 5's server-side whitelist: without it the panel's "My replies" preset
// scrapes 48h and then 400s on the very last call.
if (run.status !== 201) fail(`POST /x/harvest/runs scope=recent → ${run.status}`);
runIds.push(run.json.id);
eq2(run.json.scope, 'recent', 'run scope');
ok(`run ${run.json.id} created with scope 'recent'`);

const first = await postJson<{ inserted: number }>('/x/harvest/rows', {
  runId: run.json.id,
  rows: corpus(1),
});
if (first.status !== 201) fail(`first capture → ${first.status}: ${JSON.stringify(first.json)}`);
eq2(first.json.inserted, TOTAL_REPLIES, 'first capture inserted');

// The ingest stamps `captured_at` at request time. Two batches landing inside
// the same millisecond would make `max(captured_at)` a coin flip between them,
// which is a property of the clock, not of the code under test.
await Bun.sleep(10);

const second = await postJson<{ inserted: number }>('/x/harvest/rows', {
  runId: run.json.id,
  rows: corpus(2),
});
if (second.status !== 201) fail(`re-capture → ${second.status}: ${JSON.stringify(second.json)}`);
eq2(second.json.inserted, TOTAL_REPLIES, 're-capture inserted');
ok(
  `${TOTAL_REPLIES} replies captured twice → ${TOTAL_REPLIES * 2} rows stored (no dedup on write)`,
);

// A `posts`-mode row from the SAME handle, with a view count large enough that
// any leak is unmissable. §8: every harvest_rows reader carries a mode filter.
const postsRun = await postJson<{ id: string }>('/x/harvest/runs', {
  handle: SELF,
  mode: 'posts',
  scope: 'recent',
});
if (postsRun.status !== 201) fail(`posts-mode run → ${postsRun.status}`);
runIds.push(postsRun.json.id);
const decoy = await postJson('/x/harvest/rows', {
  runId: postsRun.json.id,
  rows: [
    {
      tweetId: tid(900),
      handle: SELF,
      text: 'oh7 smoke ORIGINAL — must never reach the reply tables',
      comments: 0,
      reposts: 0,
      likes: 0,
      bookmarks: 0,
      views: 999_999,
      time: new Date(REPLY_AT.getTime() + 60_000).toISOString(),
    },
  ],
});
if (decoy.status !== 201) fail(`posts-mode decoy row → ${decoy.status}`);

// ------------------------------------------------ 3. the dedup, in both directions

const perf = await ownReplies();
eq2(perf.totalMeasured, TOTAL_REPLIES, 'totalMeasured (each reply exactly once)');
eq2(perf.totalViews, TOTAL_VIEWS, 'totalViews (the LATER capture)');
if (perf.totalViews === TOTAL_VIEWS + FIRST_CAPTURE_VIEWS) fail('totals summed both captures');
if (perf.totalViews === FIRST_CAPTURE_VIEWS) fail('totals used the EARLIER capture (min, not max)');
eq2(perf.viewsPerReply, Math.round((TOTAL_VIEWS / TOTAL_REPLIES) * 100) / 100, 'viewsPerReply');
ok(
  `${TOTAL_REPLIES} measured / ${TOTAL_VIEWS} views / ${perf.viewsPerReply} per reply — the re-capture neither doubled the count nor kept the stale views`,
);
ok('the 999,999-view posts-mode row stayed out (mode filter, §8)');

// ---------------------------------------------------------- 4. the four axes

assertAxis('bands', perf.bands, (c) => c.band, [
  ['<1k', 4],
  ['10k-50k', 20],
  ['50k-200k', 1],
  ['200k+', 1],
  ['unknown', 1],
]);
assertAxis('latency', perf.latency, (c) => c.bucket, [
  ['<15m', 1],
  ['15-60m', 20],
  ['1-6h', 4],
  ['>24h', 1],
  ['unknown', 1],
]);
assertAxis('crowding', perf.crowding, (c) => c.bucket, [
  ['<10', 4],
  ['10-50', 20],
  ['50-200', 1],
  ['200+', 1],
  ['unknown', 1],
]);
assertAxis('arms', perf.arms, (c) => c.arm, [
  ['roster-ja', 20],
  ['roster-en', 4],
  ['off-roster-nonlatin', 1],
  ['off-roster-en', 1],
  ['unknown', 1],
]);
ok('band / latency / crowding / arm cells: canonical order, exact counts, shares sum to 100');

// The gate, both directions, on the one cell big enough to clear it.
const gated = perf.bands.find((c) => c.band === '10k-50k');
if (!gated) fail('the 20-row band cell vanished');
eq2(gated.avgYield, 200, 'gated cell avgYield (the later capture, averaged)');
eq2(gated.avgParentViews, 20_000, 'gated cell avgParentViews');
const under = perf.bands.find((c) => c.band === '<1k');
if (!under) fail('the 4-row band cell vanished');
eq2(under.n, 4, 'under-gate cell still reports its n');
eq2(under.avgYield, null, 'under-gate cell nulls avgYield');
ok(`gate at n≥${MIN_N}: the 20-row cell carries numbers, the 4-row cell carries only its count`);

// `unknown` is a bucket, never a fold into the smallest neighbour (§7.11).
for (const [axis, present] of [
  ['bands', perf.bands.some((c) => c.band === 'unknown')],
  ['latency', perf.latency.some((c) => c.bucket === 'unknown')],
  ['crowding', perf.crowding.some((c) => c.bucket === 'unknown')],
  ['arms', perf.arms.some((c) => c.arm === 'unknown')],
] as const) {
  if (!present) fail(`${axis}: the parentless reply did not land in its own 'unknown' cell`);
}
ok("the parentless reply sits in 'unknown' on all four axes, not in the bottom bucket");

// --------------------------------------------------------- 5. the brief fact

interface BriefBody {
  harvestedReplies: { day: string; n: number; totalViews: number; viewsPerReply: number } | null;
}
async function briefFact(): Promise<BriefBody['harvestedReplies']> {
  const res = await app.request('/x/brief?tzOffsetMin=0');
  if (res.status !== 200) fail(`GET /x/brief → ${res.status}: ${await res.text()}`);
  return ((await res.json()) as BriefBody).harvestedReplies;
}

const fact = await briefFact();
if (!fact) fail('brief carried no harvestedReplies fact for the seeded day');
eq2(fact.day, REPLY_DAY, 'brief fact day');
eq2(fact.n, TOTAL_REPLIES, 'brief fact n (deduped, same rule as the Playbook)');
eq2(fact.totalViews, TOTAL_VIEWS, 'brief fact totalViews');
eq2(fact.viewsPerReply, Math.round((TOTAL_VIEWS / TOTAL_REPLIES) * 10) / 10, 'brief viewsPerReply');
ok(`Today brief: ${fact.day} — ${fact.n} replies · ${fact.viewsPerReply} views/reply`);

// ------------------------------------------------- 6. the unset-handle answer

setSettings({ 'x.identity.selfHandle': '' });
const empty = await ownReplies();
eq2(empty.totalMeasured, 0, 'unset handle: totalMeasured');
eq2(empty.totalViews, 0, 'unset handle: totalViews');
eq2(empty.viewsPerReply, null, 'unset handle: viewsPerReply');
if (empty.bands.length + empty.latency.length + empty.crowding.length + empty.arms.length !== 0) {
  fail('unset handle produced cells — the empty shape must have none');
}
if ((await briefFact()) !== null) fail('unset handle: brief fact is not null');
ok('handle unset → empty shape everywhere and a null brief fact, never a guess and never a 0');
setSettings({ 'x.identity.selfHandle': SELF });

// ------------------------------------------------------ 7. window validation

for (const bad of ['0', '91', '7.5']) {
  const res = await app.request(`/x/playbook?ownReplyDays=${bad}`);
  if (res.status !== 400) fail(`?ownReplyDays=${bad} → ${res.status}, expected 400`);
  const body = (await res.json()) as { error?: string };
  eq2(body.error, 'invalid_own_reply_days', `?ownReplyDays=${bad} error`);
}
// The window is on tweet_time and measured back from now, so a 2-day reach
// always covers a reply posted at noon yesterday whatever hour this runs at.
const narrow = await ownReplies('&ownReplyDays=2');
eq2(narrow.totalMeasured, TOTAL_REPLIES, '2-day window still holds the seeded day');
ok('?ownReplyDays: 0/91/7.5 refused with invalid_own_reply_days, 2 accepted');

// ---------------------------------------------------------------- 8. cleanup

cleanup();
const leftRows = await db
  .select({ id: harvestRows.id })
  .from(harvestRows)
  .where(like(harvestRows.tweetId, `${TWEET_PREFIX}%`));
if (leftRows.length > 0) fail(`${leftRows.length} smoke harvest rows survived cleanup`);
const leftRuns = await db
  .select({ id: harvestRuns.id })
  .from(harvestRuns)
  .where(eq(harvestRuns.handle, SELF));
if (leftRuns.length > 0) fail(`${leftRuns.length} smoke runs survived cleanup`);
const leftPeople = await db
  .select({ handle: people.handle })
  .from(people)
  .where(inArray(people.handle, PARENT_HANDLES));
if (leftPeople.length > 0) fail(`${leftPeople.length} smoke people rows survived cleanup`);
const restored = resolveSetting('x.identity.selfHandle');
if (restored.isDefault !== prevHandle.isDefault || restored.value !== prevHandle.value) {
  fail('x.identity.selfHandle was not restored to the operator value');
}
ok('every seeded row, run, person and roster entry removed; the handle setting is back');

console.log('\nPASS ($0 — no X API, no LLM, no billed call on any path).');
process.exit(0);
