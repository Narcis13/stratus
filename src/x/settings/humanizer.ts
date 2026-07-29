// Project-level humanizer settings (HM.2) — the one `app_settings` row, key
// 'humanizer', that holds the jitter config any surface can pick up (the Radar
// pick path is HM.3's consumer; per-list humanizers on `reply_lists.humanizer`
// stay a sibling override and are untouched).
//
// It REUSES UI.1's `app_settings` table the way `src/llm/settings.ts` does (D1):
// key 'humanizer' is NOT a registry key, so the platform-agnostic settings store
// (src/settings/store.ts) never sees it — the registry has no string-array type
// and that store only touches keys present in its SettingsRegistry.
//
// Read-through, NO cache (the loadDoctrine discipline): a PATCH shows on the very
// next getHumanizerSettings, and there is nothing to invalidate. Nothing here can
// reach xFetch or askLLM — every route on top of it is $0.
//
// Nothing secret lives here: `app_settings` is explorer/MCP-visible by
// construction (§7.16), and a humanizer config is prefixes, suffixes and five
// probabilities.

import { eq } from 'drizzle-orm';
import { db } from '../../db/client.ts';
import { appSettings } from '../../db/shared-schema.ts';
import {
  DEFAULT_HUMANIZER,
  type HumanizerConfig,
  parseHumanizerConfig,
} from '../../shared/humanize.ts';

export const HUMANIZER_SETTINGS_KEY = 'humanizer';

export interface HumanizerSettings extends HumanizerConfig {
  /** Opt-in: the Radar checkbox defaults OFF (decision 5). */
  enabled: boolean;
}

export const DEFAULT_HUMANIZER_SETTINGS: HumanizerSettings = {
  ...DEFAULT_HUMANIZER,
  enabled: false,
};

/** Pools are refused, not clamped (the RL.4 `invalid_count` reasoning): a
 *  silently truncated pool is a config the user can't see they didn't get. */
const MAX_POOL_ENTRIES = 25;
const MAX_POOL_ENTRY_CHARS = 60;

// The defaults carry two ARRAYS, so a shallow `{...DEFAULT_HUMANIZER_SETTINGS}`
// would hand every caller the same `prefixes`/`suffixes` instances — one caller
// pushing an entry would edit the module default for the whole process. Every
// return path below goes through this instead.
function cloneDefaults(): HumanizerSettings {
  return {
    ...DEFAULT_HUMANIZER_SETTINGS,
    prefixes: [...DEFAULT_HUMANIZER_SETTINGS.prefixes],
    suffixes: [...DEFAULT_HUMANIZER_SETTINGS.suffixes],
  };
}

// Field-by-field sanitize (the getAiSettings shape): a hand-edited or
// schema-drifted row degrades to defaults rather than throwing on a live pick.
// `parseHumanizerConfig` is already lenient per field; only `enabled` is ours.
function sanitize(value: unknown): HumanizerSettings {
  const cfg = parseHumanizerConfig(value);
  if (!cfg) return cloneDefaults();
  const v = value as Record<string, unknown>;
  return { ...cfg, enabled: v.enabled === true };
}

export function getHumanizerSettings(): HumanizerSettings {
  try {
    const row = db
      .select({ value: appSettings.value })
      .from(appSettings)
      .where(eq(appSettings.key, HUMANIZER_SETTINGS_KEY))
      .get();
    if (!row) return cloneDefaults();
    return sanitize(row.value);
  } catch (err) {
    console.error(
      `humanizer settings: failed to read the 'humanizer' row, using defaults — ${err instanceof Error ? err.message : String(err)}`,
    );
    return cloneDefaults();
  }
}

/** Persist a FULL settings object — one sync upsert (§7.13, no await inside).
 *  Callers merge over `getHumanizerSettings()` first, so a partial patch can
 *  never land a partial row. */
export function saveHumanizerSettings(next: HumanizerSettings): HumanizerSettings {
  const now = new Date();
  db.insert(appSettings)
    .values({ key: HUMANIZER_SETTINGS_KEY, value: next, updatedAt: now })
    .onConflictDoUpdate({ target: appSettings.key, set: { value: next, updatedAt: now } })
    .run();
  return next;
}

/** Reset = delete the row. Missing row IS the defaults, so there is no second
 *  representation of "untouched" to keep in sync. */
export function resetHumanizerSettings(): HumanizerSettings {
  db.delete(appSettings).where(eq(appSettings.key, HUMANIZER_SETTINGS_KEY)).run();
  return cloneDefaults();
}

// Strict where the core is lenient, on purpose: `parseHumanizerConfig` reads
// STORED rows and falls back per field, while a PATCH is a human typing — a
// typo'd chance must 400, never silently keep the old value (parseAiPatch).
function validChance(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1;
}

function parsePoolPatch(v: unknown): string[] | null {
  if (!Array.isArray(v) || v.length > MAX_POOL_ENTRIES) return null;
  const pool: string[] = [];
  for (const entry of v) {
    if (typeof entry !== 'string') return null;
    const trimmed = entry.trim();
    if (trimmed.length > MAX_POOL_ENTRY_CHARS) return null;
    // An explicitly empty pool is a valid choice ("no prefixes"), and a blank
    // line in the editor's textarea is not an error — it's just not an entry.
    if (trimmed !== '') pool.push(trimmed);
  }
  return pool;
}

const CHANCE_FIELDS = [
  ['prefixChance', 'invalid_prefix_chance'],
  ['suffixChance', 'invalid_suffix_chance'],
  ['lowercaseChance', 'invalid_lowercase_chance'],
  ['dropPeriodChance', 'invalid_drop_period_chance'],
  ['typoChance', 'invalid_typo_chance'],
] as const;

/** Validate a raw PATCH body into a typed partial, or return an error CODE the
 *  route maps to a 400. Only keys PRESENT in the body are validated/applied;
 *  a body with no recognized key is `empty_patch` rather than a no-op write.
 *  Pure — no DB, so it is unit-testable without a row. */
export function parseHumanizerPatch(
  raw: Record<string, unknown>,
): { ok: true; patch: Partial<HumanizerSettings> } | { ok: false; error: string } {
  const patch: Partial<HumanizerSettings> = {};
  if ('enabled' in raw) {
    if (typeof raw.enabled !== 'boolean') return { ok: false, error: 'invalid_enabled' };
    patch.enabled = raw.enabled;
  }
  if ('prefixes' in raw) {
    const pool = parsePoolPatch(raw.prefixes);
    if (!pool) return { ok: false, error: 'invalid_prefixes' };
    patch.prefixes = pool;
  }
  if ('suffixes' in raw) {
    const pool = parsePoolPatch(raw.suffixes);
    if (!pool) return { ok: false, error: 'invalid_suffixes' };
    patch.suffixes = pool;
  }
  for (const [field, error] of CHANCE_FIELDS) {
    if (!(field in raw)) continue;
    const value = raw[field];
    if (!validChance(value)) return { ok: false, error };
    patch[field] = value;
  }
  if (Object.keys(patch).length === 0) return { ok: false, error: 'empty_patch' };
  return { ok: true, patch };
}
