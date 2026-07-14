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

export interface Settings {
  apiUrl: string;
  bearer: string;
  applyPillarsToReplies: boolean;
  autoTypeReplyDraft: boolean;
  passiveCapture: boolean;
}

export const EMPTY_SETTINGS: Settings = {
  apiUrl: '',
  bearer: '',
  applyPillarsToReplies: false,
  autoTypeReplyDraft: false,
  passiveCapture: true,
};

export async function getSettings(): Promise<Settings> {
  const out = await chrome.storage.local.get([
    KEY_API_URL,
    KEY_BEARER,
    KEY_APPLY_PILLARS_REPLIES,
    KEY_AUTOTYPE_REPLY,
    KEY_PASSIVE_CAPTURE,
  ]);
  return {
    apiUrl: typeof out[KEY_API_URL] === 'string' ? out[KEY_API_URL] : '',
    bearer: typeof out[KEY_BEARER] === 'string' ? out[KEY_BEARER] : '',
    applyPillarsToReplies: out[KEY_APPLY_PILLARS_REPLIES] === true,
    autoTypeReplyDraft: out[KEY_AUTOTYPE_REPLY] === true,
    passiveCapture: out[KEY_PASSIVE_CAPTURE] !== false,
  };
}

export async function saveSettings(s: Settings): Promise<void> {
  await chrome.storage.local.set({
    [KEY_API_URL]: s.apiUrl.trim().replace(/\/$/, ''),
    [KEY_BEARER]: s.bearer.trim(),
    [KEY_APPLY_PILLARS_REPLIES]: s.applyPillarsToReplies === true,
    [KEY_AUTOTYPE_REPLY]: s.autoTypeReplyDraft === true,
    [KEY_PASSIVE_CAPTURE]: s.passiveCapture !== false,
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
        !(KEY_PASSIVE_CAPTURE in changes)
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
