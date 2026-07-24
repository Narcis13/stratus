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
