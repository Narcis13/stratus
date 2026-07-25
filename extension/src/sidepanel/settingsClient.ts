// Thin wrapper over `api.settings` for the settings-editing UI (UI.10). The
// primitives (GearPopover, SettingRow) stay presentational — they take a
// `onPatch(key, value)` callback; this module is where that callback's real
// PATCH lands. Later tasks (UI.11 Settings rebuild, the Wave-5 inline gears)
// import these instead of touching `api.ts` directly.

import type { SettingsSync } from '../shared/messages.ts';
import { type SettingEntry, type SettingsGroup, api } from './api.ts';
import type { Settings } from './storage.ts';

// Every write here changes numbers the panel and the content script read from
// the mirrored blob, so each one asks the background (the single fetcher) to
// re-pull immediately instead of waiting out its TTL. Best-effort: a failed
// message just means the knob lands on the next sync, never a failed save.
function requestSettingsSync(): void {
  const msg: SettingsSync = { type: 'stratus/settings-sync' };
  void chrome.runtime.sendMessage(msg).catch(() => {});
}

/** Fetch the full grouped registry (the panel renders from this, never the
 *  server registry module). */
export async function loadSettingGroups(s: Settings): Promise<SettingsGroup[]> {
  const res = await api.settings.get(s);
  return res.groups;
}

/** Flatten the grouped response into a single list — handy for a searchable
 *  Settings tab or for handing a subset to a GearPopover. */
export function flattenSettings(groups: SettingsGroup[]): SettingEntry[] {
  return groups.flatMap((g) => g.settings);
}

/** Search filter for the Settings tab (UI.11). Matches a knob on its key, label
 *  or description; a query matching the GROUP's label or id keeps the whole
 *  group, so "budget" finds every budget knob rather than only the ones whose
 *  own text repeats the word. Groups left with no matching rows drop out.
 *  Pure — the component owns the query state. */
export function filterSettingGroups(groups: SettingsGroup[], query: string): SettingsGroup[] {
  const q = query.trim().toLowerCase();
  if (q === '') return groups;

  const out: SettingsGroup[] = [];
  for (const g of groups) {
    if (g.label.toLowerCase().includes(q) || g.id.toLowerCase().includes(q)) {
      out.push(g);
      continue;
    }
    const settings = g.settings.filter(
      (s) =>
        s.key.toLowerCase().includes(q) ||
        s.label.toLowerCase().includes(q) ||
        s.description.toLowerCase().includes(q),
    );
    if (settings.length > 0) out.push({ ...g, settings });
  }
  return out;
}

/** The knobs an inline gear tunes, in the order the caller asked for them (UI.12
 *  — a gear's rows are a curated sequence, not registry order). A key the server
 *  doesn't know is skipped rather than faked: gears name keys as string literals,
 *  so a renamed knob should go quiet, never render an empty control. Pure. */
export function entriesForKeys(groups: SettingsGroup[], keys: string[]): SettingEntry[] {
  const byKey = new Map(groups.flatMap((g) => g.settings).map((s) => [s.key, s]));
  const out: SettingEntry[] = [];
  for (const k of keys) {
    const entry = byKey.get(k);
    if (entry) out.push(entry);
  }
  return out;
}

function sameValue(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((v, i) => v === b[i]);
  }
  return a === b;
}

/** Apply an edit locally, ahead of its debounced PATCH. `isDefault` is
 *  recomputed here because it drives the reset dot, which has to track a slider
 *  drag — refetching per tick is not an option. Pure; the caller owns state. */
export function applyOptimisticValue(
  groups: SettingsGroup[],
  key: string,
  value: unknown,
): SettingsGroup[] {
  return groups.map((g) => ({
    ...g,
    settings: g.settings.map((s) =>
      s.key === key ? { ...s, value, isDefault: sameValue(value, s.default) } : s,
    ),
  }));
}

/** Patch one knob. Validation (range/type) happens server-side against the
 *  registry; a bad value rejects with an ApiError the caller surfaces. */
export async function patchSetting(s: Settings, key: string, value: unknown): Promise<void> {
  await api.settings.patch(s, { [key]: value });
  requestSettingsSync();
}

/** Reset every override in a group back to its registry default. */
export async function resetGroup(s: Settings, group: string): Promise<void> {
  await api.settings.reset(s, { group });
  requestSettingsSync();
}

/** Reset a specific set of keys back to their registry defaults. */
export async function resetKeys(s: Settings, keys: string[]): Promise<void> {
  await api.settings.reset(s, { keys });
  requestSettingsSync();
}
