import React from "react";

/**
 * TabRail — the fixed 104px vertical navigation on the left of the side panel.
 * A lowercase "stratus" brandmark eyebrow, then a stack of left-aligned tab
 * buttons. The active tab gets the app-canvas fill + a hairline border.
 */
export function TabRail({ brand = "stratus", tabs = [], active, onSelect, style, ...rest }) {
  return (
    <nav
      style={{
        borderRight: "1px solid var(--strat-border)",
        background: "var(--strat-bg-elev)",
        width: "104px",
        flexShrink: 0,
        display: "flex",
        flexDirection: "column",
        height: "100%",
        overflowY: "auto",
        fontFamily: "var(--strat-font-sans)",
        ...style,
      }}
      {...rest}
    >
      <div style={{ padding: "12px 12px 8px", fontWeight: 600, letterSpacing: "0.04em", fontSize: "11px", color: "var(--strat-muted)", textTransform: "uppercase" }}>
        {brand}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: "2px", padding: "0 6px 8px" }}>
        {tabs.map((t) => {
          const id = typeof t === "string" ? t : t.id;
          const label = typeof t === "string" ? t : t.label;
          const disabled = typeof t === "object" && t.disabled;
          return <RailTab key={id} label={label} active={active === id} disabled={disabled} onClick={() => onSelect && onSelect(id)} />;
        })}
      </div>
    </nav>
  );
}

function RailTab({ label, active, disabled, onClick }) {
  const [hover, setHover] = React.useState(false);
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        width: "100%",
        textAlign: "left",
        whiteSpace: "nowrap",
        border: "1px solid",
        borderColor: active ? "var(--strat-border)" : "transparent",
        background: active ? "var(--strat-bg)" : hover && !disabled ? "var(--strat-bg-hover)" : "transparent",
        color: active || (hover && !disabled) ? "var(--strat-text)" : "var(--strat-muted)",
        padding: "6px 8px",
        fontSize: "12px",
        fontFamily: "inherit",
        borderRadius: "6px",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.4 : 1,
        transition: "background var(--strat-transition-fast), color var(--strat-transition-fast)",
      }}
    >
      {label}
    </button>
  );
}
