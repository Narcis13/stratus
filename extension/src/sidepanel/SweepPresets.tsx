// SP.1 — the named-preset strip inside the sweep gear.
//
// A preset is a saved combination of the eleven `x.sweep.*` knobs, so the Radar
// can be re-aimed in one click: hunting small accounts (a few hundred
// impressions, a handful of likes) and hunting big ones are the same eleven
// numbers at different settings, and re-typing them per session is how a filter
// set quietly drifts.
//
// Three rules, each of which is why this is a component and not four inline
// handlers in Radar.tsx:
//
//   1. Only a NAME ever leaves the panel. Save snapshots the live registry
//      values SERVER-side and load writes them back through the registry's own
//      validation — the panel never holds, sends, or reconciles its own copy of
//      the eleven numbers, so there is no second place they can be wrong.
//   2. After any write, `onApplied()` re-reads the truth. A load moves eleven
//      rows at once; the optimistic path `useSettingsEditor` uses for a slider
//      drag is exactly wrong here, because the values that landed are the
//      server's, not ours.
//   3. Load is the ONLY destructive act on this strip and it is one click, so
//      the strip states what it overwrites in its own note rather than asking.
//      Delete asks, because a deleted preset can't be recovered by re-loading.
//
// Renders inside GearPopover's `head` slot, above the rows a load moves.

import { type JSX, useCallback, useEffect, useState } from 'react';
import type { SweepPreset } from '../shared/types.ts';
import { ApiError, api } from './api.ts';
import { requestSettingsSync } from './settingsClient.ts';
import type { Settings } from './storage.ts';

interface Props {
  settings: Settings;
  /** Re-read the server's truth — the tab's `editor.reload`. Called after every
   *  successful load, because eleven rows just changed underneath the gear. */
  onApplied: () => void;
}

export function SweepPresets({ settings, onApplied }: Props): JSX.Element {
  const [presets, setPresets] = useState<SweepPreset[] | null>(null);
  const [selected, setSelected] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    try {
      const res = await api.sweepPresets.list(settings);
      setPresets(res.presets);
      setError(null);
    } catch (e) {
      setPresets([]);
      setError(e instanceof ApiError ? e.code : 'load_failed');
    }
  }, [settings]);

  useEffect(() => {
    void load();
  }, [load]);

  // One wrapper for all three writes: the busy flag, the cleared note and the
  // error code are identical in each, and three copies is how one of them ends
  // up leaving the strip stuck on "Saving…" after a 400.
  const run = useCallback(
    async (fn: () => Promise<string>): Promise<void> => {
      setBusy(true);
      setError(null);
      setNote(null);
      try {
        setNote(await fn());
      } catch (e) {
        const code = e instanceof ApiError ? e.code : 'request_failed';
        setError(code);
        // The one code that says the picker is stale rather than the request
        // being wrong (deleted from another surface, or the row edited by hand):
        // re-read instead of leaving a selection that points at nothing.
        if (code === 'unknown_preset') {
          setSelected('');
          void load();
        }
      } finally {
        setBusy(false);
      }
    },
    [load],
  );

  const onSave = (): void => {
    const trimmed = name.trim();
    if (trimmed === '') return;
    void run(async () => {
      const res = await api.sweepPresets.save(settings, trimmed);
      setPresets(res.presets);
      // Select what was just saved — the name in the box is now a thing that
      // exists, and leaving the picker on the old selection reads as a failure.
      setSelected(res.saved);
      setName('');
      return `Saved “${res.saved}” — the eleven numbers below, as they stand now.`;
    });
  };

  const onLoad = (): void => {
    if (selected === '') return;
    void run(async () => {
      const res = await api.sweepPresets.load(settings, selected);
      // The eleven keys are all `mirrored`, and the load went through its own
      // route rather than through `patchSetting`, so nothing has told the
      // background to re-pull. Without this the panel shows the new filters
      // while the content script keeps sweeping on the old ones until the TTL.
      requestSettingsSync();
      onApplied();
      return `Loaded “${res.loaded}”. Every filter below is now this preset's.`;
    });
  };

  const onDelete = (): void => {
    if (selected === '') return;
    if (!confirm(`Delete the preset “${selected}”? The filters themselves don't change.`)) return;
    void run(async () => {
      const res = await api.sweepPresets.remove(settings, selected);
      setPresets(res.presets);
      const gone = selected;
      setSelected('');
      return `Deleted “${gone}”.`;
    });
  };

  const empty = presets !== null && presets.length === 0;

  return (
    <div className="sweep-presets">
      <div className="sweep-presets-row">
        <select
          className="sweep-presets-select"
          value={selected}
          disabled={busy || presets === null || empty}
          onChange={(e) => {
            setSelected(e.target.value);
            setNote(null);
          }}
          aria-label="Saved sweep presets"
        >
          <option value="">{empty ? 'No presets saved yet' : 'Pick a preset…'}</option>
          {(presets ?? []).map((p) => (
            <option key={p.name} value={p.name}>
              {p.name}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="sweep-presets-btn"
          disabled={busy || selected === ''}
          onClick={onLoad}
          title="Overwrite all eleven filters below with this preset's numbers"
        >
          Load
        </button>
        <button
          type="button"
          className="sweep-presets-btn subtle"
          disabled={busy || selected === ''}
          onClick={onDelete}
          title="Delete this preset. The filters themselves are untouched."
        >
          Delete
        </button>
      </div>

      <div className="sweep-presets-row">
        <input
          className="sweep-presets-name"
          type="text"
          value={name}
          maxLength={40}
          placeholder="Name this combination…"
          disabled={busy}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              onSave();
            }
          }}
          aria-label="New preset name"
        />
        <button
          type="button"
          className="sweep-presets-btn"
          disabled={busy || name.trim() === ''}
          onClick={onSave}
          title="Save the eleven filters below, exactly as they stand, under this name"
        >
          Save current
        </button>
      </div>

      {note && <p className="sweep-presets-note">{note}</p>}
      {error && (
        <p className="error sweep-presets-note">
          {error === 'too_many_presets'
            ? 'too_many_presets — delete one first (20 is the cap).'
            : error === 'unknown_preset'
              ? 'unknown_preset — it was removed elsewhere; the list has been re-read.'
              : error}
        </p>
      )}
    </div>
  );
}
