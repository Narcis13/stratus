// DM drafts (Authoring 3.0 A3.9) — grounded outbound direct messages for people
// I already have real shared context with. Mounted under `/x` by `mountX`; the
// list/patch routes are pure SQL ($0), only POST /dms/draft spends (one Grok
// call, LLM-gated at runtime). Sending a DM stays manual in X — this surface
// drafts, stores, and logs "sent" into the person timeline.
//
// Routes:
//   POST  /dms/draft   { handle, idea?, purpose? } → 201 { id, text, grounding }
//                      400 invalid → 404 unknown_person → 422 no_shared_context
//                      → 503 grok_not_configured → Grok (~$0.005). Every refusal
//                      is $0 and decided BEFORE any spend (§7.4).
//   GET   /dms         ?handle=&status=&limit=   → newest-first rows
//   PATCH /dms/:id     { text? | status: sent|discarded }
//                      text editable while draft; sent stamps sentAt + logs the
//                      existing manual_dm_logged person event; sent is terminal.

import { type SQL, and, desc, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { db } from '../../db/client.ts';
import { type AskLlmResult, askLLM, llmConfigured, llmErrorPayload } from '../../llm/index.ts';
import { dmDrafts } from '../db/schema.ts';
import { DM_SCHEMA, buildDmPrompt, parseDm } from '../people/dm.ts';
import { renderIcebreakerGrounding } from '../people/icebreakers.ts';
import { normalizePersonHandle, safeLogPersonEvents, snippet } from '../people/store.ts';
import { loadPromptSafe } from '../prompts/registry.ts';
import { loadIcebreakerGrounding } from './people.ts';

const STATUSES = ['draft', 'sent', 'discarded'] as const;
type DmStatus = (typeof STATUSES)[number];

const MAX_DM_LEN = 2000;
const MAX_STEER_LEN = 2000;
const DEFAULT_LIST_LIMIT = 100;
const MAX_LIST_LIMIT = 500;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_EVENT_SUMMARY_LEN = 500;

// The DM opener is short and low-effort — the icebreaker defaults (§ people).
const DM_MAX_OUTPUT_TOKENS = 400;
const DM_TEMPERATURE = 0.7;
const DM_REASONING = 'low' as const;

export const dmsRouter = new Hono();

dmsRouter.post('/dms/draft', async (c) => {
  const raw = await c.req.json().catch(() => null);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return c.json({ error: 'invalid_body' }, 400);
  }
  const body = raw as Record<string, unknown>;

  const handle = normalizePersonHandle(body.handle);
  if (!handle) return c.json({ error: 'invalid_handle' }, 400);

  const idea = parseOptSteer(body.idea);
  if (idea === 'invalid') return c.json({ error: 'invalid_idea' }, 400);
  const purpose = parseOptSteer(body.purpose);
  if (purpose === 'invalid') return c.json({ error: 'invalid_purpose' }, 400);

  // §7.4 refusal ladder — every step is $0 and decided BEFORE any LLM spend, the
  // icebreaker discipline (decision 8): unknown person and thin dossier refuse
  // first; the any-provider gate is the last cheap check before the paid call.
  const inputs = await loadIcebreakerGrounding(handle);
  if (!inputs) return c.json({ error: 'unknown_person' }, 404);

  const grounding = renderIcebreakerGrounding(inputs, new Date());
  if (grounding === null) return c.json({ error: 'no_shared_context' }, 422);

  if (!llmConfigured()) return c.json({ error: 'grok_not_configured' }, 503);

  // Registry prompt (A3.9, key `dm`): DB override else the shipped default; the
  // grounding/idea/purpose substitute at the tail inside buildDmPrompt.
  const prompt = loadPromptSafe('dm');

  let result: AskLlmResult;
  try {
    result = await askLLM(
      {
        messages: buildDmPrompt(grounding, idea, purpose, prompt.body),
        jsonSchema: { name: 'dm', schema: DM_SCHEMA },
        promptCacheKey: prompt.cacheKey,
      },
      {
        defaults: {
          reasoningEffort: DM_REASONING,
          maxOutputTokens: DM_MAX_OUTPUT_TOKENS,
          temperature: DM_TEMPERATURE,
        },
      },
    );
  } catch (err) {
    const mapped = llmErrorPayload(err);
    if (mapped) return c.json(mapped.body, mapped.status);
    const detail = err instanceof Error ? err.message : String(err);
    console.error('/x/dms/draft failed:', detail);
    return c.json({ error: 'dm_failed', detail }, 502);
  }

  const parsed = parseDm(result.text);
  if (!parsed) return c.json({ error: 'dm_parse_error', requestId: result.requestId }, 502);

  const id = crypto.randomUUID();
  await db.insert(dmDrafts).values({
    id,
    handle,
    text: parsed.dm,
    purpose,
    status: 'draft',
    // §7.16: snapshot exactly what the model saw, for dossier transparency.
    grounding: { block: grounding, idea },
    costUsd: result.costUsd,
  });

  // The grounding rides back so the panel can show exactly what the draft was
  // allowed to know — trust through transparency, same as icebreakers.
  return c.json(
    {
      id,
      text: parsed.dm,
      grounding,
      costUsd: result.costUsd,
      model: result.model,
      requestId: result.requestId,
    },
    201,
  );
});

dmsRouter.get('/dms', async (c) => {
  const handleStr = c.req.query('handle');
  let handle: string | undefined;
  if (handleStr !== undefined) {
    const h = normalizePersonHandle(handleStr);
    if (!h) return c.json({ error: 'invalid_handle' }, 400);
    handle = h;
  }

  const statusStr = c.req.query('status');
  if (statusStr !== undefined && !isStatus(statusStr)) {
    return c.json({ error: 'invalid_status' }, 400);
  }

  const limitStr = c.req.query('limit');
  let limit = DEFAULT_LIST_LIMIT;
  if (limitStr !== undefined) {
    const n = Number(limitStr);
    if (!Number.isInteger(n) || n < 1) return c.json({ error: 'invalid_limit' }, 400);
    limit = Math.min(MAX_LIST_LIMIT, n);
  }

  const filters: SQL[] = [];
  if (handle) filters.push(eq(dmDrafts.handle, handle));
  if (statusStr) filters.push(eq(dmDrafts.status, statusStr));

  const rows = await db
    .select()
    .from(dmDrafts)
    .where(filters.length ? and(...filters) : undefined)
    .orderBy(desc(dmDrafts.createdAt))
    .limit(limit);

  return c.json({ count: rows.length, dms: rows });
});

dmsRouter.patch('/dms/:id', async (c) => {
  const id = c.req.param('id');
  if (!UUID_RE.test(id)) return c.json({ error: 'invalid_id' }, 400);

  const raw = await c.req.json().catch(() => null);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return c.json({ error: 'invalid_body' }, 400);
  }
  const body = raw as Record<string, unknown>;

  const [existing] = await db.select().from(dmDrafts).where(eq(dmDrafts.id, id));
  if (!existing) return c.json({ error: 'not_found' }, 404);

  const updates: Partial<typeof dmDrafts.$inferInsert> = {};
  let logSent = false;

  // Text is editable only while the draft is still a draft — a sent/discarded
  // message is a historical record.
  if (body.text !== undefined) {
    if (existing.status !== 'draft') return c.json({ error: 'text_locked' }, 409);
    if (typeof body.text !== 'string') return c.json({ error: 'invalid_text' }, 400);
    const text = body.text.trim();
    if (text === '' || text.length > MAX_DM_LEN) return c.json({ error: 'invalid_text' }, 400);
    updates.text = text;
  }

  if (body.status !== undefined) {
    if (!isStatus(body.status)) return c.json({ error: 'invalid_status' }, 400);
    const next = body.status;
    if (next === existing.status) {
      // Idempotent no-op — covers marking-sent twice (the ratchet, §7.10): the
      // deterministic event id already made the log idempotent, this avoids even
      // re-running it. A pending text edit still applies (falls through).
      if (Object.keys(updates).length === 0) return c.json(existing);
    } else if (existing.status !== 'draft') {
      // sent and discarded are terminal — nothing regresses (§7.10).
      return c.json({ error: 'status_locked', status: existing.status }, 409);
    } else if (next === 'sent') {
      updates.status = 'sent';
      updates.sentAt = new Date();
      logSent = true;
    } else if (next === 'discarded') {
      updates.status = 'discarded';
    } else {
      // next === 'draft' from a non-draft is impossible (caught above); from a
      // draft it's a no-op already handled. Guard for exhaustiveness.
      return c.json({ error: 'invalid_status' }, 400);
    }
  }

  if (Object.keys(updates).length === 0) return c.json({ error: 'empty_patch' }, 400);

  updates.updatedAt = new Date();
  const [row] = await db.update(dmDrafts).set(updates).where(eq(dmDrafts.id, id)).returning();
  if (!row) return c.json({ error: 'not_found' }, 404);

  if (logSent) {
    // §7.8: a log failure never fails the PATCH. Deterministic id
    // `manual_dm_logged:dm_drafts:<id>` makes it idempotent (onConflictDoNothing)
    // — the same store path the manual-events route uses.
    await safeLogPersonEvents([
      {
        handle: existing.handle,
        type: 'manual_dm_logged',
        refTable: 'dm_drafts',
        refId: id,
        summary: snippet(`DM sent: ${row.text}`, MAX_EVENT_SUMMARY_LEN),
        at: new Date(),
      },
    ]);
  }

  return c.json(row);
});

// ---------------------------------------------------------------- helpers

function isStatus(v: unknown): v is DmStatus {
  return typeof v === 'string' && (STATUSES as readonly string[]).includes(v);
}

/** Optional any-language steer (idea/purpose): absent → null, present → trimmed
 *  (empty collapses to null), over-length → 'invalid'. */
function parseOptSteer(value: unknown): string | null | 'invalid' {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string' || value.length > MAX_STEER_LEN) return 'invalid';
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}
