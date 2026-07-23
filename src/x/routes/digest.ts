// Sunday Digest route (CIRCLES-PLAN C9). Facts are pure SQL over data other
// surfaces already paid for ($0); the narration is ONE Grok call (~$0.01)
// cached per week in the `digests` table, so re-opening the panel on Sunday
// never re-spends. `?refresh=true` is the only path that regenerates;
// `?factsOnly=true` skips narration entirely (smoke scripts, curiosity).
// Always mounted — the Grok key is checked at runtime, missing key degrades
// to facts-with-a-note, never a 5xx.

import { and, desc, eq, gte, inArray, lt, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { db } from '../../db/client.ts';
import { costEvents } from '../../db/shared-schema.ts';
import { GrokApiError } from '../../grok/index.ts';
import { LlmNotConfiguredError, askLLM, llmConfigured } from '../../llm/index.ts';
import { OpenRouterApiError } from '../../openrouter/index.ts';
import {
  accountSnapshots,
  digests,
  meGoals,
  metricsSnapshots,
  people,
  personEvents,
  postsPublished,
  replyDrafts,
  streaks,
  voiceAuthors,
} from '../db/schema.ts';
import {
  DIGEST_SCHEMA,
  type DigestFacts,
  type DigestGoal,
  buildDigestFacts,
  buildDigestInput,
  parseDigestNarrative,
  weekBounds,
} from '../digest.ts';
import type { GoalVerdict } from '../goals.ts';
import { resolveGoals } from '../me/profile.ts';
import { loadDoctrine } from '../niche/store.ts';
import { INBOUND_TYPES, type Stage, stageRank } from '../people/stage.ts';
import { buildMediaEffectiveness } from '../playbook.ts';
import { loadPromptSafe } from '../prompts/registry.ts';
import { localDayKey } from '../quests.ts';
import { loadCommitmentsWithDebt, loadFlowCurrents, loadGoalsWithPacing } from './goals.ts';
import {
  loadMediaRows,
  loadPostGuidanceSafe,
  loadReplyGuidanceSafe,
  loadRosterCoverage,
} from './playbook.ts';
import { targetBand } from './voice.ts';

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_RE = /^\d{4}-\d{2}-\d{2}$/;
const NEGLECTED_CAP = 5;
const STAGE_TRANSITION_CAP = 10;
const NEGLECTED_TARGET_DAYS = 7;
const NEGLECTED_ALLY_DAYS = 14;
const DIGEST_MAX_OUTPUT_TOKENS = 700;

export const digest = new Hono();

digest.get('/digest', async (c) => {
  const tzStr = c.req.query('tzOffsetMin');
  let tzOffsetMin = 0;
  if (tzStr !== undefined) {
    const n = Number(tzStr);
    if (!Number.isInteger(n) || Math.abs(n) > 16 * 60) {
      return c.json({ error: 'invalid_tz_offset_min' }, 400);
    }
    tzOffsetMin = n;
  }

  const now = new Date();
  const weekStr = c.req.query('week');
  let ref = now;
  if (weekStr !== undefined) {
    if (!WEEK_RE.test(weekStr) || Number.isNaN(Date.parse(`${weekStr}T00:00:00Z`))) {
      return c.json({ error: 'invalid_week' }, 400);
    }
    // Midday local of the named date — safely inside the intended week.
    ref = new Date(Date.parse(`${weekStr}T12:00:00Z`) + tzOffsetMin * 60_000);
  }
  const refresh = c.req.query('refresh') === 'true';
  const factsOnly = c.req.query('factsOnly') === 'true';

  const { start, end, weekKey } = weekBounds(ref, tzOffsetMin);

  if (!refresh) {
    const [stored] = await db.select().from(digests).where(eq(digests.weekKey, weekKey));
    if (stored) {
      return c.json({
        weekKey,
        from: start,
        to: end,
        facts: stored.facts as DigestFacts,
        narrative: stored.narrative,
        model: stored.model,
        costUsd: stored.costUsd,
        cached: true,
        generatedAt: stored.updatedAt,
      });
    }
  }

  const facts = await loadFacts(start, end, weekKey, tzOffsetMin, now);

  if (factsOnly) {
    return c.json({ weekKey, from: start, to: end, facts, narrative: null, cached: false });
  }
  if (!llmConfigured()) {
    return c.json({
      weekKey,
      from: start,
      to: end,
      facts,
      narrative: null,
      narrativeError: 'llm_not_configured',
      cached: false,
    });
  }

  // Registry prompt (AI.6): DB override else the shipped default; its per-body
  // cache bucket replaces the old static key (grok-only, ignored on OpenRouter).
  const prompt = loadPromptSafe('digest');

  let narrative: string | null = null;
  let narrativeError: string | undefined;
  let model: string | null = null;
  let costUsd: number | null = null;
  try {
    // AI.6: askLLM dispatches grok vs openrouter (opts > DB AI settings > the
    // house floor below — the digest's low-effort narration defaults, which a
    // stored global AI setting may override per Decision 4).
    const result = await askLLM(
      {
        messages: buildDigestInput(facts, prompt.body),
        jsonSchema: { name: 'sunday_digest', schema: DIGEST_SCHEMA },
        promptCacheKey: prompt.cacheKey,
      },
      {
        defaults: {
          reasoningEffort: 'low',
          maxOutputTokens: DIGEST_MAX_OUTPUT_TOKENS,
          temperature: 0.7,
        },
      },
    );
    model = result.model;
    costUsd = result.costUsd;
    narrative = parseDigestNarrative(result.text);
    if (narrative === null) narrativeError = 'llm_parse_error';
  } catch (err) {
    // Facts are still the page — an LLM hiccup degrades the card, never 5xxs
    // it. Nothing is cached, so the next open retries for free.
    narrativeError =
      err instanceof LlmNotConfiguredError
        ? 'llm_not_configured'
        : err instanceof GrokApiError
          ? `grok_${err.status}`
          : err instanceof OpenRouterApiError
            ? `openrouter_${err.status}`
            : 'llm_failed';
    console.error('/x/digest narration failed:', err instanceof Error ? err.message : err);
  }

  if (narrative !== null) {
    await db
      .insert(digests)
      .values({ weekKey, facts, narrative, model: model ?? 'unknown', costUsd, updatedAt: now })
      .onConflictDoUpdate({
        target: digests.weekKey,
        set: { facts, narrative, model: model ?? 'unknown', costUsd, updatedAt: now },
      });
  }

  return c.json({
    weekKey,
    from: start,
    to: end,
    facts,
    narrative,
    ...(narrativeError ? { narrativeError } : {}),
    model,
    costUsd,
    cached: false,
  });
});

// ------------------------------------------------------------ fact loading

async function loadFacts(
  start: Date,
  end: Date,
  weekKey: string,
  tzOffsetMin: number,
  now: Date,
): Promise<DigestFacts> {
  const prevStart = new Date(start.getTime() - 7 * DAY_MS);

  const [snaps, published, transitions, costRows, streakRows] = await Promise.all([
    db
      .select({
        snapshotAt: accountSnapshots.snapshotAt,
        followers: accountSnapshots.followersCount,
      })
      .from(accountSnapshots)
      .where(and(gte(accountSnapshots.snapshotAt, start), lt(accountSnapshots.snapshotAt, end)))
      .orderBy(accountSnapshots.snapshotAt),
    db
      .select({
        tweetId: postsPublished.tweetId,
        text: postsPublished.text,
        isReply: postsPublished.isReply,
        // GR.9: the scorecard's cadence component needs the local day each
        // original landed on; it never reaches the facts JSON.
        postedAt: postsPublished.postedAt,
      })
      .from(postsPublished)
      .where(and(gte(postsPublished.postedAt, start), lt(postsPublished.postedAt, end))),
    db
      .select({ handle: people.handle, stage: people.stage, at: people.stageUpdatedAt })
      .from(people)
      .where(
        and(
          eq(people.retired, false),
          gte(people.stageUpdatedAt, start),
          lt(people.stageUpdatedAt, end),
        ),
      )
      .orderBy(desc(people.stageUpdatedAt)),
    db
      .select({
        platform: costEvents.platform,
        costUsd: sql<string>`coalesce(sum(${costEvents.costUsd}), 0)`,
      })
      .from(costEvents)
      .where(and(gte(costEvents.ts, start), lt(costEvents.ts, end)))
      .groupBy(costEvents.platform),
    // Day keys are LOCAL-day strings; the week's keys are exactly
    // weekKey .. weekKey+6, independent of the UTC instant `end` lands on.
    db
      .select({ day: streaks.day, allDone: streaks.allDone })
      .from(streaks)
      .where(and(gte(streaks.day, weekKey), lt(streaks.day, dayKeyPlus(weekKey, 7)))),
  ]);

  // Latest measured outcome per published tweet (newest-first, first wins).
  const ids = published.map((p) => p.tweetId);
  const outcomeByTweet = new Map<string, { views: number | null; profileVisits: number | null }>();
  if (ids.length > 0) {
    const metricRows = await db
      .select({
        tweetId: metricsSnapshots.tweetId,
        publicMetrics: metricsSnapshots.publicMetrics,
        nonPublicMetrics: metricsSnapshots.nonPublicMetrics,
      })
      .from(metricsSnapshots)
      .where(inArray(metricsSnapshots.tweetId, ids))
      .orderBy(desc(metricsSnapshots.snapshotAt));
    for (const s of metricRows) {
      if (outcomeByTweet.has(s.tweetId)) continue;
      const pub = (s.publicMetrics ?? null) as Record<string, number> | null;
      const priv = (s.nonPublicMetrics ?? null) as Record<string, number> | null;
      outcomeByTweet.set(s.tweetId, {
        views: pub?.impression_count ?? priv?.impression_count ?? null,
        profileVisits: priv?.user_profile_clicks ?? null,
      });
    }
  }

  const [fansThisWeek, fansPrevWeek] = await Promise.all([
    loadFanCounts(start, end),
    loadFanCounts(prevStart, start),
  ]);

  const [neglectedTargets, neglectedAllies] = await Promise.all([
    loadNeglectedTargets(end),
    loadNeglectedAllies(end),
  ]);

  const [replyGuidance, postGuidance] = await Promise.all([
    loadReplyGuidanceSafe(),
    loadPostGuidanceSafe(),
  ]);

  // §S0.7 — where the week's posted replies landed vs my 2–10x target band.
  const rosterCoverage = await loadRosterCoverage(start, end);

  // M1 (ME.5) — active goals with progress (all-time latest snapshot, like the
  // Me tab); the narration may mention progress without inventing numbers.
  const goals = await loadGoals(new Date());

  // §S4 — the week's AI image spend (isolated under platform 'xai') and the
  // all-time media-vs-text lift the studio exists to earn (gated n≥20/side).
  const imageSpendUsd =
    Math.round(Number(costRows.find((r) => r.platform === 'xai')?.costUsd ?? 0) * 1e5) / 1e5;
  const mediaVsText = buildMediaEffectiveness(await loadMediaRows());

  // §GR.9 — the scorecard's own inputs (everything else it needs is derived
  // inside buildDigestFacts from the rows above).
  //
  // `loadGoalsWithPacing` is the SAME loader the brief and `GET /x/goals` use —
  // one reading of "on pace" across every surface (the loadMonitorInputs rule).
  // It applies GR.7's lazy `active→achieved|missed` flip, so **generating a
  // digest settles finished goals**; it is idempotent and only advances, but
  // nothing may poll this route expecting a pure read. The cached path returns
  // long before here, so re-opening Sunday's digest does not re-flip.
  const [commitmentViews, goalViews, prevScore] = await Promise.all([
    loadCommitmentsWithDebt(now, tzOffsetMin),
    loadGoalsWithPacing(now),
    loadPrevScore(weekKey),
  ]);
  const doctrine = loadDoctrine();
  // The debt half of the commitment view is unused here; the loader is imported
  // anyway so "which commitment is active" has exactly one reading (GR.8).
  const repliesDailyTarget =
    commitmentViews.find((c) => c.key === 'replies' && c.active)?.dailyTarget ??
    doctrine.replyTargetMin;
  // 7 once the week is over, the elapsed days while it is still running — a
  // Wednesday read is graded against three days of target, not seven.
  const daysInWeek = Math.max(
    1,
    Math.min(7, Math.ceil((Math.min(now.getTime(), end.getTime()) - start.getTime()) / DAY_MS)),
  );
  const daysWithOriginal = new Set(
    published.filter((p) => !p.isReply).map((p) => localDayKey(p.postedAt, tzOffsetMin)),
  ).size;
  const goalVerdicts: GoalVerdict[] = goalViews
    .filter((g) => g.status === 'active')
    .map((g) => g.pacing.verdict);

  return buildDigestFacts({
    weekKey,
    start,
    end,
    followerPoints: snaps,
    tweets: published.map((p) => ({
      text: snippet(p.text),
      isReply: p.isReply,
      views: outcomeByTweet.get(p.tweetId)?.views ?? null,
      profileVisits: outcomeByTweet.get(p.tweetId)?.profileVisits ?? null,
    })),
    stageTransitions: transitions
      .filter((t) => stageRank(t.stage as Stage) >= stageRank('engaged'))
      .slice(0, STAGE_TRANSITION_CAP)
      .map((t) => ({ handle: t.handle, stage: t.stage, at: t.at as Date })),
    fansThisWeek,
    fansPrevWeek,
    neglectedTargets,
    neglectedAllies,
    spendByPlatform: costRows.map((r) => ({
      platform: r.platform,
      costUsd: Math.round(Number(r.costUsd) * 1e5) / 1e5,
    })),
    streakDays: streakRows,
    goals,
    guidance: { reply: replyGuidance, post: postGuidance },
    rosterCoverage,
    imageSpendUsd,
    mediaVsText,
    scorecardInputs: {
      daysWithOriginal,
      daysInWeek,
      repliesTargetWeek: repliesDailyTarget * daysInWeek,
      targetReplyPct: doctrine.weekReplyTargetPct,
      goalVerdicts,
      prevScore,
    },
  });
}

/** GR.9 — last week's grade, read off last week's cached digest. A week that was
 *  never generated, or one generated before the scorecard existed, has none, and
 *  the delta stays null rather than becoming a comparison against zero. */
async function loadPrevScore(weekKey: string): Promise<number | null> {
  const [row] = await db
    .select({ facts: digests.facts })
    .from(digests)
    .where(eq(digests.weekKey, dayKeyPlus(weekKey, -7)));
  if (!row) return null;
  return (row.facts as Partial<DigestFacts> | null)?.scorecard?.score ?? null;
}

/** M1 (ME.5) — active Me goals with computed progress. followers goals read the
 *  latest account snapshot (all-time latest, like the Me tab); the GR.7 counted
 *  kinds read their value from the goals loader; mrr/custom use the manual
 *  currentValue. null when there are none, so the narration skips it. Unlike the
 *  injected me-block, the weekly digest DOES narrate the counted kinds — a reply
 *  quota is exactly what a week in review is about. */
async function loadGoals(now: Date): Promise<DigestGoal[] | null> {
  const goals = await db.select().from(meGoals).where(eq(meGoals.status, 'active'));
  if (goals.length === 0) return null;
  const [acct] = await db
    .select({ followersCount: accountSnapshots.followersCount })
    .from(accountSnapshots)
    .orderBy(desc(accountSnapshots.snapshotAt))
    .limit(1);
  const latestFollowers = acct ? acct.followersCount : null;
  const flowCurrents = await loadFlowCurrents(goals, now);
  return resolveGoals(goals, latestFollowers, now, flowCurrents).map((g) => ({
    label: g.label,
    unit: g.unit,
    target: g.target,
    current: g.progress?.current ?? null,
    pct: g.progress?.pct ?? null,
  }));
}

async function loadFanCounts(
  from: Date,
  to: Date,
): Promise<Array<{ handle: string; inbound: number }>> {
  const rows = await db
    .select({ handle: personEvents.handle, inbound: sql<number>`count(*)` })
    .from(personEvents)
    .where(
      and(
        inArray(personEvents.type, [...INBOUND_TYPES]),
        gte(personEvents.at, from),
        lt(personEvents.at, to),
      ),
    )
    .groupBy(personEvents.handle);
  return rows.map((r) => ({ handle: r.handle, inbound: Number(r.inbound) }));
}

/** 2–10x roster targets with no pasted reply in the trailing week (same
 *  reading as the brief's quest and C5's neglected_target). */
async function loadNeglectedTargets(asOf: Date): Promise<string[]> {
  const [acct] = await db
    .select({ followersCount: accountSnapshots.followersCount })
    .from(accountSnapshots)
    .orderBy(desc(accountSnapshots.snapshotAt))
    .limit(1);
  if (!acct) return [];
  const doctrine = loadDoctrine();
  const band = targetBand(acct.followersCount, {
    minX: doctrine.targetBandMinX,
    maxX: doctrine.targetBandMaxX,
  });
  const authors = await db
    .select({ handle: voiceAuthors.handle, followersCount: voiceAuthors.followersCount })
    .from(voiceAuthors)
    .where(eq(voiceAuthors.retired, false));
  const targets = authors
    .filter(
      (a) =>
        a.followersCount !== null && a.followersCount >= band.min && a.followersCount <= band.max,
    )
    .map((a) => a.handle);
  if (targets.length === 0) return [];

  const lastByHandle = new Map<string, Date>();
  const rows = await db
    .select({
      handle: sql<string>`lower(${replyDrafts.sourceAuthorUsername})`,
      last: sql`max(${replyDrafts.updatedAt})`.mapWith(replyDrafts.updatedAt),
    })
    .from(replyDrafts)
    .where(
      and(
        eq(replyDrafts.status, 'posted'),
        inArray(sql`lower(${replyDrafts.sourceAuthorUsername})`, targets),
      ),
    )
    .groupBy(sql`lower(${replyDrafts.sourceAuthorUsername})`);
  for (const r of rows) lastByHandle.set(r.handle, r.last);

  const cutoff = asOf.getTime() - NEGLECTED_TARGET_DAYS * DAY_MS;
  return targets
    .filter((h) => (lastByHandle.get(h)?.getTime() ?? 0) < cutoff)
    .slice(0, NEGLECTED_CAP);
}

async function loadNeglectedAllies(asOf: Date): Promise<string[]> {
  const rows = await db
    .select({
      handle: people.handle,
      lastInboundAt: people.lastInboundAt,
      lastOutboundAt: people.lastOutboundAt,
    })
    .from(people)
    .where(and(eq(people.retired, false), inArray(people.stage, ['mutual', 'ally'])));
  const cutoff = asOf.getTime() - NEGLECTED_ALLY_DAYS * DAY_MS;
  return rows
    .filter(
      (p) => Math.max(p.lastInboundAt?.getTime() ?? 0, p.lastOutboundAt?.getTime() ?? 0) < cutoff,
    )
    .map((p) => p.handle)
    .slice(0, NEGLECTED_CAP);
}

function dayKeyPlus(day: string, days: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

function snippet(text: string, max = 140): string {
  const collapsed = text.replace(/\s+/g, ' ').trim();
  return collapsed.length <= max ? collapsed : `${collapsed.slice(0, max - 1)}…`;
}
