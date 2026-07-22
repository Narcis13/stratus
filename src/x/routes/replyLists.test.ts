// RL.2 reply-list CRUD: the round-trip, cascade delete, atomic replace, and the
// validation guards — over the real (in-memory, auto-migrated) SQLite DB; bun
// test runs with SQLITE_PATH=:memory:. The DB is shared across suites, so every
// list this file creates is deleted in afterAll (items cascade with them).

import { afterAll, describe, expect, test } from 'bun:test';
import { inArray } from 'drizzle-orm';
import { Hono } from 'hono';
import { db } from '../../db/client.ts';
import { replyListItems, replyLists } from '../db/schema.ts';
import { DEFAULT_HUMANIZER, type HumanizerConfig } from '../replyLists/engine.ts';
import { replyListsRouter } from './replyLists.ts';

const app = new Hono();
app.route('/x', replyListsRouter);

const createdListIds: string[] = [];
const MISSING_UUID = '00000000-0000-4000-8000-000000000000';

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

interface ListRow {
  id: string;
  name: string;
  description: string | null;
  humanizer: HumanizerConfig | null;
  active: boolean;
  sortOrder: number;
}

interface ItemRow {
  id: string;
  listId: string;
  text: string;
  enabled: boolean;
  source: string;
  lastUsedAt: number | null;
  useCount: number;
}

async function createList(body: Record<string, unknown>): Promise<ListRow> {
  const res = await send<ListRow>('/x/reply-lists', 'POST', body);
  expect(res.status).toBe(201);
  createdListIds.push(res.body.id);
  return res.body;
}

afterAll(async () => {
  if (createdListIds.length > 0) {
    await db.delete(replyLists).where(inArray(replyLists.id, createdListIds));
  }
});

describe('reply list CRUD', () => {
  test('create → list with counts → get → patch → delete', async () => {
    const list = await createList({
      name: '  Thanks replies  ',
      description: 'quick acknowledgments',
      sortOrder: 3,
    });
    expect(list.name).toBe('Thanks replies');
    expect(list.description).toBe('quick acknowledgments');
    expect(list.humanizer).toBeNull();
    expect(list.active).toBe(true);
    expect(list.sortOrder).toBe(3);

    const added = await send<{ items: ItemRow[] }>(`/x/reply-lists/${list.id}/items`, 'POST', {
      mode: 'append',
      items: [{ text: 'thanks for the early read, {name}!' }, { text: 'appreciate this one' }],
    });
    expect(added.status).toBe(200);
    expect(added.body.items).toHaveLength(2);
    // Insertion order survives the round-trip.
    expect(added.body.items.map((i) => i.text)).toEqual([
      'thanks for the early read, {name}!',
      'appreciate this one',
    ]);
    expect(added.body.items[0]?.source).toBe('manual');
    expect(added.body.items[0]?.useCount).toBe(0);
    expect(added.body.items[0]?.lastUsedAt).toBeNull();

    const disabled = await send<ItemRow>(
      `/x/reply-lists/${list.id}/items/${added.body.items[1]?.id}`,
      'PATCH',
      { enabled: false },
    );
    expect(disabled.status).toBe(200);
    expect(disabled.body.enabled).toBe(false);

    const collection = await send<Array<ListRow & { itemCount: number; enabledCount: number }>>(
      '/x/reply-lists',
      'GET',
    );
    expect(collection.status).toBe(200);
    const mine = collection.body.find((l) => l.id === list.id);
    expect(mine?.itemCount).toBe(2);
    expect(mine?.enabledCount).toBe(1);

    const got = await send<{ list: ListRow; items: ItemRow[] }>(`/x/reply-lists/${list.id}`, 'GET');
    expect(got.status).toBe(200);
    expect(got.body.list.id).toBe(list.id);
    expect(got.body.items).toHaveLength(2);

    const patched = await send<ListRow>(`/x/reply-lists/${list.id}`, 'PATCH', {
      name: 'Thanks',
      active: false,
      description: '',
    });
    expect(patched.status).toBe(200);
    expect(patched.body.name).toBe('Thanks');
    expect(patched.body.active).toBe(false);
    expect(patched.body.description).toBeNull();

    const removed = await send<{ ok: boolean }>(`/x/reply-lists/${list.id}`, 'DELETE');
    expect(removed.status).toBe(200);
    expect(removed.body.ok).toBe(true);
    expect((await send(`/x/reply-lists/${list.id}`, 'GET')).status).toBe(404);
  });

  test('deleting a list cascades its items away', async () => {
    const list = await createList({ name: 'cascade probe' });
    await send(`/x/reply-lists/${list.id}/items`, 'POST', {
      mode: 'append',
      items: [{ text: 'one' }, { text: 'two' }],
    });

    expect(
      (
        await db
          .select()
          .from(replyListItems)
          .where(inArray(replyListItems.listId, [list.id]))
      ).length,
    ).toBe(2);

    await send(`/x/reply-lists/${list.id}`, 'DELETE');

    const orphans = await db
      .select()
      .from(replyListItems)
      .where(inArray(replyListItems.listId, [list.id]));
    expect(orphans).toHaveLength(0);
  });

  test('replace mode swaps the whole set; append adds to it', async () => {
    const list = await createList({ name: 'replace probe' });

    const first = await send<{ items: ItemRow[] }>(`/x/reply-lists/${list.id}/items`, 'POST', {
      mode: 'append',
      items: [{ text: 'old one' }, { text: 'old two' }],
    });
    const oldIds = first.body.items.map((i) => i.id);

    const replaced = await send<{ items: ItemRow[] }>(`/x/reply-lists/${list.id}/items`, 'POST', {
      mode: 'replace',
      items: [{ text: 'new one' }, { text: 'new two' }, { text: 'new three' }],
      source: 'ai',
    });
    expect(replaced.status).toBe(200);
    expect(replaced.body.items.map((i) => i.text)).toEqual(['new one', 'new two', 'new three']);
    expect(replaced.body.items.every((i) => i.source === 'ai')).toBe(true);
    expect(replaced.body.items.some((i) => oldIds.includes(i.id))).toBe(false);

    const appended = await send<{ items: ItemRow[] }>(`/x/reply-lists/${list.id}/items`, 'POST', {
      mode: 'append',
      items: [{ text: 'new four' }],
    });
    // The response is always the list's whole current set, so both modes read alike.
    expect(appended.body.items).toHaveLength(4);
    expect(appended.body.items.at(-1)?.text).toBe('new four');

    // An empty replace clears the list — the panel's "start over" path.
    const cleared = await send<{ items: ItemRow[] }>(`/x/reply-lists/${list.id}/items`, 'POST', {
      mode: 'replace',
      items: [],
    });
    expect(cleared.body.items).toHaveLength(0);
  });

  test('item delete is scoped to its list', async () => {
    const a = await createList({ name: 'scope a' });
    const b = await createList({ name: 'scope b' });
    const added = await send<{ items: ItemRow[] }>(`/x/reply-lists/${a.id}/items`, 'POST', {
      mode: 'append',
      items: [{ text: 'belongs to a' }],
    });
    const itemId = added.body.items[0]?.id ?? '';

    // Right item, wrong list → 404, and the item survives.
    expect((await send(`/x/reply-lists/${b.id}/items/${itemId}`, 'DELETE')).status).toBe(404);
    expect(
      (await send(`/x/reply-lists/${b.id}/items/${itemId}`, 'PATCH', { enabled: false })).status,
    ).toBe(404);
    expect((await send(`/x/reply-lists/${a.id}/items/${itemId}`, 'DELETE')).status).toBe(200);
  });
});

describe('reply list validation', () => {
  test('name is required and bounded', async () => {
    expect((await send('/x/reply-lists', 'POST', { name: '   ' })).status).toBe(400);
    expect((await send('/x/reply-lists', 'POST', { name: 'x'.repeat(121) })).status).toBe(400);
    expect((await send('/x/reply-lists', 'POST', 'nope')).status).toBe(400);
  });

  test('humanizer: null clears, a partial object is lenient-parsed, a non-object 400s', async () => {
    const list = await createList({
      name: 'humanizer probe',
      humanizer: { typoChance: 0.5, prefixes: ['yo'], prefixChance: 'nope' },
    });
    // Bad field falls back to the default; good fields survive (D76a).
    expect(list.humanizer?.typoChance).toBe(0.5);
    expect(list.humanizer?.prefixes).toEqual(['yo']);
    expect(list.humanizer?.prefixChance).toBe(DEFAULT_HUMANIZER.prefixChance);
    expect(list.humanizer?.suffixes).toEqual(DEFAULT_HUMANIZER.suffixes);

    const cleared = await send<ListRow>(`/x/reply-lists/${list.id}`, 'PATCH', { humanizer: null });
    expect(cleared.status).toBe(200);
    expect(cleared.body.humanizer).toBeNull();

    for (const bad of [42, 'heavy', [1, 2], true]) {
      expect((await send('/x/reply-lists', 'POST', { name: 'bad', humanizer: bad })).status).toBe(
        400,
      );
      expect((await send(`/x/reply-lists/${list.id}`, 'PATCH', { humanizer: bad })).status).toBe(
        400,
      );
    }
  });

  test('item text is 1..280 and batches cap at 100', async () => {
    const list = await createList({ name: 'items probe' });
    const path = `/x/reply-lists/${list.id}/items`;

    expect((await send(path, 'POST', { mode: 'append', items: [{ text: '' }] })).status).toBe(400);
    expect(
      (await send(path, 'POST', { mode: 'append', items: [{ text: 'x'.repeat(281) }] })).status,
    ).toBe(400);
    expect((await send(path, 'POST', { mode: 'append', items: ['bare string'] })).status).toBe(400);
    expect((await send(path, 'POST', { mode: 'append', items: 'nope' })).status).toBe(400);
    expect((await send(path, 'POST', { mode: 'sneak', items: [] })).status).toBe(400);
    expect(
      (await send(path, 'POST', { mode: 'append', items: [{ text: 'ok' }], source: 'grok' }))
        .status,
    ).toBe(400);

    const tooMany = Array.from({ length: 101 }, (_, i) => ({ text: `item ${i}` }));
    expect((await send(path, 'POST', { mode: 'replace', items: tooMany })).status).toBe(400);

    // Exactly 280 chars is fine, and exactly 100 items is fine.
    const ok = await send<{ items: ItemRow[] }>(path, 'POST', {
      mode: 'replace',
      items: [
        { text: 'x'.repeat(280) },
        ...Array.from({ length: 99 }, (_, i) => ({ text: `fits ${i}` })),
      ],
    });
    expect(ok.status).toBe(200);
    expect(ok.body.items).toHaveLength(100);
  });

  test('unknown ids 404, malformed ids 400, empty patches 400', async () => {
    expect((await send(`/x/reply-lists/${MISSING_UUID}`, 'GET')).status).toBe(404);
    expect((await send(`/x/reply-lists/${MISSING_UUID}`, 'PATCH', { name: 'x' })).status).toBe(404);
    expect((await send(`/x/reply-lists/${MISSING_UUID}`, 'DELETE')).status).toBe(404);
    expect(
      (await send(`/x/reply-lists/${MISSING_UUID}/items`, 'POST', { mode: 'append', items: [] }))
        .status,
    ).toBe(404);
    expect(
      (
        await send(`/x/reply-lists/${MISSING_UUID}/items/${MISSING_UUID}`, 'PATCH', {
          enabled: true,
        })
      ).status,
    ).toBe(404);

    expect((await send('/x/reply-lists/not-a-uuid', 'GET')).status).toBe(400);

    const list = await createList({ name: 'patch probe' });
    expect((await send(`/x/reply-lists/${list.id}`, 'PATCH', {})).status).toBe(400);
    expect((await send(`/x/reply-lists/${list.id}`, 'PATCH', { sortOrder: 1.5 })).status).toBe(400);
    expect((await send(`/x/reply-lists/${list.id}`, 'PATCH', { active: 'yes' })).status).toBe(400);
  });
});
