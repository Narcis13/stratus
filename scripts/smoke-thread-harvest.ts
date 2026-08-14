// One-shot smoke for thread harvest (plan `plans/2026-08-14-thread-harvest.md`,
// TH.1–TH.6). Mounts the harvest router — plus the cannon router, purely so the
// isolation claim can be asserted rather than assumed — in-process against the
// REAL DB (no port, no workers, no X API, no LLM) and drives the whole server
// half of the feature:
//
//   1. `POST /x/harvest/thread` — root + 3 replies (one of them the root
//      author's own continuation) lands as ONE run and 1+n rows;
//   2. `GET /x/harvest/threads` — the capture appears once, with the replies it
//      actually stored;
//   3. re-capturing the SAME root with bumped metrics appends a second run
//      instead of overwriting: the list still shows ONE entry, now `captures: 2`
//      and carrying the NEW numbers. That is `harvest_rows`' longitudinal
//      contract, and it is the whole reason the read groups by root;
//   4. `GET /x/harvest/threads/:root` — root + replies in `position` order,
//      `isAuthor` true on the root author's own reply and nothing else, and the
//      stamped `orig` (asserted over the DB, since the transcript deliberately
//      does not re-serialize what every row already echoes);
//   5. `?runId=<first>` still returns the FIRST capture's metrics — without it
//      re-capturing would be indistinguishable from an overwrite;
//   6. a duplicate reply id and a reply that IS the root are both dropped and
//      COUNTED (`skippedDuplicate`), never silently swallowed;
//   7. the refuse-before-work errors: 501 rows → `too_many_rows` before a single
//      row is parsed, a non-numeric id → 400, an uncaptured id → 404;
//   8. **isolation** — `mode='thread'` is a free-text discriminator sharing a
//      table with four other modes, so the safety argument is that every
//      existing consumer names its own modes. A 10-tweet single-handle thread
//      (above `CANNON_MIN_SAMPLE`, with view counts that would put it at the top
//      of any list it leaked into) must stay invisible to `GET /cannon/candidates`,
//      to `POST /cannon/rescore` (which reports `sampleN: 0` — it looked and saw
//      nothing), and to `GET /harvest/affinity`.
//
// **$0, and there is no `--live` flag.** Nothing on any path in this feature can
// reach `xFetch` or `askLLM`: capture is a DOM scrape, ingest is SQL, both reads
// are SQL. A flag would be theatre — there is no billed call to verify (D171c),
// which is exactly the finding, as in `smoke-own-harvest.ts`.
//
// Real-DB safety is namespace-then-delete (§D98c): every tweet id carries the
// `886…` prefix (18 digits — no real snowflake starts there) and every handle is
// `th7_*`, so cleanup is one `LIKE` delete of the rows and one of the runs
// (thread runs carry `root_tweet_id`, which is prefixed too). Cleanup also runs
// from `fail()`, which exits and would skip a `finally`.
//
// Run: bun run scripts/smoke-thread-harvest.ts

import { eq, like } from 'drizzle-orm';
import { Hono } from 'hono';
import { db } from '../src/db/client.ts';
import { CANNON_MIN_SAMPLE } from '../src/x/cannon/roster.ts';
import { cannonTargets, harvestRows, harvestRuns } from '../src/x/db/schema.ts';
import { cannonRouter } from '../src/x/routes/cannon.ts';
import { type ThreadDetail, type ThreadSummary, harvest } from '../src/x/routes/harvest.ts';

const app = new Hono();
app.route('/x', harvest);
app.route('/x', cannonRouter);

// 18 digits, all ours: real tweet ids are 19-digit snowflakes starting 1/2, so
// the LIKE in cleanup() can never sweep a genuine row.
const TWEET_PREFIX = '886000000000000';
const tid = (n: number): string => `${TWEET_PREFIX}${String(n).padStart(3, '0')}`;

// ≤15 chars, lowercase, [A-Za-z0-9_] — the USERNAME_RE every wire handle is
// validated against, and handles are lowercased on every side.
const ROOT_HANDLE = 'th7_root';
const REPLIER_A = 'th7_a';
const REPLIER_B = 'th7_b';
const LEAK_HANDLE = 'th7_leak';

const ROOT_ID = tid(1);
const LEAK_ROOT_ID = tid(300);
const MAX_THREAD_ROWS = 500;

const HOUR_MS = 60 * 60 * 1000;
const ROOT_TIME = new Date(Date.now() - 2 * HOUR_MS);

// ---------------------------------------------------------------- fixtures

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
  groupPosition?: number;
  orig?: Record<string, unknown>;
}

function row(over: Partial<WireRow> & { tweetId: string; handle: string }): WireRow {
  return {
    text: `th7 smoke ${over.tweetId}`,
    comments: 0,
    reposts: 0,
    likes: 0,
    bookmarks: 0,
    views: 0,
    time: ROOT_TIME.toISOString(),
    ...over,
  };
}

/** The same thread twice, differing only in metrics — that IS the re-capture. */
function rootRow(pass: 1 | 2): WireRow {
  return row({
    tweetId: ROOT_ID,
    handle: ROOT_HANDLE,
    text: 'th7 smoke root — the post the conversation hangs off',
    comments: pass === 1 ? 9 : 11,
    reposts: 5,
    likes: pass === 1 ? 50 : 61,
    bookmarks: 7,
    views: pass === 1 ? 1000 : 4242,
  });
}

function replyRows(pass: 1 | 2): WireRow[] {
  return [
    row({
      tweetId: tid(11),
      handle: REPLIER_A,
      text: 'th7 smoke reply from a stranger',
      likes: 3,
      views: pass === 1 ? 300 : 380,
      time: new Date(ROOT_TIME.getTime() + 5 * 60_000).toISOString(),
      // The client does not get to assert either of these (§7.16): the server
      // overwrites both, and step 4 reads them back to prove it.
      groupPosition: 99,
      orig: { tweetId: tid(777), handle: 'th7_forged', views: 999_999 },
    }),
    row({
      tweetId: tid(12),
      handle: ROOT_HANDLE,
      text: 'th7 smoke self-continuation — the author speaking in their own thread',
      likes: 12,
      views: pass === 1 ? 250 : 310,
      time: new Date(ROOT_TIME.getTime() + 9 * 60_000).toISOString(),
    }),
    row({
      tweetId: tid(13),
      handle: REPLIER_B,
      text: 'th7 smoke reply from another stranger',
      views: pass === 1 ? 120 : 140,
      time: new Date(ROOT_TIME.getTime() + 14 * 60_000).toISOString(),
    }),
  ];
}

// ------------------------------------------------------- teardown scaffolding

function cleanup(): void {
  try {
    db.delete(harvestRows)
      .where(like(harvestRows.tweetId, `${TWEET_PREFIX}%`))
      .run();
    db.delete(harvestRuns)
      .where(like(harvestRuns.rootTweetId, `${TWEET_PREFIX}%`))
      .run();
    db.delete(cannonTargets).where(eq(cannonTargets.handle, LEAK_HANDLE)).run();
  } catch (err) {
    console.error(`  (cleanup failed: ${err instanceof Error ? err.message : err})`);
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

async function getJson<T>(path: string, expect = 200): Promise<T> {
  const res = await app.request(path);
  if (res.status !== expect) fail(`GET ${path} → ${res.status}, expected ${expect}`);
  return (await res.json()) as T;
}

interface CaptureResponse {
  runId: string;
  rootTweetId: string;
  inserted: number;
  replies: number;
  skippedDuplicate: number;
}

async function capture(root: WireRow, replies: unknown[], what: string): Promise<CaptureResponse> {
  const res = await postJson<CaptureResponse>('/x/harvest/thread', { root, replies });
  if (res.status !== 201) fail(`${what} → ${res.status}: ${JSON.stringify(res.json)}`);
  return res.json;
}

/** The list is a real-DB read: the operator may have captured their own threads,
 *  so every assertion is scoped to the prefixed fixtures. */
async function ourThreads(): Promise<ThreadSummary[]> {
  const body = await getJson<{ threads: ThreadSummary[] }>('/x/harvest/threads?limit=100');
  return body.threads.filter((t) => t.rootTweetId.startsWith(TWEET_PREFIX));
}

// -------------------------------------------------------- 1. the first capture

console.log(
  'thread-harvest smoke — capture, re-capture, transcript, isolation ($0, nothing here can spend)',
);

// A stale row from an interrupted previous run would make `captures` lie.
cleanup();

const first = await capture(rootRow(1), replyRows(1), 'first capture');
eq2(first.rootTweetId, ROOT_ID, 'capture rootTweetId');
eq2(first.inserted, 4, 'first capture inserted (root + 3 replies)');
eq2(first.replies, 3, 'first capture replies');
eq2(first.skippedDuplicate, 0, 'first capture skippedDuplicate');
ok(`root + 3 replies stored as one run (${first.runId})`);

// --------------------------------------------------------------- 2. the list

let threads = await ourThreads();
eq2(threads.length, 1, 'threads listed after the first capture');
const listed1 = threads[0] as ThreadSummary;
eq2(listed1.runId, first.runId, 'listed runId');
eq2(listed1.handle, ROOT_HANDLE, 'listed handle');
eq2(listed1.replyCount, 3, 'listed replyCount');
eq2(listed1.captures, 1, 'listed captures');
eq2(listed1.rootViews, 1000, 'listed rootViews');
// The completeness pair: X's own counter beside what the scrape actually got.
eq2(listed1.rootComments, 9, 'listed rootComments (what X claims, next to replyCount)');
ok('GET /x/harvest/threads: one entry, replyCount 3, captures 1, comments 9 vs 3 stored');

// --------------------------------------------------------- 3. the re-capture

// harvest_runs.createdAt is second-resolution, so two captures inside one second
// tie and "newest run per root" becomes a coin flip — a property of the clock,
// not of the code under test.
await Bun.sleep(1100);

const second = await capture(rootRow(2), replyRows(2), 're-capture');
eq2(second.inserted, 4, 're-capture inserted');
if (second.runId === first.runId)
  fail('re-capture reused the first run — it must append a new one');

threads = await ourThreads();
eq2(threads.length, 1, 'threads after the re-capture (still ONE entry, not two)');
const listed2 = threads[0] as ThreadSummary;
eq2(listed2.captures, 2, 'captures after the re-capture');
eq2(listed2.runId, second.runId, 'the list shows the LATEST capture');
eq2(listed2.rootViews, 4242, 'the list shows the NEW rootViews');
eq2(listed2.rootComments, 11, 'the list shows the NEW rootComments');
ok('re-capture appended: one list entry, captures 2, carrying the new numbers');

// ---------------------------------------------------------- 4. the transcript

const detail = await getJson<ThreadDetail>(`/x/harvest/threads/${ROOT_ID}`);
eq2(detail.rootTweetId, ROOT_ID, 'detail rootTweetId');
eq2(detail.runId, second.runId, 'detail defaults to the latest capture');
eq2(detail.root.position, 0, 'root position');
eq2(detail.root.views, 4242, 'root views (latest capture)');
eq2(detail.replyCount, 3, 'detail replyCount');
eq2(detail.replies.map((r) => r.position).join(','), '1,2,3', 'replies ordered by position');
eq2(
  detail.replies.map((r) => r.tweetId).join(','),
  [tid(11), tid(12), tid(13)].join(','),
  'replies in captured order',
);
const authored = detail.replies.filter((r) => r.isAuthor).map((r) => r.tweetId);
eq2(authored.join(','), tid(12), 'isAuthor true on the self-continuation and nothing else');
eq2(detail.captures.length, 2, 'detail captures length');
eq2(detail.captures[0]?.runId, second.runId, 'captures[0] is the newest');
eq2(detail.captures[1]?.runId, first.runId, 'captures[1] is the first');
ok(
  'transcript: root at position 0, replies 1..3 in order, isAuthor only on the root author own reply',
);

// The stamped `orig` is not re-serialized in the transcript (every reply already
// echoes the root that is right there beside it), so it is asserted where it
// lives — and with it the §7.16 rule that the forged client orig/groupPosition
// were thrown away.
const storedReplies = await db
  .select()
  .from(harvestRows)
  .where(eq(harvestRows.runId, second.runId))
  .orderBy(harvestRows.groupPosition);
eq2(storedReplies.length, 4, 'rows stored for the latest run');
for (const r of storedReplies.slice(1)) {
  eq2(r.mode, 'thread', `row ${r.tweetId} mode`);
  eq2(r.origTweetId, ROOT_ID, `row ${r.tweetId} origTweetId`);
  eq2(r.origHandle, ROOT_HANDLE, `row ${r.tweetId} origHandle`);
  eq2(r.origViews, 4242, `row ${r.tweetId} origViews`);
  eq2(r.origComments, 11, `row ${r.tweetId} origComments`);
}
const forged = storedReplies.find((r) => r.tweetId === tid(11));
eq2(forged?.groupPosition, 1, 'client groupPosition 99 was overwritten with 1');
eq2(storedReplies[0]?.origTweetId, null, 'the root row carries no orig');
ok('every reply row stamps the root as its orig; the forged client orig and position were ignored');

// ----------------------------------------------- 5. the longitudinal read-back

const older = await getJson<ThreadDetail>(`/x/harvest/threads/${ROOT_ID}?runId=${first.runId}`);
eq2(older.runId, first.runId, '?runId= picks that capture');
eq2(older.root.views, 1000, 'root views of the first capture survived the re-capture');
eq2(older.root.comments, 9, 'root comments of the first capture');
eq2(
  older.replies.find((r) => r.tweetId === tid(11))?.views,
  300,
  'reply views of the first capture',
);
ok('?runId=<first> still returns the FIRST capture — re-capture appends, never overwrites');

// ------------------------------------------------------- 6. the dropped rows

await Bun.sleep(1100);
const third = await capture(
  rootRow(2),
  [
    replyRows(2)[0] as WireRow,
    replyRows(2)[0] as WireRow, // the same reply, re-sighted by a virtualized scroll
    rootRow(2), // the root itself renders inside its own conversation
  ],
  'dedupe capture',
);
eq2(third.inserted, 2, 'dedupe capture inserted (root + the one distinct reply)');
eq2(third.replies, 1, 'dedupe capture replies');
eq2(third.skippedDuplicate, 2, 'skippedDuplicate (the dup and the root-as-reply, both counted)');

threads = await ourThreads();
eq2(threads.length, 1, 'still one thread entry after the third capture');
eq2((threads[0] as ThreadSummary).captures, 3, 'captures after the third');
ok('duplicate reply and root-as-reply dropped and REPORTED, not silently swallowed');

// ------------------------------------------------------------- 7. the refusals

// 501 rows, with `null` payloads: the cap must fire before a single reply is
// parsed (§7.4 — refuse before work, even when the work is free).
const tooMany = await postJson<{ error: string; max: number }>('/x/harvest/thread', {
  root: rootRow(1),
  replies: new Array(MAX_THREAD_ROWS).fill(null),
});
eq2(tooMany.status, 400, '501 rows status');
eq2(tooMany.json.error, 'too_many_rows', '501 rows error');
eq2(tooMany.json.max, MAX_THREAD_ROWS, '501 rows max');

const badId = await app.request('/x/harvest/threads/abc');
eq2(badId.status, 400, 'non-numeric root status');
eq2(
  ((await badId.json()) as { error: string }).error,
  'invalid_root_tweet_id',
  'non-numeric root error',
);

const missing = await app.request(`/x/harvest/threads/${tid(999)}`);
eq2(missing.status, 404, 'uncaptured root status');
eq2(
  ((await missing.json()) as { error: string }).error,
  'thread_not_found',
  'uncaptured root error',
);

const wrongRun = await app.request(`/x/harvest/threads/${ROOT_ID}?runId=${crypto.randomUUID()}`);
eq2(wrongRun.status, 404, 'foreign runId status');
eq2(
  ((await wrongRun.json()) as { error: string }).error,
  'capture_not_found',
  'foreign runId error',
);
ok('too_many_rows (before parsing) / invalid_root_tweet_id / thread_not_found / capture_not_found');

// ---------------------------------------------------------- 8. the isolation

// One handle, 10 distinct tweets (above CANNON_MIN_SAMPLE) with view counts that
// would put it at the very top of anything it leaked into. `mode='thread'` is
// free text in a shared column: this is the assertion that every other consumer
// really does name its own modes.
const leakReplies = Array.from({ length: 9 }, (_, i) =>
  row({
    tweetId: tid(301 + i),
    handle: LEAK_HANDLE,
    text: `th7 leak canary ${i}`,
    comments: 500,
    views: 900_000,
    time: new Date(ROOT_TIME.getTime() + i * 60_000).toISOString(),
  }),
);
const leak = await capture(
  row({
    tweetId: LEAK_ROOT_ID,
    handle: LEAK_HANDLE,
    text: 'th7 leak canary root',
    comments: 500,
    views: 900_000,
  }),
  leakReplies,
  'leak-canary capture',
);
eq2(leak.inserted, 10, 'leak canary rows');
if (leak.inserted <= CANNON_MIN_SAMPLE) {
  fail(
    `the canary (${leak.inserted} tweets) is at or below CANNON_MIN_SAMPLE — it could not clear the gate even if it leaked`,
  );
}

const candidates = await getJson<{ candidates: { handle: string }[] }>(
  '/x/cannon/candidates?limit=50',
);
const leakedCandidates = candidates.candidates.filter((r) => r.handle.startsWith('th7_'));
if (leakedCandidates.length > 0) {
  fail(
    `thread rows reached the cannon candidate list: ${leakedCandidates.map((r) => r.handle).join(', ')}`,
  );
}

const target = await postJson('/x/cannon/targets', { handle: LEAK_HANDLE });
if (target.status !== 201) fail(`POST /x/cannon/targets → ${target.status}`);
const rescore = await postJson<{
  scored: number;
  skipped: { handle: string; sampleN: number; reason: string }[];
}>('/x/cannon/rescore', { handles: [LEAK_HANDLE] });
eq2(rescore.status, 200, 'rescore status');
eq2(
  rescore.json.scored,
  0,
  'rescore scored (the canary is unscorable — it has no posts-mode rows)',
);
eq2(rescore.json.skipped[0]?.handle, LEAK_HANDLE, 'rescore skipped handle');
eq2(rescore.json.skipped[0]?.sampleN, 0, 'rescore sampleN (it looked and saw nothing)');
eq2(rescore.json.skipped[0]?.reason, 'insufficient_sample', 'rescore reason');

// minDays=1 is the most permissive floor the route accepts: if a thread row
// could ever surface here, one day of captures would be enough.
const affinity = await getJson<{ authors: { handle: string }[] }>(
  '/x/harvest/affinity?minDays=1&limit=50',
);
const leakedAuthors = affinity.authors.filter((a) => a.handle.startsWith('th7_'));
if (leakedAuthors.length > 0) {
  fail(`thread rows reached the affinity roster: ${leakedAuthors.map((a) => a.handle).join(', ')}`);
}
ok(`mode='thread' is invisible to cannon candidates, to rescore (sampleN 0) and to affinity`);

// ------------------------------------------------------------- 9. the cleanup

cleanup();
const leftRows = await db
  .select({ id: harvestRows.id })
  .from(harvestRows)
  .where(like(harvestRows.tweetId, `${TWEET_PREFIX}%`));
if (leftRows.length > 0) fail(`${leftRows.length} smoke harvest rows survived cleanup`);
const leftRuns = await db
  .select({ id: harvestRuns.id })
  .from(harvestRuns)
  .where(like(harvestRuns.rootTweetId, `${TWEET_PREFIX}%`));
if (leftRuns.length > 0) fail(`${leftRuns.length} smoke runs survived cleanup`);
const leftTargets = await db
  .select({ handle: cannonTargets.handle })
  .from(cannonTargets)
  .where(eq(cannonTargets.handle, LEAK_HANDLE));
if (leftTargets.length > 0) fail('the canary cannon target survived cleanup');
if ((await ourThreads()).length > 0) fail('a prefixed thread still lists after cleanup');
ok('every seeded row, run and roster entry removed — the next run starts from a clean slate');

console.log('\nPASS ($0 — no X API, no LLM, no billed call on any path).');
process.exit(0);
