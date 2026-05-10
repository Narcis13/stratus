// Side-panel settings live in chrome.storage.local — survive panel close, sync
// across all extension contexts. Shared with the background worker and the
// x.com content script (which reads `replyHarvestLimit` directly).

import { useEffect, useState } from 'react';

const KEY_API_URL = 'apiUrl';
const KEY_BEARER = 'bearer';
export const KEY_REPLY_HARVEST_LIMIT = 'replyHarvestLimit';

export const REPLY_HARVEST_MIN = 0;
export const REPLY_HARVEST_MAX = 10;
export const REPLY_HARVEST_DEFAULT = 0;

export interface Settings {
  apiUrl: string;
  bearer: string;
  replyHarvestLimit: number;
}

export const EMPTY_SETTINGS: Settings = {
  apiUrl: '',
  bearer: '',
  replyHarvestLimit: REPLY_HARVEST_DEFAULT,
};

export function clampReplyHarvestLimit(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return REPLY_HARVEST_DEFAULT;
  const n = Math.floor(value);
  if (n < REPLY_HARVEST_MIN) return REPLY_HARVEST_MIN;
  if (n > REPLY_HARVEST_MAX) return REPLY_HARVEST_MAX;
  return n;
}

export async function getSettings(): Promise<Settings> {
  const out = await chrome.storage.local.get([KEY_API_URL, KEY_BEARER, KEY_REPLY_HARVEST_LIMIT]);
  return {
    apiUrl: typeof out[KEY_API_URL] === 'string' ? out[KEY_API_URL] : '',
    bearer: typeof out[KEY_BEARER] === 'string' ? out[KEY_BEARER] : '',
    replyHarvestLimit: clampReplyHarvestLimit(out[KEY_REPLY_HARVEST_LIMIT]),
  };
}

export async function saveSettings(s: Settings): Promise<void> {
  await chrome.storage.local.set({
    [KEY_API_URL]: s.apiUrl.trim().replace(/\/$/, ''),
    [KEY_BEARER]: s.bearer.trim(),
    [KEY_REPLY_HARVEST_LIMIT]: clampReplyHarvestLimit(s.replyHarvestLimit),
  });
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
        !(KEY_REPLY_HARVEST_LIMIT in changes)
      ) {
        return;
      }
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
