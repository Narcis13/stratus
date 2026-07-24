// A3.1 — DOM extraction of the Active-times heat grid over fixture HTML
// (happy-dom), the earlyReplies.test.ts discipline: the same structural
// skeleton X renders (heading, 7 weekday columns of shaded cells, hour rail),
// round-tripped through parseHeatColors to a normalized grid.

import { describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { extractActiveTimesSection, parseHeatColors } from './activeTimes.ts';

function cell(color: string): string {
  return `<div style="background-color: ${color}"></div>`;
}

function columnsGrid(rows: number, alphaFor: (col: number, row: number) => number): string {
  let cols = '';
  for (let col = 0; col < 7; col++) {
    let cells = '';
    for (let row = 0; row < rows; row++) {
      cells += cell(`rgba(29, 155, 240, ${alphaFor(col, row)})`);
    }
    cols += `<div class="col">${cells}</div>`;
  }
  return `<div class="grid">${cols}</div>`;
}

function documentFor(body: string): Document {
  const window = new Window({ url: 'https://x.com/i/account_analytics' });
  window.document.body.innerHTML = body;
  return window.document as unknown as Document;
}

function sectionFor(gridHtml: string, heading = '<h2>Active times</h2>'): Document {
  return documentFor(`
    <main>
      <section>
        ${heading}
        ${gridHtml}
        <div class="rail"><span>12am</span><span>4am</span><span>8am</span><span>12pm</span></div>
      </section>
    </main>`);
}

describe('extractActiveTimesSection', () => {
  test('column-per-container layout round-trips to a normalized grid', () => {
    const doc = sectionFor(columnsGrid(24, (col, row) => (col === 2 && row === 7 ? 1 : 0.1)));
    const extracted = extractActiveTimesSection(doc);
    expect(extracted).not.toBeNull();
    expect(extracted?.cols).toBe(7);
    expect(extracted?.rows).toBe(24);
    if (!extracted) return;
    const grid = parseHeatColors(extracted.colors, extracted.cols, extracted.rows);
    expect(grid?.[2]?.[7]).toBeCloseTo(1, 5);
    expect(grid?.[0]?.[0]).toBeCloseTo(0, 5);
    expect(grid?.[6]?.[23]).toBeCloseTo(0, 5);
  });

  test('flat single-container grid reads row-major (rows of 7)', () => {
    // Marker at flat index 5*7+3 must land at [col 3][row 5].
    let cells = '';
    for (let i = 0; i < 7 * 12; i++) {
      cells += cell(i === 5 * 7 + 3 ? 'rgba(29, 155, 240, 1)' : 'rgba(29, 155, 240, 0.1)');
    }
    const doc = sectionFor(
      `<div class="grid">${cells}</div>`,
      '<div role="heading">Active times</div>',
    );
    const extracted = extractActiveTimesSection(doc);
    expect(extracted?.cols).toBe(7);
    expect(extracted?.rows).toBe(12);
    if (!extracted) return;
    const grid = parseHeatColors(extracted.colors, extracted.cols, extracted.rows);
    expect(grid?.[3]?.[5]).toBeCloseTo(1, 5);
    expect(grid?.[0]?.[0]).toBeCloseTo(0, 5);
  });

  test('live palette: constant color, intensity on element opacity (flat grid)', () => {
    // The live markup (verified 2026-07-24): every cell carries the SAME
    // background color and the ramp rides on the element's opacity (0.2..1).
    // cellColor folds that opacity into an rgba alpha so parseHeatColors'
    // alpha mode reads it; without the fold the grid is all-equal noise.
    let cells = '';
    for (let i = 0; i < 7 * 24; i++) {
      const col = i % 7;
      const row = (i - col) / 7;
      const opacity = col === 6 && row === 3 ? 1 : col === 1 && row === 2 ? 0.625 : 0.25;
      cells += `<div style="background-color: rgb(30, 156, 241); opacity: ${opacity}"></div>`;
    }
    const doc = sectionFor(`<div class="grid">${cells}</div>`);
    const extracted = extractActiveTimesSection(doc);
    expect(extracted?.cols).toBe(7);
    expect(extracted?.rows).toBe(24);
    if (!extracted) return;
    const grid = parseHeatColors(extracted.colors, extracted.cols, extracted.rows);
    expect(grid?.[6]?.[3]).toBeCloseTo(1, 5);
    expect(grid?.[1]?.[2]).toBeCloseTo(0.5, 5);
    expect(grid?.[0]?.[0]).toBeCloseTo(0, 5);
  });

  test('element opacity multiplies an existing rgba alpha', () => {
    // A translucent color under a translucent element compounds: the folded
    // alpha is color-alpha × element-opacity, keeping relative order intact.
    const doc = sectionFor(
      columnsGrid(24, (col, row) => (col === 0 && row === 0 ? 0.8 : 0.4)).replaceAll(
        'style="background-color: rgba(29, 155, 240, 0.8)"',
        'style="background-color: rgba(29, 155, 240, 0.8); opacity: 0.5"',
      ),
    );
    const extracted = extractActiveTimesSection(doc);
    expect(extracted).not.toBeNull();
    if (!extracted) return;
    // col 0 row 0: 0.8 × 0.5 = 0.4 — identical to every other cell → all-equal.
    const grid = parseHeatColors(extracted.colors, extracted.cols, extracted.rows);
    expect(grid?.[0]?.[0]).toBeCloseTo(0.5, 5);
    expect(grid?.[3]?.[9]).toBeCloseTo(0.5, 5);
  });

  test('legend swatches next to the grid do not break the column count', () => {
    const legend = `<div class="legend">${'abcde'
      .split('')
      .map(() => cell('rgb(200, 200, 200)'))
      .join('')}</div>`;
    const doc = sectionFor(`${columnsGrid(24, (_, row) => row / 23)}${legend}`);
    const extracted = extractActiveTimesSection(doc);
    expect(extracted?.cols).toBe(7);
    expect(extracted?.rows).toBe(24);
  });

  test('no Active-times heading anywhere → null', () => {
    const doc = documentFor(`<section><h2>Overview</h2>${columnsGrid(24, () => 0.5)}</section>`);
    expect(extractActiveTimesSection(doc)).toBeNull();
  });

  test('six columns is not a plausible grid → null', () => {
    let cols = '';
    for (let col = 0; col < 6; col++) {
      let cells = '';
      for (let row = 0; row < 24; row++) cells += cell('rgba(29, 155, 240, 0.4)');
      cols += `<div class="col">${cells}</div>`;
    }
    const doc = sectionFor(`<div class="grid">${cols}</div>`);
    expect(extractActiveTimesSection(doc)).toBeNull();
  });

  test('fewer than 12 rows is not a plausible grid → null', () => {
    const doc = sectionFor(columnsGrid(8, () => 0.4));
    expect(extractActiveTimesSection(doc)).toBeNull();
  });
});
