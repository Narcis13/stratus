// Reply lists (RL) — CRUD over the premade canned-reply lists and their items,
// plus `/use` (the anti-repeat pick + humanized render). Mounted under `/x` by
// `mountX` in ../index.ts — always mounted, every route here is $0 (pure SQL and
// pure engine; nothing touches X or an LLM). The one route that needs more lands
// later: `/generate` (RL.4, one LLM call behind a runtime key check, pillars.ts
// shape).
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
//   POST   /reply-lists/:id/use              { vars?, targetTweetId?, targetHandle?, preview? }
//
// `humanizer` is stored normalized through the engine's parseHumanizerConfig, so
// /use never re-validates: `null` in the body clears back to DEFAULT_HUMANIZER,
// a non-object value is a 400 (parseHumanizerConfig returns null only for those;
// a partially-bad object falls back field-by-field and is accepted).

import { and, asc, eq, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { db } from '../../db/client.ts';
import { replyListItems, replyListUses, replyLists } from '../db/schema.ts';
import {
  MAX_REPLY_LENGTH,
  type ReplyVars,
  availableVarsFor,
  composeReply,
  parseHumanizerConfig,
  pickItem,
  resolveHumanizer,
} from '../replyLists/engine.ts';

const MAX_NAME_LEN = 120;
const MAX_DESCRIPTION_LEN = 2000;
// Per call, not per list — a generated batch (RL.4 caps at 30) or a paste of an
// existing swipe file both fit comfortably.
const MAX_ITEMS_PER_CALL = 100;
const MAX_VAR_LEN = 120;
const ITEM_SOURCES = ['manual', 'ai'] as const;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TWEET_ID_RE = /^\d{1,32}$/;
const USERNAME_RE = /^[A-Za-z0-9_]{1,15}$/;

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

// The whole point of the feature: pick something the account hasn't used
// recently, fill the target's name/handle in, jitter it just enough to not read
// as a macro, and hand back text. Posting stays a manual paste (§7.28) — this
// route never touches X, it only composes clipboard text.
replyListsRouter.post('/reply-lists/:id/use', async (c) => {
  const id = c.req.param('id');
  if (!UUID_RE.test(id)) return c.json({ error: 'invalid_id' }, 400);

  // A body-less POST is a legitimate "use with no target"; only a body that
  // parses to something other than an object is a 400.
  const raw = await c.req.json().catch(() => undefined);
  if (raw !== undefined && (raw === null || typeof raw !== 'object' || Array.isArray(raw)))
    return c.json({ error: 'invalid_body' }, 400);
  const b = (raw ?? {}) as Record<string, unknown>;

  const vars = parseVars(b.vars);
  if (vars === 'invalid') return c.json({ error: 'invalid_vars' }, 400);

  const targetTweetId = parsePattern(b.targetTweetId, TWEET_ID_RE);
  if (targetTweetId === 'invalid') return c.json({ error: 'invalid_target_tweet_id' }, 400);

  const targetHandle = parseTargetHandle(b.targetHandle);
  if (targetHandle === 'invalid') return c.json({ error: 'invalid_target_handle' }, 400);

  if (b.preview !== undefined && typeof b.preview !== 'boolean')
    return c.json({ error: 'invalid_preview' }, 400);
  const preview = b.preview === true;

  const [list] = await db.select().from(replyLists).where(eq(replyLists.id, id));
  if (!list) return c.json({ error: 'not_found' }, 404);

  // Every item, enabled or not — pickItem owns the enabled/var-availability
  // rules, so the filtering lives in exactly one place.
  const items = await db
    .select({
      id: replyListItems.id,
      text: replyListItems.text,
      enabled: replyListItems.enabled,
      lastUsedAt: replyListItems.lastUsedAt,
    })
    .from(replyListItems)
    .where(eq(replyListItems.listId, id));

  const item = pickItem(items, availableVarsFor(vars), Math.random);
  if (!item) return c.json({ error: 'no_enabled_items' }, 409);

  const { text, missingVars, applied } = composeReply(
    item.text,
    vars,
    resolveHumanizer(list.humanizer),
    Math.random,
  );

  if (!preview) {
    db.transaction((tx) => {
      // The anti-repeat window only holds while the item just used is STRICTLY
      // the most recent one: two uses inside the same millisecond tie on
      // last_used_at and pickItem's recency sort could then exclude the other
      // item and hand back an immediate repeat. Same monotonic-stamp trick the
      // items insert uses for created_at; the audit clock drifts by at most the
      // number of uses that shared a millisecond.
      const [newest] = tx
        .select({ max: sql<number | null>`max(${replyListItems.lastUsedAt})` })
        .from(replyListItems)
        .where(eq(replyListItems.listId, id))
        .all();
      const usedAt = new Date(Math.max(Date.now(), Number(newest?.max ?? 0) + 1));

      // updated_at deliberately untouched — it means "the text was edited".
      tx.update(replyListItems)
        .set({ lastUsedAt: usedAt, useCount: sql`${replyListItems.useCount} + 1` })
        .where(eq(replyListItems.id, item.id))
        .run();
      // Stored typos and all: RL.7 attributes a published reply to the `canned`
      // bucket by matching this text against what actually got posted.
      tx.insert(replyListUses)
        .values({
          listId: id,
          itemId: item.id,
          renderedText: text,
          targetTweetId,
          targetHandle,
          usedAt,
        })
        .run();
    });
  }

  return c.json({ itemId: item.id, text, missingVars, applied });
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

/** The render vars. Absent/empty fields simply stay unfilled — the engine
 *  degrades the template and reports them in `missingVars` (Decision 7). */
function parseVars(value: unknown): ReplyVars | 'invalid' {
  if (value === undefined || value === null) return {};
  if (typeof value !== 'object' || Array.isArray(value)) return 'invalid';
  const v = value as Record<string, unknown>;
  const out: ReplyVars = {};
  for (const key of ['name', 'handle'] as const) {
    const field = v[key];
    if (field === undefined || field === null) continue;
    if (typeof field !== 'string' || field.length > MAX_VAR_LEN) return 'invalid';
    const trimmed = field.trim();
    if (trimmed !== '') out[key] = trimmed;
  }
  return out;
}

function parsePattern(value: unknown, re: RegExp): string | null | 'invalid' {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') return 'invalid';
  const trimmed = value.trim();
  if (trimmed === '') return null;
  return re.test(trimmed) ? trimmed : 'invalid';
}

/** Audit metadata, normalized the way the rest of the repo stores handles
 *  (no `@`, lowercased) so the use log joins against people/voice rows later. */
function parseTargetHandle(value: unknown): string | null | 'invalid' {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') return 'invalid';
  const h = value.trim().replace(/^@/, '').toLowerCase();
  if (h === '') return null;
  return USERNAME_RE.test(h) ? h : 'invalid';
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
