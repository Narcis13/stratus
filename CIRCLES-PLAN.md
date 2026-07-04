# CIRCLES-PLAN.md — The People Layer & Warm Product build plan

> Status: ADOPTED (2026-07-02) — C0 + C1 shipped 2026-07-02; C2 + C3 + C4 + C5 + C6 shipped 2026-07-04; C7 is next.
> Companion to `PLAN.md` (which stays the canonical plan for
> the original three goals). Adopting this plan **amends the scope ceiling in `CLAUDE.md`**
> from three goals to four:
>
> 1. Schedule posts a week ahead
> 2. Track metrics over time on every published post
> 3. Stash other people's tweets (voice library)
> 4. **Know the people behind the handles — relationships, conversations, and the context
>    they give to every post and reply** ← this plan
>
> Nothing here touches goals 1–3 except to feed them better context.

---

## 0. The insight this plan is built on

A four-way audit of the codebase (server data model, extension capture surface, AI/prompt
layer, policy/cost envelope) produced one dominant finding:

**stratus knows tweets, but it doesn't know people.**

The system already touches dozens of humans a day and throws almost all of it away:

- Everyone who replies to me @-mentions me → they're **already in the `mentions` table**
  with authorId/username/name, at $0.001 owned reads already being paid. Never aggregated
  per person.
- Every Reply Master capture scrapes the **top ~10 commenters** (author, handle, text) into
  `PostContext` → sent to Grok, **never persisted**.
- Every "Save to stratus" synthesizes a hover and reads X's **hover card** (bio, followers,
  xUserId) → kept only when that specific save succeeds; every natural hover the user does
  while browsing is discarded.
- `reply_drafts.sourceAuthorUsername` records everyone I've replied to; `posts_published.
  inReplyToTweetId` + `conversationId` record the shape of every exchange. No table joins
  these into "my history with this person".
- `voice_author_snapshots` is a follower time-series per author — used once (targets
  ranking), never as relationship context.

Second finding: **the learning loop is open.** Every reply draft is a labeled training row
(band signals, angle, pillar, cost) and `/x/replies/outcomes` joins measured results — but
the prompts never see what worked. Angle effectiveness, pillar × register performance,
skeleton/hook conversion: all computable today with SQL, all unused.

This plan closes both gaps and wraps them in a product that feels warm: CRM mechanics for
relationships, Discord/Slack mechanics for conversations and community, and a feedback
loop that makes the drafting AI smarter every week — all without a single new category of
X API spend and without touching X's automation rules.

---

## 1. Constraint envelope (non-negotiable, inherited)

Everything below was re-verified against `PLAN.md`, `X-API-IMPLEMENTATION-PLAN.md`,
`REPLY GUIDE`, `RADAR-REVIEW.md` and the Feb 2026 policy notes before writing this plan.

**X ToS / policy:**
- No programmatic replies to non-self tweets (Feb 2026). Every reply in this plan stays
  **manual paste** — the machine drafts and contextualizes, the human posts.
- No auto-DMs, no auto-follows, no auto-likes, no auto-anything. "Follow-up engine" and
  "DM-ready" are *reminders rendered in the panel*, never actions.
- No mass synthesized hovering. Passive contact capture (§C6) reads only hover cards X
  renders because **the user hovered naturally**. The existing synthesized hover on an
  explicit "Save to stratus" click stays as-is (user-initiated, one card, existing
  behavior).
- No new crawling. All new people-data enters through surfaces that already exist:
  mentions pulls, DOM captures the user triggers, and the daily discovery pass.

**Cost:**
- Target: **$0 new recurring X API spend.** The people layer is a reorganization of data
  already collected. New Grok spend is bounded and per-click/per-week (icebreakers
  ~$0.005/call, Sunday digest ~$0.01/week, relationship block adds a few hundred
  variable-tail tokens to existing reply calls).
- No API reads of repliers/conversations. Conversation lookup via search is $0.005/result
  — **not used**. The mentions table (owned reads, $0.001) is the reply-back signal.
- Invariant #7 untouched: nothing here adds a billed read upstream of a repeatable path.

**Doctrine (the growth model this serves):**
- 70/30 replies/originals, 10–20 quality replies/day, band-gated.
- Target roster: 2–10x own follower band, momentum-ranked.
- The 75x chain: reply fast to people who reply to you — this plan finally builds the
  machinery for it (§C2 Open Loops, §C5 chain alerts, §C7 Launch Room).
- Recalibration gates stay: no BAND threshold changes below 100 measured outcomes; the
  Playbook (§C4) applies the same discipline (min sample sizes per cell before a stat is
  allowed to influence a prompt).

**Stack conventions (SQLite era):**
- `bun:sqlite` + Drizzle `sqlite-core`. Timestamps `integer({mode:'timestamp_ms'})`, JSON
  as `text({mode:'json'})`, booleans as `integer({mode:'boolean'})`.
- Sync transactions (`.all()`/`.get()`/`.run()`, no `await` inside), no `Date` binds in
  raw `sql``` templates.
- All new X-specific code under `src/x/`. Pure functions get bun:test suites. Each phase
  ends with a rerunnable `scripts/smoke-*.ts`.

---

## 2. Feature → phase map

| # | Feature (from the proposal) | Phase |
|---|---|---|
| 13 | Persist what's already captured (top comments, radar drafts) | C0 |
| 1, 2 | Circles CRM + person dossier | C1 |
| 5 | Threaded conversations + Open Loops | C2 |
| 10 | Relationship-aware reply drafting | C3 |
| 11 | The Playbook (closed learning loop) | C4 |
| 4, 8, 16 | Follow-up engine, Top Fans, momentum alerts | C5 |
| 3, 12 | Passive hover capture + Idea Inbox | C6 |
| 6 | The Launch Room | C7 |
| 7 | Channels | C8 |
| 14, 15, 9 | Streaks & quests, Sunday Digest, icebreakers | C9 |

Ordering rationale: C0 stops data loss immediately (tiny). C1 is the foundation every
later phase references. C2–C4 are the three highest-leverage payoffs. C5+ are the warm
product layers on top. Each phase is independently shippable and usable.

---

## Phase C0 — Stop the bleeding (persistence quick wins)

*Goal: three small changes so no more people/context data evaporates while we build C1.*

> **SHIPPED 2026-07-02.** Notes vs the plan below: (1) verified — `contextSnapshot` was
> never truncated server-side (only the prompt render caps at 10); a round-trip test now
> locks the contract. (2) `radar_drafts` landed with a `PATCH /x/radar/drafts` status
> route on top of the planned GET: clicks/dismissals mirror from the extension so worked
> rows don't resurrect at the next rehydrate; rehydration routes through the background
> (`stratus/radar-rehydrate`), keeping it the buffer's single writer. Expiry is a lazy
> status flip on GET. (3) as planned. See CLAUDE.md phase status for the full entry.

1. **Persist top comments.** `POST /x/replies/generate` already receives
   `PostContext.comments` (≤10 × {author, handle, text}) and discards it after the Grok
   call. Keep it: it already rides inside `contextSnapshot` — verify it's not stripped,
   and stop truncating it out. Zero schema change (`contextSnapshot` is JSON). The reply
   history becomes auditable ("what conversation did I walk into?") and C1 mines it.
2. **Radar drafts survive the browser.** New table `radar_drafts` (id PK, tweetId, url,
   handle, author, snippet, band, signals JSON, replyText, angle, drafted_at, status
   `ready|clicked|expired`, created_at). `POST /x/replies/generate-batch` inserts one row
   per returned reply (it currently persists nothing). Extension: on batch-draft success
   the background still attaches replies to the session ring buffer (unchanged UX), but
   the server now holds the copy; a `GET /x/radar/drafts?status=ready` route lets the
   panel rehydrate after a browser restart. Rows auto-expire (status flip, not delete)
   after 48h — a radar reply to a dead post is worthless anyway.
3. **Harvest cursor visibility.** Settings tab lists `harvest:cursor:*` keys with a Reset
   button each. Pure extension change; kills the silent-skip trap.

**Tests:** contextSnapshot round-trip keeps comments; radar_drafts insert on batch;
expiry helper pure-function test.
**Cost:** $0. **Done when:** browser restart → Radar queue rehydrates with drafted
replies; a reply draft row shows the comments it saw.

---

## Phase C1 — Circles: the people table + dossier

*Goal: one row per human the system has ever encountered, with an auto-advancing
relationship stage and a full interaction timeline. The foundation phase.*

> **SHIPPED 2026-07-02.** Notes vs the plan below: (1) event ids are
> deterministic (`type:ref_table:ref_id`, INSERT OR IGNORE) so the backfill and
> the live hooks share one idempotent id space — re-running either never
> double-logs. (2) A mention that replies to one of my published replies logs
> `their_reply_to_me` *instead of* (not in addition to) `their_mention` — one
> event per underlying row, cleaner timeline, same inbound weight in the stage
> engine. (3) "Two-way exchange day" is defined as a UTC day with ≥1 inbound
> AND ≥1 outbound event; ally = 4 such days inside any rolling 60d window
> (historical windows count — ratchet semantics). `harvest_seen` is
> timeline-only, it never advances a stage. (4) The stage ratchet is applied at
> recompute (`maxStage(current, computed)`): PATCH may demote, but the next
> qualifying recompute re-promotes. (5) `person_snapshots` exists but stays
> empty until C6 — voice enriches keep writing `voice_author_snapshots` only;
> the dossier merges both series. (6) Backfill skips `contextSnapshot.comments`
> (marked optional below) — commenters on someone else's post aren't
> interactions with me; C6 passive capture is the ambient path. (7) Extension
> shipped as a full People tab from day one (open question 1), with
> click-throughs from Targets/Radar/Inbox/Replies-editor/Voice and a
> "Start their file" manual-add for unknown handles (POST /events creates the
> person). See CLAUDE.md phase status for the full entry.

### Schema (`src/x/db/schema.ts`)

```
people
  handle            text PK (lowercase, no @)
  x_user_id         text nullable
  display_name      text
  bio               text
  followers_count   integer
  following_count   integer
  stage             text NOT NULL default 'stranger'
                    -- stranger | noticed | engaged | responded | mutual | ally
  stage_updated_at  integer(ts)
  notes             text            -- free-form CRM notes, human-written
  tags              text(json)      -- string[], used by Channels later (C8)
  source            text            -- first surface that created the row
  first_seen_at     integer(ts)
  last_seen_at      integer(ts)
  last_inbound_at   integer(ts)     -- their last mention/reply to me
  last_outbound_at  integer(ts)     -- my last posted reply to them
  retired           integer(bool) default false

person_events      -- append-only interaction log; the timeline IS the CRM
  id           text PK (uuid)
  handle       text NOT NULL references people(handle)
  type         text NOT NULL
               -- saved_tweet | saved_author | my_reply | their_mention |
               -- their_reply_to_me | hover_sighting | harvest_seen |
               -- note | manual_dm_logged
  ref_table    text     -- e.g. 'reply_drafts', 'mentions', 'voice_tweets'
  ref_id       text
  summary      text     -- one-line human-readable ("replied to their post about evals")
  at           integer(ts) NOT NULL

person_snapshots   -- follower series for non-voice people (voice_author_snapshots
  id / handle / followers_count / captured_at   -- stays untouched for voice authors)
```

`voice_authors` is NOT merged or migrated — a `people` row is upserted alongside it
(source `voice`), and the dossier route joins both. One human, possibly two rows in two
tables with different jobs (swipe-file vs relationship); the handle is the join key.

### Stage engine (pure, bun:tested)

`src/x/people/stage.ts::computeStage(events, now)`:

- `stranger` → `noticed`: any saved_tweet/saved_author/hover_sighting
- → `engaged`: ≥1 `my_reply`
- → `responded`: ≥1 inbound (`their_mention` / `their_reply_to_me`) *after* my first reply
- → `mutual`: ≥2 distinct two-way exchange days
- → `ally`: ≥4 two-way exchange days within 60d, OR manually pinned
- Stages only ratchet up automatically; a human can demote via PATCH. Recompute on every
  event insert (cheap — events per person are few).

### Backfill (one-shot script, $0, pure SQL over existing tables)

`scripts/backfill-people.ts`:
- `voice_authors` → people (noticed) + saved_author events
- `voice_tweets.authorHandle` → saved_tweet events
- `reply_drafts` (status posted) → my_reply events on sourceAuthorUsername
- `mentions` → their_mention events on authorUsername (+ their_reply_to_me when
  inReplyToTweetId points at one of my published replies)
- `harvest_rows` (replies mode) → harvest_seen on origHandle
- `contextSnapshot.comments` (from C0 onward) → optional light `hover_sighting`-grade rows
Then `computeStage` per person. Idempotent (INSERT OR IGNORE on a deterministic event id
derived from ref_table+ref_id+type).

### Live wiring (small hooks in existing code paths)

- `pullMentions` (src/x/mentions.ts): upsert person + their_mention event per new mention.
- `PATCH /x/replies/:id` → status `posted`: my_reply event.
- `/x/voice/scrape` and `PUT /x/voice/authors/:handle`: upsert person + event + snapshot.
- Harvest replies ingest: harvest_seen events (batched).

### Routes (`src/x/routes/people.ts`)

- `GET  /x/people` — list/filter (stage, tag, search, sort by last_inbound/last_outbound)
- `GET  /x/people/:handle` — **the dossier**: person row + full event timeline + my
  replies to them with measured outcomes (join reply_drafts → outcomes path) + their
  mentions of me + saved tweets of theirs + follower series (both snapshot tables) +
  per-angle outcome mini-crosstab (feeds C3)
- `PATCH /x/people/:handle` — notes, tags, stage override, retired
- `POST /x/people/:handle/events` — manual log entry (type `note` / `manual_dm_logged`)

### Extension

- New **People** tab (or a section under Today initially): stage-grouped list, search.
- Dossier view: timeline, notes editor, "their saved tweets", outcomes with them.
- Every handle rendered anywhere in the panel (Inbox, Radar, Targets, Replies history,
  Today leaders) becomes a click-through to the dossier. This is the "context card"
  everywhere.

**Tests:** computeStage matrix; backfill idempotency; dossier route shape.
**Smoke:** `scripts/smoke-people.ts` — throwaway person, events, stage walk, cleanup.
**Cost:** $0. **Done when:** clicking any handle in the panel answers "what's my history
with this person?" in one screen.

---

## Phase C2 — Conversations & Open Loops (Slack threads for X)

*Goal: stop rendering mentions as a flat list; render exchanges as threads, and surface
the ones where the last word is theirs.*

> **SHIPPED 2026-07-04.** Notes vs the plan below: (1) open-loop definition refined —
> an *unanswered* inbound with no post of mine after it; a mention marked
> answered/dismissed by hand settles the loop immediately, before daily discovery sees
> the pasted reply. (2) chain detection checks the owed inbound's `inReplyToTweetId`
> against `myReplyTweetIds` (all my published replies) *and* in-thread outbound reply
> rows, so a reply whose conversation_id discovery hasn't filled yet still flags.
> (3) mentions with null conversation_id get tweetId-keyed fallback threads — nothing
> drops out of the inbox. (4) snoozed/muted threads leave the actionable tier (counts +
> ranking); ranking is server-side: chains first, open loops oldest-debt-first, settled
> by latest activity. (5) the flat Inbox.tsx (already unrendered) was deleted; the
> threaded ConversationsSection renders at the Today tab's top slot, refresh budget and
> the §7.5 draft/copy/done flow carried over unchanged. Chain flag NOT yet observed on
> a real exchange (synthetic only, via scripts/smoke-conversations.ts) — watch the first
> live one. See CLAUDE.md phase status for the full entry.

- **No heavyweight conversation table.** `conversationId` already exists on both
  `posts_published` and `mentions`. `GET /x/conversations` groups the union by
  conversationId, ordered by latest activity: each thread = my posts + their mentions in
  that conversation, interleaved by postedAt. New tiny table `conversation_meta`
  (conversation_id PK, snoozed_until, last_read_at, muted) for Slack-style read state.
- **Open Loops view:** threads where the newest item is inbound (their mention) and no
  posts_published reply of mine comes after it → "yours is owed", sorted oldest-first,
  age-stamped. This generalizes the unanswered-mention inbox into *relationship debt*.
- **75x chain flag:** an open loop where the inbound item replies to **my reply** (not my
  original post) is flagged `chain` and sorts to the very top — that's the multiplier
  moment from the REPLY GUIDE, currently invisible.
- Extension: Inbox section becomes threaded (collapsible threads, unread markers from
  last_read_at, snooze). One-click Grok draft per open loop reuses the existing
  `/x/replies/generate` mention path (`override: true`, parent context) unchanged.
- Person link: every thread header shows the counterpart's stage chip (C1) and links to
  the dossier.

**Tests:** thread-grouping pure function (interleave + open-loop + chain detection).
**Cost:** $0 — reads tables the daily pass already fills.
**Done when:** the Inbox shows conversations, not tweets, and the chain flag has fired on
a real exchange.

---

## Phase C3 — Relationship-aware reply drafting

*Goal: the Reply Master prompt stops meeting everyone for the first time.*

> **SHIPPED 2026-07-04.** Notes vs the plan below: (1) no literal `{{RELATIONSHIP}}`
> token — the block rides as server-stamped `PostContext.relationship` /
> `BatchTweet.relationship` fields and `buildGrokInput`/`buildBatchGrokInput` append it
> at the variable tail (template + byte-sync test untouched, as planned); parseContext /
> parseBatchTweets never accept the field from the client, so a caller can't forge a
> history. Stamping into ctx before the insert makes `contextSnapshot` record exactly
> what the model saw, for free. (2) pure renderers live in
> `src/x/people/relationship.ts` (`renderRelationship`, `renderRelationshipBrief`,
> `pickAnglePreference`); the facts loader `loadRelationshipFacts` in people/store.ts
> (null when the person is unknown or has zero events); `buildAngleCrosstab` moved to
> `src/x/people/angles.ts` (routes/people.ts re-exports it). (3) angle preference is
> gated at ≥3 measured replies to this person (`MIN_MEASURED_FOR_ANGLE_PREFERENCE`) and
> picked by median profile visits, views as tie-break. (4) the single path looks up the
> relationship AFTER the band gate (a refused call never pays the read); batch does one
> lookup per distinct handle and carries the shared use-as-context instruction once, in
> the variable tail. (5) all lookups are best-effort — a people-layer failure yields a
> cold draft, never a failed one. "Done when" NOT yet observed live — watch the first
> mutual-stage reply build on the prior exchange. See CLAUDE.md phase status for the
> full entry.

- `buildGrokInput` / `buildBatchGrokInput` (src/x/replies/prompt.ts) gain an optional
  `{{RELATIONSHIP}}` block rendered **at the variable tail** (same pattern as the §8.6
  pillars opt-in — `reply prompt.md` / `REPLY_PROMPT_TEMPLATE` stay byte-identical, the
  sync test is untouched). Server-side, `/x/replies/generate` looks up the target handle
  in `people` and, when a row exists with ≥1 event, renders:
  - stage + exchange count ("4 prior exchanges, they replied back twice")
  - last exchange topic (summary line of the most recent my_reply/their_mention pair)
  - measured angle preference **only when ≥3 posted+measured replies to this person
    exist** (else omitted — same min-sample discipline as BAND recalibration)
  - my notes field verbatim (human-written context is the best context)
- Prompt instruction (inside the injected block, not the static prefix): "Use this as
  context and continuity — reference the running thread naturally if it fits; never
  recite it."
- `contextSnapshot` records the rendered relationship block, so outcome analysis can
  later measure whether relationship-aware drafts convert better (feeds C4).
- Batch path: same block per tweet, capped to 2 lines/person to protect the token budget.

**Tests:** renderRelationship pure function (empty person → empty string; sample gates).
**Cost:** ~few hundred extra input tokens per call on existing Grok spend (~+$0.0005).
**Done when:** a reply to a `mutual`-stage person visibly builds on the prior exchange.

---

## Phase C4 — The Playbook (close the learning loop)

*Goal: the measured-but-unused feedback signals become (a) a page the human reads and
(b) constraints the prompts consume. Insights stop living in a manually-run eval script.*

> **SHIPPED 2026-07-04.** Notes vs the plan below: (1) all six stats live in pure
> `src/x/playbook.ts`, loaders + `GET /x/playbook` (?minN=, default 20) in
> `src/x/routes/playbook.ts` (always mounted, $0). (2) own-winner templates land in a
> new `post_templates` table (not columns on posts_published) via
> `POST /x/playbook/extract-winners` — runtime XAI check → 503, bounded ≤20/call,
> skips already-extracted rows so re-running only picks up new winners; it reuses the
> §8.3 prompt/schema/cache-key verbatim (now exported from routes/voiceExtract.ts).
> (3) batch-vs-single attributes a published reply to the Radar only when BOTH the
> target matches a radar_drafts tweet AND the posted text equals the drafted reply
> (collapsed whitespace) — a draft-linked postedTweetId always wins; the rest count as
> `unattributed`. (4) guidance is server-stamped only: `PostContext.guidance` (persisted
> via contextSnapshot, so guided drafts stay distinguishable), a 5th arg on
> buildBatchGrokInput, `BuildPostDraftOptions.guidance` — all at the variable tail,
> templates + byte-sync tests untouched; loaders are best-effort
> (`loadReplyGuidanceSafe`/`loadPostGuidanceSafe` — a playbook failure never fails a
> draft) and always gate on the DEFAULT n≥20 even when the page is viewed at a lower
> minN. (5) extension got a **Playbook** tab (its own tab, not under Today); gated cells
> render the literal "insufficient data (n=…)". `scripts/smoke-playbook.ts` is the
> rerunnable $0 check. See CLAUDE.md phase status for the full entry.

- `src/x/playbook.ts` — pure aggregation over existing tables, each stat guarded by a
  min-sample gate (cell shows `insufficient data (n=7)` below threshold; default n≥20
  per cell, configurable):
  1. **Angle effectiveness:** variants[].angle of the posted variant × measured outcome
     (median profile clicks, views) — overall and by source-author size bucket.
  2. **Pillar × register scorecard:** scheduled_posts.pillar + drafter register ×
     outcome. (Requires stamping the chosen register on the draft row — add nullable
     `register` column to scheduled_posts, stamped by the drafter.)
  3. **Skeleton/hook effectiveness:** extract templates from my own winners (reuse the
     §8.3 voiceExtract pipeline on `posts_published` top rows, one-time ~$0.005/post,
     bounded ≤20) → hookType/device × outcome.
  4. **Batch vs single draft quality:** radar_drafts-originated (C0) vs Reply Master
     drafts × outcome.
  5. **Bait crosstab + band hit-rates:** the existing evals/analyze-own-replies.ts
     crosstab, served as JSON (script stays for deep dives).
  6. **Relationship lift:** outcomes with vs without the C3 relationship block.
- `GET /x/playbook` serves it; extension gets a **Playbook** view (under Today or its own
  tab): "your measured playbook", each stat with its n.
- **Feedback into generation:** `topAngles()` / `topStructures()` helpers inject a short
  data-informed guidance line into the drafter and reply variable tails ("measured: your
  contrarian replies to 10k+ accounts earn 2.1x median profile clicks — prefer it when it
  fits") — only when the gate passes. BAND thresholds remain **manual-only** per the
  ≥100-outcomes rule; the Playbook page shows the crosstab that justifies a hand edit.

**Tests:** each aggregation pure function on fixture rows; gate behavior.
**Cost:** $0 recurring (one-time ≤$0.10 for own-winner template extraction).
**Done when:** the Playbook page renders with real n's, and a gated guidance line appears
in a draft call's rendered prompt.

---

## Phase C5 — Follow-up engine, Top Fans, momentum alerts (CRM ops)

*Goal: the relationship layer starts telling you what to do today.*

> **SHIPPED 2026-07-04.** Notes vs the plan below: (1) the classifier is pure
> (`src/x/people/followups.ts`); routes in `src/x/routes/followups.ts`, mounted BEFORE
> peopleRouter because 'followups'/'fans' are valid usernames the `:handle` dossier
> route would otherwise swallow. (2) snoozes landed as the small `followup_snoozes`
> table (item_key `kind:handle` PK — the conversation_meta pattern, not tags).
> (3) **momentum is computed at read time inside GET /x/people/followups**, not in the
> nightly dailyMetrics pass — same $0 and the same queue line, but no stored flags to
> go stale (the C2 "no conversation table" discipline); inflection = latest ≥3d segment
> growing ≥5%/wk AND faster than the series before it, band entry = mutual+ people
> projected to cross 2x my size within 30d at their current followers/day. (4) one item
> per person (highest-priority kind wins) and a snoozed item doesn't hide the person's
> lower-priority items. `scripts/smoke-followups.ts` is the rerunnable $0 check. See
> CLAUDE.md phase status for the full entry.

- **Follow-up queue.** `GET /x/people/followups` computes, from people + events:
  - `chain_live`: inbound reply to my reply, < 24h old (also flagged in C2) — top priority
  - `dm_ready`: person just advanced to responded/mutual (stage_updated_at recent) — the
    REPLY GUIDE's "good reply + author replies back → DM" moment. Rendered as a
    suggestion; the DM is manual, in X, logged back via `manual_dm_logged` if the user
    wants the timeline complete.
  - `neglected_target`: voice/targets roster ∩ people where last_outbound_at > 7d
    (generalizes the existing Targets amber)
  - `neglected_ally`: stage ≥ mutual, no exchange in 14d
  - snooze per item (conversation_meta pattern, small `followup_snoozes` table or reuse
    tags)
- **Top Fans.** `GET /x/people/fans` — rank by inbound count (their_mention +
  their_reply_to_me) over trailing 30/90d, with "last acknowledged" (my last outbound to
  them). Panel section under Today: "people who already notice you", amber when a top-10
  fan is unacknowledged >7d.
- **Momentum alerts.** Nightly (inside the existing dailyMetrics pass, $0): scan
  person_snapshots/voice_author_snapshots deltas; flag people whose follower growth rate
  inflected upward (≥5%/week) and small mutuals about to enter the 2–10x band. Surfaced
  as a line in the follow-up queue, never a push.
- Today tab gets a compact **"Do next"** strip: chain-live items, then dm-ready, then
  neglected, capped at 5 — a queue, not a dashboard.

**Tests:** followup classifier pure function; fan ranking; momentum inflection helper.
**Cost:** $0. **Done when:** opening the panel in the morning answers "who do I owe, who
should I nurture, who's heating up" in one glance.

---

## Phase C6 — Passive contact capture + Idea Inbox

*Goal: the roster grows itself from natural browsing, and ideas stop dying after one use.*

> **SHIPPED 2026-07-04.** Notes vs the plan below: (1) hover_sighting events dedupe
> once/day/handle via the deterministic-id trick (`hover_sighting:hover:<handle>:<day>`
> + INSERT OR IGNORE, `src/x/people/sightings.ts`); person_snapshots points are gated
> once/day/handle too — momentum is followers/day, sub-daily points are resend noise.
> (2) The content script sends batches through the existing background ApiRequest
> channel (no new message type needed; the pure throttle/merge core is
> `extension/src/shared/sightings.ts`, bun:tested). Skeleton cards (all-null parse)
> are retried on later scans instead of being marked captured. (3) Idea consumption is
> SERVER-side on the paying path: /replies/generate and /posts/draft accept `ideaId`
> and consume after their insert (consumeIdeaSafe only advances `open`, never clobbers
> first provenance, never fails the draft); a band-gate refusal leaves the idea open.
> (4) The drafter's 3-draft batch backlinks the FIRST inserted row. (5) Reply Master
> carries the picked idea via a second storage key `replyMaster:ideaId`; both keys
> clear after a successful generate (the row is consumed — reopen is one click).
> (6) First-run note (open question 3) is a dismissible line atop the People tab.
> See CLAUDE.md phase status for the full entry; `scripts/smoke-c6.ts` is the
> rerunnable check ($0).

- **Passive hover capture.** Content script: when X renders a hover card because the
  **user hovered naturally** (no synthesized events beyond the existing explicit-save
  path), parse it (displayName, bio, followers, following, xUserId — parser already
  exists) and queue an upsert `{handle, card, seenAt}` through the background, batched
  and throttled like radar reports (2s flush, 60s per-handle resend). Server:
  `POST /x/people/sightings` (batch ≤50) upserts people (source `hover`), appends
  person_snapshots, logs hover_sighting events at most once/day/handle. A Settings
  toggle (`passiveCapture`, default ON) makes it opt-out.
- **Idea Inbox.** New table `ideas` (id PK, text, source_url, tags JSON, status
  `open|consumed|discarded`, consumed_by_table/consumed_by_id, created_at, updated_at).
  - Capture: panel quick-add; content-script context-menu "Send selection to stratus
    ideas" (selection text + page URL, $0 DOM); Romanian welcome.
  - Consume: Composer and Reply Master idea fields become dropdowns over open ideas
    (free-typing still allowed). Consuming stamps status + backlink — the current
    delete-after-one-use behavior of `replyMaster:idea` is replaced by explicit consume,
    and re-use is one click (a consumed idea can be re-opened).
  - Provenance: a published post whose draft consumed idea X shows "seeded by" in the
    calendar detail — content archaeology for free.
- Routes: `GET/POST/PATCH/DELETE /x/ideas`.

**Tests:** sighting throttle/merge (radar.ts pattern reuse); idea lifecycle.
**Cost:** $0. **Done when:** a week of normal browsing has grown `people` without a
single explicit save, and an idea typed on Monday seeds Thursday's post.

---

## Phase C7 — The Launch Room (first-30-minutes protocol)

*Goal: operationalize the doctrine's highest-leverage window — be present right after
posting — which nothing currently supports.*

- Extension background: on panel load and every 15 min, fetch today's pending scheduled
  posts; set `chrome.alarms` at each scheduledFor. At fire time (+90s grace for the
  publisher tick): chrome notification "«{text…}» just went live — open the Launch Room".
- **Launch Room view** (Today tab takeover for 30 min, dismissible): the posted tweet
  (postedTweetId from `GET /x/posts/scheduled/:id`), a big "open on X" button, elapsed
  timer, and a checklist frame: reply to every early commenter (manual, in X), pin your
  own first reply if the post is a link-in-first-reply thread.
- **Early replies feed, $0-first:** while the user has the tweet open, the content script
  already sees the replies in the DOM — stream them into the room (author, text) via the
  radar transport pattern. Optional assist: one `POST /x/mentions/refresh` (existing
  route, existing 6/day cap, ~$0.001–0.005) 20 min post-launch to catch repliers the user
  didn't scroll past. Each early replier: one-click Grok draft (self-thread replies to
  commenters on my own post are policy-clean to *draft*; posting stays manual paste),
  and an upsert into `people` (they engaged first — prime CRM material).
- Every early exchange logs person_events, so launch-window engagers accumulate stage.

**Tests:** alarm scheduling helper; DOM early-reply parser (fixture HTML).
**Cost:** ≤$0.005/launch, only when the user clicks the assist.
**Done when:** a scheduled post fires, the notification lands, and three early commenters
get human replies inside 30 minutes without the user having remembered on their own.

---

## Phase C8 — Channels (topic rooms over everything)

*Goal: topics become places. Pillars organize output; channels organize input + people.*

- New table `channels` (slug PK, label, color, sort_order, active) + the existing
  `tags` JSON columns on people/ideas (C1/C6) plus new nullable `tags` on voice_tweets
  and radar_drafts. A tag is a channel slug; a channel is a saved view.
- `GET /x/channels/:slug` aggregates: saved voice tweets tagged, people tagged (with
  stages), open ideas tagged, my posts in the pillar mapped to this channel (channels
  may declare an optional `pillar` link), recent radar drafts tagged, and that slice's
  outcomes.
- Extension: channel switcher rendered Discord-style (left rail or dropdown):
  `#ai-agents`, `#indie-smb`, `#claude-code`. Tagging affordances: on save-to-stratus
  (chip picker in the confirmation toast), in Voice/People/Ideas rows, on radar rows.
  Auto-suggest (pure, $0): keyword map per channel over tweet text, human confirms.
- Deliberately shallow: a channel is tags + a view, not a schema fork. If it doesn't
  earn its keep it deletes cleanly.

**Tests:** channel aggregate route shape; keyword auto-suggest helper.
**Cost:** $0. **Done when:** opening `#ai-agents` shows the people, swipe-file, ideas and
own-post performance of that topic on one screen.

---

## Phase C9 — Warmth: streaks, the Sunday Digest, icebreakers

*Goal: the daily rhythm and the coach's voice — what makes it a product, not a dashboard.*

- **Quests & streaks.** Extend `/x/brief` with a computed quest block (no new tables;
  all from existing rows): N quality replies (posted reply_drafts today), 1 original,
  2 neglected targets touched, 1 open loop closed, launch room attended. Streak =
  consecutive days all core quests hit; stored as a tiny `streaks` table (day PK,
  completed JSON) written by the brief route on read (idempotent per day). Today tab
  renders quest checkmarks + streak count. Tone: gentle, no red badges, no guilt copy.
- **Sunday Digest.** `GET /x/digest?week=` builds the week's facts (follower delta,
  playbook movers, stage transitions, top fan changes, neglected list, spend) and makes
  **one Grok call (~$0.01)** to write a short second-person narrative — the coach's
  voice: what worked, who moved closer, the one thing to change next week. Rendered in
  Today on Sundays (and on demand). Facts computed in SQL; Grok only narrates them —
  numbers are never invented (same discipline as the reply prompt's no-fabrication rule).
- **Icebreakers.** On any dossier or followup row: "Suggest an opener" → one Grok call
  (~$0.005) grounded strictly on real shared context (their saved tweets, channel
  overlap, past exchanges, my notes) proposing 2 conversation starters (reply-style and
  DM-style). Human sends manually. No fabricated familiarity: the prompt forbids
  referencing anything not present in the grounding block.

**Tests:** quest computation; digest fact-builder; icebreaker grounding renderer.
**Cost:** ~$0.05/week all-in at heavy use.
**Done when:** Sunday's panel reads like a note from a coach who watched your week.

---

## 3. New surface summary

**Tables:** people, person_events, person_snapshots, radar_drafts, conversation_meta,
ideas, channels, streaks (+ nullable columns: scheduled_posts.register, tags on
voice_tweets/radar_drafts).

**Routes:** /x/people (+/:handle, /followups, /fans, /sightings), /x/conversations,
/x/radar/drafts, /x/playbook, /x/ideas, /x/channels, /x/digest.

**Workers:** none new. Hooks ride existing paths (pullMentions, dailyMetrics, publisher
via extension alarms). No new polling loops — invariant preserved.

**Extension:** People tab + dossier, threaded Inbox, Do-next strip, Launch Room,
channel rail, quest strip, passive-capture toggle, idea quick-add.

## 4. Explicitly NOT doing (this plan)

- Auto-DMs, auto-follows, auto-likes, auto-posted replies of any kind — ever.
- Mass/synthesized hover crawling or any background scraping the user didn't cause.
- X API conversation/search reads for replier discovery ($0.005/result — mentions cover it).
- Follower-list sync ($40/mo-class — out, unchanged from PLAN.md).
- Sentiment scoring, lead scoring, or any CRM feature that pretends people are pipeline.
  Stages describe *reciprocity*, nothing else.
- Multi-tenant anything. One user, one wallet, one bearer.
- Merging voice_authors into people (different jobs; join by handle instead).

## 5. Open questions (all decided with C1, 2026-07-02)

1. Does `people` deserve its own extension tab from day one, or live under Today until
   C5 makes it operational? **DECIDED: tab from day one** — shipped in C1.
2. Stage thresholds (2 exchange-days → mutual, 4/60d → ally) are guesses — **DECIDED:
   ship as-is, revisit after 30 days of real events**, same spirit as the BAND ≥100 gate.
3. Passive capture default ON or OFF at first install? **DECIDED: ON** with a visible
   first-run note (lands with C6).
4. CLAUDE.md scope amendment: **DECIDED: landed with C0's commit** — the four-goal
   vision is expressed from the top of CLAUDE.md, per one-file-one-truth.

---

*Adopt phases in order; each ends usable. Update `CLAUDE.md` phase-status and this file
in the same commit when a phase lands — same discipline as PLAN.md.*
