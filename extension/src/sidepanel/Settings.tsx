import { type FormEvent, type JSX, useEffect, useMemo, useState } from 'react';
import {
  type AiFormFields,
  aiFormToPatch,
  aiSettingsToForm,
  pricePerMillion,
} from '../shared/aiSettings.ts';
import { NicheCard } from './Niche.tsx';
import { PromptsPanel } from './Prompts.tsx';
import { ApiError, type LlmModel, type LlmReasoningEffort, api } from './api.ts';
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

type SettingsView = 'general' | 'ai' | 'prompts';

export function SettingsPanel(): JSX.Element {
  const [view, setView] = useState<SettingsView>('general');
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

  // The api transport ignores this object (the background service worker owns the
  // Authorization header, §7.25) — but the client signatures require a Settings.
  // Memoized so the AI panel's on-mount load doesn't refire every render.
  const currentSettings = useMemo<Settings>(
    () => ({
      apiUrl,
      bearer,
      applyPillarsToReplies,
      autoTypeReplyDraft,
      passiveCapture,
      theme,
      density,
      uiScale,
    }),
    [
      apiUrl,
      bearer,
      applyPillarsToReplies,
      autoTypeReplyDraft,
      passiveCapture,
      theme,
      density,
      uiScale,
    ],
  );

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
      <div className="panel">
        <div className="radar-tabs">
          <button
            type="button"
            className={`radar-tab${view === 'general' ? ' active' : ''}`}
            onClick={() => setView('general')}
          >
            General
          </button>
          <button
            type="button"
            className={`radar-tab${view === 'ai' ? ' active' : ''}`}
            onClick={() => setView('ai')}
          >
            AI
          </button>
          <button
            type="button"
            className={`radar-tab${view === 'prompts' ? ' active' : ''}`}
            onClick={() => setView('prompts')}
          >
            Prompts
          </button>
        </div>
      </div>

      {view === 'ai' && <AiPanel settings={currentSettings} />}
      {view === 'prompts' && <PromptsTab settings={currentSettings} />}

      {view === 'general' && (
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
              "Since last" harvests skip everything at or before these times. Reset one to make the
              next since-last run scrape that timeline in full.
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
      )}
    </>
  );
}

// AI.10 — provider/model/temperature/tokens/effort for every draft surface.
// Loads GET /llm/settings on mount; OpenRouter is disabled until its server key
// is set. Blank numeric fields save as null ("use the surface default").
function AiPanel({ settings }: { settings: Settings }): JSX.Element {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [providers, setProviders] = useState<{ grok: boolean; openrouter: boolean }>({
    grok: false,
    openrouter: false,
  });
  const [form, setForm] = useState<AiFormFields>({
    provider: 'grok',
    openrouterModel: '',
    temperature: '',
    maxOutputTokens: '',
    reasoningEffort: '',
  });
  const [models, setModels] = useState<LlmModel[]>([]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await api.llm.getSettings(settings);
        if (cancelled) return;
        setProviders(res.providers);
        setForm(aiSettingsToForm(res));
        // Model list is only fetchable with the OpenRouter key; it's optional
        // sugar for the picker, so a failure here never blocks the panel.
        if (res.providers.openrouter) {
          try {
            const m = await api.llm.models(settings);
            if (!cancelled) setModels(m.models);
          } catch {
            /* datalist stays empty; free-text still works */
          }
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof ApiError ? e.code : 'load_failed');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [settings]);

  const set = <K extends keyof AiFormFields>(key: K, value: AiFormFields[K]): void =>
    setForm((f) => ({ ...f, [key]: value }));

  const onSave = async (): Promise<void> => {
    const mapped = aiFormToPatch(form);
    if (!mapped.ok) {
      setError(mapped.error);
      return;
    }
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      const res = await api.llm.patchSettings(settings, mapped.patch);
      setProviders(res.providers);
      setForm(aiSettingsToForm(res));
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    } catch (e) {
      setError(e instanceof ApiError ? e.code : 'save_failed');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="panel">
        <p className="muted">Loading AI settings…</p>
      </div>
    );
  }

  return (
    <div className="panel">
      <h2>AI provider</h2>
      <p className="muted">
        Which model drafts posts, replies, threads and ideas. Per-request overrides still win; blank
        numeric fields fall back to each surface's own default. API keys stay in the server env.
      </p>

      {error && <div className="error">{error}</div>}

      <div className="field">
        <span>Provider</span>
        <div className="row">
          <label className="row voice-toggle">
            <input
              type="radio"
              name="ai-provider"
              checked={form.provider === 'grok'}
              onChange={() => set('provider', 'grok')}
            />
            <span>Grok (xAI)</span>
          </label>
          <label className="row voice-toggle" title={providers.openrouter ? undefined : 'disabled'}>
            <input
              type="radio"
              name="ai-provider"
              checked={form.provider === 'openrouter'}
              disabled={!providers.openrouter}
              onChange={() => set('provider', 'openrouter')}
            />
            <span>OpenRouter</span>
          </label>
        </div>
      </div>
      {!providers.openrouter && (
        <p className="muted">
          OpenRouter is disabled — set <code>OPENROUTER_API_KEY</code> on the server to enable it.
        </p>
      )}

      <label className="field">
        <span>OpenRouter model</span>
        <input
          type="text"
          list="or-models"
          placeholder="anthropic/claude-sonnet-4.5"
          value={form.openrouterModel}
          onChange={(e) => set('openrouterModel', e.target.value)}
          spellCheck={false}
          autoComplete="off"
        />
        <datalist id="or-models">
          {models.map((m) => {
            const price = pricePerMillion(m.promptPrice);
            return (
              <option key={m.id} value={m.id}>
                {price ? `${m.name} — ${price} in` : m.name}
              </option>
            );
          })}
        </datalist>
      </label>

      <label className="field">
        <span>Temperature (blank = surface default)</span>
        <input
          type="number"
          step="0.1"
          min="0"
          max="2"
          placeholder="default"
          value={form.temperature}
          onChange={(e) => set('temperature', e.target.value)}
        />
      </label>

      <label className="field">
        <span>Max output tokens (blank = surface default)</span>
        <input
          type="number"
          step="1"
          min="1"
          max="16000"
          placeholder="default"
          value={form.maxOutputTokens}
          onChange={(e) => set('maxOutputTokens', e.target.value)}
        />
      </label>

      <label className="field">
        <span>Reasoning effort</span>
        <select
          value={form.reasoningEffort}
          onChange={(e) => set('reasoningEffort', e.target.value as LlmReasoningEffort | '')}
        >
          <option value="">Surface default</option>
          <option value="none">None</option>
          <option value="low">Low</option>
          <option value="medium">Medium</option>
          <option value="high">High</option>
        </select>
      </label>

      <div className="row">
        <button type="button" className="primary" onClick={() => void onSave()} disabled={saving}>
          {saving ? 'Saving…' : 'Save'}
        </button>
        {saved && <span className="ok">Saved</span>}
      </div>

      <h3 style={{ marginTop: 20 }}>Prompts</h3>
      <RestoreDefaultPrompts settings={settings} />
    </div>
  );
}

// AI.11 — the Prompts subtab: the per-prompt editor (Prompts.tsx) plus the
// Restore Default Prompts button (also on the AI panel footer — the user asked
// for it "in settings", so it's reachable from both).
function PromptsTab({ settings }: { settings: Settings }): JSX.Element {
  return (
    <>
      <PromptsPanel settings={settings} />
      <div className="panel">
        <RestoreDefaultPrompts settings={settings} />
      </div>
    </>
  );
}

// AI.10 — one confirm-guarded button deleting every prompt override row.
function RestoreDefaultPrompts({ settings }: { settings: Settings }): JSX.Element {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const onRestore = async (): Promise<void> => {
    if (
      !confirm('Restore all prompts to their shipped defaults? Your customizations are deleted.')
    ) {
      return;
    }
    setBusy(true);
    setResult(null);
    setError(null);
    try {
      const res = await api.prompts.restoreDefaults(settings);
      setResult(`Restored ${res.restored} prompt${res.restored === 1 ? '' : 's'} to defaults.`);
    } catch (e) {
      setError(e instanceof ApiError ? e.code : 'restore_failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
      <button type="button" className="danger" onClick={() => void onRestore()} disabled={busy}>
        {busy ? 'Restoring…' : 'Restore Default Prompts'}
      </button>
      {result && <span className="ok">{result}</span>}
      {error && <span className="error">{error}</span>}
    </div>
  );
}
