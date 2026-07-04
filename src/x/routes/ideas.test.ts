// C6 Idea Inbox: lifecycle (open → consumed with backlink → reopened clears
// it), validation guards, and the calendar "seeded by" join — all over the real
// (in-memory, auto-migrated) SQLite DB; bun test runs with SQLITE_PATH=:memory:.

import { describe, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { db } from '../../db/client.ts';
import { ideas, scheduledPosts } from '../db/schema.ts';
import { calendar } from './calendar.ts';
import { consumeIdeaSafe, ideasRouter } from './ideas.ts';

const app = new Hono();
app.route('/x', ideasRouter);
app.route('/x', calendar);

async function send<T>(
  path: string,
  method: string,
  body?: unknown,
): Promise<{ status: number; body: T }> {
  const res = await app.request(path, {
    method,
    ...(body !== undefined
      ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }
      : {}),
  });
  const parsed = res.status === 204 ? (undefined as T) : ((await res.json()) as T);
  return { status: res.status, body: parsed };
}

interface IdeaRow {
  id: string;
  text: string;
  sourceUrl: string | null;
  tags: string[] | null;
  status: string;
  consumedByTable: string | null;
  consumedById: string | null;
}

describe('idea lifecycle', () => {
  test('create → list open → consume with backlink → reopen clears it → discard → delete', async () => {
    const created = await send<IdeaRow>('/x/ideas', 'POST', {
      text: 'idee: agentii AI ca angajati',
      sourceUrl: 'https://example.com/thread',
      tags: ['ai-craft'],
    });
    expect(created.status).toBe(201);
    expect(created.body.status).toBe('open');
    expect(created.body.sourceUrl).toBe('https://example.com/thread');
    expect(created.body.tags).toEqual(['ai-craft']);
    const id = created.body.id;

    const open = await send<{ ideas: IdeaRow[] }>('/x/ideas', 'GET');
    expect(open.status).toBe(200);
    expect(open.body.ideas.some((i) => i.id === id)).toBe(true);

    const consumed = await send<IdeaRow>(`/x/ideas/${id}`, 'PATCH', {
      status: 'consumed',
      consumedByTable: 'reply_drafts',
      consumedById: 'draft-1',
    });
    expect(consumed.status).toBe(200);
    expect(consumed.body.status).toBe('consumed');
    expect(consumed.body.consumedByTable).toBe('reply_drafts');
    expect(consumed.body.consumedById).toBe('draft-1');

    // A consumed idea leaves the default (open) list…
    const openAfter = await send<{ ideas: IdeaRow[] }>('/x/ideas', 'GET');
    expect(openAfter.body.ideas.some((i) => i.id === id)).toBe(false);
    // …and shows in the consumed view.
    const consumedList = await send<{ ideas: IdeaRow[] }>('/x/ideas?status=consumed', 'GET');
    expect(consumedList.body.ideas.some((i) => i.id === id)).toBe(true);

    // Re-use is one click: reopen clears provenance.
    const reopened = await send<IdeaRow>(`/x/ideas/${id}`, 'PATCH', { status: 'open' });
    expect(reopened.body.status).toBe('open');
    expect(reopened.body.consumedByTable).toBeNull();
    expect(reopened.body.consumedById).toBeNull();

    const discarded = await send<IdeaRow>(`/x/ideas/${id}`, 'PATCH', { status: 'discarded' });
    expect(discarded.body.status).toBe('discarded');

    const deleted = await send(`/x/ideas/${id}`, 'DELETE');
    expect(deleted.status).toBe(204);
    expect((await send(`/x/ideas/${id}`, 'DELETE')).status).toBe(404);
  });

  test('consumeIdeaSafe only advances open ideas and never throws', async () => {
    const created = await send<IdeaRow>('/x/ideas', 'POST', { text: 'consume-safe target' });
    const id = created.body.id;

    await consumeIdeaSafe(id, 'scheduled_posts', 'post-row-1');
    let [row] = await db.select().from(ideas).where(eq(ideas.id, id));
    expect(row?.status).toBe('consumed');
    expect(row?.consumedById).toBe('post-row-1');

    // Second consume must not clobber the first provenance.
    await consumeIdeaSafe(id, 'reply_drafts', 'draft-row-2');
    [row] = await db.select().from(ideas).where(eq(ideas.id, id));
    expect(row?.consumedByTable).toBe('scheduled_posts');
    expect(row?.consumedById).toBe('post-row-1');

    // Unknown id is a no-op, not an error.
    await consumeIdeaSafe(crypto.randomUUID(), 'reply_drafts', 'x');

    await db.delete(ideas).where(eq(ideas.id, id));
  });

  test('validation: empty/too-long text, bad status, bad consumed_by, orphan consumed_by', async () => {
    expect((await send('/x/ideas', 'POST', { text: '' })).status).toBe(400);
    expect((await send('/x/ideas', 'POST', { text: 'x'.repeat(2001) })).status).toBe(400);
    expect((await send('/x/ideas', 'POST', { text: 'ok', tags: ['', 'a'] })).status).toBe(400);
    expect((await send('/x/ideas?status=bogus', 'GET')).status).toBe(400);

    const created = await send<IdeaRow>('/x/ideas', 'POST', { text: 'validation target' });
    const id = created.body.id;
    expect((await send(`/x/ideas/${id}`, 'PATCH', { status: 'eaten' })).status).toBe(400);
    expect(
      (
        await send(`/x/ideas/${id}`, 'PATCH', {
          status: 'consumed',
          consumedByTable: 'tokens',
          consumedById: 'x',
        })
      ).status,
    ).toBe(400);
    // consumed_by without status=consumed is rejected.
    expect(
      (await send(`/x/ideas/${id}`, 'PATCH', { consumedByTable: 'reply_drafts' })).status,
    ).toBe(400);
    expect((await send(`/x/ideas/${id}`, 'PATCH', {})).status).toBe(400);
    expect((await send('/x/ideas/not-a-uuid', 'PATCH', { status: 'open' })).status).toBe(400);
    await send(`/x/ideas/${id}`, 'DELETE');
  });

  test('calendar detail carries "seeded by" provenance', async () => {
    const [post] = await db
      .insert(scheduledPosts)
      .values({ text: 'the Thursday post', status: 'draft', source: 'drafter' })
      .returning();
    if (!post) throw new Error('insert failed');

    const created = await send<IdeaRow>('/x/ideas', 'POST', { text: 'Monday idea' });
    await consumeIdeaSafe(created.body.id, 'scheduled_posts', post.id);

    const detail = await send<{ seededBy: { id: string; text: string } | null }>(
      `/x/posts/scheduled/${post.id}`,
      'GET',
    );
    expect(detail.status).toBe(200);
    expect(detail.body.seededBy?.id).toBe(created.body.id);
    expect(detail.body.seededBy?.text).toBe('Monday idea');

    // A row nothing seeded reports null.
    const [bare] = await db
      .insert(scheduledPosts)
      .values({ text: 'hand-written', status: 'draft' })
      .returning();
    if (!bare) throw new Error('insert failed');
    const bareDetail = await send<{ seededBy: unknown }>(`/x/posts/scheduled/${bare.id}`, 'GET');
    expect(bareDetail.body.seededBy).toBeNull();

    await db.delete(ideas).where(eq(ideas.id, created.body.id));
    await db.delete(scheduledPosts).where(eq(scheduledPosts.id, post.id));
    await db.delete(scheduledPosts).where(eq(scheduledPosts.id, bare.id));
  });
});
