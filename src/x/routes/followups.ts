// Follow-up engine + Top Fans (CIRCLES-PLAN C5): the relationship layer
// telling you what to do today. Pure SQL over data other surfaces already paid
// for — always mounted, every route $0. Momentum is recomputed from the
// snapshot series on every read (no stored flags to go stale — the same
// no-derived-state discipline as C2's conversations).
//
// Routes:
//   GET   /people/followups   the ranked queue (chain_live → dm_ready →
//                             neglected_target → neglected_ally → momentum)
//   PATCH /people/followups   { kind, handle, snoozedUntil: iso|null }
//   GET   /people/fans        ?days=30&limit=20  inbound-ranked Top Fans
//
// MOUNT ORDER MATTERS: this router must be registered BEFORE peopleRouter —
// 'followups' and 'fans' are valid usernames, so GET /people/:handle would
// otherwise swallow both paths as dossier lookups (see mountX in ../index.ts).

import { and, desc, eq, gte, inArray, isNotNull, lte, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { db } from '../../db/client.ts';
import {
  accountSnapshots,
  followupSnoozes,
  mentions,
  metricsSnapshots,
  people,
  personEvents,
  personSnapshots,
  postsPublished,
  scheduledPosts,
  voiceAuthorSnapshots,
  voiceAuthors,
} from '../db/schema.ts';
import { loadDoctrine } from '../niche/store.ts';
import {
  CHAIN_LIVE_MAX_AGE_MS,
  type ChainInbound,
  type FollowerPoint,
  type FollowupPerson,
  type MomentumCandidate,
  REUP_MAX_AGE_DAYS,
  REUP_MIN_AGE_DAYS,
  type ReupCandidate,
  aboutToEnterBand,
  classifyFollowups,
  fanUnacknowledged,
  followupKey,
  isFollowupKind,
  momentumInflection,
  pickReupCandidate,
  rankFans,
  reupKey,
} from '../people/followups.ts';
import { INBOUND_TYPES, type Stage, stageRank } from '../people/stage.ts';
import { myReplyTweetIds, normalizePersonHandle } from '../people/store.ts';
import { authorMomentum, targetBand } from './voice.ts';

const DAY_MS = 24 * 60 * 60 * 1000;
// Momentum scans the trailing snapshot window only — older points describe a
// different account, and the read stays O(recent) as the series grows.
const MOMENTUM_WINDOW_DAYS = 120;
const FANS_DEFAULT_DAYS = 30;
const FANS_MAX_DAYS = 365;
const FANS_DEFAULT_LIMIT = 20;
const FANS_MAX_LIMIT = 100;
// Same bar the dailyMetrics winner re-read uses (§8.4) — a post only counts as
// a re-up candidate if a snapshot measured it clearing this view count.
const REUP_MIN_VIEWS = Number(process.env.WINNER_REREAD_MIN_VIEWS ?? '500');
const TWEET_ID_RE = /^\d+$/;

export const followups = new Hono();

// ------------------------------------------------------------------ queue

followups.get('/people/followups', async (c) => {
  const now = new Date();

  const [acct] = await db
    .select({ followersCount: accountSnapshots.followersCount })
    .from(accountSnapshots)
    .orderBy(desc(accountSnapshots.snapshotAt))
    .limit(1);
  const myFollowers = acct?.followersCount ?? null;

  // chain_live: unanswered inbound <24h that replies to one of MY replies —
  // same reading as C2's chain flag, scoped to the live window.
  const recentInbound = await db
    .select()
    .from(mentions)
    .where(
      and(
        eq(mentions.status, 'unanswered'),
        gte(mentions.postedAt, new Date(now.getTime() - CHAIN_LIVE_MAX_AGE_MS)),
        isNotNull(mentions.inReplyToTweetId),
      ),
    );
  const replyIds = await myReplyTweetIds(
    recentInbound.flatMap((m) => (m.inReplyToTweetId ? [m.inReplyToTweetId] : [])),
  );
  const chainInbound: ChainInbound[] = recentInbound.flatMap((m) => {
    if (!m.authorUsername || !m.inReplyToTweetId || !replyIds.has(m.inReplyToTweetId)) return [];
    const handle = m.authorUsername.toLowerCase();
    return [
      {
        handle,
        displayName: m.authorName,
        tweetId: m.tweetId,
        text: m.text,
        postedAt: m.postedAt,
        url: `https://x.com/${handle}/status/${m.tweetId}`,
      },
    ];
  });

  const peopleRows = await db.select().from(people).where(eq(people.retired, false));
  const followupPeople: FollowupPerson[] = peopleRows.map((p) => ({
    handle: p.handle,
    displayName: p.displayName,
    stage: p.stage as Stage,
    stageUpdatedAt: p.stageUpdatedAt,
    lastInboundAt: p.lastInboundAt,
    lastOutboundAt: p.lastOutboundAt,
  }));
  const peopleByHandle = new Map(followupPeople.map((p) => [p.handle, p]));

  // Target roster = the same 2–10x band as GET /voice/targets. Empty until the
  // first daily pass writes an account snapshot (no "my size" to band against).
  const authors = await db
    .select({
      handle: voiceAuthors.handle,
      displayName: voiceAuthors.displayName,
      followersCount: voiceAuthors.followersCount,
    })
    .from(voiceAuthors)
    .where(eq(voiceAuthors.retired, false));
  const authorDisplayByHandle = new Map(authors.map((a) => [a.handle, a.displayName]));
  const targetHandles = new Set<string>();
  if (myFollowers !== null) {
    const doctrine = loadDoctrine();
    const band = targetBand(myFollowers, {
      minX: doctrine.targetBandMinX,
      maxX: doctrine.targetBandMaxX,
    });
    for (const a of authors) {
      if (
        a.followersCount !== null &&
        a.followersCount >= band.min &&
        a.followersCount <= band.max
      ) {
        targetHandles.add(a.handle);
      }
    }
  }

  // Momentum: merge both follower series per handle (voice authors keep theirs
  // in voice_author_snapshots; person_snapshots stays empty until C6 hover
  // capture) and flag upward inflections + imminent band entries.
  const windowStart = new Date(now.getTime() - MOMENTUM_WINDOW_DAYS * DAY_MS);
  const [voiceSnaps, personSnaps] = await Promise.all([
    db
      .select({
        handle: voiceAuthorSnapshots.handle,
        followersCount: voiceAuthorSnapshots.followersCount,
        capturedAt: voiceAuthorSnapshots.capturedAt,
      })
      .from(voiceAuthorSnapshots)
      .where(gte(voiceAuthorSnapshots.capturedAt, windowStart)),
    db
      .select({
        handle: personSnapshots.handle,
        followersCount: personSnapshots.followersCount,
        capturedAt: personSnapshots.capturedAt,
      })
      .from(personSnapshots)
      .where(gte(personSnapshots.capturedAt, windowStart)),
  ]);
  const seriesByHandle = new Map<string, FollowerPoint[]>();
  for (const s of [...voiceSnaps, ...personSnaps]) {
    const list = seriesByHandle.get(s.handle) ?? [];
    list.push({ capturedAt: s.capturedAt, followersCount: s.followersCount });
    seriesByHandle.set(s.handle, list);
  }

  const momentum: MomentumCandidate[] = [];
  for (const [handle, points] of seriesByHandle) {
    if (points.length < 2) continue;
    points.sort((a, b) => a.capturedAt.getTime() - b.capturedAt.getTime());
    const person = peopleByHandle.get(handle);
    const latest = points[points.length - 1] as FollowerPoint;

    const inflection = momentumInflection(points, now);
    // Band entry is a mutual-and-up signal — a stranger crossing 2x my size is
    // trivia; an ally doing it means my early replies are about to compound.
    const enteringBand =
      myFollowers !== null &&
      person !== undefined &&
      stageRank(person.stage) >= stageRank('mutual') &&
      aboutToEnterBand(latest.followersCount, authorMomentum(points)?.perDay ?? null, myFollowers);

    if (inflection || enteringBand) {
      momentum.push({
        handle,
        displayName: person?.displayName ?? authorDisplayByHandle.get(handle) ?? null,
        stage: person?.stage ?? null,
        followersCount: latest.followersCount,
        inflection,
        enteringBand,
        latestCapturedAt: latest.capturedAt,
      });
    }
  }

  const snoozeRows = await db.select().from(followupSnoozes);
  const snoozes = new Map(snoozeRows.map((s) => [s.itemKey, s.snoozedUntil]));

  const { items, snoozed } = classifyFollowups({
    now,
    chainInbound,
    people: followupPeople,
    targetHandles,
    momentum,
    snoozes,
  });

  // reup_candidate (§S0.6): proven own posts (measured views ≥ the winner bar)
  // 14–60d old that haven't been quote-tweeted yet. Not a person item — pick
  // the single best and ranked just above momentum at the queue tail.
  const reup = pickReupCandidate(await loadReupCandidates(now), snoozes, now);
  let finalItems = items;
  if (reup.item) {
    const momentumIdx = items.findIndex((i) => i.kind === 'momentum');
    const at = momentumIdx === -1 ? items.length : momentumIdx;
    finalItems = [...items.slice(0, at), reup.item, ...items.slice(at)];
  }
  const totalSnoozed = snoozed + reup.snoozed;

  const byKind: Record<string, number> = {};
  for (const i of finalItems) byKind[i.kind] = (byKind[i.kind] ?? 0) + 1;

  return c.json({
    generatedAt: now,
    myFollowers,
    counts: { total: finalItems.length, snoozed: totalSnoozed, byKind },
    items: finalItems,
  });
});

// Own non-reply posts 14–60d old whose peak measured views cleared the winner
// bar, minus any tweet a scheduled_posts row already quotes (draft, pending, or
// posted — we don't nag about a re-up that's already queued). Views come from
// the max snapshot impression_count, same read as the dailyMetrics winner
// re-read. Retired rows are kept: retire-before-snapshot (invariant #7) means
// nearly every measured tweet is retired, so filtering on it would find nothing.
async function loadReupCandidates(now: Date): Promise<ReupCandidate[]> {
  const oldest = new Date(now.getTime() - REUP_MAX_AGE_DAYS * DAY_MS);
  const newest = new Date(now.getTime() - REUP_MIN_AGE_DAYS * DAY_MS);
  const winners = await db
    .select({
      tweetId: postsPublished.tweetId,
      postedAt: postsPublished.postedAt,
      views:
        sql<number>`max(CAST(json_extract(${metricsSnapshots.publicMetrics}, '$.impression_count') AS INTEGER))`.as(
          'views',
        ),
    })
    .from(postsPublished)
    .innerJoin(metricsSnapshots, eq(metricsSnapshots.tweetId, postsPublished.tweetId))
    .where(
      and(
        eq(postsPublished.isReply, false),
        gte(postsPublished.postedAt, oldest),
        lte(postsPublished.postedAt, newest),
      ),
    )
    .groupBy(postsPublished.tweetId)
    .having(
      sql`max(CAST(json_extract(${metricsSnapshots.publicMetrics}, '$.impression_count') AS INTEGER)) >= ${REUP_MIN_VIEWS}`,
    );
  if (winners.length === 0) return [];

  const quotedRows = await db
    .select({ quoteTweetId: scheduledPosts.quoteTweetId })
    .from(scheduledPosts)
    .where(isNotNull(scheduledPosts.quoteTweetId));
  const alreadyQuoted = new Set(quotedRows.map((r) => r.quoteTweetId));

  return winners
    .filter((w) => !alreadyQuoted.has(w.tweetId))
    .map((w) => ({ tweetId: w.tweetId, views: Number(w.views), postedAt: w.postedAt }));
}

// ----------------------------------------------------------------- snooze

followups.patch('/people/followups', async (c) => {
  const raw = await c.req.json().catch(() => null);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return c.json({ error: 'invalid_body' }, 400);
  }
  const body = raw as Record<string, unknown>;

  if (!isFollowupKind(body.kind)) return c.json({ error: 'invalid_kind' }, 400);

  // reup_candidate snoozes on the tweet (reup:<tweetId>), not a person handle.
  let itemKey: string;
  if (body.kind === 'reup_candidate') {
    const tweetId = typeof body.tweetId === 'string' ? body.tweetId.trim() : '';
    if (!TWEET_ID_RE.test(tweetId)) return c.json({ error: 'invalid_tweet_id' }, 400);
    itemKey = reupKey(tweetId);
  } else {
    const handle = normalizePersonHandle(body.handle);
    if (!handle) return c.json({ error: 'invalid_handle' }, 400);
    itemKey = followupKey(body.kind, handle);
  }

  if (body.snoozedUntil === null) {
    await db.delete(followupSnoozes).where(eq(followupSnoozes.itemKey, itemKey));
    return c.json({ itemKey, snoozedUntil: null });
  }

  if (typeof body.snoozedUntil !== 'string' || Number.isNaN(Date.parse(body.snoozedUntil))) {
    return c.json({ error: 'invalid_snoozed_until' }, 400);
  }
  const snoozedUntil = new Date(body.snoozedUntil);
  const now = new Date();
  const [row] = await db
    .insert(followupSnoozes)
    .values({ itemKey, snoozedUntil, updatedAt: now })
    .onConflictDoUpdate({
      target: followupSnoozes.itemKey,
      set: { snoozedUntil, updatedAt: now },
    })
    .returning();
  return c.json(row);
});

// ------------------------------------------------------------------- fans

followups.get('/people/fans', async (c) => {
  const now = new Date();

  let days = FANS_DEFAULT_DAYS;
  const daysStr = c.req.query('days');
  if (daysStr !== undefined) {
    const n = Number(daysStr);
    if (!Number.isInteger(n) || n < 1 || n > FANS_MAX_DAYS) {
      return c.json({ error: 'invalid_days' }, 400);
    }
    days = n;
  }

  let limit = FANS_DEFAULT_LIMIT;
  const limitStr = c.req.query('limit');
  if (limitStr !== undefined) {
    const n = Number(limitStr);
    if (!Number.isInteger(n) || n < 1) return c.json({ error: 'invalid_limit' }, 400);
    limit = Math.min(FANS_MAX_LIMIT, n);
  }

  const cutoff = new Date(now.getTime() - days * DAY_MS);
  // Inbound = their_mention + their_reply_to_me — the "they already notice
  // you" signal, counted from the same events the stage engine reads.
  const agg = await db
    .select({
      handle: people.handle,
      displayName: people.displayName,
      stage: people.stage,
      lastOutboundAt: people.lastOutboundAt,
      followersCount: people.followersCount,
      inboundCount: sql<number>`count(*)`,
      lastInboundAt: sql`max(${personEvents.at})`.mapWith(personEvents.at),
    })
    .from(people)
    .innerJoin(
      personEvents,
      and(
        eq(personEvents.handle, people.handle),
        inArray(personEvents.type, [...INBOUND_TYPES]),
        gte(personEvents.at, cutoff),
      ),
    )
    .where(eq(people.retired, false))
    .groupBy(people.handle);

  const ranked = rankFans(agg.map((f) => ({ ...f, inboundCount: Number(f.inboundCount) }))).slice(
    0,
    limit,
  );

  return c.json({
    days,
    count: ranked.length,
    fans: ranked.map((f, i) => ({
      rank: i + 1,
      handle: f.handle,
      displayName: f.displayName,
      stage: f.stage,
      followersCount: f.followersCount,
      inboundCount: f.inboundCount,
      lastInboundAt: f.lastInboundAt,
      lastOutboundAt: f.lastOutboundAt,
      unacknowledged: fanUnacknowledged(f, now),
    })),
  });
});
