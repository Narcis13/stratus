import { describe, expect, test } from 'bun:test';
import {
  LANGUAGE_PROFILES,
  MAX_WEIGHTED,
  detectScript,
  resolveLanguageProfile,
  weightedLength,
} from './language.ts';

/** Codepoint count — what `.length` should have been. */
const cp = (s: string) => [...s].length;

describe('weightedLength', () => {
  test('pure ASCII weighs one per character', () => {
    expect(weightedLength('')).toBe(0);
    expect(weightedLength('hello world')).toBe(11);
    expect(weightedLength('a'.repeat(280))).toBe(MAX_WEIGHTED);
  });

  test('Japanese weighs two per character (~140 real characters)', () => {
    expect(weightedLength('こんにちは')).toBe(10);
    const s = 'これはテストです';
    expect(weightedLength(s)).toBe(2 * s.length);
    expect(weightedLength('漢字')).toBe(4);
  });

  test('Arabic weighs ONE per codepoint — the finding the profile table exists for', () => {
    expect(weightedLength('مرحبا')).toBe(5);
    const s = 'مرحبا بالعالم';
    expect(weightedLength(s)).toBe(cp(s));
  });

  test('Cyrillic and Hebrew are weight 1 too', () => {
    expect(weightedLength('привет')).toBe(6);
    expect(weightedLength('שלום')).toBe(4);
  });

  test('an emoji weighs 2 and counts as ONE codepoint, not two UTF-16 units', () => {
    expect('😀'.length).toBe(2); // the bug this replaces
    expect(weightedLength('😀')).toBe(2);
    expect(weightedLength('hi 😀')).toBe(5);
  });

  test('mixed strings add per codepoint', () => {
    // 'AI' 2 + ' ' 1 + 'は' 2 + ' ' 1 + 'good' 4 = 10
    expect(weightedLength('AI は good')).toBe(10);
  });
});

describe('detectScript', () => {
  test('Japanese via kana, even when quoting English', () => {
    expect(detectScript('これはテストです')?.code).toBe('ja');
    expect(detectScript('Claude Code を毎日使っています')?.code).toBe('ja');
  });

  test('kana is what separates ja from zh — Han alone reads zh', () => {
    expect(detectScript('今日は漢字')?.code).toBe('ja'); // kana present, kanji folds in
    expect(detectScript('我每天都在用这个工具')?.code).toBe('zh');
  });

  test('Hangul reads ko, Arabic ar, Cyrillic ru', () => {
    expect(detectScript('안녕하세요 반갑습니다')?.code).toBe('ko');
    expect(detectScript('مرحبا بالعالم')?.code).toBe('ar');
    expect(detectScript('привет мир')?.code).toBe('ru');
    expect(detectScript('שלום עולם')?.code).toBe('he');
  });

  test('English (and Latin-script languages generally) answer null, not a guess', () => {
    expect(detectScript('shipping this today')).toBeNull();
    expect(detectScript('mañana lo enviamos')).toBeNull();
    expect(detectScript('')).toBeNull();
    expect(detectScript('123 !!! 😀')).toBeNull();
  });

  test('a tie answers null', () => {
    expect(detectScript('абв دعو')).toBeNull(); // 3 Cyrillic vs 3 Arabic
    // ...but a real lead still wins: 6 Cyrillic to 5 Arabic is a majority.
    expect(detectScript('привет مرحبا')?.code).toBe('ru');
  });

  test('no simple majority answers null', () => {
    // 3 Cyrillic, 2 Arabic, 2 Hangul: the leader has 3 of 7, under half.
    expect(detectScript('абв دع 안녕')).toBeNull();
  });
});

describe('resolveLanguageProfile', () => {
  test('code, name, case and surrounding space all resolve', () => {
    expect(resolveLanguageProfile('ja')?.code).toBe('ja');
    expect(resolveLanguageProfile('Japanese')?.code).toBe('ja');
    expect(resolveLanguageProfile('JAPANESE')?.code).toBe('ja');
    expect(resolveLanguageProfile('  japanese ')?.code).toBe('ja');
    expect(resolveLanguageProfile('ro')?.code).toBe('ro');
    expect(resolveLanguageProfile('Română')?.code).toBe('ro');
    expect(resolveLanguageProfile('pt-BR')?.code).toBe('pt');
  });

  test('an unknown string is null — never coerced to a near miss', () => {
    expect(resolveLanguageProfile('klingon')).toBeNull();
    expect(resolveLanguageProfile('jap')).toBeNull();
    expect(resolveLanguageProfile('')).toBeNull();
    expect(resolveLanguageProfile(null)).toBeNull();
    expect(resolveLanguageProfile(undefined)).toBeNull();
  });
});

describe('LANGUAGE_PROFILES', () => {
  test('codes are unique', () => {
    const codes = LANGUAGE_PROFILES.map((p) => p.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  test('every profile carries a register axis', () => {
    for (const p of LANGUAGE_PROFILES) {
      expect(p.registerAxis.trim().length).toBeGreaterThan(0);
    }
  });

  test('maxChars is the weighted budget in that language own characters', () => {
    for (const p of LANGUAGE_PROFILES) {
      const expected = p.maxChars === 140 ? 140 : MAX_WEIGHTED;
      expect(p.maxChars).toBe(expected);
      // The budget has to actually fit: maxChars of that script's own weight.
      const weight = p.maxChars === 140 ? 2 : 1;
      expect(p.maxChars * weight).toBe(MAX_WEIGHTED);
    }
  });

  test('Arabic is RTL and keeps the full 280 — the whole point of the table', () => {
    const ar = resolveLanguageProfile('ar');
    expect(ar?.rtl).toBe(true);
    expect(ar?.maxChars).toBe(280);
    expect(resolveLanguageProfile('he')?.rtl).toBe(true);
    expect(resolveLanguageProfile('ja')?.rtl).toBe(false);
    expect(resolveLanguageProfile('ja')?.maxChars).toBe(140);
  });
});
