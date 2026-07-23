// Starter set of typed endpoint functions. Add more as you need them.
// Cost notes are inline so you see the impact at the call site.

import { xFetch } from './client.ts';
import { XApiError } from './errors.ts';
import { defaultPostParams } from './fields.ts';
import type { Page } from './pagination.ts';
import { paginate } from './pagination.ts';
import { OWNED_READ_USD, POST_CREATE_USD, URL_POST_CREATE_USD } from './pricing.ts';

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
  // S0.9: the tweet pinned to the profile. Requested on the daily getMe() — a
  // field, not an extra call, so it rides free on the same $0.001 owned read.
  pinned_tweet_id?: string;
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
  // Present when the tweet carries media/polls. Requested on every owned read
  // (fields.ts POST_FIELDS already lists `attachments` for the media expansion),
  // so reading `media_keys` presence adds no cost — X bills per result, not per
  // field (§S0.2 has_media baseline).
  attachments?: {
    media_keys?: string[];
    poll_ids?: string[];
  };
}

/** Cost: $0.001 (owned read). */
export async function getMe(token: string): Promise<XUser> {
  const res = await xFetch<{ data: XUser }>('/2/users/me', {
    token,
    query: {
      'user.fields':
        'id,name,username,description,public_metrics,verified_type,subscription_type,pinned_tweet_id',
    },
  });
  return res.data;
}

/** Cost: $0.005 if other-user, $0.001 if owned — pass `owned: true` when the
 *  id is the authenticated user's tweet so the cost row reads the true price
 *  instead of the conservative other-user rate (§9.1). `ownedPrivate` implies it. */
export async function getTweet(
  token: string,
  id: string,
  opts: { ownedPrivate?: boolean; owned?: boolean } = {},
): Promise<XTweet> {
  const res = await xFetch<{
    data?: XTweet;
    errors?: Array<{ type?: string; title?: string; detail?: string }>;
  }>(`/2/tweets/${id}`, {
    token,
    query: defaultPostParams(opts),
    ...(opts.owned || opts.ownedPrivate ? { costHint: OWNED_READ_USD } : {}),
  });
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

export interface GetUserMentionsOptions {
  /** Max mentions returned across pages. Also clamps per-request page size for cost. Default 50. */
  maxResults?: number;
  /** Total ceiling across pages (CA.1). Raises completeness by walking MORE
   *  pages under the since_id boundary — never by widening the per-request
   *  `max_results`, which stays clamped by `maxResults` (invariant #5).
   *  Default: `maxResults`, i.e. the old single-page-ish behavior. */
  maxTotal?: number;
  /** Only return mentions newer than this tweet id (incremental inbox pull). */
  sinceId?: string;
}

/** A mention with the author resolved from the page's `includes.users`. */
export interface XMention extends XTweet {
  authorUsername?: string;
  authorName?: string;
}

/**
 * Mentions of the authenticated user — owned reads, $0.001/result (§7.5
 * mention inbox). Hard pagination cap of 800 mentions per X. The default
 * maxResults is a deliberate 50: a first pull with no since_id checkpoint
 * would otherwise walk the whole 800-mention history. Incremental pulls pass
 * `maxTotal` to page past 50 under the since_id boundary (CA.1) — the
 * per-request page size never widens.
 */
export async function* getUserMentions(
  token: string,
  xUserId: string,
  opts: GetUserMentionsOptions = {},
): AsyncIterable<XMention> {
  // Server accepts max_results in [5, 100]. Clamp page size to caller intent:
  // X bills for every result it returns, not what JS iterates.
  const maxResults = opts.maxResults ?? 50;
  const pageSize = Math.min(100, Math.max(5, maxResults));
  // Authors arrive in `includes.users`, which paginate() never sees — collect
  // them per page so each yielded mention carries its author's handle.
  const users = new Map<string, { username: string; name: string }>();
  const fetchPage = async (nextToken: string | undefined) => {
    const page = await xFetch<Page<XTweet> & { includes?: { users?: XUser[] } }>(
      `/2/users/${xUserId}/mentions`,
      {
        token,
        query: {
          max_results: pageSize,
          ...(opts.sinceId ? { since_id: opts.sinceId } : {}),
          ...defaultPostParams(),
          ...(nextToken ? { pagination_token: nextToken } : {}),
        },
      },
    );
    for (const u of page.includes?.users ?? []) {
      users.set(u.id, { username: u.username, name: u.name });
    }
    return page;
  };
  for await (const tweet of paginate(fetchPage, { maxItems: opts.maxTotal ?? maxResults })) {
    const author = tweet.author_id ? users.get(tweet.author_id) : undefined;
    yield {
      ...tweet,
      ...(author ? { authorUsername: author.username, authorName: author.name } : {}),
    };
  }
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
  /** Numeric author id of the tweet being replied to, when the caller knows it.
   *  Verified against `selfXUserId` (§9.2) — the gate checks, not trusts. */
  parentAuthorId?: string;
  /** Caller attests it verified `quote_tweet_id` is an own tweet (e.g. a
   *  posts_published lookup). Quote posts throw without it — quoting others is
   *  blocked on self-serve tiers (Feb 2026), so self-quotes only (§8.5). */
  verifiedSelfQuote?: boolean;
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
    // Verify, don't trust (§9.2): when the caller knows the parent's author id,
    // a mismatch is a policy violation waiting to 403 — refuse before the call.
    if (opts.parentAuthorId != null && opts.parentAuthorId !== opts.selfXUserId) {
      throw new Error(
        'createPost: in_reply_to_tweet_id targets a non-self tweet — blocked on ' +
          'self-serve tiers (Feb 2026). Pass allowReplyToOthers only for the ' +
          'verified mention carve-out.',
      );
    }
  }

  if (body.quote_tweet_id && !opts.verifiedSelfQuote) {
    throw new Error(
      'createPost: quote posts must be verified self-quotes — quoting others is ' +
        'blocked on self-serve tiers (Feb 2026). Look the id up in posts_published ' +
        'and pass { verifiedSelfQuote: true }.',
    );
  }

  // Pricing truthfulness (§9.1): the path alone can't see the URL surcharge.
  // House position (CLAUDE.md invariant #1, the link-in-first-reply pattern):
  // the $0.20 surcharge applies to standalone post text; a link in a reply
  // bills at the base $0.015.
  const costHint =
    containsUrl(body.text) && !body.reply?.in_reply_to_tweet_id
      ? URL_POST_CREATE_USD
      : POST_CREATE_USD;

  const res = await xFetch<{ data: { id: string; text: string } }>('/2/tweets', {
    method: 'POST',
    token,
    body,
    costHint,
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
