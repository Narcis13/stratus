// RS.3 — the verified-badge reader over fixture HTML (happy-dom), the skeleton
// X renders per timeline article: a User-Name block holding the display name,
// the badge svg, then the @handle, and (sometimes) a nested quote card with a
// second author of its own.

import { describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { readVerified } from './verified.ts';

type Badge = 'testid' | 'aria' | 'none';

function nameBlock(handle: string, badge: Badge): string {
  const svg =
    badge === 'testid'
      ? '<svg data-testid="icon-verified" viewBox="0 0 22 22"><g></g></svg>'
      : badge === 'aria'
        ? '<svg aria-label="Verified account" viewBox="0 0 22 22"><g></g></svg>'
        : '';
  return `
    <div data-testid="User-Name">
      <div><a href="/${handle}"><span>Alice Example</span>${svg}</a></div>
      <div><a href="/${handle}"><span>@${handle}</span></a></div>
    </div>`;
}

interface ArticleOpts {
  badge?: Badge;
  /** A quoted tweet's author, rendered deeper in the SAME article. */
  quoteBadge?: Badge;
  nameBlock?: boolean;
}

function articleOf(opts: ArticleOpts = {}): Element {
  const quote =
    opts.quoteBadge === undefined
      ? ''
      : `<div role="link" tabindex="0">${nameBlock('quoted', opts.quoteBadge)}<div data-testid="tweetText">quoted</div></div>`;
  const html = `
    <article data-testid="tweet">
      ${opts.nameBlock === false ? '' : nameBlock('alice', opts.badge ?? 'none')}
      <div data-testid="tweetText">hello</div>
      ${quote}
    </article>`;
  const window = new Window({ url: 'https://x.com/home' });
  window.document.body.innerHTML = html;
  const article = window.document.querySelector('article');
  if (!article) throw new Error('fixture has no article');
  return article as unknown as Element;
}

describe('readVerified', () => {
  test('badge via the data-testid hook', () => {
    expect(readVerified(articleOf({ badge: 'testid' }))).toBe(true);
  });

  test('badge via aria-label only (the testid renamed)', () => {
    expect(readVerified(articleOf({ badge: 'aria' }))).toBe(true);
  });

  test('a localized aria-label alone does NOT match — the testid is the load-bearing hook', () => {
    const window = new Window({ url: 'https://x.com/home' });
    window.document.body.innerHTML = `
      <article data-testid="tweet">
        <div data-testid="User-Name">
          <span>Alice</span><svg aria-label="Cont verificat"><g></g></svg>
        </div>
      </article>`;
    const article = window.document.querySelector('article') as unknown as Element;
    // Pinning the known limit rather than pretending it away: the aria fallback
    // covers a testid rename on an English UI, not a Romanian one. Under
    // `verifiedOnly` this reads as a refusal (an empty queue you can see), which
    // is the direction the whole filter is built to fail in.
    expect(readVerified(article)).toBe(false);
  });

  test('name block present, no badge -> false', () => {
    expect(readVerified(articleOf({ badge: 'none' }))).toBe(false);
  });

  test('no name block at all -> null (unknown, not "no")', () => {
    expect(readVerified(articleOf({ nameBlock: false }))).toBeNull();
  });

  test('a quoted tweet author’s badge does not vouch for the outer post', () => {
    expect(readVerified(articleOf({ badge: 'none', quoteBadge: 'testid' }))).toBe(false);
  });

  test('the outer author is read even when the quote card is unverified', () => {
    expect(readVerified(articleOf({ badge: 'testid', quoteBadge: 'none' }))).toBe(true);
  });
});
