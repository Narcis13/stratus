// RA.1 — the sighting corpus's pure rules. Two halves, and they fail in
// different ways: a parse bug 400s a whole batch (loud), while a merge bug
// quietly rewrites a row that was already right (silent), which is why the
// out-of-order cases below are asserted in both directions.

import { describe, expect, test } from 'bun:test';
import { SWEEP, type SweepConfig } from '../../shared/radarSweep.ts';
import {
  SIGHTING_TEXT_MAX,
  type SightingViewContext,
  type SightingWireRow,
  type StoredSighting,
  type StoredSightingRow,
  buildSightingViews,
  coerceBand,
  composeDraftSignals,
  derivePostedAt,
  mergeSightingRow,
  parseSightingWireRow,
  sightingVpm,
  summarizeSightings,
} from './corpus.ts';

const NOW = Date.parse('2026-08-17T12:00:00.000Z');
const TWEET = '1234567890123456789';

function wire(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    tweetId: TWEET,
    url: `https://x.com/alice/status/${TWEET}`,
    handle: 'alice',
    author: 'Alice Builder',
    text: 'shipping is a skill you learn by shipping',
    band: 'sweep',
    views: 1500,
    replies: 8,
    likes: 12,
    bait: false,
    verified: true,
    ageMin: 22,
    seenAt: new Date(NOW).toISOString(),
    sourcePath: '/home',
    ...over,
  };
}

function ok(v: unknown, nowMs = NOW): SightingWireRow {
  const r = parseSightingWireRow(v, nowMs);
  if ('error' in r) throw new Error(`expected a parsed row, got ${r.error}`);
  return r;
}

function err(v: unknown, nowMs = NOW): string | null {
  const r = parseSightingWireRow(v, nowMs);
  return 'error' in r ? r.error : null;
}

describe('parseSightingWireRow', () => {
  test('accepts a full row and lowercases the handle', () => {
    const r = ok(wire({ handle: '@Alice' }));
    expect(r.handle).toBe('alice');
    expect(r.tweetId).toBe(TWEET);
    expect(r.views).toBe(1500);
    expect(r.likes).toBe(12);
    expect(r.verified).toBe(true);
    expect(r.sourcePath).toBe('/home');
    expect(r.seenAt.getTime()).toBe(NOW);
  });

  test('rejects every bad field by name', () => {
    expect(err(null)).toBe('row_invalid');
    expect(err([])).toBe('row_invalid');
    expect(err(wire({ tweetId: 'abc' }))).toBe('tweetId_invalid');
    expect(err(wire({ tweetId: undefined }))).toBe('tweetId_invalid');
    expect(err(wire({ handle: 'a-handle-that-is-far-too-long' }))).toBe('handle_invalid');
    expect(err(wire({ handle: 42 }))).toBe('handle_invalid');
    expect(err(wire({ text: undefined }))).toBe('text_invalid');
    expect(err(wire({ band: 'nonsense' }))).toBe('band_invalid');
    expect(err(wire({ band: undefined }))).toBe('band_invalid');
    expect(err(wire({ views: -1 }))).toBe('views_invalid');
    expect(err(wire({ views: 'lots' }))).toBe('views_invalid');
    expect(err(wire({ replies: undefined }))).toBe('replies_invalid');
    expect(err(wire({ likes: -3 }))).toBe('likes_invalid');
    expect(err(wire({ bait: undefined }))).toBe('bait_invalid');
    expect(err(wire({ bait: 'no' }))).toBe('bait_invalid');
    expect(err(wire({ verified: 'yes' }))).toBe('verified_invalid');
    expect(err(wire({ ageMin: undefined }))).toBe('ageMin_invalid');
    expect(err(wire({ ageMin: 525_601 }))).toBe('ageMin_invalid');
    expect(err(wire({ seenAt: 'not a date' }))).toBe('seenAt_invalid');
    expect(err(wire({ url: 12 }))).toBe('url_invalid');
    expect(err(wire({ author: {} }))).toBe('author_invalid');
  });

  test('sourcePath must be a path, not a URL, and is bounded', () => {
    expect(err(wire({ sourcePath: 'https://x.com/home' }))).toBe('sourcePath_invalid');
    expect(err(wire({ sourcePath: `/${'a'.repeat(200)}` }))).toBe('sourcePath_invalid');
    expect(ok(wire({ sourcePath: '/search?q=bun&f=live' })).sourcePath).toBe(
      '/search?q=bun&f=live',
    );
    expect(ok(wire({ sourcePath: '' })).sourcePath).toBeNull();
    expect(ok(wire({ sourcePath: undefined })).sourcePath).toBeNull();
  });

  test('clamps text at 500 and keeps an empty snippet', () => {
    const r = ok(wire({ text: `  ${'x'.repeat(600)}  ` }));
    expect(r.text.length).toBe(SIGHTING_TEXT_MAX);
    // An image-only tweet is a real sighting, not a bad row.
    expect(ok(wire({ text: '' })).text).toBe('');
  });

  test('folds the dead classifier bands onto sweep', () => {
    expect(ok(wire({ band: 'hot' })).band).toBe('sweep');
    expect(ok(wire({ band: 'warm' })).band).toBe('sweep');
    expect(ok(wire({ band: 'MANUAL' })).band).toBe('manual');
  });

  test('absent likes/verified are null, never 0/false (§7.11)', () => {
    const r = ok(wire({ likes: undefined, verified: undefined }));
    expect(r.likes).toBeNull();
    expect(r.verified).toBeNull();
    // A real zero is still a value.
    expect(ok(wire({ likes: 0 })).likes).toBe(0);
    expect(ok(wire({ verified: false })).verified).toBe(false);
  });

  test('seenAt defaults to now and can never be in the future', () => {
    expect(ok(wire({ seenAt: undefined })).seenAt.getTime()).toBe(NOW);
    const ahead = new Date(NOW + 60 * 60 * 1000).toISOString();
    expect(ok(wire({ seenAt: ahead })).seenAt.getTime()).toBe(NOW);
    const behind = new Date(NOW - 5 * 60 * 1000).toISOString();
    expect(ok(wire({ seenAt: behind })).seenAt.getTime()).toBe(NOW - 5 * 60 * 1000);
  });
});

describe('derivePostedAt', () => {
  test('walks back from the sighting by its age', () => {
    expect(derivePostedAt(NOW, 22).getTime()).toBe(NOW - 22 * 60_000);
  });

  test('ageMin 0 is a real answer, not a missing one', () => {
    expect(derivePostedAt(NOW, 0).getTime()).toBe(NOW);
  });
});

describe('mergeSightingRow', () => {
  function stored(over: Partial<StoredSighting> = {}): StoredSighting {
    return {
      url: `https://x.com/alice/status/${TWEET}`,
      author: 'Alice Builder',
      text: 'the snippet as first captured',
      band: 'sweep',
      views: 1000,
      replies: 4,
      likes: 9,
      bait: false,
      verified: true,
      postedAt: new Date(NOW - 60 * 60 * 1000),
      sourcePath: '/home',
      lastSeenAt: new Date(NOW),
      seenCount: 3,
      ...over,
    };
  }

  test('a newer sighting moves the metrics', () => {
    const later = new Date(NOW + 5 * 60_000);
    const patch = mergeSightingRow(
      stored(),
      ok(wire({ views: 2400, replies: 11, likes: 30, seenAt: later.toISOString() }), NOW + 600_000),
    );
    expect(patch.views).toBe(2400);
    expect(patch.replies).toBe(11);
    expect(patch.likes).toBe(30);
    expect(patch.lastSeenAt.getTime()).toBe(later.getTime());
  });

  test('an OLDER sighting moves nothing but the counter', () => {
    const earlier = new Date(NOW - 10 * 60_000);
    const patch = mergeSightingRow(
      stored(),
      ok(wire({ views: 12, replies: 0, likes: 1, seenAt: earlier.toISOString() })),
    );
    expect(patch.views).toBe(1000);
    expect(patch.replies).toBe(4);
    expect(patch.likes).toBe(9);
    expect(patch.lastSeenAt.getTime()).toBe(NOW);
    expect(patch.seenCount).toBe(4);
  });

  test('posted_at / source_path / verified / url / author are fill-only', () => {
    const later = new Date(NOW + 60_000).toISOString();
    const kept = mergeSightingRow(
      stored(),
      ok(
        wire({
          seenAt: later,
          verified: false,
          sourcePath: '/search',
          url: 'https://x.com/other/status/9',
          author: 'Renamed',
          ageMin: 1,
        }),
        NOW + 60_000,
      ),
    );
    expect(kept.verified).toBe(true);
    expect(kept.sourcePath).toBe('/home');
    expect(kept.url).toBe(`https://x.com/alice/status/${TWEET}`);
    expect(kept.author).toBe('Alice Builder');
    expect(kept.postedAt?.getTime()).toBe(NOW - 60 * 60 * 1000);

    // ...and they DO fill when the stored row never knew.
    const filled = mergeSightingRow(
      stored({ verified: null, sourcePath: null, url: null, author: null, postedAt: null }),
      ok(wire({ seenAt: later, ageMin: 1 }), NOW + 60_000),
    );
    expect(filled.verified).toBe(true);
    expect(filled.sourcePath).toBe('/home');
    expect(filled.url).toBe(`https://x.com/alice/status/${TWEET}`);
    expect(filled.author).toBe('Alice Builder');
    expect(filled.postedAt?.getTime()).toBe(NOW + 60_000 - 60_000);
  });

  test('a metric-less re-sighting keeps the stored like count', () => {
    const later = new Date(NOW + 60_000).toISOString();
    const patch = mergeSightingRow(
      stored(),
      ok(wire({ likes: undefined, seenAt: later }), NOW + 60_000),
    );
    expect(patch.likes).toBe(9);
  });

  test('the band ratchets and never demotes', () => {
    const later = new Date(NOW + 60_000).toISOString();
    const incoming = (band: string) => ok(wire({ band, seenAt: later }), NOW + 60_000);

    // roster → sweep upgrades: my own filters admitted it on its numbers.
    expect(mergeSightingRow(stored({ band: 'roster' }), incoming('sweep')).band).toBe('sweep');
    // sweep → roster does not: a swept row is never demoted on the next scroll.
    expect(mergeSightingRow(stored({ band: 'sweep' }), incoming('roster')).band).toBe('sweep');
    // A human pin survives everything.
    expect(mergeSightingRow(stored({ band: 'manual' }), incoming('sweep')).band).toBe('manual');
    expect(mergeSightingRow(stored({ band: 'manual' }), incoming('cannon')).band).toBe('manual');
    // ...and reaches a swept row when the human pins it.
    expect(mergeSightingRow(stored({ band: 'sweep' }), incoming('manual')).band).toBe('manual');
    // Equal stickiness → the fresher incoming band wins.
    expect(mergeSightingRow(stored({ band: 'sweep' }), incoming('cannon')).band).toBe('cannon');
    // An unreadable stored band takes the incoming one rather than sticking.
    expect(mergeSightingRow(stored({ band: 'garbage' }), incoming('roster')).band).toBe('roster');
  });

  // Two POSTs land in the same millisecond routinely (a band change punches
  // through the throttle, so the second call follows the first immediately) —
  // and the fresher read has to win, or a re-sighting that the route deliberately
  // ACCEPTED would silently store nothing but a bumped counter.
  test('a same-millisecond re-sighting counts as the newer one', () => {
    const patch = mergeSightingRow(stored(), ok(wire({ views: 7777, seenAt: undefined })));
    expect(patch.views).toBe(7777);
    expect(patch.lastSeenAt.getTime()).toBe(NOW);
  });

  test('seen_count counts every accepted re-sighting', () => {
    const patch = mergeSightingRow(stored({ seenCount: 41 }), ok(wire()));
    expect(patch.seenCount).toBe(42);
  });
});

// RA.3 — the read half. Every field asserted below is one the table deliberately
// does NOT have a column for (§7.12/§7.16), so this block is the whole proof
// that the server's answers are reproducible from a row plus a config.
describe('buildSightingViews', () => {
  const DAY = 24 * 60 * 60 * 1000;
  const SEEN = new Date(NOW);

  function row(over: Partial<StoredSightingRow> = {}): StoredSightingRow {
    return {
      tweetId: TWEET,
      url: `https://x.com/alice/status/${TWEET}`,
      handle: 'alice',
      author: 'Alice Builder',
      text: 'shipping is a skill you learn by shipping',
      band: 'sweep',
      views: 900,
      replies: 3,
      likes: 5,
      bait: false,
      verified: true,
      postedAt: new Date(NOW - 12 * 60_000),
      sourcePath: '/home',
      firstSeenAt: SEEN,
      lastSeenAt: SEEN,
      seenCount: 1,
      ...over,
    };
  }

  function ctx(over: Partial<SightingViewContext> = {}): SightingViewContext {
    return {
      drafted: new Set<string>(),
      replied: new Set<string>(),
      people: new Map(),
      targets: new Set<string>(),
      ...over,
    };
  }

  function viewOf(
    over: Partial<StoredSightingRow> = {},
    cfg: SweepConfig = SWEEP,
    c: SightingViewContext = ctx(),
  ) {
    const [v] = buildSightingViews([row(over)], cfg, c);
    if (!v) throw new Error('expected exactly one view');
    return v;
  }

  test('derives the age, the velocity and the sweep verdict', () => {
    const v = viewOf();
    expect(v.ageMinAtLastSeen).toBe(12);
    expect(v.vpm).toBe(75); // 900 views / 12 min
    expect(v.admitted).toBe(true);
    expect(v.postedAt).toBe(new Date(NOW - 12 * 60_000).toISOString());
    expect(v.lastSeenAt).toBe(SEEN.toISOString());
  });

  // The one that matters: a post is only ever replyable at the moment it was in
  // front of me, so judging it at `now` would make every row older than
  // `maxAgeMin` read false and the whole field would say nothing.
  test('admitted is judged at the last sighting, not at read time', () => {
    const lastSeen = new Date(NOW - 5 * DAY);
    const v = viewOf({
      lastSeenAt: lastSeen,
      postedAt: new Date(lastSeen.getTime() - 12 * 60_000),
    });
    expect(v.ageMinAtLastSeen).toBe(12);
    expect(v.admitted).toBe(true);
  });

  test('admitted follows the config it is given, so a preset change re-reads history', () => {
    const strict: SweepConfig = { ...SWEEP, minViews: 5000 };
    expect(viewOf().admitted).toBe(true);
    expect(viewOf({}, strict).admitted).toBe(false);
  });

  // The two unknowns resolve in OPPOSITE directions, and both are deliberate.
  test('unknown verified refuses, unknown likes passes', () => {
    expect(viewOf({ verified: null }).admitted).toBe(false);
    expect(viewOf({ verified: false }).admitted).toBe(false);
    // …while a missing like count reads as 0 (what the page itself passes when
    // X renders no count) rather than as a refusal.
    expect(viewOf({ likes: null }).admitted).toBe(true);
    // Not vacuous: the like ceiling still bites when the count IS known.
    expect(viewOf({ likes: 25 }).admitted).toBe(false);
  });

  test('a row with no post time is unjudgeable, never a zero', () => {
    const v = viewOf({ postedAt: null });
    expect(v.ageMinAtLastSeen).toBeNull();
    expect(v.vpm).toBeNull();
    expect(v.admitted).toBeNull();
  });

  test('worked is drafted OR replied, and each half is visible on its own', () => {
    expect(viewOf({}, SWEEP, ctx()).worked).toBe(false);
    const drafted = viewOf({}, SWEEP, ctx({ drafted: new Set([TWEET]) }));
    expect(drafted).toMatchObject({ drafted: true, replied: false, worked: true });
    const replied = viewOf({}, SWEEP, ctx({ replied: new Set([TWEET]) }));
    expect(replied).toMatchObject({ drafted: false, replied: true, worked: true });
  });

  test('stage comes from the people layer and a retired person has none', () => {
    const known = ctx({ people: new Map([['alice', { stage: 'engaged', retired: false }]]) });
    expect(viewOf({}, SWEEP, known).stage).toBe('engaged');

    const retired = ctx({ people: new Map([['alice', { stage: 'engaged', retired: true }]]) });
    expect(viewOf({}, SWEEP, retired).stage).toBeNull();

    expect(viewOf({}, SWEEP, ctx()).stage).toBeNull();
    expect(viewOf({}, SWEEP, ctx({ targets: new Set(['alice']) })).isTarget).toBe(true);
    expect(viewOf({}, SWEEP, ctx({ targets: new Set(['bob']) })).isTarget).toBe(false);
  });

  test('a null url stays null — a synthesised permalink would erase the unknown', () => {
    expect(viewOf({ url: null }).url).toBeNull();
  });
});

describe('summarizeSightings', () => {
  const SEEN = new Date(NOW);

  function view(over: Partial<StoredSightingRow>, worked = false) {
    const base: StoredSightingRow = {
      tweetId: '1',
      url: null,
      handle: 'alice',
      author: null,
      text: 't',
      band: 'sweep',
      views: 900,
      replies: 3,
      likes: 5,
      bait: false,
      verified: true,
      postedAt: new Date(NOW - 12 * 60_000),
      sourcePath: '/home',
      firstSeenAt: SEEN,
      lastSeenAt: SEEN,
      seenCount: 1,
    };
    const row = { ...base, ...over };
    const [v] = buildSightingViews([row], SWEEP, {
      drafted: new Set(worked ? [row.tweetId] : []),
      replied: new Set<string>(),
      people: new Map(),
      targets: new Set<string>(),
    });
    if (!v) throw new Error('expected exactly one view');
    return v;
  }

  test('counts by band, by source path and by author — and never a rate', () => {
    const s = summarizeSightings([
      view({ tweetId: '1', handle: 'alice', band: 'sweep', sourcePath: '/home' }),
      view({ tweetId: '2', handle: 'alice', band: 'manual', sourcePath: '/search' }),
      view({ tweetId: '3', handle: 'bob', band: 'sweep', sourcePath: null }),
    ]);
    expect(s.total).toBe(3);
    expect(s.byBand).toEqual({ sweep: 2, manual: 1 });
    expect(s.bySourcePath).toEqual({ '/home': 1, '/search': 1, unknown: 1 });
    expect(s.topHandles).toEqual([
      { handle: 'alice', sightings: 2 },
      { handle: 'bob', sightings: 1 },
    ]);
    // A reply-RATE over this corpus would be an inference needing the §7.19
    // gate; the funnel in GET /playbook already owns that question.
    expect(Object.keys(s)).not.toContain('rate');
  });

  test('unworkedAdmitted is the finding: admitted, and nothing done about it', () => {
    const s = summarizeSightings([
      // Admitted + worked → counted in both, but not the finding.
      view({ tweetId: '1' }, true),
      // Admitted + untouched → the finding.
      view({ tweetId: '2' }),
      // Not admitted (too few views) and untouched → neither.
      view({ tweetId: '3', views: 10 }),
      // Unjudgeable → never counts as admitted.
      view({ tweetId: '4', postedAt: null }),
    ]);
    expect(s.total).toBe(4);
    expect(s.admitted).toBe(2);
    expect(s.worked).toBe(1);
    expect(s.unworkedAdmitted).toBe(1);
  });
});

// RA.4 — what a stored sighting looks like as a draft's `signals`. The number
// under test is `ageMin`: the confirm route derives the source post time back out
// as `draftedAt − ageMin`, so drafting an hour after the last sighting must not
// move where the post is recorded as having gone up.
describe('composeDraftSignals', () => {
  const SEEN = new Date(NOW - 30 * 60_000);

  function row(over: Partial<StoredSightingRow> = {}): StoredSightingRow {
    return {
      tweetId: TWEET,
      url: `https://x.com/alice/status/${TWEET}`,
      handle: 'alice',
      author: 'Alice Builder',
      text: 'shipping is a skill you learn by shipping',
      band: 'sweep',
      views: 600,
      replies: 3,
      likes: 5,
      bait: true,
      verified: true,
      postedAt: new Date(NOW - 120 * 60_000),
      sourcePath: '/home',
      firstSeenAt: SEEN,
      lastSeenAt: SEEN,
      seenCount: 2,
      ...over,
    };
  }

  test('ageMin is measured from the post time at COMPOSE time, not at last sighting', () => {
    const s = composeDraftSignals(row(), NOW);
    // The row was last seen 30 minutes ago, when it was 90 minutes old. Neither
    // number is the answer.
    expect(s.ageMin).toBe(120);
    expect(s.vpm).toBe(5); // 600 views / 120 min
    expect(s.views).toBe(600);
    expect(s.replies).toBe(3);
    expect(s.bait).toBe(true);
  });

  test('the age keeps moving with the clock — an hour later is an hour older', () => {
    const later = composeDraftSignals(row(), NOW + 60 * 60_000);
    expect(later.ageMin).toBe(180);
  });

  test('a hand-written row with no post time falls back to the last sighting, never null', () => {
    // A null `signals` is what makes a draft invisible on rehydrate (D186), so
    // the unknown resolves to a defensible lower bound instead: the post
    // demonstrably existed when the queue last saw it.
    const s = composeDraftSignals(row({ postedAt: null }), NOW);
    expect(s.ageMin).toBe(30);
    expect(s.vpm).toBe(20); // 600 views / 30 min
  });

  test('a post sighted in its first minute is not infinitely fast', () => {
    const s = composeDraftSignals(row({ postedAt: new Date(NOW) }), NOW);
    expect(s.ageMin).toBe(0);
    expect(s.vpm).toBe(sightingVpm(600, 0));
    expect(s.vpm).toBe(600);
  });
});

// Exported at RA.4 so the compose route can narrow the stored band without a
// third copy of the fold (§7.27).
describe('coerceBand', () => {
  test('folds the dead verdicts, passes the live four, and refuses the rest', () => {
    expect(coerceBand('hot')).toBe('sweep');
    expect(coerceBand('WARM')).toBe('sweep');
    expect(coerceBand('manual')).toBe('manual');
    expect(coerceBand('roster')).toBe('roster');
    expect(coerceBand('cannon')).toBe('cannon');
    expect(coerceBand('sweep')).toBe('sweep');
    expect(coerceBand('nonsense')).toBeNull();
    expect(coerceBand(null)).toBeNull();
  });
});
