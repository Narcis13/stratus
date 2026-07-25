// DOM half of the Active-times capture (Authoring 3.0, A3.1). The pure core
// (grid types, color → intensity parsing, weekday/hour scoring) is canonical
// in src/shared/activeTimes.ts — the replyBand shim arrangement (§7.27), so
// the server scores a stored grid exactly like the page that captured it.
// This file adds the only part that needs a DOM: finding the heat-cell grid
// on x.com/i/account_analytics. X owns that markup and WILL move it — every
// structural assumption is a named constant below (adjust live in A3.3).

import {
  ACTIVE_TIMES_COLS,
  ACTIVE_TIMES_MAX_ROWS,
  ACTIVE_TIMES_MIN_ROWS,
} from '../../../src/shared/activeTimes.ts';

export * from '../../../src/shared/activeTimes.ts';

const HEADING_SELECTOR = 'h1, h2, h3, h4, [role="heading"]';
const ACTIVE_TIMES_HEADING_RE = /active times/i;
/** Heat cells carry their shade as an inline style on a leaf div. */
const CELL_SELECTOR = '[style*="background"]';
/** How far above the heading to look for the section holding the grid. */
const MAX_ANCESTOR_HOPS = 8;

export interface ExtractedActiveTimes {
  /** Raw CSS colors, indexed [col][row]; feed into parseHeatColors. */
  colors: (string | null)[][];
  cols: number;
  rows: number;
}

/** rgb()/rgba() surgery for folding element opacity into the color's alpha. */
const RGB_PARTS_RE =
  /^rgba?\((\d{1,3})[\s,]+(\d{1,3})[\s,]+(\d{1,3})(?:\s*[,/]\s*([\d.]+))?\s*\)$/i;

function withOpacity(color: string, opacity: number): string {
  const m = color.match(RGB_PARTS_RE);
  if (!m) return color;
  const base = m[4] === undefined ? 1 : Number(m[4]);
  return `rgba(${m[1]}, ${m[2]}, ${m[3]}, ${(Number.isFinite(base) ? base : 1) * opacity})`;
}

function cellColor(el: Element): string | null {
  const style = (el as { style?: { backgroundColor?: string; opacity?: string } }).style;
  const view = el.ownerDocument?.defaultView;
  const inline = style?.backgroundColor;
  // Live palette (verified 2026-07-24): cells carry `background-color:
  // hsl(var(--color-blue-500))` — a var() only the computed style resolves
  // to a parseable rgb().
  const color =
    inline && !inline.includes('var(')
      ? inline
      : view?.getComputedStyle(el).backgroundColor || inline || null;
  if (!color) return null;
  // Live palette: intensity rides on the ELEMENT's opacity (0.2..1), not the
  // color — fold it into the alpha so parseHeatColors' alpha mode reads it.
  const rawOpacity = style?.opacity || view?.getComputedStyle(el).opacity;
  const opacity = rawOpacity ? Number(rawOpacity) : 1;
  if (!Number.isFinite(opacity) || opacity < 0 || opacity >= 1) return color;
  return withOpacity(color, opacity);
}

function collectGrid(container: Element): ExtractedActiveTimes | null {
  const leaves = [...container.querySelectorAll(CELL_SELECTOR)].filter(
    (el) => el.childElementCount === 0,
  );
  if (leaves.length === 0) return null;

  const byParent = new Map<Element, Element[]>();
  for (const el of leaves) {
    const parent = el.parentElement;
    if (!parent) continue;
    const group = byParent.get(parent);
    if (group) group.push(el);
    else byParent.set(parent, [el]);
  }

  // Column-per-container: exactly 7 same-height groups of plausible height.
  // The size filter drops stray styled leaves (legend swatches, hour rails)
  // without letting them break the 7-column count.
  const plausible = [...byParent.values()].filter(
    (g) => g.length >= ACTIVE_TIMES_MIN_ROWS && g.length <= ACTIVE_TIMES_MAX_ROWS,
  );
  const height = plausible[0]?.length ?? 0;
  if (plausible.length === ACTIVE_TIMES_COLS && plausible.every((g) => g.length === height)) {
    return {
      colors: plausible.map((g) => g.map((el) => cellColor(el))),
      cols: ACTIVE_TIMES_COLS,
      rows: height,
    };
  }

  // Flat CSS grid: one container laid out as rows of 7 (Mon..Sun per row).
  for (const group of byParent.values()) {
    const rows = group.length / ACTIVE_TIMES_COLS;
    if (!Number.isInteger(rows) || rows < ACTIVE_TIMES_MIN_ROWS || rows > ACTIVE_TIMES_MAX_ROWS)
      continue;
    const colors: (string | null)[][] = [];
    for (let col = 0; col < ACTIVE_TIMES_COLS; col++) {
      const column: (string | null)[] = [];
      for (let row = 0; row < rows; row++) {
        const el = group[row * ACTIVE_TIMES_COLS + col];
        column.push(el ? cellColor(el) : null);
      }
      colors.push(column);
    }
    return { colors, cols: ACTIVE_TIMES_COLS, rows };
  }

  return null;
}

/**
 * Locate the "Active times" section and read its heat cells by structure.
 * Returns null when nothing on the page looks like a plausible 7-column grid.
 */
export function extractActiveTimesSection(root: Document | Element): ExtractedActiveTimes | null {
  const headings = [...root.querySelectorAll(HEADING_SELECTOR)];
  const heading = headings.find((h) => ACTIVE_TIMES_HEADING_RE.test(h.textContent ?? ''));
  if (!heading) return null;
  let container: Element | null = heading.parentElement;
  for (let hop = 0; hop < MAX_ANCESTOR_HOPS && container; hop++) {
    const grid = collectGrid(container);
    if (grid) return grid;
    container = container.parentElement;
  }
  return null;
}
