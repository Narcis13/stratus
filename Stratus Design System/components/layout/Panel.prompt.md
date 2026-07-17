One-line: The elevated, hairline-bordered card that wraps every tab's content, with an optional title + actions header.

```jsx
<Panel title="Today" actions={<Button>Refresh</Button>}>
  <FollowersCard />
  <TodayPlan />
</Panel>
```

Background is `--strat-bg-elev`, 8px radius, 14px padding, and children stack with a 12px gap. The header shows a 14px semibold title on the left and an actions slot on the right. Omit both props for a plain grouping card.
