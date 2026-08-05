// X's machine translation, and how to get the original text back.
//
// When the viewer has translations enabled, X does NOT render the translation
// beside the original — it REPLACES the tweet's text in place: the same
// `div[data-testid="tweetText"]` node keeps its identity but its innerText
// becomes the translation and its `lang` flips to the viewer's display
// language. The source text is not in the DOM at all. A harvest that reads
// tweetText therefore stores English for a Japanese tweet, silently, with no
// marker (that is how `harvest_rows.orig_text` filled up with translated
// targets while the replies themselves stayed in their original language —
// the reply author's own tweets were simply never offered a translation).
//
// X keeps the original client-side: clicking the banner's "Show original"
// restores the SAME node's text and `lang` with no network call, landing on
// the next macrotask. So un-translating is a click plus a settle, not a fetch.
//
// This module is the pure DOM reader (§7.27 — the scroll engine around it is
// browser-verified by convention, this part gets fixture tests). It decides
// which nodes are showing a translation and hands back the buttons to click;
// it never clicks anything itself.

const TWEET_TEXT = 'div[data-testid="tweetText"]';

/** The viewer's display language as a base subtag ('en' from 'en-GB'). X sets
 *  it on <html>. A translation always renders in THIS language — that is the
 *  language-independent half of the detection below. */
export function viewerLangOf(doc: Document): string {
  const raw = doc.documentElement?.getAttribute('lang') ?? '';
  return baseLang(raw) || 'en';
}

function baseLang(raw: string | null | undefined): string {
  if (typeof raw !== 'string') return '';
  const tag = raw.trim().toLowerCase();
  const dash = tag.indexOf('-');
  return dash === -1 ? tag : tag.slice(0, dash);
}

/** The "Translated from X / Show original" strip X renders immediately before
 *  the tweet text, or null. Identified structurally, never by its wording —
 *  the strip is localized ("Translated from Japanese" only in an English UI).
 *  The no-tweetText guard is what stops a preceding tweet body or a quote card
 *  from being mistaken for the banner. */
export function translationBanner(txtEl: Element): Element | null {
  const prev = txtEl.previousElementSibling;
  if (!prev) return null;
  if (prev.querySelector(TWEET_TEXT)) return null;
  return prev.querySelector('[role="button"], button') ? prev : null;
}

/** True when this tweet text is currently showing a machine translation.
 *
 *  The rule is `banner present && text rendered in the viewer's language`, and
 *  it holds in both directions without reading a single localized string:
 *  translated → lang is the viewer's; original shown → lang is the source's;
 *  no banner at all → X never offered a translation (including the case where
 *  the tweet is already in the viewer's language). A missing `lang` reads as
 *  "not translated", which keeps the pre-existing behaviour rather than
 *  clicking something we did not understand. */
export function isShowingTranslation(txtEl: Element, viewerLang: string): boolean {
  if (!translationBanner(txtEl)) return false;
  const lang = baseLang(txtEl.getAttribute('lang'));
  return lang !== '' && lang === viewerLang;
}

/** What the caller needs off the button and all a fixture has to fake — typing
 *  it structurally instead of as HTMLElement keeps this module realm-agnostic,
 *  so the happy-dom tests exercise the same code the content script runs. */
export interface Clickable extends Element {
  click(): void;
}

/** The "Show original" control for a translated tweet text, or null when the
 *  text is not currently translated. */
export function showOriginalButton(txtEl: Element, viewerLang: string): Clickable | null {
  if (!isShowingTranslation(txtEl, viewerLang)) return null;
  const banner = translationBanner(txtEl);
  const btn = banner?.querySelector('[role="button"], button') ?? null;
  return btn && typeof (btn as Clickable).click === 'function' ? (btn as Clickable) : null;
}

/** Every "Show original" control among the tweet texts currently rendered under
 *  `root`. Callers click these, wait one settle, then read the articles. */
export function findShowOriginalButtons(root: ParentNode, viewerLang: string): Clickable[] {
  const out: Clickable[] = [];
  for (const txtEl of Array.from(root.querySelectorAll(TWEET_TEXT))) {
    const btn = showOriginalButton(txtEl, viewerLang);
    if (btn) out.push(btn);
  }
  return out;
}
