// Voice library: track other authors, query their tweets, view metrics history.
// Mounted under `/x` by `mountX` in ../index.ts.
//
// Routes:
//   POST   /voice/track             { username, maxPolledTweets? }    enroll author
//   DELETE /voice/track/:username                                      stop tracking (soft)
//   POST   /voice/pull/:username    { fullScan?, maxResults? }         on-demand pull
//   POST   /voice/scrape            { original, replies?, pollMetrics? } extension scrape
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

  // --------------------------------------------------------------- scrape

  // Extension content script POSTs DOM-scraped tweet content here. The scrape
  // is treated as authoritative — no X API call is made for tweet content
  // itself (we trust the DOM). The only paid call is `getUserByUsername` for
  // unknown authors (one $0.010 lookup per *new* author per request, deduped).
  // Existing tracked_authors are matched by username so re-scrapes are free.
  //
  // Auto-author handling: when a username isn't tracked yet, we insert a row
  // with source='auto_from_scrape' and both pull/metrics flags OFF — saving
  // a tweet must never silently kick off paid pulls. Promote from the side
  // panel's Voice tab once you decide an author is worth actively tracking.
  //
  // pollMetrics: when true, freshly-inserted tweets get nextPollAt=now so the
  // voiceMetricsPoll worker (opt-in via VOICE_METRICS_POLL_ENABLED) picks them
  // up on its next tick. Re-scrapes never re-arm polling on existing rows.
  router.post('/voice/scrape', async (c) => {
    const body = await readJson(c.req.raw);
    if (!body) return c.json({ error: 'invalid_body' }, 400);

    const original = parseScrapedTweet(body.original);
    if (!original) return c.json({ error: 'invalid_original' }, 400);

    const repliesRaw = Array.isArray(body.replies) ? body.replies : [];
    const replies: ScrapedTweet[] = [];
    const skippedReplies: Array<{ index: number; reason: string }> = [];
    for (let i = 0; i < repliesRaw.length; i++) {
      const r = parseScrapedTweet(repliesRaw[i]);
      if (r) replies.push(r);
      else skippedReplies.push({ index: i, reason: 'invalid_reply' });
    }

    const pollMetrics = body.pollMetrics === true;

    // Dedupe authors by username — one $0.010 lookup per fresh author per
    // request, even if 10 replies all came from the same user.
    const usernames = new Set<string>([original.username, ...replies.map((r) => r.username)]);

    const resolved = new Map<string, string>(); // username → xUserId
    const authorsCreated: Array<{ xUserId: string; username: string }> = [];
    const authorsFailed: Array<{ username: string; reason: string }> = [];

    let token: string | null = null;
    for (const username of usernames) {
      const [existing] = await db
        .select({ xUserId: trackedAuthors.xUserId })
        .from(trackedAuthors)
        .where(eq(trackedAuthors.username, username));
      if (existing) {
        resolved.set(username, existing.xUserId);
        continue;
      }

      // Lazy: only acquire a token once we hit the first unknown author.
      if (token === null) {
        try {
          token = await getValidAccessToken({
            clientId: deps.clientId,
            clientSecret: deps.clientSecret,
          });
        } catch (err) {
          const detail = err instanceof Error ? err.message : String(err);
          console.error('voice/scrape token failed:', detail);
          return c.json({ error: 'token_unavailable', detail }, 502);
        }
      }

      try {
        const user = await getUserByUsername(token, username);
        // INSERT may race with another request scraping the same author —
        // ON CONFLICT DO NOTHING leaves the existing row alone (which keeps
        // its potentially-promoted manual flags intact).
        const [inserted] = await db
          .insert(trackedAuthors)
          .values({
            xUserId: user.id,
            username: user.username,
            source: 'auto_from_scrape',
            pullEnabled: false,
            metricsPollingEnabled: false,
          })
          .onConflictDoNothing()
          .returning({ xUserId: trackedAuthors.xUserId });
        if (inserted) {
          authorsCreated.push({ xUserId: inserted.xUserId, username: user.username });
        }
        resolved.set(username, user.id);
      } catch (err) {
        if (err instanceof XApiError && err.status === 404) {
          authorsFailed.push({ username, reason: 'user_not_found' });
          continue;
        }
        const detail = err instanceof Error ? err.message : String(err);
        console.error(`voice/scrape resolve @${username} failed:`, detail);
        authorsFailed.push({ username, reason: 'resolve_failed' });
      }
    }

    // The original's author MUST resolve — without it we have no anchor for
    // the conversation. Replies whose authors failed to resolve are skipped
    // (recorded in `skippedReplies`) so we still save what we can.
    const originalAuthorId = resolved.get(original.username);
    if (!originalAuthorId) {
      const failure =
        authorsFailed.find((a) => a.username === original.username)?.reason ?? 'unresolved';
      return c.json({ error: 'original_author_unresolved', detail: failure }, 422);
    }

    const now = new Date();
    const conversationId = original.tweetId;

    let inserted = 0;
    let updated = 0;
    let pollEnrolled = 0;

    const upsertTweet = async (
      tw: ScrapedTweet,
      authorXUserId: string,
      isReply: boolean,
    ): Promise<void> => {
      const createdAt = tw.createdAt ?? now;
      const result = await db
        .insert(voiceTweets)
        .values({
          tweetId: tw.tweetId,
          authorXUserId,
          text: tw.text,
          createdAt,
          isReply,
          // We can't derive the precise parent of a reply from the DOM (deep
          // threads have nested parents); leave inReplyToTweetId null and
          // anchor the relationship via conversationId instead.
          inReplyToTweetId: null,
          conversationId,
          source: 'extension_scrape',
          fetchedAt: now,
          lastSeenAt: now,
          nextPollAt: pollMetrics ? now : null,
        })
        .onConflictDoNothing()
        .returning({ tweetId: voiceTweets.tweetId });

      if (result.length > 0) {
        inserted++;
        if (pollMetrics) pollEnrolled++;
      } else {
        // Already in the stash — just bump lastSeenAt. Don't re-arm polling
        // or change the source/createdAt of an existing row.
        await db
          .update(voiceTweets)
          .set({ lastSeenAt: now })
          .where(eq(voiceTweets.tweetId, tw.tweetId));
        updated++;
      }
    };

    await upsertTweet(original, originalAuthorId, false);

    for (const reply of replies) {
      const authorXUserId = resolved.get(reply.username);
      if (!authorXUserId) {
        skippedReplies.push({ index: -1, reason: `author_unresolved:${reply.username}` });
        continue;
      }
      await upsertTweet(reply, authorXUserId, true);
    }

    return c.json({
      conversationId,
      tweets: { inserted, updated, total: inserted + updated },
      authors: {
        resolved: resolved.size,
        created: authorsCreated.length,
        createdList: authorsCreated,
        failed: authorsFailed,
      },
      pollEnrolled,
      skippedReplies,
    });
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
  original?: unknown;
  replies?: unknown;
  pollMetrics?: unknown;
}

interface ScrapedTweet {
  tweetId: string;
  username: string;
  displayName: string | null;
  text: string;
  createdAt: Date | null;
  url: string | null;
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

export function parseScrapedTweet(value: unknown): ScrapedTweet | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;

  const tweetId = typeof v.tweetId === 'string' ? v.tweetId.trim() : '';
  if (!TWEET_ID_RE.test(tweetId)) return null;

  const usernameRaw = typeof v.username === 'string' ? v.username.trim().replace(/^@/, '') : '';
  if (!USERNAME_RE.test(usernameRaw)) return null;

  // Text may legitimately be empty (image-only tweets); only reject non-string.
  const text = typeof v.text === 'string' ? v.text : '';

  const displayName =
    typeof v.displayName === 'string' && v.displayName.trim() ? v.displayName.trim() : null;

  let createdAt: Date | null = null;
  if (typeof v.createdAt === 'string') {
    const d = new Date(v.createdAt);
    if (!Number.isNaN(d.getTime())) createdAt = d;
  }

  const url = typeof v.url === 'string' && v.url ? v.url : null;

  return { tweetId, username: usernameRaw, displayName, text, createdAt, url };
}
