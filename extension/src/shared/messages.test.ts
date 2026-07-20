import { describe, expect, test } from 'bun:test';
import { type RadarConfirm, isRadarConfirm } from './messages.ts';

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
