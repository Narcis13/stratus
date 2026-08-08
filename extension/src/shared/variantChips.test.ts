import { describe, expect, test } from 'bun:test';
import type { ReplyVariant } from './types.ts';
import { isReplyVariants, variantChipPreview } from './variantChips.ts';

describe('variantChipPreview', () => {
  test('returns short text unchanged', () => {
    expect(variantChipPreview('short reply')).toBe('short reply');
  });

  test('collapses whitespace and newlines to single spaces', () => {
    expect(variantChipPreview('multi\n\nline   text')).toBe('multi line text');
  });

  test('truncates over-long text to `max` chars with an ellipsis', () => {
    const out = variantChipPreview('a'.repeat(100), 60);
    expect(out.length).toBe(60);
    expect(out.endsWith('…')).toBe(true);
  });

  test('trims trailing whitespace before the ellipsis', () => {
    // char at index 9 is a space; slice(0, 9) then trimEnd drops it.
    expect(variantChipPreview('123456789 abcdef', 10)).toBe('123456789…');
  });
});

describe('isReplyVariants', () => {
  test('accepts a non-empty array of { text, angle }', () => {
    expect(
      isReplyVariants([
        { text: 'a', angle: 'extends' },
        { text: 'b', angle: 'debate' },
      ]),
    ).toBe(true);
  });

  test('tolerates an unknown angle string (looser-client-cache)', () => {
    expect(isReplyVariants([{ text: 'a', angle: 'future-angle' }])).toBe(true);
  });

  // RC.4: the two new angles arrive over the same message channel as the old
  // three, and `ReplyAngle` is now re-exported from the shared taxonomy instead
  // of being spelled out here. The annotation below documents that; it does NOT
  // prove it, because tsconfig.app.json excludes `*.test.ts` from the project —
  // the type is checked at the panel's real consumers (radar.ts, messages.ts).
  test('accepts the RC.4 angles, typed as the shared union', () => {
    const variants: ReplyVariant[] = [
      { text: 'the ear twitch at 0:04', angle: 'observation', gloss: null },
      { text: 'which one did you keep?', angle: 'question', gloss: null },
    ];
    expect(isReplyVariants(variants)).toBe(true);
    expect(variants.map((v) => v.angle)).toEqual(['observation', 'question']);
  });

  test('rejects an empty array, junk, and malformed entries', () => {
    expect(isReplyVariants([])).toBe(false);
    expect(isReplyVariants(null)).toBe(false);
    expect(isReplyVariants('nope')).toBe(false);
    expect(isReplyVariants([{ text: 'a' }])).toBe(false);
    expect(isReplyVariants([{ text: 1, angle: 'extends' }])).toBe(false);
    expect(isReplyVariants([{ angle: 'extends' }])).toBe(false);
  });
});
