import React from "react";

/**
 * Field — labeled form control wrapper matching the extension's `.field`.
 * A muted label row (with optional right-aligned counter), then a dark input,
 * textarea, or select that highlights its border to accent on focus. Pass the
 * control type via `as`.
 */
export function Field({
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
    resize: as === "textarea" ? "vertical" : undefined,
  };

  return (
    <label style={{ display: "flex", flexDirection: "column", gap: "4px", fontSize: "12px", color: "var(--strat-muted)", ...style }}>
      {(label || counter) && (
        <span style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span>{label}</span>
          {counter != null && (
            <span style={{ fontVariantNumeric: "tabular-nums", fontSize: "11px", color: counter < 0 ? "var(--strat-danger)" : "var(--strat-muted)", fontWeight: counter < 0 ? 600 : 400 }}>
              {counter}
            </span>
          )}
        </span>
      )}
      {as === "textarea" ? (
        <textarea value={value} onChange={onChange} placeholder={placeholder} rows={rows} disabled={disabled} onFocus={() => setFocus(true)} onBlur={() => setFocus(false)} style={controlStyle} {...rest} />
      ) : as === "select" ? (
        <select value={value} onChange={onChange} disabled={disabled} onFocus={() => setFocus(true)} onBlur={() => setFocus(false)} style={controlStyle} {...rest}>
          {options.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
          {children}
        </select>
      ) : (
        <input value={value} onChange={onChange} placeholder={placeholder} disabled={disabled} onFocus={() => setFocus(true)} onBlur={() => setFocus(false)} style={controlStyle} {...rest} />
      )}
      {hint && <small style={{ fontSize: "11px", color: "var(--strat-muted)" }}>{hint}</small>}
    </label>
  );
}
