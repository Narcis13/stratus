// Voice library: track other authors, query their tweets, view metrics history.
// Mounted under `/x` by `mountX` in ../index.ts.
//
// Routes:
//   POST   /voice/track             { username, maxPolledTweets? }    enroll author
//   DELETE /voice/track/:username                                      stop tracking (soft)
//   POST   /voice/pull/:username    { fullScan?, maxResults? }         on-demand pull
//   GET    /voice/tweets?author=&q=&minLikes=&includeReplies=&limit=   query stash
//   GET    /voice/metrics/:tweetId                                     snapshot history
//
// "Stop tracking" is a soft disable, not a delete — `voice_tweets` rows have
// an FK to `tracked_authors` and we want the historical stash to survive an
// untrack. Disable both pulls and metrics polling, retire any active tweets
// so `voiceMetricsPoll` stops spending. Re-tracking flips the flags back on.
//
// Query latest metrics via a lateral subquery so a single round-trip returns
// each voice tweet plus its most recent snapshot — what a UI list view needs.

import { type SQL, and, asc, desc, eq, ilike, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { db } from '../../db/client.ts';
import { trackedAuthors, voiceMetricsSnapshots, voiceTweets } from '../db/schema.ts';
import { getUserByUsername } from '../endpoints.ts';
import { XApiError } from '../errors.ts';
import { getValidAccessToken } from '../token-store.ts';
import { type VoicePullDeps, retireAuthorVoiceTweets, runVoicePull } from '../workers/voicePull.ts';

const TWEET_ID_RE = /^\d{1,32}$/;
// Twitter usernames: 1–15 chars, alphanumeric + underscore.
const USERNAME_RE = /^[A-Za-z0-9_]{1,15}$/;
const DEFAULT_LIST_LIMIT = 50;
const MAX_LIST_LIMIT = 200;
// X /2/users/:id/tweets pagination cap (X plan §6.1).
const PULL_HARD_CAP = 3200;

export interface VoiceRouterDeps extends VoicePullDeps {}

export function createVoiceRouter(deps: VoiceRouterDeps): Hono {
  const router = new Hono();

  // ---------------------------------------------------------------- track

  router.post('/voice/track', async (c) => {
    const body = await readJson(c.req.raw);
    if (!body) return c.json({ error: 'invalid_body' }, 400);

    const username =
      typeof body.username === 'string' ? body.username.trim().replace(/^@/, '') : '';
    if (!USERNAME_RE.test(username)) return c.json({ error: 'invalid_username' }, 400);

    const maxPolled = parsePositiveInt(body.maxPolledTweets);
    if (maxPolled === 'invalid') return c.json({ error: 'invalid_max_polled_tweets' }, 400);

    let user: Awaited<ReturnType<typeof getUserByUsername>>;
    try {
      const token = await getValidAccessToken({
        clientId: deps.clientId,
        clientSecret: deps.clientSecret,
      });
      user = await getUserByUsername(token, username);
    } catch (err) {
      if (err instanceof XApiError && err.status === 404) {
        return c.json({ error: 'user_not_found' }, 404);
      }
      const detail = err instanceof Error ? err.message : String(err);
      console.error('voice/track resolve failed:', detail);
      return c.json({ error: 'resolve_failed', detail }, 502);
    }

    // Manual track: explicitly opt the author in (overrides any prior soft-disable
    // from /voice/track DELETE or auto_from_scrape's defaults-off behavior).
    const insertValues: typeof trackedAuthors.$inferInsert = {
      xUserId: user.id,
      username: user.username,
      source: 'manual',
      pullEnabled: true,
      metricsPollingEnabled: true,
      ...(maxPolled !== undefined ? { maxPolledTweets: maxPolled } : {}),
    };
    const updateValues: Partial<typeof trackedAuthors.$inferInsert> = {
      username: user.username,
      source: 'manual',
      pullEnabled: true,
      metricsPollingEnabled: true,
      ...(maxPolled !== undefined ? { maxPolledTweets: maxPolled } : {}),
    };

    const [row] = await db
      .insert(trackedAuthors)
      .values(insertValues)
      .onConflictDoUpdate({ target: trackedAuthors.xUserId, set: updateValues })
      .returning();

    return c.json(row, 201);
  });

  router.delete('/voice/track/:username', async (c) => {
    const username = c.req.param('username').replace(/^@/, '');
    if (!USERNAME_RE.test(username)) return c.json({ error: 'invalid_username' }, 400);

    const [author] = await db
      .select()
      .from(trackedAuthors)
      .where(eq(trackedAuthors.username, username));
    if (!author) return c.json({ error: 'not_found' }, 404);

    const [updated] = await db
      .update(trackedAuthors)
      .set({ pullEnabled: false, metricsPollingEnabled: false })
      .where(eq(trackedAuthors.xUserId, author.xUserId))
      .returning();

    const retired = await retireAuthorVoiceTweets(author.xUserId);
    return c.json({ author: updated, retiredVoiceTweets: retired });
  });

  // ----------------------------------------------------------------- pull

  router.post('/voice/pull/:username', async (c) => {
    const username = c.req.param('username').replace(/^@/, '');
    if (!USERNAME_RE.test(username)) return c.json({ error: 'invalid_username' }, 400);

    const [author] = await db
      .select()
      .from(trackedAuthors)
      .where(eq(trackedAuthors.username, username));
    if (!author) return c.json({ error: 'not_found' }, 404);

    const body = await readJson(c.req.raw);
    const fullScan = body?.fullScan === true;
    const maxResults = parseMaxResults(body?.maxResults);
    if (maxResults === 'invalid') return c.json({ error: 'invalid_max_results' }, 400);

    try {
      const result = await runVoicePull(deps, author.xUserId, {
        fullScan,
        ...(maxResults !== undefined ? { maxResults } : {}),
      });
      return c.json(result);
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      console.error('voice/pull failed:', detail);
      return c.json({ error: 'pull_failed', detail }, 500);
    }
  });

  // ---------------------------------------------------------------- query

  router.get('/voice/tweets', async (c) => {
    const authorParam = c.req.query('author')?.replace(/^@/, '');
    const q = c.req.query('q')?.trim();
    const minLikesStr = c.req.query('minLikes');
    const includeReplies = c.req.query('includeReplies') === 'true';
    const limitStr = c.req.query('limit');

    const filters: SQL[] = [];

    if (authorParam) {
      // Accept either a numeric id or a @username.
      if (/^\d+$/.test(authorParam)) {
        filters.push(eq(voiceTweets.authorXUserId, authorParam));
      } else if (USERNAME_RE.test(authorParam)) {
        const [author] = await db
          .select({ xUserId: trackedAuthors.xUserId })
          .from(trackedAuthors)
          .where(eq(trackedAuthors.username, authorParam));
        if (!author) return c.json([]);
        filters.push(eq(voiceTweets.authorXUserId, author.xUserId));
      } else {
        return c.json({ error: 'invalid_author' }, 400);
      }
    }

    if (q) {
      // ILIKE with escaped wildcards — keep query as substring match.
      const pattern = `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
      filters.push(ilike(voiceTweets.text, pattern));
    }

    if (!includeReplies) {
      filters.push(eq(voiceTweets.isReply, false));
    }

    let minLikes: number | undefined;
    if (minLikesStr !== undefined) {
      const n = Number(minLikesStr);
      if (!Number.isFinite(n) || n < 0) return c.json({ error: 'invalid_min_likes' }, 400);
      minLikes = Math.floor(n);
    }

    let limit = DEFAULT_LIST_LIMIT;
    if (limitStr !== undefined) {
      const n = Number(limitStr);
      if (!Number.isInteger(n) || n < 1) return c.json({ error: 'invalid_limit' }, 400);
      limit = Math.min(MAX_LIST_LIMIT, n);
    }

    // Latest snapshot per tweet via correlated subquery — single round-trip,
    // and the subquery's LIMIT 1 keeps it cheap (uses the
    // (tweet_id, snapshot_at desc) index).
    const latestPublic = sql<unknown>`(
      select ${voiceMetricsSnapshots.publicMetrics}
      from ${voiceMetricsSnapshots}
      where ${voiceMetricsSnapshots.tweetId} = ${voiceTweets.tweetId}
      order by ${voiceMetricsSnapshots.snapshotAt} desc
      limit 1
    )`;

    if (minLikes !== undefined) {
      // Filter on the latest snapshot's like_count. NULL (no snapshot yet) is
      // treated as 0 so a minLikes>0 filter excludes un-snapshotted tweets.
      filters.push(sql`coalesce((${latestPublic}->>'like_count')::int, 0) >= ${minLikes}`);
    }

    const rows = await db
      .select({
        tweetId: voiceTweets.tweetId,
        authorXUserId: voiceTweets.authorXUserId,
        text: voiceTweets.text,
        createdAt: voiceTweets.createdAt,
        isReply: voiceTweets.isReply,
        inReplyToTweetId: voiceTweets.inReplyToTweetId,
        conversationId: voiceTweets.conversationId,
        source: voiceTweets.source,
        fetchedAt: voiceTweets.fetchedAt,
        lastSeenAt: voiceTweets.lastSeenAt,
        nextPollAt: voiceTweets.nextPollAt,
        pollCount: voiceTweets.pollCount,
        retired: voiceTweets.retired,
        latestPublicMetrics: latestPublic,
      })
      .from(voiceTweets)
      .where(filters.length ? and(...filters) : undefined)
      .orderBy(desc(voiceTweets.createdAt))
      .limit(limit);

    return c.json(rows);
  });

  // -------------------------------------------------------------- metrics

  router.get('/voice/metrics/:tweetId', async (c) => {
    const tweetId = c.req.param('tweetId');
    if (!TWEET_ID_RE.test(tweetId)) return c.json({ error: 'invalid_tweet_id' }, 400);

    const [tweet] = await db.select().from(voiceTweets).where(eq(voiceTweets.tweetId, tweetId));
    if (!tweet) return c.json({ error: 'not_found' }, 404);

    const snapshots = await db
      .select({
        snapshotAt: voiceMetricsSnapshots.snapshotAt,
        publicMetrics: voiceMetricsSnapshots.publicMetrics,
      })
      .from(voiceMetricsSnapshots)
      .where(eq(voiceMetricsSnapshots.tweetId, tweetId))
      .orderBy(asc(voiceMetricsSnapshots.snapshotAt));

    return c.json({
      tweetId: tweet.tweetId,
      authorXUserId: tweet.authorXUserId,
      createdAt: tweet.createdAt,
      retired: tweet.retired,
      pollCount: tweet.pollCount,
      nextPollAt: tweet.nextPollAt,
      lastSeenAt: tweet.lastSeenAt,
      snapshots,
    });
  });

  return router;
}

// --------------------------------------------------------------- helpers

interface Body {
  username?: unknown;
  maxPolledTweets?: unknown;
  fullScan?: unknown;
  maxResults?: unknown;
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

function parsePositiveInt(value: unknown): number | undefined | 'invalid' {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) return 'invalid';
  return value;
}

function parseMaxResults(value: unknown): number | undefined | 'invalid' {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 1) return 'invalid';
  return Math.min(PULL_HARD_CAP, Math.floor(value));
}
