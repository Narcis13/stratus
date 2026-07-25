// S5.8 chart-card data prep — pure normalization for the two chart modes.
// The gate discipline (below minN → sufficient:false, null intensity) is the
// thing that must never regress: a thin cell must render muted, never a
// confident color.

import { describe, expect, test } from 'bun:test';
import { type HeatCell, growthSeries, heatmapCells } from './chartData.ts';

describe('growthSeries', () => {
  test('extracts points, endpoint labels, and delta', () => {
    const g = growthSeries([
      { snapshotAt: '2026-06-18T03:00:00.000Z', followersCount: 1200 },
      { snapshotAt: '2026-06-19T03:00:00.000Z', followersCount: 1215 },
      { snapshotAt: '2026-07-18T03:00:00.000Z', followersCount: 1260 },
    ]);
    expect(g.points).toEqual([1200, 1215, 1260]);
    expect(g.firstLabel).toBe('2026-06-18');
    expect(g.lastLabel).toBe('2026-07-18');
    expect(g.delta).toBe(60);
  });

  test('a shrinking week keeps its negative delta', () => {
    const g = growthSeries([
      { snapshotAt: '2026-07-01T03:00:00.000Z', followersCount: 500 },
      { snapshotAt: '2026-07-08T03:00:00.000Z', followersCount: 488 },
    ]);
    expect(g.delta).toBe(-12);
  });

  test('empty input → safe empties', () => {
    expect(growthSeries([])).toEqual({ points: [], firstLabel: '', lastLabel: '', delta: 0 });
  });

  test('single snapshot → one point, delta 0, both labels equal', () => {
    const g = growthSeries([{ snapshotAt: '2026-07-18T03:00:00.000Z', followersCount: 900 }]);
    expect(g.points).toEqual([900]);
    expect(g.delta).toBe(0);
    expect(g.firstLabel).toBe('2026-07-18');
    expect(g.lastLabel).toBe('2026-07-18');
  });
});

function cell(
  weekday: number,
  hour: number,
  posts: number,
  avgViewsPerDay: number | null,
): HeatCell {
  return { weekday, hour, posts, avgViews: avgViewsPerDay, avgViewsPerDay };
}

describe('heatmapCells', () => {
  test('always emits the full 7×24 grid, ordered weekday-major', () => {
    const grid = heatmapCells([]);
    expect(grid).toHaveLength(168);
    expect(grid[0]).toMatchObject({ weekday: 0, hour: 0 });
    expect(grid[23]).toMatchObject({ weekday: 0, hour: 23 });
    expect(grid[24]).toMatchObject({ weekday: 1, hour: 0 });
    expect(grid[167]).toMatchObject({ weekday: 6, hour: 23 });
  });

  test('empty input → every cell insufficient with null intensity', () => {
    const grid = heatmapCells([]);
    expect(grid.every((c) => c.sufficient === false && c.intensity === null)).toBe(true);
  });

  test('gate: a cell below minN is insufficient with null intensity', () => {
    const grid = heatmapCells([cell(2, 9, 2, 5000)], 3);
    const c = grid.find((g) => g.weekday === 2 && g.hour === 9);
    expect(c).toMatchObject({ sufficient: false, intensity: null });
  });

  test('normalizes measured cells min→max across the sufficient set', () => {
    const grid = heatmapCells([cell(1, 8, 5, 100), cell(3, 12, 5, 300), cell(5, 18, 5, 200)], 3);
    const at = (w: number, h: number) => grid.find((g) => g.weekday === w && g.hour === h);
    expect(at(1, 8)).toMatchObject({ sufficient: true, intensity: 0 }); // min
    expect(at(3, 12)).toMatchObject({ sufficient: true, intensity: 1 }); // max
    expect(at(5, 18)).toMatchObject({ sufficient: true, intensity: 0.5 }); // midpoint
  });

  test('flat measured set → all 0.5 (guarded span, never all-invisible)', () => {
    const grid = heatmapCells([cell(0, 0, 5, 400), cell(0, 1, 5, 400)], 3);
    expect(grid[0]).toMatchObject({ sufficient: true, intensity: 0.5 });
    expect(grid[1]).toMatchObject({ sufficient: true, intensity: 0.5 });
  });

  test('avgViewsPerDay is preferred, avgViews is the fallback', () => {
    const grid = heatmapCells(
      [
        { weekday: 4, hour: 10, posts: 5, avgViews: 999, avgViewsPerDay: 100 },
        { weekday: 4, hour: 11, posts: 5, avgViews: 200, avgViewsPerDay: null },
      ],
      3,
    );
    const a = grid.find((g) => g.weekday === 4 && g.hour === 10);
    const b = grid.find((g) => g.weekday === 4 && g.hour === 11);
    // Normalized over {100, 200}: the per-day 100 is the min, the fallback 200 the max.
    expect(a).toMatchObject({ sufficient: true, intensity: 0 });
    expect(b).toMatchObject({ sufficient: true, intensity: 1 });
  });

  test('a measured cell with no value at all is insufficient', () => {
    const grid = heatmapCells(
      [{ weekday: 2, hour: 2, posts: 9, avgViews: null, avgViewsPerDay: null }],
      3,
    );
    expect(grid.find((g) => g.weekday === 2 && g.hour === 2)).toMatchObject({
      sufficient: false,
      intensity: null,
    });
  });
});
