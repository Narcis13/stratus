// C7 early-reply parser over fixture HTML (happy-dom) — the same structural
// skeleton X renders on a status page: focused tweet, reply articles, then a
// "Discover more" heading with unrelated tweets.

import { describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { parseEarlyReplies } from './earlyReplies.ts';

const LAUNCH_ID = '1000';
const SELF = 'narcis';

function article(handle: string, tweetId: string, text: string, opts: { time?: string } = {}) {
  return `
    <article data-testid="tweet">
      <div data-testid="User-Name">
        <a href="/${handle}">${handle.toUpperCase()} Display</a>
      </div>
      <a href="/${handle}/status/${tweetId}">
        <time datetime="${opts.time ?? '2026-07-04T12:05:00.000Z'}">5m</time>
      </a>
      <div data-testid="tweetText">${text}</div>
    </article>`;
}

function documentFor(html: string): Document {
  const window = new Window({ url: `https://x.com/${SELF}/status/${LAUNCH_ID}` });
  window.document.body.innerHTML = html;
  return window.document as unknown as Document;
}

describe('parseEarlyReplies', () => {
  test('collects repliers after the focused tweet: author, handle, text, time', () => {
    const doc = documentFor(`
      <h2>Post</h2>
      ${article(SELF, LAUNCH_ID, 'my launched post')}
      ${article('alice', '1001', 'great point!')}
      ${article('bob', '1002', 'disagree entirely')}
    `);
    const replies = parseEarlyReplies(doc, LAUNCH_ID, SELF);
    expect(replies).toEqual([
      {
        tweetId: '1001',
        handle: 'alice',
        author: 'ALICE Display',
        text: 'great point!',
        postedAt: '2026-07-04T12:05:00.000Z',
      },
      {
        tweetId: '1002',
        handle: 'bob',
        author: 'BOB Display',
        text: 'disagree entirely',
        postedAt: '2026-07-04T12:05:00.000Z',
      },
    ]);
  });

  test('skips my own rows (self-thread segments, my replies to commenters)', () => {
    const doc = documentFor(`
      ${article(SELF, LAUNCH_ID, 'head')}
      ${article(SELF, '1001', 'thread tail with the link')}
      ${article('alice', '1002', 'nice')}
      ${article('Narcis', '1003', 'my reply to alice')}
    `);
    const replies = parseEarlyReplies(doc, LAUNCH_ID, SELF);
    expect(replies.map((r) => r.tweetId)).toEqual(['1002']);
  });

  test('ignores everything under the Discover-more heading', () => {
    const doc = documentFor(`
      <h2>Post</h2>
      ${article(SELF, LAUNCH_ID, 'head')}
      ${article('alice', '1001', 'reply')}
      <h2>Discover more</h2>
      ${article('celeb', '9999', 'unrelated viral tweet')}
    `);
    const replies = parseEarlyReplies(doc, LAUNCH_ID, SELF);
    expect(replies.map((r) => r.tweetId)).toEqual(['1001']);
  });

  test('ignores conversation ancestry above the focused tweet', () => {
    const doc = documentFor(`
      ${article('elder', '900', 'some parent tweet')}
      ${article(SELF, LAUNCH_ID, 'my post')}
      ${article('alice', '1001', 'reply')}
    `);
    const replies = parseEarlyReplies(doc, LAUNCH_ID, SELF);
    expect(replies.map((r) => r.tweetId)).toEqual(['1001']);
  });

  test('still collects when the focused tweet is virtualized out of the DOM', () => {
    const doc = documentFor(`
      ${article('alice', '1001', 'reply one')}
      ${article('bob', '1002', 'reply two')}
      <h2>Discover more</h2>
      ${article('celeb', '9999', 'unrelated')}
    `);
    const replies = parseEarlyReplies(doc, LAUNCH_ID, SELF);
    expect(replies.map((r) => r.tweetId)).toEqual(['1001', '1002']);
  });

  test('dedupes repeated articles for the same tweet', () => {
    const doc = documentFor(`
      ${article(SELF, LAUNCH_ID, 'head')}
      ${article('alice', '1001', 'reply')}
      ${article('alice', '1001', 'reply')}
    `);
    expect(parseEarlyReplies(doc, LAUNCH_ID, SELF).length).toBe(1);
  });

  test('a text-less (media-only) reply still counts — the person matters', () => {
    const doc = documentFor(`
      ${article(SELF, LAUNCH_ID, 'head')}
      <article data-testid="tweet">
        <div data-testid="User-Name"><a href="/carol">Carol</a></div>
        <a href="/carol/status/1004"><time datetime="2026-07-04T12:06:00.000Z">6m</time></a>
      </article>
    `);
    const replies = parseEarlyReplies(doc, LAUNCH_ID, SELF);
    expect(replies).toEqual([
      {
        tweetId: '1004',
        handle: 'carol',
        author: 'Carol',
        text: '',
        postedAt: '2026-07-04T12:06:00.000Z',
      },
    ]);
  });
});
