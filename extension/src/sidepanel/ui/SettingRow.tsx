import { type JSX, useEffect, useState } from 'react';
import type { SettingEntry } from '../api.ts';
import { Slider } from './Slider.tsx';

interface Props {
  entry: SettingEntry;
  onChange: (value: unknown) => void;
  /** When provided and the value is non-default, an accent reset dot appears. */
  onReset?: (() => void) | undefined;
}

function asNumber(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

/** SettingRow — label + description + a control chosen from the SettingDef meta
 *  (number → Slider when bounded else number input; boolean → checkbox; enum →
 *  select; string → text; numberArray → comma-separated text). A reset dot marks
 *  non-default values. Pure presentation — the PATCH lives in `settingsClient`. */
export function SettingRow({ entry, onChange, onReset }: Props): JSX.Element {
  return (
    <div className="ui-setting-row">
      <div className="ui-setting-meta">
        <span className="ui-setting-label">
          {!entry.isDefault && onReset && (
            <button
              type="button"
              className="ui-setting-reset"
              title="Reset to default"
              aria-label={`Reset ${entry.label} to default`}
              onClick={onReset}
            />
          )}
          {entry.label}
          {entry.appliesOn === 'restart' && <span className="ui-setting-restart">restart</span>}
        </span>
        {entry.description && <span className="ui-setting-desc">{entry.description}</span>}
      </div>
      <div className="ui-setting-control">{renderControl(entry, onChange)}</div>
    </div>
  );
}

function renderControl(entry: SettingEntry, onChange: (v: unknown) => void): JSX.Element {
  switch (entry.type) {
    case 'boolean':
      return (
        <input
          type="checkbox"
          checked={entry.value === true}
          aria-label={entry.label}
          onChange={(e) => onChange(e.target.checked)}
        />
      );
    case 'enum': {
      const val = typeof entry.value === 'string' ? entry.value : String(entry.default ?? '');
      return (
        <select value={val} aria-label={entry.label} onChange={(e) => onChange(e.target.value)}>
          {(entry.options ?? []).map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      );
    }
    case 'string': {
      const val = typeof entry.value === 'string' ? entry.value : String(entry.default ?? '');
      return (
        <input
          type="text"
          value={val}
          aria-label={entry.label}
          onChange={(e) => onChange(e.target.value)}
        />
      );
    }
    case 'numberArray':
      return <NumberArrayInput entry={entry} onChange={onChange} />;
    default: {
      const num = asNumber(entry.value, asNumber(entry.default, entry.min ?? 0));
      if (entry.min !== undefined && entry.max !== undefined) {
        return (
          <Slider
            value={num}
            min={entry.min}
            max={entry.max}
            step={entry.step ?? 1}
            ariaLabel={entry.label}
            unit={entry.unit}
            onChange={onChange}
          />
        );
      }
      return (
        <input
          type="number"
          value={num}
          min={entry.min}
          max={entry.max}
          step={entry.step ?? 1}
          aria-label={entry.label}
          onChange={(e) => onChange(Number(e.target.value))}
        />
      );
    }
  }
}

/** numberArray editor — comma-separated, committed on blur so partial input
 *  (a trailing comma mid-type) doesn't fire a patch. */
function NumberArrayInput({
  entry,
  onChange,
}: {
  entry: SettingEntry;
  onChange: (v: unknown) => void;
}): JSX.Element {
  const [text, setText] = useState(Array.isArray(entry.value) ? entry.value.join(', ') : '');

  useEffect(() => {
    setText(Array.isArray(entry.value) ? entry.value.join(', ') : '');
  }, [entry.value]);

  const commit = () => {
    const parsed = text
      .split(',')
      .map((p) => Number(p.trim()))
      .filter((n) => Number.isFinite(n));
    onChange(parsed);
  };

  return (
    <input
      type="text"
      className="ui-numberarray"
      value={text}
      aria-label={entry.label}
      placeholder="e.g. 9, 13, 18"
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
    />
  );
}
