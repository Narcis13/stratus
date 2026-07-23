import { describe, expect, test } from 'bun:test';
import type { Extracted } from '../harvester.ts';
import {
  PASSIVE_RESEND_MS,
  PASSIVE_TEXT_MAX,
  isHomeTimelinePath,
  shouldRecordPassive,
  toPassiveIngestRow,
} from './passiveHarvest.ts';

const extracted = (over: Partial<Extracted> = {}): Extracted => ({
  handle: 'alice',
  id: '1234567890',
  url: 'https://x.com/alice/status/1234567890',
  text: 'ships agents',
  time: '2026-07-23T10:00:00.000Z',
  timeMs: Date.parse('2026-07-23T10:00:00.000Z'),
  pinned: false,
  isRepost: false,
  metrics: { comments: 3, reposts: 1, likes: 12, bookmarks: 2, views: 900 },
  hasPhoto: false,
  hasVideo: false,
  isQuote: false,
  lineBreaks: 0,
  ...over,
});

describe('isHomeTimelinePath', () => {
  test('only the home timeline captures', () => {
    expect(isHomeTimelinePath('/home')).toBe(true);
    expect(isHomeTimelinePath('/home/')).toBe(true);
    expect(isHomeTimelinePath('/notifications')).toBe(false);
    expect(isHomeTimelinePath('/elonmusk')).toBe(false);
    expect(isHomeTimelinePath('/elonmusk/status/123')).toBe(false);
    expect(isHomeTimelinePath('/')).toBe(false);
    expect(isHomeTimelinePath('/home/lists')).toBe(false);
  });
});

describe('shouldRecordPassive', () => {
  test('never sent → record', () => {
    expect(shouldRecordPassive(undefined, 1_000_000)).toBe(true);
  });

  test('inside the resend window → suppressed; at/after → record', () => {
    const sent = 1_000_000;
    expect(shouldRecordPassive(sent, sent + PASSIVE_RESEND_MS - 1)).toBe(false);
    expect(shouldRecordPassive(sent, sent + PASSIVE_RESEND_MS)).toBe(true);
  });
});

describe('toPassiveIngestRow', () => {
  test('carries metrics, time and the content-shape fields through', () => {
    const row = toPassiveIngestRow(
      extracted({ hasPhoto: true, isQuote: true, lineBreaks: 4, text: 'a b' }),
    );
    expect(row).not.toBeNull();
    expect(row).toMatchObject({
      tweetId: '1234567890',
      handle: 'alice',
      text: 'a b',
      comments: 3,
      reposts: 1,
      likes: 12,
      bookmarks: 2,
      views: 900,
      time: '2026-07-23T10:00:00.000Z',
      hasPhoto: true,
      hasVideo: false,
      isQuote: true,
      textLen: 3,
      lineBreaks: 4,
    });
  });

  test('an empty datetime becomes null, never an empty string', () => {
    // A null tweet_time makes ageMin — and therefore vpm — underivable, so the
    // funnel can only ever bucket the row as unknown. Server wants null.
    expect(toPassiveIngestRow(extracted({ time: '' }))?.time).toBeNull();
  });

  test('text truncates but textLen keeps the pre-truncation length', () => {
    const long = 'x'.repeat(PASSIVE_TEXT_MAX + 120);
    const row = toPassiveIngestRow(extracted({ text: long }));
    expect(row?.text.length).toBe(PASSIVE_TEXT_MAX);
    expect(row?.textLen).toBe(PASSIVE_TEXT_MAX + 120);
  });

  test('no permalink (missing id or handle) → no row', () => {
    expect(toPassiveIngestRow(extracted({ id: null }))).toBeNull();
    expect(toPassiveIngestRow(extracted({ handle: null }))).toBeNull();
  });

  test('an image-only tweet still ships (empty text is valid server-side)', () => {
    const row = toPassiveIngestRow(extracted({ text: '', hasPhoto: true }));
    expect(row?.text).toBe('');
    expect(row?.textLen).toBe(0);
  });
});
