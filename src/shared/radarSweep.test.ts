import { describe, expect, test } from 'bun:test';
import {
  RADAR_QUEUE_TTL_MS,
  SWEEP,
  SWEEP_STATE_KEY,
  type SweepCandidate,
  type SweepConfig,
  bandStickiness,
  passesContentGates,
  passesSweep,
  startSweepSession,
  sweepActiveAt,
  sweepMinutesLeft,
  sweepNeedsMedia,
  sweepNeedsPromoted,
  sweepNeedsVerified,
} from './radarSweep.ts';

// A candidate that clears every shipped default, so each test moves exactly one
// axis and the boundary it asserts is the only reason it passes or fails.
function cand(over: Partial<SweepCandidate> = {}): SweepCandidate {
  return {
    views: 1000,
    likes: 10,
    replies: 5,
    ageMin: 10,
    verified: true,
    hasMedia: null,
    promoted: false,
    ...over,
  };
}

const with_ = (over: Partial<SweepConfig>): SweepConfig => ({ ...SWEEP, ...over });

describe('passesSweep — the numeric gates, both sides of every boundary', () => {
  test('the default candidate is admitted', () => {
    expect(passesSweep(cand())).toBe(true);
  });

  test('exactly minViews passes, one under fails', () => {
    expect(passesSweep(cand({ views: SWEEP.minViews }))).toBe(true);
    expect(passesSweep(cand({ views: SWEEP.minViews - 1 }))).toBe(false);
  });

  test('exactly maxViews passes, one over fails', () => {
    const cfg = with_({ maxViews: 5000 });
    expect(passesSweep(cand({ views: 5000 }), cfg)).toBe(true);
    expect(passesSweep(cand({ views: 5001 }), cfg)).toBe(false);
  });

  test('exactly minLikes passes, one under fails', () => {
    // The ceiling is lifted out of the way so the floor is the only gate this
    // asserts — the shipped maxLikes sits below the floor being tested.
    const cfg = with_({ minLikes: 25, maxLikes: 0 });
    expect(passesSweep(cand({ likes: 25 }), cfg)).toBe(true);
    expect(passesSweep(cand({ likes: 24 }), cfg)).toBe(false);
  });

  test('exactly maxLikes passes, one over fails', () => {
    const cfg = with_({ maxLikes: 400 });
    expect(passesSweep(cand({ likes: 400 }), cfg)).toBe(true);
    expect(passesSweep(cand({ likes: 401 }), cfg)).toBe(false);
  });

  test('exactly minReplies passes, one under fails', () => {
    const cfg = with_({ minReplies: 3 });
    expect(passesSweep(cand({ replies: 3 }), cfg)).toBe(true);
    expect(passesSweep(cand({ replies: 2 }), cfg)).toBe(false);
  });

  test('exactly maxReplies passes, one over fails', () => {
    expect(passesSweep(cand({ replies: SWEEP.maxReplies }))).toBe(true);
    expect(passesSweep(cand({ replies: SWEEP.maxReplies + 1 }))).toBe(false);
  });

  test('exactly maxAgeMin passes, one minute past fails', () => {
    expect(passesSweep(cand({ ageMin: SWEEP.maxAgeMin }))).toBe(true);
    expect(passesSweep(cand({ ageMin: SWEEP.maxAgeMin + 1 }))).toBe(false);
  });

  // The one sentinel in the module. A `max*` of 0 must never read as "admit
  // nothing" — that misreading would make a user who clears a ceiling sweep in
  // exactly zero tweets, which is the opposite of what typing 0 means.
  test('0 on every max* means no ceiling', () => {
    const huge = cand({ views: 9_000_000, likes: 500_000, replies: 100_000 });
    expect(passesSweep(huge, with_({ maxViews: 0, maxLikes: 0, maxReplies: 0 }))).toBe(true);
    // …and each one alone still bites when it is set.
    expect(passesSweep(huge, with_({ maxViews: 1, maxLikes: 0, maxReplies: 0 }))).toBe(false);
    expect(passesSweep(huge, with_({ maxViews: 0, maxLikes: 1, maxReplies: 0 }))).toBe(false);
    expect(passesSweep(huge, with_({ maxViews: 0, maxLikes: 0, maxReplies: 1 }))).toBe(false);
  });

  // maxAgeMin is deliberately NOT a sentinel field — a 0 there is "nothing older
  // than this instant", not "any age". The registry floor is 1 so it is not
  // reachable through the UI, but the predicate must not disagree with its doc.
  test('maxAgeMin has no 0-means-unlimited escape', () => {
    expect(passesSweep(cand({ ageMin: 1 }), with_({ maxAgeMin: 0 }))).toBe(false);
    expect(passesSweep(cand({ ageMin: 0 }), with_({ maxAgeMin: 0 }))).toBe(true);
  });

  test('a min of 0 is vacuous — a zero-metric tweet still clears the floors', () => {
    expect(passesSweep(cand({ views: 0, likes: 0, replies: 0 }), with_({ minViews: 0 }))).toBe(
      true,
    );
  });
});

describe('passesSweep — the verified gate (a gate, not a bucket)', () => {
  test('verified: null passes when verifiedOnly is off', () => {
    const cfg = with_({ verifiedOnly: false });
    expect(passesSweep(cand({ verified: null }), cfg)).toBe(true);
    expect(passesSweep(cand({ verified: false }), cfg)).toBe(true);
  });

  // §7.11 says null is unknown and unknown is not "no" — inverted here on
  // purpose: admitting on unknown would silently defeat the filter, while
  // refusing surfaces a drifted selector as a visibly empty queue.
  test('verified: null FAILS when verifiedOnly is on', () => {
    expect(passesSweep(cand({ verified: null }), with_({ verifiedOnly: true }))).toBe(false);
  });

  test('verified: false fails and verified: true passes under verifiedOnly', () => {
    const cfg = with_({ verifiedOnly: true });
    expect(passesSweep(cand({ verified: false }), cfg)).toBe(false);
    expect(passesSweep(cand({ verified: true }), cfg)).toBe(true);
  });

  test('the verified gate is last — a numeric refusal wins over a verified author', () => {
    const cfg = with_({ verifiedOnly: true });
    expect(passesSweep(cand({ views: 1, verified: true }), cfg)).toBe(false);
  });
});

describe('sweepNeedsVerified', () => {
  test('exactly the verifiedOnly switch, both ways', () => {
    expect(sweepNeedsVerified(with_({ verifiedOnly: false }))).toBe(false);
    expect(sweepNeedsVerified(with_({ verifiedOnly: true }))).toBe(true);
    // The shipped set needs it — the page pays for the badge read by default.
    expect(sweepNeedsVerified(SWEEP)).toBe(true);
  });
});

describe('passesContentGates — media and ads', () => {
  // Shipped state: the media gate is off, so nothing about media can refuse.
  test('the media gate is off by default, both readings admitted', () => {
    expect(passesSweep(cand({ hasMedia: true }))).toBe(true);
    expect(passesSweep(cand({ hasMedia: false }))).toBe(true);
    expect(passesSweep(cand({ hasMedia: null }))).toBe(true);
  });

  test("'with' admits only a tweet carrying media", () => {
    const cfg = with_({ media: 'with' });
    expect(passesSweep(cand({ hasMedia: true }), cfg)).toBe(true);
    expect(passesSweep(cand({ hasMedia: false }), cfg)).toBe(false);
  });

  test("'without' admits only a tweet carrying none", () => {
    const cfg = with_({ media: 'without' });
    expect(passesSweep(cand({ hasMedia: false }), cfg)).toBe(true);
    expect(passesSweep(cand({ hasMedia: true }), cfg)).toBe(false);
  });

  // The `verified` rule again, and for the same reason: a gate that admits on
  // unknown has stopped being a gate. Both directions refuse.
  test('unknown media is a refusal under either direction', () => {
    expect(passesSweep(cand({ hasMedia: null }), with_({ media: 'with' }))).toBe(false);
    expect(passesSweep(cand({ hasMedia: null }), with_({ media: 'without' }))).toBe(false);
  });

  test('a promoted post is refused by default, admitted with the switch off', () => {
    expect(passesSweep(cand({ promoted: true }))).toBe(false);
    expect(passesSweep(cand({ promoted: true }), with_({ excludeAds: false }))).toBe(true);
  });

  // The predicate the bypass arms call directly: it must judge ONLY the two
  // content gates, so a candidate failing every metric filter still passes it.
  test('the exported predicate ignores the metric and age gates', () => {
    expect(passesContentGates({ hasMedia: null, promoted: false }, SWEEP)).toBe(true);
    expect(
      passesContentGates({ hasMedia: true, promoted: false }, with_({ media: 'without' })),
    ).toBe(false);
    expect(passesContentGates({ hasMedia: null, promoted: true }, SWEEP)).toBe(false);
  });

  test('the skip helpers track their knobs both ways (the skipped DOM reads)', () => {
    expect(sweepNeedsMedia(SWEEP)).toBe(false);
    expect(sweepNeedsMedia(with_({ media: 'with' }))).toBe(true);
    expect(sweepNeedsMedia(with_({ media: 'without' }))).toBe(true);
    expect(sweepNeedsPromoted(SWEEP)).toBe(true);
    expect(sweepNeedsPromoted(with_({ excludeAds: false }))).toBe(false);
  });
});

describe('the shipped defaults', () => {
  // §7.19/§7.33: these are opening guesses, two of them restated from BAND's
  // numbers rather than imported. Pinned so a drift is an argument with a test.
  test('SWEEP is the documented opening guess set', () => {
    expect(SWEEP).toEqual({
      minViews: 300,
      maxViews: 2000,
      minLikes: 0,
      maxLikes: 20,
      minReplies: 0,
      maxReplies: 40,
      maxAgeMin: 60,
      media: 'any',
      excludeAds: true,
      verifiedOnly: true,
      campedBypass: true,
      circleBypass: false,
      autoStopMin: 30,
    });
  });

  test('verifiedOnly ships ON and circleBypass ships OFF; campedBypass ships ON', () => {
    expect(SWEEP.verifiedOnly).toBe(true);
    expect(SWEEP.circleBypass).toBe(false);
    expect(SWEEP.campedBypass).toBe(true);
  });

  // The media gate ships NEUTRAL and the ads one ships ON, and the asymmetry is
  // the argument: 'with' or 'without' would halve the intake on an unmeasured
  // guess, while an ad has no reading under which it belongs in the queue.
  test('the media gate ships off and the ads switch ships on', () => {
    expect(SWEEP.media).toBe('any');
    expect(SWEEP.excludeAds).toBe(true);
  });

  // The three ceilings ship as real bounds now, so the shipped set admits a
  // BAND, not a half-open range. A regression to 0 (= no ceiling) on either of
  // the two that moved would silently re-open the queue to crowded posts.
  test('the shipped ceilings are real ceilings, above their floors', () => {
    expect(SWEEP.maxViews).toBeGreaterThan(SWEEP.minViews);
    expect(SWEEP.maxLikes).toBeGreaterThan(SWEEP.minLikes);
    expect(SWEEP.maxReplies).toBeGreaterThan(SWEEP.minReplies);
  });
});

describe('the sweep session', () => {
  const T0 = Date.parse('2026-08-10T12:00:00.000Z');

  test('the state key is the documented one (manual = absent)', () => {
    expect(SWEEP_STATE_KEY).toBe('radar:sweep');
  });

  test('startSweepSession honours autoStopMin', () => {
    const s = startSweepSession(T0);
    expect(s.startedAt).toBe('2026-08-10T12:00:00.000Z');
    expect(s.expiresAt).toBe('2026-08-10T12:30:00.000Z');

    const long = startSweepSession(T0, with_({ autoStopMin: 240 }));
    expect(long.expiresAt).toBe('2026-08-10T16:00:00.000Z');
  });

  test('a session it just started is active', () => {
    const s = startSweepSession(T0);
    expect(sweepActiveAt(s, T0)).toEqual(s);
    expect(sweepActiveAt(s, T0 + 29 * 60_000)).toEqual(s);
  });

  // Read-time expiry is the whole point: no timer owns the truth, so a page that
  // slept through the deadline cannot capture one tweet on wake.
  test('expiry is to the millisecond, and exactly expiresAt is already over', () => {
    const s = startSweepSession(T0);
    expect(sweepActiveAt(s, T0 + 30 * 60_000 - 1)).toEqual(s);
    expect(sweepActiveAt(s, T0 + 30 * 60_000)).toBeNull();
    expect(sweepActiveAt(s, T0 + 30 * 60_000 + 1)).toBeNull();
    // Hours asleep, still nothing captured.
    expect(sweepActiveAt(s, T0 + 86_400_000)).toBeNull();
  });

  test('absent, non-object and malformed values all read as manual, never throwing', () => {
    for (const raw of [
      undefined,
      null,
      'radar:sweep',
      42,
      true,
      [],
      [{ startedAt: 'a', expiresAt: 'b' }],
      {},
      { startedAt: '2026-08-10T12:00:00.000Z' },
      { expiresAt: '2026-08-10T12:30:00.000Z' },
      { startedAt: T0, expiresAt: T0 + 60_000 },
      { startedAt: '2026-08-10T12:00:00.000Z', expiresAt: 'tomorrow-ish' },
      { startedAt: '2026-08-10T12:00:00.000Z', expiresAt: '' },
    ]) {
      expect(sweepActiveAt(raw, T0)).toBeNull();
    }
  });

  test('an active session round-trips through JSON (what storage actually holds)', () => {
    const s = startSweepSession(T0);
    expect(sweepActiveAt(JSON.parse(JSON.stringify(s)), T0 + 60_000)).toEqual(s);
  });
});

describe('sweepMinutesLeft (RS.4)', () => {
  const T0 = Date.parse('2026-08-10T12:00:00.000Z');

  // The countdown rounds UP, and this is the assertion that says why: a sweep
  // armed for 30 minutes reads "30m left" the instant it starts. A floor would
  // print 29 and read as a minute already lost.
  test('a freshly armed sweep reads its full length', () => {
    expect(sweepMinutesLeft(startSweepSession(T0), T0)).toBe(30);
    expect(sweepMinutesLeft(startSweepSession(T0, with_({ autoStopMin: 5 })), T0)).toBe(5);
  });

  test('a partial minute still counts as a minute', () => {
    const s = startSweepSession(T0);
    expect(sweepMinutesLeft(s, T0 + 60_000)).toBe(29);
    expect(sweepMinutesLeft(s, T0 + 60_001)).toBe(29);
    expect(sweepMinutesLeft(s, T0 + 6 * 60_000 + 1)).toBe(24);
    // The last second of the session is still "1m left", never "0m".
    expect(sweepMinutesLeft(s, T0 + 30 * 60_000 - 1)).toBe(1);
  });

  // The label never contradicts the gate: at and past the moment `sweepActiveAt`
  // stops resolving, this is 0 rather than a negative number.
  test('an expired or malformed session floors at 0 instead of going negative', () => {
    const s = startSweepSession(T0);
    expect(sweepMinutesLeft(s, T0 + 30 * 60_000)).toBe(0);
    expect(sweepMinutesLeft(s, T0 + 86_400_000)).toBe(0);
    expect(sweepMinutesLeft({ startedAt: 'x', expiresAt: 'tomorrow-ish' }, T0)).toBe(0);
  });
});

// RA.1 moved this ratchet here from `extension/src/shared/radar.ts` so the page
// and the server resolve a re-sighting's band with one copy of the rule (§7.27).
// The order is the whole content of the function, so it is asserted as an order
// rather than as three magic numbers.
describe('bandStickiness (the band ratchet)', () => {
  test('a human pin outranks every capture', () => {
    expect(bandStickiness('manual')).toBeGreaterThan(bandStickiness('sweep'));
    expect(bandStickiness('manual')).toBeGreaterThan(bandStickiness('cannon'));
    expect(bandStickiness('manual')).toBeGreaterThan(bandStickiness('roster'));
  });

  test('filters I armed outrank "someone I know posted this"', () => {
    expect(bandStickiness('sweep')).toBeGreaterThan(bandStickiness('roster'));
    expect(bandStickiness('cannon')).toBeGreaterThan(bandStickiness('roster'));
  });

  test('sweep and cannon tie, so the fresher one wins at the call site', () => {
    expect(bandStickiness('sweep')).toBe(bandStickiness('cannon'));
  });
});

// RQ.3 moved the queue TTL here for the same reason as the ratchet above: the
// server's `?queue=true` window and the panel's `pruneStale` are now the same
// number by construction. The extension side asserts the identity from its end.
describe('RADAR_QUEUE_TTL_MS', () => {
  test('is 24 hours', () => {
    expect(RADAR_QUEUE_TTL_MS).toBe(24 * 60 * 60 * 1000);
  });
});
