// Panel-side reader for the mirrored settings blob (UI.6). The background is
// the single fetcher/writer (§7.25); a component only ever reads, so this hook
// is a storage read plus an onChanged subscription — a save in Settings lands
// in every mounted consumer without a reload.
//
// It starts on the baked defaults and swaps in the blob when it arrives, so
// nothing renders against a half-loaded config.

import { useEffect, useState } from 'react';
import {
  SERVER_DEFAULTS,
  SERVER_SETTINGS_KEY,
  type ServerConfig,
  readServerConfig,
} from '../shared/serverSettings.ts';

export function useServerSettings(): ServerConfig {
  const [config, setConfig] = useState<ServerConfig>(SERVER_DEFAULTS);

  useEffect(() => {
    let alive = true;
    void chrome.storage.local
      .get(SERVER_SETTINGS_KEY)
      .then((out) => {
        if (alive) setConfig(readServerConfig(out[SERVER_SETTINGS_KEY]));
      })
      .catch(() => {
        // No blob yet (or storage unavailable) — the defaults already loaded.
      });

    const onChanged = (
      changes: { [k: string]: chrome.storage.StorageChange },
      area: string,
    ): void => {
      const change = changes[SERVER_SETTINGS_KEY];
      if (area === 'local' && change) setConfig(readServerConfig(change.newValue));
    };
    chrome.storage.onChanged.addListener(onChanged);
    return () => {
      alive = false;
      chrome.storage.onChanged.removeListener(onChanged);
    };
  }, []);

  return config;
}
