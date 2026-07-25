// S5.6 code tokenizer — pure, so we assert the exact token splits. Not a real
// highlighter; the point is stable, kit-agnostic categorization the code card
// colors by.

import { describe, expect, test } from 'bun:test';
import { MONO_ADVANCE, type Token, tokenizeLine } from './codeTokens.ts';

const kinds = (toks: Token[]): string[] => toks.map((t) => t.kind);
const texts = (toks: Token[]): string[] => toks.map((t) => t.text);

describe('tokenizeLine', () => {
  test('keyword + plain + number', () => {
    const toks = tokenizeLine('const x = 1');
    expect(kinds(toks)).toEqual(['keyword', 'plain', 'number']);
    expect(texts(toks)).toEqual(['const', ' x = ', '1']);
  });

  test('string literal (double, single, backtick)', () => {
    expect(tokenizeLine('return "hi"')).toEqual([
      { text: 'return', kind: 'keyword' },
      { text: ' ', kind: 'plain' },
      { text: '"hi"', kind: 'string' },
    ]);
    expect(tokenizeLine("x = 'ab'").at(-1)).toEqual({ text: "'ab'", kind: 'string' });
    expect(tokenizeLine('t = `q`').at(-1)).toEqual({ text: '`q`', kind: 'string' });
  });

  test('escaped quote does not end the string early', () => {
    const toks = tokenizeLine('"a\\"b"');
    expect(toks).toEqual([{ text: '"a\\"b"', kind: 'string' }]);
  });

  test('line comments — // and #', () => {
    expect(tokenizeLine('foo() // note').at(-1)).toEqual({ text: '// note', kind: 'comment' });
    expect(tokenizeLine('# py comment')).toEqual([{ text: '# py comment', kind: 'comment' }]);
  });

  test('numbers — int, float, hex', () => {
    expect(tokenizeLine('42').at(0)).toEqual({ text: '42', kind: 'number' });
    expect(tokenizeLine('3.14').at(0)).toEqual({ text: '3.14', kind: 'number' });
    expect(tokenizeLine('0xFF').at(0)).toEqual({ text: '0xFF', kind: 'number' });
    // digits inside an identifier stay part of the identifier (plain)
    expect(tokenizeLine('abc1')).toEqual([{ text: 'abc1', kind: 'plain' }]);
  });

  test('no-match passthrough collapses to a single plain run', () => {
    expect(tokenizeLine('a + b')).toEqual([{ text: 'a + b', kind: 'plain' }]);
  });

  test('empty line → no tokens', () => {
    expect(tokenizeLine('')).toEqual([]);
  });

  test('deterministic — same input, same tokens', () => {
    const line = 'export const n = 10 // ten';
    expect(tokenizeLine(line)).toEqual(tokenizeLine(line));
  });

  test('column widths are the sum of token lengths (drives the x-math)', () => {
    const line = 'const x = 42';
    const cols = tokenizeLine(line).reduce((n, t) => n + t.text.length, 0);
    expect(cols).toBe(line.length);
  });

  test('MONO_ADVANCE is the JetBrains Mono 600/1000 ratio', () => {
    expect(MONO_ADVANCE).toBeCloseTo(0.6, 5);
  });
});
