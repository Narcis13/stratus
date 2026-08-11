// Named sweep presets (SP.1) — the one `app_settings` row, key 'sweep-presets',
// that holds saved combinations of the eleven `x.sweep.*` knobs so the Radar can
// be re-aimed in one click: a small-account hunt (a few hundred impressions, a
// handful of likes) and a big-account one are the same eleven numbers at
// different settings, and re-typing them per session is how a filter set drifts.
//
// It REUSES UI.1's `app_settings` table the way `humanizer.ts` and
// `src/llm/settings.ts` do (D1): 'sweep-presets' is NOT a registry key, so the
// platform-agnostic store (src/settings/store.ts) never sees it — that store only
// touches keys present in its SettingsRegistry, and the registry has no
// list-of-objects type. No schema, no migration.
//
// Two rules make this safe to load blind:
//
//   1. A preset is SNAPSHOTTED SERVER-SIDE from the live settings, never posted
//      as values by a client. There is no path by which a preset can hold a
//      number the registry would have refused when it was typed into the gear.
//   2. Loading one still goes through `setSettings` (the caller's job — see
//      routes/sweepPresets.ts), so even a hand-edited row or a preset saved
//      before a floor moved is re-validated, all-or-nothing, on the way in.
//
// Read-through, NO cache (the loadDoctrine/humanizer discipline): a save shows on
// the very next list, and there is nothing to invalidate. Nothing here can reach
// xFetch or askLLM — every route on top of it is $0.
//
// Nothing secret lives here: `app_settings` is explorer/MCP-visible by
// construction (§7.16), and a preset is eleven filter numbers and a name.

import { eq } from 'drizzle-orm';
import { db } from '../../db/client.ts';
import { appSettings } from '../../db/shared-schema.ts';
import { SWEEP, type SweepConfig } from '../../shared/radarSweep.ts';

export const SWEEP_PRESETS_KEY = 'sweep-presets';

/** Refused, not silently dropped (the RL.4 `invalid_count` reasoning): a save
 *  that quietly evicted the oldest preset is a config the user can't see they
 *  didn't get. Twenty is far past any real roster of hunting profiles. */
export const MAX_PRESETS = 20;
export const MAX_NAME_CHARS = 40;

/** One saved combination. `values` is a whole `SweepConfig` rather than a partial
 *  patch: loading a preset must leave every knob in the gear consistent with the
 *  name on it, so there is no such thing as a field a preset doesn't own. */
export interface SweepPreset {
  name: string;
  values: SweepConfig;
  /** ISO — when this name was last written (a re-save under an existing name
   *  overwrites in place and moves this). */
  updatedAt: string;
}

/** Names are matched case-insensitively so "Big accounts" and "big accounts" are
 *  one preset, but the DISPLAY case is whatever was typed last. */
function nameKey(name: string): string {
  return name.trim().toLowerCase();
}

/** Strict where `parseStored` is lenient, on purpose: this reads a human typing
 *  a name, so an empty or oversized one 400s rather than being trimmed into
 *  something they didn't ask for. Pure. */
export function parsePresetName(raw: unknown): { ok: true; name: string } | { ok: false } {
  if (typeof raw !== 'string') return { ok: false };
  const name = raw.trim();
  if (name === '' || name.length > MAX_NAME_CHARS) return { ok: false };
  return { ok: true, name };
}

function numberOr(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

/** Field-by-field sanitize against `SWEEP` (the getAiSettings/humanizer shape): a
 *  hand-edited or schema-drifted row degrades to the shipped default for that one
 *  field rather than throwing while the user is trying to list their presets. The
 *  values still face `setSettings` before they reach the store, so degrading here
 *  cannot smuggle an out-of-range number into the live config. */
function parseValues(raw: unknown): SweepConfig {
  const v = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  return {
    minViews: numberOr(v.minViews, SWEEP.minViews),
    maxViews: numberOr(v.maxViews, SWEEP.maxViews),
    minLikes: numberOr(v.minLikes, SWEEP.minLikes),
    maxLikes: numberOr(v.maxLikes, SWEEP.maxLikes),
    minReplies: numberOr(v.minReplies, SWEEP.minReplies),
    maxReplies: numberOr(v.maxReplies, SWEEP.maxReplies),
    maxAgeMin: numberOr(v.maxAgeMin, SWEEP.maxAgeMin),
    verifiedOnly: typeof v.verifiedOnly === 'boolean' ? v.verifiedOnly : SWEEP.verifiedOnly,
    campedBypass: typeof v.campedBypass === 'boolean' ? v.campedBypass : SWEEP.campedBypass,
    circleBypass: typeof v.circleBypass === 'boolean' ? v.circleBypass : SWEEP.circleBypass,
    autoStopMin: numberOr(v.autoStopMin, SWEEP.autoStopMin),
  };
}

/** Read the stored blob into a list. Lenient at every level — a non-array, a
 *  non-object entry, a nameless entry are skipped rather than fatal — and
 *  deduped by `nameKey` with the LAST occurrence winning, so a hand-edited row
 *  can never produce two entries the UI treats as one. Pure; exported for tests. */
export function parseStoredPresets(raw: unknown): SweepPreset[] {
  const list = Array.isArray(raw)
    ? raw
    : typeof raw === 'object' &&
        raw !== null &&
        Array.isArray((raw as { presets?: unknown }).presets)
      ? ((raw as { presets: unknown[] }).presets as unknown[])
      : [];

  const byKey = new Map<string, SweepPreset>();
  for (const entry of list) {
    if (typeof entry !== 'object' || entry === null) continue;
    const e = entry as Record<string, unknown>;
    const parsed = parsePresetName(e.name);
    if (!parsed.ok) continue;
    byKey.set(nameKey(parsed.name), {
      name: parsed.name,
      values: parseValues(e.values),
      updatedAt: typeof e.updatedAt === 'string' ? e.updatedAt : new Date(0).toISOString(),
    });
  }
  return sortPresets([...byKey.values()]);
}

/** Alphabetical, case-insensitive — the order a picker reads best. Deliberately
 *  NOT most-recently-used: a list whose order moves under the cursor is how you
 *  load the wrong preset. Pure. */
export function sortPresets(presets: SweepPreset[]): SweepPreset[] {
  return [...presets].sort((a, b) => nameKey(a.name).localeCompare(nameKey(b.name)));
}

export function listSweepPresets(): SweepPreset[] {
  try {
    const row = db
      .select({ value: appSettings.value })
      .from(appSettings)
      .where(eq(appSettings.key, SWEEP_PRESETS_KEY))
      .get();
    if (!row) return [];
    return parseStoredPresets(row.value);
  } catch (err) {
    console.error(
      `sweep presets: failed to read the '${SWEEP_PRESETS_KEY}' row, returning none — ${err instanceof Error ? err.message : String(err)}`,
    );
    return [];
  }
}

export function findSweepPreset(name: string): SweepPreset | null {
  const key = nameKey(name);
  return listSweepPresets().find((p) => nameKey(p.name) === key) ?? null;
}

/** Persist the whole list — one sync upsert (§7.13, no await inside).
 *
 *  Emptying the list DELETES the row rather than storing `[]`: a missing row IS
 *  "no presets" (`listSweepPresets` starts there on a fresh install), so keeping
 *  an empty array would be a second representation of the same state for every
 *  reader — the explorer, MCP, a future importer — to disagree about. Same rule
 *  as `resetHumanizerSettings`. */
function writePresets(presets: SweepPreset[]): SweepPreset[] {
  const sorted = sortPresets(presets);
  if (sorted.length === 0) {
    db.delete(appSettings).where(eq(appSettings.key, SWEEP_PRESETS_KEY)).run();
    return sorted;
  }
  const now = new Date();
  db.insert(appSettings)
    .values({ key: SWEEP_PRESETS_KEY, value: sorted, updatedAt: now })
    .onConflictDoUpdate({ target: appSettings.key, set: { value: sorted, updatedAt: now } })
    .run();
  return sorted;
}

/** Upsert by case-insensitive name. Re-saving an existing name OVERWRITES it (a
 *  preset is a bookmark for a config you are re-aiming, so "save as the name I
 *  already use" is the common act, not an error), and only a genuinely NEW name
 *  can hit the cap. */
export function saveSweepPreset(
  name: string,
  values: SweepConfig,
  now: Date = new Date(),
): { ok: true; presets: SweepPreset[] } | { ok: false; error: 'too_many_presets' } {
  const key = nameKey(name);
  const current = listSweepPresets();
  const existing = current.some((p) => nameKey(p.name) === key);
  if (!existing && current.length >= MAX_PRESETS) return { ok: false, error: 'too_many_presets' };

  const next = current.filter((p) => nameKey(p.name) !== key);
  next.push({ name, values, updatedAt: now.toISOString() });
  return { ok: true, presets: writePresets(next) };
}

/** Delete by name. Reports whether anything was actually removed — a DELETE for
 *  a name that isn't there is a 404, not a silent success, because the caller
 *  believed it existed. */
export function deleteSweepPreset(name: string): { deleted: boolean; presets: SweepPreset[] } {
  const key = nameKey(name);
  const current = listSweepPresets();
  const next = current.filter((p) => nameKey(p.name) !== key);
  if (next.length === current.length) return { deleted: false, presets: current };
  return { deleted: true, presets: writePresets(next) };
}
