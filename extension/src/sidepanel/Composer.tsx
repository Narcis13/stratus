import { type FormEvent, type JSX, useCallback, useEffect, useState } from 'react';
import { ApiError, type ScheduledPost, type UpdateBody, api } from './api.ts';
import { isoToLocalInput, localInputToIso } from './datetime.ts';
import type { Settings } from './storage.ts';

interface Props {
  settings: Settings;
  editingId: string | null;
  onClearEdit: () => void;
  onSaved: (post: ScheduledPost) => void;
}

const TWEET_LIMIT = 280;

export function ComposerPanel({
  settings,
  editingId,
  onClearEdit,
  onSaved,
}: Props): JSX.Element {
  const [text, setText] = useState('');
  const [scheduledFor, setScheduledFor] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [original, setOriginal] = useState<ScheduledPost | null>(null);

  const isEditing = editingId !== null;
  const isLocked = original?.status === 'posted';

  const reset = useCallback(() => {
    setText('');
    setScheduledFor('');
    setOriginal(null);
    setError(null);
  }, []);

  useEffect(() => {
    if (!editingId) {
      reset();
      return;
    }
    let alive = true;
    setLoading(true);
    setError(null);
    api
      .list(settings)
      .then((rows) => {
        if (!alive) return;
        const found = rows.find((r) => r.id === editingId);
        if (!found) {
          setError('Post not found');
          return;
        }
        setOriginal(found);
        setText(found.text);
        setScheduledFor(isoToLocalInput(found.scheduledFor));
      })
      .catch((e) => alive && setError(e instanceof ApiError ? e.message : 'Failed to load'))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [editingId, settings, reset]);

  const containsUrl = /(^|\s)https?:\/\//i.test(text);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const iso = localInputToIso(scheduledFor);
      let row: ScheduledPost;
      if (isEditing && original) {
        const patch: UpdateBody = { text: text.trim(), scheduledFor: iso };
        if (original.status === 'draft' && iso) patch.status = 'pending';
        if (original.status === 'pending' && !iso) patch.status = 'draft';
        row = await api.update(settings, original.id, patch);
      } else {
        row = await api.create(settings, {
          text: text.trim(),
          scheduledFor: iso,
          status: iso ? 'pending' : 'draft',
        });
      }
      onSaved(row);
      onClearEdit();
      reset();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Save failed');
    } finally {
      setLoading(false);
    }
  };

  const onDelete = async () => {
    if (!original) return;
    if (!confirm('Delete this post?')) return;
    setLoading(true);
    setError(null);
    try {
      await api.remove(settings, original.id);
      onClearEdit();
      reset();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Delete failed');
    } finally {
      setLoading(false);
    }
  };

  const remaining = TWEET_LIMIT - text.length;

  return (
    <form className="panel" onSubmit={submit}>
      <div className="panel-header">
        <h2>{isEditing ? 'Edit post' : 'New post'}</h2>
        {isEditing && (
          <button type="button" onClick={onClearEdit}>
            New
          </button>
        )}
      </div>

      {original && (
        <div className={`status-line status-${original.status}`}>
          status: <strong>{original.status}</strong>
          {original.postedTweetId && (
            <>
              {' '}
              · tweet <code>{original.postedTweetId}</code>
            </>
          )}
          {original.errorClass && (
            <>
              {' '}
              · error: <code>{original.errorClass}</code>
            </>
          )}
        </div>
      )}

      <label className="field">
        <span>
          Text
          <span className={`counter${remaining < 0 ? ' over' : ''}`}>{remaining}</span>
        </span>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={6}
          maxLength={TWEET_LIMIT * 2}
          placeholder="What are you posting?"
          disabled={isLocked}
        />
      </label>

      {containsUrl && (
        <div className="warn">
          ⚠ URLs in tweet text are billed at $0.20 (13× normal). The server will reject this
          unless explicitly allowed.
        </div>
      )}

      <label className="field">
        <span>Scheduled for (local time)</span>
        <input
          type="datetime-local"
          value={scheduledFor}
          onChange={(e) => setScheduledFor(e.target.value)}
          disabled={isLocked}
        />
        <small className="muted">
          {scheduledFor ? 'Will save as pending and ship at this minute.' : 'Empty → saved as draft.'}
        </small>
      </label>

      {error && <div className="error">{error}</div>}

      <div className="row">
        <button
          type="submit"
          className="primary"
          disabled={loading || isLocked || !text.trim() || remaining < 0}
        >
          {loading ? 'Saving…' : isEditing ? 'Save changes' : 'Save'}
        </button>
        {isEditing && !isLocked && (
          <button type="button" className="danger" onClick={() => void onDelete()} disabled={loading}>
            Delete
          </button>
        )}
      </div>
    </form>
  );
}
