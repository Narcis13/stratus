import { describe, expect, test } from 'bun:test';
import {
  DIGEST_PROMPT_TEMPLATE,
  buildDigestFacts,
  buildDigestInput,
  parseDigestNarrative,
  weekBounds,
} from './digest.ts';
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
  goals: null,
  guidance: { reply: null, post: null },
  rosterCoverage: buildRosterCoverage([], null),
  imageSpendUsd: 0,
  mediaVsText: buildMediaEffectiveness([]),
  // GR.9: a week nobody tracked — the gate keeps the scorecard null unless a
  // test says otherwise.
  scorecardInputs: {
    daysWithOriginal: 0,
    daysInWeek: 7,
    repliesTargetWeek: 0,
    targetReplyPct: 70,
    goalVerdicts: [],
    prevScore: null,
  },
};

/** Four tracked days = the minimum gradeable week (SCORECARD_MIN_DAYS). */
const FOUR_TRACKED_DAYS = [
  { day: '2026-06-29', allDone: true },
  { day: '2026-06-30', allDone: true },
  { day: '2026-07-01', allDone: false },
  { day: '2026-07-02', allDone: false },
];

describe('buildDigestFacts', () => {
  test('empty week produces nulls and zeros, never fabricated numbers', () => {
    const f = buildDigestFacts(BASE_INPUTS);
    expect(f.followers).toEqual({ start: null, end: null, delta: null });
    expect(f.conversion).toEqual({ profileClicks: 0, followerDelta: null, rate: null });
    expect(f.activity).toEqual({ posts: 0, replies: 0, replyPct: null });
    expect(f.topTweets).toEqual([]);
    expect(f.spend.totalUsd).toBe(0);
  });

  test('goals pass through verbatim; null when there are none (M1/ME.5)', () => {
    expect(buildDigestFacts(BASE_INPUTS).goals).toBeNull();
    const goals = [{ label: '5K MRR', unit: 'MRR', target: 5000, current: 800, pct: 16 }];
    const f = buildDigestFacts({ ...BASE_INPUTS, goals });
    expect(f.goals).toBe(goals);
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

  test('GR.9: the scorecard is null under the tracked-days gate, an object above it', () => {
    expect(buildDigestFacts(BASE_INPUTS).scorecard).toBeNull();
    // Three tracked days is still an ungradeable week…
    expect(
      buildDigestFacts({ ...BASE_INPUTS, streakDays: FOUR_TRACKED_DAYS.slice(0, 3) }).scorecard,
    ).toBeNull();
    // …the fourth day opens the gate.
    const f = buildDigestFacts({ ...BASE_INPUTS, streakDays: FOUR_TRACKED_DAYS });
    expect(f.scorecard?.sufficient).toBe(true);
    expect(f.scorecard?.daysTracked).toBe(4);
    expect(typeof f.scorecard?.score).toBe('number');
  });

  test('GR.9: the grade is computed from the facts it grades, never a second count', () => {
    const f = buildDigestFacts({
      ...BASE_INPUTS,
      streakDays: FOUR_TRACKED_DAYS,
      tweets: [
        { text: 'a', isReply: true, views: 10, profileVisits: 0 },
        { text: 'b', isReply: true, views: 10, profileVisits: 0 },
        { text: 'c', isReply: true, views: 10, profileVisits: 0 },
        { text: 'd', isReply: false, views: 10, profileVisits: 0 },
      ],
      scorecardInputs: {
        ...BASE_INPUTS.scorecardInputs,
        daysWithOriginal: 2,
        daysInWeek: 4,
        repliesTargetWeek: 4,
        targetReplyPct: 70,
        goalVerdicts: ['on_pace', 'behind'],
      },
    });
    // quests 2/4 · cadence 2/4 · replies 3/4 (the same `activity.replies` the
    // facts carry) · goals mean(80,40) · ratio 75% vs 70 → 100 − 5×2.
    expect(f.activity).toEqual({ posts: 1, replies: 3, replyPct: 75 });
    expect(f.scorecard?.components).toEqual({
      questAdherence: 50,
      cadenceConsistency: 50,
      replyQuota: 75,
      goalPacing: 60,
      ratioAdherence: 90,
    });
    // Weighted by SCORECARD_WEIGHTS (all five present → /100).
    expect(f.scorecard?.score).toBe(
      Math.round((50 * 30 + 50 * 20 + 75 * 25 + 60 * 15 + 90 * 10) / 100),
    );
  });

  test('GR.9: the previous-week delta exists only when last week was graded', () => {
    const graded = { ...BASE_INPUTS, streakDays: FOUR_TRACKED_DAYS };
    const alone = buildDigestFacts(graded);
    expect(alone.scorecard?.prevScore).toBeNull();
    expect(alone.scorecard?.delta).toBeNull();

    const compared = buildDigestFacts({
      ...graded,
      scorecardInputs: { ...BASE_INPUTS.scorecardInputs, prevScore: 40 },
    });
    expect(compared.scorecard?.prevScore).toBe(40);
    expect(compared.scorecard?.delta).toBe((compared.scorecard?.score ?? 0) - 40);
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

  test('AI.6: registry template renders byte-identical to the pre-registry shape', () => {
    const facts = buildDigestFacts(BASE_INPUTS);
    // The {{FACTS}} token sits at the exact tail that reproduces the old
    // `${prefix}\n\nFACTS:\n${json}` concatenation.
    expect(DIGEST_PROMPT_TEMPLATE.endsWith('\n\nFACTS:\n{{FACTS}}')).toBe(true);
    const factsJson = JSON.stringify(facts, null, 1);
    const [msg] = buildDigestInput(facts);
    expect(msg?.content).not.toContain('{{FACTS}}');
    expect(msg?.content).toBe(
      `${DIGEST_PROMPT_TEMPLATE.slice(0, -'{{FACTS}}'.length)}${factsJson}`,
    );
    // A custom override's {{FACTS}} substitutes too; a token-less one appends.
    expect(buildDigestInput(facts, 'HEAD {{FACTS}} TAIL')[0]?.content).toBe(
      `HEAD ${factsJson} TAIL`,
    );
    expect(buildDigestInput(facts, 'no token')[0]?.content).toBe(
      `no token\n\nFACTS:\n${factsJson}`,
    );
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
