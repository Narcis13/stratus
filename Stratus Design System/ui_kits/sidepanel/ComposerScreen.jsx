// The Composer tab — write / AI-draft / schedule. Faithful to the extension:
// text field with live counter, schedule row with Best time / Next slot,
// best-times hint, cost preview, and the Grok drafter with three register cards.
const { Panel, Button, Badge, Field, Message } = window.StratusDesignSystem_4635dc;
const { useState } = React;

const TWEET_LIMIT = 280;
const DRAFTS = [
  { register: "plain", pillar: "build", text: "I schedule a week of posts in about 20 minutes. Pick the pillar, generate three drafts, drop each into an open slot. Done." },
  { register: "spicy", pillar: "build", text: "\"post consistently\" is useless advice. Batch a week in one sitting, queue it, and go live your life. Consistency is a scheduling problem, not a willpower one." },
  { register: "reflective", pillar: "build", text: "The weeks I grew most weren't the weeks I felt most creative. They were the weeks I'd already queued the work and could just show up to reply." },
];

function ComposerScreen() {
  const [text, setText] = useState("I schedule a week of posts in about 20 minutes flat. Here's the exact loop I run every Sunday night.");
  const [when, setWhen] = useState("");
  const [drafts, setDrafts] = useState([]);
  const remaining = TWEET_LIMIT - text.length;

  return (
    <Panel title="New post" actions={<Button>Thread</Button>}>
      <Field as="textarea" label="Text" counter={remaining} value={text} onChange={(e) => setText(e.target.value)} rows={5} placeholder="What are you posting?" />

      <Field label="Scheduled for (local time)" hint={when ? "Will save as pending and ship at this minute." : "Empty → saved as draft."}>
      </Field>
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: -8 }}>
        <input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} style={{ flex: 1, background: "var(--strat-bg)", color: "var(--strat-text)", border: "1px solid var(--strat-border)", borderRadius: 6, padding: "8px 10px", fontFamily: "inherit", fontSize: 13 }} />
        <Button onClick={() => setWhen("2026-07-18T18:20")}>Best time</Button>
        <Button onClick={() => setWhen("2026-07-18T09:14")}>Next slot</Button>
      </div>
      <div style={{ fontSize: 11, color: "var(--strat-muted)", marginTop: -4 }}>
        Best Fri: <span>18:xx <strong style={{ color: "var(--strat-text)" }}>2.4k</strong>/day (n=6)</span> · <span>09:xx <strong style={{ color: "var(--strat-text)" }}>1.9k</strong>/day (n=4)</span>
      </div>

      <div style={{ fontSize: 12, color: "var(--strat-text)", fontVariantNumeric: "tabular-nums" }}>≈ $0.015 <span style={{ color: "var(--strat-muted)" }}>· single post, no link</span></div>

      <div style={{ display: "flex", gap: 8 }}>
        <Button variant="primary">Save</Button>
        <Button>Make visual</Button>
      </div>

      <section style={{ marginTop: 4, paddingTop: 10, borderTop: "1px solid var(--strat-border)", display: "flex", flexDirection: "column", gap: 8 }}>
        <h3 style={{ margin: 0, fontSize: 12, textTransform: "uppercase", letterSpacing: "0.04em", color: "var(--strat-muted)" }}>Draft with Grok</h3>
        <Field as="select" label="Pillar" value="build" onChange={() => {}} options={[{ value: "build", label: "build — build in public" }, { value: "craft", label: "craft — the craft" }, { value: "", label: "any pillar (Grok declares)" }]} />
        <Field as="textarea" label="Idea (optional, Romanian OK)" value="my sunday scheduling loop" onChange={() => {}} rows={2} />
        <Button onClick={() => setDrafts(DRAFTS)}>{drafts.length ? "Regenerate 3 drafts (~$0.01)" : "Generate 3 drafts (~$0.01)"}</Button>

        {drafts.length > 0 ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ fontSize: 11, color: "var(--strat-muted)" }}>3 drafts · 2 winners as voice anchors · $0.0094. Pick one to set a time, or regenerate.</div>
            {drafts.map((d, i) => (
              <div key={i} style={{ border: "1px solid var(--strat-border)", borderRadius: 8, padding: "8px 10px", background: "var(--strat-bg-elev)", display: "flex", flexDirection: "column", gap: 6 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <Badge tone={d.register === "spicy" ? "danger" : d.register === "reflective" ? "ok" : "accent"}>{d.register}</Badge>
                  <Badge tone="pillar" uppercase={false}>{d.pillar}</Badge>
                  <span style={{ marginLeft: "auto", fontSize: 11, color: "var(--strat-muted)", fontVariantNumeric: "tabular-nums" }}>{d.text.length}</span>
                </div>
                <div style={{ fontSize: 13, lineHeight: 1.4 }}>{d.text}</div>
                <div style={{ display: "flex", gap: 6 }}>
                  <Button variant="primary" size="sm">Use this →</Button>
                  <Button size="sm">More like this</Button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <small style={{ fontSize: 11, color: "var(--strat-muted)" }}>One plain, one spicy, one reflective — pick one inline to schedule, the rest stay as calendar drafts. Nothing posts until you schedule it.</small>
        )}
      </section>
    </Panel>
  );
}

window.ComposerScreen = ComposerScreen;
