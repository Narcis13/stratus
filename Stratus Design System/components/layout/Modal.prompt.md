One-line: A centered dialog over a 55%-black scrim, with a title bar, ✕ close button, and scrollable body.

```jsx
{open && (
  <Modal title="Default reply system prompt" onClose={() => setOpen(false)}>
    <pre className="prompt-view">{prompt}</pre>
  </Modal>
)}
```

Clicking the scrim or the ✕ fires `onClose`. Card maxes at 560px wide / 85vh tall and scrolls its body. Used for prompt viewers, confirmations, and detail overlays.
