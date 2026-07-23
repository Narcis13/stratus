// RL.6 — the quick canned-reply picker: the one-click end of the reply-list
// feature. It rides every Launch Room early-replier row and every Conversations
// open loop — the two places the machinery already knows who the counterpart is.
//
// Deliberately dumb (Decision 1): the picker NEVER picks. One click is one
// `POST /use`, and the server owns the anti-repeat shuffle, the
// {name}/{first_name}/{handle} fill and the humanizer, then hands back finished
// text. Picking here — or sending `preview: true` to avoid "spending" an item —
// would silently fork the anti-repeat state the DB is the only copy of.
//
// Posting stays a manual paste (§7.28): this component fills the clipboard and
// nothing else. No status flips, no new message types, no session storage.

import { type JSX, useEffect, useRef, useState } from 'react';
import { ApiError, type ReplyListSummary, type UseReplyResponse, api } from './api.ts';
import type { Settings } from './storage.ts';

// One fetch per minute shared by every picker on screen (the ChannelTags cache
// shape). The Lists subtab invalidates on unmount, so a list created there is
// offered as soon as the user leaves it.
const CACHE_TTL_MS = 60_000;
let cache: { lists: ReplyListSummary[]; at: number } | null = null;
let inflight: Promise<ReplyListSummary[]> | null = null;

export async function loadReplyLists(settings: Settings): Promise<ReplyListSummary[]> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.lists;
  if (!inflight) {
    inflight = api.replyLists
      .list(settings)
      .then((lists) => {
        cache = { lists, at: Date.now() };
        return lists;
      })
      .finally(() => {
        inflight = null;
      });
  }
  return inflight;
}

export function invalidateReplyListsCache(): void {
  cache = null;
}

/** Mirrors the route's `USERNAME_RE` (D79g): a malformed `targetHandle` is a
 *  hard 400, and audit metadata is never worth losing the whole use over. */
const USERNAME_RE = /^[A-Za-z0-9_]{1,15}$/;
/** The route's `TWEET_ID_RE` — same reasoning as the handle. */
const TWEET_ID_RE = /^\d{1,32}$/;
/** The route's `MAX_VAR_LEN`; a longer display name 400s `invalid_vars`. */
const MAX_VAR_LEN = 120;

const ERR: Record<string, string> = {
  no_enabled_items: 'Nothing switched on in that list.',
  not_found: 'That list is gone — reopen the Lists subtab.',
};

interface Props {
  settings: Settings;
  /** The target author. Both halves are optional: a var the target can't supply
   *  degrades the template server-side instead of blocking the use. */
  vars: { name?: string | undefined; handle?: string | undefined };
  targetTweetId?: string | undefined;
  targetHandle?: string | undefined;
}

export function QuickReplyPicker({
  settings,
  vars,
  targetTweetId,
  targetHandle,
}: Props): JSX.Element {
  const [lists, setLists] = useState<ReplyListSummary[] | null>(null);
  const [open, setOpen] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [used, setUsed] = useState<UseReplyResponse | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    let alive = true;
    loadReplyLists(settings)
      .then((ls) => {
        if (alive) setLists(ls);
      })
      .catch(() => {
        if (alive) setLists([]);
      });
    return () => {
      alive = false;
    };
  }, [settings]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  // `active` is presentation state (D79e): an inactive list stays usable by id,
  // it just isn't offered here.
  const offered = (lists ?? []).filter((l) => l.active);
  if (offered.length === 0) return <></>;

  const use = async (list: ReplyListSummary): Promise<void> => {
    if (busyId) return;
    setBusyId(list.id);
    setError(null);
    setCopied(false);

    const name = vars.name?.trim().slice(0, MAX_VAR_LEN);
    const handle = vars.handle?.trim().replace(/^@/, '').slice(0, MAX_VAR_LEN);
    const target = targetHandle?.trim().replace(/^@/, '').toLowerCase();

    try {
      const res = await api.replyLists.use(settings, list.id, {
        vars: { ...(name ? { name } : {}), ...(handle ? { handle } : {}) },
        ...(targetTweetId && TWEET_ID_RE.test(targetTweetId) ? { targetTweetId } : {}),
        ...(target && USERNAME_RE.test(target) ? { targetHandle: target } : {}),
      });
      setUsed(res);
      // Straight after the round-trip, still inside the click handler — the
      // panel document is focused, which is what Chrome's clipboard-write gate
      // actually checks. A refusal is never fatal: the item is already spent,
      // so the text stays on screen to copy by hand.
      try {
        await navigator.clipboard.writeText(res.text);
        setCopied(true);
      } catch {
        setCopied(false);
      }
    } catch (e) {
      setError(e instanceof ApiError ? (ERR[e.code] ?? `${e.code} (${e.status})`) : 'Pick failed');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <span className="quick-reply" ref={ref}>
      <button
        type="button"
        className="quick-reply-btn"
        title="Premade replies — one click copies a humanized pick"
        aria-expanded={open}
        onClick={() => {
          setOpen((v) => !v);
          setError(null);
        }}
      >
        canned ▾
      </button>

      {open && (
        <div className="quick-reply-pop">
          {used ? (
            <div className="quick-reply-result">
              <div
                className={`quick-reply-status${copied ? '' : ' quick-reply-status-warn'}`}
                title={copied ? undefined : 'The clipboard refused — select the text and copy it'}
              >
                {copied ? 'Copied ✓ — paste it in X' : 'Copy this by hand:'}
              </div>
              <div className="quick-reply-text">{used.text}</div>
              {used.missingVars.length > 0 && (
                <div className="quick-reply-meta">
                  no {used.missingVars.join(', ')} for this target — the template was trimmed
                </div>
              )}
              <button
                type="button"
                onClick={() => {
                  setUsed(null);
                  setCopied(false);
                }}
              >
                Pick another
              </button>
            </div>
          ) : (
            <ul className="quick-reply-list">
              {offered.map((l) => (
                <li key={l.id}>
                  <button
                    type="button"
                    className="quick-reply-item"
                    disabled={busyId !== null || l.enabledCount === 0}
                    title={
                      l.enabledCount === 0
                        ? 'Nothing switched on in this list'
                        : (l.description ?? l.name)
                    }
                    onClick={() => void use(l)}
                  >
                    <span className="quick-reply-name">{l.name}</span>
                    <span className="quick-reply-meta">
                      {busyId === l.id ? '…' : `${l.enabledCount} on`}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {error && <div className="quick-reply-err">{error}</div>}
        </div>
      )}
    </span>
  );
}
