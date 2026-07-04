// Early-reply parser for the Launch Room (CIRCLES-PLAN C7). While the user
// has the freshly-posted tweet open, the replies are already in the DOM — $0.
// This module reads them with the same selectors the rest of the content
// script uses; the streaming/throttle plumbing stays in content.ts.
//
// Scope rules, in DOM order:
//   - only articles AFTER the launch tweet's own article count (everything
//     before it is conversation ancestry, never a reply);
//   - collection stops at the first heading (h2) that follows an article —
//     X's "Discover more" rail sits under such a heading, and its unrelated
//     tweets must not be logged as engagers. (The page's top "Post" heading
//     precedes every article, so it never cuts anything.)
//   - the launch author's own rows are skipped (self-thread segments and my
//     own replies to commenters are not *early repliers*).

import type { EarlyReply } from './launch.ts';

const STATUS_HREF_RE = /(?:^|\/)([A-Za-z0-9_]{1,15})\/status\/(\d+)/;

function parsePermalink(article: Element): { handle: string; tweetId: string } | null {
  const link = article.querySelector<HTMLAnchorElement>('a[href*="/status/"]');
  const href = link?.getAttribute('href');
  const m = href?.match(STATUS_HREF_RE);
  if (!m || !m[1] || !m[2]) return null;
  return { handle: m[1], tweetId: m[2] };
}

export function parseEarlyReplies(
  root: ParentNode,
  launchTweetId: string,
  selfHandle: string | null,
): EarlyReply[] {
  const articles = [...root.querySelectorAll<HTMLElement>('article[data-testid="tweet"]')];
  if (articles.length === 0) return [];

  const FOLLOWING = 4; // Node.DOCUMENT_POSITION_FOLLOWING — root may not be a document

  const focused = articles.find((a) => parsePermalink(a)?.tweetId === launchTweetId) ?? null;

  // First heading that has at least one article before it — the "Discover
  // more" separator. Headings above every article (the page title) don't cut.
  let cutoff: Element | null = null;
  for (const h of root.querySelectorAll('h2')) {
    if (articles.some((a) => (a.compareDocumentPosition(h) & FOLLOWING) !== 0)) {
      cutoff = h;
      break;
    }
  }

  const self = selfHandle?.toLowerCase() ?? null;
  const seen = new Set<string>();
  const replies: EarlyReply[] = [];

  for (const article of articles) {
    // The launch tweet may be virtualized out while its replies remain — when
    // the anchor is present, require the row to follow it.
    if (focused) {
      if (article === focused) continue;
      if ((focused.compareDocumentPosition(article) & FOLLOWING) === 0) continue;
    }
    if (cutoff && (cutoff.compareDocumentPosition(article) & FOLLOWING) !== 0) continue;

    const permalink = parsePermalink(article);
    if (!permalink) continue;
    if (permalink.tweetId === launchTweetId || seen.has(permalink.tweetId)) continue;
    if (self && permalink.handle.toLowerCase() === self) continue;

    const text = article.querySelector('[data-testid="tweetText"]')?.textContent?.trim() ?? '';
    const userNameEl = article.querySelector('[data-testid="User-Name"]');
    const author = userNameEl?.querySelector<HTMLAnchorElement>('a')?.textContent?.trim() || null;
    const postedAt = article.querySelector('time')?.getAttribute('datetime') || null;

    seen.add(permalink.tweetId);
    replies.push({ tweetId: permalink.tweetId, handle: permalink.handle, author, text, postedAt });
  }

  return replies;
}
