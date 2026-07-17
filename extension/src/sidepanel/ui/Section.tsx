import type { JSX, ReactNode } from 'react';

interface Props {
  /** Uppercase tracked eyebrow above the body. */
  title: string;
  /** Optional right-aligned actions slot in the eyebrow row (gear, reset…). */
  actions?: ReactNode;
  children: ReactNode;
}

/** Section — an eyebrow-headed content block. The formalized version of the
 *  ad-hoc `<h3>` + copy pattern scattered through the tabs; consumers migrate
 *  in the Wave-5 polish passes. Pure presentation: className + tokens only. */
export function Section({ title, actions, children }: Props): JSX.Element {
  return (
    <section className="ui-section">
      <div className="ui-section-head">
        <h3 className="ui-section-eyebrow">{title}</h3>
        {actions && <div className="ui-section-actions">{actions}</div>}
      </div>
      {children}
    </section>
  );
}
