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
  /** One line of context above the rows (UI.12). Mostly OWNERSHIP: a gear is
   *  next to a feature, so the number a user expects to find in it but which
   *  lives elsewhere has to say so here, or its absence reads as a bug. */
  note?: string | undefined;
  /** Per-key refusal codes (UI.12). The registry bounds are the money guard, so
   *  a rejected value must be visibly rejected rather than left looking saved. */
  errors?: Record<string, string> | undefined;
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
  note,
  errors,
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
          {note && <p className="ui-gear-note">{note}</p>}
          {settings.map((entry) => (
            <div key={entry.key}>
              <SettingRow
                entry={entry}
                onChange={(value) => onPatch(entry.key, value)}
                onReset={onReset ? () => onReset(entry.key) : undefined}
              />
              {errors?.[entry.key] && (
                <p className="error ui-gear-error">
                  {errors[entry.key]} — value rejected, showing the saved one.
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
