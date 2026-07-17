import React from "react";

/**
 * Chip — a rounded pill used for filters, segmented tabs, relationship stages,
 * channel tags, and reply variants. Outlined by default; `active` fills it with
 * a tinted accent. `tone` recolours the outline for stage/band semantics.
 */
const TONES = {
  neutral: "var(--strat-muted)",
  accent: "var(--strat-accent)",
  ok: "var(--strat-ok)",
  warn: "var(--strat-warn)",
  hot: "var(--strat-band-hot)",
  warm: "var(--strat-band-warm-text)",
};

export function Chip({
  active = false,
  tone = "neutral",
  as = "button",
  onClick,
  style,
  children,
  ...rest
}) {
  const [hover, setHover] = React.useState(false);
  const color = TONES[tone] || TONES.neutral;
  const Tag = as;
  const interactive = as === "button";

  return (
    <Tag
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      type={interactive ? "button" : undefined}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "4px",
        fontFamily: "var(--strat-font-sans)",
        fontSize: "11px",
        fontWeight: active ? 600 : 400,
        lineHeight: 1.3,
        padding: "1px 8px",
        borderRadius: "999px",
        border: "1px solid",
        cursor: interactive ? "pointer" : "default",
        whiteSpace: "nowrap",
        transition: "background var(--strat-transition-fast), color var(--strat-transition-fast)",
        color: active ? (tone === "neutral" ? "var(--strat-accent)" : color) : color,
        borderColor: active ? (tone === "neutral" ? "var(--strat-accent)" : color) : "var(--strat-border)",
        background: active
          ? "var(--strat-bg-elev)"
          : hover && interactive
            ? "var(--strat-bg-hover)"
            : "transparent",
        ...style,
      }}
      {...rest}
    >
      {children}
    </Tag>
  );
}
