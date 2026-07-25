// A3.8 — the Today publish card for a `manual` scheduled post that just came
// due. A manual post is pasted into X by hand at its slot (Studio visuals, link
// posts at $0 — nothing auto-publishes), so at the scheduled minute the
// background drops a `manual:due` entry (single writer) and fires a "Time to
// post" notification; this card is the copy-and-paste surface.
//
// Reader only: it never writes the session key. "Mark posted" and dismiss route
// through the background (§7.24), same discipline as the Launch Room. Mark
// posted flips the row to `posted` via the reconcile-safe endpoint (A3.5) —
// linking the pasted tweet is the daily reconcile's job (A3.6), so this renders
// off `status`, never `postedTweetId`.

import { type JSX, useEffect, useState } from 'react';
import {
  MANUAL_DUE_KEY,
  type ManualDue,
  isManualDueList,
  manualCardVisible,
} from '../shared/launch.ts';
import type { ManualDismiss } from '../shared/messages.ts';
import { ApiError, api } from './api.ts';
import { formatTime } from './datetime.ts';
import type { Settings } from './storage.ts';

function useManualDue(): ManualDue[] {
  const [due, setDue] = useState<ManualDue[]>([]);
  useEffect(() => {
    let alive = true;
    void chrome.storage.session.get(MANUAL_DUE_KEY).then((out) => {
      if (!alive) return;
      const v = out[MANUAL_DUE_KEY];
      setDue(isManualDueList(v) ? v : []);
    });

    const onChanged = (
      changes: Record<string, chrome.storage.StorageChange>,
      area: chrome.storage.AreaName,
    ): void => {
      if (area !== 'session' || !(MANUAL_DUE_KEY in changes)) return;
      const v = changes[MANUAL_DUE_KEY]?.newValue;
      setDue(isManualDueList(v) ? v : []);
    };
    chrome.storage.onChanged.addListener(onChanged);
    return () => {
      alive = false;
      chrome.storage.onChanged.removeListener(onChanged);
    };
  }, []);
  return due;
}

export function ManualPostCardSection({ settings }: { settings: Settings }): JSX.Element | null {
  const due = useManualDue();
  const [now, setNow] = useState(() => Date.now());

  // Tick once a minute so a card ages out of view at its 60-minute mark even
  // without a storage change to re-render it.
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(t);
  }, []);

  const visible = due.filter((d) => manualCardVisible(d.firedAt, now));
  if (visible.length === 0) return null;

  return (
    <>
      {visible.map((d) => (
        <ManualPostCard key={d.postId} settings={settings} due={d} />
      ))}
    </>
  );
}

function ManualPostCard({ settings, due }: { settings: Settings; due: ManualDue }): JSX.Element {
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dismiss = (): void => {
    const msg: ManualDismiss = { type: 'stratus/manual-dismiss', postId: due.postId };
    chrome.runtime.sendMessage(msg).catch(() => {});
  };

  const copy = async (): Promise<void> => {
    await navigator.clipboard.writeText(due.text);
    setCopied(true);
  };

  const markPosted = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await api.markPosted(settings, due.postId);
      dismiss(); // the background drops the due entry → the card disappears
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not mark it posted');
      setBusy(false);
    }
  };

  return (
    <section className="brief-section manual-card">
      <div className="manual-card-head">
        <h3>📌 Time to post</h3>
        {due.scheduledFor && (
          <span className="manual-card-slot">{formatTime(due.scheduledFor)}</span>
        )}
        <button type="button" className="manual-card-dismiss" title="Dismiss" onClick={dismiss}>
          ✕
        </button>
      </div>

      <div className="manual-card-text">{due.text}</div>
      {due.mediaNote && (
        <div className="warn manual-card-media">{due.mediaNote} — post it with its visual.</div>
      )}
      {error && <div className="error">{error}</div>}

      <div className="manual-card-actions">
        <button type="button" onClick={() => void copy()}>
          {copied ? 'Copied ✓' : 'Copy text'}
        </button>
        <a
          className="manual-card-open"
          href="https://x.com/compose/post"
          target="_blank"
          rel="noreferrer"
        >
          Open X compose
        </a>
        <button type="button" disabled={busy} onClick={() => void markPosted()}>
          {busy ? '…' : 'Mark posted'}
        </button>
      </div>
    </section>
  );
}
