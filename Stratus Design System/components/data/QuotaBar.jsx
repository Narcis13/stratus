import React from "react";

/**
 * QuotaBar — the thin pill progress meter from the reply-quota row. Fills with
 * accent blue, or green once the target is met. Optional trailing label.
 */
export function QuotaBar({ value = 0, max = 1, met, label, style, ...rest }) {
  const pct = Math.max(0, Math.min(100, (value / (max || 1)) * 100));
  const isMet = met != null ? met : value >= max;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "10px", fontFamily: "var(--strat-font-sans)", ...style }} {...rest}>
      <div style={{ flex: 1, height: "8px", background: "var(--strat-bg)", border: "1px solid var(--strat-border)", borderRadius: "999px", overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${pct}%`, background: isMet ? "var(--strat-ok)" : "var(--strat-accent)", borderRadius: "999px", transition: "width var(--strat-transition)" }} />
      </div>
      {label != null && (
        <span style={{ fontSize: "11px", color: "var(--strat-muted)", fontVariantNumeric: "tabular-nums", flexShrink: 0 }}>{label}</span>
      )}
    </div>
  );
}
