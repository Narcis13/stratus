import { ReactNode, CSSProperties, MouseEventHandler } from "react";

/**
 * @startingPoint section="Core" subtitle="Button intents & sizes" viewport="700x120"
 */
export interface ButtonProps {
  /** Visual intent. @default "default" */
  variant?: "default" | "primary" | "danger";
  /** Density. @default "md" */
  size?: "md" | "sm";
  disabled?: boolean;
  type?: "button" | "submit" | "reset";
  onClick?: MouseEventHandler<HTMLButtonElement>;
  style?: CSSProperties;
  children?: ReactNode;
}

/**
 * The primary action control for the Stratus side panel.
 */
export function Button(props: ButtonProps): JSX.Element;
