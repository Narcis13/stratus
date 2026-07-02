// Mention inbox (§7.5): people who replied to *me*, the highest-multiplier
// reply surface. Unanswered mentions age-sorted, each with a one-click Grok
// draft through the same /x/replies/generate pipeline (thread context — my
// parent post — included; band gate overridden, mentions are never gated).
// Posting stays MANUAL PASTE: Copy → open the tweet → paste → Done. Refresh
// is rate-limited client-side (the server backstops at 6/day).

import { type JSX, useCallback, useEffect, useState } from 'react';
import {
  ApiError,
  type Mention,
  type MentionsResponse,
  type PostContext,
  type ReplyDraft,
  api,
} from './api.ts';
import type { Settings } from './storage.ts';

const LIST_LIMIT = 20;
// Client-side refresh budget — "a few per day". Rolling 24h window persisted
// in localStorage; the server's own counter (6/day) is the backstop.
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

function mentionUrl(m: Mention): string {
  return m.authorUsername
    ? `https://x.com/${m.authorUsername}/status/${m.tweetId}`
    : `https://x.com/i/web/status/${m.tweetId}`;
}

// Same voice pipeline as Reply Master: the mention is the post being replied
// to; my parent post rides along as thread context. Metrics are zeros — a
// fresh mention has none worth gating on, hence override.
function contextFor(m: Mention): PostContext {
  return {
    tweetId: m.tweetId,
    handle: m.authorUsername ?? 'unknown',
    author: m.authorName ?? m.authorUsername ?? 'unknown',
    text: m.text,
    url: mentionUrl(m),
    postedAt: m.postedAt,
    metrics: { views: 0, replies: 0, reposts: 0, likes: 0 },
    topComments: [],
    ...(m.parentText ? { parent: { text: m.parentText } } : {}),
  };
}

export function InboxSection({
  settings,
  onOpenPerson,
}: {
  settings: Settings;
  onOpenPerson: (handle: string) => void;
}): JSX.Element {
  const [data, setData] = useState<MentionsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshesLeft, setRefreshesLeft] = useState(REFRESH_LIMIT - recentRefreshes().length);

  const load = useCallback(async () => {
    setError(null);
    try {
      setData(await api.mentions.list(settings, { status: 'unanswered', limit: LIST_LIMIT }));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to load inbox');
    }
  }, [settings]);

  useEffect(() => {
    void load();
  }, [load]);

  const refresh = async (): Promise<void> => {
    if (recentRefreshes().length >= REFRESH_LIMIT) {
      setRefreshesLeft(0);
      return;
    }
    setRefreshing(true);
    setError(null);
    try {
      await api.mentions.refresh(settings);
      recordRefresh();
      setRefreshesLeft(REFRESH_LIMIT - recentRefreshes().length);
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

  const remove = (tweetId: string): void => {
    setData((d) =>
      d
        ? {
            counts: { unanswered: Math.max(0, d.counts.unanswered - 1) },
            mentions: d.mentions.filter((m) => m.tweetId !== tweetId),
          }
        : d,
    );
  };

  const count = data?.counts.unanswered ?? 0;

  return (
    <section className="brief-section">
      <div className="radar-head">
        <h3>Inbox{count > 0 && ` (${count})`}</h3>
        <button
          type="button"
          className="radar-clear"
          onClick={() => void refresh()}
          disabled={refreshing || refreshesLeft <= 0}
          title={refreshesLeft <= 0 ? `Limit ${REFRESH_LIMIT}/day — back tomorrow` : undefined}
        >
          {refreshing ? 'Refreshing…' : `Refresh (${refreshesLeft} left)`}
        </button>
      </div>

      {error && <div className="error">{error}</div>}

      {data &&
        (data.mentions.length === 0 ? (
          <div className="muted">
            No unanswered mentions. Refresh pulls new ones (~$0.001 each).
          </div>
        ) : (
          <ul className="radar-list">
            {data.mentions.map((m) => (
              <InboxRow
                key={m.tweetId}
                m={m}
                settings={settings}
                onGone={() => remove(m.tweetId)}
                onError={setError}
                onOpenPerson={onOpenPerson}
              />
            ))}
          </ul>
        ))}
    </section>
  );
}

function InboxRow({
  m,
  settings,
  onGone,
  onError,
  onOpenPerson,
}: {
  m: Mention;
  settings: Settings;
  onGone: () => void;
  onError: (msg: string | null) => void;
  onOpenPerson: (handle: string) => void;
}): JSX.Element {
  const [draft, setDraft] = useState<ReplyDraft | null>(null);
  const [variantIdx, setVariantIdx] = useState(0);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const patch = async (body: Parameters<typeof api.mentions.patch>[2]): Promise<void> => {
    setBusy(true);
    onError(null);
    try {
      await api.mentions.patch(settings, m.tweetId, body);
      onGone();
    } catch (e) {
      onError(e instanceof ApiError ? e.message : 'Update failed');
    } finally {
      setBusy(false);
    }
  };

  const generate = async (): Promise<void> => {
    setBusy(true);
    onError(null);
    try {
      const d = await api.replies.generate(settings, {
        context: contextFor(m),
        override: true,
      });
      setDraft(d);
      setVariantIdx(0);
      // Best-effort link so the draft is findable from the mention later.
      api.mentions.patch(settings, m.tweetId, { draftId: d.id }).catch(() => {});
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

  return (
    <li className="radar-row">
      <div className="radar-row-head">
        {m.authorUsername ? (
          <button
            type="button"
            className="radar-author person-link"
            title="Open dossier"
            onClick={() => onOpenPerson(m.authorUsername as string)}
          >
            @{m.authorUsername}
          </button>
        ) : (
          <span className="radar-author">{m.authorName ?? 'unknown'}</span>
        )}
        <span className="inbox-age">{fmtAgo(m.postedAt)}</span>
        <button
          type="button"
          className="radar-dismiss"
          title="Dismiss — not worth answering"
          disabled={busy}
          onClick={() => void patch({ status: 'dismissed' })}
        >
          ✕
        </button>
      </div>

      <a className="radar-text" href={mentionUrl(m)} target="_blank" rel="noreferrer">
        {m.text}
      </a>

      {m.parentText && <div className="inbox-context">↳ on: {m.parentText}</div>}

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
        <button
          type="button"
          disabled={busy}
          title="Replied (pasted on X) — clear from inbox"
          onClick={() => void patch({ status: 'answered' })}
        >
          Done
        </button>
      </div>
    </li>
  );
}

function fmtAgo(iso: string): string {
  const min = Math.max(0, (Date.now() - Date.parse(iso)) / 60000);
  if (min < 60) return `${Math.round(min)}m`;
  if (min < 24 * 60) return `${Math.floor(min / 60)}h`;
  return `${Math.floor(min / 1440)}d`;
}
