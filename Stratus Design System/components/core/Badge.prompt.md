One-line: A tiny uppercase status pill for post lifecycle, reply state, drafts, and authors.

```jsx
<Badge tone="posted">posted</Badge>
<Badge tone="pending">pending</Badge>
<Badge tone="pillar" uppercase={false}>build-in-public</Badge>
```

Tones map to the extension's status system: `draft`, `pending`, `publishing`, `posted`, `failed`, `cancelled`, plus semantic `accent`/`warn`/`ok`/`danger`, `pillar` (purple), and `media`. Colored text sits on a ~15–20% matching fill. Uppercase by default; turn it off for slugs/labels.
