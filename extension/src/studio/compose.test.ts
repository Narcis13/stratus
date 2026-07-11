// S3.1 composition engine — the pure 20% that's hard: text wrap / shrink-to-fit
// / ellipsis over an injected MeasureFn (fake metrics: width = chars × size ×
// 0.6, so every expectation is arithmetic), plus color math and sparkline
// normalization. The canvas half of compose.ts is deliberately untested here —
// determinism lives in these functions.

import { describe, expect, test } from 'bun:test';
import {
  type MeasureFn,
  contrastOn,
  hexToRgb,
  layoutText,
  shade,
  sparklineCoords,
  withAlpha,
  wrapLine,
} from './compose.ts';

// Every char is 0.6em wide → at size 10, a 100px box fits 16 chars per line.
const measure: MeasureFn = (text, sizePx) => text.length * sizePx * 0.6;

describe('wrapLine', () => {
  test('fits short text on one line', () => {
    expect(wrapLine('hello world', 10, 100, measure)).toEqual(['hello world']);
  });

  test('wraps greedily at word boundaries', () => {
    // 16 chars max per line at size 10 / width 100.
    expect(wrapLine('one two three four five', 10, 100, measure)).toEqual([
      'one two three',
      'four five',
    ]);
  });

  test('collapses runs of spaces', () => {
    expect(wrapLine('a   b', 10, 100, measure)).toEqual(['a b']);
  });

  test('hard-breaks a word wider than the box by characters', () => {
    // 5 chars per line at width 30.
    expect(wrapLine('abcdefghijkl', 10, 30, measure)).toEqual(['abcde', 'fghij', 'kl']);
  });

  test('hard-break also applies mid-paragraph', () => {
    expect(wrapLine('ok abcdefghij', 10, 30, measure)).toEqual(['ok', 'abcde', 'fghij']);
  });

  test('empty input stays a single empty line', () => {
    expect(wrapLine('', 10, 100, measure)).toEqual(['']);
  });
});

describe('layoutText', () => {
  test('keeps the target size when everything fits', () => {
    const out = layoutText(
      { text: 'short', maxWidth: 400, maxHeight: 100, fontSizePx: 40, minSizePx: 20 },
      measure,
    );
    expect(out.fontSizePx).toBe(40);
    expect(out.lines).toEqual(['short']);
    expect(out.truncated).toBe(false);
  });

  test('preserves explicit newlines and blank lines', () => {
    const out = layoutText(
      { text: 'one\n\ntwo', maxWidth: 400, maxHeight: 400, fontSizePx: 20 },
      measure,
    );
    expect(out.lines).toEqual(['one', '', 'two']);
  });

  test('shrinks until the block fits the box height', () => {
    // 40 chars: at size 40 (24px/char) only ~16 chars/line in 400px → 3 lines
    // × 52px > 110px box, so it must shrink; at some smaller size it fits.
    const text = 'aaaa bbbb cccc dddd eeee ffff gggg hhhh';
    const out = layoutText(
      { text, maxWidth: 400, maxHeight: 110, fontSizePx: 40, minSizePx: 16 },
      measure,
    );
    expect(out.truncated).toBe(false);
    expect(out.fontSizePx).toBeLessThan(40);
    expect(out.fontSizePx).toBeGreaterThanOrEqual(16);
    expect(out.lines.length * out.lineHeightPx).toBeLessThanOrEqual(110.5);
    for (const line of out.lines) {
      expect(measure(line, out.fontSizePx)).toBeLessThanOrEqual(400);
    }
  });

  test('maxLines forces shrinking too', () => {
    const text = 'aaaa bbbb cccc dddd eeee ffff';
    const out = layoutText(
      { text, maxWidth: 300, maxHeight: 10_000, fontSizePx: 40, minSizePx: 10, maxLines: 2 },
      measure,
    );
    expect(out.truncated).toBe(false);
    expect(out.lines.length).toBeLessThanOrEqual(2);
  });

  test('ellipsizes at the floor when nothing fits', () => {
    const text = 'word '.repeat(200).trim();
    const out = layoutText(
      { text, maxWidth: 200, maxHeight: 80, fontSizePx: 30, minSizePx: 20 },
      measure,
    );
    expect(out.truncated).toBe(true);
    expect(out.fontSizePx).toBe(20);
    expect(out.lines.length * out.lineHeightPx).toBeLessThanOrEqual(80.5);
    const last = out.lines[out.lines.length - 1] as string;
    expect(last.endsWith('…')).toBe(true);
    expect(measure(last, 20)).toBeLessThanOrEqual(200);
  });

  test('no shrinking when minSizePx is omitted — straight to ellipsis', () => {
    const out = layoutText(
      { text: 'word '.repeat(50).trim(), maxWidth: 200, maxHeight: 40, fontSizePx: 30 },
      measure,
    );
    expect(out.truncated).toBe(true);
    expect(out.fontSizePx).toBe(30);
  });

  test('a minSizePx above fontSizePx is clamped down (never grows)', () => {
    const out = layoutText(
      { text: 'hi', maxWidth: 400, maxHeight: 100, fontSizePx: 20, minSizePx: 60 },
      measure,
    );
    expect(out.fontSizePx).toBe(20);
  });

  test('always returns at least one line, even in an impossible box', () => {
    const out = layoutText(
      { text: 'something long enough to overflow', maxWidth: 50, maxHeight: 1, fontSizePx: 30 },
      measure,
    );
    expect(out.lines.length).toBe(1);
    expect(out.truncated).toBe(true);
  });
});

describe('color helpers', () => {
  test('hexToRgb parses #rgb and #rrggbb, rejects garbage', () => {
    expect(hexToRgb('#fff')).toEqual({ r: 255, g: 255, b: 255 });
    expect(hexToRgb('#1d9bf0')).toEqual({ r: 29, g: 155, b: 240 });
    expect(hexToRgb('blue')).toBeNull();
    expect(hexToRgb('#12345')).toBeNull();
  });

  test('contrastOn picks dark ink on light, light ink on dark', () => {
    expect(contrastOn('#ffffff')).toBe('#0f1419');
    expect(contrastOn('#0f1419')).toBe('#f7f9f9');
    expect(contrastOn('not-a-color')).toBe('#f7f9f9');
  });

  test('shade darkens and lightens symmetrically', () => {
    expect(shade('#808080', -0.5)).toBe('#404040');
    expect(shade('#808080', 0.5)).toBe('#c0c0c0');
    expect(shade('#808080', 0)).toBe('#808080');
  });

  test('withAlpha emits rgba and clamps', () => {
    expect(withAlpha('#1d9bf0', 0.5)).toBe('rgba(29, 155, 240, 0.5)');
    expect(withAlpha('#1d9bf0', 2)).toBe('rgba(29, 155, 240, 1)');
  });
});

describe('sparklineCoords', () => {
  const box = { x: 10, y: 20, w: 100, h: 50 };

  test('below two points there is no line', () => {
    expect(sparklineCoords([], box)).toEqual([]);
    expect(sparklineCoords([5], box)).toEqual([]);
  });

  test('normalizes min→bottom, max→top, evenly spaced x', () => {
    const out = sparklineCoords([0, 5, 10], box);
    expect(out).toEqual([
      { x: 10, y: 70 },
      { x: 60, y: 45 },
      { x: 110, y: 20 },
    ]);
  });

  test('a flat series sits on the baseline instead of dividing by zero', () => {
    const out = sparklineCoords([7, 7], box);
    expect(out.map((p) => p.y)).toEqual([70, 70]);
  });
});
