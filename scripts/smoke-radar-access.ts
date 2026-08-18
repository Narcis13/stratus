// One-shot $0 smoke for Radar access (RA.1–RA.5) — the sighting corpus and the
// terminal-session drafting path that rides on it. Mounts the radar + settings
// routers in-process against the real DB (no port, no workers, no X API, no
// Grok) and drives the whole lane end-to-end: POST 3 sightings -> a re-POST is
// skippedRecent -> a BAND CHANGE punches through that throttle (D188a) -> a bad
// row 400s the batch with nothing written -> a 61-day-old sighting is pruned by
// the next POST -> GET the list (the three orders are three different
// sequences, the summary counts, the `admitted` FLIP when the sweep config
// moves) -> GET one -> the LIVE QUEUE (queue=true lists the three, a PATCH
// dismisses one, a re-PATCH updates nothing) -> compose 2 variants -> compose
// again (the first row is expired, exactly one `ready` survives) -> confirm
// (the `reply_drafts` row's `model` and `sourcePostedAt`) -> the same tweet now
// reads `worked` and leaves the queue -> a `manual`-band re-ingest (the pin)
// is the one thing that puts a dismissed row back.
//
// There is NO `--live` flag, and the absence is the finding (D171c): nothing
// under `/x/radar` — sightings, compose, confirm — can reach `xFetch` or
// `askLLM`, so a $0 run makes every claim this script has. That is the whole
// point of the lane: Claude drafts the reply, stratus pays nothing.
//
// Real-DB safety, two halves:
//  - ROWS: every id this script writes is 888-prefixed and 18 digits (real
//    tweet ids are 19-digit snowflakes starting 1/2) under the `ra_smoke`
//    handle, so `cleanup()` can never sweep a genuine sighting, radar draft or
//    reply draft. Cleanup is synchronous (bun:sqlite is) and also runs from
//    `fail()`, so a mid-run abort leaves nothing behind.
//  - SETTINGS: the `admitted` flip needs a known sweep config, so the script
//    PATCHes the eight admission knobs and snapshot-restores each by
//    `isDefault` (D113(d)) — `resetSettings` would DELETE an override the
//    operator set on purpose, so a reset is never assumed to be the restore.
//
// One global write is inherent rather than smoke-caused and is asserted rather
// than hidden: `POST /radar/sightings` prunes every sighting older than the
// 60-day retention on the ingest path (§7.407, the `prunePassiveRuns` rule), so
// any real row that far back would go on the next real capture too.
//
// Run: bun run scripts/smoke-radar-access.ts

import { eq, like } from 'drizzle-orm';
import { Hono } from 'hono';
import { db } from '../src/db/client.ts';
import type { SweepConfig } from '../src/shared/radarSweep.ts';
import { radarDrafts, radarSightings, replyDrafts } from '../src/x/db/schema.ts';
import { radar } from '../src/x/routes/radar.ts';
import { settingsRouter } from '../src/x/routes/settings.ts';
import { resetSettings, resolveSetting, setSettings } from '../src/x/settings/registry.ts';

const app = new Hono();
app.route('/x', radar);
app.route('/x', settingsRouter);

// 18 digits, all ours.
const TWEET_PREFIX = '888000000000000';
const tid = (n: number): string => `${TWEET_PREFIX}${String(n).padStart(3, '0')}`;

// ≤15 chars, lowercase (handles are lowercased on every side, so seeds must be
// too) and no real account's. It is also the LIST FILTER every read below uses,
// which is what makes the summary counts deterministic on a populated DB.
const HANDLE = 'ra_smoke';

const A = tid(1); // oldest sighting, biggest views, slowest vpm
const B = tid(2); // fastest vpm — the row everything downstream drafts against
const C = tid(3); // newest sighting, the band-change row
const STALE = tid(9); // 61 days old, seeded directly, pruned by the next POST
const GHOST = tid(99); // never ingested — the compose 404

const MIN = 60_000;
const DAY_MS = 24 * 60 * 60 * 1000;

// ------------------------------------------------------- snapshot / restore

interface Snapshot {
  value: unknown;
  isDefault: boolean;
}
const touched = new Map<string, Snapshot>();

function remember(keys: string[]): void {
  for (const key of keys) {
    if (!touched.has(key)) touched.set(key, resolveSetting(key));
  }
}

function restoreSettings(): void {
  for (const [key, prev] of touched) {
    if (prev.isDefault) resetSettings({ keys: [key] });
    else setSettings({ [key]: prev.value });
  }
  touched.clear();
}

function cleanup(): void {
  try {
    db.delete(replyDrafts)
      .where(like(replyDrafts.sourceTweetId, `${TWEET_PREFIX}%`))
      .run();
    db.delete(radarDrafts)
      .where(like(radarDrafts.tweetId, `${TWEET_PREFIX}%`))
      .run();
    db.delete(radarSightings)
      .where(like(radarSightings.tweetId, `${TWEET_PREFIX}%`))
      .run();
  } catch (err) {
    console.error('cleanup failed:', err instanceof Error ? err.message : err);
  }
  restoreSettings();
}

function fail(msg: string): never {
  console.error(`FAIL: ${msg}`);
  cleanup();
  process.exit(1);
}

function ok(msg: string): void {
  console.log(`  ok · ${msg}`);
}

// ------------------------------------------------------------------ helpers

// `app.request` is typed Response | Promise<Response> — every helper must be
// async or root typecheck (which covers scripts/) rejects the return type.
async function post(path: string, body: unknown): Promise<{ status: number; body: unknown }> {
  const res = await app.request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

async function patchJson(path: string, body: unknown): Promise<{ status: number; body: unknown }> {
  const res = await app.request(path, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

async function get(path: string): Promise<{ status: number; body: unknown }> {
  const res = await app.request(path);
  return { status: res.status, body: await res.json() };
}

interface IngestBody {
  inserted: number;
  updated: number;
  skippedRecent: number;
  skippedCap: number;
}

interface SightingRow {
  tweetId: string;
  band: string;
  views: number;
  vpm: number | null;
  ageMinAtLastSeen: number | null;
  admitted: boolean | null;
  worked: boolean;
  dismissed: boolean;
  drafted: boolean;
  replied: boolean;
  seenCount: number;
  sourcePath: string | null;
  handle: string;
}

interface ListBody {
  days: number;
  queue: boolean;
  order: string;
  sweep: SweepConfig;
  count: number;
  truncated: boolean;
  summary: {
    total: number;
    admitted: number;
    worked: number;
    dismissed: number;
    unworkedAdmitted: number;
    byBand: Record<string, number>;
    bySourcePath: Record<string, number>;
    topHandles: { handle: string; sightings: number }[];
  };
  sightings: SightingRow[];
}

interface DraftRow {
  id: number;
  tweetId: string;
  band: string;
  status: string;
  model: string | null;
  angle: string;
  replyText: string;
  curationScore: number | null;
  draftedAt: string;
  signals: { views: number; replies: number; ageMin: number; vpm: number; bait: boolean } | null;
  variants: { text: string; angle: string }[] | null;
}

const now = Date.now();
const iso = (msAgo: number): string => new Date(now - msAgo).toISOString();

function wireRow(over: Record<string, unknown>): Record<string, unknown> {
  return {
    handle: HANDLE,
    author: 'RA smoke',
    text: 'ra smoke — a swept sighting',
    band: 'sweep',
    bait: false,
    verified: true,
    likes: 3,
    replies: 2,
    ...over,
  };
}

// Built so the THREE orders are THREE DIFFERENT sequences — with the obvious
// fixture set (views tracking vpm) `order=views` and `order=vpm` return the same
// list and the parameter is untested by construction.
//   views    → A(1500) C(1200) B(900)
//   vpm      → B(900/1) C(1200/6) A(1500/30)
//   lastSeen → C B A
//
// `seenAt` is SECONDS back, not minutes, and that is load-bearing rather than
// cosmetic: the recapture throttle measures `now − last_seen_at`, not "how long
// since the last POST", so a fixture backdated past the 60 s window would be
// UPDATED by the re-POST below instead of skipped, and the throttle assertion
// would silently test nothing. `ageMin` is independent of it (the post time is
// derived as `seenAt − ageMin`), so the vpm spread survives the squeeze.
const ROWS: Record<string, unknown>[] = [
  wireRow({ tweetId: A, views: 1500, ageMin: 30, seenAt: iso(3000), sourcePath: '/home' }),
  wireRow({ tweetId: B, views: 900, ageMin: 1, seenAt: iso(2000), sourcePath: '/search' }),
  wireRow({ tweetId: C, views: 1200, ageMin: 6, seenAt: iso(1000), sourcePath: '/i/lists/9' }),
];

function idsOf(list: SightingRow[]): string[] {
  return list.filter((s) => s.tweetId.startsWith(TWEET_PREFIX)).map((s) => s.tweetId);
}

// The queue read, asked for by MEMBERSHIP (sorted) rather than by rank — the
// three orders are asserted once, in section 3, and re-asserting them here
// would make an ordering change look like a queue-predicate bug. The two echo
// checks ride along on every call because they are the cheap half of the
// contract: `queue: true` says which predicate produced the list, and `days: 1`
// says the 24 h TTL window was used and any `days` was ignored.
async function queueIds(): Promise<string[]> {
  const body = (await get(`/x/radar/sightings?handle=${HANDLE}&queue=true`)).body as ListBody;
  if (body.queue !== true) fail('the queue read does not echo `queue: true`');
  if (body.days !== 1) fail(`queue=true reported days ${body.days}, expected the 24 h TTL window`);
  return idsOf(body.sightings).sort();
}

// Leftovers from an aborted run would turn the first insert into an update.
cleanup();

// ------------------------------------------------------------- 1. the ingest

console.log('1. ingest');

const first = await post('/x/radar/sightings', { rows: ROWS });
if (first.status !== 201) fail(`POST /radar/sightings returned ${first.status}, expected 201`);
const firstBody = first.body as IngestBody;
if (firstBody.skippedCap > 0) {
  fail(`skippedCap ${firstBody.skippedCap} — today's sighting corpus is at the 2,000-row cap`);
}
if (firstBody.inserted !== 3 || firstBody.updated !== 0 || firstBody.skippedRecent !== 0) {
  fail(`first POST answered ${JSON.stringify(firstBody)}, expected 3 inserted / 0 / 0`);
}
ok('3 sightings inserted, one row per tweet');

const again = (await post('/x/radar/sightings', { rows: ROWS })).body as IngestBody;
if (again.inserted !== 0 || again.updated !== 0 || again.skippedRecent !== 3) {
  fail(`re-POST answered ${JSON.stringify(again)}, expected 0 / 0 / 3 skippedRecent`);
}
ok('an immediate re-POST of the same three is skippedRecent (the 60 s window)');

// D188a: a band change is a real event (a ⊕ pin landing on a swept row), not
// scroll noise, so it must not wait out a throttle meant for scroll noise —
// and the same-millisecond case is exactly why the freshness tie-break is `>=`.
const punched = (
  await post('/x/radar/sightings', {
    rows: [
      wireRow({ tweetId: C, views: 1200, ageMin: 6, band: 'manual', sourcePath: '/i/lists/9' }),
    ],
  })
).body as IngestBody;
if (punched.updated !== 1 || punched.skippedRecent !== 0) {
  fail(`the band-change re-POST answered ${JSON.stringify(punched)}, expected 1 updated`);
}
const [cRow] = db.select().from(radarSightings).where(eq(radarSightings.tweetId, C)).all();
if (!cRow) fail('the band-change row vanished');
if (cRow.band !== 'manual') fail(`the band ratchet stored '${cRow.band}', expected 'manual'`);
if (cRow.seenCount !== 2) fail(`seen_count is ${cRow.seenCount}, expected 2`);
ok('a band change punches through the throttle and ratchets sweep → manual (seen_count 2)');

// ---------------------------------------------------------------- 2. guards

console.log('2. guards');

const before = db
  .select()
  .from(radarSightings)
  .where(like(radarSightings.tweetId, `${TWEET_PREFIX}%`))
  .all().length;
const bad = await post('/x/radar/sightings', {
  rows: [
    wireRow({ tweetId: tid(20), views: 10, ageMin: 5 }),
    wireRow({ tweetId: tid(21), views: 10, ageMin: 5, handle: 'not a handle' }),
  ],
});
if (bad.status !== 400) fail(`a batch with one bad row returned ${bad.status}, expected 400`);
const badBody = bad.body as { error: string; index: number };
if (badBody.error !== 'handle_invalid' || badBody.index !== 1) {
  fail(`the bad row answered ${JSON.stringify(badBody)}, expected handle_invalid at index 1`);
}
const after = db
  .select()
  .from(radarSightings)
  .where(like(radarSightings.tweetId, `${TWEET_PREFIX}%`))
  .all().length;
if (after !== before) fail('one bad row 400d but the GOOD row in the same batch was written');
ok('one bad row 400s the whole batch by field + index, and nothing lands');

const oversized = await post('/x/radar/sightings', {
  rows: Array.from({ length: 101 }, (_, i) =>
    wireRow({ tweetId: tid(300 + i), views: 10, ageMin: 5 }),
  ),
});
const oversizedBody = oversized.body as { error: string; max: number };
if (
  oversized.status !== 400 ||
  oversizedBody.error !== 'too_many_rows' ||
  oversizedBody.max !== 100
) {
  fail(`a 101-row batch answered ${oversized.status} ${JSON.stringify(oversizedBody)}`);
}
ok('a 101-row batch is refused 400 too_many_rows before the DB is touched');

// The one global write on this path — asserted, not hidden.
const staleAt = new Date(now - 61 * DAY_MS);
db.insert(radarSightings)
  .values({
    tweetId: STALE,
    handle: HANDLE,
    text: 'ra smoke — a 61-day-old sighting',
    band: 'sweep',
    views: 10,
    replies: 0,
    bait: false,
    firstSeenAt: staleAt,
    lastSeenAt: staleAt,
    postedAt: staleAt,
  })
  .run();
await post('/x/radar/sightings', {
  rows: [wireRow({ tweetId: tid(4), views: 10, ageMin: 5, sourcePath: '/home' })],
});
if (db.select().from(radarSightings).where(eq(radarSightings.tweetId, STALE)).all().length > 0) {
  fail('a 61-day-old sighting survived the lazy prune on the ingest path');
}
db.delete(radarSightings)
  .where(eq(radarSightings.tweetId, tid(4)))
  .run();
ok('the next POST pruned a 61-day-old sighting (60-day retention, no worker)');

// ------------------------------------------------- 3. the read + the flip

console.log('3. the corpus read');

// A KNOWN sweep config, so `admitted` is a fact about the row rather than about
// whatever the operator last tuned. Everything but the age gate is opened all
// the way (0 = no ceiling), which leaves `maxAgeMin` as the single axis the
// flip below moves. The two CONTENT gates (media, ads) are absent on purpose:
// `radar_sightings` stores neither signal, so `buildSightingViews` forces both
// off — patching them here would imply they can move this read, and they can't.
const PERMISSIVE: Record<string, number | boolean> = {
  'x.sweep.minViews': 0,
  'x.sweep.maxViews': 0,
  'x.sweep.minLikes': 0,
  'x.sweep.maxLikes': 0,
  'x.sweep.minReplies': 0,
  'x.sweep.maxReplies': 0,
  'x.sweep.maxAgeMin': 1440,
  'x.sweep.verifiedOnly': false,
};
remember(Object.keys(PERMISSIVE));
const patched = await patchJson('/x/settings', PERMISSIVE);
if (patched.status !== 200) fail(`PATCH /x/settings returned ${patched.status}`);

const wide = (await get(`/x/radar/sightings?handle=${HANDLE}&days=1`)).body as ListBody;
if (wide.sweep.maxAgeMin !== 1440 || wide.sweep.verifiedOnly !== false) {
  fail(`the echoed sweep config is not the one just patched: ${JSON.stringify(wide.sweep)}`);
}
if (wide.summary.total !== 3 || wide.summary.admitted !== 3) {
  fail(`wide-open config: ${wide.summary.admitted}/${wide.summary.total} admitted, expected 3/3`);
}
if (wide.truncated) fail('the scan cap truncated a 3-row filtered read');
ok('with the gates open all three rows read admitted, and `sweep` echoes the live config');

// THE FLIP: the same three rows, one knob moved, two verdicts changed. This is
// the lane's headline caveat made observable — `admitted` is judged against
// TODAY's config, at the age the row had when it was LAST SEEN.
const strict = await patchJson('/x/settings', { 'x.sweep.maxAgeMin': 10 });
if (strict.status !== 200) fail(`PATCH maxAgeMin returned ${strict.status}`);

const list = (await get(`/x/radar/sightings?handle=${HANDLE}&days=1`)).body as ListBody;
if (list.summary.admitted !== 2) {
  fail(`after maxAgeMin=10: ${list.summary.admitted} admitted, expected 2 (A is 30 min old)`);
}
const aView = list.sightings.find((s) => s.tweetId === A);
if (!aView) fail('the 30-minute-old row fell out of its own handle filter');
if (aView.admitted !== false) fail('a 30-minute-old row is admitted under maxAgeMin=10');
if (aView.ageMinAtLastSeen !== 30) {
  fail(
    `ageMinAtLastSeen is ${aView.ageMinAtLastSeen}, expected 30 — the age is judged at LAST SEEN`,
  );
}
ok('one knob moved and two verdicts changed — `admitted` is recomputed, never stored');

const s = list.summary;
if (s.total !== 3 || s.worked !== 0 || s.unworkedAdmitted !== 2) {
  fail(`summary ${JSON.stringify(s)}, expected total 3 / worked 0 / unworkedAdmitted 2`);
}
if (s.byBand.sweep !== 2 || s.byBand.manual !== 1) {
  fail(`byBand ${JSON.stringify(s.byBand)}, expected 2 sweep / 1 manual`);
}
if (
  s.bySourcePath['/home'] !== 1 ||
  s.bySourcePath['/search'] !== 1 ||
  s.bySourcePath['/i/lists/9'] !== 1
) {
  fail(`bySourcePath ${JSON.stringify(s.bySourcePath)} — the off-/home sweep is the whole point`);
}
if (s.topHandles[0]?.handle !== HANDLE || s.topHandles[0]?.sightings !== 3) {
  fail(`topHandles ${JSON.stringify(s.topHandles)}`);
}
ok('the summary counts the whole filtered population — bands, source paths, top handles');

const byViews = idsOf(
  ((await get(`/x/radar/sightings?handle=${HANDLE}&days=1&order=views`)).body as ListBody)
    .sightings,
);
const byVpm = idsOf(list.sightings);
const byLastSeen = idsOf(
  ((await get(`/x/radar/sightings?handle=${HANDLE}&days=1&order=lastSeen`)).body as ListBody)
    .sightings,
);
if (byViews.join() !== [A, C, B].join()) fail(`order=views gave ${byViews.join()}`);
if (byVpm.join() !== [B, C, A].join()) fail(`order=vpm (default) gave ${byVpm.join()}`);
if (byLastSeen.join() !== [C, B, A].join()) fail(`order=lastSeen gave ${byLastSeen.join()}`);
ok('the three orders are three different sequences (views ≠ vpm ≠ lastSeen)');

const filtered = (await get(`/x/radar/sightings?handle=${HANDLE}&days=1&admitted=true`))
  .body as ListBody;
if (idsOf(filtered.sightings).length !== 2 || filtered.sightings.some((v) => v.tweetId === A)) {
  fail('admitted=true did not narrow to the two young rows');
}
const lenient = await get(`/x/radar/sightings?handle=${HANDLE}&admitted=1`);
if (lenient.status !== 400 || (lenient.body as { error: string }).error !== 'invalid_admitted') {
  fail(`admitted=1 answered ${lenient.status} — a FILTER may not be leniently parsed (D190a)`);
}
ok('admitted=true filters; admitted=1 is a 400, not a silently unfiltered list');

const detail = await get(`/x/radar/sightings/${B}`);
if (detail.status !== 200) fail(`GET /radar/sightings/:tweetId returned ${detail.status}`);
const detailBody = detail.body as {
  sweep: SweepConfig;
  sighting: SightingRow;
  drafts: DraftRow[];
  replies: unknown[];
};
if (detailBody.sighting.tweetId !== B) fail('the detail read returned another tweet');
if (detailBody.sighting.worked !== false) fail('an undrafted sighting reads worked');
if (detailBody.drafts.length !== 0 || detailBody.replies.length !== 0) {
  fail('a never-drafted tweet came back with drafts or replies');
}
if (detailBody.sweep.maxAgeMin !== 10) fail('the detail read does not echo the sweep config');
const missing = await get(`/x/radar/sightings/${GHOST}`);
if (missing.status !== 404) fail(`an unknown tweet id returned ${missing.status}, expected 404`);
ok('the detail read carries the sighting + its (empty) draft and reply history');

// -------------------------------------------------------- 4. the live queue

console.log('4. the live queue');

// RQ.3. `queue=true` is the PANEL's predicate, server-side: last seen inside
// the 24 h TTL, not dismissed, not worked. It exists because the panel's
// dismissals used to live only in `chrome.storage.local` — the panel showed
// `Queue (35)` and a drafting session read 55, re-surfacing ~20 tweets the
// operator had already thrown away.
if (JSON.stringify(await queueIds()) !== JSON.stringify([A, B, C].sort())) {
  fail('queue=true does not list the three live, undismissed, unworked rows');
}
ok('queue=true lists the live queue and echoes the window it actually used');

const dismiss = await patchJson('/x/radar/sightings', { tweetIds: [A], dismissed: true });
if (dismiss.status !== 200) fail(`PATCH /radar/sightings returned ${dismiss.status}, expected 200`);
if ((dismiss.body as { updated: number }).updated !== 1) {
  fail(`the dismiss answered ${JSON.stringify(dismiss.body)}, expected updated 1`);
}
if (JSON.stringify(await queueIds()) !== JSON.stringify([B, C].sort())) {
  fail('a dismissed row is still in the queue — the panel and an agent disagree again');
}
ok('a PATCHed dismissal leaves the queue (this is what the panel ✕ now mirrors)');

// Dropped from the QUEUE, kept in the CORPUS (60-day retention) — and the
// unfiltered read still explains itself rather than just being short one row.
const withDismissed = (await get(`/x/radar/sightings?handle=${HANDLE}&days=1`)).body as ListBody;
if (withDismissed.summary.total !== 3 || withDismissed.summary.dismissed !== 1) {
  fail(
    `the days-based read summarises ${JSON.stringify(withDismissed.summary)}, expected total 3 / dismissed 1`,
  );
}
if (withDismissed.sightings.find((v) => v.tweetId === A)?.dismissed !== true) {
  fail('the dismissed row does not read `dismissed: true` on an unfiltered read');
}
ok('the corpus keeps the row and says so — `dismissed` is a view field and a summary count');

const reDismiss = await patchJson('/x/radar/sightings', { tweetIds: [A], dismissed: true });
if ((reDismiss.body as { updated: number }).updated !== 0) {
  fail(`a re-dismiss answered ${JSON.stringify(reDismiss.body)}, expected updated 0 — the ratchet`);
}
ok('a second dismiss of the same row updates nothing (§7.10 — the stamp is a ratchet)');

// -------------------------------------------------------------- 5. compose

console.log('5. compose');

const ghost = await post('/x/radar/drafts/compose', {
  tweetId: GHOST,
  variants: [{ text: 'no anchor, no draft', angle: 'observation' }],
});
if (ghost.status !== 404 || (ghost.body as { error: string }).error !== 'sighting_not_found') {
  fail(`composing against an un-sighted tweet answered ${ghost.status}`);
}
// Not `network`: that IS in `REPLY_ANGLES` and the route accepts it (D194a — it
// is a different OBJECTIVE, scoped out by `trimToModeAngles` on the drafting
// path and by the radar-analyst skill's own rule, not by this validator).
const badAngle = await post('/x/radar/drafts/compose', {
  tweetId: B,
  variants: [{ text: 'fine', angle: 'sarcasm' }],
});
if (badAngle.status !== 400 || (badAngle.body as { error: string }).error !== 'invalid_angle') {
  fail(`an out-of-set angle answered ${badAngle.status}`);
}
ok('compose refuses an un-sighted tweet (404) and an out-of-set angle (400), before writing');

const composed = await post('/x/radar/drafts/compose', {
  tweetId: B,
  variants: [
    { text: 'ra smoke — the observation variant', angle: 'observation' },
    { text: 'ra smoke — the question variant', angle: 'question' },
  ],
});
if (composed.status !== 201) fail(`compose returned ${composed.status}, expected 201`);
const draft = composed.body as DraftRow;
// D186 / §7.16: band and signals come from OUR row, and `draftRowToSighting`
// returns null without either — a draft missing them is an invisible feature
// that every test still passes.
if (draft.band !== 'sweep')
  fail(`the composed draft's band is '${draft.band}', not the sighting's`);
if (!draft.signals)
  fail('the composed draft carries no signals — the panel would drop it silently');
if (draft.signals.views !== 900)
  fail(`signals.views ${draft.signals.views}, expected the stored 900`);
if (draft.signals.vpm !== Math.round((900 / Math.max(draft.signals.ageMin, 1)) * 100) / 100) {
  fail('signals.vpm is not sightingVpm(views, ageMin) — the formula has forked');
}
if (draft.model !== 'claude-code-mcp')
  fail(`model '${draft.model}' — the cohort key is a contract`);
if (draft.status !== 'ready') fail(`status '${draft.status}', expected ready`);
if (draft.curationScore !== null)
  fail('curationScore must be null, never 0 — this never went through curation');
if (draft.variants?.length !== 2) fail('the composed draft lost a variant');
ok('a composed draft is band + signals stamped from the sighting, ready, model claude-code-mcp');

// The 201 is not evidence the panel shows anything (RA.4): the queue rehydrates
// through GET /radar/drafts, which applies its own lazy TTL flip and status
// defaulting. Re-read through the surface the panel actually uses.
const pulled = (await get(`/x/radar/drafts?tweetId=${B}`)).body as {
  count: number;
  drafts: DraftRow[];
};
if (pulled.count !== 1 || pulled.drafts[0]?.id !== draft.id) {
  fail(
    'the composed draft is not visible through GET /radar/drafts — the panel would show nothing',
  );
}
ok('it reaches the panel through GET /radar/drafts, the surface Fetch drafts pulls');

const second = await post('/x/radar/drafts/compose', {
  tweetId: B,
  variants: [{ text: 'ra smoke — the second pass', angle: 'extends' }],
});
if (second.status !== 201) fail(`the second compose returned ${second.status}`);
const secondDraft = second.body as DraftRow;
const live = (await get(`/x/radar/drafts?tweetId=${B}`)).body as {
  count: number;
  drafts: DraftRow[];
};
if (live.count !== 1 || live.drafts[0]?.id !== secondDraft.id) {
  fail(
    `after a second compose ${live.count} rows are live — "newest ready row wins" is not deterministic`,
  );
}
const expired = (await get(`/x/radar/drafts?tweetId=${B}&status=expired`)).body as {
  count: number;
  drafts: DraftRow[];
};
if (expired.count !== 1 || expired.drafts[0]?.id !== draft.id) {
  fail('the first composed draft was not expired by the second — two writers race the rehydrate');
}
ok('composing again expires the previous ready row; exactly one survives');

// -------------------------------------------------------------- 6. confirm

console.log('6. confirm');

const confirmed = await post(`/x/radar/drafts/${B}/confirm`, {});
if (confirmed.status !== 201) fail(`confirm returned ${confirmed.status}, expected 201`);
const reply = confirmed.body as {
  id: number;
  model: string | null;
  source: string;
  status: string;
  sourceTweetId: string;
  sourcePostedAt: string | null;
};
if (reply.model !== 'claude-code-mcp') {
  fail(
    `the reply_drafts row carries model '${reply.model}' — the Claude-vs-Grok split reads THIS column`,
  );
}
if (reply.source !== 'radar' || reply.status !== 'copied') {
  fail(`the confirmed row is ${reply.source}/${reply.status}, expected radar/copied`);
}
if (!reply.sourcePostedAt)
  fail('the confirmed row has no sourcePostedAt — the latency reader needs it');
// draftedAt − ageMin, the derivation the Playbook's latency reader believes.
const expectedPostedAt =
  Date.parse(secondDraft.draftedAt) - (secondDraft.signals?.ageMin ?? 0) * MIN;
if (Math.abs(Date.parse(reply.sourcePostedAt) - expectedPostedAt) > 1000) {
  fail(`sourcePostedAt ${reply.sourcePostedAt} is not draftedAt − signals.ageMin`);
}
const clicked = (await get(`/x/radar/drafts?tweetId=${B}`)).body as { drafts: DraftRow[] };
if (clicked.drafts[0]?.status !== 'clicked')
  fail('confirm did not ratchet the radar draft to clicked');
ok('confirm lands a reply_drafts row (radar/copied, the cohort model, the true post time)');

// ------------------------------------------------------------- 7. worked

console.log('7. the loop closes');

const worked = (await get(`/x/radar/sightings/${B}`)).body as {
  sighting: SightingRow;
  drafts: DraftRow[];
  replies: unknown[];
};
if (!worked.sighting.drafted || !worked.sighting.worked) {
  fail('the composed-against tweet does not read worked');
}
// `replied` counts only a POSTED reply_drafts row — a `copied` draft never
// reached anyone (the RA.3 asymmetry, and it is deliberate on both halves).
if (worked.sighting.replied) fail('a copied — not posted — reply made the sighting read replied');
if (worked.drafts.length !== 2 || worked.replies.length !== 1) {
  fail(
    `the history reads ${worked.drafts.length} drafts / ${worked.replies.length} replies, expected 2 / 1`,
  );
}
const unworked = (await get(`/x/radar/sightings?handle=${HANDLE}&days=1&worked=false`))
  .body as ListBody;
if (idsOf(unworked.sightings).length !== 2 || unworked.sightings.some((v) => v.tweetId === B)) {
  fail('worked=false still lists the drafted tweet');
}
ok('drafting IS the work: the row leaves the unworked queue the moment compose returns');

if (JSON.stringify(await queueIds()) !== JSON.stringify([C])) {
  fail('the drafted tweet is still in the queue — a drafting pass would re-surface its own work');
}
ok('one dismissed and one drafted later, the live queue is down to the one untouched row');

// The server mirror of the panel's `purgeDismissed`: a ⊕ pin (band `manual`) is
// the ONLY thing that clears a dismissal. A plain re-sighting must not, which is
// why the tombstone survives the scroll that put the card back on screen — that
// half is `corpus.test.ts`'s, because the 60 s recapture throttle would skip a
// same-band re-POST here before the merge rule ever ran.
const repinned = (
  await post('/x/radar/sightings', {
    rows: [wireRow({ tweetId: A, views: 1600, ageMin: 31, band: 'manual', sourcePath: '/home' })],
  })
).body as IngestBody;
if (repinned.updated !== 1 || repinned.skippedRecent !== 0) {
  fail(`the ⊕ re-pin answered ${JSON.stringify(repinned)}, expected 1 updated`);
}
if (JSON.stringify(await queueIds()) !== JSON.stringify([A, C].sort())) {
  fail('a manual-band re-ingest did not clear the dismissal — the pin is the one way back');
}
ok('a ⊕ pin (band `manual`) is the one thing that puts a dismissed row back in the queue');

// ------------------------------------------------------------- 8. cleanup

console.log('8. cleanup');

cleanup();
const leftSightings = db
  .select()
  .from(radarSightings)
  .where(like(radarSightings.tweetId, `${TWEET_PREFIX}%`))
  .all();
const leftDrafts = db
  .select()
  .from(radarDrafts)
  .where(like(radarDrafts.tweetId, `${TWEET_PREFIX}%`))
  .all();
const leftReplies = db
  .select()
  .from(replyDrafts)
  .where(like(replyDrafts.sourceTweetId, `${TWEET_PREFIX}%`))
  .all();
if (leftSightings.length + leftDrafts.length + leftReplies.length > 0) {
  fail(
    `survivors: ${leftSightings.length} sightings / ${leftDrafts.length} drafts / ${leftReplies.length} replies`,
  );
}
const sweepNow = ((await get('/x/radar/sightings?days=1&limit=1')).body as ListBody).sweep;
const liveMaxAge = Number(resolveSetting('x.sweep.maxAgeMin').value);
if (sweepNow.maxAgeMin !== liveMaxAge) fail('the operator’s sweep config was not restored');
ok('every seeded row removed and the eight sweep knobs restored to the operator’s own values');

console.log('SMOKE PASS ($0 — no X API, no LLM, and no flag that would add one)');
process.exit(0);
