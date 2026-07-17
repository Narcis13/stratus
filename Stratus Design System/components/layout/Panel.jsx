import React from "react";

/**
 * Panel — the elevated card container that wraps every tab's content. Optional
 * header row with a 14px title and a right-aligned actions slot. Children stack
 * with a 12px gap, matching the extension's `.panel`.
 */
export function Panel({ title, actions, style, children, ...rest }) {
  return (
    <section
      style={{
        background: "var(--strat-bg-elev)",
        border: "1px solid var(--strat-border)",
        borderRadius: "8px",
        padding: "14px",
        display: "flex",
        flexDirection: "column",
        gap: "12px",
        fontFamily: "var(--strat-font-sans)",
        color: "var(--strat-text)",
        ...style,
      }}
      {...rest}
    >
      {(title || actions) && (
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px" }}>
          <h2 style={{ margin: 0, fontSize: "14px", fontWeight: 600 }}>{title}</h2>
          {actions && <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}
