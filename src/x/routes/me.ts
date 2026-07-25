// Me / My Profile (M1): CRUD over the dynamic personal-context layer plus the
// rendered-block preview + the best-effort loader the draft pipelines call.
// Always mounted under `/x` by `mountX` (pure SQL, $0 — no Grok, no X). `/x/me`
// is a static prefix; the only params are on `/me/entries/:id` and
// `/me/goals/:id`, which shadow nothing (§7.20 checked).
//
//   GET    /me?kind=&active=            { entries: (row & {inWindow})[], goals: (row & {progress})[] }
//   POST   /me/entries                  { kind, text ≤1000, happenedAt?, pinned? } → 201
//   PATCH  /me/entries/:id              partial { kind?, text?, happenedAt?, pinned?, active? }
//   DELETE /me/entries/:id              { ok:true } / 404
//   POST   /me/goals                    { label, kind, target>0, unit?, deadline? (future), currentValue? } → 201
//                                       400 deadline_in_past | target_not_above_baseline (GR.7)
//   PATCH  /me/goals/:id                partial incl. currentValue + status → 200 / 404 / 400
//   DELETE /me/goals/:id                { ok:true } / 404
//   GET    /me/context?mode=post|reply  { mode, block: string|null } — the exact injected block (§7.18)

import { type SQL, and, desc, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { db } from '../../db/client.ts';
import { accountSnapshots, meEntries, meGoals } from '../db/schema.ts';
import {
  GOAL_KINDS,
  ME_KINDS,
  type MeEntry,
  type MeGoal,
  isEntryInWindow,
  isFlowGoalKind,
  renderMeBrief,
  renderMeContext,
  resolveGoals,
  selectEntriesForPrompt,
} from '../me/profile.ts';
import { loadFlowCurrents, stampBaseline } from './goals.ts';

// GR.7 added `missed` — the lazy deadline flip in routes/goals.ts writes it.
const GOAL_STATUSES = ['active', 'achieved', 'missed', 'dropped'] as const;

export const me = new Hono();

// ------------------------------------------------------------------- helpers

// happenedAt / deadline arrive as ISO strings (or null = undated). Never bind a
// raw Date in a `sql` template on the sync driver (§7.13) — Drizzle column ops
// only, which we do (the parsed Date goes straight into .values/.set).
function parseDate(v: unknown): { ok: true; value: Date | null } | { ok: false } {
  if (v === undefined || v === null) return { ok: true, value: null };
  if (typeof v !== 'string') return { ok: false };
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return { ok: false };
  return { ok: true, value: d };
}

async function loadLatestFollowers(): Promise<number | null> {
  const [acct] = await db
    .select({ followersCount: accountSnapshots.followersCount })
    .from(accountSnapshots)
    .orderBy(desc(accountSnapshots.snapshotAt))
    .limit(1);
  return acct ? acct.followersCount : null;
}

// The single source of the injected block, shared by GET /me/context and
// loadMeContextSafe: active entries + active goals + latest followers →
// selection → render. Returns '' when there is nothing to inject.
async function renderFor(mode: 'post' | 'reply'): Promise<string> {
  const now = new Date();
  const entries = (await db
    .select()
    .from(meEntries)
    .where(eq(meEntries.active, true))) as MeEntry[];
  // Flow goals (posted_replies/originals) are accountability, not biography —
  // they are deliberately not injected into a drafting prompt (GR.7).
  const goals = (await db.select().from(meGoals).where(eq(meGoals.status, 'active'))).filter(
    (g) => !isFlowGoalKind(g.kind),
  );
  const latestFollowers = await loadLatestFollowers();
  const selection = selectEntriesForPrompt(entries, now);
  const renderGoals = resolveGoals(goals, latestFollowers, now);
  return mode === 'reply'
    ? renderMeBrief(selection, renderGoals, now)
    : renderMeContext(selection, renderGoals, now);
}

// ------------------------------------------------------------------- entries

me.get('/me', async (c) => {
  const now = new Date();
  const kind = c.req.query('kind');
  const activeParam = c.req.query('active');
  const conds: SQL[] = [];
  if (kind !== undefined && kind !== '') conds.push(eq(meEntries.kind, kind));
  if (activeParam !== undefined) conds.push(eq(meEntries.active, activeParam === 'true'));

  const order = [desc(meEntries.pinned), desc(meEntries.createdAt)] as const;
  const rows = (
    conds.length > 0
      ? await db
          .select()
          .from(meEntries)
          .where(and(...conds))
          .orderBy(...order)
      : await db
          .select()
          .from(meEntries)
          .orderBy(...order)
  ) as MeEntry[];
  const entries = rows.map((e) => ({ ...e, inWindow: isEntryInWindow(e, now) }));

  const goalRows = await db.select().from(meGoals).orderBy(desc(meGoals.createdAt));
  const latestFollowers = await loadLatestFollowers();
  // The counted kinds get their value from the same loader `GET /x/goals` uses
  // — the Me tab must never fork the counting (§7.12 spirit).
  const resolved = resolveGoals(
    goalRows,
    latestFollowers,
    now,
    await loadFlowCurrents(goalRows, now),
  );
  const goals = goalRows.map((g, i) => ({ ...g, progress: resolved[i]?.progress ?? null }));

  return c.json({ entries, goals });
});

me.post('/me/entries', async (c) => {
  const raw = await c.req.json().catch(() => null);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw))
    return c.json({ error: 'invalid_body' }, 400);
  const b = raw as Record<string, unknown>;

  const kind = typeof b.kind === 'string' ? b.kind : '';
  if (!(ME_KINDS as readonly string[]).includes(kind))
    return c.json({ error: 'invalid_kind' }, 400);
  const text = typeof b.text === 'string' ? b.text.trim() : '';
  if (text === '' || text.length > 1000) return c.json({ error: 'invalid_text' }, 400);
  const happenedAt = parseDate(b.happenedAt);
  if (!happenedAt.ok) return c.json({ error: 'invalid_happened_at' }, 400);
  const pinned = typeof b.pinned === 'boolean' ? b.pinned : false;

  const [row] = await db
    .insert(meEntries)
    .values({ kind, text, happenedAt: happenedAt.value, pinned })
    .returning();
  return c.json(row, 201);
});

me.patch('/me/entries/:id', async (c) => {
  const id = c.req.param('id');
  const raw = await c.req.json().catch(() => null);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw))
    return c.json({ error: 'invalid_body' }, 400);
  const b = raw as Record<string, unknown>;

  const patch: Record<string, unknown> = { updatedAt: new Date() };
  if (b.kind !== undefined) {
    if (typeof b.kind !== 'string' || !(ME_KINDS as readonly string[]).includes(b.kind))
      return c.json({ error: 'invalid_kind' }, 400);
    patch.kind = b.kind;
  }
  if (b.text !== undefined) {
    if (typeof b.text !== 'string' || b.text.trim() === '' || b.text.length > 1000)
      return c.json({ error: 'invalid_text' }, 400);
    patch.text = b.text.trim();
  }
  if (b.happenedAt !== undefined) {
    const parsed = parseDate(b.happenedAt);
    if (!parsed.ok) return c.json({ error: 'invalid_happened_at' }, 400);
    patch.happenedAt = parsed.value;
  }
  if (b.pinned !== undefined) {
    if (typeof b.pinned !== 'boolean') return c.json({ error: 'invalid_pinned' }, 400);
    patch.pinned = b.pinned;
  }
  if (b.active !== undefined) {
    if (typeof b.active !== 'boolean') return c.json({ error: 'invalid_active' }, 400);
    patch.active = b.active;
  }

  const [row] = await db.update(meEntries).set(patch).where(eq(meEntries.id, id)).returning();
  if (!row) return c.json({ error: 'not_found' }, 404);
  return c.json(row);
});

me.delete('/me/entries/:id', async (c) => {
  const id = c.req.param('id');
  const [existing] = await db
    .select({ id: meEntries.id })
    .from(meEntries)
    .where(eq(meEntries.id, id));
  if (!existing) return c.json({ error: 'not_found' }, 404);
  await db.delete(meEntries).where(eq(meEntries.id, id));
  return c.json({ ok: true });
});

// --------------------------------------------------------------------- goals

me.post('/me/goals', async (c) => {
  const raw = await c.req.json().catch(() => null);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw))
    return c.json({ error: 'invalid_body' }, 400);
  const b = raw as Record<string, unknown>;

  const label = typeof b.label === 'string' ? b.label.trim() : '';
  if (label === '' || label.length > 200) return c.json({ error: 'invalid_label' }, 400);
  const kind = typeof b.kind === 'string' ? b.kind : '';
  if (!(GOAL_KINDS as readonly string[]).includes(kind))
    return c.json({ error: 'invalid_kind' }, 400);
  if (typeof b.target !== 'number' || !Number.isFinite(b.target) || b.target <= 0)
    return c.json({ error: 'invalid_target' }, 400);
  const unit = typeof b.unit === 'string' && b.unit.trim() !== '' ? b.unit.trim() : null;

  let currentValue: number | null = null;
  if (b.currentValue !== undefined && b.currentValue !== null) {
    if (typeof b.currentValue !== 'number' || !Number.isFinite(b.currentValue))
      return c.json({ error: 'invalid_current_value' }, 400);
    currentValue = b.currentValue;
  }
  const deadline = parseDate(b.deadline);
  if (!deadline.ok) return c.json({ error: 'invalid_deadline' }, 400);
  const now = new Date();
  // GR.7: undated goals are fine (ME.1), but a dated one whose deadline already
  // passed would flip to `missed` on the very next read — refuse it here.
  if (deadline.value !== null && deadline.value.getTime() <= now.getTime())
    return c.json({ error: 'deadline_in_past' }, 400);

  // GR.7: stamp where this goal starts. Without a baseline the counted kinds
  // would measure all of history and a followers goal could never say how far
  // it has moved since I set it.
  const baseline = await stampBaseline(kind, currentValue, now);
  // GR.7: a known baseline at or past the target would flip to `achieved` on
  // the very next read. Null baseline = unknown (§7.11), never refused.
  if (baseline.baselineValue !== null && b.target <= baseline.baselineValue)
    return c.json({ error: 'target_not_above_baseline' }, 400);

  const [row] = await db
    .insert(meGoals)
    .values({
      label,
      kind,
      target: b.target,
      unit,
      currentValue,
      deadline: deadline.value,
      ...baseline,
    })
    .returning();
  return c.json(row, 201);
});

me.patch('/me/goals/:id', async (c) => {
  const id = c.req.param('id');
  const raw = await c.req.json().catch(() => null);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw))
    return c.json({ error: 'invalid_body' }, 400);
  const b = raw as Record<string, unknown>;

  const patch: Record<string, unknown> = { updatedAt: new Date() };
  if (b.label !== undefined) {
    if (typeof b.label !== 'string' || b.label.trim() === '' || b.label.length > 200)
      return c.json({ error: 'invalid_label' }, 400);
    patch.label = b.label.trim();
  }
  if (b.kind !== undefined) {
    if (typeof b.kind !== 'string' || !(GOAL_KINDS as readonly string[]).includes(b.kind))
      return c.json({ error: 'invalid_kind' }, 400);
    patch.kind = b.kind;
  }
  if (b.target !== undefined) {
    if (typeof b.target !== 'number' || !Number.isFinite(b.target) || b.target <= 0)
      return c.json({ error: 'invalid_target' }, 400);
    patch.target = b.target;
  }
  if (b.unit !== undefined) {
    if (b.unit !== null && typeof b.unit !== 'string')
      return c.json({ error: 'invalid_unit' }, 400);
    patch.unit = typeof b.unit === 'string' && b.unit.trim() !== '' ? b.unit.trim() : null;
  }
  if (b.currentValue !== undefined) {
    if (b.currentValue === null) patch.currentValue = null;
    else if (typeof b.currentValue !== 'number' || !Number.isFinite(b.currentValue))
      return c.json({ error: 'invalid_current_value' }, 400);
    else patch.currentValue = b.currentValue;
  }
  if (b.deadline !== undefined) {
    const parsed = parseDate(b.deadline);
    if (!parsed.ok) return c.json({ error: 'invalid_deadline' }, 400);
    patch.deadline = parsed.value;
  }
  if (b.status !== undefined) {
    if (typeof b.status !== 'string' || !(GOAL_STATUSES as readonly string[]).includes(b.status))
      return c.json({ error: 'invalid_status' }, 400);
    patch.status = b.status;
  }

  const [row] = await db.update(meGoals).set(patch).where(eq(meGoals.id, id)).returning();
  if (!row) return c.json({ error: 'not_found' }, 404);
  return c.json(row);
});

me.delete('/me/goals/:id', async (c) => {
  const id = c.req.param('id');
  const [existing] = await db.select({ id: meGoals.id }).from(meGoals).where(eq(meGoals.id, id));
  if (!existing) return c.json({ error: 'not_found' }, 404);
  await db.delete(meGoals).where(eq(meGoals.id, id));
  return c.json({ ok: true });
});

// ------------------------------------------------------------------- context

me.get('/me/context', async (c) => {
  const mode = c.req.query('mode') === 'reply' ? 'reply' : 'post';
  const block = await renderFor(mode);
  return c.json({ mode, block: block === '' ? null : block });
});

/** The rendered me-block for a draft pipeline. Returns null on an empty profile
 *  OR any error (console.error, never throws) — a me-layer failure must never
 *  fail the paying draft path (§7.8, `loadReplyGuidanceSafe` discipline). */
export async function loadMeContextSafe(mode: 'post' | 'reply'): Promise<string | null> {
  try {
    const block = await renderFor(mode);
    return block === '' ? null : block;
  } catch (err) {
    console.error(
      'me: context load failed (draft proceeds without it):',
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}
