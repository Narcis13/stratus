import { describe, expect, test } from 'bun:test';
import {
  draftLanguage,
  glossFor,
  languageSourceTitle,
  textDirFor,
  weightedRemaining,
} from './replyLanguage.ts';
import type { ReplyVariant } from './types.ts';

const variant = (text: string, gloss: string | null): ReplyVariant => ({
  text,
  angle: 'extends',
  gloss,
});

describe('weightedRemaining', () => {
  test('English counts one per character, same number as before', () => {
    expect(weightedRemaining('')).toBe(280);
    expect(weightedRemaining('a'.repeat(280))).toBe(0);
    expect(weightedRemaining('a'.repeat(281))).toBe(-1);
  });

  test('Japanese is weight 2 — 140 characters fills the budget', () => {
    // The whole point of the task: the old counter said 140 left here.
    expect(weightedRemaining('あ'.repeat(140))).toBe(0);
    expect(weightedRemaining('あ'.repeat(70))).toBe(140);
    expect(weightedRemaining('あ'.repeat(141))).toBe(-2);
  });

  test('Arabic is weight 1 — the full 280, not a halved budget', () => {
    expect(weightedRemaining('ب'.repeat(280))).toBe(0);
  });

  test('an astral codepoint counts once, not twice', () => {
    // '😀' is two UTF-16 units, one codepoint, weight 2.
    expect(weightedRemaining('😀')).toBe(278);
  });
});

describe('draftLanguage', () => {
  test('reads the generate response echo first', () => {
    expect(draftLanguage({ language: 'Japanese', languageSource: 'detected' })).toEqual({
      language: 'Japanese',
      source: 'detected',
    });
  });

  test('falls back to the contextSnapshot stamp for a History row', () => {
    expect(
      draftLanguage({
        language: null,
        languageSource: null,
        contextSnapshot: { language: 'Arabic', languageSource: 'roster' },
      }),
    ).toEqual({ language: 'Arabic', source: 'roster' });
  });

  test('an English draft carries neither and reads null', () => {
    expect(draftLanguage({ language: null, languageSource: null })).toBeNull();
    expect(draftLanguage({ contextSnapshot: {} })).toBeNull();
    expect(draftLanguage({})).toBeNull();
  });

  test('the pair moves together — a language with no source is not an answer', () => {
    expect(draftLanguage({ language: 'Japanese' })).toBeNull();
    expect(draftLanguage({ language: '  ', languageSource: 'explicit' })).toBeNull();
    expect(draftLanguage({ language: 'Japanese', languageSource: 'guessed' as never })).toBeNull();
  });
});

describe('languageSourceTitle', () => {
  test('every source names the rule that fired', () => {
    expect(languageSourceTitle('explicit')).toContain('chose');
    expect(languageSourceTitle('roster')).toContain('roster');
    expect(languageSourceTitle('detected')).toContain('Detected');
  });
});

describe('textDirFor', () => {
  test('rtl only for the languages the profile table marks rtl', () => {
    expect(textDirFor('Arabic')).toBe('rtl');
    expect(textDirFor('he')).toBe('rtl');
  });

  test('everything else renders the markup it always did', () => {
    expect(textDirFor('Japanese')).toBeUndefined();
    expect(textDirFor(null)).toBeUndefined();
    expect(textDirFor(undefined)).toBeUndefined();
    // §7.11: a near miss is not coerced to a profile, so it is not rtl either.
    expect(textDirFor('Arabicish')).toBeUndefined();
  });
});

describe('glossFor', () => {
  const variants = [variant('日本語の返信', 'The Japanese reply, literally.')];

  test('returns the gloss of the variant whose text is in the box', () => {
    expect(glossFor(variants, '日本語の返信')).toBe('The Japanese reply, literally.');
  });

  test('an edited reply loses its gloss rather than keeping a stale one', () => {
    expect(glossFor(variants, '日本語の返信!')).toBeNull();
  });

  test('null/blank/absent glosses render nothing', () => {
    expect(glossFor([variant('plain english', null)], 'plain english')).toBeNull();
    expect(glossFor([variant('plain english', '   ')], 'plain english')).toBeNull();
    // A pre-ML.2 persisted row has no `gloss` key at all.
    expect(glossFor([{ text: 'old', angle: 'extends' } as ReplyVariant], 'old')).toBeNull();
    expect(glossFor(null, 'anything')).toBeNull();
  });
});
