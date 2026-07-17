import { ReactNode, CSSProperties, MouseEventHandler } from "react";

/**
 * @startingPoint section="Core" subtitle="Pills, stages & filter chips" viewport="700x120"
 */
export interface ChipProps {
  /** Filled/selected state. @default false */
  active?: boolean;
  /** Outline colour semantic. @default "neutral" */
  tone?: "neutral" | "accent" | "ok" | "warn" | "hot" | "warm";
  /** Render as a button (default, clickable) or a static span. @default "button" */
  as?: "button" | "span";
  onClick?: MouseEventHandler<HTMLElement>;
  style?: CSSProperties;
  children?: ReactNode;
}

/**
 * Rounded pill for filters, segmented tabs, stages, channel tags, and reply variants.
 */
export function Chip(props: ChipProps): JSX.Element;
