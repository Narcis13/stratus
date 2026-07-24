// C5 follow-up engine: classifier matrix, momentum inflection, band entry,
// fan ranking — all pure, fixed `now`.

import { describe, expect, test } from 'bun:test';
import {
  type ChainInbound,
  type ClassifyInputs,
  type FollowerPoint,
  type FollowupPerson,
  type MomentumCandidate,
  type ReupCandidate,
  aboutToEnterBand,
  classifyFollowups,
  fanUnacknowledged,
  followupKey,
  momentumInflection,
  pickReupCandidate,
  rankFans,
  reupKey,
} from './followups.ts';

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const NOW = new Date('2026-07-04T12:00:00Z');

function daysAgo(d: number): Date {
  return new Date(NOW.getTime() - d * DAY_MS);
}

function person(handle: string, over: Partial<FollowupPerson> = {}): FollowupPerson {
  return {
    handle,
    displayName: null,
    stage: 'stranger',
    stageUpdatedAt: null,
    lastInboundAt: null,
    lastOutboundAt: null,
    ...over,
  };
}

function chain(handle: string, hoursAgo: number, tweetId = `t_${handle}`): ChainInbound {
  return {
    handle,
    displayName: null,
    tweetId,
    text: 'they replied',
    postedAt: new Date(NOW.getTime() - hoursAgo * HOUR_MS),
    url: `https://x.com/${handle}/status/${tweetId}`,
  };
}

function inputs(over: Partial<ClassifyInputs> = {}): ClassifyInputs {
  return {
    now: NOW,
    chainInbound: [],
    people: [],
    targetHandles: new Set(),
    momentum: [],
    snoozes: new Map(),
    ...over,
  };
}

describe('classifyFollowups', () => {
  test('chain_live: inbound reply to my reply <24h, oldest debt first; ≥24h drops', () => {
    const { items } = classifyFollowups(
      inputs({ chainInbound: [chain('fresh', 2), chain('older', 20), chain('stale', 25)] }),
    );
    expect(items.map((i) => `${i.kind}:${i.handle}`)).toEqual([
      'chain_live:older',
      'chain_live:fresh',
    ]);
    expect(items[0]?.tweetId).toBe('t_older');
    expect(items[0]?.url).toContain('/status/t_older');
  });

  test('dm_ready: responded/mutual with a recent stage change; engaged and old changes do not fire', () => {
    const { items } = classifyFollowups(
      inputs({
        people: [
          person('just_responded', { stage: 'responded', stageUpdatedAt: daysAgo(1) }),
          person('just_mutual', { stage: 'mutual', stageUpdatedAt: daysAgo(3) }),
          person('old_mutual', {
            stage: 'mutual',
            stageUpdatedAt: daysAgo(10),
            // Recent exchange so it doesn't classify as neglected_ally instead.
            lastInboundAt: daysAgo(2),
          }),
          person('just_engaged', { stage: 'engaged', stageUpdatedAt: daysAgo(1) }),
          person('no_stamp', { stage: 'responded', stageUpdatedAt: null }),
        ],
      }),
    );
    // Freshest advance first.
    expect(items.map((i) => `${i.kind}:${i.handle}`)).toEqual([
      'dm_ready:just_responded',
      'dm_ready:just_mutual',
    ]);
  });

  test('neglected_target: roster ∩ people, outbound >7d or never (never first)', () => {
    const { items } = classifyFollowups(
      inputs({
        people: [
          person('never', {}),
          person('cold', { lastOutboundAt: daysAgo(10) }),
          person('warm', { lastOutboundAt: daysAgo(2) }),
          person('not_target', { lastOutboundAt: daysAgo(30) }),
        ],
        targetHandles: new Set(['never', 'cold', 'warm']),
      }),
    );
    expect(items.map((i) => `${i.kind}:${i.handle}`)).toEqual([
      'neglected_target:never',
      'neglected_target:cold',
    ]);
    expect(items[0]?.reason).toContain('never replied');
  });

  test('neglected_ally: stage ≥ mutual with no exchange either way in 14d', () => {
    const { items } = classifyFollowups(
      inputs({
        people: [
          person('quiet_ally', {
            stage: 'ally',
            lastInboundAt: daysAgo(40),
            lastOutboundAt: daysAgo(20),
          }),
          person('quiet_mutual', { stage: 'mutual', lastOutboundAt: daysAgo(15) }),
          person('active_ally', { stage: 'ally', lastInboundAt: daysAgo(3) }),
          person('quiet_responded', { stage: 'responded', lastOutboundAt: daysAgo(60) }),
        ],
      }),
    );
    // Oldest exchange first: quiet_mutual's last exchange (15d) is more recent
    // than quiet_ally's (20d).
    expect(items.map((i) => `${i.kind}:${i.handle}`)).toEqual([
      'neglected_ally:quiet_ally',
      'neglected_ally:quiet_mutual',
    ]);
    expect(items[0]?.reason).toContain('no exchange in 20d');
  });

  test('momentum: only flagged candidates, hottest first, at the queue tail', () => {
    const cand = (handle: string, over: Partial<MomentumCandidate>): MomentumCandidate => ({
      handle,
      displayName: null,
      stage: null,
      followersCount: 1000,
      inflection: null,
      enteringBand: false,
      latestCapturedAt: daysAgo(1),
      ...over,
    });
    const { items } = classifyFollowups(
      inputs({
        chainInbound: [chain('chainy', 1)],
        momentum: [
          cand('slow', {
            inflection: {
              weeklyRatePct: 6,
              prevWeeklyRatePct: 1,
              fromFollowers: 900,
              toFollowers: 1000,
              segmentDays: 7,
            },
          }),
          cand('hot', {
            inflection: {
              weeklyRatePct: 12,
              prevWeeklyRatePct: null,
              fromFollowers: 900,
              toFollowers: 1000,
              segmentDays: 7,
            },
          }),
          cand('band_only', { enteringBand: true }),
          cand('unflagged', {}),
        ],
      }),
    );
    expect(items.map((i) => `${i.kind}:${i.handle}`)).toEqual([
      'chain_live:chainy',
      'momentum:hot',
      'momentum:slow',
      'momentum:band_only',
    ]);
    expect(items.find((i) => i.handle === 'band_only')?.reason).toContain('2–10x band');
  });

  test('kind priority holds: chain > dm_ready > neglected_target > neglected_ally', () => {
    const { items } = classifyFollowups(
      inputs({
        chainInbound: [chain('c', 1)],
        people: [
          person('d', { stage: 'mutual', stageUpdatedAt: daysAgo(1) }),
          person('t', { lastOutboundAt: daysAgo(10) }),
          person('a', { stage: 'ally', lastOutboundAt: daysAgo(30) }),
        ],
        targetHandles: new Set(['t']),
      }),
    );
    expect(items.map((i) => i.kind)).toEqual([
      'chain_live',
      'dm_ready',
      'neglected_target',
      'neglected_ally',
    ]);
  });

  test('one item per person: the highest-priority kind wins', () => {
    // Same person is dm_ready AND a neglected target AND a neglected ally.
    const { items } = classifyFollowups(
      inputs({
        people: [
          person('multi', {
            stage: 'mutual',
            stageUpdatedAt: daysAgo(1),
            lastOutboundAt: daysAgo(20),
          }),
        ],
        targetHandles: new Set(['multi']),
      }),
    );
    expect(items).toHaveLength(1);
    expect(items[0]?.kind).toBe('dm_ready');
  });

  test('snooze hides exactly that (kind, handle) and is counted; expired snoozes are ignored', () => {
    const base = inputs({
      chainInbound: [chain('c', 1)],
      people: [person('d', { stage: 'responded', stageUpdatedAt: daysAgo(1) })],
    });

    const active = classifyFollowups({
      ...base,
      snoozes: new Map([[followupKey('chain_live', 'c'), new Date(NOW.getTime() + HOUR_MS)]]),
    });
    expect(active.items.map((i) => i.handle)).toEqual(['d']);
    expect(active.snoozed).toBe(1);

    const expired = classifyFollowups({
      ...base,
      snoozes: new Map([[followupKey('chain_live', 'c'), new Date(NOW.getTime() - HOUR_MS)]]),
    });
    expect(expired.items.map((i) => i.handle)).toEqual(['c', 'd']);
    expect(expired.snoozed).toBe(0);
  });

  test('a snoozed high-priority item does not hide the same person entirely', () => {
    // multi is dm_ready (snoozed) and a neglected target — the target item shows.
    const { items, snoozed } = classifyFollowups(
      inputs({
        people: [
          person('multi', {
            stage: 'mutual',
            stageUpdatedAt: daysAgo(1),
            lastOutboundAt: daysAgo(20),
          }),
        ],
        targetHandles: new Set(['multi']),
        snoozes: new Map([[followupKey('dm_ready', 'multi'), new Date(NOW.getTime() + HOUR_MS)]]),
      }),
    );
    expect(snoozed).toBe(1);
    expect(items.map((i) => i.kind)).toEqual(['neglected_target']);
  });

  // UI.3: the four windows are a settings-backed second param (the route reads
  // the `followups` group and passes them). Defaults match the constants above.
  test('honors custom windows: a narrower neglectedAllyDays drops a quiet ally', () => {
    const quiet = [person('ally20', { stage: 'ally', lastOutboundAt: daysAgo(20) })];
    // 20d quiet — neglected at the default 14d window.
    expect(classifyFollowups(inputs({ people: quiet })).items.map((i) => i.kind)).toEqual([
      'neglected_ally',
    ]);
    // Widen the window to 21d and the same ally is no longer neglected.
    const wide = classifyFollowups(inputs({ people: quiet }), {
      chainLiveMaxAgeMs: DAY_MS,
      dmReadyWindowMs: 7 * DAY_MS,
      neglectedTargetDays: 7,
      neglectedAllyDays: 21,
    });
    expect(wide.items).toEqual([]);
  });

  test('honors custom windows: chain-live and neglected-target windows widen together', () => {
    const res = classifyFollowups(
      inputs({
        chainInbound: [chain('c', 30)], // 30h old — past the default 24h chain window
        people: [person('t', { lastOutboundAt: daysAgo(8) })],
        targetHandles: new Set(['t']),
      }),
      {
        chainLiveMaxAgeMs: 48 * HOUR_MS, // now 30h counts
        dmReadyWindowMs: 7 * DAY_MS,
        neglectedTargetDays: 14, // now the 8-day-cold target does NOT
        neglectedAllyDays: 14,
      },
    );
    expect(res.items.map((i) => `${i.kind}:${i.handle}`)).toEqual(['chain_live:c']);
  });
});

describe('pickReupCandidate', () => {
  const cand = (tweetId: string, views: number, daysOld: number): ReupCandidate => ({
    tweetId,
    views,
    postedAt: daysAgo(daysOld),
  });

  test('empty in → null, snoozed 0', () => {
    expect(pickReupCandidate([], new Map(), NOW)).toEqual({ item: null, snoozed: 0 });
  });

  test('picks the single highest-views candidate, formats a re-up line', () => {
    const { item, snoozed } = pickReupCandidate(
      [cand('1001', 800, 20), cand('1002', 4200, 21), cand('1003', 1200, 30)],
      new Map(),
      NOW,
    );
    expect(snoozed).toBe(0);
    expect(item?.kind).toBe('reup_candidate');
    expect(item?.tweetId).toBe('1002');
    expect(item?.handle).toBe('');
    expect(item?.url).toBe('https://x.com/i/web/status/1002');
    expect(item?.reason).toContain('4.2k views');
    expect(item?.reason).toContain('quote-tweet re-up');
  });

  test('a snoozed candidate is skipped and counted; the next best surfaces', () => {
    const snoozes = new Map([[reupKey('1002'), new Date(NOW.getTime() + DAY_MS)]]);
    const { item, snoozed } = pickReupCandidate(
      [cand('1001', 800, 20), cand('1002', 4200, 21)],
      snoozes,
      NOW,
    );
    expect(snoozed).toBe(1);
    expect(item?.tweetId).toBe('1001');
  });

  test('an expired snooze does not hide the candidate', () => {
    const snoozes = new Map([[reupKey('1002'), new Date(NOW.getTime() - DAY_MS)]]);
    const { item, snoozed } = pickReupCandidate([cand('1002', 4200, 21)], snoozes, NOW);
    expect(snoozed).toBe(0);
    expect(item?.tweetId).toBe('1002');
  });

  test('ties on views break to the newer post, then tweetId', () => {
    const { item } = pickReupCandidate(
      [cand('1001', 1000, 30), cand('1002', 1000, 15)],
      new Map(),
      NOW,
    );
    expect(item?.tweetId).toBe('1002'); // newer wins the tie
  });
});

describe('momentumInflection', () => {
  const pt = (d: number, f: number): FollowerPoint => ({
    capturedAt: daysAgo(d),
    followersCount: f,
  });

  test('needs ≥2 points and a recent segment spanning ≥3 days', () => {
    expect(momentumInflection([pt(1, 1000)], NOW)).toBeNull();
    // Two points 4 hours apart — no ≥3d base to measure against.
    expect(
      momentumInflection(
        [
          { capturedAt: new Date(NOW.getTime() - 4 * HOUR_MS), followersCount: 900 },
          { capturedAt: new Date(NOW.getTime() - 1 * HOUR_MS), followersCount: 1000 },
        ],
        NOW,
      ),
    ).toBeNull();
  });

  test('flags ≥5%/week with no prior segment (new trend)', () => {
    // +10% over 7 days = +10%/wk.
    const inf = momentumInflection([pt(8, 1000), pt(1, 1100)], NOW);
    expect(inf).not.toBeNull();
    expect(inf?.weeklyRatePct).toBe(10);
    expect(inf?.prevWeeklyRatePct).toBeNull();
  });

  test('below 5%/week is not an inflection', () => {
    expect(momentumInflection([pt(8, 1000), pt(1, 1030)], NOW)).toBeNull();
  });

  test('acceleration required: fast recent beats slow prior, deceleration is null', () => {
    // Prior: +2%/wk over 14d; recent: +10%/wk over 7d → inflected.
    const up = momentumInflection([pt(22, 960), pt(8, 1000), pt(1, 1100)], NOW);
    expect(up).not.toBeNull();
    expect(up?.prevWeeklyRatePct).not.toBeNull();
    // Prior: +20%/wk; recent: +10%/wk → decelerating, no flag.
    const down = momentumInflection([pt(22, 600), pt(8, 1000), pt(1, 1100)], NOW);
    expect(down).toBeNull();
  });

  test('a stale series (latest point >30d old) never flags', () => {
    expect(momentumInflection([pt(45, 1000), pt(35, 1200)], NOW)).toBeNull();
  });

  test('honors a custom weeklyPctThreshold (UI.3 momentumWeeklyPct)', () => {
    // +6%/wk clears the default 5% but not a stricter 8% bar.
    const series = [pt(8, 1000), pt(1, 1060)];
    expect(momentumInflection(series, NOW)).not.toBeNull();
    expect(momentumInflection(series, NOW, { weeklyPctThreshold: 8 })).toBeNull();
    // A looser 2% bar flags a segment the default would reject.
    expect(momentumInflection([pt(8, 1000), pt(1, 1030)], NOW)).toBeNull();
    expect(
      momentumInflection([pt(8, 1000), pt(1, 1030)], NOW, { weeklyPctThreshold: 2 }),
    ).not.toBeNull();
  });
});

describe('aboutToEnterBand', () => {
  // My 1000 followers → band starts at 2000.
  test('below the band and on pace to cross within 30d', () => {
    expect(aboutToEnterBand(1800, 10, 1000)).toBe(true); // 1800 + 300 ≥ 2000
    expect(aboutToEnterBand(1500, 10, 1000)).toBe(false); // 1500 + 300 < 2000
  });

  test('already in (or above) the band, or not growing → false', () => {
    expect(aboutToEnterBand(2500, 50, 1000)).toBe(false);
    expect(aboutToEnterBand(1900, 0, 1000)).toBe(false);
    expect(aboutToEnterBand(1900, null, 1000)).toBe(false);
    expect(aboutToEnterBand(1900, -5, 1000)).toBe(false);
  });
});

describe('fans', () => {
  test('rankFans: inbound count desc, latest inbound breaks ties, handle stabilizes', () => {
    const ranked = rankFans([
      { handle: 'b', inboundCount: 3, lastInboundAt: daysAgo(5), lastOutboundAt: null },
      { handle: 'a', inboundCount: 3, lastInboundAt: daysAgo(1), lastOutboundAt: null },
      { handle: 'c', inboundCount: 9, lastInboundAt: daysAgo(20), lastOutboundAt: null },
      { handle: 'd', inboundCount: 3, lastInboundAt: daysAgo(1), lastOutboundAt: null },
    ]);
    expect(ranked.map((f) => f.handle)).toEqual(['c', 'a', 'd', 'b']);
  });

  test('fanUnacknowledged: never replied or >7d since my last outbound', () => {
    const fan = (lastOutboundAt: Date | null) => ({
      handle: 'f',
      inboundCount: 1,
      lastInboundAt: daysAgo(1),
      lastOutboundAt,
    });
    expect(fanUnacknowledged(fan(null), NOW)).toBe(true);
    expect(fanUnacknowledged(fan(daysAgo(8)), NOW)).toBe(true);
    expect(fanUnacknowledged(fan(daysAgo(3)), NOW)).toBe(false);
    // UI.3: a custom fanUnacknowledgedDays window moves the boundary.
    expect(fanUnacknowledged(fan(daysAgo(3)), NOW, 2)).toBe(true);
    expect(fanUnacknowledged(fan(daysAgo(8)), NOW, 14)).toBe(false);
  });
});
