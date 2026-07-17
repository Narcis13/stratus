import type { JSX } from 'react';

export interface SubTab<T extends string = string> {
  id: T;
  label: string;
}

interface Props<T extends string> {
  tabs: SubTab<T>[];
  active: T;
  onSelect: (id: T) => void;
}

/** SubTabs — the segmented pill control formalized from Voice's `Tweets|Pillars`
 *  switch. A row of buttons; the active one fills. Voice migrates onto this in
 *  Task 14 (UI.14); future plans reuse it for in-tab sub-navigation. */
export function SubTabs<T extends string>({ tabs, active, onSelect }: Props<T>): JSX.Element {
  return (
    <div className="ui-subtabs" role="tablist">
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          role="tab"
          aria-selected={active === t.id}
          className={`ui-subtab${active === t.id ? ' ui-subtab-active' : ''}`}
          onClick={() => onSelect(t.id)}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
