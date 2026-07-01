# RELATIONSHIP-OS-PROPOSAL.md — turning stratus into a warm, relationship-first product

> Status: **proposal, not yet approved.** This is a deliberate scope expansion beyond
> the three goals in `CLAUDE.md` (schedule / measure / stash). Read the "Scope decision"
> section before building any of it. `PLAN.md` is still the canonical build plan; nothing
> here is committed until it lands there as a milestone.

---

## 1. The reframe

Stratus today is a **cold growth machine**: schedule → measure → optimize, with a voice
library bolted on. It treats X as a *content pipeline*.

But growth on X is a **relationships game**, and stratus already stores the raw material for
relationships — it just never joins it into a *person*:

- `voice_authors` (+ `voice_author_snapshots`) — people you track, with a follower-momentum series.
- `reply_drafts.source_author_username` — everyone you've drafted/sent a reply to.
- `mentions` (author_id / author_username) — everyone who has talked *to you*.
- `harvest_rows.handle` / `orig_handle` — people whose content and metrics you've captured.
- `posts_published` + `metrics_snapshots` — what each interaction actually earned (profile clicks!).

> **The move: promote "the person" to a first-class entity and build a personal CRM +
> community cockpit on top of it — a Relationship OS for X.** Most of it is *synthesis over
> data you already store and already paid for*, not new capture.

This proposal is one milestone (**Milestone R**) in seven phases (R1–R7), each shippable on
its own, each borrowing a proven idea from CRM / Discord / Slack / knowledge tools and bending
it to X growth — **without ever crossing the automation line.**

---

## 2. The compliance spine (non-negotiable, applies to every feature below)

Every feature in this document is designed to sit *inside* the walls stratus already respects.
Restating them because they gate the whole design:

1. **No programmatic replies to non-self tweets** (Feb 2026). Every reply to another account is
   Grok-drafted → **copied/typed by hand → sent by the human**. No batch-send, no auto-reply.
   The `generated → copied → posted` status machine on `reply_drafts` *is* the compliance boundary.
2. **No cross-account quote tweets.** Self-quotes only (verified against `posts_published`).
3. **No automated engagement.** Zero auto-likes / auto-follows / auto-reposts. Nothing in a
   "circle" or "pod" coordinates inauthentic amplification — the relationship ledger is *personal
   bookkeeping about genuine interactions*, never an ask to reciprocate on demand.
4. **Enrichment stays DOM-scraped and human-paced.** Person/profile/follow data comes from the
   extension reading the page you're already looking at — never from 5×-cost other-user API reads,
   never from a background crawler.
5. **No DM API.** DM "outreach prep" is draft-to-clipboard only; the DM API ($0.010/event, tight
   limits) stays out of scope.
6. **Cost discipline holds.** New reads are $0 (DOM-scrape or pure SQL over existing data). Grok
   spend is opt-in and per-action, tracked in `cost_events` like everything else.

If a proposed feature can't be built inside these six walls, it doesn't get built.

---

## 3. What we already have (asset inventory)

The point of listing this: **Milestone R is ~80% joins, ~20% new capture.**

| Asset (exists today) | What it becomes in the Relationship OS |
|---|---|
| `voice_authors` + `voice_author_snapshots` | Profile + follower momentum on the contact card |
| `reply_drafts` (source_author_username, status, outcomes) | Outbound interaction history + reciprocity (give) |
| `mentions` (author, status) | Inbound interaction history + reciprocity (take) |
| `harvest_rows` (handle, metrics, orig_*) | Topic profiling + their content curve |
| `posts_published` + `metrics_snapshots` | Per-interaction outcome (views, **profile clicks**) |
| `/x/voice/targets` (band + momentum + rankTargets) | The prototype for relationship-ranked lists |
| Radar ring buffer (session) | Presence feed ("who's online now") |
| `/x/brief` assembly | The warm daily standup |
| `voice_authors.profile_summary` (column exists, never written) | Free home for the topic/interest profile |
| `Inbox.tsx` (built, not rendered) | Reactivated as the inbound relationship surface |
| `searchRecent` (wired, no route) | A compliant discovery surface for finding new people |

---

## 4. Milestone R — the seven phases

Each phase below lists its features. Per feature: **borrows-from**, **builds-on** (existing
tables/routes), a **sketch** (endpoint or UI), and a **policy note** where relevant.

Endpoints follow the house pattern: a new Hono router mounted under `/x` by `mountX` in
`src/x/index.ts`; $0 unless a Grok call is named.

---

### R1 — The People Graph (a CRM for X) ⭐ foundation

Borrows from: **Attio / HubSpot / Salesforce, Notion.** *Detailed build plan lives in
`PEOPLE-GRAPH-PLAN.md`.*

**R1.1 — The `person` spine + unified contact card.**
A new `people` table keyed by lowercased handle, created/updated lazily ("touched") from every
existing write path (voice scrape, reply draft, mention pull, harvest ingest). The contact card
(`GET /x/people/:handle`) is a JOIN/UNION that stitches: profile (from `voice_authors`), every
reply you drafted/sent them (`reply_drafts`), every mention from them (`mentions`), their tweets
you saved (`voice_tweets`), and the measured outcome of each interaction (`metrics_snapshots`).
- *Builds on:* every people-bearing table already listed. *New capture:* none.
- *Sketch:* `GET /x/people`, `GET /x/people/:handle`, `PATCH /x/people/:handle`.

**R1.2 — Relationship pipeline (deal stages).**
Each person carries a stage: `stranger → warming → engaged → mutual → ally`. Stratus *suggests* a
stage from signals (did they mention you? did you reply? mutual follow?) and you can override it.
Kanban-style board view.
- *Borrows:* CRM opportunity stages. *Builds on:* `mentions` (inbound) + posted `reply_drafts`
  (outbound) + follow flags (R1.4). *Policy:* stage is inferred from *real* interactions only.

**R1.3 — Notes + tags per person.**
Append-only `person_notes` (timestamped) + `tags` (string[]) — "met in @x's replies, into
local-LLM", `#ai-builder`, `#romanian-tech`, `#potential-collab`. Finally populates the dormant
`voice_authors.profile_summary` idea with a real home.
- *Borrows:* CRM notes/tags. *Sketch:* `POST /x/people/:handle/notes`, tags via PATCH.

**R1.4 — Follow-relationship flags (DOM-scraped).**
`follows_me` / `i_follow` captured on the extension's "Save author" enrich path (the "Follows
you" badge and Follow/Following button state are in the profile DOM). Powers the `mutual` stage
and the mutual tracker.
- *Policy note:* DOM-only, human-paced — never the follower-list API (5× cost + pagination caps).

**R1.5 — Follow-up cadence / reminders.**
"You haven't engaged @handle in 14 days — a `warming` contact." A per-person `last_touch_at`
(max over your replies + saves) plus a configurable cadence. Generalizes the "neglected target"
logic already in `/x/voice/targets`.
- *Borrows:* CRM follow-up sequences. *Builds on:* the exact lastRepliedAt join in `voice.ts`.

**R1.6 — Reciprocity ledger.**
Per person: replies you sent them vs. mentions/replies they sent you. Surfaces one-sided
relationships and genuine mutuals.
- *Policy note:* **personal awareness only.** Explicitly not an engagement-pod / coordination
  tool — no amplification asks, no "reply back" automation. Honest bookkeeping about real
  interactions, nothing more.

---

### R2 — The Context Engine (context for every post & reply) ⭐ highest quality leverage

Borrows from: **Superhuman "background on sender", Gong, Notion AI.**
Today Reply Master hands Grok the tweet + top comments and **nothing about the human or your
history with them.** This is the biggest reply-quality gap the audit found.

**R2.1 — Pre-reply context card.**
Before you draft a reply, surface: your last 3 interactions with this person, their recurring
topics, their relationship stage, and which of your past replies to them earned profile clicks.
- *Builds on:* R1 contact card + `reply_drafts` outcomes. *Renders in:* Replies tab, above the editor.

**R2.2 — Context-aware drafting.**
Feed that relationship history into the Grok reply prompt ("you've replied to this person about
local LLMs before — don't repeat your Turbo Pascal line"). Injected at the variable tail so the
cached instruction prefix is unchanged.
- *Builds on:* `src/x/replies/prompt.ts` (`buildGrokInput`). *Cost:* same Grok call, richer input.
- *This is the single highest-leverage upgrade in the whole milestone.*

**R2.3 — Topic / interest profile per author.**
Distill each author's `voice_tweets` + `harvest_rows` into "what they tweet about" (Grok pass,
~$0.003 one-time, mirrors the §8.3 template-extraction pattern). Then answer *do they overlap with
my pillars?* — making the roster about **fit**, not just follower momentum. Writes to
`voice_authors.profile_summary`.
- *Borrows:* CRM enrichment / lead scoring.

**R2.4 — Semantic memory of your own voice ("don't repeat yourself").**
Embeddings over `posts_published` + `reply_drafts`; at compose time, warn "you made this point on
Jun 3 — here's what it earned." The audit found the whole system is `LIKE`-search only; this is
the first semantic layer.
- *Borrows:* Notion AI / RAG. *Note:* local embeddings (no per-token API) to stay $0; decision in
  the plan doc.

**R2.5 — Conversation reconstruction.**
For mentions and reply-to-reply, render the full thread chain (you store `conversation_id` /
`in_reply_to_tweet_id` but only surface `parent_text` today) so replies land in context.

---

### R3 — Community & presence (Discord/Slack-borrowed)

Borrows from: **Discord servers/channels + "online now", Slack.**

**R3.1 — Circles (a.k.a. lists / "servers").**
Group people into named circles — `Inner Circle`, `AI builders`, `Romanian tech`,
`Aspirational (10x)`. A circle is a saved lens over the People Graph; the current Targets roster
becomes *one* circle instead of the only view.
- *New:* `circles` + `circle_members` tables. *Sketch:* `/x/circles` CRUD, `?circle=` filter on `/x/people`.

**R3.2 — Presence feed — "who's posting now."**
Scope the existing **Radar** to your circles: "3 people from your Inner Circle just posted."
Discord's "online now" applied to *your* network, reusing the Radar ring buffer wholesale.
- *Builds on:* Radar (content script sightings) + circle membership. *The most community-feeling feature.*

**R3.3 — Daily standup / digest.**
A Slack-style morning message: "Your Inner Circle shipped 4 posts overnight; @x hit a milestone;
you owe @y a reply." The Brief already assembles most of this — reframe it as a warm standup.
- *Builds on:* `/x/brief` + R1 follow-up + R3.4.

**R3.4 — Milestone & moment alerts.**
Detect follower milestones / breakout tweets among your people (momentum spikes you already track
in `voice_author_snapshots`): "@handle just crossed 10k — good moment to congratulate."
- *Policy note:* **alert-only.** You reply by hand.

**R3.5 — Streaks & rituals.**
"Reply to 2 people in your Inner Circle today" as a light daily quest; a reply-streak counter.
Turns the 70/30 doctrine into a warm habit instead of a quota bar.
- *Borrows:* Duolingo / Discord gamification. *Builds on:* the reply-quota logic in `/x/brief`.

---

### R4 — Networking workflows (CRM sequences, 100% manual-send)

Borrows from: **Outreach / Apollo cadences** — but every step is a human action.

**R4.1 — Warm-up plays.**
A guided multi-touch template to get on someone's radar over days: *save their post → thoughtful
reply → save again → reply to a different angle*. Each step is a checklist item you complete by
hand; stratus tracks progress and nudges the next step.
- *Policy note:* a **reminder system for human actions**, not automation. Nothing sends itself.

**R4.2 — "Who to engage today," relationship-ranked.**
A list parallel to Radar's velocity ranking, weighted by *relationship goals*: warming contacts
who just posted, neglected mutuals, in-band aspirational targets. Combines the band classifier
with the People Graph.

**R4.3 — Outreach / DM prep (manual).**
When a relationship reaches `mutual`, offer a Grok-drafted intro message to **copy-paste** into
DMs.
- *Policy note:* **no DM API** — draft-to-clipboard only, same boundary as Reply Master.

**R4.4 — Mutual-follow tracker.**
Whether each person follows you back, from the R1.4 DOM-scraped flags. Powers the `mutual` stage
and a "they follow you, reply back sometime" nudge.
- *Policy note:* DOM-scraped like the voice library — never the follower-list API.

---

### R5 — Intelligence upgrades (close the gaps the audit found)

The AI layer is rule-driven with **no learning loop.** Several fixes are cheap and compounding:

**R5.1 — Live band recalibration.** `evals/analyze-own-replies.ts` already computes the
band→outcome crosstab; surface it in-app and auto-recalibrate once past 100 measured replies (the
gate already exists).

**R5.2 — Pillar / register / angle performance weighting.** You capture `pillar` on posts and
`angle`/`register` on drafts but never learn from outcomes. Show "spicy + unsexy-problems earns 2×
profile clicks" and bias the drafters.

**R5.3 — Best-times → actual scheduling.** `/x/metrics/best-times` computes your best UTC
hour×weekday cells and *nothing consumes them.* Wire "Suggest slot" to measured best times instead
of fixed anchors.

**R5.4 — Activate already-paid-for surface area.** Real dead code worth reviving: `Inbox.tsx`
(built, not rendered), `searchRecent` (wired, no route — a compliant *discovery* surface),
`organic_metrics` (captured, never shown), `scheduled_posts.error_class` (captured, never
surfaced).

---

### R6 — Warmth & ritual (the "warm product" ask)

Borrows from: **Slack weekly wrap / Spotify Wrapped, Duolingo.**

**R6.1 — Conversational morning ritual.** Open the panel to a warm first-person briefing
("Morning. You're +40 this week. @x is warming — reply to their thread from 20 min ago?") instead
of a metrics dashboard. Same data, human tone.

**R6.2 — Weekly retrospective.** A Friday "your week in relationships + content": new mutuals,
best reply, neglected people, the pillar that's working.

**R6.3 — Wins wall.** Celebrate milestones — follower deltas, a reply that broke out, a
`stranger → mutual` conversion. Makes the grind visible.

---

### R7 — Discovery (find the right people, compliantly)

Borrows from: **CRM prospecting / lead lists.**

**R7.1 — Compliant discovery surface.** Activate the wired-but-unused `searchRecent` to find
people posting about your pillars — surfaced as *candidates to save*, never auto-followed or
auto-replied. Budget-gated (search reads are $0.005/result — clamp `max_results`, honor invariant #5).

**R7.2 — Lookalike suggestions.** "People like @x you already track" from topic-profile overlap
(R2.3) + who your circle engages with (from harvested reply targets). $0, pure SQL over existing data.

---

## 5. Sequencing recommendation

Three thin vertical slices first — each is usable the day it ships:

1. **R1 People Graph core** (R1.1–R1.3) — the spine + contact card + notes/tags. Unlocks everything.
2. **R2 Context Engine for replies** (R2.1–R2.2) — feed relationship history into Reply Master.
   Highest quality-per-effort win in the milestone.
3. **R3 Circles + Presence** (R3.1–R3.2) — the community layer, reusing Radar + Brief.

Then R5 intelligence upgrades as they pay for themselves, then R4/R6/R7 as warmth polish.

---

## 6. Cost envelope

Milestone R is designed to **not move the cost needle**:

- R1, R3, R4, R6, R7.2: **$0** — pure SQL joins over existing data + DOM-scraped enrichment.
- R2.2 (context-aware replies): same Grok call, richer input — **no new call.**
- R2.3 (topic profiling): one-time ~$0.003/author, mirrors §8.3.
- R2.4 (semantic memory): $0 if local embeddings (recommended).
- R7.1 (discovery search): the only new *X* spend — $0.005/result, budget-clamped, off by default.

The $0.15/day X soft budget and the `cost_events` dashboard remain the cap.

---

## 7. Scope decision (read before building)

`CLAUDE.md`'s ceiling is **three goals**: schedule, measure, stash. A Relationship OS is a genuine
**fourth pillar** — networking/community. This is worth doing *because* growth on X is relational,
but it's a product-direction decision, not a feature bolt-on. If approved:

- Add a "Milestone R — Relationship OS" section to `PLAN.md` and update the scope ceiling language.
- Keep per-platform isolation: all of this lives under `src/x/` (people are X people for now); the
  spine could later generalize if LinkedIn arrives.
- The seven phases are independent — you can approve R1+R2 and defer the rest.

---

## 8. Explicitly NOT doing (guardrails for this milestone)

- **No auto-engagement of any kind** — no auto-like/follow/repost/reply. Ever.
- **No engagement pods / coordination.** The reciprocity ledger is personal bookkeeping, not a
  reciprocity-enforcement or amplification tool.
- **No DM API.** Outreach is draft-to-clipboard.
- **No follower-list / following-list API reads.** Follow relationships are DOM-scraped, human-paced.
- **No background crawling.** All capture stays user-triggered and on-screen (harvester discipline).
- **No republishing scraped data.** Person data is personal analysis only.
- **No multi-tenant.** Still one operator, one bearer token.

---

*Companion doc: `PEOPLE-GRAPH-PLAN.md` — the executable implementation plan for R1.*
