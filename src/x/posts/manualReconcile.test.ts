import { describe, expect, test } from 'bun:test';
import {
  type ManualScheduledRow,
  type PublishedCandidate,
  RECONCILE_WINDOW_AFTER_MS,
  RECONCILE_WINDOW_BEFORE_MS,
  matchManualRows,
} from './manualReconcile.ts';

// A fixed, jittered slot (never top-of-hour) — offsets are added in ms.
const T0 = new Date('2026-06-01T09:12:00.000Z').getTime();
const at = (offsetMs: number): Date => new Date(T0 + offsetMs);
const MIN = 60 * 1000;

function manualRow(over: Partial<ManualScheduledRow> = {}): ManualScheduledRow {
  return { id: 'sp1', text: 'hello world', scheduledFor: at(0), status: 'manual', ...over };
}

function published(over: Partial<PublishedCandidate> = {}): PublishedCandidate {
  return {
    tweetId: 't1',
    text: 'hello world',
    postedAt: at(5 * MIN),
    isReply: false,
    scheduledPostId: null,
    ...over,
  };
}

describe('matchManualRows (A3.6)', () => {
  test('exact text + in-window → one link', () => {
    expect(matchManualRows([manualRow()], [published()])).toEqual([
      { scheduledPostId: 'sp1', tweetId: 't1' },
    ]);
  });

  test('whitespace-collapsed equality matches (newlines vs spaces)', () => {
    const links = matchManualRows(
      [manualRow({ text: 'hello   world' })],
      [published({ text: 'hello\n\nworld' })],
    );
    expect(links).toEqual([{ scheduledPostId: 'sp1', tweetId: 't1' }]);
  });

  test('edited text → no match', () => {
    const links = matchManualRows(
      [manualRow({ text: 'hello world' })],
      [published({ text: 'hello world!' })],
    );
    expect(links).toEqual([]);
  });

  test('reply rows are never candidates', () => {
    const links = matchManualRows([manualRow()], [published({ isReply: true })]);
    expect(links).toEqual([]);
  });

  test('already-linked published row is skipped', () => {
    const links = matchManualRows([manualRow()], [published({ scheduledPostId: 'other' })]);
    expect(links).toEqual([]);
  });

  test('window edges are inclusive', () => {
    // exactly at scheduledFor − 1h and scheduledFor + 7d → linked
    const beforeEdge = matchManualRows(
      [manualRow()],
      [published({ postedAt: at(-RECONCILE_WINDOW_BEFORE_MS) })],
    );
    expect(beforeEdge).toEqual([{ scheduledPostId: 'sp1', tweetId: 't1' }]);
    const afterEdge = matchManualRows(
      [manualRow()],
      [published({ postedAt: at(RECONCILE_WINDOW_AFTER_MS) })],
    );
    expect(afterEdge).toEqual([{ scheduledPostId: 'sp1', tweetId: 't1' }]);
  });

  test('just outside either edge → rejected', () => {
    const tooEarly = matchManualRows(
      [manualRow()],
      [published({ postedAt: at(-RECONCILE_WINDOW_BEFORE_MS - 1) })],
    );
    expect(tooEarly).toEqual([]);
    const tooLate = matchManualRows(
      [manualRow()],
      [published({ postedAt: at(RECONCILE_WINDOW_AFTER_MS + 1) })],
    );
    expect(tooLate).toEqual([]);
  });

  test('two manual rows with identical text → nearest postedAt wins, one link each', () => {
    const rows = [
      manualRow({ id: 'A', scheduledFor: at(0) }),
      manualRow({ id: 'B', scheduledFor: at(3 * 24 * 60 * MIN) }), // T0 + 3d
    ];
    const tweets = [
      published({ tweetId: 'X', postedAt: at(5 * MIN) }), // nearest A
      published({ tweetId: 'Y', postedAt: at(3 * 24 * 60 * MIN + 5 * MIN) }), // nearest B
    ];
    const links = matchManualRows(rows, tweets);
    expect(links).toHaveLength(2);
    expect(links).toContainEqual({ scheduledPostId: 'A', tweetId: 'X' });
    expect(links).toContainEqual({ scheduledPostId: 'B', tweetId: 'Y' });
  });

  test('one tweet contested by two rows → nearest row wins, the other stays unlinked', () => {
    const rows = [
      manualRow({ id: 'A', scheduledFor: at(0) }),
      manualRow({ id: 'B', scheduledFor: at(30 * MIN) }),
    ];
    const tweets = [published({ tweetId: 'X', postedAt: at(40 * MIN) })]; // 40m from A, 10m from B
    expect(matchManualRows(rows, tweets)).toEqual([{ scheduledPostId: 'B', tweetId: 'X' }]);
  });

  test('empty inputs and no candidates → no links', () => {
    expect(matchManualRows([], [published()])).toEqual([]);
    expect(matchManualRows([manualRow()], [])).toEqual([]);
    expect(matchManualRows([manualRow({ text: '   ' })], [published({ text: '   ' })])).toEqual([]);
  });
});
