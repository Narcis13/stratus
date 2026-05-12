import { type JSX, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ApiError,
  type RepliesListOpts,
  type ReplyDraft,
  type ReplyDraftStatus,
  api,
} from './api.ts';
import {
  clearLastDraft,
  setLastDraft,
  useLastDraft,
  useSystemPromptOverride,
} from './replyMasterStorage.ts';
import type { Settings } from './storage.ts';

interface Props {
  settings: Settings;
}

const LIST_LIMIT = 50;
const TWEET_LIMIT = 280;
const EDIT_DEBOUNCE_MS = 600;
const SYSTEM_PROMPT_DEBOUNCE_MS = 600;
const TWEET_ID_RE = /^\d{1,32}$/;

const STATUS_OPTIONS: { value: '' | ReplyDraftStatus; label: string }[] = [
  { value: '', label: 'All' },
  { value: 'generated', label: 'Generated' },
  { value: 'copied', label: 'Copied' },
  { value: 'posted', label: 'Posted' },
  { value: 'discarded', label: 'Discarded' },
];

export function RepliesPanel({ settings }: Props): JSX.Element {
  const { draft: storageDraft, refresh: refreshStorage } = useLastDraft();
  const {
    value: systemPromptOverride,
    loading: systemPromptLoading,
    save: saveSystemPrompt,
  } = useSystemPromptOverride();
  const [activeDraft, setActiveDraft] = useState<ReplyDraft | null>(null);
  const [history, setHistory] = useState<ReplyDraft[]>([]);
  const [statusFilter, setStatusFilter] = useState<'' | ReplyDraftStatus>('');
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [historyError, setHistoryError] = useState<string | null>(null);

  // Swap the editor to whatever the content script just dropped into storage.
  // We don't auto-swap when the user has clicked a non-active history row
  // unless the storage key changes — track which id we showed last.
  const lastShownStorageId = useRef<string | null>(null);
  useEffect(() => {
    if (!storageDraft) {
      if (lastShownStorageId.current && activeDraft?.id === lastShownStorageId.current) {
        setActiveDraft(null);
      }
      lastShownStorageId.current = null;
      return;
    }
    if (storageDraft.id !== lastShownStorageId.current) {
      lastShownStorageId.current = storageDraft.id;
      setActiveDraft(storageDraft);
    }
  }, [storageDraft, activeDraft]);

  const loadHistory = useCallback(async () => {
    setLoadingHistory(true);
    setHistoryError(null);
    try {
      const opts: RepliesListOpts = { limit: LIST_LIMIT };
      if (statusFilter) opts.status = statusFilter;
      const rows = await api.replies.list(settings, opts);
      setHistory(rows);
    } catch (e) {
      setHistoryError(e instanceof ApiError ? e.message : 'Failed to load history');
    } finally {
      setLoadingHistory(false);
    }
  }, [settings, statusFilter]);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  const onDraftChanged = useCallback(async (next: ReplyDraft) => {
    setActiveDraft(next);
    setHistory((prev) => {
      const found = prev.findIndex((r) => r.id === next.id);
      if (found === -1) return [next, ...prev];
      const copy = prev.slice();
      copy[found] = next;
      return copy;
    });
    if (lastShownStorageId.current === next.id) {
      await setLastDraft(next);
    }
  }, []);

  const onDraftDiscarded = useCallback(async (id: string) => {
    setActiveDraft(null);
    setHistory((prev) => prev.filter((r) => r.id !== id));
    if (lastShownStorageId.current === id) {
      await clearLastDraft();
      lastShownStorageId.current = null;
    }
  }, []);

  const onRegenerated = useCallback(async (next: ReplyDraft) => {
    setActiveDraft(next);
    setHistory((prev) => [next, ...prev]);
    lastShownStorageId.current = next.id;
    await setLastDraft(next);
  }, []);

  const counts = useMemo(() => {
    const c: Record<ReplyDraftStatus, number> = {
      generated: 0,
      copied: 0,
      posted: 0,
      discarded: 0,
    };
    for (const r of history) c[r.status] += 1;
    return c;
  }, [history]);

  const openFromHistory = (row: ReplyDraft): void => {
    setActiveDraft(row);
  };

  return (
    <div className="panel">
      <div className="panel-header">
        <h2>Reply Master</h2>
        <button type="button" onClick={() => void loadHistory()} disabled={loadingHistory}>
          {loadingHistory ? 'Loading…' : 'Refresh'}
        </button>
      </div>

      {!activeDraft && (
        <p className="muted">
          Open a tweet on x.com and click <strong>🪄 Reply Master</strong> to start a draft. The
          generated text is copied to your clipboard automatically.
        </p>
      )}

      {activeDraft && (
        <DraftEditor
          key={activeDraft.id}
          draft={activeDraft}
          settings={settings}
          isLive={lastShownStorageId.current === activeDraft.id}
          systemPromptOverride={systemPromptOverride}
          onChanged={onDraftChanged}
          onDiscarded={onDraftDiscarded}
          onRegenerated={onRegenerated}
          onClear={() => {
            void (async () => {
              await refreshStorage();
              if (lastShownStorageId.current === activeDraft.id) {
                await clearLastDraft();
                lastShownStorageId.current = null;
              }
              setActiveDraft(null);
            })();
          }}
        />
      )}

      <SystemPromptOverride
        value={systemPromptOverride}
        loading={systemPromptLoading}
        onSave={saveSystemPrompt}
      />

      <div className="reply-history">
        <div className="panel-header">
          <h2>History</h2>
        </div>
        {historyError && <div className="error">{historyError}</div>}
        <div className="voice-controls">
          <label className="field">
            <span>Status</span>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as '' | ReplyDraftStatus)}
              disabled={loadingHistory}
            >
              {STATUS_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <div className="status-line">
            {history.length} shown · {counts.generated} gen · {counts.copied} copied ·{' '}
            {counts.posted} posted · {counts.discarded} discarded
          </div>
        </div>

        {loadingHistory && history.length === 0 ? (
          <p className="muted">Loading…</p>
        ) : history.length === 0 ? (
          <p className="muted">No reply drafts yet.</p>
        ) : (
          <ul className="voice-tweet-list">
            {history.map((r) => (
              <li key={r.id}>
                <HistoryRow
                  draft={r}
                  active={activeDraft?.id === r.id}
                  onOpen={() => openFromHistory(r)}
                />
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

interface EditorProps {
  draft: ReplyDraft;
  settings: Settings;
  isLive: boolean;
  systemPromptOverride: string;
  onChanged: (row: ReplyDraft) => void | Promise<void>;
  onDiscarded: (id: string) => void | Promise<void>;
  onRegenerated: (row: ReplyDraft) => void | Promise<void>;
  onClear: () => void;
}

function DraftEditor({
  draft,
  settings,
  isLive,
  systemPromptOverride,
  onChanged,
  onDiscarded,
  onRegenerated,
  onClear,
}: EditorProps): JSX.Element {
  const initialText = draft.replyTextEdited ?? draft.replyText;
  const [text, setText] = useState(initialText);
  const [busy, setBusy] = useState<null | 'copy' | 'regen' | 'posted' | 'discard' | 'patch'>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [postedInputOpen, setPostedInputOpen] = useState(false);
  const [postedTweetIdInput, setPostedTweetIdInput] = useState('');
  const lastPatchedTextRef = useRef<string>(initialText);

  // Debounced PATCH whenever the user edits the textarea. We only PATCH if the
  // text actually differs from the row we last sent — avoids a redundant write
  // when a status-only update arrives from elsewhere.
  useEffect(() => {
    const current = text;
    if (current === lastPatchedTextRef.current) return;
    // Track raw Grok output for parity with replyText; if user types it back
    // to exactly the original output, clear the override.
    const desired: string | null = current === draft.replyText ? null : current;
    const t = setTimeout(() => {
      void (async () => {
        setBusy('patch');
        setError(null);
        try {
          const row = await api.replies.patch(settings, draft.id, { replyTextEdited: desired });
          lastPatchedTextRef.current = current;
          await onChanged(row);
        } catch (e) {
          setError(e instanceof ApiError ? e.message : 'Save failed');
        } finally {
          setBusy(null);
        }
      })();
    }, EDIT_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [text, draft.id, draft.replyText, settings, onChanged]);

  const remaining = TWEET_LIMIT - text.length;
  const ctx = draft.contextSnapshot;
  const cost = draft.costUsd ? `$${Number(draft.costUsd).toFixed(4)}` : null;
  const isTerminal = draft.status === 'posted' || draft.status === 'discarded';

  const onCopy = async (): Promise<void> => {
    setBusy('copy');
    setError(null);
    setInfo(null);
    try {
      await navigator.clipboard.writeText(text);
      setInfo('Copied to clipboard');
      // Bump status to 'copied' if still 'generated' — terminal states stay put.
      if (draft.status === 'generated') {
        const row = await api.replies.patch(settings, draft.id, { status: 'copied' });
        await onChanged(row);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Copy failed');
    } finally {
      setBusy(null);
      setTimeout(() => setInfo(null), 2500);
    }
  };

  const onRegenerate = async (): Promise<void> => {
    setBusy('regen');
    setError(null);
    setInfo(null);
    try {
      // Prefer the current panel-level override over whatever was used when
      // the draft was first generated — user expects the textarea they're
      // looking at to steer the next call.
      const override =
        systemPromptOverride.trim() !== '' ? systemPromptOverride : draft.systemPromptOverride;
      const next = await api.replies.generate(settings, {
        context: ctx,
        ...(override ? { systemPromptOverride: override } : {}),
      });
      await onRegenerated(next);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Regenerate failed');
    } finally {
      setBusy(null);
    }
  };

  const openPostedInput = (): void => {
    setPostedInputOpen(true);
    setPostedTweetIdInput('');
  };

  const onMarkPosted = async (): Promise<void> => {
    setBusy('posted');
    setError(null);
    setInfo(null);
    const trimmed = postedTweetIdInput.trim();
    let postedTweetId: string | null = null;
    if (trimmed !== '') {
      const fromUrl = trimmed.match(/\/status\/(\d+)/);
      const candidate = fromUrl?.[1] ?? trimmed;
      if (!TWEET_ID_RE.test(candidate)) {
        setError('Posted tweet id must be numeric or a /status/<id> URL');
        setBusy(null);
        return;
      }
      postedTweetId = candidate;
    }
    try {
      const row = await api.replies.patch(settings, draft.id, {
        status: 'posted',
        ...(postedTweetId ? { postedTweetId } : {}),
      });
      await onChanged(row);
      setPostedInputOpen(false);
      setPostedTweetIdInput('');
      setInfo('Marked posted');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Mark posted failed');
    } finally {
      setBusy(null);
    }
  };

  const onDiscard = async (): Promise<void> => {
    if (!confirm('Discard this draft? This deletes the row.')) return;
    setBusy('discard');
    setError(null);
    try {
      await api.replies.remove(settings, draft.id);
      await onDiscarded(draft.id);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Discard failed');
      setBusy(null);
    }
  };

  return (
    <div className="reply-editor">
      <div className="reply-capture">
        <div className="reply-capture-head">
          <span className={`badge ${badgeClassFor(draft.status)}`}>{draft.status}</span>
          <span>
            Drafted from <strong>@{draft.sourceAuthorUsername}</strong>
          </span>
          <span className="muted">· {relativeTime(draft.createdAt)}</span>
          {isLive && <span className="badge badge-pending">live</span>}
          <button type="button" className="reply-link" onClick={onClear}>
            Clear
          </button>
        </div>
      </div>

      <details className="reply-context">
        <summary>
          Context:{' '}
          {ctx.text ? `"${ctx.text.slice(0, 80)}${ctx.text.length > 80 ? '…' : ''}"` : '(empty)'}
        </summary>
        <div className="reply-context-body">
          <div>
            <strong>{ctx.author}</strong> <span className="muted">@{ctx.handle}</span>
          </div>
          <div className="reply-context-text">{ctx.text}</div>
          <div className="reply-context-meta">
            ♥ {ctx.metrics.likes} · ↩ {ctx.metrics.replies} · ↻ {ctx.metrics.reposts} · 👁{' '}
            {ctx.metrics.views}
            {ctx.topComments.length > 0 && <> · {ctx.topComments.length} top reply(ies)</>}
          </div>
          {ctx.topComments.length > 0 && (
            <ul className="reply-context-comments">
              {ctx.topComments.map((c, i) => (
                <li key={`${c.handle}-${i}`}>
                  <strong>@{c.handle.replace(/^@/, '')}:</strong> {c.text}
                </li>
              ))}
            </ul>
          )}
          <a className="muted" href={draft.sourceUrl} target="_blank" rel="noreferrer">
            Open on x.com →
          </a>
        </div>
      </details>

      <label className="field">
        <span>
          Reply
          <span className={`counter${remaining < 0 ? ' over' : ''}`}>{remaining}</span>
        </span>
        <textarea
          className="reply-textarea"
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={5}
          disabled={isTerminal}
          spellCheck
        />
        <small className="muted">
          {draft.model}
          {cost && <> · {cost}</>}
          {draft.replyTextEdited !== null && ' · edited'}
          {busy === 'patch' && ' · saving…'}
        </small>
      </label>

      {error && <div className="error">{error}</div>}
      {info && <div className="ok">{info}</div>}

      <div className="row reply-toolbar">
        <button
          type="button"
          className="primary"
          onClick={() => void onCopy()}
          disabled={busy !== null}
        >
          {busy === 'copy' ? 'Copying…' : 'Copy'}
        </button>
        <button type="button" onClick={() => void onRegenerate()} disabled={busy !== null}>
          {busy === 'regen' ? 'Regenerating…' : 'Regenerate'}
        </button>
        {!postedInputOpen ? (
          <button
            type="button"
            onClick={openPostedInput}
            disabled={busy !== null || draft.status === 'posted' || draft.status === 'discarded'}
          >
            Mark posted
          </button>
        ) : (
          <button type="button" onClick={() => setPostedInputOpen(false)} disabled={busy !== null}>
            Cancel
          </button>
        )}
        <button
          type="button"
          className="danger"
          onClick={() => void onDiscard()}
          disabled={busy !== null || draft.status === 'discarded'}
        >
          {busy === 'discard' ? 'Discarding…' : 'Discard'}
        </button>
      </div>

      {postedInputOpen && (
        <div className="reply-posted-input">
          <label className="field">
            <span>Posted tweet URL or id (optional)</span>
            <input
              type="text"
              placeholder="https://x.com/me/status/1234… or 1234…"
              value={postedTweetIdInput}
              onChange={(e) => setPostedTweetIdInput(e.target.value)}
              spellCheck={false}
            />
          </label>
          <div className="row">
            <button
              type="button"
              className="primary"
              onClick={() => void onMarkPosted()}
              disabled={busy !== null}
            >
              {busy === 'posted' ? 'Saving…' : 'Confirm posted'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function SystemPromptOverride({
  value,
  loading,
  onSave,
}: {
  value: string;
  loading: boolean;
  onSave: (next: string) => Promise<void>;
}): JSX.Element {
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const lastSavedRef = useRef(value);

  // Re-sync if storage changed elsewhere (other panel, settings reset).
  useEffect(() => {
    setDraft(value);
    lastSavedRef.current = value;
  }, [value]);

  // Debounced persist. Empty string clears the key entirely (see storage helper).
  useEffect(() => {
    if (loading) return;
    if (draft === lastSavedRef.current) return;
    const t = setTimeout(() => {
      void (async () => {
        setSaving(true);
        try {
          await onSave(draft);
          lastSavedRef.current = draft;
          setSaved(true);
          setTimeout(() => setSaved(false), 1500);
        } finally {
          setSaving(false);
        }
      })();
    }, SYSTEM_PROMPT_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [draft, loading, onSave]);

  const active = draft.trim() !== '';

  return (
    <details className="reply-context reply-system-prompt">
      <summary>
        System prompt override{' '}
        {active ? (
          <span className="badge badge-pending">active</span>
        ) : (
          <span className="muted">(empty — using default)</span>
        )}
      </summary>
      <div className="reply-context-body">
        <p className="muted" style={{ margin: 0 }}>
          Replaces the default Grok system prompt on every generation (side panel and the page
          button). Leave empty to use the server default.
        </p>
        <textarea
          className="reply-textarea"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={6}
          placeholder="e.g. Reply like a terse engineer. No emoji. ≤ 240 chars."
          disabled={loading}
          spellCheck
        />
        <small className="muted">
          {saving ? 'saving…' : saved ? 'saved' : `${draft.length} chars`}
        </small>
      </div>
    </details>
  );
}

function HistoryRow({
  draft,
  active,
  onOpen,
}: {
  draft: ReplyDraft;
  active: boolean;
  onOpen: () => void;
}): JSX.Element {
  const finalText = draft.replyTextEdited ?? draft.replyText;
  const created = new Date(draft.createdAt);
  const cost = draft.costUsd ? `$${Number(draft.costUsd).toFixed(4)}` : null;
  return (
    <button
      type="button"
      className={`voice-tweet reply-history-row${active ? ' reply-history-row-active' : ''}`}
      onClick={onOpen}
    >
      <div className="voice-tweet-head">
        <span className="voice-tweet-author">@{draft.sourceAuthorUsername}</span>
        <span className={`badge ${badgeClassFor(draft.status)}`}>{draft.status}</span>
        {draft.replyTextEdited !== null && <span className="badge badge-draft">edited</span>}
        <span className="voice-tweet-time">
          {created.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
        </span>
      </div>
      <div className="voice-tweet-text">
        <strong>Source:</strong> {draft.sourceText || <em className="muted">(no text)</em>}
      </div>
      <div className="voice-tweet-text">
        <strong>Reply:</strong> {finalText}
      </div>
      <div className="voice-tweet-metrics">
        <span>{draft.model}</span>
        {cost && <span>{cost}</span>}
        {draft.postedTweetId && <span>posted #{draft.postedTweetId}</span>}
      </div>
    </button>
  );
}

function badgeClassFor(status: ReplyDraftStatus): string {
  switch (status) {
    case 'generated':
      return 'badge-draft';
    case 'copied':
      return 'badge-pending';
    case 'posted':
      return 'badge-posted';
    case 'discarded':
      return 'badge-cancelled';
  }
}

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const secs = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (secs < 60) return `${secs}s ago`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86_400) return `${Math.floor(secs / 3600)}h ago`;
  return new Date(iso).toLocaleDateString();
}
