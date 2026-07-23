// Notification-surface engagement harvest (CIRCLES-PLAN C10): likes, reposts
// and follows scraped from x.com/notifications cells. They are the only
// relationship signals the system never saw, and they are free in that tab's
// DOM. Each engagement upserts the person (fill-only — a notification glimpse
// never clobbers enriched data) and logs a timeline event under a
// DETERMINISTIC id so re-scrolling the same page can never double-log:
//   their_like:notif:<handle>:<tweetId>      when the target post resolves
//   their_like:notif:<handle>:<YYYY-MM-DD>   when it doesn't (day bucket —
//                                            bounded re-log, never a flood)
//   their_follow:notif:<handle>              a follow logs once, ever
//
// Stage effect: NONE, by design (plan decision 1). The three types are in
// PERSON_EVENT_TYPES but in no stage set, so a person with 50 likes is still a
// stranger — stages keep meaning "we actually talked". Only the seen watermark
// moves.

import { desc } from 'drizzle-orm';
import { db } from '../../db/client.ts';
import { personEvents, postsPublished } from '../db/schema.ts';
import { normalizePersonHandle, recomputePerson, snippet, upsertPerson } from './store.ts';

export const MAX_ENGAGEMENTS_PER_BATCH = 50;

/** How many recent own posts a snippet is matched against. */
const TARGET_POST_WINDOW = 300;

/** Notification snippets are truncated, so the match is a prefix match — below
 *  this many characters a prefix is not evidence of anything. */
const MIN_TARGET_SNIPPET_CHARS = 20;

/** What crosses the wire. The parser's `'other'` kind is dropped client-side
 *  and is deliberately not representable here. */
export type EngagementKind = 'like' | 'repost' | 'follow';

export const ENGAGEMENT_EVENT_TYPE = {
  like: 'their_like',
  repost: 'their_repost',
  follow: 'their_follow',
} as const;

export interface EngagementInput {
  kind: EngagementKind;
  handle: string;
  /** The engaged post's visible text, truncated by X. Always null for a follow
   *  (the parser forces it — a new follower's bio is not a post). */
  targetText: string | null;
  seenAt: Date;
}

export interface EngagementResult {
  received: number;
  processed: number;
  skipped: number;
  events: number;
}

export interface OwnPost {
  tweetId: string;
  text: string;
}

function collapse(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

// Pure — exported for unit tests. One row per (kind, handle, target) survives a
// batch: the freshest wins. Two likes by the same person on different posts are
// two engagements, not one.
export function dedupeEngagements(inputs: EngagementInput[]): EngagementInput[] {
  const byKey = new Map<string, EngagementInput>();
  for (const e of inputs) {
    const key = `${e.kind}:${e.handle}:${e.targetText ?? ''}`;
    const prev = byKey.get(key);
    if (!prev || e.seenAt >= prev.seenAt) byKey.set(key, e);
  }
  return [...byKey.values()];
}

export function engagementEventId(
  kind: EngagementKind,
  handle: string,
  targetTweetId: string | null,
  seenAt: Date,
): string {
  const type = ENGAGEMENT_EVENT_TYPE[kind];
  if (kind === 'follow') return `${type}:notif:${handle}`;
  if (targetTweetId) return `${type}:notif:${handle}:${targetTweetId}`;
  return `${type}:notif:${handle}:${seenAt.toISOString().slice(0, 10)}`;
}

export function engagementSummary(kind: EngagementKind, targetText: string | null): string {
  if (kind === 'follow') return 'followed you';
  const verb = kind === 'like' ? 'liked' : 'reposted';
  return targetText ? `${verb}: "${snippet(targetText)}"` : `${verb} a post`;
}

/** Pure prefix match of a scraped snippet against own posts (newest first, so
 *  the freshest match wins). Whitespace is collapsed on both sides — the DOM
 *  renders a multi-line post as one run of text. */
export function matchTargetTweetId(targetText: string | null, posts: OwnPost[]): string | null {
  if (!targetText) return null;
  const needle = collapse(targetText);
  if (needle.length < MIN_TARGET_SNIPPET_CHARS) return null;
  for (const p of posts) {
    if (collapse(p.text).startsWith(needle)) return p.tweetId;
  }
  return null;
}

async function loadRecentOwnPosts(limit = TARGET_POST_WINDOW): Promise<OwnPost[]> {
  return db
    .select({ tweetId: postsPublished.tweetId, text: postsPublished.text })
    .from(postsPublished)
    .orderBy(desc(postsPublished.postedAt))
    .limit(limit);
}

/** Single-shot resolve (tests, one-off callers). `recordEngagements` loads the
 *  post window once per batch instead of calling this per row. */
export async function resolveTargetTweetId(targetText: string | null): Promise<string | null> {
  if (!targetText || collapse(targetText).length < MIN_TARGET_SNIPPET_CHARS) return null;
  return matchTargetTweetId(targetText, await loadRecentOwnPosts());
}

export async function recordEngagements(inputs: EngagementInput[]): Promise<EngagementResult> {
  const result: EngagementResult = {
    received: inputs.length,
    processed: 0,
    skipped: 0,
    events: 0,
  };

  const valid: EngagementInput[] = [];
  for (const e of inputs) {
    const handle = normalizePersonHandle(e.handle);
    if (!handle) {
      result.skipped++;
      continue;
    }
    valid.push({ ...e, handle });
  }

  // Loaded at most once per batch, and not at all when nothing needs matching
  // (a follow-only batch does zero target SQL).
  let posts: OwnPost[] | null = null;
  const touched = new Map<string, Date>();

  for (const e of dedupeEngagements(valid)) {
    await upsertPerson(e.handle, { source: 'notification', now: e.seenAt });
    result.processed++;

    let targetTweetId: string | null = null;
    if (e.kind !== 'follow' && e.targetText) {
      posts ??= await loadRecentOwnPosts();
      targetTweetId = matchTargetTweetId(e.targetText, posts);
    }

    const inserted = await db
      .insert(personEvents)
      .values({
        id: engagementEventId(e.kind, e.handle, targetTweetId, e.seenAt),
        handle: e.handle,
        type: ENGAGEMENT_EVENT_TYPE[e.kind],
        // The deterministic id already encodes the ref (hoverSightingEventId
        // set the precedent); a ref pair would add nothing.
        refTable: null,
        refId: null,
        summary: engagementSummary(e.kind, e.targetText),
        at: e.seenAt,
      })
      .onConflictDoNothing()
      .returning({ id: personEvents.id });
    result.events += inserted.length;

    const prev = touched.get(e.handle);
    if (!prev || e.seenAt > prev) touched.set(e.handle, e.seenAt);
  }

  // Watermarks only. Once per handle rather than per row: recomputePerson
  // reloads the whole event history anyway, and since these types are in no
  // stage set the ratchet (maxStage) leaves the stage exactly where it was.
  for (const [handle, seenAt] of touched) {
    await recomputePerson(handle, seenAt);
  }

  return result;
}
