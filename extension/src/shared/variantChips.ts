// Pure helpers for the on-page radar variant chips (RU.7). The content script
// is untested by convention (IIFE-bound DOM code), so the two bits worth
// asserting — the chip preview truncation and the variant-shape guard — live
// here and are bun-tested.

import type { ReplyVariant } from './types.ts';

// One-line preview text for a variant chip. Collapses runs of whitespace and
// newlines to single spaces (the multi-line reply reads cleanly on a chip),
// then clips to `max` chars with a trailing ellipsis. Never exceeds `max`.
export function variantChipPreview(text: string, max = 60): string {
  const collapsed = text.replace(/\s+/g, ' ').trim();
  if (collapsed.length <= max) return collapsed;
  return `${collapsed.slice(0, max - 1).trimEnd()}…`;
}

// Shape guard for a variants payload crossing the message channel or arriving
// from the server fallback: a NON-EMPTY array of { text, angle } (angle stays a
// loose string so a server that grows an angle isn't rejected — the same
// looser-client-cache tolerance as GlanceEntry.stage). An empty array reads as
// "no variants to show", so it fails the guard.
export function isReplyVariants(v: unknown): v is ReplyVariant[] {
  if (!Array.isArray(v) || v.length === 0) return false;
  return v.every((x) => {
    if (!x || typeof x !== 'object') return false;
    const r = x as Record<string, unknown>;
    return typeof r.text === 'string' && typeof r.angle === 'string';
  });
}
