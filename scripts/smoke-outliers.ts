// One-shot smoke for Outliers (OU.1–OU.7) — the x.com advanced-search hunt.
// Mounts `searchesRouter` + `settingsRouter` + the voice router in-process (no
// port, no workers) against the REAL DB and drives the whole surface at **$0**.
//
// **There is no `--live` flag, and the absence is the finding** (D171c, the
// `smoke-humanizer.ts` answer rather than `smoke-radar-curate.ts`'s). Nothing
// under `/x/searches` can reach `xFetch` or `askLLM` — every route is pure SQL
// over `saved_searches`/`voice_tweets` plus the dependency-free compiler in
// `src/shared/searchQuery.ts` — so there is no paid claim a keyless run fails
// to make. That is not an accident of this lane, it IS the lane: X API v2 has
// no `min_faves`/`min_retweets`/`min_replies` operator at any tier, so the API
// version of this feature would pay ~$0.005 per returned result to discard most
// of them. A `--live` flag here could only mean someone added a billed read
// back (CLAUDE.md invariant #8), which is a decision made out loud, not a flag.
//
//   1. `GET /searches/defaults` reflects the registry — the six `x.outliers.*`
//      knobs PATCHed to a known set and read back through the route, plus the
//      two arms only this route owns: a `lang` outside `SEARCH_LANGS` is
//      DROPPED WITH A WARN (never a refusal, §7.23a) and a `0` floor omits its
//      operator entirely.
//   2. Save → read back → run → patch, with the compiled string asserted
//      **byte-for-byte** and the `url` decoded back to that same string.
//   3. The refusal ladder: three uncompilable queries → `400 invalid_query`
//      with `problems`, and no row left behind. A warn-only query SAVES.
//   4. `POST /searches/compile` — the stateless preview, which answers **200
//      even when the query has errors**. The panel never calls it (it compiles
//      locally through the shim), so this script is its only caller.
//   5. The capture footer end-to-end (D220): a `POST /voice/scrape` carrying
//      `sourcePath: '/search?q=…'` moves `capture.savedFromSearch` by exactly
//      +1 and a `/home` one moves it by 0. **This is the whole reason step 5
//      exists.** The provenance string is written in `routes/voice.ts`
//      (`SOURCE_OUTLIER`) and read in `routes/searches.ts` (`CAPTURE_SOURCE`) —
//      two literals in two files with nothing between them, and a typo in
//      either leaves the footer reading 0 forever while both files' own unit
//      tests stay green.
//   6. DELETE → 204, then `404` on both the re-read and the re-delete.
//
//   bun run scripts/smoke-outliers.ts     # $0, rerunnable
//
// Every write is READ BACK through a second call (the RC.5/D184a lesson — a
// green POST is not proof a column exists), and cleanup fires the instant the
// DB half ends, from `fail()` as well as the success path: the fixtures are
// namespaced (`__smoke_outliers__` names, `9008xxx` tweet ids) and every
// `x.outliers.*` knob is snapshot-restored by `isDefault`, because `reset`
// would delete an override the operator set on purpose (D113(d)).

import { eq, inArray, like } from 'drizzle-orm';
import { Hono } from 'hono';
import { db } from '../src/db/client.ts';
import { FAVES_LADDER, type Problem, SEARCH_LANGS } from '../src/shared/searchQuery.ts';
import {
  people,
  personEvents,
  savedSearches,
  voiceAuthors,
  voiceTweets,
} from '../src/x/db/schema.ts';
import { searchesRouter } from '../src/x/routes/searches.ts';
import { settingsRouter } from '../src/x/routes/settings.ts';
import { createVoiceRouter } from '../src/x/routes/voice.ts';
import { resetSettings, resolveSetting, setSettings } from '../src/x/settings/registry.ts';

const app = new Hono();
app.route('/x', searchesRouter);
app.route('/x', settingsRouter);
app.route('/x', createVoiceRouter());

const NAME_PREFIX = '__smoke_outliers__';
// Handles must be ≤15 chars or `normalizeHandle` drops the whole tweet and the
// assertions below go vacuous.
const HANDLES = ['ou8hunter', 'ou8timeline'];
const ID_SEARCH = '9008001';
const ID_HOME = '9008002';
const TWEET_IDS = [ID_SEARCH, ID_HOME];

const OUTLIER_KEYS = [
  'x.outliers.minFaves',
  'x.outliers.minRetweets',
  'x.outliers.minReplies',
  'x.outliers.sinceDays',
  'x.outliers.lang',
  'x.outliers.sort',
];

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
    db.delete(savedSearches)
      .where(like(savedSearches.name, `${NAME_PREFIX}%`))
      .run();
    db.delete(voiceTweets).where(inArray(voiceTweets.tweetId, TWEET_IDS)).run();
    // The scrape fires the people-layer side hooks too; a leaked `people` row is
    // exactly the fixture that breaks a different suite's count somewhere else.
    db.delete(personEvents).where(inArray(personEvents.handle, HANDLES)).run();
    db.delete(people).where(inArray(people.handle, HANDLES)).run();
    db.delete(voiceAuthors).where(inArray(voiceAuthors.handle, HANDLES)).run();
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

// `app.request` is typed `Response | Promise<Response>`, so every helper is
// async or root typecheck (which covers `scripts/`) rejects the return type.
interface Reply {
  status: number;
  body: Record<string, unknown>;
}

async function send(method: string, path: string, body?: unknown): Promise<Reply> {
  const res = await app.request(path, {
    method,
    ...(body === undefined
      ? {}
      : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
  });
  if (res.status === 204) return { status: 204, body: {} };
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

const get = (path: string): Promise<Reply> => send('GET', path);
const post = (path: string, body?: unknown): Promise<Reply> => send('POST', path, body);
const patch = (path: string, body: unknown): Promise<Reply> => send('PATCH', path, body);
const del = (path: string): Promise<Reply> => send('DELETE', path);

/** The route's own window arithmetic, restated — `localDaysAgo` is private to
 *  `routes/searches.ts`, and building the date through the `Date` constructor
 *  (rather than `now - days * 86400000`) is what keeps a month boundary or a
 *  DST shift from landing the expectation a day off the route's answer. */
function localDaysAgo(days: number): string {
  const now = new Date();
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - days);
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${month}-${day}`;
}

interface Hydrated {
  saved: {
    id: string;
    name: string;
    query: Record<string, unknown> | null;
    sort: string;
    pinned: boolean;
    lastRunAt: string | null;
    createdAt: string;
    updatedAt: string;
  };
  compiled: { query: string; length: number; overLimit: boolean; problems: Problem[] } | null;
  url: string | null;
}

function hydrated(r: Reply, what: string): Hydrated {
  const h = r.body as unknown as Hydrated;
  if (!h.saved || typeof h.saved.id !== 'string')
    fail(`${what}: no saved row in ${JSON.stringify(r.body)}`);
  return h;
}

function problemsOf(body: Record<string, unknown>): Problem[] {
  return Array.isArray(body.problems) ? (body.problems as Problem[]) : [];
}

/** The Open-in-X hand-off's real claim: not "a url came back" but "the url
 *  carries exactly the string the user was shown". */
function assertUrlCarries(url: string | null, query: string, sort: string, what: string): void {
  if (!url) fail(`${what}: url is null for a compilable query`);
  const parsed = new URL(url);
  if (parsed.origin + parsed.pathname !== 'https://x.com/search')
    fail(`${what}: url is not an x.com search page — ${url}`);
  const q = parsed.searchParams.get('q');
  if (q !== query) fail(`${what}: url q= decodes to ${JSON.stringify(q)}, not the compiled string`);
  if (parsed.searchParams.get('f') !== sort)
    fail(`${what}: url f= is ${parsed.searchParams.get('f')}, expected ${sort}`);
}

async function captureCount(): Promise<number> {
  const list = await get('/x/searches');
  if (list.status !== 200) fail(`GET /x/searches → ${list.status}`);
  const capture = list.body.capture as { savedFromSearch?: unknown; days?: unknown } | undefined;
  if (!capture || typeof capture.savedFromSearch !== 'number' || typeof capture.days !== 'number')
    fail(`GET /x/searches has no numeric capture block: ${JSON.stringify(list.body.capture)}`);
  return capture.savedFromSearch;
}

async function scrape(tweetId: string, handle: string, sourcePath?: string): Promise<Reply> {
  return post('/x/voice/scrape', {
    tweet: {
      tweetId,
      handle,
      displayName: 'OU8',
      text: 'an outlier worth stealing the shape of',
      url: `https://x.com/${handle}/status/${tweetId}`,
    },
    ...(sourcePath === undefined ? {} : { sourcePath }),
  });
}

// A crashed prior run leaves namespaced rows behind; clearing them up front is
// what makes the counts below deltas rather than lies.
cleanup();

// ============================================================================
// 1. GET /searches/defaults reflects the six registry knobs
// ============================================================================
console.log('1. /x/searches/defaults — the registry is the fresh form');
remember(OUTLIER_KEYS);
{
  const KNOWN = {
    'x.outliers.minFaves': 777,
    'x.outliers.minRetweets': 12,
    'x.outliers.minReplies': 3,
    'x.outliers.sinceDays': 7,
    'x.outliers.lang': 'ro',
    'x.outliers.sort': 'live',
  };
  const patched = await patch('/x/settings', KNOWN);
  if (patched.status !== 200)
    fail(`PATCH /x/settings → ${patched.status} ${JSON.stringify(patched.body)}`);

  const d = await get('/x/searches/defaults');
  if (d.status !== 200) fail(`GET /x/searches/defaults → ${d.status}`);
  const q = d.body.query as Record<string, unknown>;
  if (q.minFaves !== 777 || q.minRetweets !== 12 || q.minReplies !== 3)
    fail(`the floors did not come from the registry: ${JSON.stringify(q)}`);
  if (q.lang !== 'ro') fail(`lang did not come from the registry: ${JSON.stringify(q)}`);
  if (q.sort !== 'live') fail(`sort did not come from the registry: ${JSON.stringify(q)}`);
  if (q.since !== localDaysAgo(7)) fail(`since is ${q.since}, expected ${localDaysAgo(7)}`);
  if (JSON.stringify(d.body.ladder) !== JSON.stringify([...FAVES_LADDER]))
    fail(`the ladder is not FAVES_LADDER: ${JSON.stringify(d.body.ladder)}`);
  if (problemsOf(d.body).length !== 0)
    fail(`a valid config reported problems: ${JSON.stringify(d.body.problems)}`);
  ok('all six knobs reach the fresh form, and `ladder` is FAVES_LADDER itself');

  // `x.outliers.lang` is an unvalidated `string` at the registry BY DESIGN
  // (`''` ships and an enum has no blank option), so this route is the one
  // place a bad code is caught — and it DROPS with a warn rather than refusing.
  const bad = await patch('/x/settings', { 'x.outliers.lang': 'zz' });
  if (bad.status !== 200) fail(`the registry refused a garbage lang: ${JSON.stringify(bad.body)}`);
  const warned = await get('/x/searches/defaults');
  if (warned.status !== 200) fail(`GET defaults after a bad lang → ${warned.status}`);
  const warnProblems = problemsOf(warned.body);
  if (
    warnProblems.length !== 1 ||
    warnProblems[0]?.level !== 'warn' ||
    warnProblems[0]?.field !== 'lang'
  )
    fail(`a bad lang did not warn: ${JSON.stringify(warned.body.problems)}`);
  if (!warnProblems[0]?.message.includes(SEARCH_LANGS.join(', ')))
    fail('the warn does not list the accepted codes, so it cannot be acted on');
  if ((warned.body.query as Record<string, unknown>).lang !== undefined)
    fail('a bad lang was compiled into the fresh form instead of being dropped');
  ok('an unlisted lang: is dropped with a warn — a fresh hunt still opens (§7.23a)');

  const zeroed = await patch('/x/settings', { 'x.outliers.minFaves': 0 });
  if (zeroed.status !== 200) fail(`PATCH minFaves=0 → ${zeroed.status}`);
  const off = await get('/x/searches/defaults');
  if ((off.body.query as Record<string, unknown>).minFaves !== undefined)
    fail('a floor of 0 still reached the form — `min_faves:0` is inert noise on the 512 budget');
  ok('a floor of 0 omits its operator entirely (the §7.11 carve-out)');
}

// ============================================================================
// 2. Save → read back → run → patch, with the string pinned byte-for-byte
// ============================================================================
console.log('2. save / read back / run / patch');

// Every clause the compiler orders, in one query: keywords → OR group → phrase
// → from: → negation → floor → filters → lang: → dates. If clause ORDER ever
// drifts, this literal is what says so — and order is what makes a saved hunt's
// string stable enough to diff.
const QUERY_A = {
  all: ['bun'],
  any: ['sqlite', 'drizzle'],
  phrases: ['ships on friday'],
  from: 'levelsio',
  none: ['crypto'],
  minFaves: 400,
  replies: 'exclude',
  noRetweets: true,
  lang: 'en',
  since: '2026-07-01',
  until: '2026-07-31',
  sort: 'top',
};
const COMPILED_A =
  'bun (sqlite OR drizzle) "ships on friday" from:levelsio -crypto min_faves:400 ' +
  '-filter:replies -filter:nativeretweets lang:en since:2026-07-01 until:2026-07-31';

let huntId = '';
{
  const created = await post('/x/searches', {
    name: `${NAME_PREFIX} clause order`,
    query: QUERY_A,
  });
  if (created.status !== 201)
    fail(`POST /x/searches → ${created.status} ${JSON.stringify(created.body)}`);
  const h = hydrated(created, 'POST /x/searches');
  huntId = h.saved.id;
  if (h.compiled?.query !== COMPILED_A)
    fail(`compiled string drifted:\n  got      ${h.compiled?.query}\n  expected ${COMPILED_A}`);
  ok(`created — the compiled string is byte-identical (${h.compiled.length} chars)`);

  // The read-back is the claim, not the 201 (D184a): a best-effort write that
  // silently stored nothing would still answer 201 off its in-memory value.
  const read = await get(`/x/searches/${huntId}`);
  if (read.status !== 200) fail(`GET /x/searches/:id → ${read.status}`);
  const back = hydrated(read, 'GET /x/searches/:id');
  if (back.compiled?.query !== COMPILED_A)
    fail(`the stored row recompiles differently: ${back.compiled?.query}`);
  if (back.saved.sort !== 'top') fail(`sort came back ${back.saved.sort}, expected top`);
  if (back.saved.lastRunAt !== null) fail('a never-run hunt reports a lastRunAt');
  assertUrlCarries(back.url, COMPILED_A, 'top', 'GET /x/searches/:id');
  ok('read back identical, and the url q= decodes to exactly that string (f=top)');

  // D208(a): the list item is the SAME shape as the detail read, which is what
  // lets the panel's Load path be one function instead of two.
  const list = await get('/x/searches');
  const items = (list.body.searches ?? []) as Hydrated[];
  const mine = items.find((i) => i.saved.id === huntId);
  if (!mine) fail('the saved hunt is missing from GET /x/searches');
  if (JSON.stringify(mine) !== JSON.stringify(back))
    fail('a list item is not byte-identical to the detail read (D208a)');
  ok('the list item is byte-identical to the detail read');

  const ran = await post(`/x/searches/${huntId}/run`);
  if (ran.status !== 200)
    fail(`POST /searches/:id/run → ${ran.status} ${JSON.stringify(ran.body)}`);
  assertUrlCarries(ran.body.url as string, COMPILED_A, 'top', 'run');
  const afterRun = hydrated(await get(`/x/searches/${huntId}`), 'GET after run');
  if (!afterRun.saved.lastRunAt) fail('run answered 200 but last_run_at is still null');
  if (afterRun.saved.updatedAt !== back.saved.updatedAt)
    fail('run stamped updated_at — a run is not an edit, and it would reorder the saved list');
  ok(`run stamped last_run_at (${afterRun.saved.lastRunAt}) and left updated_at alone`);

  const edited = await patch(`/x/searches/${huntId}`, {
    query: { ...QUERY_A, minFaves: 800, hashtags: ['buildinpublic'] },
  });
  if (edited.status !== 200)
    fail(`PATCH /x/searches/:id → ${edited.status} ${JSON.stringify(edited.body)}`);
  const expectedB = COMPILED_A.replace('from:levelsio', 'from:levelsio #buildinpublic').replace(
    'min_faves:400',
    'min_faves:800',
  );
  const patchedBack = hydrated(await get(`/x/searches/${huntId}`), 'GET after patch');
  if (patchedBack.compiled?.query !== expectedB)
    fail(
      `recompilation after PATCH:\n  got      ${patchedBack.compiled?.query}\n  expected ${expectedB}`,
    );
  if (!patchedBack.saved.lastRunAt) fail('the PATCH dropped last_run_at');
  ok('PATCH recompiles the stored row (floor moved, hashtag added) and keeps last_run_at');
}

// ============================================================================
// 3. The write path refuses an uncompilable query; a warn-only one saves
// ============================================================================
console.log('3. refusals (nothing written) and the warn/error split');
let warnHuntId = '';
{
  const before = ((await get('/x/searches')).body.searches as Hydrated[]).length;

  const cases: Array<[string, unknown, string]> = [
    // A form with only floors and filters is a request for the firehose minus a
    // bit of it — the one error that is about the query as a whole.
    ['floors with no matcher', { minFaves: 500, replies: 'exclude' }, 'query'],
    ['until before since', { all: ['bun'], since: '2026-07-31', until: '2026-07-01' }, 'until'],
    // X has no escape character, so one stray quote re-parses everything after
    // it — an error, never a silent strip.
    ['a quote inside a keyword', { all: ['say "no"'] }, 'all'],
  ];
  for (const [what, query, field] of cases) {
    const r = await post('/x/searches', { name: `${NAME_PREFIX} ${what}`, query });
    if (r.status !== 400 || r.body.error !== 'invalid_query')
      fail(`${what}: expected 400 invalid_query, got ${r.status} ${JSON.stringify(r.body)}`);
    const errors = problemsOf(r.body).filter((p) => p.level === 'error');
    if (!errors.some((p) => p.field === field))
      fail(`${what}: no error problem on \`${field}\`: ${JSON.stringify(r.body.problems)}`);
  }
  ok(`${cases.length} uncompilable queries refused with per-field problems`);

  const after = ((await get('/x/searches')).body.searches as Hydrated[]).length;
  if (after !== before) fail(`a refused write left ${after - before} row(s) behind`);
  ok(
    'every refusal wrote nothing — a stored row whose Copy can never work is the thing being prevented',
  );

  // The warn half never refuses (§7.23a): `build in public` inside the OR group
  // is a real mis-parse worth flagging and a perfectly storable hunt.
  const warned = await post('/x/searches', {
    name: `${NAME_PREFIX} warn only`,
    query: { any: ['build in public', 'indie hacker'], minFaves: 400, sort: 'live' },
  });
  if (warned.status !== 201)
    fail(`a warn-only query was refused: ${warned.status} ${JSON.stringify(warned.body)}`);
  const wh = hydrated(warned, 'warn-only save');
  warnHuntId = wh.saved.id;
  const problems = wh.compiled?.problems ?? [];
  if (problems.some((p) => p.level === 'error')) fail('a warn-only query reported an error');
  const warns = problems.filter((p) => p.level === 'warn' && p.field === 'any');
  if (warns.length !== 2) fail(`expected two multi-word warns, got ${JSON.stringify(problems)}`);
  const COMPILED_WARN = '(build in public OR indie hacker) min_faves:400';
  if (wh.compiled?.query !== COMPILED_WARN)
    fail(`warn-only compile:\n  got      ${wh.compiled?.query}\n  expected ${COMPILED_WARN}`);
  assertUrlCarries(wh.url, COMPILED_WARN, 'live', 'warn-only save');
  ok('a warn-only hunt saves, compiles and still gets a url — the warn half never refuses');
}

// ============================================================================
// 4. POST /searches/compile — the stateless preview (200 even with errors)
// ============================================================================
console.log('4. /x/searches/compile — a preview, not a gate');
{
  const before = ((await get('/x/searches')).body.searches as Hydrated[]).length;

  const good = await post('/x/searches/compile', { query: QUERY_A });
  if (good.status !== 200) fail(`compile → ${good.status}`);
  if (good.body.query !== COMPILED_A)
    fail(`compile disagrees with the stored row: ${good.body.query}`);
  if (good.body.length !== COMPILED_A.length || good.body.overLimit !== false)
    fail(
      `compile reported ${good.body.length}/${good.body.overLimit} for a ${COMPILED_A.length}-char query`,
    );
  assertUrlCarries(good.body.url as string, COMPILED_A, 'top', 'compile');

  const broken = await post('/x/searches/compile', { query: { minFaves: 500 } });
  if (broken.status !== 200) fail(`compile of a broken query → ${broken.status}, expected 200`);
  if (broken.body.url !== null) fail('compile handed back a url for a query with an error');
  if (!problemsOf(broken.body).some((p) => p.level === 'error'))
    fail(`compile of a matcher-less query reported no error: ${JSON.stringify(broken.body)}`);

  // The one thing that separates `compile` from the write paths.
  const after = ((await get('/x/searches')).body.searches as Hydrated[]).length;
  if (after !== before) fail('compile wrote a row');
  ok('compile answers 200 with `problems` + `url: null`, and stores nothing');
}

// ============================================================================
// 5. The capture footer, writer to reader (D220)
// ============================================================================
console.log('5. capture.savedFromSearch — the writer and the reader agree');
{
  const before = await captureCount();

  const fromSearch = await scrape(ID_SEARCH, 'ou8hunter', '/search?q=min_faves%3A400%20bun');
  if (fromSearch.status !== 201)
    fail(`scrape from /search → ${fromSearch.status} ${JSON.stringify(fromSearch.body)}`);
  const afterSearch = await captureCount();
  if (afterSearch !== before + 1)
    fail(`a save off a search page moved the footer by ${afterSearch - before}, expected +1`);

  const fromHome = await scrape(ID_HOME, 'ou8timeline', '/home');
  if (fromHome.status !== 201) fail(`scrape from /home → ${fromHome.status}`);
  const afterHome = await captureCount();
  if (afterHome !== afterSearch)
    fail(`a save off /home moved the footer by ${afterHome - afterSearch}, expected 0`);
  ok(`+1 for a /search save, +0 for a /home one — ${before} → ${afterHome} in the last 30 days`);

  // The two literals live in two files (`routes/voice.ts::SOURCE_OUTLIER` and
  // `routes/searches.ts::CAPTURE_SOURCE`) with nothing between them, so the
  // column itself is worth reading rather than trusting the delta.
  const stored = db.select().from(voiceTweets).where(eq(voiceTweets.tweetId, ID_SEARCH)).get();
  if (stored?.source !== 'outlier_search')
    fail(`the stored row reads source=${JSON.stringify(stored?.source)}, not outlier_search`);
  const home = db.select().from(voiceTweets).where(eq(voiceTweets.tweetId, ID_HOME)).get();
  if (home?.source !== 'extension_scrape')
    fail(`a /home save reads source=${JSON.stringify(home?.source)}, not extension_scrape`);
  ok('the column holds the provenance the footer counts (first save wins, insert-only)');
}

// ============================================================================
// 6. DELETE, and 404 on both the re-read and the re-delete
// ============================================================================
console.log('6. delete');
for (const id of [huntId, warnHuntId]) {
  const gone = await del(`/x/searches/${id}`);
  if (gone.status !== 204) fail(`DELETE /x/searches/${id} → ${gone.status}`);
  const read = await get(`/x/searches/${id}`);
  if (read.status !== 404) fail(`GET after DELETE → ${read.status}, expected 404`);
  const again = await del(`/x/searches/${id}`);
  if (again.status !== 404) fail(`a second DELETE → ${again.status}, expected 404`);
}
ok('both hunts deleted; the re-read and the re-delete are 404');

cleanup();
console.log('  ok · fixtures removed and every x.outliers.* knob restored to the operator’s value');
console.log('SMOKE OK');
process.exit(0);
