// Channel keyword auto-suggest (CIRCLES-PLAN C8). Pure and $0: each channel
// carries an optional keyword list; matching a tweet's/idea's text against
// those keywords proposes channels, and a human always confirms the tag. Shared
// between the server (aggregate/tests) and the extension (save-to-stratus chips
// and the panel tag pickers) — extension/src/channelSuggest.ts is a re-export
// shim Vite inlines, same arrangement as replyBand.ts.

export interface ChannelKeywords {
  slug: string;
  keywords: string[] | null;
}

const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// A keyword matches on word boundaries so "ai" doesn't fire on "maintain".
// Keywords may be phrases ("claude code") or hashtags ("#buildinpublic") —
// anything non-alphanumeric at the edges counts as a boundary.
function keywordMatches(keyword: string, lowerText: string): boolean {
  const kw = keyword.trim().toLowerCase();
  if (kw === '') return false;
  const re = new RegExp(`(^|[^a-z0-9])${escapeRegExp(kw)}([^a-z0-9]|$)`, 'i');
  return re.test(lowerText);
}

/** Channels whose keywords match the text, best match first (most keyword hits,
 *  slug asc as tie-break). Channels without keywords never self-suggest. */
export function suggestChannels(text: string, channels: ChannelKeywords[]): string[] {
  const lower = text.toLowerCase();
  if (lower.trim() === '') return [];
  const scored: { slug: string; hits: number }[] = [];
  for (const ch of channels) {
    if (!ch.keywords || ch.keywords.length === 0) continue;
    let hits = 0;
    for (const kw of ch.keywords) if (keywordMatches(kw, lower)) hits++;
    if (hits > 0) scored.push({ slug: ch.slug, hits });
  }
  scored.sort((a, b) => b.hits - a.hits || a.slug.localeCompare(b.slug));
  return scored.map((s) => s.slug);
}
