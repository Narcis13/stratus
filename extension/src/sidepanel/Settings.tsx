import { type FormEvent, type JSX, useEffect, useState } from 'react';
import {
  REPLY_HARVEST_DEFAULT,
  REPLY_HARVEST_MAX,
  REPLY_HARVEST_MIN,
  type Settings,
  clampReplyHarvestLimit,
  getSettings,
  saveSettings,
} from './storage.ts';

export function SettingsPanel(): JSX.Element {
  const [apiUrl, setApiUrl] = useState('');
  const [bearer, setBearer] = useState('');
  const [replyHarvestLimit, setReplyHarvestLimit] = useState<number>(REPLY_HARVEST_DEFAULT);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    getSettings().then((s) => {
      setApiUrl(s.apiUrl);
      setBearer(s.bearer);
      setReplyHarvestLimit(s.replyHarvestLimit);
    });
  }, []);

  const onSave = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setSaved(false);
    const next: Settings = {
      apiUrl,
      bearer,
      replyHarvestLimit: clampReplyHarvestLimit(replyHarvestLimit),
    };
    await saveSettings(next);
    setReplyHarvestLimit(next.replyHarvestLimit);
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

      <label className="field">
        <span>Reply harvest limit</span>
        <input
          type="number"
          min={REPLY_HARVEST_MIN}
          max={REPLY_HARVEST_MAX}
          step={1}
          value={replyHarvestLimit}
          onChange={(e) => {
            const n = Number(e.target.value);
            setReplyHarvestLimit(Number.isFinite(n) ? n : REPLY_HARVEST_DEFAULT);
          }}
        />
        <small className="muted">
          On a tweet-detail page, "Save to stratus" on the focused tweet also
          saves up to this many surrounding tweets. 0 = original only. Max{' '}
          {REPLY_HARVEST_MAX}. Each new author costs $0.010.
        </small>
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
