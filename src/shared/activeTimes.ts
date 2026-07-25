// Audience "Active times" heatmap — pure core (Authoring 3.0, A3.1).
//
// X Analytics renders when-your-audience-is-online as a 7-column (Mon..Sun)
// heat grid. Canonical home (the replyBand arrangement, §7.27): the server
// (brief gap annotation, /x/analytics validation) and the page (capture,
// Composer blending) must read a stored grid identically, so the color →
// intensity parsing and the weekday/hour mapping live here, once. The DOM
// half — finding the grid on x.com — lives in
// extension/src/shared/activeTimes.ts, which re-exports this module.

export interface ActiveTimesGrid {
  cols: number;
  rows: number;
  /** Indexed [col][row]; col 0 = Monday; values normalized 0..1. */
  grid: number[][];
  /** Viewer-local tz at capture — the grid buckets are local wall-clock. */
  tzOffsetMin: number;
  /** The analytics dropdown at capture time ('likes', …). */
  metric: string;
}

export const ACTIVE_TIMES_COLS = 7;
export const ACTIVE_TIMES_MIN_ROWS = 12;
export const ACTIVE_TIMES_MAX_ROWS = 96;
/** Fail closed when more than this share of cells has an unreadable color. */
export const MAX_UNPARSEABLE_RATIO = 0.2;

interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

const HEX_RE = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const RGB_RE = /^rgba?\(\s*(\d{1,3})[\s,]+(\d{1,3})[\s,]+(\d{1,3})(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/i;

function hexChannel(raw: string): number {
  return Number.parseInt(raw.length === 1 ? raw + raw : raw, 16);
}

function parseCssColor(value: string): Rgba | null {
  const v = value.trim().toLowerCase();
  if (v === 'transparent') return { r: 0, g: 0, b: 0, a: 0 };
  if (HEX_RE.test(v)) {
    const h = v.slice(1);
    const step = h.length <= 4 ? 1 : 2;
    const r = hexChannel(h.slice(0, step));
    const g = hexChannel(h.slice(step, step * 2));
    const b = hexChannel(h.slice(step * 2, step * 3));
    const alphaRaw = h.slice(step * 3, step * 4);
    return { r, g, b, a: alphaRaw ? hexChannel(alphaRaw) / 255 : 1 };
  }
  const m = v.match(RGB_RE);
  if (!m?.[1] || !m[2] || !m[3]) return null;
  const r = Number(m[1]);
  const g = Number(m[2]);
  const b = Number(m[3]);
  if (r > 255 || g > 255 || b > 255) return null;
  const rawA = m[4];
  if (rawA === undefined) return { r, g, b, a: 1 };
  const a = rawA.endsWith('%') ? Number(rawA.slice(0, -1)) / 100 : Number(rawA);
  if (!Number.isFinite(a)) return null;
  return { r, g, b, a: Math.min(1, Math.max(0, a)) };
}

/**
 * CSS colors → normalized 0..1 intensity grid, or null when the input is not
 * a readable grid. The absolute palette is X-owned and unknowable; relative
 * intensity is what matters, so values are min-max scaled across the grid.
 */
export function parseHeatColors(
  colors: (string | null)[][],
  cols: number,
  rows: number,
): number[][] | null {
  if (!Number.isInteger(cols) || !Number.isInteger(rows) || cols <= 0 || rows <= 0) return null;
  if (colors.length !== cols || colors.some((col) => col.length !== rows)) return null;

  const parsed = colors.map((col) => col.map((c) => (c === null ? null : parseCssColor(c))));
  let unparseable = 0;
  let alphaMode = false;
  for (const col of parsed) {
    for (const c of col) {
      if (c === null) unparseable += 1;
      else if (c.a < 1) alphaMode = true;
    }
  }
  if (unparseable > cols * rows * MAX_UNPARSEABLE_RATIO) return null;

  // One translucent cell marks the whole palette as an alpha ramp (uniform
  // hue, varying opacity — the a=1 peak scores 1, not its hue's luminance);
  // otherwise shade carries the signal and relative luminance stands in.
  const scalars = parsed.map((col) =>
    col.map((c) => {
      if (c === null) return null;
      if (alphaMode) return c.a;
      return (0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b) / 255;
    }),
  );

  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const col of scalars) {
    for (const s of col) {
      if (s === null) continue;
      if (s < min) min = s;
      if (s > max) max = s;
    }
  }
  const span = max - min;
  // Unreadable cells read 0 — no signal, not poison; the >20% gate above
  // keeps a mostly-unreadable grid from shipping as a mostly-dead one.
  return scalars.map((col) =>
    col.map((s) => (s === null ? 0 : span === 0 ? 0.5 : (s - min) / span)),
  );
}

/**
 * Average intensity for a local weekday+hour. `jsWeekday` uses JS getDay()
 * semantics (0 = Sunday); X's columns run Mon..Sun, the mapping lives here.
 */
export function audienceScoreFor(
  grid: ActiveTimesGrid,
  jsWeekday: number,
  hour: number,
): number | null {
  if (!Number.isInteger(jsWeekday) || jsWeekday < 0 || jsWeekday > 6) return null;
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) return null;
  if (grid.cols !== ACTIVE_TIMES_COLS || grid.grid.length !== grid.cols) return null;
  if (!Number.isInteger(grid.rows) || grid.rows <= 0) return null;
  const column = grid.grid[(jsWeekday + 6) % 7];
  if (!column || column.length !== grid.rows) return null;
  const perHour = grid.rows / 24;
  const start = Math.floor(hour * perHour);
  const end = Math.max(start + 1, Math.floor((hour + 1) * perHour));
  let sum = 0;
  let count = 0;
  for (let row = start; row < end && row < column.length; row++) {
    const v = column[row];
    if (v === undefined) return null;
    sum += v;
    count += 1;
  }
  return count === 0 ? null : sum / count;
}

/** Per-cell comparison for capture re-send suppression. */
export function gridsEqual(a: number[][], b: number[][], epsilon = 0.02): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const colA = a[i];
    const colB = b[i];
    if (!colA || !colB || colA.length !== colB.length) return false;
    for (let j = 0; j < colA.length; j++) {
      const va = colA[j];
      const vb = colB[j];
      if (va === undefined || vb === undefined || Math.abs(va - vb) > epsilon) return false;
    }
  }
  return true;
}
