import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import { type Settings, getSettings, resolveTheme } from './storage.ts';
import './styles.css';

// UI.9 Appearance — stamp theme/density/scale on <html> so styles.css can
// re-tint the whole panel. Kept out of React so it applies before first paint
// and survives across every context (no flash on the `system` default).
const prefersLight = window.matchMedia('(prefers-color-scheme: light)');
let themePref: Settings['theme'] = 'system';

function applyAppearance(s: Settings): void {
  themePref = s.theme;
  const el = document.documentElement;
  el.dataset.theme = resolveTheme(s.theme, prefersLight.matches);
  el.dataset.density = s.density;
  el.dataset.scale = String(s.uiScale);
}

// Immediate best-guess for the (default) `system` theme — corrected the moment
// storage resolves. Avoids a dark flash for a light-OS user.
document.documentElement.dataset.theme = prefersLight.matches ? 'light' : 'dark';

getSettings().then(applyAppearance);

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if ('theme' in changes || 'density' in changes || 'uiScale' in changes) {
    getSettings().then(applyAppearance);
  }
});

// Follow the OS when the pref is `system`.
prefersLight.addEventListener('change', () => {
  if (themePref === 'system') {
    document.documentElement.dataset.theme = resolveTheme('system', prefersLight.matches);
  }
});

const root = document.getElementById('root');
if (!root) throw new Error('root element missing');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
