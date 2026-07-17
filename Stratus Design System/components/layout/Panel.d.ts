import { ReactNode, CSSProperties } from "react";

/**
 * @startingPoint section="Layout" subtitle="Card container with header" viewport="700x220"
 */
export interface PanelProps {
  /** 14px panel title (rendered as an h2). */
  title?: ReactNode;
  /** Right-aligned actions in the header row (e.g. a Refresh button). */
  actions?: ReactNode;
  style?: CSSProperties;
  children?: ReactNode;
}

/**
 * The elevated card container that wraps each side-panel tab's content.
 */
export function Panel(props: PanelProps): JSX.Element;
