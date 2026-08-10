// Does this tweet's author carry the verified badge? (RS.3)
//
// The DOM half of the sweep's `verifiedOnly` filter — `passesSweep` owns the
// RULE (src/shared/radarSweep.ts), this owns the READ. Split for the usual
// reason (the notifications.ts / earlyReplies.ts pattern): a pure,
// fixture-tested core here, the browser plumbing in content.ts.
//
// Dependency-free by contract — this gets inlined into the content-script IIFE
// (§7.26).
//
// **X owns this markup and it will drift.** Every structural assumption is a
// named constant below (the activeTimes.ts rule) so a drift is one edit in one
// place. The primary match is STRUCTURAL — X's own `icon-verified` testid, no
// text involved. The aria-label fallback is a second chance at a testid rename
// on an English UI and NOT a locale-proof rule (a Romanian "Cont verificat"
// does not carry the substring; a fixture pins that limit rather than hiding
// it). The fixtures pin the parser; only a live x.com scroll can pin the
// selector, which is why the plan's browser pass has to see one admit AND one
// refuse in the same scroll.
//
// The failure direction is chosen, not accidental: `passesSweep` reads `null`
// (and `false`) as a REFUSAL under `verifiedOnly`, so a drifted selector shows
// up as a visibly empty Radar queue rather than as a filter that silently
// stopped filtering.

/** The author's name line. Scoping to the FIRST one in the article is what
 *  keeps a quoted tweet's verified author from vouching for the outer post —
 *  a quote card renders its own `User-Name` block deeper in the same article. */
export const NAME_BLOCK_SELECTOR = '[data-testid="User-Name"]';

/** Ordered: the testid is X's own hook and the cheapest true positive; the
 *  aria-label substring is the fallback that survives a testid rename. The
 *  substring is deliberately missing its first letter ("erified") so it matches
 *  both `Verified account` and `verified`; `i` covers the rest. */
export const VERIFIED_BADGE_SELECTORS = [
  'svg[data-testid="icon-verified"]',
  'svg[aria-label*="erified" i]',
];

/** `true` = badge found on the author's own name line. `false` = the name line
 *  is there and no badge matched. `null` = **unknown** (§7.11): the name block
 *  itself was unreadable, so there was nothing to read — which is not the same
 *  claim as "not verified", and the sweep's gate treats both as a refusal. */
export function readVerified(article: Element): boolean | null {
  const nameBlock = article.querySelector(NAME_BLOCK_SELECTOR);
  if (!nameBlock) return null;
  for (const selector of VERIFIED_BADGE_SELECTORS) {
    if (nameBlock.querySelector(selector)) return true;
  }
  return false;
}
