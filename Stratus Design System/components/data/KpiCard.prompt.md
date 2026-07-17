One-line: The hero metric block — a big tabular number with a coloured delta and an optional trailing sparkline.

```jsx
<KpiCard value="1,284" label="followers" delta={37} deltaSuffix=" / 7d" spark={followerSeries} />
<KpiCard value="214.7K" label="Impressions" delta={29} deltaSuffix="K" />
```

Powers the follower hero on Today and the analytics stat grid. `value` is pre-formatted text. Positive `delta` renders green with a leading `+`; negative renders red. The number uses tabular-nums so digits don't jitter.
