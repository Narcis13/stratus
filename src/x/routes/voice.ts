// Voice library: a swipe file of other people's tweets, kept for style/format
// reference. Mounted under `/x` by `mountX` in ../index.ts.
//
// This is a pure DOM-scrape store — the extension content script reads the
// tweet (and a best-effort author hover card) straight from x.com and POSTs it
// here. NO X API is touched: every route below is $0. Authors are identified by
// their lowercased @handle (the only stable id scrapeable without the API);
// the numeric x_user_id is filled opportunistically when the page exposes it.
//
// Routes:
//   POST   /voice/scrape              { tweet, author? }   save a tweet (+ stub/enrich its author)
//   PUT    /voice/authors/:handle     { ...profile }       enrich author from their profile page
//   GET    /voice/authors?retired=    list authors + tweet counts
//   GET    /voice/targets                                  the 2–10x reply-target roster (§7.4)
//   GET    /voice/tweets?author=&q=&limit=&retired=        query the stash
//   PATCH  /voice/tweets/:tweetId     { retired?, tags?, addTags? }  archive / channel tags (C8)
//   DELETE /voice/tweets/:tweetId                          hard-remove a tweet
//   PATCH  /voice/authors/:handle     { retired }          archive / unarchive an author
//   DELETE /voice/authors/:handle                          hard-remove an author (409 if it has tweets)

import {
  type SQL,
  and,
  asc,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  lte,
  sql,
} from 'drizzle-orm';
import { Hono } from 'hono';
import { db } from '../../db/client.ts';
import {
  accountSnapshots,
  replyDrafts,
  voiceAuthorSnapshots,
  voiceAuthors,
  voiceTweets,
} from '../db/schema.ts';
import { loadDoctrine } from '../niche/store.ts';
import { safeLogPersonEvents, snippet, upsertPerson } from '../people/store.ts';
import { parseChannelTags } from './channels.ts';

const TWEET_ID_RE = /^\d{1,32}$/;
// Twitter usernames: 1–15 chars, alphanumeric + underscore.
const USERNAME_RE = /^[A-Za-z0-9_]{1,15}$/;
const DEFAULT_LIST_LIMIT = 50;
const MAX_LIST_LIMIT = 200;

export function createVoiceRouter(): Hono {
  const router = new Hono();

  // --------------------------------------------------------------- scrape

  // The content script POSTs DOM-scraped content. The tweet's author always
  // gets a row (a stub from handle + display name if we've never seen them);
  // the optional `author` block carries best-effort hover-card fields (bio,
  // follower/following counts). Re-scraping a known author only *fills* null
  // fields — it never clobbers richer data captured via the profile "Save
  // author" path.
  router.post('/voice/scrape', async (c) => {
    const body = await readJson(c.req.raw);
    if (!body) return c.json({ error: 'invalid_body' }, 400);

    const tweet = parseScrapedTweet(body.tweet);
    if (!tweet) return c.json({ error: 'invalid_tweet' }, 400);

    const hover = body.author === undefined ? null : parseScrapedAuthor(body.author);
    // A malformed author block is non-fatal — we still have the tweet's own
    // handle + display name to anchor the row.

    const now = new Date();

    await fillAuthor(tweet.handle, {
      displayName: hover?.displayName ?? tweet.displayName,
      bio: hover?.bio ?? null,
      followersCount: hover?.followersCount ?? null,
      followingCount: hover?.followingCount ?? null,
      xUserId: hover?.xUserId ?? null,
      profileUrl: `https://x.com/${tweet.handle}`,
    });

    const [saved] = await db
      .insert(voiceTweets)
      .values({
        tweetId: tweet.tweetId,
        authorHandle: tweet.handle,
        text: tweet.text,
        scrapedHtml: tweet.html,
        createdAt: tweet.createdAt ?? now,
        url: tweet.url,
        source: 'extension_scrape',
        savedAt: now,
      })
      .onConflictDoUpdate({
        target: voiceTweets.tweetId,
        // Re-save refreshes the captured text/html (the tweet may have been
        // edited) and stamps updatedAt; createdAt/savedAt stay put.
        set: {
          text: tweet.text,
          scrapedHtml: tweet.html ?? sql`${voiceTweets.scrapedHtml}`,
          url: tweet.url ?? sql`${voiceTweets.url}`,
          updatedAt: now,
        },
      })
      .returning();

    const [author] = await db
      .select()
      .from(voiceAuthors)
      .where(eq(voiceAuthors.handle, tweet.handle));

    // People layer (C1): a saved tweet notices its author. Fill-only person
    // upsert (hover-card grade); the follower series for voice authors stays
    // in voice_author_snapshots. Best-effort, never fails the save.
    await upsertPerson(tweet.handle, {
      source: 'voice',
      fields: {
        displayName: hover?.displayName ?? tweet.displayName,
        bio: hover?.bio ?? null,
        followersCount: hover?.followersCount ?? null,
        followingCount: hover?.followingCount ?? null,
        xUserId: hover?.xUserId ?? null,
      },
    }).catch((err) => console.error('people: voice upsert failed:', err));
    await safeLogPersonEvents(
      [
        {
          handle: tweet.handle,
          type: 'saved_tweet',
          refTable: 'voice_tweets',
          refId: tweet.tweetId,
          summary: `saved their tweet: "${snippet(tweet.text)}"`,
          at: now,
        },
      ],
      { source: 'voice' },
    );

    return c.json({ tweet: saved, author }, 201);
  });

  // --------------------------------------------------------------- enrich

  // Full profile capture from the author's profile page (followers, following,
  // bio, pinned tweet, …). Authoritative: provided fields overwrite whatever a
  // hover-card scrape had guessed. Stamps enrichedAt.
  router.put('/voice/authors/:handle', async (c) => {
    const handle = normalizeHandle(c.req.param('handle'));
    if (!handle) return c.json({ error: 'invalid_handle' }, 400);

    const body = await readJson(c.req.raw);
    if (!body) return c.json({ error: 'invalid_body' }, 400);

    const profile = parseAuthorProfile(body);
    if (!profile) return c.json({ error: 'invalid_profile' }, 400);

    const now = new Date();
    const fields = {
      displayName: profile.displayName,
      bio: profile.bio,
      followersCount: profile.followersCount,
      followingCount: profile.followingCount,
      pinnedTweetId: profile.pinnedTweetId,
      pinnedTweetText: profile.pinnedTweetText,
      xUserId: profile.xUserId,
      profileUrl: profile.profileUrl ?? `https://x.com/${handle}`,
    };

    const [row] = await db
      .insert(voiceAuthors)
      .values({ handle, source: 'profile_scrape', enrichedAt: now, updatedAt: now, ...fields })
      .onConflictDoUpdate({
        target: voiceAuthors.handle,
        // Only overwrite columns the scrape actually caught — a missed bio must
        // not wipe a good one captured on an earlier enrich.
        set: { ...stripNullish(fields), enrichedAt: now, updatedAt: now },
      })
      .returning();

    // Append-only follower series (§7.4) — every enrich adds a point, even an
    // unchanged count ("still N at date X" is signal for the momentum slope).
    if (profile.followersCount !== null) {
      await db.insert(voiceAuthorSnapshots).values({
        handle,
        followersCount: profile.followersCount,
        capturedAt: now,
      });
    }

    // People layer (C1): a full profile capture is authoritative — overwrite.
    // saved_author's deterministic id means only the first enrich logs an
    // event; repeat enriches refresh the person fields silently.
    await upsertPerson(handle, {
      source: 'voice',
      overwrite: true,
      fields: {
        displayName: profile.displayName,
        bio: profile.bio,
        followersCount: profile.followersCount,
        followingCount: profile.followingCount,
        xUserId: profile.xUserId,
      },
    }).catch((err) => console.error('people: enrich upsert failed:', err));
    await safeLogPersonEvents(
      [
        {
          handle,
          type: 'saved_author',
          refTable: 'voice_authors',
          refId: handle,
          summary: 'saved their profile to the voice library',
          at: now,
        },
      ],
      { source: 'voice' },
    );

    return c.json(row);
  });

  // -------------------------------------------------------------- authors

  router.get('/voice/authors', async (c) => {
    const includeRetired = c.req.query('retired') === 'true';

    const tweetCount = sql<number>`count(${voiceTweets.tweetId})`.as('tweet_count');

    const rows = await db
      .select({
        handle: voiceAuthors.handle,
        xUserId: voiceAuthors.xUserId,
        displayName: voiceAuthors.displayName,
        bio: voiceAuthors.bio,
        followersCount: voiceAuthors.followersCount,
        followingCount: voiceAuthors.followingCount,
        pinnedTweetId: voiceAuthors.pinnedTweetId,
        pinnedTweetText: voiceAuthors.pinnedTweetText,
        profileSummary: voiceAuthors.profileSummary,
        profileUrl: voiceAuthors.profileUrl,
        source: voiceAuthors.source,
        addedAt: voiceAuthors.addedAt,
        enrichedAt: voiceAuthors.enrichedAt,
        updatedAt: voiceAuthors.updatedAt,
        retired: voiceAuthors.retired,
        tweetCount,
      })
      .from(voiceAuthors)
      .leftJoin(voiceTweets, eq(voiceTweets.authorHandle, voiceAuthors.handle))
      .where(includeRetired ? undefined : eq(voiceAuthors.retired, false))
      .groupBy(voiceAuthors.handle)
      .orderBy(asc(voiceAuthors.handle));

    return c.json(rows);
  });

  router.patch('/voice/authors/:handle', async (c) => {
    const handle = normalizeHandle(c.req.param('handle'));
    if (!handle) return c.json({ error: 'invalid_handle' }, 400);

    const body = await readJson(c.req.raw);
    if (!body || typeof body.retired !== 'boolean') {
      return c.json({ error: 'invalid_retired' }, 400);
    }

    const [updated] = await db
      .update(voiceAuthors)
      .set({ retired: body.retired, updatedAt: new Date() })
      .where(eq(voiceAuthors.handle, handle))
      .returning();

    if (!updated) return c.json({ error: 'not_found' }, 404);
    return c.json(updated);
  });

  router.delete('/voice/authors/:handle', async (c) => {
    const handle = normalizeHandle(c.req.param('handle'));
    if (!handle) return c.json({ error: 'invalid_handle' }, 400);

    const [countRow] = await db
      .select({ count: sql<number>`count(*)` })
      .from(voiceTweets)
      .where(eq(voiceTweets.authorHandle, handle));
    const tweetCount = countRow?.count ?? 0;
    if (tweetCount > 0) return c.json({ error: 'author_has_tweets', tweets: tweetCount }, 409);

    // The follower series is derived data of the author — drop it with them
    // (it FK-references the handle, so it must go first).
    const deleted = db.transaction((tx) => {
      tx.delete(voiceAuthorSnapshots).where(eq(voiceAuthorSnapshots.handle, handle)).run();
      return tx
        .delete(voiceAuthors)
        .where(eq(voiceAuthors.handle, handle))
        .returning({ handle: voiceAuthors.handle })
        .all();
    });

    if (deleted.length === 0) return c.json({ error: 'not_found' }, 404);
    return c.json({ deleted: handle });
  });

  // -------------------------------------------------------------- targets

  // The reply-target roster (§7.4): voice authors sized 2–10x my own follower
  // count (latest account_snapshots row from the daily getMe), ranked by
  // momentum from the append-only enrich series, each with "last replied to"
  // joined from reply_drafts so neglected targets surface. Pure SQL, $0.
  router.get('/voice/targets', async (c) => {
    const [acct] = await db
      .select({
        snapshotAt: accountSnapshots.snapshotAt,
        followersCount: accountSnapshots.followersCount,
      })
      .from(accountSnapshots)
      .orderBy(desc(accountSnapshots.snapshotAt))
      .limit(1);

    if (!acct) {
      // No daily pass has run yet — there is no "my size" to band against.
      return c.json({ myFollowers: null, measuredAt: null, band: null, targets: [] });
    }

    const doctrine = loadDoctrine();
    const band = targetBand(acct.followersCount, {
      minX: doctrine.targetBandMinX,
      maxX: doctrine.targetBandMaxX,
    });

    const authors = await db
      .select({
        handle: voiceAuthors.handle,
        displayName: voiceAuthors.displayName,
        followersCount: voiceAuthors.followersCount,
        followingCount: voiceAuthors.followingCount,
        profileUrl: voiceAuthors.profileUrl,
        enrichedAt: voiceAuthors.enrichedAt,
      })
      .from(voiceAuthors)
      .where(
        and(
          eq(voiceAuthors.retired, false),
          gte(voiceAuthors.followersCount, band.min),
          lte(voiceAuthors.followersCount, band.max),
        ),
      );

    const handles = authors.map((a) => a.handle);

    const [snaps, replyAgg] = handles.length
      ? await Promise.all([
          db
            .select({
              handle: voiceAuthorSnapshots.handle,
              followersCount: voiceAuthorSnapshots.followersCount,
              capturedAt: voiceAuthorSnapshots.capturedAt,
            })
            .from(voiceAuthorSnapshots)
            .where(inArray(voiceAuthorSnapshots.handle, handles))
            .orderBy(asc(voiceAuthorSnapshots.capturedAt)),
          // sourceAuthorUsername is stored as scraped (any case); voice handles
          // are lowercased — match on lower(). A posted draft's updatedAt is in
          // effect paste time (same reading as brief.ts's reply quota).
          db
            .select({
              handle: sql<string>`lower(${replyDrafts.sourceAuthorUsername})`.as('agg_handle'),
              // mapWith decodes the aggregate like the column itself, so the
              // JSON carries an ISO timestamp, not a raw Postgres string.
              lastRepliedAt:
                sql`max(${replyDrafts.updatedAt}) filter (where ${replyDrafts.status} = 'posted')`.mapWith(
                  replyDrafts.updatedAt,
                ),
              postedReplies: sql<number>`count(*) filter (where ${replyDrafts.status} = 'posted')`,
            })
            .from(replyDrafts)
            .where(inArray(sql`lower(${replyDrafts.sourceAuthorUsername})`, handles))
            .groupBy(sql`lower(${replyDrafts.sourceAuthorUsername})`),
        ])
      : [[], []];

    const snapsByHandle = new Map<string, FollowerSnapshotPoint[]>();
    for (const s of snaps) {
      const list = snapsByHandle.get(s.handle) ?? [];
      list.push({ capturedAt: s.capturedAt, followersCount: s.followersCount });
      snapsByHandle.set(s.handle, list);
    }
    const repliesByHandle = new Map(replyAgg.map((r) => [r.handle, r]));

    const targets = rankTargets(
      authors.map((a) => {
        const points = snapsByHandle.get(a.handle) ?? [];
        const r = repliesByHandle.get(a.handle);
        return {
          ...a,
          followersCount: a.followersCount as number,
          ratio: Math.round(((a.followersCount as number) / acct.followersCount) * 10) / 10,
          momentum: authorMomentum(points),
          snapshotCount: points.length,
          lastRepliedAt: r?.lastRepliedAt ?? null,
          postedReplies: r?.postedReplies ?? 0,
        };
      }),
    );

    return c.json({
      myFollowers: acct.followersCount,
      measuredAt: acct.snapshotAt,
      band,
      targets,
    });
  });

  // --------------------------------------------------------------- tweets

  router.get('/voice/tweets', async (c) => {
    const authorParam = c.req.query('author');
    const q = c.req.query('q')?.trim();
    const hook = c.req.query('hook')?.trim();
    const extractedParam = c.req.query('extracted');
    const includeRetired = c.req.query('retired') === 'true';
    const limitStr = c.req.query('limit');

    const filters: SQL[] = [];

    if (authorParam) {
      const handle = normalizeHandle(authorParam);
      if (!handle) return c.json({ error: 'invalid_author' }, 400);
      filters.push(eq(voiceTweets.authorHandle, handle));
    }

    if (q) {
      // Substring match with the user's %/_/\ taken literally. SQLite LIKE is
      // case-insensitive for ASCII (stands in for Postgres ILIKE) but, unlike
      // Postgres, has NO default escape char — so spell out `escape '\'`.
      const pattern = `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
      filters.push(sql`${voiceTweets.text} like ${pattern} escape '\\'`);
    }

    // Template filters (§8.3): "show me stat-hook tweets" becomes a query.
    if (hook) {
      const pattern = `%${hook.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
      filters.push(sql`${voiceTweets.hookType} like ${pattern} escape '\\'`);
    }
    if (extractedParam !== undefined) {
      if (extractedParam !== 'true' && extractedParam !== 'false') {
        return c.json({ error: 'invalid_extracted' }, 400);
      }
      filters.push(
        extractedParam === 'true'
          ? isNotNull(voiceTweets.templateExtractedAt)
          : isNull(voiceTweets.templateExtractedAt),
      );
    }

    if (!includeRetired) filters.push(eq(voiceTweets.retired, false));

    let limit = DEFAULT_LIST_LIMIT;
    if (limitStr !== undefined) {
      const n = Number(limitStr);
      if (!Number.isInteger(n) || n < 1) return c.json({ error: 'invalid_limit' }, 400);
      limit = Math.min(MAX_LIST_LIMIT, n);
    }

    const rows = await db
      .select({
        tweetId: voiceTweets.tweetId,
        authorHandle: voiceTweets.authorHandle,
        authorDisplayName: voiceAuthors.displayName,
        text: voiceTweets.text,
        scrapedHtml: voiceTweets.scrapedHtml,
        createdAt: voiceTweets.createdAt,
        url: voiceTweets.url,
        source: voiceTweets.source,
        savedAt: voiceTweets.savedAt,
        updatedAt: voiceTweets.updatedAt,
        retired: voiceTweets.retired,
        hookType: voiceTweets.hookType,
        skeleton: voiceTweets.skeleton,
        lineBreakPattern: voiceTweets.lineBreakPattern,
        templateLength: voiceTweets.templateLength,
        device: voiceTweets.device,
        templateExtractedAt: voiceTweets.templateExtractedAt,
      })
      .from(voiceTweets)
      .innerJoin(voiceAuthors, eq(voiceAuthors.handle, voiceTweets.authorHandle))
      .where(filters.length ? and(...filters) : undefined)
      .orderBy(desc(voiceTweets.createdAt))
      .limit(limit);

    return c.json(rows);
  });

  router.patch('/voice/tweets/:tweetId', async (c) => {
    const tweetId = c.req.param('tweetId');
    if (!TWEET_ID_RE.test(tweetId)) return c.json({ error: 'invalid_tweet_id' }, 400);

    const body = await readJson(c.req.raw);
    if (!body) return c.json({ error: 'invalid_body' }, 400);

    const updates: Partial<typeof voiceTweets.$inferInsert> = {};

    if (body.retired !== undefined) {
      if (typeof body.retired !== 'boolean') return c.json({ error: 'invalid_retired' }, 400);
      updates.retired = body.retired;
    }

    // Channel tags (C8): `tags` replaces the set (null clears); `addTags`
    // merges server-side — the additive form the content script's save chips
    // use, so a chip click never races a read-modify-write in the page.
    if (body.tags !== undefined && body.addTags !== undefined) {
      return c.json({ error: 'tags_or_add_tags_not_both' }, 400);
    }
    if (body.tags !== undefined) {
      const tags = parseChannelTags(body.tags);
      if (tags === 'invalid') return c.json({ error: 'invalid_tags' }, 400);
      updates.tags = tags;
    }
    if (body.addTags !== undefined) {
      const addTags = parseChannelTags(body.addTags);
      if (addTags === 'invalid' || addTags === null) {
        return c.json({ error: 'invalid_add_tags' }, 400);
      }
      const [existing] = await db
        .select({ tags: voiceTweets.tags })
        .from(voiceTweets)
        .where(eq(voiceTweets.tweetId, tweetId));
      if (!existing) return c.json({ error: 'not_found' }, 404);
      const merged = [...(existing.tags ?? [])];
      for (const t of addTags) if (!merged.includes(t)) merged.push(t);
      updates.tags = merged;
    }

    if (Object.keys(updates).length === 0) return c.json({ error: 'empty_patch' }, 400);
    updates.updatedAt = new Date();

    const [updated] = await db
      .update(voiceTweets)
      .set(updates)
      .where(eq(voiceTweets.tweetId, tweetId))
      .returning();

    if (!updated) return c.json({ error: 'not_found' }, 404);
    return c.json(updated);
  });

  router.delete('/voice/tweets/:tweetId', async (c) => {
    const tweetId = c.req.param('tweetId');
    if (!TWEET_ID_RE.test(tweetId)) return c.json({ error: 'invalid_tweet_id' }, 400);

    const deleted = await db
      .delete(voiceTweets)
      .where(eq(voiceTweets.tweetId, tweetId))
      .returning({ tweetId: voiceTweets.tweetId });

    if (deleted.length === 0) return c.json({ error: 'not_found' }, 404);
    return c.json({ deleted: tweetId });
  });

  return router;
}

// ------------------------------------------------------- targets helpers

const DAY_MS = 24 * 60 * 60 * 1000;

// REPLY GUIDE band: accounts 2–10x my size are big enough to lend reach,
// small enough that a good reply is actually seen. The multipliers are the
// active niche's doctrine knobs (N0.5); the defaults keep every existing call
// site and test green when a caller doesn't pass a band.
export function targetBand(
  myFollowers: number,
  band: { minX: number; maxX: number } = { minX: 2, maxX: 10 },
): { min: number; max: number } {
  return { min: band.minX * myFollowers, max: band.maxX * myFollowers };
}

// The current targets roster as bare (lowercased) handles — the same 2–10x band
// as GET /voice/targets, without the momentum/reply joins. $0. Empty until the
// first daily pass writes an account snapshot (no "my size" to band against).
// Used by GET /x/people/rankmap (S0.3) to tier Radar sightings.
export async function loadTargetHandles(): Promise<string[]> {
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
  const rows = await db
    .select({ handle: voiceAuthors.handle })
    .from(voiceAuthors)
    .where(
      and(
        eq(voiceAuthors.retired, false),
        gte(voiceAuthors.followersCount, band.min),
        lte(voiceAuthors.followersCount, band.max),
      ),
    );
  return rows.map((r) => r.handle);
}

export interface FollowerSnapshotPoint {
  capturedAt: Date;
  followersCount: number;
}

export interface AuthorMomentum {
  delta: number;
  days: number;
  perDay: number;
}

/** Followers/day between the oldest and newest snapshot. Needs ≥2 points; the
 *  span is clamped to a 1-day minimum so two enriches minutes apart don't read
 *  as explosive growth. */
export function authorMomentum(points: FollowerSnapshotPoint[]): AuthorMomentum | null {
  if (points.length < 2) return null;
  const ordered = [...points].sort((a, b) => a.capturedAt.getTime() - b.capturedAt.getTime());
  const first = ordered[0] as FollowerSnapshotPoint;
  const last = ordered.at(-1) as FollowerSnapshotPoint;
  const days = (last.capturedAt.getTime() - first.capturedAt.getTime()) / DAY_MS;
  const delta = last.followersCount - first.followersCount;
  return {
    delta,
    days: round2(days),
    perDay: round2(delta / Math.max(days, 1)),
  };
}

/** Momentum desc; single-snapshot authors (unknown momentum) sink below all
 *  measured ones and order by follower count asc — closest to my size first,
 *  since smaller accounts in the band are likeliest to reply back. */
export function rankTargets<T extends { momentum: AuthorMomentum | null; followersCount: number }>(
  targets: T[],
): T[] {
  return [...targets].sort((a, b) => {
    if (a.momentum && b.momentum && a.momentum.perDay !== b.momentum.perDay) {
      return b.momentum.perDay - a.momentum.perDay;
    }
    if (!a.momentum !== !b.momentum) return a.momentum ? -1 : 1;
    return a.followersCount - b.followersCount;
  });
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// --------------------------------------------------------------- helpers

// Fill-only author upsert: create a stub if new, otherwise set just the columns
// that are still null. Never overwrites enriched data with a weaker hover-card
// guess. `fields` values of null mean "nothing to offer for this column".
async function fillAuthor(
  handle: string,
  fields: {
    displayName: string | null;
    bio: string | null;
    followersCount: number | null;
    followingCount: number | null;
    xUserId: string | null;
    profileUrl: string | null;
  },
): Promise<void> {
  const now = new Date();
  const [existing] = await db.select().from(voiceAuthors).where(eq(voiceAuthors.handle, handle));

  if (!existing) {
    await db.insert(voiceAuthors).values({
      handle,
      source: 'extension_scrape',
      displayName: fields.displayName,
      bio: fields.bio,
      followersCount: fields.followersCount,
      followingCount: fields.followingCount,
      xUserId: fields.xUserId,
      profileUrl: fields.profileUrl,
      addedAt: now,
      updatedAt: now,
    });
    return;
  }

  const set: Partial<typeof voiceAuthors.$inferInsert> = {};
  if (existing.displayName === null && fields.displayName !== null) {
    set.displayName = fields.displayName;
  }
  if (existing.bio === null && fields.bio !== null) set.bio = fields.bio;
  if (existing.followersCount === null && fields.followersCount !== null) {
    set.followersCount = fields.followersCount;
  }
  if (existing.followingCount === null && fields.followingCount !== null) {
    set.followingCount = fields.followingCount;
  }
  if (existing.xUserId === null && fields.xUserId !== null) set.xUserId = fields.xUserId;
  if (existing.profileUrl === null && fields.profileUrl !== null) {
    set.profileUrl = fields.profileUrl;
  }

  if (Object.keys(set).length === 0) return;
  set.updatedAt = now;
  await db.update(voiceAuthors).set(set).where(eq(voiceAuthors.handle, handle));
}

interface Body {
  tweet?: unknown;
  author?: unknown;
  retired?: unknown;
  tags?: unknown;
  addTags?: unknown;
  displayName?: unknown;
  bio?: unknown;
  followersCount?: unknown;
  followingCount?: unknown;
  pinnedTweetId?: unknown;
  pinnedTweetText?: unknown;
  xUserId?: unknown;
  profileUrl?: unknown;
}

interface ScrapedTweet {
  tweetId: string;
  handle: string;
  displayName: string | null;
  text: string;
  html: string | null;
  createdAt: Date | null;
  url: string | null;
}

interface ScrapedAuthor {
  handle: string;
  displayName: string | null;
  bio: string | null;
  followersCount: number | null;
  followingCount: number | null;
  xUserId: string | null;
}

interface AuthorProfile {
  displayName: string | null;
  bio: string | null;
  followersCount: number | null;
  followingCount: number | null;
  pinnedTweetId: string | null;
  pinnedTweetText: string | null;
  xUserId: string | null;
  profileUrl: string | null;
}

async function readJson(req: Request): Promise<Body | null> {
  try {
    const parsed = await req.json();
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return parsed as Body;
  } catch {
    return null;
  }
}

function normalizeHandle(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const h = value.trim().replace(/^@/, '').toLowerCase();
  return USERNAME_RE.test(h) ? h : null;
}

function optString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function optCount(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null;
  return Math.floor(value);
}

function optTweetId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const v = value.trim();
  return TWEET_ID_RE.test(v) ? v : null;
}

export function parseScrapedTweet(value: unknown): ScrapedTweet | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;

  const tweetId = typeof v.tweetId === 'string' ? v.tweetId.trim() : '';
  if (!TWEET_ID_RE.test(tweetId)) return null;

  const handle = normalizeHandle(v.handle);
  if (!handle) return null;

  // Text may legitimately be empty (image-only tweets); only reject non-string.
  const text = typeof v.text === 'string' ? v.text : '';
  const html = typeof v.html === 'string' && v.html ? v.html : null;
  const displayName = optString(v.displayName);

  let createdAt: Date | null = null;
  if (typeof v.createdAt === 'string') {
    const d = new Date(v.createdAt);
    if (!Number.isNaN(d.getTime())) createdAt = d;
  }

  const url = optString(v.url);

  return { tweetId, handle, displayName, text, html, createdAt, url };
}

export function parseScrapedAuthor(value: unknown): ScrapedAuthor | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  const handle = normalizeHandle(v.handle);
  if (!handle) return null;
  return {
    handle,
    displayName: optString(v.displayName),
    bio: optString(v.bio),
    followersCount: optCount(v.followersCount),
    followingCount: optCount(v.followingCount),
    xUserId: optTweetId(v.xUserId),
  };
}

function parseAuthorProfile(body: Body): AuthorProfile | null {
  // Every field is optional, but a scrape that caught *nothing* usable is a
  // no-op we'd rather reject than persist as an empty enriched row.
  const profile: AuthorProfile = {
    displayName: optString(body.displayName),
    bio: optString(body.bio),
    followersCount: optCount(body.followersCount),
    followingCount: optCount(body.followingCount),
    pinnedTweetId: optTweetId(body.pinnedTweetId),
    pinnedTweetText: optString(body.pinnedTweetText),
    xUserId: optTweetId(body.xUserId),
    profileUrl: optString(body.profileUrl),
  };
  const hasAny = Object.values(profile).some((v) => v !== null);
  return hasAny ? profile : null;
}

function stripNullish<T extends Record<string, unknown>>(obj: T): Partial<T> {
  const out: Partial<T> = {};
  for (const [k, val] of Object.entries(obj)) {
    if (val !== undefined && val !== null) (out as Record<string, unknown>)[k] = val;
  }
  return out;
}
