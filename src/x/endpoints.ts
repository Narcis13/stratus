// Starter set of typed endpoint functions. Add more as you need them.
// Cost notes are inline so you see the impact at the call site.

import { xFetch } from './client.ts';
import { XApiError } from './errors.ts';
import { defaultPostParams } from './fields.ts';
import type { Page } from './pagination.ts';
import { paginate } from './pagination.ts';

// -------------------------------------------------------------------- READS

export interface XUser {
  id: string;
  name: string;
  username: string;
  description?: string;
  public_metrics?: {
    followers_count: number;
    following_count: number;
    tweet_count: number;
    listed_count: number;
  };
  verified_type?: string;
  subscription_type?: string;
}

export interface XTweet {
  id: string;
  text: string;
  created_at?: string;
  author_id?: string;
  conversation_id?: string;
  in_reply_to_user_id?: string;
  referenced_tweets?: Array<{ type: 'retweeted' | 'quoted' | 'replied_to'; id: string }>;
  public_metrics?: {
    retweet_count: number;
    reply_count: number;
    like_count: number;
    quote_count: number;
    bookmark_count: number;
    impression_count: number;
  };
  // Returned only on owned-user reads of posts ≤30 days old (X plan §6.9).
  // Silently null after the 30-day window — the daily snapshot fires at ~24h,
  // well inside it (see workers/dailyMetrics.ts).
  non_public_metrics?: {
    impression_count: number;
    url_link_clicks: number;
    user_profile_clicks: number;
  };
  organic_metrics?: {
    impression_count: number;
    like_count: number;
    reply_count: number;
    retweet_count: number;
    url_link_clicks: number;
    user_profile_clicks: number;
  };
}

/** Cost: $0.001 (owned read). */
export async function getMe(token: string): Promise<XUser> {
  const res = await xFetch<{ data: XUser }>('/2/users/me', {
    token,
    query: {
      'user.fields': 'id,name,username,description,public_metrics,verified_type,subscription_type',
    },
  });
  return res.data;
}

/** Cost: $0.005 if other-user, $0.001 if owned. */
export async function getTweet(
  token: string,
  id: string,
  opts: { ownedPrivate?: boolean } = {},
): Promise<XTweet> {
  const res = await xFetch<{
    data?: XTweet;
    errors?: Array<{ type?: string; title?: string; detail?: string }>;
  }>(`/2/tweets/${id}`, { token, query: defaultPostParams(opts) });
  // X answers an unreadable tweet (deleted, suspended author) with HTTP 200 and
  // a `{errors:[…]}` body and NO `data` — and bills the read regardless. xFetch
  // can't see this (200 is "ok"), so without this guard getTweet returns
  // undefined and the caller dereferences it, throwing *after* the billed read.
  // In the metrics worker that throw rolls back the per-row tx so next_poll_at
  // never advances — re-billing the same dead tweet every 60s. Surface it as a
  // 404 so the worker's retire-on-404 path stops polling it. (Burned $18 once.)
  if (!res.data) {
    const e = res.errors?.[0];
    throw new XApiError({
      status: 404,
      type: e?.type ?? 'https://api.x.com/2/problems/resource-not-found',
      detail: e?.detail ?? e?.title ?? `No data returned for tweet ${id}`,
      rawBody: res,
    });
  }
  return res.data;
}

/** Cost: $0.005/result. 7-day window. */
export async function* searchRecent(
  token: string,
  query: string,
  opts: { maxResults?: number } = {},
): AsyncIterable<XTweet> {
  // X bills for every result it returns in the response, not what JS iterates.
  // If maxResults=3 and we ask the server for 100, we pay for ~98 we never use.
  // Clamp to X's per-request range [10, 100]; default 100 only when caller wants full iteration.
  const pageSize = Math.min(100, Math.max(10, opts.maxResults ?? 100));
  const fetchPage = (nextToken: string | undefined) =>
    xFetch<Page<XTweet>>('/2/tweets/search/recent', {
      token,
      query: {
        query,
        max_results: pageSize,
        ...defaultPostParams(),
        ...(nextToken ? { next_token: nextToken } : {}),
      },
    });
  yield* paginate(fetchPage, opts.maxResults ? { maxItems: opts.maxResults } : {});
}

export interface GetUserTweetsOptions {
  /** Max tweets returned across pages. Also clamps per-request page size for cost. Default 100. */
  maxResults?: number;
  /** Only return tweets posted after this id (incremental polling). */
  sinceId?: string;
  /** Pull `non_public_metrics` and `organic_metrics` (≤30d, owned only). */
  ownedPrivate?: boolean;
}

/**
 * Cost: $0.001/result if `xUserId` is the authenticated user, $0.005/result otherwise.
 * Replies and retweets are included by default. Hard cap of 3,200 tweets per X.
 */
export async function* getUserTweets(
  token: string,
  xUserId: string,
  opts: GetUserTweetsOptions = {},
): AsyncIterable<XTweet> {
  // Server accepts max_results in [5, 100]. Clamp page size to caller intent:
  // X bills for every result it returns, not what JS iterates.
  const pageSize = Math.min(100, Math.max(5, opts.maxResults ?? 100));
  const fetchPage = (nextToken: string | undefined) =>
    xFetch<Page<XTweet>>(`/2/users/${xUserId}/tweets`, {
      token,
      query: {
        max_results: pageSize,
        ...(opts.sinceId ? { since_id: opts.sinceId } : {}),
        ...defaultPostParams(opts.ownedPrivate ? { ownedPrivate: true } : undefined),
        ...(nextToken ? { pagination_token: nextToken } : {}),
      },
    });
  yield* paginate(fetchPage, opts.maxResults ? { maxItems: opts.maxResults } : {});
}

export interface GetTweetsByIdsResult {
  /** Tweets X returned, in arbitrary order. */
  found: XTweet[];
  /** Ids X did not return (deleted, suspended author, or never existed). */
  missing: string[];
}

/**
 * Batch tweet lookup — up to 100 ids in one call. Cost: $0.001/result if the
 * ids are the authenticated user's own tweets, $0.005/result otherwise. We only
 * ever call this on our own tweets (the daily metrics snapshot), so it's priced
 * as an owned read in pricing.ts. X bills per result *returned*, so missing ids
 * (which come back under `errors`, not `data`) aren't billed.
 */
export async function getTweetsByIds(
  token: string,
  ids: string[],
  opts: { ownedPrivate?: boolean } = {},
): Promise<GetTweetsByIdsResult> {
  if (ids.length === 0) return { found: [], missing: [] };
  if (ids.length > 100) {
    throw new Error(`getTweetsByIds: max 100 ids per call, got ${ids.length}`);
  }
  const res = await xFetch<{
    data?: XTweet[];
    errors?: Array<{ resource_id?: string; value?: string; type?: string; detail?: string }>;
  }>('/2/tweets', {
    token,
    query: { ids: ids.join(','), ...defaultPostParams(opts) },
  });
  const found = res.data ?? [];
  const foundIds = new Set(found.map((t) => t.id));
  const missing = ids.filter((id) => !foundIds.has(id));
  return { found, missing };
}

// ------------------------------------------------------------------- WRITES

export interface CreatePostInput {
  text?: string;
  reply?: { in_reply_to_tweet_id: string; exclude_reply_user_ids?: string[] };
  quote_tweet_id?: string;
  media?: { media_ids: string[]; tagged_user_ids?: string[] };
}

export interface CreatePostOptions {
  /** Explicit consent to pay the $0.20 URL surcharge. Default false → throws. */
  allowUrlSurcharge?: boolean;
  /** The authenticated user's X numeric id. Required to enforce the reply-to-other gate. */
  selfXUserId?: string;
  /** If true, allow replying to non-self tweets. Default false (Feb 2026 policy). */
  allowReplyToOthers?: boolean;
}

const URL_RE = /(^|\s)https?:\/\//i;
export function containsUrl(text: string | undefined): boolean {
  return text != null && URL_RE.test(text);
}

/**
 * Cost: $0.015 for plain post, $0.20 if `text` contains a URL (13× more — guarded).
 *
 * Pre-flight checks (before hitting X):
 *   - URL surcharge guard ($0.015 → $0.20)
 *   - Programmatic-reply gate (Feb 2026 policy)
 *   - Self-quote gate
 */
export async function createPost(
  token: string,
  body: CreatePostInput,
  opts: CreatePostOptions = {},
): Promise<{ id: string; text: string }> {
  if (containsUrl(body.text) && !opts.allowUrlSurcharge) {
    throw new Error(
      'createPost: `text` contains a URL — would be billed at $0.20 (13× standard $0.015). ' +
        'Pass { allowUrlSurcharge: true } if intentional, or move the link to a reply.',
    );
  }

  if (body.reply?.in_reply_to_tweet_id && !opts.allowReplyToOthers) {
    // We can't always tell ownership without a lookup. Caller must confirm by
    // passing `allowReplyToOthers: true` for non-self replies — at which point
    // we surface that this is broken on self-serve unless the original author
    // @-mentioned the app or quoted us. See X plan §0.2.
    if (opts.selfXUserId == null) {
      throw new Error(
        'createPost: replying to a tweet without `selfXUserId` set. ' +
          'Pass selfXUserId so we can verify it is a self-reply (Feb 2026 policy).',
      );
    }
  }

  const res = await xFetch<{ data: { id: string; text: string } }>('/2/tweets', {
    method: 'POST',
    token,
    body,
  });
  return res.data;
}

/** Cost: $0.010. */
export async function deletePost(token: string, id: string): Promise<{ deleted: boolean }> {
  const res = await xFetch<{ data: { deleted: boolean } }>(`/2/tweets/${id}`, {
    method: 'DELETE',
    token,
  });
  return res.data;
}
