import type { JSX } from 'react';

export interface SubTab<T extends string = string> {
  id: T;
  label: string;
}

interface Props<T extends string> {
  tabs: SubTab<T>[];
  active: T;
  onSelect: (id: T) => void;
  /** Inert while something else owns the choice (UI.15: Harvest freezes its
   *  whole form for the duration of a run). The `:hover:not(:disabled)` rule has
   *  anticipated this since UI.10 — only the prop was missing. */
  disabled?: boolean | undefined;
}

/** SubTabs — the segmented pill control formalized from Voice's `Tweets|Pillars`
 *  switch. A row of buttons; the active one fills. Voice migrated onto this in
 *  Task 14 (UI.14), which also made the row wrap; it is the panel's single-select
 *  FILTER control too, not just sub-navigation. */
export function SubTabs<T extends string>({
  tabs,
  active,
  onSelect,
  disabled,
}: Props<T>): JSX.Element {
  return (
    <div className="ui-subtabs" role="tablist">
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          role="tab"
          aria-selected={active === t.id}
          disabled={disabled}
          className={`ui-subtab${active === t.id ? ' ui-subtab-active' : ''}`}
          onClick={() => onSelect(t.id)}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
