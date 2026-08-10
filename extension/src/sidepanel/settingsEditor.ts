// The one settings-editing discipline in the panel (UI.12, extracted from the
// UI.11 Tuning panel so the inline Today gears cannot invent a second one).
//
// Every editable knob in the extension goes through this hook, because getting
// any of these four rules subtly different is how the panel and the store start
// disagreeing about what is saved:
//
//   1. OPTIMISTIC — `SettingRow` renders a `Slider` for most bounded numbers and
//      a slider fires on every drag tick. The control must track the drag, and
//      the reset dot with it, so the local value moves first.
//   2. DEBOUNCED per key — one PATCH per knob per settle, not per tick.
//   3. FLUSHED on unmount — closing a gear or switching subtab must not silently
//      drop a number the user already moved.
//   4. RE-READ on refusal — the registry floors and ceilings are the money guard
//      (plan decision 5), so a value the server rejected must never sit on
//      screen looking saved. The row shows the 400 code and the truth comes back
//      from the server.
//
// Every consumer shares one `GET /x/settings` read and holds the whole registry,
// because a gear tuning three keys still needs their labels, bounds and units —
// the panel never imports the server registry (§5 build isolation).

import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, type SettingsGroup } from './api.ts';
import {
  applyOptimisticValue,
  loadSettingGroups,
  patchSetting,
  resetGroup,
  resetKeys,
} from './settingsClient.ts';
import type { Settings } from './storage.ts';

/** Long enough to coalesce a slider drag, short enough that a save feels
 *  immediate. */
export const PATCH_DEBOUNCE_MS = 400;

export interface SettingsEditor {
  /** The whole registry as the server rendered it, or null until it loads. */
  groups: SettingsGroup[] | null;
  /** Load/reset failure, as an API error code. */
  error: string | null;
  /** Per-key failure code from a refused PATCH — the row shows it. */
  rowErrors: Record<string, string>;
  /** The group id a reset is in flight for. */
  busyGroup: string | null;
  /** Edit a knob: optimistic locally, debounced to the server. */
  change: (key: string, value: unknown) => void;
  /** Drop one override back to its registry default. */
  resetKey: (key: string) => void;
  /** Drop a whole set of overrides — what a gear's "Reset to defaults" uses.
   *  Keys, not a group id: a gear tunes a curated subset that may not be a
   *  whole registry group, and resetting more than the card shows would move
   *  numbers the user cannot see. */
  resetKeyList: (keys: string[]) => void;
  /** Drop every override in a group. */
  resetGroupId: (id: string) => void;
  /** Re-read the server's truth (also runs after a refusal). */
  reload: () => Promise<void>;
}

export function useSettingsEditor(settings: Settings): SettingsEditor {
  const [groups, setGroups] = useState<SettingsGroup[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const [busyGroup, setBusyGroup] = useState<string | null>(null);

  // The pending write per key, and the timer that will send it.
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const pendingValues = useRef(new Map<string, unknown>());
  // The unmount flush needs today's connection without re-subscribing the effect.
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  const reload = useCallback(async (): Promise<void> => {
    try {
      setGroups(await loadSettingGroups(settingsRef.current));
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.code : 'load_failed');
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const gs = await loadSettingGroups(settings);
        if (!cancelled) setGroups(gs);
      } catch (e) {
        if (!cancelled) setError(e instanceof ApiError ? e.code : 'load_failed');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [settings]);

  useEffect(() => {
    const timerMap = timers.current;
    const valueMap = pendingValues.current;
    return () => {
      // Rule 3: flush, don't cancel. Losing an edit the user watched land is
      // worse than a write that arrives after the component is gone.
      for (const t of timerMap.values()) clearTimeout(t);
      timerMap.clear();
      for (const [key, value] of valueMap) {
        void patchSetting(settingsRef.current, key, value).catch(() => {});
      }
      valueMap.clear();
    };
  }, []);

  const commit = useCallback(
    async (key: string): Promise<void> => {
      const value = pendingValues.current.get(key);
      pendingValues.current.delete(key);
      timers.current.delete(key);
      try {
        await patchSetting(settingsRef.current, key, value);
      } catch (e) {
        setRowErrors((p) => ({ ...p, [key]: e instanceof ApiError ? e.code : 'save_failed' }));
        await reload();
      }
    },
    [reload],
  );

  const change = useCallback(
    (key: string, value: unknown): void => {
      setGroups((gs) => (gs === null ? gs : applyOptimisticValue(gs, key, value)));
      setRowErrors((prev) => {
        if (!(key in prev)) return prev;
        const next = { ...prev };
        delete next[key];
        return next;
      });

      pendingValues.current.set(key, value);
      const existing = timers.current.get(key);
      if (existing) clearTimeout(existing);
      timers.current.set(
        key,
        setTimeout(() => void commit(key), PATCH_DEBOUNCE_MS),
      );
    },
    [commit],
  );

  const resetKeyList = useCallback(
    (keys: string[]): void => {
      if (keys.length === 0) return;
      for (const key of keys) {
        // A pending edit for a key being reset is now meaningless — dropping the
        // override is the newer intent, so cancel rather than flush (rule 3's
        // one exception).
        const t = timers.current.get(key);
        if (t) clearTimeout(t);
        timers.current.delete(key);
        pendingValues.current.delete(key);
      }
      // One request for the whole set: a per-key fan-out would leave a partial
      // reset on the first failure, and the route already takes a key list.
      void (async () => {
        try {
          await resetKeys(settingsRef.current, keys);
          await reload();
        } catch (e) {
          const code = e instanceof ApiError ? e.code : 'reset_failed';
          setRowErrors((p) => {
            const next = { ...p };
            for (const key of keys) next[key] = code;
            return next;
          });
        }
      })();
    },
    [reload],
  );

  const resetKey = useCallback((key: string): void => resetKeyList([key]), [resetKeyList]);

  const resetGroupId = useCallback(
    (id: string): void => {
      setBusyGroup(id);
      void (async () => {
        try {
          await resetGroup(settingsRef.current, id);
          await reload();
        } catch (e) {
          setError(e instanceof ApiError ? e.code : 'reset_failed');
        } finally {
          setBusyGroup(null);
        }
      })();
    },
    [reload],
  );

  return {
    groups,
    error,
    rowErrors,
    busyGroup,
    change,
    resetKey,
    resetKeyList,
    resetGroupId,
    reload,
  };
}
