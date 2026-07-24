import { type FormEvent, type JSX, useEffect, useMemo, useRef, useState } from 'react';
import {
  type AiFormFields,
  aiFormToPatch,
  aiSettingsToForm,
  pricePerMillion,
} from '../shared/aiSettings.ts';
import { NicheCard } from './Niche.tsx';
import { PromptsPanel } from './Prompts.tsx';
import {
  ApiError,
  type CommitmentKey,
  type LlmModel,
  type LlmReasoningEffort,
  type SettingEntry,
  type SettingsGroup,
  api,
} from './api.ts';
import { COMING_SOON, comingSoonMatches } from './comingSoon.ts';
import {
  filterSettingGroups,
  loadSettingGroups,
  patchSetting,
  resetGroup,
  resetKeys,
} from './settingsClient.ts';
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
import { EmptyState } from './ui/EmptyState.tsx';
import { Section } from './ui/Section.tsx';
import { SettingRow } from './ui/SettingRow.tsx';
import { SubTabs } from './ui/SubTabs.tsx';

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

type SettingsView = 'general' | 'tuning' | 'ai' | 'prompts';

const SETTINGS_TABS: { id: SettingsView; label: string }[] = [
  { id: 'general', label: 'General' },
  { id: 'tuning', label: 'Tuning' },
  { id: 'ai', label: 'AI' },
  { id: 'prompts', label: 'Prompts' },
];

export function SettingsPanel(): JSX.Element {
  const [view, setView] = useState<SettingsView>('general');
  const [apiUrl, setApiUrl] = useState('');
  const [bearer, setBearer] = useState('');
  const [applyPillarsToReplies, setApplyPillarsToReplies] = useState(false);
  const [autoTypeReplyDraft, setAutoTypeReplyDraft] = useState(false);
  const [passiveCapture, setPassiveCapture] = useState(true);
  const [passiveHarvest, setPassiveHarvest] = useState(true);
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
      setPassiveHarvest(s.passiveHarvest);
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
      passiveHarvest,
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
      passiveHarvest,
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
      passiveHarvest,
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
        <SubTabs tabs={SETTINGS_TABS} active={view} onSelect={setView} />
      </div>

      {view === 'tuning' && <TuningPanel settings={currentSettings} />}
      {view === 'ai' && (
        <AiPanel settings={currentSettings} onOpenTuning={() => setView('tuning')} />
      )}
      {view === 'prompts' && <PromptsTab settings={currentSettings} />}

      {view === 'general' && (
        <>
          <NicheCard />
          <CommitmentsCard settings={currentSettings} />

          <form className="panel" onSubmit={onSave}>
            <Section title="Connection">
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

              <div className="row">
                <button type="submit" className="primary" disabled={saving || !apiUrl || !bearer}>
                  {saving ? 'Saving…' : 'Save'}
                </button>
                {saved && <span className="ok">Saved</span>}
              </div>
            </Section>
          </form>

          <div className="panel">
            <Section title="Behavior & privacy">
              <p className="muted">These four save the moment you click them — no Save needed.</p>

              <label className="row voice-toggle">
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

              <label className="row voice-toggle">
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

              <label className="row voice-toggle">
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

              <label className="row voice-toggle">
                <input
                  type="checkbox"
                  checked={passiveHarvest}
                  onChange={(e) => {
                    const v = e.target.checked;
                    setPassiveHarvest(v);
                    void patchSettings({ passiveHarvest: v });
                  }}
                />
                <span>Passive timeline harvest while browsing /home (default on, $0)</span>
              </label>
            </Section>
          </div>

          <div className="panel">
            <Section title="Appearance">
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
            </Section>
          </div>

          <div className="panel">
            <Section title="Harvest cursors">
              <p className="muted">
                "Since last" harvests skip everything at or before these times. Reset one to make
                the next since-last run scrape that timeline in full.
              </p>
              {cursors.length === 0 ? (
                <EmptyState
                  line="No cursors yet."
                  hint="They appear after a completed since-last harvest."
                />
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
            </Section>
          </div>
        </>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// UI.11 — Tuning: the whole server settings registry, rendered from
// GET /x/settings. The panel NEVER imports the server registry (§5 build
// isolation) — every label, bound, unit and default on screen came over the
// wire, so a knob added server-side appears here with no extension rebuild.

/** Sliders fire on every drag tick; a PATCH per tick would be a write storm.
 *  Long enough to coalesce a drag, short enough that a save feels immediate. */
const PATCH_DEBOUNCE_MS = 400;

/** Copy that only makes sense at group level — mostly OWNERSHIP: several numbers
 *  a user expects to find here deliberately live on the active niche instead
 *  (one owner per knob), and the AI group is the lower of two legitimate tiers. */
const GROUP_NOTE: Record<string, string> = {
  doctrine:
    'Your reply quota and week reply % are not here — they belong to the active niche. Edit them under General → Niche.',
  people:
    'The 2–10× target-band multipliers belong to the active niche (General → Niche), not to this group.',
  band: 'These twelve are the classifier thresholds — what counts as hot, warm or skip on the page badge and at the reply gate, which read the same numbers. How many replies you owe a day, and the 2–10× follower window, are niche settings (General → Niche).',
  ai: 'Per-surface house defaults. A value set under Settings → AI is a global override and wins over these; blank fields there fall back to exactly this group.',
  workers:
    'Knobs tagged "restart" arm a timer when the server boots, so they apply on the next restart. Everything else in Tuning applies to the very next request.',
  budgets:
    'Ceilings, not switches. The spend checks themselves are never configurable — these only move where the line sits.',
};

function sameValue(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((v, i) => v === b[i]);
  }
  return a === b;
}

function TuningPanel({ settings }: { settings: Settings }): JSX.Element {
  const [groups, setGroups] = useState<SettingsGroup[] | null>(null);
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const [busyGroup, setBusyGroup] = useState<string | null>(null);

  // Debounced writes: the timer and the value it will send, per key.
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const pendingValues = useRef(new Map<string, unknown>());
  // The unmount flush needs today's settings without re-subscribing the effect.
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  const reload = async (): Promise<void> => {
    try {
      setGroups(await loadSettingGroups(settingsRef.current));
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.code : 'load_failed');
    }
  };

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const gs = await loadSettingGroups(settings);
        if (!cancelled) setGroups(gs);
      } catch (e) {
        if (!cancelled) setError(e instanceof ApiError ? e.code : 'load_failed');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [settings]);

  useEffect(() => {
    const timerMap = timers.current;
    const valueMap = pendingValues.current;
    return () => {
      // Switching subtab unmounts this panel; a knob the user already moved must
      // not be silently dropped, so flush the debounce instead of cancelling it.
      for (const t of timerMap.values()) clearTimeout(t);
      timerMap.clear();
      for (const [key, value] of valueMap) {
        void patchSetting(settingsRef.current, key, value).catch(() => {});
      }
      valueMap.clear();
    };
  }, []);

  const commit = async (key: string): Promise<void> => {
    const value = pendingValues.current.get(key);
    pendingValues.current.delete(key);
    timers.current.delete(key);
    try {
      await patchSetting(settingsRef.current, key, value);
    } catch (e) {
      // The registry floors/ceilings are the money guard — a value the server
      // rejected must not sit on screen looking saved, so re-read the truth.
      setRowErrors((p) => ({ ...p, [key]: e instanceof ApiError ? e.code : 'save_failed' }));
      await reload();
    }
  };

  const onChange = (entry: SettingEntry, value: unknown): void => {
    // Optimistic: the control has to track the drag, and `isDefault` drives the
    // reset dot, so recompute it here rather than refetching per tick.
    setGroups((gs) =>
      gs === null
        ? gs
        : gs.map((g) => ({
            ...g,
            settings: g.settings.map((s) =>
              s.key === entry.key ? { ...s, value, isDefault: sameValue(value, s.default) } : s,
            ),
          })),
    );
    setRowErrors((prev) => {
      if (!(entry.key in prev)) return prev;
      const next = { ...prev };
      delete next[entry.key];
      return next;
    });

    pendingValues.current.set(entry.key, value);
    const existing = timers.current.get(entry.key);
    if (existing) clearTimeout(existing);
    timers.current.set(
      entry.key,
      setTimeout(() => void commit(entry.key), PATCH_DEBOUNCE_MS),
    );
  };

  const onResetKey = async (key: string): Promise<void> => {
    const t = timers.current.get(key);
    if (t) clearTimeout(t);
    timers.current.delete(key);
    pendingValues.current.delete(key);
    try {
      await resetKeys(settingsRef.current, [key]);
      await reload();
    } catch (e) {
      setRowErrors((p) => ({ ...p, [key]: e instanceof ApiError ? e.code : 'reset_failed' }));
    }
  };

  const onResetGroup = async (id: string): Promise<void> => {
    setBusyGroup(id);
    try {
      await resetGroup(settingsRef.current, id);
      await reload();
    } catch (e) {
      setError(e instanceof ApiError ? e.code : 'reset_failed');
    } finally {
      setBusyGroup(null);
    }
  };

  if (groups === null) {
    return (
      <div className="panel">
        {error !== null ? (
          <>
            <div className="error">{error}</div>
            <p className="muted">
              Settings load from the server. Check the connection fields under General.
            </p>
          </>
        ) : (
          <p className="muted">Loading settings…</p>
        )}
      </div>
    );
  }

  const filtered = filterSettingGroups(groups, query);
  const features = COMING_SOON.filter((f) => comingSoonMatches(f, query));
  const totalKnobs = groups.reduce((n, g) => n + g.settings.length, 0);
  const shownKnobs = filtered.reduce((n, g) => n + g.settings.length, 0);
  const overridden = groups.reduce((n, g) => n + g.settings.filter((s) => !s.isDefault).length, 0);

  return (
    <>
      <div className="panel">
        <div className="settings-search">
          <input
            type="search"
            placeholder="Search settings…"
            value={query}
            aria-label="Search settings"
            spellCheck={false}
            autoComplete="off"
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <p className="muted settings-count">
          {query.trim() === ''
            ? `${totalKnobs} knobs across ${groups.length} groups · ${overridden} changed from default`
            : `${shownKnobs} of ${totalKnobs} knobs match`}
        </p>
        {error !== null && <div className="error">{error}</div>}
      </div>

      {filtered.length === 0 && features.length === 0 && (
        <div className="panel">
          <EmptyState
            line={`Nothing matches "${query.trim()}".`}
            hint="Search matches a knob's name, description or key — and a group name keeps the whole group."
          />
        </div>
      )}

      {filtered.map((group) => (
        <div className="panel" key={group.id}>
          <Section
            title={group.label}
            actions={
              <button
                type="button"
                className="settings-group-reset"
                disabled={busyGroup === group.id}
                onClick={() => void onResetGroup(group.id)}
              >
                {busyGroup === group.id ? 'Resetting…' : 'Reset group'}
              </button>
            }
          >
            {GROUP_NOTE[group.id] && <p className="muted settings-note">{GROUP_NOTE[group.id]}</p>}
            {group.settings.map((entry) => (
              <div key={entry.key}>
                <SettingRow
                  entry={entry}
                  onChange={(v) => onChange(entry, v)}
                  onReset={() => void onResetKey(entry.key)}
                />
                {rowErrors[entry.key] && (
                  <p className="error settings-row-error">
                    {rowErrors[entry.key]} — value rejected, showing the saved one.
                  </p>
                )}
              </div>
            ))}
          </Section>
        </div>
      ))}

      {features.length > 0 && (
        <div className="panel">
          <Section title="Coming soon">
            <p className="muted settings-note">
              Planned but not built. These rows are inert — nothing here is stored on the server
              yet.
            </p>
            {features.map((f) => (
              <div className="coming-soon" key={f.id}>
                <div className="coming-soon-head">
                  <span className="coming-soon-title">{f.title}</span>
                  <span className="coming-soon-plan">{f.planFile}</span>
                </div>
                <p className="muted coming-soon-summary">{f.summary}</p>
                <ul className="coming-soon-knobs">
                  {f.knobs.map((k) => (
                    <li key={k.label}>
                      <span className="coming-soon-knob">{k.label}</span>
                      <span className="muted">{k.hint}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </Section>
        </div>
      )}
    </>
  );
}

// GR.8 — daily commitments (Guardrails §C): the minimum I hold myself to each
// day. An absent or paused row changes nothing (the quests fall back to the
// doctrine defaults, which is why the table ships with no seed); an active one
// raises the Today quest bar and starts accumulating debt from the day the
// promise was made. Saving is per key, because that is what PUT /x/commitments is.
const COMMITMENT_KEYS: CommitmentKey[] = ['replies', 'originals'];

const COMMITMENT_LABEL: Record<CommitmentKey, string> = {
  replies: 'Replies per day',
  originals: 'Original posts per day',
};

interface CommitmentForm {
  target: string;
  active: boolean;
}

function CommitmentsCard({ settings }: { settings: Settings }): JSX.Element {
  const [forms, setForms] = useState<Record<CommitmentKey, CommitmentForm>>({
    replies: { target: '', active: false },
    originals: { target: '', active: false },
  });
  const [busy, setBusy] = useState<CommitmentKey | null>(null);
  const [saved, setSaved] = useState<CommitmentKey | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await api.commitments.get(settings);
        if (cancelled) return;
        setForms((f) => {
          const next = { ...f };
          for (const c of res.commitments)
            next[c.key] = { target: String(c.dailyTarget), active: c.active };
          return next;
        });
      } catch {
        // Unconfigured, or a server predating GR.8 — the fields stay blank and
        // a save will report the real error.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [settings]);

  const set = (key: CommitmentKey, patch: Partial<CommitmentForm>): void =>
    setForms((f) => ({ ...f, [key]: { ...f[key], ...patch } }));

  const save = async (key: CommitmentKey): Promise<void> => {
    const n = Number(forms[key].target);
    if (!Number.isInteger(n) || n < 1 || n > 100) {
      setError('Daily target must be a whole number from 1 to 100.');
      return;
    }
    setBusy(key);
    setSaved(null);
    setError(null);
    try {
      const row = await api.commitments.put(settings, {
        key,
        dailyTarget: n,
        active: forms[key].active,
      });
      set(key, { target: String(row.dailyTarget), active: row.active });
      setSaved(key);
      setTimeout(() => setSaved(null), 1500);
    } catch (e) {
      setError(e instanceof ApiError ? e.code : 'save_failed');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="panel">
      <h2>Daily commitments</h2>
      <p className="muted">
        The minimum you hold yourself to. An active commitment replaces the doctrine target in
        Today's quests; missed days show up there as debt. Nothing is ever blocked.
      </p>
      {error && <div className="error">{error}</div>}
      {COMMITMENT_KEYS.map((key) => (
        <div className="row commitment-row" key={key}>
          <span className="commitment-label">{COMMITMENT_LABEL[key]}</span>
          <input
            className="commitment-target"
            type="number"
            min="1"
            max="100"
            step="1"
            placeholder="—"
            value={forms[key].target}
            onChange={(e) => set(key, { target: e.target.value })}
          />
          <label className="row voice-toggle">
            <input
              type="checkbox"
              checked={forms[key].active}
              onChange={(e) => set(key, { active: e.target.checked })}
            />
            <span>active</span>
          </label>
          <button type="button" onClick={() => void save(key)} disabled={busy === key}>
            {busy === key ? 'Saving…' : 'Save'}
          </button>
          {saved === key && <span className="ok">Saved</span>}
        </div>
      ))}
    </div>
  );
}

// AI.10 — provider/model/temperature/tokens/effort for every draft surface.
// Loads GET /llm/settings on mount; OpenRouter is disabled until its server key
// is set. Blank numeric fields save as null ("use the surface default").
function AiPanel({
  settings,
  onOpenTuning,
}: { settings: Settings; onOpenTuning: () => void }): JSX.Element {
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
      {/* UI.11 — the two-tier story, said once where it can be acted on: this
          panel is the GLOBAL override, Tuning → AI calls holds the per-surface
          defaults a blank field here falls back to. */}
      <p className="muted">
        These apply to every surface at once. The per-surface defaults they fall back to live in{' '}
        <button type="button" className="linklike" onClick={onOpenTuning}>
          Tuning → AI calls
        </button>
        .
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
