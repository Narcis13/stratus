import React from "react";

/**
 * Modal — centered dialog over a dark scrim. Header with title + close button,
 * then a scrollable body. Matches the extension's .modal-backdrop / .modal-card.
 */
export function Modal({ title, onClose, style, children, ...rest }) {
  return (
    <div
      onClick={onClose}
      role="presentation"
      style={{
        position: "fixed",
        inset: 0,
        background: "var(--strat-scrim)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "16px",
        zIndex: 100,
        fontFamily: "var(--strat-font-sans)",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        style={{
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
          ...style,
        }}
        {...rest}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <h3 style={{ margin: 0, fontSize: "14px", fontWeight: 600 }}>{title}</h3>
          <button
            type="button"
            onClick={onClose}
            style={{ background: "var(--strat-bg-hover)", color: "var(--strat-text)", border: "1px solid var(--strat-border)", borderRadius: "6px", padding: "2px 8px", fontSize: "12px", cursor: "pointer", lineHeight: 1.4 }}
          >
            ✕
          </button>
        </div>
        <div style={{ overflow: "auto" }}>{children}</div>
      </div>
    </div>
  );
}
