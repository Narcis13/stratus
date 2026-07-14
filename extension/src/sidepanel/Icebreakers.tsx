// "Suggest an opener" (CIRCLES-PLAN C9) — one button, one Grok call
// (~$0.005), two starters grounded strictly on real shared context. Rides on
// the People dossier and on Do-next rows. Sending stays fully manual: Copy,
// then paste in X.

import { type JSX, useState } from 'react';
import { ApiError, type IcebreakersResponse, api } from './api.ts';
import type { Settings } from './storage.ts';

export function IcebreakerBox({
  settings,
  handle,
}: {
  settings: Settings;
  handle: string;
}): JSX.Element {
  const [result, setResult] = useState<IcebreakersResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showGrounding, setShowGrounding] = useState(false);

  const suggest = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      setResult(await api.people.icebreakers(settings, handle));
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="icebreaker-box">
      {!result && (
        <button type="button" disabled={busy} onClick={() => void suggest()}>
          {busy ? 'Thinking…' : 'Suggest an opener'}
        </button>
      )}
      {error && <div className="muted">{error}</div>}
      {result && (
        <>
          <OpenerRow label="Reply" text={result.icebreakers.reply} />
          <OpenerRow label="DM" text={result.icebreakers.dm} />
          <div className="icebreaker-foot">
            <button type="button" disabled={busy} onClick={() => void suggest()}>
              {busy ? '…' : 'Again'}
            </button>
            <button type="button" onClick={() => setShowGrounding((v) => !v)}>
              {showGrounding ? 'Hide grounding' : 'What it knew'}
            </button>
            <span className="muted">${result.costUsd.toFixed(4)}</span>
          </div>
          {showGrounding && <pre className="icebreaker-grounding">{result.grounding}</pre>}
        </>
      )}
    </div>
  );
}

function OpenerRow({ label, text }: { label: string; text: string }): JSX.Element {
  const [copied, setCopied] = useState(false);
  return (
    <div className="icebreaker-row">
      <span className="icebreaker-kind">{label}</span>
      <div className="icebreaker-text">{text}</div>
      <button
        type="button"
        onClick={() => {
          void navigator.clipboard.writeText(text).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          });
        }}
      >
        {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  );
}

function friendlyError(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.status === 422) {
      return 'Nothing real to open with yet — save one of their tweets or log an exchange first.';
    }
    if (e.status === 503) return 'Grok is not configured on the server.';
    return `Opener failed: ${e.message}`;
  }
  return 'Opener failed';
}
