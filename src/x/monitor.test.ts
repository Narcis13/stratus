// GR.5 activity monitor — pure rules. No DB, no clock: every fn takes the rows
// plus `now`, so the whole threshold matrix is table-driven. What matters here
// is the BOUNDARIES: a monitor that cries wolf gets ignored, and one that fires
// a post too late has already let the risk happen.

import { describe, expect, test } from 'bun:test';
import { DAILY_CEILING } from './connections.ts';
import {
  type MonitorAlert,
  type MonitorPost,
  type MonitorSlot,
  NEAR_DUPLICATE_THRESHOLD,
  POST_BURST_MAX,
  REPLY_BURST_CRITICAL,
  REPLY_BURST_WARN,
  SCHEDULE_CLUSTER_MS,
  UNFOLLOW_CHURN_WARN,
  nearDuplicate,
  normalizeForShingles,
  postBurst,
  replyBurst,
  runMonitor,
  scheduleCluster,
  shingleJaccard,
  unfollowChurn,
  worstOf,
} from './monitor.ts';

const MIN_MS = 60_000;
const HOUR_MS = 60 * MIN_MS;
const NOW = new Date('2026-07-23T18:00:00.000Z');

function minsAgo(n: number): Date {
  return new Date(NOW.getTime() - n * MIN_MS);
}

function post(tweetId: string, minutes: number, text = `post ${tweetId}`): MonitorPost {
  return { tweetId, text, postedAt: minsAgo(minutes) };
}

function slot(id: string, minutesFromNow: number): MonitorSlot {
  return { id, scheduledFor: new Date(NOW.getTime() + minutesFromNow * MIN_MS) };
}

/** n pastes spread `stepMin` apart, the most recent `endMinsAgo` minutes back. */
function pastes(n: number, stepMin: number, endMinsAgo = 0): Date[] {
  return Array.from({ length: n }, (_, i) => minsAgo(endMinsAgo + i * stepMin));
}

function marks(n: number, minutesAgo: number): Date[] {
  return Array.from({ length: n }, () => minsAgo(minutesAgo));
}

describe('postBurst', () => {
  // Spaced an hour apart so only the volume condition is in play.
  const spread = (n: number) => Array.from({ length: n }, (_, i) => post(`p${i}`, 60 * (i + 1)));

  test(`${POST_BURST_MAX} originals in 24h is quiet, ${POST_BURST_MAX + 1} warns`, () => {
    expect(postBurst(spread(POST_BURST_MAX), NOW)).toBeNull();
    const alert = postBurst(spread(POST_BURST_MAX + 1), NOW);
    expect(alert?.severity).toBe('warn');
    expect(alert?.evidence.count24h).toBe(POST_BURST_MAX + 1);
    // Volume only — no pair was close enough to name.
    expect(alert?.evidence.closestPair).toBeUndefined();
  });

  test('originals older than 24h do not count', () => {
    const rows = [...spread(POST_BURST_MAX), post('old', 25 * 60)];
    expect(postBurst(rows, NOW)).toBeNull();
  });

  test('two originals inside 20 min warn on their own', () => {
    const alert = postBurst([post('a', 40), post('b', 28)], NOW);
    expect(alert?.severity).toBe('warn');
    expect(alert?.evidence.closestPairMin).toBe(12);
    expect(alert?.evidence.closestPair).toEqual(['a', 'b']);
    expect(alert?.evidence.count24h).toBe(2);
  });

  test('exactly 20 min apart is not a burst (strictly-closer rule)', () => {
    expect(postBurst([post('a', 40), post('b', 20)], NOW)).toBeNull();
    expect(postBurst([post('a', 41), post('b', 20)], NOW)).toBeNull();
  });

  test('both conditions land in one alert, closest pair wins', () => {
    // The spread sits at 60..300 min ago; this pair is well clear of it.
    const rows = [...spread(POST_BURST_MAX + 1), post('x', 421), post('y', 418)];
    const alert = postBurst(rows, NOW);
    expect(alert?.evidence.closestPairMin).toBe(3);
    expect(alert?.evidence.closestPair).toEqual(['x', 'y']);
    expect(alert?.message).toContain('originals in the last 24h');
    expect(alert?.message).toContain('3 min apart');
  });
});

describe('replyBurst', () => {
  test(`${REPLY_BURST_WARN} pastes in an hour is quiet, ${REPLY_BURST_WARN + 1} warns`, () => {
    expect(replyBurst(pastes(REPLY_BURST_WARN, 5), NOW)).toBeNull();
    const alert = replyBurst(pastes(REPLY_BURST_WARN + 1, 5), NOW);
    expect(alert?.severity).toBe('warn');
    expect(alert?.evidence.peakPerHour).toBe(REPLY_BURST_WARN + 1);
  });

  test(`${REPLY_BURST_CRITICAL + 1} in an hour is critical`, () => {
    expect(replyBurst(pastes(REPLY_BURST_CRITICAL, 3), NOW)?.severity).toBe('warn');
    expect(replyBurst(pastes(REPLY_BURST_CRITICAL + 1, 3), NOW)?.severity).toBe('critical');
  });

  test('the same replies spread over three hours never fill an hour', () => {
    expect(replyBurst(pastes(REPLY_BURST_WARN + 1, 16), NOW)).toBeNull();
  });

  test('a burst that ended two hours ago still fires (the lookback tail)', () => {
    const alert = replyBurst(pastes(REPLY_BURST_WARN + 2, 2, 120), NOW);
    expect(alert?.severity).toBe('warn');
    expect(alert?.evidence.peakEndedAt).toBe(minsAgo(120).toISOString());
  });

  test('pastes older than the lookback are dropped', () => {
    const stale = Array.from({ length: 20 }, () => new Date(NOW.getTime() - 4 * HOUR_MS));
    expect(replyBurst(stale, NOW)).toBeNull();
  });
});

describe('shingleJaccard', () => {
  test('identical text is 1', () => {
    expect(shingleJaccard('ship the boring version first', 'ship the boring version first')).toBe(
      1,
    );
  });

  test('URLs, handles, case and punctuation are normalized away', () => {
    expect(normalizeForShingles('Ship it — TODAY! https://x.com/a @alice 🚀')).toEqual([
      'ship',
      'it',
      'today',
    ]);
    expect(shingleJaccard('Ship it, today!', 'ship it today https://example.com @bob')).toBe(1);
  });

  test('nothing in common is 0, and empty text never matches', () => {
    expect(shingleJaccard('alpha bravo charlie', 'delta echo foxtrot')).toBe(0);
    expect(shingleJaccard('', 'alpha bravo charlie')).toBe(0);
    expect(shingleJaccard('  🚀  ', 'alpha bravo charlie')).toBe(0);
  });

  test('a post shorter than the shingle size is its own shingle', () => {
    expect(shingleJaccard('gm', 'gm')).toBe(1);
    expect(shingleJaccard('gm', 'gn')).toBe(0);
  });
});

describe('nearDuplicate', () => {
  // 11 words → 9 shingles; swapping the last word shares 8 of 10 → exactly 0.80.
  const ELEVEN = 'alpha bravo charlie delta echo foxtrot golf hotel india juliett kilo';
  const ELEVEN_SWAPPED = 'alpha bravo charlie delta echo foxtrot golf hotel india juliett lima';
  // 10 words → 8 shingles; the same swap shares 7 of 9 → 0.78.
  const TEN = 'alpha bravo charlie delta echo foxtrot golf hotel india juliett';
  const TEN_SWAPPED = 'alpha bravo charlie delta echo foxtrot golf hotel india mike';

  test('the fixtures really do straddle the threshold', () => {
    expect(shingleJaccard(ELEVEN, ELEVEN_SWAPPED)).toBeCloseTo(0.8, 10);
    expect(shingleJaccard(TEN, TEN_SWAPPED)).toBeCloseTo(7 / 9, 10);
    expect(7 / 9).toBeLessThan(NEAR_DUPLICATE_THRESHOLD);
  });

  test('at the threshold it fires, just below it stays silent', () => {
    const fires = nearDuplicate(
      [post('a', 10, ELEVEN), post('b', 4000, ELEVEN_SWAPPED)],
      NOW,
    ) as MonitorAlert;
    expect(fires.severity).toBe('warn');
    expect(fires.evidence.pairCount).toBe(1);
    expect(fires.evidence.pairs).toEqual([{ a: 'a', b: 'b', similarity: 0.8 }]);

    expect(nearDuplicate([post('a', 10, TEN), post('b', 4000, TEN_SWAPPED)], NOW)).toBeNull();
  });

  test('a duplicate outside the 14-day window is not a duplicate', () => {
    const rows = [post('a', 10, ELEVEN), post('b', 15 * 24 * 60, ELEVEN)];
    expect(nearDuplicate(rows, NOW)).toBeNull();
  });

  test('pairs are counted in full and listed most-similar first', () => {
    const rows = [
      post('exact1', 10, ELEVEN),
      post('exact2', 20, ELEVEN),
      post('near', 30, ELEVEN_SWAPPED),
      post('other', 40, 'a completely different sentence about nothing at all'),
    ];
    const alert = nearDuplicate(rows, NOW) as MonitorAlert;
    // exact1↔exact2 (1.0) plus each exact against `near` (0.8) = 3 pairs.
    expect(alert.evidence.pairCount).toBe(3);
    const pairs = alert.evidence.pairs as { similarity: number }[];
    expect(pairs[0]?.similarity).toBe(1);
    expect(alert.message).toContain('3 near-duplicate pairs');
  });
});

describe('unfollowChurn', () => {
  test(`${UNFOLLOW_CHURN_WARN - 1} marks is quiet, ${UNFOLLOW_CHURN_WARN} warns`, () => {
    expect(unfollowChurn(marks(UNFOLLOW_CHURN_WARN - 1, 60), NOW)).toBeNull();
    const alert = unfollowChurn(marks(UNFOLLOW_CHURN_WARN, 60), NOW);
    expect(alert?.severity).toBe('warn');
    expect(alert?.evidence.count).toBe(UNFOLLOW_CHURN_WARN);
    expect(alert?.evidence.dailyCeiling).toBe(DAILY_CEILING);
  });

  test(`${DAILY_CEILING - 1} still warns, ${DAILY_CEILING} is critical`, () => {
    expect(unfollowChurn(marks(DAILY_CEILING - 1, 60), NOW)?.severity).toBe('warn');
    expect(unfollowChurn(marks(DAILY_CEILING, 60), NOW)?.severity).toBe('critical');
  });

  test('marks older than 24h fall out of the window', () => {
    expect(unfollowChurn(marks(DAILY_CEILING, 25 * 60), NOW)).toBeNull();
  });
});

describe('scheduleCluster', () => {
  test('44 min apart is advice, 45 and 46 are not', () => {
    const alert = scheduleCluster([slot('a', 60), slot('b', 104)]);
    expect(alert?.severity).toBe('info');
    expect(alert?.evidence.pairs).toEqual([{ a: 'a', b: 'b', gapMin: 44 }]);
    expect(scheduleCluster([slot('a', 60), slot('b', 105)])).toBeNull();
    expect(scheduleCluster([slot('a', 60), slot('b', 106)])).toBeNull();
  });

  test('unsorted input still finds the clusters, and every pair is counted', () => {
    const alert = scheduleCluster([slot('c', 200), slot('a', 60), slot('b', 90), slot('d', 220)]);
    expect(alert?.evidence.clusterCount).toBe(2);
    expect(alert?.evidence.pairs).toEqual([
      { a: 'a', b: 'b', gapMin: 30 },
      { a: 'c', b: 'd', gapMin: 20 },
    ]);
  });

  test(`slots ${SCHEDULE_CLUSTER_MS / MIN_MS}+ min apart are silent`, () => {
    expect(scheduleCluster([slot('a', 60), slot('b', 180), slot('c', 300)])).toBeNull();
    expect(scheduleCluster([])).toBeNull();
  });
});

describe('worstOf', () => {
  const a = (severity: MonitorAlert['severity']): MonitorAlert => ({
    rule: 'postBurst',
    severity,
    message: '',
    evidence: {},
  });

  test('no alerts means no severity', () => {
    expect(worstOf([])).toBeNull();
  });

  test('the loudest one wins regardless of order', () => {
    expect(worstOf([a('info'), a('warn')])).toBe('warn');
    expect(worstOf([a('critical'), a('info')])).toBe('critical');
    expect(worstOf([a('info'), a('critical'), a('warn')])).toBe('critical');
  });
});

describe('runMonitor', () => {
  test('clean behaviour produces no alerts at all', () => {
    expect(
      runMonitor({
        now: NOW,
        originals: [post('a', 60), post('b', 400)],
        replyPastedAts: pastes(6, 20),
        unfollowMarks: marks(3, 120),
        pendingSlots: [slot('s1', 60), slot('s2', 300)],
      }),
    ).toEqual([]);
  });

  test('every rule can fire at once, most severe first, one alert per rule', () => {
    const alerts = runMonitor({
      now: NOW,
      originals: [
        post('p1', 5, 'alpha bravo charlie delta echo foxtrot golf hotel india juliett kilo'),
        post('p2', 12, 'alpha bravo charlie delta echo foxtrot golf hotel india juliett lima'),
        post('p3', 40),
        post('p4', 200),
        post('p5', 400),
      ],
      replyPastedAts: pastes(REPLY_BURST_CRITICAL + 1, 3),
      unfollowMarks: marks(UNFOLLOW_CHURN_WARN, 90),
      pendingSlots: [slot('s1', 60), slot('s2', 80)],
    });
    expect(alerts.map((x) => x.rule)).toEqual([
      'replyBurst',
      'postBurst',
      'nearDuplicate',
      'unfollowChurn',
      'scheduleCluster',
    ]);
    expect(alerts[0]?.severity).toBe('critical');
    expect(new Set(alerts.map((x) => x.rule)).size).toBe(alerts.length);
    expect(worstOf(alerts)).toBe('critical');
  });
});
