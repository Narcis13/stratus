import { type FormEvent, type JSX, useEffect, useState } from 'react';
import { NicheCard } from './Niche.tsx';
import {
  DEFAULT_DENSITY,
  DEFAULT_THEME,
  DEFAULT_UI_SCALE,
  type Density,
  type Settings,
  type ThemePref,
  type UiScale,
  getSettings,
  patchSettings,
  saveSettings,
} from './storage.ts';

// C0: surface the per-handle 'since-last' harvest cursors (shared/harvest.ts
// harvestCursorKey) so a wrong cursor is visible and resettable instead of a
// silent-skip trap. Key format: harvest:cursor:<handle>:<mode>, value = epoch
// ms of the newest item the last completed run saw.
const HARVEST_CURSOR_PREFIX = 'harvest:cursor:';

interface HarvestCursor {
  key: string;
  label: string; // "<handle> · <mode>"
  at: number | null;
}

async function loadHarvestCursors(): Promise<HarvestCursor[]> {
  const all = await chrome.storage.local.get(null);
  return Object.entries(all)
    .filter(([k]) => k.startsWith(HARVEST_CURSOR_PREFIX))
    .map(([key, v]) => {
      const rest = key.slice(HARVEST_CURSOR_PREFIX.length);
      const sep = rest.lastIndexOf(':');
      const label = sep > 0 ? `@${rest.slice(0, sep)} · ${rest.slice(sep + 1)}` : rest;
      return { key, label, at: typeof v === 'number' && Number.isFinite(v) ? v : null };
    })
    .sort((a, b) => a.label.localeCompare(b.label));
}

export function SettingsPanel(): JSX.Element {
  const [apiUrl, setApiUrl] = useState('');
  const [bearer, setBearer] = useState('');
  const [applyPillarsToReplies, setApplyPillarsToReplies] = useState(false);
  const [autoTypeReplyDraft, setAutoTypeReplyDraft] = useState(false);
  const [passiveCapture, setPassiveCapture] = useState(true);
  const [theme, setTheme] = useState<ThemePref>(DEFAULT_THEME);
  const [density, setDensity] = useState<Density>(DEFAULT_DENSITY);
  const [uiScale, setUiScale] = useState<UiScale>(DEFAULT_UI_SCALE);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [cursors, setCursors] = useState<HarvestCursor[]>([]);

  useEffect(() => {
    getSettings().then((s) => {
      setApiUrl(s.apiUrl);
      setBearer(s.bearer);
      setApplyPillarsToReplies(s.applyPillarsToReplies);
      setAutoTypeReplyDraft(s.autoTypeReplyDraft);
      setPassiveCapture(s.passiveCapture);
      setTheme(s.theme);
      setDensity(s.density);
      setUiScale(s.uiScale);
    });
    void loadHarvestCursors().then(setCursors);
  }, []);

  const resetCursor = async (key: string): Promise<void> => {
    await chrome.storage.local.remove(key);
    setCursors(await loadHarvestCursors());
  };

  const onSave = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setSaved(false);
    const next: Settings = {
      apiUrl,
      bearer,
      applyPillarsToReplies,
      autoTypeReplyDraft,
      passiveCapture,
      theme,
      density,
      uiScale,
    };
    await saveSettings(next);
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };

  return (
    <>
      <NicheCard />
      <form className="panel" onSubmit={onSave}>
        <h2>Settings</h2>
        <p className="muted">
          Bearer token must match the server's <code>API_TOKEN</code> env var.
        </p>

        <label className="field">
          <span>API URL</span>
          <input
            type="url"
            placeholder="http://127.0.0.1:8787"
            value={apiUrl}
            onChange={(e) => setApiUrl(e.target.value)}
            spellCheck={false}
            autoComplete="off"
          />
        </label>

        <label className="field">
          <span>Bearer token</span>
          <input
            type="password"
            placeholder="paste API_TOKEN"
            value={bearer}
            onChange={(e) => setBearer(e.target.value)}
            spellCheck={false}
            autoComplete="off"
          />
        </label>

        <label className="row voice-toggle" style={{ marginTop: 8 }}>
          <input
            type="checkbox"
            checked={applyPillarsToReplies}
            onChange={(e) => {
              const v = e.target.checked;
              setApplyPillarsToReplies(v);
              void patchSettings({ applyPillarsToReplies: v });
            }}
          />
          <span>Apply content pillars to reply drafting (default off)</span>
        </label>

        <label className="row voice-toggle" style={{ marginTop: 8 }}>
          <input
            type="checkbox"
            checked={autoTypeReplyDraft}
            onChange={(e) => {
              const v = e.target.checked;
              setAutoTypeReplyDraft(v);
              void patchSettings({ autoTypeReplyDraft: v });
            }}
          />
          <span>Auto-type Reply Master drafts into the reply box (default off)</span>
        </label>

        <label className="row voice-toggle" style={{ marginTop: 8 }}>
          <input
            type="checkbox"
            checked={passiveCapture}
            onChange={(e) => {
              const v = e.target.checked;
              setPassiveCapture(v);
              void patchSettings({ passiveCapture: v });
            }}
          />
          <span>Passive contact capture from hover cards (default on)</span>
        </label>

        <div className="row">
          <button type="submit" className="primary" disabled={saving || !apiUrl || !bearer}>
            {saving ? 'Saving…' : 'Save'}
          </button>
          {saved && <span className="ok">Saved</span>}
        </div>

        <h3 style={{ marginTop: 20 }}>Appearance</h3>
        <p className="muted">Panel look only — applies instantly, no Save needed.</p>

        <label className="field">
          <span>Theme</span>
          <select
            value={theme}
            onChange={(e) => {
              const v = e.target.value as ThemePref;
              setTheme(v);
              void patchSettings({ theme: v });
            }}
          >
            <option value="system">System</option>
            <option value="dark">Dark</option>
            <option value="light">Light</option>
          </select>
        </label>

        <label className="field">
          <span>Density</span>
          <select
            value={density}
            onChange={(e) => {
              const v = e.target.value as Density;
              setDensity(v);
              void patchSettings({ density: v });
            }}
          >
            <option value="cozy">Cozy</option>
            <option value="compact">Compact</option>
          </select>
        </label>

        <label className="field">
          <span>Text size</span>
          <select
            value={String(uiScale)}
            onChange={(e) => {
              const v = Number(e.target.value) as UiScale;
              setUiScale(v);
              void patchSettings({ uiScale: v });
            }}
          >
            <option value="12">Small</option>
            <option value="13">Default</option>
            <option value="14">Large</option>
          </select>
        </label>

        <h3 style={{ marginTop: 20 }}>Harvest cursors</h3>
        <p className="muted">
          "Since last" harvests skip everything at or before these times. Reset one to make the next
          since-last run scrape that timeline in full.
        </p>
        {cursors.length === 0 ? (
          <p className="muted">
            No cursors yet — they appear after a completed since-last harvest.
          </p>
        ) : (
          <ul className="cursor-list">
            {cursors.map((c) => (
              <li key={c.key} className="row cursor-row">
                <span className="cursor-label">{c.label}</span>
                <span className="muted">
                  {c.at !== null ? new Date(c.at).toLocaleString() : 'invalid value'}
                </span>
                <button type="button" onClick={() => void resetCursor(c.key)}>
                  Reset
                </button>
              </li>
            ))}
          </ul>
        )}
      </form>
    </>
  );
}
