One-line: A labeled form control (input, textarea, or select) with the extension's focus-accent border and optional char counter.

```jsx
<Field label="Text" counter={280 - text.length} as="textarea" value={text} onChange={e => setText(e.target.value)} placeholder="What are you posting?" />
<Field label="Pillar" as="select" options={[{value:"", label:"any pillar"}]} />
<Field label="API URL" hint="Set this first." value={url} onChange={...} />
```

`as` chooses the control. `counter` renders a right-aligned tabular number that turns red + bold when negative (over the 280-char tweet limit). `hint` is muted helper text underneath. The control fill is `--strat-bg` (darker than the surrounding panel).
