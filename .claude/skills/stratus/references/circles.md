# Circles reference — people CRM, followups, fans, conversations, launch

The people layer: one row per human the system has ever encountered, an
auto-advancing relationship stage, a full interaction timeline, and the queues
built on top. Everything here is **$0** (pure SQL) except icebreakers (one Grok
call ~$0.005). Handles are normalized server-side (lowercased, `@` stripped).

**Routing trap:** `followups`, `fans`, and `rankmap` are valid usernames — those
static routes are mounted before `GET /people/:handle` on purpose. Nothing for
you to do, just don't be surprised that `/x/people/followups` isn't a dossier.

## The stage ladder

Stages describe **reciprocity**, and auto-recompute only ratchets UP. The sole
demote path is a manual `PATCH /x/people/:handle {stage}` (sticks until events
re-earn the rank).

| Stage | Earned by |
|---|---|
| `stranger` | default |
| `noticed` | ≥1 saved_tweet / saved_author / hover_sighting |
| `engaged` | ≥1 `my_reply` |
| `responded` | inbound (mention / reply-to-me) after my first reply |
| `mutual` | ≥2 **exchange days** (a UTC day with both an inbound AND an outbound) |
| `ally` | ≥4 exchange days inside any rolling 60d window |

Timeline-only events that never move stage: `harvest_seen`, `note`,
`manual_dm_logged` (and, per the notifications plan, future likes/reposts).

## Roster & dossier

### GET /x/people
Query: `stage` (invalid → `400 invalid_stage`), `tag` (exact match inside the
person's `tags`), `q` (case-insensitive LIKE on handle/displayName),
`sort` = `last_seen|last_inbound|last_outbound|first_seen` (default `last_seen`,
DESC), `retired=true` to include retired, `limit` (default 100, max 500).
Returns `{count, people: [...]}` — each row is the full people record plus
`inboundCount` (their_mention + their_reply_to_me), `outboundCount` (my_reply),
`eventCount`.

### GET /x/people/rankmap
`{count, map: {handle: {stage, isTarget}}}` — only handles worth tiering
(stage ≥ engaged, plus the 2–10x targets roster; a target with no people row
reads `{stage:'stranger', isTarget:true}`). Retired people never tier. Empty
until the first daily account snapshot exists.

### GET /x/people/:handle — THE DOSSIER
The one-call answer to "who is @x to me?". `404 not_found` for unknowns (offer
to start their file — see events below). Returns:

- `person` — full row (stage, notes, tags, watermarks).
- `voiceAuthor` — their voice_authors row or null.
- `events` — timeline, newest first, ≤500.
- `replies` — `{count, measured, outcomes}`: my posted replies to them with
  measured views/likes/replies/profileVisits.
- `angles` — per-angle outcome crosstab (which angle works on THIS person; the
  drafter uses it automatically at ≥3 measured).
- `mentions` — their mentions of me (≤100), `savedTweets` — their tweets I saved (≤50).
- `followerSeries` — merged voice (`source:'voice'`) + person (`source:'person'`)
  snapshots, ascending.

When summarizing a dossier: stage + how it was earned, exchange counts, last
inbound/outbound, notes verbatim, best angle if gated, then the timeline
highlights. That's the prep sheet before replying to or DMing someone.

### PATCH /x/people/:handle
Body (≥1 field, else `400 empty_patch`): `notes` (≤5000 or null), `tags` (≤25 ×
≤40 chars, deduped, or null), `stage` (the manual demote path), `retired`
(bool). Returns the updated row.

### POST /x/people/:handle/events
Manual timeline append — also **the manual-add path** (creates the person when
missing, source `manual`). Body: `type` = `note` | `manual_dm_logged`
(anything else → 400 with `allowed`), `summary` (≤500, required), `at`
(optional ISO). Returns `201 {person, event}`. Log a `manual_dm_logged` event
whenever the user says they DMed someone — the dm_ready queue depends on it.

### POST /x/people/sightings
Batch hover-capture ingest (the extension feeds this; ≤batch cap, fill-only
upserts, once/day/handle event + snapshot gates). You'll rarely call it by hand.

### POST /x/people/:handle/icebreakers (~$0.005)
Grok-drafted reply-style + DM-style openers, grounded STRICTLY on real shared
context (notes, bio, last exchanges, saved tweets, channel overlap). Refusal
ladder — $0 refusals before any spend, in order: `404 not_found` →
`422 no_shared_context` (thin dossier: don't retry, go build actual context) →
`503 grok_not_configured` → `429/502` upstream. Success:
`{handle, icebreakers: {reply, dm}, grounding, model, costUsd}` — `grounding`
is exactly what the model saw; show it if the user wonders where an opener came
from. Nothing is persisted; sending stays manual.

## Follow-up queue & fans

### GET /x/people/followups
The ranked "do next" queue. Returns `{generatedAt, myFollowers, counts: {total,
snoozed, byKind}, items: [{kind, handle, displayName, stage, reason, at,
tweetId?, url?}]}`.

Priority (highest first) — coach in this order:

1. `chain_live` — unanswered mention <24h that replies to MY reply (the 75×
   chain). Has `tweetId`+`url` to their reply. Answer these first, always.
2. `dm_ready` — advanced to responded/mutual within 7d: the DM moment. The DM
   is manual in X; log it back via `manual_dm_logged`.
3. `neglected_target` — on the 2–10x roster, no outbound >7d or ever.
4. `neglected_ally` — stage ≥ mutual, no exchange either way in 14d.
5. `reup_candidate` — NOT a person (`handle:''`): own original 14–60d old whose
   peak views cleared 500, not already re-quoted. Cap 1 per read. Draft via
   `POST /x/posts/reup {tweetId}`.
6. `momentum` — heating-up accounts (inflection ≥5%/wk, or about to enter the
   band). Informational tail, never a push.

One item per person (highest kind wins). Momentum recomputes at read time —
nothing here goes stale.

### PATCH /x/people/followups (snooze)
Body: `kind` (required), then `handle` for person kinds (key `<kind>:<handle>`)
**but `tweetId` for `reup_candidate`** (key `reup:<tweetId>`), and
`snoozedUntil` (ISO, or null to clear). Snooze 24h when the user says "not
today"; expired snoozes are ignored on read.

### GET /x/people/fans?days=&limit=
Top inbound engagers over a trailing window (default 30d, max 365; limit
default 20, max 100). `{days, count, fans: [{rank, handle, displayName, stage,
followersCount, inboundCount, lastInboundAt, lastOutboundAt, unacknowledged}]}`.
`unacknowledged` = never replied or >7d — those are the coach's "these people
already notice you, acknowledge them" list.

## Conversations & open loops

### GET /x/conversations?limit=
The mention inbox as ranked threads — no conversation table, regrouped on every
read (mention scan bounded to 500 newest). Returns `{counts: {threads,
openLoops, chains, unread}, threads: [...]}` — each thread interleaves my posts
and their mentions, and carries:

- **open loop** — an unanswered inbound with no post of mine after it;
  `owedSince` = oldest such inbound. Marking the mention answered/dismissed by
  hand settles the loop instantly.
- **chain** — the owed inbound replies to MY REPLY (75× moment).
- `person` — `{handle, stage, displayName}` chip for the counterpart.

Ranking: chain loops top, then plain open loops (oldest debt first), then
settled by latest activity. Snoozed/muted sink to settled and leave the counts.

### PATCH /x/conversations/:conversationId
`conversationId` is numeric (`400 invalid_id`). Body (≥1 field):
`read: true` (only true; stamps lastReadAt), `snoozedUntil` (ISO|null),
`muted` (bool). Returns the upserted meta row.

Working an open loop end-to-end: draft via `POST /x/replies/generate` with
`override: true` and `context.parent` = my post being replied to → user pastes
on X → `PATCH /x/mentions/:tweetId {status:'answered', draftId}` → the loop
settles.

## Launch Room ingest

### POST /x/launch/replies
Early repliers DOM-scraped in the first 30 min after a post fires (the
extension feeds this). ≤50/batch; malformed handles are skipped, not fatal.
Side effects: person upsert (source `launch`, fill-only) + `their_mention`
event with deterministic id `their_mention:mentions:<tweetId>` — shared with
the daily mention pull so nothing double-logs. **Never touches the `mentions`
table** (a DOM-scraped id would corrupt the since_id checkpoint). Returns
`{received, processed, skipped}`.
