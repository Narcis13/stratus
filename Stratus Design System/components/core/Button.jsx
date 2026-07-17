import React from "react";

/**
 * Button — the extension's action control. Flat, hairline-bordered, with a
 * background-swap hover. Three intents (default / primary / danger) and two
 * densities (md / sm) covering everything from panel headers to inline chips.
 */
export function Button({
  variant = "default",
  size = "md",
  disabled = false,
  type = "button",
  onClick,
  style,
  children,
  ...rest
}) {
  const [hover, setHover] = React.useState(false);
  const [active, setActive] = React.useState(false);

  const sizes = {
    md: { padding: "6px 12px", fontSize: "12px", borderRadius: "6px" },
    sm: { padding: "2px 10px", fontSize: "11px", borderRadius: "6px" },
  };

  const intents = {
    default: {
      base: { background: "#2b323d", color: "var(--strat-text)", borderColor: "#3a424f" },
      hover: { background: "#39424f", borderColor: "#4a5462" },
    },
    primary: {
      base: { background: "var(--strat-accent)", color: "#fff", borderColor: "var(--strat-accent)" },
      hover: { background: "var(--strat-accent-hover)", borderColor: "var(--strat-accent-hover)" },
    },
    danger: {
      base: { background: "transparent", color: "var(--strat-danger)", borderColor: "var(--strat-danger)" },
      hover: { background: "var(--strat-danger)", color: "#fff" },
    },
  };

  const intent = intents[variant] || intents.default;

  return (
    <button
      type={type}
      disabled={disabled}
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => { setHover(false); setActive(false); }}
      onMouseDown={() => setActive(true)}
      onMouseUp={() => setActive(false)}
      style={{
        fontFamily: "var(--strat-font-sans)",
        fontWeight: 500,
        lineHeight: 1.45,
        border: "1px solid",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.5 : 1,
        transition: "background var(--strat-transition-fast), border-color var(--strat-transition-fast)",
        transform: active && !disabled ? "translateY(0.5px)" : "none",
        ...sizes[size],
        ...intent.base,
        ...(hover && !disabled ? intent.hover : null),
        ...style,
      }}
      {...rest}
    >
      {children}
    </button>
  );
}
