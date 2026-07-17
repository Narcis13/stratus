import { ReactNode, CSSProperties } from "react";

/**
 * @startingPoint section="Data" subtitle="KPI / stat card" viewport="700x120"
 */
export interface KpiCardProps {
  /** The hero number (pre-formatted, e.g. "214.7K"). */
  value: ReactNode;
  /** Muted label under the number. */
  label?: ReactNode;
  /** Signed delta; positive → green, negative → red. */
  delta?: number;
  /** Suffix on the delta (e.g. " / 7d"). */
  deltaSuffix?: string;
  /** Sparkline series; renders a trailing trend line when given. */
  spark?: number[];
  style?: CSSProperties;
}

/**
 * A hero metric block: big tabular number, delta, and optional sparkline.
 */
export function KpiCard(props: KpiCardProps): JSX.Element;
