import React from "react";

/**
 * Badge — a tiny uppercase status pill. Covers the extension's full badge
 * vocabulary: post lifecycle (draft…cancelled), author modes, draft registers,
 * pillar, media, and a plain accent. Colored text on a matching ~15% fill.
 */
const TONES = {
  draft: ["var(--strat-status-draft)", "rgba(139,149,167,0.2)"],
  pending: ["var(--strat-status-pending)", "rgba(79,140,255,0.18)"],
  publishing: ["var(--strat-status-publishing)", "rgba(240,180,70,0.18)"],
  posted: ["var(--strat-status-posted)", "rgba(90,209,154,0.18)"],
  failed: ["var(--strat-status-failed)", "rgba(224,85,109,0.18)"],
  cancelled: ["var(--strat-status-cancelled)", "rgba(110,110,110,0.18)"],
  accent: ["var(--strat-accent)", "rgba(79,140,255,0.15)"],
  warn: ["var(--strat-warn)", "rgba(255,180,84,0.18)"],
  ok: ["var(--strat-ok)", "rgba(90,209,154,0.15)"],
  danger: ["var(--strat-danger)", "rgba(224,85,109,0.15)"],
  pillar: ["var(--strat-pillar)", "var(--strat-pillar-bg)"],
  media: ["var(--strat-warn)", "rgba(255,180,84,0.18)"],
};

export function Badge({ tone = "draft", uppercase = true, style, children, ...rest }) {
  const [fg, bg] = TONES[tone] || TONES.draft;
  return (
    <span
      style={{
        display: "inline-block",
        fontFamily: "var(--strat-font-sans)",
        fontSize: "10px",
        fontWeight: 600,
        textTransform: uppercase ? "uppercase" : "none",
        letterSpacing: "0.04em",
        padding: "1px 6px",
        borderRadius: "10px",
        lineHeight: 1.5,
        flexShrink: 0,
        color: fg,
        background: bg,
        ...style,
      }}
      {...rest}
    >
      {children}
    </span>
  );
}
