One-line: Inline status callout — tinted bordered boxes for `error` and `warn`, plain coloured text for `ok`.

```jsx
<Message tone="error">Failed to load brief</Message>
<Message tone="warn">⚠ A URL in tweet 1 is billed at $0.20.</Message>
<Message tone="ok">Copied to clipboard</Message>
```

`error` (red) and `warn` (amber) are 12px text on a ~10% fill with a matching border and 6px radius. `ok` (green) is bare text, no box — used for transient confirmations.
