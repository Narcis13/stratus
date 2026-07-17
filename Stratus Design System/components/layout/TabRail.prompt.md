One-line: The fixed 104px vertical tab rail down the left of the side panel, with a lowercase "stratus" brandmark.

```jsx
<TabRail
  tabs={[{id:"today",label:"Today"},{id:"composer",label:"Composer"},{id:"replies",label:"Replies"}]}
  active={tab}
  onSelect={setTab}
/>
```

The active tab is filled with the darker app-canvas colour and a hairline border; others are muted text that lighten on hover. Disabled tabs drop to 0.4 opacity (the extension locks every tab until Settings is configured). Must live in a full-height flex row next to the content area.
