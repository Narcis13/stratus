import { describe, expect, test } from 'bun:test';
import {
  INBOUND_TYPES,
  OUTBOUND_TYPES,
  PERSON_EVENT_TYPES,
  type PersonEventType,
  type StageEvent,
  computeStage,
  exchangeDays,
  maxStage,
  stageRank,
} from './stage.ts';

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-07-02T12:00:00Z');

function ev(type: PersonEventType, daysAgo: number, hour = 10): StageEvent {
  const at = new Date(NOW.getTime() - daysAgo * DAY_MS);
  at.setUTCHours(hour, 0, 0, 0);
  return { type, at };
}

describe('computeStage matrix', () => {
  test('no events → stranger', () => {
    expect(computeStage([], NOW)).toBe('stranger');
  });

  test('timeline-only types never advance past stranger', () => {
    expect(
      computeStage([ev('harvest_seen', 3), ev('note', 2), ev('manual_dm_logged', 1)], NOW),
    ).toBe('stranger');
  });

  test('inbound alone (they mentioned me, I never engaged) stays stranger', () => {
    expect(computeStage([ev('their_mention', 5)], NOW)).toBe('stranger');
  });

  test.each(['saved_tweet', 'saved_author', 'hover_sighting'] as const)('%s → noticed', (type) => {
    expect(computeStage([ev(type, 2)], NOW)).toBe('noticed');
  });

  test('one my_reply → engaged', () => {
    expect(computeStage([ev('saved_tweet', 5), ev('my_reply', 2)], NOW)).toBe('engaged');
  });

  test('inbound BEFORE my first reply does not count as responded', () => {
    expect(computeStage([ev('their_mention', 5), ev('my_reply', 2)], NOW)).toBe('engaged');
  });

  test('inbound after my first reply → responded', () => {
    expect(computeStage([ev('my_reply', 5), ev('their_mention', 2)], NOW)).toBe('responded');
  });

  test('their_reply_to_me counts as inbound too', () => {
    expect(computeStage([ev('my_reply', 5), ev('their_reply_to_me', 2)], NOW)).toBe('responded');
  });

  test('2 distinct two-way exchange days → mutual', () => {
    const events = [
      ev('my_reply', 10, 9),
      ev('their_mention', 10, 11),
      ev('my_reply', 3, 9),
      ev('their_reply_to_me', 3, 15),
    ];
    expect(computeStage(events, NOW)).toBe('mutual');
  });

  test('inbound and outbound on DIFFERENT days is not an exchange day', () => {
    const events = [
      ev('my_reply', 10),
      ev('their_mention', 9),
      ev('my_reply', 4),
      ev('their_mention', 3),
    ];
    // responded (inbound after first reply) but zero same-day exchanges.
    expect(computeStage(events, NOW)).toBe('responded');
  });

  test('4 exchange days within 60d → ally', () => {
    const events = [0, 10, 25, 55].flatMap((d) => [
      ev('my_reply', d, 9),
      ev('their_mention', d, 12),
    ]);
    expect(computeStage(events, NOW)).toBe('ally');
  });

  test('4 exchange days spread past 60d stays mutual', () => {
    const events = [0, 30, 65, 100].flatMap((d) => [
      ev('my_reply', d, 9),
      ev('their_mention', d, 12),
    ]);
    expect(computeStage(events, NOW)).toBe('mutual');
  });

  test('a historical dense window earns ally even when old (ratchet semantics)', () => {
    const events = [100, 110, 120, 130].flatMap((d) => [
      ev('my_reply', d, 9),
      ev('their_mention', d, 12),
    ]);
    expect(computeStage(events, NOW)).toBe('ally');
  });

  // C10 decision 1: notification-harvested engagement is not reciprocity.
  test.each(['their_like', 'their_repost', 'their_follow'] as const)(
    '%s belongs to no stage set',
    (type) => {
      expect(PERSON_EVENT_TYPES).toContain(type);
      expect(INBOUND_TYPES).not.toContain(type);
      expect(OUTBOUND_TYPES).not.toContain(type);
      // Covers NOTICED_TYPES too (not exported): a lone engagement moves nothing.
      expect(computeStage([ev(type, 2)], NOW)).toBe('stranger');
    },
  );

  test('50 likes and a follow is still a stranger', () => {
    const events: StageEvent[] = [
      ...Array.from({ length: 50 }, (_, i) => ev('their_like', i % 30, 8)),
      ev('their_repost', 4),
      ev('their_follow', 1),
    ];
    expect(computeStage(events, NOW)).toBe('stranger');
  });

  test('engagement never lifts a real relationship either — mutual stays mutual', () => {
    const talked = [0, 5].flatMap((d) => [ev('my_reply', d, 9), ev('their_mention', d, 12)]);
    expect(computeStage(talked, NOW)).toBe('mutual');
    const withLikes = [...talked, ev('their_like', 1), ev('their_follow', 0)];
    // Neither promoted past mutual nor (via the caller's ratchet) demoted.
    expect(computeStage(withLikes, NOW)).toBe('mutual');
    expect(maxStage('mutual', computeStage([ev('their_like', 1)], NOW))).toBe('mutual');
  });

  test('future-dated events are ignored', () => {
    const future = { type: 'my_reply' as const, at: new Date(NOW.getTime() + DAY_MS) };
    expect(computeStage([future], NOW)).toBe('stranger');
  });
});

describe('exchangeDays', () => {
  test('returns sorted distinct day indices with both directions', () => {
    const events = [
      ev('my_reply', 3, 9),
      ev('their_mention', 3, 10),
      ev('my_reply', 3, 20), // same day, still one exchange day
      ev('their_mention', 1, 9), // inbound only — not an exchange day
    ];
    expect(exchangeDays(events)).toHaveLength(1);
  });
});

describe('stage ordering helpers', () => {
  test('ranks ascend stranger → ally', () => {
    expect(stageRank('stranger')).toBeLessThan(stageRank('noticed'));
    expect(stageRank('noticed')).toBeLessThan(stageRank('engaged'));
    expect(stageRank('engaged')).toBeLessThan(stageRank('responded'));
    expect(stageRank('responded')).toBeLessThan(stageRank('mutual'));
    expect(stageRank('mutual')).toBeLessThan(stageRank('ally'));
  });

  test('maxStage ratchets', () => {
    expect(maxStage('mutual', 'engaged')).toBe('mutual');
    expect(maxStage('engaged', 'mutual')).toBe('mutual');
    expect(maxStage('ally', 'stranger')).toBe('ally');
  });
});
