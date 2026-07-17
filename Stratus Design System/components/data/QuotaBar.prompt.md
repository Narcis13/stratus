One-line: A thin pill progress meter — accent-blue fill that flips to green once the target is met.

```jsx
<QuotaBar value={3} max={5} label="3 / 5–10 today" />
```

Used for the daily reply quota on Today. Clamps to 0–100%. Pass `met` to force the green state (e.g. when any value in a min–max window counts as done); otherwise it turns green at `value >= max`.
