// Side-panel settings live in chrome.storage.local — survive panel close, sync
// across all extension contexts. Two values: the API base URL and the bearer
// token, both shared with the background worker.

import { useEffect, useState } from 'react';

const KEY_API_URL = 'apiUrl';
const KEY_BEARER = 'bearer';

export interface Settings {
  apiUrl: string;
  bearer: string;
}

export const EMPTY_SETTINGS: Settings = { apiUrl: '', bearer: '' };

export async function getSettings(): Promise<Settings> {
  const out = await chrome.storage.local.get([KEY_API_URL, KEY_BEARER]);
  return {
    apiUrl: typeof out[KEY_API_URL] === 'string' ? out[KEY_API_URL] : '',
    bearer: typeof out[KEY_BEARER] === 'string' ? out[KEY_BEARER] : '',
  };
}

export async function saveSettings(s: Settings): Promise<void> {
  await chrome.storage.local.set({
    [KEY_API_URL]: s.apiUrl.trim().replace(/\/$/, ''),
    [KEY_BEARER]: s.bearer.trim(),
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
      if (!(KEY_API_URL in changes) && !(KEY_BEARER in changes)) return;
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
