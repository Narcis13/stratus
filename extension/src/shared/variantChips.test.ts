import { describe, expect, test } from 'bun:test';
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

  test('rejects an empty array, junk, and malformed entries', () => {
    expect(isReplyVariants([])).toBe(false);
    expect(isReplyVariants(null)).toBe(false);
    expect(isReplyVariants('nope')).toBe(false);
    expect(isReplyVariants([{ text: 'a' }])).toBe(false);
    expect(isReplyVariants([{ text: 1, angle: 'extends' }])).toBe(false);
    expect(isReplyVariants([{ angle: 'extends' }])).toBe(false);
  });
});
