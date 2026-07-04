import { describe, expect, test } from 'bun:test';
import {
  type HoverCardData,
  type PersonSighting,
  SIGHTING_RESEND_MS,
  cardHasData,
  mergePendingSighting,
  shouldReportSighting,
} from './sightings.ts';

const card = (over: Partial<HoverCardData> = {}): HoverCardData => ({
  displayName: null,
  bio: null,
  followersCount: null,
  followingCount: null,
  xUserId: null,
  ...over,
});

const sighting = (seenAt: string, c: Partial<HoverCardData>): PersonSighting => ({
  handle: 'alice',
  seenAt,
  card: card(c),
});

describe('cardHasData', () => {
  test('all-null card is a skeleton', () => {
    expect(cardHasData(card())).toBe(false);
    expect(cardHasData(card({ followersCount: 0 }))).toBe(true);
    expect(cardHasData(card({ bio: 'x' }))).toBe(true);
  });
});

describe('mergePendingSighting', () => {
  test('no previous → incoming as-is', () => {
    const s = sighting('2026-07-04T10:00:00Z', { bio: 'b' });
    expect(mergePendingSighting(undefined, s)).toBe(s);
  });

  test('newer wins, null fields backfill from older (progressive card render)', () => {
    const older = sighting('2026-07-04T10:00:00Z', { bio: 'builds agents', followersCount: 500 });
    const newer = sighting('2026-07-04T10:00:02Z', { displayName: 'Alice', followersCount: 510 });
    const merged = mergePendingSighting(older, newer);
    expect(merged.seenAt).toBe('2026-07-04T10:00:02Z');
    expect(merged.card.followersCount).toBe(510);
    expect(merged.card.bio).toBe('builds agents');
    expect(merged.card.displayName).toBe('Alice');
  });

  test('out-of-order arrival: the stored newer entry survives an older incoming', () => {
    const newer = sighting('2026-07-04T10:00:02Z', { followersCount: 510 });
    const older = sighting('2026-07-04T10:00:00Z', { bio: 'late parse', followersCount: 500 });
    const merged = mergePendingSighting(newer, older);
    expect(merged.seenAt).toBe('2026-07-04T10:00:02Z');
    expect(merged.card.followersCount).toBe(510);
    expect(merged.card.bio).toBe('late parse'); // still backfills
  });
});

describe('shouldReportSighting', () => {
  test('never sent → report', () => {
    expect(shouldReportSighting(undefined, 1_000_000)).toBe(true);
  });

  test('inside the resend window → suppressed; at/after → report', () => {
    const sent = 1_000_000;
    expect(shouldReportSighting(sent, sent + SIGHTING_RESEND_MS - 1)).toBe(false);
    expect(shouldReportSighting(sent, sent + SIGHTING_RESEND_MS)).toBe(true);
  });
});
