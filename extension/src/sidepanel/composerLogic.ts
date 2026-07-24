// Pure, unit-testable helpers behind the Composer's smarter affordances:
//   - cadence: propose the next open jittered post slot (never top-of-hour, per
//     the schedule doctrine) from the same anchor ladders the Today brief uses.
//   - cost: live $ preview honouring the $0.20 URL surcharge invariant (#1).
//   - split: turn a >280 blob into a clean thread at natural boundaries.
// No React, no chrome, no Date.now() inside — `now`/`rand` are injected so the
// logic stays deterministic in tests.

import { type ActiveTimesGrid, audienceScoreFor } from '../shared/activeTimes.ts';
import { SERVER_DEFAULTS } from '../shared/serverSettings.ts';
import type { BestTimeCell } from '../shared/types.ts';
import { addDays, isSameLocalDay, startOfLocalDay } from './datetime.ts';

// Cadence anchors — 3/day and 4/day local hours. These are the module DEFAULTS;
// UI.6 made them the mirrored x.doctrine.anchors3/anchors4/ladderSwitchAt
// settings, so a caller holding the blob (Composer, Calendar) passes the
// configured ladder in and the hand-sync with brief.ts / md_to_schedule.ts is
// gone. The baked values live in shared/serverSettings.ts — one owner.
export const ANCHORS_3 = SERVER_DEFAULTS.anchors3;
export const ANCHORS_4 = SERVER_DEFAULTS.anchors4;

/** The mirrored knobs the cadence + best-time helpers read. Structurally a
 *  subset of ServerConfig, so the hook's value passes straight in. */
export interface CadenceConfig {
  anchors3: number[];
  anchors4: number[];
  ladderSwitchAt: number;
  bestTimeMinN: number;
}

export const CADENCE_DEFAULTS: CadenceConfig = SERVER_DEFAULTS;

// `ladderSwitchAt`+ posts already slotted that day means the 4/day ladder, else
// 3/day — identical rule (and identical config shape) to brief.pickAnchors so
// the Composer, the Calendar board and the brief agree.
export function pickAnchors(
  filledSlotCount: number,
  cfg: CadenceConfig = CADENCE_DEFAULTS,
): number[] {
  return filledSlotCount >= cfg.ladderSwitchAt ? cfg.anchors4 : cfg.anchors3;
}

// Assign each post (minutes-of-day) to its nearest anchor hour; the anchors left
// unclaimed are the day's open slots. Ties go to the earlier anchor.
export function findScheduleGaps(postMinutes: number[], anchors: number[]): number[] {
  const filled = new Set<number>();
  for (const m of postMinutes) {
    let best = anchors[0] ?? 0;
    for (const a of anchors) {
      if (Math.abs(a * 60 - m) < Math.abs(best * 60 - m)) best = a;
    }
    filled.add(best);
  }
  return anchors.filter((a) => !filled.has(a));
}

// A random minute offset in [4, 56] — never the top of the hour (09:12, not
// 09:00), matching the user's jitter preference.
export function jitterMinutes(rand: () => number = Math.random): number {
  return 4 + Math.floor(rand() * 53);
}

// The next open, jittered, still-in-the-future slot. Walks today first (only
// anchors whose jittered time hasn't passed), then following days. Returns null
// if every anchor in the horizon is already claimed.
export function suggestSlotDate(
  now: Date,
  scheduledLocal: Date[],
  horizonDays = 7,
  rand: () => number = Math.random,
  cfg: CadenceConfig = CADENCE_DEFAULTS,
): Date | null {
  for (let d = 0; d <= horizonDays; d++) {
    const day = startOfLocalDay(addDays(now, d));
    const dayPosts = scheduledLocal.filter((s) => isSameLocalDay(s, day));
    const anchors = pickAnchors(dayPosts.length, cfg);
    const gaps = findScheduleGaps(
      dayPosts.map((p) => p.getHours() * 60 + p.getMinutes()),
      anchors,
    );
    for (const hour of gaps) {
      const cand = new Date(day);
      cand.setHours(hour, jitterMinutes(rand), 0, 0);
      // Leave a small buffer so the publisher's next tick can actually catch it.
      if (cand.getTime() > now.getTime() + 60_000) return cand;
    }
  }
  return null;
}

// ------------------------------------------------------------- best times S0.4

// Advice gate: a cell with fewer measured posts is "no data", not a
// recommendation. The DEFAULT — UI.6 mirrors x.gates.bestTimeMinN, the very key
// /metrics/best-times and the brief's cadence gaps read, so the panel can't sit
// on a thinner bar than the page.
export const BEST_TIME_MIN_N = SERVER_DEFAULTS.bestTimeMinN;

// The one scalar a cell is ranked by — age-normalized rate, else raw views.
// Null below the n gate or with no view data.
export function bestTimeCellScore(
  cell: BestTimeCell | undefined,
  minN = BEST_TIME_MIN_N,
): number | null {
  if (!cell || cell.posts < minN) return null;
  return cell.avgViewsPerDay ?? cell.avgViews ?? null;
}

// Top gated cells for one local weekday, best-first — the "Best times for Wed"
// display. Cells below the gate are dropped (never advice from thin data).
export function topCellsForWeekday(
  cells: BestTimeCell[],
  weekday: number,
  limit = 3,
  minN = BEST_TIME_MIN_N,
): BestTimeCell[] {
  return cells
    .filter((c) => c.weekday === weekday && bestTimeCellScore(c, minN) != null)
    .sort((a, b) => (bestTimeCellScore(b, minN) ?? 0) - (bestTimeCellScore(a, minN) ?? 0))
    .slice(0, limit);
}

// Like suggestSlotDate, but ranks the open anchors by best-times score instead
// of earliest-first. Candidates are still only the cadence-ladder anchors (so
// the cadence is respected) and the minute is still jittered (never top-of-
// hour). Ranking is three tiers (A3.4): (1) own gated score desc — the measured
// authority, §7.19/decision 10, two measured candidates never reorder by
// audience; (2) among unmeasured slots, captured audience intensity desc; (3)
// earliest. With no `audience` grid every audienceScore is null, so tier 2
// collapses and the picker degrades byte-for-byte to its pre-A3.4 behavior.
// Returns null if every anchor in the horizon is claimed.
export function suggestBestSlotDate(
  now: Date,
  scheduledLocal: Date[],
  cells: BestTimeCell[],
  horizonDays = 7,
  rand: () => number = Math.random,
  audience?: ActiveTimesGrid | null,
  cfg: CadenceConfig = CADENCE_DEFAULTS,
): Date | null {
  const candidates: Array<{ date: Date; score: number | null; audienceScore: number | null }> = [];
  for (let d = 0; d <= horizonDays; d++) {
    const day = startOfLocalDay(addDays(now, d));
    const dayPosts = scheduledLocal.filter((s) => isSameLocalDay(s, day));
    const anchors = pickAnchors(dayPosts.length, cfg);
    const gaps = findScheduleGaps(
      dayPosts.map((p) => p.getHours() * 60 + p.getMinutes()),
      anchors,
    );
    for (const hour of gaps) {
      const cand = new Date(day);
      cand.setHours(hour, jitterMinutes(rand), 0, 0);
      if (cand.getTime() <= now.getTime() + 60_000) continue;
      const cell = cells.find((c) => c.weekday === day.getDay() && c.hour === hour);
      candidates.push({
        date: cand,
        score: bestTimeCellScore(cell, cfg.bestTimeMinN),
        audienceScore: audience ? audienceScoreFor(audience, day.getDay(), hour) : null,
      });
    }
  }
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => {
    // Tier 1 — own measured score outranks everything; measured ties fall to
    // the earliest (audience never reorders two measured slots).
    if (a.score != null && b.score != null) {
      if (a.score !== b.score) return b.score - a.score;
      return a.date.getTime() - b.date.getTime();
    }
    if (a.score != null) return -1;
    if (b.score != null) return 1;
    // Tier 2 — among unmeasured slots, audience intensity breaks the tie.
    if (a.audienceScore != null && b.audienceScore != null && a.audienceScore !== b.audienceScore) {
      return b.audienceScore - a.audienceScore;
    }
    if (a.audienceScore != null && b.audienceScore == null) return -1;
    if (a.audienceScore == null && b.audienceScore != null) return 1;
    // Tier 3 — earliest.
    return a.date.getTime() - b.date.getTime();
  });
  return (candidates[0] as { date: Date }).date;
}

// Why a suggested best-slot won, so the UI can say so: 'measured' when its own
// gated cell clears the n gate (the authority), 'audience' when only captured
// presence data spoke, null when neither did (the earliest-open fallback).
export function slotHint(
  cell: BestTimeCell | undefined,
  audienceScore: number | null,
  minN = BEST_TIME_MIN_N,
): 'measured' | 'audience' | null {
  if (bestTimeCellScore(cell, minN) != null) return 'measured';
  if (audienceScore != null) return 'audience';
  return null;
}

// The local hours a captured audience heatmap is busiest for one weekday, best
// first (ties: earlier hour). Presence data — labeled "audience" in the UI,
// never merged with measured advice; dead (zero-intensity) hours aren't peaks.
export function audiencePeakHours(grid: ActiveTimesGrid, weekday: number, topN = 2): number[] {
  const scored: Array<{ hour: number; score: number }> = [];
  for (let hour = 0; hour < 24; hour++) {
    const s = audienceScoreFor(grid, weekday, hour);
    if (s != null && s > 0) scored.push({ hour, score: s });
  }
  scored.sort((a, b) => (a.score !== b.score ? b.score - a.score : a.hour - b.hour));
  return scored.slice(0, topN).map((x) => x.hour);
}

// --------------------------------------------------------------------- cost

const URL_RE = /(^|\s)https?:\/\//i;
const COST_STANDARD = 0.015;
const COST_URL = 0.2;

export interface CostEstimate {
  usd: number;
  /** Short human reason for the number, e.g. "URL surcharge" or "4 segments". */
  note: string;
}

// Mirrors createPost's pricing (invariant #1): a URL in a standalone post or a
// thread head is billed 13× ($0.20); replies/tail segments are always base.
// A3.7: `manual` posts never touch the API (the user pastes them at the slot),
// so they cost $0 — and the URL surcharge simply doesn't apply, which is the
// sanctioned way to post a link at $0 (decision 5).
export function estimatePostCostUsd(opts: {
  threadMode: boolean;
  text: string;
  segments: string[];
  manual?: boolean;
}): CostEstimate {
  if (opts.manual) return { usd: 0, note: 'manual paste' };
  if (opts.threadMode) {
    const segs = opts.segments.map((s) => s.trim()).filter((s) => s !== '');
    if (segs.length === 0) return { usd: 0, note: '' };
    let usd = 0;
    let headSurcharge = false;
    segs.forEach((s, i) => {
      if (i === 0 && URL_RE.test(s)) {
        usd += COST_URL;
        headSurcharge = true;
      } else {
        usd += COST_STANDARD;
      }
    });
    const note = headSurcharge
      ? `${segs.length} segments · URL in head (move it to a reply)`
      : `${segs.length} segments`;
    return { usd, note };
  }
  const t = opts.text.trim();
  if (t === '') return { usd: 0, note: '' };
  const hasUrl = URL_RE.test(t);
  return { usd: hasUrl ? COST_URL : COST_STANDARD, note: hasUrl ? 'URL surcharge (13×)' : '' };
}

// --------------------------------------------------------------------- split

function splitSentences(s: string): string[] {
  const m = s.match(/[^.!?]+(?:[.!?]+|$)/g);
  return m ? m.map((x) => x.trim()).filter(Boolean) : [s];
}

// Pack a long blob into <=limit segments, breaking at the coarsest boundary that
// fits: paragraphs first, then sentences, then words, then (last resort) hard
// character splits. Paragraph breaks are preserved when whole paragraphs are
// packed together; finer breaks join with single spaces.
export function splitIntoThread(text: string, limit = 280): string[] {
  const trimmed = text.trim();
  if (trimmed === '') return [];
  if (trimmed.length <= limit) return [trimmed];

  const out: string[] = [];
  let buf = '';
  const flush = (): void => {
    const t = buf.trim();
    if (t) out.push(t);
    buf = '';
  };
  const tryAppend = (piece: string, sep: string): boolean => {
    const cand = buf ? buf + sep + piece : piece;
    if (cand.length <= limit) {
      buf = cand;
      return true;
    }
    return false;
  };

  for (const para of trimmed.split(/\n{2,}/)) {
    const p = para.trim();
    if (!p) continue;
    if (tryAppend(p, '\n\n')) continue;
    flush();
    if (p.length <= limit) {
      buf = p;
      continue;
    }
    for (const sentence of splitSentences(p)) {
      if (tryAppend(sentence, ' ')) continue;
      flush();
      if (sentence.length <= limit) {
        buf = sentence;
        continue;
      }
      for (const word of sentence.split(/\s+/)) {
        if (tryAppend(word, ' ')) continue;
        flush();
        if (word.length <= limit) {
          buf = word;
          continue;
        }
        for (let i = 0; i < word.length; i += limit) out.push(word.slice(i, i + limit));
      }
    }
  }
  flush();
  return out;
}
