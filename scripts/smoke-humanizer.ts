// One-shot smoke for the project humanizer (HM.1–HM.4). Mounts `humanizerRouter`
// in-process (no port, no workers) against the REAL DB and drives the whole
// surface at **$0** — and that $0 is structural, not a promise: nothing under
// `/x/humanizer` can reach `xFetch` or `askLLM`, so there is no paid claim a
// keyless run fails to make and the script ships **no `--live` flag** (D171c).
//
//   1. GET → PATCH → GET round-trip over the real `app_settings` row, plus the
//      two things a `:memory:` route suite structurally cannot claim: that the
//      stored row is DURABLE (read back through raw SQL, not through the route
//      that wrote it) and that a reader bypassing HTTP entirely
//      (`getHumanizerSettings`) sees the same object — the store is
//      read-through with no cache, so the row IS the state that survives a
//      restart.
//   2. The 400 matrix (per-field codes + `empty_patch` + `invalid_body`) —
//      writes nothing, so it runs between the round-trip and the reset.
//   3. DELETE → defaults, and the row is really gone (missing row IS "untouched").
//   4. Pure-engine sanity: 500 seeded draws over `humanize` with the shipped
//      pools and every chance at 1 — the protected handle is never mutated,
//      `applied` only ever names known steps, nothing exceeds 280, and an
//      all-zero config is byte-identical to its input (the checkbox-off arm).
//
//   bun run scripts/smoke-humanizer.ts     # $0, rerunnable
//
// The real 'humanizer' row is a live user config, so it is snapshotted up front
// and restored the moment the DB half finishes (step 4 needs no DB). Rerunnable
// in the snapshot/restore sense rather than the namespace-then-delete one: there
// is exactly one row and it cannot be namespaced. See SENTINEL below for what a
// crashed prior run does to that.

import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { db } from '../src/db/client.ts';
import { appSettings } from '../src/db/shared-schema.ts';
import { DEFAULT_HUMANIZER, type HumanizerConfig, humanize } from '../src/shared/humanize.ts';
import { humanizerRouter } from '../src/x/routes/humanizer.ts';
import {
  HUMANIZER_SETTINGS_KEY,
  type HumanizerSettings,
  getHumanizerSettings,
} from '../src/x/settings/humanizer.ts';

const app = new Hono();
app.route('/x', humanizerRouter);

// A snapshot/restore smoke over a SINGLE row has a failure mode the
// namespace-then-delete ones don't: a run killed between the first PATCH and the
// restore leaves OUR config in the row, and the next run would snapshot that as
// "the original" and make it permanent. So every write this script makes carries
// a prefix no real pool would hold; finding it at entry means the row belongs to
// a crashed run, and the honest recovery is to treat the baseline as ABSENT
// (restore = delete = the documented "untouched" state) rather than to adopt it.
const SENTINEL = '__smoke_humanizer__';

interface StoredRow {
  key: string;
  value: unknown;
  updatedAt: Date;
}

function readRow(): StoredRow | undefined {
  return db.select().from(appSettings).where(eq(appSettings.key, HUMANIZER_SETTINGS_KEY)).get();
}

function looksLikeALeakedRun(row: StoredRow | undefined): boolean {
  return JSON.stringify(row?.value ?? null).includes(SENTINEL);
}

const rowBefore = readRow();
const baseline = looksLikeALeakedRun(rowBefore) ? undefined : rowBefore;
let restored = false;

function restore(): void {
  if (restored) return;
  restored = true;
  if (baseline) {
    db.insert(appSettings)
      .values(baseline)
      .onConflictDoUpdate({
        target: appSettings.key,
        set: { value: baseline.value, updatedAt: baseline.updatedAt },
      })
      .run();
  } else {
    db.delete(appSettings).where(eq(appSettings.key, HUMANIZER_SETTINGS_KEY)).run();
  }
}

function fail(msg: string): never {
  console.error(`FAIL: ${msg}`);
  restore();
  process.exit(1);
}

function ok(msg: string): void {
  console.log(`  ok: ${msg}`);
}

interface Reply {
  status: number;
  body: Partial<HumanizerSettings> & { error?: string };
}

async function req(method: string, body?: unknown): Promise<Reply> {
  const res = await app.request('/x/humanizer', {
    method,
    ...(body === undefined
      ? {}
      : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
  });
  return { status: res.status, body: (await res.json()) as Reply['body'] };
}

if (rowBefore && !baseline)
  console.log(
    `  note: the stored row carries ${SENTINEL} — a prior run died mid-way, so it is being reset to defaults rather than preserved.`,
  );

// ============================================================================
// 1. Round-trip over the real DB
// ============================================================================
console.log('1. GET/PATCH round-trip (real app_settings row)');
const PATCHED = {
  enabled: true,
  typoChance: 1,
  prefixChance: 0,
  prefixes: [`${SENTINEL} honestly,`, '  ', ' ok so '],
};
{
  const first = await req('GET');
  if (first.status !== 200) fail(`GET → ${first.status}`);
  for (const field of ['prefixes', 'suffixes'] as const) {
    if (!Array.isArray(first.body[field])) fail(`GET body missing ${field}`);
  }
  if (typeof first.body.enabled !== 'boolean' || typeof first.body.typoChance !== 'number')
    fail(`GET body shape wrong: ${JSON.stringify(first.body)}`);
  ok(`GET → 200, enabled=${first.body.enabled}, ${first.body.prefixes?.length} prefixes`);

  const patched = await req('PATCH', PATCHED);
  if (patched.status !== 200) fail(`PATCH → ${patched.status} ${JSON.stringify(patched.body)}`);
  // A blank entry is dropped, a padded one trimmed — the pool the route stores
  // is not the pool the caller sent, which is why the re-read below matters.
  if (patched.body.enabled !== true || patched.body.typoChance !== 1)
    fail(`PATCH did not apply: ${JSON.stringify(patched.body)}`);
  if (JSON.stringify(patched.body.prefixes) !== JSON.stringify([`${SENTINEL} honestly,`, 'ok so']))
    fail(`pool not trimmed/compacted: ${JSON.stringify(patched.body.prefixes)}`);
  // Untouched fields survive a partial PATCH — the route merges over CURRENT,
  // so the baseline is whatever the first GET returned. Comparing against
  // DEFAULT_HUMANIZER instead would pass on a clean checkout and fail on any
  // machine whose operator has actually customized the pools.
  if (JSON.stringify(patched.body.suffixes) !== JSON.stringify(first.body.suffixes))
    fail('PATCH replaced the whole row instead of merging over the stored one');
  ok('PATCH {enabled,typoChance,prefixChance,prefixes} → merged, trimmed, blanks dropped');

  const reread = await req('GET');
  if (JSON.stringify(reread.body) !== JSON.stringify(patched.body))
    fail(`GET after PATCH differs: ${JSON.stringify(reread.body)}`);
  ok('GET after PATCH is byte-identical to the PATCH response');

  // The two claims an in-memory route suite cannot make. Raw SQL, so nothing the
  // route layer caches (it caches nothing — that is the point) can fake it.
  const row = readRow();
  if (!row) fail('no app_settings row after PATCH — the write never landed');
  const stored = row.value as Record<string, unknown>;
  if (stored.enabled !== true || stored.typoChance !== 1)
    fail(`the persisted row does not hold the patch: ${JSON.stringify(stored)}`);
  const direct = getHumanizerSettings();
  if (JSON.stringify(direct) !== JSON.stringify(reread.body))
    fail(`getHumanizerSettings disagrees with the route: ${JSON.stringify(direct)}`);
  ok('the row on disk holds the patch, and a non-HTTP reader sees the same object');
}

// ============================================================================
// 2. The 400 matrix — refuse a typo'd config, never fall back silently
// ============================================================================
console.log('2. PATCH validation (writes nothing)');
{
  const cases: Array<[unknown, string]> = [
    [{ typoChance: 1.5 }, 'invalid_typo_chance'],
    [{ typoChance: 'high' }, 'invalid_typo_chance'],
    [{ lowercaseChance: -0.1 }, 'invalid_lowercase_chance'],
    [{ enabled: 'yes' }, 'invalid_enabled'],
    [{ prefixes: 'honestly,' }, 'invalid_prefixes'],
    [{ suffixes: [`${'x'.repeat(61)}`] }, 'invalid_suffixes'],
    [{ unknownField: 1 }, 'empty_patch'],
    [{}, 'empty_patch'],
  ];
  for (const [body, code] of cases) {
    const r = await req('PATCH', body);
    if (r.status !== 400 || r.body.error !== code)
      fail(`PATCH ${JSON.stringify(body)} expected 400 ${code}, got ${r.status} ${r.body.error}`);
  }
  ok(`${cases.length} refusals: per-field codes + empty_patch`);

  const notAnObject = await req('PATCH', ['honestly,']);
  if (notAnObject.status !== 400 || notAnObject.body.error !== 'invalid_body')
    fail(`an array body expected 400 invalid_body, got ${notAnObject.status}`);
  ok('an array body → 400 invalid_body');

  const untouched = await req('GET');
  if (untouched.body.typoChance !== 1 || untouched.body.enabled !== true)
    fail('a refused PATCH changed the stored config');
  ok('every refusal left the stored config exactly as it was');
}

// ============================================================================
// 3. DELETE = reset, and the row is really gone
// ============================================================================
console.log('3. DELETE → defaults');
{
  const reset = await req('DELETE');
  if (reset.status !== 200) fail(`DELETE → ${reset.status}`);
  if (JSON.stringify(reset.body) !== JSON.stringify({ ...DEFAULT_HUMANIZER, enabled: false }))
    fail(`DELETE did not return the defaults: ${JSON.stringify(reset.body)}`);
  if (readRow()) fail('DELETE left the row behind — a missing row IS the defaults');
  const after = await req('GET');
  if (JSON.stringify(after.body) !== JSON.stringify(reset.body))
    fail('GET after DELETE differs from the DELETE response');
  ok('DELETE removes the row and both reads return the engine defaults (enabled:false)');
}

// Every DB write is done. Restore now rather than at exit, so the window in
// which a crash could lose the real config is microseconds wide.
restore();
console.log(
  baseline ? '  ok: restored the original humanizer row' : '  ok: no stored row before this run',
);

// ============================================================================
// 4. Pure engine sanity (no DB, no clock, no Math.random)
// ============================================================================
console.log('4. humanize() — protected spans, known steps, the 280 cap');
{
  // Local copy: the repo's other mulberry32s live in a test file and in the
  // extension build, neither of which `scripts/` may import.
  function mulberry32(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const KNOWN = new Set([
    'prefix',
    'suffix',
    'lowercase',
    'drop_period',
    'typo:drop',
    'typo:swap',
    'typo:neighbor',
    'typo:double_space',
  ]);
  const TEXT = 'Great breakdown of the tradeoffs by @somebody.';
  // The shipped pools, every chance turned all the way up — a sweep at the
  // default chances would spend most of its seeds proving nothing fired.
  const ALL_ON: HumanizerConfig = {
    ...DEFAULT_HUMANIZER,
    prefixChance: 1,
    suffixChance: 1,
    lowercaseChance: 1,
    dropPeriodChance: 1,
    typoChance: 1,
  };
  // Suffix and drop-period are mutually exclusive at chance 1: the suffix lands
  // AFTER the final period, so `drop_period` can only ever be observed on a
  // config where the suffix roll cannot fire. Two sweeps, one union of steps.
  const NO_SUFFIX: HumanizerConfig = { ...ALL_ON, suffixChance: 0 };
  const OFF = {
    prefixChance: 0,
    suffixChance: 0,
    lowercaseChance: 0,
    dropPeriodChance: 0,
    typoChance: 0,
  };

  let jittered = 0;
  let draws = 0;
  const kinds = new Set<string>();
  for (const cfg of [ALL_ON, NO_SUFFIX]) {
    for (let seed = 1; seed <= 500; seed++) {
      draws++;
      const out = humanize(TEXT, cfg, mulberry32(seed), ['somebody']);
      if (!out.text.includes('@somebody'))
        fail(`seed ${seed} mutated the protected handle: ${out.text}`);
      if (out.text.length > 280) fail(`seed ${seed} exceeded 280: ${out.text.length}`);
      for (const step of out.applied) {
        if (!KNOWN.has(step)) fail(`seed ${seed} reported an unknown step "${step}"`);
        kinds.add(step);
      }
      if (out.applied.length > 0) jittered++;
    }
  }
  if (jittered === 0)
    fail(`${draws} all-chances-1 draws produced no jitter at all — the loop is vacuous`);
  // Every non-typo step by name, and at least one typo kind: a sweep that only
  // ever fired `prefix` would pass the loop above while proving almost nothing.
  for (const step of ['prefix', 'suffix', 'lowercase', 'drop_period']) {
    if (!kinds.has(step))
      fail(`the seeded sweep never exercised ${step}: ${[...kinds].sort().join(', ')}`);
  }
  if (![...kinds].some((k) => k.startsWith('typo:')))
    fail(`the seeded sweep never exercised a typo: ${[...kinds].sort().join(', ')}`);
  ok(`${draws} draws: ${jittered} jittered, steps seen = ${[...kinds].sort().join(', ')}`);

  const silent = humanize(TEXT, { ...DEFAULT_HUMANIZER, ...OFF }, mulberry32(9));
  if (silent.text !== TEXT || silent.applied.length > 0)
    fail(`an all-zero config changed the text: ${JSON.stringify(silent)}`);
  ok('an all-zero config is byte-identical to its input (the checkbox-off contract)');
}

restore();
console.log('SMOKE OK');
process.exit(0);
