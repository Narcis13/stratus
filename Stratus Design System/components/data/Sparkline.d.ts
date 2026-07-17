import { CSSProperties } from "react";

export interface SparklineProps {
  /** Series values; auto-scaled to the box. Needs ≥2 points to render. */
  points: number[];
  width?: number;
  height?: number;
  /** Stroke colour. @default accent blue */
  color?: string;
  strokeWidth?: number;
  style?: CSSProperties;
}

/** Tiny axis-less trend line for KPI cards. */
export function Sparkline(props: SparklineProps): JSX.Element | null;
