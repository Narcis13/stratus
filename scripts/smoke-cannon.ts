// One-shot smoke for the Cannon queue (CQ.1–CQ.7). Mounts the cannon, radar,
// people and replies routers in-process (no port, no workers) against the REAL
// DB and drives the roster end to end at **$0** by default.
//
//   1. Two `cannon_targets` created through the route — one seeded above the
//      sample gate, one below — then `POST /x/cannon/rescore`, then the rows
//      READ BACK from the table (RC.5: a txn write is proved by a read-back, not
//      by a green call). `[score, sampleN, scoredAt]` is asserted on both, and
//      the under-gate handle must land `score: null` with `scoredAt` SET — "we
//      looked and there wasn't enough" is a different fact from "never scored"
//      (§7.11), and only a read-back can tell the two apart.
//   2. `GET /x/cannon/targets` — rank order (score desc, nulls last), the
//      `belowFloor` flag against the LIVE `x.cannon.scoreMin` knob (moved through
//      the registry and moved back), and `staleDays`.
//   3. `GET /x/cannon/candidates` — a third harvested handle that is NOT on the
//      roster shows up; both targets are excluded; `limit` clamps.
//   4. `mode='replies'` rows are not counted (§8): the same handle harvested in
//      replies mode adds nothing to its sample.
//   5. `GET /x/radar/placed-today` shape + the one-line proof it is safe to poll
//      (`streaks` row count unchanged across the call).
//   6. `GET /x/people/glance` carries `isCannon` for a camped handle with no
//      `people` row, and drops it when the target is benched.
//   7. DELETE both targets and confirm the seeded `harvest_rows` are UNTOUCHED —
//      a dropped target is not history, but the corpus it was scored from is.
//
//   bun run scripts/smoke-cannon.ts            # $0, rerunnable
//   bun run scripts/smoke-cannon.ts --live     # + ONE real batch draft with a
//                                              #   language (~$0.002–0.01)
//
// `--live` exists because Task CQ.7 shipped (D171c, answered per surface): the
// reply-language clause is the ONE thing in this feature that can reach
// `askLLM`, and a keyless run cannot claim that the model actually honors a
// tail-stamped `Write all variants in ${language}` line. Everything in steps 1–7
// is structurally $0 — nothing under `/x/cannon` may import `xFetch` or
// `askLLM` — so the flag guards exactly one call and nothing else.
//
// Rerunnable: every row this script writes is namespaced (`smokecannon*` handles,
// an `88300…` tweet-id prefix, its own `harvest_runs` row) and deleted from both
// the success path and `fail()`; the one settings knob it moves is snapshotted by
// `isDefault` and restored the same way (D113(d) — a reset would DELETE an
// override the operator set on purpose).

import { and, eq, inArray, like } from 'drizzle-orm';
import { Hono } from 'hono';
import { db } from '../src/db/client.ts';
import { llmConfigured } from '../src/llm/index.ts';
import { CANNON } from '../src/shared/cannon.ts';
import { CANNON_MIN_SAMPLE, CANNON_SAMPLE_POSTS } from '../src/x/cannon/roster.ts';
import { cannonTargets, harvestRows, harvestRuns, streaks } from '../src/x/db/schema.ts';
import { cannonRouter } from '../src/x/routes/cannon.ts';
import { peopleRouter } from '../src/x/routes/people.ts';
import { radar } from '../src/x/routes/radar.ts';
import { replies } from '../src/x/routes/replies.ts';
import { settingsRouter } from '../src/x/routes/settings.ts';
import { resetSettings, resolveSetting, setSettings } from '../src/x/settings/registry.ts';

const LIVE = process.argv.includes('--live');

const app = new Hono();
app.route('/x', cannonRouter);
app.route('/x', radar);
app.route('/x', peopleRouter);
app.route('/x', replies);
app.route('/x', settingsRouter);

// ------------------------------------------------------- fixtures + cleanup

// A camped handle with a fat sample: 10 posts, median views 12,000, median
// comments 3 → score 3,000. Well clear of any floor this feature ships with.
const RICH = 'smokecannonrich';
// A camped handle harvested exactly 3 times — under CANNON_MIN_SAMPLE (8), so it
// must read `score: null` however good those 3 posts look.
const THIN = 'smokecannonthin';
// Never added to the roster: the discovery list has to find it.
const CAND = 'smokecannoncand';
const HANDLES = [RICH, THIN, CAND];

const TWEET_PREFIX = '883000000000';
const RUN_HANDLE = 'smokecannonrun';

const KNOBS = ['x.cannon.scoreMin'];
const knobSnapshot = new Map<string, { value: unknown; isDefault: boolean }>();
for (const key of KNOBS) knobSnapshot.set(key, resolveSetting(key));

/** Put the operator's own knobs back. Sync (bun:sqlite) so `fail()` can run it. */
function restoreKnobs(): void {
  for (const [key, prev] of knobSnapshot) {
    if (prev.isDefault) resetSettings({ keys: [key] });
    else setSettings({ [key]: prev.value });
  }
}

function cleanupRows(): void {
  db.delete(cannonTargets).where(inArray(cannonTargets.handle, HANDLES)).run();
  db.delete(harvestRows)
    .where(like(harvestRows.tweetId, `${TWEET_PREFIX}%`))
    .run();
  db.delete(harvestRuns).where(eq(harvestRuns.handle, RUN_HANDLE)).run();
}

function fail(msg: string): never {
  console.error(`FAIL: ${msg}`);
  restoreKnobs();
  cleanupRows();
  process.exit(1);
}

function ok(msg: string): void {
  console.log(`  ok: ${msg}`);
}

async function get(path: string): Promise<{ status: number; body: unknown }> {
  const res = await app.request(path);
  return { status: res.status, body: res.status === 204 ? null : await res.json() };
}

async function post(path: string, body: unknown): Promise<{ status: number; body: unknown }> {
  const res = await app.request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: res.status === 204 ? null : await res.json() };
}

async function patch(path: string, body: unknown): Promise<{ status: number; body: unknown }> {
  const res = await app.request(path, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: res.status === 204 ? null : await res.json() };
}

async function del(path: string): Promise<{ status: number; body: unknown }> {
  const res = await app.request(path, { method: 'DELETE' });
  return { status: res.status, body: res.status === 204 ? null : await res.json() };
}

function errorCode(body: unknown): string {
  return typeof body === 'object' && body !== null && 'error' in body
    ? String((body as { error: unknown }).error)
    : `<no error field: ${JSON.stringify(body)}>`;
}

interface TargetView {
  handle: string;
  score: number | null;
  sampleN: number;
  scoredAt: string | null;
  staleDays: number | null;
  belowFloor: boolean;
  active: boolean;
  language: string | null;
}

// Start clean in case an earlier run died mid-way.
restoreKnobs();
cleanupRows();

// ============================================================================
// 1. Two targets, a seeded corpus, one rescore — read back from the table
// ============================================================================
console.log('1. targets → harvest_rows → POST /x/cannon/rescore → read the rows back');

const HOUR = 60 * 60 * 1000;
const now = Date.now();
let seededRowIds: number[] = [];

{
  // Create both through the route, so the handle normalization and the
  // fill-only upsert are the ones the panel actually hits.
  const created = await post('/x/cannon/targets', {
    handle: `@${RICH.toUpperCase()}`, // normalization: '@' stripped, lowercased
    displayName: 'Smoke Cannon Rich',
    language: 'Japanese',
    notes: 'smoke fixture',
  });
  if (created.status !== 201) fail(`POST targets → ${created.status} ${errorCode(created.body)}`);
  if ((created.body as TargetView).handle !== RICH) {
    fail(`'@${RICH.toUpperCase()}' normalized to ${(created.body as TargetView).handle}`);
  }
  const thin = await post('/x/cannon/targets', { handle: THIN });
  if (thin.status !== 201) fail(`POST targets (thin) → ${thin.status} ${errorCode(thin.body)}`);
  // Never scored yet: null score, and `staleDays` null rather than 0 (§7.11).
  const thinView = thin.body as TargetView;
  if (thinView.score !== null || thinView.scoredAt !== null || thinView.staleDays !== null) {
    fail(`a brand-new target reads ${JSON.stringify(thinView)} — want nulls throughout`);
  }
  ok(`two targets created; '@${RICH.toUpperCase()}' → '${RICH}'; a new one is score:null`);

  // The corpus. One run row, then the posts. RICH gets 10 posts (median views
  // 12,000, median comments 3 → 12000/4 = 3,000); THIN gets 3; CAND gets 9 so
  // the candidates list has something to find. Plus two `mode='replies'` rows
  // for RICH that must NOT be counted (§8), and one re-capture of a RICH tweet
  // to exercise the latest-capture dedupe.
  const [run] = await db
    .insert(harvestRuns)
    .values({ handle: RUN_HANDLE, mode: 'posts', scope: 'all', rowCount: 0 })
    .returning();
  if (!run) fail('could not seed a harvest_runs row');

  let n = 0;
  const seed = (
    handle: string,
    views: number,
    comments: number,
    mode: string,
    opts?: { tweetId?: string; capturedAt?: number },
  ) => {
    n += 1;
    return {
      runId: run.id,
      tweetId: opts?.tweetId ?? `${TWEET_PREFIX}${String(1000 + n).padStart(6, '0')}`,
      handle,
      mode,
      text: `smoke cannon fixture ${n}`,
      comments,
      views,
      tweetTime: new Date(now - n * HOUR),
      capturedAt: new Date(opts?.capturedAt ?? now - n * HOUR),
    };
  };

  // views 8k..16k in 2k steps over 10 posts → median 12,000; comments median 3.
  const richViews = [8000, 9000, 10000, 11000, 12000, 12000, 13000, 14000, 15000, 16000];
  const richComments = [1, 2, 2, 3, 3, 3, 4, 4, 5, 6];
  const rows = richViews.map((v, i) => seed(RICH, v, richComments[i] as number, 'posts'));
  const richFirstId = rows[0]?.tweetId as string;

  // A replies-mode row for RICH with absurd numbers: if the mode filter ever
  // slips, the median moves and step 1's assertion fails loudly.
  rows.push(seed(RICH, 999_999, 0, 'replies'));
  rows.push(seed(RICH, 999_999, 0, 'replies'));

  // A re-capture of RICH's first tweet, captured LATER with different numbers.
  // The dedupe keeps this one — same tweet, maturer reading (roster.ts note (b)).
  rows.push(seed(RICH, 8000, 1, 'posts', { tweetId: richFirstId, capturedAt: now }));

  for (let i = 0; i < 3; i += 1) rows.push(seed(THIN, 50_000, 0, 'posts'));
  for (let i = 0; i < 9; i += 1) rows.push(seed(CAND, 2000 + i * 100, 1, 'timeline'));

  const inserted = await db.insert(harvestRows).values(rows).returning({ id: harvestRows.id });
  seededRowIds = inserted.map((r) => r.id);
  ok(
    `seeded ${rows.length} harvest_rows (${richViews.length} posts + 2 replies + 1 re-capture for @${RICH}, 3 for @${THIN}, 9 for @${CAND})`,
  );

  const rescored = await post('/x/cannon/rescore', {});
  if (rescored.status !== 200) fail(`rescore → ${rescored.status} ${errorCode(rescored.body)}`);
  const res = rescored.body as {
    scored: number;
    skipped: Array<{ handle: string; sampleN: number; reason: string }>;
    samplePosts: number;
    minSample: number;
  };
  if (res.samplePosts !== CANNON_SAMPLE_POSTS || res.minSample !== CANNON_MIN_SAMPLE) {
    fail(`rescore reported window ${res.samplePosts}/${res.minSample} — not the module's`);
  }
  const skippedThin = res.skipped.find((s) => s.handle === THIN);
  if (!skippedThin || skippedThin.reason !== 'insufficient_sample' || skippedThin.sampleN !== 3) {
    fail(`@${THIN} should be skipped with sampleN 3, got ${JSON.stringify(res.skipped)}`);
  }
  ok(`rescore: scored=${res.scored}, @${THIN} skipped as insufficient_sample (n=3)`);

  // ---- THE READ-BACK (RC.5). Straight off the table, not through the route
  // that just wrote it: the rescore write is one sync txn, and a txn that
  // silently rolled back looks exactly like a green 200 from here.
  const stored = await db
    .select()
    .from(cannonTargets)
    .where(inArray(cannonTargets.handle, [RICH, THIN]));
  const byHandle = new Map(stored.map((r) => [r.handle, r]));
  const rich = byHandle.get(RICH);
  const thinRow = byHandle.get(THIN);
  if (!rich || !thinRow) fail('a target went missing between the rescore and the read-back');

  // 12,000 / (3 + 1) = 3,000. The two replies rows and the re-capture are why
  // this number is an assertion and not a range.
  if (rich.score !== 3000) fail(`@${RICH} stored score ${rich.score}, want 3000`);
  if (rich.medianViews !== 12000 || rich.medianComments !== 3) {
    fail(`@${RICH} medians ${rich.medianViews}/${rich.medianComments}, want 12000/3`);
  }
  if (rich.sampleN !== 10) fail(`@${RICH} sampleN ${rich.sampleN}, want 10 (dedupe kept one)`);
  if (rich.scoredAt === null) fail(`@${RICH} was scored but carries no scoredAt`);
  ok(`@${RICH}: [score 3000, sampleN 10, scoredAt set] — replies rows and the dupe both ignored`);

  // The §7.11 pair, and the reason this is a read-back and not a route call:
  // null score WITH a scoredAt stamp. Zero would be a real verdict; it isn't one.
  if (thinRow.score !== null) fail(`@${THIN} stored score ${thinRow.score}, want null (never 0)`);
  if (thinRow.sampleN !== 3) fail(`@${THIN} sampleN ${thinRow.sampleN}, want 3`);
  if (thinRow.scoredAt === null) {
    fail(`@${THIN} has no scoredAt — "looked, not enough" collapsed into "never scored"`);
  }
  ok(`@${THIN}: [score null, sampleN 3, scoredAt set] — under the gate is not a zero`);
}

// ============================================================================
// 2. GET /x/cannon/targets — ordering, belowFloor against the live knob
// ============================================================================
console.log('2. GET /x/cannon/targets — rank order + belowFloor against x.cannon.scoreMin');
{
  const listed = await get('/x/cannon/targets');
  if (listed.status !== 200) fail(`GET targets → ${listed.status}`);
  const { floor, targets } = listed.body as { floor: number; targets: TargetView[] };
  const ours = targets.filter((t) => HANDLES.includes(t.handle));
  if (ours.length !== 2) fail(`the list carries ${ours.length} of our 2 targets`);
  // Scored first, never-scored last — whatever else is on the operator's roster.
  const richIdx = targets.findIndex((t) => t.handle === RICH);
  const thinIdx = targets.findIndex((t) => t.handle === THIN);
  if (richIdx > thinIdx) fail(`a null score (@${THIN}) sorted above a 3000 (@${RICH})`);
  ok(`nulls last: @${RICH} at ${richIdx}, @${THIN} at ${thinIdx}; floor reported as ${floor}`);

  const richView = targets[richIdx] as TargetView;
  if (richView.staleDays !== 0) fail(`a just-scored target reads staleDays ${richView.staleDays}`);
  if (richView.language !== 'Japanese') fail('the language set at create time did not survive');
  const thinView = targets[thinIdx] as TargetView;
  if (thinView.belowFloor) fail('an unscored target reads belowFloor — absent is not below');
  ok('staleDays 0 on a fresh score; an unscored target is never belowFloor');

  // The floor is read per REQUEST (the money-knob discipline): move it above
  // 3000 through the settings route and the same row has to flip.
  if (richView.belowFloor)
    fail(`@${RICH} (3000) reads belowFloor at the shipped ${CANNON.scoreMin}`);
  const bumped = await patch('/x/settings', { 'x.cannon.scoreMin': 5000 });
  if (bumped.status !== 200) fail(`PATCH x.cannon.scoreMin → ${errorCode(bumped.body)}`);
  const after = (await get('/x/cannon/targets')).body as { floor: number; targets: TargetView[] };
  const richAfter = after.targets.find((t) => t.handle === RICH) as TargetView;
  if (after.floor !== 5000 || !richAfter.belowFloor) {
    fail(`the floor moved to 5000 but @${RICH} still reads belowFloor=${richAfter.belowFloor}`);
  }
  ok('scoreMin 5000 → the same 3000 row flips belowFloor: the floor is read per request');
  restoreKnobs();

  // The bench arm: `active=false` is what takes a handle out of the carve-out
  // and off the glance map (step 6 leans on this).
  const benched = await patch(`/x/cannon/targets/${RICH}`, { active: false });
  if (benched.status !== 200) fail(`PATCH active=false → ${errorCode(benched.body)}`);
  const activeOnly = (await get('/x/cannon/targets?active=true')).body as { targets: TargetView[] };
  if (activeOnly.targets.some((t) => t.handle === RICH))
    fail('a benched target is still ?active=true');
  ok('PATCH active=false benches the handle and ?active=true drops it');
}

// ============================================================================
// 3. GET /x/cannon/candidates — the discovery list excludes existing targets
// ============================================================================
console.log(`3. GET /x/cannon/candidates — @${CAND} found, both targets excluded`);
{
  const listed = await get('/x/cannon/candidates?limit=50&minSample=8');
  if (listed.status !== 200) fail(`GET candidates → ${listed.status} ${errorCode(listed.body)}`);
  const { limit, minSample, candidates } = listed.body as {
    limit: number;
    minSample: number;
    candidates: Array<{ handle: string; score: number; sampleN: number }>;
  };
  if (limit !== 50 || minSample !== CANNON_MIN_SAMPLE) {
    fail(`candidates echoed limit=${limit} minSample=${minSample}`);
  }
  const found = candidates.find((c) => c.handle === CAND);
  if (!found) fail(`@${CAND} (9 harvested posts, not a target) is absent from the candidates list`);
  if (found.sampleN !== 9) fail(`@${CAND} sampleN ${found.sampleN}, want 9`);
  ok(`@${CAND} found: score ${found.score.toFixed(1)}, n=${found.sampleN}`);

  // A benched target is still a TARGET — the exclusion is membership, not
  // activity. Both of ours must be gone from a list that is about who to ADD.
  for (const h of [RICH, THIN]) {
    if (candidates.some((c) => c.handle === h)) fail(`@${h} is a target but shows as a candidate`);
  }
  ok('both targets excluded (the benched one too — exclusion is membership, not activity)');

  // The `intParam` contract: out of range clamps, non-integer 400s.
  const clamped = (await get('/x/cannon/candidates?limit=999')).body as { limit: number };
  if (clamped.limit !== 50) fail(`limit=999 clamped to ${clamped.limit}, want 50`);
  const bad = await get('/x/cannon/candidates?limit=abc');
  if (bad.status !== 400 || errorCode(bad.body) !== 'invalid_limit') {
    fail(`limit=abc wanted 400 invalid_limit, got ${bad.status} ${errorCode(bad.body)}`);
  }
  ok('limit=999 clamps to 50; limit=abc is a 400 invalid_limit');
}

// ============================================================================
// 4. The mode filter, isolated (§8)
// ============================================================================
console.log("4. mode='replies' rows are not the author's posts");
{
  // @RICH's two replies rows carry 999,999 views and 0 comments each. If the
  // filter ever slips they would drag the median from 12,000 up past 100,000 —
  // scoring "how many eyes their REPLIES get" under the column named for posts.
  const [row] = await db.select().from(cannonTargets).where(eq(cannonTargets.handle, RICH));
  if (!row || row.medianViews !== 12000) {
    fail(`@${RICH} medianViews ${row?.medianViews} — the mode filter let replies rows in`);
  }
  const replyRows = await db
    .select({ id: harvestRows.id })
    .from(harvestRows)
    .where(and(eq(harvestRows.handle, RICH), eq(harvestRows.mode, 'replies')));
  if (replyRows.length !== 2)
    fail('the replies fixtures are not in the table — step 4 proves nothing');
  ok('2 replies-mode rows at 999,999 views sit in the table and moved nothing');
}

// ============================================================================
// 5. GET /x/radar/placed-today — shape, and the proof it is safe to poll
// ============================================================================
console.log('5. GET /x/radar/placed-today — shape + writes nothing');
{
  const streaksBefore = db.select().from(streaks).all().length;

  const r = await get('/x/radar/placed-today?tzOffsetMin=-120');
  if (r.status !== 200) fail(`placed-today → ${r.status} ${errorCode(r.body)}`);
  const body = r.body as { dayKey: string; placed: number; target: number };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(body.dayKey)) fail(`dayKey ${body.dayKey} is not YYYY-MM-DD`);
  if (!Number.isInteger(body.placed) || body.placed < 0) fail(`placed = ${body.placed}`);
  if (!Number.isInteger(body.target) || body.target <= 0) fail(`target = ${body.target}`);
  ok(`{dayKey ${body.dayKey}, placed ${body.placed}, target ${body.target}}`);

  const bad = await get('/x/radar/placed-today?tzOffsetMin=9999');
  if (bad.status !== 400 || errorCode(bad.body) !== 'invalid_tz_offset_min') {
    fail(`tzOffsetMin=9999 wanted 400 invalid_tz_offset_min, got ${bad.status}`);
  }
  ok('an out-of-range tzOffsetMin is a 400');

  // The one-line proof. `GET /brief` reports the same number but upserts a
  // streak on the way, which is exactly why the panel may poll this route and
  // may not poll that one.
  const streaksAfter = db.select().from(streaks).all().length;
  if (streaksAfter !== streaksBefore) {
    fail(`placed-today wrote ${streaksAfter - streaksBefore} streaks rows — it must write nothing`);
  }
  ok('streaks unchanged across the call — safe to poll, unlike GET /brief');
}

// ============================================================================
// 6. GET /x/people/glance carries isCannon
// ============================================================================
console.log('6. GET /x/people/glance — isCannon on a camped handle with no people row');
{
  // @THIN is camped and has no CRM row at all — the case the capture arm needs
  // most, since camping an account for reach implies no relationship with it.
  const glance = (await get('/x/people/glance')).body as {
    count: number;
    map: Record<string, { isCannon: boolean; isTarget: boolean; stage: string }>;
  };
  const thinEntry = glance.map[THIN];
  if (!thinEntry) fail(`@${THIN} is camped but absent from the glance map`);
  if (!thinEntry.isCannon) fail(`@${THIN} carries isCannon=false`);
  if (thinEntry.stage !== 'stranger')
    fail(`the bare backfill gave @${THIN} stage ${thinEntry.stage}`);
  ok(`@${THIN}: {isCannon: true, stage: 'stranger'} — backfilled with no people row`);

  // @RICH was benched in step 2. `loadCannonHandles()` is active-only, so it
  // must NOT be flagged — otherwise benching is a no-op that looks like a
  // decision.
  const richEntry = glance.map[RICH];
  if (richEntry?.isCannon) fail(`benched @${RICH} still reads isCannon=true`);
  ok(`benched @${RICH} is not flagged — active=0 really takes a handle off the roster`);

  // And back on when re-camped, through the route.
  const recamped = await patch(`/x/cannon/targets/${RICH}`, { active: true });
  if (recamped.status !== 200) fail(`re-camp → ${errorCode(recamped.body)}`);
  const again = (await get('/x/people/glance')).body as {
    map: Record<string, { isCannon: boolean }>;
  };
  if (!again.map[RICH]?.isCannon) fail(`re-camping @${RICH} did not restore isCannon`);
  ok(`re-camping @${RICH} restores isCannon on the next read`);
}

// ============================================================================
// 7. DELETE — the target goes, the corpus stays
// ============================================================================
console.log('7. DELETE /x/cannon/targets/:handle — hard delete, harvest untouched');
{
  for (const h of [RICH, THIN]) {
    const gone = await del(`/x/cannon/targets/${h}`);
    if (gone.status !== 204) fail(`DELETE @${h} → ${gone.status} ${errorCode(gone.body)}`);
  }
  const missing = await del(`/x/cannon/targets/${RICH}`);
  if (missing.status !== 404) fail(`a second DELETE wanted 404, got ${missing.status}`);
  const left = await db.select().from(cannonTargets).where(inArray(cannonTargets.handle, HANDLES));
  if (left.length !== 0) fail(`${left.length} of our targets survived the delete`);
  ok('both targets hard-deleted; re-deleting is a 404');

  // The whole point of a hard delete being safe: the rows the score came from
  // are still there, so re-adding the handle and rescoring rebuilds it exactly.
  const survivors = await db
    .select({ id: harvestRows.id })
    .from(harvestRows)
    .where(inArray(harvestRows.id, seededRowIds));
  if (survivors.length !== seededRowIds.length) {
    fail(`dropping a target took ${seededRowIds.length - survivors.length} harvest_rows with it`);
  }
  ok(`all ${seededRowIds.length} seeded harvest_rows untouched — a dropped target is rebuildable`);

  // Prove it: re-add and rescore, and the same 3,000 comes back.
  await post('/x/cannon/targets', { handle: RICH });
  await post('/x/cannon/rescore', { handles: [RICH] });
  const [rebuilt] = await db.select().from(cannonTargets).where(eq(cannonTargets.handle, RICH));
  if (rebuilt?.score !== 3000) fail(`the rebuilt score is ${rebuilt?.score}, want 3000`);
  ok('re-add + rescore reproduces score 3000 from the surviving corpus');
}

// ============================================================================
// 8. --live — the only way to prove the model honors the language clause
// ============================================================================
if (LIVE) {
  console.log('8. --live: ONE batch draft with a language (~$0.002–0.01)');
  if (!llmConfigured()) {
    fail('--live needs an LLM provider (set XAI_API_KEY or OPENROUTER_API_KEY)');
  }
  const LANGUAGE = 'Japanese';
  const r = await post('/x/replies/generate-batch', {
    language: LANGUAGE,
    tweets: [
      {
        tweetId: `${TWEET_PREFIX}999001`,
        handle: 'smoke_cannon',
        author: 'Smoke Cannon',
        text: 'Shipped a scheduler that batches DB writes into one transaction. Wall time went 900ms → 40ms. The trick was refusing to await inside the loop.',
        band: 'cannon',
      },
    ],
  });
  if (r.status !== 200)
    fail(`generate-batch → ${r.status}: ${JSON.stringify(r.body).slice(0, 200)}`);
  const body = r.body as {
    drafts: Array<{ tweetId: string; variants: Array<{ text: string }> }>;
    costUsd: number;
    model: string;
  };
  const draft = body.drafts[0];
  if (!draft || draft.variants.length === 0) fail('a live batch came back with no variants');
  // The clause is a drafting instruction, so the assertion is on the RENDERED
  // output, not on the prompt: Japanese text has to carry kana/kanji. A latin-
  // only answer means the tail clause was ignored, which is the one thing this
  // flag exists to catch.
  const jp = /[぀-ヿ一-鿿]/;
  const honored = draft.variants.filter((v) => jp.test(v.text)).length;
  if (honored === 0) {
    fail(`language='${LANGUAGE}' produced no kana/kanji in ${draft.variants.length} variants`);
  }
  ok(
    `${honored}/${draft.variants.length} variants in ${LANGUAGE}, cost $${body.costUsd.toFixed(4)} model=${body.model}`,
  );
  for (const v of draft.variants) console.log(`     ${v.text.slice(0, 90)}`);

  // The batch path persists radar_drafts / reply_drafts rows; the cleanup below
  // does not reach them, so the id is namespaced under TWEET_PREFIX and dropped
  // here the way smoke-radar-curate.ts drops its own.
  db.run(`delete from radar_drafts where tweet_id like '${TWEET_PREFIX}%'`);
  db.run(`delete from reply_drafts where tweet_id like '${TWEET_PREFIX}%'`);
  ok('live rows dropped');
}

restoreKnobs();
cleanupRows();
ok('cleanup');

console.log('SMOKE PASS');
process.exit(0);
