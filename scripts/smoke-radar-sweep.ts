// One-shot smoke for the manual-first Radar and its armed sweep (plan
// `plans/2026-08-10-radar-manual-first.md`, RS.1–RS.6). Mounts the settings and
// radar routers in-process (no port, no workers) against the REAL DB and drives
// the whole server-visible half of the feature:
//
//   (a) the registry — the `sweep` group is EXACTLY `keyof SweepConfig`, every
//       default is the `SWEEP` constant itself, all eleven are `mirrored`, and an
//       out-of-range PATCH is refused by code with nothing written. The group
//       shape is the load-bearing assertion: a knob the predicate reads but the
//       catalog never exposes is a filter the user cannot see or turn off.
//   (b) `GET /x/settings/values?scope=mirrored` carries all eleven keys, and an
//       edited one rides out on the same blob — the only end-to-end proof that
//       what the page's `readSweep` will actually receive is what was stored.
//   (c) `passesSweep` over a boundary matrix: both sides of every gate, `0` on a
//       `max*` meaning "no ceiling", `maxAgeMin: 0` meaning the opposite (always
//       enforced, no sentinel), and `verified: null` refused under `verifiedOnly`.
//   (d) a `radar_drafts` row with `band: 'sweep'` confirmed into `reply_drafts`,
//       then READ BACK FROM THE DB to prove `contextSnapshot.signals` carries no
//       band at all. `persistRadarDrafts`-class writes are best-effort, so a green
//       call proves nothing (RC.5) — and a rule that only held in the response
//       body would still persist a capture reason as a fact about the tweet.
//
// **$0, and there is NO `--live` flag — the absence is the finding** (D171c, a
// fifth time). Nothing on any path this feature touches can reach `xFetch` or
// `askLLM`: the sweep is a page/panel session, its filters are settings rows, and
// the confirm endpoint is pure DB. A flag here would advertise a paid claim that
// does not exist. `smoke-own-harvest.ts` is the precedent; `smoke-cannon.ts`,
// which does buy one tweet read, is the counter-example.
//
// Real-DB safety, both halves:
//   - the eleven `x.sweep.*` override rows are snapshotted and restored (including
//     from `fail()`, which exits and would skip a finally). Snapshot/restore over
//     rows that cannot be namespaced has the `smoke-humanizer.ts` failure mode: a
//     run killed mid-way leaves OUR values in the table and the next run would
//     adopt them as "the original". So the one value this script writes is a
//     SENTINEL no operator would ever type; finding it at entry means the rows
//     belong to a crashed run, and the honest recovery is to treat the baseline as
//     ABSENT (restore = reset to defaults) rather than to make it permanent.
//   - every tweet id is 986-prefixed (18 digits — no real snowflake starts there),
//     and the rows this script creates are deleted by id, on both paths.
//
// Run: bun run scripts/smoke-radar-sweep.ts

import { eq, inArray } from 'drizzle-orm';
import { Hono } from 'hono';
import { db } from '../src/db/client.ts';
import {
  SWEEP,
  type SweepCandidate,
  type SweepConfig,
  passesSweep,
  sweepNeedsMedia,
  sweepNeedsPromoted,
  sweepNeedsVerified,
} from '../src/shared/radarSweep.ts';
import { radarDrafts, replyDrafts } from '../src/x/db/schema.ts';
import { persistRadarDrafts, radar } from '../src/x/routes/radar.ts';
import { settingsRouter } from '../src/x/routes/settings.ts';
import { sweepPresetsRouter } from '../src/x/routes/sweepPresets.ts';
import {
  resetSettings,
  resolveSetting,
  setSettings,
  settingsByGroup,
} from '../src/x/settings/registry.ts';
import { deleteSweepPreset, listSweepPresets } from '../src/x/settings/sweepPresets.ts';

const app = new Hono();
app.route('/x', settingsRouter);
app.route('/x', sweepPresetsRouter);
app.route('/x', radar);

// The eleven keys, derived from the predicate's own shape rather than typed out:
// a field added to SweepConfig without a knob must fail step (a), not slip past a
// hand-maintained list here.
const SWEEP_FIELDS = Object.keys(SWEEP) as Array<keyof SweepConfig>;
const SWEEP_KEYS = SWEEP_FIELDS.map((f) => `x.sweep.${f}`);

// In range (0..1_000_000) so the PATCH is accepted, and a number no human tuning
// an impression ceiling would ever land on. See the header on why it exists.
const SENTINEL_KEY = 'x.sweep.maxViews';
const SENTINEL_VALUE = 987_654;

// SP.1 — the preset this run creates and deletes. Bracketed so it sorts and reads
// as machine-made: the presets row is a LIST, so unlike the settings rows it can
// hold ours alongside the operator's, and cleanup only has to remove this name.
const SMOKE_PRESET = '__smoke-sweep-preset__';
// The value the preset carries. Distinct from SENTINEL_VALUE so step (b2) proves
// the LOAD moved the number, not the PATCH that preceded it.
const PRESET_VALUE = 876_543;

// 18 digits: real tweet ids are 19-digit snowflakes, so these can never collide.
const T_SWEEP = '986000000000000001';
const T_IDS = [T_SWEEP];

function fail(msg: string): never {
  console.error(`FAIL: ${msg}`);
  cleanup();
  process.exit(1);
}

function ok(msg: string): void {
  console.log(`  ok: ${msg}`);
}

// ------------------------------------------------------- snapshot / restore

const stored = new Map<string, unknown>();
for (const key of SWEEP_KEYS) {
  const { value, isDefault } = resolveSetting(key);
  if (!isDefault) stored.set(key, value);
}
const leaked = stored.get(SENTINEL_KEY) === SENTINEL_VALUE;
const baseline = leaked ? new Map<string, unknown>() : stored;
if (leaked)
  console.log(
    `  note: ${SENTINEL_KEY} holds ${SENTINEL_VALUE} — a prior run died mid-way, so the sweep group is being reset to defaults rather than preserved.`,
  );

let restored = false;
let cleanedRows = false;

function restore(): void {
  if (restored) return;
  restored = true;
  resetSettings({ group: 'sweep' });
  if (baseline.size > 0) setSettings(Object.fromEntries(baseline));
  dropSmokePreset();
}

// The presets row needs no snapshot/restore dance: it is a LIST keyed by name, so
// this run adds exactly one entry and removes exactly that entry. An operator's
// own presets are never read, rewritten or reordered by this script — which is
// why the sentinel discipline the x.sweep.* rows need does not apply here.
function dropSmokePreset(): void {
  try {
    deleteSweepPreset(SMOKE_PRESET);
  } catch {
    // Best-effort, like every other cleanup arm: a failure here must not mask
    // the assertion that sent us into cleanup.
  }
}

function deleteOwnRows(): void {
  if (cleanedRows) return;
  cleanedRows = true;
  const rows = db.select().from(radarDrafts).where(inArray(radarDrafts.tweetId, T_IDS)).all();
  const replyIds = rows.map((r) => r.replyDraftId).filter((id): id is string => id !== null);
  db.delete(radarDrafts).where(inArray(radarDrafts.tweetId, T_IDS)).run();
  if (replyIds.length > 0) db.delete(replyDrafts).where(inArray(replyDrafts.id, replyIds)).run();
}

function cleanup(): void {
  try {
    restore();
    deleteOwnRows();
  } catch (err) {
    console.error('cleanup failed:', err instanceof Error ? err.message : err);
  }
}

interface Reply {
  status: number;
  body: Record<string, unknown>;
}

async function req(path: string, method = 'GET', body?: unknown): Promise<Reply> {
  const res = await app.request(path, {
    method,
    ...(body === undefined
      ? {}
      : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
  });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

// A leftover row from a crashed run would make step (d)'s confirm idempotent
// (it returns the linked reply instead of rebuilding one), so start clean.
deleteOwnRows();
cleanedRows = false;

// ============================================================================
// (a) The registry — the group IS the predicate's shape
// ============================================================================
console.log('(a) the sweep group: shape, defaults, scope, refusals');
{
  // Deterministic baseline: whatever the operator has tuned is already
  // snapshotted, and restore() puts it back.
  resetSettings({ group: 'sweep' });

  const group = settingsByGroup().find((g) => g.id === 'sweep');
  if (!group) fail('no `sweep` group in the registry');
  const suffixes = group.defs.map((d) => d.key.replace('x.sweep.', ''));
  if (suffixes.slice().sort().join(',') !== SWEEP_FIELDS.slice().sort().join(','))
    fail(`the group is not keyof SweepConfig: ${suffixes.join(', ')}`);
  ok(`the group is exactly keyof SweepConfig (${suffixes.length} knobs, "${group.label}")`);

  for (const def of group.defs) {
    const field = def.key.replace('x.sweep.', '') as keyof SweepConfig;
    if (def.default !== SWEEP[field])
      fail(`${def.key} defaults to ${String(def.default)}, SWEEP says ${String(SWEEP[field])}`);
    if (def.scope !== 'mirrored') fail(`${def.key} is scope=${def.scope}, not mirrored`);
  }
  ok('every default IS the SWEEP constant, and all thirteen are mirrored');

  // The four booleans — a knob typed `number` would render a slider over a
  // switch and validate the wrong way — and the one enum, whose options ARE the
  // predicate's three branches: an option the rule has no branch for would be a
  // setting the user can pick and the page silently ignores.
  const bools = group.defs.filter((d) => d.type === 'boolean').map((d) => d.key);
  if (
    bools.sort().join(',') !==
    'x.sweep.campedBypass,x.sweep.circleBypass,x.sweep.excludeAds,x.sweep.verifiedOnly'
  )
    fail(`the boolean knobs are ${bools.join(', ')}`);
  const enums = group.defs.filter((d) => d.type === 'enum');
  if (enums.length !== 1 || enums[0]?.key !== 'x.sweep.media')
    fail(`the enum knobs are ${enums.map((d) => d.key).join(', ')}`);
  if ((enums[0]?.options ?? []).join(',') !== 'any,with,without')
    fail(`x.sweep.media options are ${(enums[0]?.options ?? []).join(', ')}`);
  ok("four switches typed boolean, one enum over the rule's own three branches, eight numbers");

  // Refused by CODE, through the same route MCP and the panel gear use. 0 is the
  // one interesting refusal in this group: it is a valid "no ceiling" on every
  // other maximum and an out-of-range value on this one, because maxAgeMin is
  // always enforced and its floor is 1.
  const refused = await req('/x/settings', 'PATCH', { 'x.sweep.maxAgeMin': 0 });
  if (refused.status !== 400 || refused.body.error !== 'invalid_setting_value')
    fail(`maxAgeMin: 0 expected 400 invalid_setting_value, got ${refused.status}`);
  if (refused.body.key !== 'x.sweep.maxAgeMin') fail(`refusal named ${String(refused.body.key)}`);
  const overMax = await req('/x/settings', 'PATCH', { 'x.sweep.autoStopMin': 241 });
  if (overMax.status !== 400) fail(`autoStopMin: 241 expected 400, got ${overMax.status}`);
  const notABool = await req('/x/settings', 'PATCH', { 'x.sweep.verifiedOnly': 'yes' });
  if (notABool.status !== 400) fail(`verifiedOnly: 'yes' expected 400, got ${notABool.status}`);
  // An enum's whole guard is its option list: 'photos' is the shape a caller
  // guesses, and it must not become a stored value that matches no branch.
  const badEnum = await req('/x/settings', 'PATCH', { 'x.sweep.media': 'photos' });
  if (badEnum.status !== 400) fail(`media: 'photos' expected 400, got ${badEnum.status}`);
  if (!resolveSetting('x.sweep.maxAgeMin').isDefault || !resolveSetting('x.sweep.media').isDefault)
    fail('a refused PATCH wrote an override row anyway');
  ok(
    'maxAgeMin:0 / autoStopMin:241 / verifiedOnly:"yes" / media:"photos" refused, nothing written',
  );
}

// ============================================================================
// (b) The mirror — what the content script will actually receive
// ============================================================================
console.log('(b) GET /x/settings/values?scope=mirrored');
{
  const mirrored = await req('/x/settings/values?scope=mirrored');
  if (mirrored.status !== 200) fail(`values?scope=mirrored → ${mirrored.status}`);
  for (const field of SWEEP_FIELDS) {
    const key = `x.sweep.${field}`;
    if (!(key in mirrored.body)) fail(`${key} is missing from the mirrored blob`);
    if (mirrored.body[key] !== SWEEP[field])
      fail(`${key} mirrors ${String(mirrored.body[key])}, SWEEP says ${String(SWEEP[field])}`);
  }
  ok(`all ${SWEEP_KEYS.length} x.sweep.* keys ride the mirrored blob at their SWEEP defaults`);

  // The half a defaults check cannot make: an EDIT has to reach the page too, or
  // the gear would appear to work while the sweep kept admitting on the defaults.
  const patched = await req('/x/settings', 'PATCH', { [SENTINEL_KEY]: SENTINEL_VALUE });
  if (patched.status !== 200) fail(`PATCH ${SENTINEL_KEY} → ${patched.status}`);
  const after = await req('/x/settings/values?scope=mirrored');
  if (after.body[SENTINEL_KEY] !== SENTINEL_VALUE)
    fail(`the mirror still reads ${String(after.body[SENTINEL_KEY])} after the PATCH`);
  const stillEleven = SWEEP_KEYS.every((k) => k in after.body);
  if (!stillEleven) fail('an edit dropped a sibling key from the mirrored blob');
  ok(
    `an edited ${SENTINEL_KEY} rides out on the same blob; the other ${SWEEP_FIELDS.length - 1} are untouched`,
  );
}

// ============================================================================
// (b2) SP.1 — a named preset is a round trip through the MIRRORED blob
// ============================================================================
// The claim worth a smoke: loading a preset moves what the PAGE will sweep on,
// not just what the panel renders. Everything below is asserted through
// `?scope=mirrored` for that reason — a preset that only moved the override rows
// would pass a settings-tab check while the content script kept admitting on the
// old filters until its next TTL.
console.log('(b2) sweep presets');
{
  const before = listSweepPresets().length;

  // Save from a KNOWN live config, so what lands in the preset is checkable.
  const set = await req('/x/settings', 'PATCH', { [SENTINEL_KEY]: PRESET_VALUE });
  if (set.status !== 200) fail(`PATCH before save → ${set.status}`);
  const saved = await req('/x/sweep/presets', 'POST', { name: SMOKE_PRESET });
  if (saved.status !== 200) fail(`save preset → ${saved.status} ${JSON.stringify(saved.body)}`);

  const presets = saved.body.presets as Array<{ name: string; values: Record<string, unknown> }>;
  const mine = presets.find((p) => p.name === SMOKE_PRESET);
  if (!mine) fail('the saved preset is not in the returned list');
  if (mine.values.maxViews !== PRESET_VALUE)
    fail(`the preset snapshotted maxViews=${String(mine.values.maxViews)}, not ${PRESET_VALUE}`);
  for (const field of SWEEP_FIELDS) {
    if (!(field in mine.values)) fail(`the preset is missing ${field} — a preset owns all eleven`);
  }
  if (presets.length !== before + 1)
    fail(`saving one preset moved the count from ${before} to ${presets.length}`);
  ok(`a preset snapshots all ${SWEEP_FIELDS.length} live values and leaves the others alone`);

  // Move the live config elsewhere, then load the preset back and check the PAGE's
  // view of it.
  const moved = await req('/x/settings', 'PATCH', { [SENTINEL_KEY]: SENTINEL_VALUE });
  if (moved.status !== 200) fail(`PATCH between save and load → ${moved.status}`);
  const drifted = await req('/x/settings/values?scope=mirrored');
  if (drifted.body[SENTINEL_KEY] !== SENTINEL_VALUE)
    fail('the mirror did not follow the PATCH between save and load');

  const loaded = await req('/x/sweep/presets/load', 'POST', { name: SMOKE_PRESET.toUpperCase() });
  if (loaded.status !== 200) fail(`load preset → ${loaded.status} ${JSON.stringify(loaded.body)}`);
  const mirrored = await req('/x/settings/values?scope=mirrored');
  if (mirrored.body[SENTINEL_KEY] !== PRESET_VALUE)
    fail(
      `after the load the mirror reads ${String(mirrored.body[SENTINEL_KEY])}, not the preset's ${PRESET_VALUE}`,
    );
  if (!SWEEP_KEYS.every((k) => k in mirrored.body))
    fail('a preset load dropped a sibling key from the mirrored blob');
  ok('a load (matched case-insensitively) reaches the mirrored blob the page sweeps on');

  // The refusals. Both are the point of the feature having a server side at all:
  // a name that is gone must not silently no-op, and the registry bounds are
  // still the guard even for a value that once passed them.
  const ghost = await req('/x/sweep/presets/load', 'POST', { name: 'no-such-preset-here' });
  if (ghost.status !== 404) fail(`loading an unknown preset → ${ghost.status}, expected 404`);
  const unnamed = await req('/x/sweep/presets', 'POST', { name: '   ' });
  if (unnamed.status !== 400) fail(`saving a blank name → ${unnamed.status}, expected 400`);
  ok('an unknown name 404s and a blank name 400s — neither is a silent no-op');

  const removed = await req('/x/sweep/presets', 'DELETE', { name: SMOKE_PRESET });
  if (removed.status !== 200) fail(`delete preset → ${removed.status}`);
  if ((removed.body.presets as unknown[]).length !== before)
    fail('delete did not put the list back to its pre-run length');
  const again = await req('/x/sweep/presets', 'DELETE', { name: SMOKE_PRESET });
  if (again.status !== 404) fail(`deleting it twice → ${again.status}, expected 404`);
  // The filters themselves survive the delete — a preset is a bookmark, not the
  // config, and deleting one must never re-aim a live sweep.
  const afterDelete = await req('/x/settings/values?scope=mirrored');
  if (afterDelete.body[SENTINEL_KEY] !== PRESET_VALUE)
    fail('deleting a preset moved the live filters');
  ok('delete is idempotent-by-404 and leaves the live filters exactly where they were');
}

// Every settings write is done — restore now rather than at exit, so the window
// in which a crash could strand the sentinel is microseconds wide.
restore();
console.log(
  baseline.size > 0
    ? `  ok: restored ${baseline.size} pre-existing x.sweep.* override row(s)`
    : '  ok: no x.sweep.* overrides existed before this run; the group is back on defaults',
);

// ============================================================================
// (c) The admission rule — both sides of every gate
// ============================================================================
console.log('(c) passesSweep boundaries');
{
  // Deliberately tighter than SWEEP on all six numeric gates, so every boundary
  // below is a real edge rather than a vacuous one.
  const CFG: SweepConfig = {
    minViews: 300,
    maxViews: 5_000,
    minLikes: 2,
    maxLikes: 100,
    minReplies: 1,
    maxReplies: 40,
    maxAgeMin: 60,
    media: 'any',
    excludeAds: false,
    verifiedOnly: false,
    campedBypass: true,
    circleBypass: false,
    autoStopMin: 30,
  };
  const BASE: SweepCandidate = {
    views: 1_000,
    likes: 10,
    replies: 5,
    ageMin: 20,
    verified: null,
    hasMedia: null,
    promoted: false,
  };

  const cases: Array<[string, Partial<SweepCandidate>, Partial<SweepConfig>, boolean]> = [
    ['a mid-range tweet', {}, {}, true],
    ['views exactly minViews', { views: 300 }, {}, true],
    ['views one under minViews', { views: 299 }, {}, false],
    ['views exactly maxViews', { views: 5_000 }, {}, true],
    ['views one over maxViews', { views: 5_001 }, {}, false],
    ['maxViews: 0 = no ceiling', { views: 9_000_000 }, { maxViews: 0 }, true],
    ['likes exactly minLikes', { likes: 2 }, {}, true],
    ['likes one under minLikes', { likes: 1 }, {}, false],
    ['likes exactly maxLikes', { likes: 100 }, {}, true],
    ['likes one over maxLikes', { likes: 101 }, {}, false],
    ['maxLikes: 0 = no ceiling', { likes: 9_000_000 }, { maxLikes: 0 }, true],
    ['replies exactly minReplies', { replies: 1 }, {}, true],
    ['replies one under minReplies', { replies: 0 }, {}, false],
    ['replies exactly maxReplies', { replies: 40 }, {}, true],
    ['replies one over maxReplies', { replies: 41 }, {}, false],
    ['maxReplies: 0 = no ceiling', { replies: 9_000_000 }, { maxReplies: 0 }, true],
    ['age exactly maxAgeMin', { ageMin: 60 }, {}, true],
    ['age one minute over', { ageMin: 61 }, {}, false],
    // The one maximum with no sentinel: 0 here refuses everything older than
    // instantaneous rather than admitting everything. The registry floor is 1 so
    // the state is unreachable through the UI — this pins the predicate anyway,
    // because the page takes its config off a wire.
    ['maxAgeMin: 0 is a ceiling, not a sentinel', { ageMin: 1 }, { maxAgeMin: 0 }, false],
    ['verified: null passes when the gate is off', { verified: null }, {}, true],
    ['verified: false passes when the gate is off', { verified: false }, {}, true],
    [
      'verified: true admitted under verifiedOnly',
      { verified: true },
      { verifiedOnly: true },
      true,
    ],
    [
      'verified: false refused under verifiedOnly',
      { verified: false },
      { verifiedOnly: true },
      false,
    ],
    // §7.11 deliberately inverted: this is a gate, not a bucket. An unreadable
    // badge under verifiedOnly is a REFUSAL, so a drifted selector shows up as a
    // visibly empty queue instead of a silently unfiltered one.
    [
      'verified: null refused under verifiedOnly',
      { verified: null },
      { verifiedOnly: true },
      false,
    ],
    // The two content gates. They are NOT metric gates — the bypass arms in
    // content.ts call `passesContentGates` on their own — so the cases here pin
    // the same predicate the arms share.
    ['media either way when the gate is off', { hasMedia: true }, {}, true],
    ["media 'with' admits a tweet carrying media", { hasMedia: true }, { media: 'with' }, true],
    ["media 'with' refuses a plain-text tweet", { hasMedia: false }, { media: 'with' }, false],
    ["media 'without' admits a plain-text tweet", { hasMedia: false }, { media: 'without' }, true],
    ["media 'without' refuses one carrying media", { hasMedia: true }, { media: 'without' }, false],
    // Unknown refuses in BOTH directions — the verified rule again: a gate that
    // admits on unknown has stopped being a gate.
    ["unknown media refused under 'with'", { hasMedia: null }, { media: 'with' }, false],
    ["unknown media refused under 'without'", { hasMedia: null }, { media: 'without' }, false],
    ['a promoted post refused under excludeAds', { promoted: true }, { excludeAds: true }, false],
    ['a promoted post admitted with the switch off', { promoted: true }, {}, true],
  ];

  for (const [label, cand, cfg, expected] of cases) {
    const got = passesSweep({ ...BASE, ...cand }, { ...CFG, ...cfg });
    if (got !== expected) fail(`${label}: expected ${expected}, got ${got}`);
  }
  ok(`${cases.length} boundary cases, both sides of all six numeric gates and both content ones`);

  // The shipped defaults, sanity-checked as a set rather than key by key: a
  // 400-view, 12-minute-old post from a verified author with no likes is exactly
  // what the sweep exists to admit; a two-hour-old one is not, and neither is a
  // 5,000-view one now that maxViews ships as a real ceiling.
  const shipped = (over: Partial<SweepCandidate>): SweepCandidate => ({
    views: 400,
    likes: 0,
    replies: 3,
    ageMin: 12,
    verified: true,
    hasMedia: null,
    promoted: false,
    ...over,
  });
  if (!passesSweep(shipped({})))
    fail('the shipped SWEEP defaults refuse a 400-view 12-minute-old verified post');
  if (passesSweep(shipped({ ageMin: 120 })))
    fail('the shipped SWEEP defaults admit a two-hour-old post');
  if (passesSweep(shipped({ views: 5000 })))
    fail('the shipped SWEEP defaults admit a post past the shipped view ceiling');
  // Ads ship excluded, media ships neutral: the one content refusal in the
  // shipped set is the promoted post.
  if (passesSweep(shipped({ promoted: true })))
    fail('the shipped SWEEP defaults admit a promoted post');
  if (!passesSweep(shipped({ hasMedia: true })) || !passesSweep(shipped({ hasMedia: false })))
    fail('the shipped SWEEP defaults filter on media — the gate ships neutral');
  ok('the shipped SWEEP defaults admit a fresh mid-size post, refuse a stale or crowded one');

  // verifiedOnly ships ON, so the shipped set refuses an author the page could
  // not read a badge for. That is the gate working; it is also the reason an
  // empty queue and a drifted selector look alike.
  if (passesSweep(shipped({ verified: null })))
    fail('the shipped SWEEP defaults admit an unreadable author');
  ok('the shipped SWEEP defaults refuse an unreadable author (verifiedOnly ships ON)');

  // The perf contract has a name so it stays reviewable: the caller pays for the
  // DOM badge read only when the answer can still matter — which, at the shipped
  // defaults, is now every candidate that clears the numbers.
  if (!sweepNeedsVerified(SWEEP) || sweepNeedsVerified({ ...SWEEP, verifiedOnly: false }))
    fail('sweepNeedsVerified does not track verifiedOnly');
  ok('sweepNeedsVerified tracks verifiedOnly both ways (the skipped DOM read)');

  // Same contract for the two content reads. The media one matters most: it is
  // the only DOM read here that walks the whole article, and it ships skipped.
  if (sweepNeedsMedia(SWEEP) || !sweepNeedsMedia({ ...SWEEP, media: 'with' }))
    fail('sweepNeedsMedia does not track the media gate');
  if (!sweepNeedsPromoted(SWEEP) || sweepNeedsPromoted({ ...SWEEP, excludeAds: false }))
    fail('sweepNeedsPromoted does not track excludeAds');
  ok('sweepNeedsMedia/sweepNeedsPromoted track their knobs (the media read ships skipped)');
}

// ============================================================================
// (d) A swept row confirms with NO band in the STORED snapshot
// ============================================================================
console.log("(d) radar_drafts band:'sweep' → confirm → reply_drafts");
{
  await persistRadarDrafts(
    [
      {
        tweetId: T_SWEEP,
        handle: 'sweep_smoke',
        author: 'Sweep Smoke',
        text: 'an ordinary post my sweep filters let through',
        url: `https://x.com/sweep_smoke/status/${T_SWEEP}`,
        band: 'sweep',
        signals: { views: 610, replies: 4, ageMin: 18, vpm: 34, bait: false },
      },
    ],
    [{ tweetId: T_SWEEP, text: 'smoke reply to a swept tweet', angle: 'extends' }],
    'grok-smoke',
  );
  const [inserted] = db.select().from(radarDrafts).where(eq(radarDrafts.tweetId, T_SWEEP)).all();
  if (!inserted) fail('the radar_drafts row never landed (persistRadarDrafts is best-effort)');
  if (inserted.band !== 'sweep') fail(`stored band is ${String(inserted.band)}, not 'sweep'`);
  ok("a radar_drafts row stored with band:'sweep' (the capture reason survives the column)");

  const confirmed = await req(`/x/radar/drafts/${T_SWEEP}/confirm`, 'POST');
  if (confirmed.status !== 201)
    fail(`confirm → ${confirmed.status} ${JSON.stringify(confirmed.body)}`);
  const replyId = confirmed.body.id;
  if (typeof replyId !== 'string') fail('confirm returned no reply_drafts id');

  // READ BACK FROM THE DB. What a later Playbook read sees is the persisted
  // snapshot, and a coercion that only held in the response body would pass a
  // body-only check while still writing a capture reason into the snapshot.
  const [reply] = db.select().from(replyDrafts).where(eq(replyDrafts.id, replyId)).all();
  if (!reply) fail('confirm returned 201 but no reply_drafts row is on disk');
  const snapshot = reply.contextSnapshot as {
    signals?: { views: number };
    metrics: { views: number };
  };
  if (!snapshot.signals) fail('the stored snapshot carries no signals at all');
  if ('band' in snapshot.signals)
    fail(
      `stored contextSnapshot.signals still carries a band: ${JSON.stringify(snapshot.signals)}`,
    );
  if (snapshot.metrics.views !== 610)
    fail(`the snapshot lost its metrics: ${snapshot.metrics.views}`);
  ok('the STORED contextSnapshot.signals carries no band — the reason stays in its column');

  // …and the coercion is snapshot-only: the queue must still be able to say WHY
  // it held this row, so radar_drafts.band is untouched.
  const [after] = db.select().from(radarDrafts).where(eq(radarDrafts.tweetId, T_SWEEP)).all();
  if (after?.band !== 'sweep') fail(`confirm rewrote radar_drafts.band to ${String(after?.band)}`);
  if (after?.status !== 'clicked') fail(`confirm left status at ${String(after?.status)}`);
  ok("radar_drafts.band is still 'sweep' and the row ratcheted to clicked");
}

cleanup();
console.log('SMOKE OK ($0 — no X call, no LLM call, nothing to flag)');
process.exit(0);
