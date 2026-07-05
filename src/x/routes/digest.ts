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
import { GrokApiError, askGrok } from '../../grok/index.ts';
import {
  accountSnapshots,
  digests,
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
  buildDigestFacts,
  buildDigestInput,
  parseDigestNarrative,
  weekBounds,
} from '../digest.ts';
import { INBOUND_TYPES, type Stage, stageRank } from '../people/stage.ts';
import { loadPostGuidanceSafe, loadReplyGuidanceSafe } from './playbook.ts';
import { targetBand } from './voice.ts';

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_RE = /^\d{4}-\d{2}-\d{2}$/;
const NEGLECTED_CAP = 5;
const STAGE_TRANSITION_CAP = 10;
const NEGLECTED_TARGET_DAYS = 7;
const NEGLECTED_ALLY_DAYS = 14;
const DIGEST_CACHE_KEY = 'stratus-digest';
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

  const facts = await loadFacts(start, end, weekKey);

  if (factsOnly) {
    return c.json({ weekKey, from: start, to: end, facts, narrative: null, cached: false });
  }
  if (!process.env.XAI_API_KEY) {
    return c.json({
      weekKey,
      from: start,
      to: end,
      facts,
      narrative: null,
      narrativeError: 'grok_not_configured',
      cached: false,
    });
  }

  let narrative: string | null = null;
  let narrativeError: string | undefined;
  let model: string | null = null;
  let costUsd: number | null = null;
  try {
    const result = await askGrok({
      messages: buildDigestInput(facts),
      reasoningEffort: 'low',
      maxOutputTokens: DIGEST_MAX_OUTPUT_TOKENS,
      temperature: 0.7,
      jsonSchema: { name: 'sunday_digest', schema: DIGEST_SCHEMA },
      promptCacheKey: DIGEST_CACHE_KEY,
    });
    model = result.model;
    costUsd = result.costUsd;
    narrative = parseDigestNarrative(result.text);
    if (narrative === null) narrativeError = 'grok_parse_error';
  } catch (err) {
    // Facts are still the page — a Grok hiccup degrades the card, never 5xxs
    // it. Nothing is cached, so the next open retries for free.
    narrativeError = err instanceof GrokApiError ? `grok_${err.status}` : 'grok_failed';
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

async function loadFacts(start: Date, end: Date, weekKey: string): Promise<DigestFacts> {
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
    guidance: { reply: replyGuidance, post: postGuidance },
  });
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
  const band = targetBand(acct.followersCount);
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
