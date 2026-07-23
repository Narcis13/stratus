import { describe, expect, test } from 'bun:test';
import {
  DEFAULT_HARVEST_FORM,
  type HarvestForm,
  harvestTargetUrl,
  isAtTarget,
  isFollowingPath,
  parseHarvestForm,
  passesMinViews,
  passiveRowsToday,
} from './harvest.ts';
import type { HarvestRun } from './types.ts';

describe('passesMinViews (HV.3)', () => {
  test('an absent floor keeps everything', () => {
    expect(passesMinViews(0)).toBe(true);
    expect(passesMinViews(1_000_000)).toBe(true);
  });

  test('a zero or negative floor keeps everything', () => {
    expect(passesMinViews(0, 0)).toBe(true);
    expect(passesMinViews(0, -5)).toBe(true);
  });

  test('a NaN floor keeps everything — a half-typed input must not drop rows', () => {
    expect(passesMinViews(0, Number.NaN)).toBe(true);
  });

  test('the floor is inclusive', () => {
    expect(passesMinViews(999, 1000)).toBe(false);
    expect(passesMinViews(1000, 1000)).toBe(true);
    expect(passesMinViews(1001, 1000)).toBe(true);
  });
});

describe('parseHarvestForm (HV.3)', () => {
  test('round-trips a full form', () => {
    const form: HarvestForm = {
      mode: 'replies',
      scope: 'since-last',
      pace: 'slow',
      maxStr: '250',
      minViewsStr: '1000',
      downloadCsv: false,
    };
    expect(parseHarvestForm(form)).toEqual(form);
  });

  test('a missing / non-object value yields the defaults', () => {
    expect(parseHarvestForm(undefined)).toEqual(DEFAULT_HARVEST_FORM);
    expect(parseHarvestForm(null)).toEqual(DEFAULT_HARVEST_FORM);
    expect(parseHarvestForm('nope')).toEqual(DEFAULT_HARVEST_FORM);
    expect(parseHarvestForm([])).toEqual(DEFAULT_HARVEST_FORM);
  });

  test('each bad field falls back on its own, the good ones survive', () => {
    expect(
      parseHarvestForm({
        mode: 'timeline',
        scope: 'last-week',
        pace: 'turbo',
        maxStr: '12',
        minViewsStr: 'lots',
        downloadCsv: 'yes',
        extra: 1,
      }),
    ).toEqual({ ...DEFAULT_HARVEST_FORM, maxStr: '12' });
  });

  test('numeric fields keep only digit strings — blank stays blank', () => {
    expect(parseHarvestForm({ maxStr: '', minViewsStr: '' })).toEqual(DEFAULT_HARVEST_FORM);
    expect(parseHarvestForm({ minViewsStr: -5 }).minViewsStr).toBe('');
    expect(parseHarvestForm({ minViewsStr: '1e3' }).minViewsStr).toBe('');
  });

  test('the default form is CSV-on, so an older build restores unchanged behaviour', () => {
    expect(parseHarvestForm({ mode: 'replies' }).downloadCsv).toBe(true);
  });

  test('following mode round-trips (GR.2)', () => {
    expect(parseHarvestForm({ mode: 'following' }).mode).toBe('following');
  });
});

describe('following-mode URLs (GR.2)', () => {
  test('isFollowingPath accepts a profile following page, with or without the slash', () => {
    expect(isFollowingPath('https://x.com/narcis/following')).toBe(true);
    expect(isFollowingPath('https://x.com/narcis/following/')).toBe(true);
    expect(isFollowingPath('/narcis/following')).toBe(true);
  });

  test('it rejects the neighbouring list pages', () => {
    expect(isFollowingPath('https://x.com/narcis/followers')).toBe(false);
    expect(isFollowingPath('https://x.com/narcis/verified_followers')).toBe(false);
    expect(isFollowingPath('https://x.com/narcis')).toBe(false);
    expect(isFollowingPath('https://x.com/narcis/following/extra')).toBe(false);
  });

  // /i/ is an app route, not a handle — scraping it would file X's own UI as
  // people I follow.
  test('it rejects reserved first segments', () => {
    expect(isFollowingPath('https://x.com/i/following')).toBe(false);
    expect(isFollowingPath('https://x.com/settings/following')).toBe(false);
  });

  test('harvestTargetUrl and isAtTarget agree for every mode', () => {
    expect(harvestTargetUrl('narcis', 'following')).toBe('https://x.com/narcis/following');
    expect(harvestTargetUrl('narcis', 'replies')).toBe('https://x.com/narcis/with_replies');
    expect(harvestTargetUrl('narcis', 'posts')).toBe('https://x.com/narcis');
    for (const mode of ['posts', 'replies', 'following'] as const) {
      expect(isAtTarget(harvestTargetUrl('narcis', mode), 'narcis', mode)).toBe(true);
    }
  });

  test('isAtTarget is case-insensitive but mode-exact', () => {
    expect(isAtTarget('https://x.com/Narcis/Following', 'narcis', 'following')).toBe(true);
    expect(isAtTarget('https://x.com/narcis/following/', 'narcis', 'following')).toBe(true);
    expect(isAtTarget('https://x.com/narcis', 'narcis', 'following')).toBe(false);
    expect(isAtTarget('https://x.com/narcis/following', 'narcis', 'posts')).toBe(false);
  });
});

describe('passiveRowsToday (HV.3)', () => {
  const now = Date.parse('2026-07-23T04:10:00.000Z');
  const run = (over: Partial<HarvestRun>): HarvestRun => ({
    id: 'r1',
    handle: 'timeline',
    mode: 'timeline',
    scope: 'passive',
    rowCount: 0,
    createdAt: '2026-07-23T00:00:00.000Z',
    ...over,
  });

  test('counts today’s timeline run', () => {
    expect(passiveRowsToday([run({ rowCount: 412 })], now)).toBe(412);
  });

  test('ignores hand-run harvests, whatever their row count', () => {
    expect(
      passiveRowsToday([run({ id: 'r2', mode: 'posts', handle: 'alice', rowCount: 900 })], now),
    ).toBe(0);
  });

  test('ignores yesterday’s passive run', () => {
    expect(
      passiveRowsToday([run({ createdAt: '2026-07-22T00:00:00.000Z', rowCount: 2000 })], now),
    ).toBe(0);
  });

  // The server keys its run by UTC day; at 04:10 UTC a local-midnight window in
  // UTC+3 would have started at 21:00 the previous UTC day and swallowed it.
  test('the day boundary is UTC, not local', () => {
    const justAfterUtcMidnight = Date.parse('2026-07-23T00:00:01.000Z');
    expect(
      passiveRowsToday(
        [run({ createdAt: '2026-07-22T23:59:59.000Z', rowCount: 7 })],
        justAfterUtcMidnight,
      ),
    ).toBe(0);
  });

  test('sums rather than first-matching, and survives an unparseable date', () => {
    expect(
      passiveRowsToday(
        [
          run({ id: 'a', rowCount: 10 }),
          run({ id: 'b', createdAt: 'not a date', rowCount: 99 }),
          run({ id: 'c', createdAt: '2026-07-23T03:00:00.000Z', rowCount: 5 }),
        ],
        now,
      ),
    ).toBe(15);
  });

  test('an empty run log reads zero', () => {
    expect(passiveRowsToday([], now)).toBe(0);
  });
});
