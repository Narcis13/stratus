import { describe, expect, test } from 'bun:test';
import {
  HAND_SWEEP_MINUTES,
  type HandSweepSession,
  handSweepActiveAt,
  handSweepCountLabel,
  handSweepDateLabel,
  handSweepMinutesLeft,
  handSweepTargetFor,
  pageInHandSweep,
  parseHandSweepStats,
  startHandSweepSession,
} from './handSweep.ts';

const NOW = Date.parse('2026-08-27T10:00:00.000Z');

const session = (over: Partial<HandSweepSession> = {}): HandSweepSession => ({
  handle: 'alice',
  mode: 'posts',
  startedAt: new Date(NOW).toISOString(),
  expiresAt: new Date(NOW + 30 * 60_000).toISOString(),
  ...over,
});

describe('startHandSweepSession', () => {
  test('lowercases the handle and expires after the window', () => {
    const s = startHandSweepSession('AliCe', 'replies', NOW);
    expect(s.handle).toBe('alice');
    expect(s.mode).toBe('replies');
    expect(Date.parse(s.expiresAt) - Date.parse(s.startedAt)).toBe(HAND_SWEEP_MINUTES * 60_000);
  });
});

describe('handSweepActiveAt', () => {
  test('a live session resolves', () => {
    expect(handSweepActiveAt(session(), NOW)).toMatchObject({ handle: 'alice', mode: 'posts' });
  });

  test('expiry is resolved on every read, never cached', () => {
    const s = session();
    expect(handSweepActiveAt(s, NOW + 29 * 60_000)).not.toBeNull();
    // At the boundary the sweep is already over — the same `<=` the radar uses.
    expect(handSweepActiveAt(s, NOW + 30 * 60_000)).toBeNull();
    expect(handSweepActiveAt(s, NOW + 31 * 60_000)).toBeNull();
  });

  test('junk, a missing field and an unknown mode all read as not armed', () => {
    expect(handSweepActiveAt(null, NOW)).toBeNull();
    expect(handSweepActiveAt('armed', NOW)).toBeNull();
    expect(handSweepActiveAt([session()], NOW)).toBeNull();
    expect(handSweepActiveAt({ ...session(), handle: '' }, NOW)).toBeNull();
    expect(handSweepActiveAt({ ...session(), mode: 'following' }, NOW)).toBeNull();
    expect(handSweepActiveAt({ ...session(), expiresAt: 'soon' }, NOW)).toBeNull();
  });

  test('a stored handle keeps its case only until it is resolved', () => {
    expect(handSweepActiveAt({ ...session(), handle: 'ALICE' }, NOW)?.handle).toBe('alice');
  });
});

describe('handSweepMinutesLeft', () => {
  test('rounds up so a live sweep never reads 0m', () => {
    expect(handSweepMinutesLeft(session(), NOW)).toBe(30);
    expect(handSweepMinutesLeft(session(), NOW + 29 * 60_000 + 1)).toBe(1);
    expect(handSweepMinutesLeft(session(), NOW + 60 * 60_000)).toBe(0);
  });
});

describe('parseHandSweepStats', () => {
  const stats = {
    startedAt: '2026-08-27T10:00:00.000Z',
    rows: 128,
    saved: 120,
    oldest: '2026-08-03T09:00:00.000Z',
    runId: 'c0ffee',
    updatedAt: '2026-08-27T10:05:00.000Z',
    error: null,
  };

  test('reads back the page`s progress', () => {
    expect(parseHandSweepStats(stats, stats.startedAt)).toMatchObject({ rows: 128, saved: 120 });
  });

  test('a blob from an earlier sweep is not this sweep`s progress', () => {
    expect(parseHandSweepStats(stats, '2026-08-27T11:00:00.000Z')).toBeNull();
  });

  test('missing and malformed fields fall back rather than throwing the tab', () => {
    const out = parseHandSweepStats(
      { startedAt: stats.startedAt, rows: -3, oldest: '' },
      stats.startedAt,
    );
    expect(out).toMatchObject({ rows: 0, saved: 0, oldest: null, error: null });
  });

  test('junk is no progress at all', () => {
    expect(parseHandSweepStats(null, stats.startedAt)).toBeNull();
    expect(parseHandSweepStats('128', stats.startedAt)).toBeNull();
  });
});

describe('handSweepTargetFor', () => {
  test('the mode comes from the page', () => {
    expect(handSweepTargetFor('https://x.com/alice')).toEqual({ handle: 'alice', mode: 'posts' });
    expect(handSweepTargetFor('https://x.com/AliCe/')).toEqual({ handle: 'alice', mode: 'posts' });
    expect(handSweepTargetFor('https://x.com/alice/with_replies')).toEqual({
      handle: 'alice',
      mode: 'replies',
    });
  });

  test('anything that is not one of the two timelines is not sweepable', () => {
    expect(handSweepTargetFor('https://x.com/alice/media')).toBeNull();
    expect(handSweepTargetFor('https://x.com/alice/highlights')).toBeNull();
    expect(handSweepTargetFor('https://x.com/alice/following')).toBeNull();
    expect(handSweepTargetFor('https://x.com/alice/status/123')).toBeNull();
    expect(handSweepTargetFor('https://x.com/home')).toBeNull();
    expect(handSweepTargetFor('https://x.com/i/bookmarks')).toBeNull();
    expect(handSweepTargetFor('https://example.com/alice')).toBeNull();
  });
});

describe('pageInHandSweep', () => {
  test('only the swept timeline captures', () => {
    const s = session({ mode: 'replies' });
    expect(pageInHandSweep('https://x.com/alice/with_replies', s)).toBe(true);
    expect(pageInHandSweep('https://x.com/alice', s)).toBe(false);
    expect(pageInHandSweep('https://x.com/bob/with_replies', s)).toBe(false);
    expect(pageInHandSweep('https://x.com/alice/status/123', s)).toBe(false);
  });

  test('the arm and the gate agree on every page the button offers', () => {
    for (const url of ['https://x.com/alice', 'https://x.com/alice/with_replies']) {
      const target = handSweepTargetFor(url);
      expect(target).not.toBeNull();
      if (!target) continue;
      expect(pageInHandSweep(url, session(target))).toBe(true);
    }
  });
});

describe('labels', () => {
  test('count', () => {
    expect(handSweepCountLabel(0, 'posts')).toBe('0 posts');
    expect(handSweepCountLabel(1, 'posts')).toBe('1 post');
    expect(handSweepCountLabel(1, 'replies')).toBe('1 reply');
    expect(handSweepCountLabel(128, 'replies')).toBe('128 replies');
  });

  test('date drops the year inside the current one and keeps it outside', () => {
    expect(handSweepDateLabel('2026-08-03T09:00:00.000Z', NOW)).toMatch(/^[234] Aug$/);
    expect(handSweepDateLabel('2025-12-31T09:00:00.000Z', NOW)).toMatch(/^3[01] Dec 2025$/);
    expect(handSweepDateLabel(null, NOW)).toBeNull();
    expect(handSweepDateLabel('not a date', NOW)).toBeNull();
  });
});
