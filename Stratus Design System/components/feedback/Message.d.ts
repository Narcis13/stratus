import { ReactNode, CSSProperties } from "react";

/**
 * @startingPoint section="Feedback" subtitle="Error, warn & ok messages" viewport="700x150"
 */
export interface MessageProps {
  /** @default "error" */
  tone?: "error" | "warn" | "ok";
  style?: CSSProperties;
  children?: ReactNode;
}

/**
 * Inline status callout: tinted boxes for error/warn, plain text for ok.
 */
export function Message(props: MessageProps): JSX.Element;
