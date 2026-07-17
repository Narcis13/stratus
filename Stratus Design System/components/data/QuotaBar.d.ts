import { ReactNode, CSSProperties } from "react";

/**
 * @startingPoint section="Data" subtitle="Quota / progress bar" viewport="700x90"
 */
export interface QuotaBarProps {
  value?: number;
  max?: number;
  /** Force the "met" (green) state; defaults to value >= max. */
  met?: boolean;
  /** Trailing tabular label, e.g. "3 / 5–10 today". */
  label?: ReactNode;
  style?: CSSProperties;
}

/**
 * Thin pill progress meter — accent while below target, green once met.
 */
export function QuotaBar(props: QuotaBarProps): JSX.Element;
