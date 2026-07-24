import { type FormEvent, type JSX, useCallback, useEffect, useState } from 'react';
import { audienceScoreFor } from '../shared/activeTimes.ts';
import type {
  AudienceCapture,
  BestTimeCell,
  PostPillar,
  PostRegister,
  PostStatus,
} from '../shared/types.ts';
import {
  ApiError,
  type Idea,
  type PostDraftResponse,
  type RewriteVariant,
  type ScheduledPost,
  type ScheduledPostCreated,
  type ScheduledPostWithThread,
  type UpdateBody,
  api,
} from './api.ts';
import {
  audiencePeakHours,
  bestTimeCellScore,
  estimatePostCostUsd,
  slotHint,
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
import { useServerSettings } from './serverSettingsHook.ts';
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
  /** S3: seed the Studio with this text (and the row to stamp). Thread mode seeds
   *  the thread cover with the head segment; otherwise the quote card. */
  onMakeVisual: (seed: {
    text: string;
    postId?: string;
    template?: 'quote' | 'thread';
  }) => void;
}

const TWEET_LIMIT = 280;
const URL_RE = /(^|\s)https?:\/\//i;
// Matches each URL for the move-link-to-reply affordance (§8.2).
const URL_EXTRACT_RE = /https?:\/\/\S+/g;
// How far ahead "Suggest slot" scans the calendar for open anchors.
const SLOT_HORIZON_DAYS = 7;
// Past this the captured audience heatmap is stale enough to nudge a refresh
// visit — the grid drifts as the audience does (A3.4).
const AUDIENCE_STALE_DAYS = 28;

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

// A3.7 — the status a single-post edit should transition to, given the current
// status and the publish-mode toggle. Only the schedulable states participate
// (posted/publishing are locked out of editing; cancelled/failed keep their
// status unless re-scheduled the normal API way). null = leave status untouched.
function nextEditStatus(
  cur: PostStatus,
  manual: boolean,
  hasTime: boolean,
): 'draft' | 'pending' | 'manual' | null {
  if (cur !== 'draft' && cur !== 'pending' && cur !== 'manual') return null;
  if (manual) return hasTime ? 'manual' : null; // no-time is guarded before submit
  if (cur === 'manual') return hasTime ? 'pending' : 'draft';
  if (cur === 'draft' && hasTime) return 'pending';
  if (cur === 'pending' && !hasTime) return 'draft';
  return null;
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

// AI.8 — rewrite variant labels for the "Improve with AI" cards.
const REWRITE_KIND_LABEL: Record<RewriteVariant['kind'], string> = {
  tightened: 'tightened',
  rehooked: 'rehooked',
  restructured: 'restructured',
};

export function ComposerPanel({
  settings,
  editingId,
  remixTweetId,
  onClearRemix,
  onClearEdit,
  onSaved,
  onEdit,
  onMakeVisual,
}: Props): JSX.Element {
  // The mirrored cadence ladder + best-time gate (UI.6) — same numbers the
  // brief and /metrics/best-times read, so a PATCHed anchor moves this picker
  // after one background sync instead of at the next extension rebuild.
  const server = useServerSettings();
  const [threadMode, setThreadMode] = useState(false);
  const [text, setText] = useState('');
  const [segments, setSegments] = useState<string[]>(['', '']);
  const [scheduledFor, setScheduledFor] = useState('');
  const [loading, setLoading] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  // S0.4 — best-times cells (local weekday × hour) for the slot picker.
  const [bestCells, setBestCells] = useState<BestTimeCell[]>([]);
  // A3.4 — the latest captured audience heatmap ($0), blended below measured
  // cells in "Best time" and shown as the day's audience peaks. null until the
  // fetch lands or when X Analytics was never visited.
  const [audience, setAudience] = useState<AudienceCapture | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // GR.6 schedule-time advisory — survives the post-save `reset()` on purpose
  // (it is about the post that was just saved), so it is set after reset runs.
  const [warnings, setWarnings] = useState<string[]>([]);
  // A3.7 — publish mode. API (default): the publisher ships it. Manual: the user
  // pastes it at the slot ($0, URL surcharge doesn't apply). Single posts only —
  // threads reject manual server-side (decision 7), so the toggle hides there.
  const [manualMode, setManualMode] = useState(false);
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
  // AI.8 — "Improve with AI" rewrite of the current single-post text.
  const [rewriting, setRewriting] = useState(false);
  const [rewriteVariants, setRewriteVariants] = useState<RewriteVariant[]>([]);

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

  // A3.4 — load the captured audience heatmap once on mount, alongside
  // best-times. Silent null on 404/unconfigured: measured cells still rank.
  useEffect(() => {
    let alive = true;
    api.analytics
      .activeTimes(settings)
      .then((r) => alive && setAudience(r.capture))
      .catch(() => {
        /* no audience data; "Best time" falls back to measured cells only */
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
    setWarnings([]);
    setManualMode(false);
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
          // A3.7 — a manual row stays manual; a Studio-marked visual (media_note)
          // must ship by hand anyway (the API can't attach images), so nudge
          // manual on. The user can still flip back to API.
          setManualMode(row.status === 'manual' || row.mediaNote != null);
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
  const topSlots = topCellsForWeekday(bestCells, selectedWeekday, 3, server.bestTimeMinN);

  // A3.4 — captured audience peaks for the scheduling day (presence, not
  // measured advice — always labeled "audience") + a staleness/absence nudge.
  const audiencePeaks = audience ? audiencePeakHours(audience, selectedWeekday) : [];
  const audienceStale = ((): string | null => {
    if (!audience) return 'no audience data — visit X Analytics once';
    const capturedMs = new Date(audience.capturedAt).getTime();
    if (Number.isNaN(capturedMs)) return null;
    const days = Math.floor((Date.now() - capturedMs) / 86_400_000);
    return days > AUDIENCE_STALE_DAYS
      ? `audience data ${days}d old — visit X Analytics to refresh`
      : null;
  })();

  // A3.7 — manual mode is a single-post-only affordance; the toggle never shows
  // in either thread branch, so this also gates the $0 cost line and the URL
  // suppression to the single-post render.
  const isSinglePost = !isThreadEdit && !(threadMode && !isEditing);
  const isManualSingle = isSinglePost && manualMode;

  // Live cost preview (invariant #1) — what this post will bill before you save.
  // Manual mode is $0 (the user pastes it), and the URL surcharge doesn't apply.
  const costPreview = estimatePostCostUsd(
    isThreadEdit
      ? { threadMode: true, text: '', segments: thread.map((s) => s.text) }
      : threadMode && !isEditing
        ? { threadMode: true, text: '', segments }
        : { threadMode: false, text, segments: [], manual: manualMode },
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
        ? suggestBestSlotDate(
            now,
            slotted,
            bestCells,
            SLOT_HORIZON_DAYS,
            Math.random,
            audience,
            server,
          )
        : suggestSlotDate(now, slotted, SLOT_HORIZON_DAYS, Math.random, server);
      if (!slot) {
        setError(`No open slot in the next ${SLOT_HORIZON_DAYS} days — every anchor is filled.`);
        return;
      }
      setScheduledFor(dateToLocalInput(slot));
      if (best) {
        const cell = bestCells.find(
          (c) => c.weekday === slot.getDay() && c.hour === slot.getHours(),
        );
        const audScore = audience
          ? audienceScoreFor(audience, slot.getDay(), slot.getHours())
          : null;
        const hint = slotHint(cell, audScore, server.bestTimeMinN);
        const where = `${WEEKDAYS[slot.getDay()]} ${fmtHour(slot.getHours())}`;
        // Label WHY the slot won (§7.19/decision 10): measured own-data, else
        // captured audience presence, else the earliest-open fallback.
        setNotice(
          hint === 'measured'
            ? `Best open slot: ${where} · ${fmtViews(bestTimeCellScore(cell, server.bestTimeMinN) ?? 0)} avg views/day (n=${cell?.posts}).`
            : hint === 'audience'
              ? `Best open slot: ${where} · audience peak (no measured data yet).`
              : 'No measured best-time yet — filled the earliest open slot instead.',
        );
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not read the calendar');
    } finally {
      setSuggesting(false);
    }
  };

  const submitSingle = async (): Promise<ScheduledPostCreated> => {
    const iso = localInputToIso(scheduledFor);
    if (isEditing && original) {
      const patch: UpdateBody = { text: text.trim(), scheduledFor: iso };
      // A3.7 — the publish-mode toggle drives the status transition. Manual
      // needs a slot (guarded above); flipping back to API re-derives
      // pending/draft from whether a time is set.
      const target = nextEditStatus(original.status, manualMode, iso != null);
      if (target && target !== original.status) patch.status = target;
      return api.update(settings, original.id, patch);
    }
    return api.create(settings, {
      text: text.trim(),
      scheduledFor: iso,
      status: manualMode ? 'manual' : iso ? 'pending' : 'draft',
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
    // A3.7 — manual posts are pasted at a specific slot, so a time is required
    // (the server would 400 `scheduled_for_required_when_pending` anyway; catch
    // it here with a clearer message before the round-trip).
    if (isManualSingle && !localInputToIso(scheduledFor)) {
      setError('Manual posts need a scheduled time — that is the slot you paste them at.');
      return;
    }
    setLoading(true);
    setError(null);
    setNotice(null);
    try {
      let row: ScheduledPostCreated;
      if (isThreadEdit) row = await submitThreadEdit();
      else if (threadMode && !isEditing) row = await submitThreadCreate();
      else row = await submitSingle();
      onSaved(row);
      onClearEdit();
      reset();
      // After reset, which clears the previous save's advisory (GR.6).
      setWarnings(row.warnings ?? []);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Save failed');
    } finally {
      setLoading(false);
    }
  };

  // S3: drop the "visual made" marker (the visual was scrapped or already used).
  const clearMediaNote = async (): Promise<void> => {
    if (!original) return;
    try {
      await api.update(settings, original.id, { mediaNote: null });
      setOriginal((prev) => (prev ? { ...prev, mediaNote: null } : prev));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not clear the marker');
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

  // AI.7 — one LLM call drafts a whole thread (reusing the pillar + idea inputs).
  // It lands as a draft head + segment tails sharing a threadId; we open it in
  // the thread editor so the user can tweak segments, set a time, and schedule.
  const draftThread = async (): Promise<void> => {
    setDrafting(true);
    setError(null);
    setNotice(null);
    try {
      const effectiveIdea = idea.trim();
      const ideaId = effectiveIdea ? selectedIdeaId : '';
      const res = await api.drafts.thread(settings, {
        ...(pillar ? { pillar } : {}),
        ...(effectiveIdea ? { idea: effectiveIdea } : {}),
        ...(ideaId ? { ideaId } : {}),
      });
      if (ideaId) {
        setSelectedIdeaId('');
        loadOpenIdeas();
      }
      const head = res.segments.find((s) => s.threadPosition === 1) ?? res.segments[0];
      if (!head) throw new ApiError(0, 'empty_thread_response');
      onSaved(head);
      onEdit(head.id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Thread draft failed');
    } finally {
      setDrafting(false);
    }
  };

  // AI.8 — three sharper versions of the current single-post text. No DB rows;
  // clicking a variant replaces the textarea. Same substance, better writing.
  const improveWithAi = async (): Promise<void> => {
    const draft = text.trim();
    if (draft.length < 1) return;
    setRewriting(true);
    setError(null);
    setNotice(null);
    try {
      const res = await api.drafts.rewrite(settings, { text: draft });
      setRewriteVariants(res.variants);
      if (res.variants.length === 0) setNotice('No usable rewrites came back — try again.');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Rewrite failed');
    } finally {
      setRewriting(false);
    }
  };

  const applyRewrite = (v: RewriteVariant): void => {
    setText(v.text);
    setRewriteVariants([]);
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
      : text.trim() !== '' &&
        TWEET_LIMIT - text.length >= 0 &&
        // A3.7 — manual mode has no draft form: it's a scheduled paste, so a
        // time is mandatory before the button unlocks.
        (!manualMode || scheduledFor !== '');

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
          {original.mediaNote && (
            <div className="media-note-line">
              <span className="badge badge-media" title={original.mediaNote}>
                visual made — post manually with its image
              </span>
              {!isLocked && (
                <button
                  type="button"
                  onClick={() => void clearMediaNote()}
                  title="Remove the marker"
                >
                  ✕
                </button>
              )}
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

      {!threadMode && !isThreadEdit && !isLocked && text.trim() !== '' && (
        <div className="rewrite-assist">
          <button type="button" onClick={() => void improveWithAi()} disabled={rewriting}>
            {rewriting ? 'Improving…' : 'Improve with AI (~$0.003)'}
          </button>
          {rewriteVariants.length > 0 && (
            <div className="draft-cards">
              {rewriteVariants.map((v) => (
                <div className="draft-card" key={v.kind}>
                  <div className="draft-card-head">
                    <span className="badge badge-register">{REWRITE_KIND_LABEL[v.kind]}</span>
                    <span className="counter">{v.text.length}</span>
                  </div>
                  <div className="draft-card-text">{v.text}</div>
                  <div className="row draft-card-actions">
                    <button type="button" className="primary" onClick={() => applyRewrite(v)}>
                      Use this →
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
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

      {headHasUrl && !isManualSingle && (
        <div className="warn">
          ⚠ A URL in tweet 1 is billed at $0.20 (13×).{' '}
          {!threadMode && !isEditing && (
            <button type="button" onClick={moveLinkToReply}>
              Move link to first reply ($0.030)
            </button>
          )}
        </div>
      )}

      {isSinglePost && !isLocked && (
        <div className="publish-mode">
          <span className="muted">Publish</span>
          <div className="segmented">
            <button
              type="button"
              className={manualMode ? '' : 'active'}
              onClick={() => setManualMode(false)}
              title="Stratus publishes it automatically at the slot"
            >
              API
            </button>
            <button
              type="button"
              className={manualMode ? 'active' : ''}
              onClick={() => setManualMode(true)}
              title="You paste it in X yourself at the slot — $0, and links are fine (no $0.20 surcharge)"
            >
              Manual (you paste)
            </button>
          </div>
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
        {!isLocked && audiencePeaks.length > 0 && (
          <div className="best-times muted">
            Audience peak {WEEKDAYS[selectedWeekday]}:{' '}
            {audiencePeaks.map((h) => fmtHour(h)).join(', ')}
          </div>
        )}
        {!isLocked && audienceStale && <div className="best-times muted">{audienceStale}</div>}
        <small className="muted">
          {isManualSingle
            ? scheduledFor
              ? 'Manual — you paste it in X at this minute; nothing auto-publishes.'
              : 'Manual mode needs a time — that is the slot you paste it at.'
            : scheduledFor
              ? 'Will save as pending and ship at this minute.'
              : 'Empty → saved as draft.'}
        </small>
      </label>

      {isManualSingle ? (
        <div className="cost-preview">
          $0 <span className="muted">· you paste it</span>
        </div>
      ) : (
        costPreview.usd > 0 && (
          <div className={`cost-preview${headHasUrl ? ' cost-preview-warn' : ''}`}>
            ≈ ${costPreview.usd.toFixed(3)}
            {costPreview.note && <span className="muted"> · {costPreview.note}</span>}
          </div>
        )
      )}

      {error && <div className="error">{error}</div>}
      {notice && <div className="ok">{notice}</div>}
      {/* GR.6: the post is already saved — these are cadence smells worth a look
          before the publisher gets there, never a reason it didn't go in. */}
      {warnings.length > 0 && (
        <div className="warn">
          {warnings.map((w) => (
            <div key={w}>{w}</div>
          ))}
        </div>
      )}

      <div className="row">
        <button type="submit" className="primary" disabled={loading || isLocked || !canSubmit}>
          {loading ? 'Saving…' : isEditing ? 'Save changes' : 'Save'}
        </button>
        {(threadMode || isThreadEdit ? (threadSegments[0] ?? '').trim() : text.trim()).length >
          0 && (
          <button
            type="button"
            onClick={() => {
              const isThread = threadMode || isThreadEdit;
              onMakeVisual({
                text: (isThread ? (threadSegments[0] ?? '') : text).trim(),
                ...(isEditing && original ? { postId: original.id } : {}),
                ...(isThread ? { template: 'thread' as const } : {}),
              });
            }}
            title="Open the Studio with this text — thread mode seeds the thread cover, otherwise a quote card"
          >
            Make visual
          </button>
        )}
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
          <h3>{threadMode ? 'Draft a thread with AI (§8.2)' : 'Draft with Grok (§8.1)'}</h3>
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
          <button
            type="button"
            onClick={() => void (threadMode ? draftThread() : generateDrafts())}
            disabled={drafting}
          >
            {drafting
              ? 'Drafting…'
              : threadMode
                ? 'Draft thread with AI (~$0.01)'
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
