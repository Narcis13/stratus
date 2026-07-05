// Circles CRM (CIRCLES-PLAN C1): one row per human, an append-only interaction
// timeline, and the dossier that answers "what's my history with this person?"
// in one screen. Mounted under `/x` by `mountX` in ../index.ts — always
// mounted, every route is $0 (pure SQL over data other surfaces already paid
// for; nothing here touches the X API or Grok).
//
// Routes:
//   GET   /people                   list/filter (stage, tag, q, sort, retired)
//   GET   /people/:handle           the dossier
//   PATCH /people/:handle           notes, tags, stage override (may demote), retired
//   POST  /people/:handle/events    manual log entry (note | manual_dm_logged)

import { type SQL, and, asc, desc, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { db } from '../../db/client.ts';
import { GrokApiError, askGrok } from '../../grok/index.ts';
import {
  channels,
  mentions,
  metricsSnapshots,
  people,
  personEvents,
  personSnapshots,
  postsPublished,
  replyDrafts,
  voiceAuthorSnapshots,
  voiceAuthors,
  voiceTweets,
} from '../db/schema.ts';
import { buildAngleCrosstab } from '../people/angles.ts';
import {
  ICEBREAKER_SCHEMA,
  MAX_GROUNDING_EXCHANGES,
  MAX_GROUNDING_TWEETS,
  buildIcebreakerInput,
  parseIcebreakers,
  renderIcebreakerGrounding,
} from '../people/icebreakers.ts';
import {
  type HoverCard,
  MAX_SIGHTINGS_PER_BATCH,
  type PersonSightingInput,
  recordSightings,
} from '../people/sightings.ts';
import { INBOUND_TYPES, OUTBOUND_TYPES, type Stage, isStage } from '../people/stage.ts';
import { normalizePersonHandle, recomputePerson, upsertPerson } from '../people/store.ts';
import type { ReplyVariant } from '../replies/prompt.ts';
import { buildReplyOutcomes } from './replies.ts';

// Moved to ../people/angles.ts (C3 needs it outside a route module); re-exported
// so existing callers/tests keep their import site.
export { buildAngleCrosstab, type AngleCell } from '../people/angles.ts';

const DEFAULT_LIST_LIMIT = 100;
const MAX_LIST_LIMIT = 500;
const MAX_EVENTS = 500;
const MAX_DOSSIER_REPLIES = 200;
const MAX_DOSSIER_MENTIONS = 100;
const MAX_DOSSIER_TWEETS = 50;
const MAX_NOTES_LEN = 5000;
const MAX_TAGS = 25;
const MAX_TAG_LEN = 40;
const MAX_SUMMARY_LEN = 500;

const SORTS = ['last_seen', 'last_inbound', 'last_outbound', 'first_seen'] as const;
type PeopleSort = (typeof SORTS)[number];

const MANUAL_EVENT_TYPES = ['note', 'manual_dm_logged'] as const;

export const peopleRouter = new Hono();

// ------------------------------------------------------------------- list

peopleRouter.get('/people', async (c) => {
  const stageStr = c.req.query('stage');
  const tag = c.req.query('tag')?.trim();
  const q = c.req.query('q')?.trim();
  const sortStr = c.req.query('sort') ?? 'last_seen';
  const includeRetired = c.req.query('retired') === 'true';
  const limitStr = c.req.query('limit');

  if (stageStr !== undefined && !isStage(stageStr)) return c.json({ error: 'invalid_stage' }, 400);
  if (!isSort(sortStr)) return c.json({ error: 'invalid_sort' }, 400);

  let limit = DEFAULT_LIST_LIMIT;
  if (limitStr !== undefined) {
    const n = Number(limitStr);
    if (!Number.isInteger(n) || n < 1) return c.json({ error: 'invalid_limit' }, 400);
    limit = Math.min(MAX_LIST_LIMIT, n);
  }

  const filters: SQL[] = [];
  if (stageStr !== undefined) filters.push(eq(people.stage, stageStr));
  if (!includeRetired) filters.push(eq(people.retired, false));
  if (tag) {
    filters.push(
      sql`exists (select 1 from json_each(${people.tags}) where json_each.value = ${tag})`,
    );
  }
  if (q) {
    const pattern = `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
    filters.push(
      sql`(${people.handle} like ${pattern} escape '\\' or ${people.displayName} like ${pattern} escape '\\')`,
    );
  }

  const sortCol =
    sortStr === 'last_inbound'
      ? people.lastInboundAt
      : sortStr === 'last_outbound'
        ? people.lastOutboundAt
        : sortStr === 'first_seen'
          ? people.firstSeenAt
          : people.lastSeenAt;

  const inboundCount = sql<number>`coalesce(sum(case when ${personEvents.type} in ('their_mention','their_reply_to_me') then 1 else 0 end), 0)`;
  const outboundCount = sql<number>`coalesce(sum(case when ${personEvents.type} = 'my_reply' then 1 else 0 end), 0)`;
  const eventCount = sql<number>`count(${personEvents.id})`;

  const rows = await db
    .select({
      handle: people.handle,
      xUserId: people.xUserId,
      displayName: people.displayName,
      bio: people.bio,
      followersCount: people.followersCount,
      followingCount: people.followingCount,
      stage: people.stage,
      stageUpdatedAt: people.stageUpdatedAt,
      notes: people.notes,
      tags: people.tags,
      source: people.source,
      firstSeenAt: people.firstSeenAt,
      lastSeenAt: people.lastSeenAt,
      lastInboundAt: people.lastInboundAt,
      lastOutboundAt: people.lastOutboundAt,
      retired: people.retired,
      inboundCount,
      outboundCount,
      eventCount,
    })
    .from(people)
    .leftJoin(personEvents, eq(personEvents.handle, people.handle))
    .where(filters.length ? and(...filters) : undefined)
    .groupBy(people.handle)
    .orderBy(desc(sortCol), asc(people.handle))
    .limit(limit);

  return c.json({ count: rows.length, people: rows });
});

// ---------------------------------------------------------------- dossier

peopleRouter.get('/people/:handle', async (c) => {
  const handle = normalizePersonHandle(c.req.param('handle'));
  if (!handle) return c.json({ error: 'invalid_handle' }, 400);

  const [person] = await db.select().from(people).where(eq(people.handle, handle));
  if (!person) return c.json({ error: 'not_found' }, 404);

  const [voiceAuthor] = await db.select().from(voiceAuthors).where(eq(voiceAuthors.handle, handle));

  const events = await db
    .select()
    .from(personEvents)
    .where(eq(personEvents.handle, handle))
    .orderBy(desc(personEvents.at))
    .limit(MAX_EVENTS);

  // My replies to them, with measured outcomes — same join path as
  // GET /x/replies/outcomes, scoped to this person.
  const drafts = await db
    .select({
      id: replyDrafts.id,
      sourceTweetId: replyDrafts.sourceTweetId,
      sourceAuthorUsername: replyDrafts.sourceAuthorUsername,
      sourceText: replyDrafts.sourceText,
      sourceUrl: replyDrafts.sourceUrl,
      sourcePostedAt: replyDrafts.sourcePostedAt,
      contextSnapshot: replyDrafts.contextSnapshot,
      replyText: replyDrafts.replyText,
      replyTextEdited: replyDrafts.replyTextEdited,
      postedTweetId: replyDrafts.postedTweetId,
      createdAt: replyDrafts.createdAt,
      variants: replyDrafts.variants,
    })
    .from(replyDrafts)
    .where(
      and(
        sql`lower(${replyDrafts.sourceAuthorUsername}) = ${handle}`,
        eq(replyDrafts.status, 'posted'),
      ),
    )
    .orderBy(desc(replyDrafts.createdAt))
    .limit(MAX_DOSSIER_REPLIES);

  const ids = drafts.flatMap((d) => (d.postedTweetId ? [d.postedTweetId] : []));
  const [posts, snaps] = ids.length
    ? await Promise.all([
        db
          .select({
            tweetId: postsPublished.tweetId,
            postedAt: postsPublished.postedAt,
            retired: postsPublished.retired,
          })
          .from(postsPublished)
          .where(inArray(postsPublished.tweetId, ids)),
        db
          .select({
            tweetId: metricsSnapshots.tweetId,
            snapshotAt: metricsSnapshots.snapshotAt,
            publicMetrics: metricsSnapshots.publicMetrics,
            nonPublicMetrics: metricsSnapshots.nonPublicMetrics,
          })
          .from(metricsSnapshots)
          .where(inArray(metricsSnapshots.tweetId, ids))
          .orderBy(desc(metricsSnapshots.snapshotAt)),
      ])
    : [[], []];

  const outcomes = buildReplyOutcomes(drafts, posts, snaps);

  // The angle each posted draft actually shipped with (the primary pick), so
  // the crosstab can feed C3's "measured angle preference" block.
  const angleByDraft = new Map<string, string | null>();
  for (const d of drafts) {
    const variants = d.variants as ReplyVariant[] | null;
    angleByDraft.set(d.id, variants?.find((v) => v.text === d.replyText)?.angle ?? null);
  }
  const angles = buildAngleCrosstab(
    outcomes.map((o) => ({
      angle: angleByDraft.get(o.draftId) ?? null,
      outcome: o.outcome,
    })),
  );

  const theirMentions = await db
    .select()
    .from(mentions)
    .where(sql`lower(${mentions.authorUsername}) = ${handle}`)
    .orderBy(desc(mentions.postedAt))
    .limit(MAX_DOSSIER_MENTIONS);

  const savedTweets = await db
    .select()
    .from(voiceTweets)
    .where(eq(voiceTweets.authorHandle, handle))
    .orderBy(desc(voiceTweets.createdAt))
    .limit(MAX_DOSSIER_TWEETS);

  // Follower series from BOTH snapshot tables (voice authors keep theirs).
  const [voiceSnaps, personSnaps] = await Promise.all([
    db
      .select({
        followersCount: voiceAuthorSnapshots.followersCount,
        capturedAt: voiceAuthorSnapshots.capturedAt,
      })
      .from(voiceAuthorSnapshots)
      .where(eq(voiceAuthorSnapshots.handle, handle))
      .orderBy(asc(voiceAuthorSnapshots.capturedAt)),
    db
      .select({
        followersCount: personSnapshots.followersCount,
        capturedAt: personSnapshots.capturedAt,
      })
      .from(personSnapshots)
      .where(eq(personSnapshots.handle, handle))
      .orderBy(asc(personSnapshots.capturedAt)),
  ]);
  const followerSeries = [
    ...voiceSnaps.map((s) => ({ ...s, source: 'voice' as const })),
    ...personSnaps.map((s) => ({ ...s, source: 'person' as const })),
  ].sort((a, b) => a.capturedAt.getTime() - b.capturedAt.getTime());

  return c.json({
    person,
    voiceAuthor: voiceAuthor ?? null,
    events,
    replies: {
      count: outcomes.length,
      measured: outcomes.filter((o) => o.outcome !== null).length,
      outcomes,
    },
    angles,
    mentions: theirMentions,
    savedTweets,
    followerSeries,
  });
});

// ------------------------------------------------------------------ patch

peopleRouter.patch('/people/:handle', async (c) => {
  const handle = normalizePersonHandle(c.req.param('handle'));
  if (!handle) return c.json({ error: 'invalid_handle' }, 400);

  const raw = await c.req.json().catch(() => null);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return c.json({ error: 'invalid_body' }, 400);
  }
  const body = raw as Record<string, unknown>;

  const updates: Partial<typeof people.$inferInsert> = {};

  if (body.notes !== undefined) {
    if (body.notes === null) updates.notes = null;
    else if (typeof body.notes !== 'string' || body.notes.length > MAX_NOTES_LEN) {
      return c.json({ error: 'invalid_notes' }, 400);
    } else updates.notes = body.notes;
  }

  if (body.tags !== undefined) {
    if (body.tags === null) updates.tags = null;
    else {
      if (!Array.isArray(body.tags) || body.tags.length > MAX_TAGS) {
        return c.json({ error: 'invalid_tags' }, 400);
      }
      const tags: string[] = [];
      for (const t of body.tags) {
        if (typeof t !== 'string') return c.json({ error: 'invalid_tags' }, 400);
        const trimmed = t.trim();
        if (trimmed === '' || trimmed.length > MAX_TAG_LEN) {
          return c.json({ error: 'invalid_tags' }, 400);
        }
        if (!tags.includes(trimmed)) tags.push(trimmed);
      }
      updates.tags = tags;
    }
  }

  // Manual stage override — the one path allowed to demote (auto only ratchets
  // up; see people/store.ts recomputePerson).
  if (body.stage !== undefined) {
    if (!isStage(body.stage)) return c.json({ error: 'invalid_stage' }, 400);
    updates.stage = body.stage;
    updates.stageUpdatedAt = new Date();
  }

  if (body.retired !== undefined) {
    if (typeof body.retired !== 'boolean') return c.json({ error: 'invalid_retired' }, 400);
    updates.retired = body.retired;
  }

  if (Object.keys(updates).length === 0) return c.json({ error: 'empty_patch' }, 400);

  const [row] = await db.update(people).set(updates).where(eq(people.handle, handle)).returning();
  if (!row) return c.json({ error: 'not_found' }, 404);
  return c.json(row);
});

// -------------------------------------------------------------- sightings

// Passive hover capture (C6): batched upserts from hover cards X rendered
// during natural browsing. $0 — pure DOM data. NOTE: POST, so it can't collide
// with GET /people/:handle; the events/snapshot once-a-day gates live in
// ../people/sightings.ts.
peopleRouter.post('/people/sightings', async (c) => {
  const raw = await c.req.json().catch(() => null);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return c.json({ error: 'invalid_body' }, 400);
  }
  const body = raw as Record<string, unknown>;

  if (!Array.isArray(body.sightings) || body.sightings.length === 0) {
    return c.json({ error: 'invalid_sightings' }, 400);
  }
  if (body.sightings.length > MAX_SIGHTINGS_PER_BATCH) {
    return c.json({ error: 'too_many_sightings', max: MAX_SIGHTINGS_PER_BATCH }, 400);
  }

  const inputs: PersonSightingInput[] = [];
  for (let i = 0; i < body.sightings.length; i++) {
    const s = body.sightings[i];
    if (!s || typeof s !== 'object' || Array.isArray(s)) {
      return c.json({ error: `invalid_sighting_${i}` }, 400);
    }
    const r = s as Record<string, unknown>;
    if (typeof r.handle !== 'string') return c.json({ error: `invalid_sighting_handle_${i}` }, 400);
    const seenAt = typeof r.seenAt === 'string' ? new Date(r.seenAt) : null;
    if (!seenAt || Number.isNaN(seenAt.getTime())) {
      return c.json({ error: `invalid_sighting_seen_at_${i}` }, 400);
    }
    const card = parseHoverCard(r.card);
    if (card === null) return c.json({ error: `invalid_sighting_card_${i}` }, 400);
    inputs.push({ handle: r.handle, card, seenAt });
  }

  const result = await recordSightings(inputs);
  return c.json(result);
});

function parseHoverCard(value: unknown): HoverCard | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const r = value as Record<string, unknown>;
  const str = (v: unknown): string | null | undefined =>
    v === undefined || v === null ? null : typeof v === 'string' ? v : undefined;
  const num = (v: unknown): number | null | undefined =>
    v === undefined || v === null
      ? null
      : typeof v === 'number' && Number.isFinite(v) && v >= 0
        ? Math.floor(v)
        : undefined;

  const displayName = str(r.displayName);
  const bio = str(r.bio);
  const xUserId = str(r.xUserId);
  const followersCount = num(r.followersCount);
  const followingCount = num(r.followingCount);
  if (
    displayName === undefined ||
    bio === undefined ||
    xUserId === undefined ||
    followersCount === undefined ||
    followingCount === undefined
  ) {
    return null;
  }
  return { displayName, bio, followersCount, followingCount, xUserId };
}

// ----------------------------------------------------------- manual events

peopleRouter.post('/people/:handle/events', async (c) => {
  const handle = normalizePersonHandle(c.req.param('handle'));
  if (!handle) return c.json({ error: 'invalid_handle' }, 400);

  const raw = await c.req.json().catch(() => null);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return c.json({ error: 'invalid_body' }, 400);
  }
  const body = raw as Record<string, unknown>;

  const type = body.type;
  if (type !== 'note' && type !== 'manual_dm_logged') {
    return c.json({ error: 'invalid_type', allowed: MANUAL_EVENT_TYPES }, 400);
  }

  if (
    typeof body.summary !== 'string' ||
    body.summary.trim() === '' ||
    body.summary.length > MAX_SUMMARY_LEN
  ) {
    return c.json({ error: 'invalid_summary' }, 400);
  }

  let at = new Date();
  if (body.at !== undefined && body.at !== null) {
    if (typeof body.at !== 'string' || Number.isNaN(new Date(body.at).getTime())) {
      return c.json({ error: 'invalid_at' }, 400);
    }
    at = new Date(body.at);
  }

  // Manual logging may introduce a person the machine never met — that's the
  // manual-add path (source 'manual').
  await upsertPerson(handle, { source: 'manual' });

  const id = crypto.randomUUID();
  const summary = body.summary.trim();
  await db.insert(personEvents).values({ id, handle, type, summary, at });

  // Manual types never advance a stage, but the watermarks should move.
  await recomputePerson(handle, new Date());

  const [person] = await db.select().from(people).where(eq(people.handle, handle));
  const [event] = await db.select().from(personEvents).where(eq(personEvents.id, id));
  return c.json({ person, event }, 201);
});

// ------------------------------------------------------- icebreakers (C9)

// "Suggest an opener": one Grok call (~$0.005) grounded STRICTLY on real
// shared context. Order matters for $0 paths: unknown person → 404 and no
// shared context → 422 are decided BEFORE the XAI_API_KEY check, so smoke
// tests and thin dossiers never risk a Grok call.
peopleRouter.post('/people/:handle/icebreakers', async (c) => {
  const handle = normalizePersonHandle(c.req.param('handle'));
  if (!handle) return c.json({ error: 'invalid_handle' }, 400);

  const [person] = await db.select().from(people).where(eq(people.handle, handle));
  if (!person) return c.json({ error: 'not_found' }, 404);

  const [voiceAuthor] = await db
    .select({ bio: voiceAuthors.bio, displayName: voiceAuthors.displayName })
    .from(voiceAuthors)
    .where(eq(voiceAuthors.handle, handle));

  const [exchangeRows, savedTweets, channelRows] = await Promise.all([
    db
      .select({ type: personEvents.type, at: personEvents.at, summary: personEvents.summary })
      .from(personEvents)
      .where(
        and(
          eq(personEvents.handle, handle),
          isNotNull(personEvents.summary),
          inArray(personEvents.type, [...INBOUND_TYPES, ...OUTBOUND_TYPES]),
        ),
      )
      .orderBy(desc(personEvents.at))
      .limit(MAX_GROUNDING_EXCHANGES),
    db
      .select({ text: voiceTweets.text, createdAt: voiceTweets.createdAt, tags: voiceTweets.tags })
      .from(voiceTweets)
      .where(and(eq(voiceTweets.authorHandle, handle), eq(voiceTweets.retired, false)))
      .orderBy(desc(voiceTweets.createdAt))
      .limit(MAX_GROUNDING_TWEETS),
    db.select({ slug: channels.slug }).from(channels).where(eq(channels.active, true)),
  ]);

  const channelSlugs = new Set(channelRows.map((r) => r.slug));
  const theirTags = new Set<string>(person.tags ?? []);
  for (const t of savedTweets) for (const tag of t.tags ?? []) theirTags.add(tag);
  const sharedChannels = [...theirTags].filter((t) => channelSlugs.has(t));

  const grounding = renderIcebreakerGrounding(
    {
      handle,
      displayName: person.displayName ?? voiceAuthor?.displayName ?? null,
      stage: person.stage as Stage,
      bio: person.bio ?? voiceAuthor?.bio ?? null,
      notes: person.notes,
      exchanges: exchangeRows.map((e) => ({
        direction: (INBOUND_TYPES as readonly string[]).includes(e.type)
          ? ('inbound' as const)
          : ('outbound' as const),
        at: e.at,
        summary: e.summary as string,
      })),
      savedTweets: savedTweets.map((t) => ({ text: t.text, createdAt: t.createdAt })),
      sharedChannels,
    },
    new Date(),
  );
  if (grounding === null) return c.json({ error: 'no_shared_context' }, 422);

  if (!process.env.XAI_API_KEY) return c.json({ error: 'grok_not_configured' }, 503);

  let result: Awaited<ReturnType<typeof askGrok>>;
  try {
    result = await askGrok({
      messages: buildIcebreakerInput(grounding),
      reasoningEffort: 'low',
      maxOutputTokens: 400,
      temperature: 0.7,
      jsonSchema: { name: 'icebreakers', schema: ICEBREAKER_SCHEMA },
      promptCacheKey: 'stratus-icebreaker',
    });
  } catch (err) {
    if (err instanceof GrokApiError) {
      return c.json(
        {
          error: 'grok_upstream_error',
          status: err.status,
          message: err.message,
          requestId: err.requestId,
        },
        err.status === 429 ? 429 : 502,
      );
    }
    const detail = err instanceof Error ? err.message : String(err);
    console.error('/x/people/:handle/icebreakers failed:', detail);
    return c.json({ error: 'icebreakers_failed', detail }, 502);
  }

  const icebreakers = parseIcebreakers(result.text);
  if (!icebreakers) return c.json({ error: 'grok_parse_error', requestId: result.requestId }, 502);

  // The grounding rides back so the panel can show exactly what the openers
  // were allowed to know — trust through transparency, nothing persisted.
  return c.json({
    handle,
    icebreakers,
    grounding,
    model: result.model,
    costUsd: result.costUsd,
    requestId: result.requestId,
  });
});

// ---------------------------------------------------------------- helpers

function isSort(v: unknown): v is PeopleSort {
  return typeof v === 'string' && (SORTS as readonly string[]).includes(v);
}
