import { type FormEvent, type JSX, useEffect, useState } from 'react';
import { type Settings, getSettings, saveSettings } from './storage.ts';

export function SettingsPanel(): JSX.Element {
  const [apiUrl, setApiUrl] = useState('');
  const [bearer, setBearer] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    getSettings().then((s) => {
      setApiUrl(s.apiUrl);
      setBearer(s.bearer);
    });
  }, []);

  const onSave = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setSaved(false);
    const next: Settings = { apiUrl, bearer };
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

      <div className="row">
        <button type="submit" className="primary" disabled={saving || !apiUrl || !bearer}>
          {saving ? 'Saving…' : 'Save'}
        </button>
        {saved && <span className="ok">Saved</span>}
      </div>
    </form>
  );
}
