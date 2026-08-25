import { describe, expect, test } from 'bun:test';
import { mergeTerms } from './outlierSeed.ts';

describe('mergeTerms', () => {
  test('appends after the existing terms, in order', () => {
    const out = mergeTerms(['bun', 'sqlite'], ['drizzle'], 20);
    expect(out.terms).toEqual(['bun', 'sqlite', 'drizzle']);
    expect(out.added).toBe(1);
    expect(out.dropped).toBe(0);
  });

  test('dedupes case-insensitively — the key parseSearchQuery uses', () => {
    const out = mergeTerms(['Bun'], ['bun', 'BUN', 'drizzle'], 20);
    expect(out.terms).toEqual(['Bun', 'drizzle']);
    expect(out.added).toBe(1);
  });

  test('trims and drops blanks on both sides', () => {
    const out = mergeTerms(['  bun  ', ''], [' ', ' drizzle '], 20);
    expect(out.terms).toEqual(['bun', 'drizzle']);
  });

  test('a seed that is already there adds nothing and drops nothing', () => {
    const out = mergeTerms(['bun', 'drizzle'], ['drizzle', 'bun'], 20);
    expect(out.terms).toEqual(['bun', 'drizzle']);
    expect(out.added).toBe(0);
    expect(out.dropped).toBe(0);
  });

  test('truncates at the cap and reports the incoming terms it cut', () => {
    const out = mergeTerms(['a', 'b'], ['c', 'd', 'e'], 3);
    expect(out.terms).toEqual(['a', 'b', 'c']);
    expect(out.added).toBe(1);
    expect(out.dropped).toBe(2);
  });

  test('existing terms already past the cap are not counted as dropped', () => {
    // They were not compiling before this click either — the seed did not lose them.
    const out = mergeTerms(['a', 'b', 'c'], ['d'], 2);
    expect(out.terms).toEqual(['a', 'b']);
    expect(out.added).toBe(0);
    expect(out.dropped).toBe(1);
  });

  test('an empty seed is a no-op', () => {
    const out = mergeTerms(['bun'], [], 20);
    expect(out.terms).toEqual(['bun']);
    expect(out.added).toBe(0);
  });
});
