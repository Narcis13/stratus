// Threaded Inbox (CIRCLES-PLAN C2): conversations, not tweets. Each thread is
// my posts + their mentions in one conversation_id, interleaved; open loops
// (the last word is theirs) sort first, 75x chains (they replied to MY reply)
// at the very top. Slack-style read state: unread dot from last_read_at
// (expanding a thread marks it read), snooze, mute. The one-click Grok draft
// per open loop reuses the §7.5 mention path unchanged: /x/replies/generate
// with override (mentions are never band-gated) + my parent post as context.
// Posting stays MANUAL PASTE: Copy → open the tweet → paste → Done.

import { type JSX, useCallback, useEffect, useState } from 'react';
import { QuickReplyPicker } from './QuickReplyPicker.tsx';
import {
  ApiError,
  type ConversationItem,
  type ConversationThread,
  type ConversationsResponse,
  type PostContext,
  type ReplyDraft,
  api,
} from './api.ts';
import { useServerSettings } from './serverSettingsHook.ts';
import type { Settings } from './storage.ts';

const LIST_LIMIT = 30;
const SNOOZE_MS = 24 * 60 * 60 * 1000;

// Client-side mention-refresh budget — "a few per day". Rolling 24h window
// persisted in localStorage; the server's own counter is the backstop and the
// real limit. UI.6 mirrors the panel budget as x.mentions.panelRefreshCap; this
// is the fallback when the settings blob hasn't landed yet.
const REFRESH_LIMIT = 4;
const REFRESH_WINDOW_MS = 24 * 60 * 60 * 1000;
const REFRESH_KEY = 'stratus:inbox:refreshes';

function recentRefreshes(): number[] {
  try {
    const raw = localStorage.getItem(REFRESH_KEY);
    const arr = raw ? (JSON.parse(raw) as unknown) : [];
    if (!Array.isArray(arr)) return [];
    const cutoff = Date.now() - REFRESH_WINDOW_MS;
    return arr.filter((t): t is number => typeof t === 'number' && t > cutoff);
  } catch {
    return [];
  }
}

function recordRefresh(): void {
  try {
    localStorage.setItem(REFRESH_KEY, JSON.stringify([...recentRefreshes(), Date.now()]));
  } catch {
    // storage full/unavailable — the server-side cap still holds
  }
}

function tweetUrl(handle: string | null, tweetId: string): string {
  return handle
    ? `https://x.com/${handle}/status/${tweetId}`
    : `https://x.com/i/web/status/${tweetId}`;
}

/** The inbound the reply is owed to: the newest unanswered mention. */
function owedMention(t: ConversationThread): ConversationItem | null {
  for (let i = t.items.length - 1; i >= 0; i--) {
    const item = t.items[i] as ConversationItem;
    if (item.kind === 'inbound' && item.status === 'unanswered') return item;
  }
  return null;
}

/** My post the owed mention replies to — exact match first, else my latest
 *  post before it in the thread. */
function parentTextFor(t: ConversationThread, owed: ConversationItem): string | null {
  let latestBefore: string | null = null;
  for (const item of t.items) {
    if (item.kind !== 'outbound') continue;
    if (owed.kind === 'inbound' && item.tweetId === owed.inReplyToTweetId) return item.text;
    if (item.postedAt <= owed.postedAt) latestBefore = item.text;
  }
  return latestBefore;
}

// Same voice pipeline as Reply Master; metrics are zeros — a fresh mention has
// none worth gating on, hence override at the call site.
function contextFor(t: ConversationThread, owed: ConversationItem): PostContext {
  const handle = owed.kind === 'inbound' ? owed.authorUsername : null;
  const author = owed.kind === 'inbound' ? (owed.authorName ?? handle) : null;
  const parentText = parentTextFor(t, owed);
  return {
    tweetId: owed.tweetId,
    handle: handle ?? 'unknown',
    author: author ?? 'unknown',
    text: owed.text,
    url: tweetUrl(handle, owed.tweetId),
    postedAt: owed.postedAt,
    metrics: { views: 0, replies: 0, reposts: 0, likes: 0 },
    topComments: [],
    ...(parentText ? { parent: { text: parentText } } : {}),
  };
}

export function ConversationsSection({
  settings,
  onOpenPerson,
}: {
  settings: Settings;
  onOpenPerson: (handle: string) => void;
}): JSX.Element {
  const [data, setData] = useState<ConversationsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  // Track what's been SPENT, not what's left: the cap arrives from the mirrored
  // blob after mount (and can change under us on a settings save), so the
  // remaining count has to be derived rather than snapshotted.
  const { panelRefreshCap } = useServerSettings();
  const [refreshesUsed, setRefreshesUsed] = useState(recentRefreshes().length);
  const refreshesLeft = Math.max(0, panelRefreshCap - refreshesUsed);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setData(await api.conversations.list(settings, { limit: LIST_LIMIT }));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to load inbox');
    }
  }, [settings]);

  useEffect(() => {
    void load();
  }, [load]);

  // New mentions arrive through the same §7.5 pull the flat inbox used.
  const refresh = async (): Promise<void> => {
    if (recentRefreshes().length >= panelRefreshCap) {
      setRefreshesUsed(recentRefreshes().length);
      return;
    }
    setRefreshing(true);
    setError(null);
    try {
      await api.mentions.refresh(settings);
      recordRefresh();
      setRefreshesUsed(recentRefreshes().length);
      await load();
    } catch (e) {
      if (e instanceof ApiError && e.code === 'refresh_limit') {
        setError('Refresh limit reached for today (server)');
      } else {
        setError(e instanceof ApiError ? e.message : 'Refresh failed');
      }
    } finally {
      setRefreshing(false);
    }
  };

  const toggle = (t: ConversationThread): void => {
    const opening = expandedId !== t.conversationId;
    setExpandedId(opening ? t.conversationId : null);
    if (opening && t.unread) {
      // Best-effort read marker; reflect locally without a reload.
      api.conversations.patch(settings, t.conversationId, { read: true }).catch(() => {});
      setData((d) =>
        d
          ? {
              counts: { ...d.counts, unread: Math.max(0, d.counts.unread - 1) },
              threads: d.threads.map((x) =>
                x.conversationId === t.conversationId ? { ...x, unread: false } : x,
              ),
            }
          : d,
      );
    }
  };

  const setMeta = async (
    t: ConversationThread,
    body: { snoozedUntil?: string | null; muted?: boolean },
  ): Promise<void> => {
    setError(null);
    try {
      await api.conversations.patch(settings, t.conversationId, body);
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Update failed');
    }
  };

  const counts = data?.counts;

  return (
    <section className="brief-section">
      <div className="radar-head">
        <h3>
          Inbox
          {counts && counts.openLoops > 0 && ` — ${counts.openLoops} owed`}
          {counts && counts.chains > 0 && ` (${counts.chains} chain)`}
        </h3>
        <button
          type="button"
          className="radar-clear"
          onClick={() => void refresh()}
          disabled={refreshing || refreshesLeft <= 0}
          title={refreshesLeft <= 0 ? `Limit ${panelRefreshCap}/day — back tomorrow` : undefined}
        >
          {refreshing ? 'Refreshing…' : `Refresh (${refreshesLeft} left)`}
        </button>
      </div>

      {error && <div className="error">{error}</div>}

      {data &&
        (data.threads.length === 0 ? (
          <div className="muted">
            No conversations yet. Refresh pulls new mentions (~$0.001 each).
          </div>
        ) : (
          <ul className="radar-list">
            {data.threads.map((t) => (
              <ThreadRow
                key={t.conversationId}
                t={t}
                expanded={expandedId === t.conversationId}
                settings={settings}
                onToggle={() => toggle(t)}
                onSnooze={() =>
                  void setMeta(t, {
                    snoozedUntil: t.snoozed ? null : new Date(Date.now() + SNOOZE_MS).toISOString(),
                  })
                }
                onMute={() => void setMeta(t, { muted: !t.muted })}
                onChanged={() => void load()}
                onError={setError}
                onOpenPerson={onOpenPerson}
              />
            ))}
          </ul>
        ))}
    </section>
  );
}

function ThreadRow({
  t,
  expanded,
  settings,
  onToggle,
  onSnooze,
  onMute,
  onChanged,
  onError,
  onOpenPerson,
}: {
  t: ConversationThread;
  expanded: boolean;
  settings: Settings;
  onToggle: () => void;
  onSnooze: () => void;
  onMute: () => void;
  onChanged: () => void;
  onError: (msg: string | null) => void;
  onOpenPerson: (handle: string) => void;
}): JSX.Element {
  const owed = t.openLoop ? owedMention(t) : null;
  const last = t.items[t.items.length - 1];
  const quiet = t.muted || t.snoozed;

  return (
    <li className={`radar-row${quiet ? ' convo-quiet' : ''}`}>
      <div className="radar-row-head">
        {t.unread && <span className="convo-unread" title="New activity since last read" />}
        {t.chain && (
          <span
            className="radar-band radar-band-hot"
            title="They replied to your reply — the 75x moment"
          >
            chain
          </span>
        )}
        {t.counterpartHandle ? (
          <button
            type="button"
            className="radar-author person-link"
            title="Open dossier"
            onClick={() => onOpenPerson(t.counterpartHandle as string)}
          >
            @{t.counterpartHandle}
          </button>
        ) : (
          <span className="radar-author">{t.counterpartName ?? 'unknown'}</span>
        )}
        {t.person && <span className={`stage-chip stage-${t.person.stage}`}>{t.person.stage}</span>}
        {owed && owed.kind === 'inbound' && (
          <span className="inbox-age" title="Yours is owed">
            owed {fmtAgo(t.owedSince ?? owed.postedAt)}
          </span>
        )}
        <span className="convo-meta-actions">
          <button
            type="button"
            className="radar-dismiss"
            title={t.snoozed ? 'Unsnooze' : 'Snooze 24h'}
            onClick={onSnooze}
          >
            {t.snoozed ? '⏰' : 'zz'}
          </button>
          <button
            type="button"
            className="radar-dismiss"
            title={t.muted ? 'Unmute thread' : 'Mute thread'}
            onClick={onMute}
          >
            {t.muted ? '🔕' : '✕'}
          </button>
        </span>
      </div>

      <button type="button" className="convo-summary" onClick={onToggle}>
        <span className="convo-count">
          {t.inboundCount + t.outboundCount} msg{expanded ? ' ▾' : ' ▸'}
        </span>
        {!expanded && last && (
          <span className="convo-last">
            {last.kind === 'outbound' ? 'me: ' : ''}
            {last.text}
          </span>
        )}
      </button>

      {expanded && (
        <>
          <ul className="convo-items">
            {t.items.map((item) => (
              <li
                key={item.tweetId}
                className={`convo-item${item.kind === 'outbound' ? ' convo-item-mine' : ''}`}
              >
                <span className="convo-item-who">
                  {item.kind === 'outbound' ? 'me' : `@${item.authorUsername ?? '?'}`}
                </span>
                <a
                  className="radar-text"
                  href={tweetUrl(
                    item.kind === 'inbound' ? item.authorUsername : null,
                    item.tweetId,
                  )}
                  target="_blank"
                  rel="noreferrer"
                >
                  {item.text}
                </a>
                <span className="inbox-age">{fmtAgo(item.postedAt)}</span>
              </li>
            ))}
          </ul>
          {owed && (
            <OpenLoopActions
              t={t}
              owed={owed}
              settings={settings}
              onChanged={onChanged}
              onError={onError}
            />
          )}
        </>
      )}
    </li>
  );
}

// The §7.5 draft/copy/done flow, per open loop.
function OpenLoopActions({
  t,
  owed,
  settings,
  onChanged,
  onError,
}: {
  t: ConversationThread;
  owed: ConversationItem;
  settings: Settings;
  onChanged: () => void;
  onError: (msg: string | null) => void;
}): JSX.Element {
  const [draft, setDraft] = useState<ReplyDraft | null>(null);
  const [variantIdx, setVariantIdx] = useState(0);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const generate = async (): Promise<void> => {
    setBusy(true);
    onError(null);
    try {
      const d = await api.replies.generate(settings, {
        context: contextFor(t, owed),
        override: true,
      });
      setDraft(d);
      setVariantIdx(0);
      // Best-effort link so the draft is findable from the mention later.
      api.mentions.patch(settings, owed.tweetId, { draftId: d.id }).catch(() => {});
    } catch (e) {
      onError(e instanceof ApiError ? e.message : 'Draft failed');
    } finally {
      setBusy(false);
    }
  };

  const variants = draft?.variants ?? null;
  const draftText = variants?.[variantIdx]?.text ?? draft?.replyText ?? null;

  const copy = async (): Promise<void> => {
    if (draftText === null || !draft) return;
    await navigator.clipboard.writeText(draftText);
    setCopied(true);
    api.replies.patch(settings, draft.id, { status: 'copied' }).catch(() => {});
  };

  const done = async (): Promise<void> => {
    setBusy(true);
    onError(null);
    try {
      await api.mentions.patch(settings, owed.tweetId, { status: 'answered' });
      onChanged();
    } catch (e) {
      onError(e instanceof ApiError ? e.message : 'Update failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="inbox-draft-wrap">
      {draft && (
        <div className="inbox-draft">
          {variants && variants.length > 1 && (
            <div className="reply-variants">
              {variants.map((v, i) => (
                <button
                  key={v.angle + String(i)}
                  type="button"
                  className={`reply-variant${i === variantIdx ? ' active' : ''}`}
                  onClick={() => {
                    setVariantIdx(i);
                    setCopied(false);
                  }}
                >
                  {v.angle}
                </button>
              ))}
            </div>
          )}
          <div className="inbox-draft-text">{draftText}</div>
        </div>
      )}
      <div className="inbox-actions">
        {draft === null ? (
          <button type="button" disabled={busy} onClick={() => void generate()}>
            {busy ? 'Drafting…' : 'Draft reply'}
          </button>
        ) : (
          <button type="button" disabled={busy || draftText === null} onClick={() => void copy()}>
            {copied ? 'Copied ✓' : 'Copy'}
          </button>
        )}
        <QuickReplyPicker
          settings={settings}
          vars={{
            name: t.counterpartName ?? t.person?.displayName ?? undefined,
            handle: t.counterpartHandle ?? undefined,
          }}
          targetTweetId={owed.tweetId}
          targetHandle={t.counterpartHandle ?? undefined}
        />
        <button
          type="button"
          disabled={busy}
          title="Replied (pasted on X) — settle the loop"
          onClick={() => void done()}
        >
          Done
        </button>
      </div>
    </div>
  );
}

function fmtAgo(iso: string): string {
  const min = Math.max(0, (Date.now() - Date.parse(iso)) / 60000);
  if (min < 60) return `${Math.round(min)}m`;
  if (min < 24 * 60) return `${Math.floor(min / 60)}h`;
  return `${Math.floor(min / 1440)}d`;
}
