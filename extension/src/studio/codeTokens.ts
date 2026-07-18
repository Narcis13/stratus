// Deterministic single-line tokenizer for the Studio code/terminal card
// (SURFACES S5.6). Deliberately NOT a real syntax highlighter — a
// language-agnostic split into a tiny set of token kinds, so `codeCardSpec`
// stays a pure, snapshot-testable spec builder (no canvas, no clock).
//
// The card lays tokens out by FIXED MONOSPACE ADVANCE, not canvas measurement:
// a token at column `c` sits at `x = codeLeft + c * fontSizePx * MONO_ADVANCE`.
// That's why the mono font is bundled — the advance ratio must be identical
// across machines or the columns drift.

export type TokenKind = 'plain' | 'keyword' | 'string' | 'number' | 'comment';

export interface Token {
  text: string;
  kind: TokenKind;
}

/** JetBrains Mono advance-to-em ratio (600 / 1000 units). Exact, not a guess —
 *  verify visually once in the browser (ST.9), but the glyph advance is fixed. */
export const MONO_ADVANCE = 0.6;

// Small, cross-language keyword set (JS/TS + Python + Rust). A word not in here
// is `plain` — we never try to be a full lexer.
const KEYWORDS = new Set([
  'const',
  'let',
  'var',
  'function',
  'return',
  'if',
  'else',
  'for',
  'while',
  'import',
  'export',
  'from',
  'def',
  'class',
  'async',
  'await',
  'fn',
  'pub',
  'use',
  'match',
]);

const NUMBER_RE = /^(?:0[xX][0-9a-fA-F]+|[0-9][0-9_]*(?:\.[0-9]+)?)/;
const IDENT_RE = /^[A-Za-z_][A-Za-z0-9_]*/;

/** Split one line into typed runs. Pure and deterministic — same input always
 *  yields the same token array. Empty line → []. */
export function tokenizeLine(line: string): Token[] {
  const tokens: Token[] = [];
  let plain = '';
  const flushPlain = (): void => {
    if (plain !== '') {
      tokens.push({ text: plain, kind: 'plain' });
      plain = '';
    }
  };

  let i = 0;
  const n = line.length;
  while (i < n) {
    const ch = line[i] as string;

    // Line comment (`//` or `#`) — the rest of the line is one comment token.
    if (ch === '#' || (ch === '/' && line[i + 1] === '/')) {
      flushPlain();
      tokens.push({ text: line.slice(i), kind: 'comment' });
      return tokens;
    }

    // Quoted string — single, double, or backtick; backslash escapes the next
    // char; an unterminated quote runs to end of line.
    if (ch === '"' || ch === "'" || ch === '`') {
      flushPlain();
      let j = i + 1;
      while (j < n && line[j] !== ch) {
        if (line[j] === '\\') j += 1;
        j += 1;
      }
      const end = Math.min(j + 1, n);
      tokens.push({ text: line.slice(i, end), kind: 'string' });
      i = end;
      continue;
    }

    // Number — only when it starts a token (a digit inside `abc1` is part of the
    // identifier, consumed below before we ever reach here).
    if (ch >= '0' && ch <= '9') {
      const num = NUMBER_RE.exec(line.slice(i));
      if (num) {
        flushPlain();
        tokens.push({ text: num[0], kind: 'number' });
        i += num[0].length;
        continue;
      }
    }

    // Identifier / keyword.
    const ident = IDENT_RE.exec(line.slice(i));
    if (ident) {
      const word = ident[0];
      if (KEYWORDS.has(word)) {
        flushPlain();
        tokens.push({ text: word, kind: 'keyword' });
      } else {
        plain += word;
      }
      i += word.length;
      continue;
    }

    // Anything else (punctuation, whitespace) accumulates as plain.
    plain += ch;
    i += 1;
  }
  flushPlain();
  return tokens;
}
