import { ReactNode, CSSProperties } from "react";

/**
 * @startingPoint section="Layout" subtitle="Dialog over scrim" viewport="700x360"
 */
export interface ModalProps {
  title?: ReactNode;
  /** Called on scrim click or the ✕ button. */
  onClose?: () => void;
  style?: CSSProperties;
  children?: ReactNode;
}

/**
 * Centered dialog over a dark scrim, with a title bar and scrollable body.
 */
export function Modal(props: ModalProps): JSX.Element;
