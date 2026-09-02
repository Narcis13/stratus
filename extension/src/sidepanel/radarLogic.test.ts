// XR.6 — the E chip's pure half. What the panel renders is a component and
// untested by convention; what a sighting HANDS the scorer, and what the chip
// claims in words, is a contract.

import { describe, expect, test } from 'bun:test';
import type { RadarSighting } from '../shared/radar.ts';
import { RANKER_BAND_CUTS, rankerMeasuredBand } from '../xRankerSignals.ts';
import {
  rankerChipFace,
  rankerChipTitle,
  sightingCounts,
  sightingRankerScore,
} from './radarLogic.ts';

function sighting(over: Partial<RadarSighting> = {}): RadarSighting {
  return {
    tweetId: '1',
    url: 'https://x.com/someone/status/1',
    handle: 'someone',
    author: 'Someone',
    text: 'a tweet',
    band: 'sweep',
    signals: { views: 5000, replies: 20, ageMin: 30, vpm: 166, bait: false },
    firstSeenAt: '2026-09-02T10:00:00.000Z',
    lastSeenAt: '2026-09-02T10:00:00.000Z',
    ...over,
  };
}

describe('sightingCounts', () => {
  test('reposts are absent, never zero — a sighting has no repost field to read', () => {
    expect(sightingCounts(sighting({ likes: 90 }))).toEqual({
      likes: 90,
      replies: 20,
      reposts: null,
      views: 5000,
    });
  });

  test('an unstamped like count stays absent', () => {
    expect(sightingCounts(sighting()).likes).toBeNull();
  });
});

describe('sightingRankerScore', () => {
  test('views and likes yield a numeric score with a measured band', () => {
    const r = sightingRankerScore(sighting({ likes: 90 }));
    expect(r.available).toBe(true);
    if (!r.available) throw new Error('unreachable');
    expect(Number.isFinite(r.score)).toBe(true);
    expect(r.band).toBe(rankerMeasuredBand(r.score));
    expect(r.contributions.map((c) => c.head).sort()).toEqual(['favorite', 'reply']);
  });

  test('no captured views ⇒ unavailable, so the row renders no chip at all', () => {
    const r = sightingRankerScore(
      sighting({ signals: { views: 0, replies: 0, ageMin: 5, vpm: 0, bait: false } }),
    );
    expect(r.available).toBe(false);
  });

  test('a sighting without likes still scores, and `favorite` is absent from the contributions', () => {
    const r = sightingRankerScore(sighting());
    expect(r.available).toBe(true);
    if (!r.available) throw new Error('unreachable');
    expect(r.contributions.map((c) => c.head)).toEqual(['reply']);
  });

  test('the repost head never appears, however the sighting is stamped', () => {
    const r = sightingRankerScore(sighting({ likes: 400 }));
    if (!r.available) throw new Error('unreachable');
    expect(r.contributions.some((c) => c.head === 'retweet')).toBe(false);
  });

  test('scored on the base reply weight, so personTier cannot move the number', () => {
    const plain = sightingRankerScore(sighting({ likes: 90 }));
    const mutual = sightingRankerScore(sighting({ likes: 90, personTier: 'mutual' }));
    if (!plain.available || !mutual.available) throw new Error('unreachable');
    expect(mutual.score).toBe(plain.score);
  });

  test('a heavily-replied post outscores an identical one nobody answered', () => {
    const busy = sightingRankerScore(sighting({ likes: 90 }));
    const quiet = sightingRankerScore(
      sighting({
        likes: 90,
        signals: { views: 5000, replies: 0, ageMin: 30, vpm: 166, bait: false },
      }),
    );
    if (!busy.available || !quiet.available) throw new Error('unreachable');
    expect(busy.score).toBeGreaterThan(quiet.score);
  });
});

describe('the chip words', () => {
  test('the face carries the band word, because only `below` carries a colour', () => {
    const r = sightingRankerScore(
      sighting({
        likes: 400,
        signals: { views: 900, replies: 40, ageMin: 30, vpm: 30, bait: false },
      }),
    );
    if (!r.available) throw new Error('unreachable');
    expect(rankerChipFace(r)).toBe(
      `E ${r.score} · ${
        r.band === 'below' ? 'below typical' : r.band === 'typical' ? 'typical' : 'strong shape'
      }`,
    );
  });

  test('the tooltip names the heads it actually read and says the missing one is absent', () => {
    const r = sightingRankerScore(sighting({ likes: 90 }));
    if (!r.available) throw new Error('unreachable');
    const title = rankerChipTitle(r);
    expect(title).toContain('Reply + Like'); // ordered by contribution, not by head order
    expect(title).toContain('not counted as zero');
    // Decision 9 — the caveat is WHY the chip is on the post rather than a
    // hedge about the arithmetic.
    expect(title).toContain('never your reply');
  });

  test('a title over a post with no likes does not claim to have read them', () => {
    const r = sightingRankerScore(sighting());
    if (!r.available) throw new Error('unreachable');
    expect(rankerChipTitle(r)).not.toContain('Like');
  });

  test('the smoothing line shows only under the shrinkage sample size', () => {
    const small = sightingRankerScore(
      sighting({ likes: 5, signals: { views: 300, replies: 2, ageMin: 10, vpm: 30, bait: false } }),
    );
    const large = sightingRankerScore(
      sighting({
        likes: 900,
        signals: { views: 90_000, replies: 200, ageMin: 300, vpm: 300, bait: false },
      }),
    );
    if (!small.available || !large.available) throw new Error('unreachable');
    expect(rankerChipTitle(small)).toContain('smoothed toward the feed median');
    expect(rankerChipTitle(large)).not.toContain('smoothed toward the feed median');
  });

  test('the band the chip prints is the MEASURED pair, not the draft one', () => {
    // XR.4 split the cuts (D236): 51 is `strong` on the measured scale and
    // `below` on the draft scale. A chip reading the wrong pair fails silently.
    expect(rankerMeasuredBand(RANKER_BAND_CUTS.measured.strong)).toBe('strong');
    expect(RANKER_BAND_CUTS.draft.typical).toBeGreaterThan(RANKER_BAND_CUTS.measured.strong);
  });
});
