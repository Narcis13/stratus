// Reply lists (RL) — CRUD over the premade canned-reply lists and their items.
// Mounted under `/x` by `mountX` in ../index.ts — always mounted, every route
// here is $0 (pure SQL; nothing touches X or an LLM). The two routes that need
// more land later: `/use` (RL.3, still $0) and `/generate` (RL.4, one LLM call
// behind a runtime key check, pillars.ts shape).
//
// Routes:
//   GET    /reply-lists                      → [{...list, itemCount, enabledCount}] (sortOrder asc)
//   POST   /reply-lists                      { name, description?, humanizer?, active?, sortOrder? }
//   GET    /reply-lists/:id                  → { list, items }  (items createdAt asc)
//   PATCH  /reply-lists/:id                  partial { name?, description?, humanizer?, active?, sortOrder? }
//   DELETE /reply-lists/:id                  items cascade; the use log survives on purpose
//   POST   /reply-lists/:id/items            { mode:'append'|'replace', items:[{text}], source? }
//   PATCH  /reply-lists/:id/items/:itemId    { text?, enabled? }
//   DELETE /reply-lists/:id/items/:itemId
//
// `humanizer` is stored normalized through the engine's parseHumanizerConfig, so
// /use never re-validates: `null` in the body clears back to DEFAULT_HUMANIZER,
// a non-object value is a 400 (parseHumanizerConfig returns null only for those;
// a partially-bad object falls back field-by-field and is accepted).

import { and, asc, eq, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { db } from '../../db/client.ts';
import { replyListItems, replyLists } from '../db/schema.ts';
import { MAX_REPLY_LENGTH, parseHumanizerConfig } from '../replyLists/engine.ts';

const MAX_NAME_LEN = 120;
const MAX_DESCRIPTION_LEN = 2000;
// Per call, not per list — a generated batch (RL.4 caps at 30) or a paste of an
// existing swipe file both fit comfortably.
const MAX_ITEMS_PER_CALL = 100;
const ITEM_SOURCES = ['manual', 'ai'] as const;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const replyListsRouter = new Hono();

replyListsRouter.get('/reply-lists', async (c) => {
  const lists = await db
    .select()
    .from(replyLists)
    .orderBy(asc(replyLists.sortOrder), asc(replyLists.createdAt));

  // One grouped select for both counts — the list rail shows "n items · m on".
  const counts = await db
    .select({
      listId: replyListItems.listId,
      itemCount: sql<number>`count(*)`,
      enabledCount: sql<number>`sum(case when ${replyListItems.enabled} then 1 else 0 end)`,
    })
    .from(replyListItems)
    .groupBy(replyListItems.listId);
  const byList = new Map(counts.map((r) => [r.listId, r]));

  return c.json(
    lists.map((l) => {
      const hit = byList.get(l.id);
      return {
        ...l,
        itemCount: Number(hit?.itemCount ?? 0),
        enabledCount: Number(hit?.enabledCount ?? 0),
      };
    }),
  );
});

replyListsRouter.post('/reply-lists', async (c) => {
  const raw = await c.req.json().catch(() => null);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw))
    return c.json({ error: 'invalid_body' }, 400);
  const b = raw as Record<string, unknown>;

  const name = typeof b.name === 'string' ? b.name.trim() : '';
  if (name === '' || name.length > MAX_NAME_LEN) return c.json({ error: 'invalid_name' }, 400);

  const description = parseDescription(b.description);
  if (description === 'invalid') return c.json({ error: 'invalid_description' }, 400);

  const humanizer = parseHumanizerField(b.humanizer);
  if (humanizer === 'invalid') return c.json({ error: 'invalid_humanizer' }, 400);

  if (b.active !== undefined && typeof b.active !== 'boolean')
    return c.json({ error: 'invalid_active' }, 400);
  if (
    b.sortOrder !== undefined &&
    (typeof b.sortOrder !== 'number' || !Number.isInteger(b.sortOrder))
  )
    return c.json({ error: 'invalid_sort_order' }, 400);

  const [row] = await db
    .insert(replyLists)
    .values({
      name,
      description,
      humanizer,
      ...(typeof b.active === 'boolean' ? { active: b.active } : {}),
      ...(typeof b.sortOrder === 'number' ? { sortOrder: b.sortOrder } : {}),
    })
    .returning();
  return c.json(row, 201);
});

replyListsRouter.get('/reply-lists/:id', async (c) => {
  const id = c.req.param('id');
  if (!UUID_RE.test(id)) return c.json({ error: 'invalid_id' }, 400);

  const [list] = await db.select().from(replyLists).where(eq(replyLists.id, id));
  if (!list) return c.json({ error: 'not_found' }, 404);

  const items = await db
    .select()
    .from(replyListItems)
    .where(eq(replyListItems.listId, id))
    .orderBy(asc(replyListItems.createdAt), asc(replyListItems.id));

  return c.json({ list, items });
});

replyListsRouter.patch('/reply-lists/:id', async (c) => {
  const id = c.req.param('id');
  if (!UUID_RE.test(id)) return c.json({ error: 'invalid_id' }, 400);

  const raw = await c.req.json().catch(() => null);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw))
    return c.json({ error: 'invalid_body' }, 400);
  const b = raw as Record<string, unknown>;

  const updates: Partial<typeof replyLists.$inferInsert> = {};

  if (b.name !== undefined) {
    const name = typeof b.name === 'string' ? b.name.trim() : '';
    if (name === '' || name.length > MAX_NAME_LEN) return c.json({ error: 'invalid_name' }, 400);
    updates.name = name;
  }
  if (b.description !== undefined) {
    const description = parseDescription(b.description);
    if (description === 'invalid') return c.json({ error: 'invalid_description' }, 400);
    updates.description = description;
  }
  if (b.humanizer !== undefined) {
    const humanizer = parseHumanizerField(b.humanizer);
    if (humanizer === 'invalid') return c.json({ error: 'invalid_humanizer' }, 400);
    updates.humanizer = humanizer;
  }
  if (b.active !== undefined) {
    if (typeof b.active !== 'boolean') return c.json({ error: 'invalid_active' }, 400);
    updates.active = b.active;
  }
  if (b.sortOrder !== undefined) {
    if (typeof b.sortOrder !== 'number' || !Number.isInteger(b.sortOrder))
      return c.json({ error: 'invalid_sort_order' }, 400);
    updates.sortOrder = b.sortOrder;
  }

  if (Object.keys(updates).length === 0) return c.json({ error: 'empty_patch' }, 400);

  updates.updatedAt = new Date();
  const [row] = await db.update(replyLists).set(updates).where(eq(replyLists.id, id)).returning();
  if (!row) return c.json({ error: 'not_found' }, 404);
  return c.json(row);
});

replyListsRouter.delete('/reply-lists/:id', async (c) => {
  const id = c.req.param('id');
  if (!UUID_RE.test(id)) return c.json({ error: 'invalid_id' }, 400);

  // Items cascade (FK). reply_list_uses deliberately does NOT — the measurement
  // history outlives the list it came from.
  const deleted = await db.delete(replyLists).where(eq(replyLists.id, id)).returning({
    id: replyLists.id,
  });
  if (deleted.length === 0) return c.json({ error: 'not_found' }, 404);
  return c.json({ ok: true });
});

replyListsRouter.post('/reply-lists/:id/items', async (c) => {
  const id = c.req.param('id');
  if (!UUID_RE.test(id)) return c.json({ error: 'invalid_id' }, 400);

  const raw = await c.req.json().catch(() => null);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw))
    return c.json({ error: 'invalid_body' }, 400);
  const b = raw as Record<string, unknown>;

  const mode = b.mode === 'replace' ? 'replace' : b.mode === 'append' ? 'append' : null;
  if (mode === null) return c.json({ error: 'invalid_mode' }, 400);

  const texts = parseItemTexts(b.items);
  if (texts === 'invalid') return c.json({ error: 'invalid_items' }, 400);

  let source: (typeof ITEM_SOURCES)[number] = 'manual';
  if (b.source !== undefined && b.source !== null) {
    if (typeof b.source !== 'string' || !(ITEM_SOURCES as readonly string[]).includes(b.source))
      return c.json({ error: 'invalid_source' }, 400);
    source = b.source as (typeof ITEM_SOURCES)[number];
  }

  const [list] = await db
    .select({ id: replyLists.id })
    .from(replyLists)
    .where(eq(replyLists.id, id));
  if (!list) return c.json({ error: 'not_found' }, 404);

  // One sync txn (§7.13 — no await inside, .all()/.run() terminals): a replace
  // never leaves the list empty-then-crashed.
  const items = db.transaction((tx) => {
    if (mode === 'replace') tx.delete(replyListItems).where(eq(replyListItems.listId, id)).run();

    // Insertion order has to survive the round-trip (the panel and the AI
    // preview both show items in the order they were written), but a batch
    // insert shares one `unixepoch()` default down to the millisecond — and an
    // append landing in the same millisecond as the previous batch would tie
    // with it. So stamp createdAt explicitly, past whatever is already there.
    let base = Date.now();
    if (texts.length > 0) {
      const [newest] = tx
        .select({ max: sql<number | null>`max(${replyListItems.createdAt})` })
        .from(replyListItems)
        .where(eq(replyListItems.listId, id))
        .all();
      const maxCreated = Number(newest?.max ?? 0);
      if (maxCreated >= base) base = maxCreated + 1;
    }
    const values = texts.map((text, i) => ({
      listId: id,
      text,
      source,
      createdAt: new Date(base + i),
      updatedAt: new Date(base + i),
    }));

    if (values.length > 0) tx.insert(replyListItems).values(values).run();
    return tx
      .select()
      .from(replyListItems)
      .where(eq(replyListItems.listId, id))
      .orderBy(asc(replyListItems.createdAt), asc(replyListItems.id))
      .all();
  });

  // The list's whole current set, so append and replace answer the same shape.
  return c.json({ items });
});

replyListsRouter.patch('/reply-lists/:id/items/:itemId', async (c) => {
  const id = c.req.param('id');
  const itemId = c.req.param('itemId');
  if (!UUID_RE.test(id) || !UUID_RE.test(itemId)) return c.json({ error: 'invalid_id' }, 400);

  const raw = await c.req.json().catch(() => null);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw))
    return c.json({ error: 'invalid_body' }, 400);
  const b = raw as Record<string, unknown>;

  const updates: Partial<typeof replyListItems.$inferInsert> = {};
  if (b.text !== undefined) {
    const text = typeof b.text === 'string' ? b.text.trim() : '';
    if (text === '' || text.length > MAX_REPLY_LENGTH)
      return c.json({ error: 'invalid_text' }, 400);
    updates.text = text;
  }
  if (b.enabled !== undefined) {
    if (typeof b.enabled !== 'boolean') return c.json({ error: 'invalid_enabled' }, 400);
    updates.enabled = b.enabled;
  }
  if (Object.keys(updates).length === 0) return c.json({ error: 'empty_patch' }, 400);

  updates.updatedAt = new Date();
  const [row] = await db
    .update(replyListItems)
    .set(updates)
    .where(and(eq(replyListItems.id, itemId), eq(replyListItems.listId, id)))
    .returning();
  if (!row) return c.json({ error: 'not_found' }, 404);
  return c.json(row);
});

replyListsRouter.delete('/reply-lists/:id/items/:itemId', async (c) => {
  const id = c.req.param('id');
  const itemId = c.req.param('itemId');
  if (!UUID_RE.test(id) || !UUID_RE.test(itemId)) return c.json({ error: 'invalid_id' }, 400);

  const deleted = await db
    .delete(replyListItems)
    .where(and(eq(replyListItems.id, itemId), eq(replyListItems.listId, id)))
    .returning({ id: replyListItems.id });
  if (deleted.length === 0) return c.json({ error: 'not_found' }, 404);
  return c.json({ ok: true });
});

// ---------------------------------------------------------------- helpers

function parseDescription(value: unknown): string | null | 'invalid' {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') return 'invalid';
  const trimmed = value.trim();
  if (trimmed === '') return null;
  if (trimmed.length > MAX_DESCRIPTION_LEN) return 'invalid';
  return trimmed;
}

/** null = clear to the engine defaults; anything that isn't a plain object is a
 *  400 (a partially-bad object is lenient-parsed field by field — D76a). */
function parseHumanizerField(value: unknown): ReturnType<typeof parseHumanizerConfig> | 'invalid' {
  if (value === undefined || value === null) return null;
  const parsed = parseHumanizerConfig(value);
  return parsed === null ? 'invalid' : parsed;
}

function parseItemTexts(value: unknown): string[] | 'invalid' {
  if (!Array.isArray(value) || value.length > MAX_ITEMS_PER_CALL) return 'invalid';
  const texts: string[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return 'invalid';
    const text = (entry as Record<string, unknown>).text;
    if (typeof text !== 'string') return 'invalid';
    const trimmed = text.trim();
    if (trimmed === '' || trimmed.length > MAX_REPLY_LENGTH) return 'invalid';
    texts.push(trimmed);
  }
  return texts;
}
