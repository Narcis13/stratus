# Cost-Audit Follow-ups (CA) — mention inbox completeness + honest cost ledger

- **Status:** planned 2026-07-23 · not started · **URGENT — jump the queue; both land before the next 03:00 UTC pass. Do CA.1 and CA.2 in one session if budget allows; they touch disjoint files.**
- **Source:** the 2026-07-23 cost audit (this session). The console showed X spend climbing from ~$0.12/day to ~$0.30/day starting Jul 18. Root cause was benign — reply volume 10×'d (8→90 manual replies/day from Jul 17), and the daily pass scales linearly. **Fix 1 (discovery pull = snapshot, killing the per-tweet double-read) and fix 2 (replies out of the winner re-read) already shipped in the same session** — see `docs/PHASE-HISTORY.md`. This plan is the two findings that were deliberately deferred: one data-loss bug, one measurement bug.
- **Goal fit:** goal 2 (tracking). CA.1 keeps the mention inbox from silently dropping mentions; CA.2 makes `/cost/today` and `/cost/daily` trustworthy again so the next spend surprise is caught by our own numbers, not the X console.
- **Cost impact:** **CA.1 is $0** (`since_id` already caps the pull; paging past 50 only bills mentions that actually exist, which we would pay for the next day regardless — it pulls the spend forward one day, it does not add spend, and the 800-mention hard cap bounds it). **CA.2 is $0** (it only changes how we *count* reads we already make). Neither adds a recurring call.
- **Invariants touched:** #4 (one place to call X — both fixes stay inside `endpoints.ts` / `client.ts`, no new call sites), #5 (`max_results` caps cost, not `maxItems` — CA.1 must page WITHOUT widening per-request `max_results` beyond the existing clamp), #7 (a billed read must be unrepeatable — CA.1's `since_id` checkpoint advance stays after the rows are committed), plus the standing rule *nothing DOM-scraped writes `mentions`* (untouched).
- **Codemap sections relevant:** §3 (`x/endpoints.ts` `getUserMentions`, `x/mentions.ts` `pullMentions`, `x/client.ts` `xFetch`/`itemCount`, `x/pricing.ts`), §5 (n/a — server only), §7 (cost invariants), §9 (pricing table).

## Why / what changes for the user

**Finding A — the mention inbox is capped at 50 and silently drops the rest.** `getUserMentions` defaults `maxResults: 50` and `pullMentions` never pages past it. Production has returned **exactly 50 new mention rows every single day since Jul 14**, while real inbound volume ran 50–90/day (measured off `mentions.posted_at`). On any day with >50 mentions, the overflow is lost *permanently*: `pullMentions` advances the `since_id` checkpoint to the max tweet id it saw, so the dropped mentions sit below the next day's floor and are never fetched. Busy days silently lose the tail — and it gets worse as reply volume (and thus inbound) keeps scaling. Flat $0.05/day today because the cap is exactly what hides the problem.

**Finding B — our own cost ledger under-reports, which is *why* the X console diverged from `/cost/today`.** The audit found the console peaking near $0.60 on days our ledger logged $0.33. In June the two tracked closely; they only split in July. The likely mechanism: `defaultPostParams()` requests `expansions=referenced_tweets.id,author_id`, so every reply drags its **parent tweet — someone else's post** — into `includes.tweets`. `itemCount()` in `client.ts` counts only `data.length` and never sees the `includes` objects, so we under-count billable results. Pre-Jul-17 that was ~9 hidden objects/day; at 90 replies/day it's ~90, twice a day — the timing matches the divergence exactly. **CA.2 is instrument-first:** confirm the mechanism for $0 before changing any pricing, because the response body we already pay for carries the answer.

## Design

**No migrations. No new routes. No extension changes. Server-only, both tasks.**

**CA.1 — page the mention pull to a real ceiling.** Keep the per-request `max_results` clamp exactly as is (invariant #5); what changes is that `pullMentions` walks pages until either the `since_id` boundary is reached or a sane total ceiling (the 800-mention X hard cap) is hit. The steady-state incremental pull with a live `since_id` still returns a handful — the ceiling only bites on the first pull or a genuine >50-mention day. The checkpoint advance stays *after* the committed insert (invariant #7).

**CA.2 — count what we're billed for, in two steps.**
1. **Instrument ($0, ship first):** in `xFetch`/`itemCount`, additionally observe `includes.tweets?.length` (and `includes.users?.length` where relevant) and log it on the next few 03:00 passes — do NOT change `cost_usd` yet. Confirm the hidden-object count matches the console gap.
2. **Correct (only if step 1 confirms):** the cheaper, behavior-preserving fix is to stop paying for objects we don't use — drop `referenced_tweets.id` from the discovery/snapshot expansion set. We already persist `in_reply_to_tweet_id` from the tweet's own `referenced_tweets` *field* (present without the expansion), so nothing downstream breaks. If a reason to keep the expansion emerges, the fallback is to make `itemCount` bill `data.length + includes.tweets.length` so at least the ledger is honest. Pick the drop-the-expansion path unless the instrumentation shows a consumer needs the expanded parent objects.

## Decisions taken

1. **CA.1 pages but never widens `max_results`.** Invariant #5 is absolute: the per-request page size stays clamped to caller intent. Completeness comes from *more pages under the `since_id` boundary*, never from a bigger single request.
2. **The 800-mention X hard cap is the ceiling, and a first-pull with no checkpoint must still not walk all 800 by default.** The existing "deliberate 50 on a cold pull" reasoning stays for the *first ever* pull; incremental pulls (which always have a `since_id`) page to completion because the boundary makes that cheap and bounded.
3. **CA.2 is instrument-before-fix.** No `cost_usd` math changes until a real 03:00 pass logs the hidden-object count and it matches the console gap. We were burned before by pricing assumptions; confirm with the body we already bought.
4. **Prefer dropping the expansion over inflating the count.** Honest-and-cheaper beats honest-and-same-price. `in_reply_to_tweet_id` survives on the tweet field, so conversations/open-loops keep working.
5. **Neither task adds a recurring call or a table.** If CA.2 needs a place to stash the observed `includes` count for a day, log it — don't add a column.

## Done when

- [ ] On a simulated >50-mention day (fixture or `--live`), `pullMentions` inserts every mention above the prior `since_id`, not just the first 50, and advances the checkpoint to the true max only after the insert commits.
- [ ] `getUserMentions` per-request `max_results` is unchanged (still clamped); the completeness comes from pagination, verified by a test that counts pages vs `max_results`.
- [ ] A 03:00 pass logs `includes.tweets`/`includes.users` counts alongside `data.length` for the discovery/snapshot reads (CA.2 step 1), and the audit's console-vs-ledger gap is either confirmed or refuted in a one-line note in `docs/PHASE-HISTORY.md`.
- [ ] If confirmed: the fix lands (drop `referenced_tweets.id` from the metrics-read expansions, or bill `includes`), `/cost/today` for the next pass matches the X console within rounding, and no consumer of `in_reply_to_tweet_id` regresses (`bun run test` green).
- [ ] `bun run test` + `bun run typecheck` + `bun run lint` green; no migration, no route, no extension build needed.

---

## Task CA.1: page the mention inbox pull to completion  [server-only]
**Depends on:** none
**Session budget:** ~120 diff lines, 3 files (`x/endpoints.ts`, `x/mentions.ts`, a test)

**Read first:** `src/x/endpoints.ts::getUserMentions` (the `maxResults: 50` default + `pageSize` clamp — note the invariant-#5 comment), `src/x/mentions.ts::pullMentions` (checkpoint advance + insert order — invariant #7), codemap §7.5 and §9.1.

**Edit:**
- `src/x/mentions.ts` — page the pull until the `since_id` boundary or the 800 X hard cap, keeping the committed-insert-before-checkpoint-advance order. Cold pull (no `since_id`) keeps its bounded default.
- `src/x/endpoints.ts` — if needed, let `getUserMentions` accept a higher *total* ceiling while leaving per-request `max_results` clamped. Do NOT raise the page size.
- test — a fixture pull with >50 mentions above the checkpoint asserts all are inserted and per-request `max_results` never exceeded the clamp.

**Commit:** `fix(mentions): page inbox pull past 50 without widening max_results (CA.1)`

---

## Task CA.2: honest cost ledger — instrument, then correct  [server-only]
**Depends on:** none (parallel-ok with CA.1 — disjoint files)
**Session budget:** ~100 diff lines. Step 1 (~30) ships first and is $0.

**Read first:** `src/x/client.ts::itemCount` + the `onCost` path, `src/x/fields.ts::defaultPostParams`/`EXPANSIONS`, `src/x/pricing.ts` (per-result multiply), consumers of `in_reply_to_tweet_id` (`grep -rn inReplyToTweetId src`), codemap §9.

**Edit (step 1, ship alone):**
- `src/x/client.ts` — observe and log `includes.tweets?.length` / `includes.users?.length` next to `data.length` on X reads. No `cost_usd` change.
- verify against the next 03:00 pass; write the confirm/refute one-liner into `docs/PHASE-HISTORY.md`.

**Edit (step 2, only if confirmed):**
- Preferred: drop `referenced_tweets.id` from the expansion set used by the metrics reads (keep `in_reply_to_tweet_id` sourced from the tweet field). Fallback: bill `data.length + includes.tweets.length` in `itemCount`/`priceFor`.
- test — the expansion change leaves `inReplyToTweetId` populated on a reply fixture; the pricing change (if taken) bills the hidden objects.

**Commit:** `fix(cost): count expanded includes so the ledger matches the X console (CA.2)`
