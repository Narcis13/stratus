// Pure week-board assembly for the Calendar tab (A3.14). ALL placement and
// scoring live here so Calendar.tsx renders view-models only. No React, no
// chrome, no Date.now() inside — `now`/`rand` are injected so the logic stays
// deterministic in tests. Reuses the Composer's cadence + best-times helpers
// (one anchor ladder, §7.19/decision 10: audience ranks below measured).

import { type ActiveTimesGrid, audienceScoreFor } from '../shared/activeTimes.ts';
import type { BestTimeCell, ScheduledPost } from '../shared/types.ts';
import {
  CADENCE_DEFAULTS,
  type CadenceConfig,
  bestTimeCellScore,
  findScheduleGaps,
  jitterMinutes,
  pickAnchors,
  slotHint,
} from './composerLogic.ts';
import { addDays, isSameLocalDay, startOfLocalDay } from './datetime.ts';

// Forward days the board spans (today first).
export const BOARD_DAYS = 7;

// The longest snippet shown per row; the raw text is clipped once, here.
const SNIPPET_MAX = 60;

// Statuses that HOLD a calendar slot, so an anchor near one is not "open":
// pending publishes via the API, manual is a hand-paste at the slot, posted
// already went out, publishing is mid-flight. draft/failed/cancelled free the
// slot (a failed/cancelled row no longer occupies its hour; a draft has no
// committed time). Used for BOTH the ghost gaps and "→ best slot" so the board
// and the scheduler agree on what's taken.
const OCCUPYING: ReadonlySet<string> = new Set(['pending', 'manual', 'posted', 'publishing']);

// A scheduled/published row's chip flags + snippet, all derived here — the
// component formats the raw `scheduledFor` (Intl is locale-bound, kept out of
// the pure layer) and renders these booleans as chips.
export interface BoardRow {
  id: string;
  scheduledFor: string | null;
  status: ScheduledPost['status'];
  snippet: string;
  /** manual + slot already past — it won't auto-publish, so it's a nudge. */
  overdue: boolean;
  pillar: string | null;
  isThread: boolean;
  isReup: boolean;
  hasVisual: boolean;
  isManual: boolean;
  mediaNote: string | null;
}

// An open cadence anchor with why-it's-good scoring for the heat shade. `hint`
// drives the tier: 'measured' (own gated cell) → 'audience' (captured presence)
// → null (neutral fallback). ownScore is the measured avg-views/day when gated.
export interface GhostSlot {
  hour: number;
  ownScore: number | null;
  audienceScore: number | null;
  hint: 'measured' | 'audience' | null;
}

export interface DayColumn {
  /** Local start-of-day. */
  date: Date;
  isToday: boolean;
  /** Scheduled/published rows for this day, earliest first. */
  rows: BoardRow[];
  /** Unclaimed cadence anchors, schedulable (past hours dropped on today). */
  ghosts: GhostSlot[];
}

// An unscheduled draft, ordered for the tray. `hasVisual` means a Studio image
// must ship by hand → schedule it as `manual`, matching the Composer's nudge.
export interface TrayDraft {
  id: string;
  snippet: string;
  pillar: string | null;
  hasVisual: boolean;
}

export interface WeekBoard {
  columns: DayColumn[];
  tray: TrayDraft[];
}

function snippet(text: string): string {
  const t = text.replace(/\s+/g, ' ').trim();
  return t.length > SNIPPET_MAX ? `${t.slice(0, SNIPPET_MAX).trimEnd()}…` : t;
}

function toRow(p: ScheduledPost, nowMs: number): BoardRow {
  const overdue =
    p.status === 'manual' && p.scheduledFor != null && new Date(p.scheduledFor).getTime() < nowMs;
  return {
    id: p.id,
    scheduledFor: p.scheduledFor,
    status: p.status,
    snippet: snippet(p.text),
    overdue,
    pillar: p.pillar,
    isThread: p.threadId != null,
    isReup: p.quoteTweetId != null,
    hasVisual: p.mediaNote != null,
    isManual: p.status === 'manual',
    mediaNote: p.mediaNote,
  };
}

// The local Dates of every slot-holding post — the claimed anchors both the
// ghost computation and "→ best slot" avoid. Invalid/absent times are dropped.
export function occupiedSlotDates(posts: ScheduledPost[]): Date[] {
  return posts
    .filter((p) => p.scheduledFor != null && OCCUPYING.has(p.status))
    .map((p) => new Date(p.scheduledFor as string))
    .filter((d) => !Number.isNaN(d.getTime()));
}

// The jittered target Date for a clicked ghost slot — never top-of-hour (the
// standing schedule-doctrine rule). `rand` injected for tests.
export function slotDateFor(dayStart: Date, hour: number, rand: () => number = Math.random): Date {
  const d = new Date(dayStart);
  d.setHours(hour, jitterMinutes(rand), 0, 0);
  return d;
}

// Assemble the whole board: 7 forward day-columns (rows + heat-shaded open
// anchors) and the drafts tray (newest first). `posts` are the windowed rows of
// any status; `drafts` are the unscheduled drafts (caller filters `scheduledFor`
// out). `audience` is the captured heatmap (a superset of ActiveTimesGrid, so
// AudienceCapture feeds straight in), null when nothing was captured. `cfg` is
// the mirrored cadence/gate config (UI.6) — the board's ghost anchors and the
// Composer's "Best time" must read the same configured ladder or the two
// surfaces disagree about which hours are open.
export function buildWeekBoard(
  now: Date,
  posts: ScheduledPost[],
  drafts: ScheduledPost[],
  cells: BestTimeCell[],
  audience: ActiveTimesGrid | null,
  cfg: CadenceConfig = CADENCE_DEFAULTS,
): WeekBoard {
  const nowMs = now.getTime();
  const today = startOfLocalDay(now);
  const occupied = occupiedSlotDates(posts);

  const columns: DayColumn[] = [];
  for (let i = 0; i < BOARD_DAYS; i++) {
    const day = addDays(today, i);
    const rows = posts
      .filter((p) => p.scheduledFor != null && isSameLocalDay(new Date(p.scheduledFor), day))
      .sort((a, b) => (a.scheduledFor ?? '').localeCompare(b.scheduledFor ?? ''))
      .map((p) => toRow(p, nowMs));

    // Open anchors: the cadence ladder for the day's fill level, minus the
    // anchors already claimed by a slot-holding post. Ghosts show only for
    // still-future hours (a past top-of-hour today isn't schedulable).
    const dayOccupied = occupied.filter((d) => isSameLocalDay(d, day));
    const anchors = pickAnchors(dayOccupied.length, cfg);
    const openHours = findScheduleGaps(
      dayOccupied.map((d) => d.getHours() * 60 + d.getMinutes()),
      anchors,
    );
    const ghosts: GhostSlot[] = [];
    for (const hour of openHours) {
      if (i === 0) {
        const topOfHour = new Date(day);
        topOfHour.setHours(hour, 0, 0, 0);
        if (topOfHour.getTime() <= nowMs) continue;
      }
      const cell = cells.find((c) => c.weekday === day.getDay() && c.hour === hour);
      const audienceScore = audience ? audienceScoreFor(audience, day.getDay(), hour) : null;
      // A dead (0-intensity) hour didn't really "speak" — treat it as no audience
      // signal for the tier tag (the audiencePeakHours philosophy), even though
      // `slotHint` alone would tag any non-null score. The raw score is still
      // exposed for callers that want it.
      const audienceSignal = audienceScore != null && audienceScore > 0 ? audienceScore : null;
      ghosts.push({
        hour,
        ownScore: bestTimeCellScore(cell, cfg.bestTimeMinN),
        audienceScore,
        hint: slotHint(cell, audienceSignal, cfg.bestTimeMinN),
      });
    }

    columns.push({ date: day, isToday: i === 0, rows, ghosts });
  }

  const tray: TrayDraft[] = drafts
    .slice()
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map((d) => ({
      id: d.id,
      snippet: snippet(d.text),
      pillar: d.pillar,
      hasVisual: d.mediaNote != null,
    }));

  return { columns, tray };
}
