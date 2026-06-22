import { type FormEvent, type JSX, useEffect, useState } from 'react';
import { type Settings, getSettings, patchSettings, saveSettings } from './storage.ts';

export function SettingsPanel(): JSX.Element {
  const [apiUrl, setApiUrl] = useState('');
  const [bearer, setBearer] = useState('');
  const [applyPillarsToReplies, setApplyPillarsToReplies] = useState(false);
  const [autoTypeReplyDraft, setAutoTypeReplyDraft] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    getSettings().then((s) => {
      setApiUrl(s.apiUrl);
      setBearer(s.bearer);
      setApplyPillarsToReplies(s.applyPillarsToReplies);
      setAutoTypeReplyDraft(s.autoTypeReplyDraft);
    });
  }, []);

  const onSave = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setSaved(false);
    const next: Settings = { apiUrl, bearer, applyPillarsToReplies, autoTypeReplyDraft };
    await saveSettings(next);
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };

  return (
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

      <div className="row">
        <button type="submit" className="primary" disabled={saving || !apiUrl || !bearer}>
          {saving ? 'Saving…' : 'Save'}
        </button>
        {saved && <span className="ok">Saved</span>}
      </div>
    </form>
  );
}
