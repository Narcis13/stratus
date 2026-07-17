# Stratus Operator Manual

A complete, example-driven manual for operating **stratus** — the single-user X
(Twitter) growth machine — through its skill. Companion to `SKILL.md` (canonical)
and `EXPLAINER.html` (visual). Everything here reflects what is implemented on
the `next` branch as of 2026-07-17.

---

## Table of contents

1. [What stratus is](#1-what-stratus-is)
2. [Getting connected](#2-getting-connected)
3. [The five operator roles](#3-the-five-operator-roles)
4. [The doctrine](#4-the-doctrine)
5. [Feature guide with examples](#5-feature-guide-with-examples)
   - 5.1 [Calendar & scheduling](#51-calendar--scheduling)
   - 5.2 [Threads](#52-threads)
   - 5.3 [AI post drafting (Grok)](#53-ai-post-drafting-grok)
   - 5.4 [Self-quote re-ups](#54-self-quote-re-ups)
   - 5.5 [Content pillars](#55-content-pillars)
   - 5.6 [Metrics: brief, snapshots, best-times](#56-metrics-brief-snapshots-best-times)
   - 5.7 [The Playbook (measured feedback)](#57-the-playbook-measured-feedback)
   - 5.8 [The Sunday digest](#58-the-sunday-digest)
   - 5.9 [Reply drafting & the band gate](#59-reply-drafting--the-band-gate)
   - 5.10 [Batch replies & the Radar](#510-batch-replies--the-radar)
   - 5.11 [Reply outcomes](#511-reply-outcomes)
   - 5.12 [Mention inbox](#512-mention-inbox)
   - 5.13 [Conversations & open loops](#513-conversations--open-loops)
   - 5.14 [People CRM: roster, stages, dossier](#514-people-crm-roster-stages-dossier)
   - 5.15 [Follow-up queue, fans, icebreakers](#515-follow-up-queue-fans-icebreakers)
   - 5.16 [Voice library (swipe file)](#516-voice-library-swipe-file)
   - 5.17 [Target roster (2–10x)](#517-target-roster-210x)
   - 5.18 [Idea Inbox](#518-idea-inbox)
   - 5.19 [Channels (topic rooms)](#519-channels-topic-rooms)
   - 5.20 [Harvest ingestion](#520-harvest-ingestion)
   - 5.21 [Studio images & assets](#521-studio-images--assets)
   - 5.22 [Data explorer & read-only SQL](#522-data-explorer--read-only-sql)
   - 5.23 [MCP server](#523-mcp-server)
   - 5.24 [Cost dashboard](#524-cost-dashboard)
   - 5.25 [Raw Grok passthrough](#525-raw-grok-passthrough)
6. [The ten safety rules](#6-the-ten-safety-rules)
7. [Cost cheat sheet](#7-cost-cheat-sheet)
8. [Session playbooks](#8-session-playbooks)
9. [Output etiquette](#9-output-etiquette)
10. [Planned but not live](#10-planned-but-not-live)

---

## 1. What stratus is

Stratus does four things, all on a thin typed wrapper over X API v2:

1. **Schedule posts a week ahead** — calendar + 60 s publisher worker.
2. **Track metrics over time** on every published post — one once-only snapshot
   at the daily 03:00 UTC pass, then the tweet is retired.
3. **Stash other people's tweets** — a $0 DOM-scraped voice/swipe library.
4. **Know the people behind the handles** — the Circles CRM layer: relationship
   stages, conversations, follow-up queues, and a measured learning loop.

Hard scope ceiling: features not in service of those four don't exist. Crucially,
**stratus never auto-posts to other people** — every reply is drafted, the human
pastes it on X, and a PATCH closes the loop.

## 2. Getting connected

| Fact | Value |
|---|---|
| Base URL | `$STRATUS_BASE_URL`, defaulting to the always-on Hetzner instance (`https://stratus-narcis.duckdns.org`). Export `http://127.0.0.1:3000` only for local dev against `bun run start`. |
| Auth | `Authorization: Bearer $STRATUS_API_TOKEN` on everything except `GET /healthz` and `GET /explorer`. The token is `.env`'s `API_TOKEN`. Never echo it. |
| Helper | `bash .claude/skills/stratus/scripts/api.sh METHOD PATH [JSON\|@file]` — sources `.env` itself, prints body to stdout and `HTTP <status>` to stderr, exits non-zero on ≥400. |
| MCP | If the session has `stratus` MCP tools (`x_brief`, `x_playbook`, `x_person`, `x_query`, …), prefer them over curl. |

All examples below use the shorthand `api.sh` for the helper.

**Preflight (every session):**

```bash
# 1 — machine sanity (no auth). 503 => stop and surface staleWorkers.
curl -fsS "$STRATUS_BASE_URL/healthz"

# 2 — a 401 on any call means the bearer is wrong. Do not retry.

# 3 — Grok-backed routes need the server's XAI_API_KEY:
#     some refuse to mount (404), others answer 503 grok_not_configured.
```

`staleWorkers` in a 503 healthz means the publisher (stale >5 min) or the
dailyMetrics worker (stale >25 h) died — scheduled posts and metrics may
silently not happen until it's fixed.

## 3. The five operator roles

The ask picks the playbook (details in `references/coach.md` and
`references/circles.md`):

| Role | Trigger | What you do |
|---|---|---|
| **Coach** | "what should I do today?" | The six-read morning session → coach's brief + ≤5-action do-next list |
| **Editorialist** | "plan my week", "what should I post?" | Audit the queue, mine ideas/winners/structures, draft, slot by best-times |
| **Reply operator** | "let's do replies" | Ready radar drafts → owed conversations → neglected targets, quota-tracked |
| **Analyst** | "why did X work?", weekly review | Digest + playbook (sufficient cells only) + ad-hoc SQL |
| **CRM operator** | "who is @x?", "who should I DM?" | The dossier, follow-up queue, fans, icebreakers, manual events |

## 4. The doctrine

Every number stratus surfaces is measured against this strategy — coach to it,
don't invent another one:

- **70/30** — ~70% of output is replies, ~30% originals (`week.replyPct` in the brief).
- **10–20 quality replies/day** — the brief's `replyQuota`, paste-time counting.
- **Reply up, not sideways** — target authors at **2–10× my follower count**
  (`GET /x/voice/targets` is the live roster).
- **Reply early** — hot/warm band posts; the Playbook's `latencyEffectiveness`
  grades whether <15 min replies actually beat ≥1 h ones.
- **The 75× chain** — someone replying to *my reply* is the highest-value signal;
  chain loops rank at the very top of conversations and followups.
- **The launch window** — the first 30 min after an original decide its reach.
- **Profile visits** (`user_profile_clicks`) matter more than likes — the
  follow-precursor.
- **Links kill reach and cost 13×** — never a URL in a standalone post; use a
  thread tail ($0.030 total).
- **3–4 originals/day, minute-jittered** — anchors 3/day `[9,13,18]`,
  4/day `[8,12,16,20]` local, never `:00`.
- **Statistical discipline** — Playbook cells gate at n≥20/side, best-times top
  at n≥3, per-person angle preference at ≥3 measured, BAND recalibration at
  ≥100 and manual-only. An insufficient cell is "not enough data yet (n=…)",
  never advice.

## 5. Feature guide with examples

### 5.1 Calendar & scheduling

DB-backed CRUD over `scheduled_posts`; the publisher worker drains
`status='pending'` rows whose time has come every 60 s. Status lifecycle:
`draft → pending → publishing → posted` (worker) with `failed`/`cancelled`
side-exits. `posted`/`publishing` rows are worker-owned — PATCH/DELETE answer 409.

**Create one post** (UTC ISO 8601, jittered minute):

```bash
api.sh POST /x/posts/scheduled \
  '{"text":"shipping notes from the weekend","scheduledFor":"2026-07-20T06:14:00Z"}'
# → 201 with the row: {id, text, scheduledFor, status:"pending", ...}
```

**Create a draft** (no time yet — drafts may even hold URLs; the URL check
re-runs at promotion):

```bash
api.sh POST /x/posts/scheduled '{"text":"rough idea, polish later","status":"draft"}'
```

**List the week's queue:**

```bash
api.sh GET '/x/posts/scheduled?from=2026-07-20T00:00:00Z&to=2026-07-27T00:00:00Z&status=pending'
```

**Reschedule / cancel / retry / delete:**

```bash
api.sh PATCH  /x/posts/scheduled/$ID '{"scheduledFor":"2026-07-21T15:27:00Z"}'
api.sh PATCH  /x/posts/scheduled/$ID '{"status":"cancelled"}'          # soft
api.sh PATCH  /x/posts/scheduled/$ID '{"status":"pending","scheduledFor":"2026-07-22T06:08:00Z"}'  # retry a failed row
api.sh DELETE /x/posts/scheduled/$ID   # 204; 409 on posted/publishing
```

A row stuck in `publishing` means the X outcome is unknown (5xx/network
mid-call). It is locked and never auto-retried; the daily reconcile picks the
tweet up if it actually shipped. Leave it alone.

**Schedule a whole week from markdown** (the headline flow — full recipe in
`references/scheduling.md`). One tweet = one contiguous run of `> ` blockquote
lines; count must equal `slots × 7`:

```bash
bun run .claude/skills/stratus/scripts/md_to_schedule.ts \
  week.md Europe/Bucharest 2026-07-20 4 > /tmp/week.json
# refuses URLs and >280 chars; jitters minutes in [5,35]\{30}, distinct per slot
# column; converts local anchors to UTC DST-safely.

# preview EXACTLY what you'll submit (jitter is regenerated on rerun!)
jq -r '.[] | "\(.scheduledFor)  \(.text[0:60])"' /tmp/week.json

bash .claude/skills/stratus/scripts/schedule_week.sh /tmp/week.json
# OK 8e3e…  2026-07-20T05:14:00Z
# …
# Submitted 28, OK 28, failed 0
```

Always show the dry-run preview table and get approval before submitting, then
verify the queue back grouped by day.

**Media note** (S3 Studio marker — a human reminder, not a gate):

```bash
api.sh PATCH /x/posts/scheduled/$ID '{"mediaNote":"quote card v2 — paste manually with the visual"}'
```

### 5.2 Threads

One thread = one schedulable unit (2–25 segments). The head is a normal
pending row; tails land as `status='segment'` and the publisher posts them as
self-replies ~500 ms apart at $0.015 each. One failed/ambiguous segment freezes
the rest (`errorClass='thread_frozen'`) — the posted prefix is never re-posted.

The URL guard applies to **segment 1 only**: a link belongs in a tail
(link-in-first-reply — $0.030 total instead of the $0.20 surcharge).

```bash
api.sh POST /x/posts/threads '{
  "segments": [
    "the hook — no URL here",
    "the context, the numbers, the turn",
    "full writeup: https://example.com/post"
  ],
  "scheduledFor": "2026-07-22T15:22:00Z",
  "status": "pending"
}'
# → 201 {threadId, segments: [rows]}
```

Tails accept text edits only; schedule/status/delete go through the head
(delete cascades). `GET /x/posts/scheduled/:id` on any member returns the
`thread: [...]` siblings.

### 5.3 AI post drafting (Grok)

`POST /x/posts/draft` makes one Grok structured-outputs call (~$0.006) and
returns **three register-distinct drafts** — plain / spicy / reflective — that
land as `status='draft'` calendar rows with their pillar and register stamped.
Nothing posts until a human promotes a keeper.

```bash
# Steered draft, consuming an Idea-Inbox idea (backlink provenance for free)
api.sh POST /x/posts/draft '{
  "pillar": "ai-craft",
  "idea": "ce am invatat construind stratus saptamana asta",
  "ideaId": "<uuid-of-open-idea>"
}'
# → 201 {drafts:[rows], winnersUsed, model, costUsd}
# Romanian steer in, English drafts out.

# Structure remix from a saved voice tweet (structure only, never content)
api.sh POST /x/posts/draft '{"voiceTweetId":"1791000000000000000"}'

# Promote the keeper after reviewing with the user
api.sh PATCH /x/posts/scheduled/$DRAFT_ID \
  '{"status":"pending","scheduledFor":"2026-07-21T06:17:00Z"}'
```

Few-shot grounding uses the top-5 own posts by measured views; when the
Playbook's post guidance clears its n≥20 gate, the measured "structures that
work" line is appended server-side automatically.

### 5.4 Self-quote re-ups

Re-surface a proven winner (14–60 d old, ≥500 peak views) as a quote tweet of
yourself. The followups queue surfaces at most one `reup_candidate` per read.

```bash
api.sh POST /x/posts/reup '{"tweetId":"1791000000000000000"}'
# 404 not_own_tweet if it isn't yours. Drafts carry quoteTweetId; the publisher
# re-verifies ownership at post time (non-self quotes are policy-refused).
```

### 5.5 Content pillars

The editable taxonomy the drafter writes against (seeded
`ai-craft | builder-51 | unsexy-problems`). Editing a pillar's body changes how
Grok drafts.

```bash
api.sh GET  '/x/pillars?active=true'
api.sh POST /x/pillars '{"slug":"ai-ops","label":"AI ops","body":"…what this pillar is about…"}'
api.sh PATCH /x/pillars/ai-ops '{"body":"sharper definition"}'
api.sh DELETE /x/pillars/ai-ops       # 409 last_active_pillar if it's the only active one

# AI proposal — NEVER auto-saved; review, then POST/PATCH it yourself (~$0.003)
api.sh POST /x/pillars/draft '{"mode":"new","idea":"agentic coding war stories"}'
```

Replies can opt in to pillars via `applyPillars: true` on the generate routes.

### 5.6 Metrics: brief, snapshots, best-times

All $0 — pure SQL over already-billed snapshots.

**The daily brief** — the coach payload (follower KPI + conversion, pinned-post
watch, yesterday's numbers, today's schedule with best-times-scored gaps, reply
quota, quests + streak, 70/30 ratio, spend):

```bash
api.sh GET '/x/brief?tzOffsetMin=-180'    # JS getTimezoneOffset semantics: UTC−local; -180 = UTC+3
```

Reading order: follower delta → yesterday → `today.gaps` (each empty anchor
annotated `{hour, n, avgViewsPerDay, score, sufficient}`, highest-value hole
first) → `replyQuota` → `week` ratio → quests/streak → `pinnedWatch` → spend.
`metrics: null` on a row means "not measured yet" (the 03:00 UTC pass hasn't
read it), never "0 views". Reading the brief also upserts today's streak row —
opening it *is* how the day gets counted.

**Per-tweet and list metrics:**

```bash
api.sh GET /x/metrics/1791000000000000000        # snapshots for one tweet
api.sh GET '/x/metrics/posts?limit=50'           # my originals + latest snapshot
api.sh GET '/x/metrics/replies?limit=50'         # my replies + latest snapshot
api.sh GET /x/metrics/account                    # follower series w/ per-day activity
api.sh GET /x/metrics/pillars                    # performance by pillar
```

Each tweet is snapshotted **once** at the first 03:00 UTC pass after it lands,
then retired (plus at most one day-7 winner re-read when the first snapshot
cleared 500 views).

**Best times** (rank slots by measured value):

```bash
api.sh GET '/x/metrics/best-times?tzOffsetMin=-180' | jq '{measuredPosts, top}'
```

`top` is gated at **n≥3 posts per cell**; `avgViewsPerDay` (age-normalized) is
the number to rank by. Below the gate a cell is "no data", not advice.

**Reconcile** (pick up tweets posted manually from the X app — costs
~$0.001/tweet scanned, so mention it first):

```bash
api.sh POST /x/posts/reconcile '{}'
# → {scanned, discovered, snapshotted, retired, mentionsNew, rereadWinners, …}
```

### 5.7 The Playbook (measured feedback)

`GET /x/playbook` is every number the machine has learned about what works —
**every cell gated at n≥20 per side** (`sufficient: false` below it):

```bash
api.sh GET /x/playbook | jq '{guidance, angleEffectiveness: .angleEffectiveness.overall}'
api.sh GET '/x/playbook?minN=5'    # exploration knob; guidance.* always keeps the default gate
```

Sections: `angleEffectiveness` (by author-size bucket too), `pillarRegister`,
`structures`, `batchVsSingle`, `bandCalibration`, `relationshipLift`,
`mediaEffectiveness`, `ideaEffectiveness`, `latencyEffectiveness` (early-vs-late
lift), `rosterCoverage` (2–10x in-band verdict over the trailing 7 d), and
`guidance.reply`/`guidance.post` — the exact one-liners injected into drafting
when gated. Quote them verbatim when coaching.

**Extract winners** (fills `structures` from your own top posts):

```bash
api.sh POST /x/playbook/extract-winners '{"limit":20}'
# ≤20/call ≈ $0.10 max; rerunning skips already-extracted rows.
```

### 5.8 The Sunday digest

The week's facts (pure SQL, $0) + one Grok-narrated coach note (~$0.01),
**cached per Monday-week**:

```bash
api.sh GET '/x/digest?tzOffsetMin=-180'                  # current week; narrates once, then cached
api.sh GET '/x/digest?week=2026-07-06&tzOffsetMin=-180'  # a past week
api.sh GET '/x/digest?refresh=true'                      # re-spend for a rewrite (only if asked)
api.sh GET '/x/digest?factsOnly=true'                    # $0 always (what MCP forces)
```

A missing XAI key degrades to `{narrative: null, narrativeError:
"grok_not_configured"}` — facts always come back, never a 5xx. The narrative
may only narrate the facts block; if it names a number the facts don't hold,
that's a bug.

### 5.9 Reply drafting & the band gate

`POST /x/replies/generate` sends one Grok call and persists the draft to
`reply_drafts`. **It never publishes** — the human pastes on X.

**The band gate:** the server recomputes the reply band *before* the Grok call
and refuses dead targets with `422 {error:"band_gate", band, signals}` — no
spend, no reply slot burned. `override: true` is the explicit escape hatch
(always required for mentions, whose metrics are zeros).

```bash
cat > /tmp/ctx.json <<'EOF'
{
  "context": {
    "tweetId":  "1791000000000000001",
    "handle":   "naval",
    "author":   "Naval",
    "text":     "Inflation is a hidden tax on cash holders.",
    "url":      "https://x.com/naval/status/1791000000000000001",
    "postedAt": "2026-05-12T10:00:00Z",
    "metrics":  { "views": 12000, "replies": 30, "reposts": 5, "likes": 240 },
    "topComments": []
  }
}
EOF
api.sh POST /x/replies/generate @/tmp/ctx.json
# → the reply_drafts row: replyText (first gate-passing variant) +
#   variants: [{text, angle:"extends"}, {text, angle:"contrarian"}] + costUsd
```

Optional knobs: `idea` (≤2000 chars — Romanian steer in, English out),
`ideaId` (consume an Idea-Inbox idea; a refusal or Grok failure leaves it
open), `applyPillars`, `systemPromptOverride` (persisted for audit;
`GET /x/replies/default-prompt` shows the default), `model`, `reasoningEffort`.
Server-stamped, never sent by you: `signals`, `relationship` (the C3 block),
`guidance` — they persist in `contextSnapshot` so every draft records exactly
what the model saw.

**Status flow** (a ratchet — bad transitions are `409 invalid_status_transition`):

```
generated → copied | posted | discarded
copied    → posted | discarded
posted    → discarded
discarded → ∅
```

```bash
api.sh PATCH /x/replies/$ID '{"replyTextEdited":"tighter version"}'   # original preserved
api.sh PATCH /x/replies/$ID '{"status":"posted","postedTweetId":"1791000000000099999"}'
```

**Always set `postedTweetId`** — it is the join key for outcomes, relationship
history, and the Playbook. (Harvest reconcile backfills missed ones, but don't
rely on it.)

### 5.10 Batch replies & the Radar

For a queue of hot/warm tweets, one Grok call drafts one reply each
(~$0.01–0.05 for 10–25 tweets). No band gate (pre-filter yourself), no
`reply_drafts` rows — replies persist to `radar_drafts` (status `ready`, 48 h
lazy expiry) so a browser restart can't lose paid-for output.

```bash
api.sh POST /x/replies/generate-batch '{
  "tweets": [
    {"tweetId":"1791000000000000010","handle":"somebuilder","text":"…full tweet text…","url":"https://x.com/…"},
    {"tweetId":"1791000000000000011","handle":"otherdev","text":"…"}
  ]
}' | jq '{count, requested, costUsd}'

# Work the queue afterwards — ready rows are PRE-PAID output; surface them first
api.sh GET '/x/radar/drafts?status=ready' | jq '.count, .drafts[0]'
api.sh PATCH /x/radar/drafts '{"tweetIds":["1791000000000000010"],"status":"clicked"}'
# ratchet: ready → clicked → expired; nothing moves backwards
```

For replies you want *measured* (targets, mentions, anyone in the CRM), prefer
single `/generate` + the `posted`+`postedTweetId` PATCH.

### 5.11 Reply outcomes

Did the replies work? $0 join of posted drafts → published posts → latest
snapshots:

```bash
api.sh GET '/x/replies/outcomes?limit=200' | jq '{count, measured, unlinked}'
```

Each row carries capture-time `signals` (band verdict), `sourceMetrics`, and
`outcome: {views, likes, replies, retweets, quotes, bookmarks, profileVisits}`.
`profileVisits` is the follow-precursor — the number to coach on. This is also
the BAND-calibration dataset (recalibrate only at ≥100 measured, manual-only).

### 5.12 Mention inbox

Mentions of me — owned reads at $0.001/result, pulled by the daily pass and on
demand (server cap **6 refreshes/day**).

```bash
api.sh GET '/x/mentions?status=unanswered'
api.sh POST /x/mentions/refresh '{}'          # 429 refresh_limit after 6/day

# Draft a reply to a mention: ALWAYS override (metrics are zeros) + parent context
api.sh POST /x/replies/generate '{
  "override": true,
  "context": {
    "tweetId":"1795000000000000123","handle":"replyguy","author":"Reply Guy",
    "text":"but how do you handle the token rotation?",
    "url":"https://x.com/replyguy/status/1795000000000000123",
    "postedAt":"2026-07-17T09:12:00Z",
    "metrics":{"views":0,"replies":0,"reposts":0,"likes":0},
    "topComments":[],
    "parent":{"text":"my original post text — the tweet below replies to it"}
  }
}'

# After pasting on X: settle the mention (this also settles the conversation loop)
api.sh PATCH /x/mentions/1795000000000000123 '{"status":"answered","draftId":"<draft-uuid>"}'
```

Never insert invented tweet ids into mentions paths — the max stored id IS the
since_id checkpoint for the incremental pull.

### 5.13 Conversations & open loops

The mention inbox rendered as ranked threads — exchanges, not tweets.
Recomputed on every read (no conversation table).

```bash
api.sh GET /x/conversations | jq '{counts, first: .threads[0]}'
```

- **Open loop** = an unanswered inbound with no post of mine after it
  (`owedSince` = oldest such inbound).
- **Chain** = the owed inbound replies to MY reply — the 75× moment. Chain
  loops rank at the very top. Never let one sit.
- Each thread carries the counterpart's stage chip (`person: {handle, stage}`).

```bash
api.sh PATCH /x/conversations/$CONVERSATION_ID '{"read":true}'
api.sh PATCH /x/conversations/$CONVERSATION_ID '{"snoozedUntil":"2026-07-18T09:00:00Z"}'
api.sh PATCH /x/conversations/$CONVERSATION_ID '{"muted":true}'
```

### 5.14 People CRM: roster, stages, dossier

One row per human the system has ever encountered. Handles are normalized
(lowercased, `@` stripped). Stages describe **reciprocity** and only ratchet up
automatically:

| Stage | Earned by |
|---|---|
| `stranger` | default |
| `noticed` | ≥1 saved tweet / saved author / hover sighting |
| `engaged` | ≥1 reply from me |
| `responded` | inbound after my first reply |
| `mutual` | ≥2 exchange days (a UTC day with both an inbound and an outbound) |
| `ally` | ≥4 exchange days in any rolling 60 d window |

```bash
# Roster with filters
api.sh GET '/x/people?stage=mutual&sort=last_inbound'
api.sh GET '/x/people?q=builder&limit=50'

# Lightweight tier map (stage ≥ engaged + targets roster)
api.sh GET /x/people/rankmap

# THE DOSSIER — the one-call answer to "who is @x to me?"
api.sh GET /x/people/somebuilder
# → person (stage, notes, tags, watermarks) + voiceAuthor + events timeline
#   + my replies to them WITH measured outcomes + per-angle crosstab
#   + their mentions of me + their tweets I saved + merged follower series

# Notes / tags / manual stage demote / retire
api.sh PATCH /x/people/somebuilder '{"notes":"met at the AI-tools thread; ships daily","tags":["ai-tools"]}'
api.sh PATCH /x/people/somebuilder '{"stage":"engaged"}'   # the only demote path

# Manual events — also the manual-add path for unknown handles
api.sh POST /x/people/newperson/events '{"type":"note","summary":"interesting take on agents"}'
api.sh POST /x/people/somebuilder/events '{"type":"manual_dm_logged","summary":"sent the collab DM"}'
```

Log `manual_dm_logged` whenever the user says they DMed someone — the
`dm_ready` queue depends on it.

When summarizing a dossier: stage + how it was earned, exchange counts, last
inbound/outbound, notes verbatim, best angle if gated (≥3 measured), then
timeline highlights. That's the prep sheet before replying or DMing.

### 5.15 Follow-up queue, fans, icebreakers

**The Do-next queue** — priority-ordered; coach in this order:

```bash
api.sh GET /x/people/followups
```

1. `chain_live` — unanswered mention <24 h that replies to MY reply. Answer NOW.
2. `dm_ready` — advanced to responded/mutual within 7 d: the DM moment (manual
   in X, logged back).
3. `neglected_target` — on the 2–10x roster, no outbound >7 d or ever.
4. `neglected_ally` — stage ≥ mutual, silent both ways 14 d.
5. `reup_candidate` — not a person: an own original 14–60 d old, ≥500 peak
   views, not already re-quoted. Cap 1 per read. Draft via `POST /x/posts/reup`.
6. `momentum` — heating-up accounts. Informational tail, never a push.

```bash
# Snooze ("not today") — person kinds key on handle, reup keys on tweetId
api.sh PATCH /x/people/followups '{"kind":"neglected_target","handle":"somebuilder","snoozedUntil":"2026-07-18T09:00:00Z"}'
api.sh PATCH /x/people/followups '{"kind":"reup_candidate","tweetId":"1791…","snoozedUntil":"2026-07-18T09:00:00Z"}'
```

**Top fans** — people who already notice you:

```bash
api.sh GET '/x/people/fans?days=30&limit=20'
# unacknowledged = never replied or >7d — the "acknowledge them" list
```

**Icebreakers** (~$0.005) — grounded or refused, in this order, all $0 refusals
before spend: `404 not_found` → `422 no_shared_context` (thin dossier — go
build real context, don't retry) → `503 grok_not_configured`:

```bash
api.sh POST /x/people/somebuilder/icebreakers '{}'
# → {icebreakers: {reply, dm}, grounding, costUsd} — grounding is exactly what
#   the model saw; nothing persisted, sending stays manual.
```

### 5.16 Voice library (swipe file)

Other people's tweets kept for style/structure reference. **Pure DOM-scrape, $0
— no X API ever.** Rows are normally created by the Chrome extension ("Save to
stratus" on a tweet, "Save author" on a profile), not the CLI.

```bash
# Query the stash
api.sh GET '/x/voice/tweets?author=naval&limit=20'
api.sh GET '/x/voice/tweets?q=leverage&limit=50'          # substring search
api.sh GET '/x/voice/tweets?hook=stat&extracted=true'     # by extracted structure
api.sh GET /x/voice/authors                               # authors + tweetCount

# Curate
api.sh PATCH /x/voice/tweets/$TWEET_ID '{"retired":true}'          # soft archive
api.sh PATCH /x/voice/tweets/$TWEET_ID '{"addTags":["ai-tools"]}'  # channel tags (additive, race-safe)
api.sh DELETE /x/voice/authors/naval    # 409 author_has_tweets until its tweets are gone

# Template extraction (Grok, ~$0.005/tweet, one-time; structure only, never content)
api.sh POST /x/voice/tweets/$TWEET_ID/extract
api.sh POST /x/voice/extract-batch '{"limit":20}'   # ≤50/call ⇒ ≤$0.25 worst case
```

Never reintroduce an X-API read to "pull" someone's tweets — other-user reads
cost 5× owned reads; that capability was deliberately removed. Point the user
at the extension.

### 5.17 Target roster (2–10x)

The REPLY GUIDE's "private list of 10–20 top voices" as a live $0 view — voice
authors banded to 2–10× my follower count, ranked by momentum (followers/day
across enrich snapshots):

```bash
api.sh GET /x/voice/targets | jq '{myFollowers, band,
  top: [.targets[0:10][] | {handle, followersCount, ratio, momentum, lastRepliedAt, postedReplies}]}'
```

`lastRepliedAt` amber-flags neglected targets (never, or >7 d). Momentum
accrues from profile enrichment — re-enriching an author every week or two
(extension "Save author") keeps the series alive. `band: null` until the first
daily account snapshot exists.

### 5.18 Idea Inbox

Ideas survive their first use — capture anywhere, consume in a draft, keep the
provenance.

```bash
api.sh POST /x/ideas '{"text":"thread: the 13x URL surcharge war story","tags":["build-in-public"]}'
api.sh GET '/x/ideas?status=open'
api.sh GET '/x/ideas?q=surcharge'
```

**Prefer implicit consumption**: pass `ideaId` to `/x/posts/draft`,
`/x/posts/reup`, or `/x/replies/generate` — the server consumes after its
insert (a refused or failed call leaves the idea open), and the backlink is
free content archaeology. Only PATCH manually for hand-written posts:

```bash
api.sh PATCH /x/ideas/$ID '{"status":"consumed","consumedByTable":"scheduled_posts","consumedById":"<row-uuid>"}'
api.sh PATCH /x/ideas/$ID '{"status":"open"}'    # reopen clears provenance
```

The Playbook's `ideaEffectiveness` cell eventually answers whether the inbox
pays (idea-seeded vs unseeded medians, gated n≥20/side).

### 5.19 Channels (topic rooms)

A channel = tags + a saved view (never a schema fork). Slug is immutable;
keywords drive $0 auto-suggest; an optional pillar link pulls in own-post
performance.

```bash
api.sh POST /x/channels '{"slug":"ai-tools","label":"AI tools","keywords":["cursor","claude code","copilot"],"pillar":"ai-craft"}'

# THE ROOM — your whole position in a topic on one screen
api.sh GET /x/channels/ai-tools
# → {channel, people (tagged + stages), voiceTweets, ideas (open), radarDrafts,
#    posts: own posted tweets in the mapped pillar + medianViews/medianProfileVisits}

api.sh PATCH /x/channels/ai-tools '{"keywords":["cursor","claude code"]}'
api.sh DELETE /x/channels/ai-tools   # clean; orphan tag strings stay behind harmlessly
```

Tag things into the room: `addTags` on voice tweets (5.16), `tags` on people
(5.14), tags on ideas, `PATCH /x/radar/drafts/:tweetId/tags` for radar rows.

### 5.20 Harvest ingestion

$0 — rows arrive DOM-scraped from the extension's Harvest tab. Repeated
harvests of one tweet create new rows on purpose: the `(tweetId, capturedAt)`
series is the longitudinal engagement curve the once-only API snapshot can't
give.

```bash
api.sh POST /x/harvest/runs '{"handle":"@somebuilder","mode":"replies","scope":"since-last"}'
# → 201 {id, …}; then batched rows (≤500/call) from the extension:
# POST /x/harvest/rows {"runId":"<uuid>","rows":[…]}
api.sh GET '/x/harvest/runs?limit=20'
```

Replies-mode ingest silently reconciles against `reply_drafts`: exact match on
`postedTweetId`, else a text+time fallback that also **backfills the draft's
missing `postedTweetId`** — the systematic fix for drafts never PATCHed after
pasting.

### 5.21 Studio images & assets

Non-text imagery for the extension's Studio — generated backgrounds composited
UNDER canvas-rendered brand text (image models garble words).

```bash
# ~$0.02/image; HARD $0.50/day budget checked BEFORE the paid call → 429
api.sh POST /x/images/generate '{"prompt":"flat vector clouds over a data grid, no text, no letters","n":1}'
# → {images:[{dataUrl:"data:image/png;base64,…"}], costUsd} — always base64,
#   never a raw xAI URL (canvas-taint trap). Spend logs under platform 'xai'.

# Asset library (SQLite blobs, ≤2MB each)
api.sh POST /x/assets '{"pngBase64":"…","kind":"background","prompt":"clouds v1"}'
api.sh GET /x/assets                       # metadata only — never the blob
curl -s "$STRATUS_BASE_URL/x/assets/$ID/png" -H "Authorization: Bearer $STRATUS_API_TOKEN" -o bg.png
api.sh DELETE /x/assets/$ID
```

Posting an image stays a **manual paste** — the OAuth 1.0a media-upload wall
means stratus never attaches media via the API.

### 5.22 Data explorer & read-only SQL

Read-only **by construction**: a second `{readonly: true}` SQLite connection;
whitelist derived from the Drizzle schema; **`tokens` is excluded entirely and
rejected by name**.

```bash
api.sh GET /x/data/tables                          # whitelist + row counts + columns
api.sh GET '/x/data/reply_drafts?limit=20&sort=created_at&dir=desc&q=naval'

# The power tool — SELECT/WITH only, single statement, 500-row cap
api.sh POST /x/data/query '{"sql":
  "SELECT source_author_username,
          COUNT(*) n,
          AVG(CAST(json_extract(context_snapshot, '\''$.metrics.views'\'') AS INTEGER)) avg_views
   FROM reply_drafts WHERE status = '\''posted'\''
   GROUP BY 1 ORDER BY n DESC LIMIT 20"}'
```

Dialect notes: timestamps are epoch-ms integers
(`datetime(col/1000,'unixepoch')` to render); metrics live in JSON columns
(`json_extract(public_metrics,'$.impression_count')`); day bucketing via
`strftime`. `truncated: true` means the 500-row cap hit — say so when
reporting. Always state sample sizes.

For visual browsing, point the user at `GET /explorer` — the browser shell is
served without auth and prompts for the token client-side.

**Useful joins** (mirror what the routes do):

- Outcomes: `reply_drafts` → `posts_published` → newest `metrics_snapshots` on `postedTweetId`.
- Person timeline: `person_events` by handle.
- Longitudinal engagement: `harvest_rows` `(tweet_id, captured_at)` series.

### 5.23 MCP server

Any MCP client can interrogate the whole operation:

```bash
claude mcp add --transport http stratus "$STRATUS_BASE_URL/mcp" \
  --header "Authorization: Bearer $STRATUS_API_TOKEN"
```

16+ tools in three tiers, all $0 by construction:

- **Schema**: `x_list_tables`, `x_describe_table`, `x_query` — same
  SELECT-only / tokens-blind / 500-row rules as 5.22.
- **Curated**: `x_brief`, `x_playbook`, `x_person`, `x_followups`,
  `x_conversations`, `x_metrics_account`, `x_best_times`, `x_cost`,
  `x_search_voice`, `x_digest` (forces `factsOnly=true` — an MCP read never
  spends on narration).
- **Write** (never X-billed): `x_add_idea`, `x_add_person_note`,
  `x_draft_post` — status hard-coded to `draft`; no MCP call can ever reach
  the publisher. Only a human promotes draft → pending.

Tool count drifts upward as plans land — probe with `tools/list`, don't assume.

### 5.24 Cost dashboard

```bash
api.sh GET /cost/today          # UTC day, by platform + endpoint; budget flags
api.sh GET '/cost/daily?days=30'  # zero-filled series + budgets {x: 0.15, xai: 0.5}
```

Three platforms: `x` (soft $0.15/day — a crossing only logs a watchdog error),
`grok` (text tokens, unbudgeted), `xai` (images — the **hard** $0.50/day budget
that 429s generation before spending). Flag `overBudget` when reporting.

### 5.25 Raw Grok passthrough

For output that isn't a reply or post draft (brainstorming, rewriting,
summarizing) — no DB row beyond the cost event:

```bash
api.sh POST /grok/ask '{"prompt":"tighten this hook: …","reasoningEffort":"low"}'
api.sh POST /grok/ask '{"system":"you are a copy editor","messages":[{"role":"user","content":"…"}]}'
```

Otherwise prefer `/x/replies/generate` / `/x/posts/draft` so the output is
tracked and reopenable.

## 6. The ten safety rules

Violating these costs real money, breaks X policy, or corrupts the data every
measurement stands on (full text in `SKILL.md`):

1. **URL surcharge (13×)** — $0.20 vs $0.015. The API rejects pending rows with
   URLs (`400 url_in_text`); never look for a bypass. Cheap pattern: thread
   with the link in a tail ($0.030).
2. **Nothing auto-posts to other people.** Every reply flow drafts; the human
   pastes, then PATCHes `posted` + `postedTweetId`. MCP can only create
   `status='draft'` rows.
3. **Refuse-before-spend gates are features.** `422 band_gate` saves a Grok
   call on dead posts; icebreakers 404/422 before spending; images 429 at
   budget. Don't "fix" a refusal by hammering it.
4. **Rate/spend caps are real** — mentions refresh 6/day; drafter ~$0.006/call;
   extract-batch up to $0.25/call; reconcile ~$0.001/tweet scanned. Mention
   cost before bulk Grok operations.
5. **`scheduledFor` is UTC ISO 8601.** Convert from the user's local timezone;
   ask if ambiguous. Jitter minutes [5,35], never `:00`.
6. **The voice library is $0 DOM-only.** Never reintroduce an X-API read to
   "pull" tweets.
7. **`posted`/`publishing` rows are worker-owned** — PATCH/DELETE 409. Stuck
   `publishing` = unknown X outcome; the reconcile resolves it, never a manual
   retry.
8. **Statuses ratchet; ids are sacred.** Reply drafts
   `generated→copied→posted→discarded`; radar drafts `ready→clicked→expired`;
   person stages only auto-promote. Never insert invented tweet ids into
   mentions paths — the max stored id IS the since_id checkpoint.
9. **Honor the stat gates** — n≥20 playbook cells, n≥3 best-times, ≥100 band
   recalibration. Insufficient = "not enough data", never quoted advice.
10. **Always set `postedTweetId`** when flipping a reply draft to `posted` —
    everything downstream degrades without it.

## 7. Cost cheat sheet

| Operation | Cost |
|---|---|
| Brief, playbook, people, voice, conversations, followups, fans, radar, ideas, channels, SQL reads | $0 |
| Own-tweet snapshot (once-only) · account KPI · mention result | $0.001 each |
| One reply draft (2 variants; 2× on the automatic specificity retry) | ~$0.002–0.004 |
| Icebreakers · voice/winner template extraction (per tweet, one-time) | ~$0.005 |
| Post drafter / re-up (3 drafts per call) | ~$0.006 |
| Sunday digest narration (first open per week; facts always $0) | ~$0.01 |
| Batch replies (10–25 tweets, one call) | ~$0.01–0.05 |
| Publish one post / thread segment | $0.015 |
| One Studio image (hard $0.50/day budget) | ~$0.02 |
| Reconcile pass | ~$0.001 × tweets scanned |
| **URL in a standalone post (blocked by two guards)** | **$0.20** |

Standing budgets: X soft $0.15/day (log-only), xAI images hard $0.50/day
(429), mention refresh 6/day, extract-batch ≤$0.25/call.

## 8. Session playbooks

Condensed from `references/coach.md` — the order matters.

**Morning coach** (all $0): `GET /healthz` → `GET /x/brief?tzOffsetMin=` →
`GET /x/people/followups` → `GET /x/conversations` →
`GET /x/mentions?status=unanswered` → `GET /cost/today`. Deliver 3–5 sentences
of narrative + a numbered do-next list of ≤5 actions, hardest-deadline first
(chain replies > launch windows > gaps > drafting ahead > cleanup). Close with
the streak — praise kept ones; a broken one gets one neutral sentence.

**Reply shift**: `radar/drafts?status=ready` first (pre-paid output) →
conversations' owed loops (override + parent) → 2–3 neglected targets from
`voice/targets` (respect the band gate) → track against `replyQuota`, stop at
the top of the range → PATCH every posted reply with `postedTweetId`.

**Editorial planning**: audit `posts/scheduled` grouped by day (thin days,
pillar imbalance) → mine inputs cheapest-first (open ideas → top measured posts
→ gated playbook guidance → extracted structures → the re-up candidate) →
draft (`/x/posts/draft`, `/x/posts/reup`) → slot by best-times with jittered
minutes → balance pillars → verify the queue back as a table.

**Weekly review** (Sundays): digest → `metrics/account` → playbook (sufficient
cells only — one sentence of advice each) → people stage transitions →
`cost/daily?days=7`. Deliverable: 3 wins, 3 slips, next week's single focus.

**Account health**: healthz → cost today + 30d → failed/stuck scheduled rows
(surface `errorClass` + first line of `errorDetail`) → follower trend →
reconcile only if the user posted manually and wants it tracked now.

## 9. Output etiquette

- Calendars/queues render as tables grouped by day; dossiers and briefs as
  short narrative + bullet actions — never raw JSON dumps.
- Failures: `errorClass` + first line of `errorDetail`, not whole rows.
- After bulk writes: one-line totals (`Submitted 21, OK 21, failed 0`) + offer
  a verification read.
- Numbers with context ("34 profile visits — your best reply this week"),
  gates out loud ("too early to say which angle wins, n=11/20"), streaks
  praised before outcomes.
- A null metric means "not measured yet" (the 03:00 UTC pass), never "0 views".
- Never print the bearer token; shown commands use `$STRATUS_API_TOKEN`.

## 10. Planned but not live

`references/roadmap.md` lists the next wave — Me profile (`/x/me`), Niche
(doctrine knobs as data), reply lists, radar/reply unification, the AI layer
(DB-editable prompts + OpenRouter), guardrails (goals, activity monitor),
Harvest 2.0 (passive timeline capture), notifications capture, augmented X UI,
Authoring 3 / Studio 2. **None of those endpoints exist until their plan
ships** — probe with a single request first (404 = not deployed; fall back and
say it's planned). Every plan keeps posting manual; nothing in the roadmap adds
auto-posting.

---

*`SKILL.md` is canonical; this manual is the long-form companion. Update both
in the same commit when behavior changes.*
