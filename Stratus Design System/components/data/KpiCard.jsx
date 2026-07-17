import React from "react";
import { Sparkline } from "./Sparkline.jsx";

/**
 * KpiCard — the hero metric block from the Today tab: a big tabular number,
 * a label with an optional up/down delta, and a trailing sparkline. Also serves
 * the analytics stat cards (Impressions, Engagement rate, etc).
 */
export function KpiCard({ value, label, delta, deltaSuffix = "", spark, style, ...rest }) {
  const up = delta == null || delta >= 0;
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        gap: "12px",
        background: "var(--strat-bg)",
        border: "1px solid var(--strat-border)",
        borderRadius: "6px",
        padding: "12px 14px",
        fontFamily: "var(--strat-font-sans)",
        ...style,
      }}
      {...rest}
    >
      <div>
        <div style={{ fontSize: "26px", fontWeight: 700, lineHeight: 1.1, fontVariantNumeric: "tabular-nums", color: "var(--strat-text)" }}>
          {value}
        </div>
        <div style={{ fontSize: "11px", color: "var(--strat-muted)", display: "flex", gap: "8px", alignItems: "baseline", marginTop: "2px" }}>
          {label}
          {delta != null && (
            <span style={{ fontWeight: 600, fontVariantNumeric: "tabular-nums", color: up ? "var(--strat-ok)" : "var(--strat-danger)" }}>
              {up ? "+" : ""}{delta}{deltaSuffix}
            </span>
          )}
        </div>
      </div>
      {Array.isArray(spark) && <Sparkline points={spark} />}
    </div>
  );
}
