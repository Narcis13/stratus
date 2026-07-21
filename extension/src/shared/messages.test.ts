import { describe, expect, test } from 'bun:test';
import {
  type RadarConfirm,
  type RadarVariantPasted,
  type RadarVariantsGet,
  isRadarConfirm,
  isRadarVariantPasted,
  isRadarVariantsGet,
} from './messages.ts';

describe('isRadarConfirm', () => {
  test('accepts a well-formed radar-confirm message', () => {
    const msg: RadarConfirm = { type: 'stratus/radar-confirm', tweetId: '123' };
    expect(isRadarConfirm(msg)).toBe(true);
  });

  test('rejects the wrong type, a missing/non-string tweetId, and junk', () => {
    expect(isRadarConfirm({ type: 'stratus/radar-click', tweetId: '1' })).toBe(false);
    expect(isRadarConfirm({ type: 'stratus/radar-confirm' })).toBe(false);
    expect(isRadarConfirm({ type: 'stratus/radar-confirm', tweetId: 1 })).toBe(false);
    expect(isRadarConfirm(null)).toBe(false);
    expect(isRadarConfirm('stratus/radar-confirm')).toBe(false);
  });
});

describe('isRadarVariantsGet', () => {
  test('accepts a well-formed radar-variants-get message', () => {
    const msg: RadarVariantsGet = { type: 'stratus/radar-variants-get', tweetId: '123' };
    expect(isRadarVariantsGet(msg)).toBe(true);
  });

  test('rejects the wrong type, a non-string tweetId, and junk', () => {
    expect(isRadarVariantsGet({ type: 'stratus/radar-confirm', tweetId: '1' })).toBe(false);
    expect(isRadarVariantsGet({ type: 'stratus/radar-variants-get' })).toBe(false);
    expect(isRadarVariantsGet({ type: 'stratus/radar-variants-get', tweetId: 1 })).toBe(false);
    expect(isRadarVariantsGet(null)).toBe(false);
  });
});

describe('isRadarVariantPasted', () => {
  test('accepts a well-formed radar-variant-pasted message', () => {
    const msg: RadarVariantPasted = {
      type: 'stratus/radar-variant-pasted',
      tweetId: '123',
      text: 'a reply',
    };
    expect(isRadarVariantPasted(msg)).toBe(true);
  });

  test('rejects a missing/non-string tweetId or text, wrong type, and junk', () => {
    expect(isRadarVariantPasted({ type: 'stratus/radar-variant-pasted', tweetId: '1' })).toBe(
      false,
    );
    expect(
      isRadarVariantPasted({ type: 'stratus/radar-variant-pasted', tweetId: '1', text: 5 }),
    ).toBe(false);
    expect(
      isRadarVariantPasted({ type: 'stratus/radar-variants-get', tweetId: '1', text: 'x' }),
    ).toBe(false);
    expect(isRadarVariantPasted(null)).toBe(false);
  });
});
