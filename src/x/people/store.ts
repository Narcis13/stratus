// People-layer writes (CIRCLES-PLAN C1): person upserts + append-only event
// logging with a stage recompute after every insert. This is the ONE place
// people/person_events rows are written — routes, live hooks (mentions pull,
// reply posted, voice scrape/enrich, harvest ingest) and the backfill script
// all come through here, so idempotency and the stage ratchet live in one spot.

import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { db } from '../../db/client.ts';
import {
  metricsSnapshots,
  people,
  personEvents,
  postsPublished,
  replyDrafts,
} from '../db/schema.ts';
import type { ReplyVariant } from '../replies/prompt.ts';
import { getSetting } from '../settings/registry.ts';
import { buildAngleCrosstab } from './angles.ts';
import {
  type ExchangeSummary,
  type RelationshipFacts,
  pickAnglePreference,
} from './relationship.ts';
import {
  INBOUND_TYPES,
  OUTBOUND_TYPES,
  type PersonEventType,
  type Stage,
  type StageEvent,
  type StageThresholds,
  computeStage,
  maxStage,
} from './stage.ts';

// The stage thresholds are read from the settings store here — not threaded from
// the routes — because recomputePerson runs from every ingest path (mentions,
// harvest, engagements, PATCH), and a knob honored only in one route would let
// the others advance a stage on the default ladder. getSetting is a sync,
// Map-cached read; the ratchet never demotes, so overrides only touch future
// advances (Decision 6: this module is impure DB access, not a pure fn).
function stageThresholds(): StageThresholds {
  return {
    mutualExchangeDays: getSetting<number>('x.people.mutualExchangeDays'),
    allyExchangeDays: getSetting<number>('x.people.allyExchangeDays'),
    allyWindowDays: getSetting<number>('x.people.allyWindowDays'),
  };
}

const USERNAME_RE = /^[A-Za-z0-9_]{1,15}$/;

export function normalizePersonHandle(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const h = value.trim().replace(/^@/, '').toLowerCase();
  return USERNAME_RE.test(h) ? h : null;
}

/** One-line summaries stay one line: collapse whitespace, cap length. */
export function snippet(text: string, max = 120): string {
  const collapsed = text.replace(/\s+/g, ' ').trim();
  return collapsed.length <= max ? collapsed : `${collapsed.slice(0, max - 1)}…`;
}

export interface PersonEventInput {
  /** Normalized lowercase handle (see normalizePersonHandle). */
  handle: string;
  type: PersonEventType;
  refTable?: string;
  refId?: string;
  summary?: string;
  at: Date;
  /** Explicit id override (manual events that need a known id). */
  id?: string;
}

// Deterministic when a ref exists so backfill + live hooks INSERT OR IGNORE
// into the same id space and the same underlying row never double-logs.
export function personEventId(e: PersonEventInput): string {
  if (e.id) return e.id;
  return e.refTable && e.refId ? `${e.type}:${e.refTable}:${e.refId}` : crypto.randomUUID();
}

export interface PersonFields {
  xUserId?: string | null;
  displayName?: string | null;
  bio?: string | null;
  followersCount?: number | null;
  followingCount?: number | null;
}

/** Create-or-fill a person row. Fill-only by default (a hover-card guess never
 *  clobbers enriched data); `overwrite: true` for authoritative sources like a
 *  full profile scrape. Null/undefined field values mean "nothing to offer". */
export async function upsertPerson(
  handle: string,
  opts: { source: string; fields?: PersonFields; overwrite?: boolean; now?: Date } = {
    source: 'manual',
  },
): Promise<void> {
  const now = opts.now ?? new Date();
  const fields = opts.fields ?? {};
  const [existing] = await db.select().from(people).where(eq(people.handle, handle));

  if (!existing) {
    await db
      .insert(people)
      .values({
        handle,
        source: opts.source,
        xUserId: fields.xUserId ?? null,
        displayName: fields.displayName ?? null,
        bio: fields.bio ?? null,
        followersCount: fields.followersCount ?? null,
        followingCount: fields.followingCount ?? null,
        firstSeenAt: now,
        lastSeenAt: now,
      })
      .onConflictDoNothing();
    return;
  }

  const set: Partial<typeof people.$inferInsert> = {};
  for (const k of ['xUserId', 'displayName', 'bio', 'followersCount', 'followingCount'] as const) {
    const v = fields[k];
    if (v === undefined || v === null) continue;
    if (opts.overwrite || existing[k] === null) set[k] = v as never;
  }
  if (Object.keys(set).length === 0) return;
  await db.update(people).set(set).where(eq(people.handle, handle));
}

/** Append events (INSERT OR IGNORE on deterministic ids), then recompute the
 *  stage and the seen/inbound/outbound watermarks per touched handle. Creates
 *  stub person rows for handles never seen before (`source` labels those). */
export async function logPersonEvents(
  inputs: PersonEventInput[],
  opts: { source?: string; now?: Date } = {},
): Promise<void> {
  if (inputs.length === 0) return;
  const now = opts.now ?? new Date();

  const byHandle = new Map<string, PersonEventInput[]>();
  for (const e of inputs) {
    const list = byHandle.get(e.handle) ?? [];
    list.push(e);
    byHandle.set(e.handle, list);
  }

  for (const [handle, events] of byHandle) {
    await upsertPerson(handle, { source: opts.source ?? 'manual', now });

    await db
      .insert(personEvents)
      .values(
        events.map((e) => ({
          id: personEventId(e),
          handle,
          type: e.type,
          refTable: e.refTable ?? null,
          refId: e.refId ?? null,
          summary: e.summary ?? null,
          at: e.at,
        })),
      )
      .onConflictDoNothing();

    await recomputePerson(handle, now);
  }
}

/** Live-hook wrapper: person bookkeeping must never fail the path that pays
 *  for it (a mention pull, a harvest ingest, a PATCH). Same discipline as
 *  persistRadarDrafts. */
export async function safeLogPersonEvents(
  inputs: PersonEventInput[],
  opts: { source?: string; now?: Date } = {},
): Promise<void> {
  try {
    await logPersonEvents(inputs, opts);
  } catch (err) {
    console.error(
      'people: event log failed (primary path unaffected):',
      err instanceof Error ? err.message : err,
    );
  }
}

/** Reload the full event history, ratchet the stage (auto never demotes) and
 *  refresh first/last-seen + inbound/outbound watermarks. Cheap — events per
 *  person are few. */
export async function recomputePerson(handle: string, now: Date): Promise<void> {
  const rows = await db
    .select({ type: personEvents.type, at: personEvents.at })
    .from(personEvents)
    .where(eq(personEvents.handle, handle))
    .orderBy(asc(personEvents.at));
  if (rows.length === 0) return;

  const events = rows as StageEvent[];
  const [person] = await db.select().from(people).where(eq(people.handle, handle));
  if (!person) return;

  const current = person.stage as Stage;
  const next = maxStage(current, computeStage(events, now, stageThresholds()));

  const atMs = events.map((e) => e.at.getTime());
  const firstSeen = Math.min(...atMs, person.firstSeenAt?.getTime() ?? Number.POSITIVE_INFINITY);
  const lastSeen = Math.max(...atMs, person.lastSeenAt?.getTime() ?? 0);
  const lastInbound = events
    .filter((e) => INBOUND_TYPES.includes(e.type))
    .reduce<number | null>((max, e) => Math.max(max ?? 0, e.at.getTime()), null);
  const lastOutbound = events
    .filter((e) => OUTBOUND_TYPES.includes(e.type))
    .reduce<number | null>((max, e) => Math.max(max ?? 0, e.at.getTime()), null);

  await db
    .update(people)
    .set({
      stage: next,
      ...(next !== current ? { stageUpdatedAt: now } : {}),
      firstSeenAt: new Date(firstSeen),
      lastSeenAt: new Date(lastSeen),
      lastInboundAt: lastInbound === null ? person.lastInboundAt : new Date(lastInbound),
      lastOutboundAt: lastOutbound === null ? person.lastOutboundAt : new Date(lastOutbound),
    })
    .where(eq(people.handle, handle));
}

/** Batch stage recompute (backfill). */
export async function recomputePeople(handles: string[], now: Date): Promise<void> {
  for (const h of handles) await recomputePerson(h, now);
}

// ------------------------------------------------- relationship facts (C3)

// Posted drafts per person are few; matches the dossier's scope cap.
const MAX_RELATIONSHIP_DRAFTS = 200;

/** What the reply drafter gets to know about a target (CIRCLES-PLAN C3):
 *  stage + exchange counts, the latest exchange topics, the measured angle
 *  preference (gated at ≥3 measured replies by pickAnglePreference), and the
 *  human-written notes. Null when the person is unknown or has zero events —
 *  the prompt then meets them for the first time, as before. */
export async function loadRelationshipFacts(handle: string): Promise<RelationshipFacts | null> {
  const [person] = await db.select().from(people).where(eq(people.handle, handle));
  if (!person) return null;

  const events = await db
    .select({ type: personEvents.type, at: personEvents.at, summary: personEvents.summary })
    .from(personEvents)
    .where(eq(personEvents.handle, handle))
    .orderBy(desc(personEvents.at));
  if (events.length === 0) return null;

  let inboundCount = 0;
  let outboundCount = 0;
  let lastInbound: ExchangeSummary | null = null;
  let lastOutbound: ExchangeSummary | null = null;
  for (const e of events) {
    const type = e.type as PersonEventType;
    if (INBOUND_TYPES.includes(type)) {
      inboundCount++;
      if (!lastInbound && e.summary) lastInbound = { at: e.at, summary: e.summary };
    } else if (OUTBOUND_TYPES.includes(type)) {
      outboundCount++;
      if (!lastOutbound && e.summary) lastOutbound = { at: e.at, summary: e.summary };
    }
  }

  const anglePreference =
    outboundCount > 0 ? pickAnglePreference(await loadAngleCells(handle)) : null;

  return {
    handle,
    stage: person.stage as Stage,
    eventCount: events.length,
    inboundCount,
    outboundCount,
    lastInbound,
    lastOutbound,
    anglePreference,
    notes: person.notes,
  };
}

// Same join path as the dossier's angle crosstab (routes/people.ts), scoped to
// what the preference pick needs: shipped angle + latest measured snapshot.
async function loadAngleCells(handle: string) {
  const drafts = await db
    .select({
      replyText: replyDrafts.replyText,
      variants: replyDrafts.variants,
      postedTweetId: replyDrafts.postedTweetId,
    })
    .from(replyDrafts)
    .where(
      and(
        sql`lower(${replyDrafts.sourceAuthorUsername}) = ${handle}`,
        eq(replyDrafts.status, 'posted'),
      ),
    )
    .orderBy(desc(replyDrafts.createdAt))
    .limit(MAX_RELATIONSHIP_DRAFTS);

  const ids = drafts.flatMap((d) => (d.postedTweetId ? [d.postedTweetId] : []));
  const snaps = ids.length
    ? await db
        .select({
          tweetId: metricsSnapshots.tweetId,
          publicMetrics: metricsSnapshots.publicMetrics,
          nonPublicMetrics: metricsSnapshots.nonPublicMetrics,
        })
        .from(metricsSnapshots)
        .where(inArray(metricsSnapshots.tweetId, ids))
        .orderBy(desc(metricsSnapshots.snapshotAt))
    : [];
  const latest = new Map<string, (typeof snaps)[number]>();
  for (const s of snaps) if (!latest.has(s.tweetId)) latest.set(s.tweetId, s);

  return buildAngleCrosstab(
    drafts.map((d) => {
      const variants = d.variants as ReplyVariant[] | null;
      const snap = d.postedTweetId ? latest.get(d.postedTweetId) : undefined;
      const pub = (snap?.publicMetrics ?? null) as Record<string, number> | null;
      const priv = (snap?.nonPublicMetrics ?? null) as Record<string, number> | null;
      return {
        angle: variants?.find((v) => v.text === d.replyText)?.angle ?? null,
        outcome: snap
          ? {
              views: pub?.impression_count ?? priv?.impression_count ?? null,
              profileVisits: priv?.user_profile_clicks ?? null,
              replies: pub?.reply_count ?? null,
            }
          : null,
      };
    }),
  );
}

/** Which of these tweet ids are my published REPLIES — a mention replying to
 *  one is their_reply_to_me (the 75x chain moment), not a plain mention. */
export async function myReplyTweetIds(candidateIds: string[]): Promise<Set<string>> {
  if (candidateIds.length === 0) return new Set();
  const rows = await db
    .select({ tweetId: postsPublished.tweetId })
    .from(postsPublished)
    .where(and(inArray(postsPublished.tweetId, candidateIds), eq(postsPublished.isReply, true)));
  return new Set(rows.map((r) => r.tweetId));
}
