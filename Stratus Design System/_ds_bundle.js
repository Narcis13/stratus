/* @ds-bundle: {"format":4,"namespace":"StratusDesignSystem_4635dc","components":[{"name":"Badge","sourcePath":"components/core/Badge.jsx"},{"name":"Button","sourcePath":"components/core/Button.jsx"},{"name":"Chip","sourcePath":"components/core/Chip.jsx"},{"name":"KpiCard","sourcePath":"components/data/KpiCard.jsx"},{"name":"QuotaBar","sourcePath":"components/data/QuotaBar.jsx"},{"name":"Sparkline","sourcePath":"components/data/Sparkline.jsx"},{"name":"Message","sourcePath":"components/feedback/Message.jsx"},{"name":"Field","sourcePath":"components/forms/Field.jsx"},{"name":"Modal","sourcePath":"components/layout/Modal.jsx"},{"name":"Panel","sourcePath":"components/layout/Panel.jsx"},{"name":"TabRail","sourcePath":"components/layout/TabRail.jsx"}],"sourceHashes":{"components/core/Badge.jsx":"6a57e4b237e6","components/core/Button.jsx":"aff0f557d7ec","components/core/Chip.jsx":"a001ae4242fb","components/data/KpiCard.jsx":"1a4a1fa246b3","components/data/QuotaBar.jsx":"7536a9190854","components/data/Sparkline.jsx":"bde89d251985","components/feedback/Message.jsx":"3eb6da250cde","components/forms/Field.jsx":"8a0483aa076f","components/layout/Modal.jsx":"a21cf70a1536","components/layout/Panel.jsx":"5bd3b76cfef4","components/layout/TabRail.jsx":"cb9fc9643029","ui_kits/sidepanel/ComposerScreen.jsx":"0772da3ccc1e","ui_kits/sidepanel/ReplyScreen.jsx":"ca62f2a67caf","ui_kits/sidepanel/TodayScreen.jsx":"b9dfa785d70e","ui_kits/sidepanel/XTimeline.jsx":"297e47c3c281"},"inlinedExternals":[],"unexposedExports":[]} */

(() => {

const __ds_ns = (window.StratusDesignSystem_4635dc = window.StratusDesignSystem_4635dc || {});

const __ds_scope = {};

(__ds_ns.__errors = __ds_ns.__errors || []);

// components/core/Badge.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
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
  media: ["var(--strat-warn)", "rgba(255,180,84,0.18)"]
};
function Badge({
  tone = "draft",
  uppercase = true,
  style,
  children,
  ...rest
}) {
  const [fg, bg] = TONES[tone] || TONES.draft;
  return /*#__PURE__*/React.createElement("span", _extends({
    style: {
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
      ...style
    }
  }, rest), children);
}
Object.assign(__ds_scope, { Badge });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Badge.jsx", error: String((e && e.message) || e) }); }

// components/core/Button.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * Button — the extension's action control. Flat, hairline-bordered, with a
 * background-swap hover. Three intents (default / primary / danger) and two
 * densities (md / sm) covering everything from panel headers to inline chips.
 */
function Button({
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
    md: {
      padding: "6px 12px",
      fontSize: "12px",
      borderRadius: "6px"
    },
    sm: {
      padding: "2px 10px",
      fontSize: "11px",
      borderRadius: "6px"
    }
  };
  const intents = {
    default: {
      base: {
        background: "#2b323d",
        color: "var(--strat-text)",
        borderColor: "#3a424f"
      },
      hover: {
        background: "#39424f",
        borderColor: "#4a5462"
      }
    },
    primary: {
      base: {
        background: "var(--strat-accent)",
        color: "#fff",
        borderColor: "var(--strat-accent)"
      },
      hover: {
        background: "var(--strat-accent-hover)",
        borderColor: "var(--strat-accent-hover)"
      }
    },
    danger: {
      base: {
        background: "transparent",
        color: "var(--strat-danger)",
        borderColor: "var(--strat-danger)"
      },
      hover: {
        background: "var(--strat-danger)",
        color: "#fff"
      }
    }
  };
  const intent = intents[variant] || intents.default;
  return /*#__PURE__*/React.createElement("button", _extends({
    type: type,
    disabled: disabled,
    onClick: onClick,
    onMouseEnter: () => setHover(true),
    onMouseLeave: () => {
      setHover(false);
      setActive(false);
    },
    onMouseDown: () => setActive(true),
    onMouseUp: () => setActive(false),
    style: {
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
      ...style
    }
  }, rest), children);
}
Object.assign(__ds_scope, { Button });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Button.jsx", error: String((e && e.message) || e) }); }

// components/core/Chip.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
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
  warm: "var(--strat-band-warm-text)"
};
function Chip({
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
  return /*#__PURE__*/React.createElement(Tag, _extends({
    onClick: onClick,
    onMouseEnter: () => setHover(true),
    onMouseLeave: () => setHover(false),
    type: interactive ? "button" : undefined,
    style: {
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
      color: active ? tone === "neutral" ? "var(--strat-accent)" : color : color,
      borderColor: active ? tone === "neutral" ? "var(--strat-accent)" : color : "var(--strat-border)",
      background: active ? "var(--strat-bg-elev)" : hover && interactive ? "var(--strat-bg-hover)" : "transparent",
      ...style
    }
  }, rest), children);
}
Object.assign(__ds_scope, { Chip });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Chip.jsx", error: String((e && e.message) || e) }); }

// components/data/QuotaBar.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * QuotaBar — the thin pill progress meter from the reply-quota row. Fills with
 * accent blue, or green once the target is met. Optional trailing label.
 */
function QuotaBar({
  value = 0,
  max = 1,
  met,
  label,
  style,
  ...rest
}) {
  const pct = Math.max(0, Math.min(100, value / (max || 1) * 100));
  const isMet = met != null ? met : value >= max;
  return /*#__PURE__*/React.createElement("div", _extends({
    style: {
      display: "flex",
      alignItems: "center",
      gap: "10px",
      fontFamily: "var(--strat-font-sans)",
      ...style
    }
  }, rest), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      height: "8px",
      background: "var(--strat-bg)",
      border: "1px solid var(--strat-border)",
      borderRadius: "999px",
      overflow: "hidden"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      height: "100%",
      width: `${pct}%`,
      background: isMet ? "var(--strat-ok)" : "var(--strat-accent)",
      borderRadius: "999px",
      transition: "width var(--strat-transition)"
    }
  })), label != null && /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: "11px",
      color: "var(--strat-muted)",
      fontVariantNumeric: "tabular-nums",
      flexShrink: 0
    }
  }, label));
}
Object.assign(__ds_scope, { QuotaBar });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/data/QuotaBar.jsx", error: String((e && e.message) || e) }); }

// components/data/Sparkline.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * Sparkline — the tiny accent-blue polyline used on the follower KPI. Pure SVG,
 * no axes; auto-scales the given points to the box. Mirrors the Today tab's
 * inline Sparkline.
 */
function Sparkline({
  points = [],
  width = 120,
  height = 32,
  color = "var(--strat-accent)",
  strokeWidth = 1.5,
  style,
  ...rest
}) {
  if (!points || points.length < 2) return null;
  const pad = 2;
  const min = Math.min(...points);
  const span = Math.max(...points) - min || 1;
  const coords = points.map((v, i) => {
    const x = pad + i / (points.length - 1) * (width - 2 * pad);
    const y = height - pad - (v - min) / span * (height - 2 * pad);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
  return /*#__PURE__*/React.createElement("svg", _extends({
    width: width,
    height: height,
    viewBox: `0 0 ${width} ${height}`,
    role: "img",
    style: {
      color,
      flexShrink: 0,
      ...style
    }
  }, rest), /*#__PURE__*/React.createElement("polyline", {
    points: coords,
    fill: "none",
    stroke: "currentColor",
    strokeWidth: strokeWidth,
    strokeLinejoin: "round",
    strokeLinecap: "round"
  }));
}
Object.assign(__ds_scope, { Sparkline });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/data/Sparkline.jsx", error: String((e && e.message) || e) }); }

// components/data/KpiCard.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * KpiCard — the hero metric block from the Today tab: a big tabular number,
 * a label with an optional up/down delta, and a trailing sparkline. Also serves
 * the analytics stat cards (Impressions, Engagement rate, etc).
 */
function KpiCard({
  value,
  label,
  delta,
  deltaSuffix = "",
  spark,
  style,
  ...rest
}) {
  const up = delta == null || delta >= 0;
  return /*#__PURE__*/React.createElement("div", _extends({
    style: {
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
      gap: "12px",
      background: "var(--strat-bg)",
      border: "1px solid var(--strat-border)",
      borderRadius: "6px",
      padding: "12px 14px",
      fontFamily: "var(--strat-font-sans)",
      ...style
    }
  }, rest), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: "26px",
      fontWeight: 700,
      lineHeight: 1.1,
      fontVariantNumeric: "tabular-nums",
      color: "var(--strat-text)"
    }
  }, value), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: "11px",
      color: "var(--strat-muted)",
      display: "flex",
      gap: "8px",
      alignItems: "baseline",
      marginTop: "2px"
    }
  }, label, delta != null && /*#__PURE__*/React.createElement("span", {
    style: {
      fontWeight: 600,
      fontVariantNumeric: "tabular-nums",
      color: up ? "var(--strat-ok)" : "var(--strat-danger)"
    }
  }, up ? "+" : "", delta, deltaSuffix))), Array.isArray(spark) && /*#__PURE__*/React.createElement(__ds_scope.Sparkline, {
    points: spark
  }));
}
Object.assign(__ds_scope, { KpiCard });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/data/KpiCard.jsx", error: String((e && e.message) || e) }); }

// components/feedback/Message.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * Message — inline status callout. `error` and `warn` are tinted, bordered
 * boxes; `ok` is plain coloured text. Mirrors the extension's .error/.warn/.ok.
 */
const TONES = {
  error: {
    color: "var(--strat-danger)",
    background: "rgba(224,85,109,0.12)",
    border: "1px solid rgba(224,85,109,0.3)",
    boxed: true
  },
  warn: {
    color: "var(--strat-warn)",
    background: "rgba(255,180,84,0.1)",
    border: "1px solid rgba(255,180,84,0.3)",
    boxed: true
  },
  ok: {
    color: "var(--strat-ok)",
    background: "transparent",
    border: "none",
    boxed: false
  }
};
function Message({
  tone = "error",
  style,
  children,
  ...rest
}) {
  const t = TONES[tone] || TONES.error;
  return /*#__PURE__*/React.createElement("div", _extends({
    style: {
      fontFamily: "var(--strat-font-sans)",
      fontSize: "12px",
      lineHeight: 1.45,
      color: t.color,
      background: t.background,
      border: t.border,
      borderRadius: t.boxed ? "6px" : 0,
      padding: t.boxed ? "8px 10px" : 0,
      ...style
    }
  }, rest), children);
}
Object.assign(__ds_scope, { Message });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/feedback/Message.jsx", error: String((e && e.message) || e) }); }

// components/forms/Field.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * Field — labeled form control wrapper matching the extension's `.field`.
 * A muted label row (with optional right-aligned counter), then a dark input,
 * textarea, or select that highlights its border to accent on focus. Pass the
 * control type via `as`.
 */
function Field({
  label,
  counter,
  hint,
  as = "input",
  value,
  onChange,
  placeholder,
  rows = 4,
  options = [],
  disabled = false,
  style,
  children,
  ...rest
}) {
  const [focus, setFocus] = React.useState(false);
  const controlStyle = {
    background: "var(--strat-bg)",
    color: "var(--strat-text)",
    border: "1px solid",
    borderColor: focus ? "var(--strat-accent)" : "var(--strat-border)",
    borderRadius: "6px",
    padding: "8px 10px",
    fontFamily: "var(--strat-font-sans)",
    fontSize: "13px",
    outline: "none",
    width: "100%",
    resize: as === "textarea" ? "vertical" : undefined
  };
  return /*#__PURE__*/React.createElement("label", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: "4px",
      fontSize: "12px",
      color: "var(--strat-muted)",
      ...style
    }
  }, (label || counter) && /*#__PURE__*/React.createElement("span", {
    style: {
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center"
    }
  }, /*#__PURE__*/React.createElement("span", null, label), counter != null && /*#__PURE__*/React.createElement("span", {
    style: {
      fontVariantNumeric: "tabular-nums",
      fontSize: "11px",
      color: counter < 0 ? "var(--strat-danger)" : "var(--strat-muted)",
      fontWeight: counter < 0 ? 600 : 400
    }
  }, counter)), as === "textarea" ? /*#__PURE__*/React.createElement("textarea", _extends({
    value: value,
    onChange: onChange,
    placeholder: placeholder,
    rows: rows,
    disabled: disabled,
    onFocus: () => setFocus(true),
    onBlur: () => setFocus(false),
    style: controlStyle
  }, rest)) : as === "select" ? /*#__PURE__*/React.createElement("select", _extends({
    value: value,
    onChange: onChange,
    disabled: disabled,
    onFocus: () => setFocus(true),
    onBlur: () => setFocus(false),
    style: controlStyle
  }, rest), options.map(o => /*#__PURE__*/React.createElement("option", {
    key: o.value,
    value: o.value
  }, o.label)), children) : /*#__PURE__*/React.createElement("input", _extends({
    value: value,
    onChange: onChange,
    placeholder: placeholder,
    disabled: disabled,
    onFocus: () => setFocus(true),
    onBlur: () => setFocus(false),
    style: controlStyle
  }, rest)), hint && /*#__PURE__*/React.createElement("small", {
    style: {
      fontSize: "11px",
      color: "var(--strat-muted)"
    }
  }, hint));
}
Object.assign(__ds_scope, { Field });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Field.jsx", error: String((e && e.message) || e) }); }

// components/layout/Modal.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * Modal — centered dialog over a dark scrim. Header with title + close button,
 * then a scrollable body. Matches the extension's .modal-backdrop / .modal-card.
 */
function Modal({
  title,
  onClose,
  style,
  children,
  ...rest
}) {
  return /*#__PURE__*/React.createElement("div", {
    onClick: onClose,
    role: "presentation",
    style: {
      position: "fixed",
      inset: 0,
      background: "var(--strat-scrim)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      padding: "16px",
      zIndex: 100,
      fontFamily: "var(--strat-font-sans)"
    }
  }, /*#__PURE__*/React.createElement("div", _extends({
    onClick: e => e.stopPropagation(),
    role: "dialog",
    "aria-modal": "true",
    style: {
      background: "var(--strat-bg-elev)",
      border: "1px solid var(--strat-border)",
      borderRadius: "8px",
      boxShadow: "0 12px 32px rgba(0,0,0,0.5)",
      padding: "14px 16px",
      width: "100%",
      maxWidth: "560px",
      maxHeight: "85vh",
      display: "flex",
      flexDirection: "column",
      gap: "10px",
      color: "var(--strat-text)",
      ...style
    }
  }, rest), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between"
    }
  }, /*#__PURE__*/React.createElement("h3", {
    style: {
      margin: 0,
      fontSize: "14px",
      fontWeight: 600
    }
  }, title), /*#__PURE__*/React.createElement("button", {
    type: "button",
    onClick: onClose,
    style: {
      background: "var(--strat-bg-hover)",
      color: "var(--strat-text)",
      border: "1px solid var(--strat-border)",
      borderRadius: "6px",
      padding: "2px 8px",
      fontSize: "12px",
      cursor: "pointer",
      lineHeight: 1.4
    }
  }, "\u2715")), /*#__PURE__*/React.createElement("div", {
    style: {
      overflow: "auto"
    }
  }, children)));
}
Object.assign(__ds_scope, { Modal });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/layout/Modal.jsx", error: String((e && e.message) || e) }); }

// components/layout/Panel.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * Panel — the elevated card container that wraps every tab's content. Optional
 * header row with a 14px title and a right-aligned actions slot. Children stack
 * with a 12px gap, matching the extension's `.panel`.
 */
function Panel({
  title,
  actions,
  style,
  children,
  ...rest
}) {
  return /*#__PURE__*/React.createElement("section", _extends({
    style: {
      background: "var(--strat-bg-elev)",
      border: "1px solid var(--strat-border)",
      borderRadius: "8px",
      padding: "14px",
      display: "flex",
      flexDirection: "column",
      gap: "12px",
      fontFamily: "var(--strat-font-sans)",
      color: "var(--strat-text)",
      ...style
    }
  }, rest), (title || actions) && /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
      gap: "8px"
    }
  }, /*#__PURE__*/React.createElement("h2", {
    style: {
      margin: 0,
      fontSize: "14px",
      fontWeight: 600
    }
  }, title), actions && /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: "8px",
      alignItems: "center"
    }
  }, actions)), children);
}
Object.assign(__ds_scope, { Panel });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/layout/Panel.jsx", error: String((e && e.message) || e) }); }

// components/layout/TabRail.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * TabRail — the fixed 104px vertical navigation on the left of the side panel.
 * A lowercase "stratus" brandmark eyebrow, then a stack of left-aligned tab
 * buttons. The active tab gets the app-canvas fill + a hairline border.
 */
function TabRail({
  brand = "stratus",
  tabs = [],
  active,
  onSelect,
  style,
  ...rest
}) {
  return /*#__PURE__*/React.createElement("nav", _extends({
    style: {
      borderRight: "1px solid var(--strat-border)",
      background: "var(--strat-bg-elev)",
      width: "104px",
      flexShrink: 0,
      display: "flex",
      flexDirection: "column",
      height: "100%",
      overflowY: "auto",
      fontFamily: "var(--strat-font-sans)",
      ...style
    }
  }, rest), /*#__PURE__*/React.createElement("div", {
    style: {
      padding: "12px 12px 8px",
      fontWeight: 600,
      letterSpacing: "0.04em",
      fontSize: "11px",
      color: "var(--strat-muted)",
      textTransform: "uppercase"
    }
  }, brand), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: "2px",
      padding: "0 6px 8px"
    }
  }, tabs.map(t => {
    const id = typeof t === "string" ? t : t.id;
    const label = typeof t === "string" ? t : t.label;
    const disabled = typeof t === "object" && t.disabled;
    return /*#__PURE__*/React.createElement(RailTab, {
      key: id,
      label: label,
      active: active === id,
      disabled: disabled,
      onClick: () => onSelect && onSelect(id)
    });
  })));
}
function RailTab({
  label,
  active,
  disabled,
  onClick
}) {
  const [hover, setHover] = React.useState(false);
  return /*#__PURE__*/React.createElement("button", {
    type: "button",
    disabled: disabled,
    onClick: onClick,
    onMouseEnter: () => setHover(true),
    onMouseLeave: () => setHover(false),
    style: {
      width: "100%",
      textAlign: "left",
      whiteSpace: "nowrap",
      border: "1px solid",
      borderColor: active ? "var(--strat-border)" : "transparent",
      background: active ? "var(--strat-bg)" : hover && !disabled ? "var(--strat-bg-hover)" : "transparent",
      color: active || hover && !disabled ? "var(--strat-text)" : "var(--strat-muted)",
      padding: "6px 8px",
      fontSize: "12px",
      fontFamily: "inherit",
      borderRadius: "6px",
      cursor: disabled ? "not-allowed" : "pointer",
      opacity: disabled ? 0.4 : 1,
      transition: "background var(--strat-transition-fast), color var(--strat-transition-fast)"
    }
  }, label);
}
Object.assign(__ds_scope, { TabRail });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/layout/TabRail.jsx", error: String((e && e.message) || e) }); }

// ui_kits/sidepanel/ComposerScreen.jsx
try { (() => {
// The Composer tab — write / AI-draft / schedule. Faithful to the extension:
// text field with live counter, schedule row with Best time / Next slot,
// best-times hint, cost preview, and the Grok drafter with three register cards.
const {
  Panel,
  Button,
  Badge,
  Field,
  Message
} = window.StratusDesignSystem_4635dc;
const {
  useState
} = React;
const TWEET_LIMIT = 280;
const DRAFTS = [{
  register: "plain",
  pillar: "build",
  text: "I schedule a week of posts in about 20 minutes. Pick the pillar, generate three drafts, drop each into an open slot. Done."
}, {
  register: "spicy",
  pillar: "build",
  text: "\"post consistently\" is useless advice. Batch a week in one sitting, queue it, and go live your life. Consistency is a scheduling problem, not a willpower one."
}, {
  register: "reflective",
  pillar: "build",
  text: "The weeks I grew most weren't the weeks I felt most creative. They were the weeks I'd already queued the work and could just show up to reply."
}];
function ComposerScreen() {
  const [text, setText] = useState("I schedule a week of posts in about 20 minutes flat. Here's the exact loop I run every Sunday night.");
  const [when, setWhen] = useState("");
  const [drafts, setDrafts] = useState([]);
  const remaining = TWEET_LIMIT - text.length;
  return /*#__PURE__*/React.createElement(Panel, {
    title: "New post",
    actions: /*#__PURE__*/React.createElement(Button, null, "Thread")
  }, /*#__PURE__*/React.createElement(Field, {
    as: "textarea",
    label: "Text",
    counter: remaining,
    value: text,
    onChange: e => setText(e.target.value),
    rows: 5,
    placeholder: "What are you posting?"
  }), /*#__PURE__*/React.createElement(Field, {
    label: "Scheduled for (local time)",
    hint: when ? "Will save as pending and ship at this minute." : "Empty → saved as draft."
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 8,
      alignItems: "center",
      marginTop: -8
    }
  }, /*#__PURE__*/React.createElement("input", {
    type: "datetime-local",
    value: when,
    onChange: e => setWhen(e.target.value),
    style: {
      flex: 1,
      background: "var(--strat-bg)",
      color: "var(--strat-text)",
      border: "1px solid var(--strat-border)",
      borderRadius: 6,
      padding: "8px 10px",
      fontFamily: "inherit",
      fontSize: 13
    }
  }), /*#__PURE__*/React.createElement(Button, {
    onClick: () => setWhen("2026-07-18T18:20")
  }, "Best time"), /*#__PURE__*/React.createElement(Button, {
    onClick: () => setWhen("2026-07-18T09:14")
  }, "Next slot")), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 11,
      color: "var(--strat-muted)",
      marginTop: -4
    }
  }, "Best Fri: ", /*#__PURE__*/React.createElement("span", null, "18:xx ", /*#__PURE__*/React.createElement("strong", {
    style: {
      color: "var(--strat-text)"
    }
  }, "2.4k"), "/day (n=6)"), " \xB7 ", /*#__PURE__*/React.createElement("span", null, "09:xx ", /*#__PURE__*/React.createElement("strong", {
    style: {
      color: "var(--strat-text)"
    }
  }, "1.9k"), "/day (n=4)")), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 12,
      color: "var(--strat-text)",
      fontVariantNumeric: "tabular-nums"
    }
  }, "\u2248 $0.015 ", /*#__PURE__*/React.createElement("span", {
    style: {
      color: "var(--strat-muted)"
    }
  }, "\xB7 single post, no link")), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 8
    }
  }, /*#__PURE__*/React.createElement(Button, {
    variant: "primary"
  }, "Save"), /*#__PURE__*/React.createElement(Button, null, "Make visual")), /*#__PURE__*/React.createElement("section", {
    style: {
      marginTop: 4,
      paddingTop: 10,
      borderTop: "1px solid var(--strat-border)",
      display: "flex",
      flexDirection: "column",
      gap: 8
    }
  }, /*#__PURE__*/React.createElement("h3", {
    style: {
      margin: 0,
      fontSize: 12,
      textTransform: "uppercase",
      letterSpacing: "0.04em",
      color: "var(--strat-muted)"
    }
  }, "Draft with Grok"), /*#__PURE__*/React.createElement(Field, {
    as: "select",
    label: "Pillar",
    value: "build",
    onChange: () => {},
    options: [{
      value: "build",
      label: "build — build in public"
    }, {
      value: "craft",
      label: "craft — the craft"
    }, {
      value: "",
      label: "any pillar (Grok declares)"
    }]
  }), /*#__PURE__*/React.createElement(Field, {
    as: "textarea",
    label: "Idea (optional, Romanian OK)",
    value: "my sunday scheduling loop",
    onChange: () => {},
    rows: 2
  }), /*#__PURE__*/React.createElement(Button, {
    onClick: () => setDrafts(DRAFTS)
  }, drafts.length ? "Regenerate 3 drafts (~$0.01)" : "Generate 3 drafts (~$0.01)"), drafts.length > 0 ? /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: 8
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 11,
      color: "var(--strat-muted)"
    }
  }, "3 drafts \xB7 2 winners as voice anchors \xB7 $0.0094. Pick one to set a time, or regenerate."), drafts.map((d, i) => /*#__PURE__*/React.createElement("div", {
    key: i,
    style: {
      border: "1px solid var(--strat-border)",
      borderRadius: 8,
      padding: "8px 10px",
      background: "var(--strat-bg-elev)",
      display: "flex",
      flexDirection: "column",
      gap: 6
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 6
    }
  }, /*#__PURE__*/React.createElement(Badge, {
    tone: d.register === "spicy" ? "danger" : d.register === "reflective" ? "ok" : "accent"
  }, d.register), /*#__PURE__*/React.createElement(Badge, {
    tone: "pillar",
    uppercase: false
  }, d.pillar), /*#__PURE__*/React.createElement("span", {
    style: {
      marginLeft: "auto",
      fontSize: 11,
      color: "var(--strat-muted)",
      fontVariantNumeric: "tabular-nums"
    }
  }, d.text.length)), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 13,
      lineHeight: 1.4
    }
  }, d.text), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 6
    }
  }, /*#__PURE__*/React.createElement(Button, {
    variant: "primary",
    size: "sm"
  }, "Use this \u2192"), /*#__PURE__*/React.createElement(Button, {
    size: "sm"
  }, "More like this"))))) : /*#__PURE__*/React.createElement("small", {
    style: {
      fontSize: 11,
      color: "var(--strat-muted)"
    }
  }, "One plain, one spicy, one reflective \u2014 pick one inline to schedule, the rest stay as calendar drafts. Nothing posts until you schedule it.")));
}
window.ComposerScreen = ComposerScreen;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/sidepanel/ComposerScreen.jsx", error: String((e && e.message) || e) }); }

// ui_kits/sidepanel/ReplyScreen.jsx
try { (() => {
// The Replies tab ("Reply Master") — AI-draft a strong reply to the tweet
// you're viewing, then paste it yourself. Faithful to the extension: source
// context, variant chips, reply editor with counter + toolbar, and history.
const {
  Panel,
  Button,
  Badge,
  Field,
  Chip,
  Message
} = window.StratusDesignSystem_4635dc;
const {
  useState
} = React;
const VARIANTS = [{
  angle: "agree + add",
  text: "This matches what I see. The accounts that compound are the ones replying 5–10x more than they post — the timeline rewards showing up in other people's threads, not just your own."
}, {
  angle: "counter",
  text: "Mostly true, but replies only compound if they're in-band. 200 replies to huge accounts who'll never notice you is just noise. Reply to people 2–10x your size."
}, {
  angle: "question",
  text: "How do you decide who's worth replying to? I've been band-gating by reach + velocity so I don't burn the good hours on tweets that already peaked."
}];
const HISTORY = [{
  who: "grifter",
  status: "posted",
  src: "the accounts that grow fastest reply more than they post.",
  reply: "in-band is the whole game — reply to people 2–10x your size."
}, {
  who: "marco_dev",
  status: "copied",
  src: "your pinned tweet is your homepage.",
  reply: "mine was 8 months stale until last week. instant lift in profile→follow."
}];
function ReplyScreen() {
  const [text, setText] = useState(VARIANTS[1].text);
  const [open, setOpen] = useState(false);
  const remaining = 280 - text.length;
  return /*#__PURE__*/React.createElement(Panel, {
    title: "Reply Master",
    actions: /*#__PURE__*/React.createElement(Button, null, "Refresh")
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      background: "var(--strat-bg)",
      border: "1px solid var(--strat-border)",
      borderRadius: 6,
      padding: "10px 12px",
      display: "flex",
      flexDirection: "column",
      gap: 10
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 8,
      alignItems: "center",
      flexWrap: "wrap",
      fontSize: 12
    }
  }, /*#__PURE__*/React.createElement(Badge, {
    tone: "pending"
  }, "copied"), /*#__PURE__*/React.createElement("span", null, "Drafted from ", /*#__PURE__*/React.createElement("button", {
    style: {
      background: "none",
      border: "none",
      padding: 0,
      font: "inherit",
      color: "var(--strat-accent)",
      cursor: "pointer"
    }
  }, /*#__PURE__*/React.createElement("strong", null, "@grifter"))), /*#__PURE__*/React.createElement("span", {
    style: {
      color: "var(--strat-muted)"
    }
  }, "\xB7 2m ago"), /*#__PURE__*/React.createElement(Badge, {
    tone: "pending"
  }, "live")), /*#__PURE__*/React.createElement("details", {
    open: open,
    onToggle: e => setOpen(e.target.open),
    style: {
      background: "var(--strat-bg-elev)",
      border: "1px solid var(--strat-border)",
      borderRadius: 6,
      padding: "6px 10px",
      fontSize: 12
    }
  }, /*#__PURE__*/React.createElement("summary", {
    style: {
      cursor: "pointer",
      color: "var(--strat-muted)",
      listStyle: "none"
    }
  }, "Context: \"the accounts that grow fastest reply more than they post.\""), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: 6,
      paddingTop: 8
    }
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("strong", null, "growth notes"), " ", /*#__PURE__*/React.createElement("span", {
    style: {
      color: "var(--strat-muted)"
    }
  }, "@grifter")), /*#__PURE__*/React.createElement("div", {
    style: {
      color: "var(--strat-muted)",
      fontVariantNumeric: "tabular-nums"
    }
  }, "\u2665 512 \xB7 \u21A9 63 \xB7 \u21BB 88 \xB7 \uD83D\uDC41 41K"))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 6,
      flexWrap: "wrap"
    }
  }, VARIANTS.map((v, i) => /*#__PURE__*/React.createElement(Chip, {
    key: i,
    active: text === v.text,
    onClick: () => setText(v.text)
  }, "V", i + 1, " \xB7 ", v.angle))), /*#__PURE__*/React.createElement(Field, {
    as: "textarea",
    label: "Reply",
    counter: remaining,
    value: text,
    onChange: e => setText(e.target.value),
    rows: 5,
    hint: "grok-4 \xB7 $0.0038 \xB7 edited"
  }), /*#__PURE__*/React.createElement(Message, {
    tone: "ok"
  }, "Copied to clipboard"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 6,
      flexWrap: "wrap"
    }
  }, /*#__PURE__*/React.createElement(Button, {
    variant: "primary"
  }, "Copy"), /*#__PURE__*/React.createElement(Button, null, "Regenerate"), /*#__PURE__*/React.createElement(Button, null, "Mark posted"), /*#__PURE__*/React.createElement(Button, {
    variant: "danger"
  }, "Discard"))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: 8,
      marginTop: 4,
      paddingTop: 12,
      borderTop: "1px solid var(--strat-border)"
    }
  }, /*#__PURE__*/React.createElement("h2", {
    style: {
      margin: 0,
      fontSize: 14,
      fontWeight: 600
    }
  }, "History"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 11,
      color: "var(--strat-muted)"
    }
  }, "12 shown \xB7 3 gen \xB7 4 copied \xB7 4 posted \xB7 1 discarded"), /*#__PURE__*/React.createElement("ul", {
    style: {
      listStyle: "none",
      margin: 0,
      padding: 0,
      display: "flex",
      flexDirection: "column",
      gap: 6
    }
  }, HISTORY.map((h, i) => /*#__PURE__*/React.createElement("li", {
    key: i,
    style: {
      background: "var(--strat-bg)",
      border: "1px solid var(--strat-border)",
      borderRadius: 6,
      padding: "10px 12px",
      display: "flex",
      flexDirection: "column",
      gap: 4
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 6,
      alignItems: "center"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontWeight: 600,
      fontSize: 12
    }
  }, "@", h.who), /*#__PURE__*/React.createElement(Badge, {
    tone: h.status === "posted" ? "posted" : "pending"
  }, h.status)), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 12,
      color: "var(--strat-muted)"
    }
  }, /*#__PURE__*/React.createElement("strong", {
    style: {
      color: "var(--strat-text)"
    }
  }, "Source:"), " ", h.src), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 12
    }
  }, /*#__PURE__*/React.createElement("strong", null, "Reply:"), " ", h.reply))))));
}
window.ReplyScreen = ReplyScreen;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/sidepanel/ReplyScreen.jsx", error: String((e && e.message) || e) }); }

// ui_kits/sidepanel/TodayScreen.jsx
try { (() => {
// The Today tab — the "what do I do next" home screen. Faithful to the real
// extension: quests, follower KPI + sparkline, today's plan, reply quota,
// yesterday's numbers. Composes DS primitives from window.StratusDesignSystem.
const {
  Panel,
  Button,
  Badge,
  KpiCard,
  QuotaBar
} = window.StratusDesignSystem_4635dc;
const FOLLOWERS = [820, 845, 860, 858, 872, 905, 940, 1010, 1080, 1150, 1210, 1284];
const QUESTS = [{
  label: "Post once before noon",
  done: true,
  note: ""
}, {
  label: "Reply to 5 in-band tweets",
  done: false,
  note: "3/5"
}, {
  label: "Log one new person",
  done: true,
  note: ""
}];
const PLAN = [{
  time: "09:14",
  status: "posted",
  text: "the accounts that grow fastest reply more than they post."
}, {
  time: "13:40",
  status: "pending",
  text: "thread: how I schedule a week of posts in 20 minutes",
  media: true
}, {
  time: "18:20",
  status: "draft",
  text: "unpopular opinion: your pinned tweet is your homepage"
}];
const YESTERDAY = [{
  text: "shipped the reply drafter — three registers, you pick one.",
  views: "9.4K",
  likes: "184",
  replies: "27",
  visits: "312"
}, {
  text: "nothing posts on its own. stratus drafts, you post.",
  views: "4.1K",
  likes: "88",
  replies: "9",
  visits: "140"
}];
function Section({
  title,
  extra,
  children
}) {
  return /*#__PURE__*/React.createElement("section", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: 6
    }
  }, /*#__PURE__*/React.createElement("h3", {
    style: {
      margin: 0,
      fontSize: 11,
      fontWeight: 600,
      textTransform: "uppercase",
      letterSpacing: "0.04em",
      color: "var(--strat-muted)"
    }
  }, title, extra), children);
}
function TodayScreen() {
  return /*#__PURE__*/React.createElement(Panel, {
    title: "Today",
    actions: /*#__PURE__*/React.createElement(Button, null, "Refresh")
  }, /*#__PURE__*/React.createElement(Section, {
    title: "Today's quests",
    extra: /*#__PURE__*/React.createElement("span", {
      style: {
        fontWeight: 400,
        color: "var(--strat-accent)",
        fontSize: 11
      }
    }, " \xB7 6-day streak")
  }, /*#__PURE__*/React.createElement("ul", {
    style: {
      listStyle: "none",
      margin: 0,
      padding: 0,
      display: "flex",
      flexDirection: "column",
      gap: 3
    }
  }, QUESTS.map(q => /*#__PURE__*/React.createElement("li", {
    key: q.label,
    style: {
      display: "flex",
      alignItems: "baseline",
      gap: 8,
      fontSize: 12
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: 14,
      textAlign: "center",
      color: q.done ? "var(--strat-ok)" : "var(--strat-muted)"
    }
  }, q.done ? "✓" : "○"), /*#__PURE__*/React.createElement("span", {
    style: {
      color: q.done ? "var(--strat-muted)" : "var(--strat-text)"
    }
  }, q.label), /*#__PURE__*/React.createElement("span", {
    style: {
      marginLeft: "auto",
      fontSize: 11,
      color: "var(--strat-muted)"
    }
  }, q.note))))), /*#__PURE__*/React.createElement(KpiCard, {
    value: "1,284",
    label: "followers",
    delta: 37,
    deltaSuffix: " / 7d",
    spark: FOLLOWERS
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 11,
      color: "var(--strat-muted)",
      fontVariantNumeric: "tabular-nums",
      marginTop: -4
    }
  }, "1.8K profile visits \u2192 ", /*#__PURE__*/React.createElement("span", {
    style: {
      color: "var(--strat-ok)",
      fontWeight: 600
    }
  }, "+37 followers"), " \xB7 2.1% ", /*#__PURE__*/React.createElement("span", {
    style: {
      opacity: 0.7
    }
  }, "7d")), /*#__PURE__*/React.createElement(Section, {
    title: "Today's plan"
  }, /*#__PURE__*/React.createElement("ul", {
    style: {
      listStyle: "none",
      margin: 0,
      padding: 0,
      border: "1px solid var(--strat-border)",
      borderRadius: 6,
      background: "var(--strat-bg)"
    }
  }, PLAN.map((p, i) => /*#__PURE__*/React.createElement("li", {
    key: p.time,
    style: {
      display: "flex",
      alignItems: "center",
      gap: 8,
      padding: "8px 10px",
      borderBottom: i < PLAN.length - 1 ? "1px solid var(--strat-border)" : "none",
      fontSize: 12
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      color: "var(--strat-muted)",
      fontVariantNumeric: "tabular-nums",
      minWidth: 44,
      fontSize: 11
    }
  }, p.time), /*#__PURE__*/React.createElement(Badge, {
    tone: p.status
  }, p.status), p.media && /*#__PURE__*/React.createElement(Badge, {
    tone: "media"
  }, "visual"), /*#__PURE__*/React.createElement("span", {
    style: {
      whiteSpace: "nowrap",
      overflow: "hidden",
      textOverflow: "ellipsis",
      flex: 1,
      minWidth: 0
    }
  }, p.text))))), /*#__PURE__*/React.createElement(Section, {
    title: "Replies"
  }, /*#__PURE__*/React.createElement(QuotaBar, {
    value: 3,
    max: 5,
    label: "3 / 5\u201310 today"
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 11,
      color: "var(--strat-muted)"
    }
  }, "Week: ", /*#__PURE__*/React.createElement("strong", {
    style: {
      color: "var(--strat-text)"
    }
  }, "34"), " replies \xB7 ", /*#__PURE__*/React.createElement("strong", {
    style: {
      color: "var(--strat-text)"
    }
  }, "9"), " posts \u2014 79% replies (target 70%)")), /*#__PURE__*/React.createElement(Section, {
    title: "Yesterday"
  }, /*#__PURE__*/React.createElement("ul", {
    style: {
      listStyle: "none",
      margin: 0,
      padding: 0,
      display: "flex",
      flexDirection: "column",
      gap: 6
    }
  }, YESTERDAY.map(t => /*#__PURE__*/React.createElement("li", {
    key: t.text,
    style: {
      background: "var(--strat-bg)",
      border: "1px solid var(--strat-border)",
      borderRadius: 6,
      padding: "8px 10px",
      display: "flex",
      flexDirection: "column",
      gap: 4
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 12
    }
  }, t.text), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 10,
      flexWrap: "wrap",
      fontSize: 11,
      color: "var(--strat-muted)",
      fontVariantNumeric: "tabular-nums"
    }
  }, /*#__PURE__*/React.createElement("span", null, t.views, " views"), /*#__PURE__*/React.createElement("span", null, t.likes, " likes"), /*#__PURE__*/React.createElement("span", null, t.replies, " replies"), /*#__PURE__*/React.createElement("span", null, t.visits, " profile visits")))))), /*#__PURE__*/React.createElement(Section, {
    title: "Spend today (UTC)"
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 12,
      color: "var(--strat-muted)",
      fontVariantNumeric: "tabular-nums"
    }
  }, "X ", /*#__PURE__*/React.createElement("strong", {
    style: {
      color: "var(--strat-text)"
    }
  }, "$0.0180"), " \xB7 Grok ", /*#__PURE__*/React.createElement("strong", {
    style: {
      color: "var(--strat-text)"
    }
  }, "$0.0142"), " \xB7 total ", /*#__PURE__*/React.createElement("strong", {
    style: {
      color: "var(--strat-text)"
    }
  }, "$0.0322"))));
}
window.TodayScreen = TodayScreen;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/sidepanel/TodayScreen.jsx", error: String((e && e.message) || e) }); }

// ui_kits/sidepanel/XTimeline.jsx
try { (() => {
// A lightweight, dimmed recreation of the x.com home column — the backdrop the
// stratus side panel docks against. NOT the product; it exists only to show the
// panel "feels at home" next to the live X timeline. Rendered in X's dark theme.
// Icons: Lucide (CDN) stand in for X's proprietary glyphs — flagged in the kit README.
const {
  useState
} = React;
function XIcon({
  name,
  size = 22,
  filled
}) {
  return /*#__PURE__*/React.createElement("i", {
    "data-lucide": name,
    style: {
      width: size,
      height: size,
      display: "inline-block",
      color: filled ? "var(--x-blue)" : "currentColor"
    }
  });
}
const NAV = [["home", "Home"], ["search", "Explore"], ["bell", "Notifications"], ["mail", "Messages"], ["bookmark", "Bookmarks"], ["users", "Communities"], ["user", "Profile"], ["circle-ellipsis", "More"]];
const POSTS = [{
  name: "elena builds",
  handle: "elenabuilds",
  time: "2h",
  verified: true,
  text: "shipped the reply drafter today. three registers — plain, spicy, reflective. you pick one and schedule it. nothing posts on its own.",
  likes: "184",
  replies: "27",
  reposts: "12",
  views: "9.4K"
}, {
  name: "growth notes",
  handle: "grifter",
  time: "5h",
  verified: false,
  text: "the accounts that grow fastest reply more than they post. it's not close.",
  likes: "512",
  replies: "63",
  reposts: "88",
  views: "41K"
}, {
  name: "Marco",
  handle: "marco_dev",
  time: "7h",
  verified: true,
  text: "unpopular opinion: your pinned tweet is your homepage. most people's is 8 months stale.",
  likes: "97",
  replies: "14",
  reposts: "5",
  views: "3.1K"
}];
function XTimeline() {
  const [tab, setTab] = useState("For you");
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      height: "100%",
      background: "#000",
      color: "#e7e9ea",
      fontFamily: "var(--strat-font-sans)",
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement("nav", {
    style: {
      width: 68,
      flexShrink: 0,
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      gap: 4,
      padding: "8px 0",
      borderRight: "1px solid var(--x-border)"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      width: 40,
      height: 40,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      marginBottom: 6
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 26,
      fontWeight: 800
    }
  }, "\uD835\uDD4F")), NAV.map(([icon, label], i) => /*#__PURE__*/React.createElement("div", {
    key: label,
    title: label,
    style: {
      width: 44,
      height: 44,
      borderRadius: 999,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      color: i === 0 ? "#e7e9ea" : "#e7e9ea"
    }
  }, /*#__PURE__*/React.createElement(XIcon, {
    name: icon,
    filled: i === 0
  }))), /*#__PURE__*/React.createElement("div", {
    style: {
      width: 44,
      height: 44,
      borderRadius: 999,
      background: "var(--x-blue)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      marginTop: 6,
      color: "#fff"
    }
  }, /*#__PURE__*/React.createElement(XIcon, {
    name: "feather"
  }))), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      minWidth: 0,
      borderRight: "1px solid var(--x-border)",
      overflowY: "auto"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      position: "sticky",
      top: 0,
      background: "rgba(0,0,0,0.65)",
      backdropFilter: "blur(12px)",
      borderBottom: "1px solid var(--x-border)",
      zIndex: 2
    }
  }, ["For you", "Following"].map(t => /*#__PURE__*/React.createElement("button", {
    key: t,
    onClick: () => setTab(t),
    style: {
      flex: 1,
      background: "transparent",
      border: "none",
      color: tab === t ? "#e7e9ea" : "var(--x-muted)",
      fontFamily: "inherit",
      fontSize: 15,
      fontWeight: tab === t ? 700 : 500,
      padding: "16px 0",
      cursor: "pointer",
      position: "relative"
    }
  }, t, tab === t && /*#__PURE__*/React.createElement("span", {
    style: {
      position: "absolute",
      bottom: 0,
      left: "50%",
      transform: "translateX(-50%)",
      width: 56,
      height: 4,
      borderRadius: 999,
      background: "var(--x-blue)"
    }
  })))), POSTS.map(p => /*#__PURE__*/React.createElement("article", {
    key: p.handle,
    style: {
      display: "flex",
      gap: 12,
      padding: "12px 16px",
      borderBottom: "1px solid var(--x-border)"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      width: 40,
      height: 40,
      borderRadius: 999,
      background: "linear-gradient(135deg,#334155,#1e293b)",
      flexShrink: 0
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      minWidth: 0,
      flex: 1
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 4,
      fontSize: 15
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontWeight: 700
    }
  }, p.name), p.verified && /*#__PURE__*/React.createElement(XIcon, {
    name: "badge-check",
    size: 16,
    filled: true
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      color: "var(--x-muted)"
    }
  }, "@", p.handle, " \xB7 ", p.time)), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 15,
      lineHeight: 1.4,
      marginTop: 2,
      whiteSpace: "pre-wrap"
    }
  }, p.text), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      justifyContent: "space-between",
      maxWidth: 340,
      marginTop: 10,
      color: "var(--x-muted)",
      fontSize: 13
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 6
    }
  }, /*#__PURE__*/React.createElement(XIcon, {
    name: "message-circle",
    size: 17
  }), p.replies), /*#__PURE__*/React.createElement("span", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 6
    }
  }, /*#__PURE__*/React.createElement(XIcon, {
    name: "repeat-2",
    size: 17
  }), p.reposts), /*#__PURE__*/React.createElement("span", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 6
    }
  }, /*#__PURE__*/React.createElement(XIcon, {
    name: "heart",
    size: 17
  }), p.likes), /*#__PURE__*/React.createElement("span", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 6
    }
  }, /*#__PURE__*/React.createElement(XIcon, {
    name: "bar-chart-3",
    size: 17
  }), p.views), /*#__PURE__*/React.createElement("span", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 6
    }
  }, /*#__PURE__*/React.createElement(XIcon, {
    name: "bookmark",
    size: 17
  }))))))));
}
window.XTimeline = XTimeline;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/sidepanel/XTimeline.jsx", error: String((e && e.message) || e) }); }

__ds_ns.Badge = __ds_scope.Badge;

__ds_ns.Button = __ds_scope.Button;

__ds_ns.Chip = __ds_scope.Chip;

__ds_ns.KpiCard = __ds_scope.KpiCard;

__ds_ns.QuotaBar = __ds_scope.QuotaBar;

__ds_ns.Sparkline = __ds_scope.Sparkline;

__ds_ns.Message = __ds_scope.Message;

__ds_ns.Field = __ds_scope.Field;

__ds_ns.Modal = __ds_scope.Modal;

__ds_ns.Panel = __ds_scope.Panel;

__ds_ns.TabRail = __ds_scope.TabRail;

})();
