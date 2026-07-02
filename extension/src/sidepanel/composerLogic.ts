// Pure, unit-testable helpers behind the Composer's smarter affordances:
//   - cadence: propose the next open jittered post slot (never top-of-hour, per
//     the schedule doctrine) from the same anchor ladders the Today brief uses.
//   - cost: live $ preview honouring the $0.20 URL surcharge invariant (#1).
//   - split: turn a >280 blob into a clean thread at natural boundaries.
// No React, no chrome, no Date.now() inside — `now`/`rand` are injected so the
// logic stays deterministic in tests.

import { addDays, isSameLocalDay, startOfLocalDay } from './datetime.ts';

// Cadence anchors mirror md_to_schedule.ts / brief.ts — 3/day and 4/day local
// hours. Kept in sync by hand (both are tiny constant ladders).
export const ANCHORS_3 = [9, 13, 18];
export const ANCHORS_4 = [8, 12, 16, 20];

// 4+ posts already slotted that day means the 4/day ladder, else 3/day —
// identical rule to brief.pickAnchors so the Composer and the brief agree.
export function pickAnchors(filledSlotCount: number): number[] {
  return filledSlotCount >= 4 ? ANCHORS_4 : ANCHORS_3;
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
): Date | null {
  for (let d = 0; d <= horizonDays; d++) {
    const day = startOfLocalDay(addDays(now, d));
    const dayPosts = scheduledLocal.filter((s) => isSameLocalDay(s, day));
    const anchors = pickAnchors(dayPosts.length);
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
export function estimatePostCostUsd(opts: {
  threadMode: boolean;
  text: string;
  segments: string[];
}): CostEstimate {
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
