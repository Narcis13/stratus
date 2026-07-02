import { describe, expect, test } from 'bun:test';
import { BAND, classifyBand, formatCount, textLooksLikeReplyBait } from './replyBand.ts';

// Signals reconstructed from evals/reply-eval-20260604-201909.md:
// (original-post views, replies already on it, age = reply_time - post_time).
function sig(views: number, replies: number, ageMin: number, bait = false) {
  return { views, replies, ageMin, vpm: views / Math.max(ageMin, 1), bait };
}

describe('classifyBand', () => {
  test("mid-size, replied early -> hot (the day's winner: @shubh19 1541v/8r)", () => {
    expect(classifyBand(sig(1541, 8, 56))).toBe('hot');
  });

  test('whale with a deep thread -> skip (@thsottiaux 70k v / 168 replies)', () => {
    expect(classifyBand(sig(70000, 168, 136))).toBe('skip');
  });

  test('big but mid-pack -> warm (@Its_Nova1012 51k v / 94 replies, got 86 views)', () => {
    expect(classifyBand(sig(51000, 94, 107))).toBe('warm');
  });

  test('tiny & slow -> null, not worth a reply (@HafedDm 13v/1r)', () => {
    expect(classifyBand(sig(13, 1, 4))).toBe(null);
  });

  test('fresh & rising clears the bar on velocity alone -> hot (sub-floor views, 31 vpm)', () => {
    // 250 views < bigViews(300), but fresh (8m) and rising fast enough to project in.
    expect(classifyBand(sig(250, 5, 8))).toBe('hot');
  });

  test('buried by reply count even when big & fresh -> skip', () => {
    expect(classifyBand(sig(5000, 200, 10))).toBe('skip');
  });

  test('reply-bait lowers the view floor: a sub-floor post flips null -> hot', () => {
    // 220 views sits below bigViews(300) but above baitViews(180): only worth a
    // reply if it's reply-bait. (The old 479v/34r->null case was superseded by
    // santoshstack outcomes, which showed 300-1k-view posts DO pay off.)
    expect(classifyBand(sig(220, 10, 40, false))).toBe(null);
    expect(classifyBand(sig(220, 10, 40, true))).toBe('hot');
  });

  test('thresholds stay ordered (guards against fat-finger calibration)', () => {
    expect(BAND.baitViews).toBeLessThan(BAND.bigViews);
    expect(BAND.earlyReplies).toBeLessThan(BAND.midReplies);
    expect(BAND.baitVPM).toBeLessThan(BAND.risingVPM);
  });
});

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
