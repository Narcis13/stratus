// GR.3 curation — pure eligibility + cadence budget. No DB, no clock: every fn
// takes the rows, the whitelist and `now`, so the whole matrix is table-driven.

import { describe, expect, test } from 'bun:test';
import {
  type CurationRow,
  DAILY_CEILING,
  GRACE_DAYS,
  UNFOLLOW_WINDOW_MS,
  WINDOW_CAP_MAX,
  WINDOW_CAP_MIN,
  eligibleForUnfollow,
  rankForUnfollow,
  releaseBudget,
  reviewQueued,
} from './connections.ts';

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-07-23T12:00:00.000Z');

function row(handle: string, over: Partial<CurationRow> = {}): CurationRow {
  return {
    handle,
    displayName: `${handle} name`,
    status: 'active',
    followsBack: false,
    keep: false,
    // Comfortably past grace unless a test overrides it.
    firstSeenAt: new Date(NOW.getTime() - 30 * DAY_MS),
    listPosition: null,
    ...over,
  };
}

describe('eligibleForUnfollow', () => {
  test('only active, non-following, non-kept, non-whitelisted, past-grace rows survive', () => {
    const rows = [
      row('a'),
      row('follower', { followsBack: true }),
      row('kept', { keep: true }),
      row('ally'), // whitelisted below
      row('queued_already', { status: 'queued' }),
      row('gone_row', { status: 'gone' }),
      row('fresh', { firstSeenAt: new Date(NOW.getTime() - 2 * DAY_MS) }),
    ];
    const out = eligibleForUnfollow(rows, new Set(['ally']), NOW);
    expect(out.map((r) => r.handle)).toEqual(['a']);
  });

  test('grace boundary is inclusive at exactly GRACE_DAYS', () => {
    const exactly = row('exactly', {
      firstSeenAt: new Date(NOW.getTime() - GRACE_DAYS * DAY_MS),
    });
    const oneMsShort = row('short', {
      firstSeenAt: new Date(NOW.getTime() - GRACE_DAYS * DAY_MS + 1),
    });
    const out = eligibleForUnfollow([exactly, oneMsShort], new Set(), NOW);
    expect(out.map((r) => r.handle)).toEqual(['exactly']);
  });

  test('ranks oldest first, list_position desc as tie-break, handle to break a full tie', () => {
    const old = new Date(NOW.getTime() - 40 * DAY_MS);
    const newer = new Date(NOW.getTime() - 20 * DAY_MS);
    const rows = [
      row('newer', { firstSeenAt: newer }),
      row('old_lowpos', { firstSeenAt: old, listPosition: 5 }),
      row('old_highpos', { firstSeenAt: old, listPosition: 900 }),
      row('old_nopos', { firstSeenAt: old, listPosition: null }),
      // exact tie with old_highpos on age AND position → handle asc decides.
      row('old_highpos_b', { firstSeenAt: old, listPosition: 900 }),
    ];
    const out = eligibleForUnfollow(rows, new Set(), NOW);
    // Oldest four first (highest position among the tied = the older follow),
    // null position sorts last within the same age, newest last overall.
    expect(out.map((r) => r.handle)).toEqual([
      'old_highpos',
      'old_highpos_b',
      'old_lowpos',
      'old_nopos',
      'newer',
    ]);
  });
});

describe('reviewQueued', () => {
  test('splits queued rows into held vs revoked and ranks the held', () => {
    const old = new Date(NOW.getTime() - 40 * DAY_MS);
    const newer = new Date(NOW.getTime() - 20 * DAY_MS);
    const rows = [
      row('active_ignored'), // not queued → neither list
      row('q_new', { status: 'queued', firstSeenAt: newer }),
      row('q_old', { status: 'queued', firstSeenAt: old }),
      row('q_kept', { status: 'queued', keep: true }),
      row('q_followsback', { status: 'queued', followsBack: true }),
      row('q_ally', { status: 'queued' }),
    ];
    const { held, revoked } = reviewQueued(rows, new Set(['q_ally']));
    expect(held.map((r) => r.handle)).toEqual(['q_old', 'q_new']);
    expect(revoked.map((r) => r.handle).sort()).toEqual(['q_ally', 'q_followsback', 'q_kept']);
  });
});

describe('rankForUnfollow', () => {
  test('does not mutate its input', () => {
    const rows = [row('b'), row('a')];
    const snapshot = rows.map((r) => r.handle);
    rankForUnfollow(rows);
    expect(rows.map((r) => r.handle)).toEqual(snapshot);
  });
});

describe('releaseBudget', () => {
  test('empty window draws a jittered cap in [MIN, MAX]', () => {
    const low = releaseBudget([], NOW, () => 0);
    expect(low.windowCap).toBe(WINDOW_CAP_MIN);
    expect(low.budget).toBe(WINDOW_CAP_MIN);
    expect(low.windowUsed).toBe(0);
    expect(low.dailyUsed).toBe(0);

    const high = releaseBudget([], NOW, () => 0.999999);
    expect(high.windowCap).toBe(WINDOW_CAP_MAX);
    expect(high.budget).toBe(WINDOW_CAP_MAX);

    // The draw stays inside the band for any rand in [0,1).
    for (const r of [0.1, 0.33, 0.5, 0.75, 0.95]) {
      const cap = releaseBudget([], NOW, () => r).windowCap;
      expect(cap).toBeGreaterThanOrEqual(WINDOW_CAP_MIN);
      expect(cap).toBeLessThanOrEqual(WINDOW_CAP_MAX);
    }
  });

  test('marks inside the 6h window reduce the budget; older-but-same-day marks only count daily', () => {
    const inWindow = [
      new Date(NOW.getTime() - 1 * 60 * 60 * 1000),
      new Date(NOW.getTime() - 3 * 60 * 60 * 1000),
    ];
    const sameDayOutOfWindow = [
      new Date(NOW.getTime() - 10 * 60 * 60 * 1000),
      new Date(NOW.getTime() - 20 * 60 * 60 * 1000),
      new Date(NOW.getTime() - 23 * 60 * 60 * 1000),
    ];
    const b = releaseBudget([...inWindow, ...sameDayOutOfWindow], NOW, () => 0);
    expect(b.windowUsed).toBe(2);
    expect(b.dailyUsed).toBe(5);
    expect(b.budget).toBe(WINDOW_CAP_MIN - 2);
  });

  test('marks older than the window edge and the day edge are dropped', () => {
    const justOutsideWindow = new Date(NOW.getTime() - UNFOLLOW_WINDOW_MS - 1);
    const justOutsideDay = new Date(NOW.getTime() - DAY_MS - 1);
    const b = releaseBudget([justOutsideWindow, justOutsideDay], NOW, () => 0);
    expect(b.windowUsed).toBe(0);
    expect(b.dailyUsed).toBe(1); // only the one still inside 24h
    expect(b.budget).toBe(WINDOW_CAP_MIN);
  });

  test('the daily ceiling zeroes the budget regardless of the window', () => {
    // DAILY_CEILING marks spread across the day, none in the last 6h — the window
    // is clear but the day is not, so the queue still refuses to release.
    const marks = Array.from(
      { length: DAILY_CEILING },
      (_, i) => new Date(NOW.getTime() - (7 + (i % 16)) * 60 * 60 * 1000),
    );
    const b = releaseBudget(marks, NOW, () => 0.999999);
    expect(b.dailyUsed).toBe(DAILY_CEILING);
    expect(b.windowUsed).toBe(0);
    expect(b.budget).toBe(0);
  });

  test('never goes negative when the window is over-full', () => {
    const marks = Array.from(
      { length: WINDOW_CAP_MAX + 5 },
      () => new Date(NOW.getTime() - 60 * 1000),
    );
    const b = releaseBudget(marks, NOW, () => 0);
    expect(b.budget).toBe(0);
  });
});
