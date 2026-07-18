// Chart-card data prep (SURFACES S5.8): pure normalization for the two chart
// modes, kept out of the template so `chartCardSpec` stays a plain-array spec.
//
// Growth reads the daily account series ($0, /x/metrics/account); the raw
// follower points are handed to a `sparkline` layer, which does its own
// min/max fit (compose.ts sparklineCoords) — so growthSeries only extracts
// points + labels + delta, no normalization here.
//
// Heatmap reads /x/metrics/best-times and DOES normalize: it builds the full
// 7×24 grid so the template can render every cell, and it honors the S0.4 gate
// — a cell below `minN` measured posts is `sufficient:false` with a null
// intensity and MUST render muted, never a confident color for thin data.

/** Structural subset of AccountSeriesPoint — decouples this module from the
 *  server types (the shell passes `res.series` straight in). */
export interface GrowthRow {
  snapshotAt: string;
  followersCount: number;
}

export interface GrowthSeries {
  /** Raw follower counts, oldest → newest (the sparkline normalizes them). */
  points: number[];
  /** ISO date (YYYY-MM-DD) of the first / last snapshot; '' when empty. */
  firstLabel: string;
  lastLabel: string;
  /** last − first follower count (0 when empty). */
  delta: number;
}

/** Extract the follower curve + endpoint labels from the account series. */
export function growthSeries(rows: GrowthRow[]): GrowthSeries {
  if (rows.length === 0) return { points: [], firstLabel: '', lastLabel: '', delta: 0 };
  const first = rows[0] as GrowthRow;
  const last = rows[rows.length - 1] as GrowthRow;
  return {
    points: rows.map((r) => r.followersCount),
    firstLabel: first.snapshotAt.slice(0, 10),
    lastLabel: last.snapshotAt.slice(0, 10),
    delta: last.followersCount - first.followersCount,
  };
}

/** Structural subset of BestTimeCell — the fields the heatmap needs. */
export interface HeatCell {
  weekday: number;
  hour: number;
  posts: number;
  avgViews: number | null;
  avgViewsPerDay: number | null;
}

export interface ChartCell {
  weekday: number;
  hour: number;
  /** 0..1 for a measured cell; null below the gate (renders muted). */
  intensity: number | null;
  /** posts ≥ minN AND a value to normalize — else a "no data" cell. */
  sufficient: boolean;
}

/** The S0.4 best-times advice gate (the server also gates its `top` at 3). */
export const HEATMAP_MIN_N = 3;

/** Build the full 7×24 grid from the sparse best-times cells. Every weekday ×
 *  hour slot is emitted (so the template renders a complete grid); cells with
 *  `posts < minN` or no value are `sufficient:false`/`intensity:null`.
 *  Intensity is a min→max normalization over the sufficient cells (a flat set
 *  reads as a uniform 0.5, never all-invisible — mirrors the guarded span in
 *  compose.ts sparklineCoords). */
export function heatmapCells(cells: HeatCell[], minN = HEATMAP_MIN_N): ChartCell[] {
  const byKey = new Map<string, HeatCell>();
  const values: number[] = [];
  for (const c of cells) {
    byKey.set(`${c.weekday}:${c.hour}`, c);
    if (c.posts >= minN) {
      const v = c.avgViewsPerDay ?? c.avgViews;
      if (v !== null) values.push(v);
    }
  }
  const min = values.length > 0 ? Math.min(...values) : 0;
  const max = values.length > 0 ? Math.max(...values) : 0;
  const span = max - min;

  const out: ChartCell[] = [];
  for (let weekday = 0; weekday < 7; weekday += 1) {
    for (let hour = 0; hour < 24; hour += 1) {
      const c = byKey.get(`${weekday}:${hour}`);
      const v = c ? (c.avgViewsPerDay ?? c.avgViews) : null;
      const sufficient = c !== undefined && c.posts >= minN && v !== null;
      const intensity = sufficient ? (span > 0 ? ((v as number) - min) / span : 0.5) : null;
      out.push({ weekday, hour, intensity, sufficient });
    }
  }
  return out;
}
