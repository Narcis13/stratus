// Typed endpoint functions over `xFetch`. Cost notes are inline so you see the
// impact at the call site.
//
// THIS FILE IS WRITE-ONLY ON PURPOSE. Every billed READ (`getTweet`,
// `searchRecent`, `getUserTweets`, `getUserMentions`, `getTweetsByIds`) was
// deleted 2026-08-12 together with the 03:00 UTC daily pass — the service now
// spends money on exactly one thing, publishing a scheduled post. Do not add a
// read back here without re-reading CLAUDE.md invariant #8: the numbers those
// reads bought are measured better, and for $0, by the extension's DOM harvest.
//
// `getMe` is the one exception and it is NOT reachable from the server: only
// `scripts/restore-tokens.ts` calls it, to prove a restored refresh token still
// works before trusting it (invariant #3). One $0.001 read, by hand, during
// recovery.

import { xFetch } from './client.ts';
import { POST_CREATE_USD, URL_POST_CREATE_USD } from './pricing.ts';

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
  pinned_tweet_id?: string;
}

/** Cost: $0.001 (owned read). Recovery scripts only — see the file header. */
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
