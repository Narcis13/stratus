import { type JSX, useCallback, useEffect, useState } from 'react';
import { ApiError, type PromptDetail, type PromptSummary, api } from './api.ts';
import type { Settings } from './storage.ts';

interface Props {
  settings: Settings;
}

const ERR: Record<string, string> = {
  unknown_prompt: 'That prompt no longer exists.',
  missing_placeholder: 'Add the required placeholders back before saving.',
  invalid_body_field: 'The prompt body cannot be empty.',
  body_too_large: 'Prompt is too large (max 32 KB).',
};

function errMsg(e: unknown, fallback: string): string {
  if (e instanceof ApiError) return ERR[e.code] ?? `${e.code} (${e.status})`;
  return fallback;
}

// Mirror of the server's validatePromptBody `includes` check (registry.ts) — the
// server still enforces on PATCH; this is instant feedback so Save can grey out.
function missingPlaceholders(body: string, required: string[]): string[] {
  return required.filter((token) => !body.includes(token));
}

export function PromptsPanel({ settings }: Props): JSX.Element {
  const [prompts, setPrompts] = useState<PromptSummary[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setPrompts(await api.prompts.list(settings));
    } catch (e) {
      setError(errMsg(e, 'Failed to load prompts'));
    } finally {
      setLoading(false);
    }
  }, [settings]);

  useEffect(() => {
    void load();
  }, [load]);

  if (selected) {
    return (
      <PromptEditor
        promptKey={selected}
        settings={settings}
        onBack={() => {
          setSelected(null);
          // Refetch so the customized chip + updatedAt reflect any save/reset.
          void load();
        }}
      />
    );
  }

  return (
    <div className="panel">
      <div className="row voice-pillars-head">
        <h2>Prompts</h2>
        <button type="button" onClick={() => void load()} disabled={loading}>
          {loading ? 'Loading…' : 'Refresh'}
        </button>
      </div>
      <p className="muted">
        Every AI surface reads one of these. Edit any prompt to change how it drafts — saved to the
        server. Customized prompts show an amber chip; reset reverts to the shipped default.
      </p>

      {error && <div className="error">{error}</div>}

      {loading && prompts.length === 0 ? (
        <p className="muted">Loading prompts…</p>
      ) : (
        <ul className="prompt-list">
          {prompts.map((p) => (
            <li key={p.key}>
              <button type="button" className="prompt-row" onClick={() => setSelected(p.key)}>
                <div className="prompt-row-head">
                  <strong>{p.name}</strong>
                  {p.customized && <span className="badge badge-auto">customized</span>}
                </div>
                <code className="prompt-key">{p.key}</code>
                <span className="muted prompt-desc">{p.description}</span>
                {p.customized && p.updatedAt !== null && (
                  <span className="muted prompt-updated">
                    edited {new Date(p.updatedAt).toLocaleString()}
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

interface EditorProps {
  promptKey: string;
  settings: Settings;
  onBack: () => void;
}

function PromptEditor({ promptKey, settings, onBack }: EditorProps): JSX.Element {
  const [detail, setDetail] = useState<PromptDetail | null>(null);
  const [body, setBody] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [showDefault, setShowDefault] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const d = await api.prompts.get(settings, promptKey);
      setDetail(d);
      setBody(d.body);
    } catch (e) {
      setError(errMsg(e, 'Failed to load prompt'));
    } finally {
      setLoading(false);
    }
  }, [settings, promptKey]);

  useEffect(() => {
    void load();
  }, [load]);

  const missing = detail ? missingPlaceholders(body, detail.required) : [];
  const dirty = detail !== null && body !== detail.body;

  const save = async (): Promise<void> => {
    if (!detail) return;
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      await api.prompts.patch(settings, promptKey, body);
      setDetail({ ...detail, body, customized: true });
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    } catch (e) {
      setError(errMsg(e, 'Save failed'));
    } finally {
      setBusy(false);
    }
  };

  const reset = async (): Promise<void> => {
    if (!detail) return;
    setBusy(true);
    setError(null);
    try {
      await api.prompts.reset(settings, promptKey);
      setConfirming(false);
      // Reload to pull the shipped default back into the editor.
      await load();
    } catch (e) {
      setError(errMsg(e, 'Reset failed'));
      setBusy(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="panel">
      <div className="row voice-pillars-head">
        <button type="button" onClick={onBack}>
          ← Back
        </button>
        <code className="prompt-key">{promptKey}</code>
      </div>

      {error && <div className="error">{error}</div>}

      {loading || !detail ? (
        <p className="muted">Loading prompt…</p>
      ) : (
        <>
          <div className="prompt-editor-head">
            {detail.customized ? (
              <span className="badge badge-auto">customized</span>
            ) : (
              <span className="muted">shipped default</span>
            )}
          </div>

          {detail.required.length > 0 && (
            <div className="prompt-placeholders">
              <span className="muted">Required placeholders:</span>
              {detail.required.map((token) => {
                const isMissing = !body.includes(token);
                return (
                  <code
                    key={token}
                    className={`prompt-token${isMissing ? ' prompt-token-missing' : ''}`}
                    title={isMissing ? 'Missing — add it back before saving' : 'Present'}
                  >
                    {token}
                  </code>
                );
              })}
            </div>
          )}

          <textarea
            className="prompt-body"
            rows={20}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            spellCheck={false}
          />
          <div className="row prompt-meta">
            <span className="muted">{body.length} chars</span>
            {missing.length > 0 && (
              <span className="error">
                missing {missing.length} placeholder{missing.length === 1 ? '' : 's'}
              </span>
            )}
          </div>

          <div className="pillar-card-actions">
            <button
              type="button"
              className="primary"
              onClick={() => void save()}
              disabled={busy || !dirty || missing.length > 0}
            >
              {busy ? '…' : 'Save'}
            </button>
            <button type="button" onClick={() => setBody(detail.body)} disabled={busy || !dirty}>
              Revert edits
            </button>
            <button type="button" onClick={() => setShowDefault((v) => !v)} disabled={busy}>
              {showDefault ? 'Hide default' : 'Show default'}
            </button>
            {confirming ? (
              <>
                <button
                  type="button"
                  className="danger"
                  onClick={() => void reset()}
                  disabled={busy}
                >
                  {busy ? '…' : 'Confirm reset'}
                </button>
                <button type="button" onClick={() => setConfirming(false)} disabled={busy}>
                  cancel
                </button>
              </>
            ) : (
              <button
                type="button"
                className="danger"
                onClick={() => setConfirming(true)}
                disabled={busy || !detail.customized}
                title={detail.customized ? 'Revert to shipped default' : 'Already the default'}
              >
                Reset this prompt
              </button>
            )}
          </div>

          {saved && <span className="ok">Saved</span>}

          {showDefault && (
            <div className="prompt-default">
              <p className="muted">Shipped default (read-only):</p>
              <textarea className="prompt-body" rows={20} value={detail.defaultBody} readOnly />
            </div>
          )}
        </>
      )}
    </div>
  );
}
