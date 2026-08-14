import { describe, expect, test } from 'bun:test';
import type { Extracted } from '../harvester.ts';
import type { HarvestIngestRow } from './harvest.ts';
import {
  MAX_THREAD_REPLIES,
  dedupeThreadReplies,
  extractedToIngestRow,
  threadRootIdFromUrl,
} from './thread.ts';

function extracted(over: Partial<Extracted> = {}): Extracted {
  return {
    handle: 'someone',
    id: '1234567890',
    url: 'https://x.com/someone/status/1234567890',
    text: 'hello world',
    time: '2026-08-14T09:00:00.000Z',
    timeMs: Date.parse('2026-08-14T09:00:00.000Z'),
    pinned: false,
    isRepost: false,
    metrics: { comments: 3, reposts: 2, likes: 41, bookmarks: 5, views: 900 },
    hasPhoto: true,
    hasVideo: false,
    isQuote: false,
    lineBreaks: 2,
    ...over,
  };
}

function row(tweetId: string, over: Partial<HarvestIngestRow> = {}): HarvestIngestRow {
  return {
    tweetId,
    handle: 'someone',
    text: 't',
    comments: 0,
    reposts: 0,
    likes: 0,
    bookmarks: 0,
    views: 0,
    time: null,
    ...over,
  };
}

describe('threadRootIdFromUrl (TH.3)', () => {
  test('a bare status URL resolves to the id', () => {
    expect(threadRootIdFromUrl('https://x.com/someone/status/1234567890')).toBe('1234567890');
  });

  test('trailing segments still resolve to the id', () => {
    expect(threadRootIdFromUrl('https://x.com/someone/status/1234567890/photo/1')).toBe(
      '1234567890',
    );
    expect(threadRootIdFromUrl('https://x.com/someone/status/1234567890/analytics')).toBe(
      '1234567890',
    );
  });

  test('a query string and a trailing slash are ignored', () => {
    expect(threadRootIdFromUrl('https://x.com/someone/status/1234567890?s=20&t=x')).toBe(
      '1234567890',
    );
    expect(threadRootIdFromUrl('https://x.com/someone/status/1234567890/')).toBe('1234567890');
  });

  test('a bare pathname works — the helper accepts either form', () => {
    expect(threadRootIdFromUrl('/someone/status/1234567890')).toBe('1234567890');
  });

  test('a profile URL is not a thread', () => {
    expect(threadRootIdFromUrl('https://x.com/someone')).toBeNull();
    expect(threadRootIdFromUrl('https://x.com/someone/with_replies')).toBeNull();
    expect(threadRootIdFromUrl('https://x.com/home')).toBeNull();
  });

  test('a reserved app route is not a handle', () => {
    expect(threadRootIdFromUrl('https://x.com/i/status/123')).toBeNull();
  });

  test('a 20-digit id survives (ids are strings, never numbers)', () => {
    expect(threadRootIdFromUrl('https://x.com/someone/status/12345678901234567890')).toBe(
      '12345678901234567890',
    );
  });

  test('an empty string and a non-numeric id are null', () => {
    expect(threadRootIdFromUrl('')).toBeNull();
    expect(threadRootIdFromUrl('https://x.com/someone/status/abc')).toBeNull();
    expect(threadRootIdFromUrl('https://x.com/someone/statuses/123')).toBeNull();
  });
});

describe('extractedToIngestRow (TH.3)', () => {
  test('round-trips a full article onto the wire row', () => {
    expect(extractedToIngestRow(extracted())).toEqual({
      tweetId: '1234567890',
      handle: 'someone',
      text: 'hello world',
      comments: 3,
      reposts: 2,
      likes: 41,
      bookmarks: 5,
      views: 900,
      time: '2026-08-14T09:00:00.000Z',
      hasPhoto: true,
      hasVideo: false,
      isQuote: false,
      textLen: 11,
      lineBreaks: 2,
    });
  });

  test('a missing id or handle filters itself out (ads, promoted cells)', () => {
    expect(extractedToIngestRow(extracted({ id: null }))).toBeNull();
    expect(extractedToIngestRow(extracted({ handle: null }))).toBeNull();
  });

  test('empty text survives — image-only tweets are legal', () => {
    const r = extractedToIngestRow(extracted({ text: '' }));
    expect(r?.text).toBe('');
    expect(r?.textLen).toBe(0);
  });

  test('a missing timestamp becomes null, not an empty string', () => {
    expect(extractedToIngestRow(extracted({ time: '' }))?.time).toBeNull();
  });

  test('textLen counts the collapsed text the row actually carries', () => {
    const r = extractedToIngestRow(extracted({ text: 'one two three', lineBreaks: 4 }));
    expect(r?.textLen).toBe(13);
    expect(r?.lineBreaks).toBe(4);
  });
});

describe('dedupeThreadReplies (TH.3)', () => {
  test('duplicate ids collapse first-wins', () => {
    const kept = dedupeThreadReplies(
      [row('1', { text: 'first' }), row('2'), row('1', { text: 'second' })],
      '99',
    );
    expect(kept.map((r) => r.tweetId)).toEqual(['1', '2']);
    expect(kept[0]?.text).toBe('first');
  });

  test('the root is dropped wherever it appears', () => {
    const kept = dedupeThreadReplies([row('99'), row('1'), row('99'), row('2')], '99');
    expect(kept.map((r) => r.tweetId)).toEqual(['1', '2']);
  });

  test('order is otherwise preserved', () => {
    const kept = dedupeThreadReplies([row('3'), row('1'), row('2')], '99');
    expect(kept.map((r) => r.tweetId)).toEqual(['3', '1', '2']);
  });

  test('empty input stays empty', () => {
    expect(dedupeThreadReplies([], '99')).toEqual([]);
  });
});

describe('MAX_THREAD_REPLIES (TH.3)', () => {
  test('root + replies fits the server ceiling of 500 rows per call', () => {
    expect(1 + MAX_THREAD_REPLIES).toBeLessThanOrEqual(500);
  });
});
