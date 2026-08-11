import { describe, expect, test } from 'bun:test';
import { formatCount, textLooksLikeReplyBait } from './replyBand.ts';

describe('textLooksLikeReplyBait', () => {
  test('trailing question mark is bait', () => {
    expect(textLooksLikeReplyBait('Is Bun ready for production?')).toBe(true);
    expect(textLooksLikeReplyBait('Cursor vs Claude Code — which one wins')).toBe(true); // "which one"
  });

  test('bait phrases hit mid-text', () => {
    expect(textLooksLikeReplyBait('Hot take: TypeScript slowed us down. Change my mind.')).toBe(
      true,
    );
    expect(textLooksLikeReplyBait("What's your stack for side projects")).toBe(true);
  });

  test('plain statements are not bait', () => {
    expect(textLooksLikeReplyBait('Shipped the new metrics worker today.')).toBe(false);
    expect(textLooksLikeReplyBait('')).toBe(false);
  });
});

describe('formatCount', () => {
  test('abbreviates like X', () => {
    expect(formatCount(1541)).toBe('1.5k');
    expect(formatCount(70000)).toBe('70k');
    expect(formatCount(1000)).toBe('1k');
    expect(formatCount(500)).toBe('500');
    expect(formatCount(2_100_000)).toBe('2.1M');
  });
});
