import { type FormEvent, type JSX, useCallback, useEffect, useState } from 'react';
import type { PostPillar } from '../shared/types.ts';
import {
  ApiError,
  type ScheduledPost,
  type ScheduledPostWithThread,
  type UpdateBody,
  api,
} from './api.ts';
import { isoToLocalInput, localInputToIso } from './datetime.ts';
import type { Settings } from './storage.ts';

interface Props {
  settings: Settings;
  editingId: string | null;
  /** §8.3 → §8.1: a swipe-file tweet whose structure the drafter should remix. */
  remixTweetId: string | null;
  onClearRemix: () => void;
  onClearEdit: () => void;
  onSaved: (post: ScheduledPost) => void;
}

const TWEET_LIMIT = 280;
const URL_RE = /(^|\s)https?:\/\//i;
// Matches each URL for the move-link-to-reply affordance (§8.2).
const URL_EXTRACT_RE = /https?:\/\/\S+/g;

const PILLARS: Array<{ value: PostPillar | ''; label: string }> = [
  { value: '', label: 'any pillar (Grok declares)' },
  { value: 'ai-craft', label: 'ai-craft — AI-native craft' },
  { value: 'builder-51', label: 'builder-51 — the 51-year-old builder' },
  { value: 'unsexy-problems', label: 'unsexy-problems — real SMB/public-system problems' },
];

export function ComposerPanel({
  settings,
  editingId,
  remixTweetId,
  onClearRemix,
  onClearEdit,
  onSaved,
}: Props): JSX.Element {
  const [threadMode, setThreadMode] = useState(false);
  const [text, setText] = useState('');
  const [segments, setSegments] = useState<string[]>(['', '']);
  const [scheduledFor, setScheduledFor] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [original, setOriginal] = useState<ScheduledPostWithThread | null>(null);
  const [thread, setThread] = useState<ScheduledPost[]>([]);

  // Drafter (§8.1)
  const [idea, setIdea] = useState('');
  const [pillar, setPillar] = useState<PostPillar | ''>('');
  const [drafting, setDrafting] = useState(false);

  const isEditing = editingId !== null;
  const isThreadEdit = isEditing && original?.threadId != null;
  const isLocked = original?.status === 'posted' || original?.status === 'publishing';

  const reset = useCallback(() => {
    setThreadMode(false);
    setText('');
    setSegments(['', '']);
    setScheduledFor('');
    setOriginal(null);
    setThread([]);
    setError(null);
    setNotice(null);
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
      .get(settings, editingId)
      .then((row) => {
        if (!alive) return;
        setOriginal(row);
        setText(row.text);
        if (row.thread && row.thread.length > 0) {
          setThread(row.thread);
          const head = row.thread.find((s) => s.threadPosition === 1) ?? row.thread[0];
          setScheduledFor(isoToLocalInput(head?.scheduledFor ?? null));
        } else {
          setScheduledFor(isoToLocalInput(row.scheduledFor));
        }
      })
      .catch((e) => alive && setError(e instanceof ApiError ? e.message : 'Failed to load'))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [editingId, settings, reset]);

  const headHasUrl = threadMode ? URL_RE.test(segments[0] ?? '') : URL_RE.test(text);

  // §8.2 affordance: a link in tweet 1 costs $0.20; in the first reply, $0.015.
  const moveLinkToReply = (): void => {
    const urls = text.match(URL_EXTRACT_RE) ?? [];
    if (urls.length === 0) return;
    const stripped = text
      .replace(URL_EXTRACT_RE, '')
      .replace(/[ \t]+/g, ' ')
      .trim();
    setSegments([stripped, urls.join('\n')]);
    setThreadMode(true);
    setNotice('Link moved to the first reply — $0.030 total instead of $0.20.');
  };

  const submitSingle = async (): Promise<ScheduledPost> => {
    const iso = localInputToIso(scheduledFor);
    if (isEditing && original) {
      const patch: UpdateBody = { text: text.trim(), scheduledFor: iso };
      if (original.status === 'draft' && iso) patch.status = 'pending';
      if (original.status === 'pending' && !iso) patch.status = 'draft';
      return api.update(settings, original.id, patch);
    }
    return api.create(settings, {
      text: text.trim(),
      scheduledFor: iso,
      status: iso ? 'pending' : 'draft',
    });
  };

  const submitThreadCreate = async (): Promise<ScheduledPost> => {
    const iso = localInputToIso(scheduledFor);
    const res = await api.createThread(settings, {
      segments: segments.map((s) => s.trim()).filter((s) => s !== ''),
      scheduledFor: iso,
      status: iso ? 'pending' : 'draft',
    });
    const head = res.segments.find((s) => s.threadPosition === 1) ?? res.segments[0];
    if (!head) throw new ApiError(0, 'empty_thread_response');
    return head;
  };

  // Thread edit: PATCH changed segment texts; schedule/status ride on the head.
  const submitThreadEdit = async (): Promise<ScheduledPost> => {
    if (!original) throw new ApiError(0, 'not_loaded');
    const head = thread.find((s) => s.threadPosition === 1);
    if (!head) throw new ApiError(0, 'head_missing');

    for (const seg of thread) {
      if (seg.status === 'posted' || seg.status === 'publishing') continue;
      if (seg.id === head.id) continue;
      const trimmed = seg.text.trim();
      if (trimmed) await api.update(settings, seg.id, { text: trimmed });
    }

    const iso = localInputToIso(scheduledFor);
    const patch: UpdateBody = { text: head.text.trim(), scheduledFor: iso };
    if (head.status === 'draft' && iso) patch.status = 'pending';
    if (head.status === 'pending' && !iso) patch.status = 'draft';
    return api.update(settings, head.id, patch);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setNotice(null);
    try {
      let row: ScheduledPost;
      if (isThreadEdit) row = await submitThreadEdit();
      else if (threadMode && !isEditing) row = await submitThreadCreate();
      else row = await submitSingle();
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
    const what = isThreadEdit ? 'this whole thread' : 'this post';
    if (!confirm(`Delete ${what}?`)) return;
    setLoading(true);
    setError(null);
    try {
      const headId = isThreadEdit
        ? (thread.find((s) => s.threadPosition === 1)?.id ?? original.id)
        : original.id;
      await api.remove(settings, headId);
      onClearEdit();
      reset();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Delete failed');
    } finally {
      setLoading(false);
    }
  };

  // §8.1 — three register-distinct drafts straight into the calendar.
  const generateDrafts = async () => {
    setDrafting(true);
    setError(null);
    setNotice(null);
    try {
      const res = await api.drafts.generate(settings, {
        ...(pillar ? { pillar } : {}),
        ...(idea.trim() ? { idea: idea.trim() } : {}),
        ...(remixTweetId ? { voiceTweetId: remixTweetId } : {}),
      });
      setNotice(
        `${res.drafts.length} drafts added to the calendar ` +
          `(${res.winnersUsed} winners as voice anchors, $${res.costUsd.toFixed(4)}).`,
      );
      setIdea('');
      onClearRemix();
      const first = res.drafts[0];
      if (first) onSaved(first);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Draft failed');
    } finally {
      setDrafting(false);
    }
  };

  const updateSegment = (i: number, value: string): void => {
    setSegments((prev) => prev.map((s, k) => (k === i ? value : s)));
  };
  const updateThreadSegment = (id: string, value: string): void => {
    setThread((prev) => prev.map((s) => (s.id === id ? { ...s, text: value } : s)));
  };
  const addSegment = (): void => setSegments((prev) => [...prev, '']);
  const removeSegment = (i: number): void =>
    setSegments((prev) => (prev.length > 2 ? prev.filter((_, k) => k !== i) : prev));
  const moveSegment = (i: number, dir: -1 | 1): void => {
    setSegments((prev) => {
      const j = i + dir;
      if (j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      const a = next[i] as string;
      next[i] = next[j] as string;
      next[j] = a;
      return next;
    });
  };

  const canSubmit = isThreadEdit
    ? thread.some((s) => s.text.trim() !== '')
    : threadMode && !isEditing
      ? segments.filter((s) => s.trim() !== '').length >= 2
      : text.trim() !== '' && TWEET_LIMIT - text.length >= 0;

  return (
    <form className="panel" onSubmit={submit}>
      <div className="panel-header">
        <h2>
          {isThreadEdit
            ? 'Edit thread'
            : isEditing
              ? 'Edit post'
              : threadMode
                ? 'New thread'
                : 'New post'}
        </h2>
        <div className="row">
          {!isEditing && (
            <button type="button" onClick={() => setThreadMode((m) => !m)}>
              {threadMode ? 'Single post' : 'Thread'}
            </button>
          )}
          {isEditing && (
            <button type="button" onClick={onClearEdit}>
              New
            </button>
          )}
        </div>
      </div>

      {original && (
        <div className={`status-line status-${original.status}`}>
          status: <strong>{original.status}</strong>
          {original.threadId && ' · thread'}
          {original.pillar && ` · ${original.pillar}`}
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

      {isThreadEdit ? (
        <div className="thread-segments">
          {thread.map((seg) => {
            const segLocked = seg.status === 'posted' || seg.status === 'publishing';
            return (
              <label className="field" key={seg.id}>
                <span>
                  {seg.threadPosition}/{thread.length}
                  {segLocked && ` · ${seg.status}`}
                  <span className={`counter${TWEET_LIMIT - seg.text.length < 0 ? ' over' : ''}`}>
                    {TWEET_LIMIT - seg.text.length}
                  </span>
                </span>
                <textarea
                  value={seg.text}
                  onChange={(e) => updateThreadSegment(seg.id, e.target.value)}
                  rows={3}
                  disabled={segLocked}
                />
              </label>
            );
          })}
        </div>
      ) : threadMode && !isEditing ? (
        <div className="thread-segments">
          {segments.map((seg, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: segments are positional by nature
            <label className="field" key={i}>
              <span>
                {i + 1}/{segments.length}
                <span className={`counter${TWEET_LIMIT - seg.length < 0 ? ' over' : ''}`}>
                  {TWEET_LIMIT - seg.length}
                </span>
              </span>
              <textarea
                value={seg}
                onChange={(e) => updateSegment(i, e.target.value)}
                rows={3}
                placeholder={
                  i === 0 ? 'Hook — no links here ($0.20 surcharge)' : `Segment ${i + 1} — links OK`
                }
              />
              <span className="row thread-segment-actions">
                <button type="button" onClick={() => moveSegment(i, -1)} disabled={i === 0}>
                  ↑
                </button>
                <button
                  type="button"
                  onClick={() => moveSegment(i, 1)}
                  disabled={i === segments.length - 1}
                >
                  ↓
                </button>
                <button
                  type="button"
                  onClick={() => removeSegment(i)}
                  disabled={segments.length <= 2}
                >
                  ✕
                </button>
              </span>
            </label>
          ))}
          <button type="button" onClick={addSegment}>
            + Add segment
          </button>
        </div>
      ) : (
        <label className="field">
          <span>
            Text
            <span className={`counter${TWEET_LIMIT - text.length < 0 ? ' over' : ''}`}>
              {TWEET_LIMIT - text.length}
            </span>
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
      )}

      {headHasUrl && (
        <div className="warn">
          ⚠ A URL in tweet 1 is billed at $0.20 (13×).{' '}
          {!threadMode && !isEditing && (
            <button type="button" onClick={moveLinkToReply}>
              Move link to first reply ($0.030)
            </button>
          )}
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
          {scheduledFor
            ? 'Will save as pending and ship at this minute.'
            : 'Empty → saved as draft.'}
        </small>
      </label>

      {error && <div className="error">{error}</div>}
      {notice && <div className="ok">{notice}</div>}

      <div className="row">
        <button type="submit" className="primary" disabled={loading || isLocked || !canSubmit}>
          {loading ? 'Saving…' : isEditing ? 'Save changes' : 'Save'}
        </button>
        {isEditing && !isLocked && (
          <button
            type="button"
            className="danger"
            onClick={() => void onDelete()}
            disabled={loading}
          >
            Delete
          </button>
        )}
      </div>

      {!isEditing && (
        <section className="drafter">
          <h3>Draft with Grok (§8.1)</h3>
          {remixTweetId && (
            <div className="status-line">
              remixing structure of tweet <code>{remixTweetId}</code>{' '}
              <button type="button" onClick={onClearRemix}>
                ✕
              </button>
            </div>
          )}
          <label className="field">
            <span>Pillar</span>
            <select value={pillar} onChange={(e) => setPillar(e.target.value as PostPillar | '')}>
              {PILLARS.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Idea (optional, Romanian OK)</span>
            <textarea
              value={idea}
              onChange={(e) => setIdea(e.target.value)}
              rows={2}
              maxLength={2000}
              placeholder="seed for the three drafts…"
            />
          </label>
          <button type="button" onClick={() => void generateDrafts()} disabled={drafting}>
            {drafting ? 'Drafting…' : 'Generate 3 drafts (~$0.01)'}
          </button>
          <small className="muted">
            One plain, one spicy, one reflective — landing as calendar drafts. Nothing posts until
            you schedule one.
          </small>
        </section>
      )}
    </form>
  );
}
