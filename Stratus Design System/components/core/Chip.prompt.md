One-line: A rounded pill for filters, segmented tabs, relationship stages, channel tags, and reply variants.

```jsx
<Chip active>For you</Chip>
<Chip tone="ok" as="span">ally</Chip>
<Chip tone="hot" as="span">hot</Chip>
```

`active` fills the chip with a tinted accent background and a coloured outline. `tone` recolours the outline/text for semantics: `neutral`, `accent`, `ok`/`warn` (relationship stages), `hot`/`warm` (reply bands). Use `as="span"` for non-interactive status chips, `as="button"` (default) for filters.
