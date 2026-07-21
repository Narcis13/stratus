# Mika growth tactics (GT) — reciprocity lane, reply-bait formats, launch seeding, milestone nudge, format cooldown

- **Status:** planned 2026-07-22 · not started · **backlog — implement after the current masterplan waves finish**
- **Source:** `evals/i_mika_el_analysis.md` (the @i_mika_el posts/replies harvest study). Read it first — every task here implements one of its ranked recommendations.
- **Goal fit:** goals 1 (posting — better-performing originals) and 4 (Circles — the reciprocity/relationship half of the reply strategy). The analysis shows the measured growth engine is comment-flywheel volume + small-account reciprocity, which is exactly the people layer's job.
- **Cost impact:** $0 X API throughout. Grok per-click unchanged on existing paths (~$0.003–0.006/reply draft, ~$0.006/post draft); the reciprocity lane *increases click volume* by design (operator-controlled, each click still human-initiated). No recurring spend.
- **Invariants touched:** §7.4 (refuse-before-spend — the gate exemption is a deliberate, people-scoped carve-out; refusal stays the default for unknown handles), §7.8 (best-effort people lookups — a people-layer failure yields the old 422, never a crash), §7.14 (prompt byte-sync — two .md edits regenerate their TS literals), §7.16 (server-stamped `gateBypass`, never client-parsed), §7.19 (roster band is queue metadata, never a classifier verdict — coerced away on confirm like `manual`), §7.20 (new static route before `:param` check), §7.24–27 (background single writer, one transport, IIFE, shims), §7.28 (posting stays manual paste — nothing here auto-posts).
- **Codemap sections relevant:** §3.3 (quests.ts, replies.ts, brief.ts, drafter.ts, radar.ts, niche/defaults.ts, people/store.ts), §5 (content.ts, shared/radar.ts, LaunchRoom.tsx, Today.tsx, Composer.tsx), §7, §9.

## Why / what changes for the user

After the last task: (a) replying to a small/quiet post by someone in your People CRM or target roster no longer requires the 5s "dead post — force" dance — the band gate recognizes your people and lets the draft through, and a new daily quest ("replies to your people") makes the reciprocity habit visible; (b) fresh posts by your people enter the Radar queue even when they're not hot/warm, so the batch-draft button covers the relationship lane too; (c) the Launch Room tells you to seed the first comment yourself and drafts it in one click; (d) the Today tab nudges you to post a milestone the morning you cross one; (e) the Composer warns when a register/pillar has been used ≥4x in 7 days (reach-decay cooldown, x-builder-inspired); (f) the reply prompt anchors every reply on a concrete term from the post, and the post prompt knows the four measured reply-bait skeletons (would-you-rather, poll-list, confessional question, audience CTA).

The analysis's #1 recommendation — raising reply volume — needs **no code**: after this ships, the operator PATCHes the active niche's doctrine (`replyTargetMin/Max` 10/20 → e.g. 20/40) from the Settings Niche card. Recorded here so nobody builds a feature for it.

## Design

**Data:** no new tables, no migrations. One new doctrine knob (`reciprocityTargetMin`, JSON — `niches.doctrine` is schemaless), one new server-stamped `PostContext` field (`gateBypass`), one widened union (`RadarBand` + `'roster'` — `radar_drafts.band` is already free-text).

**Pure logic:** `computeQuests` gains a 6th quest (`reciprocity`); new `src/x/posts/cooldowns.ts` (`buildFormatCooldowns`); brief gains `milestoneWatch` helpers (pinnedWatch pattern — pure helpers exported from `routes/brief.ts`, tested in `src/test.test.ts`); `extension/src/shared/radar.ts` merge/rank handles `'roster'`.

**Routes:** `/x/replies/generate` band gate gains the roster exemption (lookup AFTER the cheap validation, before any spend); `GET /x/posts/cooldowns` on the calendar router ($0 SQL); `GET /x/brief` gains `milestoneWatch` + the reciprocity quest inputs; `parseBatchTweets`/confirm accept+coerce `'roster'`.

**Extension:** content.ts reports roster sightings (glance-map members, fresh, any band) into the radar stream; Radar.tsx renders a roster chip; LaunchRoom.tsx checklist + seed-draft button; Today.tsx milestone card; Composer.tsx cooldown chips.

**Measurement:** `contextSnapshot.gateBypass` makes roster-exempt drafts a distinguishable cohort (future playbook cell, deliberately NOT built now — n will be ~0 for weeks; §7.19 discipline). The reciprocity quest itself is the daily visibility. Smoke script proves the gate opens for a roster handle without spending (no-key 503 trick, `drafter.test.ts` pattern).

## Decisions taken

1. **Gate exemption is server-side, not a client auto-override.** A client sending `override:true` automatically would weaken the money gate for every caller; the server checking "is this author stage≥noticed or on the roster" keeps the refusal default and stamps what happened. (§7.16: server-stamped, never client-parsed.)
2. **Reciprocity membership = non-retired `people` at stage ≥ `noticed` ∪ current 2–10x target handles.** Matches how the person got into the system (a saved tweet/author/hover = noticed). Strangers still 422 — the ⊕ manual pin (RU.8) remains the escape hatch for them.
3. **Radar entry for roster posts uses a new band value `'roster'`, not `'manual'`.** Manual means "the human pinned it" and ranks first; roster is ambient capture and must rank below hot/warm within a tier — reusing `'manual'` would lie in both directions.
4. **Doctrine bump is an operator action, not code.** New knob only for the reciprocity quest target (`reciprocityTargetMin`, default 5 — opening guess, C1-threshold spirit).
5. **Milestone "already posted" detection is not built.** The nudge shows for 3 days after crossing and then goes quiet — a nudge, not a tracker (pinnedWatch precedent). Ladder is duplicated server-side from `extension/src/studio/milestones.ts` (extension module can't be imported by the server; note the twin in both files).
6. **Format cooldown counts `register` and `pillar` only** (both already stamped on drafter rows). Hand-written posts have null register and are counted in an `unknown` bucket, surfaced but never warned on (§7.11: null = unknown). Hook-type cooldown waits until extraction coverage is real.
7. **Prompt edits go in the stable prefix** (they're constant instructions, not per-call content) — this busts the prefix cache once per edit, which is how every prompt edit already behaves. The four skeletons go in the post prompt's §9 (X mechanics); the echo rule in the reply prompt's "How the replies sound". `REPLY_BATCH_PROMPT_TEMPLATE` embeds the reply voice block verbatim (AI.5 anti-drift test) — both change together.
8. **Launch seed comment drafts through the existing `/x/replies/generate` with `override:true`** (own post = zero metrics = band null), same as the early-replier flow; pasting stays manual ($0 — deliberately not using the API self-reply path at $0.015).

## Done when

- [ ] A reply draft to a stage≥noticed person's 12-view post succeeds without `override`, and `reply_drafts.contextSnapshot.gateBypass === 'roster'`; an unknown handle's dead post still 422s.
- [ ] The Today quest block shows "N replies to your people" and it increments when such a draft is pasted (PATCH → posted).
- [ ] A fresh post by a roster member appears in the Radar queue with a roster chip despite a null band verdict, and "Draft replies" covers it.
- [ ] The Launch Room shows the seed-comment checklist item and drafts one on click; the Today tab shows a milestone card within 3 days of crossing a ladder rung; the Composer shows a cooldown chip after 4 same-register posts in 7 days.
- [ ] `bun scripts/smoke-growth-tactics.ts` passes $0 (gate-exempt-then-503 proof, cooldown arithmetic, milestone helper, quest arithmetic, roster-band coerce on confirm).
- [ ] Byte-sync + equivalence + anti-drift prompt tests all green after both prompt edits.

---

## Task 1: Echo-anchor rule in the reply prompt  [parallel-ok]
**Depends on:** none
**Session budget:** ~60 diff lines, 4 files

**Read first:** codemap header + §7.14/§7.15/N-block; `reply prompt.md` (whole — it's short); `src/x/replies/prompt.ts` (the `REPLY_PROMPT_TEMPLATE` and `REPLY_BATCH_PROMPT_TEMPLATE` literals + how the anti-drift test slices); the byte-sync + anti-drift tests in `src/test.test.ts` (grep `REPLY_PROMPT_TEMPLATE`).

**Edit:**
- `reply prompt.md` — add one bullet to `## How the replies sound`: anchor each reply on ONE concrete term/detail lifted from the post itself (echo the word, don't paraphrase it away); never quote more than a fragment.
- `src/x/replies/prompt.ts` — regenerate `REPLY_PROMPT_TEMPLATE` byte-exact; update `REPLY_BATCH_PROMPT_TEMPLATE`'s embedded voice block identically (the anti-drift test asserts the batch default embeds the reply default's voice block verbatim).

**How:** The analysis measured 62% of the subject's replies reusing a ≥6-char word from the original — this codifies the pattern the specificity gate already rewards. Wording must not collide with the existing "never recite" relationship instruction (that one is about the relationship block; this is about the post text). Do NOT touch the `{{REPLY_PERSONA}}` token, the `## The three variants` heading, or anything the N.4 equivalence fixtures cover. Regenerate literals mechanically (read .md → paste into TS template literal, escaping backticks/`${`).

**Tests:** existing byte-sync + anti-drift + equivalence tests in `src/test.test.ts` are the coverage — they fail until the literals are regenerated correctly. No new tests.

**Done when:**
- [ ] `GET /x/replies/default-prompt` shows the new bullet
- [ ] Byte-sync, anti-drift, and N.4 equivalence tests green
- [ ] `bun test` + `bun run typecheck` + `bun run lint` green
- [ ] Committed: `feat(replies): echo-anchor rule in reply prompt (GT.1)`

**Cost note:** $0 — prompt edit; one-time prefix-cache bust on next draft.

---

## Task 2: Reply-bait skeletons in the post prompt  [parallel-ok]
**Depends on:** none
**Session budget:** ~80 diff lines, 3 files

**Read first:** codemap header + §7.14; `post prompt.md` §8–§9 region; `src/x/posts/prompt.ts` (`POST_PROMPT_TEMPLATE` literal); the post byte-sync test in `src/test.test.ts`; `evals/i_mika_el_analysis.md` "Taxonomy by performance".

**Edit:**
- `post prompt.md` — extend `## 9. X mechanics` with a "Proven engagement formats" block: four skeletons with one-line usage notes — (1) would-you-rather with two concrete stakes (money/tradeoff framing); (2) poll-list: short question + 3–4 dash options, last one self-deprecating; (3) confessional question ("be honest — …?"); (4) audience CTA ("drop/show me X, I'll respond to every one" — only when ready to actually reply to everyone). Plus the measured rule: posts engineered to be answered beat posts engineered to be admired (~2x views); at most one such format per day.
- `src/x/posts/prompt.ts` — regenerate `POST_PROMPT_TEMPLATE` byte-exact.

**How:** §9 is in the stable prefix and is builder-texture-free, so the N.3 equivalence fixtures (§1/§5 markers) are unaffected — verify by running them. `thread prompt.md` copied post §0–§5 only; §9 is outside the copy, no thread drift, `THREAD_PROMPT_TEMPLATE` untouched. Do not renumber sections. Formats are prompt guidance, NOT seeded `post_templates` rows (that table is measured own-winner extraction — foreign formats would pollute §8.3/C4 measurement).

**Tests:** existing post byte-sync + N.3 equivalence tests. No new tests.

**Done when:**
- [ ] A `POST /x/posts/draft` call's rendered prompt (assert via `buildPostDraftInput` in a quick REPL check, not a paid call) contains the formats block
- [ ] Byte-sync + equivalence tests green; thread byte-sync untouched and green
- [ ] `bun test` + `bun run typecheck` + `bun run lint` green
- [ ] Committed: `feat(drafter): proven engagement formats in post prompt (GT.2)`

**Cost note:** $0.

---

## Task 3: Launch Room — seed the first comment  [parallel-ok]
**Depends on:** none
**Session budget:** ~120 diff lines, 2–3 files

**Read first:** codemap header + §5 (LaunchRoom row) + §7.28; `extension/src/sidepanel/LaunchRoom.tsx` (whole — the early-replier draft flow is the exemplar, incl. its `api.replies` call shape, copy button, and error handling); `docs/` file for the Today tab (launch section).

**Edit:**
- `extension/src/sidepanel/LaunchRoom.tsx` — (a) new first checklist item: "Seed the first comment yourself — extend the post, don't restate it"; (b) a "Draft seed comment" button above the early-repliers list: calls the same generate path the per-replier buttons use, but with `context` = the launched post itself (my handle, the post text, zero metrics, `postedAt` = launch time) and `override: true`; renders the returned variants with the existing copy affordance; no `parent` block (the post IS the target).

**How:** Mirror the existing early-replier draft handler in the same file — same api client call, same busy/error state idioms. The pasted seed reply flows through the normal PATCH → posted path and already counts toward the replies quota and launch attendance (no server change). Thread heads with link-in-first-reply already pin their first reply — when `active.linkInFirstReply` is true, hide the seed button (the first reply is the link, already handled).

**Tests:** none required (LaunchRoom has no test file — extension panel components are manually verified by convention). Update the Today-tab doc.

**Done when:**
- [ ] Checklist shows the seed item; button drafts variants for the launched post; linkInFirstReply hides it
- [ ] `bun test` + `bun run typecheck` + `bun run lint` green (extension included)
- [ ] Committed: `feat(launch): seed-first-comment checklist + one-click draft (GT.3)`

**Cost note:** ~$0.003–0.006 Grok per click, human-initiated; $0 X.

---

## Task 4: Milestone nudge in the brief + Today card  [parallel-ok]
**Depends on:** none
**Session budget:** ~250 diff lines, 5 files

**Read first:** codemap header + §3.4 brief row + §7.12; `src/x/routes/brief.ts` lines ~240–330 (`pinnedSince`/`buildPinnedWatch` — the exemplar pure-helpers-in-route-file pattern) and ~500–560 (where pinnedWatch is assembled — see what account-snapshot series is already loaded and widen rather than re-query); `extension/src/studio/milestones.ts` (the ladder to mirror); `extension/src/sidepanel/Today.tsx` (`PinnedWatchCard` — the exemplar card); `src/x/routes/brief.test.ts` (pinnedWatch shape test).

**Edit:**
- `src/x/routes/brief.ts` — pure `MILESTONES` ladder (mirrored from the studio module; comment pointing at the twin) + `buildMilestoneWatch(series, now)` → `{milestone, crossedOn, followers} | null` (crossed within the last 3 days, peak-based ≥ like `latestCrossed`); wire as top-level `milestoneWatch` in the brief payload using the 30d account-snapshot series (reuse/widen the pinnedWatch query — do not add a second query if one already returns date+followers).
- `extension/src/sidepanel/Today.tsx` — `MilestoneCard` after `PinnedWatchCard`: renders only when non-null; copy like "you crossed {N} followers on {date} — post it (milestone posts are your best format)"; a "draft it" button calling the existing post drafter (`api` drafts call) with `idea` prefilled ("just crossed {N} followers — write the milestone post").
- `extension/src/studio/milestones.ts` — add the twin-comment pointing at brief.ts.
- `src/test.test.ts` — pure tests; `src/x/routes/brief.test.ts` — payload shape.

**Tests:** `buildMilestoneWatch`: crossing 2 days ago → nudge; 5 days ago → null; no snapshots → null; dip-after-cross still nudges (peak-based); exact-equal boundary. Route test: `milestoneWatch` key present and null on the seedless in-memory DB.

**Done when:**
- [ ] Brief carries `milestoneWatch`; card renders only on a fresh crossing; draft button lands 3 drafts in the calendar
- [ ] `bun test` + `bun run typecheck` + `bun run lint` green
- [ ] Committed: `feat(brief): milestone crossing nudge + Today card (GT.4)`

**Cost note:** $0 recurring (SQL over already-billed snapshots); ~$0.006 Grok only when "draft it" is clicked.

---

## Task 5: Format cooldown (register/pillar, rolling 7d)  [parallel-ok]
**Depends on:** none
**Session budget:** ~280 diff lines, 6 files

**Read first:** codemap header + §3.3 (posts/ modules) + §7.11/§7.20; `src/x/posts/pillars.ts` (small pure-module exemplar); `src/x/routes/calendar.ts` (router shape, existing GETs — confirm `/posts/cooldowns` can't shadow `/posts/scheduled/:id`; different segments, it can't); `src/x/routes/drafter.ts` around the insert (register stamping, response assembly); `extension/src/sidepanel/Composer.tsx` + `composerLogic.ts` (where best-times chips render — imitate).

**Edit:**
- `src/x/posts/cooldowns.ts` (new, pure) — `COOLDOWN_WINDOW_DAYS = 7`, `COOLDOWN_THRESHOLD = 4` (x-builder's bar); `buildFormatCooldowns(rows, now)` over `{register, pillar, at}` rows → `{registers: Cell[], pillars: Cell[]}`, `Cell = {key, count, cooldown}`; null register/pillar → `key:'unknown'`, counted, **never** `cooldown:true` (§7.11).
- `src/x/routes/calendar.ts` — `GET /posts/cooldowns` ($0 SQL): last-7d `scheduled_posts` with status in `posted|pending|publishing` (what went/will go out; drafts excluded), plus posted rows' `postedAt` fallback to `scheduledFor` — feed the pure builder.
- `src/x/routes/drafter.ts` — include `cooldowns` in the `POST /posts/draft` response (computed pre-Grok, advisory only — never refuse).
- `extension/src/sidepanel/Composer.tsx` — fetch cooldowns on mount (new `api` method in `sidepanel/api.ts`); amber chip per cooldown cell near the register/pillar controls: "spicy used 4x this week — reach decays".
- Tests: `src/x/posts/cooldowns.test.ts` (new) + a route case in the calendar route suite.

**How:** Warn-only by design — the operator decides. Chip styling: reuse the existing amber/`--strat-warn` idiom (§ UI tokens; no color literals).

**Tests:** builder — window boundary (7d-1min in, 7d+1min out), threshold at exactly 4, null bucketing, empty rows; route — seeded in-memory rows round-trip (clean up: shared DB, §9 discipline).

**Done when:**
- [ ] 4 same-register posts inside 7d → `cooldown:true` from the endpoint and a Composer chip
- [ ] Drafter response carries `cooldowns` without any behavior change to drafting
- [ ] `bun test` + `bun run typecheck` + `bun run lint` green
- [ ] Committed: `feat(posts): 7-day format cooldown warning (GT.5)`

**Cost note:** $0.

---

## Task 6: Band-gate roster exemption + doctrine knob
**Depends on:** none (lands before Task 7)
**Session budget:** ~220 diff lines, 6 files

**Read first:** codemap header + §7.4/§7.8/§7.16 + the N.5 doctrine block; `src/x/routes/replies.ts` lines ~170–270 (override parse, `gateSignalsFor`, the 422, ctx stamping order relationship→me→guidance, the insert with `contextSnapshot: ctx`); `src/x/people/store.ts` (query idioms); `src/x/routes/voice.ts` `loadTargetHandles`; `src/x/niche/defaults.ts` (`NicheDoctrine`, `DEFAULT_DOCTRINE`, `resolveDoctrine`); `src/x/replies/prompt.ts` `parseContext` allowlist + its test.

**Edit:**
- `src/x/niche/defaults.ts` — `NicheDoctrine.reciprocityTargetMin` (default 5) via `resolveDoctrine`'s lenient pick; no migration (doctrine is JSON, null-tolerant).
- `src/x/people/store.ts` — `isReciprocityHandle(handle): boolean` — non-retired `people` row at stage ≥ `noticed` (use the stage-order array already in scope) OR handle ∈ `loadTargetHandles()` (lowercased compare both sides); plus a `Safe` wrapper returning false on any error (§7.8).
- `src/x/routes/replies.ts` — in `/replies/generate`, when `(band === null || band === 'skip') && !override`: call `isReciprocityHandleSafe(ctx.tweet.authorUsername)`; exempt → skip the 422, stamp `ctx.gateBypass = 'roster'` (server-only field on `PostContext`, stamped BEFORE the insert so `contextSnapshot` records it); not exempt → the existing 422 unchanged. The lookup runs only on the refusal path — a hot/warm post never pays it.
- `src/x/replies/prompt.ts` — add `gateBypass?: 'roster'` to `PostContext`; `parseContext` must NOT accept it from clients (allowlist).
- Extension Settings Niche card (`Niche.tsx`) — 6th doctrine number input (follows the existing 5; doctrine PATCH is whole-object, D27c).
- Tests: replies route suite (exempt person → proceeds to the no-key 503, proving the gate opened pre-spend without paying; unknown handle → 422; retired person → 422; override still works), `parseContext` rejects `gateBypass`, `resolveDoctrine` picks the new knob.

**How:** `gateBypass` does NOT change what Grok sees — it's bookkeeping in the snapshot (the relationship block C3 already gives Grok the person context). Never bypass for `band === 'skip'` bait posts? No — a roster person's bait post is still their post; keep the exemption uniform, the human clicked. Do not touch the batch path (it has no gate).

**Tests:** as listed; the 503 trick force-unsets both LLM keys in a `finally` (drafter.test.ts pattern).

**Done when:**
- [ ] Roster-person dead post → draft proceeds (or 503 keyless) with `gateBypass:'roster'` in the would-be snapshot; stranger dead post → 422 `band_gate`
- [ ] `parseContext` allowlist test green; doctrine knob resolves
- [ ] `bun test` + `bun run typecheck` + `bun run lint` green
- [ ] Committed: `feat(replies): band-gate roster exemption + reciprocity doctrine knob (GT.6)`

**Cost note:** $0 at the gate (one SQL lookup on the refusal path only); Grok spend unchanged per click, human-initiated.

---

## Task 7: Reciprocity quest
**Depends on:** Task 6 (the doctrine knob + `isReciprocityHandle`)
**Session budget:** ~200 diff lines, 4 files

**Read first:** codemap header + §3.3 quests row; `src/x/quests.ts` (whole — vacuous-done contract); `src/x/routes/brief.ts` lines ~600–700 (quest input assembly — `postedDraftRows`, `repliedTodayHandles`, doctrine load); `src/x/quests.test.ts`; the Today tab quest rendering (generic over `brief.quests` — verify no per-key branch needed).

**Edit:**
- `src/x/quests.ts` — `QUEST_KEYS` + `'reciprocity'`; `QuestInputs.reciprocityRepliesToday` + `reciprocityTarget` + `knownPeopleCount`; quest entry: label "`{target}` replies to your people", vacuous-done with note "no one in your circle yet" when `knownPeopleCount === 0`.
- `src/x/routes/brief.ts` — compute: of today's `postedDraftRows`, count those whose `sourceAuthorUsername` (lowercased) is a reciprocity handle — load the reciprocity handle set ONCE (stage≥noticed non-retired people ∪ target handles; reuse the pieces Task 6 exposed, batched — do not call the single-handle checker per row); `reciprocityTarget` from `loadDoctrine().reciprocityTargetMin`; `knownPeopleCount` = size of the set.
- Tests: quest matrix cases in `src/x/quests.test.ts`; brief route test asserts the 6th quest's presence + vacuous path on the empty DB.

**How:** Streak semantics need no change — `completedMap`/`allDone` regenerate per day; historical `streaks` rows keep their 5-key maps (the diary is per-day, C9). Counting overlaps with the existing `targets` quest on purpose (a neglected-target reply satisfies both — same spirit as a reply satisfying both quota and launch attendance).

**Tests:** done + vacuous + partial progress; brief integration.

**Done when:**
- [ ] Today shows the 6th quest; pasting a reply to a CRM person increments it on the next brief read
- [ ] Empty-CRM DB → vacuous done with note, streak unaffected
- [ ] `bun test` + `bun run typecheck` + `bun run lint` green
- [ ] Committed: `feat(quests): daily reciprocity-replies quest (GT.7)`

**Cost note:** $0.

---

## Task 8: Roster sightings into the Radar
**Depends on:** Task 6 conceptually (same lane), independent in code
**Session budget:** ~350 diff lines, ~7 files — the big one; split content-script and server halves across two commits inside the session if it strains

**Read first:** codemap header + §5 (content.ts, shared/radar.ts rows — RU.8's `'manual'` widening is the exact precedent to imitate end to end) + §7.19/§7.24; `extension/src/shared/radar.ts` (`RadarBand`, `mergeSightings`, `rankSightings`, `stampTiers` + tests); `extension/src/content.ts` — the band scan/`recordRadarSighting` path AND the AX.3 glance cache (`getGlanceMap`) already available in the same file; `src/x/routes/replies.ts` `parseBatchTweets` band handling; `src/x/routes/radar.ts` confirm's `'manual'`→null coercion; `extension/src/sidepanel/Radar.tsx` (manual chip rendering).

**Edit:**
- `extension/src/shared/radar.ts` — `RadarBand` + `'roster'`; `mergeSightings`: a hot/warm re-sight UPGRADES a roster row (fresher verdict wins — unlike `'manual'` which never downgrades); rank order stays manual → tier → band with `hot > warm > roster`; `isRadarSightings` accepts it.
- `extension/src/content.ts` — in the scan where the band verdict lands: when the verdict is null/skip AND the author's lowercased handle has a glance-map entry (the map only contains non-retired people rows + roster targets, so presence IS membership — AX.1) AND the tweet is fresh (`signals.ageMin ≤ 24h`; skip when age is unknown) → `recordRadarSighting` with `band:'roster'`. Reuse the existing throttle/flush; no new transport.
- `extension/src/shared/types.ts` — `BatchReplyTweet.band` widened.
- `src/x/routes/replies.ts` — `parseBatchTweets` accepts `'roster'` (never reaches Grok — band is queue metadata).
- `src/x/routes/radar.ts` — confirm coerces `'roster'` → null in the rebuilt `contextSnapshot.signals.band` (extend the `'manual'` coercion; §7.19: never a Playbook hot/warm cell).
- `extension/src/sidepanel/Radar.tsx` — `.radar-band-roster` chip ("your circle") + whyLine.
- Tests: `extension/src/shared/radar.test.ts` (merge upgrade, rank ordering roster-below-warm-within-tier, eviction), replies route `parseBatchTweets` case, radar confirm coercion case.

**How:** The glance map presence check is IIFE-safe (glance cache already lives in content.ts). Ring-buffer pressure: roster rows are auto-captures and evict normally (manual still survives eviction preferentially — RU.8 untouched). The 24h freshness guard is the flood-control: without it a week-old timeline scroll fills the queue with stale debts.

**Tests:** as listed; server cases go in the existing suites.

**Done when:**
- [ ] A quiet fresh post by a glance-map person enters the queue with a roster chip; a stranger's quiet post doesn't; a hot re-sight upgrades the band
- [ ] Batch draft + confirm round-trip: confirmed snapshot's `signals.band` is null, never `'roster'`
- [ ] `bun test` + `bun run typecheck` + `bun run lint` green
- [ ] Committed: `feat(radar): roster sightings — your people enter the queue regardless of band (GT.8)`

**Cost note:** $0 capture (DOM only); the queue feeds the existing per-click batch drafting.

---

## Task 9 (final): docs-sync + smoke
**Depends on:** all prior.

- [ ] `scripts/smoke-growth-tactics.ts` — rerunnable, $0, real DB, surgical cleanup: seeds a throwaway stage-`noticed` person → asserts (a) `/replies/generate` on a dead post for that handle passes the gate and hits the keyless 503 (both LLM keys force-unset in a `finally` — proves gate-open without spend) while a stranger 422s; (b) `buildFormatCooldowns` + the `/posts/cooldowns` round-trip over seeded rows; (c) `buildMilestoneWatch` on a synthetic series; (d) the reciprocity quest arithmetic via the brief route; (e) radar confirm coerces a `'roster'`-band draft's snapshot band to null. Deletes every seeded row on entry + exit.
- [ ] CLAUDE.md: one phase-style entry (what shipped, date, $0/per-click costs, the gate-exemption carve-out rationale, the operator doctrine-bump note).
- [ ] `CIRCLES-PLAN.md` (reciprocity lane + quest) and `PLAN.md` (prompt/cooldown/milestone notes) status lines.
- [ ] `docs/` — Today tab (quest, milestone card, launch seed), Radar section (roster chip), Composer (cooldown chips) docs updated.
- [ ] `evals/i_mika_el_analysis.md` — append a "shipped as GT.1–GT.8" pointer line.
- [ ] `.claude/skills/plan-feature/references/codemap.md`: touched sections updated + header re-stamped.

## Out of scope (do NOT build)

- **No auto-posting, no reply scheduling, no 350/day automation** — every reply stays a human click + manual paste (§7.28). The subject's volume is the operator's choice, not the machine's.
- **No API crawling of small accounts' timelines** (other-user reads are $0.005 — the whole lane is DOM-capture + already-billed data).
- **No seeding `post_templates` with the subject's formats** — that table is measured own-winner extraction; foreign formats pollute C4.
- **No playbook `gateBypass` cell yet** — n≈0 for weeks; add it when the cohort exists (the snapshot field makes it a one-session add later).
- **No auto-override in the extension client** — the exemption lives server-side only.
- **No milestone "already posted" detection**, no dismissal state — 3-day window then silence.
- **No hook-type cooldown** — register/pillar only until extraction coverage is real.

## Risks / watch items

- **Thresholds are opening guesses** (reciprocity target 5/day, roster freshness 24h, cooldown 4-in-7d, milestone window 3d) — C1-threshold spirit, revisit after ~30 days of use.
- **Radar queue pressure**: if the glance map is large, roster sightings could crowd hot/warm rows toward the cap-100 eviction. The 24h guard + rank ordering mitigate; watch the first week.
- **Echo rule vs. "never recite"**: wording must keep the two instructions visibly about different things (post text vs relationship block) or Grok may over-hedge.
- **Gate exemption spend**: replies to dead posts by known people are deliberate spend on relationship, not reach — if the Playbook's roster-coverage/latency numbers later say it doesn't pay, the exemption is one `if` to remove.
- **Prompt-cache bust** is one-time per prompt edit (Tasks 1–2) — expected, not a regression.
- **Live "done when" tails**: the first gate-exempt draft, the first roster chip in a real queue, the first milestone card — all need live use to observe.
