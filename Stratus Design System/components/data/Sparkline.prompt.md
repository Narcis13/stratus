One-line: A tiny axis-less accent-blue trend line for KPI cards (e.g. the follower sparkline on Today).

```jsx
<Sparkline points={brief.sparkline.map(p => p.followers)} />
```

Auto-scales the point series to a 120×32 box. Renders nothing with fewer than 2 points. Colour defaults to the brand accent; pass `color` for ok/danger trends.
