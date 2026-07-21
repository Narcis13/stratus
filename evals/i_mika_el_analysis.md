# @i_mika_el — reply/post strategy analysis (2026-07-21 harvest)

> Source data: `evals/i_mika_el_posts_2026-07-21.csv` (106 posts, 2026-06-08 → 2026-07-21)
> and `evals/i_mika_el_replies_2026-07-21.csv` (500 replies, a ~23.3h window across 2026-07-20/21).
> Harvested with stratus's extension harvester. Analysis scripts were run ad-hoc (Python over the CSVs);
> numbers below are reproducible from the raw files.
> His tool: https://github.com/creynir/x-builder (local Playwright overlay — pre-publish scoring, LLM judge, format cooldowns).

## TLDR

A two-tier reply machine — ~350 replies/day, almost certainly AI-drafted and human-dispatched — where
63% of replies go to tiny (<100-view) accounts for reciprocity/follow-backs and ~8% go to huge accounts
for impressions. Posts are engineered reply-bait (questions, polls, would-you-rather), never links.
Growth: 0 → 2k+ followers in ~60 days; weekly median post views 4x'd in five weeks (509 → 2,152).
The growth engine is the comment flywheel, not posting brilliance: 3,112 comments harvested on 106 posts.

## Replies (500 rows ≈ one day)

### Scale and cadence
- 500 replies in 23.3h (149 evening one, 351 the next day), 410 unique handles.
- Median inter-reply gap **1.3 min; 68% of gaps < 2 min**, sustained over a 17-hour active day.
- Bursts of 9–11 replies per 10-minute window.
- His own post states the doctrine: "the growth strategy nobody wants to hear: replies. 5-6 hours of them. every day."

### AI-drafted? Almost certainly, with a human dispatching
- Uniformity: median 13 words; **91% of replies in a 40–120 char band** (cv 0.33); 0 emoji; 0 multiline.
- Fixed grammar: 49% one-liners, 37% two-statement, 14% end in a question.
- **62% echo a distinctive ≥6-char word from the original post** (grounded-specificity prompt pattern).
- Boilerplate leakage: the same x-builder plug sentence recurs near-verbatim in 14 replies (2.8% plug rate).
- Human-in-the-loop markers: 9 "hhh" laughter openers, typos ("dont", "isnt"), one "Jacobian deez nuts" joke
  to ThePrimeagen (440 views). Curated variants or a hand-written layer on top.

### Two-tier targeting (the real strategy)

| Target size (orig views) | n | share | med reply views | comment-back | med latency |
|---|---|---|---|---|---|
| <100 | 315 | 63% | 6 | **26%** | 96m |
| 100–1k | 101 | 20% | 10 | **36%** | 47m |
| 1k–10k | 44 | 9% | 27 | 34% | 47m |
| >10k | 40 | 8% | **60** (max 1,517) | 10% | 77m |

- Small-account tier earns ~nothing in impressions; payoff = **137 comment-backs (27% of all replies)** + follows.
- Huge-account tier (shadcn, rauchg, Primeagen, simonw, kentcdodds, lennysan, gergelyorosz, shl) is the
  impressions play — best reply: 1,517 views / 11 likes on a 33k-view Claude Code post.
- 30% of replies go to repeat handles — relationships, not one-shots.

### Latency
- Median 74 min; only 19% under 15 min. Buckets: <15m 94, 15–60m 132, 1–3h 120, 3–6h 70, 6–24h 83.
- Volume beats speed — but on ≥1k-view posts, ≤60 min did better (median 47 vs 33 reply views).
- He batch-sweeps the timeline a few times a day; he is not camping notifications.

### Sneaky trick
- **Self-replies to his own post within a minute of posting** to seed the conversation — that self-reply
  got 1,116 views and 48 likes, his most-liked reply in the set.

## Posts (106 over 44 days, 2.4/day)

- Median 1,098 views on a ~2k-follower account. Weekly medians: 509 → 425 → 1,046 → 1,744 → **2,152**.
- Format: 84% start lowercase, median 110 chars, list-dash polls, 41% end with "?".
- **2 of 106 posts contain a link; the hard-link post is his worst performer (87 views).**
- Money-amount framing ($2M vs $50M, $5k yours vs $20k employed) performs: median 1,638 views.

### Taxonomy by performance

| Type | n | med views | med comments |
|---|---|---|---|
| Milestone ("crossed 2k followers") | 3 | 2,819 | 79 |
| Poll-list ("auth in 2026: - Clerk - Auth0 - roll your own and cry") | 6 | 2,672 | 46 |
| Would-you-rather ("$2M tomorrow or bet on $50M") | 8 | 1,698 | 46 |
| Audience CTA ("drop what you're building, I'll give a first impression") | 3 | 1,509 | 27 |
| Hot take ("be honest…", "nobody wants to hear…") | 7 | 1,418 | 31 |
| Build-in-public | 8 | 1,108 | 22 |
| Plain question | 34 | 1,074 | 19 |
| Statement/other | 34 | 660 | 10 |
| News commentary | 3 | **327** | 2 |

- **Posts engineered to be answered beat posts engineered to be admired.** "?"-bearing posts do 2x statements
  (1,190 vs 660 median views).
- The audience-CTA type converts his reply labor into *inbound*: dozens of small builders reply,
  each becomes a reciprocity contact.
- News takes flop at his account size.

## x-builder (repo notes)

Local Playwright + CDP tool injecting a React shadow-DOM overlay into x.com. Never auto-posts.
- Deterministic 0–100 pre-publish score + reach prediction calibrated to trailing-median account performance.
- 13-dimension LLM judge; hook/hedging/weak-closer checks (Fix vs Nudge).
- Voice capture from own archive + **passive GraphQL response capture** while browsing.
- **Format cooldown tracking**: ≥4 uses of the same format in a rolling 7 days = reach-decay warning.
- Local SQLite, human posts, AI drafts — philosophically a sibling of stratus.

## Recommendations for stratus (ranked)

1. **Raise the reply doctrine, backed by batch drafting.** Doctrine says 10–20/day; his data says volume is
   *the* growth input. 30–50/day is reachable with the RU.3 radar batch pipeline; `doctrine.replyTargetMin/Max`
   is already a DB knob.
2. **Add a reciprocity lane the band gate currently forbids.** The server band gate 422s "dead" posts — but his
   highest comment-back rates (26–36%) come from sub-1k-view posts by small builders. Right gate for the
   impressions lane, wrong for the relationship lane. Shape: a daily quest "reply to N fresh posts from
   stage≥noticed people / targets roster, band gate bypassed by design" (override + People CRM already exist;
   the RU.8 ⊕ manual pin is today's manual version).
3. **Seed the first comment on your own posts.** Launch Room checklist item; free; his top-liked reply of the
   day was a self-reply seed.
4. **Feed the winning post skeletons into the drafter.** Would-you-rather, poll-list, "be honest" confessional,
   audience-CTA — as §8.3 hookType/skeleton templates and post-prompt guidance. The audience-CTA additionally
   fills the People CRM with inbound.
5. **Milestone auto-nudge.** Milestone posts are his best type; stratus tracks followers daily and has
   `milestones.ts` — the brief should nudge "you crossed N, post it" the morning it happens.
6. **Format cooldown (from x-builder).** We stamp `register` + pillar on every draft; a rolling 7-day
   "format used 4x, reach decays" warning in the drafter is cheap.
7. **Keep the no-links rule; don't over-invest in <15m latency.** Both validated by his data. Let S0.5's
   latency table judge on our own numbers before buying more speed machinery.
8. **Echo instruction for replies.** 62% of his replies anchor on a concrete term from the original —
   a one-line reply-prompt tweak matching his measured pattern.

**Meta-lesson:** he isn't winning on writing quality (median reply: 8 views). He wins on systematized
volume + deliberate audience stratification — the game stratus was built for, currently run at 1/10th
throttle with a gate that blocks the relationship half of the strategy.
