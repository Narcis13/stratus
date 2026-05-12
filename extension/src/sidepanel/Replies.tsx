import { type JSX, useCallback, useEffect, useMemo, useState } from 'react';
import {
  ApiError,
  type RepliesListOpts,
  type ReplyDraft,
  type ReplyDraftStatus,
  api,
} from './api.ts';
import type { Settings } from './storage.ts';

interface Props {
  settings: Settings;
}

const LIST_LIMIT = 100;
const STATUS_OPTIONS: { value: '' | ReplyDraftStatus; label: string }[] = [
  { value: '', label: 'All' },
  { value: 'generated', label: 'Generated' },
  { value: 'copied', label: 'Copied' },
  { value: 'posted', label: 'Posted' },
  { value: 'discarded', label: 'Discarded' },
];

export function RepliesPanel({ settings }: Props): JSX.Element {
  const [rows, setRows] = useState<ReplyDraft[]>([]);
  const [statusFilter, setStatusFilter] = useState<'' | ReplyDraftStatus>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const opts: RepliesListOpts = { limit: LIST_LIMIT };
      if (statusFilter) opts.status = statusFilter;
      const out = await api.replies.list(settings, opts);
      setRows(out);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to load replies');
    } finally {
      setLoading(false);
    }
  }, [settings, statusFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  const counts = useMemo(() => {
    const c: Record<ReplyDraftStatus, number> = {
      generated: 0,
      copied: 0,
      posted: 0,
      discarded: 0,
    };
    for (const r of rows) c[r.status] += 1;
    return c;
  }, [rows]);

  return (
    <div className="panel">
      <div className="panel-header">
        <h2>Reply Master</h2>
        <button type="button" onClick={() => void load()} disabled={loading}>
          {loading ? 'Loading…' : 'Refresh'}
        </button>
      </div>

      {error && <div className="error">{error}</div>}

      <div className="voice-controls">
        <label className="field">
          <span>Status</span>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as '' | ReplyDraftStatus)}
            disabled={loading}
          >
            {STATUS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <div className="status-line">
          {rows.length} shown · {counts.generated} gen · {counts.copied} copied · {counts.posted}{' '}
          posted · {counts.discarded} discarded
        </div>
      </div>

      {loading && rows.length === 0 ? (
        <p className="muted">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="muted">
          No reply drafts yet. Generate one with <code>curl -X POST /x/replies/generate</code> or
          via the content-script button (next phase).
        </p>
      ) : (
        <ul className="voice-tweet-list">
          {rows.map((r) => (
            <li key={r.id}>
              <ReplyRow draft={r} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ReplyRow({ draft }: { draft: ReplyDraft }): JSX.Element {
  const finalText = draft.replyTextEdited ?? draft.replyText;
  const created = new Date(draft.createdAt);
  const cost = draft.costUsd ? `$${Number(draft.costUsd).toFixed(4)}` : null;
  return (
    <a className="voice-tweet" href={draft.sourceUrl} target="_blank" rel="noreferrer">
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
    </a>
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
