// Articles CRUD routes over the real (in-memory) DB (A3.11). Every route is $0
// pure SQL — no LLM, no X — so the whole matrix is exercised directly: create
// defaults, lean list (no body_md, carries bodyChars), pillar validation, the
// publish stamp, the discarded freeze, autosave partials, and 404s. Rows are
// cleared per test so ordering/count assertions own the whole population.

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { db } from '../../db/client.ts';
import { articles } from '../db/schema.ts';
import { articlesRouter } from './articles.ts';

const app = new Hono();
app.route('/x', articlesRouter);

const MISSING_ID = '00000000-0000-4000-8000-000000000000';

async function post(body: unknown): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await app.request('/x/articles', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return {
    status: res.status,
    body: (await res.json().catch(() => ({}))) as Record<string, unknown>,
  };
}

async function patch(
  id: string,
  body: unknown,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await app.request(`/x/articles/${id}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return {
    status: res.status,
    body: (await res.json().catch(() => ({}))) as Record<string, unknown>,
  };
}

async function getOne(id: string): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await app.request(`/x/articles/${id}`);
  return {
    status: res.status,
    body: (await res.json().catch(() => ({}))) as Record<string, unknown>,
  };
}

async function list(query = ''): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await app.request(`/x/articles${query}`);
  return {
    status: res.status,
    body: (await res.json().catch(() => ({}))) as Record<string, unknown>,
  };
}

async function assist(
  id: string,
  body: unknown,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await app.request(`/x/articles/${id}/assist`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return {
    status: res.status,
    body: (await res.json().catch(() => ({}))) as Record<string, unknown>,
  };
}

afterEach(async () => {
  await db.delete(articles);
});

describe('articles CRUD (A3.11)', () => {
  test('POST defaults title/status/body and returns 201', async () => {
    const r = await post({});
    expect(r.status).toBe(201);
    expect(r.body.title).toBe('Untitled');
    expect(r.body.status).toBe('draft');
    expect(r.body.bodyMd).toBe('');
    expect(r.body.publishedAt).toBeNull();
    expect(typeof r.body.id).toBe('string');
  });

  test('POST accepts title/bodyMd and a valid pillar (numeric shorthand)', async () => {
    const r = await post({ title: '  My Essay  ', bodyMd: '# Hello\n\nbody', pillar: 1 });
    expect(r.status).toBe(201);
    expect(r.body.title).toBe('My Essay');
    expect(r.body.bodyMd).toBe('# Hello\n\nbody');
    expect(r.body.pillar).toBe('ai-craft');
  });

  test('POST rejects an unknown pillar with 400', async () => {
    const r = await post({ pillar: 'not-a-real-pillar' });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe('invalid_pillar');
  });

  test('GET list excludes body_md, carries bodyChars, newest-updated first', async () => {
    // Seed directly with explicit updatedAt so ordering is deterministic (no ms tie).
    await db.insert(articles).values([
      { id: crypto.randomUUID(), title: 'older', bodyMd: 'abc', updatedAt: new Date(1000) },
      { id: crypto.randomUUID(), title: 'newer', bodyMd: 'abcdef', updatedAt: new Date(2000) },
    ]);

    const r = await list();
    expect(r.status).toBe(200);
    expect(r.body.count).toBe(2);
    const rows = r.body.articles as Array<Record<string, unknown>>;
    expect(rows.map((x) => x.title)).toEqual(['newer', 'older']);
    const [first, second] = rows;
    expect(first).not.toHaveProperty('bodyMd');
    expect(first?.bodyChars).toBe(6);
    expect(second?.bodyChars).toBe(3);
  });

  test('GET list filters by status; invalid status 400', async () => {
    const draft = await post({ title: 'a draft' });
    const pub = await post({ title: 'to publish' });
    await patch(pub.body.id as string, { status: 'published' });

    const published = await list('?status=published');
    expect(published.body.count).toBe(1);
    expect((published.body.articles as Array<Record<string, unknown>>)[0]?.title).toBe(
      'to publish',
    );

    const drafts = await list('?status=draft');
    expect((drafts.body.articles as Array<Record<string, unknown>>).map((x) => x.id)).toEqual([
      draft.body.id,
    ]);

    const all = await list('?status=all');
    expect(all.body.count).toBe(2);

    const bad = await list('?status=nope');
    expect(bad.status).toBe(400);
    expect(bad.body.error).toBe('invalid_status');
  });

  test('GET /:id returns the full row incl. body_md; 404 + invalid_id', async () => {
    const created = await post({ title: 'full', bodyMd: 'the body' });
    const full = await getOne(created.body.id as string);
    expect(full.status).toBe(200);
    expect(full.body.bodyMd).toBe('the body');

    const missing = await getOne(MISSING_ID);
    expect(missing.status).toBe(404);

    const bad = await getOne('not-a-uuid');
    expect(bad.status).toBe(400);
    expect(bad.body.error).toBe('invalid_id');
  });

  test('PATCH publish stamps publishedAt + publishedUrl; published→draft keeps the stamp', async () => {
    const created = await post({ title: 'ship it' });
    const pubd = await patch(created.body.id as string, {
      status: 'published',
      publishedUrl: 'https://x.com/i/article/1',
    });
    expect(pubd.status).toBe(200);
    expect(pubd.body.status).toBe('published');
    expect(pubd.body.publishedAt).not.toBeNull();
    expect(pubd.body.publishedUrl).toBe('https://x.com/i/article/1');
    const stamp = pubd.body.publishedAt;

    const reopened = await patch(created.body.id as string, { status: 'draft' });
    expect(reopened.body.status).toBe('draft');
    expect(reopened.body.publishedAt).toBe(stamp); // history preserved
  });

  test('PATCH autosave: only supplied fields change and updatedAt bumps', async () => {
    const id = crypto.randomUUID();
    await db
      .insert(articles)
      .values({ id, title: 'orig', subtitle: 'sub', bodyMd: 'keep me', updatedAt: new Date(1000) });

    const before = Date.now();
    const r = await patch(id, { title: 'renamed' });
    expect(r.status).toBe(200);
    expect(r.body.title).toBe('renamed');
    expect(r.body.subtitle).toBe('sub'); // untouched
    expect(r.body.bodyMd).toBe('keep me'); // untouched
    expect(new Date(r.body.updatedAt as string).getTime()).toBeGreaterThanOrEqual(before);
  });

  test('PATCH empty body → empty_patch 400; unknown id → 404', async () => {
    const created = await post({ title: 'x' });
    const empty = await patch(created.body.id as string, {});
    expect(empty.status).toBe(400);
    expect(empty.body.error).toBe('empty_patch');

    const missing = await patch(MISSING_ID, { title: 'y' });
    expect(missing.status).toBe(404);
  });

  test('discarded row is frozen except status back to draft', async () => {
    const created = await post({ title: 'doomed' });
    const id = created.body.id as string;
    const discarded = await patch(id, { status: 'discarded' });
    expect(discarded.body.status).toBe('discarded');

    // A content edit on a discarded row is refused.
    const blocked = await patch(id, { title: 'sneaky' });
    expect(blocked.status).toBe(409);
    expect(blocked.body.error).toBe('discarded_locked');

    // status:draft WITH a content field is still refused (must be a bare revive).
    const blocked2 = await patch(id, { status: 'draft', title: 'sneaky' });
    expect(blocked2.status).toBe(409);

    // Re-publishing a discarded row is refused too.
    const blocked3 = await patch(id, { status: 'published' });
    expect(blocked3.status).toBe(409);

    // A bare un-discard is allowed.
    const revived = await patch(id, { status: 'draft' });
    expect(revived.status).toBe(200);
    expect(revived.body.status).toBe('draft');
  });

  test('DELETE hard-deletes then 404s', async () => {
    const created = await post({ title: 'temp' });
    const id = created.body.id as string;

    const res = await app.request(`/x/articles/${id}`, { method: 'DELETE' });
    expect(res.status).toBe(204);

    const rows = await db.select().from(articles).where(eq(articles.id, id));
    expect(rows.length).toBe(0);

    const again = await app.request(`/x/articles/${id}`, { method: 'DELETE' });
    expect(again.status).toBe(404);
  });
});

// The assist route's $0 refusal ladder (A3.12). The paid Grok path is left to
// the A3.15 --live smoke (no mock harness — the A3.9 DM convention): forcing both
// provider keys off makes a valid request hit the 503 refusal instead of spending.
describe('articles assist guards (A3.12)', () => {
  let savedXai: string | undefined;
  let savedOr: string | undefined;

  beforeAll(() => {
    savedXai = process.env.XAI_API_KEY;
    savedOr = process.env.OPENROUTER_API_KEY;
    process.env.XAI_API_KEY = '';
    process.env.OPENROUTER_API_KEY = '';
  });

  afterAll(() => {
    process.env.XAI_API_KEY = savedXai ?? '';
    process.env.OPENROUTER_API_KEY = savedOr ?? '';
  });

  test('invalid id → 400', async () => {
    const r = await assist('not-a-uuid', { mode: 'outline', idea: 'x' });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe('invalid_id');
  });

  test('unknown mode → 400 invalid_mode (before any DB lookup)', async () => {
    const created = await post({ title: 'a' });
    const r = await assist(created.body.id as string, { mode: 'nope', idea: 'x' });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe('invalid_mode');
  });

  test('per-mode required seed → 400', async () => {
    const created = await post({ title: 'a' });
    const id = created.body.id as string;
    expect((await assist(id, { mode: 'outline' })).body.error).toBe('idea_required');
    expect((await assist(id, { mode: 'full' })).body.error).toBe('idea_required');
    expect((await assist(id, { mode: 'section' })).body.error).toBe('heading_required');
    expect((await assist(id, { mode: 'polish' })).body.error).toBe('selection_required');
  });

  test('unknown article → 404 (valid mode + seed)', async () => {
    const r = await assist(MISSING_ID, { mode: 'outline', idea: 'x' });
    expect(r.status).toBe(404);
    expect(r.body.error).toBe('not_found');
  });

  test('discarded article → 409 discarded_locked (before the key check, never spends)', async () => {
    const created = await post({ title: 'doomed' });
    const id = created.body.id as string;
    await patch(id, { status: 'discarded' });
    const r = await assist(id, { mode: 'polish', selection: 'some prose' });
    expect(r.status).toBe(409);
    expect(r.body.error).toBe('discarded_locked');
  });

  test('valid request, no LLM provider → 503 (never a silent fabrication)', async () => {
    const created = await post({ title: 'ready' });
    const r = await assist(created.body.id as string, {
      mode: 'outline',
      idea: 'how I ship weekly',
    });
    expect(r.status).toBe(503);
    expect(r.body.error).toBe('grok_not_configured');
  });
});
