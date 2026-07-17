// Platform-agnostic settings store (UI.1). Sync read-through over `app_settings`
// (bun:sqlite is synchronous — §7.13). Only overridden keys are stored; a missing
// row resolves to the registry default. An in-process Map caches the (tiny) set
// of override rows and is invalidated on every write.
//
// This module is deliberately platform-agnostic — it never imports src/x/*. The
// typed catalog (defaults, scopes, validation) is passed in as a `SettingsRegistry`
// (the X registry implements it in src/x/settings/registry.ts), the same layering
// as makeOnCost taking a `platform` instead of importing X pricing. A future
// src/linkedin/ can reuse this store with its own registry.

import { inArray } from 'drizzle-orm';
import { db } from '../db/client.ts';
import { appSettings } from '../db/shared-schema.ts';

export type SettingScope = 'server' | 'mirrored';

/** The minimal view of a registry the store needs — defaults, scope/group for
 *  listing, and per-key validation. Rich metadata (label/description/type/UI
 *  hints) lives in the platform registry and never reaches this layer. */
export interface SettingsRegistry {
  /** Minimal def for a key, or undefined if the key is not in the catalog. */
  get(key: string): { default: unknown; scope: SettingScope; group: string } | undefined;
  /** Every def, for listing/reset-by-group. */
  list(): Array<{ key: string; default: unknown; scope: SettingScope; group: string }>;
  /** null = valid; a short reason code otherwise. Assumes `key` is known. */
  validate(key: string, value: unknown): string | null;
}

/** Thrown by setSettings; the route maps `code` to a 400 body. */
export class SettingsError extends Error {
  constructor(
    public readonly code: 'unknown_setting' | 'invalid_setting_value',
    public readonly key: string,
    public readonly reason?: string,
  ) {
    super(reason ? `${code}: ${key} (${reason})` : `${code}: ${key}`);
    this.name = 'SettingsError';
  }
}

// Override rows only (key → parsed JSON value). null = not loaded yet.
let cache: Map<string, unknown> | null = null;

function loadCache(): Map<string, unknown> {
  if (cache) return cache;
  const rows = db.select().from(appSettings).all();
  cache = new Map(rows.map((r) => [r.key, r.value as unknown]));
  return cache;
}

/** Exported for tests and for callers that mutate the table out of band. */
export function invalidateSettingsCache(): void {
  cache = null;
}

export interface ResolvedSetting {
  value: unknown;
  isDefault: boolean;
}

/** Resolve a single key: override row if present, else the registry default.
 *  Throws SettingsError('unknown_setting') for a key not in the catalog. */
export function resolveSetting(registry: SettingsRegistry, key: string): ResolvedSetting {
  const def = registry.get(key);
  if (!def) throw new SettingsError('unknown_setting', key);
  const c = loadCache();
  if (c.has(key)) return { value: c.get(key), isDefault: false };
  return { value: def.default, isDefault: true };
}

/** Typed convenience over resolveSetting — the shape every consumer uses. */
export function getSetting<T>(registry: SettingsRegistry, key: string): T {
  return resolveSetting(registry, key).value as T;
}

/** Flat {key: value} for every def (optionally only `scope` ones) — the GET
 *  values payload and the extension mirror blob. */
export function getAllValues(
  registry: SettingsRegistry,
  scope?: SettingScope,
): Record<string, unknown> {
  const c = loadCache();
  const out: Record<string, unknown> = {};
  for (const d of registry.list()) {
    if (scope && d.scope !== scope) continue;
    out[d.key] = c.has(d.key) ? c.get(d.key) : d.default;
  }
  return out;
}

/** Validate every key in the patch BEFORE writing (all-or-nothing), then upsert
 *  in one sync txn. A single bad key throws and writes nothing. */
export function setSettings(
  registry: SettingsRegistry,
  patch: Record<string, unknown>,
): Array<{ key: string; value: unknown }> {
  const entries = Object.entries(patch);
  for (const [key, value] of entries) {
    const def = registry.get(key);
    if (!def) throw new SettingsError('unknown_setting', key);
    const reason = registry.validate(key, value);
    if (reason) throw new SettingsError('invalid_setting_value', key, reason);
  }

  const now = new Date();
  db.transaction((tx) => {
    for (const [key, value] of entries) {
      tx.insert(appSettings)
        .values({ key, value, updatedAt: now })
        .onConflictDoUpdate({ target: appSettings.key, set: { value, updatedAt: now } })
        .run();
    }
  });
  invalidateSettingsCache();
  return entries.map(([key, value]) => ({ key, value }));
}

/** Delete override rows for the given keys and/or every key in a group; the next
 *  resolve falls back to the registry default. Unknown keys are a harmless no-op. */
export function resetSettings(
  registry: SettingsRegistry,
  opts: { keys?: string[]; group?: string },
): { reset: string[] } {
  const target = new Set<string>();
  if (opts.keys) for (const k of opts.keys) target.add(k);
  if (opts.group) for (const d of registry.list()) if (d.group === opts.group) target.add(d.key);

  const keys = [...target];
  if (keys.length === 0) return { reset: [] };

  db.transaction((tx) => {
    tx.delete(appSettings).where(inArray(appSettings.key, keys)).run();
  });
  invalidateSettingsCache();
  return { reset: keys };
}
