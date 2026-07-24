import { describe, expect, test } from 'bun:test';
import type { ActiveTimesGrid } from '../shared/activeTimes.ts';
import type { BestTimeCell } from '../shared/types.ts';
import {
  ANCHORS_3,
  ANCHORS_4,
  BEST_TIME_MIN_N,
  audiencePeakHours,
  bestTimeCellScore,
  estimatePostCostUsd,
  findScheduleGaps,
  jitterMinutes,
  pickAnchors,
  slotHint,
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

// A 7×24 audience grid with the given (jsWeekday, hour) cells set to 1, all
// else 0. Columns run Mon..Sun; audienceScoreFor maps jsWeekday via (wd+6)%7.
function grid(hot: Array<[number, number]>): ActiveTimesGrid {
  const cells = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => 0));
  for (const [wd, hr] of hot) {
    (cells[(wd + 6) % 7] as number[])[hr] = 1;
  }
  return { cols: 7, rows: 24, grid: cells, tzOffsetMin: 0, metric: 'likes' };
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

describe('audience-blended slots (A3.4)', () => {
  const fixedJitter = () => 0;
  const now = new Date(2026, 5, 18, 7, 0); // Thu 07:00, before the 9 anchor

  test('a measured cell outranks a hotter but unmeasured audience slot', () => {
    const cells = [cell(4, 9, 5, 300)]; // only 9 is measured (and low)
    const aud = grid([[4, 18]]); // Thu 18h is the audience peak, 9h/13h cold
    // Tier 1 holds: measured 9 wins over hot-but-unmeasured 18.
    const d = suggestBestSlotDate(now, [], cells, 0, fixedJitter, aud);
    expect(d?.getHours()).toBe(9);
  });

  test('audience intensity breaks the tie among unmeasured slots', () => {
    const aud = grid([[4, 18]]); // Thu 18h hot, 9h/13h cold
    const withAud = suggestBestSlotDate(now, [], [], 0, fixedJitter, aud);
    expect(withAud?.getHours()).toBe(18); // later-but-hot beats earlier-cold
    const withoutAud = suggestBestSlotDate(now, [], [], 0, fixedJitter);
    expect(withoutAud?.getHours()).toBe(9); // no grid → earliest, unchanged
  });

  test('passing null audience is identical to omitting it', () => {
    const cells = [cell(4, 9, 5, 300), cell(4, 13, 5, 900), cell(4, 18, 5, 600)];
    const omitted = suggestBestSlotDate(now, [], cells, 7, fixedJitter);
    const nulled = suggestBestSlotDate(now, [], cells, 7, fixedJitter, null);
    expect(nulled?.getTime()).toBe(omitted?.getTime());
  });

  test('slotHint labels why a slot won', () => {
    expect(slotHint(cell(4, 9, 5, 300), 0.9)).toBe('measured'); // measured outranks audience
    expect(slotHint(cell(4, 9, 2, 999), 0.9)).toBe('audience'); // below n gate → audience
    expect(slotHint(undefined, 0.5)).toBe('audience');
    expect(slotHint(undefined, null)).toBeNull();
  });

  test('audiencePeakHours returns the busiest local hours, best-first', () => {
    const aud = grid([
      [4, 21],
      [4, 18],
    ]); // Thu 18h & 21h equally hot, rest cold
    expect(audiencePeakHours(aud, 4)).toEqual([18, 21]); // tie → earlier first
    expect(audiencePeakHours(aud, 4, 1)).toEqual([18]);
    expect(audiencePeakHours(aud, 0)).toEqual([]); // Sunday is all-cold → no peaks
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
