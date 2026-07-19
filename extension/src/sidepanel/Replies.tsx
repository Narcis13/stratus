import { type JSX, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ApiError,
  type Idea,
  type RepliesListOpts,
  type ReplyDraft,
  type ReplyDraftStatus,
  api,
} from './api.ts';
import {
  clearLastDraft,
  setLastDraft,
  useIdea,
  useIdeaId,
  useLastDraft,
  useSystemPromptOverride,
} from './replyMasterStorage.ts';
import type { Settings } from './storage.ts';

interface Props {
  settings: Settings;
  /** C1: open a handle's dossier in the People tab. */
  onOpenPerson: (handle: string) => void;
}

const LIST_LIMIT = 100;
const TWEET_LIMIT = 280;
const EDIT_DEBOUNCE_MS = 600;
const SYSTEM_PROMPT_DEBOUNCE_MS = 600;
const TWEET_ID_RE = /^\d{1,32}$/;
const GROUP_PAGE_SIZE = 10;
const POSTED_AUTO_CLEAR_MS = 700;

const STATUS_OPTIONS: { value: '' | ReplyDraftStatus; label: string }[] = [
  { value: '', label: 'All' },
  { value: 'generated', label: 'Generated' },
  { value: 'copied', label: 'Copied' },
  { value: 'posted', label: 'Posted' },
  { value: 'discarded', label: 'Discarded' },
];

export function RepliesPanel({ settings, onOpenPerson }: Props): JSX.Element {
  const { draft: storageDraft, refresh: refreshStorage } = useLastDraft();
  const {
    value: systemPromptOverride,
    loading: systemPromptLoading,
    save: saveSystemPrompt,
  } = useSystemPromptOverride();
  const { value: idea, loading: ideaLoading, save: saveIdea } = useIdea();
  // C6: when the steer was picked from the Idea Inbox, its id rides along so
  // the server consumes the row on the next generate.
  const { value: ideaId, save: saveIdeaId } = useIdeaId();
  const [openIdeas, setOpenIdeas] = useState<Idea[]>([]);
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

  const loadOpenIdeas = useCallback(() => {
    api.ideas
      .list(settings, { status: 'open' })
      .then(setOpenIdeas)
      .catch(() => {
        /* dropdown just stays empty; free-typing still works */
      });
  }, [settings]);

  useEffect(() => {
    loadOpenIdeas();
  }, [loadOpenIdeas]);

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

      <IdeaSteer
        value={idea}
        loading={ideaLoading}
        onSave={saveIdea}
        openIdeas={openIdeas}
        selectedId={ideaId}
        onSelect={(picked) => {
          void saveIdea(picked?.text ?? '');
          void saveIdeaId(picked?.id ?? null);
        }}
        onClearId={() => void saveIdeaId(null)}
      />

      {activeDraft && (
        <DraftEditor
          key={activeDraft.id}
          draft={activeDraft}
          settings={settings}
          onOpenPerson={onOpenPerson}
          isLive={lastShownStorageId.current === activeDraft.id}
          systemPromptOverride={systemPromptOverride}
          idea={idea}
          ideaId={ideaId}
          onIdeaConsumed={async () => {
            await saveIdea('');
            await saveIdeaId(null);
            loadOpenIdeas();
          }}
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
        settings={settings}
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
          <HistoryGroups
            history={history}
            activeId={activeDraft?.id ?? null}
            onOpen={openFromHistory}
          />
        )}
      </div>
    </div>
  );
}

interface EditorProps {
  draft: ReplyDraft;
  settings: Settings;
  onOpenPerson: (handle: string) => void;
  isLive: boolean;
  systemPromptOverride: string;
  idea: string;
  ideaId: string | null;
  onIdeaConsumed: () => void | Promise<void>;
  onChanged: (row: ReplyDraft) => void | Promise<void>;
  onDiscarded: (id: string) => void | Promise<void>;
  onRegenerated: (row: ReplyDraft) => void | Promise<void>;
  onClear: () => void;
}

function DraftEditor({
  draft,
  settings,
  onOpenPerson,
  isLive,
  systemPromptOverride,
  idea,
  ideaId,
  onIdeaConsumed,
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
      const steer = idea.trim();
      const next = await api.replies.generate(settings, {
        context: ctx,
        ...(override ? { systemPromptOverride: override } : {}),
        ...(steer !== '' ? { idea: steer } : {}),
        ...(steer !== '' && ideaId ? { ideaId } : {}),
      });
      await onRegenerated(next);
      if (steer !== '') await onIdeaConsumed();
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
      // Brief delay lets the success message register, then close the editor
      // so the user is ready for the next tweet.
      setTimeout(onClear, POSTED_AUTO_CLEAR_MS);
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
            Drafted from{' '}
            <button
              type="button"
              className="person-link"
              title="Open dossier"
              onClick={() => onOpenPerson(draft.sourceAuthorUsername)}
            >
              <strong>@{draft.sourceAuthorUsername}</strong>
            </button>
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
          {draft.idea && (
            <div className="muted">
              <strong>Steer:</strong> {draft.idea}
            </div>
          )}
          <a className="muted" href={draft.sourceUrl} target="_blank" rel="noreferrer">
            Open on x.com →
          </a>
        </div>
      </details>

      {draft.variants && draft.variants.length > 1 && (
        <div className="reply-variants">
          {draft.variants.map((v, i) => (
            <button
              key={`${v.angle}-${i}`}
              type="button"
              className={`reply-variant${text === v.text ? ' active' : ''}`}
              onClick={() => setText(v.text)}
              disabled={isTerminal || busy !== null}
              title={v.text}
            >
              V{i + 1} · {v.angle}
            </button>
          ))}
        </div>
      )}

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

// The per-tweet steer. Persisted to chrome.storage so the page button picks it
// up; consumed (cleared) by whichever surface fires the generate it steered.
// C6: open Idea Inbox rows feed a dropdown above the textarea — picking one
// links its id (server-side consume on generate); free-typing stays allowed
// and emptying the box drops the link.
function IdeaSteer({
  value,
  loading,
  onSave,
  openIdeas,
  selectedId,
  onSelect,
  onClearId,
}: {
  value: string;
  loading: boolean;
  onSave: (next: string) => Promise<void>;
  openIdeas: Idea[];
  selectedId: string | null;
  onSelect: (picked: Idea | null) => void;
  onClearId: () => void;
}): JSX.Element {
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);
  const lastSavedRef = useRef(value);

  // Re-sync when storage changes elsewhere — most importantly when the content
  // script consumes the idea after a successful generate.
  useEffect(() => {
    setDraft(value);
    lastSavedRef.current = value;
  }, [value]);

  useEffect(() => {
    if (loading) return;
    if (draft === lastSavedRef.current) return;
    const t = setTimeout(() => {
      void (async () => {
        setSaving(true);
        try {
          await onSave(draft);
          lastSavedRef.current = draft;
          if (draft.trim() === '') onClearId();
        } finally {
          setSaving(false);
        }
      })();
    }, SYSTEM_PROMPT_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [draft, loading, onSave, onClearId]);

  return (
    <div className="reply-idea">
      {openIdeas.length > 0 && (
        <label className="field">
          <span>Seed from Idea Inbox</span>
          <select
            value={selectedId ?? ''}
            onChange={(e) => {
              const id = e.target.value;
              onSelect(id === '' ? null : (openIdeas.find((i) => i.id === id) ?? null));
            }}
            disabled={loading}
          >
            <option value="">— free-typed / none —</option>
            {openIdeas.map((i) => (
              <option key={i.id} value={i.id}>
                {i.text.length > 80 ? `${i.text.slice(0, 79)}…` : i.text}
              </option>
            ))}
          </select>
        </label>
      )}
      <label className="field">
        <span>
          Idea steer{' '}
          <span className="muted">(optional — used on the next generate, then cleared)</span>
        </span>
        <textarea
          className="reply-textarea"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={2}
          placeholder="Seed for the next draft — Romanian is fine, the reply comes out in English."
          disabled={loading}
          spellCheck
        />
        {saving && <small className="muted">saving…</small>}
      </label>
    </div>
  );
}

function SystemPromptOverride({
  settings,
  value,
  loading,
  onSave,
}: {
  settings: Settings;
  value: string;
  loading: boolean;
  onSave: (next: string) => Promise<void>;
}): JSX.Element {
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const lastSavedRef = useRef(value);

  // The default prompt is fetched lazily the first time the user opens the viewer.
  const [defaultPrompt, setDefaultPrompt] = useState<string | null>(null);
  const [defaultLoading, setDefaultLoading] = useState(false);
  const [defaultError, setDefaultError] = useState<string | null>(null);
  const [viewerOpen, setViewerOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const openViewer = useCallback(() => {
    setViewerOpen(true);
    if (defaultPrompt !== null || defaultLoading) return;
    setDefaultLoading(true);
    setDefaultError(null);
    void (async () => {
      try {
        const res = await api.replies.defaultPrompt(settings);
        setDefaultPrompt(res.prompt);
      } catch (e) {
        setDefaultError(e instanceof Error ? e.message : 'Failed to load default prompt.');
      } finally {
        setDefaultLoading(false);
      }
    })();
  }, [settings, defaultPrompt, defaultLoading]);

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
        <div className="reply-toolbar voice-controls">
          <button type="button" onClick={openViewer}>
            View default prompt
          </button>
        </div>
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

      {viewerOpen && (
        <PromptViewer
          prompt={defaultPrompt}
          loading={defaultLoading}
          error={defaultError}
          copied={copied}
          onCopy={() => {
            if (defaultPrompt === null) return;
            void navigator.clipboard.writeText(defaultPrompt).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            });
          }}
          onUseAsStart={() => {
            if (defaultPrompt === null) return;
            setDraft(defaultPrompt);
            setViewerOpen(false);
          }}
          onClose={() => setViewerOpen(false)}
        />
      )}
    </details>
  );
}

function PromptViewer({
  prompt,
  loading,
  error,
  copied,
  onCopy,
  onUseAsStart,
  onClose,
}: {
  prompt: string | null;
  loading: boolean;
  error: string | null;
  copied: boolean;
  onCopy: () => void;
  onUseAsStart: () => void;
  onClose: () => void;
}): JSX.Element {
  return (
    <div
      className="modal-backdrop"
      onClick={onClose}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose();
      }}
      role="presentation"
    >
      <dialog
        open
        className="modal-card"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onClose();
        }}
        aria-modal="true"
        aria-label="Default reply system prompt"
      >
        <div className="modal-header">
          <h3>Default reply system prompt</h3>
          <button type="button" onClick={onClose}>
            ✕
          </button>
        </div>
        {loading && <p className="muted">Loading…</p>}
        {error && <div className="error">{error}</div>}
        {prompt !== null && <pre className="prompt-view">{prompt}</pre>}
        <div className="reply-toolbar voice-controls">
          <button type="button" onClick={onCopy} disabled={prompt === null}>
            {copied ? 'Copied' : 'Copy'}
          </button>
          <button type="button" onClick={onUseAsStart} disabled={prompt === null}>
            Use as starting point
          </button>
        </div>
      </dialog>
    </div>
  );
}

interface DayGroup {
  key: string;
  label: string;
  rows: ReplyDraft[];
}

function HistoryGroups({
  history,
  activeId,
  onOpen,
}: {
  history: ReplyDraft[];
  activeId: string | null;
  onOpen: (row: ReplyDraft) => void;
}): JSX.Element {
  const groups = useMemo<DayGroup[]>(() => {
    const map = new Map<string, DayGroup>();
    for (const r of history) {
      const d = new Date(r.createdAt);
      const key = dayKeyOf(d);
      const existing = map.get(key);
      if (existing) {
        existing.rows.push(r);
      } else {
        map.set(key, { key, label: dayLabelOf(d, key), rows: [r] });
      }
    }
    // Newest day first (API returns newest first, so insertion order is right).
    return Array.from(map.values());
  }, [history]);

  const todayKey = dayKeyOf(new Date());

  return (
    <div className="reply-history-groups">
      {groups.map((g) => (
        <HistoryGroup
          key={g.key}
          group={g}
          defaultOpen={g.key === todayKey}
          activeId={activeId}
          onOpen={onOpen}
        />
      ))}
    </div>
  );
}

function HistoryGroup({
  group,
  defaultOpen,
  activeId,
  onOpen,
}: {
  group: DayGroup;
  defaultOpen: boolean;
  activeId: string | null;
  onOpen: (row: ReplyDraft) => void;
}): JSX.Element {
  const [open, setOpen] = useState(defaultOpen);
  const [visibleCount, setVisibleCount] = useState(GROUP_PAGE_SIZE);

  // If the active draft is in this group, force-open it so the user sees the
  // highlight even on older days.
  const containsActive = activeId !== null && group.rows.some((r) => r.id === activeId);
  const effectiveOpen = open || containsActive;

  const visible = group.rows.slice(0, visibleCount);
  const remaining = group.rows.length - visible.length;

  return (
    <section className="reply-history-group">
      <button
        type="button"
        className="reply-history-group-head"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={effectiveOpen}
      >
        <span className="reply-history-group-caret">{effectiveOpen ? '▾' : '▸'}</span>
        <span className="reply-history-group-label">{group.label}</span>
        <span className="reply-history-group-count">{group.rows.length}</span>
      </button>
      {effectiveOpen && (
        <ul className="voice-tweet-list">
          {visible.map((r) => (
            <li key={r.id}>
              <HistoryRow draft={r} active={activeId === r.id} onOpen={() => onOpen(r)} />
            </li>
          ))}
          {remaining > 0 && (
            <li>
              <button
                type="button"
                className="reply-link reply-history-more"
                onClick={() => setVisibleCount((n) => n + GROUP_PAGE_SIZE)}
              >
                Show {Math.min(remaining, GROUP_PAGE_SIZE)} more
                {remaining > GROUP_PAGE_SIZE ? ` (${remaining} hidden)` : ''}
              </button>
            </li>
          )}
        </ul>
      )}
    </section>
  );
}

function dayKeyOf(d: Date): string {
  // Local-day key so "Today" matches the user's calendar, not UTC.
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function dayLabelOf(d: Date, key: string): string {
  const now = new Date();
  if (key === dayKeyOf(now)) return 'Today';
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (key === dayKeyOf(yesterday)) return 'Yesterday';
  const sameYear = d.getFullYear() === now.getFullYear();
  return d.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
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
