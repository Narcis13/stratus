# X API — Pricing, Auth & Rate Limits Reference

Extracted from official X documentation on **2026-05-06** so this repo has a single canonical pricing source. The authoritative live page is <https://docs.x.com/x-api/getting-started/pricing> — when in doubt, that wins. All figures USD.

The model since **Feb 6, 2026** is **pay-per-use only**: no Free / Basic / Pro tiers anymore (Enterprise still exists for large workloads). You buy credits in the Developer Console and they are deducted per request. No subscription, no minimum spend, no contract.

---

## Pricing — Reads

Charged per **resource returned** (not per HTTP request).

| Resource type | Cost per resource |
|---|---|
| Posts: Read | $0.005 |
| List: Read | $0.005 |
| Space: Read | $0.005 |
| Community: Read | $0.005 |
| Note: Read | $0.005 |
| Media: Read | $0.005 |
| Analytics: Read | $0.005 |
| User: Read | $0.010 |
| DM Event: Read | $0.010 |
| Following / Followers: Read | $0.010 |
| Trend: Read | $0.010 |

### Owned Reads — discounted

> "$0.001 per resource (1,000 resources for $1) when the user owns the developer app and `{id}` matches the authenticated user."

Applies when reading your own data (your posts, your followers, your DMs, etc.) through an app you own.

### Deduplication

> "All resources are deduplicated within a 24-hour UTC day window."

Same resource ID requested again within the same UTC day = no extra charge. Reset is at 00:00 UTC, not on a rolling basis.

---

## Pricing — Writes & Actions

Charged per **request**.

| Action | Cost per request |
|---|---|
| Content: Create (no URL in text) | $0.015 |
| **Content: Create (URL in text)** | **$0.200** ⚠️ |
| Content: Manage | $0.005 |
| DM Interaction: Create | $0.015 |
| User Interaction: Create (like, repost, follow, mute, block) | $0.015 |
| Interaction: Delete | $0.010 |
| List: Create | $0.010 |
| List: Manage | $0.005 |
| Bookmark | $0.005 |
| Media Metadata | $0.005 |
| Privacy: Update | $0.010 |
| Mute: Delete | $0.005 |
| Counts: Recent | $0.005 |
| Counts: All | $0.010 |

⚠️ **The URL surcharge is real and large** — a post text matching `/(^|\s)https?:\/\//i` is billed at $0.200, ~13× a normal post. `src/client.ts` / `src/endpoints.ts::createPost` blocks this unless `allowUrlSurcharge: true` is set.

> Note: CLAUDE.md's cost cheat sheet currently lists "Like / Repost / Bookmark write" as $0.015. The official table splits these: like / repost / follow / mute / block writes are $0.015 (User Interaction: Create), but **Bookmark create is $0.005** (its own line). Trust this doc / the live page over the CLAUDE.md cheat sheet for that one.

---

## xAI Credit Rebate Tiers

Cumulative spend in a billing cycle, paid back as xAI API credits:

| Cumulative spend | Rebate |
|---|---|
| $0 – $199 | 0% |
| $200 – $499 | 10% |
| $500 – $999 | 15% |
| $1,000+ | 20% |

---

## Caps

- **Pay-per-use is capped at ~2 million post reads / month.** Above that, Enterprise is required (per X's Feb 2026 launch announcement; the official pricing page does not restate this number, so verify in console.x.com if you approach it).
- Standard rate limits still apply on top of cost (see below) — paying does not lift them.

---

## Rate Limits (selected — full list at <https://docs.x.com/x-api/fundamentals/rate-limits>)

Windows are 15 min or 24 h, per-app or per-user.

| Endpoint | Limit |
|---|---|
| `/2/tweets` (lookup, batched) | 3,500 / 15min per app |
| `/2/tweets/:id` | 450 / 15min per app |
| `/2/tweets` (POST, create) | 10,000 / 24h per app |
| `/2/tweets/search/recent` | 450 / 15min per app |
| `/2/tweets/search/all` | 1 / sec, 300 / 15min per app |
| `/2/users/*` (most lookups) | 300 / 15min per app |
| `/2/users/me` | 75 / 15min per user |
| DM read | 15 / 15min per user |
| DM send | 1,440 / 24h per app |
| Media upload (chunked) | 180,000 / 24h per app |
| Blocks / Mutes | 15 / 15min per user |

Hard pagination ceilings (silent — iteration just stops):

- `/2/users/:id/tweets` — 3,200 max
- `/2/users/:id/mentions` — 800 max
- `/2/tweets/:id/retweeted_by` — 100 max
- `/2/tweets/:id/liking_users` — 100 max

`search/all` is server-rate-limited to 1 req/sec — pass `perPageSleepMs: 1100` to `paginate()`.

---

## Authentication

X exposes four auth modes; this repo only uses **OAuth 2.0 PKCE (Authorization Code)**.

| Method | When to use |
|---|---|
| OAuth 2.0 PKCE (Authorization Code) | User-context calls — what `src/auth.ts` implements |
| App-only (OAuth 2.0 Bearer) | Public reads, no user context — `X_BEARER_TOKEN` in `.env` |
| OAuth 1.0a User Context | Legacy; still required for `/2/media/upload` as of May 2026 |
| Basic Authentication | Enterprise APIs only |

### OAuth 2.0 PKCE specifics

- **Authorize URL:** `https://x.com/i/oauth2/authorize`
- **Token URL:** `https://api.x.com/2/oauth2/token`
- **Revoke URL:** `https://api.x.com/2/oauth2/revoke` (used in `src/auth.ts::revokeToken`)
- **Access token TTL:** 2 hours
- **`offline.access` is mandatory** for a refresh token. Without it, the user re-auths every 2h.
- **Refresh-token rotation:** X rotates the refresh token on **every** refresh. Persist the new one before returning the access token, or you lock the user out permanently. (See `src/token-store.ts::getValidAccessToken`.)
- **Confidential vs. public clients:**
  - *Web App / Automated App / Bot* (what we use) = confidential — has a Client Secret, uses Basic auth header on the token endpoint.
  - *Native App / SPA* = public — no secret, PKCE alone.

### Full OAuth 2.0 scope list

```
tweet.read, tweet.write, tweet.moderate.write,
users.email, users.read,
follows.read, follows.write,
space.read,
mute.read, mute.write,
like.read, like.write,
list.read, list.write,
block.read, block.write,
bookmark.read, bookmark.write,
dm.read, dm.write,
media.write,
offline.access
```

This repo currently requests a subset (see `SCOPES` in `src/auth.ts`). `users.email` and `dm.read` / `dm.write` are NOT requested by default — add them only if needed; X may require additional review.

---

## What this means for `bun run play`

The default playground (`src/playground.ts`) calls:

1. `getMe()` → 1 user resource on owned read = **$0.001**
2. `searchRecent('from:elonmusk -is:retweet', { maxResults: 3 })` → up to 3 third-party post reads = **3 × $0.005 = $0.015**

Total worst case: ~$0.016 per run, dedup-resetting at 00:00 UTC. The commented-out `createPost` would add another $0.015 (or $0.20 with a URL).

**You need credits in the Developer Console before any of this works** — there is no free allowance under the new model. Minimum credit purchase amount isn't published on the docs page; check console.x.com → *Billing*.

---

## Recent changes worth knowing

- **2026-04-20** — owned reads dropped to $0.001 per resource (previously bundled into the $0.005 read price). The owned-read discount is what makes self-monitoring affordable.
- **2026-02-06** — Pay-per-use launched as the default model; tiered Free / Basic / Pro plans deprecated.

---

## Sources

- <https://docs.x.com/x-api/getting-started/pricing> — authoritative pricing table
- <https://docs.x.com/x-api/introduction> — model overview ("pay-per-usage, no subscriptions")
- <https://docs.x.com/resources/fundamentals/authentication/overview> — auth method matrix
- <https://docs.x.com/resources/fundamentals/authentication/oauth-2-0/authorization-code> — OAuth 2.0 PKCE details
- <https://docs.x.com/x-api/fundamentals/rate-limits> — rate-limit ceilings
- <https://docs.x.com/changelog> — recent platform changes
- <https://devcommunity.x.com/t/x-api-pricing-update-owned-reads-now-0-001-other-changes-effective-april-20-2026/263025> — Apr 20 2026 owned-reads update announcement
