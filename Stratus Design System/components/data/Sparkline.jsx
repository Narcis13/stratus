import React from "react";

/**
 * Sparkline — the tiny accent-blue polyline used on the follower KPI. Pure SVG,
 * no axes; auto-scales the given points to the box. Mirrors the Today tab's
 * inline Sparkline.
 */
export function Sparkline({ points = [], width = 120, height = 32, color = "var(--strat-accent)", strokeWidth = 1.5, style, ...rest }) {
  if (!points || points.length < 2) return null;
  const pad = 2;
  const min = Math.min(...points);
  const span = Math.max(...points) - min || 1;
  const coords = points
    .map((v, i) => {
      const x = pad + (i / (points.length - 1)) * (width - 2 * pad);
      const y = height - pad - ((v - min) / span) * (height - 2 * pad);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" style={{ color, flexShrink: 0, ...style }} {...rest}>
      <polyline points={coords} fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}
