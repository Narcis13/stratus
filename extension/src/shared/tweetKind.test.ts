// The media/ads readers over fixture HTML (happy-dom), the skeleton X renders
// per timeline article — the verified.test.ts pattern one module over.

import { describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { readHasMedia, readPromoted } from './tweetKind.ts';

interface ArticleOpts {
  /** The tweet's own media node, by testid. */
  media?: 'tweetPhoto' | 'videoPlayer' | 'videoComponent' | 'previewInterstitial';
  /** A link-preview card, optionally carrying a thumbnail that LOOKS like media. */
  card?: 'plain' | 'withPhoto';
  /** A quoted tweet, optionally carrying its own photo. */
  quotePhoto?: boolean;
  /** X's promoted-content wrapper. */
  placementTracking?: boolean;
  /** The social-context line's text, verbatim. */
  socialContext?: string;
}

function articleOf(opts: ArticleOpts = {}): Element {
  const media = opts.media
    ? `<div data-testid="${opts.media}"><img src="x.jpg" alt="" /></div>`
    : '';
  const card =
    opts.card === undefined
      ? ''
      : `<div data-testid="card.wrapper">${
          opts.card === 'withPhoto'
            ? '<div data-testid="card.layoutLarge.media"><div data-testid="tweetPhoto"><img src="unfurl.jpg" alt="" /></div></div>'
            : '<span>example.com</span>'
        }</div>`;
  const quote = opts.quotePhoto
    ? '<div role="link" tabindex="0"><div data-testid="tweetText">quoted</div><div data-testid="tweetPhoto"><img src="q.jpg" alt="" /></div></div>'
    : '';
  const social =
    opts.socialContext === undefined
      ? ''
      : `<div data-testid="socialContext"><span>${opts.socialContext}</span></div>`;
  const placement = opts.placementTracking
    ? '<div data-testid="placementTracking"><div data-testid="videoPlayer"></div></div>'
    : '';
  const html = `
    <article data-testid="tweet">
      ${social}
      <div data-testid="User-Name"><a href="/alice"><span>Alice</span></a></div>
      <div data-testid="tweetText">hello</div>
      ${media}${card}${quote}${placement}
    </article>`;
  const window = new Window({ url: 'https://x.com/home' });
  window.document.body.innerHTML = html;
  const article = window.document.querySelector('article');
  if (!article) throw new Error('fixture has no article');
  return article as unknown as Element;
}

describe('readHasMedia', () => {
  test('a plain text tweet has none', () => {
    expect(readHasMedia(articleOf())).toBe(false);
  });

  for (const media of [
    'tweetPhoto',
    'videoPlayer',
    'videoComponent',
    'previewInterstitial',
  ] as const) {
    test(`${media} counts as media`, () => {
      expect(readHasMedia(articleOf({ media }))).toBe(true);
    });
  }

  // The distinction the gate exists for: a link preview is a LINK, and X's
  // unfurled thumbnail is not the author's photo.
  test('a link card alone is not media', () => {
    expect(readHasMedia(articleOf({ card: 'plain' }))).toBe(false);
  });

  test("a link card's own thumbnail is not media, even under a media testid", () => {
    expect(readHasMedia(articleOf({ card: 'withPhoto' }))).toBe(false);
  });

  test('a real photo alongside a link card still counts', () => {
    expect(readHasMedia(articleOf({ media: 'tweetPhoto', card: 'withPhoto' }))).toBe(true);
  });

  // Deliberate, and the opposite call from readVerified's quote handling: the
  // cell in front of you does show an image.
  test("a quoted tweet's photo counts", () => {
    expect(readHasMedia(articleOf({ quotePhoto: true }))).toBe(true);
  });
});

describe('readPromoted', () => {
  test('an ordinary tweet is not promoted', () => {
    expect(readPromoted(articleOf())).toBe(false);
  });

  test("X's placementTracking wrapper is the structural hook", () => {
    expect(readPromoted(articleOf({ placementTracking: true }))).toBe(true);
  });

  test('the "Promoted" social-context label', () => {
    expect(readPromoted(articleOf({ socialContext: 'Promoted' }))).toBe(true);
  });

  test('"Promoted by Acme" — a prefix match, not an exact one', () => {
    expect(readPromoted(articleOf({ socialContext: 'Promoted by Acme' }))).toBe(true);
  });

  test('the bare "Ad" label', () => {
    expect(readPromoted(articleOf({ socialContext: 'Ad' }))).toBe(true);
  });

  // The false positive this reader cannot afford: it would silently drop a real
  // tweet out of the queue, and nothing on screen would say why.
  test('"Adam liked" is not an ad', () => {
    expect(readPromoted(articleOf({ socialContext: 'Adam liked' }))).toBe(false);
  });

  test('a pinned/reposted social context is not an ad', () => {
    expect(readPromoted(articleOf({ socialContext: 'Alice reposted' }))).toBe(false);
  });

  // The stated limit, pinned rather than hidden: the text arm is English-only,
  // and a localized UI falls back to the structural hook alone.
  test('a localized label does NOT match — the testid is the load-bearing hook', () => {
    expect(readPromoted(articleOf({ socialContext: 'Promovat' }))).toBe(false);
  });
});
