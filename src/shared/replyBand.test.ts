import { describe, expect, test } from 'bun:test';
import {
  BAND,
  type BandThresholds,
  classifyBand,
  formatCount,
  textLooksLikeReplyBait,
} from './replyBand.ts';

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

// UI.7: the same signals must be able to land in different bands under
// different thresholds — that is the whole point of the knobs, and both sides
// of the wire (the server gate, the on-page badge) reach the classifier through
// this argument. Omitting it keeps every pre-UI.7 call site byte-valid, which
// the block above is the regression proof of.
describe('classifyBand with configured thresholds', () => {
  const strict = (over: Partial<BandThresholds>): BandThresholds => ({ ...BAND, ...over });

  test('raising the view floor downgrades a mid-size post to nothing', () => {
    // The Task-7 done-when, in pure form: 500 views, 5 replies, an hour old.
    const s = sig(500, 5, 60);
    expect(classifyBand(s)).toBe('hot');
    expect(classifyBand(s, strict({ bigViews: 1000 }))).toBeNull();
  });

  test('the buried cutoff moves both ways on one number', () => {
    const s = sig(50, 150, 1440); // tiny, slow, and deep in a thread
    expect(classifyBand(s)).toBe('skip');
    // Past 200 the thread is no longer "buried", so the dead-zone rule decides.
    expect(classifyBand(s, strict({ midReplies: 200 }))).toBeNull();
  });

  test('the early/mid split alone flips hot to warm', () => {
    const s = sig(5000, 30, 90);
    expect(classifyBand(s)).toBe('hot');
    expect(classifyBand(s, strict({ earlyReplies: 10 }))).toBe('warm');
  });

  test('the bait floors are independent of the plain ones', () => {
    const s = sig(220, 10, 40, true);
    expect(classifyBand(s)).toBe('hot');
    // Bait posts get their own floor: raising it kills them without touching
    // what a plain post needs.
    expect(classifyBand(s, strict({ baitViews: 400 }))).toBeNull();
    expect(classifyBand(sig(500, 5, 60), strict({ baitViews: 400 }))).toBe('hot');
  });

  test('velocity knobs decide the fresh paths', () => {
    const rising = sig(250, 5, 8); // sub-floor views, 31 vpm, fresh
    expect(classifyBand(rising)).toBe('hot');
    expect(classifyBand(rising, strict({ risingVPM: 50 }))).toBe('warm'); // falls to the watch path
    expect(classifyBand(rising, strict({ risingVPM: 50, watchVPM: 50 }))).toBeNull();
    // Shrinking the freshness window closes both velocity paths at once.
    expect(classifyBand(rising, strict({ freshMin: 5 }))).toBeNull();
  });

  test('the watch path has its own reply ceiling', () => {
    const s = sig(100, 22, 10); // fresh, 10 vpm: promising but unproven
    expect(classifyBand(s)).toBe('warm');
    expect(classifyBand(s, strict({ watchReplyCeiling: 20 }))).toBeNull();
  });

  // Hoisting the dead-zone literals into knobs surfaced a property worth
  // pinning: AT THE SHIPPED DEFAULTS that early return decides nothing. It only
  // fires when views < tooSmallViews (== bigViews) and ageMin > tooSmallAgeMin
  // (> freshMin), and a post failing both of those can never clear the view
  // floor or reach a velocity path — so it is a short-circuit, not a verdict.
  // That is exactly why raising the view floor alone cannot widen the dead
  // zone, and why the two shadowing knobs are separate.
  test('at shipped defaults the dead-zone branch never changes a verdict', () => {
    const cases = [
      sig(1541, 8, 56),
      sig(70000, 168, 136),
      sig(51000, 94, 107),
      sig(13, 1, 4),
      sig(250, 5, 8),
      sig(220, 10, 40, true),
      sig(280, 3, 30),
      sig(400, 3, 30),
      sig(50, 150, 1440),
    ];
    // tooSmallViews: 0 makes `views < tooSmallViews` unsatisfiable, i.e. the
    // branch is switched off entirely.
    const off = strict({ tooSmallViews: 0 });
    for (const s of cases) expect([s, classifyBand(s, off)]).toEqual([s, classifyBand(s)]);
  });

  test('the dead-zone knobs bite once they diverge from the floors', () => {
    // Pushed ABOVE the view floor, the dead zone starts refusing posts that
    // clear it — all three conditions have to hold, so the velocity knob is
    // what completes the kill here.
    const aged = sig(500, 3, 30); // 16.7 vpm
    expect(classifyBand(aged)).toBe('hot');
    expect(classifyBand(aged, strict({ tooSmallViews: 1000 }))).toBe('hot'); // vpm still clears
    expect(classifyBand(aged, strict({ tooSmallViews: 1000, tooSmallVpm: 20 }))).toBeNull();

    // Pulled BELOW the freshness window, it starts refusing fresh posts the
    // watch path would otherwise keep.
    const young = sig(100, 3, 10); // 10 vpm, fresh
    expect(classifyBand(young)).toBe('warm');
    expect(classifyBand(young, strict({ tooSmallAgeMin: 5 }))).toBeNull();
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
