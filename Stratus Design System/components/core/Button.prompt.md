One-line: The flat, hairline-bordered action button used across every Stratus panel — default, primary, and danger intents.

```jsx
<Button variant="primary" onClick={save}>Save</Button>
<Button>Refresh</Button>
<Button variant="danger" size="sm">Discard</Button>
```

Variants: `default` (neutral fill), `primary` (brand blue, white text), `danger` (red outline → red fill on hover). Sizes: `md` (default, panel actions) and `sm` (inline row actions, chips). Disabled drops opacity to 0.5. Hover is a background swap, not an animated slide.
