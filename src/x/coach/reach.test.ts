import { describe, expect, test } from 'bun:test';
import { classifyFormat } from '../../shared/postFormat.ts';
import {
  ESCAPE_MULTIPLE,
  REACH_BASE_WINDOW,
  REACH_EXEMPT_FORMATS,
  type ReachRow,
  SNAPSHOT_MAX_AGE_MIN,
  SNAPSHOT_MIN_AGE_MIN,
  buildReachBand,
  buildReachFit,
  fitFormatWeights,
  reachPopulation,
} from './reach.ts';

const T0 = Date.UTC(2026, 0, 1);
const HOUR = 3_600_000;

// Two plain content lines, no bullets, no shape — the classifier's `substance`
// fallback. Used as filler because it is EXEMPT, so it can pad the trailing
// window without ever producing a fitted cell of its own.
const FILLER = 'Some notes from the work today.\nIt kept moving either way.';
const LIST = 'Three things that helped:\n- shipping smaller\n- reading the logs\n- asking sooner';

function row(i: number, text: string, views: number | null, age: number | null = 600): ReachRow {
  return { text, postedAt: new Date(T0 + i * HOUR), views, ageAtSnapshotMin: age };
}

// The premises every arithmetic assertion below rests on. Asserted rather than
// assumed, so a classifier change reddens the premise instead of silently
// re-labelling the numbers underneath it (the SC.6 discipline).
test('fixtures classify as the formats the arithmetic assumes', () => {
  expect(classifyFormat(FILLER)).toBe('substance');
  expect(classifyFormat(LIST)).toBe('list');
  expect(REACH_EXEMPT_FORMATS).toContain('substance');
});

/** 20 filler posts at 100 views, then 20 list posts each followed by 3 fillers.
 *  Every trailing window therefore holds 15+ rows at exactly 100 views, so the
 *  baseline is pinned at 100 for every fitted row and a post's ratio is just
 *  `views / 100`. 15 stalls at 10…150 views, 5 escapes at 400. */
function corpus(): ReachRow[] {
  const rows: ReachRow[] = [];
  for (let i = 0; i < REACH_BASE_WINDOW; i++) rows.push(row(i, FILLER, 100));
  const listViews = [
    10, 20, 30, 400, 40, 50, 60, 400, 70, 80, 90, 400, 100, 110, 120, 400, 130, 140, 150, 400,
  ];
  let i = REACH_BASE_WINDOW;
  for (const views of listViews) {
    rows.push(row(i++, LIST, views));
    for (let f = 0; f < 3; f++) rows.push(row(i++, FILLER, 100));
  }
  return rows;
}

describe('reachPopulation', () => {
  test('keeps only rows measured inside the daily pass window', () => {
    const rows = [
      row(0, FILLER, 100, SNAPSHOT_MIN_AGE_MIN),
      row(1, FILLER, 100, SNAPSHOT_MAX_AGE_MIN),
      row(2, FILLER, 100, SNAPSHOT_MIN_AGE_MIN - 1), // read too early
      row(3, FILLER, 100, SNAPSHOT_MAX_AGE_MIN + 1), // read too late
      row(4, FILLER, null, 600), // never measured
      row(5, FILLER, 100, null), // pre-§8.4 snapshot, no age
    ];
    expect(reachPopulation(rows)).toHaveLength(2);
  });

  test('orders by publication time regardless of input order', () => {
    const out = reachPopulation([row(5, FILLER, 1), row(1, FILLER, 2), row(3, FILLER, 3)]);
    expect(out.map((r) => r.views)).toEqual([2, 3, 1]);
  });
});

describe('fitFormatWeights', () => {
  test('base is null until a full trailing window exists', () => {
    const short = Array.from({ length: REACH_BASE_WINDOW - 1 }, (_, i) => row(i, FILLER, 100));
    expect(fitFormatWeights(short).base).toBeNull();
    expect(fitFormatWeights([...short, row(99, FILLER, 100)]).base).toBe(100);
  });

  test('fits the multiplier quantiles against the trailing median', () => {
    const fit = fitFormatWeights(corpus());
    expect(fit.base).toBe(100);
    expect(fit.measuredPosts).toBe(100);
    expect(fit.fittedPosts).toBe(80);

    const list = fit.weights.find((w) => w.format === 'list');
    expect(list?.n).toBe(20);
    expect(list?.sufficient).toBe(true);
    // 15 stalls at 0.1…1.5 plus 5 escapes at 4.0 → the 11th smallest is 1.1.
    expect(list?.p50Multiplier).toBeCloseTo(1.1, 5);
    expect(list?.escapeRate).toBeCloseTo(0.25, 5);
    // Stall quantiles run over the NON-escaped rows only: 4th and 12th of 15.
    expect(list?.p25StallMultiplier).toBeCloseTo(0.4, 5);
    expect(list?.p75StallMultiplier).toBeCloseTo(1.2, 5);
  });

  test('a format below the gate is never sufficient, however good it looks', () => {
    const rows = corpus();
    // One spectacular hot take is still one hot take.
    rows.push(row(500, 'Unpopular opinion: most dashboards are decoration.', 5_000));
    const fit = fitFormatWeights(rows);
    const hot = fit.weights.find((w) => w.format === 'hot_take');
    expect(classifyFormat('Unpopular opinion: most dashboards are decoration.')).toBe('hot_take');
    expect(hot?.n).toBe(1);
    expect(hot?.sufficient).toBe(false);
  });

  test('the no-format-detected buckets stay exempt at any n', () => {
    const fit = fitFormatWeights(corpus());
    const substance = fit.weights.find((w) => w.format === 'substance');
    // 60 filler rows cleared the window — far past the gate, still not fitted.
    expect(substance?.n).toBeGreaterThan(20);
    expect(substance?.exempt).toBe(true);
    expect(substance?.sufficient).toBe(false);
    for (const format of REACH_EXEMPT_FORMATS) {
      expect(fit.weights.find((w) => w.format === format)?.sufficient).toBe(false);
    }
  });

  test('respects a tightened gate', () => {
    const fit = fitFormatWeights(corpus(), 21);
    expect(fit.weights.find((w) => w.format === 'list')?.sufficient).toBe(false);
  });
});

describe('buildReachBand', () => {
  test('scales the fitted multipliers by the live baseline', () => {
    const fit = fitFormatWeights(corpus());
    const list = fit.weights.find((w) => w.format === 'list');
    const cell = buildReachBand(list as NonNullable<typeof list>, fit.base);
    expect(cell.weightSource).toBe('fitted');
    expect(cell.stallRange).toEqual([40, 120]);
    expect(cell.escapeThreshold).toBe(ESCAPE_MULTIPLE * 100);
    expect(cell.escapeProbability).toBeCloseTo(0.25, 5);
  });

  test('a fitted format still yields nothing without a baseline', () => {
    const fit = fitFormatWeights(corpus());
    const list = fit.weights.find((w) => w.format === 'list');
    expect(buildReachBand(list as NonNullable<typeof list>, null).weightSource).toBe(
      'insufficient',
    );
  });
});

describe('buildReachFit', () => {
  test('every format gets a cell, and an insufficient one carries no number', () => {
    const fit = buildReachFit(corpus());
    expect(fit.cells).toHaveLength(14);
    expect(fit.minN).toBe(20);
    expect(fit.escapeMultiple).toBe(ESCAPE_MULTIPLE);

    const fitted = fit.cells.filter((c) => c.weightSource === 'fitted');
    expect(fitted.map((c) => c.format)).toEqual(['list']);

    // The invariant this whole task exists to hold: no seed table, so below the
    // gate there is no number to read — not a placeholder, not a default.
    for (const cell of fit.cells) {
      if (cell.weightSource === 'fitted') continue;
      expect(cell.stallRange).toBeNull();
      expect(cell.escapeThreshold).toBeNull();
      expect(cell.escapeProbability).toBeNull();
      expect(cell.p50Multiplier).toBeNull();
    }
  });

  test('an empty corpus is silent, not zero', () => {
    const fit = buildReachFit([]);
    expect(fit.base).toBeNull();
    expect(fit.measuredPosts).toBe(0);
    expect(fit.cells.every((c) => c.weightSource === 'insufficient')).toBe(true);
    expect(fit.cells.every((c) => c.stallRange === null)).toBe(true);
  });
});
