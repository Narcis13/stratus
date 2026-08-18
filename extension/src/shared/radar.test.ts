import { describe, expect, test } from 'bun:test';
import { RADAR_QUEUE_TTL_MS } from '../radarSweep.ts';
import {
  CURATE_REQUEST_CAP,
  RADAR_CAP,
  RADAR_DISMISSED_CAP,
  RADAR_DISMISSED_TTL_MS,
  RADAR_TTL_MS,
  type RadarDraftRow,
  type RadarSighting,
  type RankMap,
  appendDismissed,
  cannonQueue,
  coerceDismissed,
  coerceSightings,
  dismissedIds,
  displayAgeMin,
  draftRowToSighting,
  groupQueue,
  isRadarSightings,
  mergeSightings,
  partitionForCurate,
  personTierFor,
  pruneDismissed,
  pruneStale,
  purgeDismissed,
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
    band: 'sweep',
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
      band: 'cannon',
      signals: { views: 2000, replies: 12, ageMin: 45, vpm: 44, bait: false },
      firstSeenAt: '2026-06-10T11:00:00.000Z',
      lastSeenAt: '2026-06-10T11:00:00.000Z',
    });
    const merged = mergeSightings([first], [again], []);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.band).toBe('cannon');
    expect(merged[0]?.signals.views).toBe(2000);
    expect(merged[0]?.lastSeenAt).toBe('2026-06-10T11:00:00.000Z');
    expect(merged[0]?.firstSeenAt).toBe('2026-06-10T10:00:00.000Z');
  });

  test('dismissed ids never re-enter (the content script keeps re-sighting them)', () => {
    const merged = mergeSightings([sighting('1')], [sighting('2'), sighting('3')], ['2']);
    expect(merged.map((s) => s.tweetId).sort()).toEqual(['1', '3']);
  });

  test('a ⊕ pin overrides its own tombstone — a human changing their mind', () => {
    const pinned = sighting('2', { band: 'manual' });
    expect(mergeSightings([], [pinned], ['2']).map((s) => s.tweetId)).toEqual(['2']);
    // …and only the pin: the auto arms stay blocked by the same tombstone.
    expect(mergeSightings([], [sighting('2', { band: 'sweep' })], ['2'])).toHaveLength(0);
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

  test('a re-sighting keeps the room the reply was drafted for (RC.5)', () => {
    const drafted = sighting('1', { reply: 'r', mode: 'wholesome', modeSource: 'detected' });
    const resighted = sighting('1', { lastSeenAt: '2026-06-10T11:00:00.000Z' });
    const merged = mergeSightings([drafted], [resighted], []);
    // The chip has to outlive a scroll-past, or the check it exists for is gone
    // exactly when the row is still unworked.
    expect(merged[0]?.mode).toBe('wholesome');
    expect(merged[0]?.modeSource).toBe('detected');
  });

  test('a re-drafted row takes the fresh room (RC.5)', () => {
    const drafted = sighting('1', { mode: 'general', modeSource: 'fallback' });
    const updated = sighting('1', { mode: 'banter', modeSource: 'roster' });
    const merged = mergeSightings([drafted], [updated], []);
    expect(merged[0]?.mode).toBe('banter');
    expect(merged[0]?.modeSource).toBe('roster');
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

  test('eviction keeps a drafted row over fresher un-drafted captures (RQ.1)', () => {
    // A Grok call was already spent on this row. A scroll that admits a hundred
    // fresh strangers must not be what throws it away.
    const drafted = sighting('drafted', {
      reply: 'the paid draft',
      lastSeenAt: '2026-06-10T00:00:00.000Z',
    });
    const clicked = sighting('clicked', {
      reply: 'worked',
      clickedAt: '2026-06-10T00:30:00.000Z',
      lastSeenAt: '2026-06-10T00:00:00.000Z',
    });
    const fresh = Array.from({ length: RADAR_CAP }, (_, i) =>
      sighting(`fresh-${i}`, { lastSeenAt: `2026-06-10T1${i % 10}:0${i % 6}:00.000Z` }),
    );
    const merged = mergeSightings([drafted, clicked], fresh, []);
    expect(merged).toHaveLength(RADAR_CAP);
    expect(merged.some((s) => s.tweetId === 'drafted')).toBe(true);
    expect(merged.some((s) => s.tweetId === 'clicked')).toBe(true);
  });

  test('a whole sweep session lands — the buffer is not a 100-row ceiling (RQ.1)', () => {
    // The reported bug: an armed sweep on a busy timeline admits more tweets
    // than the old buffer held, and the surplus vanished before it was seen.
    const swept = Array.from({ length: 400 }, (_, i) => sighting(`swept-${i}`));
    expect(mergeSightings([], swept, [])).toHaveLength(400);
  });

  test('a manual add (RU.8) is never downgraded by an auto re-sight', () => {
    const pinned = sighting('1', { band: 'manual' });
    const resighted = sighting('1', { band: 'sweep' });
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

  test('a roster row (GT.8) is UPGRADED when a sweep later admits it on its numbers', () => {
    const quiet = sighting('1', { band: 'roster' });
    const loud = sighting('1', { band: 'sweep' });
    expect(mergeSightings([quiet], [loud], [])[0]?.band).toBe('sweep');
  });

  test('a roster re-sight never DOWNGRADES a swept row', () => {
    // Same tweet, later scroll: the filters admitted it at capture, it has since
    // aged past them, and its author is in my circle. The queue keeps the
    // stronger reason it is here.
    const swept = sighting('1', { band: 'sweep' });
    const nowQuiet = sighting('1', { band: 'roster', lastSeenAt: '2026-06-10T11:00:00.000Z' });
    const merged = mergeSightings([swept], [nowQuiet], []);
    expect(merged[0]?.band).toBe('sweep');
    expect(merged[0]?.lastSeenAt).toBe('2026-06-10T11:00:00.000Z'); // everything else still refreshes
  });

  test('a manual pin still outranks a roster re-sight', () => {
    const pinned = sighting('1', { band: 'manual' });
    expect(mergeSightings([pinned], [sighting('1', { band: 'roster' })], [])[0]?.band).toBe(
      'manual',
    );
  });

  test('eviction drops roster captures before swept rows (GT.8 queue pressure)', () => {
    // The roster row is the FRESHEST of the lot and still goes first: a chatty
    // circle must not push the rows my own filters admitted out of the buffer.
    const roster = sighting('roster-1', {
      band: 'roster',
      lastSeenAt: '2026-06-10T23:59:00.000Z',
    });
    const swept = Array.from({ length: RADAR_CAP }, (_, i) =>
      sighting(`swept-${i}`, { lastSeenAt: `2026-06-10T1${i % 10}:0${i % 6}:00.000Z` }),
    );
    const merged = mergeSightings([roster], swept, []);
    expect(merged).toHaveLength(RADAR_CAP);
    expect(merged.some((s) => s.tweetId === 'roster-1')).toBe(false);
  });

  test('cannon and sweep share a stickiness rung — the fresher re-sight wins both ways', () => {
    // CQ.4/RS.2: unlike 'roster', both are reasons the user armed on purpose (a
    // camped roster, or their own filters), so neither upgrades or downgrades
    // the other — the fresher capture simply wins.
    const cannonThenSweep = mergeSightings(
      [sighting('1', { band: 'cannon' })],
      [sighting('1', { band: 'sweep' })],
      [],
    );
    expect(cannonThenSweep[0]?.band).toBe('sweep');

    const sweepThenCannon = mergeSightings(
      [sighting('1', { band: 'sweep' })],
      [sighting('1', { band: 'cannon' })],
      [],
    );
    expect(sweepThenCannon[0]?.band).toBe('cannon');
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
    const swept = Array.from({ length: RADAR_CAP - 1 }, (_, i) =>
      sighting(`swept-${i}`, { lastSeenAt: `2026-06-10T1${i % 10}:0${i % 6}:00.000Z` }),
    );
    const merged = mergeSightings([roster, cannon], swept, []);
    expect(merged).toHaveLength(RADAR_CAP);
    expect(merged.some((s) => s.tweetId === 'roster-1')).toBe(false);
    expect(merged.some((s) => s.tweetId === 'cannon-1')).toBe(true);
  });

  test('a sweep admission is never demoted by a roster re-sight (RS.2)', () => {
    // Same rung as cannon: the user's own filters admitted this row, so
    // "someone I know posted it" is not new information that should replace it.
    const swept = sighting('1', { band: 'sweep' });
    expect(mergeSightings([swept], [sighting('1', { band: 'roster' })], [])[0]?.band).toBe('sweep');
  });

  test('a manual pin still outranks a sweep re-sight', () => {
    const pinned = sighting('1', { band: 'manual' });
    expect(mergeSightings([pinned], [sighting('1', { band: 'sweep' })], [])[0]?.band).toBe(
      'manual',
    );
  });

  test('likes/verified survive a metric-less re-sighting (RS.2)', () => {
    // The sweep admitted this row on numbers the card can't otherwise show; a
    // re-sight that couldn't read them must not erase why it is here.
    const captured = sighting('1', { band: 'sweep', likes: 42, verified: true });
    const resighted = sighting('1', { band: 'sweep', lastSeenAt: '2026-06-10T11:00:00.000Z' });
    const merged = mergeSightings([captured], [resighted], []);
    expect(merged[0]?.likes).toBe(42);
    expect(merged[0]?.verified).toBe(true);
    expect(merged[0]?.lastSeenAt).toBe('2026-06-10T11:00:00.000Z');
  });

  test('a fresher read of likes/verified wins (RS.2)', () => {
    const captured = sighting('1', { likes: 5, verified: false });
    const later = sighting('1', { likes: 60, verified: true });
    const merged = mergeSightings([captured], [later], []);
    expect(merged[0]?.likes).toBe(60);
    expect(merged[0]?.verified).toBe(true);
  });

  test('likes/verified stay ABSENT, not undefined, when never captured', () => {
    // exactOptionalPropertyTypes: an `undefined` value would round-trip through
    // JSON as a dropped key anyway, so the buffer must never write one.
    const merged = mergeSightings([sighting('1')], [sighting('1', { reply: 'r' })], []);
    expect(merged[0] && 'likes' in merged[0]).toBe(false);
    expect(merged[0] && 'verified' in merged[0]).toBe(false);
  });
});

describe('the caps', () => {
  test('the curate request cap is the SERVER’s, not the buffer’s (RQ.1)', () => {
    // They were one constant while both were 100. `MAX_CURATE_TWEETS` in
    // `src/x/replies/curate.ts` is still 100 and the route REFUSES an over-long
    // batch — sending RADAR_CAP rows would 400 the whole pass.
    expect(CURATE_REQUEST_CAP).toBe(100);
    expect(RADAR_CAP).toBeGreaterThan(CURATE_REQUEST_CAP);
  });
});

describe('appendDismissed', () => {
  const NOW = Date.parse('2026-08-11T12:00:00.000Z');

  test('dedups and appends, stamping the moment of the dismissal', () => {
    const out = appendDismissed([{ id: 'a', at: NOW - 1000 }], ['b', 'b'], NOW);
    expect(dismissedIds(out).sort()).toEqual(['a', 'b']);
    expect(out.find((t) => t.id === 'b')?.at).toBe(NOW);
  });

  test('re-dismissing an id re-stamps it — the TTL runs from the last "no"', () => {
    const stale = [{ id: 'a', at: NOW - RADAR_DISMISSED_TTL_MS + 60_000 }];
    const out = appendDismissed(stale, ['a'], NOW);
    expect(out).toHaveLength(1);
    expect(out[0]?.at).toBe(NOW);
  });

  test('appending prunes tombstones past the TTL', () => {
    // The bug this whole shape exists for: an id buried yesterday must not block
    // today's capture just because nothing has dismissed 500 tweets since.
    const old = [{ id: 'yesterday', at: NOW - RADAR_DISMISSED_TTL_MS - 1 }];
    expect(dismissedIds(appendDismissed(old, ['today'], NOW))).toEqual(['today']);
  });

  test('caps by dropping the oldest dismissals', () => {
    const full = Array.from({ length: RADAR_DISMISSED_CAP }, (_, i) => ({
      id: `id-${i}`,
      at: NOW - RADAR_DISMISSED_CAP + i,
    }));
    const out = appendDismissed(full, ['new'], NOW);
    expect(out).toHaveLength(RADAR_DISMISSED_CAP);
    expect(out[0]?.id).toBe('id-1');
    expect(out[out.length - 1]?.id).toBe('new');
  });

  test('a tweet dismissed today can be re-swept tomorrow', () => {
    const buried = appendDismissed([], ['1'], NOW);
    const tomorrow = NOW + RADAR_DISMISSED_TTL_MS + 1;
    const live = pruneDismissed(buried, tomorrow);
    expect(mergeSightings([], [sighting('1')], dismissedIds(live))).toHaveLength(1);
  });
});

describe('purgeDismissed', () => {
  test('un-buries the named ids and leaves the rest', () => {
    const dismissed = [
      { id: 'a', at: 1 },
      { id: 'b', at: 2 },
    ];
    expect(dismissedIds(purgeDismissed(dismissed, ['a']))).toEqual(['b']);
  });

  test('an empty id list is the identity (no needless rewrite)', () => {
    const dismissed = [{ id: 'a', at: 1 }];
    expect(purgeDismissed(dismissed, [])).toBe(dismissed);
  });
});

describe('coerceDismissed', () => {
  const NOW = Date.parse('2026-08-11T12:00:00.000Z');

  test('migrates the legacy string[] by stamping it now', () => {
    const out = coerceDismissed(['a', 'b'], NOW);
    expect(out).toEqual([
      { id: 'a', at: NOW },
      { id: 'b', at: NOW },
    ]);
  });

  test('drops entries past the TTL and keeps live ones', () => {
    const out = coerceDismissed(
      [
        { id: 'old', at: NOW - RADAR_DISMISSED_TTL_MS - 1 },
        { id: 'live', at: NOW - 1000 },
      ],
      NOW,
    );
    expect(dismissedIds(out)).toEqual(['live']);
  });

  test('keeps what parses and drops what does not — never all-or-nothing', () => {
    const out = coerceDismissed([{ id: 'good', at: NOW }, null, 42, { at: NOW }], NOW);
    expect(dismissedIds(out)).toEqual(['good']);
  });

  test('an unreadable timestamp reads as now, never as 1970', () => {
    // A 0 would un-dismiss the row on the very next read, which is the one
    // direction this must not fail in.
    expect(coerceDismissed([{ id: 'a', at: 'nope' }], NOW)).toEqual([{ id: 'a', at: NOW }]);
  });

  test('a non-array (missing key, corrupted blob) is an empty set', () => {
    expect(coerceDismissed(undefined, NOW)).toEqual([]);
    expect(coerceDismissed({ a: 1 }, NOW)).toEqual([]);
  });
});

describe('rankSightings', () => {
  test('orders by vpm, then recency', () => {
    const rows = [
      sighting('mid', {
        signals: { views: 900, replies: 3, ageMin: 10, vpm: 90, bait: false },
      }),
      sighting('slow', {
        signals: { views: 1500, replies: 8, ageMin: 100, vpm: 15, bait: false },
      }),
      sighting('fast', {
        signals: { views: 1200, replies: 4, ageMin: 12, vpm: 100, bait: true },
      }),
      sighting('fast-newer', {
        signals: { views: 1200, replies: 4, ageMin: 12, vpm: 100, bait: false },
        lastSeenAt: '2026-06-10T11:30:00.000Z',
      }),
    ];
    expect(rankSightings(rows).map((s) => s.tweetId)).toEqual([
      'fast-newer',
      'fast',
      'mid',
      'slow',
    ]);
  });

  // The capture reason does NOT sort the queue: with the classifier gone every
  // band says how a row arrived, not how loud it is, and vpm already measures
  // loudness. A ⊕ pin is the one exception, asserted next.
  test('capture reason does not break a vpm tie-break at equal tier', () => {
    const rows = [
      sighting('roster-fast', {
        band: 'roster',
        personTier: 'target',
        signals: { views: 900, replies: 1, ageMin: 3, vpm: 300, bait: false },
      }),
      sighting('sweep-slow', {
        band: 'sweep',
        personTier: 'target',
        signals: { views: 600, replies: 4, ageMin: 120, vpm: 5, bait: false },
      }),
      sighting('cannon-mid', {
        band: 'cannon',
        personTier: 'target',
        signals: { views: 900, replies: 9, ageMin: 30, vpm: 30, bait: false },
      }),
    ];
    expect(rankSightings(rows).map((s) => s.tweetId)).toEqual([
      'roster-fast',
      'cannon-mid',
      'sweep-slow',
    ]);
  });

  test('a manual add (RU.8) ranks first, above roster tier and vpm', () => {
    const rows = [
      sighting('loud-ally', {
        band: 'sweep',
        personTier: 'ally',
        signals: { views: 5000, replies: 40, ageMin: 5, vpm: 1000, bait: false },
      }),
      sighting('manual-cold', {
        band: 'manual',
        signals: { views: 0, replies: 0, ageMin: 3, vpm: 0, bait: false },
      }),
    ];
    expect(rankSightings(rows).map((s) => s.tweetId)).toEqual(['manual-cold', 'loud-ally']);
  });

  test('does not mutate its input', () => {
    const rows = [sighting('1', { band: 'sweep' }), sighting('2', { band: 'cannon' })];
    rankSightings(rows);
    expect(rows[0]?.tweetId).toBe('1');
  });

  test('a roster capture from an ally still outranks a loud stranger (tier leads vpm)', () => {
    const rows = [
      sighting('loud-rando', {
        band: 'sweep',
        signals: { views: 9000, replies: 60, ageMin: 6, vpm: 1500, bait: false },
      }),
      sighting('roster-ally', {
        band: 'roster',
        personTier: 'ally',
        signals: { views: 40, replies: 0, ageMin: 12, vpm: 3, bait: false },
      }),
    ];
    expect(rankSightings(rows).map((s) => s.tweetId)).toEqual(['roster-ally', 'loud-rando']);
  });

  test('roster tier leads vpm/recency (S0.3)', () => {
    const rows = [
      sighting('loud-rando', {
        signals: { views: 5000, replies: 20, ageMin: 8, vpm: 200, bait: false },
      }),
      sighting('quiet-mutual', {
        personTier: 'mutual',
        signals: { views: 300, replies: 2, ageMin: 30, vpm: 10, bait: false },
      }),
      sighting('slow-target', {
        personTier: 'target',
        signals: { views: 400, replies: 3, ageMin: 25, vpm: 16, bait: false },
      }),
      sighting('fast-target', {
        personTier: 'target',
        signals: { views: 1200, replies: 5, ageMin: 12, vpm: 100, bait: false },
      }),
    ];
    // ally/mutual first, then target (the faster target leads on vpm), then the
    // loud rando last — a 200 vpm stranger still loses to a 10 vpm mutual.
    expect(rankSightings(rows).map((s) => s.tweetId)).toEqual([
      'quiet-mutual',
      'fast-target',
      'slow-target',
      'loud-rando',
    ]);
  });

  test('ally and mutual share the top tier; vpm breaks the tie', () => {
    const rows = [
      sighting('ally-quiet', {
        personTier: 'ally',
        signals: { views: 200, replies: 1, ageMin: 40, vpm: 5, bait: false },
      }),
      sighting('mutual-loud', {
        personTier: 'mutual',
        signals: { views: 900, replies: 6, ageMin: 15, vpm: 60, bait: false },
      }),
    ];
    expect(rankSightings(rows).map((s) => s.tweetId)).toEqual(['mutual-loud', 'ally-quiet']);
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

describe('cannonQueue (CQ.5)', () => {
  // Fixed thresholds, so a recalibration of the shipped defaults can never turn
  // these into a different test (§7.19 — the knobs are an argument on purpose).
  const T = { scoreMin: 120, maxAgeMin: 30, redAgeMin: 15, placedTarget: 18 };
  const NOW = Date.parse('2026-08-05T12:00:00.000Z');

  // A sighting whose displayed age is exactly `ageMin` at NOW: captured age
  // plus time since capture is what the view reads, so both halves are set.
  function cannonSighting(
    id: string,
    over: {
      views?: number;
      replies?: number;
      capturedAgeMin?: number;
      minsSinceSeen?: number;
      band?: RadarSighting['band'];
      clickedAt?: string;
    } = {},
  ): RadarSighting {
    const capturedAgeMin = over.capturedAgeMin ?? 5;
    const minsSinceSeen = over.minsSinceSeen ?? 0;
    const seen = new Date(NOW - minsSinceSeen * 60_000).toISOString();
    return sighting(id, {
      band: over.band ?? 'sweep',
      signals: {
        views: over.views ?? 6000,
        replies: over.replies ?? 4,
        ageMin: capturedAgeMin,
        vpm: 100,
        bait: false,
      },
      firstSeenAt: seen,
      lastSeenAt: seen,
      ...(over.clickedAt ? { clickedAt: over.clickedAt } : {}),
    });
  }

  test('empty input returns an empty queue', () => {
    expect(cannonQueue([], NOW, T)).toEqual({ rows: [], hidden: 0 });
  });

  test('drops a row past maxAgeMin and counts it in hidden', () => {
    // 20 minutes old at capture + 10 minutes on the shelf = exactly 30 → in.
    const atCutoff = cannonSighting('at-cutoff', { capturedAgeMin: 20, minsSinceSeen: 10 });
    // One minute more → out, and the queue says so instead of just shrinking.
    const past = cannonSighting('past', { capturedAgeMin: 20, minsSinceSeen: 11 });
    const out = cannonQueue([atCutoff, past], NOW, T);
    expect(out.rows.map((r) => r.s.tweetId)).toEqual(['at-cutoff']);
    expect(out.hidden).toBe(1);
  });

  test('a cannon-band row below the score floor is still in (capture reason)', () => {
    // 300 / (10 + 1) ≈ 27 — nowhere near 120, but content.ts queued it for the
    // roster, and that reason does not expire when the numbers move.
    const roster = cannonSighting('camped', { band: 'cannon', views: 300, replies: 10 });
    const out = cannonQueue([roster], NOW, T);
    expect(out.rows.map((r) => r.s.tweetId)).toEqual(['camped']);
    expect(out.hidden).toBe(0);
  });

  test('a swept row above the floor is included without being re-banded', () => {
    const dense = cannonSighting('swept-1', { band: 'sweep', views: 5000, replies: 3 });
    const [row] = cannonQueue([dense], NOW, T).rows;
    expect(row?.s.tweetId).toBe('swept-1');
    expect(row?.s.band).toBe('sweep');
    expect(row?.score).toBeCloseTo(1250, 5);
  });

  test('a row under the floor and not cannon-banded never enters', () => {
    const quiet = cannonSighting('quiet', { band: 'sweep', views: 400, replies: 9 });
    expect(cannonQueue([quiet], NOW, T)).toEqual({ rows: [], hidden: 0 });
  });

  test('sorted by score desc, ties broken by the fresher sighting', () => {
    // Same score (1000/(4+1) = 200), different capture times.
    const older = cannonSighting('older', { views: 1000, replies: 4, minsSinceSeen: 8 });
    const fresher = cannonSighting('fresher', { views: 1000, replies: 4, minsSinceSeen: 2 });
    const loudest = cannonSighting('loudest', { views: 9000, replies: 4, minsSinceSeen: 9 });
    const out = cannonQueue([older, fresher, loudest], NOW, T);
    expect(out.rows.map((r) => r.s.tweetId)).toEqual(['loudest', 'fresher', 'older']);
  });

  test('tone flips to red past redAgeMin, not at it', () => {
    const at = cannonSighting('at', { capturedAgeMin: 15, minsSinceSeen: 0 });
    const past = cannonSighting('past', { capturedAgeMin: 15, minsSinceSeen: 1 });
    const out = cannonQueue([at, past], NOW, T);
    expect(out.rows.find((r) => r.s.tweetId === 'at')?.tone).toBe('ok');
    expect(out.rows.find((r) => r.s.tweetId === 'past')?.tone).toBe('red');
  });

  test('a clicked row never appears, and is not counted as aged out', () => {
    const clicked = cannonSighting('clicked', { clickedAt: '2026-08-05T11:59:00.000Z' });
    expect(cannonQueue([clicked], NOW, T)).toEqual({ rows: [], hidden: 0 });
  });
});

describe('displayAgeMin (CQ.5)', () => {
  const NOW = Date.parse('2026-08-05T12:00:00.000Z');

  test('capture age plus time on the shelf', () => {
    const s = sighting('1', {
      signals: { views: 10, replies: 0, ageMin: 12, vpm: 1, bait: false },
      lastSeenAt: new Date(NOW - 8 * 60_000).toISOString(),
    });
    expect(displayAgeMin(s, NOW)).toBeCloseTo(20, 5);
  });

  test('an unparseable lastSeenAt falls back to the capture age, never NaN', () => {
    const s = sighting('1', {
      signals: { views: 10, replies: 0, ageMin: 12, vpm: 1, bait: false },
      lastSeenAt: 'not a date',
    });
    expect(displayAgeMin(s, NOW)).toBe(12);
  });
});

describe('partitionForCurate (RC.4)', () => {
  test('manual pins are never scored; every other band is', () => {
    const fresh = [
      sighting('pin-1', { band: 'manual' }),
      sighting('sweep-1', { band: 'sweep' }),
      sighting('cannon-1', { band: 'cannon' }),
      // GT.8 roster rows ARE scored: they are in the queue for WHO posted them,
      // and whether the post is worth replying to is a different question.
      sighting('roster-1', { band: 'roster' }),
    ];
    const { pinned, scoreable, skipped } = partitionForCurate(fresh);
    expect(pinned.map((s) => s.tweetId)).toEqual(['pin-1']);
    expect(scoreable.map((s) => s.tweetId)).toEqual(['sweep-1', 'cannon-1', 'roster-1']);
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
      sighting('sweep-1'),
    ];
    const { pinned, scoreable, skipped } = partitionForCurate(fresh);
    expect(pinned).toEqual([]);
    expect(scoreable.map((s) => s.tweetId)).toEqual(['sweep-1']);
    expect(skipped.map((s) => s.tweetId)).toEqual(['img-1', 'img-2', 'pin-blank']);
  });

  test('the three buckets always sum to the input — a row can never vanish here', () => {
    const fresh = [
      sighting('a', { band: 'manual' }),
      sighting('b', { band: 'cannon' }),
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
    expect(isRadarSightings([sighting('1', { band: 'sweep' })])).toBe(true); // RS.2
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
    // RS.2 — a swept row survives a reload like every other band; a reader that
    // dropped it would silently empty the queue of everything the sweep caught.
    const swept = sighting('3', { band: 'sweep', likes: 12, verified: true });
    expect(coerceSightings([swept])).toEqual([swept]);
    // A session buffer written before the reply-band classifier was removed
    // still holds 'hot'/'warm' rows. They are folded onto 'sweep', not dropped:
    // an extension upgrade must not silently empty the working queue.
    for (const legacy of ['hot', 'warm']) {
      const old = { ...sighting('4'), band: legacy };
      expect(coerceSightings([old])).toEqual([{ ...sighting('4'), band: 'sweep' }]);
    }
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

  // RQ.3: the same number the server's `?queue=true` window uses. Asserted as
  // an identity, not as `24 * 60 * 60 * 1000` — a second literal here is exactly
  // the drift the move was meant to close.
  test('RADAR_TTL_MS is the shared RADAR_QUEUE_TTL_MS', () => {
    expect(RADAR_TTL_MS).toBe(RADAR_QUEUE_TTL_MS);
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
    band: 'sweep',
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
      band: 'sweep',
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
