import { describe, expect, test } from 'bun:test';
import {
  type NotifContextGet,
  type RadarConfirm,
  type RadarVariantPasted,
  type RadarVariantsGet,
  isNotifContextGet,
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

describe('isNotifContextGet', () => {
  test('accepts the bare message and the forced variant', () => {
    const bare: NotifContextGet = { type: 'stratus/notif-context' };
    const forced: NotifContextGet = { type: 'stratus/notif-context', force: true };
    expect(isNotifContextGet(bare)).toBe(true);
    expect(isNotifContextGet(forced)).toBe(true);
  });

  test('rejects the wrong type and junk', () => {
    expect(isNotifContextGet({ type: 'stratus/radar-confirm' })).toBe(false);
    expect(isNotifContextGet({ force: true })).toBe(false);
    expect(isNotifContextGet(null)).toBe(false);
    expect(isNotifContextGet('stratus/notif-context')).toBe(false);
  });
});
