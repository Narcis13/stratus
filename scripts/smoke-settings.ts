// One-shot smoke test for the settings platform (UI.1–UI.7, UI.11–UI.16 — the
// configurability moat). Mounts settings + brief + playbook + images in-process
// (no port, no workers, no LLM) against the REAL DB and drives the whole
// contract: catalog → mirror payload → the validation ladder → three consumers
// that visibly move → the money ceiling → reset.
//
//   bun run scripts/smoke-settings.ts
//
// $0. Nothing here spends: every route is DB-only, and the one paid surface it
// touches (`POST /x/images/generate`) is asserted on its REFUSAL side, where the
// budget gate fires before any network call.
//
// It also writes NO ROWS — the only state it mutates is `app_settings`, and it
// snapshot-restores every key it touches by `isDefault` from BOTH the success
// path and `fail()` (D113(d)/(e)): `resetSettings` would DELETE an override the
// operator set on purpose, so a reset is never assumed to be the right restore.
// One exception is not settings state: `GET /x/brief` is a read that WRITES (it
// settles goal statuses and stamps the C9 streak diary), so the script closes
// with one more brief read after restoring, leaving today's diary computed from
// the operator's real numbers rather than the doctored ones.

import { Hono } from 'hono';
import { brief } from '../src/x/routes/brief.ts';
import { images } from '../src/x/routes/images.ts';
import { playbook } from '../src/x/routes/playbook.ts';
import { settingsRouter } from '../src/x/routes/settings.ts';
import { resetSettings, resolveSetting, setSettings } from '../src/x/settings/registry.ts';

const app = new Hono();
app.route('/x', settingsRouter);
app.route('/x', brief);
app.route('/x', playbook);
app.route('/x', images);

// ------------------------------------------------------- snapshot / restore

interface Snapshot {
  value: unknown;
  isDefault: boolean;
}

const touched = new Map<string, Snapshot>();

/** Snapshot every key in the patch (once) before the route writes it. */
function remember(keys: string[]): void {
  for (const key of keys) {
    if (!touched.has(key)) touched.set(key, resolveSetting(key));
  }
}

/** Put the operator's own settings back. Sync (bun:sqlite) so it can run from
 *  `fail()`, which exits the process. */
function restore(): void {
  for (const [key, prev] of touched) {
    if (prev.isDefault) resetSettings({ keys: [key] });
    else setSettings({ [key]: prev.value });
  }
  touched.clear();
}

const prevXaiKey = process.env.XAI_API_KEY;
let xaiKeyFaked = false;

function unfakeKey(): void {
  if (!xaiKeyFaked) return;
  process.env.XAI_API_KEY = prevXaiKey ?? '';
  xaiKeyFaked = false;
}

function fail(msg: string): never {
  console.error(`FAIL: ${msg}`);
  unfakeKey();
  restore();
  process.exit(1);
}

function ok(msg: string): void {
  console.log(`  ok · ${msg}`);
}

// ------------------------------------------------------------------ helpers

interface SettingEntry {
  key: string;
  group: string;
  label: string;
  type: string;
  scope: string;
  unit?: string;
  value: unknown;
  isDefault: boolean;
}

interface SettingsResponse {
  groups: Array<{ id: string; label: string; settings: SettingEntry[] }>;
}

async function getJson<T>(path: string): Promise<T> {
  const res = await app.request(path);
  if (res.status !== 200) fail(`GET ${path} → ${res.status}: ${await res.text()}`);
  return (await res.json()) as T;
}

async function send(
  path: string,
  method: 'PATCH' | 'POST',
  body: unknown,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await app.request(path, {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const parsed = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: res.status, body: parsed };
}

/** PATCH through the route under test, snapshotting first. */
async function patch(body: Record<string, unknown>): Promise<void> {
  remember(Object.keys(body));
  const { status, body: out } = await send('/x/settings', 'PATCH', body);
  if (status !== 200) fail(`PATCH ${JSON.stringify(body)} → ${status}: ${JSON.stringify(out)}`);
}

/** The stored value, or a marker for a key the registry does not know. */
function peek(key: string): string {
  try {
    return JSON.stringify(resolveSetting(key).value);
  } catch {
    return '(unknown key)';
  }
}

/** Assert a PATCH is refused with a given code, and that nothing landed. */
async function refuses(body: Record<string, unknown>, code: string, what: string): Promise<void> {
  const before = Object.keys(body).map(peek);
  const { status, body: out } = await send('/x/settings', 'PATCH', body);
  if (status !== 400) fail(`${what}: expected 400, got ${status} ${JSON.stringify(out)}`);
  if (out.error !== code) fail(`${what}: expected error ${code}, got ${JSON.stringify(out.error)}`);
  const after = Object.keys(body).map(peek);
  if (after.join('|') !== before.join('|')) fail(`${what}: a refused PATCH still wrote a value`);
  ok(`${what} → 400 ${code}, nothing written`);
}

function eqArray(a: unknown, b: number[]): boolean {
  return Array.isArray(a) && a.length === b.length && a.every((v, i) => v === b[i]);
}

/** Walk the whole Playbook payload and count gated cells vs the ones that clear
 *  the gate. `sufficient` is computed server-side at `minN`, so the ratio is the
 *  second visible effect of the one number (D139(d)) — and printing the
 *  denominator keeps a zero honest (an empty DB vs a broken counter). */
function countCells(node: unknown): { gated: number; sufficient: number } {
  const acc = { gated: 0, sufficient: 0 };
  const walk = (n: unknown): void => {
    if (Array.isArray(n)) {
      for (const v of n) walk(v);
      return;
    }
    if (n === null || typeof n !== 'object') return;
    const rec = n as Record<string, unknown>;
    if (typeof rec.sufficient === 'boolean') {
      acc.gated += 1;
      if (rec.sufficient) acc.sufficient += 1;
    }
    for (const v of Object.values(rec)) walk(v);
  };
  walk(node);
  return acc;
}

// ------------------------------------------ 1. the catalog + mirror payload

console.log('1. catalog');
const catalog = await getJson<SettingsResponse>('/x/settings');
const knobs = catalog.groups.flatMap((g) => g.settings);
if (catalog.groups.length < 12) fail(`expected ≥12 groups, got ${catalog.groups.length}`);
if (knobs.length < 55) fail(`expected ≥55 knobs, got ${knobs.length}`);
for (const s of knobs) {
  if (typeof s.key !== 'string' || typeof s.type !== 'string' || typeof s.isDefault !== 'boolean')
    fail(`malformed entry ${JSON.stringify(s)}`);
  if (s.scope !== 'server' && s.scope !== 'mirrored') fail(`bad scope on ${s.key}: ${s.scope}`);
}
const overridden = knobs.filter((s) => !s.isDefault);
ok(
  `${catalog.groups.length} groups / ${knobs.length} knobs (${catalog.groups.map((g) => g.id).join(', ')})`,
);
ok(
  overridden.length === 0
    ? 'every knob is at its registry default'
    : `${overridden.length} operator override(s) live: ${overridden.map((s) => s.key).join(', ')}`,
);

const mirrored = await getJson<Record<string, unknown>>('/x/settings/values?scope=mirrored');
const mirroredKeys = Object.keys(mirrored);
const declaredMirrored = knobs.filter((s) => s.scope === 'mirrored').map((s) => s.key);
if (mirroredKeys.length !== declaredMirrored.length)
  fail(
    `mirror payload has ${mirroredKeys.length} keys, registry declares ${declaredMirrored.length}`,
  );
for (const k of declaredMirrored) {
  if (!(k in mirrored)) fail(`mirrored key ${k} missing from the extension payload`);
}
// UI.12 gotcha 6: the two brief-read display knobs stay `server` on purpose —
// the panel receives those numbers already applied, inside the brief payload.
if ('x.display.sparklineDays' in mirrored) fail('a server-scoped key leaked into the mirror');
ok(`mirror payload = ${mirroredKeys.length} keys, exactly the mirrored set; no server keys leak`);

const badScope = await app.request('/x/settings/values?scope=bogus');
if (badScope.status !== 400) fail(`?scope=bogus → ${badScope.status} (expected 400)`);
ok('?scope=bogus → 400 invalid_scope');

// ---------------------------------------------- 2. the validation ladder

console.log('2. validation (registry ceilings are the money guard — Decision 5)');
await refuses({ 'x.nope.notAKnob': 1 }, 'unknown_setting', 'unknown key');
await refuses({ 'x.gates.minCellN': 4 }, 'invalid_setting_value', 'below the floor (min 5)');
await refuses({ 'x.gates.minCellN': 101 }, 'invalid_setting_value', 'above the ceiling (max 100)');
await refuses({ 'x.gates.minCellN': 'twenty' }, 'invalid_setting_value', 'wrong type');
await refuses(
  { 'x.budgets.imageDailyUsd': 2.01 },
  'invalid_setting_value',
  'image budget past the $2.00 hard cap',
);
await refuses(
  { 'x.doctrine.anchors3': [9, 9] },
  'invalid_setting_value',
  'anchors not sorted-unique',
);
// All-or-nothing: one bad key in a multi-key patch writes neither.
await refuses(
  { 'x.gates.bestTimeMinN': 7, 'x.gates.minCellN': 0 },
  'invalid_setting_value',
  'mixed patch (one valid, one out of range)',
);
const emptyPatch = await send('/x/settings', 'PATCH', {});
if (emptyPatch.status !== 400 || emptyPatch.body.error !== 'empty_patch')
  fail(`empty patch → ${emptyPatch.status} ${JSON.stringify(emptyPatch.body)}`);
ok('empty patch → 400 empty_patch');

// ------------------------- 3. consumer A: a server knob reshapes the payload

console.log('3. consumer — x.gates.minCellN → GET /x/playbook (server-scoped)');
interface PlaybookResponse {
  minN: number;
}
// Baseline is whatever the operator's store resolves to, not the registry
// default — a live override must not fail the smoke before it writes anything.
const minCellBaseline = Number(resolveSetting('x.gates.minCellN').value);
const pbDefault = await getJson<PlaybookResponse & Record<string, unknown>>('/x/playbook');
if (pbDefault.minN !== minCellBaseline)
  fail(`baseline playbook gate expected ${minCellBaseline}, got ${pbDefault.minN}`);

await patch({ 'x.gates.minCellN': 5 });
const pbOpen = await getJson<PlaybookResponse & Record<string, unknown>>('/x/playbook');
if (pbOpen.minN !== 5) fail(`after PATCH the playbook gate should read 5, got ${pbOpen.minN}`);

await patch({ 'x.gates.minCellN': 100 });
const pbTight = await getJson<PlaybookResponse & Record<string, unknown>>('/x/playbook');
if (pbTight.minN !== 100)
  fail(`after PATCH the playbook gate should read 100, got ${pbTight.minN}`);

// The `?minN=` query param still overrides the configured baseline per read
// (the UI.4 contract) — and `?minN=1` doubles as the sanity check that the
// sufficient-cell count is not vacuously zero on this DB.
const pbParam = await getJson<PlaybookResponse & Record<string, unknown>>('/x/playbook?minN=1');
if (pbParam.minN !== 1) fail(`?minN=1 should win over the store, got ${pbParam.minN}`);
ok('?minN= still overrides the configured gate per read');

const all = countCells(pbParam);
const open = countCells(pbOpen);
const tight = countCells(pbTight);
if (all.gated === 0) fail('no gated cell in the Playbook payload — the sufficient flag is gone');
if (!(all.sufficient >= open.sufficient && open.sufficient >= tight.sufficient))
  fail(
    `gate is not monotone: n≥1 → ${all.sufficient}, n≥5 → ${open.sufficient}, n≥100 → ${tight.sufficient}`,
  );
ok(
  `one number, two effects: minN 20→5→100 answers ${all.sufficient} ≥ ${open.sufficient} ≥ ${tight.sufficient} of ${all.gated} gated cells`,
);
if (all.sufficient === 0)
  console.log('  note · no measured cell clears even n≥1 on this DB, so only `minN` moved visibly');

// ------------------------------- 4. consumer B: doctrine → the Today brief

console.log('4. consumer — x.doctrine.anchors3/4 → GET /x/brief');
interface BriefResponse {
  today: { anchors: number[] };
}
const SMOKE_ANCHORS = [2, 5, 8];
// Both rungs, so the assertion holds whichever the ladder picks for today's
// filled-slot count (`pickAnchors` switches at x.doctrine.ladderSwitchAt).
await patch({ 'x.doctrine.anchors3': SMOKE_ANCHORS, 'x.doctrine.anchors4': SMOKE_ANCHORS });
const briefed = await getJson<BriefResponse>('/x/brief');
if (!eqArray(briefed.today.anchors, SMOKE_ANCHORS))
  fail(
    `brief anchors expected ${JSON.stringify(SMOKE_ANCHORS)}, got ${JSON.stringify(briefed.today.anchors)}`,
  );
ok(`today's cadence anchors follow the setting: ${JSON.stringify(briefed.today.anchors)}`);

// ------------------------- 5. consumer C: the band blob the extension mirrors

console.log('5. consumer — x.band.* → the mirrored blob the badge reads');
const bandBefore = Number(mirrored['x.band.bigViews']);
const bandNext = bandBefore === 500 ? 400 : 500;
await patch({ 'x.band.bigViews': bandNext });
const mirrorAfter = await getJson<Record<string, unknown>>('/x/settings/values?scope=mirrored');
if (mirrorAfter['x.band.bigViews'] !== bandNext)
  fail(`mirror still reports bigViews ${JSON.stringify(mirrorAfter['x.band.bigViews'])}`);
ok(
  `bigViews ${bandBefore} → ${bandNext} in the same payload the badge and the server gate both read`,
);

// ------------------------------------------ 6. the money ceiling actually bites

console.log('6. money — x.budgets.imageDailyUsd: 0 → POST /x/images/generate refuses');
if (!prevXaiKey) {
  // The 503 key gate sits ahead of the budget gate; fake a key so the budget
  // check is what answers. Nothing is sent — the refusal happens before the call.
  process.env.XAI_API_KEY = 'smoke-settings-no-network';
  xaiKeyFaked = true;
}
await patch({ 'x.budgets.imageDailyUsd': 0 });
const refused = await send('/x/images/generate', 'POST', {
  prompt: 'a muted flat-vector backdrop',
});
if (refused.status !== 429 || refused.body.error !== 'image_budget_exceeded')
  fail(`over-budget generate → ${refused.status} ${JSON.stringify(refused.body)} (expected 429)`);
ok(`429 image_budget_exceeded at $${refused.body.spentUsd} ≥ $${refused.body.budgetUsd}`);
unfakeKey();

// --------------------------------------------------------------- 7. reset

console.log('7. reset');
const wrote = [...touched.keys()];
const resetRes = await send('/x/settings/reset', 'POST', { keys: wrote });
if (resetRes.status !== 200) fail(`reset → ${resetRes.status} ${JSON.stringify(resetRes.body)}`);
const cleared = Array.isArray(resetRes.body.reset) ? resetRes.body.reset : [];
const afterReset = await getJson<SettingsResponse>('/x/settings');
const stillOverridden = afterReset.groups
  .flatMap((g) => g.settings)
  .filter((s) => wrote.includes(s.key) && !s.isDefault);
if (stillOverridden.length > 0)
  fail(`reset left overrides on ${stillOverridden.map((s) => s.key).join(', ')}`);
ok(
  `POST /settings/reset dropped ${cleared.length} override(s); all ${wrote.length} keys read default`,
);

// A group reset deletes EVERY override in the group, including ones this
// script never wrote — snapshot the whole group first so restore() can put
// an operator's untouched override (e.g. x.gates.bestTimeMinN) back.
const gatesGroup = catalog.groups.find((g) => g.id === 'gates');
if (!gatesGroup) fail('gates group missing from the catalog');
remember(gatesGroup.settings.map((s) => s.key));
const resetGroup = await send('/x/settings/reset', 'POST', { group: 'gates' });
if (resetGroup.status !== 200) fail(`group reset → ${resetGroup.status}`);
ok('group reset accepted');

const nothing = await send('/x/settings/reset', 'POST', {});
if (nothing.status !== 400 || nothing.body.error !== 'nothing_to_reset')
  fail(`empty reset → ${nothing.status} ${JSON.stringify(nothing.body)}`);
const badKeys = await send('/x/settings/reset', 'POST', { keys: [7] });
if (badKeys.status !== 400 || badKeys.body.error !== 'invalid_keys')
  fail(`reset with non-string keys → ${badKeys.status} ${JSON.stringify(badKeys.body)}`);
ok('reset validation: nothing_to_reset + invalid_keys');

// -------------------------------------------------- 8. restore + clean diary

console.log('8. restore');
restore();
const restored = await getJson<SettingsResponse>('/x/settings');
const leftovers = restored.groups
  .flatMap((g) => g.settings)
  .filter((s) => !s.isDefault)
  .map((s) => s.key);
const expected = overridden.map((s) => s.key);
if (leftovers.join('|') !== expected.join('|'))
  fail(`override set changed: was [${expected.join(', ')}], now [${leftovers.join(', ')}]`);
ok(
  expected.length === 0
    ? 'no overrides added or removed — the store is exactly as found'
    : `the operator's ${expected.length} override(s) are back, byte for byte`,
);

// GR.10/D113(d): /x/brief is a read that writes. Re-read it under the restored
// settings so today's C9 streak row describes the operator's real numbers.
await getJson<BriefResponse>('/x/brief');
ok('brief re-read under restored settings — the C9 diary is clean');

console.log('SMOKE PASS');
process.exit(0);
