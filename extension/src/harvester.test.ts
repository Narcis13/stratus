// XR.7 — `extractArticle`'s two DOM reads, over fixture HTML (happy-dom), the
// `tweetKind.test.ts` / `verified.test.ts` pattern one module over.
//
// `extractArticle` is the ONE reader every harvest path shares (HV.2), so a
// wrong answer here is wrong in the Playbook's media cell, in the calibration
// corpus and in the swipe file at once. Both bugs below were invisible: each
// produced a plausible number rather than an error.

import { describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { extractArticle } from './harvester.ts';

interface ArticleOpts {
  /** The action row's aria-label, X's own metric summary. */
  groupLabel?: string;
  /** Render the testid buttons X ships in every locale, with these faces. */
  buttons?: { reply?: string; retweet?: string; like?: string; bookmark?: string };
  /** The analytics link the view count lives on, with this face. */
  viewsLink?: string;
  /** Media the AUTHOR attached. */
  media?: 'tweetPhoto' | 'videoPlayer';
  /** A quoted tweet, carrying its own text and optionally its own media. */
  quote?: 'plain' | 'withPhoto' | 'withVideo';
  /** A link-preview card carrying a thumbnail that matches the media selector. */
  cardPhoto?: boolean;
}

function articleOf(opts: ArticleOpts = {}): Element {
  const group =
    opts.groupLabel === undefined
      ? '<div role="group"></div>'
      : `<div role="group" aria-label="${opts.groupLabel}"></div>`;
  const buttons = Object.entries(opts.buttons ?? {})
    .map(([testid, face]) => `<button data-testid="${testid}"><span>${face}</span></button>`)
    .join('');
  const views =
    opts.viewsLink === undefined
      ? ''
      : `<a href="/alice/status/123/analytics"><span>${opts.viewsLink}</span></a>`;
  const media = opts.media ? `<div data-testid="${opts.media}"></div>` : '';
  const quote =
    opts.quote === undefined
      ? ''
      : `<div role="link" tabindex="0"><div data-testid="tweetText">quoted</div>${
          opts.quote === 'withPhoto'
            ? '<div data-testid="tweetPhoto"></div>'
            : opts.quote === 'withVideo'
              ? '<div data-testid="videoPlayer"></div>'
              : ''
        }</div>`;
  const card = opts.cardPhoto
    ? '<div role="link" tabindex="0" data-testid="card.wrapper"><div data-testid="tweetPhoto"></div></div>'
    : '';

  const window = new Window({ url: 'https://x.com/alice/status/123' });
  window.document.body.innerHTML = `
    <article data-testid="tweet">
      <a href="/alice/status/123"><time datetime="2026-08-01T10:00:00.000Z">1 Aug</time></a>
      <div data-testid="tweetText">the outer tweet</div>
      ${media}${quote}${card}
      ${group}${buttons}${views}
    </article>`;
  const article = window.document.querySelector('article');
  if (!article) throw new Error('fixture has no article');
  return article as unknown as Element;
}

const EN_LABEL = '19 replies, 4 reposts, 38 likes, 2 bookmarks, 845 views';

describe('extractArticle — media belongs to the tweet, not to the one it quotes', () => {
  test('the author’s own photo counts', () => {
    expect(extractArticle(articleOf({ media: 'tweetPhoto' })).hasPhoto).toBe(true);
  });

  // The bug this fix exists for: a text-only quote of a photo post recorded
  // hasPhoto: true, which reads in the Playbook as "images do nothing for us".
  test('a text-only quote of a photo post has NO photo', () => {
    const r = extractArticle(articleOf({ quote: 'withPhoto' }));
    expect(r.hasPhoto).toBe(false);
    expect(r.isQuote).toBe(true);
  });

  test('a text-only quote of a video post has NO video', () => {
    expect(extractArticle(articleOf({ quote: 'withVideo' })).hasVideo).toBe(false);
  });

  test('our own photo still counts while quoting a photo post', () => {
    expect(extractArticle(articleOf({ media: 'tweetPhoto', quote: 'withPhoto' })).hasPhoto).toBe(
      true,
    );
  });

  // The predicate is "the role=link card carries its OWN tweetText", not "it is
  // a role=link" — a link preview is one too, and its thumbnail is part of how
  // THIS tweet renders.
  test('a link-preview card is not a quote card', () => {
    expect(extractArticle(articleOf({ cardPhoto: true })).hasPhoto).toBe(true);
  });

  test('a plain quote with no media leaves both flags false', () => {
    const r = extractArticle(articleOf({ quote: 'plain' }));
    expect(r.hasPhoto).toBe(false);
    expect(r.hasVideo).toBe(false);
  });
});

describe('extractArticle — metrics survive a locale the aria stems miss', () => {
  test('an English label is read from the label alone', () => {
    expect(extractArticle(articleOf({ groupLabel: EN_LABEL })).metrics).toEqual({
      comments: 19,
      reposts: 4,
      likes: 38,
      bookmarks: 2,
      views: 845,
    });
  });

  // A label with numbers whose words match no stem used to zero every metric
  // behind the `unparsed` flag. The testids are identical in every locale.
  test('an unparseable label falls back to the testid buttons', () => {
    const r = extractArticle(
      articleOf({
        groupLabel: '19 zzzz, 4 yyyy, 38 xxxx, 845 wwww',
        buttons: { reply: '19', retweet: '4', like: '38' },
        viewsLink: '845',
      }),
    );
    expect(r.metrics).toEqual({ comments: 19, reposts: 4, likes: 38, bookmarks: 0, views: 845 });
  });

  test('an absent label falls back too', () => {
    const r = extractArticle(articleOf({ buttons: { like: '7' }, viewsLink: '1,234' }));
    expect(r.metrics.likes).toBe(7);
    expect(r.metrics.views).toBe(1234);
  });

  // Precision is why the label stays the primary read: a button carries the
  // abbreviated face, so the fallback rounds where the label would not have.
  test('an abbreviated face is expanded', () => {
    const r = extractArticle(articleOf({ buttons: { like: '1.2K' }, viewsLink: '3M' }));
    expect(r.metrics.likes).toBe(1200);
    expect(r.metrics.views).toBe(3_000_000);
  });

  // The rule that keeps the fallback safe: it fills, it never corrects.
  test('a parsed value is never overwritten by a button', () => {
    const r = extractArticle(
      articleOf({ groupLabel: EN_LABEL, buttons: { like: '9999', reply: '8888' } }),
    );
    expect(r.metrics.likes).toBe(38);
    expect(r.metrics.comments).toBe(19);
  });

  // X renders no number at all for a zero metric, so "the button says nothing"
  // and "the metric is zero" are the same reading — and both stay zero.
  test('a metric with no button and no label stays zero', () => {
    const r = extractArticle(articleOf({ buttons: { like: '7' } }));
    expect(r.metrics.reposts).toBe(0);
    expect(r.metrics.views).toBe(0);
  });
});
