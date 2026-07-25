// GET /x/goals + the commitments CRUD — the accountability read surface
// (Guardrails §C). Always mounted, **$0**: every number here is read-time SQL
// over rows stratus already collected and paid for (§7.12 — no pacing table,
// no worker, nothing stored that can go stale).
//
// D4 — the goals themselves live in `me_goals` and are WRITTEN through
// `/x/me/goals` (ME.1). This file never inserts a goal: one table, one writer,
// one validation ladder. It owns the derived half — the current value, the
// pacing, the lazy status flip — plus the `commitments` table, which is new.
//
// Like `/x/radar/drafts` and `/x/following/queue`, **this GET writes**: the
// `active → achieved | missed` flip is applied on read (radar-expiry pattern,
// ratchet §7.10). It is idempotent and it only ever advances a status.
//
// The loaders are exported because the brief serves the same blocks (GR.8):
// one place owns the windows and the column choices, so the Today card, the
// brief and `x_goals` can never disagree about what "on pace" means — the same
// discipline as `loadMonitorInputs`.
//
// Static paths only, no `:param` (§7.20).

import { and, desc, eq, gte, isNotNull } from 'drizzle-orm';
import { Hono } from 'hono';
import { db } from '../../db/client.ts';
import {
  accountSnapshots,
  commitments,
  meGoals,
  postsPublished,
  replyDrafts,
  streaks,
} from '../db/schema.ts';
import {
  type CommitmentDebt,
  type CommitmentKey,
  type GoalPacing,
  MAX_DAILY_TARGET,
  MIN_DAILY_TARGET,
  commitmentDebt,
  goalPacing,
  isCommitmentKey,
  nextGoalStatus,
  shiftDayKey,
} from '../goals.ts';
import { type FlowCurrents, isFlowGoalKind } from '../me/profile.ts';
import { localDayKey } from '../quests.ts';

const DAY_MS = 86_400_000;

/** The window the measured rate is taken over — the same trailing week the
 *  brief and the digest reason in. */
export const RATE_WINDOW_DAYS = 7;

export const goalsRouter = new Hono();

type GoalRow = typeof meGoals.$inferSelect;
type CommitmentRow = typeof commitments.$inferSelect;

export interface GoalView extends GoalRow {
  pacing: GoalPacing;
}

export interface CommitmentView extends CommitmentRow {
  debt: CommitmentDebt;
}

// ------------------------------------------------------------------ helpers

/** Where a goal starts counting. Null `baselineAt` = a row created before GR.7
 *  (or one whose kind changed later); `createdAt` is the honest fallback — it
 *  is when the goal came into existence either way. */
function baselineOf(g: GoalRow): Date {
  return g.baselineAt ?? g.createdAt;
}

/** Garbage degrades to UTC rather than 400ing — a bad tz on a read-only
 *  accountability view is not worth refusing the whole payload over. */
function tzFrom(raw: string | undefined): number {
  if (raw === undefined) return 0;
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
}

/** Value + measured rate for every goal, in at most four queries. Three shapes:
 *  followers is a STOCK read off the daily account snapshot; posted_replies /
 *  originals are FLOWS counted from each goal's own baseline; mrr/custom are
 *  manual, so their rate can only come from how far they have moved since the
 *  baseline was stamped. */
async function loadCurrents(
  rows: GoalRow[],
  now: Date,
): Promise<Map<string, { current: number | null; actualPerDay: number | null }>> {
  const t = now.getTime();
  const rateFrom = new Date(t - RATE_WINDOW_DAYS * DAY_MS);
  const out = new Map<string, { current: number | null; actualPerDay: number | null }>();

  const wants = (kind: string): boolean => rows.some((r) => r.kind === kind);
  const earliestBaseline = (kind: string): Date | null => {
    const times = rows.filter((r) => r.kind === kind).map((r) => baselineOf(r).getTime());
    return times.length > 0 ? new Date(Math.min(...times, rateFrom.getTime())) : null;
  };

  // followers: the latest snapshot is the current value; the oldest snapshot
  // still inside the rate window gives the slope. No upper bound on the window
  // — real snapshots are never in the future, and leaving it open lets a
  // future-dated fixture exercise the arithmetic without polluting any suite
  // that asserts exact follower numbers over the present week (me.test.ts idiom).
  let followersNow: number | null = null;
  let followersRate: number | null = null;
  if (wants('followers')) {
    const [latest] = await db
      .select({ at: accountSnapshots.snapshotAt, n: accountSnapshots.followersCount })
      .from(accountSnapshots)
      .orderBy(desc(accountSnapshots.snapshotAt))
      .limit(1);
    const [oldest] = await db
      .select({ at: accountSnapshots.snapshotAt, n: accountSnapshots.followersCount })
      .from(accountSnapshots)
      .where(gte(accountSnapshots.snapshotAt, rateFrom))
      .orderBy(accountSnapshots.snapshotAt)
      .limit(1);
    followersNow = latest ? latest.n : null;
    if (latest && oldest) {
      const elapsed = (latest.at.getTime() - oldest.at.getTime()) / DAY_MS;
      // Under a day apart the slope is noise dressed up as a rate.
      if (elapsed >= 1) followersRate = (latest.n - oldest.n) / elapsed;
    }
  }

  // Flows: one query per kind over the earliest baseline in play, counted per
  // goal in TS (each goal has its own start, so a per-goal query would be N
  // round-trips for the same rows).
  let replyAts: Date[] = [];
  const replySince = wants('posted_replies') ? earliestBaseline('posted_replies') : null;
  if (replySince) {
    // `updatedAt` on a posted draft is the paste time — the same column the
    // brief's quota and the monitor's burst rule read.
    const rowsR = await db
      .select({ at: replyDrafts.updatedAt })
      .from(replyDrafts)
      .where(and(eq(replyDrafts.status, 'posted'), gte(replyDrafts.updatedAt, replySince)));
    replyAts = rowsR.map((r) => r.at);
  }

  let originalAts: Date[] = [];
  const originalSince = wants('originals') ? earliestBaseline('originals') : null;
  if (originalSince) {
    const rowsO = await db
      .select({ at: postsPublished.postedAt })
      .from(postsPublished)
      .where(and(eq(postsPublished.isReply, false), gte(postsPublished.postedAt, originalSince)));
    originalAts = rowsO.map((r) => r.at);
  }

  for (const g of rows) {
    const since = baselineOf(g).getTime();
    if (g.kind === 'followers') {
      out.set(g.id, { current: followersNow, actualPerDay: followersRate });
      continue;
    }
    if (isFlowGoalKind(g.kind)) {
      const ats = g.kind === 'posted_replies' ? replyAts : originalAts;
      const current = ats.filter((a) => a.getTime() >= since).length;
      const recent = ats.filter((a) => a.getTime() >= rateFrom.getTime()).length;
      out.set(g.id, { current, actualPerDay: recent / RATE_WINDOW_DAYS });
      continue;
    }
    // Manual kinds: the only rate available is how far the number has moved
    // since the baseline was stamped. Null baseline (pre-GR.7 rows) → no rate.
    const elapsed = (t - since) / DAY_MS;
    const moved =
      g.currentValue !== null && g.baselineValue !== null ? g.currentValue - g.baselineValue : null;
    out.set(g.id, {
      current: g.currentValue,
      actualPerDay: moved !== null && elapsed >= 1 ? moved / elapsed : null,
    });
  }

  return out;
}

/** Counted current value per flow goal, for callers that only list goals
 *  (`GET /x/me`, the digest facts). Exported so the counting is never forked. */
export async function loadFlowCurrents(rows: GoalRow[], now: Date): Promise<FlowCurrents> {
  const flow = rows.filter((r) => isFlowGoalKind(r.kind));
  if (flow.length === 0) return new Map();
  const currents = await loadCurrents(flow, now);
  return new Map([...currents].map(([id, v]) => [id, v.current]));
}

/** Every goal with live pacing, active first. Applies the lazy status flip
 *  before returning, so what the caller renders is what the DB now says. */
export async function loadGoalsWithPacing(now: Date): Promise<GoalView[]> {
  const rows = (await db.select().from(meGoals).orderBy(desc(meGoals.createdAt))) as GoalRow[];
  if (rows.length === 0) return [];
  const currents = await loadCurrents(rows, now);

  const views: GoalView[] = [];
  const flips: Array<{ id: string; status: 'achieved' | 'missed' }> = [];
  for (const row of rows) {
    const c = currents.get(row.id) ?? { current: null, actualPerDay: null };
    const pacing = goalPacing(row, c.current, c.actualPerDay, now);
    const next = nextGoalStatus(row, pacing, now);
    if (next) flips.push({ id: row.id, status: next });
    views.push({ ...row, ...(next ? { status: next } : {}), pacing });
  }

  for (const f of flips) {
    await db
      .update(meGoals)
      .set({ status: f.status, updatedAt: now })
      .where(and(eq(meGoals.id, f.id), eq(meGoals.status, 'active')));
  }

  return views.sort((a, b) => {
    const rank = (s: string): number => (s === 'active' ? 0 : 1);
    if (rank(a.status) !== rank(b.status)) return rank(a.status) - rank(b.status);
    return b.createdAt.getTime() - a.createdAt.getTime();
  });
}

/** Commitments with their debt over the C9 streak diary. `tzOffsetMin` follows
 *  JS `getTimezoneOffset()` — day keys are the viewer's local days, exactly as
 *  the diary was written. */
export async function loadCommitmentsWithDebt(
  now: Date,
  tzOffsetMin: number,
): Promise<CommitmentView[]> {
  const rows = (await db.select().from(commitments)) as CommitmentRow[];
  if (rows.length === 0) return [];

  const todayKey = localDayKey(now, tzOffsetMin);
  const days = await db
    .select({ day: streaks.day, completed: streaks.completed })
    .from(streaks)
    .where(gte(streaks.day, shiftDayKey(todayKey, -31)));

  return rows.map((r) => ({
    ...r,
    debt: commitmentDebt(
      days,
      r.key as CommitmentKey,
      localDayKey(r.activeSince, tzOffsetMin),
      todayKey,
    ),
  }));
}

/** The baseline a new goal starts from, stamped by `POST /x/me/goals` at
 *  creation. Counted flows start at 0 by definition; followers records where
 *  the account stood; the manual kinds record whatever value was supplied. */
export async function stampBaseline(
  kind: string,
  currentValue: number | null,
  now: Date,
): Promise<{ baselineValue: number | null; baselineAt: Date }> {
  if (isFlowGoalKind(kind)) return { baselineValue: 0, baselineAt: now };
  if (kind !== 'followers') return { baselineValue: currentValue, baselineAt: now };
  const [latest] = await db
    .select({ n: accountSnapshots.followersCount })
    .from(accountSnapshots)
    .where(isNotNull(accountSnapshots.followersCount))
    .orderBy(desc(accountSnapshots.snapshotAt))
    .limit(1);
  return { baselineValue: latest ? latest.n : null, baselineAt: now };
}

// ------------------------------------------------------------------- routes

goalsRouter.get('/goals', async (c) => {
  const now = new Date();
  const tz = tzFrom(c.req.query('tzOffsetMin'));
  const [goals, commitmentViews] = await Promise.all([
    loadGoalsWithPacing(now),
    loadCommitmentsWithDebt(now, tz),
  ]);
  return c.json({ goals, commitments: commitmentViews, checkedAt: now.toISOString() });
});

goalsRouter.get('/commitments', async (c) => {
  const now = new Date();
  return c.json({
    commitments: await loadCommitmentsWithDebt(now, tzFrom(c.req.query('tzOffsetMin'))),
  });
});

goalsRouter.put('/commitments', async (c) => {
  const raw = await c.req.json().catch(() => null);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw))
    return c.json({ error: 'invalid_body' }, 400);
  const b = raw as Record<string, unknown>;

  const key = typeof b.key === 'string' ? b.key : '';
  if (!isCommitmentKey(key)) return c.json({ error: 'invalid_key' }, 400);
  if (
    typeof b.dailyTarget !== 'number' ||
    !Number.isInteger(b.dailyTarget) ||
    b.dailyTarget < MIN_DAILY_TARGET ||
    b.dailyTarget > MAX_DAILY_TARGET
  )
    return c.json({ error: 'invalid_daily_target' }, 400);
  if (b.active !== undefined && typeof b.active !== 'boolean')
    return c.json({ error: 'invalid_active' }, 400);
  const active = b.active === undefined ? true : b.active;

  const now = new Date();
  const [existing] = await db.select().from(commitments).where(eq(commitments.key, key));
  if (existing) {
    // Re-activating restarts the debt clock; editing the target never does —
    // raising the bar must not erase the days already missed under the old one.
    const activeSince = !existing.active && active ? now : existing.activeSince;
    await db
      .update(commitments)
      .set({ dailyTarget: b.dailyTarget, active, activeSince, updatedAt: now })
      .where(eq(commitments.key, key));
  } else {
    await db
      .insert(commitments)
      .values({ key, dailyTarget: b.dailyTarget, active, activeSince: now, updatedAt: now });
  }

  const views = await loadCommitmentsWithDebt(now, tzFrom(c.req.query('tzOffsetMin')));
  const view = views.find((v) => v.key === key);
  return c.json(view ?? { key, dailyTarget: b.dailyTarget, active });
});
