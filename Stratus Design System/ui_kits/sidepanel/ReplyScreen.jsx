// The Replies tab ("Reply Master") — AI-draft a strong reply to the tweet
// you're viewing, then paste it yourself. Faithful to the extension: source
// context, variant chips, reply editor with counter + toolbar, and history.
const { Panel, Button, Badge, Field, Chip, Message } = window.StratusDesignSystem_4635dc;
const { useState } = React;

const VARIANTS = [
  { angle: "agree + add", text: "This matches what I see. The accounts that compound are the ones replying 5–10x more than they post — the timeline rewards showing up in other people's threads, not just your own." },
  { angle: "counter", text: "Mostly true, but replies only compound if they're in-band. 200 replies to huge accounts who'll never notice you is just noise. Reply to people 2–10x your size." },
  { angle: "question", text: "How do you decide who's worth replying to? I've been band-gating by reach + velocity so I don't burn the good hours on tweets that already peaked." },
];
const HISTORY = [
  { who: "grifter", status: "posted", src: "the accounts that grow fastest reply more than they post.", reply: "in-band is the whole game — reply to people 2–10x your size." },
  { who: "marco_dev", status: "copied", src: "your pinned tweet is your homepage.", reply: "mine was 8 months stale until last week. instant lift in profile→follow." },
];

function ReplyScreen() {
  const [text, setText] = useState(VARIANTS[1].text);
  const [open, setOpen] = useState(false);
  const remaining = 280 - text.length;

  return (
    <Panel title="Reply Master" actions={<Button>Refresh</Button>}>
      <div style={{ background: "var(--strat-bg)", border: "1px solid var(--strat-border)", borderRadius: 6, padding: "10px 12px", display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", fontSize: 12 }}>
          <Badge tone="pending">copied</Badge>
          <span>Drafted from <button style={{ background: "none", border: "none", padding: 0, font: "inherit", color: "var(--strat-accent)", cursor: "pointer" }}><strong>@grifter</strong></button></span>
          <span style={{ color: "var(--strat-muted)" }}>· 2m ago</span>
          <Badge tone="pending">live</Badge>
        </div>

        <details open={open} onToggle={(e) => setOpen(e.target.open)} style={{ background: "var(--strat-bg-elev)", border: "1px solid var(--strat-border)", borderRadius: 6, padding: "6px 10px", fontSize: 12 }}>
          <summary style={{ cursor: "pointer", color: "var(--strat-muted)", listStyle: "none" }}>Context: "the accounts that grow fastest reply more than they post."</summary>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, paddingTop: 8 }}>
            <div><strong>growth notes</strong> <span style={{ color: "var(--strat-muted)" }}>@grifter</span></div>
            <div style={{ color: "var(--strat-muted)", fontVariantNumeric: "tabular-nums" }}>♥ 512 · ↩ 63 · ↻ 88 · 👁 41K</div>
          </div>
        </details>

        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {VARIANTS.map((v, i) => (
            <Chip key={i} active={text === v.text} onClick={() => setText(v.text)}>V{i + 1} · {v.angle}</Chip>
          ))}
        </div>

        <Field as="textarea" label="Reply" counter={remaining} value={text} onChange={(e) => setText(e.target.value)} rows={5} hint="grok-4 · $0.0038 · edited" />

        <Message tone="ok">Copied to clipboard</Message>

        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <Button variant="primary">Copy</Button>
          <Button>Regenerate</Button>
          <Button>Mark posted</Button>
          <Button variant="danger">Discard</Button>
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 4, paddingTop: 12, borderTop: "1px solid var(--strat-border)" }}>
        <h2 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>History</h2>
        <div style={{ fontSize: 11, color: "var(--strat-muted)" }}>12 shown · 3 gen · 4 copied · 4 posted · 1 discarded</div>
        <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 6 }}>
          {HISTORY.map((h, i) => (
            <li key={i} style={{ background: "var(--strat-bg)", border: "1px solid var(--strat-border)", borderRadius: 6, padding: "10px 12px", display: "flex", flexDirection: "column", gap: 4 }}>
              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <span style={{ fontWeight: 600, fontSize: 12 }}>@{h.who}</span>
                <Badge tone={h.status === "posted" ? "posted" : "pending"}>{h.status}</Badge>
              </div>
              <div style={{ fontSize: 12, color: "var(--strat-muted)" }}><strong style={{ color: "var(--strat-text)" }}>Source:</strong> {h.src}</div>
              <div style={{ fontSize: 12 }}><strong>Reply:</strong> {h.reply}</div>
            </li>
          ))}
        </ul>
      </div>
    </Panel>
  );
}

window.ReplyScreen = ReplyScreen;
