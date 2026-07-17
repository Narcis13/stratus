import React from "react";

/**
 * Message — inline status callout. `error` and `warn` are tinted, bordered
 * boxes; `ok` is plain coloured text. Mirrors the extension's .error/.warn/.ok.
 */
const TONES = {
  error: { color: "var(--strat-danger)", background: "rgba(224,85,109,0.12)", border: "1px solid rgba(224,85,109,0.3)", boxed: true },
  warn: { color: "var(--strat-warn)", background: "rgba(255,180,84,0.1)", border: "1px solid rgba(255,180,84,0.3)", boxed: true },
  ok: { color: "var(--strat-ok)", background: "transparent", border: "none", boxed: false },
};

export function Message({ tone = "error", style, children, ...rest }) {
  const t = TONES[tone] || TONES.error;
  return (
    <div
      style={{
        fontFamily: "var(--strat-font-sans)",
        fontSize: "12px",
        lineHeight: 1.45,
        color: t.color,
        background: t.background,
        border: t.border,
        borderRadius: t.boxed ? "6px" : 0,
        padding: t.boxed ? "8px 10px" : 0,
        ...style,
      }}
      {...rest}
    >
      {children}
    </div>
  );
}
