import { type JSX, useEffect, useRef, useState } from 'react';

interface Props {
  value: number;
  min?: number | undefined;
  max?: number | undefined;
  step?: number | undefined;
  /** Accessible name (SettingRow passes the knob label). */
  ariaLabel: string;
  /** Optional unit shown after the box ('%', '×', 'views'…). */
  unit?: string | undefined;
  onChange: (value: number) => void;
}

/** NumberField — the one control every `number` knob renders (RS.7 replaced the
 *  bounded-range Slider with it). A range knob whose ceiling is 1,000,000 views
 *  cannot be aimed with a 110px track: the sweep filters are exact numbers the
 *  user types, so the control has to accept exact numbers.
 *
 *  Commits on blur and Enter, never per keystroke — the same discipline the
 *  numberArray row uses, and for a stronger reason here: typing "500" into a
 *  knob whose floor is 100 would clamp the first keystroke to 100 and fight the
 *  typist. The registry bounds still apply on commit (they are the money guard),
 *  and an unparseable or emptied field reverts to the saved value rather than
 *  saving a 0. GearPopover blurs the focused input before it closes, so an
 *  outside click is a save, not a dropped edit. */
export function NumberField({
  value,
  min,
  max,
  step = 1,
  ariaLabel,
  unit,
  onChange,
}: Props): JSX.Element {
  const [text, setText] = useState(String(value));
  useEffect(() => {
    setText(String(value));
  }, [value]);

  // The Settings tab keeps rows mounted, but a gear's rows unmount with the
  // popover. React removing a focused input does NOT fire blur in every path,
  // so the unmount flush is the backstop for a value typed and never committed.
  const latest = useRef({ text, value, min, max, onChange });
  latest.current = { text, value, min, max, onChange };
  useEffect(() => {
    return () => {
      const l = latest.current;
      const next = parse(l.text, l.min, l.max);
      if (next !== null && next !== l.value) l.onChange(next);
    };
  }, []);

  const commit = (): void => {
    const next = parse(text, min, max);
    if (next === null) {
      setText(String(value));
      return;
    }
    setText(String(next));
    if (next !== value) onChange(next);
  };

  return (
    <div className="ui-numberfield">
      <input
        type="number"
        className="ui-numberfield-input"
        inputMode="numeric"
        min={min}
        max={max}
        step={step}
        value={text}
        aria-label={ariaLabel}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key !== 'Enter') return;
          e.preventDefault();
          commit();
        }}
      />
      {unit && <span className="ui-numberfield-unit">{unit}</span>}
    </div>
  );
}

/** The typed text as a saveable number, or null when there is nothing to save
 *  (blank, or not a number — `Number('') === 0` is the trap). Clamped to the
 *  registry bounds so the field cannot hand the server a value it will refuse. */
function parse(text: string, min: number | undefined, max: number | undefined): number | null {
  const trimmed = text.trim();
  if (trimmed === '') return null;
  const n = Number(trimmed);
  if (!Number.isFinite(n)) return null;
  if (min !== undefined && n < min) return min;
  if (max !== undefined && n > max) return max;
  return n;
}
