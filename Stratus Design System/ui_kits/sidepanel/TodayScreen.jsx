// The Today tab — the "what do I do next" home screen. Faithful to the real
// extension: quests, follower KPI + sparkline, today's plan, reply quota,
// yesterday's numbers. Composes DS primitives from window.StratusDesignSystem.
const { Panel, Button, Badge, KpiCard, QuotaBar } = window.StratusDesignSystem_4635dc;

const FOLLOWERS = [820, 845, 860, 858, 872, 905, 940, 1010, 1080, 1150, 1210, 1284];
const QUESTS = [
  { label: "Post once before noon", done: true, note: "" },
  { label: "Reply to 5 in-band tweets", done: false, note: "3/5" },
  { label: "Log one new person", done: true, note: "" },
];
const PLAN = [
  { time: "09:14", status: "posted", text: "the accounts that grow fastest reply more than they post." },
  { time: "13:40", status: "pending", text: "thread: how I schedule a week of posts in 20 minutes", media: true },
  { time: "18:20", status: "draft", text: "unpopular opinion: your pinned tweet is your homepage" },
];
const YESTERDAY = [
  { text: "shipped the reply drafter — three registers, you pick one.", views: "9.4K", likes: "184", replies: "27", visits: "312" },
  { text: "nothing posts on its own. stratus drafts, you post.", views: "4.1K", likes: "88", replies: "9", visits: "140" },
];

function Section({ title, extra, children }) {
  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <h3 style={{ margin: 0, fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em", color: "var(--strat-muted)" }}>
        {title}{extra}
      </h3>
      {children}
    </section>
  );
}

function TodayScreen() {
  return (
    <Panel title="Today" actions={<Button>Refresh</Button>}>
      <Section title="Today's quests" extra={<span style={{ fontWeight: 400, color: "var(--strat-accent)", fontSize: 11 }}> · 6-day streak</span>}>
        <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 3 }}>
          {QUESTS.map((q) => (
            <li key={q.label} style={{ display: "flex", alignItems: "baseline", gap: 8, fontSize: 12 }}>
              <span style={{ width: 14, textAlign: "center", color: q.done ? "var(--strat-ok)" : "var(--strat-muted)" }}>{q.done ? "✓" : "○"}</span>
              <span style={{ color: q.done ? "var(--strat-muted)" : "var(--strat-text)" }}>{q.label}</span>
              <span style={{ marginLeft: "auto", fontSize: 11, color: "var(--strat-muted)" }}>{q.note}</span>
            </li>
          ))}
        </ul>
      </Section>

      <KpiCard value="1,284" label="followers" delta={37} deltaSuffix=" / 7d" spark={FOLLOWERS} />
      <div style={{ fontSize: 11, color: "var(--strat-muted)", fontVariantNumeric: "tabular-nums", marginTop: -4 }}>
        1.8K profile visits → <span style={{ color: "var(--strat-ok)", fontWeight: 600 }}>+37 followers</span> · 2.1% <span style={{ opacity: 0.7 }}>7d</span>
      </div>

      <Section title="Today's plan">
        <ul style={{ listStyle: "none", margin: 0, padding: 0, border: "1px solid var(--strat-border)", borderRadius: 6, background: "var(--strat-bg)" }}>
          {PLAN.map((p, i) => (
            <li key={p.time} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", borderBottom: i < PLAN.length - 1 ? "1px solid var(--strat-border)" : "none", fontSize: 12 }}>
              <span style={{ color: "var(--strat-muted)", fontVariantNumeric: "tabular-nums", minWidth: 44, fontSize: 11 }}>{p.time}</span>
              <Badge tone={p.status}>{p.status}</Badge>
              {p.media && <Badge tone="media">visual</Badge>}
              <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", flex: 1, minWidth: 0 }}>{p.text}</span>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Replies">
        <QuotaBar value={3} max={5} label="3 / 5–10 today" />
        <div style={{ fontSize: 11, color: "var(--strat-muted)" }}>Week: <strong style={{ color: "var(--strat-text)" }}>34</strong> replies · <strong style={{ color: "var(--strat-text)" }}>9</strong> posts — 79% replies (target 70%)</div>
      </Section>

      <Section title="Yesterday">
        <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 6 }}>
          {YESTERDAY.map((t) => (
            <li key={t.text} style={{ background: "var(--strat-bg)", border: "1px solid var(--strat-border)", borderRadius: 6, padding: "8px 10px", display: "flex", flexDirection: "column", gap: 4 }}>
              <div style={{ fontSize: 12 }}>{t.text}</div>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", fontSize: 11, color: "var(--strat-muted)", fontVariantNumeric: "tabular-nums" }}>
                <span>{t.views} views</span><span>{t.likes} likes</span><span>{t.replies} replies</span><span>{t.visits} profile visits</span>
              </div>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Spend today (UTC)">
        <div style={{ fontSize: 12, color: "var(--strat-muted)", fontVariantNumeric: "tabular-nums" }}>
          X <strong style={{ color: "var(--strat-text)" }}>$0.0180</strong> · Grok <strong style={{ color: "var(--strat-text)" }}>$0.0142</strong> · total <strong style={{ color: "var(--strat-text)" }}>$0.0322</strong>
        </div>
      </Section>
    </Panel>
  );
}

window.TodayScreen = TodayScreen;
