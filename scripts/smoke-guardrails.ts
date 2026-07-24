// One-shot $0 smoke for the Guardrails phase (GR.1–GR.10) — the following
// ledger + curation queue, the activity monitor and its schedule-time advisory,
// and the accountability layer (goals, commitments, weekly scorecard). Mounts
// the following/monitor/goals/me/calendar/brief/digest routers in-process
// against the real DB: no port, no workers, no X API, no LLM.
//
// What it drives, in order:
//   1. run -> 9-row batch -> a PARTIAL run flips nothing
//   2. a second run closed done:true -> the reconcile (gone / confirmed /
//      requeued); "unseen" is per RUN, not per batch
//   3. GET /following/queue -> the grace window, the mutual-stage whitelist,
//      `keep` and follows-back all excluded; the release is idempotent
//   4. PATCH done -> the mark lands, the window/daily budget moves, the handle
//      leaves the batch; a `keep` pin revokes a queued row on the next read
//   5. goals + commitments: pacing, the lazy achieved/missed flip, and the
//      commitment override showing up in the brief's quest targets
//   6. seeded burst / near-duplicate / churn -> GET /monitor alerts, and
//      POST /posts/scheduled -> the amber `warnings` array
//   7. GET /digest?factsOnly -> the weekly scorecard, present at 5 tracked days
//      and null at 3 (the SCORECARD_MIN_DAYS gate)
//
// REAL-DB SAFETY (the interesting part — same discipline as
// scripts/smoke-passive-harvest.ts, D98c):
//   * every row this script writes is namespaced — `gr10_*` handles (no real
//     scrape produces one), 889-prefixed tweet ids (no real snowflake starts
//     there), `gr10 smoke` text prefixes — so cleanup keys are exact.
//   * a complete-run reconcile is GLOBAL: it marks every unseen live handle
//     `gone`. So the statuses of all foreign `following` rows are snapshotted
//     before the first write and restored on the way out (and from fail()).
//     Reading the queue is likewise a write — the same one the People tab makes
//     when you open it — and the same snapshot covers it.
//   * `commitments`, and the `streaks`/`digests` rows the scorecard week needs,
//     are snapshotted and restored rather than deleted.
//   * seeded own posts are written `retired: true` (NT.7) so an aborted run can
//     never leave a row the daily 03:00 pass would pay to read.
//   * the seeded originals sit inside today's window, so the run ENDS with one
//     more GET /x/brief: the C9 streak diary is recomputed from clean data
//     rather than left describing fixtures (recompute, never restore).
//
// Run: bun run scripts/smoke-guardrails.ts

import { eq, inArray, like } from 'drizzle-orm';
import { Hono } from 'hono';
import { db } from '../src/db/client.ts';
import { DAILY_CEILING, GRACE_DAYS } from '../src/x/connections.ts';
import {
  commitments,
  digests,
  following,
  followingRuns,
  meGoals,
  people,
  postsPublished,
  scheduledPosts,
  streaks,
} from '../src/x/db/schema.ts';
import { SCORECARD_MIN_DAYS, shiftDayKey } from '../src/x/goals.ts';
import {
  NEAR_DUPLICATE_THRESHOLD,
  POST_BURST_MAX,
  SCHEDULE_CLUSTER_MS,
  UNFOLLOW_CHURN_WARN,
} from '../src/x/monitor.ts';
import { brief } from '../src/x/routes/brief.ts';
import { calendar } from '../src/x/routes/calendar.ts';
import { digest } from '../src/x/routes/digest.ts';
import { followingRouter } from '../src/x/routes/following.ts';
import { goalsRouter } from '../src/x/routes/goals.ts';
import { me } from '../src/x/routes/me.ts';
import { monitorRouter } from '../src/x/routes/monitor.ts';

const app = new Hono();
app.route('/x', followingRouter);
app.route('/x', monitorRouter);
app.route('/x', goalsRouter);
app.route('/x', me);
app.route('/x', calendar);
app.route('/x', brief);
app.route('/x', digest);

const MIN_MS = 60_000;
const HOUR_MS = 60 * MIN_MS;
const DAY_MS = 24 * HOUR_MS;

// ---------------------------------------------------------------- namespacing

// ≤15 chars each and lowercase — normalizePersonHandle silently drops anything
// longer, which would make every assertion around it vacuous (NT.2).
const STALE_A = 'gr10_stale_a';
const STALE_B = 'gr10_stale_b';
const ALLY = 'gr10_ally';
const KEEP = 'gr10_keep';
const FRESH = 'gr10_fresh';
const BACK = 'gr10_back';
const GONE = 'gr10_gone';
const TICKED = 'gr10_ticked';
const STUCK = 'gr10_stuck';

const LEDGER_HANDLES = [STALE_A, STALE_B, ALLY, KEEP, FRESH, BACK, GONE, TICKED, STUCK];
// Enough marks to trip the churn rule on their own, parked 8h back so they sit
// inside the 24h churn window but OUTSIDE the 6h release window — the queue's
// budget assertions must not depend on them.
const CHURN_HANDLES = Array.from(
  { length: UNFOLLOW_CHURN_WARN + 1 },
  (_, i) => `gr10_c${String(i).padStart(2, '0')}`,
);
const ALL_HANDLES = [...LEDGER_HANDLES, ...CHURN_HANDLES];

// 18 digits: real tweet ids are 19-digit snowflakes starting 1 or 2.
const TWEET_PREFIX = '889000000000000';
const tid = (n: number): string => `${TWEET_PREFIX}${String(n).padStart(3, '0')}`;
const BURST_IDS = Array.from({ length: POST_BURST_MAX + 1 }, (_, i) => tid(i));
const DUP_IDS = [tid(50), tid(51)];
const OWN_POST_IDS = [...BURST_IDS, ...DUP_IDS];

// Two of the burst posts land 10 min apart (the pair sub-condition); the rest
// spread across the day, all comfortably inside the 24h window.
const burstOffsetMs = (i: number): number =>
  i === 0 ? HOUR_MS : i === 1 ? HOUR_MS - 10 * MIN_MS : (i + 1) * 2 * HOUR_MS;
// Distinct enough that the burst fixtures never shingle into each other — only
// the DUP pair below may read as a near-duplicate.
const BURST_TAILS = [
  'shipping notes from an afternoon of wiring guardrails together',
  'a build log nobody asked for, kept anyway because measuring beats guessing',
  'one small idea about cadence that took three days to say plainly',
  'a rough draft of the thing I keep meaning to write properly',
  'an evening thought that survived until morning, which is rare',
];

const TEXT_PREFIX = 'gr10 smoke';
const DUP_TEXT = `${TEXT_PREFIX} — the same sentence twice is its own penalty, and the monitor should say so out loud`;
const QUEUED_TEXT = `${TEXT_PREFIX} — two pending slots twenty minutes apart is a cadence smell worth a warning line`;

// The scorecard weeks: far enough back that the real C9 diary cannot own them,
// and both are Mondays (the digest's week keys).
const GRADED_WEEK = '2025-01-06';
const THIN_WEEK = '2025-01-20';
const PREV_WEEK = shiftDayKey(GRADED_WEEK, -7);
const PREV_SCORE = 60;
const GRADED_DAYS_TRACKED = SCORECARD_MIN_DAYS + 1;
const GRADED_DAYS_ALL_DONE = 3;
const THIN_DAYS_TRACKED = SCORECARD_MIN_DAYS - 1;
const GRADED_DAY_KEYS = Array.from({ length: GRADED_DAYS_TRACKED }, (_, i) =>
  shiftDayKey(GRADED_WEEK, i),
);
const THIN_DAY_KEYS = Array.from({ length: THIN_DAYS_TRACKED }, (_, i) =>
  shiftDayKey(THIN_WEEK, i),
);
const SEEDED_DAY_KEYS = [...GRADED_DAY_KEYS, ...THIN_DAY_KEYS];
const SEEDED_WEEK_KEYS = [PREV_WEEK, GRADED_WEEK, THIN_WEEK];

const REPLIES_TARGET = 17;
const ORIGINALS_TARGET = 3;

// -------------------------------------------------------- snapshot + cleanup

type FollowingStatusRow = { handle: string; status: string };
type CommitmentRow = typeof commitments.$inferSelect;
type StreakRow = typeof streaks.$inferSelect;
type DigestRow = typeof digests.$inferSelect;

/** Statuses of every row this script did NOT create, as they were before the
 *  first write. The complete-run reconcile and the queue release both move
 *  statuses globally; nothing else about a foreign row is touched. */
let foreignStatuses: FollowingStatusRow[] = [];
let savedCommitments: CommitmentRow[] = [];
let savedStreaks: StreakRow[] = [];
let savedDigests: DigestRow[] = [];
let snapshotTaken = false;
const createdRunIds: string[] = [];

function cleanup(): void {
  try {
    db.delete(following).where(inArray(following.handle, ALL_HANDLES)).run();
    db.delete(people)
      .where(inArray(people.handle, [ALLY]))
      .run();
    db.delete(postsPublished).where(inArray(postsPublished.tweetId, OWN_POST_IDS)).run();
    db.delete(scheduledPosts)
      .where(like(scheduledPosts.text, `${TEXT_PREFIX}%`))
      .run();
    db.delete(meGoals)
      .where(like(meGoals.label, `${TEXT_PREFIX}%`))
      .run();
    if (createdRunIds.length > 0) {
      db.delete(followingRuns).where(inArray(followingRuns.id, createdRunIds)).run();
      createdRunIds.length = 0;
    }

    if (!snapshotTaken) return;

    // Restore what the global writes moved. Only rows that actually differ are
    // written back, so a clean run touches nothing.
    const live = db
      .select({ handle: following.handle, status: following.status })
      .from(following)
      .all();
    const now = new Map(live.map((r) => [r.handle, r.status]));
    for (const prev of foreignStatuses) {
      if (now.get(prev.handle) === prev.status) continue;
      if (!now.has(prev.handle)) continue;
      db.update(following)
        .set({ status: prev.status })
        .where(eq(following.handle, prev.handle))
        .run();
    }

    db.delete(commitments).run();
    if (savedCommitments.length > 0) db.insert(commitments).values(savedCommitments).run();

    db.delete(streaks).where(inArray(streaks.day, SEEDED_DAY_KEYS)).run();
    if (savedStreaks.length > 0) db.insert(streaks).values(savedStreaks).run();

    db.delete(digests).where(inArray(digests.weekKey, SEEDED_WEEK_KEYS)).run();
    if (savedDigests.length > 0) db.insert(digests).values(savedDigests).run();
  } catch (err) {
    console.error('cleanup failed:', err instanceof Error ? err.message : err);
  }
}

function fail(msg: string): never {
  console.error(`FAIL: ${msg}`);
  cleanup();
  process.exit(1);
}

function check(ok: boolean, msg: string): void {
  if (!ok) fail(msg);
}

// ------------------------------------------------------------------- helpers

const jsonInit = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

// `app.request` is typed `Response | Promise<Response>` — a helper that returns
// it must be async or root typecheck (which covers scripts/) rejects it.
async function req<T>(path: string, init?: RequestInit): Promise<{ status: number; body: T }> {
  const res = await app.request(path, init);
  return { status: res.status, body: (await res.json()) as T };
}

interface RowsResult {
  runId: string;
  received: number;
  applied: number;
  inserted: number;
  updated: number;
  rowsSeen: number;
  complete: boolean;
  reconcile: { gone: number; confirmed: number; requeued: number } | null;
}
interface QueueBody {
  batch: { handle: string; displayName: string | null; firstSeenAt: string; url: string }[];
  eligibleTotal: number;
  releasedNow: number;
  windowUsed: number;
  windowCap: number;
  dailyUsed: number;
  dailyCeiling: number;
  lastCompleteRunAt: string | null;
}
interface Alert {
  rule: string;
  severity: string;
  message: string;
  evidence: Record<string, unknown>;
}
interface MonitorBody {
  alerts: Alert[];
  worst: string | null;
  checkedAt: string;
}
interface PacingBody {
  current: number | null;
  pctComplete: number | null;
  daysLeft: number | null;
  requiredPerDay: number | null;
  actualPerDay: number | null;
  verdict: string;
}
interface GoalBody {
  id: string;
  label: string;
  kind: string;
  status: string;
  baselineValue: number | null;
  baselineAt: string | null;
  pacing: PacingBody;
}
interface CommitmentBody {
  key: string;
  dailyTarget: number;
  active: boolean;
  debt: { missedLast7: number; missedLast30: number; trackedLast7: number; tier: number };
}
interface GoalsBody {
  goals: GoalBody[];
  commitments: CommitmentBody[];
  checkedAt: string;
}
interface BriefBody {
  quests: { day: string; items: { key: string; label: string; done: boolean }[] };
  goals?: GoalBody[];
  commitments?: CommitmentBody[];
  monitor?: { alerts: Alert[]; worst: string | null };
}
interface ScheduledCreated {
  id: string;
  text: string;
  status: string;
  warnings: string[];
}
interface ScorecardBody {
  score: number;
  components: Record<string, number | null>;
  sufficient: boolean;
  daysTracked: number;
  prevScore: number | null;
  delta: number | null;
}
interface DigestBody {
  weekKey: string;
  facts: { scorecard: ScorecardBody | null };
  narrative: string | null;
  cached: boolean;
}

const wireRow = (handle: string, followsBack: boolean, listPosition: number): unknown => ({
  handle,
  displayName: `GR10 ${handle}`,
  followsBack,
  listPosition,
});

async function statusOf(handle: string): Promise<string | null> {
  const [row] = await db
    .select({ status: following.status })
    .from(following)
    .where(eq(following.handle, handle));
  return row?.status ?? null;
}

async function readQueue(): Promise<QueueBody> {
  const { status, body } = await req<QueueBody>('/x/following/queue');
  if (status !== 200) fail(`GET /x/following/queue returned ${status}`);
  return body;
}

async function readMonitor(): Promise<Map<string, Alert>> {
  const { status, body } = await req<MonitorBody>('/x/monitor');
  if (status !== 200) fail(`GET /x/monitor returned ${status}`);
  // One alert per rule (D103a) — so the set is safely keyable by rule.
  return new Map(body.alerts.map((a) => [a.rule, a]));
}

// Leftovers from an aborted run would poison every count below.
cleanup();

// ============================================== 1. ledger ingest, partial run

const preLedger = await db
  .select({ handle: following.handle, status: following.status })
  .from(following);
foreignStatuses = preLedger.filter((r) => !ALL_HANDLES.includes(r.handle));
savedCommitments = await db.select().from(commitments);
savedStreaks = await db.select().from(streaks).where(inArray(streaks.day, SEEDED_DAY_KEYS));
savedDigests = await db.select().from(digests).where(inArray(digests.weekKey, SEEDED_WEEK_KEYS));
snapshotTaken = true;
console.log(
  `snapshot: ${foreignStatuses.length} foreign following rows, ${savedCommitments.length} commitments, ` +
    `${savedStreaks.length} streak days and ${savedDigests.length} digests protected`,
);

const seedRunRes = await req<{ id: string }>('/x/following/runs', jsonInit('POST', {}));
check(seedRunRes.status === 201, `POST /x/following/runs returned ${seedRunRes.status}`);
const seedRunId = seedRunRes.body.id;
createdRunIds.push(seedRunId);

const firstBatch = await req<RowsResult>(
  '/x/following/rows',
  jsonInit('POST', {
    runId: seedRunId,
    rows: [
      wireRow(STALE_A, false, 900),
      wireRow(STALE_B, false, 901),
      wireRow(ALLY, false, 902),
      wireRow(KEEP, false, 903),
      wireRow(FRESH, false, 904),
      wireRow(BACK, true, 905),
      wireRow(GONE, false, 906),
      wireRow(TICKED, false, 907),
      wireRow(STUCK, false, 908),
      // Same handle twice in one batch: first occurrence wins, one row applied.
      wireRow(STALE_A, false, 999),
    ],
  }),
);
check(firstBatch.status === 201, `POST /x/following/rows returned ${firstBatch.status}`);
check(firstBatch.body.received === 10, `received ${firstBatch.body.received}, expected 10`);
check(firstBatch.body.applied === 9, `in-batch dedupe failed: applied ${firstBatch.body.applied}`);
check(firstBatch.body.inserted === 9, `inserted ${firstBatch.body.inserted}, expected 9`);
// A batch without `done` is a partial pass: it may update what it saw and
// nothing else. Absence proves nothing until the scroll reached the bottom.
check(firstBatch.body.complete === false, 'a batch without done:true reported complete');
check(firstBatch.body.reconcile === null, 'a PARTIAL run reconciled — it must never');
console.log('ledger: 9 handles ingested under one run, in-batch duplicate collapsed');

// Backdate the follow-date proxy: the 7-day grace cannot be waited out in a
// smoke, and `first_seen_at` is fill-only through the route by design.
const now0 = Date.now();
const oldAt = new Date(now0 - (GRACE_DAYS + 23) * DAY_MS);
await db
  .update(following)
  .set({ firstSeenAt: oldAt })
  .where(inArray(following.handle, [STALE_A, STALE_B, ALLY, KEEP, BACK, GONE, TICKED, STUCK]));
// The mutual-stage person is the read-time whitelist (§7.12) — no table, no pin.
await db.insert(people).values({ handle: ALLY, stage: 'mutual', source: 'manual', retired: false });
await db.update(following).set({ keep: true }).where(eq(following.handle, KEEP));
// Two rows the user already ticked off: one the closing run will not see
// (=> confirmed), one it still will (=> the single reverse edge, back to queued).
await db
  .update(following)
  .set({ status: 'done', unfollowMarkedAt: new Date(now0 - 3 * HOUR_MS) })
  .where(inArray(following.handle, [TICKED, STUCK]));

// ================================================ 2. complete-run reconcile

// A SECOND run, because "unseen" means `last_run_id != runId` — a handle seen
// earlier in the same run is seen, whichever batch carried it. That is also how
// the real thing works: one scroll session is one run.
const runRes = await req<{ id: string }>('/x/following/runs', jsonInit('POST', {}));
check(runRes.status === 201, `the second POST /x/following/runs returned ${runRes.status}`);
const runId = runRes.body.id;
createdRunIds.push(runId);

const closing = await req<RowsResult>(
  '/x/following/rows',
  jsonInit('POST', {
    runId,
    // GONE and TICKED are deliberately absent from the complete pass.
    rows: [
      wireRow(STALE_A, false, 900),
      wireRow(STALE_B, false, 901),
      wireRow(ALLY, false, 902),
      wireRow(KEEP, false, 903),
      wireRow(FRESH, false, 904),
      wireRow(BACK, true, 905),
      wireRow(STUCK, false, 908),
    ],
    done: true,
  }),
);
check(closing.status === 201, `closing batch returned ${closing.status}`);
check(closing.body.complete === true, 'a done:true batch with rows did not report complete');
const reconcile = closing.body.reconcile;
check(reconcile !== null, 'a complete run did not reconcile');
check((await statusOf(GONE)) === 'gone', `${GONE} should be gone after a complete pass`);
check((await statusOf(TICKED)) === 'confirmed', `${TICKED} should be confirmed`);
check((await statusOf(STUCK)) === 'queued', `${STUCK} should be requeued (the tick didn't take)`);
check((reconcile?.requeued ?? 0) >= 1, 'the seen-done row was not requeued');
check((await statusOf(STALE_A)) === 'active', `${STALE_A} was seen and must stay active`);

const already = await req<{ error: string }>(
  '/x/following/rows',
  jsonInit('POST', { runId, rows: [wireRow(STALE_A, false, 900)] }),
);
check(already.status === 409, `posting into a completed run returned ${already.status}`);
console.log(
  `reconcile: unseen live -> gone, unseen done -> confirmed, seen done -> queued (${reconcile?.gone} / ${reconcile?.confirmed} / ${reconcile?.requeued}); a closed run 409s`,
);

// =================================================== 3. the curation queue

const q1 = await readQueue();
const batch1 = q1.batch.map((r) => r.handle);
// The batch needs three slots (one held + two fresh releases). Fail loudly
// naming the cap rather than through a confusing count assertion.
if (q1.dailyUsed >= DAILY_CEILING || q1.windowCap - q1.windowUsed < 3) {
  fail(
    `no release budget left (windowUsed ${q1.windowUsed}/${q1.windowCap}, ` +
      `dailyUsed ${q1.dailyUsed}/${q1.dailyCeiling}) — rerun after the 6h window rolls over`,
  );
}
// Every foreign row is `gone`/`confirmed` after the reconcile above, so the
// batch is exactly ours: the two long-standing non-followers plus the requeued
// row that was already held.
check(batch1.includes(STALE_A), `${STALE_A} (30d, no follow-back) was not released`);
check(batch1.includes(STALE_B), `${STALE_B} (30d, no follow-back) was not released`);
check(batch1.includes(STUCK), `${STUCK} (already queued) must stay in the batch until ticked`);
check(!batch1.includes(ALLY), `${ALLY} is at stage mutual — the whitelist must exclude them`);
check(!batch1.includes(KEEP), `${KEEP} carries keep:true and must never be offered`);
check(!batch1.includes(FRESH), `${FRESH} is inside the ${GRACE_DAYS}-day grace window`);
check(!batch1.includes(BACK), `${BACK} follows back and must never be offered`);
check(q1.eligibleTotal === 3, `eligibleTotal ${q1.eligibleTotal}, expected 3 (held + eligible)`);
check(q1.releasedNow === 2, `releasedNow ${q1.releasedNow}, expected 2`);

const q2 = await readQueue();
check(
  q2.releasedNow === 0,
  `a second read released ${q2.releasedNow} more — it must top up, not stack`,
);
check(
  q2.batch.map((r) => r.handle).join(',') === batch1.join(','),
  'the batch changed between two reads with nothing ticked',
);
check(q2.eligibleTotal === 3, `eligibleTotal moved between reads: ${q2.eligibleTotal}`);
console.log(
  `queue: ${batch1.length} offered (grace / mutual-stage / keep / follows-back all excluded), ` +
    `re-read is idempotent (windowCap jitters ${q1.windowCap} -> ${q2.windowCap})`,
);

// ============================================ 4. tick done, pin keep, budget

const tick = await req<{ status: string; unfollowMarkedAt: number | string | null }>(
  `/x/following/${STALE_A}`,
  jsonInit('PATCH', { status: 'done' }),
);
check(tick.status === 200, `PATCH done returned ${tick.status}`);
check(tick.body.status === 'done', `PATCH left status ${tick.body.status}`);
check(tick.body.unfollowMarkedAt !== null, 'PATCH done did not stamp unfollow_marked_at');

const reTick = await req<{ error: string }>(
  `/x/following/${STALE_A}`,
  jsonInit('PATCH', { status: 'done' }),
);
check(reTick.status === 409, `re-ticking a done row returned ${reTick.status}, expected 409`);

const q3 = await readQueue();
check(q3.windowUsed === q2.windowUsed + 1, `windowUsed ${q2.windowUsed} -> ${q3.windowUsed}`);
check(q3.dailyUsed === q2.dailyUsed + 1, `dailyUsed ${q2.dailyUsed} -> ${q3.dailyUsed}`);
check(!q3.batch.some((r) => r.handle === STALE_A), `${STALE_A} is still in the batch after done`);
check(q3.eligibleTotal === 2, `eligibleTotal ${q3.eligibleTotal} after one tick, expected 2`);

// `keep` moves no status — the queue is what stops offering the row, and it is
// the very next read that revokes it (GR.1 hand-off #1 / D101c).
const pin = await req<{ keep: boolean; status: string }>(
  `/x/following/${STALE_B}`,
  jsonInit('PATCH', { keep: true }),
);
check(pin.status === 200, `PATCH keep returned ${pin.status}`);
check(pin.body.keep === true, 'PATCH keep did not set the pin');
check(pin.body.status === 'queued', `keep moved the status to ${pin.body.status} — it must not`);

const q4 = await readQueue();
check(!q4.batch.some((r) => r.handle === STALE_B), `${STALE_B} survived a keep pin in the batch`);
check((await statusOf(STALE_B)) === 'active', `${STALE_B} was not revoked back to active`);
check(q4.eligibleTotal === 1, `eligibleTotal ${q4.eligibleTotal} after the pin, expected 1`);
console.log(
  `ratchet: tick -> mark + budget ${q2.windowUsed}->${q3.windowUsed} in-window, re-tick 409s, keep revokes a queued row on the next read`,
);

// =================================== 5. goals, commitments, brief targets

// Deleted first so the fresh rows carry activeSince = now: a commitment made
// today can have no debt yet, and that is the assertion.
await db.delete(commitments);
for (const [key, dailyTarget] of [
  ['replies', REPLIES_TARGET],
  ['originals', ORIGINALS_TARGET],
] as const) {
  const put = await req<CommitmentBody>(
    '/x/commitments',
    jsonInit('PUT', { key, dailyTarget, active: true }),
  );
  check(put.status === 200, `PUT /x/commitments ${key} returned ${put.status}`);
  check(put.body.dailyTarget === dailyTarget, `${key} target came back ${put.body.dailyTarget}`);
}

const goalRes = await req<{ id: string; baselineValue: number | null }>(
  '/x/me/goals',
  jsonInit('POST', {
    label: `${TEXT_PREFIX} — custom goal on pace`,
    kind: 'custom',
    target: 100,
    unit: 'units',
    currentValue: 40,
    deadline: new Date(now0 + 30 * DAY_MS).toISOString(),
  }),
);
check(goalRes.status === 201, `POST /x/me/goals returned ${goalRes.status}`);
check(goalRes.body.baselineValue === 40, `baseline stamped ${goalRes.body.baselineValue}`);
const goalId = goalRes.body.id;
// Backdate the baseline so there is a measurable rate: 10 -> 40 over 10 days is
// 3/day against a required 60/30 = 2/day, i.e. comfortably ahead.
await db
  .update(meGoals)
  .set({ baselineValue: 10, baselineAt: new Date(now0 - 10 * DAY_MS) })
  .where(eq(meGoals.id, goalId));

const goals1 = await req<GoalsBody>('/x/goals?tzOffsetMin=0');
check(goals1.status === 200, `GET /x/goals returned ${goals1.status}`);
const g1 = goals1.body.goals.find((g) => g.id === goalId);
check(g1 !== undefined, 'the created goal is missing from GET /x/goals');
check(g1?.pacing.pctComplete === 40, `pctComplete ${g1?.pacing.pctComplete}, expected 40`);
check(g1?.pacing.daysLeft === 30, `daysLeft ${g1?.pacing.daysLeft}, expected 30`);
check(g1?.pacing.requiredPerDay === 2, `requiredPerDay ${g1?.pacing.requiredPerDay}, expected 2`);
check(
  (g1?.pacing.actualPerDay ?? 0) > 2.9 && (g1?.pacing.actualPerDay ?? 0) <= 3,
  `actualPerDay ${g1?.pacing.actualPerDay}, expected ~3`,
);
check(g1?.pacing.verdict === 'ahead', `verdict ${g1?.pacing.verdict}, expected ahead`);

const freshDebt = goals1.body.commitments.find((c) => c.key === 'replies')?.debt;
check(
  freshDebt?.trackedLast7 === 0,
  `a commitment made today tracked ${freshDebt?.trackedLast7} days`,
);
check(freshDebt?.missedLast7 === 0, `a commitment made today owes ${freshDebt?.missedLast7} days`);
check(freshDebt?.tier === 0, `a fresh commitment is tier ${freshDebt?.tier}, expected 0`);

const briefRes = await req<BriefBody>('/x/brief?tzOffsetMin=0');
check(briefRes.status === 200, `GET /x/brief returned ${briefRes.status}`);
const questLabels = briefRes.body.quests.items.map((i) => i.label);
check(
  questLabels.includes(`${REPLIES_TARGET} quality replies`),
  `the replies commitment did not reach the quest labels: ${questLabels.join(' | ')}`,
);
check(
  questLabels.includes(`${ORIGINALS_TARGET} original posts`),
  `the originals commitment did not reach the quest labels: ${questLabels.join(' | ')}`,
);
check(
  (briefRes.body.goals ?? []).some((g) => g.id === goalId && g.pacing.verdict === 'ahead'),
  'the active goal is missing from the brief goals block',
);
check((briefRes.body.commitments ?? []).length >= 2, 'the brief carries no commitments block');
check(briefRes.body.monitor !== undefined, 'the brief carries no monitor block');
console.log(
  `accountability: pacing ahead (need 2/day, doing ~3/day), fresh commitments owe nothing, brief quests read "${REPLIES_TARGET} quality replies" / "${ORIGINALS_TARGET} original posts"`,
);

// The lazy ratchet, both directions. Reading is what settles them (§7.10).
await req<GoalBody>(`/x/me/goals/${goalId}`, jsonInit('PATCH', { currentValue: 120 }));
// POST refuses a past deadline outright (GR.7 validation)…
const refused = await req<{ error: string }>(
  '/x/me/goals',
  jsonInit('POST', {
    label: `${TEXT_PREFIX} — goal past its deadline`,
    kind: 'custom',
    target: 100,
    currentValue: 5,
    deadline: new Date(now0 - DAY_MS).toISOString(),
  }),
);
check(refused.status === 400, `POST past-deadline goal returned ${refused.status}, expected 400`);
check(refused.body.error === 'deadline_in_past', `past-deadline error ${refused.body.error}`);
// …so create it dated tomorrow and backdate the deadline directly — the same
// idiom as the baseline backdate above.
const overdueRes = await req<{ id: string }>(
  '/x/me/goals',
  jsonInit('POST', {
    label: `${TEXT_PREFIX} — goal past its deadline`,
    kind: 'custom',
    target: 100,
    currentValue: 5,
    deadline: new Date(now0 + DAY_MS).toISOString(),
  }),
);
check(overdueRes.status === 201, `POST overdue goal returned ${overdueRes.status}`);
const overdueId = overdueRes.body.id;
await db
  .update(meGoals)
  .set({ deadline: new Date(now0 - DAY_MS) })
  .where(eq(meGoals.id, overdueId));

const goals2 = await req<GoalsBody>('/x/goals');
const settled = goals2.body.goals.find((g) => g.id === goalId);
const missed = goals2.body.goals.find((g) => g.id === overdueId);
check(settled?.status === 'achieved', `goal past target reads ${settled?.status}`);
check(missed?.status === 'missed', `goal past deadline reads ${missed?.status}`);
check(missed?.pacing.verdict === 'overdue', `overdue verdict ${missed?.pacing.verdict}`);
const persisted = await db
  .select({ id: meGoals.id, status: meGoals.status })
  .from(meGoals)
  .where(inArray(meGoals.id, [goalId, overdueId]));
check(
  persisted.every((r) => r.status !== 'active'),
  'GET /x/goals reported a flip it never wrote — this GET must write',
);
console.log('goals: achieved + missed flipped lazily on read, and the flip is persisted');

// ============================== 6. monitor alerts + schedule-time warnings

const before = await readMonitor();
const baselineDupPairs = Number(
  (before.get('nearDuplicate')?.evidence as { pairCount?: number } | undefined)?.pairCount ?? 0,
);
const baselineClusters = Number(
  (before.get('scheduleCluster')?.evidence as { clusterCount?: number } | undefined)
    ?.clusterCount ?? 0,
);

// Own posts are seeded RETIRED (NT.7): a leftover own post is a candidate for
// the daily 03:00 pass, i.e. a real billed X read for a tweet that never existed.
await db.insert(postsPublished).values(
  BURST_IDS.map((id, i) => ({
    tweetId: id,
    text: `${TEXT_PREFIX} — burst fixture ${i}: ${BURST_TAILS[i % BURST_TAILS.length]}`,
    postedAt: new Date(now0 - burstOffsetMs(i)),
    isReply: false,
    source: 'gr10-smoke',
    retired: true,
  })),
);
await db.insert(postsPublished).values(
  DUP_IDS.map((id, i) => ({
    tweetId: id,
    text: DUP_TEXT,
    postedAt: new Date(now0 - (i + 3) * DAY_MS),
    isReply: false,
    source: 'gr10-smoke',
    retired: true,
  })),
);
await db.insert(following).values(
  CHURN_HANDLES.map((handle, i) => ({
    handle,
    displayName: null,
    followsBack: false,
    listPosition: 2000 + i,
    firstSeenAt: new Date(now0 - 40 * DAY_MS),
    lastSeenAt: new Date(now0 - 8 * HOUR_MS),
    lastRunId: runId,
    status: 'done',
    keep: false,
    unfollowMarkedAt: new Date(now0 - 8 * HOUR_MS),
  })),
);

const slotAt = now0 + 120 * DAY_MS;
const post1 = await req<ScheduledCreated>(
  '/x/posts/scheduled',
  jsonInit('POST', { text: QUEUED_TEXT, scheduledFor: new Date(slotAt).toISOString() }),
);
check(post1.status === 201, `POST /x/posts/scheduled returned ${post1.status}`);
check(Array.isArray(post1.body.warnings), 'the POST response carries no warnings array');
check(
  !post1.body.warnings.some((w) => w.includes('already queued')),
  'the first post of a pair was warned about a twin that does not exist yet',
);

const post2 = await req<ScheduledCreated>(
  '/x/posts/scheduled',
  jsonInit('POST', {
    text: QUEUED_TEXT,
    scheduledFor: new Date(slotAt + 20 * MIN_MS).toISOString(),
  }),
);
check(post2.status === 201, `the second scheduled post returned ${post2.status}`);
check(
  post2.body.warnings.some((w) => w.includes('other pending post')),
  `no cluster warning ${SCHEDULE_CLUSTER_MS / MIN_MS} min from another slot: ${post2.body.warnings.join(' | ')}`,
);
check(
  post2.body.warnings.some((w) => w.includes('already queued')),
  `no queued-twin warning for an identical pending post: ${post2.body.warnings.join(' | ')}`,
);

const post3 = await req<ScheduledCreated>(
  '/x/posts/scheduled',
  jsonInit('POST', {
    text: DUP_TEXT,
    scheduledFor: new Date(slotAt + 10 * DAY_MS).toISOString(),
  }),
);
check(post3.status === 201, `the duplicate-of-published post returned ${post3.status}`);
check(
  post3.body.warnings.some((w) => w.startsWith('Very similar to a post from')),
  `no published-twin warning at ${NEAR_DUPLICATE_THRESHOLD} similarity: ${post3.body.warnings.join(' | ')}`,
);

const draft = await req<ScheduledCreated>(
  '/x/posts/scheduled',
  jsonInit('POST', { text: DUP_TEXT, status: 'draft' }),
);
check(draft.status === 201, `the draft returned ${draft.status}`);
check(draft.body.warnings.length === 0, 'a draft was warned — nothing is scheduled to happen yet');
console.log(
  'advisory: cluster + queued-twin + published-twin lines on pending posts, none on a draft',
);

const after = await readMonitor();
const burst = after.get('postBurst');
check(burst !== undefined, 'postBurst did not fire on 5 originals in 24h');
const burstEvidence = burst?.evidence as
  | { count24h?: number; closestPair?: [string, string] }
  | undefined;
check(
  Number(burstEvidence?.count24h ?? 0) > POST_BURST_MAX,
  `postBurst counted ${burstEvidence?.count24h} originals in 24h`,
);
check(burstEvidence?.closestPair !== undefined, 'postBurst missed the two-posts-20-min-apart pair');

const dup = after.get('nearDuplicate');
check(dup !== undefined, 'nearDuplicate did not fire on two identical originals');
const dupPairs = Number((dup?.evidence as { pairCount?: number } | undefined)?.pairCount ?? 0);
check(
  dupPairs >= baselineDupPairs + 1,
  `nearDuplicate pairCount ${baselineDupPairs} -> ${dupPairs}, expected at least one more`,
);

const churn = after.get('unfollowChurn');
check(churn !== undefined, `unfollowChurn did not fire on ${CHURN_HANDLES.length} marks in 24h`);
const churnCount = Number((churn?.evidence as { count?: number } | undefined)?.count ?? 0);
check(
  churnCount >= UNFOLLOW_CHURN_WARN,
  `unfollowChurn counted ${churnCount}, expected ≥ ${UNFOLLOW_CHURN_WARN}`,
);

const cluster = after.get('scheduleCluster');
check(cluster !== undefined, 'scheduleCluster did not fire on the 20-min pending pair');
const clusters = Number(
  (cluster?.evidence as { clusterCount?: number } | undefined)?.clusterCount ?? 0,
);
check(
  clusters >= baselineClusters + 1,
  `scheduleCluster clusterCount ${baselineClusters} -> ${clusters}`,
);
console.log(
  `monitor: postBurst(${burstEvidence?.count24h}/24h) + nearDuplicate(${dupPairs} pairs) + ` +
    `unfollowChurn(${churnCount}) + scheduleCluster(${clusters}) — worst=${churn?.severity}`,
);

// ===================================================== 7. weekly scorecard

await db.delete(streaks).where(inArray(streaks.day, SEEDED_DAY_KEYS));
await db.delete(digests).where(inArray(digests.weekKey, SEEDED_WEEK_KEYS));
await db.insert(streaks).values(
  GRADED_DAY_KEYS.map((day, i) => ({
    day,
    completed: { replies: i < GRADED_DAYS_ALL_DONE, original: i < GRADED_DAYS_ALL_DONE },
    allDone: i < GRADED_DAYS_ALL_DONE,
  })),
);
await db
  .insert(streaks)
  .values(THIN_DAY_KEYS.map((day) => ({ day, completed: { replies: true }, allDone: true })));
await db.insert(digests).values({
  weekKey: PREV_WEEK,
  facts: { scorecard: { score: PREV_SCORE } },
  narrative: `${TEXT_PREFIX} — seeded predecessor week`,
  model: 'gr10-smoke',
});

const graded = await req<DigestBody>(`/x/digest?week=${GRADED_WEEK}&tzOffsetMin=0&factsOnly=true`);
check(graded.status === 200, `GET /x/digest returned ${graded.status}`);
check(graded.body.narrative === null, 'factsOnly returned a narration — that would cost money');
const card = graded.body.facts.scorecard;
check(card !== null, `no scorecard at ${GRADED_DAYS_TRACKED} tracked days`);
check(card?.sufficient === true, 'the graded week reported insufficient data');
check(
  card?.daysTracked === GRADED_DAYS_TRACKED,
  `daysTracked ${card?.daysTracked}, expected ${GRADED_DAYS_TRACKED}`,
);
const expectedAdherence = Math.round((GRADED_DAYS_ALL_DONE / GRADED_DAYS_TRACKED) * 100);
check(
  card?.components.questAdherence === expectedAdherence,
  `questAdherence ${card?.components.questAdherence}, expected ${expectedAdherence}`,
);
check(
  typeof card?.score === 'number' && card.score >= 0 && card.score <= 100,
  `score ${card?.score} is not a 0–100 number`,
);
check(card?.prevScore === PREV_SCORE, `prevScore ${card?.prevScore}, expected ${PREV_SCORE}`);
check(
  card?.delta === (card?.score ?? 0) - PREV_SCORE,
  `delta ${card?.delta} does not match score − prevScore`,
);

const thin = await req<DigestBody>(`/x/digest?week=${THIN_WEEK}&tzOffsetMin=0&factsOnly=true`);
check(thin.status === 200, `GET /x/digest (thin week) returned ${thin.status}`);
check(
  thin.body.facts.scorecard === null,
  `a ${THIN_DAYS_TRACKED}-day week was graded — the whole card must be null under the gate`,
);

const cachedAfter = await db
  .select({ weekKey: digests.weekKey })
  .from(digests)
  .where(inArray(digests.weekKey, [GRADED_WEEK, THIN_WEEK]));
check(cachedAfter.length === 0, 'factsOnly cached a digest row — it must return before the write');
console.log(
  `scorecard: ${GRADED_DAYS_TRACKED} tracked days -> score ${card?.score} ` +
    `(quests ${card?.components.questAdherence}, delta ${card?.delta} vs ${PREV_SCORE}); ` +
    `${THIN_DAYS_TRACKED} days -> null under the ${SCORECARD_MIN_DAYS}-day gate`,
);

// ============================================= 8. cleanup + verification

cleanup();

const leftoverLedger = await db
  .select({ handle: following.handle })
  .from(following)
  .where(inArray(following.handle, ALL_HANDLES));
check(leftoverLedger.length === 0, `${leftoverLedger.length} seeded ledger rows survived cleanup`);
const leftoverPosts = await db
  .select({ tweetId: postsPublished.tweetId })
  .from(postsPublished)
  .where(inArray(postsPublished.tweetId, OWN_POST_IDS));
check(leftoverPosts.length === 0, `${leftoverPosts.length} seeded own posts survived cleanup`);
const leftoverSlots = await db
  .select({ id: scheduledPosts.id })
  .from(scheduledPosts)
  .where(like(scheduledPosts.text, `${TEXT_PREFIX}%`));
check(leftoverSlots.length === 0, `${leftoverSlots.length} seeded scheduled posts survived`);
const leftoverGoals = await db
  .select({ id: meGoals.id })
  .from(meGoals)
  .where(like(meGoals.label, `${TEXT_PREFIX}%`));
check(leftoverGoals.length === 0, `${leftoverGoals.length} seeded goals survived cleanup`);
const leftoverRuns = await db
  .select({ id: followingRuns.id })
  .from(followingRuns)
  .where(inArray(followingRuns.id, [runId]));
check(leftoverRuns.length === 0, 'the seeded following run survived cleanup');

const restored = await db
  .select({ handle: following.handle, status: following.status })
  .from(following);
const restoredMap = new Map(restored.map((r) => [r.handle, r.status]));
const drifted = foreignStatuses.filter((r) => restoredMap.get(r.handle) !== r.status);
check(drifted.length === 0, `${drifted.length} foreign ledger rows did not get their status back`);

const commitmentsBack = await db.select().from(commitments);
check(
  commitmentsBack.length === savedCommitments.length,
  `commitments came back as ${commitmentsBack.length} rows, expected ${savedCommitments.length}`,
);
const streaksBack = await db
  .select({ day: streaks.day })
  .from(streaks)
  .where(inArray(streaks.day, SEEDED_DAY_KEYS));
check(
  streaksBack.length === savedStreaks.length,
  `${streaksBack.length} streak days at the seeded keys, expected ${savedStreaks.length}`,
);
const digestsBack = await db
  .select({ weekKey: digests.weekKey })
  .from(digests)
  .where(inArray(digests.weekKey, SEEDED_WEEK_KEYS));
check(
  digestsBack.length === savedDigests.length,
  `${digestsBack.length} digests at the seeded keys, expected ${savedDigests.length}`,
);
console.log('cleanup: every seeded row removed; foreign statuses and snapshots restored');

// The burst fixtures sat inside today's window while the brief was writing the
// C9 diary. One more read recomputes today's row from clean data — recompute,
// never restore (D98c).
const recompute = await req<BriefBody>('/x/brief?tzOffsetMin=0');
check(recompute.status === 200, `the closing brief read returned ${recompute.status}`);
console.log(`diary: today's streak row recomputed from clean data (${recompute.body.quests.day})`);

console.log('SMOKE PASS ($0 — no X API, no LLM)');
process.exit(0);
