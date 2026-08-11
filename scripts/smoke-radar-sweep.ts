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
  sweepNeedsVerified,
} from '../src/shared/radarSweep.ts';
import { radarDrafts, replyDrafts } from '../src/x/db/schema.ts';
import { persistRadarDrafts, radar } from '../src/x/routes/radar.ts';
import { settingsRouter } from '../src/x/routes/settings.ts';
import {
  resetSettings,
  resolveSetting,
  setSettings,
  settingsByGroup,
} from '../src/x/settings/registry.ts';

const app = new Hono();
app.route('/x', settingsRouter);
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
  ok('every default IS the SWEEP constant, and all eleven are mirrored');

  // The three booleans — a knob typed `number` would render a slider over a
  // switch and validate the wrong way.
  const bools = group.defs.filter((d) => d.type === 'boolean').map((d) => d.key);
  if (bools.sort().join(',') !== 'x.sweep.campedBypass,x.sweep.circleBypass,x.sweep.verifiedOnly')
    fail(`the boolean knobs are ${bools.join(', ')}`);
  ok('the three switches are typed boolean; the other eight are numbers');

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
  if (!resolveSetting('x.sweep.maxAgeMin').isDefault)
    fail('a refused PATCH wrote an override row anyway');
  ok('maxAgeMin:0 / autoStopMin:241 / verifiedOnly:"yes" refused by code, nothing written');
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
  ok(`an edited ${SENTINEL_KEY} rides out on the same blob; the other ten are untouched`);
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
    verifiedOnly: false,
    campedBypass: true,
    circleBypass: false,
    autoStopMin: 30,
  };
  const BASE: SweepCandidate = { views: 1_000, likes: 10, replies: 5, ageMin: 20, verified: null };

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
  ];

  for (const [label, cand, cfg, expected] of cases) {
    const got = passesSweep({ ...BASE, ...cand }, { ...CFG, ...cfg });
    if (got !== expected) fail(`${label}: expected ${expected}, got ${got}`);
  }
  ok(`${cases.length} boundary cases, both sides of all six numeric gates`);

  // The shipped defaults, sanity-checked as a set rather than key by key: a
  // 400-view, 12-minute-old post from a verified author with no likes is exactly
  // what the sweep exists to admit; a two-hour-old one is not, and neither is a
  // 5,000-view one now that maxViews ships as a real ceiling.
  if (!passesSweep({ views: 400, likes: 0, replies: 3, ageMin: 12, verified: true }))
    fail('the shipped SWEEP defaults refuse a 400-view 12-minute-old verified post');
  if (passesSweep({ views: 400, likes: 0, replies: 3, ageMin: 120, verified: true }))
    fail('the shipped SWEEP defaults admit a two-hour-old post');
  if (passesSweep({ views: 5000, likes: 0, replies: 3, ageMin: 12, verified: true }))
    fail('the shipped SWEEP defaults admit a post past the shipped view ceiling');
  ok('the shipped SWEEP defaults admit a fresh mid-size post, refuse a stale or crowded one');

  // verifiedOnly ships ON, so the shipped set refuses an author the page could
  // not read a badge for. That is the gate working; it is also the reason an
  // empty queue and a drifted selector look alike.
  if (passesSweep({ views: 400, likes: 0, replies: 3, ageMin: 12, verified: null }))
    fail('the shipped SWEEP defaults admit an unreadable author');
  ok('the shipped SWEEP defaults refuse an unreadable author (verifiedOnly ships ON)');

  // The perf contract has a name so it stays reviewable: the caller pays for the
  // DOM badge read only when the answer can still matter — which, at the shipped
  // defaults, is now every candidate that clears the numbers.
  if (!sweepNeedsVerified(SWEEP) || sweepNeedsVerified({ ...SWEEP, verifiedOnly: false }))
    fail('sweepNeedsVerified does not track verifiedOnly');
  ok('sweepNeedsVerified tracks verifiedOnly both ways (the skipped DOM read)');
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
