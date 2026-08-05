// The X machine-translation reader over fixture HTML (happy-dom). The shapes
// below were copied off a live x.com timeline: a translated tweet renders the
// localized "Translated from <lang> / Show original" strip as the tweet text's
// immediately preceding sibling, with the text itself carrying lang="en" (the
// VIEWER's language). Click it and the same node comes back with lang="ja" and
// a strip that now reads "Show translation".

import { describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import {
  findShowOriginalButtons,
  isShowingTranslation,
  showOriginalButton,
  translationBanner,
  viewerLangOf,
} from './translation.ts';

type State = 'translated' | 'original' | 'plain';

function tweetHtml(state: State, text = 'hello'): string {
  const banner = (label: string, note = ''): string =>
    `<div dir="ltr"><span><span>${note}</span></span>` +
    `<button role="button" type="button" aria-label="${label}"><span>${label}</span></button></div>`;
  if (state === 'translated') {
    return `<article data-testid="tweet"><div>
      ${banner('Show original', 'Translated from Japanese')}
      <div data-testid="tweetText" lang="en" dir="auto">${text}</div>
    </div></article>`;
  }
  if (state === 'original') {
    return `<article data-testid="tweet"><div>
      ${banner('Show translation')}
      <div data-testid="tweetText" lang="ja" dir="auto">${text}</div>
    </div></article>`;
  }
  return `<article data-testid="tweet"><div>
    <div data-testid="tweetText" lang="en" dir="auto">${text}</div>
  </div></article>`;
}

function docOf(html: string, lang = 'en'): Document {
  const window = new Window({ url: 'https://x.com/someone/with_replies' });
  window.document.documentElement.setAttribute('lang', lang);
  window.document.body.innerHTML = html;
  return window.document as unknown as Document;
}

function textOf(doc: Document): Element {
  const el = doc.querySelector('div[data-testid="tweetText"]');
  if (!el) throw new Error('fixture has no tweetText');
  return el;
}

describe('viewerLangOf', () => {
  test('reads <html lang>, reduced to the base subtag', () => {
    expect(viewerLangOf(docOf(tweetHtml('plain'), 'en-GB'))).toBe('en');
    expect(viewerLangOf(docOf(tweetHtml('plain'), 'ja'))).toBe('ja');
  });

  test('falls back to en when <html> carries no lang', () => {
    const doc = docOf(tweetHtml('plain'));
    doc.documentElement.removeAttribute('lang');
    expect(viewerLangOf(doc)).toBe('en');
  });
});

describe('translationBanner', () => {
  test('finds the strip preceding a translated tweet text', () => {
    const banner = translationBanner(textOf(docOf(tweetHtml('translated'))));
    expect(banner).not.toBeNull();
    expect(banner?.textContent).toContain('Show original');
  });

  test('is null when X never offered a translation', () => {
    expect(translationBanner(textOf(docOf(tweetHtml('plain'))))).toBeNull();
  });

  test('never mistakes a preceding tweet body for the banner', () => {
    // Two articles in one conversation group: the second tweet's text must not
    // read the first tweet's block as its own translation strip.
    const doc = docOf(`<div>
      <div><div data-testid="tweetText" lang="en">parent</div>
        <button role="button">Reply</button></div>
      <div data-testid="tweetText" lang="en">child</div>
    </div>`);
    const child = Array.from(doc.querySelectorAll('div[data-testid="tweetText"]'))[1];
    expect(child?.textContent).toBe('child');
    expect(child && translationBanner(child)).toBeNull();
  });
});

describe('isShowingTranslation', () => {
  test('true only while the text renders in the viewer language', () => {
    expect(isShowingTranslation(textOf(docOf(tweetHtml('translated'))), 'en')).toBe(true);
    expect(isShowingTranslation(textOf(docOf(tweetHtml('original'))), 'en')).toBe(false);
    expect(isShowingTranslation(textOf(docOf(tweetHtml('plain'))), 'en')).toBe(false);
  });

  test('detection never reads the strip wording — a localized UI works too', () => {
    const html = tweetHtml('translated').replace(/Show original/g, 'Afficher l’original');
    const doc = docOf(html, 'fr');
    // Same fixture, but the translation now renders in French for a French viewer.
    textOf(doc).setAttribute('lang', 'fr');
    expect(isShowingTranslation(textOf(doc), viewerLangOf(doc))).toBe(true);
  });

  test('a missing lang attribute reads as not-translated, so nothing is clicked', () => {
    const doc = docOf(tweetHtml('translated'));
    textOf(doc).removeAttribute('lang');
    expect(isShowingTranslation(textOf(doc), 'en')).toBe(false);
    expect(showOriginalButton(textOf(doc), 'en')).toBeNull();
  });
});

describe('findShowOriginalButtons', () => {
  test('returns one button per translated tweet and skips the rest', () => {
    const doc = docOf(
      tweetHtml('translated', 'a') +
        tweetHtml('original', 'b') +
        tweetHtml('plain', 'c') +
        tweetHtml('translated', 'd'),
    );
    const btns = findShowOriginalButtons(doc, viewerLangOf(doc));
    expect(btns).toHaveLength(2);
    for (const b of btns) expect(b.getAttribute('aria-label')).toBe('Show original');
  });

  test('clicking is what the caller does, and a re-scan then finds nothing', () => {
    // Mirrors the live toggle: the same node keeps its identity, its lang flips
    // to the source language and the strip becomes "Show translation".
    const doc = docOf(tweetHtml('translated', 'こんにちは'));
    const before = findShowOriginalButtons(doc, 'en');
    expect(before).toHaveLength(1);
    const txtEl = textOf(doc);
    before[0]?.addEventListener('click', () => {
      txtEl.setAttribute('lang', 'ja');
      const strip = txtEl.previousElementSibling?.querySelector('button');
      strip?.setAttribute('aria-label', 'Show translation');
    });
    before[0]?.click();
    expect(findShowOriginalButtons(doc, 'en')).toHaveLength(0);
    expect(textOf(doc).getAttribute('lang')).toBe('ja');
  });

  test('empty document yields no work', () => {
    expect(findShowOriginalButtons(docOf(''), 'en')).toHaveLength(0);
  });
});
