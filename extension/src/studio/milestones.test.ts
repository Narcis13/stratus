// S5.5 — the follower milestone detection is pure over the account series, so
// crossing logic is fully unit-testable without a browser or the account KPI.

import { describe, expect, test } from 'bun:test';
import { MILESTONES, latestCrossed } from './milestones.ts';

describe('latestCrossed', () => {
  test('a series climbing past 250 → 250 + the first crossing date', () => {
    const series = [
      { date: '2026-07-01', followers: 100 },
      { date: '2026-07-05', followers: 240 },
      { date: '2026-07-08', followers: 260 },
      { date: '2026-07-10', followers: 300 },
    ];
    expect(latestCrossed(series)).toEqual({ milestone: 250, crossedOn: '2026-07-08' });
  });

  test('below the first rung → null', () => {
    expect(latestCrossed([{ date: '2026-07-01', followers: 40 }])).toBeNull();
  });

  test('empty series → null', () => {
    expect(latestCrossed([])).toBeNull();
  });

  test('unordered input tolerated — the earliest crossing date wins', () => {
    const series = [
      { date: '2026-07-10', followers: 300 },
      { date: '2026-07-01', followers: 100 },
      { date: '2026-07-08', followers: 260 },
    ];
    expect(latestCrossed(series)).toEqual({ milestone: 250, crossedOn: '2026-07-08' });
  });

  test('exact-equal boundary counts as crossed (>=)', () => {
    expect(latestCrossed([{ date: '2026-07-02', followers: 1000 }])).toEqual({
      milestone: 1000,
      crossedOn: '2026-07-02',
    });
  });

  test('picks the highest rung the peak reached', () => {
    expect(latestCrossed([{ date: '2026-07-02', followers: 5200 }])).toEqual({
      milestone: 5000,
      crossedOn: '2026-07-02',
    });
  });

  test('a later dip never un-crosses an earned rung (uses the peak)', () => {
    const series = [
      { date: '2026-07-01', followers: 520 },
      { date: '2026-07-05', followers: 480 },
    ];
    expect(latestCrossed(series)).toEqual({ milestone: 500, crossedOn: '2026-07-01' });
  });

  test('ladder is ascending and starts at 50', () => {
    expect(MILESTONES[0]).toBe(50);
    for (let i = 1; i < MILESTONES.length; i++) {
      expect(MILESTONES[i]).toBeGreaterThan(MILESTONES[i - 1] as number);
    }
  });
});
