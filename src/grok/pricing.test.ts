// xAI price table — the image-model entries (SURFACES S4). The token path is
// exercised indirectly by the reply/drafter suites; this locks the flat
// per-image fallback rate so a generation without reported usage never silently
// prices to $0. (The live path prefers the response's cost_in_usd_ticks.)

import { describe, expect, test } from 'bun:test';
import { isKnownImageModel, priceForImage } from './pricing.ts';

describe('priceForImage (S4)', () => {
  test('grok-imagine-image is $0.02/image and scales with n', () => {
    expect(priceForImage('grok-imagine-image', 1)).toBeCloseTo(0.02, 5);
    expect(priceForImage('grok-imagine-image', 2)).toBeCloseTo(0.04, 5);
    expect(priceForImage('grok-imagine-image-quality', 1)).toBeCloseTo(0.05, 5);
  });

  test('n of 0 or negative bills nothing', () => {
    expect(priceForImage('grok-imagine-image', 0)).toBe(0);
    expect(priceForImage('grok-imagine-image', -3)).toBe(0);
  });

  test('an unmapped image model prices to $0 (the route shouts)', () => {
    expect(priceForImage('grok-99-image', 1)).toBe(0);
    expect(isKnownImageModel('grok-99-image')).toBe(false);
  });

  test('isKnownImageModel recognizes the mapped models', () => {
    expect(isKnownImageModel('grok-imagine-image')).toBe(true);
    expect(isKnownImageModel('grok-imagine-image-quality')).toBe(true);
  });
});
