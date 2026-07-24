// A3.2: audience Active-times capture routes over the real (in-memory) DB —
// the validation matrix, server-side clamping, newest-wins reads and the
// history cap. This suite is the only writer of `audience_activity`, but the
// shared-DB discipline (§9) still applies: every row it makes is deleted.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { Hono } from 'hono';
import { db } from '../../db/client.ts';
import {
  ACTIVE_TIMES_COLS,
  ACTIVE_TIMES_MAX_ROWS,
  ACTIVE_TIMES_MIN_ROWS,
} from '../../shared/activeTimes.ts';
import { audienceActivity } from '../db/schema.ts';
import { analyticsRouter } from './analytics.ts';

const app = new Hono();
app.route('/x', analyticsRouter);

const ROWS = 24;

function makeGrid(fill = 0.5, cols = ACTIVE_TIMES_COLS, rows = ROWS): number[][] {
  return Array.from({ length: cols }, () => Array.from({ length: rows }, () => fill));
}

function payload(overrides: Record<string, unknown> = {}) {
  return {
    metric: 'likes',
    tzOffsetMin: 180,
    cols: ACTIVE_TIMES_COLS,
    rows: ROWS,
    grid: makeGrid(),
    ...overrides,
  };
}

interface CaptureView {
  id: number;
  capturedAt: string;
  metric: string;
  tzOffsetMin: number;
  cols: number;
  rows: number;
  grid: number[][];
}

async function post(body: unknown): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await app.request('/x/analytics/active-times', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

async function get(query = ''): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await app.request(`/x/analytics/active-times${query}`);
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

beforeAll(async () => {
  await db.delete(audienceActivity);
});

afterAll(async () => {
  await db.delete(audienceActivity);
});

describe('GET /x/analytics/active-times (empty)', () => {
  test('returns capture: null before any insert', async () => {
    const { status, body } = await get();
    expect(status).toBe(200);
    expect(body.capture).toBeNull();
  });
});

describe('POST /x/analytics/active-times validation', () => {
  test('non-object body → invalid_body', async () => {
    for (const bad of [null, [], 'x', 42]) {
      const { status, body } = await post(bad);
      expect(status).toBe(400);
      expect(body.error).toBe('invalid_body');
    }
  });

  test('metric missing / empty / whitespace / too long → invalid_metric', async () => {
    for (const metric of [undefined, '', '   ', 'x'.repeat(41), 7]) {
      const { status, body } = await post(payload({ metric }));
      expect(status).toBe(400);
      expect(body.error).toBe('invalid_metric');
    }
  });

  test('tzOffsetMin non-integer or out of ±840 → invalid_tz_offset_min', async () => {
    for (const tzOffsetMin of [undefined, '180', 1.5, -841, 841, Number.NaN]) {
      const { status, body } = await post(payload({ tzOffsetMin }));
      expect(status).toBe(400);
      expect(body.error).toBe('invalid_tz_offset_min');
    }
  });

  test('cols must be exactly 7 → invalid_cols', async () => {
    for (const cols of [undefined, 6, 8, '7']) {
      const { status, body } = await post(payload({ cols }));
      expect(status).toBe(400);
      expect(body.error).toBe('invalid_cols');
    }
  });

  test('rows outside 12..96 or non-integer → invalid_rows', async () => {
    for (const rows of [
      undefined,
      ACTIVE_TIMES_MIN_ROWS - 1,
      ACTIVE_TIMES_MAX_ROWS + 1,
      24.5,
      '24',
    ]) {
      const { status, body } = await post(payload({ rows }));
      expect(status).toBe(400);
      expect(body.error).toBe('invalid_rows');
    }
  });

  test('grid shape/content mismatches → invalid_grid', async () => {
    const bads: unknown[] = [
      undefined,
      'grid',
      makeGrid(0.5, 6), // wrong column count
      makeGrid(0.5, ACTIVE_TIMES_COLS, ROWS - 1), // wrong row count
      [...makeGrid().slice(0, 6), 'not-a-column'], // one column not an array
    ];
    const nanGrid = makeGrid();
    (nanGrid[0] as number[])[0] = Number.NaN;
    bads.push(nanGrid);
    const stringCell = makeGrid() as unknown[][];
    (stringCell[0] as unknown[])[0] = '0.5';
    bads.push(stringCell);
    for (const grid of bads) {
      const { status, body } = await post(payload({ grid }));
      expect(status).toBe(400);
      expect(body.error).toBe('invalid_grid');
    }
  });
});

describe('POST → GET round-trip', () => {
  test('201 with the stored capture; out-of-range values clamped to [0,1]', async () => {
    const grid = makeGrid(0.4);
    (grid[0] as number[])[0] = -0.5;
    (grid[6] as number[])[ROWS - 1] = 1.5;
    const { status, body } = await post(payload({ metric: '  likes  ', grid }));
    expect(status).toBe(201);
    const created = body.capture as unknown as CaptureView;
    expect(created.metric).toBe('likes');
    expect(created.tzOffsetMin).toBe(180);
    expect(created.cols).toBe(ACTIVE_TIMES_COLS);
    expect(created.rows).toBe(ROWS);
    expect(created.grid[0]?.[0]).toBe(0);
    expect(created.grid[6]?.[ROWS - 1]).toBe(1);
    expect(created.capturedAt).toBeTruthy();

    const { status: gs, body: gb } = await get();
    expect(gs).toBe(200);
    const capture = gb.capture as unknown as CaptureView;
    expect(capture.id).toBe(created.id);
    expect(capture.grid).toEqual(created.grid);
  });

  test('newest capture wins after a second insert', async () => {
    const { body } = await post(payload({ metric: 'replies', grid: makeGrid(0.9) }));
    const second = body.capture as unknown as CaptureView;
    const { body: gb } = await get();
    const capture = gb.capture as unknown as CaptureView;
    expect(capture.id).toBe(second.id);
    expect(capture.metric).toBe('replies');
  });
});

describe('GET ?history=', () => {
  test('returns the series newest-first', async () => {
    const { status, body } = await get('?history=10');
    expect(status).toBe(200);
    expect(body.count).toBe(2);
    const captures = body.captures as unknown as CaptureView[];
    expect(captures[0]?.metric).toBe('replies');
    expect(captures[1]?.metric).toBe('likes');
  });

  test('history is capped at 30 and rejects non-positive-integer values', async () => {
    const { status, body } = await get('?history=1000');
    expect(status).toBe(200);
    expect(body.count).toBe(2); // capped limit, only 2 rows exist

    for (const bad of ['0', '-3', '2.5', 'abc']) {
      const { status: bs, body: bb } = await get(`?history=${bad}`);
      expect(bs).toBe(400);
      expect(bb.error).toBe('invalid_history');
    }
  });

  test('history=1 returns only the newest', async () => {
    const { body } = await get('?history=1');
    expect(body.count).toBe(1);
    const captures = body.captures as unknown as CaptureView[];
    expect(captures[0]?.metric).toBe('replies');
  });
});
