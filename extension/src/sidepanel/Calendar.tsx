import { type JSX, useCallback, useEffect, useState } from 'react';
import type { AudienceCapture, BestTimeCell } from '../shared/types.ts';
import { ApiError, type ScheduledPost, api } from './api.ts';
import {
  BOARD_DAYS,
  type GhostSlot,
  type TrayDraft,
  buildWeekBoard,
  occupiedSlotDates,
  slotDateFor,
} from './calendarLogic.ts';
import { suggestBestSlotDate } from './composerLogic.ts';
import { addDays, formatDayLabel, formatTime, startOfLocalDay } from './datetime.ts';
import type { Settings } from './storage.ts';

interface Props {
  settings: Settings;
  onEdit: (id: string) => void;
}

// Hours read HH:xx — the :xx signals the mandatory minute jitter (never top-of-
// hour), matching the Composer's best-time labels.
function fmtHour(h: number): string {
  return `${String(h).padStart(2, '0')}:xx`;
}

// Compact avg-views readout for a measured ghost's tier badge.
function fmtScore(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k`;
  return String(Math.round(n));
}

function ghostLabel(g: GhostSlot): string {
  if (g.hint === 'measured' && g.ownScore != null)
    return `${fmtHour(g.hour)} · ${fmtScore(g.ownScore)}`;
  if (g.hint === 'audience') return `${fmtHour(g.hour)} · aud`;
  return fmtHour(g.hour);
}

export function CalendarPanel({ settings, onEdit }: Props): JSX.Element {
  const [posts, setPosts] = useState<ScheduledPost[]>([]);
  const [drafts, setDrafts] = useState<ScheduledPost[]>([]);
  const [bestCells, setBestCells] = useState<BestTimeCell[]>([]);
  const [audience, setAudience] = useState<AudienceCapture | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [marking, setMarking] = useState<string | null>(null);
  const [scheduling, setScheduling] = useState<string | null>(null);
  // A3.14 — the draft armed for slot-picking: while set, ghost slots become
  // clickable and place it. null = just browsing.
  const [selectedDraftId, setSelectedDraftId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const startToday = startOfLocalDay(new Date());
      const from = startToday.toISOString();
      const to = addDays(startToday, BOARD_DAYS).toISOString();
      const [rows, draftRows, best, active] = await Promise.all([
        api.list(settings, { from, to }),
        // Unscheduled drafts (incl. §8.1 drafter output) have no scheduled_for,
        // so the day-window query never returns them.
        api.list(settings, { status: 'draft' }),
        // Best-times + audience feed the ghost-slot heat; a failure just leaves
        // slots neutral (the picker degrades to earliest-open, like the Composer).
        api.metrics
          .bestTimes(settings)
          .catch(() => null),
        api.analytics.activeTimes(settings).catch(() => null),
      ]);
      setPosts(rows);
      setDrafts(draftRows.filter((d) => !d.scheduledFor));
      setBestCells(best?.cells ?? []);
      setAudience(active?.capture ?? null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [settings]);

  useEffect(() => {
    void load();
  }, [load]);

  // A3.7 — flip a manual row to `posted` after you've pasted it in X. One click,
  // no confirm: it's exactly what you just did, and it's reversible (the daily
  // reconcile self-heals the link). Reload after — status drives the chips.
  const markPosted = useCallback(
    async (id: string) => {
      setMarking(id);
      setError(null);
      try {
        await api.markPosted(settings, id);
        await load();
      } catch (e) {
        setError(e instanceof ApiError ? e.message : 'Failed to mark posted');
      } finally {
        setMarking(null);
      }
    },
    [settings, load],
  );

  // Schedule a draft into a concrete slot. A media-note draft goes `manual`
  // (ships by hand with its visual, matching the Composer's nudge); everything
  // else goes `pending`. A URL in a pending post trips the server's $0.20 guard
  // — surface that inline as a "switch to manual" nudge rather than a raw code.
  const scheduleDraft = useCallback(
    async (draftId: string, hasVisual: boolean, iso: string) => {
      setScheduling(draftId);
      setError(null);
      try {
        await api.update(settings, draftId, {
          status: hasVisual ? 'manual' : 'pending',
          scheduledFor: iso,
        });
        setSelectedDraftId(null);
        await load();
      } catch (e) {
        if (e instanceof ApiError && e.code === 'url_in_text') {
          setError(
            'This draft has a link — links need manual mode or a thread. Open it in the Composer and switch to Manual.',
          );
        } else {
          setError(e instanceof ApiError ? e.message : 'Failed to schedule');
        }
      } finally {
        setScheduling(null);
      }
    },
    [settings, load],
  );

  const board = buildWeekBoard(new Date(), posts, drafts, bestCells, audience);

  // "→ best slot": the audience-blended ranking over every open anchor (§7.19 —
  // own measured cells first, captured audience second, earliest third).
  const scheduleBest = (draft: TrayDraft): void => {
    const slot = suggestBestSlotDate(
      new Date(),
      occupiedSlotDates(posts),
      bestCells,
      BOARD_DAYS,
      Math.random,
      audience,
    );
    if (!slot) {
      setError(`No open slot in the next ${BOARD_DAYS} days — every anchor is filled.`);
      return;
    }
    void scheduleDraft(draft.id, draft.hasVisual, slot.toISOString());
  };

  // Click a ghost slot while a draft is armed → place it there, jittered.
  const scheduleAt = (day: Date, hour: number): void => {
    if (!selectedDraftId) return;
    const draft = board.tray.find((d) => d.id === selectedDraftId);
    if (!draft) return;
    void scheduleDraft(draft.id, draft.hasVisual, slotDateFor(day, hour).toISOString());
  };

  return (
    <div className="panel">
      <div className="panel-header">
        <h2>Calendar</h2>
        <button type="button" onClick={() => void load()} disabled={loading}>
          {loading ? 'Loading…' : 'Refresh'}
        </button>
      </div>

      {error && <div className="error">{error}</div>}
      {selectedDraftId && (
        <div className="status-line">Draft armed — click an open slot above to schedule it.</div>
      )}

      <div className="week-board">
        {board.columns.map((col) => (
          <div
            key={col.date.toISOString()}
            className={`week-col${col.isToday ? ' week-col-today' : ''}`}
          >
            <div className="day-header">
              <span className="day-label">{formatDayLabel(col.date)}</span>
              <span className="day-count">{col.rows.length}</span>
            </div>

            {col.rows.length > 0 && (
              <ul className="post-list">
                {col.rows.map((r) => (
                  <li key={r.id}>
                    <button
                      type="button"
                      className={`post-row status-${r.status}${r.overdue ? ' overdue' : ''}`}
                      onClick={() => onEdit(r.id)}
                    >
                      <span className="post-time">{formatTime(r.scheduledFor)}</span>
                      <span
                        className={`badge badge-${r.status}`}
                        title={
                          r.isManual
                            ? "You paste this in X yourself at the slot — it won't auto-publish."
                            : undefined
                        }
                      >
                        {r.status}
                      </span>
                      {r.isThread && <span className="badge">🧵</span>}
                      {r.isReup && <span className="badge">re-up</span>}
                      {r.hasVisual && (
                        <span
                          className="badge badge-media"
                          title={`${r.mediaNote} — post manually with its visual (the API can't attach images)`}
                        >
                          visual
                        </span>
                      )}
                      {r.pillar && <span className="badge badge-pillar">{r.pillar}</span>}
                      <span className="post-text">{r.snippet}</span>
                    </button>
                    {r.isManual && (
                      <button
                        type="button"
                        className="mark-posted-btn"
                        onClick={() => void markPosted(r.id)}
                        disabled={marking === r.id}
                        title="Flip to posted — the next daily pass links the tweet"
                      >
                        {marking === r.id ? '…' : 'Mark posted'}
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}

            {col.ghosts.length > 0 && (
              <div className="ghost-list">
                {col.ghosts.map((g) => (
                  <button
                    key={g.hour}
                    type="button"
                    className={`ghost ghost-${g.hint ?? 'none'}${selectedDraftId ? ' ghost-armed' : ''}`}
                    onClick={() => scheduleAt(col.date, g.hour)}
                    disabled={!selectedDraftId || scheduling != null}
                    title={
                      selectedDraftId
                        ? 'Schedule the armed draft here'
                        : g.hint === 'measured'
                          ? 'Measured best time'
                          : g.hint === 'audience'
                            ? 'Audience is active here'
                            : 'Open slot'
                    }
                  >
                    {ghostLabel(g)}
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      {board.tray.length > 0 && (
        <div className="day-card drafts-tray">
          <div className="day-header">
            <span className="day-label">Drafts (unscheduled)</span>
            <span className="day-count">{board.tray.length}</span>
          </div>
          <ul className="post-list">
            {board.tray.map((d) => {
              const selected = selectedDraftId === d.id;
              return (
                <li key={d.id} className={selected ? 'tray-draft-selected' : undefined}>
                  <button
                    type="button"
                    className="post-row"
                    onClick={() => setSelectedDraftId(selected ? null : d.id)}
                    title={
                      selected
                        ? 'Armed — pick a slot above'
                        : 'Arm this draft, then click an open slot'
                    }
                  >
                    {d.hasVisual && <span className="badge badge-media">visual</span>}
                    {d.pillar && <span className="badge badge-pillar">{d.pillar}</span>}
                    <span className="post-text">{d.snippet}</span>
                  </button>
                  <div className="tray-actions">
                    <button
                      type="button"
                      className="mark-posted-btn"
                      onClick={() => scheduleBest(d)}
                      disabled={scheduling === d.id}
                      title="Schedule into the best open slot (audience-blended)"
                    >
                      {scheduling === d.id ? '…' : '→ best slot'}
                    </button>
                    <button type="button" className="tray-edit-btn" onClick={() => onEdit(d.id)}>
                      edit
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
