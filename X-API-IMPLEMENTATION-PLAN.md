# X API Wrapper — Implementation Plan for IPSE

> Companion to `PRD-IPSE.md`. Defines the X API surface IPSE depends on, the wrapper architecture, the cost model under the post-April-2026 pay-per-use regime, and a phased build order aligned to the PRD roadmap.
>
> Research snapshot: **May 2026**. All endpoints, prices, and policies reflect the X API v2 pay-per-use model (live Feb 2026, repriced April 20 2026).

---

## 0. Executive summary — what changed since the PRD was drafted

Five 2026-era realities reshape the PRD's assumptions. Read these before anything else.

| # | Reality | PRD impact |
|---|---------|------------|
| 1 | **URL surcharge: $0.20/post when `text` contains a URL** (vs $0.015 base, ~13× more) | Cost model in PRD §10 silently underprices any post with a link. The "link-in-reply" pattern in PRD §6 is now a hard cost lever, not a stylistic preference. |
| 2 | **Programmatic reply restriction (Feb 2026)**: an app may only reply via `in_reply_to_tweet_id` if the original author has @mentioned the app's account or quoted the app's post. **Self-replies (own threads) remain allowed.** | IPSE threads are safe. But "reply targeting" — the core of PRD §5.4's "Reply targeting" feature — is **broken on self-serve tiers**. We must either (a) move replies to a copy-paste handoff, (b) move to Enterprise, or (c) reframe the feature as "queue suggested replies, user confirms in X UI". This is the single largest architectural decision triggered by 2026 changes. |
| 3 | **Cross-account quote tweets blocked** on self-serve tiers (Feb 2026). | PRD §6's "QT > RT" guidance can only be fulfilled for **self-quotes** (probably) or via Enterprise. Treat QT-of-others as Enterprise-only for now. |
| 4 | **Owned Reads at $0.001/resource** (Apr 20 2026): own posts, mentions, likes, bookmarks, followers, following, mute/block lists. | Lowers cost dramatically. PRD §10's $6-12/user/month estimate holds — confirms tiering is sustainable. |
| 5 | **Bookmarks billing bug** (open as of May 2026): `/2/users/:id/bookmarks` is being billed at $0.005 instead of $0.001 despite owned-read eligibility. | Defer bookmark sync; cap fetches until X resolves. |

**Architectural implication:** the wrapper must (1) refuse to embed URLs in primary tweet text by default, (2) gate `replyToOther()` behind a feature flag with cost+policy warning, (3) expose `quoteTweet()` only for self-quotes until policy clarifies.

---

## 1. Scope — what IPSE actually needs from X

Mapping PRD modules → X API surface. Anything not in this table is **out of scope** for v1.

| PRD module | API surface needed |
|------------|--------------------|
| §5.1 Ingest | OAuth 2.0 PKCE; `GET /2/users/me`; `GET /2/users/:id/tweets`; `GET /2/tweets/search/all` (archive backfill); `GET /2/users/:id/mentions`; `GET /2/users/:id/liked_tweets`; user/follower lookup |
| §5.2 Graph Studio | (no X API) |
| §5.3 Authoring agent | `POST /2/tweets` (single, thread chain); `DELETE /2/tweets/:id`; `POST /2/media/upload` chunked; `POST /2/media/metadata` (alt-text); `PUT /2/tweets/:id/hidden` |
| §5.4 Strategic brain → reply targeting | `GET /2/users/by/username/:username`; `GET /2/users?ids=`; `GET /2/users/search`; `GET /2/users/:id` with `connection_status`; `GET /2/tweets/search/recent` (niche cluster discovery). **Reply *posting* gated by Feb-2026 restriction — see §0.2** |
| §5.4 First-30-min protocol | Polling `/2/users/:id/mentions` + per-tweet metric polls (own posts → owned read $0.001) |
| §5.5 Feedback loop | `GET /2/tweets/:id` polling for `public_metrics` + `non_public_metrics` + `organic_metrics` (owned, ≤30d window); compliance batch for delete reconciliation |
| §5.6 Analytics | Same as §5.5 — no separate analytics endpoints needed |

**Explicitly out of v1 scope:** DMs, Spaces, Communities, Lists, Trends, Polls, Account Activity webhooks (use polling), Filtered Stream (use polling), full-archive search beyond minimum backfill.

---

## 2. Stack alignment

Per PRD §7 (BHVR + Bun + Hono + TS):

- **Runtime:** Bun ≥ 1.1
- **HTTP framework:** Hono
- **Language:** TypeScript end-to-end
- **DB:** Postgres + Drizzle (encrypts tokens via pgcrypto or app-layer AES-256-GCM)
- **Job queue:** BullMQ on Redis (for backfills, metric polls, compliance batches)
- **HTTP client to X:** native `fetch` for everything except OAuth 1.0a media upload signing (use `oauth-1.0a` lib)
- **SDK choice:** **Hand-rolled wrapper, not `@xdevplatform/xdk`.** Rationale: SDK does not auto-refresh OAuth 2.0 tokens, error shapes pass through anyway, and we need fine-grained cost-tracking middleware that is awkward to bolt onto the SDK. We will mirror the SDK's typing patterns and reuse the OpenAPI spec at `https://api.x.com/2/openapi.json` to generate types.

---

## 3. Repository layout

```
src/
  x/
    index.ts                  # Public re-exports
    client.ts                 # XClient (per-user, per-app, app-only)
    auth/
      oauth2.ts               # PKCE flow, token exchange, refresh
      oauth1a.ts              # 3-legged + signing (only for /2/media/upload)
      tokens.ts               # Encrypt/decrypt; refresh-with-rotation tx
      scopes.ts               # SCOPE constants + endpoint↔scope map
    fields.ts                 # X_POST_FIELDS, X_USER_FIELDS, X_MEDIA_FIELDS, EXPANSIONS, defaultPostParams()
    types/
      generated.ts            # OpenAPI-generated types (script: bun run gen:x-types)
      domain.ts               # Hand-written domain types (Draft, ThreadPlan, ReplyTarget…)
    posts/
      read.ts                 # timelines, mentions, liked, bookmarks, lookup, conversation
      search.ts               # search/recent, search/all, counts
      write.ts                # create, delete, hideReply, thread chain
      backfill.ts             # backfillUserHistory(userId): two-phase pipeline
    users/
      lookup.ts               # me, byId, byIds, byUsername, byUsernames
      search.ts               # /2/users/search
      relationships.ts        # followers, following, muting, blocking sync
      scoring.ts              # scoreReplyTarget(); cluster signal extraction
    media/
      upload.ts               # INIT/APPEND/FINALIZE/STATUS chunked pipeline
      altText.ts              # /2/media/metadata
    metrics/
      poller.ts               # per-post polling cadence engine
      compliance.ts           # batch /2/compliance/jobs delete-reconciliation
    realtime/
      mentionsPoller.ts       # 60s mention polling for first-30-min protocol
    cost/
      tracker.ts              # per-call cost recorder; per-user, per-day rollups
      budgets.ts              # tier caps; circuit breakers
    util/
      retry.ts                # exponential backoff honoring x-rate-limit-reset
      idempotency.ts          # safePost(): pre-write draft, post-confirm via timeline scan
      pagination.ts           # async iterator over next_token
      errors.ts               # XApiError; classification by `type` URI
      ratelimit.ts            # per-endpoint window tracker
    test/
      mocks/                  # canned responses; OpenAPI-validated
      fixtures/               # sample tweets, users, media payloads
db/schema/
  x_credentials.ts            # per-user OAuth state (encrypted)
  x_app_credentials.ts        # per-app secrets (env-loaded, not stored)
  x_drafts.ts                 # idempotency log for outgoing posts
  x_threads.ts                # multi-segment thread state
  x_metrics_snapshots.ts      # time-series metric polls
  x_followers_snapshots.ts    # incremental follower diffs
  x_cost_events.ts            # cost ledger
```

---

## 4. Authentication model

### 4.1 Two contexts, three credential sets

| Context | Credentials | Use |
|---------|-------------|-----|
| **App-only (Bearer)** | `X_BEARER_TOKEN` (env) | Public reads of arbitrary users, niche cluster search, user lookup by username, search/recent. Higher per-endpoint rate limits, no user consent. |
| **User context (OAuth 2.0 PKCE)** | Per-user `access_token` + `refresh_token` (encrypted in `x_credentials`); app-level `client_id` + `client_secret` (env) | All writes; owned reads at $0.001; mentions/followers/likes/bookmarks of auth'd user |
| **User context (OAuth 1.0a)** | Per-user `access_token` + `access_token_secret` (encrypted); app-level `api_key` + `api_secret` (env) | **Only** for `POST /2/media/upload` (chunked) — the v2 endpoint historically requires OAuth 1.0a signing. May change; check during build. |

> If `/2/media/upload` accepts OAuth 2.0 by the time we implement Phase 1, drop OAuth 1.0a entirely. Track [docs.x.com/changelog](https://docs.x.com/changelog).

### 4.2 OAuth 2.0 PKCE flow (Hono routes)

Required scopes (request all up-front, prune later if X enforces minimization):

```
tweet.read tweet.write tweet.moderate.write
users.read
follows.read
mute.read
like.read like.write
bookmark.read
media.write
offline.access
```

**`offline.access` is mandatory** — without it, no refresh token, and users re-auth every 2 h.

Routes (`src/x/auth/oauth2.ts` exposes pure functions; Hono adapter calls them):

- `GET  /auth/x/start`     → generate `code_verifier`, store in signed cookie + Redis (5-min TTL), redirect to `https://x.com/i/oauth2/authorize`
- `GET  /auth/x/callback`  → verify `state`, exchange `code` (within 30 s) for tokens, encrypt + persist in `x_credentials`, redirect to `/dashboard`
- `POST /auth/x/disconnect` → call `POST https://api.x.com/2/oauth2/revoke`, soft-delete `x_credentials` row

### 4.3 Token rotation — the critical correctness invariant

X rotates the **refresh token on every refresh**. If we lose the new refresh token between issuance and persistence, the user is permanently locked out (no recovery except re-auth).

```ts
// src/x/auth/tokens.ts
export async function refreshIfExpired(userId: string, db: DB): Promise<string> {
  const row = await db.x_credentials.findOne(userId);
  const buffer = 60_000; // refresh 60s before actual expiry
  if (row.expiresAt.getTime() > Date.now() + buffer) {
    return decrypt(row.accessToken);
  }

  const fresh = await postOauth2Refresh(decrypt(row.refreshToken));

  // ATOMIC: write new tokens before returning. If this transaction fails,
  // we must surface the error and force re-auth — do NOT return the new token.
  await db.tx(async (tx) => {
    await tx.x_credentials.update(userId, {
      accessToken:  encrypt(fresh.access_token),
      refreshToken: encrypt(fresh.refresh_token),
      expiresAt:    new Date(Date.now() + fresh.expires_in * 1000),
      lastRefreshAt: new Date(),
    });
  });

  return fresh.access_token;
}
```

Hono middleware `withUserToken()` calls `refreshIfExpired()` before any user-context request and injects the fresh token into `c.var.xToken`.

### 4.4 Token storage schema

```ts
// db/schema/x_credentials.ts
export const xCredentials = pgTable('x_credentials', {
  userId: text('user_id').primaryKey(),     // IPSE user
  xUserId: text('x_user_id').notNull(),     // X user ID (string int64)
  xUsername: text('x_username').notNull(),
  xVerifiedType: text('x_verified_type'),   // "blue" | "business" | "government" | "none"
  xSubscriptionType: text('x_subscription_type'), // "None" | "Premium" | "PremiumPlus" — gates long-form
  // OAuth 2.0
  accessToken: text('access_token').notNull(),         // AES-256-GCM(ciphertext)
  refreshToken: text('refresh_token').notNull(),       // AES-256-GCM(ciphertext)
  expiresAt: timestamp('expires_at').notNull(),
  scope: text('scope').notNull(),
  // OAuth 1.0a (optional, only if media upload still requires it)
  oauth1AccessToken: text('oauth1_access_token'),
  oauth1TokenSecret: text('oauth1_token_secret'),
  // Audit
  connectedAt: timestamp('connected_at').defaultNow().notNull(),
  lastRefreshAt: timestamp('last_refresh_at'),
  revokedAt: timestamp('revoked_at'),
});
```

Encryption: per-row IV stored alongside ciphertext; master key from `process.env.X_TOKEN_KMS_KEY` (env-injected via secrets manager). Never log either token.

---

## 5. Field selection — canonical defaults

`src/x/fields.ts` (single source of truth):

```ts
export const X_POST_FIELDS = [
  'id', 'text', 'created_at', 'author_id',
  'conversation_id', 'in_reply_to_user_id', 'referenced_tweets',
  'public_metrics', 'entities', 'context_annotations',
  'lang', 'possibly_sensitive', 'attachments',
  'edit_history_tweet_ids', 'edit_controls',
] as const;

// Add only on owned-user reads of posts ≤30 days old
export const X_POST_FIELDS_OWNED_PRIVATE = [
  ...X_POST_FIELDS,
  'non_public_metrics',  // url_link_clicks, user_profile_clicks, engagements, video playback %s
  'organic_metrics',     // overlapping, but useful as cross-check
] as const;

export const X_USER_FIELDS = [
  'id', 'name', 'username', 'created_at',
  'description', 'entities', 'location',
  'profile_image_url', 'protected',
  'public_metrics', 'verified', 'verified_type',
  'most_recent_tweet_id', 'subscription_type',  // self only
  'connection_status',                          // for peer lookups under user-context
  'url', 'withheld',
] as const;

export const X_MEDIA_FIELDS = [
  'media_key', 'type', 'url', 'preview_image_url',
  'alt_text', 'duration_ms', 'height', 'width', 'public_metrics',
] as const;

export const X_EXPANSIONS = [
  'author_id',
  'referenced_tweets.id',
  'referenced_tweets.id.author_id',
  'in_reply_to_user_id',
  'attachments.media_keys',
  'entities.mentions.username',
  'edit_history_tweet_ids',
] as const;

export function defaultPostParams(opts?: { ownedPrivate?: boolean }) {
  return {
    'tweet.fields': (opts?.ownedPrivate ? X_POST_FIELDS_OWNED_PRIVATE : X_POST_FIELDS).join(','),
    'user.fields': X_USER_FIELDS.join(','),
    'media.fields': X_MEDIA_FIELDS.join(','),
    'expansions': X_EXPANSIONS.join(','),
  };
}
```

---

## 6. Module specs

Each module is a thin, typed function library — no classes, no dependency injection containers. The wrapper is functional: `(ctx, params) → Promise<Result>`. `ctx` carries the active token, the cost tracker, and the rate-limit window store.

### 6.1 `posts/read.ts`

| Function | Endpoint | Auth | Cost |
|----------|----------|------|------|
| `getMyTweets(ctx, opts)` | `GET /2/users/:id/tweets` (id from `me`) | user | $0.001/post |
| `getMentions(ctx, opts)` | `GET /2/users/:id/mentions` | user | $0.001/post |
| `getLikedTweets(ctx, opts)` | `GET /2/users/:id/liked_tweets` | user | $0.001/post |
| `getBookmarks(ctx, opts)` | `GET /2/users/:id/bookmarks` | user (`bookmark.read`) | **bug: charged $0.005, defer** |
| `getReverseChronTimeline(ctx, opts)` | `GET /2/users/:id/timelines/reverse_chronological` | user | $0.005/post |
| `getTweet(ctx, id, opts)` | `GET /2/tweets/:id` | either | $0.005 / $0.001 if owned |
| `getTweets(ctx, ids, opts)` | `GET /2/tweets?ids=` (≤100) | either | $0.005/post returned |
| `getQuotesOf(ctx, id, opts)` | `GET /2/tweets/:id/quote_tweets` | either | $0.005/post |
| `getRetweetersOf(ctx, id, opts)` | `GET /2/tweets/:id/retweeted_by` | either | $0.010/user |
| `getLikersOf(ctx, id, opts)` | `GET /2/tweets/:id/liking_users` | either | $0.010/user |
| `getConversationReplies(ctx, conversationId, opts)` | `GET /2/tweets/search/recent?query=conversation_id:X is:reply` | either | $0.005/post |

All return paginated `AsyncIterable<Tweet>` via `paginate()` helper (handles `next_token`).

**Hard caps to encode:**
- `/users/:id/tweets`: 3,200 most recent (after that → search/all)
- `/users/:id/mentions`: 800 most recent
- `/tweets/:id/retweeted_by` / `liking_users`: hard 100 cap (no pagination beyond)
- `search/all`: 1 req/sec server-enforced — `paginate()` injects 1.1 s sleep

### 6.2 `posts/search.ts`

| Function | Endpoint |
|----------|----------|
| `searchRecent(ctx, query, opts)` | `GET /2/tweets/search/recent` (7-day) |
| `searchAll(ctx, query, opts)` | `GET /2/tweets/search/all` (full archive, pay-per-use OK) |
| `searchCounts(ctx, query, granularity)` | `GET /2/tweets/counts/recent` |

Operator helpers (`buildQuery({from, to, conversationId, hasMedia, lang, exclude})`) to avoid string-glue bugs. Validate query length (512 / 1024 chars).

**Niche-cluster query templates** (PRD §5.4 reply targeting, *for discovery only — actual reply must use the gated path in §6.3.4*):

```ts
// Generated from a user's Pillar nodes
buildQuery({
  any: ['#indiehackers', '"#buildinpublic"', '"saas founder"'],
  exclude: ['is:retweet'],
  lang: 'en',
});
```

### 6.3 `posts/write.ts`

#### 6.3.1 `createPost(ctx, body)`

```ts
interface CreatePostInput {
  text?: string;
  reply?: { in_reply_to_tweet_id: string; exclude_reply_user_ids?: string[] };
  quote_tweet_id?: string;       // ENTERPRISE-gated for cross-account, see §0.2
  media?: { media_ids: string[]; tagged_user_ids?: string[] };
  reply_settings?: 'mentionedUsers' | 'following' | 'subscribers' | 'verified';
  for_super_followers_only?: boolean;
  community_id?: string;
  edit_options?: { previous_post_id: string };
}
```

**Pre-flight checks** the wrapper enforces:
1. **URL detection.** If `text` matches `/(^|\s)https?:\/\//i`, the wrapper logs a high-cost warning (`$0.20`) and either (a) blocks unless `allowUrlSurcharge: true` is set, or (b) auto-rewrites to a "link-in-reply" thread (configurable per-tier).
2. **Length validation.** 280 chars unless `xCredentials.subscription_type` ∈ `{Premium, PremiumPlus}`, in which case 25,000.
3. **Programmatic-reply gate.** If `reply.in_reply_to_tweet_id` is set AND target `author_id !== ctx.xUserId` (i.e., not a self-reply), block unless feature flag `IPSE_ALLOW_NON_SUMMONED_REPLY` is on. Surface the Feb 2026 policy in the error.
4. **Quote tweet gate.** If `quote_tweet_id` is set AND quoted tweet's `author_id !== ctx.xUserId`, block with policy error.
5. **Idempotency.** See §7.4.

#### 6.3.2 `deletePost(ctx, id)` → `DELETE /2/tweets/:id`

#### 6.3.3 `hideReply(ctx, id, hidden: boolean)` → `PUT /2/tweets/:id/hidden`

#### 6.3.4 `postThread(ctx, segments: CreatePostInput[]): Promise<ThreadResult>`

Self-replies only (always allowed). Persists each segment to `x_threads` table before/after each call. On mid-thread failure, returns `{posted: string[], failedAt: number, error}` and **does not auto-rollback** — IPSE UI offers user the choice to delete posted segments or resume.

```ts
interface ThreadResult {
  draftId: string;
  posted: { index: number; tweetId: string }[];
  failedAt?: number;
  error?: XApiError;
}
```

500 ms inter-segment delay (avoids X's duplicate-content window race).

#### 6.3.5 (Engagement actions — one-line wrappers)

`like`, `unlike`, `repost`, `unrepost`, `bookmark`, `unbookmark` — all `POST/DELETE /2/users/:id/...` — guarded by scope checks.

**Exclude `replyToOther()` from the public API of v1** until §0.2 reply restriction has a clear product answer.

### 6.4 `posts/backfill.ts`

```ts
async function backfillUserHistory(ctx: UserCtx, opts: { archiveCap: number }): Promise<BackfillReport>
```

Two-phase pipeline (PRD §5.1):

**Phase 1 — Owned timeline (≤3,200 most recent posts at $0.001/each = ≤$3.20).**
- `GET /2/users/:id/tweets?max_results=100` paginated until `next_token` exhausted
- `exclude=` parameter NOT used by default (we want replies and self-quotes for graph extraction)
- Persist into local `tweets_raw` table

**Phase 2 — Archive backfill via `search/all`** (capped at `archiveCap`, default 1,800 posts at $0.005 each = $9; user-tier-configurable).
- Anchor: `until_id = oldest_id_from_phase_1`
- Query: `from:{username} -is:retweet`
- `max_results: 500` (search/all max), 1.1 s sleep between pages
- Stop at `archiveCap` regardless of remaining pages

Total worst-case: $3.20 + $9.00 = **$12.20 one-time per user**, only if user has >3,200 posts. PRD §10 allocated $5; `archiveCap` defaults make this configurable per tier (Seed: skip Phase 2; Voice: cap 1,000; Atlas: cap 5,000).

Output: `BackfillReport { totalFetched, ownedRead, archiveRead, costEstimate, durationMs }` written to `x_backfill_runs`.

### 6.5 `users/lookup.ts` and `users/search.ts`

| Function | Endpoint | Cost |
|----------|----------|------|
| `getMe(ctx)` | `/2/users/me` | $0.001 |
| `getUserById(ctx, id)` | `/2/users/:id` | $0.010 (or $0.001 owned) |
| `getUsersByIds(ctx, ids)` | `/2/users?ids=` (≤100) | $0.010/user |
| `getUserByUsername(ctx, username)` | `/2/users/by/username/:username` | $0.010 |
| `getUsersByUsernames(ctx, names)` | `/2/users/by?usernames=` (≤100) | $0.010/user |
| `searchUsers(ctx, query, opts)` | `/2/users/search` | $0.010/user |

All return objects with `connection_status` populated when `ctx` is user-context — primary mute/block check signal.

### 6.6 `users/relationships.ts`

| Function | Endpoint | Cadence |
|----------|----------|---------|
| `syncFollowers(ctx)` | `/2/users/:id/followers` paginated `max_results=1000` | weekly |
| `syncFollowing(ctx)` | `/2/users/:id/following` | weekly |
| `syncMuteList(ctx)` | `/2/users/:id/muting` | session-start + after every mute write |
| `syncBlockList(ctx)` | `/2/users/:id/blocking` | session-start + after every block write |
| `follow / unfollow / mute / unmute / block / unblock` | corresponding POST/DELETE | on-demand |

**Diff-based persistence** (`x_followers_snapshots`): each sync stores `{snapshotAt, addedIds[], removedIds[], totalCount}`. Full member list lives in a denormalized `x_followers (userId, followerId, lastSeenSnapshotId)` table for cluster analysis.

**Cost projection (ICP user, 10K followers, weekly sync):** 10 pages × $0.001/follower × 4/month ≈ **$40/month**. PRD §10 must absorb this — tier into the cost table, not "infra share".

### 6.7 `users/scoring.ts`

`scoreReplyTarget(user: PeerUser): number` — formula from research (followers in 200K–1M range, listed_count log-weight, reciprocal-follow warmth, mute/block hard zero). Used for ranking, not posting (replying to others gated).

### 6.8 `media/upload.ts`

Chunked pipeline (`INIT → APPEND → FINALIZE → STATUS-poll → done`). Signed via OAuth 1.0a.

```ts
async function uploadMedia(
  ctx: UserCtx,
  source: BunFile | Blob | ReadableStream,
  opts: { mediaType: string; mediaCategory: 'tweet_image'|'tweet_gif'|'tweet_video'|'amplify_video'; altText?: string }
): Promise<{ mediaId: string; mediaKey: string; expiresAfterSecs: number }>
```

Implementation (full code in research notes — key Bun gotchas reproduced here):

- 1 MB chunk size; concurrent APPENDs disallowed by X (sequential only)
- Wrap chunk as `new Blob([buf], { type: 'application/octet-stream' })` — `BunFile.slice()` directly into FormData causes 400
- Do **not** override `Content-Type` on FormData requests; Bun's auto-boundary is correct
- `Bun.sleep()` between STATUS polls per `processing_info.check_after_secs`
- Alt-text via `POST /2/media/metadata` with `{media_id, alt_text:{text}}`, max 1000 chars
- Media ID expires ~24 h post-FINALIZE; attach to a tweet within that window or re-upload

**Limits to encode in validation:** JPEG/PNG/WebP ≤5 MB; GIF ≤15 MB / ≤350 frames; MP4 ≤512 MB / ≤140 s; H.264 High Profile + AAC LC; aspect 1:3 to 3:1.

### 6.9 `metrics/poller.ts`

The feedback-loop heart (PRD §5.5). Per-post age-aware polling cadence:

```
0–30 min:    every 5 min   →  6 polls
30 min–6 h:  every 15 min  → 22 polls
6 h–48 h:    every 1 h     → 42 polls
2 d–7 d:     every 6 h     → 20 polls
7 d–30 d:    daily         → 23 polls
                  TOTAL    ≈ 113 polls/post
```

At $0.001 (owned) → **$0.113/post**. For PRD §10's ~30 posts/month → **$3.40/user/month** in metric reads. Comfortable under PRD's $0.90/user budget after dedup wins (24-h UTC dedup means daily polls from same UTC day are free).

After 30 days, `non_public_metrics` and `organic_metrics` silently null — poller switches to public-only fields and persists final snapshot before retiring the post.

```ts
// Stored in x_metrics_snapshots (post_id, snapshot_at, public_metrics, non_public_metrics, organic_metrics)
// Each row is a time-series datapoint for the identity-graph attribution loop.
```

### 6.10 `metrics/compliance.ts`

Nightly batch: collect tweet IDs cached in last 30 d, submit to `/2/compliance/jobs?type=tweets`, poll `/2/compliance/jobs/:id` until complete, ingest delete events, mark `x_metrics_snapshots.deleted_at`. Avoids attributing graph nodes to phantom posts.

### 6.11 `realtime/mentionsPoller.ts`

PRD §5.4 first-30-min protocol. After every successful `createPost()`, schedule a 60 s polling loop on `/2/users/:id/mentions?since_id=last_seen_id` for 30 minutes. New mentions piped to in-app notifications + agent's "respond fast" suggestion.

**Cost:** ~30 polls × $0.001 × 6 posts/month = **$0.18/user/month**. Effectively free.

Filter rules:
- Match `in_reply_to_user_id == ctx.xUserId` AND `referenced_tweets[].id ∈ recently_published_ids`
- De-dup against `x_metrics_snapshots` so we don't fire alerts for replies arriving after the alert window

**Filtered Stream alternative:** deferred. Single connection limit per project doesn't scale to multi-tenant SaaS without sharding. Only revisit if an Atlas-tier user demands sub-10 s latency.

### 6.12 `cost/tracker.ts`

Every wrapper call passes through middleware that:
1. Estimates cost based on (endpoint, owned-or-not, response item count)
2. Inserts a row into `x_cost_events (userId, endpoint, costCents, items, costType, requestId, ts)`
3. Increments per-user, per-day rollup counters in Redis (sliding 24-h dedup window)
4. Trips a circuit breaker if monthly cap (per tier) reached → returns `BudgetExhaustedError` instead of calling X

Tier caps live in `cost/budgets.ts`:

```ts
export const TIER_CAPS = {
  spark:   { reads: 1000, writes: 50,    usd: 5 },     // 14-day trial
  seed:    { reads: 5000, writes: 200,   usd: 15 },    // $19/mo plan
  voice:   { reads: 30000, writes: 1500, usd: 50 },    // $59/mo plan
  atlas:   { reads: 100000, writes: 5000, usd: 130 },  // $149/mo plan
} as const;
```

These are operating-margin caps; X's hard 2M post-reads/month account-level cap is enforced separately.

---

## 7. Cross-cutting concerns

### 7.1 Rate-limit handler (`util/ratelimit.ts`)

Maintain a per-endpoint, per-user (or per-app for Bearer) sliding window in Redis seeded from `x-rate-limit-remaining` / `x-rate-limit-reset` headers on every response. Before issuing a request, check the window. If `remaining === 0`, sleep until `reset` (with 500 ms jitter). On `429`, honor `x-rate-limit-reset` exactly.

### 7.2 Retry policy (`util/retry.ts`)

```ts
withRetry(fn, {
  maxAttempts: 5,
  isRetriable: (err) =>
    err.status === 429 ||
    (err.status >= 500 && err.status <= 504) ||
    err.code === 'NETWORK_ERROR',
  backoff: 'exponential-jitter', // 1s, 2s, 4s, 8s, 16s + 0–500ms jitter
});
```

Never retry: 400 (validation), 401 (token — trigger refresh once then surface), 403 (permission/policy — surface), 404 (gone).

### 7.3 Error classification (`util/errors.ts`)

```ts
export class XApiError extends Error {
  status: number;
  type: string;             // URI from X response (`https://api.x.com/2/problems/...`)
  detail: string;
  rawBody: unknown;
}

export function classify(err: XApiError): ErrorClass {
  if (err.status === 401) return 'auth_invalid';
  if (err.type.includes('client-forbidden') && /duplicate/i.test(err.detail)) return 'duplicate_content';
  if (err.type.includes('client-forbidden') && /not permitted/i.test(err.detail)) return 'reply_restriction';
  if (err.type.includes('client-forbidden') && /user-suspended/i.test(err.detail)) return 'user_suspended';
  if (err.type.includes('rate-limit-exceeded')) return 'rate_limited';
  if (err.type.includes('usage-capped')) return 'usage_capped';
  if (err.type.includes('not-authorized-for-resource')) return 'scope_or_permission';
  if (err.status >= 500) return 'server_error';
  return 'unknown';
}
```

UI mappings: `auth_invalid` → re-auth modal; `duplicate_content` → silent success (already posted); `reply_restriction` → product-level explainer of Feb 2026 policy; `user_suspended` → block + surface support link; `usage_capped` → tier upgrade CTA.

### 7.4 Idempotency (`util/idempotency.ts`)

X has **no** `Idempotency-Key` header. Implement client-side pattern:

```
1. Generate draft_id (UUIDv4) for every CreatePostInput
2. Insert row into x_drafts (draft_id, user_id, body_hash=sha256(text), status='pending', attempted_at)
3. POST /2/tweets
4a. On 2xx → UPDATE x_drafts SET status='posted', tweet_id=…
4b. On network error / 5xx → enter "verification mode":
    - GET /2/users/:id/tweets max_results=10 since={attempted_at - 1min}
    - If any tweet matches body_hash → claim it, mark posted
    - Else → mark failed; safe to retry
```

For threads: extend with `(draft_id, segment_index)` so each segment is independently idempotent.

### 7.5 Logging & observability

- Per-call structured log: `{userId, endpoint, status, costCents, durationMs, retries, requestId}`
- Sensitive fields scrubbed (tokens never logged; tweet text hashed)
- Sink: Axiom or Better Stack (per PRD §7.5)
- Metrics dashboard: cost/user/day, error-class counts, rate-limit-headroom-min-per-endpoint

### 7.6 Encryption

Per PRD §7.5 + §12. Token columns AES-256-GCM with per-row IV. Master key from KMS/Vault, never in DB. Graph data encryption is out of scope for this wrapper.

---

## 8. Cost model — IPSE per-tier

Recomputed against PRD §10 with empirical 2026 numbers. **All prices in USD.** Owned reads = $0.001; standard reads = $0.005; user reads = $0.010; non-URL writes = $0.015; URL writes = $0.20.

### 8.1 Per-active-user monthly burn

| Operation | Volume | Unit cost | Subtotal |
|-----------|--------|-----------|----------|
| One-time backfill, Phase 1 (3,200 own tweets) | 32 reqs × 100 posts | $0.001 | $3.20 (one-time) |
| One-time backfill, Phase 2 (1,800 archive) | 4 reqs × 500 posts | $0.005 | $9.00 (one-time, capped) |
| Mentions polling (first-30-min × 6 posts) | 180 reqs/mo | $0.001 | $0.18 |
| Metrics polling (113 polls × 6 posts) | 678 reads/mo | $0.001 | $0.68 |
| Mute/block sync (weekly) | 4 syncs × ~100 ppl avg | $0.001 | $0.40 |
| Followers weekly sync (10K-follower account) | 40 reqs × 1000 ppl | $0.001 | $40.00 ⚠️ |
| Niche-peer enrichment (50 accounts daily) | 1500/mo | $0.010 | $15.00 |
| Search recent (cluster discovery, 30 queries × 100 results/mo) | 3000 results | $0.005 | $15.00 |
| Posts: 30 single posts/mo (no URL) | 30 writes | $0.015 | $0.45 |
| Posts: thread chains (avg 2 threads × 5 segments/mo) | 10 writes | $0.015 | $0.15 |
| Media uploads (5 images/mo) | 5 writes | $0.015 | $0.08 |
| Compliance batch (nightly) | 30 batches × ~400 IDs avg | $0.005 each (TBC) | included above |
| LLM tokens (per PRD) | — | — | $5–12 |
| Infra share | — | — | $1–2 |
| **X API marginal** | | | **~$70–75** |
| **All-in marginal** | | | **~$76–89/user/mo** |

### 8.2 Tier reconciliation

The big surprise: **followers weekly sync is the dominant X cost at ICP scale**, not posting. PRD §10's $6–12 marginal estimate held because it underweighted follower sync. Two mitigations:

1. **Tier follower sync cadence:** Seed = monthly (1×$10=$10), Voice = bi-weekly (2×$10=$20), Atlas = weekly ($40). Updated tier cost table:

   | Tier | Price | Marginal X cost | LLM | Net margin |
   |------|-------|-----------------|-----|-----------|
   | Spark trial | $0 | $5 (capped) | — | trial only |
   | Seed $19 | $19 | ~$5 | ~$5 | ~$9 |
   | Voice $59 | $59 | ~$15 | ~$10 | ~$34 |
   | Atlas $149 | $149 | ~$50 | ~$15 | ~$84 |

2. **Lazy follower sync:** Don't sync the full follower list on a clock. Sync only when the user opens the audience-cluster module (cache 7 days), or sample 10% per week. This kills the $40 line item for low-engagement users.

### 8.3 xAI cashback offset

Per PRD §7.4 / §10.1: 20% of cumulative X spend returns as xAI credits. At $50/user × 100 users = $5,000/mo X spend → **$1,000/mo xAI credits**, sufficient to displace ~$0.80/user of LLM cost. Fold into all-in margin only after reaching $1,000/mo X spend tier (PRD §7.4 confirmed).

### 8.4 Hard guardrails

- Per-user circuit breaker at `TIER_CAPS[tier].usd` × 1.2 (20 % overage tolerance)
- Account-level monitor on the X Developer Console's 2M post-reads/month cap (alert at 70 %)
- Auto-recharge configured at console level with monthly spending cap matching projected $/100 users

---

## 9. Real-time strategy decision

| Use case | Chosen mechanism | Latency | Monthly cost / user |
|----------|------------------|---------|---------------------|
| First-30-min replies/QTs to user's post | **Poll `/mentions` every 60 s for 30 min after each publish** | ≤60 s | $0.18 |
| Daily metric snapshots (own posts) | **Poll `/tweets/:id` per cadence ladder (§6.9)** | per-tier | $0.68 |
| Community Note attached | **Poll `/tweets/:id` with elevated cadence first 4 h** + heuristic on impression-velocity collapse | ≤5 min | rolled into metrics poll |
| Delete reconciliation | **Nightly `/compliance/jobs` batch** | <24 h | rolled into ingest |
| Mention listening (general) | Same `/mentions` polling at relaxed 5-min cadence outside post windows | ≤5 min | ~$0.30 |
| Niche keyword listening (PRD §5.4 reply targeting) | **Search recent on a cron**, not stream | per-cron | rolled into search costs |

**No filtered stream, no Account Activity webhooks in v1.** Both deferred — they add operational complexity (persistent connections, CRC challenges) and don't unlock anything our PRD requires at the current latency tolerance.

---

## 10. Phased build order — mapped to PRD §11

### Phase 0 — Fondație tehnică (Săpt. 1–3)

- [ ] App registration in console.x.com (separate dev/staging/prod apps)
- [ ] OAuth 2.0 PKCE flow end-to-end (`/auth/x/start`, `/auth/x/callback`, `/auth/x/disconnect`)
- [ ] `x_credentials` schema + AES-GCM encryption
- [ ] `refreshIfExpired()` middleware (with rotation transaction)
- [ ] `XClient` skeleton: app-only + user-context constructors
- [ ] `cost/tracker.ts` skeleton (logs only, no caps yet)
- [ ] `util/retry.ts` + `util/errors.ts` + `util/pagination.ts`
- [ ] OpenAPI type-gen script (`bun run gen:x-types`)
- [ ] `getMe()` smoke test from a real browser auth flow

### Phase 1 — MVP (Săpt. 4–10): Graph Studio + Drafting Agent

- [ ] `posts/backfill.ts` two-phase pipeline + BullMQ job
- [ ] `posts/read.ts` (timeline, mentions, lookup, conversation replies)
- [ ] `users/lookup.ts` (me, byId, byIds, byUsername)
- [ ] `posts/write.ts` `createPost()` with all four pre-flight checks (URL surcharge guard, length validation, reply-restriction gate, idempotency)
- [ ] `posts/write.ts` `postThread()` with `x_threads` resume state
- [ ] `media/upload.ts` chunked pipeline (OAuth 1.0a)
- [ ] `metrics/poller.ts` cadence engine + `x_metrics_snapshots` writes
- [ ] `cost/tracker.ts` enforcement with tier caps + `BudgetExhaustedError`

**Phase-1 exit criteria:** A new user connects X → backfill ingests ≤3,200 posts in <10 min → can publish a single tweet, a thread, and a tweet+image from the IPSE UI → metrics arrive in `x_metrics_snapshots` within 5 min.

### Phase 2 — Closed loop (Săpt. 11–16)

- [ ] `users/relationships.ts` followers + mute/block sync
- [ ] `users/scoring.ts` reply-target ranking
- [ ] `realtime/mentionsPoller.ts` first-30-min protocol
- [ ] `metrics/compliance.ts` nightly delete reconciliation
- [ ] `posts/search.ts` recent + cluster query templates
- [ ] **Reply targeting product decision** (gated path): either build "queued suggestion → user opens X to reply" UX, or invest in Enterprise tier upgrade

### Phase 3 — Co-thinker complet (Săpt. 17–24)

- [ ] `posts/search.ts` `searchAll` (only for archive backfill on premium tier)
- [ ] `users/search.ts` (peer discovery)
- [ ] Long-form post support (Premium subscription_type gating)
- [ ] Tension/Evolution detection from edit history

### Phase 4 — Compounding (Săpt. 25+)

- [ ] Filtered Stream evaluation for Atlas tier (only if a user demands sub-10s)
- [ ] Account Activity API webhooks evaluation
- [ ] Optional Enterprise tier path for cross-account reply / QT capabilities

---

## 11. Testing strategy

### 11.1 Unit tests

- All `util/*` (retry, errors, pagination, idempotency, ratelimit) — pure-function tests
- All `*/*.ts` modules — mocked `fetch` returning canned OpenAPI-validated payloads from `test/fixtures/`
- Cost tracker: assert per-call cost computation matches spec table exactly

### 11.2 Integration tests (sandbox X account)

- One dedicated X "test rig" account with OAuth 2.0 PKCE flow end-to-end
- Publish + delete each cycle (use `nullcast: true`? — confirm during build whether it suppresses billing)
- Run on `bun test --watch=false` only on CI (not local) to avoid burning credits
- Snapshot tests of typed responses against generated OpenAPI types (catches X schema drift)

### 11.3 Contract tests against OpenAPI spec

Re-run `bun run gen:x-types` weekly via a scheduled CI job; fail PR if generated types diverge from committed types — forces explicit acknowledgment of X-side schema changes.

### 11.4 Cost regression tests

A canary test that simulates "1 user's monthly traffic" against a mocked X server, asserts total cost ≤ tier cap × 1.05.

---

## 12. Operational checklist (pre-launch)

- [ ] Production app environment in console.x.com (NOT Development — `client-forbidden` bug)
- [ ] Initial credit purchase + monthly cap configured
- [ ] xAI account linked for 20 % cashback
- [ ] Auto-recharge threshold + alerts in console
- [ ] All redirect URIs registered exactly (incl. trailing slashes); use `127.0.0.1` not `localhost` for dev
- [ ] Master encryption key rotated and stored in KMS (NOT env var in source repo)
- [ ] `x_credentials` table backup encryption verified
- [ ] Privacy policy + terms updated for X data ingestion (PRD §12 explicit no-train)
- [ ] Incident runbook: token-rotation failure, X outage, billing-bug response, suspended-user path
- [ ] Status page subscription to <https://api.x.com/status>
- [ ] Monitoring dashboard: cost-per-user-per-day, p95 latency per endpoint, 429 rate

---

## 13. Open decisions to resolve before Phase 1 ships

1. **Reply targeting product UX.** Without programmatic reply to non-summoned tweets, do we (a) ship a "click-to-X-reply" handoff, (b) skip until Enterprise, or (c) explore Enterprise pricing? This is the largest single product decision triggered by the 2026 changes.
2. **Confirm owned-read $0.001 applies to user-context tokens for end users**, not just app-owner self-reads. Open ticket with X support; budget assumes yes.
3. **Confirm bookmarks billing bug status.** Skip bookmark sync in Phase 1 if unfixed.
4. **Confirm media upload still requires OAuth 1.0a** as of build time. If not, drop OAuth 1.0a entirely.
5. **Confirm `nullcast: true` semantics** under pay-per-use — is the post free / cheaper / billed as normal? Affects testing rig cost.
6. **Long-form `text` field native support** without third-party `type: "long_post"` wrapper — confirm via empirical test once we have a Premium test account.
7. **Self-quote (own tweet) under Feb 2026 QT restriction** — confirmed allowed? If yes, expose `quoteTweet()` for self-quotes only.
8. **Filtered Stream economics** under pay-per-use (per-delivered-tweet cost not in published rate card). Low priority — only relevant if we revisit streams in Phase 4.

---

## 14. Appendix — endpoint cost reference card

| Surface | Cost | Notes |
|---------|------|-------|
| Own post read | $0.001 | Owned read; 24 h UTC dedup |
| Other-user post read | $0.005 | Standard read |
| Own user data (me, mentions, likes, bookmarks*, followers, following, mute, block) | $0.001 | *bookmarks billing bug pending |
| Third-party user lookup | $0.010 | Per user object returned |
| Search recent / search all | $0.005 | Per result; `search/all` 1 req/sec |
| Post create (no URL) | $0.015 | |
| Post create (URL in text) | **$0.20** | ⚠️ 13× base; trigger surcharge guard |
| Summoned reply (orig author @-mentioned us) | $0.010 | |
| Like / Repost / Bookmark write | $0.015 | |
| Delete write | $0.010 | |
| Bookmark delete | $0.005 | |
| Filtered stream delivery | TBC | Likely $0.005/post; verify console |
| Compliance batch | $0.005/ID estimated | Verify console |

---

*End of plan. Companion to PRD-IPSE.md. Treat as a living doc — re-validate against [docs.x.com/changelog](https://docs.x.com/changelog) at the start of each phase.*
