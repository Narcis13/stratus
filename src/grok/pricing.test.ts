// xAI price table — the image-model entries (SURFACES S4). The token path is
// exercised indirectly by the reply/drafter suites; this locks the flat
// per-image rate so a $0.07 generation never silently prices to $0.

import { describe, expect, test } from 'bun:test';
import { isKnownImageModel, priceForImage } from './pricing.ts';

describe('priceForImage (S4)', () => {
  test('grok-2-image is $0.07/image and scales with n', () => {
    expect(priceForImage('grok-2-image', 1)).toBeCloseTo(0.07, 5);
    expect(priceForImage('grok-2-image', 2)).toBeCloseTo(0.14, 5);
    expect(priceForImage('grok-2-image-latest', 1)).toBeCloseTo(0.07, 5);
  });

  test('n of 0 or negative bills nothing', () => {
    expect(priceForImage('grok-2-image', 0)).toBe(0);
    expect(priceForImage('grok-2-image', -3)).toBe(0);
  });

  test('an unmapped image model prices to $0 (the route shouts)', () => {
    expect(priceForImage('grok-99-image', 1)).toBe(0);
    expect(isKnownImageModel('grok-99-image')).toBe(false);
  });

  test('isKnownImageModel recognizes the mapped models', () => {
    expect(isKnownImageModel('grok-2-image')).toBe(true);
    expect(isKnownImageModel('grok-2-image-latest')).toBe(true);
  });
});
