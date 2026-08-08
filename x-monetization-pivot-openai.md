# Stratus after X Original Content Rewards

> Product reassessment, 2026-08-08. Prepared from the current Stratus codebase,
> the supplied eligibility screenshot, X's published product documentation, and
> fresh reporting of the new program.
>
> **This is not a growth plan.** It does not prescribe a posting calendar, daily
> quotas, or a deadline campaign. It identifies how Stratus should change as a
> coaching and measurement product now that X rewards qualified exposure to
> original content and explicitly excludes replies from the eligibility counter.

## Executive decision

Stratus should stop treating reply reach as the primary growth currency.

The product's new job is:

> Help create defensibly original work, distribute it into relevant Home
> Timelines, attract a verified audience likely to return, and learn from the
> best available evidence without pretending Stratus can see X's private
> qualification logic.

Replies remain useful, but their role changes. They are no longer an impression
engine. They are a selective audience-acquisition and relationship mechanism for
the core niche and genuinely adjacent niches. Raw parent reach and low reply
density become secondary feasibility signals, not the objective.

This changes the product emphasis substantially:

| Product decision | Stratus area |
|---|---|
| **Promote to the main loop** | Ideas, Me, Composer, Calendar, Launch Room, Writer, Studio, original-post metrics, Playbook |
| **Enrich for the new objective** | Channels, People, Notifications/Following harvest, originality review, provenance, measurement maturity |
| **Reorient rather than remove** | Radar, Replies, Voice library, relationship follow-ups |
| **Demote** | Cannon placement, reply quotas, multilingual off-niche hunting, reply-impression leaderboards, the 70/30 doctrine |
| **Put behind an eligibility warning** | One-click LLM drafting/rewrite, generated visuals, scheduled/API publishing |
| **Do not build yet** | Revenue estimates, invented “verified share” models, more reply automation, API search optimized for large unrelated accounts |

The highest-priority product change is a conservative **Rewards Mode**: human
authorship first, manual publishing by default, an audit trail for source and
contribution, and no claim that AI-assisted or API-posted work qualifies. Beside
it, Stratus needs a trustworthy **Monetization Observatory** that records the
authoritative X counter, makes its freshness and rolling-window semantics
visible, and keeps every internal proxy clearly separate from the number X
actually uses.

---

## 1. What is confirmed, and what is not

The official help page and effective 2026-08-07 terms were retrieved during this
review. The account screen, help-page rules, program terms, and older creator
documentation are still separated below because they answer different questions.

### 1.1 Directly confirmed by the supplied X eligibility screen

The screen shows these requirements and current state:

| Requirement | Current state |
|---|---:|
| Premium, Premium+, or Premium Business | met |
| Age 18+ | met |
| 500 verified followers | met |
| 500,000 Verified Home Timeline impressions in the last 90 days | **259.1K / 500K** |
| Reply treatment | **“Does not include replies”** |

That is **51.82% complete**, with **240.9K** remaining on the current rolling
counter. This is a product baseline, not an ETA. Because the window rolls, an
observed increase can coexist with older impressions expiring; a straight-line
forecast from one screenshot would be false precision.

### 1.2 Directly confirmed by the Original Content Rewards help page

X defines a qualified impression as:

- A **unique** impression from an X Premium Basic, Premium, Premium+, or Premium
  Business subscriber.
- On the **Home Timeline** feed.
- With at least **50% of the post visible**.

X excludes a second impression from the same account on the same post, as well
as paid/promoted, artificially generated, and fraudulent impressions. This is
why Stratus cannot reproduce the total from ordinary post metrics: it cannot see
viewer subscription, surface, visibility percentage, or X's deduplication.

X defines original content as work personally written, filmed, designed, or
produced that reflects the creator's voice, perspective, or expertise. Genuine
reaction, analysis, context, and commentary can qualify. The help page excludes:

- Fully copied text, images, or video without original contribution.
- Reuploads downloaded from X or another platform by someone other than the
  creator.
- Slight modifications such as a word change, filter, speed adjustment, or text
  overlay that do not meaningfully transform the source.
- Aggregations that primarily compile others' work without substantial new
  perspective or framing.

Eligibility also requires a supported country, age 18+, an account in good
standing, a Personal or Business account, Premium/Premium+/Premium Business,
500K qualifying Home impressions in 90 days, 500 verified followers, and active
original posting. Romania appears in the published supported-country list.
Meeting the thresholds does not guarantee admission; X says review normally
takes three business days, permits one appeal, and otherwise allows reapplication
after 90 days.

### 1.3 Critical constraint: automated creation and posting

The help page says content is ineligible if it **“was created or posted using
automated means.”** It separately prohibits tools that artificially generate
likes, follows, views, comments, or shares.

This language has direct product impact:

- Stratus's LLM full-draft, rewrite, article-draft, and generated-image features
  may be considered automated creation.
- `src/x/workers/publisher.ts` and the API/scheduled publishing path may be
  considered automated posting.
- Automatically published thread segments are both automation-risky and, after
  the first post, may be treated as replies for the eligibility counter.

X does not define on the page where ordinary editing assistance ends and
“created using automated means” begins. Stratus therefore cannot certify that a
human-edited LLM draft qualifies. For a user explicitly optimizing for this
program, the conservative product default must be **human-authored and manually
posted**, with AI generation and API publishing visibly marked as eligibility
risk. The product can still coach, ask questions, organize evidence, run local
checks, and critique text without pretending those activities settle X's
interpretation.

Other explicit content risks the product should surface include repeated
solicitation of likes/replies/bookmarks/follows/reposts, misleading content,
content with a helpful Community Note, and content exclusively focused on
monetization coaching, monetization discussion, or maximizing payouts.

### 1.4 Transition and older official X material

X stopped accepting new Creator Revenue Sharing enrollments on 2026-08-07.
Existing participants continue earning under it through 2026-09-07, and X says
it will begin rolling out applications for them on 2026-09-08. The new program
pays every two weeks with a published $30 minimum, subject to continued account
and content eligibility.

X has already said that creator payouts use **Verified Home Timeline
impressions**, that higher Premium tiers may carry more value, and that some
formats may receive different weighting. X's timeline documentation also makes
clear that Home includes recommended posts outside the accounts a person
follows, selected using relevance, popularity, and network interactions.

This supports a product focus on original-post distribution and audience fit.
It does **not** support claiming that Stratus knows the payout formula or that a
specific format is currently multiplied by a known amount. The new help page
says content in any format can qualify; it does not publish a format multiplier.

### 1.5 Unresolved policy questions

Stratus should maintain a small policy-version record because these answers can
change independently of the app:

- The practical boundary of “created or posted using automated means,” including
  LLM critique, LLM rewriting, templated visuals, third-party scheduling, X's own
  scheduling, API publishing, and assisted versus generated work.
- Whether a visible verification badge reliably exposes the Premium state used
  by the program at impression time.
- Payout weights, rates, caps, and any account-level quality adjustments.
- How X attributes impressions when original work is quoted, reposted, or
  meaningfully transformed by another account.
- Whether an item's Community Note status can later change prior earnings.

No Stratus feature should guess these answers.

### 1.6 The indexed-document trap

Search engines still expose X's older Creator Revenue Sharing page with the
5-million-organic-impression threshold. That is an indexing lag, not a reason to
keep the old product objective. The account's current eligibility screen and the
new Original Content Rewards page are the operative sources.

`x-growth-plan-v3.md` should therefore be treated as historical research. Its
reply-placement observations can still inform relationship discovery, but its
gate, currency, output mix, Cannon thesis, and deadline arithmetic are obsolete.
This review intentionally leaves that user-edited file untouched.

---

## 2. The product loop has changed

The old loop was optimized for an output X now excludes:

```text
large parent post -> fast reply -> reply impressions -> 5M gate
```

The new loop has two connected lanes:

```text
FIRST-PARTY CONTENT LANE
real idea/evidence
  -> human-authored draft + provenance
  -> policy-risk review
  -> manual publish + launch
  -> Home Timeline distribution
  -> verified audience exposure
  -> X eligibility checkpoint + internal proxy learning

ADJACENT-AUDIENCE LANE
core/adjacent conversation
  -> valuable reply
  -> relevant profile visit/follow/relationship
  -> later exposure to original posts
  -> repeat engagement from the right audience
```

The second lane serves the first. It is no longer allowed to dominate the
interface, the daily commitments, or the application's definition of success.

### New north star and measurement hierarchy

Stratus needs three explicitly separated measurement layers:

1. **External ground truth:** the 500K Verified Home Timeline counter displayed
   by X. Only X decides what qualifies.
2. **Internal outcome proxies:** original-post impressions, profile visits,
   engagements, follows, verified-engager observations, and returning
   engagement on later originals.
3. **Controllable inputs:** human-authored evidence-backed ideas, provenance,
   originality review, format, pillar, register, manual launch actions,
   adjacent-audience interactions, and publishing consistency.

The UI must never blend these into an opaque “monetization score.” A useful
proxy stays labeled as a proxy.

---

## 3. What the current Stratus already has

Stratus is not starting from zero. Much of the necessary product exists, but the
center of gravity is wrong.

### 3.1 Authoring pipeline: high leverage, under-instrumented

`extension/src/sidepanel/Composer.tsx`, `src/x/routes/drafter.ts`, and
`src/x/posts/prompt.ts` already provide:

- Single-post and thread drafting.
- Personal context from Me, editable pillars, and saved ideas.
- Static coaching, an optional LLM Judge, and rewrite assistance.
- Best-time suggestions based on measured post history and audience activity.
- A path into Studio for original visual production.
- Manual and API publishing flows.

The post prompt already instructs the model to draft originals, avoid engagement
bait, use real personal material, and borrow only a saved post's structural
skeleton—not its words, claims, or specifics. That is a good foundation.

It is not enough for Rewards Mode. The LLM is still producing the publishable
text, and Composer can improve/rewrite it and hand it to an API publisher. The
new policy's automated-creation/posting clause makes those conveniences a direct
eligibility risk even when the output sounds personal. Rewards Mode should be
blank-first and human-authored: Stratus prompts for facts, asks editorial
questions, detects issues, and critiques a user-written draft. Full generation,
rewrite, and API publishing should require leaving that conservative mode and
acknowledging the unresolved policy risk.

The first line of `src/x/posts/prompt.ts` also still calls originals the
“30%-originals side” of a 70/30 doctrine. `src/x/routes/brief.ts`, Today, README
copy, niche doctrine, and weekly ratio scoring still encode reply-first behavior.
The product is coaching against its new objective before the user writes a word.

### 3.2 Ideas, Me, pillars, and Channels: the raw material layer

These are now strategic assets:

- `ideas` preserves a seed, source URL, tags, and the artifact it becomes.
- Me stores lived facts, events, beliefs, and emotions that can ground genuinely
  first-party writing.
- `content_pillars` organizes output and measured performance.
- `channels` already organizes input and people through tags, keywords, niche,
  and an optional pillar relationship.

The missing piece is evidence and intent. An idea can say where it came from,
but not yet distinguish firsthand experience from original analysis, creative
work, reporting, or transformation of a source. A Channel can group a topic,
but not say whether it is core, adjacent, or experimental, or why its audience
should overlap with the creator's originals.

### 3.3 Calendar and Today: correct control surfaces, wrong emphasis

Today already has the right product role: it combines schedule gaps, goals,
quests, follower state, Launch Room, conversations, follow-ups, targets, account
health, and recent outcomes.

But its information hierarchy remains reply-led:

- Reply quota and weekly reply percentage are first-class concepts.
- Targets and Radar occupy the acquisition center.
- Original production is one commitment beside a much richer reply system.
- There is no authoritative Original Content Rewards progress card.
- The “do next” logic cannot prioritize an unreviewed original, an expiring
  checkpoint, or a post awaiting mature measurement.

Today should remain the home screen; its objective and ordering should change.

### 3.4 Launch Room: directly aligned with timeline distribution

`src/x/routes/launch.ts` and the Launch Room already detect early responders and
turn them into People/events without API spend. Early, relevant conversation on
an original is much closer to the new objective than placing another reply
under an unrelated viral post.

It currently behaves mainly as an early-replier inbox. It should become the
short-lived operating room for an original: launch state, first meaningful
responses, relevant people, early measurement, and follow-up actions that add
value without engagement bait.

### 3.5 Metrics and Playbook: valuable, but optimizing generic reach

`posts_published` distinguishes originals from replies and records media.
`metrics_snapshots` stores X public/non-public/organic metrics and the age of the
post at capture. `src/x/routes/playbook.ts` already calculates:

- Media versus text performance.
- Post format performance.
- Pillar/register combinations.
- Coach and Judge outcome relationships.
- Best times and timeline funnel views.
- Reply outcomes and own-reply performance.

This is the correct learning engine. The limitation is fundamental: the X data
Stratus stores exposes aggregate `impression_count`, not verified-viewer Home
Timeline impressions. Playbook can compare generic reach and profile action; it
cannot attribute qualified impressions to a post.

There is also a measurement-maturity problem. The current daily worker may read
posts at materially different ages. `plans/2026-08-03-multipass-metrics.md` was
designed to fix comparability, but remains unimplemented and gives replies more
measurement investment than they now deserve.

### 3.6 Writer: newly important, disconnected from outcomes

The standalone Writer and `articles` table support outlines, full drafts,
section drafting, polishing, a pillar, and a manual published URL. Original
writing, reporting, expertise, and analysis sit at the center of the new policy,
so Writer becomes a first-class content surface.

Its published article is not linked to a `posts_published` record or a promotion
post. Playbook therefore cannot compare article-led work with short posts or
connect a long-form artifact to its launch and downstream performance. Writer
also lacks a source/evidence notebook and a dedicated originality review. More
urgently, its full-draft, section-draft, and polish actions are automated creation
under a conservative reading of the new rule. Rewards Mode should make Writer a
human writing environment with research organization and critique; generative
actions belong behind the same explicit risk boundary as Composer.

### 3.7 Studio: an original-content multiplier with a provenance gap

Studio can create charts, code cards, thread covers, milestones, banners, quote
cards, and other deterministic PNGs; it also supports generated backgrounds.
This is useful when the visual expresses the creator's own data, process,
artifact, or argument. But one-click generated backgrounds and automatically
produced visual content now need an automation-risk label. A deterministic
layout tool applied manually to the creator's own data is lower-risk than an
AI-generated image, but X has not published a safe boundary; Stratus must not
invent one.

`media_assets` records kind, generation prompt, dimensions, and the tweet where
the asset was used. It does not record whether the source material is owned,
licensed, cited, transformed, or unknown. Under the new rules, an original chart
from the creator's own data and a superficial text overlay on somebody else's
work must not look equivalent inside Stratus.

### 3.8 People and passive harvesting: the seed of audience-quality data

The People CRM records identity, bio, follower counts, stages, tags, source, and
an append-only event history. Notifications, hover capture, following capture,
Launch Room, mentions, and harvest can populate it cheaply.

The code's X user type already knows about `verified_type` and
`subscription_type`, but `people` does not persist an observed verification
state or its source and freshness. That prevents Stratus from answering a basic
new-product question: “Are the relevant people entering and returning to my
original work plausibly part of the verified audience?”

Visible verification remains only a signal. It must not be converted into a
claim that a person produced a qualified impression.

### 3.9 Radar, Replies, and Cannon: excellent machinery for the old objective

The reply system is one of the deepest parts of the app: banding, harvesting,
target rosters, curation, multiple drafting modes, relationship exceptions,
multilingual handling, reply lists, and measured outcome views.

Its objective function is now misaligned:

- `src/x/cannon/roster.ts` scores authors as median views divided by median
  comments plus one: a reply-placement opportunity score.
- `src/shared/cannon.ts` carries a daily placed target of 18.
- `src/x/replies/curate.ts` asks which reply will earn impressions and profile
  visits.
- The most recent Playbook work grades reply yield, crowding, latency, language,
  and Cannon arms.
- The current 70/30 doctrine gives replies the majority of output.

None of those are useless engineering. They are simply pointed at an excluded
metric. The relationship lane, People integration, context capture, and quality
drafting should stay. Global low-density hunting and raw reply impressions should
move out of the primary product loop.

### 3.10 Voice library: useful inspiration, new policy risk

The Voice library captures posts, extracts structure, and lets Composer remix a
hook shape, skeleton, line-break rhythm, length, or closing device. The prompt's
transformation instruction is strong, but Stratus does not perform a similarity
check or preserve a complete provenance trail on the final scheduled post.

This becomes a risk surface precisely because it is convenient. The product
should keep the library as a craft reference, while adding an “originality
firewall” that makes copying harder and the creator's added contribution visible.

---

## 4. Product decisions by subsystem

| Subsystem | Decision | Product reason | Immediate change |
|---|---|---|---|
| Today | **Promote/reframe** | Best place for the authoritative goal and next actions | Put Original Rewards status and original pipeline first; make reply work secondary |
| Composer | **Promote/rebuild for Rewards Mode** | Main workspace for eligible artifacts | Human-authored blank-first flow; provenance and critique; put generation/rewrite behind risk acknowledgement |
| Ideas + Me | **Promote/enrich** | First-party material differentiates originals from generic output | Capture evidence type, source references, concrete personal facts, and intended contribution |
| Calendar | **Promote, reminder-first** | Makes the original pipeline visible before and after publishing | Show preflight, manual-publish, launch, and measurement states; no unattended Rewards-mode publish |
| Launch Room | **Promote/enrich** | Supports relevant early distribution and relationships | Center it on each original and its first audience, not generic engagement volume |
| Metrics | **Promote/rebuild denominator** | Needed to learn what earns timeline exposure | Implement comparable original-post passes and label generic reach as proxy |
| Playbook | **Promote/reframe** | Can turn measured originals into repeatable product guidance | Separate ground truth, outcomes, and inputs; default to originals |
| Writer | **Promote/rebuild for Rewards Mode** | Long-form expertise/reporting is strongly aligned with originality | Human writing + evidence/critique; put generative drafting behind risk acknowledgement; add attribution |
| Studio | **Promote selectively** | Creator-owned visuals can increase substance and dwell | Add asset/automation provenance; distinguish own-data composition from generated media |
| Channels | **Enrich** | Natural home for adjacent-niche strategy | Add core/adjacent/experimental relation and an audience-overlap hypothesis |
| People | **Enrich** | Relevant verified followers and returners are a new audience-quality signal | Persist observed verification and engagement with originals, with source/freshness |
| Radar | **Reorient** | Still useful for relevant discovery | Default to core/adjacent sources and relationship value; parent reach becomes a tie-breaker |
| Replies | **Reorient** | Can acquire relevant followers and build relationships | Grade downstream audience quality, not reply impressions |
| Voice | **Keep with guardrails** | Structural study remains useful | Add similarity warning, source trail, and “what I add” field |
| Publisher worker/API publish | **Disable in Rewards Mode** | Policy explicitly flags automated posting | Calendar becomes a reminder; reconcile the manually posted result |
| Cannon | **Demote/rename** | Its score optimizes excluded reach | Remove from daily headline; replace with an adjacent-audience discovery lane |
| Multilingual off-niche modes | **Park** | Low audience continuity for English niche originals | Keep code, remove from default coaching and quotas |
| Search Query Builder plan | **Adapt, then build** | Search can discover adjacent conversations | Anchor searches to Channels and audience fit, not viral low-density targets |

---

## 5. The product Stratus should add

### 5.1 Rewards Mode — human-authored, manual-posted by default

This is the immediate safety boundary around the existing product.

Rewards Mode should be an account-level objective, not a decorative Composer
toggle. When active it changes defaults across Composer, Calendar, Writer,
Studio, Today, and the publisher:

- Composer opens blank-first and asks for the creator's thesis, evidence, lived
  detail, and draft. It does not open with generated variants.
- Deterministic coaching can flag hook, clarity, duplication, unsupported claims,
  engagement solicitation, and source risk. LLM critique is optional and carries
  an “automated assistance—qualification unclear” marker.
- Full draft, Improve with AI, article generation, section generation, AI polish,
  and image generation sit behind an explicit policy-risk acknowledgement. They
  are not labeled safe merely because the human later edits the result.
- Every artifact records `authoring_mode`: `human_written`, `ai_critiqued`,
  `ai_rewritten`, `ai_generated`, or `unknown`, plus the last transition time.
- Calendar schedules a human reminder. `src/x/workers/publisher.ts` does not post
  Rewards-mode originals; the user publishes in X and Stratus reconciles the
  resulting tweet ID through its existing manual path.
- Threads show a clear warning that segments after the root are replies and the
  published rule excludes reply impressions from the counter.
- Generated or automatically composed media is visually distinguished from the
  creator's uploaded/captured work and own-data manual compositions.

This mode reduces policy risk; it cannot certify acceptance. X retains discretion
and has not published a detailed automation boundary. Keep the existing
generation/publishing capabilities for non-Rewards workflows rather than deleting
them, but never let an old scheduled row silently cross into Rewards Mode.

### 5.2 Monetization Observatory — authoritative counter, honest semantics

This is the other P0 feature.

Add a small append-only `monetization_checkpoints` model:

| Field | Purpose |
|---|---|
| `id` | Stable checkpoint identity |
| `program` | `original_content_rewards` so future programs do not overwrite history |
| `policy_version` | The rules believed active when captured |
| `qualified_impressions` | Exact value displayed by X |
| `threshold` | 500,000 now; stored rather than assumed forever |
| `window_days` | 90 now |
| `captured_at` | Freshness and observed deltas |
| `source` | `manual`, `dom`, or `screenshot` |
| `source_url` / `raw_label` | Auditability and parser diagnosis |
| `note` | Policy/UI anomalies or human context |

Routes should provide append, list, and summary. Today should render:

- Current value, target, percentage, remaining, capture time, and source.
- The exact label **Verified Home Timeline impressions**.
- A permanent **Replies excluded** note.
- An explicit **X-reported ground truth** badge.
- Observed deltas between checkpoints, never reconstructed totals.
- A stale-state warning when no recent checkpoint exists.
- No ETA until enough checkpoints exist; even then call it “recent observed
  pace,” explain the rolling-window caveat, and never imply known expirations.

The extension can opportunistically read the monetization page's DOM because it
already has passive capture patterns. The parser must fail closed: if the label,
unit, or requirement card is not recognized, store nothing and ask for manual
entry. Manual entry must always remain available because X can change markup.

#### Measurement contract

The app must never:

- Sum `public_metrics.impression_count` and call the result qualified.
- Apply a guessed verified-audience percentage.
- Count reply impressions toward the progress card.
- Attribute a checkpoint delta to one post without X-level evidence.
- Treat “verified person observed engaging” as “qualified impression counted.”
- Estimate revenue from the eligibility counter.

### 5.3 Originality and provenance layer

Add one shared provenance concept across scheduled posts, articles, and media.
The durable model can be a generic `content_provenance` table keyed by artifact
type/id, or equivalent typed fields on each artifact. It should record:

- `origin_kind`: firsthand experience, original analysis, reporting,
  creator-owned media, creative work, transformed commentary, or unknown.
- Source references: URLs, saved voice tweet IDs, idea IDs, notes, datasets, or
  local artifacts.
- `original_contribution`: one plain-language sentence explaining what the
  creator adds that is not present in the sources.
- Evidence notes for factual claims.
- Review status, policy version, reviewer, timestamp, and acknowledged warnings.

Composer and Writer should show a lightweight preflight:

1. What is yours here?
2. What sources or prior work informed it?
3. If it transforms another item, what substantive commentary or creative work
   did you add?
4. Are any factual claims unsupported or any calls to action engagement bait?

Add a deterministic local similarity warning against the selected Voice source
and saved corpus. N-gram overlap, longest shared spans, and repeated distinctive
phrases are sufficient for a first version. Start as a transparent warning with
examples, not a black-box block. The optional LLM Judge can add a richer
policy-risk review, but its verdict must say **automated assistance** and **risk
review**, never “X eligible.” Preserve the human draft separately so a Judge or
rewrite never erases authorship provenance.

Update the prompt registry so policy copy is versioned and editable. Remove the
hard-coded 70/30 claim from `src/x/posts/prompt.ts`. Keep the existing strong
rules against invented specifics, copied claims, and engagement bait.

### 5.4 Original-content brief, without inventing a second workflow

Do not build a separate editorial suite. Extend the existing Idea → Composer →
scheduled post linkage:

- Ideas gain origin kind, evidence/source notes, intended Channel, and intended
  contribution.
- Consuming an idea transfers those fields into the scheduled artifact's
  provenance record.
- Composer displays the brief beside the draft and warns if evidence is lost.
- Calendar displays small states: evidence present, review pending/passed,
  visual ready, scheduled, launched, 24h measured, 7d measured.
- The final published record remains the outcome anchor.

For articles, use the same brief and provenance model. Link a published article
to its X URL and any launch/promotion post so Playbook can analyze it as one
content package.

### 5.5 Comparable original-post measurement

Adapt `plans/2026-08-03-multipass-metrics.md` to the new objective instead of
implementing it unchanged.

Recommended pass ladder:

- An early pass only where Launch Room has a concrete consumer for it.
- A comparable ~24-hour pass for originals.
- A comparable ~7-day pass for originals.
- No long-tail reply pass by default.

Persist the pass/maturity explicitly rather than asking every reader to infer it
from `age_at_snapshot_min`. Playbook comparisons must choose one maturity level
and show sample size. Format, pillar, register, media, Coach, Judge, time, and
provenance categories should all use the same outcome denominator.

This makes generic original-post impressions a much better learning proxy. It
still does not turn them into qualified impressions.

Playbook should open with an **Original exposure** view:

- 24h and 7d distribution of original impressions, not only averages.
- Median, upper quartile, and tail frequency; a single winner must not silently
  redefine the baseline.
- Profile visits per 1,000 original impressions.
- Engagement from observed verified people, labeled as an audience-quality
  signal.
- New followers followed by return engagement on later originals.
- Performance by origin kind, Channel/pillar, format, media provenance, and
  launch behavior after the sample gate.
- A separate section for reply acquisition, not mixed into original reach.

### 5.6 Adjacent-audience graph

Channels are the correct substrate. Add:

- `relation_to_core`: core, adjacent, experimental.
- `audience_overlap_hypothesis`: why people in this Channel would care about the
  creator's originals.
- Optional inclusion/exclusion examples and language.
- A relationship to the primary output pillar where appropriate.

Examples should come from the actual niche configuration, not be hard-coded in
the product. The tool should ask for the reasoning, not decide adjacency from
keyword overlap alone.

Extend People with observed audience-quality fields:

- Verification state/type, source, and observed-at time.
- Channel tags and how they were assigned.
- First and most recent engagement with an original post.
- Follow observation where available.
- Return-engagement count on later originals.

Prefer free DOM observations from hover cards, notifications, Following, and
Launch Room. Use paid X user lookup only when a real product action needs fresh
data. A badge can go stale, so verification must be tri-state and timestamped,
not a permanent boolean.

### 5.7 Radar becomes “Relevant Conversations”

Keep the queue and drafting mechanics, change ranking and presentation.

Eligibility for the default lane should require either:

- A core/adjacent Channel match; or
- A meaningful relationship already present in People.

Ranking should then use interpretable factors:

1. Audience/topic fit.
2. Relationship opportunity and prior reciprocity.
3. Evidence that the author or audience is relevant to future originals.
4. Freshness and a realistic chance of being seen.
5. Parent reach/reply density only as tie-breakers.

An observed verified author is useful context but should not dominate the score.
Large unrelated posts should require an explicit experimental override and never
populate the default daily commitment.

The curation prompt in `src/x/replies/curate.ts` should stop asking primarily
which reply will earn impressions. It should ask which conversation allows a
specific, valuable contribution that can plausibly create relevant profile
interest or strengthen a relationship.

### 5.8 A reply acquisition funnel that admits uncertainty

Exact per-reply follow attribution is not available from the current X metrics.
Do not invent it. Build a confidence-graded funnel from observable events:

```text
reply posted
  -> aggregate profile-visit movement in a bounded window (weak attribution)
  -> new follow observed (moderate when temporally/person-linked)
  -> interaction with a later original (strong audience-fit evidence)
  -> repeated original engagement (stronger relationship evidence)
```

Playbook should prefer the last two signals. A reply with modest views that
creates a recurring relevant reader is more useful than a viral reply that
creates no return behavior.

Rename Cannon or place it under an advanced/legacy section. Its current score
can remain as a visibility feature inside the new ranking, but not as the main
score and not as a daily quota. Preserve its code and historical measurements
for comparison.

### 5.9 Writer and Studio become evidence-bearing content tools

Writer additions:

- Rewards Mode opens as a human writing surface; generative actions are separated
  and record an authoring-mode transition.
- Source notebook with citation URLs and creator notes.
- Claim/evidence checklist and originality risk review.
- Link article, published URL, promotion post, launch session, and metrics.
- Article/content-package outcome view in Playbook.
- Structural templates learned from the creator's own winning originals before
  third-party examples.

Studio additions:

- Provenance classification for every asset: creator-owned, generated,
  licensed/sourced, transformed, or unknown.
- An automation-risk marker for AI-generated and one-click generated assets; no
  “eligible” badge for manually composed assets because X's boundary is unknown.
- Source URL/credit and transformation notes where relevant.
- Fast templates for own data, code, before/after process, diagrams, receipts,
  experiments, and milestones.
- A visible warning when the only transformation is a text overlay or cosmetic
  edit to third-party material.
- Strong linkage from asset to scheduled and published artifacts.

Do not assume an Article or image receives a payout multiplier. Test content
formats with comparable internal outcomes and track policy announcements
separately.

### 5.10 Today becomes an Original Content command center

Recommended order:

1. X-reported Original Content Rewards checkpoint.
2. Original work needing evidence, review, scheduling, launch, or measurement.
3. Recent original exposure and mature Playbook signal.
4. Relevant conversations and relationships in core/adjacent Channels.
5. System health, spend, and secondary reply activity.

Quests should be based on completion states the app can observe, such as:

- Evidence captured for an idea.
- Original reviewed and scheduled.
- Launch replies answered substantively.
- Measurement pass matured.
- One relevant relationship followed up.

Avoid turning the new policy into another volume scoreboard. Originality cannot
be guaranteed by counting posts.

---

## 6. Implementation sequence

This is a product dependency order, not a user growth schedule.

### P0 — Stop coaching the old game

1. Add a versioned policy configuration and replace runtime 5M/70-30/reply-first
   copy. Inspect live `me_goals` and commitments before migrating user data; the
   empty development database is not evidence of production state.
2. Add Rewards Mode: human-authored Composer/Writer defaults, risk boundaries on
   generative actions, manual-publish reminders, and no publisher-worker/API
   posting for Rewards-mode originals.
3. Add `monetization_checkpoints`, routes, manual capture, and the Today card.
4. Demote Cannon placement and reply-percentage scoring in Today/brief/quests.
5. Add provenance/origin/authoring-mode fields and a deterministic originality preflight to
   Composer; make the same model usable by Writer and Studio.
6. Amend the multipass metrics plan so comparable originals receive the
   measurement budget and Playbook defaults to originals.

### P1 — Optimize the original-content system

7. Extend Ideas into evidence-bearing briefs and carry provenance through
   scheduled and published artifacts.
8. Link articles and Studio assets to scheduled/published posts and mature
   metrics.
9. Rebuild Playbook around original exposure distributions, maturity, sample
   gates, and labeled audience-quality proxies.
10. Turn Launch Room into an original launch session with relevant early audience
   context and return-engagement capture.
11. Add verification observation and original-engagement fields to People.

### P2 — Rebuild replies as adjacent-audience acquisition

12. Add core/adjacent/experimental semantics to Channels.
13. Reorient Radar filters, ranking, curation prompt, and copy around relevance
    and relationship potential.
14. Add the confidence-graded reply → follow → later-original-engagement funnel.
15. Adapt the planned Search Query Builder to generate Channel-grounded discovery
    queries instead of viral low-density hunts.

### P3 — Calibration and policy resilience

16. Calibrate similarity warnings and originality-review rules from real false
    positives/negatives; do not choose magic thresholds in advance.
17. Add a policy-watch surface showing source URL, last verified date, known
    unknowns, and acknowledgement when policy copy changes.
18. Only after adequate samples, test which origin kinds, formats, Channels, and
    launch patterns correlate with stronger original exposure and returning
    relevant audience.

---

## 7. Concrete code seams

| Change | Existing seam | Likely additions |
|---|---|---|
| Rewards Mode | Composer, Writer, Studio, Calendar, `src/x/workers/publisher.ts`, manual reconciliation | Account objective; `authoring_mode`; risk acknowledgements; publisher exclusion; root/thread warning |
| Monetization checkpoints | `src/x/db/schema.ts`, `src/x/index.ts`, `src/x/routes/brief.ts`, `extension/src/sidepanel/Today.tsx` | Migration; `routes/monetization.ts`; shared types/API; optional content-script capture |
| Policy/version registry | `src/x/settings/registry.ts`, prompt registry, Settings | Policy constants plus source/verified-at UI; no hidden hard-coding |
| Originality preflight | `src/shared/postCoach.ts`, `src/x/judge/prompt.ts`, Composer | Shared provenance types; deterministic similarity/risk module; focused Judge dimensions |
| Evidence-bearing ideas | `ideas`, `routes/ideas.ts`, Ideas, Composer | Origin/evidence/source fields and transfer into provenance |
| Comparable measurement | `workers/dailyMetrics.ts`, `metrics_snapshots`, `routes/metrics.ts` | Explicit pass/maturity; original-first polling; migration and worker tests |
| Original Playbook | `routes/playbook.ts`, Playbook, shared types | Exposure distribution, maturity selector, origin/Channel cohorts, proxy labels |
| Article attribution | `articles`, `routes/articles.ts`, Writer | Published tweet/content-package links and Playbook loader |
| Media provenance | `media_assets`, Studio registry/editor | Provenance/source fields and risk badge |
| Audience quality | `people`, `person_events`, hover/notification/following/launch harvest | Timestamped verification observations and original-engagement events |
| Adjacent Channels | `channels`, `routes/channels.ts`, Channels | Relation, hypothesis, exclusions, validation |
| Relevant-conversation Radar | `src/x/routes/radar.ts`, `src/x/replies/curate.ts`, Cannon roster, Radar | Channel/People gate, interpretable factor breakdown, legacy visibility component |
| Today reprioritization | brief, quests, goals, Today | New next-action types; original states first; reply quota secondary/off by default |

The optional monetization DOM capture should follow the repository's current
passive-ingestion discipline: parse locally, spend $0, send the smallest typed
payload to a server route, deduplicate, and never mutate X.

---

## 8. Acceptance criteria for the pivot

The product pivot is credible when all of these are true:

### Truthfulness

- Today shows the latest X-reported counter with capture time and source.
- Replies are never included in, or visually adjacent to, qualified progress as
  if they contributed directly.
- Every generic impression metric is labeled “all impressions” or “proxy.”
- No revenue or verified-share estimate appears without an official formula.
- Rolling-window deltas are not presented as guaranteed pace or deadline.

### Automation boundary

- Rewards Mode never sends an original through the publisher worker or API.
- Composer and Writer default to human-authored blank-first workflows.
- Generative drafts, rewrites, polish, and images require an explicit policy-risk
  acknowledgement and persist `authoring_mode`; editing does not erase history.
- Calendar treats Rewards-mode schedules as reminders and reconciles the manual
  X post afterward.
- Thread UI says that post two onward is a reply and reply impressions are
  excluded.
- Stratus never labels any assisted artifact as accepted or eligible.

### Originality

- Every new scheduled original can carry origin kind, sources, and original
  contribution.
- A Voice remix preserves its source link and receives a similarity warning when
  distinctive wording or structure is too close.
- Writer and Studio use the same provenance vocabulary.
- Static and LLM checks are advisory policy-risk reviews, not eligibility
  certification.

### Measurement

- Original comparisons use a named, comparable maturity pass.
- Playbook defaults to originals and shows sample size plus distributions.
- One outlier cannot silently become a reusable recommendation.
- The X counter and internal metrics are stored and rendered as separate series.

### Audience acquisition

- The default Radar queue contains core/adjacent or relationship-backed posts.
- Every recommended reply explains the topic/relationship fit.
- Parent views divided by comments is not the headline rank.
- People verification observations include source and freshness.
- Reply value can be assessed through later interaction with originals, with an
  explicit confidence level.

### Product hierarchy

- Composer, original pipeline, Launch Room, and measurement appear before reply
  volume in Today.
- The 70/30 doctrine no longer controls runtime coaching.
- Cannon and multilingual off-niche hunting are accessible but not promoted.
- Existing reply-craft and relationship capabilities remain available for the
  narrowed acquisition job.

---

## 9. What not to do

- Do not replace “5M raw” with a fake internally calculated “500K verified.”
- Do not assume the ratio between generic original impressions and the current
  259.1K counter remains stable across posts, audiences, or time.
- Do not build a payout calculator while X's weights and rates are undisclosed.
- Do not automatically publish a Rewards-mode original while X explicitly lists
  content posted using automated means as ineligible.
- Do not call an LLM draft “human-authored” after cosmetic editing or assume an
  originality score resolves the automated-creation rule.
- Do not reward post volume without evidence, originality, and mature outcomes.
- Do not delete the reply stack; its relationship machinery is valuable.
- Do not keep Cannon's old score and merely add an “adjacent” label to the UI.
- Do not interpret a visible badge as proof of a counted impression.
- Do not let AI review become a compliance oracle.
- Do not allow Voice-library convenience to erase source attribution.
- Do not hard-code policy prose into scattered prompts and React components
  again; version it once and surface when it was last verified.

---

## 10. Final product thesis

The policy change does not make replies worthless. It makes their correct job
obvious.

Replies create introductions. Relevant followers and relationships can improve
the audience available for future original work. The monetizable asset, however,
is the original work and its qualified Home Timeline exposure. Stratus should
therefore optimize the complete chain from firsthand material to original
artifact to relevant distribution to honest learning.

The codebase already contains most of that chain. Composer, Me, Ideas, Channels,
Calendar, Launch Room, Writer, Studio, People, metrics, and Playbook are not side
features anymore; together they are the product. Radar and Replies become a
supporting acquisition layer. Cannon becomes historical machinery unless and
until its score is rebuilt around relevant audience continuity.

Composer and Writer also need to become better companions than generators.
Organizing the creator's evidence, asking the question that unlocks a real point,
spotting a copied phrase, and critiquing a human draft are more aligned with this
program than producing three polished variants and publishing one unattended.

The differentiator should not be “Stratus writes more posts.” It should be:

> Stratus knows what came from you, keeps you visibly in authorship control,
> helps turn it into defensibly original work, places relationship effort near
> the people most likely to care, records what X actually reports, and never
> confuses a proxy with the goal.

---

## Sources reviewed

- [X Help — Original Content Rewards](https://help.x.com/en/using-x/original-content-rewards)
- [X Legal — Original Content Rewards Program Terms](https://legal.x.com/original-content-rewards-terms)
- [X Business — Creator updates and Article contest replacement](https://business.x.com/en/blog/creator-updates-and-article-contest-replacement)
- [X Help — About your For You timeline](https://help.x.com/en/using-x/x-timeline)
- [X Help — X Premium FAQ](https://help.x.com/en/using-x/x-premium-faq)
- [Engadget — X is replacing revenue sharing with Original Content Rewards](https://www.engadget.com/2232981/x-replacing-revenue-sharing-with-original-content-rewards-program/)
- Supplied screenshot: `/Users/narcisbrindusescu/Desktop/Screenshot 2026-08-08 at 01.12.47.png`

## Repository material reviewed

- `CLAUDE.md` and the current codemap.
- `x-growth-plan-v3.md`.
- Extension navigation and the Today, Composer, Calendar, Radar, Replies,
  Channels, People, Studio, Ideas, Voice, Playbook, and Writer surfaces.
- X route mounting, schema, prompts, coaching, metrics worker/routes, Playbook,
  Cannon scoring, Radar curation, passive harvest, and People events.
- `plans/2026-08-03-multipass-metrics.md` and
  `plans/2026-08-03-search-query-builder.md`.

The local checkout database was not used as a production-performance baseline;
it is effectively empty for published posts and metrics. The supplied X screen
is the current account-level baseline. No unsupported per-post qualified
impression attribution is made in this document.
