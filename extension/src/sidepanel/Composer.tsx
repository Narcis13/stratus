import { type FormEvent, type JSX, useCallback, useEffect, useState } from 'react';
import type { BestTimeCell, PostPillar, PostRegister } from '../shared/types.ts';
import {
  ApiError,
  type Idea,
  type PostDraftResponse,
  type ScheduledPost,
  type ScheduledPostWithThread,
  type UpdateBody,
  api,
} from './api.ts';
import {
  estimatePostCostUsd,
  splitIntoThread,
  suggestBestSlotDate,
  suggestSlotDate,
  topCellsForWeekday,
} from './composerLogic.ts';
import {
  addDays,
  dateToLocalInput,
  isoToLocalInput,
  localInputToIso,
  startOfLocalDay,
} from './datetime.ts';
import type { Settings } from './storage.ts';

interface Props {
  settings: Settings;
  editingId: string | null;
  /** §8.3 → §8.1: a swipe-file tweet whose structure the drafter should remix. */
  remixTweetId: string | null;
  onClearRemix: () => void;
  onClearEdit: () => void;
  onSaved: (post: ScheduledPost) => void;
  /** Open one of the just-generated drafts in the editor (no calendar trip). */
  onEdit: (id: string) => void;
}

const TWEET_LIMIT = 280;
const URL_RE = /(^|\s)https?:\/\//i;
// Matches each URL for the move-link-to-reply affordance (§8.2).
const URL_EXTRACT_RE = /https?:\/\/\S+/g;
// How far ahead "Suggest slot" scans the calendar for open anchors.
const SLOT_HORIZON_DAYS = 7;

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

// Hours show as HH:xx — the :xx signals the mandatory minute jitter (never
// top-of-hour), so a best-time slot never reads as a robotic 17:00.
function fmtHour(h: number): string {
  return `${String(h).padStart(2, '0')}:xx`;
}

function fmtViews(n: number): string {
  if (n >= 10_000) return `${(n / 1000).toFixed(1)}k`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return Math.round(n).toLocaleString();
}

type DraftCard = PostDraftResponse['drafts'][number];

// "any pillar" stays static; the rest are fetched live (§8.6 editable pillars).
const ANY_PILLAR: { value: string; label: string } = {
  value: '',
  label: 'any pillar (Grok declares)',
};

const REGISTER_LABEL: Record<PostRegister, string> = {
  plain: 'plain',
  spicy: 'spicy',
  reflective: 'reflective',
};

export function ComposerPanel({
  settings,
  editingId,
  remixTweetId,
  onClearRemix,
  onClearEdit,
  onSaved,
  onEdit,
}: Props): JSX.Element {
  const [threadMode, setThreadMode] = useState(false);
  const [text, setText] = useState('');
  const [segments, setSegments] = useState<string[]>(['', '']);
  const [scheduledFor, setScheduledFor] = useState('');
  const [loading, setLoading] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  // S0.4 — best-times cells (local weekday × hour) for the slot picker.
  const [bestCells, setBestCells] = useState<BestTimeCell[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [original, setOriginal] = useState<ScheduledPostWithThread | null>(null);
  const [thread, setThread] = useState<ScheduledPost[]>([]);

  // Drafter (§8.1)
  const [idea, setIdea] = useState('');
  // C6 Idea Inbox: the stored idea the steer was picked from — sent as ideaId
  // so the server consumes it (status flip + "seeded by" backlink).
  const [selectedIdeaId, setSelectedIdeaId] = useState('');
  const [openIdeas, setOpenIdeas] = useState<Idea[]>([]);
  const [pillar, setPillar] = useState<PostPillar | ''>('');
  const [pillarOpts, setPillarOpts] = useState<Array<{ value: string; label: string }>>([
    ANY_PILLAR,
  ]);
  const [drafting, setDrafting] = useState(false);
  const [drafts, setDrafts] = useState<DraftCard[]>([]);
  const [draftMeta, setDraftMeta] = useState<{ winnersUsed: number; costUsd: number } | null>(null);

  // S0.4 — best-times for the schedule picker; failure just hides the hints.
  useEffect(() => {
    let alive = true;
    api.metrics
      .bestTimes(settings)
      .then((r) => alive && setBestCells(r.cells))
      .catch(() => {
        /* no best-times hints; Suggest slot / manual entry still work */
      });
    return () => {
      alive = false;
    };
  }, [settings]);

  // C6 — open ideas feed the drafter's seed dropdown; free-typing stays allowed.
  const loadOpenIdeas = useCallback(() => {
    api.ideas
      .list(settings, { status: 'open' })
      .then(setOpenIdeas)
      .catch(() => {
        /* dropdown just stays empty; the textarea still works */
      });
  }, [settings]);

  useEffect(() => {
    loadOpenIdeas();
  }, [loadOpenIdeas]);

  // §8.6 — the pillar dropdown follows the editable DB set, not a hardcoded list.
  useEffect(() => {
    let alive = true;
    api.pillars
      .list(settings, { active: true })
      .then((rows) => {
        if (!alive) return;
        setPillarOpts([
          ANY_PILLAR,
          ...rows.map((p) => ({ value: p.slug, label: `${p.slug} — ${p.label}` })),
        ]);
      })
      .catch(() => {
        /* dropdown falls back to "any pillar"; Grok still declares one */
      });
    return () => {
      alive = false;
    };
  }, [settings]);

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
    setDrafts([]);
    setDraftMeta(null);
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
  const overLimitSingle = !threadMode && !isEditing && text.length > TWEET_LIMIT;

  // S0.4 — top-3 measured cells for the day being scheduled (the input's local
  // weekday, or today when empty). Below the n gate they simply don't appear.
  const selectedWeekday = (() => {
    if (scheduledFor) {
      const d = new Date(scheduledFor);
      if (!Number.isNaN(d.getTime())) return d.getDay();
    }
    return new Date().getDay();
  })();
  const topSlots = topCellsForWeekday(bestCells, selectedWeekday);

  // Live cost preview (invariant #1) — what this post will bill before you save.
  const costPreview = estimatePostCostUsd(
    isThreadEdit
      ? { threadMode: true, text: '', segments: thread.map((s) => s.text) }
      : threadMode && !isEditing
        ? { threadMode: true, text: '', segments }
        : { threadMode: false, text, segments: [] },
  );

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

  // Break a >280 blob into a clean thread at natural boundaries.
  const splitToThread = (): void => {
    const segs = splitIntoThread(text, TWEET_LIMIT);
    if (segs.length < 2) return;
    setSegments(segs);
    setThreadMode(true);
    setNotice(`Split into ${segs.length} segments.`);
  };

  // Every pending post's local time across the slot horizon — the claimed
  // anchors both slot pickers avoid.
  const readSlottedPending = async (now: Date): Promise<Date[]> => {
    const pending = await api.list(settings, {
      status: 'pending',
      from: startOfLocalDay(now).toISOString(),
      to: addDays(now, SLOT_HORIZON_DAYS + 1).toISOString(),
    });
    return pending
      .filter((p) => p.scheduledFor)
      .map((p) => new Date(p.scheduledFor as string))
      .filter((d) => !Number.isNaN(d.getTime()));
  };

  // Propose the next open, jittered anchor slot (never top-of-hour). `best`
  // ranks the open anchors by best-times score (S0.4); otherwise earliest wins.
  const suggestSlot = async (best: boolean): Promise<void> => {
    setSuggesting(true);
    setError(null);
    setNotice(null);
    try {
      const now = new Date();
      const slotted = await readSlottedPending(now);
      const slot = best
        ? suggestBestSlotDate(now, slotted, bestCells, SLOT_HORIZON_DAYS)
        : suggestSlotDate(now, slotted, SLOT_HORIZON_DAYS);
      if (!slot) {
        setError(`No open slot in the next ${SLOT_HORIZON_DAYS} days — every anchor is filled.`);
        return;
      }
      setScheduledFor(dateToLocalInput(slot));
      if (best) {
        const cell = bestCells.find(
          (c) => c.weekday === slot.getDay() && c.hour === slot.getHours(),
        );
        const score = cell?.avgViewsPerDay ?? cell?.avgViews ?? null;
        setNotice(
          score != null
            ? `Best open slot: ${WEEKDAYS[slot.getDay()]} ${fmtHour(slot.getHours())} · ${fmtViews(score)} avg views/day (n=${cell?.posts}).`
            : 'No measured best-time yet — filled the earliest open slot instead.',
        );
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not read the calendar');
    } finally {
      setSuggesting(false);
    }
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

  // §8.1 — three register-distinct drafts. They land as calendar draft rows AND
  // come back in the response, so we render them inline as pickable cards. A
  // regenerate (or "more like") throws away the previous, unpicked candidates.
  const generateDrafts = async (seedIdea?: string) => {
    const replacing = drafts;
    setDrafting(true);
    setError(null);
    setNotice(null);
    try {
      const effectiveIdea = seedIdea !== undefined ? seedIdea : idea.trim();
      // The inbox link only applies to the typed idea, not a "More like this"
      // re-seed from a generated draft.
      const ideaId = seedIdea === undefined && effectiveIdea ? selectedIdeaId : '';
      const res = await api.drafts.generate(settings, {
        ...(pillar ? { pillar } : {}),
        ...(effectiveIdea ? { idea: effectiveIdea } : {}),
        ...(ideaId ? { ideaId } : {}),
        ...(remixTweetId ? { voiceTweetId: remixTweetId } : {}),
      });
      if (ideaId) {
        // Consumed server-side; drop the link and refresh the dropdown.
        setSelectedIdeaId('');
        loadOpenIdeas();
      }
      setDrafts(res.drafts);
      setDraftMeta({ winnersUsed: res.winnersUsed, costUsd: res.costUsd });
      if (seedIdea !== undefined) setIdea(seedIdea);
      onClearRemix();
      const first = res.drafts[0];
      if (first) onSaved(first);
      // Best-effort cleanup of the candidates we just replaced, so regenerating
      // doesn't pile orphan drafts into the calendar.
      await Promise.allSettled(replacing.map((d) => api.remove(settings, d.id)));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Draft failed');
    } finally {
      setDrafting(false);
    }
  };

  // Pick a generated draft → open it in the editor (it already exists as a draft
  // row); the user sets a time and Saves, promoting it to pending. No round-trip
  // through the Calendar tab.
  const useDraft = (id: string): void => {
    setDrafts([]);
    setDraftMeta(null);
    onEdit(id);
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

  const threadSegments = isThreadEdit ? thread.map((s) => s.text) : segments;
  const threadCharTotal = threadSegments.reduce((n, s) => n + s.length, 0);
  const threadFilledCount = threadSegments.filter((s) => s.trim() !== '').length;

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
          {original.seededBy && (
            <div className="muted" title={original.seededBy.text}>
              seeded by idea: "
              {original.seededBy.text.length > 100
                ? `${original.seededBy.text.slice(0, 99)}…`
                : original.seededBy.text}
              "
            </div>
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
            maxLength={TWEET_LIMIT * 4}
            placeholder="What are you posting?"
            disabled={isLocked}
          />
        </label>
      )}

      {(threadMode || isThreadEdit) && (
        <div className="thread-total muted">
          {threadFilledCount} segment{threadFilledCount === 1 ? '' : 's'} · {threadCharTotal} chars
          total
        </div>
      )}

      {overLimitSingle && (
        <div className="warn">
          ⚠ {text.length}/{TWEET_LIMIT} — too long for one tweet.{' '}
          <button type="button" onClick={splitToThread}>
            Split into thread ({splitIntoThread(text, TWEET_LIMIT).length})
          </button>
        </div>
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
        <div className="row schedule-row">
          <input
            type="datetime-local"
            value={scheduledFor}
            onChange={(e) => setScheduledFor(e.target.value)}
            disabled={isLocked}
          />
          {!isLocked && (
            <>
              <button
                type="button"
                onClick={() => void suggestSlot(true)}
                disabled={suggesting}
                title="Fill the highest-scoring open anchor (jittered, never top-of-hour)"
              >
                {suggesting ? '…' : 'Best time'}
              </button>
              <button
                type="button"
                onClick={() => void suggestSlot(false)}
                disabled={suggesting}
                title="Fill the earliest open anchor"
              >
                Next slot
              </button>
            </>
          )}
          {scheduledFor && !isLocked && (
            <button type="button" onClick={() => setScheduledFor('')} title="Clear → save as draft">
              ✕
            </button>
          )}
        </div>
        {!isLocked &&
          (topSlots.length > 0 ? (
            <div className="best-times muted">
              Best {WEEKDAYS[selectedWeekday]}:{' '}
              {topSlots.map((c, i) => (
                <span key={`${c.weekday}:${c.hour}`} className="best-time-cell">
                  {i > 0 && ' · '}
                  {fmtHour(c.hour)} <strong>{fmtViews(c.avgViewsPerDay ?? c.avgViews ?? 0)}</strong>
                  /day (n={c.posts})
                </span>
              ))}
            </div>
          ) : (
            <div className="best-times muted">
              No measured best-time for {WEEKDAYS[selectedWeekday]} yet (need ≥3 posts in a slot).
            </div>
          ))}
        <small className="muted">
          {scheduledFor
            ? 'Will save as pending and ship at this minute.'
            : 'Empty → saved as draft.'}
        </small>
      </label>

      {costPreview.usd > 0 && (
        <div className={`cost-preview${headHasUrl ? ' cost-preview-warn' : ''}`}>
          ≈ ${costPreview.usd.toFixed(3)}
          {costPreview.note && <span className="muted"> · {costPreview.note}</span>}
        </div>
      )}

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
            <select value={pillar} onChange={(e) => setPillar(e.target.value)}>
              {pillarOpts.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>
          {openIdeas.length > 0 && (
            <label className="field">
              <span>Seed from Idea Inbox (optional)</span>
              <select
                value={selectedIdeaId}
                onChange={(e) => {
                  const id = e.target.value;
                  setSelectedIdeaId(id);
                  const picked = openIdeas.find((i) => i.id === id);
                  if (picked) setIdea(picked.text);
                }}
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
            <span>Idea (optional, Romanian OK)</span>
            <textarea
              value={idea}
              onChange={(e) => {
                setIdea(e.target.value);
                // Emptying the box drops the inbox link; tweaking keeps it —
                // the picked idea still seeded whatever ships.
                if (e.target.value.trim() === '') setSelectedIdeaId('');
              }}
              rows={2}
              maxLength={2000}
              placeholder="seed for the three drafts…"
            />
          </label>
          <button type="button" onClick={() => void generateDrafts()} disabled={drafting}>
            {drafting
              ? 'Drafting…'
              : drafts.length > 0
                ? 'Regenerate 3 drafts (~$0.01)'
                : 'Generate 3 drafts (~$0.01)'}
          </button>

          {drafts.length > 0 ? (
            <div className="draft-cards">
              {draftMeta && (
                <div className="muted draft-meta">
                  {drafts.length} drafts · {draftMeta.winnersUsed} winners as voice anchors · $
                  {draftMeta.costUsd.toFixed(4)}. Pick one to set a time, or regenerate.
                </div>
              )}
              {drafts.map((d) => (
                <div className="draft-card" key={d.id}>
                  <div className="draft-card-head">
                    {d.register && (
                      <span className={`badge badge-register badge-${d.register}`}>
                        {REGISTER_LABEL[d.register]}
                      </span>
                    )}
                    {d.pillar && <span className="badge badge-pillar">{d.pillar}</span>}
                    <span className="counter">{d.text.length}</span>
                  </div>
                  <div className="draft-card-text">{d.text}</div>
                  <div className="row draft-card-actions">
                    <button type="button" className="primary" onClick={() => useDraft(d.id)}>
                      Use this →
                    </button>
                    <button
                      type="button"
                      onClick={() => void generateDrafts(d.text)}
                      disabled={drafting}
                      title="Feed this draft back as the seed for three fresh takes"
                    >
                      More like this
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <small className="muted">
              One plain, one spicy, one reflective — pick one inline to schedule, the rest stay as
              calendar drafts. Nothing posts until you schedule it.
            </small>
          )}
        </section>
      )}
    </form>
  );
}
