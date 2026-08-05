// CQ.2 roster scoring — pure, no DB, no clock.

import { describe, expect, test } from 'bun:test';
import {
  type AuthorPost,
  CANNON_MIN_SAMPLE,
  median,
  rankCannonTargets,
  scoreAuthor,
} from './roster.ts';

function post(over: Partial<AuthorPost> & { tweetId: string }): AuthorPost {
  return {
    views: 1000,
    comments: 4,
    tweetTime: null,
    capturedAt: 1_000_000,
    ...over,
  };
}

/** n posts with distinct ids and publish times, newest last. */
function series(n: number, over: Partial<AuthorPost> = {}): AuthorPost[] {
  return Array.from({ length: n }, (_, i) =>
    post({ tweetId: `t${i}`, tweetTime: 1_000 + i, ...over }),
  );
}

describe('median', () => {
  test('odd length takes the middle', () => {
    expect(median([5, 1, 3])).toBe(3);
  });

  test('even length averages the two middles', () => {
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });

  test('empty is null, never 0', () => {
    expect(median([])).toBeNull();
  });

  test('does not mutate the input', () => {
    const xs = [3, 1, 2];
    median(xs);
    expect(xs).toEqual([3, 1, 2]);
  });
});

describe('scoreAuthor', () => {
  test('null under the sample gate — never a number on 3 posts', () => {
    expect(scoreAuthor(series(CANNON_MIN_SAMPLE - 1))).toBeNull();
    expect(scoreAuthor(series(3))).toBeNull();
  });

  test('exactly the gate scores', () => {
    const scored = scoreAuthor(series(CANNON_MIN_SAMPLE));
    expect(scored).not.toBeNull();
    expect(scored?.sampleN).toBe(CANNON_MIN_SAMPLE);
  });

  test('separate medians, then divide: median(views) / (median(comments) + 1)', () => {
    // 8 posts: views 100..800 (median 450), comments all 4 (median 4).
    const posts = Array.from({ length: 8 }, (_, i) =>
      post({ tweetId: `t${i}`, tweetTime: i, views: (i + 1) * 100, comments: 4 }),
    );
    const scored = scoreAuthor(posts);
    expect(scored?.medianViews).toBe(450);
    expect(scored?.medianComments).toBe(4);
    expect(scored?.score).toBe(450 / 5);
  });

  test('zero-comment author scores exactly medianViews (the +1 guard)', () => {
    const scored = scoreAuthor(series(10, { views: 700, comments: 0 }));
    expect(scored?.medianComments).toBe(0);
    expect(scored?.score).toBe(700);
  });

  test('dedupe keeps the LATEST capture of a re-captured tweet', () => {
    const posts = [
      ...series(8, { views: 100, comments: 0 }),
      // t0 seen again later with a maturer view count.
      post({ tweetId: 't0', tweetTime: 1_000, views: 9_000, comments: 0, capturedAt: 5_000_000 }),
    ];
    const scored = scoreAuthor(posts);
    // Still 8 distinct tweets, and t0 now reads 9,000 — so the median of
    // [100 x7, 9000] is 100 and the max moved, proving the late row replaced
    // rather than joined.
    expect(scored?.sampleN).toBe(8);
    expect(scored?.medianViews).toBe(100);
    const withoutDupe = scoreAuthor(series(8, { views: 100, comments: 0 }));
    expect(scored?.score).toBe(withoutDupe?.score as number);
  });

  test('an earlier re-capture never overwrites the later one', () => {
    const posts = [
      ...series(8, { views: 500, comments: 0 }),
      post({ tweetId: 't0', tweetTime: 1_000, views: 1, comments: 0, capturedAt: 0 }),
    ];
    expect(scoreAuthor(posts)?.medianViews).toBe(500);
  });

  test('maxPosts takes the NEWEST by tweetTime', () => {
    // 12 posts, views tracking recency: the newest 8 are views 500..1200.
    const posts = Array.from({ length: 12 }, (_, i) =>
      post({ tweetId: `t${i}`, tweetTime: i, views: (i + 1) * 100, comments: 0 }),
    );
    const scored = scoreAuthor(posts, 8);
    expect(scored?.sampleN).toBe(8);
    // views 500..1200 → median 850
    expect(scored?.medianViews).toBe(850);
  });

  test('falls back to capturedAt when tweetTime is null', () => {
    const posts = Array.from({ length: 12 }, (_, i) =>
      post({ tweetId: `t${i}`, tweetTime: null, capturedAt: i, views: (i + 1) * 100 }),
    );
    expect(scoreAuthor(posts, 8)?.medianViews).toBe(850);
  });

  test('empty input is null, not 0', () => {
    expect(scoreAuthor([])).toBeNull();
  });
});

describe('rankCannonTargets', () => {
  test('nulls last, score desc, handle asc as the total tiebreak', () => {
    const rows = [
      { handle: 'zed', score: null },
      { handle: 'bea', score: 120 },
      { handle: 'abe', score: 120 },
      { handle: 'ana', score: null },
      { handle: 'cy', score: 900 },
    ];
    expect(rankCannonTargets(rows).map((r) => r.handle)).toEqual([
      'cy',
      'abe',
      'bea',
      'ana',
      'zed',
    ]);
  });

  test('a score of 0 is a verdict and outranks unscored (§7.11)', () => {
    const rows = [
      { handle: 'unscored', score: null },
      { handle: 'zero', score: 0 },
    ];
    expect(rankCannonTargets(rows).map((r) => r.handle)).toEqual(['zero', 'unscored']);
  });

  test('does not mutate the input', () => {
    const rows = [
      { handle: 'b', score: 1 },
      { handle: 'a', score: 2 },
    ];
    rankCannonTargets(rows);
    expect(rows.map((r) => r.handle)).toEqual(['b', 'a']);
  });
});
