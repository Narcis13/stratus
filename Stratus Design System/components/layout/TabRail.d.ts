import { CSSProperties } from "react";

export interface TabRailItem { id: string; label: string; disabled?: boolean; }

/**
 * @startingPoint section="Layout" subtitle="Vertical tab rail" viewport="140x420"
 */
export interface TabRailProps {
  /** Lowercase brand eyebrow at the top. @default "stratus" */
  brand?: string;
  /** Tabs, as ids or {id,label,disabled} objects. */
  tabs?: (string | TabRailItem)[];
  /** id of the active tab. */
  active?: string;
  onSelect?: (id: string) => void;
  style?: CSSProperties;
}

/**
 * The fixed 104px vertical tab navigation for the Stratus side panel.
 */
export function TabRail(props: TabRailProps): JSX.Element;
