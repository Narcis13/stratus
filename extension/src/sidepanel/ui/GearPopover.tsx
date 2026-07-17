import { type JSX, useEffect, useRef, useState } from 'react';
import type { SettingEntry } from '../api.ts';
import { SettingRow } from './SettingRow.tsx';

interface Props {
  /** The subset of knobs this gear tunes (the caller pre-filters the registry). */
  settings: SettingEntry[];
  /** Where the PATCH lands — wire to `settingsClient.patchSetting`. */
  onPatch: (key: string, value: unknown) => void;
  /** Optional per-key reset — wire to `settingsClient.resetKeys`. */
  onReset?: ((key: string) => void) | undefined;
  /** Accessible name for the trigger. */
  label?: string | undefined;
}

/** GearPopover — the inline-config affordance: a `⚙` glyph button opening a
 *  hairline card of SettingRows next to the feature it tunes. Closes on outside
 *  click. No entrance animation (DS motion: hover/press only). Presentational —
 *  the caller owns the PATCH via `onPatch`. */
export function GearPopover({
  settings,
  onPatch,
  onReset,
  label = 'Configure',
}: Props): JSX.Element {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  return (
    <div className="ui-gear" ref={ref}>
      <button
        type="button"
        className="ui-gear-btn"
        aria-label={label}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        ⚙
      </button>
      {open && (
        <div className="ui-gear-pop">
          {settings.map((entry) => (
            <SettingRow
              key={entry.key}
              entry={entry}
              onChange={(value) => onPatch(entry.key, value)}
              onReset={onReset ? () => onReset(entry.key) : undefined}
            />
          ))}
        </div>
      )}
    </div>
  );
}
