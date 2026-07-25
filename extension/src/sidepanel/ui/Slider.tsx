import type { JSX } from 'react';

interface Props {
  value: number;
  min: number;
  max: number;
  step?: number;
  /** Accessible name (SettingRow passes the knob label). */
  ariaLabel: string;
  /** Optional unit shown after the numeric readout ('%', '×', 'days'…). */
  unit?: string | undefined;
  onChange: (value: number) => void;
}

/** Slider — a bounded range control with a tabular-nums readout. Used by
 *  SettingRow for `number` knobs that declare both min and max. Thin: a native
 *  range input styled via tokens, no state of its own. */
export function Slider({
  value,
  min,
  max,
  step = 1,
  ariaLabel,
  unit,
  onChange,
}: Props): JSX.Element {
  return (
    <div className="ui-slider">
      <input
        type="range"
        className="ui-slider-range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-label={ariaLabel}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <span className="ui-slider-value">
        {value}
        {unit ? ` ${unit}` : ''}
      </span>
    </div>
  );
}
