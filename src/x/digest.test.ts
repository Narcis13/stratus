import { describe, expect, test } from 'bun:test';
import { buildDigestFacts, buildDigestInput, parseDigestNarrative, weekBounds } from './digest.ts';
import { buildMediaEffectiveness, buildRosterCoverage } from './playbook.ts';

const DAY_MS = 24 * 60 * 60 * 1000;

describe('weekBounds', () => {
  test('a Sunday belongs to the week that started the previous Monday', () => {
    // 2026-07-05 is a Sunday.
    const b = weekBounds(new Date('2026-07-05T15:00:00Z'), 0);
    expect(b.weekKey).toBe('2026-06-29');
    expect(b.start.toISOString()).toBe('2026-06-29T00:00:00.000Z');
    expect(b.end.getTime() - b.start.getTime()).toBe(7 * DAY_MS);
  });

  test('a Monday starts its own week', () => {
    expect(weekBounds(new Date('2026-06-29T00:00:00Z'), 0).weekKey).toBe('2026-06-29');
  });

  test('the local timezone decides which week an instant belongs to', () => {
    // 22:00 UTC Sunday is already Monday 01:00 in UTC+3 (offset -180).
    const late = new Date('2026-07-05T22:00:00Z');
    expect(weekBounds(late, 0).weekKey).toBe('2026-06-29');
    expect(weekBounds(late, -180).weekKey).toBe('2026-07-06');
    // The window is anchored to local midnight, expressed as a UTC instant.
    expect(weekBounds(late, -180).start.toISOString()).toBe('2026-07-05T21:00:00.000Z');
  });
});

const BASE_INPUTS = {
  weekKey: '2026-06-29',
  start: new Date('2026-06-29T00:00:00Z'),
  end: new Date('2026-07-06T00:00:00Z'),
  followerPoints: [],
  tweets: [],
  stageTransitions: [],
  fansThisWeek: [],
  fansPrevWeek: [],
  neglectedTargets: [],
  neglectedAllies: [],
  spendByPlatform: [],
  streakDays: [],
  guidance: { reply: null, post: null },
  rosterCoverage: buildRosterCoverage([], null),
  imageSpendUsd: 0,
  mediaVsText: buildMediaEffectiveness([]),
};

describe('buildDigestFacts', () => {
  test('empty week produces nulls and zeros, never fabricated numbers', () => {
    const f = buildDigestFacts(BASE_INPUTS);
    expect(f.followers).toEqual({ start: null, end: null, delta: null });
    expect(f.conversion).toEqual({ profileClicks: 0, followerDelta: null, rate: null });
    expect(f.activity).toEqual({ posts: 0, replies: 0, replyPct: null });
    expect(f.topTweets).toEqual([]);
    expect(f.spend.totalUsd).toBe(0);
  });

  test('roster coverage passes through verbatim (S0.7)', () => {
    const rc = buildRosterCoverage([50_000, 50_000], { min: 20_000, max: 100_000 }, 1);
    const f = buildDigestFacts({ ...BASE_INPUTS, rosterCoverage: rc });
    expect(f.rosterCoverage).toBe(rc);
    expect(f.rosterCoverage.majorityInBand).toBe(true);
  });

  test('follower delta needs two points', () => {
    const one = buildDigestFacts({
      ...BASE_INPUTS,
      followerPoints: [{ snapshotAt: new Date('2026-06-30T03:00:00Z'), followers: 500 }],
    });
    expect(one.followers.delta).toBeNull();
    const two = buildDigestFacts({
      ...BASE_INPUTS,
      followerPoints: [
        { snapshotAt: new Date('2026-06-30T03:00:00Z'), followers: 500 },
        { snapshotAt: new Date('2026-07-05T03:00:00Z'), followers: 527 },
      ],
    });
    expect(two.followers).toEqual({ start: 500, end: 527, delta: 27 });
  });

  test('conversion divides the week follower delta by summed profile clicks', () => {
    const f = buildDigestFacts({
      ...BASE_INPUTS,
      followerPoints: [
        { snapshotAt: new Date('2026-06-29T03:00:00Z'), followers: 500 },
        { snapshotAt: new Date('2026-07-05T03:00:00Z'), followers: 509 },
      ],
      tweets: [
        { text: 'a', isReply: false, views: 100, profileVisits: 200 },
        { text: 'b', isReply: true, views: 900, profileVisits: 112 },
        { text: 'unmeasured', isReply: false, views: null, profileVisits: null },
      ],
    });
    expect(f.conversion.profileClicks).toBe(312);
    expect(f.conversion.followerDelta).toBe(9);
    expect(f.conversion.rate).toBeCloseTo(9 / 312, 10);
  });

  test('conversion rate is gated null below 20 clicks', () => {
    const f = buildDigestFacts({
      ...BASE_INPUTS,
      followerPoints: [
        { snapshotAt: new Date('2026-06-29T03:00:00Z'), followers: 500 },
        { snapshotAt: new Date('2026-07-05T03:00:00Z'), followers: 509 },
      ],
      tweets: [{ text: 'a', isReply: false, views: 100, profileVisits: 5 }],
    });
    expect(f.conversion.profileClicks).toBe(5);
    expect(f.conversion.followerDelta).toBe(9);
    expect(f.conversion.rate).toBeNull();
  });

  test('top tweets are measured-only, ranked by views, capped at 3', () => {
    const f = buildDigestFacts({
      ...BASE_INPUTS,
      tweets: [
        { text: 'a', isReply: false, views: 100, profileVisits: 1 },
        { text: 'unmeasured', isReply: false, views: null, profileVisits: null },
        { text: 'b', isReply: true, views: 900, profileVisits: 4 },
        { text: 'c', isReply: false, views: 300, profileVisits: 2 },
        { text: 'd', isReply: true, views: 200, profileVisits: 0 },
      ],
    });
    expect(f.topTweets.map((t) => t.text)).toEqual(['b', 'c', 'd']);
    expect(f.activity).toEqual({ posts: 3, replies: 2, replyPct: 40 });
  });

  test('top fans flag newcomers vs the previous week', () => {
    const f = buildDigestFacts({
      ...BASE_INPUTS,
      fansThisWeek: [
        { handle: 'steady', inbound: 4 },
        { handle: 'newcomer', inbound: 3 },
      ],
      fansPrevWeek: [{ handle: 'steady', inbound: 2 }],
    });
    expect(f.topFans).toEqual([
      { handle: 'steady', inbound: 4, newThisWeek: false },
      { handle: 'newcomer', inbound: 3, newThisWeek: true },
    ]);
  });

  test('quest days count only all-done days', () => {
    const f = buildDigestFacts({
      ...BASE_INPUTS,
      streakDays: [
        { day: '2026-06-29', allDone: true },
        { day: '2026-06-30', allDone: false },
        { day: '2026-07-01', allDone: true },
      ],
    });
    expect(f.quests).toEqual({ daysAllDone: 2, daysTracked: 3 });
  });
});

describe('buildDigestInput', () => {
  test('facts ride at the tail and the no-invention rule is in the prefix', () => {
    const facts = buildDigestFacts({
      ...BASE_INPUTS,
      fansThisWeek: [{ handle: 'digest_fan_x', inbound: 2 }],
    });
    const [msg] = buildDigestInput(facts);
    expect(msg?.role).toBe('user');
    const content = msg?.content ?? '';
    expect(content).toContain('Never invent');
    expect(content.indexOf('FACTS:')).toBeGreaterThan(content.indexOf('Never invent'));
    expect(content.slice(content.indexOf('FACTS:'))).toContain('digest_fan_x');
  });
});

describe('parseDigestNarrative', () => {
  test('valid, empty, and malformed payloads', () => {
    expect(parseDigestNarrative('{"narrative":" A good week. "}')).toBe('A good week.');
    expect(parseDigestNarrative('{"narrative":""}')).toBeNull();
    expect(parseDigestNarrative('not json')).toBeNull();
    expect(parseDigestNarrative('{"other":"x"}')).toBeNull();
  });
});
