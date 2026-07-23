// Side-panel settings live in chrome.storage.local — survive panel close, sync
// across all extension contexts. Shared with the background worker.

import { useEffect, useState } from 'react';

const KEY_API_URL = 'apiUrl';
const KEY_BEARER = 'bearer';
// §8.6 opt-in: when on, reply drafting steers toward the active content pillars.
const KEY_APPLY_PILLARS_REPLIES = 'applyPillarsToReplies';
// When on, a Reply Master draft is "typed" char-by-char into the focused reply
// box (content script reads this key directly). Default off → copy-to-clipboard.
const KEY_AUTOTYPE_REPLY = 'autoTypeReplyDraft';
// C6 passive hover capture — default ON (opt-out): absent key means enabled,
// only an explicit `false` disables. The content script reads this key directly.
const KEY_PASSIVE_CAPTURE = 'passiveCapture';
// HV.2 passive home-timeline harvest — also default ON (opt-out), also read
// directly by the content script. Separate key: one is people, one is corpus.
const KEY_PASSIVE_HARVEST = 'passiveHarvest';
// UI.9 Appearance — panel-local look, stamped on <html> by main.tsx. `system`
// resolves via matchMedia; density/scale drive [data-density]/[data-scale].
const KEY_THEME = 'theme';
const KEY_DENSITY = 'density';
const KEY_UI_SCALE = 'uiScale';

export type ThemePref = 'system' | 'dark' | 'light';
export type Density = 'cozy' | 'compact';
export type UiScale = 12 | 13 | 14;

export const DEFAULT_THEME: ThemePref = 'system';
export const DEFAULT_DENSITY: Density = 'cozy';
export const DEFAULT_UI_SCALE: UiScale = 13;

export function normalizeTheme(v: unknown): ThemePref {
  return v === 'dark' || v === 'light' || v === 'system' ? v : DEFAULT_THEME;
}
export function normalizeDensity(v: unknown): Density {
  return v === 'compact' ? 'compact' : DEFAULT_DENSITY;
}
export function normalizeScale(v: unknown): UiScale {
  return v === 12 || v === 14 ? v : DEFAULT_UI_SCALE;
}

// Resolve a theme preference to the concrete theme stamped on <html>. `system`
// follows the OS: prefers-light → light, otherwise dark (the plan's default).
export function resolveTheme(pref: ThemePref, prefersLight: boolean): 'dark' | 'light' {
  if (pref === 'system') return prefersLight ? 'light' : 'dark';
  return pref;
}

export interface Settings {
  apiUrl: string;
  bearer: string;
  applyPillarsToReplies: boolean;
  autoTypeReplyDraft: boolean;
  passiveCapture: boolean;
  passiveHarvest: boolean;
  theme: ThemePref;
  density: Density;
  uiScale: UiScale;
}

export const EMPTY_SETTINGS: Settings = {
  apiUrl: '',
  bearer: '',
  applyPillarsToReplies: false,
  autoTypeReplyDraft: false,
  passiveCapture: true,
  passiveHarvest: true,
  theme: DEFAULT_THEME,
  density: DEFAULT_DENSITY,
  uiScale: DEFAULT_UI_SCALE,
};

export async function getSettings(): Promise<Settings> {
  const out = await chrome.storage.local.get([
    KEY_API_URL,
    KEY_BEARER,
    KEY_APPLY_PILLARS_REPLIES,
    KEY_AUTOTYPE_REPLY,
    KEY_PASSIVE_CAPTURE,
    KEY_PASSIVE_HARVEST,
    KEY_THEME,
    KEY_DENSITY,
    KEY_UI_SCALE,
  ]);
  return {
    apiUrl: typeof out[KEY_API_URL] === 'string' ? out[KEY_API_URL] : '',
    bearer: typeof out[KEY_BEARER] === 'string' ? out[KEY_BEARER] : '',
    applyPillarsToReplies: out[KEY_APPLY_PILLARS_REPLIES] === true,
    autoTypeReplyDraft: out[KEY_AUTOTYPE_REPLY] === true,
    passiveCapture: out[KEY_PASSIVE_CAPTURE] !== false,
    passiveHarvest: out[KEY_PASSIVE_HARVEST] !== false,
    theme: normalizeTheme(out[KEY_THEME]),
    density: normalizeDensity(out[KEY_DENSITY]),
    uiScale: normalizeScale(out[KEY_UI_SCALE]),
  };
}

export async function saveSettings(s: Settings): Promise<void> {
  await chrome.storage.local.set({
    [KEY_API_URL]: s.apiUrl.trim().replace(/\/$/, ''),
    [KEY_BEARER]: s.bearer.trim(),
    [KEY_APPLY_PILLARS_REPLIES]: s.applyPillarsToReplies === true,
    [KEY_AUTOTYPE_REPLY]: s.autoTypeReplyDraft === true,
    [KEY_PASSIVE_CAPTURE]: s.passiveCapture !== false,
    [KEY_PASSIVE_HARVEST]: s.passiveHarvest !== false,
    [KEY_THEME]: normalizeTheme(s.theme),
    [KEY_DENSITY]: normalizeDensity(s.density),
    [KEY_UI_SCALE]: normalizeScale(s.uiScale),
  });
}

// Persist a single setting immediately. The boolean toggles use this so they
// stick the moment they're clicked — the Save button only exists to commit the
// API URL / bearer together, and gating a toggle behind it lost the change.
export async function patchSettings(partial: Partial<Settings>): Promise<void> {
  const out: Record<string, unknown> = {};
  if (partial.apiUrl !== undefined) out[KEY_API_URL] = partial.apiUrl.trim().replace(/\/$/, '');
  if (partial.bearer !== undefined) out[KEY_BEARER] = partial.bearer.trim();
  if (partial.applyPillarsToReplies !== undefined)
    out[KEY_APPLY_PILLARS_REPLIES] = partial.applyPillarsToReplies === true;
  if (partial.autoTypeReplyDraft !== undefined)
    out[KEY_AUTOTYPE_REPLY] = partial.autoTypeReplyDraft === true;
  if (partial.passiveCapture !== undefined)
    out[KEY_PASSIVE_CAPTURE] = partial.passiveCapture !== false;
  if (partial.passiveHarvest !== undefined)
    out[KEY_PASSIVE_HARVEST] = partial.passiveHarvest !== false;
  if (partial.theme !== undefined) out[KEY_THEME] = normalizeTheme(partial.theme);
  if (partial.density !== undefined) out[KEY_DENSITY] = normalizeDensity(partial.density);
  if (partial.uiScale !== undefined) out[KEY_UI_SCALE] = normalizeScale(partial.uiScale);
  await chrome.storage.local.set(out);
}

export function isConfigured(s: Settings): boolean {
  return s.apiUrl.length > 0 && s.bearer.length > 0;
}

export function useSettings(): { settings: Settings; loading: boolean } {
  const [settings, setSettings] = useState<Settings>(EMPTY_SETTINGS);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    getSettings().then((s) => {
      if (!alive) return;
      setSettings(s);
      setLoading(false);
    });

    const onChanged = (
      changes: Record<string, chrome.storage.StorageChange>,
      area: chrome.storage.AreaName,
    ) => {
      if (area !== 'local') return;
      if (
        !(KEY_API_URL in changes) &&
        !(KEY_BEARER in changes) &&
        !(KEY_APPLY_PILLARS_REPLIES in changes) &&
        !(KEY_AUTOTYPE_REPLY in changes) &&
        !(KEY_PASSIVE_CAPTURE in changes) &&
        !(KEY_THEME in changes) &&
        !(KEY_DENSITY in changes) &&
        !(KEY_UI_SCALE in changes)
      )
        return;
      getSettings().then((s) => alive && setSettings(s));
    };
    chrome.storage.onChanged.addListener(onChanged);
    return () => {
      alive = false;
      chrome.storage.onChanged.removeListener(onChanged);
    };
  }, []);

  return { settings, loading };
}
