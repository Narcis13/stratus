// Notification-cell parser for the x.com/notifications surface (CIRCLES C10).
// Likes, reposts and follows are the only relationship signals stratus never
// sees, and they are free in this tab's DOM. This module is the pure,
// fixture-tested core (the earlyReplies.ts pattern); the batching + transport
// plumbing lives in content.ts (NT.5).
//
// Kind detection is icon-first on purpose: the leading glyph is identical in
// every locale, so a Romanian UI still classifies correctly. The en+ro keyword
// fallback only runs when the glyph is unrecognised, and a cell nothing
// matches parses as 'other' — the caller drops those, never sends them.
//
// Dependency-free by contract: this module gets inlined into the content-script
// IIFE (§7.26), so it duplicates the small handle regex instead of importing it.

export type EngagementKind = 'like' | 'repost' | 'follow' | 'other';

export interface ParsedNotification {
  kind: EngagementKind;
  /** Lowercased, deduped, in DOM order. Aggregated cells show ~8 avatars max. */
  handles: string[];
  /** The post the engagement is on, as scraped (may be truncated by X). */
  targetText: string | null;
}

// Leading-glyph `d` prefixes in X's 24×24 icon viewbox. Prefixes rather than
// whole paths: X ships minor path revisions without changing the shape.
// NOT YET VERIFIED against the live DOM — NT.5's browser walk confirms them;
// until then the keyword fallback carries classification, which is why an
// unrecognised glyph must degrade silently instead of forcing 'other'.
export const LIKE_ICON_PREFIXES = ['M16.697 5.5', 'M20.884 13.19'];
export const REPOST_ICON_PREFIXES = ['M4.5 3.88'];
export const FOLLOW_ICON_PREFIXES = ['M12 11.816'];

// Verb stems, lowercased. Order of the three checks is load-bearing: a follow
// cell never carries post text, so the loose `urmăre` stem is only reachable
// after the like/repost phrases have failed.
const LIKE_WORDS = ['liked', 'apreciat'];
const REPOST_WORDS = ['reposted', 'retweeted', 'redistribuit'];
const FOLLOW_WORDS = ['followed', 'new follower', 'urmăre'];
const ALL_VERB_WORDS = [...LIKE_WORDS, ...REPOST_WORDS, ...FOLLOW_WORDS];

const AVATAR_TESTID_PREFIX = 'UserAvatar-Container-';
const HANDLE_RE = /^[A-Za-z0-9_]{1,15}$/;
const TRAILING_ELLIPSIS_RE = /(?:…|\.\.\.)+$/;

function detectKindFromIcon(article: Element): EngagementKind | null {
  const d = article.querySelector('svg path')?.getAttribute('d')?.trim();
  if (!d) return null;
  if (LIKE_ICON_PREFIXES.some((p) => d.startsWith(p))) return 'like';
  if (REPOST_ICON_PREFIXES.some((p) => d.startsWith(p))) return 'repost';
  if (FOLLOW_ICON_PREFIXES.some((p) => d.startsWith(p))) return 'follow';
  return null;
}

function detectKindFromWords(text: string): EngagementKind | null {
  const t = text.toLowerCase();
  if (t === '') return null;
  if (LIKE_WORDS.some((w) => t.includes(w))) return 'like';
  if (REPOST_WORDS.some((w) => t.includes(w))) return 'repost';
  if (FOLLOW_WORDS.some((w) => t.includes(w))) return 'follow';
  return null;
}

/** The cell's first directional text block — X renders the "A and 2 others
 *  liked your post" line before the quoted post, so this is the header. */
function headerText(article: Element): string {
  return article.querySelector('[dir]')?.textContent?.trim() ?? '';
}

function parseHandles(article: Element): string[] {
  const handles: string[] = [];
  const seen = new Set<string>();
  for (const el of article.querySelectorAll(`[data-testid^="${AVATAR_TESTID_PREFIX}"]`)) {
    const raw = (el.getAttribute('data-testid') ?? '').slice(AVATAR_TESTID_PREFIX.length);
    if (!HANDLE_RE.test(raw)) continue;
    const handle = raw.toLowerCase();
    // X renders a placeholder container for users it hasn't resolved yet.
    if (handle === 'unknown' || seen.has(handle)) continue;
    seen.add(handle);
    handles.push(handle);
  }
  return handles;
}

function parseTargetText(article: Element): string | null {
  let best = '';
  for (const el of article.querySelectorAll('[dir="auto"]')) {
    const raw = el.textContent?.trim() ?? '';
    if (raw === '') continue;
    const lower = raw.toLowerCase();
    if (ALL_VERB_WORDS.some((w) => lower.includes(w))) continue;
    if (raw.length > best.length) best = raw;
  }
  const cleaned = best.replace(TRAILING_ELLIPSIS_RE, '').trim();
  return cleaned === '' ? null : cleaned;
}

/** Parse one `article[data-testid="notification"]` cell. Returns null for any
 *  element that isn't such a cell, so a caller can pass articles blindly. */
export function parseNotificationCell(article: Element): ParsedNotification | null {
  if (article.getAttribute('data-testid') !== 'notification') return null;

  const kind =
    detectKindFromIcon(article) ??
    detectKindFromWords(headerText(article)) ??
    detectKindFromWords(article.textContent ?? '') ??
    'other';

  // A follow cell carries no target post; any prose there is the follower's
  // bio, which must never be handed to the server's target resolution.
  const targetText = kind === 'follow' ? null : parseTargetText(article);

  return { kind, handles: parseHandles(article), targetText };
}
