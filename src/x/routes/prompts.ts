// Prompt editor routes (AI.4). CRUD-ish surface over `prompt_overrides` — the
// editable half of the AI.3 registry. Mounted under `/x` by `mountX` ALWAYS
// (next to `pillars`): editing a prompt must work with no LLM key configured,
// so this never gates on XAI_API_KEY / llmConfigured. Storage is override-rows-
// only (§Decision 1): a row's presence IS "customized"; reset/restore delete.
//
//   GET   /prompts                    list all keys with customized flags
//   GET   /prompts/:key               { key, body, defaultBody, customized, required }
//   PATCH /prompts/:key   { body }    validate placeholders → upsert override
//   POST  /prompts/:key/reset         delete this key's override row
//   POST  /prompts/restore-defaults   delete EVERY override row (the Settings button)
//
// Unknown key → 404 `unknown_prompt`. PATCH body > 32KB → 413.

import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { db } from '../../db/client.ts';
import { promptOverrides } from '../db/schema.ts';
import { PROMPT_KEYS, PROMPT_SPECS, isPromptKey, validatePromptBody } from '../prompts/registry.ts';

// Body cap: a prompt is prose, not a payload. 32KB is ~5× the largest shipped
// default (the ~12KB post prompt) — generous, but a wall against a runaway paste.
const MAX_BODY_BYTES = 32 * 1024;

export const promptsRouter = new Hono();

promptsRouter.get('/prompts', (c) => {
  const overrides = new Map(
    db
      .select({ key: promptOverrides.key, updatedAt: promptOverrides.updatedAt })
      .from(promptOverrides)
      .all()
      .map((r) => [r.key, r.updatedAt] as const),
  );
  const list = PROMPT_KEYS.map((key) => {
    const spec = PROMPT_SPECS[key];
    return {
      key,
      name: spec.name,
      description: spec.description,
      required: spec.required,
      customized: overrides.has(key),
      updatedAt: overrides.get(key) ?? null,
    };
  });
  return c.json(list);
});

promptsRouter.get('/prompts/:key', (c) => {
  const key = c.req.param('key');
  if (!isPromptKey(key)) return c.json({ error: 'unknown_prompt' }, 404);
  const spec = PROMPT_SPECS[key];
  const row = db.select().from(promptOverrides).where(eq(promptOverrides.key, key)).get();
  return c.json({
    key,
    body: row?.body ?? spec.defaultBody,
    defaultBody: spec.defaultBody,
    required: spec.required,
    customized: row !== undefined,
  });
});

promptsRouter.patch('/prompts/:key', async (c) => {
  const key = c.req.param('key');
  if (!isPromptKey(key)) return c.json({ error: 'unknown_prompt' }, 404);

  const raw = await c.req.json().catch(() => null);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw))
    return c.json({ error: 'invalid_body' }, 400);
  const b = raw as Record<string, unknown>;

  if (typeof b.body !== 'string' || b.body.trim() === '')
    return c.json({ error: 'invalid_body_field' }, 400);
  const body = b.body;
  if (new TextEncoder().encode(body).length > MAX_BODY_BYTES)
    return c.json({ error: 'body_too_large', maxBytes: MAX_BODY_BYTES }, 413);

  // Required placeholders are the render contract — an override missing one
  // silently drops that content at draft time, so we refuse the save. Unknown
  // {{TOKENS}} are surfaced as a warning (the editor shows them), never fatal.
  const validation = validatePromptBody(key, body);
  if (!validation.ok)
    return c.json({ error: 'missing_placeholder', missing: validation.missing }, 400);

  db.insert(promptOverrides)
    .values({ key, body, updatedAt: new Date() })
    .onConflictDoUpdate({ target: promptOverrides.key, set: { body, updatedAt: new Date() } })
    .run();

  return c.json({ customized: true, unknownPlaceholders: validation.unknown });
});

promptsRouter.post('/prompts/restore-defaults', (c) => {
  const rows = db.select({ key: promptOverrides.key }).from(promptOverrides).all();
  db.delete(promptOverrides).run();
  return c.json({ restored: rows.length });
});

promptsRouter.post('/prompts/:key/reset', (c) => {
  const key = c.req.param('key');
  if (!isPromptKey(key)) return c.json({ error: 'unknown_prompt' }, 404);
  db.delete(promptOverrides).where(eq(promptOverrides.key, key)).run();
  return c.json({ customized: false });
});
