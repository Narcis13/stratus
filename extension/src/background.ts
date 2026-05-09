// Open the side panel when the toolbar action is clicked.
chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((err) => console.error('[stratus] sidePanel.setPanelBehavior failed', err));
