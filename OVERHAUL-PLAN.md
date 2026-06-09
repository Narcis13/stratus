# stratus 2.0 — The Growth Engine Overhaul

> **Mission: 10,000 followers on X for @13_narcissus — without meaningfully raising X API spend, without violating X ToS, and without a single automated engagement.**
>
> This plan extends `PLAN.md` (Phases 1–5, all shipped) into the next milestone. It was produced from a full multi-agent audit of the codebase on 2026-06-10: every claim about current behavior below was verified against the actual source. On approval, fold the phase summaries into `PLAN.md`/`CLAUDE.md` and treat this file as the milestone spec.

---

## 0. The one-paragraph thesis

stratus already has the hard parts: a cost-guarded X client, a scheduler that posts like a human, a $0 DOM harvester, an empirically calibrated reply-targeting model (`replyBand.ts`, 55% vs 12% hit-rate), and a Grok reply drafter wrapped in a genuinely differentiated voice prompt. What it does **not** have is a closed loop. Nothing measures the one number the mission is about (own follower count — verified: `getMe` is wrapped but only `playground.ts` calls it), reply drafts are never joined to their outcomes, harvested CSVs dead-end in the Downloads folder, and the 60x-engagement format (original posts, per `evals/reply-eval-santoshstack-20260605.md`) has no drafting tool at all. **The overhaul is 80% closing loops over data we already pay for, 15% new authoring leverage, 5% new spend.** Almost everything below costs $0 in X API reads because the data is either already billed, already in Postgres, or captured by the DOM.

The growth flywheel this plan builds:

```
        DISCOVER                 DRAFT                   PUBLISH
   reply radar + bands  ─►  Grok in my voice   ─►  manual paste (replies)
   mention inbox             2 variants, idea       API publish (own posts,
   target roster             steer, band-gated      threads, self-replies)
        ▲                                                  │
        │                                                  ▼
        LEARN                                         MEASURE
   recalibrate bands     ◄─  outcomes join  ◄─   follower snapshots ($0.001/day)
   reweight pillars          best-time SQL        profile clicks (already free)
   extract templates         weekly digest        harvest ingestion ($0)
```

---

## 1. Where the code stands (verified 2026-06-10)

**Keep — these are assets, not debt:**

| Asset | Where | Why it matters for growth |
|---|---|---|
| `xFetch` single chokepoint + cost ledger | `src/x/client.ts`, `src/middleware/costTracker.ts` | Every new feature inherits billing, retries, rate-limit handling for free |
| Retire-before-snapshot dailyMetrics | `src/x/workers/dailyMetrics.ts` | $0.001/tweet once-only reads, incl. `user_profile_clicks` — the follow-precursor metric — already free |
| Publisher with jittered human-hour scheduling | `src/x/workers/publisher.ts` + `md_to_schedule.ts` | The posting cadence machine already looks human |
| Reply band model, eval-calibrated | `extension/src/replyBand.ts` + `evals/` | A working "what to reply to" classifier with measured 55%/12% hot/null hit-rates |
| Voice prompt (persona, pillars, anti-slop) | `src/x/replies/prompt.ts`, `reply prompt.md` | The moat: drafts a model can't fake without it |
| $0 harvester + voice library | `extension/src/harvester.ts`, `src/x/routes/voice.ts` | Free, ToS-defensible data capture with exact view/bookmark integers the API doesn't sell cheap |
| Reply Master manual-paste pipeline | `extension/src/content.ts`, `src/x/routes/replies.ts` | Policy compliance is structural: the status machine ends at a human pasting |

**The seven verified gaps the plan exists to close:**

1. **No follower history.** The 10k goal has no numerator anywhere in the system.
2. **Reply outcome loop open.** `reply_drafts.postedTweetId` exists, dailyMetrics snapshots every posted reply, but no query joins them. Band thresholds are calibrated on *someone else's* scraped week — `replyBand.ts`'s own header demands first-party recalibration.
3. **Harvest data dead-ends as CSV.** The richest $0 dataset never reaches Postgres.
4. **No original-post drafter.** Eval #2's biggest finding (originals ≈ 60x engagement/post vs replies) has zero tooling; `evals/week_x_posts.md` was hand-built outside the voice guardrails and contains fabricated biography.
5. **No threads.** Self-reply chains are explicitly policy-legal and the publisher can't do them (`publisher.ts:88` posts `{text}` only). The voice doc's own mechanics call for 3–8 tweet threads with links in the first reply.
6. **The live reply prompt is damaged.** `prompt.ts:219` tells Grok to "put the reply onto the system clipboard using the clipboard skill" (impossible over API — confirmation noise lands in stored drafts), the `<idea>` steer slot is hardcoded empty, and the eval-derived hardenings (forbidden openers, specificity gate, one-line bias) were never applied. Real cost is ~$0.006–0.01/draft, not the documented $0.0019.
7. **The machine has no pulse monitor.** A dead publisher silently kills the posting cadence; `/healthz` stays 200.

---

## 2. Phase 6 — Close the loops (measure + protect)

*Everything here is prerequisite to learning anything. Total new X spend: ~$0.002/day.*

### 6.1 Follower snapshots — the mission KPI ($0.001/day)

- New table `account_snapshots` in `src/x/db/schema.ts`: `id`, `snapshot_at`, `followers_count`, `following_count`, `tweet_count`, `listed_count`.
- One `getMe()` call appended inside the existing `runDailyMetrics` pass (the wrapper exists; `XUser.public_metrics` already carries all four counts).
- `GET /x/metrics/account` — the series + daily deltas, joined against that day's posts/replies counts so spikes are attributable.
- **This is the first thing to build. Without it the next 10,000 followers are unobservable.**

### 6.2 Reply outcomes — first-party calibration data ($0)

- `GET /x/replies/outcomes`: join `reply_drafts` (status `posted`) → `posts_published` → `metrics_snapshots` on `postedTweetId`. Surface per reply: views, likes, replies, **`user_profile_clicks`** (already captured free in `non_public_metrics` on the owned read).
- Stamp the band verdict into the data at capture time: `scrapePostContext()` in `content.ts` already computes signals for the badge — add `{band, views, replies, ageMin, vpm, bait}` to `PostContext` so every draft is a labeled training row.
- An eval script `evals/analyze-own-replies.ts` emitting the same crosstab as `analyze-santoshstack.ts`, but over my replies. Recalibrate `BAND` constants from it once ≥100 posted replies accumulate.

### 6.3 Harvest ingestion — stop throwing the data away ($0 X API)

- `POST /x/harvest/runs` + `POST /x/harvest/rows` (batched), new tables `harvest_runs` and `harvest_rows` (tweet_id, handle, mode, text, comments/reposts/likes/bookmarks/views, time, captured_at, run_id).
- Harvest tab gets a "Send to stratus" toggle (default on) — rows ship through the existing background `ApiRequest` path *alongside* the CSV download.
- Repeated harvests of the same tweet create new rows → **longitudinal view/bookmark curves for $0**, complementing the once-only API snapshot.
- Replies-mode rows reconcile against `reply_drafts` by `postedTweetId` (fallback: text+time match) — second outcome source, zero API reads.
- ToS posture unchanged: user-triggered, finite, human-paced, own-analysis only.

### 6.4 The Daily Brief — stratus becomes a coach ($0)

- `GET /x/brief`: one JSON for the side panel's new **Today** tab (becomes the default tab):
  - Follower count + 7-day delta and trend sparkline data.
  - Yesterday's posts/replies with their snapshot numbers; profile clicks leaders.
  - Today's scheduled posts (and gaps — "you have no post slotted for 18:00").
  - Reply quota progress (posted replies today vs 10–20 target) and 70/30 ratio for the week.
  - Today's spend from `cost_events` (X + Grok side by side).
- This is the "act as my growth coach" surface: open the panel, see exactly what to do next.

### 6.5 Protect the machine ($0)

- **Worker heartbeats in `/healthz`**: `startXWorkers` registers `lastPublisherTickAt` / `lastDailyMetricsRunAt`; `/healthz` flags staleness (>5 min / >25 h). A dead publisher must page the deploy check, not fail silently.
- **Publisher double-post hardening**: flip the row to a committed `publishing` state *before* the `createPost` call (same pattern family as retire-before-snapshot — billed side-effects must not sit upstream of repeatability).
- **Reject URL posts at schedule time** in `calendar.ts` (today they pass, then die at the scheduled minute — a silently lost posting slot). Composer already warns; the server must enforce.
- **SIGTERM handler** in `app.ts`: stop workers, drain in-flight tick, then exit — protects against the deploy-restart double-post window.
- **`GET /cost/daily?days=30`** + a soft budget watchdog (log loudly / flag when X spend crosses $0.15/day).
- `.env.example` gains the missing `SELF_X_USER_ID`, `XAI_API_KEY`, `DAILY_METRICS_ENABLED`; deploy.sh diffs server .env keys against it. Delete the legacy `.tokens.json` at repo root after confirming the Postgres row is live (it's a refresh token sitting on disk).

**Phase 6 smoke test:** morning panel shows follower count, yesterday's numbers, today's plan; kill the publisher process → `/healthz` goes degraded; harvest own profile → rows appear in Postgres; `GET /x/replies/outcomes` returns posted replies with profile clicks.

---

## 3. Phase 7 — Reply Engine 2.0 ("Reply Radar")

*Replies are the proven <10k growth lever (REPLY GUIDE: replies weigh 13.5–27x likes; reply-chains 75x). This phase makes the existing pipeline sharper, cheaper, and measurable. New X spend: ~$0.01–0.03/day (mentions). Grok: ~$0.04–0.15/day at 10–20 drafts.*

### 7.1 Prompt surgery (do this first — it's broken today)

- **Fix the Output section** of `REPLY_PROMPT_TEMPLATE`: replace the clipboard instruction with "Return ONLY the raw reply text, exactly as it should appear on X." Better: use Grok **structured outputs** (`{replies: [{text, angle}]}`) so parsing is mechanical.
- **Wire the `<idea>` steer**: add optional `idea` field to `POST /x/replies/generate`, substituted into the existing tag (Romanian seed in, English reply out — the prompt already handles this).
- **Two variants per call**, not one: the user picks the punchier one. One Grok call returning `{replies: [v1, v2]}` costs barely more than one variant and doubles selection quality. Each variant tagged with its angle (`extends` / `contrarian` / `debate`).
- **Apply the eval-validated hardenings** in the same commit (to both `reply prompt.md` and the embedded literal, plus a `bun:test` asserting they stay in sync):
  - Reply-specific forbidden openers ("Exactly", "True, but", "Sounds like", "Agreed"…) — 42% of the failed reference account's replies opened with agreement.
  - Hard specificity gate: server-side regex check (contains a digit OR first-person marker OR named tool) → one automatic regenerate on failure.
  - Bias to ONE punchy line; two only when the angle earns it.
  - Never fabricate a number or biographical detail.
- **Drop `maxOutputTokens` 2000 → 350** and lean on xAI prefix caching (the 17.5KB template is a stable prefix; `{{TWEET_CONTEXT}}` already sits at the end). Draft cost falls to ~$0.002–0.004.
- On "ask for a profile visit and follow": the data (and the voice doc's anti-bait rule) say *earned* profile visits convert and literal "follow me" asks read as slop. The drafts optimize for the curiosity click — and we now **measure** it per reply via `user_profile_clicks` (6.2). Add an optional `cta` register for rare, deliberate use.

### 7.2 The Radar — a worked queue instead of caught badges ($0)

The band badge already classifies every rendered tweet; today verdicts evaporate as you scroll past.

- Content script streams **hot/warm** sightings (url, author, text snippet, signals, band) to `chrome.storage` (capped ring buffer, session-scoped).
- New side-panel **Radar** section (inside Today tab): ranked queue of reply opportunities seen this session — sorted by band, then views-per-minute, then recency. Click → opens the tweet, Reply Master is one click away.
- Each queue entry shows "why" (`1.5k views · 8 replies · 22m · bait`) so judgment stays with the human.
- This is pure presentation of data the script already computes while the user browses normally. No new capture, no crawling, nothing unattended.

### 7.3 Server-side band gate ($0 — saves money)

- Move `replyBand.ts` to a shared package location (`src/shared/replyBand.ts`, re-exported into the extension build).
- `/x/replies/generate` computes the band from submitted context metrics; **refuses `null`/`skip` targets** (with an explicit `override: true` escape hatch). Eval #2's recommendation verbatim: don't spend a Grok call on a dead post — and don't spend the scarcer resource, a daily reply slot, either.

### 7.4 Target roster — the 2–10x list as data ($0)

- `voice_authors` already stores follower counts from the $0 profile scrape. Add `voice_author_snapshots` (handle, followers_count, captured_at) appended on every enrich instead of overwriting — author momentum becomes visible.
- `GET /x/voice/targets`: authors in the 2–10x-my-size band (uses my own follower count from 6.1!), sorted by momentum. The REPLY GUIDE's "private list of 10–20 top voices" becomes a living view instead of vibes.
- Panel shows it with "last replied to" (join against `reply_drafts.sourceAuthorUsername`) so neglected targets surface.

### 7.5 Mention inbox — the 75x chain, systematized (~$0.01–0.03/day)

Replying fast to people who reply to *you* is the highest-multiplier move in the playbook, and mentions are **owned reads at $0.001/result**.

- Wrap `GET /2/users/:id/mentions` in `endpoints.ts` (the `paginate` + `since_id` + clamp pattern drops straight in; scopes already granted). Add the pricing branch in `pricing.ts` in the same commit (unknown endpoints silently bill $0 today).
- Pull mentions inside the daily pass + an on-demand "refresh inbox" button (rate-limited client-side to a few per day).
- New `mentions` table + **Inbox** section in the panel: unanswered mentions, age-sorted, each with a one-click Grok draft (same voice pipeline, thread context included).
- Posting stays **manual paste** by default. The Feb 2026 policy has exactly one carve-out — replying to a tweet that @-mentions you — which would allow API-posting these specific replies. Treat that as a **verify-then-enable** flag (`MENTION_API_REPLIES=false` until a live test on one mention confirms self-serve eligibility); even then, every send stays behind a human "Send" click. No auto-replies, ever.

**Phase 7 smoke test:** browse X for 20 minutes → Radar queue holds ranked hot tweets; click one → two variant drafts with my idea steered in; null-band tweet → generate refuses; mention arrives → appears in Inbox with draft; `analyze-own-replies.ts` runs against real outcomes.

---

## 4. Phase 8 — Authoring 2.0 (originals, threads, templates)

*Originals carry ~60x engagement per unit vs replies (eval #2). This phase gives the 30%-originals side of the 70/30 doctrine the same tooling quality the reply side already has. New X spend: $0.015/extra post or thread segment — inside the existing posting budget.*

### 8.1 Original-post drafter — `POST /x/posts/draft` (Grok ~$0.01/draft)

- Reuses voice template sections 0–9 with a post-specific tail (not the reply tail): registers Plain/Spicy/Reflective per §8, hook patterns per §9, **pillar declared per draft**.
- **Few-shot from my own winners**: inject top-N own tweets by views/profile-clicks (from `metrics_snapshots` — already in Postgres, $0) as "this worked, sound like this" exemplars. The voice clone is grounded in *measured* performance, not taste.
- Optional `voiceTweetId` parameter: remix a saved swipe-file tweet's *structure* (see 8.3) with my topic. Never the content — the skeleton.
- Output lands as `draft` rows in the existing calendar; nothing posts without the human flipping it to `pending`. The `week_x_posts.md` workflow (28 posts hand-assembled outside the guardrails, fabricated bio included) becomes obsolete.

### 8.2 Threads — the missing legal format ($0.015/segment)

- Schema: `thread_id uuid` + `thread_position int` on `scheduled_posts`.
- Publisher: posts position 1, then chains `createPost` with `reply.in_reply_to_tweet_id` of the previous segment's returned id (self-replies are policy-legal; ~500ms between segments per the impl plan §6.3.4). One failed segment freezes the rest of the thread as `failed` for manual retry — never a half-posted thread re-posted from the top.
- **Link-in-first-reply automation**: composer affordance "move URL to first reply" converts a $0.20 URL post into $0.015 + $0.015 = **$0.030 (6.7x cheaper)** and matches the voice doc's own "no external link in tweet 1" rule. The calendar finally gets a safe way to ship links.
- Extension Composer grows a thread mode: segment list, per-segment char counter, drag to reorder, preview.

### 8.3 Template extraction — make the swipe file compound (Grok ~$0.005/saved tweet, one-time)

- `voice_tweets.scraped_html` was captured *exactly for this* and nothing reads it.
- On save (or backfill batch), one Grok structured-output pass per tweet: `{hookType, skeleton, lineBreakPattern, length, device}` — e.g. "contrast hook · short declarative · list of 3 · question close". Stored in new columns on `voice_tweets`.
- Voice tab gains filters ("show me stat-hook tweets > 500 likes" — likes from harvest rows once 6.3 lands) and a **Remix** button feeding 8.1.
- ToS note stays hard: templates are *structures* derived for personal analysis; drafts must transform, never reproduce, scraped content.

### 8.4 Best-time + pillar analytics ($0, pure SQL)

- `GET /x/metrics/best-times`: engagement by posted UTC hour × weekday, normalized by age-at-snapshot (store `age_at_snapshot` on new snapshots — the 03:00 pass reads tweets at 3–27h old and comparisons are currently biased). Composer suggests slots from it.
- `pillar text` column on `scheduled_posts` and `reply_drafts` (the prompt already defines the three pillars; the drafter sets it automatically). `GET /x/metrics/pillars`: which pillar earns views/profile clicks/follows. Monthly reweighting becomes a query, not a feeling.
- **Bounded winner re-read**: tweets whose day-1 views exceed a threshold get one extra day-7 snapshot (un-retire → retire-before-read per pass, cap 5/day = +$0.005/day) — learn which content compounds.

### 8.5 Resurface winners — manual-approve "re-up" ($0.015/use)

- Implement the missing self-quote gate in `createPost` (the docstring claims it; the code doesn't have it — verify `quote_tweet_id` is own via `posts_published`), then verify self-quotes work on self-serve with one live test.
- Panel action on a top post: "Quote it with a new take" (drafted by 8.1) — the Hypefury evergreen trick, human-approved each time, never scheduled blind.

**Phase 8 smoke test:** "draft 3 posts for pillar 2" → three register-distinct drafts in the calendar citing real biography only; schedule a 4-segment thread with a link → posts as a chain, link in reply 2, total cost $0.060; Voice tab filters by hook type; best-times endpoint returns a real heat map.

---

## 5. Phase 9 — Hardening & hygiene (continuous, mostly $0)

Ordered by what protects the mission, not by severity labels:

1. **Pricing truthfulness**: `costHint` plumbing through `xFetch` so URL-surcharge posts bill $0.20 (today the dashboard undercounts 13x) and owned single-tweet reads bill $0.001; `console.warn` when a 2xx call prices to $0 on an unmapped endpoint; same guard for unknown Grok models (today: silent $0).
2. **Reply/quote gates verify, not just gate**: pass the parent author id where known and compare to `selfXUserId` instead of trusting the caller.
3. **Locale-harden the metric regexes** in `harvester.ts`/`content.ts` (English-only today — non-English UI silently zeroes every metric and kills the band model); emit a loud `metrics_unparsed` event when an aria-label exists but parses to zero.
4. **Harvester robustness**: per-handle incremental cursor ("since last run" scope); record group position in replies mode (the `items[k-1]` pairing mislabels deep threads and self-threads — pollutes calibration data); formula-escape CSV cells (`^[=+\-@]`); content-shape columns (`hasPhoto`, `hasVideo`, `isQuote`, text length, line breaks) so "which formats earn views" is answerable.
5. **Extension consolidation**: collapse the two API clients (`sidepanel/api.ts` direct-fetch vs `bgClient.ts`) onto the background-routed one; `GET /x/posts/scheduled/:id` instead of list+find in Composer.
6. **Tests where the money is**: `app.request()`-based tests for bearer auth, CORS, `/cost/today` math, calendar URL rejection, thread chaining, band gate; sync-test for prompt.md ↔ embedded literal.
7. **Doc sync as a spend guard** (the audit found README/SKILL.md/PLAN.md still describing the dead 113-poll cadence — 113x the real cost — and dead paid voice routes an LLM operator could re-suggest): one pass aligning README §11–16/§25, `SKILL.md` workflow C, `references/endpoints.md`, `CLAUDE.md` cheat sheet (bookmark $0.005, Postgres token store), and folding this plan's phases into `PLAN.md`. Update `.claude/skills/stratus/` so the operator skill knows the new routes (brief, outcomes, targets, drafts, threads).
8. **Deploy**: run/print migration status before restart; stamp deployed git SHA into `/healthz`; move the hardcoded IP/domain to env.
9. tsconfig `include` gains `scripts/**/*` and `drizzle.config.ts`; `/healthz` stops echoing raw DB errors publicly.

---

## 6. Phase 10 (optional, gated) — Generated media

*The single most expensive feature here in complexity. Ship phases 6–8 first; revisit only if image-led posts prove out in a manual test.*

- **Reality check (verified)**: `/2/media/upload` still requires OAuth 1.0a (May 2026); stratus has OAuth 2.0 PKCE only; `scheduled_posts.media_ids` is inert; the xAI docs digest lists image *understanding* only — no generation model/price. So this is: OAuth 1.0a request-signing module (scoped to media upload only) + chunked INIT→APPEND→FINALIZE + media id expiry (~24h → upload at publish time, not schedule time).
- **Image source — deterministic, $0, on-brand**: render "dynamic content" cards locally (satori → resvg → PNG): weekly follower-curve cards from `account_snapshots`, "what I shipped this week" stat cards, thread cover cards with the hook line, quote-cards of my own best lines. No external image-gen API needed, nothing to license, perfectly reproducible. (An AI-image model can slot in later behind the same interface if one is worth it.)
- **Interim before OAuth 1.0a lands**: the panel renders + downloads the card; image posts get posted manually from the X composer (drafted text copied from stratus). Cheap validation of whether media posts even outperform — measured via dailyMetrics, of course.
- **Verify media-post pricing in the X console before building** — the cost table doesn't list a media surcharge, and "verify before trusting" is how this repo avoids its next $3.71 lesson.

---

## 7. Cost ledger — the whole plan against the wallet

| Feature | X API | Grok | Notes |
|---|---|---|---|
| Follower snapshot (6.1) | **+$0.001/day** | — | The mission KPI. $0.37/year. |
| Reply outcomes, brief, best-times, pillars, radar, targets, gate | $0 | — | Pure SQL/UX over already-billed or DOM data |
| Harvest ingestion (6.3) | $0 | — | DOM only |
| Mention inbox (7.5) | **+$0.01–0.03/day** | — | Owned reads $0.001/result, since_id-bounded |
| Reply drafts (7.1) | $0 | ~$0.002–0.004/draft after token cap + caching | 20/day ≈ $0.04–0.08/day xAI |
| Post drafter (8.1) | $0 | ~$0.01/draft | 4/day ≈ $0.04/day xAI |
| Template extraction (8.3) | $0 | ~$0.005/saved tweet, once | Backfill ~150 tweets ≈ $0.75 one-time |
| Threads (8.2) | $0.015/segment | — | A 4-tweet thread = $0.060; replaces, not adds to, post slots |
| Link-in-reply (8.2) | **−$0.17/link post** | — | The plan's only negative-cost feature |
| Winner re-read (8.4) | ≤ +$0.005/day | — | Capped 5/day |
| Self-quote re-up (8.5) | $0.015/use, manual | — | |
| Media (10) | TBD — verify price first | — | Gated phase |
| **Steady state** | **~$0.06–0.13/day X** (vs ~$0.05–0.10 today) | **~$0.05–0.15/day xAI** | X spend ceiling respected; xAI is the deliberate cheap lever |

---

## 8. ToS & policy charter (binding on every phase)

1. **No automated engagement, ever.** No auto-likes, auto-follows, auto-reposts, auto-replies. Every reply to another account is pasted and sent by a human hand. The `generated→copied→posted` status machine *is* the compliance boundary — no feature may bypass it.
2. **API posting only for own content**: scheduled originals, self-threads, self-replies, (verified) self-quotes. The mention carve-out (7.5) ships disabled until verified live, and even then sends only on explicit per-message human click.
3. **Capture is user-initiated, finite, human-paced, on-screen-only.** The harvester runs when clicked, on one profile, with pacing presets and a hard step cap. No background timers, no unattended runs, no bulk crawling, no new passive collection beyond what the user is already looking at.
4. **Scraped data is for personal analysis only.** It feeds my private analytics and structural template extraction. Drafts derived from it must transform structure, never reproduce content. Nothing scraped is republished, resold, or shared.
5. **Posting looks human because it is human-planned**: jittered minutes (never :00/:30), human-hour anchors, content written or approved line-by-line by me.
6. **The voice doc's §5 stance is product law**: zero engagement pods, zero engagement-bait, organic growth only — even though the evals proved pods "work" for others.

---

## 9. The operating doctrine — how I'd run this account to 10k

*The features above exist to serve this loop. Tools don't grow accounts; the loop does.*

**Daily (≈45 min total):**
- Morning: open Today tab → follower delta, yesterday's numbers, today's slots. Fill any empty slot from the drafter.
- 2× 15-min reply sessions while reading the feed normally: work the Radar queue top-down, 5–10 band-gated replies/session, idea-steered drafts, edit until they pass the "would I say this over coffee" bar, paste, mark posted.
- Inbox zero on mentions — reply-backs within ~2h trigger the chain multiplier.

**Weekly (~30 min, Sunday):**
- Schedule the week: 3–4 originals/day from the drafter (pillar-balanced, best-time slots), 1–2 threads.
- Read `outcomes`: which replies earned profile clicks → more of that angle. Which originals earned follows → more of that pillar/format.
- Harvest own profile (`today` scope each evening or `all` weekly) to keep longitudinal curves flowing.

**Monthly:**
- Recalibrate `BAND` from own outcomes once the sample allows.
- Reweight pillars from `/x/metrics/pillars`.
- Prune the target roster by momentum; add 3–5 rising authors met in the replies.

**Milestones (honest, not hockey-stick):** 0→1k is the grind phase — 90 days of the loop above, success metric = profile-clicks-per-reply trending up, not follower count. 1k→5k: threads + templates compound, replies stay 70%. 5k→10k: flip toward 50/50 originals, self-quote re-ups of proven winners, mention volume becomes the moat. Every transition is visible in `account_snapshots` — the chart this whole plan exists to bend.

---

## 10. Explicitly NOT doing (unchanged + new)

- Auto-posting replies to non-self tweets (policy + stance) — including any "post all drafts" batch button.
- API reads for the voice library (5x cost; DOM does it free).
- Follower-list sync, engagement pods, buying anything.
- Multi-tenant, queues/Redis, Chrome Web Store publishing.
- AI-image APIs before deterministic cards prove the format (Phase 10 gate).
- Unattended/scheduled harvesting — the harvester stays a hand tool.

## 11. Build order

```
Phase 6  (foundation)   6.1 follower KPI → 6.5 heartbeats/guards → 6.2 outcomes
                        → 6.3 harvest ingestion → 6.4 daily brief
Phase 7  (reply engine)  7.1 prompt surgery → 7.3 band gate → 7.2 radar
                        → 7.4 targets → 7.5 mention inbox (flag off)
Phase 8  (authoring)     8.1 drafter → 8.2 threads + link-in-reply
                        → 8.4 analytics → 8.3 templates → 8.5 re-up
Phase 9  (hardening)     woven through 6–8; doc sync lands with each phase
Phase 10 (media)         only after an image post wins a manual A/B
```

Each sub-phase ends runnable and smoke-tested, per house rules. One endpoint at a time, everything X-specific under `src/x/`, every new read clamps `max_results` and retires before it snapshots.

---

*When this plan is approved: add Phase 6–10 summaries to `PLAN.md`, update the `CLAUDE.md` phase block per phase shipped, and keep this file as the milestone's source of truth. The mission line at the top is the scope ceiling now: if a feature doesn't move @13_narcissus toward 10,000 followers under these constraints, it doesn't get built.*
