import { ReactNode, CSSProperties, ChangeEventHandler } from "react";

export interface FieldOption { value: string; label: string; }

/**
 * @startingPoint section="Forms" subtitle="Input, textarea & select field" viewport="700x160"
 */
export interface FieldProps {
  /** Muted label shown above the control. */
  label?: ReactNode;
  /** Right-aligned tabular counter (e.g. chars remaining); negative renders red. */
  counter?: number;
  /** Small muted helper text below the control. */
  hint?: ReactNode;
  /** Control kind. @default "input" */
  as?: "input" | "textarea" | "select";
  value?: string;
  onChange?: ChangeEventHandler<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>;
  placeholder?: string;
  rows?: number;
  /** Options for as="select". */
  options?: FieldOption[];
  disabled?: boolean;
  style?: CSSProperties;
  children?: ReactNode;
}

/**
 * Labeled input / textarea / select with a focus-accent border and char counter.
 */
export function Field(props: FieldProps): JSX.Element;
