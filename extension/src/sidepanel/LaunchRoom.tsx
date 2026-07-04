// The Launch Room (CIRCLES-PLAN C7): for 30 minutes after a scheduled post
// fires, the Today tab's top slot becomes the first-30-minutes protocol —
// the live post, an elapsed clock, the presence checklist, and the early
// repliers the content script streams in from the open tweet. Each replier
// gets the one-click Grok draft (same voice pipeline as the mention inbox;
// posting stays manual paste in X). The optional assist is ONE
// POST /x/mentions/refresh (~$0.001–0.005, existing 6/day server cap) to
// catch repliers the user didn't scroll past — best ~20 minutes in.
//
// Reader only: the background owns the launch:* session keys; dismiss routes
// through it (single-writer discipline, same as the radar buffer).

import { type JSX, useEffect, useState } from 'react';
import {
  type ActiveLaunch,
  type EarlyReply,
  LAUNCH_ACTIVE_KEY,
  LAUNCH_REPLIES_KEY,
  isActiveLaunch,
  isEarlyReplies,
  launchIsLive,
} from '../shared/launch.ts';
import type { LaunchDismiss, LaunchSync } from '../shared/messages.ts';
import { ApiError, type PostContext, type ReplyDraft, api } from './api.ts';
import type { Settings } from './storage.ts';

function useLaunchState(): { active: ActiveLaunch | null; replies: EarlyReply[] } {
  const [active, setActive] = useState<ActiveLaunch | null>(null);
  const [replies, setReplies] = useState<EarlyReply[]>([]);

  useEffect(() => {
    let alive = true;
    void chrome.storage.session.get([LAUNCH_ACTIVE_KEY, LAUNCH_REPLIES_KEY]).then((out) => {
      if (!alive) return;
      const a = out[LAUNCH_ACTIVE_KEY];
      const r = out[LAUNCH_REPLIES_KEY];
      setActive(isActiveLaunch(a) ? a : null);
      setReplies(isEarlyReplies(r) ? r : []);
    });

    const onChanged = (
      changes: Record<string, chrome.storage.StorageChange>,
      area: chrome.storage.AreaName,
    ): void => {
      if (area !== 'session') return;
      if (LAUNCH_ACTIVE_KEY in changes) {
        const v = changes[LAUNCH_ACTIVE_KEY]?.newValue;
        setActive(isActiveLaunch(v) ? v : null);
      }
      if (LAUNCH_REPLIES_KEY in changes) {
        const v = changes[LAUNCH_REPLIES_KEY]?.newValue;
        setReplies(isEarlyReplies(v) ? v : []);
      }
    };
    chrome.storage.onChanged.addListener(onChanged);
    return () => {
      alive = false;
      chrome.storage.onChanged.removeListener(onChanged);
    };
  }, []);

  return { active, replies };
}

export function LaunchRoomSection({
  settings,
  onOpenPerson,
}: {
  settings: Settings;
  onOpenPerson: (handle: string) => void;
}): JSX.Element | null {
  const { active, replies } = useLaunchState();
  const [now, setNow] = useState(() => Date.now());
  const [refreshBusy, setRefreshBusy] = useState(false);
  const [refreshNote, setRefreshNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Panel load re-syncs the alarm schedule ("on panel load and every 15 min").
  useEffect(() => {
    const msg: LaunchSync = { type: 'stratus/launch-sync' };
    chrome.runtime.sendMessage(msg).catch(() => {});
  }, []);

  const live = active !== null && launchIsLive(active.firedAt, now);

  // Tick the elapsed clock (and the 30-minute expiry) once a second.
  useEffect(() => {
    if (!live) return;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [live]);

  if (!active || !live) return null;

  const dismiss = (): void => {
    const msg: LaunchDismiss = { type: 'stratus/launch-dismiss' };
    chrome.runtime.sendMessage(msg).catch(() => {});
  };

  // The optional billed assist — one refresh per room is the doctrine.
  const pullFromX = async (): Promise<void> => {
    setRefreshBusy(true);
    setError(null);
    try {
      const res = await api.mentions.refresh(settings);
      setRefreshNote(
        `${res.inserted} new mention${res.inserted === 1 ? '' : 's'} — see Conversations below`,
      );
    } catch (e) {
      setError(e instanceof ApiError ? `Refresh failed: ${e.message}` : 'Refresh failed');
      setRefreshBusy(false);
    }
  };

  const elapsedMs = now - Date.parse(active.firedAt);
  const minutesIn = Math.floor(elapsedMs / 60000);

  return (
    <section className="brief-section launch-room">
      <div className="launch-head">
        <h3>🚀 Launch Room</h3>
        <span className="launch-clock" title="Time since the post went live">
          {fmtElapsed(elapsedMs)} / 30:00
        </span>
        <button type="button" className="launch-dismiss" title="Close the room" onClick={dismiss}>
          ✕
        </button>
      </div>

      <div className="launch-post">{active.text}</div>
      <a className="launch-open" href={active.url} target="_blank" rel="noreferrer">
        Open on X — be present
      </a>

      <ul className="launch-checklist">
        <li>Reply to every early commenter (in X — paste, human words)</li>
        {active.linkInFirstReply && <li>Pin your first reply — the link lives there</li>}
      </ul>

      {error && <div className="error">{error}</div>}

      <div className="launch-repliers-head">
        <h4>Early repliers {replies.length > 0 ? `(${replies.length})` : ''}</h4>
        {refreshNote ? (
          <span className="launch-refresh-note">{refreshNote}</span>
        ) : (
          <button
            type="button"
            disabled={refreshBusy}
            title="One mention pull (~$0.001–0.005, 6/day cap) — catches repliers you didn't scroll past. Best ~20 min in."
            onClick={() => void pullFromX()}
          >
            {refreshBusy ? 'Pulling…' : `Pull from X${minutesIn < 20 ? ' (best at 20m)' : ''}`}
          </button>
        )}
      </div>

      {replies.length === 0 ? (
        <div className="muted">Keep the tweet open on X — replies you scroll past appear here.</div>
      ) : (
        <ul className="launch-replies">
          {replies.map((r) => (
            <EarlyReplierRow
              key={r.tweetId}
              r={r}
              postText={active.text}
              settings={settings}
              onOpenPerson={onOpenPerson}
              onError={setError}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

// Draft/copy per early replier — the mention-inbox pipeline (override: the
// gate has nothing to measure on a minutes-old reply), with my launched post
// as the parent block for thread context.
function EarlyReplierRow({
  r,
  postText,
  settings,
  onOpenPerson,
  onError,
}: {
  r: EarlyReply;
  postText: string;
  settings: Settings;
  onOpenPerson: (handle: string) => void;
  onError: (msg: string | null) => void;
}): JSX.Element {
  const [draft, setDraft] = useState<ReplyDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const generate = async (): Promise<void> => {
    setBusy(true);
    onError(null);
    try {
      const context: PostContext = {
        tweetId: r.tweetId,
        handle: r.handle,
        author: r.author ?? r.handle,
        text: r.text,
        url: `https://x.com/${r.handle}/status/${r.tweetId}`,
        postedAt: r.postedAt ?? new Date().toISOString(),
        metrics: { views: 0, replies: 0, reposts: 0, likes: 0 },
        topComments: [],
        parent: { text: postText },
      };
      setDraft(await api.replies.generate(settings, { context, override: true }));
    } catch (e) {
      onError(e instanceof ApiError ? `Draft failed: ${e.message}` : 'Draft failed');
    } finally {
      setBusy(false);
    }
  };

  const draftText = draft ? (draft.replyTextEdited ?? draft.replyText) : null;

  const copy = async (): Promise<void> => {
    if (!draft || draftText === null) return;
    await navigator.clipboard.writeText(draftText);
    setCopied(true);
    api.replies.patch(settings, draft.id, { status: 'copied' }).catch(() => {});
  };

  return (
    <li className="launch-reply-row">
      <div className="launch-reply-head">
        <button
          type="button"
          className="person-link"
          title={`Open @${r.handle}'s dossier`}
          onClick={() => onOpenPerson(r.handle)}
        >
          {r.author ?? `@${r.handle}`}
        </button>
        <a
          className="launch-reply-open"
          href={`https://x.com/${r.handle}/status/${r.tweetId}`}
          target="_blank"
          rel="noreferrer"
        >
          open
        </a>
        {draft === null ? (
          <button type="button" disabled={busy} onClick={() => void generate()}>
            {busy ? 'Drafting…' : 'Draft reply'}
          </button>
        ) : (
          <button type="button" onClick={() => void copy()}>
            {copied ? 'Copied ✓' : 'Copy'}
          </button>
        )}
      </div>
      <div className="launch-reply-text">{r.text || '(media reply)'}</div>
      {draftText && <div className="launch-reply-draft">{draftText}</div>}
    </li>
  );
}

function fmtElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
