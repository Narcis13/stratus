// The hype reel's count-up math is a pure function of elapsed time, so the
// whole animation is testable without a browser, a clock, or a canvas.

import { describe, expect, test } from 'bun:test';
import {
  DEFAULT_TIMING,
  type HypeTiming,
  countUpValue,
  easeOutExpo,
  formatHypeCount,
  hypeBars,
  hypeDone,
  hypeDurationMs,
  hypeEngagementPct,
  hypeFrame,
  hypeMetrics,
  metricProgress,
} from './hype.ts';

const T: HypeTiming = { durationMs: 1000, staggerMs: 100, leadInMs: 200, holdMs: 500 };

const POST = { views: 12_345, likes: 210, replies: 18, reposts: 7, bookmarks: 33 };

describe('easeOutExpo', () => {
  test('pinned at both ends', () => {
    expect(easeOutExpo(0)).toBe(0);
    expect(easeOutExpo(1)).toBe(1);
    expect(easeOutExpo(-3)).toBe(0);
    expect(easeOutExpo(4)).toBe(1);
  });

  test('front-loaded — half the time is well past half the distance', () => {
    expect(easeOutExpo(0.5)).toBeGreaterThan(0.9);
  });

  test('monotonic', () => {
    let prev = -1;
    for (let t = 0; t <= 1.0001; t += 0.05) {
      const v = easeOutExpo(t);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });
});

describe('metricProgress', () => {
  test('nothing moves during the lead-in', () => {
    expect(metricProgress(0, 0, T)).toBe(0);
    expect(metricProgress(199, 0, T)).toBe(0);
  });

  test('each counter starts one stagger later than the one before it', () => {
    expect(metricProgress(250, 0, T)).toBeCloseTo(0.05);
    expect(metricProgress(250, 1, T)).toBe(0);
    expect(metricProgress(350, 1, T)).toBeCloseTo(0.05);
  });

  test('clamps at 1 once its own duration is spent', () => {
    expect(metricProgress(1200, 0, T)).toBe(1);
    expect(metricProgress(99_999, 4, T)).toBe(1);
  });
});

describe('countUpValue', () => {
  test('starts at zero and lands exactly on the target', () => {
    expect(countUpValue(12_345, 0)).toBe(0);
    expect(countUpValue(12_345, 1)).toBe(12_345);
  });

  test('never overshoots mid-flight', () => {
    for (let p = 0; p <= 1.0001; p += 0.05) {
      const v = countUpValue(12_345, p);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(12_345);
    }
  });

  test('a target of 1 shows 1 for the whole climb, never a stuck 0', () => {
    expect(countUpValue(1, 0.01)).toBe(1);
    expect(countUpValue(1, 1)).toBe(1);
  });

  test('a target of 0 stays 0', () => {
    expect(countUpValue(0, 0.5)).toBe(0);
    expect(countUpValue(0, 1)).toBe(0);
  });
});

describe('hypeFrame', () => {
  const metrics = hypeMetrics(POST);

  test('frame 0 is all zeroes, and the keys keep the order handed in', () => {
    const cells = hypeFrame(metrics, 0, T);
    expect(cells.map((c) => c.key)).toEqual(['views', 'likes', 'replies', 'reposts', 'bookmarks']);
    expect(cells.every((c) => c.value === 0)).toBe(true);
  });

  test('the last frame is the real numbers', () => {
    const cells = hypeFrame(metrics, hypeDurationMs(metrics.length, T), T);
    expect(cells.map((c) => c.value)).toEqual([12_345, 210, 18, 7, 33]);
  });

  test('the stagger is visible — views is ahead of bookmarks mid-reel', () => {
    const cells = hypeFrame(metrics, T.leadInMs + 50, T);
    expect(cells[0]?.progress).toBeGreaterThan(cells[4]?.progress ?? 1);
    expect(cells[4]?.progress).toBe(0);
  });

  test('a zero metric still gets a tile — the grid never reshuffles', () => {
    const cells = hypeFrame(hypeMetrics({ ...POST, reposts: 0 }), 999_999, T);
    expect(cells).toHaveLength(5);
    expect(cells.find((c) => c.key === 'reposts')?.value).toBe(0);
  });
});

describe('hypeDurationMs / hypeDone', () => {
  test('five counters = lead-in + four staggers + one duration + hold', () => {
    expect(hypeDurationMs(5, T)).toBe(200 + 400 + 1000 + 500);
  });

  test('not done a frame early, done at the boundary', () => {
    const total = hypeDurationMs(5, T);
    expect(hypeDone(5, total - 1, T)).toBe(false);
    expect(hypeDone(5, total, T)).toBe(true);
  });

  test('the shipped default reel runs a few seconds — long enough to record', () => {
    const total = hypeDurationMs(5, DEFAULT_TIMING);
    expect(total).toBeGreaterThan(3000);
    expect(total).toBeLessThan(15_000);
  });
});

describe('formatHypeCount', () => {
  test('small numbers keep their digits', () => {
    expect(formatHypeCount(0)).toBe('0');
    expect(formatHypeCount(7)).toBe('7');
    expect(formatHypeCount(1234)).toBe('1,234');
    expect(formatHypeCount(9999)).toBe('9,999');
  });

  test('compacts above 10K so a counting frame does not jitter units', () => {
    expect(formatHypeCount(10_000)).toBe('10.0K');
    expect(formatHypeCount(12_345)).toBe('12.3K');
    expect(formatHypeCount(1_234_567)).toBe('1.23M');
  });

  test('junk in never renders junk out', () => {
    expect(formatHypeCount(Number.NaN)).toBe('0');
    expect(formatHypeCount(-5)).toBe('0');
  });
});

describe('hypeEngagementPct', () => {
  test('actions over views, one decimal', () => {
    expect(
      hypeEngagementPct({ views: 1000, likes: 20, replies: 5, reposts: 3, bookmarks: 2 }),
    ).toBe(3);
  });

  test('zero views → null, never a fabricated 0%', () => {
    expect(
      hypeEngagementPct({ views: 0, likes: 4, replies: 0, reposts: 0, bookmarks: 0 }),
    ).toBeNull();
  });
});

describe('hypeBars', () => {
  test('starts flat, ends as a full left-to-right ramp', () => {
    expect(hypeBars(4, 0)).toEqual([0, 0, 0, 0]);
    expect(hypeBars(4, 1)).toEqual([0.25, 0.5, 0.75, 1]);
  });

  test('never exceeds 1 and never goes backwards along the row', () => {
    const bars = hypeBars(6, 0.4);
    expect(Math.max(...bars)).toBeLessThanOrEqual(1);
    for (let i = 1; i < bars.length; i++) {
      expect(bars[i] as number).toBeGreaterThanOrEqual(bars[i - 1] as number);
    }
  });
});
