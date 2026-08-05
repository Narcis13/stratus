import { describe, expect, test } from 'bun:test';
import {
  CANNON,
  type CannonThresholds,
  cannonAgeTone,
  cannonScore,
  isCannonEligible,
} from './cannon.ts';

function sig(views: number, replies: number, ageMin: number, bait = false) {
  return { views, replies, ageMin, vpm: views / Math.max(ageMin, 1), bait };
}

const with_ = (over: Partial<CannonThresholds>): CannonThresholds => ({ ...CANNON, ...over });

describe('cannonScore', () => {
  // The shape the whole feature exists for: a lot of eyes, almost no crowd.
  test('big views over a handful of replies (200491v / 8r)', () => {
    expect(cannonScore(sig(200491, 8, 12))).toBeCloseTo(22276.8, 1);
  });

  test('zero replies scores the raw views (the +1 is the zero guard)', () => {
    expect(cannonScore(sig(9000, 0, 3))).toBe(9000);
  });

  test('zero views scores 0 whatever the replies', () => {
    expect(cannonScore(sig(0, 0, 1))).toBe(0);
    expect(cannonScore(sig(0, 40, 60))).toBe(0);
  });

  test('a crowd already under it collapses the score', () => {
    // Same 200k views, 400 replies: 500 v/reply, an order of magnitude under
    // the 8-reply version and (at the shipped floor) still eligible — the model
    // discounts the crowd, it does not veto it.
    expect(cannonScore(sig(200000, 399, 12))).toBe(500);
  });
});

describe('isCannonEligible', () => {
  test('exactly the score floor passes', () => {
    expect(isCannonEligible(sig(CANNON.scoreMin, 0, 5))).toBe(true);
    expect(isCannonEligible(sig(CANNON.scoreMin - 1, 0, 5))).toBe(false);
  });

  test('exactly the age cutoff passes, one minute past fails', () => {
    expect(isCannonEligible(sig(50_000, 1, CANNON.maxAgeMin))).toBe(true);
    expect(isCannonEligible(sig(50_000, 1, CANNON.maxAgeMin + 1))).toBe(false);
  });

  test('both halves are required', () => {
    expect(isCannonEligible(sig(10, 5, 1))).toBe(false); // fresh, but dead
  });

  test('the threshold argument overrides the default (the mirrored blob path)', () => {
    const s = sig(5000, 0, 20);
    expect(isCannonEligible(s)).toBe(true);
    expect(isCannonEligible(s, with_({ scoreMin: 10_000 }))).toBe(false);
    expect(isCannonEligible(s, with_({ maxAgeMin: 10 }))).toBe(false);
  });

  test('the shipped floor is the MEASURED p90, not the borrowed 5,000', () => {
    // §7.33: 0.60% of the harvest corpus cleared 5,000. Pinned so a future edit
    // back to a borrowed number has to argue with a test.
    expect(CANNON.scoreMin).toBe(120);
  });
});

describe('cannonAgeTone', () => {
  test("exactly redAgeMin still reads 'ok' (strict >)", () => {
    expect(cannonAgeTone(CANNON.redAgeMin)).toBe('ok');
    expect(cannonAgeTone(CANNON.redAgeMin + 1)).toBe('red');
    expect(cannonAgeTone(0)).toBe('ok');
  });

  test('a red age is still eligible until the cutoff', () => {
    const s = sig(50_000, 1, CANNON.redAgeMin + 1);
    expect(cannonAgeTone(s.ageMin)).toBe('red');
    expect(isCannonEligible(s)).toBe(true);
  });

  test('the threshold argument overrides the default', () => {
    expect(cannonAgeTone(20, with_({ redAgeMin: 25 }))).toBe('ok');
    expect(cannonAgeTone(20, with_({ redAgeMin: 5 }))).toBe('red');
  });
});
