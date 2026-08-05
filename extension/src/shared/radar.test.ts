import { describe, expect, test } from 'bun:test';
import {
  RADAR_CAP,
  RADAR_DISMISSED_CAP,
  RADAR_TTL_MS,
  type RadarDraftRow,
  type RadarSighting,
  type RankMap,
  appendDismissed,
  coerceSightings,
  draftRowToSighting,
  groupQueue,
  isRadarSightings,
  mergeSightings,
  partitionForCurate,
  personTierFor,
  pruneStale,
  rankSightings,
  splitClicked,
  stampTiers,
} from './radar.ts';

function sighting(id: string, over: Partial<RadarSighting> = {}): RadarSighting {
  return {
    tweetId: id,
    url: `https://x.com/someone/status/${id}`,
    handle: 'someone',
    author: 'Someone',
    text: `tweet ${id}`,
    band: 'warm',
    signals: { views: 500, replies: 5, ageMin: 20, vpm: 25, bait: false },
    firstSeenAt: '2026-06-10T10:00:00.000Z',
    lastSeenAt: '2026-06-10T10:00:00.000Z',
    ...over,
  };
}

describe('mergeSightings', () => {
  test('adds new sightings to an empty buffer', () => {
    const merged = mergeSightings([], [sighting('1'), sighting('2')], []);
    expect(merged.map((s) => s.tweetId).sort()).toEqual(['1', '2']);
  });

  test('re-sighting updates signals/band/lastSeenAt but keeps firstSeenAt', () => {
    const first = sighting('1');
    const again = sighting('1', {
      band: 'hot',
      signals: { views: 2000, replies: 12, ageMin: 45, vpm: 44, bait: false },
      firstSeenAt: '2026-06-10T11:00:00.000Z',
      lastSeenAt: '2026-06-10T11:00:00.000Z',
    });
    const merged = mergeSightings([first], [again], []);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.band).toBe('hot');
    expect(merged[0]?.signals.views).toBe(2000);
    expect(merged[0]?.lastSeenAt).toBe('2026-06-10T11:00:00.000Z');
    expect(merged[0]?.firstSeenAt).toBe('2026-06-10T10:00:00.000Z');
  });

  test('dismissed ids never re-enter (the content script keeps re-sighting them)', () => {
    const merged = mergeSightings([sighting('1')], [sighting('2'), sighting('3')], ['2']);
    expect(merged.map((s) => s.tweetId).sort()).toEqual(['1', '3']);
  });

  test('a re-sighting without a reply keeps the one the background attached (§7.2)', () => {
    const drafted = sighting('1', { reply: 'my sharp take' });
    const resighted = sighting('1', { lastSeenAt: '2026-06-10T11:00:00.000Z' });
    const merged = mergeSightings([drafted], [resighted], []);
    expect(merged[0]?.reply).toBe('my sharp take');
    expect(merged[0]?.lastSeenAt).toBe('2026-06-10T11:00:00.000Z');
  });

  test('a fresh reply on the incoming sighting wins', () => {
    const drafted = sighting('1', { reply: 'old' });
    const updated = sighting('1', { reply: 'new' });
    expect(mergeSightings([drafted], [updated], [])[0]?.reply).toBe('new');
  });

  test('a re-sighting keeps the 3 angle variants the background attached (RU.4)', () => {
    const drafted = sighting('1', {
      reply: 'primary take',
      variants: [
        { text: 'primary take', angle: 'extends' },
        { text: 'sharper take', angle: 'contrarian' },
        { text: 'debate take', angle: 'debate' },
      ],
    });
    const resighted = sighting('1', { lastSeenAt: '2026-06-10T11:00:00.000Z' });
    const merged = mergeSightings([drafted], [resighted], []);
    expect(merged[0]?.variants).toHaveLength(3);
    expect(merged[0]?.variants?.[1]?.angle).toBe('contrarian');
    expect(merged[0]?.reply).toBe('primary take');
    expect(merged[0]?.lastSeenAt).toBe('2026-06-10T11:00:00.000Z');
  });

  test('a fresh variant set on the incoming sighting wins (RU.4)', () => {
    const drafted = sighting('1', {
      variants: [{ text: 'old', angle: 'extends' }],
    });
    const updated = sighting('1', {
      variants: [
        { text: 'new-a', angle: 'contrarian' },
        { text: 'new-b', angle: 'debate' },
      ],
    });
    expect(mergeSightings([drafted], [updated], [])[0]?.variants).toHaveLength(2);
  });

  test('a re-sighting keeps the draftId the background stamped after confirm (RU.6)', () => {
    const confirmed = sighting('1', { reply: 'r', draftId: 'draft-abc' });
    const resighted = sighting('1', { lastSeenAt: '2026-06-10T13:00:00.000Z' });
    const merged = mergeSightings([confirmed], [resighted], []);
    expect(merged[0]?.draftId).toBe('draft-abc');
    expect(merged[0]?.reply).toBe('r');
    expect(merged[0]?.lastSeenAt).toBe('2026-06-10T13:00:00.000Z');
  });

  test('a re-sighting keeps clickedAt the panel stamped (stays in Clicked view)', () => {
    const clicked = sighting('1', { reply: 'r', clickedAt: '2026-06-10T12:00:00.000Z' });
    const resighted = sighting('1', { lastSeenAt: '2026-06-10T13:00:00.000Z' });
    const merged = mergeSightings([clicked], [resighted], []);
    expect(merged[0]?.clickedAt).toBe('2026-06-10T12:00:00.000Z');
    expect(merged[0]?.reply).toBe('r');
    expect(merged[0]?.lastSeenAt).toBe('2026-06-10T13:00:00.000Z');
  });

  test('caps the buffer by evicting least-recently-seen', () => {
    const old = Array.from({ length: RADAR_CAP }, (_, i) =>
      sighting(`old-${i}`, {
        lastSeenAt: `2026-06-10T0${i % 10}:0${i % 6}:00.000Z`,
      }),
    );
    const fresh = [
      sighting('fresh-1', { lastSeenAt: '2026-06-10T12:00:00.000Z' }),
      sighting('fresh-2', { lastSeenAt: '2026-06-10T12:01:00.000Z' }),
    ];
    const merged = mergeSightings(old, fresh, []);
    expect(merged).toHaveLength(RADAR_CAP);
    const ids = new Set(merged.map((s) => s.tweetId));
    expect(ids.has('fresh-1')).toBe(true);
    expect(ids.has('fresh-2')).toBe(true);
  });

  test('a manual add (RU.8) is never downgraded by a hot re-sight', () => {
    const pinned = sighting('1', { band: 'manual' });
    const resighted = sighting('1', { band: 'hot' });
    const merged = mergeSightings([pinned], [resighted], []);
    expect(merged[0]?.band).toBe('manual');
  });

  test('eviction keeps a manual add over fresher auto-captured rows (RU.8)', () => {
    // The pinned row is the oldest by lastSeenAt, yet RADAR_CAP fresher rows
    // must not evict it — a human pin outlives auto-captures.
    const pinned = sighting('pinned', {
      band: 'manual',
      lastSeenAt: '2026-06-10T00:00:00.000Z',
    });
    const fresh = Array.from({ length: RADAR_CAP }, (_, i) =>
      sighting(`fresh-${i}`, {
        lastSeenAt: `2026-06-10T1${i % 10}:0${i % 6}:00.000Z`,
      }),
    );
    const merged = mergeSightings([pinned], fresh, []);
    expect(merged).toHaveLength(RADAR_CAP);
    expect(merged.some((s) => s.tweetId === 'pinned')).toBe(true);
  });

  test('a roster row (GT.8) is UPGRADED by a hot re-sight — the tweet caught fire', () => {
    const quiet = sighting('1', { band: 'roster' });
    const loud = sighting('1', { band: 'hot' });
    expect(mergeSightings([quiet], [loud], [])[0]?.band).toBe('hot');
  });

  test('a roster re-sight never DOWNGRADES a real verdict (vpm decays with age)', () => {
    // Same tweet, later scroll: it was hot at capture, has since gone quiet, and
    // its author is in my circle. The queue must keep the verdict it earned.
    const hot = sighting('1', { band: 'hot' });
    const nowQuiet = sighting('1', { band: 'roster', lastSeenAt: '2026-06-10T11:00:00.000Z' });
    const merged = mergeSightings([hot], [nowQuiet], []);
    expect(merged[0]?.band).toBe('hot');
    expect(merged[0]?.lastSeenAt).toBe('2026-06-10T11:00:00.000Z'); // everything else still refreshes
  });

  test('a manual pin still outranks a roster re-sight', () => {
    const pinned = sighting('1', { band: 'manual' });
    expect(mergeSightings([pinned], [sighting('1', { band: 'roster' })], [])[0]?.band).toBe(
      'manual',
    );
  });

  test('eviction drops roster captures before real verdicts (GT.8 queue pressure)', () => {
    // The roster row is the FRESHEST of the lot and still goes first: a chatty
    // circle must not push the day's loudest opportunities out of the buffer.
    const roster = sighting('roster-1', {
      band: 'roster',
      lastSeenAt: '2026-06-10T23:59:00.000Z',
    });
    const warm = Array.from({ length: RADAR_CAP }, (_, i) =>
      sighting(`warm-${i}`, { lastSeenAt: `2026-06-10T1${i % 10}:0${i % 6}:00.000Z` }),
    );
    const merged = mergeSightings([roster], warm, []);
    expect(merged).toHaveLength(RADAR_CAP);
    expect(merged.some((s) => s.tweetId === 'roster-1')).toBe(false);
  });

  test('cannon and hot share a stickiness rung — the fresher re-sight wins both ways', () => {
    // CQ.4: unlike 'roster', a cannon capture IS a reason to be here (a measured
    // score, or a roster camped on purpose), so it behaves like every hot/warm
    // pair: no upgrade, no downgrade, just the fresher verdict.
    const cannonThenHot = mergeSightings(
      [sighting('1', { band: 'cannon' })],
      [sighting('1', { band: 'hot' })],
      [],
    );
    expect(cannonThenHot[0]?.band).toBe('hot');

    const hotThenCannon = mergeSightings(
      [sighting('1', { band: 'hot' })],
      [sighting('1', { band: 'cannon' })],
      [],
    );
    expect(hotThenCannon[0]?.band).toBe('cannon');
  });

  test('a manual pin still outranks a cannon re-sight', () => {
    const pinned = sighting('1', { band: 'manual' });
    expect(mergeSightings([pinned], [sighting('1', { band: 'cannon' })], [])[0]?.band).toBe(
      'manual',
    );
  });

  test('eviction drops a roster capture before a cannon one (CQ.4)', () => {
    // Both are queue metadata, but only one of them says something about the
    // tweet. Under cap pressure the roster row is the freshest of the three and
    // still the one that goes.
    const roster = sighting('roster-1', {
      band: 'roster',
      lastSeenAt: '2026-06-10T23:59:00.000Z',
    });
    const cannon = sighting('cannon-1', {
      band: 'cannon',
      lastSeenAt: '2026-06-10T00:00:00.000Z',
    });
    const warm = Array.from({ length: RADAR_CAP - 1 }, (_, i) =>
      sighting(`warm-${i}`, { lastSeenAt: `2026-06-10T1${i % 10}:0${i % 6}:00.000Z` }),
    );
    const merged = mergeSightings([roster, cannon], warm, []);
    expect(merged).toHaveLength(RADAR_CAP);
    expect(merged.some((s) => s.tweetId === 'roster-1')).toBe(false);
    expect(merged.some((s) => s.tweetId === 'cannon-1')).toBe(true);
  });
});

describe('appendDismissed', () => {
  test('dedups and appends', () => {
    expect(appendDismissed(['a', 'b'], ['b', 'c'])).toEqual(['a', 'b', 'c']);
  });

  test('caps by dropping the oldest dismissals', () => {
    const full = Array.from({ length: RADAR_DISMISSED_CAP }, (_, i) => `id-${i}`);
    const out = appendDismissed(full, ['new']);
    expect(out).toHaveLength(RADAR_DISMISSED_CAP);
    expect(out[0]).toBe('id-1');
    expect(out[out.length - 1]).toBe('new');
  });
});

describe('rankSightings', () => {
  test('orders by band, then vpm, then recency', () => {
    const rows = [
      sighting('warm-fast', {
        band: 'warm',
        signals: { views: 900, replies: 3, ageMin: 10, vpm: 90, bait: false },
      }),
      sighting('hot-slow', {
        band: 'hot',
        signals: { views: 1500, replies: 8, ageMin: 100, vpm: 15, bait: false },
      }),
      sighting('hot-fast', {
        band: 'hot',
        signals: { views: 1200, replies: 4, ageMin: 12, vpm: 100, bait: true },
      }),
      sighting('hot-fast-newer', {
        band: 'hot',
        signals: { views: 1200, replies: 4, ageMin: 12, vpm: 100, bait: false },
        lastSeenAt: '2026-06-10T11:30:00.000Z',
      }),
    ];
    expect(rankSightings(rows).map((s) => s.tweetId)).toEqual([
      'hot-fast-newer',
      'hot-fast',
      'hot-slow',
      'warm-fast',
    ]);
  });

  test('a manual add (RU.8) ranks first, above roster tier and band', () => {
    const rows = [
      sighting('hot-ally', {
        band: 'hot',
        personTier: 'ally',
        signals: { views: 5000, replies: 40, ageMin: 5, vpm: 1000, bait: false },
      }),
      sighting('manual-cold', {
        band: 'manual',
        signals: { views: 0, replies: 0, ageMin: 3, vpm: 0, bait: false },
      }),
    ];
    expect(rankSightings(rows).map((s) => s.tweetId)).toEqual(['manual-cold', 'hot-ally']);
  });

  test('does not mutate its input', () => {
    const rows = [sighting('1', { band: 'warm' }), sighting('2', { band: 'hot' })];
    rankSightings(rows);
    expect(rows[0]?.tweetId).toBe('1');
  });

  test('a roster capture (GT.8) ranks below warm WITHIN the same tier', () => {
    // Same person, same tier — so the only thing separating these is the band,
    // and the quiet one that is here for who posted it goes last. vpm would say
    // the opposite if band didn't lead it.
    const rows = [
      sighting('roster-fast', {
        band: 'roster',
        personTier: 'target',
        signals: { views: 80, replies: 0, ageMin: 1, vpm: 80, bait: false },
      }),
      sighting('warm-slow', {
        band: 'warm',
        personTier: 'target',
        signals: { views: 600, replies: 4, ageMin: 120, vpm: 5, bait: false },
      }),
      sighting('hot-slow', {
        band: 'hot',
        personTier: 'target',
        signals: { views: 900, replies: 9, ageMin: 200, vpm: 4, bait: false },
      }),
    ];
    expect(rankSightings(rows).map((s) => s.tweetId)).toEqual([
      'hot-slow',
      'warm-slow',
      'roster-fast',
    ]);
  });

  test('a roster capture from an ally still outranks a hot stranger (tier leads band)', () => {
    const rows = [
      sighting('hot-rando', {
        band: 'hot',
        signals: { views: 9000, replies: 60, ageMin: 6, vpm: 1500, bait: false },
      }),
      sighting('roster-ally', {
        band: 'roster',
        personTier: 'ally',
        signals: { views: 40, replies: 0, ageMin: 12, vpm: 3, bait: false },
      }),
    ];
    expect(rankSightings(rows).map((s) => s.tweetId)).toEqual(['roster-ally', 'hot-rando']);
  });

  test('roster tier leads band/vpm/recency (S0.3)', () => {
    const rows = [
      sighting('hot-rando', {
        band: 'hot',
        signals: { views: 5000, replies: 20, ageMin: 8, vpm: 200, bait: false },
      }),
      sighting('warm-mutual', {
        band: 'warm',
        personTier: 'mutual',
        signals: { views: 300, replies: 2, ageMin: 30, vpm: 10, bait: false },
      }),
      sighting('warm-target', {
        band: 'warm',
        personTier: 'target',
        signals: { views: 400, replies: 3, ageMin: 25, vpm: 16, bait: false },
      }),
      sighting('hot-target', {
        band: 'hot',
        personTier: 'target',
        signals: { views: 1200, replies: 5, ageMin: 12, vpm: 100, bait: false },
      }),
    ];
    // ally/mutual first, then target (hot target beats warm target on band),
    // then the loud rando last.
    expect(rankSightings(rows).map((s) => s.tweetId)).toEqual([
      'warm-mutual',
      'hot-target',
      'warm-target',
      'hot-rando',
    ]);
  });

  test('ally and mutual share the top tier; band/vpm break the tie', () => {
    const rows = [
      sighting('ally-warm', {
        band: 'warm',
        personTier: 'ally',
        signals: { views: 200, replies: 1, ageMin: 40, vpm: 5, bait: false },
      }),
      sighting('mutual-hot', {
        band: 'hot',
        personTier: 'mutual',
        signals: { views: 900, replies: 6, ageMin: 15, vpm: 60, bait: false },
      }),
    ];
    expect(rankSightings(rows).map((s) => s.tweetId)).toEqual(['mutual-hot', 'ally-warm']);
  });

  test('a cannon capture (CQ.4) ranks below hot at equal tier, and manual still leads', () => {
    // The main Queue is the reciprocity lane: an arbitrage capture must not
    // outrank a real verdict here however dense it is. That ordering lives in
    // the Cannon view, which reads the same buffer through its own sort.
    const rows = [
      sighting('cannon-dense', {
        band: 'cannon',
        signals: { views: 200_000, replies: 6, ageMin: 4, vpm: 50_000, bait: false },
      }),
      sighting('hot-modest', {
        band: 'hot',
        signals: { views: 1200, replies: 5, ageMin: 12, vpm: 100, bait: false },
      }),
      sighting('manual-cold', {
        band: 'manual',
        signals: { views: 0, replies: 0, ageMin: 3, vpm: 0, bait: false },
      }),
    ];
    expect(rankSightings(rows).map((s) => s.tweetId)).toEqual([
      'manual-cold',
      'hot-modest',
      'cannon-dense',
    ]);
  });
});

describe('personTierFor', () => {
  test('ally/mutual stage → that tier; a target below mutual → target; else null', () => {
    expect(personTierFor({ stage: 'ally', isTarget: false })).toBe('ally');
    expect(personTierFor({ stage: 'mutual', isTarget: true })).toBe('mutual');
    expect(personTierFor({ stage: 'engaged', isTarget: true })).toBe('target');
    expect(personTierFor({ stage: 'noticed', isTarget: true })).toBe('target');
    expect(personTierFor({ stage: 'engaged', isTarget: false })).toBeNull();
    expect(personTierFor({ stage: 'responded', isTarget: false })).toBeNull();
    expect(personTierFor(undefined)).toBeNull();
  });
});

describe('stampTiers', () => {
  const map: RankMap = {
    ally_h: { stage: 'ally', isTarget: false },
    target_h: { stage: 'noticed', isTarget: true },
  };

  test('derives personTier from the rankmap, matching handles case-insensitively', () => {
    const rows = [
      sighting('1', { handle: 'Ally_H' }),
      sighting('2', { handle: 'target_h' }),
      sighting('3', { handle: 'nobody' }),
    ];
    const out = stampTiers(rows, map);
    expect(out[0]?.personTier).toBe('ally');
    expect(out[1]?.personTier).toBe('target');
    expect(out[2]?.personTier).toBeUndefined();
  });

  test('clears a stale tier when the author dropped out of the map', () => {
    const rows = [sighting('1', { handle: 'ally_h', personTier: 'target' })];
    const out = stampTiers(rows, {});
    expect(out[0]?.personTier).toBeUndefined();
  });

  test('returns the same reference for rows whose tier is unchanged', () => {
    const row = sighting('1', { handle: 'ally_h', personTier: 'ally' });
    const out = stampTiers([row], map);
    expect(out[0]).toBe(row);
  });

  test('an empty map clears all tiers (no rankmap loaded yet)', () => {
    const rows = [sighting('1', { handle: 'ally_h', personTier: 'ally' }), sighting('2')];
    const out = stampTiers(rows, {});
    expect(out.every((s) => s.personTier === undefined)).toBe(true);
  });
});

describe('splitClicked', () => {
  test('clicked rows leave the queue, sorted most-recently-clicked first', () => {
    const ranked = [
      sighting('a'),
      sighting('b', { clickedAt: '2026-06-10T10:00:00.000Z' }),
      sighting('c'),
      sighting('d', { clickedAt: '2026-06-10T11:00:00.000Z' }),
    ];
    const { queue, clicked } = splitClicked(ranked);
    expect(queue.map((s) => s.tweetId)).toEqual(['a', 'c']);
    expect(clicked.map((s) => s.tweetId)).toEqual(['d', 'b']);
  });

  test('preserves the incoming queue order (rank)', () => {
    const ranked = [sighting('first'), sighting('second'), sighting('third')];
    expect(splitClicked(ranked).queue.map((s) => s.tweetId)).toEqual(['first', 'second', 'third']);
  });
});

describe('groupQueue', () => {
  test('splits reply-ready from freshly-discovered, keeping order within each', () => {
    const queue = [
      sighting('ready-1', { reply: 'r1' }),
      sighting('new-1'),
      sighting('ready-2', { reply: 'r2' }),
      sighting('new-2'),
    ];
    const { ready, fresh } = groupQueue(queue);
    expect(ready.map((s) => s.tweetId)).toEqual(['ready-1', 'ready-2']);
    expect(fresh.map((s) => s.tweetId)).toEqual(['new-1', 'new-2']);
  });
});

describe('partitionForCurate (RC.4)', () => {
  test('manual pins are never scored; every other band is', () => {
    const fresh = [
      sighting('pin-1', { band: 'manual' }),
      sighting('hot-1', { band: 'hot' }),
      sighting('warm-1', { band: 'warm' }),
      // GT.8 roster rows ARE scored: they are in the queue for WHO posted them,
      // and whether the post is worth replying to is a different question.
      sighting('roster-1', { band: 'roster' }),
    ];
    const { pinned, scoreable, skipped } = partitionForCurate(fresh);
    expect(pinned.map((s) => s.tweetId)).toEqual(['pin-1']);
    expect(scoreable.map((s) => s.tweetId)).toEqual(['hot-1', 'warm-1', 'roster-1']);
    expect(skipped).toEqual([]);
  });

  test('a textless row is skipped whatever its band — including a pin', () => {
    // An image-only tweet captures as `text: ''`. Scoring is text-only, and the
    // server refuses an empty text for the whole request — one of these in the
    // queue would 400 the entire pass if it rode along.
    const fresh = [
      sighting('img-1', { text: '' }),
      sighting('img-2', { text: '   ' }),
      sighting('pin-blank', { band: 'manual', text: '' }),
      sighting('warm-1'),
    ];
    const { pinned, scoreable, skipped } = partitionForCurate(fresh);
    expect(pinned).toEqual([]);
    expect(scoreable.map((s) => s.tweetId)).toEqual(['warm-1']);
    expect(skipped.map((s) => s.tweetId)).toEqual(['img-1', 'img-2', 'pin-blank']);
  });

  test('the three buckets always sum to the input — a row can never vanish here', () => {
    const fresh = [
      sighting('a', { band: 'manual' }),
      sighting('b', { band: 'hot' }),
      sighting('c', { text: '' }),
      sighting('d', { band: 'roster' }),
    ];
    const { pinned, scoreable, skipped } = partitionForCurate(fresh);
    expect(pinned.length + scoreable.length + skipped.length).toBe(fresh.length);
    expect([...pinned, ...scoreable, ...skipped].map((s) => s.tweetId).sort()).toEqual([
      'a',
      'b',
      'c',
      'd',
    ]);
  });

  test('queue order survives inside each bucket', () => {
    const fresh = [sighting('z'), sighting('m'), sighting('a')];
    expect(partitionForCurate(fresh).scoreable.map((s) => s.tweetId)).toEqual(['z', 'm', 'a']);
  });

  test('an empty queue partitions into three empty buckets', () => {
    expect(partitionForCurate([])).toEqual({ pinned: [], scoreable: [], skipped: [] });
  });
});

describe('isRadarSightings', () => {
  test('accepts a valid stored array and rejects junk', () => {
    expect(isRadarSightings([sighting('1')])).toBe(true);
    expect(isRadarSightings([sighting('1', { band: 'manual' })])).toBe(true);
    expect(isRadarSightings([sighting('1', { band: 'roster' })])).toBe(true); // GT.8
    expect(isRadarSightings([sighting('1', { band: 'cannon' })])).toBe(true); // CQ.4
    expect(isRadarSightings([{ ...sighting('1'), band: 'cold' }])).toBe(false);
    expect(isRadarSightings([])).toBe(true);
    expect(isRadarSightings(undefined)).toBe(false);
    expect(isRadarSightings([{ tweetId: 1 }])).toBe(false);
    expect(isRadarSightings([sighting('1'), { nope: true }])).toBe(false);
  });
});

describe('coerceSightings', () => {
  test('keeps the readable rows instead of nuking the whole buffer', () => {
    const good = sighting('1');
    expect(coerceSightings([good, { nope: true }, sighting('2')])).toEqual([good, sighting('2')]);
    expect(coerceSightings([{ ...sighting('1'), band: 'cold' }])).toEqual([]);
    expect(coerceSightings(undefined)).toEqual([]);
    expect(coerceSightings('not an array')).toEqual([]);
    expect(coerceSightings([])).toEqual([]);
  });
});

describe('pruneStale', () => {
  const now = Date.parse('2026-06-11T10:00:00.000Z');

  test('drops sightings past the TTL and keeps the rest', () => {
    const fresh = sighting('1', { lastSeenAt: '2026-06-11T09:30:00.000Z' });
    const old = sighting('2', { lastSeenAt: '2026-06-10T09:00:00.000Z' }); // 25h
    expect(pruneStale([fresh, old], now).map((s) => s.tweetId)).toEqual(['1']);
  });

  test('an unparseable lastSeenAt is kept, never silently dropped', () => {
    const broken = sighting('3', { lastSeenAt: 'not a date' });
    expect(pruneStale([broken], now)).toEqual([broken]);
  });

  test('the TTL is exactly RADAR_TTL_MS from lastSeenAt', () => {
    const justInside = sighting('4', {
      lastSeenAt: new Date(now - RADAR_TTL_MS + 1000).toISOString(),
    });
    const justOutside = sighting('5', { lastSeenAt: new Date(now - RADAR_TTL_MS).toISOString() });
    expect(pruneStale([justInside, justOutside], now).map((s) => s.tweetId)).toEqual(['4']);
  });
});

describe('draftRowToSighting (C0 rehydration)', () => {
  const row: RadarDraftRow = {
    id: 'uuid-1',
    tweetId: '111',
    url: 'https://x.com/alice/status/111',
    handle: 'alice',
    author: 'Alice',
    snippet: 'shipping beats planning',
    band: 'hot',
    signals: { views: 1500, replies: 8, ageMin: 22, vpm: 68, bait: false },
    replyText: 'my drafted reply',
    angle: 'contrarian',
    variants: null,
    status: 'ready',
    draftedAt: '2026-07-01T10:00:00.000Z',
    createdAt: '2026-07-01T10:00:00.000Z',
  };

  test('rebuilds a reply-ready sighting from a server row', () => {
    const s = draftRowToSighting(row);
    expect(s).toEqual({
      tweetId: '111',
      url: 'https://x.com/alice/status/111',
      handle: 'alice',
      author: 'Alice',
      text: 'shipping beats planning',
      band: 'hot',
      signals: { views: 1500, replies: 8, ageMin: 22, vpm: 68, bait: false },
      firstSeenAt: '2026-07-01T10:00:00.000Z',
      lastSeenAt: '2026-07-01T10:00:00.000Z',
      reply: 'my drafted reply',
    });
  });

  test('falls back to a built status URL when the row has none', () => {
    const s = draftRowToSighting({ ...row, url: null });
    expect(s?.url).toBe('https://x.com/alice/status/111');
  });

  test('rows without band/signals cannot rehydrate (no rank, no why-line)', () => {
    expect(draftRowToSighting({ ...row, band: null })).toBeNull();
    expect(draftRowToSighting({ ...row, signals: null })).toBeNull();
  });

  test('maps the 3 angle variants from the server row (RU.4)', () => {
    const s = draftRowToSighting({
      ...row,
      variants: [
        { text: 'my drafted reply', angle: 'contrarian' },
        { text: 'extend it', angle: 'extends' },
        { text: 'fight me', angle: 'debate' },
      ],
    });
    expect(s?.variants).toHaveLength(3);
    expect(s?.variants?.[0]?.angle).toBe('contrarian');
    expect(s?.reply).toBe('my drafted reply');
  });

  test('a row with null variants rehydrates without a variants key', () => {
    const s = draftRowToSighting(row);
    expect(s?.variants).toBeUndefined();
  });

  test('rehydrated sightings merge cleanly and keep their reply', () => {
    const s = draftRowToSighting(row);
    if (!s) throw new Error('expected sighting');
    const merged = mergeSightings([], [s], []);
    expect(merged[0]?.reply).toBe('my drafted reply');
    // dismissed ids stay gone even through rehydration
    expect(mergeSightings([], [s], ['111'])).toEqual([]);
  });
});
