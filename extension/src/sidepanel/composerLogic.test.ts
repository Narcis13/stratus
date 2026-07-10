import { describe, expect, test } from 'bun:test';
import type { BestTimeCell } from '../shared/types.ts';
import {
  ANCHORS_3,
  ANCHORS_4,
  BEST_TIME_MIN_N,
  bestTimeCellScore,
  estimatePostCostUsd,
  findScheduleGaps,
  jitterMinutes,
  pickAnchors,
  splitIntoThread,
  suggestBestSlotDate,
  suggestSlotDate,
  topCellsForWeekday,
} from './composerLogic.ts';

// Compact BestTimeCell builder for the S0.4 tests below.
function cell(weekday: number, hour: number, posts: number, rate: number | null): BestTimeCell {
  return {
    weekday,
    hour,
    posts,
    avgViews: rate,
    avgViewsPerDay: rate,
    avgLikes: null,
    avgProfileVisits: null,
  };
}

describe('pickAnchors', () => {
  test('3/day until 4 slots are filled', () => {
    expect(pickAnchors(0)).toEqual(ANCHORS_3);
    expect(pickAnchors(3)).toEqual(ANCHORS_3);
    expect(pickAnchors(4)).toEqual(ANCHORS_4);
  });
});

describe('findScheduleGaps', () => {
  test('claims the nearest anchor and returns the rest', () => {
    // a post at 09:10 claims the 9 anchor
    expect(findScheduleGaps([9 * 60 + 10], ANCHORS_3)).toEqual([13, 18]);
  });
  test('all anchors open when nothing is slotted', () => {
    expect(findScheduleGaps([], ANCHORS_3)).toEqual(ANCHORS_3);
  });
  test('ties go to the earlier anchor', () => {
    // 11:00 is equidistant from 9 and 13 → claims 9
    expect(findScheduleGaps([11 * 60], ANCHORS_3)).toEqual([13, 18]);
  });
});

describe('jitterMinutes', () => {
  test('never top-of-hour, stays in [4,56]', () => {
    expect(jitterMinutes(() => 0)).toBe(4);
    expect(jitterMinutes(() => 0.999999)).toBe(56);
    for (let i = 0; i < 50; i++) {
      const m = jitterMinutes(() => i / 50);
      expect(m).toBeGreaterThanOrEqual(4);
      expect(m).toBeLessThanOrEqual(56);
    }
  });
});

describe('suggestSlotDate', () => {
  const fixedJitter = () => 0; // → minute 4

  test('picks the first future anchor today', () => {
    const now = new Date(2026, 5, 18, 7, 0); // 07:00 local, before the 9 anchor
    const d = suggestSlotDate(now, [], 7, fixedJitter);
    expect(d).not.toBeNull();
    expect(d?.getHours()).toBe(9);
    expect(d?.getMinutes()).toBe(4);
    expect(d?.getDate()).toBe(18);
  });

  test('skips an already-claimed anchor', () => {
    const now = new Date(2026, 5, 18, 7, 0);
    const claimed = [new Date(2026, 5, 18, 9, 5)]; // claims the 9 anchor
    const d = suggestSlotDate(now, claimed, 7, fixedJitter);
    expect(d?.getHours()).toBe(13);
  });

  test('rolls to the next day when today is past the last anchor', () => {
    const now = new Date(2026, 5, 18, 23, 0); // after 18:00
    const d = suggestSlotDate(now, [], 7, fixedJitter);
    expect(d?.getDate()).toBe(19);
    expect(d?.getHours()).toBe(9);
  });
});

describe('best-times slot picker (S0.4)', () => {
  const fixedJitter = () => 0; // → minute 4, never top-of-hour

  test('bestTimeCellScore prefers per-day rate and gates at n≥3', () => {
    expect(BEST_TIME_MIN_N).toBe(3);
    expect(bestTimeCellScore(cell(3, 17, 6, 2100))).toBe(2100);
    expect(bestTimeCellScore(cell(3, 17, 2, 9999))).toBeNull(); // below gate
    expect(bestTimeCellScore(cell(3, 17, 3, null))).toBeNull(); // gate met, no data
    expect(bestTimeCellScore(undefined)).toBeNull();
  });

  test('topCellsForWeekday returns gated cells best-first, capped', () => {
    const cells = [
      cell(4, 9, 5, 300),
      cell(4, 13, 5, 900),
      cell(4, 18, 5, 600),
      cell(4, 8, 2, 9999), // below the n gate — excluded
      cell(5, 12, 9, 5000), // wrong weekday — excluded
    ];
    expect(topCellsForWeekday(cells, 4).map((c) => c.hour)).toEqual([13, 18, 9]);
    expect(topCellsForWeekday(cells, 4, 2).map((c) => c.hour)).toEqual([13, 18]);
    // A weekday with no gated cells yields nothing (→ "no data" in the UI).
    expect(topCellsForWeekday(cells, 0)).toEqual([]);
  });

  test('suggestBestSlotDate picks the highest-scoring open anchor, jittered', () => {
    const now = new Date(2026, 5, 18, 7, 0); // Thu 07:00 local, before the 9 anchor
    const cells = [cell(4, 9, 5, 300), cell(4, 13, 5, 900), cell(4, 18, 5, 600)];
    const d = suggestBestSlotDate(now, [], cells, 7, fixedJitter);
    expect(d?.getDate()).toBe(18);
    expect(d?.getHours()).toBe(13); // 900 beats 600 and 300
    expect(d?.getMinutes()).toBe(4); // jittered — never :00
  });

  test('falls back to the earliest open anchor when no cell has data', () => {
    const now = new Date(2026, 5, 18, 7, 0);
    const d = suggestBestSlotDate(now, [], [], 7, fixedJitter);
    const earliest = suggestSlotDate(now, [], 7, fixedJitter);
    expect(d?.getDate()).toBe(earliest?.getDate());
    expect(d?.getHours()).toBe(earliest?.getHours());
    expect(d?.getHours()).toBe(9);
  });

  test('skips a claimed anchor and picks the next best', () => {
    const now = new Date(2026, 5, 18, 7, 0);
    const claimed = [new Date(2026, 5, 18, 13, 5)]; // 13 anchor taken today
    const cells = [cell(4, 9, 5, 300), cell(4, 13, 5, 900), cell(4, 18, 5, 600)];
    const d = suggestBestSlotDate(now, claimed, cells, 0, fixedJitter); // today only
    expect(d?.getHours()).toBe(18); // 13 gone → 600 beats 300
  });

  test('returns null when every anchor in the horizon is claimed', () => {
    const now = new Date(2026, 5, 18, 7, 0);
    const claimed = [
      new Date(2026, 5, 18, 9, 5),
      new Date(2026, 5, 18, 13, 5),
      new Date(2026, 5, 18, 18, 5),
    ];
    expect(suggestBestSlotDate(now, claimed, [], 0, fixedJitter)).toBeNull();
  });
});

describe('estimatePostCostUsd', () => {
  test('standard single post', () => {
    const c = estimatePostCostUsd({ threadMode: false, text: 'hello world', segments: [] });
    expect(c.usd).toBeCloseTo(0.015);
    expect(c.note).toBe('');
  });
  test('URL surcharge on a standalone post', () => {
    const c = estimatePostCostUsd({
      threadMode: false,
      text: 'read this https://example.com',
      segments: [],
    });
    expect(c.usd).toBeCloseTo(0.2);
    expect(c.note).toMatch(/surcharge/);
  });
  test('empty text is free', () => {
    expect(estimatePostCostUsd({ threadMode: false, text: '   ', segments: [] }).usd).toBe(0);
  });
  test('thread bills per non-empty segment', () => {
    const c = estimatePostCostUsd({ threadMode: true, text: '', segments: ['a', 'b', '', 'c'] });
    expect(c.usd).toBeCloseTo(0.045);
    expect(c.note).toBe('3 segments');
  });
  test('URL in head segment triggers the surcharge', () => {
    const c = estimatePostCostUsd({
      threadMode: true,
      text: '',
      segments: ['hook https://x.com', 'tail'],
    });
    expect(c.usd).toBeCloseTo(0.215); // 0.20 head + 0.015 tail
    expect(c.note).toMatch(/URL in head/);
  });
  test('URL in a tail segment stays at base price', () => {
    const c = estimatePostCostUsd({
      threadMode: true,
      text: '',
      segments: ['hook', 'link https://x.com'],
    });
    expect(c.usd).toBeCloseTo(0.03);
  });
});

describe('splitIntoThread', () => {
  test('short text stays one segment', () => {
    expect(splitIntoThread('just a tweet', 280)).toEqual(['just a tweet']);
  });
  test('splits on paragraph boundaries first', () => {
    const a = 'A'.repeat(150);
    const b = 'B'.repeat(150);
    const segs = splitIntoThread(`${a}\n\n${b}`, 280);
    expect(segs).toEqual([a, b]);
  });
  test('every segment respects the limit', () => {
    const long = 'Sentence one is here. Sentence two follows. '.repeat(20);
    const segs = splitIntoThread(long, 100);
    expect(segs.length).toBeGreaterThan(1);
    for (const s of segs) expect(s.length).toBeLessThanOrEqual(100);
    // no content dropped (modulo whitespace)
    expect(segs.join(' ').replace(/\s+/g, ' ').trim()).toBe(long.replace(/\s+/g, ' ').trim());
  });
  test('hard-splits a single oversized token', () => {
    const segs = splitIntoThread('x'.repeat(50), 20);
    expect(segs).toEqual(['x'.repeat(20), 'x'.repeat(20), 'x'.repeat(10)]);
  });
});
