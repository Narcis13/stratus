// What KIND of tweet is this — does it carry media, and is it an ad?
//
// The DOM half of the sweep's two content gates. `passesContentGates`
// (src/shared/radarSweep.ts) owns the RULE, this owns the READ — the same split
// `verified.ts` takes, and for the same reason: a pure, fixture-tested core
// here, the browser plumbing in content.ts.
//
// Dependency-free by contract — this gets inlined into the content-script IIFE
// (§7.26).
//
// **X owns this markup and it will drift.** Every structural assumption is a
// named constant below (the verified.ts/activeTimes.ts rule) so a drift is one
// edit in one place. Both readers are STRUCTURAL first — X's own testids, no
// text involved — with a text fallback only for the promoted label, where X
// gives nothing else on some cells. That fallback is English-only and a fixture
// pins the limit rather than hiding it.
//
// Neither reader returns `null`: unlike a missing name block, "no media node in
// this article" and "no promoted marker in this article" are complete answers,
// not missing anchors. The consequence is stated in `passesContentGates` and is
// the reason the media gate ships `'any'`: a drift reads as "no media", which
// empties the queue under `'with'` and silently admits media under `'without'`.

/** Media X renders as the tweet's OWN photo/video/GIF. `previewInterstitial` is
 *  the sensitive-media cover — a covered photo is still a photo — and
 *  `videoComponent`/`videoPlayer` are the two names the player has carried
 *  across redesigns; both stay listed because a rename is exactly the drift this
 *  list is here to survive. */
export const MEDIA_SELECTORS = [
  '[data-testid="tweetPhoto"]',
  '[data-testid="videoPlayer"]',
  '[data-testid="videoComponent"]',
  '[data-testid="previewInterstitial"]',
];

/** A link preview's thumbnail is NOT media: the tweet is a link, and the image
 *  is X's own unfurl of it. Anything matching MEDIA_SELECTORS inside one of
 *  these is skipped. A quoted tweet's photo deliberately still counts — the cell
 *  in front of you does show an image, which is the thing the gate is about. */
export const CARD_ANCESTOR_SELECTOR = '[data-testid^="card."]';

/** X's own wrapper around promoted content, and the cheapest true positive. */
export const PROMOTED_SELECTORS = ['[data-testid="placementTracking"]'];

/** Where the "Promoted"/"Ad" label renders when there is no tracking wrapper —
 *  the social-context line above or below the tweet. Text, so English-only:
 *  a Romanian "Promovat" does not match, and a fixture pins that rather than
 *  letting it read as a bug later. Structural matches above are locale-proof. */
export const PROMOTED_TEXT_SELECTORS = ['[data-testid="socialContext"]'];

/** Prefixes that mark a social-context line as an ad, matched case-insensitively
 *  against the trimmed line. `startsWith`, not `includes`: "Promoted by X" is an
 *  ad and "@promoted liked this" is not. */
export const PROMOTED_TEXT_PREFIXES = ['promoted', 'sponsored'];

/** The bare label, which has to match EXACTLY — a `startsWith('ad')` would call
 *  every "Adam liked" line an ad, which is the one false positive this reader
 *  cannot afford: it silently drops a real tweet out of the queue. */
export const PROMOTED_TEXT_EXACT = ['ad'];

/** Does this article carry a photo, video or GIF of its own? `false` = looked
 *  and found none (never `null` — see the header). */
export function readHasMedia(article: Element): boolean {
  for (const selector of MEDIA_SELECTORS) {
    for (const node of Array.from(article.querySelectorAll(selector))) {
      // `closest` from the media node, not a scan of the card: a cell can hold
      // both a real photo and a link card, and only the card's own image is
      // excluded.
      if (node.closest(CARD_ANCESTOR_SELECTOR)) continue;
      return true;
    }
  }
  return false;
}

/** Is this a promoted/sponsored post? Structural first, then the English label.
 *
 *  Most ads never reach a caller that asks: they carry no metrics aria-label and
 *  no `<time>`, so `readTweetCapture` has already returned null. This closes the
 *  ones that do render both. */
export function readPromoted(article: Element): boolean {
  for (const selector of PROMOTED_SELECTORS) {
    if (article.querySelector(selector)) return true;
  }
  for (const selector of PROMOTED_TEXT_SELECTORS) {
    for (const node of Array.from(article.querySelectorAll(selector))) {
      const text = (node.textContent ?? '').trim().toLowerCase();
      if (PROMOTED_TEXT_EXACT.includes(text)) return true;
      if (PROMOTED_TEXT_PREFIXES.some((p) => text.startsWith(p))) return true;
    }
  }
  return false;
}
