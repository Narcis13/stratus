// A lightweight, dimmed recreation of the x.com home column — the backdrop the
// stratus side panel docks against. NOT the product; it exists only to show the
// panel "feels at home" next to the live X timeline. Rendered in X's dark theme.
// Icons: Lucide (CDN) stand in for X's proprietary glyphs — flagged in the kit README.
const { useState } = React;

function XIcon({ name, size = 22, filled }) {
  return (
    <i
      data-lucide={name}
      style={{ width: size, height: size, display: "inline-block", color: filled ? "var(--x-blue)" : "currentColor" }}
    />
  );
}

const NAV = [
  ["home", "Home"], ["search", "Explore"], ["bell", "Notifications"],
  ["mail", "Messages"], ["bookmark", "Bookmarks"], ["users", "Communities"],
  ["user", "Profile"], ["circle-ellipsis", "More"],
];

const POSTS = [
  { name: "elena builds", handle: "elenabuilds", time: "2h", verified: true,
    text: "shipped the reply drafter today. three registers — plain, spicy, reflective. you pick one and schedule it. nothing posts on its own.",
    likes: "184", replies: "27", reposts: "12", views: "9.4K" },
  { name: "growth notes", handle: "grifter", time: "5h", verified: false,
    text: "the accounts that grow fastest reply more than they post. it's not close.",
    likes: "512", replies: "63", reposts: "88", views: "41K" },
  { name: "Marco", handle: "marco_dev", time: "7h", verified: true,
    text: "unpopular opinion: your pinned tweet is your homepage. most people's is 8 months stale.",
    likes: "97", replies: "14", reposts: "5", views: "3.1K" },
];

function XTimeline() {
  const [tab, setTab] = useState("For you");
  return (
    <div style={{ display: "flex", height: "100%", background: "#000", color: "#e7e9ea", fontFamily: "var(--strat-font-sans)", minWidth: 0 }}>
      {/* left nav */}
      <nav style={{ width: 68, flexShrink: 0, display: "flex", flexDirection: "column", alignItems: "center", gap: 4, padding: "8px 0", borderRight: "1px solid var(--x-border)" }}>
        <div style={{ width: 40, height: 40, display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 6 }}>
          <span style={{ fontSize: 26, fontWeight: 800 }}>𝕏</span>
        </div>
        {NAV.map(([icon, label], i) => (
          <div key={label} title={label} style={{ width: 44, height: 44, borderRadius: 999, display: "flex", alignItems: "center", justifyContent: "center", color: i === 0 ? "#e7e9ea" : "#e7e9ea" }}>
            <XIcon name={icon} filled={i === 0} />
          </div>
        ))}
        <div style={{ width: 44, height: 44, borderRadius: 999, background: "var(--x-blue)", display: "flex", alignItems: "center", justifyContent: "center", marginTop: 6, color: "#fff" }}>
          <XIcon name="feather" />
        </div>
      </nav>

      {/* timeline column */}
      <div style={{ flex: 1, minWidth: 0, borderRight: "1px solid var(--x-border)", overflowY: "auto" }}>
        <div style={{ display: "flex", position: "sticky", top: 0, background: "rgba(0,0,0,0.65)", backdropFilter: "blur(12px)", borderBottom: "1px solid var(--x-border)", zIndex: 2 }}>
          {["For you", "Following"].map((t) => (
            <button key={t} onClick={() => setTab(t)} style={{ flex: 1, background: "transparent", border: "none", color: tab === t ? "#e7e9ea" : "var(--x-muted)", fontFamily: "inherit", fontSize: 15, fontWeight: tab === t ? 700 : 500, padding: "16px 0", cursor: "pointer", position: "relative" }}>
              {t}
              {tab === t && <span style={{ position: "absolute", bottom: 0, left: "50%", transform: "translateX(-50%)", width: 56, height: 4, borderRadius: 999, background: "var(--x-blue)" }} />}
            </button>
          ))}
        </div>
        {POSTS.map((p) => (
          <article key={p.handle} style={{ display: "flex", gap: 12, padding: "12px 16px", borderBottom: "1px solid var(--x-border)" }}>
            <div style={{ width: 40, height: 40, borderRadius: 999, background: "linear-gradient(135deg,#334155,#1e293b)", flexShrink: 0 }} />
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 15 }}>
                <span style={{ fontWeight: 700 }}>{p.name}</span>
                {p.verified && <XIcon name="badge-check" size={16} filled />}
                <span style={{ color: "var(--x-muted)" }}>@{p.handle} · {p.time}</span>
              </div>
              <div style={{ fontSize: 15, lineHeight: 1.4, marginTop: 2, whiteSpace: "pre-wrap" }}>{p.text}</div>
              <div style={{ display: "flex", justifyContent: "space-between", maxWidth: 340, marginTop: 10, color: "var(--x-muted)", fontSize: 13 }}>
                <span style={{ display: "flex", alignItems: "center", gap: 6 }}><XIcon name="message-circle" size={17} />{p.replies}</span>
                <span style={{ display: "flex", alignItems: "center", gap: 6 }}><XIcon name="repeat-2" size={17} />{p.reposts}</span>
                <span style={{ display: "flex", alignItems: "center", gap: 6 }}><XIcon name="heart" size={17} />{p.likes}</span>
                <span style={{ display: "flex", alignItems: "center", gap: 6 }}><XIcon name="bar-chart-3" size={17} />{p.views}</span>
                <span style={{ display: "flex", alignItems: "center", gap: 6 }}><XIcon name="bookmark" size={17} /></span>
              </div>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}

window.XTimeline = XTimeline;
