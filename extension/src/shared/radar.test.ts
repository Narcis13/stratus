import { describe, expect, test } from 'bun:test';
import {
  RADAR_CAP,
  RADAR_DISMISSED_CAP,
  type RadarDraftRow,
  type RadarSighting,
  appendDismissed,
  draftRowToSighting,
  groupQueue,
  isRadarSightings,
  mergeSightings,
  rankSightings,
  splitClicked,
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

  test('does not mutate its input', () => {
    const rows = [sighting('1', { band: 'warm' }), sighting('2', { band: 'hot' })];
    rankSightings(rows);
    expect(rows[0]?.tweetId).toBe('1');
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

  test('rehydrated sightings merge cleanly and keep their reply', () => {
    const s = draftRowToSighting(row);
    if (!s) throw new Error('expected sighting');
    const merged = mergeSightings([], [s], []);
    expect(merged[0]?.reply).toBe('my drafted reply');
    // dismissed ids stay gone even through rehydration
    expect(mergeSightings([], [s], ['111'])).toEqual([]);
  });
});
