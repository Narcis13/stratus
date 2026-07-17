import { ReactNode, CSSProperties } from "react";

/**
 * @startingPoint section="Core" subtitle="Status & lifecycle badges" viewport="700x120"
 */
export interface BadgeProps {
  /** Status/semantic tone. @default "draft" */
  tone?:
    | "draft" | "pending" | "publishing" | "posted" | "failed" | "cancelled"
    | "accent" | "warn" | "ok" | "danger" | "pillar" | "media";
  /** Uppercase the label. @default true */
  uppercase?: boolean;
  style?: CSSProperties;
  children?: ReactNode;
}

/**
 * A small status pill used on posts, drafts, replies, and authors.
 */
export function Badge(props: BadgeProps): JSX.Element;
