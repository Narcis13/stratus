// Channels (CIRCLES-PLAN C8) — topic rooms over everything. A channel is tags
// + a saved view, never a schema fork: the aggregate below is pure SQL over
// rows other surfaces already collected, so a channel that doesn't earn its
// keep deletes cleanly (tags on rows are harmless orphan strings). Mounted
// under `/x` by `mountX` in ../index.ts — always mounted, every route is $0.
//
// Routes:
//   GET    /channels          ?active=true|false — list (sortOrder asc)
//   POST   /channels          { slug, label, color?, pillar?, keywords?, sortOrder?, active? }
//   GET    /channels/:slug    the room: tagged people/voice tweets/ideas/radar
//                             drafts + own posts in the mapped pillar with
//                             measured outcomes
//   PATCH  /channels/:slug    partial update
//   DELETE /channels/:slug

import {
  type AnyColumn,
  type SQL,
  and,
  asc,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  or,
  sql,
} from 'drizzle-orm';
import { Hono } from 'hono';
import { db } from '../../db/client.ts';
import {
  channels,
  ideas,
  metricsSnapshots,
  people,
  postsPublished,
  radarDrafts,
  scheduledPosts,
  voiceAuthors,
  voiceTweets,
} from '../db/schema.ts';
import { loadActiveNicheSafe } from '../niche/store.ts';

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;
const MAX_LABEL_LEN = 60;
const MAX_COLOR_LEN = 20;
const MAX_KEYWORDS = 50;
const MAX_KEYWORD_LEN = 60;
const MAX_SECTION_ROWS = 50;
const MAX_RADAR_ROWS = 20;

export const channelsRouter = new Hono();

// ------------------------------------------------------------------- list

channelsRouter.get('/channels', async (c) => {
  const activeParam = c.req.query('active');
  if (activeParam !== undefined && activeParam !== 'true' && activeParam !== 'false') {
    return c.json({ error: 'invalid_active' }, 400);
  }
  const order = [asc(channels.sortOrder), asc(channels.slug)] as const;
  // N0.6: scope to the active niche (or NULL legacy rows) — a channel of another
  // niche never appears while it isn't active. Identity until a second niche.
  const nicheScope = ownedByNiche(loadActiveNicheSafe().slug);
  const rows =
    activeParam === undefined
      ? await db
          .select()
          .from(channels)
          .where(nicheScope)
          .orderBy(...order)
      : await db
          .select()
          .from(channels)
          .where(and(eq(channels.active, activeParam === 'true'), nicheScope))
          .orderBy(...order);
  return c.json(rows);
});

// ----------------------------------------------------------------- create

channelsRouter.post('/channels', async (c) => {
  const raw = await c.req.json().catch(() => null);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return c.json({ error: 'invalid_body' }, 400);
  }
  const b = raw as Record<string, unknown>;

  const slug = typeof b.slug === 'string' ? b.slug.trim().toLowerCase() : '';
  if (!SLUG_RE.test(slug)) return c.json({ error: 'invalid_slug' }, 400);
  const label = typeof b.label === 'string' ? b.label.trim() : '';
  if (label === '' || label.length > MAX_LABEL_LEN) return c.json({ error: 'invalid_label' }, 400);

  const color = parseColor(b.color);
  if (color === 'invalid') return c.json({ error: 'invalid_color' }, 400);
  const pillar = parsePillarLink(b.pillar);
  if (pillar === 'invalid') return c.json({ error: 'invalid_pillar' }, 400);
  const keywords = parseKeywords(b.keywords);
  if (keywords === 'invalid') return c.json({ error: 'invalid_keywords' }, 400);
  const sortOrder =
    b.sortOrder === undefined
      ? 0
      : typeof b.sortOrder === 'number' && Number.isInteger(b.sortOrder)
        ? b.sortOrder
        : null;
  if (sortOrder === null) return c.json({ error: 'invalid_sort_order' }, 400);
  const active = b.active === undefined ? true : b.active;
  if (typeof active !== 'boolean') return c.json({ error: 'invalid_active' }, 400);

  const existing = await db
    .select({ slug: channels.slug })
    .from(channels)
    .where(eq(channels.slug, slug));
  if (existing.length > 0) return c.json({ error: 'slug_exists' }, 409);

  // N0.6: stamp the owning niche so the channel joins the active niche's set.
  const niche = loadActiveNicheSafe().slug;
  const [row] = await db
    .insert(channels)
    .values({ slug, label, color, pillar, keywords, sortOrder, active, niche })
    .returning();
  return c.json(row, 201);
});

// -------------------------------------------------------------- aggregate

channelsRouter.get('/channels/:slug', async (c) => {
  const slug = c.req.param('slug').trim().toLowerCase();
  if (!SLUG_RE.test(slug)) return c.json({ error: 'invalid_slug' }, 400);

  const [channel] = await db.select().from(channels).where(eq(channels.slug, slug));
  // N0.6: the room is invisible from another niche — a slug that belongs to a
  // non-active niche reads as not-found (NULL-niche legacy rows stay visible).
  const activeSlug = loadActiveNicheSafe().slug;
  if (!channel || (channel.niche !== activeSlug && channel.niche !== null)) {
    return c.json({ error: 'not_found' }, 404);
  }

  const [taggedPeople, taggedVoiceTweets, taggedIdeas, taggedRadarDrafts] = await Promise.all([
    db
      .select({
        handle: people.handle,
        displayName: people.displayName,
        stage: people.stage,
        followersCount: people.followersCount,
        lastInboundAt: people.lastInboundAt,
        lastOutboundAt: people.lastOutboundAt,
        tags: people.tags,
      })
      .from(people)
      .where(and(eq(people.retired, false), tagged(people.tags, slug)))
      .orderBy(desc(people.lastSeenAt), asc(people.handle))
      .limit(MAX_SECTION_ROWS),
    db
      .select({
        tweetId: voiceTweets.tweetId,
        authorHandle: voiceTweets.authorHandle,
        authorDisplayName: voiceAuthors.displayName,
        text: voiceTweets.text,
        url: voiceTweets.url,
        createdAt: voiceTweets.createdAt,
        savedAt: voiceTweets.savedAt,
        hookType: voiceTweets.hookType,
        tags: voiceTweets.tags,
      })
      .from(voiceTweets)
      .innerJoin(voiceAuthors, eq(voiceAuthors.handle, voiceTweets.authorHandle))
      .where(and(eq(voiceTweets.retired, false), tagged(voiceTweets.tags, slug)))
      .orderBy(desc(voiceTweets.savedAt))
      .limit(MAX_SECTION_ROWS),
    db
      .select()
      .from(ideas)
      .where(and(eq(ideas.status, 'open'), tagged(ideas.tags, slug)))
      .orderBy(desc(ideas.createdAt))
      .limit(MAX_SECTION_ROWS),
    db
      .select({
        tweetId: radarDrafts.tweetId,
        url: radarDrafts.url,
        handle: radarDrafts.handle,
        author: radarDrafts.author,
        snippet: radarDrafts.snippet,
        band: radarDrafts.band,
        replyText: radarDrafts.replyText,
        angle: radarDrafts.angle,
        status: radarDrafts.status,
        draftedAt: radarDrafts.draftedAt,
        tags: radarDrafts.tags,
      })
      .from(radarDrafts)
      .where(tagged(radarDrafts.tags, slug))
      .orderBy(desc(radarDrafts.draftedAt))
      .limit(MAX_RADAR_ROWS),
  ]);

  const posts = channel.pillar ? await pillarPosts(channel.pillar) : null;

  return c.json({
    channel,
    people: taggedPeople,
    voiceTweets: taggedVoiceTweets,
    ideas: taggedIdeas,
    radarDrafts: taggedRadarDrafts,
    posts,
  });
});

// ------------------------------------------------------------------ patch

channelsRouter.patch('/channels/:slug', async (c) => {
  const slug = c.req.param('slug').trim().toLowerCase();
  if (!SLUG_RE.test(slug)) return c.json({ error: 'invalid_slug' }, 400);

  const raw = await c.req.json().catch(() => null);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return c.json({ error: 'invalid_body' }, 400);
  }
  const b = raw as Record<string, unknown>;

  const patch: Partial<typeof channels.$inferInsert> = {};
  if (b.label !== undefined) {
    if (typeof b.label !== 'string' || b.label.trim() === '' || b.label.length > MAX_LABEL_LEN) {
      return c.json({ error: 'invalid_label' }, 400);
    }
    patch.label = b.label.trim();
  }
  if (b.color !== undefined) {
    const color = parseColor(b.color);
    if (color === 'invalid') return c.json({ error: 'invalid_color' }, 400);
    patch.color = color;
  }
  if (b.pillar !== undefined) {
    const pillar = parsePillarLink(b.pillar);
    if (pillar === 'invalid') return c.json({ error: 'invalid_pillar' }, 400);
    patch.pillar = pillar;
  }
  if (b.keywords !== undefined) {
    const keywords = parseKeywords(b.keywords);
    if (keywords === 'invalid') return c.json({ error: 'invalid_keywords' }, 400);
    patch.keywords = keywords;
  }
  if (b.sortOrder !== undefined) {
    if (typeof b.sortOrder !== 'number' || !Number.isInteger(b.sortOrder)) {
      return c.json({ error: 'invalid_sort_order' }, 400);
    }
    patch.sortOrder = b.sortOrder;
  }
  if (b.active !== undefined) {
    if (typeof b.active !== 'boolean') return c.json({ error: 'invalid_active' }, 400);
    patch.active = b.active;
  }
  if (Object.keys(patch).length === 0) return c.json({ error: 'empty_patch' }, 400);

  patch.updatedAt = new Date();
  const [row] = await db.update(channels).set(patch).where(eq(channels.slug, slug)).returning();
  if (!row) return c.json({ error: 'not_found' }, 404);
  return c.json(row);
});

// ----------------------------------------------------------------- delete

channelsRouter.delete('/channels/:slug', async (c) => {
  const slug = c.req.param('slug').trim().toLowerCase();
  if (!SLUG_RE.test(slug)) return c.json({ error: 'invalid_slug' }, 400);
  const deleted = await db
    .delete(channels)
    .where(eq(channels.slug, slug))
    .returning({ slug: channels.slug });
  if (deleted.length === 0) return c.json({ error: 'not_found' }, 404);
  // Tags on people/ideas/voice_tweets/radar_drafts stay behind as harmless
  // strings — deliberately shallow, nothing cascades.
  return c.json({ deleted: slug });
});

// ---------------------------------------------------------------- helpers

// SQLite JSON containment: the tags column holds a JSON string[] of slugs.
function tagged(col: AnyColumn, slug: string): SQL {
  return sql`exists (select 1 from json_each(${col}) where json_each.value = ${slug})`;
}

// N0.6: a channel is owned by the active niche when its stamp matches — or is
// NULL (legacy rows pre-dating the niche column). Identity until a second niche
// exists (the N0.1 migration backfills every row to `builder`).
function ownedByNiche(slug: string): SQL | undefined {
  return or(eq(channels.niche, slug), isNull(channels.niche));
}

// Own posts in the channel's mapped pillar, with the latest measured snapshot
// per tweet — same first-row-wins read as buildReplyOutcomes / listPerformance.
async function pillarPosts(pillar: string) {
  const rows = await db
    .select({
      id: scheduledPosts.id,
      text: scheduledPosts.text,
      register: scheduledPosts.register,
      postedTweetId: scheduledPosts.postedTweetId,
    })
    .from(scheduledPosts)
    .where(
      and(
        eq(scheduledPosts.pillar, pillar),
        eq(scheduledPosts.status, 'posted'),
        isNotNull(scheduledPosts.postedTweetId),
      ),
    )
    .orderBy(desc(scheduledPosts.updatedAt))
    .limit(MAX_SECTION_ROWS);

  const ids = rows.flatMap((r) => (r.postedTweetId ? [r.postedTweetId] : []));
  const [pubs, snaps] = ids.length
    ? await Promise.all([
        db
          .select({ tweetId: postsPublished.tweetId, postedAt: postsPublished.postedAt })
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

  const postedAtById = new Map(pubs.map((p) => [p.tweetId, p.postedAt]));
  const latestSnap = new Map<string, (typeof snaps)[number]>();
  for (const s of snaps) if (!latestSnap.has(s.tweetId)) latestSnap.set(s.tweetId, s);

  const items = rows.map((r) => {
    const snap = r.postedTweetId ? latestSnap.get(r.postedTweetId) : undefined;
    const pub = (snap?.publicMetrics ?? null) as Record<string, number> | null;
    const priv = (snap?.nonPublicMetrics ?? null) as Record<string, number> | null;
    return {
      scheduledPostId: r.id,
      text: r.text,
      register: r.register,
      postedTweetId: r.postedTweetId,
      postedAt: r.postedTweetId ? (postedAtById.get(r.postedTweetId) ?? null) : null,
      outcome: snap
        ? {
            views: pub?.impression_count ?? priv?.impression_count ?? null,
            likes: pub?.like_count ?? null,
            replies: pub?.reply_count ?? null,
            retweets: pub?.retweet_count ?? null,
            bookmarks: pub?.bookmark_count ?? null,
            profileVisits: priv?.user_profile_clicks ?? null,
          }
        : null,
    };
  });

  const measured = items.filter((i) => i.outcome !== null);
  const views = measured
    .map((i) => i.outcome?.views)
    .filter((v): v is number => typeof v === 'number');
  const profileVisits = measured
    .map((i) => i.outcome?.profileVisits)
    .filter((v): v is number => typeof v === 'number');

  return {
    pillar,
    count: items.length,
    measured: measured.length,
    medianViews: median(views),
    medianProfileVisits: median(profileVisits),
    items,
  };
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const m =
    sorted.length % 2 === 1 ? sorted[mid] : ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
  return m ?? null;
}

// Tag arrays on voice_tweets / radar_drafts rows (same loose rule as ideas'
// tags: trimmed, deduped, ≤40 chars — a tag is a channel slug by convention
// but never FK-enforced). Exported for the tag-write PATCHes in voice/radar.
export function parseChannelTags(value: unknown): string[] | null | 'invalid' {
  if (value === null) return null;
  if (!Array.isArray(value) || value.length > 25) return 'invalid';
  const tags: string[] = [];
  for (const t of value) {
    if (typeof t !== 'string') return 'invalid';
    const trimmed = t.trim().toLowerCase();
    if (trimmed === '' || trimmed.length > 40) return 'invalid';
    if (!tags.includes(trimmed)) tags.push(trimmed);
  }
  return tags;
}

function parseColor(value: unknown): string | null | 'invalid' {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') return 'invalid';
  const trimmed = value.trim();
  if (trimmed === '') return null;
  if (trimmed.length > MAX_COLOR_LEN) return 'invalid';
  return trimmed;
}

// The pillar link is a plain slug string, deliberately NOT FK-validated against
// content_pillars — pillar metrics group by arbitrary strings everywhere else,
// and a channel pointing at a renamed pillar should degrade to zero posts, not
// break the room.
function parsePillarLink(value: unknown): string | null | 'invalid' {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') return 'invalid';
  const trimmed = value.trim().toLowerCase();
  if (trimmed === '') return null;
  if (!SLUG_RE.test(trimmed)) return 'invalid';
  return trimmed;
}

function parseKeywords(value: unknown): string[] | null | 'invalid' {
  if (value === undefined || value === null) return null;
  if (!Array.isArray(value) || value.length > MAX_KEYWORDS) return 'invalid';
  const out: string[] = [];
  for (const k of value) {
    if (typeof k !== 'string') return 'invalid';
    const trimmed = k.trim();
    if (trimmed === '' || trimmed.length > MAX_KEYWORD_LEN) return 'invalid';
    if (!out.includes(trimmed)) out.push(trimmed);
  }
  return out.length > 0 ? out : null;
}
