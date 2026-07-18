// S4 asset library — wiring over the real (in-memory, auto-migrated) SQLite DB.
// Asserts the base64 round-trip (POST bytes → stream them back unchanged), that
// the list never ships blobs, the 2MB size cap, and delete.

import { describe, expect, test } from 'bun:test';
import { Hono } from 'hono';
import { assets } from './assets.ts';

const app = new Hono();
app.route('/x', assets);

async function post<T>(path: string, body: unknown): Promise<{ status: number; body: T }> {
  const res = await app.request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as T };
}

// A tiny, known byte sequence stands in for a PNG — the route caps by size and
// stores bytes verbatim; it doesn't parse image structure.
const BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 250]);
const B64 = Buffer.from(BYTES).toString('base64');

describe('POST/GET/DELETE /x/assets (S4)', () => {
  test('save returns metadata only (never the blob)', async () => {
    const { status, body } = await post<Record<string, unknown>>('/x/assets', {
      pngBase64: B64,
      kind: 'quote',
      prompt: 'flat vector, no text',
      width: 1200,
      height: 675,
    });
    expect(status).toBe(201);
    expect(typeof body.id).toBe('string');
    expect(body.kind).toBe('quote');
    expect(body.byteLength).toBe(BYTES.length);
    expect('png').not.toBeOneOf(Object.keys(body));
  });

  test('base64 round-trip: the PNG stream returns the exact bytes', async () => {
    const { body: created } = await post<{ id: string }>('/x/assets', {
      pngBase64: B64,
      kind: 'banner',
    });
    const res = await app.request(`/x/assets/${created.id}/png`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('image/');
    const got = new Uint8Array(await res.arrayBuffer());
    expect(Array.from(got)).toEqual(Array.from(BYTES));
  });

  test('list excludes the blob column', async () => {
    const res = await app.request('/x/assets');
    const body = (await res.json()) as { assets: Array<Record<string, unknown>> };
    expect(res.status).toBe(200);
    expect(body.assets.length).toBeGreaterThan(0);
    for (const a of body.assets) {
      expect('png').not.toBeOneOf(Object.keys(a));
      expect(typeof a.id).toBe('string');
    }
  });

  test('over 2MB → 413', async () => {
    const big = Buffer.alloc(2 * 1024 * 1024 + 1, 7).toString('base64');
    const { status, body } = await post<{ error: string }>('/x/assets', {
      pngBase64: big,
      kind: 'quote',
    });
    expect(status).toBe(413);
    expect(body.error).toBe('asset_too_large');
  });

  test('empty png → 400; unknown kind falls back to other', async () => {
    const bad = await post<{ error: string }>('/x/assets', { pngBase64: '', kind: 'quote' });
    expect(bad.status).toBe(400);
    const ok = await post<{ kind: string }>('/x/assets', { pngBase64: B64, kind: 'nonsense' });
    expect(ok.status).toBe(201);
    expect(ok.body.kind).toBe('other');
  });

  test('an S5 template kind (milestone) is stored, not coerced to other', async () => {
    const { status, body } = await post<{ kind: string }>('/x/assets', {
      pngBase64: B64,
      kind: 'milestone',
    });
    expect(status).toBe(201);
    expect(body.kind).toBe('milestone');
  });

  test('delete removes it; the stream then 404s', async () => {
    const { body: created } = await post<{ id: string }>('/x/assets', {
      pngBase64: B64,
      kind: 'pfp',
    });
    const del = await app.request(`/x/assets/${created.id}`, { method: 'DELETE' });
    expect(del.status).toBe(200);
    const gone = await app.request(`/x/assets/${created.id}/png`);
    expect(gone.status).toBe(404);
    const delAgain = await app.request(`/x/assets/${created.id}`, { method: 'DELETE' });
    expect(delAgain.status).toBe(404);
  });
});
