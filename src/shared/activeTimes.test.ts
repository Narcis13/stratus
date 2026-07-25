// A3.1 — pure half of the Active-times heatmap parser: color → intensity
// normalization, the JS-weekday ↔ Mon..Sun column mapping, hour-row averaging
// and the re-send equality check. The DOM extraction is fixture-tested in
// extension/src/shared/activeTimes.test.ts (happy-dom lives there).

import { describe, expect, test } from 'bun:test';
import {
  ACTIVE_TIMES_COLS,
  type ActiveTimesGrid,
  audienceScoreFor,
  gridsEqual,
  parseHeatColors,
} from './activeTimes.ts';

function grid24(fill = 0.1): ActiveTimesGrid {
  return {
    cols: ACTIVE_TIMES_COLS,
    rows: 24,
    grid: Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => fill)),
    tzOffsetMin: 0,
    metric: 'likes',
  };
}

describe('parseHeatColors', () => {
  test('min-max normalizes an opaque luminance ramp to 0..1', () => {
    const out = parseHeatColors(
      [['rgb(0, 0, 0)', 'rgb(102, 102, 102)', 'rgb(255, 255, 255)']],
      1,
      3,
    );
    expect(out).not.toBeNull();
    expect(out?.[0]?.[0]).toBeCloseTo(0, 5);
    expect(out?.[0]?.[1]).toBeCloseTo(0.4, 5);
    expect(out?.[0]?.[2]).toBeCloseTo(1, 5);
  });

  test('a single translucent cell switches the whole grid to alpha mode', () => {
    // The a=1 peak of an alpha ramp scores 1 — never its hue's luminance.
    const out = parseHeatColors(
      [['rgba(29, 155, 240, 0.2)', 'rgba(29, 155, 240, 0.6)', 'rgba(29, 155, 240, 1)']],
      1,
      3,
    );
    expect(out?.[0]?.[0]).toBeCloseTo(0, 5);
    expect(out?.[0]?.[1]).toBeCloseTo(0.5, 5);
    expect(out?.[0]?.[2]).toBeCloseTo(1, 5);
  });

  test('all-equal grid reads 0.5 everywhere', () => {
    const out = parseHeatColors(
      [
        ['rgb(10, 20, 30)', 'rgb(10, 20, 30)'],
        ['rgb(10, 20, 30)', 'rgb(10, 20, 30)'],
      ],
      2,
      2,
    );
    expect(out).toEqual([
      [0.5, 0.5],
      [0.5, 0.5],
    ]);
  });

  test('unparseable cells read 0 and do not skew the min-max window', () => {
    const out = parseHeatColors(
      [
        [
          'rgb(51, 51, 51)',
          'rgb(255, 255, 255)',
          'blurple',
          'rgb(255, 255, 255)',
          'rgb(51, 51, 51)',
        ],
      ],
      1,
      5,
    );
    expect(out?.[0]).toEqual([0, 1, 0, 1, 0]);
  });

  test('exactly 20% unparseable still parses; over 20% fails closed', () => {
    const okay = parseHeatColors(
      [['rgb(0,0,0)', 'rgb(255,255,255)', null, 'rgb(0,0,0)', 'rgb(255,255,255)']],
      1,
      5,
    );
    expect(okay).not.toBeNull();
    const over = parseHeatColors([['rgb(0,0,0)', 'rgb(255,255,255)', null, 'nonsense']], 1, 4);
    expect(over).toBeNull();
  });

  test('hex colors parse, including shorthand and alpha hex', () => {
    const ramp = parseHeatColors([['#000', '#666666', '#fff']], 1, 3);
    expect(ramp?.[0]?.[0]).toBeCloseTo(0, 5);
    expect(ramp?.[0]?.[1]).toBeCloseTo(0.4, 5);
    expect(ramp?.[0]?.[2]).toBeCloseTo(1, 5);

    const alpha = parseHeatColors([['#1d9bf033', '#1d9bf080', '#1d9bf0ff']], 1, 3);
    expect(alpha?.[0]?.[0]).toBeCloseTo(0, 5);
    expect(alpha?.[0]?.[1]).toBeCloseTo((0x80 / 255 - 0.2) / 0.8, 3);
    expect(alpha?.[0]?.[2]).toBeCloseTo(1, 5);
  });

  test('space-separated rgb syntax and transparent parse as alpha', () => {
    const out = parseHeatColors(
      [['rgb(29 155 240 / 0.5)', 'transparent', 'rgb(29 155 240 / 1)']],
      1,
      3,
    );
    expect(out?.[0]?.[0]).toBeCloseTo(0.5, 5);
    expect(out?.[0]?.[1]).toBeCloseTo(0, 5);
    expect(out?.[0]?.[2]).toBeCloseTo(1, 5);
  });

  test('dimension mismatches fail closed', () => {
    expect(parseHeatColors([['rgb(0,0,0)']], 2, 1)).toBeNull();
    expect(parseHeatColors([['rgb(0,0,0)'], ['rgb(0,0,0)', 'rgb(0,0,0)']], 2, 1)).toBeNull();
    expect(parseHeatColors([], 0, 0)).toBeNull();
  });
});

describe('audienceScoreFor', () => {
  test('Monday is column 0 (jsWeekday 1)', () => {
    const grid = grid24();
    const col0 = grid.grid[0];
    if (col0) col0[10] = 0.9;
    expect(audienceScoreFor(grid, 1, 10)).toBeCloseTo(0.9, 5);
  });

  test('Sunday is column 6 (jsWeekday 0)', () => {
    const grid = grid24();
    const col6 = grid.grid[6];
    if (col6) col6[5] = 0.7;
    expect(audienceScoreFor(grid, 0, 5)).toBeCloseTo(0.7, 5);
  });

  test('48-row grids average the two half-hour rows of the hour', () => {
    const grid: ActiveTimesGrid = {
      ...grid24(),
      rows: 48,
      grid: Array.from({ length: 7 }, () => Array.from({ length: 48 }, () => 0.1)),
    };
    const wed = grid.grid[2];
    if (wed) {
      wed[16] = 0.2;
      wed[17] = 0.6;
    }
    expect(audienceScoreFor(grid, 3, 8)).toBeCloseTo(0.4, 5);
  });

  test('24-row grids pass the hour row through', () => {
    const grid = grid24();
    const col = grid.grid[4];
    if (col) col[23] = 0.8;
    expect(audienceScoreFor(grid, 5, 23)).toBeCloseTo(0.8, 5);
  });

  test('other row counts map proportionally (12 rows = 2h per row)', () => {
    const grid: ActiveTimesGrid = {
      ...grid24(),
      rows: 12,
      grid: Array.from({ length: 7 }, () => Array.from({ length: 12 }, () => 0.1)),
    };
    const mon = grid.grid[0];
    if (mon) mon[1] = 0.8;
    expect(audienceScoreFor(grid, 1, 2)).toBeCloseTo(0.8, 5);
    expect(audienceScoreFor(grid, 1, 3)).toBeCloseTo(0.8, 5);
    expect(audienceScoreFor(grid, 1, 4)).toBeCloseTo(0.1, 5);
  });

  test('out-of-range or non-integer inputs return null', () => {
    const grid = grid24();
    expect(audienceScoreFor(grid, 7, 10)).toBeNull();
    expect(audienceScoreFor(grid, -1, 10)).toBeNull();
    expect(audienceScoreFor(grid, 0.5, 10)).toBeNull();
    expect(audienceScoreFor(grid, 1, 24)).toBeNull();
    expect(audienceScoreFor(grid, 1, -1)).toBeNull();
    expect(audienceScoreFor(grid, 1, 3.5)).toBeNull();
  });

  test('malformed grids return null', () => {
    const sixCols = { ...grid24(), grid: grid24().grid.slice(0, 6) };
    expect(audienceScoreFor(sixCols, 1, 10)).toBeNull();
    const ragged = grid24();
    ragged.grid[3] = [0.1, 0.2];
    expect(audienceScoreFor(ragged, 4, 10)).toBeNull();
  });
});

describe('gridsEqual', () => {
  test('true within the default epsilon, false beyond it', () => {
    expect(gridsEqual([[0.1, 0.2]], [[0.11, 0.19]])).toBe(true);
    expect(gridsEqual([[0.1, 0.2]], [[0.15, 0.2]])).toBe(false);
  });

  test('dimension mismatches are never equal', () => {
    expect(gridsEqual([[0.1]], [[0.1], [0.1]])).toBe(false);
    expect(gridsEqual([[0.1, 0.2]], [[0.1]])).toBe(false);
  });

  test('custom epsilon is honored', () => {
    expect(gridsEqual([[0.1]], [[0.11]], 0.001)).toBe(false);
    expect(gridsEqual([[0.1]], [[0.11]], 0.05)).toBe(true);
  });

  test('empty grids are equal', () => {
    expect(gridsEqual([], [])).toBe(true);
  });
});
