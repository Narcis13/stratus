import { describe, expect, test } from 'bun:test';
import {
  PASTE_COOLDOWN_MS,
  PASTE_PACE_STALE_MS,
  formatElapsed,
  pastePaceAt,
  readLastPickAt,
} from './pastePace.ts';

const NOW = 1_800_000_000_000;

describe('readLastPickAt', () => {
  test('takes a stamp', () => {
    expect(readLastPickAt(NOW)).toBe(NOW);
  });

  test('anything else reads as no pick', () => {
    expect(readLastPickAt(undefined)).toBeNull();
    expect(readLastPickAt(null)).toBeNull();
    expect(readLastPickAt(String(NOW))).toBeNull();
    expect(readLastPickAt(0)).toBeNull();
    expect(readLastPickAt(-1)).toBeNull();
    expect(readLastPickAt(Number.NaN)).toBeNull();
    expect(readLastPickAt({ at: NOW })).toBeNull();
  });
});

describe('formatElapsed', () => {
  test('seconds while seconds are the unit', () => {
    expect(formatElapsed(0)).toBe('0s');
    expect(formatElapsed(12_400)).toBe('12s');
    expect(formatElapsed(59_999)).toBe('59s');
  });

  test('minutes past the first one, zero-padded so it does not shimmy', () => {
    expect(formatElapsed(60_000)).toBe('1m 00s');
    expect(formatElapsed(64_000)).toBe('1m 04s');
    expect(formatElapsed(9 * 60_000 + 59_000)).toBe('9m 59s');
    expect(formatElapsed(11 * 60_000)).toBe('11m');
  });

  test('never counts backwards', () => {
    expect(formatElapsed(-5_000)).toBe('0s');
  });
});

describe('pastePaceAt', () => {
  test('no pick yet is cold, and never a warning', () => {
    const pace = pastePaceAt(null, NOW);
    expect(pace.tone).toBe('cold');
    expect(pace.hint).toBeNull();
    expect(pace.remainingMs).toBe(0);
  });

  test('inside the cooldown it counts down what is left', () => {
    const pace = pastePaceAt(NOW - 12_000, NOW);
    expect(pace.tone).toBe('wait');
    expect(pace.sinceMs).toBe(12_000);
    expect(pace.remainingMs).toBe(PASTE_COOLDOWN_MS - 12_000);
    expect(pace.label).toBe('Copied 12s ago — wait 28s before pasting');
    expect(pace.hint).toBe('wait 28s — you copied one 12s ago');
  });

  test('the wait rounds up, so it never reads 0s while still waiting', () => {
    const pace = pastePaceAt(NOW - (PASTE_COOLDOWN_MS - 100), NOW);
    expect(pace.tone).toBe('wait');
    expect(pace.hint).toBe('wait 1s — you copied one 39s ago');
  });

  test('the cooldown boundary itself is clear', () => {
    const pace = pastePaceAt(NOW - PASTE_COOLDOWN_MS, NOW);
    expect(pace.tone).toBe('clear');
    expect(pace.remainingMs).toBe(0);
    expect(pace.hint).toBeNull();
    expect(pace.label).toBe('Copied 40s ago — clear to paste');
  });

  test('past the stale window the clock stops being interesting', () => {
    const pace = pastePaceAt(NOW - PASTE_PACE_STALE_MS, NOW);
    expect(pace.tone).toBe('cold');
    expect(pace.sinceMs).toBe(0);
    expect(pace.label).toBe('No recent copy — clear to paste');
  });

  test('a stamp from the future clamps to just-now rather than reading clear', () => {
    const pace = pastePaceAt(NOW + 60_000, NOW);
    expect(pace.tone).toBe('wait');
    expect(pace.sinceMs).toBe(0);
    expect(pace.remainingMs).toBe(PASTE_COOLDOWN_MS);
  });

  test('the cooldown is a parameter, not a hardcode', () => {
    expect(pastePaceAt(NOW - 12_000, NOW, 10_000).tone).toBe('clear');
    expect(pastePaceAt(NOW - 12_000, NOW, 90_000).hint).toBe('wait 78s — you copied one 12s ago');
  });
});
