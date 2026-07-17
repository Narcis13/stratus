import type { JSX, ReactNode } from 'react';

interface Props {
  /** One-line coach copy — what's empty and why, in the product's voice. */
  line: string;
  /** Optional secondary hint (the next action to take). */
  hint?: string;
  /** Optional action (a button/link) shown under the copy. */
  action?: ReactNode;
}

/** EmptyState — replaces bare `<p className="muted">` empties with a consistent,
 *  slightly warmer treatment: a coach line, an optional hint, an optional CTA. */
export function EmptyState({ line, hint, action }: Props): JSX.Element {
  return (
    <div className="ui-empty">
      <p className="ui-empty-line">{line}</p>
      {hint && <p className="ui-empty-hint">{hint}</p>}
      {action && <div className="ui-empty-action">{action}</div>}
    </div>
  );
}
