import { describe, expect, test } from 'bun:test';
import {
  MIN_PROFILE_CLICKS,
  computeConversion,
  conversionForWindow,
  conversionRate,
  followerDeltaOverWindow,
  sumProfileClicks,
} from './conversion.ts';

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-07-10T12:00:00Z');
const daysAgo = (d: number) => new Date(NOW.getTime() - d * DAY_MS);

describe('conversionRate', () => {
  test('gates below the min-sample threshold', () => {
    expect(conversionRate(MIN_PROFILE_CLICKS - 1, 5)).toBeNull();
    expect(conversionRate(MIN_PROFILE_CLICKS, 5)).toBe(5 / MIN_PROFILE_CLICKS);
  });

  test('null follower delta → null rate even with plenty of clicks', () => {
    expect(conversionRate(1000, null)).toBeNull();
  });

  test('a follower drop yields a negative (leaking) rate', () => {
    expect(conversionRate(100, -10)).toBe(-0.1);
  });
});

describe('followerDeltaOverWindow', () => {
  test('needs two points', () => {
    expect(
      followerDeltaOverWindow([{ snapshotAt: daysAgo(3), followers: 500 }], NOW, 7),
    ).toBeNull();
  });

  test('baseline is the newest point at least windowDays old', () => {
    const points = [
      { snapshotAt: daysAgo(10), followers: 480 },
      { snapshotAt: daysAgo(8), followers: 490 }, // still ≥7d old → the 7d baseline
      { snapshotAt: daysAgo(2), followers: 520 },
      { snapshotAt: daysAgo(0), followers: 527 },
    ];
    expect(followerDeltaOverWindow(points, NOW, 7)).toBe(527 - 490);
    // The 28d window falls back to the oldest point (history is shorter).
    expect(followerDeltaOverWindow(points, NOW, 28)).toBe(527 - 480);
  });

  test('when every point is inside the window, falls back to oldest', () => {
    const points = [
      { snapshotAt: daysAgo(3), followers: 500 },
      { snapshotAt: daysAgo(1), followers: 512 },
    ];
    expect(followerDeltaOverWindow(points, NOW, 7)).toBe(12);
  });
});

describe('sumProfileClicks', () => {
  test('sums only tweets inside the window, ignoring nulls', () => {
    const tweets = [
      { postedAt: daysAgo(30), profileVisits: 100 }, // outside 28d
      { postedAt: daysAgo(20), profileVisits: 40 },
      { postedAt: daysAgo(5), profileVisits: 12 },
      { postedAt: daysAgo(1), profileVisits: null }, // unmeasured
    ];
    expect(sumProfileClicks(tweets, NOW, 7)).toBe(12);
    expect(sumProfileClicks(tweets, NOW, 28)).toBe(52);
  });
});

describe('conversionForWindow', () => {
  test('rate = follower delta ÷ profile clicks when clicks clear the gate', () => {
    const points = [
      { snapshotAt: daysAgo(10), followers: 300 },
      { snapshotAt: daysAgo(0), followers: 309 },
    ];
    const tweets = [
      { postedAt: daysAgo(6), profileVisits: 200 },
      { postedAt: daysAgo(2), profileVisits: 112 },
    ];
    const w = conversionForWindow(points, tweets, NOW, 7);
    expect(w.profileClicks).toBe(312);
    expect(w.followerDelta).toBe(9);
    expect(w.rate).toBeCloseTo(9 / 312, 10);
  });

  test('too few clicks → rate null, but the raw facts still report', () => {
    const points = [
      { snapshotAt: daysAgo(10), followers: 300 },
      { snapshotAt: daysAgo(0), followers: 309 },
    ];
    const tweets = [{ postedAt: daysAgo(2), profileVisits: 5 }];
    const w = conversionForWindow(points, tweets, NOW, 7);
    expect(w.profileClicks).toBe(5);
    expect(w.followerDelta).toBe(9);
    expect(w.rate).toBeNull();
  });
});

describe('computeConversion', () => {
  test('returns both windows', () => {
    const points = [
      { snapshotAt: daysAgo(29), followers: 200 },
      { snapshotAt: daysAgo(8), followers: 250 },
      { snapshotAt: daysAgo(0), followers: 280 },
    ];
    const tweets = [
      { postedAt: daysAgo(20), profileVisits: 500 },
      { postedAt: daysAgo(3), profileVisits: 400 },
    ];
    const { d7, d28 } = computeConversion(points, tweets, NOW);
    expect(d7.windowDays).toBe(7);
    expect(d7.profileClicks).toBe(400);
    expect(d7.followerDelta).toBe(280 - 250);
    expect(d28.windowDays).toBe(28);
    expect(d28.profileClicks).toBe(900);
    expect(d28.followerDelta).toBe(280 - 200);
    expect(d28.rate).toBeCloseTo(80 / 900, 10);
  });
});
