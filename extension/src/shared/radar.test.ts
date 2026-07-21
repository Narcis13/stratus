import { describe, expect, test } from 'bun:test';
import {
  RADAR_CAP,
  RADAR_DISMISSED_CAP,
  type RadarDraftRow,
  type RadarSighting,
  type RankMap,
  appendDismissed,
  draftRowToSighting,
  groupQueue,
  isRadarSightings,
  mergeSightings,
  personTierFor,
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

describe('isRadarSightings', () => {
  test('accepts a valid stored array and rejects junk', () => {
    expect(isRadarSightings([sighting('1')])).toBe(true);
    expect(isRadarSightings([])).toBe(true);
    expect(isRadarSightings(undefined)).toBe(false);
    expect(isRadarSightings([{ tweetId: 1 }])).toBe(false);
    expect(isRadarSightings([sighting('1'), { nope: true }])).toBe(false);
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
