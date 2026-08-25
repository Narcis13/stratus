# Masterplan execution state

> Dynamic memory for `/masterplan`. Updated after EVERY task, in the task's own commit.
> Plan: `plans/MASTERPLAN.md` (static — order, reasoning levels, waves, D1–D10 + Wave-6 seeds D141–D144 + Wave-7 seeds D172–D174 + Wave-8 seeds D185–D187 + **Wave-9 seeds D195–D197, whose numbers COLLIDE with this file's D195 — see the collision note in the register**).
> Codemap: `.claude/skills/plan-feature/references/codemap.md` (updated per task too).
> History: `.claude/skills/masterplan/STATE-ARCHIVE.md` (frozen, grep-only — closed-lane deviations, gotchas, priors, ledger rows).
> Debt: `.claude/skills/masterplan/VERIFY-DEBT.md` (**unpaid**, not history — browser-verify + CA.2. Read it when you have Chrome open; skip it otherwise).

## WAVE 9 IS OPEN — 155/157. Next up: OU.7 — two tasks to the end (OU.7 → OU.8), and OU.7 is the LAST writer of `Outliers.tsx`.

Waves 0–8 closed at 149/149 (RA.8, 2026-08-18). `4ebceb3` registered **Wave 9 (OU — `plans/2026-08-03-search-query-builder.md`, 8 tasks, revised 2026-08-24)** in `plans/MASTERPLAN.md`, and **OU.2 re-opened the ledger below** (2026-08-24). **Outliers**: an x.com advanced-search compiler with a clipboard hand-off and saved hunts, closing the last gap in goal 3’s intake — the swipe file grows only from tweets that happen to cross the timeline, because finding *deliberately* means typing raw operator syntax from memory every session. **The whole wave is $0 by design, not by luck:** X API v2 has **no** `min_faves`/`min_retweets`/`min_replies` operator at any tier, so the API version would pay ~$0.005 per returned result to discard most of them. Invariant #8 says adding a billed read back is a decision made out loud; this wave makes the opposite one on the record, and `searchRecent` stays deleted. **The results page needs no capture code at all** — `content.ts`’s save-button attach has no path gate, so every result already carries **Save to stratus**.

**Between RA.8 and this commit, four lanes shipped OUTSIDE the skill** and are deliberately not in the ledger — they had their own plan files or none at all, and the masterplan was closed the whole time: **RQ.1–RQ.5** (`plans/2026-08-18-radar-live-queue.md`, migration `0030_famous_wrecker`), **SW.1** (the sweep’s media/ads gates — **this is where the two registry knobs came from that made STATE.md’s 61/31 stale**), **OFF-PILLAR/REMIX** (`813dafc`/`3868981`, the drafter’s register triple + off-pillar default), and `b92d783` (calendar tray draft-delete, **still unstamped in the codemap — OU.8 owes it a §5 line**). The codemap §11 log and its header stamps are the record for all four; grep it by lane code, not this file.

**A new lane starts by writing a plan (`/plan-feature`), registering it in `plans/MASTERPLAN.md`, and re-opening the ledger below in that lane’s FIRST commit.** RA.1 and now OU.2 are the worked examples, and the one thing both got right is worth copying: **recount** the `current state` numbers off the running code instead of carrying the line forward. OU.2 recounted and found two stale (registry 61→63 knobs / 31→33 mirrored).

**What is still owed, and it is not a task.** `VERIFY-DEBT.md` holds **twenty-eight** unpaid items — browser checks
that shipped with automated gates only, plus CA.2 step 2. The newest is `0w`, RA's own (the sighting mirror per page,
the kill switch, the **Fetch drafts** hand-off, the pick, and one open question about scoreless angle tabs); `0n(b)`
and `0l` are the only two that spend (~$0.003 and ~$0.010). Nothing there needs a plan or a session of its own: fold
them into whichever session next has Chrome open on the panel, and **delete each entry as you pay it.** That file is
deliberately not in the archive — a debt filed among history stops being owed. **The ceiling on all of them is the
same and is structural:** the stratus panel is a Chrome *side panel*, a page tab cannot read another extension's
`chrome.storage.local`, and the extension service worker has no console reachable from a coding session — what they
need is the human at the browser, not a session with Chrome tools loaded.

**Size discipline (added 2026-07-23 at 339 KB; paid twelve times since — read this before a new wave re-grows the
file).** STATE.md must stay loadable in a **single `Read`**, and the limit that bites is the tool's **token** cap
(~25k), not the 256 KB byte cap. **The budget is measured: at 61.7 KB a single `Read` came back TRUNCATED at 25,023
tokens, so the real ratio is ≈405 tokens/KB and the ceiling is ≈61.5 KB. Aim at 60 KB and leave the last 1.5 KB
unspent.** Measure BYTES with `wc -c`, not `.length` — this file is full of multibyte `—`/`≥`/`✓` and a character
count reads ~1.5 KB under the truth. **Five lessons, each of which cost real sessions:** (1) *the breach is never one
big entry, it is six good ones that each looked affordable* — Wave 6 went 48 KB → 156 KB in fifteen tasks; (2) *a
closing pass archives the lane in front of it and misses the weight behind it* — UI.17 left Wave 5's ledger rows and
every session until GT.9 paid for them, so **also ask what stopped binding two waves ago**; (3) *"it still binds an
open task" is a reason to DISTIL, not to keep 19 KB*; (4) **an ORDINARY task breaches it too, so `wc -c` between
entries, not only before the commit** — JD.5 needed two archive passes in one task; (5) **when a lane CLOSES, its
hot-file lock row and its pointer lines are weight, not state.** Never "fix" a breach by deleting something an open
task needs; if a pass slips, pay it as a standalone housekeeping commit (the `55c6d19`/`c9c8ade` precedent). **OU.6 paid the early-archive clause rather than squeezing: D198/D199/D200/D201/D202/D204/D205/D206 went to `STATE-ARCHIVE.md` (every reader shipped) and the file came back to **51.7 KB** before its own entries landed. OU.8 closes the lane and archives the rest; if OU.7 needs room first, D203/D207/D208 are the next block whose readers have all shipped.**

- **last-commit:** **identity is the SUBJECT LINE — no sha is recorded (D97).** HEAD should read `feat(outliers): channel/target prefills, faves ladder, settings gear (OU.6)`, parent `385a70c`. **Step 0 is one command:** `git log -1 --format='%h %s'`. **Expect ad-hoc commits between masterplan tasks** — four lanes ran outside the skill since RA.8, so a HEAD that doesn’t name a task is normal now; reconcile against this line, not against the whole log.
- **current state of the repo (as of OU.6, 2026-08-25 — recounted, not carried forward):** suite **2590** across **131** files (**OU.6 moved both, and that was the plan's call, not a slip** — panel components still carry no unit tests, but Task 6's Tests bullet routes a pure helper that falls out of a panel task to `extension/src/shared/` with a bun test; `outlierSeed.test.ts` is +7, D213); tables **44**; migrations through **`0031_sharp_screwball`** — **the journal is FREE from `0032`**; registry **16 groups / 69 knobs, 33 mirrored** and **17 prompt keys** (unmoved since OU.3 — the six `x.outliers.*` are all `scope:'server'`); MCP **28 tools** (3 schema / 19 curated / 6 write) — **Wave 9 bumps none of them by decision**; smoke scripts **40**; extension tsconfig `include` shims **12** (OU.6 added no shim — `extension/src/shared/outlierSeed.ts` is IN-tree); panel tabs **15**; whole-repo lint **0 errors**. **`docs/settings-tab.md`’s count strings are CURRENT as of OU.3** (69 knobs / 16 groups / 33 mirrored / 17 prompts, plus the **Outliers** table row and the `### The sixteen groups` heading) — **re-read the strings before believing any staleness claim about them (D205, archived).** The four multi-file moves a new task will hit, each with the assertions that make them fail loudly: **a mirrored knob is SEVEN edits** — `registry.ts` (group array; order decides mirrored position), `registry.test.ts` **twice** (the group’s exact key list *and* the exact mirrored list), `docs/settings-tab.md`’s **three** count strings (prose, asserted by nothing) **plus its group table row**, and extension-side `ServerConfig` + `SERVER_DEFAULTS` + `readServerConfig`, pinned by `serverSettings.test.ts`’s exact `Object.keys` list AND its full-blob `toEqual` (D181d — the server half alone ships a knob that silently does nothing); a **`scope:'server'`** group is three of those seven and no extension build (the `outliers` group is the worked example). **A registry prompt key is FOUR** (`PROMPT_KEYS` + `PROMPT_SPECS`, the default exported from a **pure** module or the import cycles, `registry.test.ts`’s exact key list, and `docs/settings-tab.md`’s three prompt strings). **An MCP tool is SIX doc strings plus three asserted numbers**: `src/mcp.test.ts`’s exact **28**, `scripts/smoke-mcp.ts`’s expected-names list, and in `docs/s2-mcp-server.md` the prose total, the `## The tools` heading, the end-to-end verification line, the `### <tier> (N)` heading **of the tier you touched**, the intro’s prose enumeration of the write tools, and the §"Security & cost invariants" write-ceiling row — plus the counts in codemap §3.3’s `mcp.ts` row **and** §6. **A migration** never runs in two parallel sessions, ignores any number quoted in plan text, and is inspected for dropped seed INSERTs by `git status --porcelain src/db/migrations/` (**not `git diff --stat`** — the new `.sql` and its snapshot are UNTRACKED, so a diff shows only the `_journal.json` append and reads like the SQL never landed) plus a fresh `:memory:` boot counting `content_pillars` (3) — never by grepping for `INSERT INTO`, which `0000`’s `INSERT OR IGNORE` spellings make return 0 (D177a).
- **next-up:** **OU.7** (capture provenance — `voice_tweets.source = 'outlier_search'` + the footer count, **xhigh**) — deps OU.4 ✓ OU.5 ✓ OU.6 ✓, so it is unblocked, and it is the **last writer of `extension/src/sidepanel/Outliers.tsx`** (the lock is now OU.7's alone). **It is also the wave's only task that touches `extension/src/content.ts`** — one field, and §7.26 applies: the content script is a self-contained IIFE, so **do NOT import `../searchQuery.ts` there** (the OU.5 dist grep asserts `min_faves`/`-filter:replies`/`x.com/search` are **0 in `content.js`**, and OU.6 added `x.outliers.minFaves`/`outlier-rungs` to that same 0-in-content check). It reports `location.pathname` and the **server** decides the source. **First-save-wins: do NOT extend `onConflictDoUpdate`'s set-clause to `source`.** The footer is OU.7's by an explicit decision recorded at OU.6 (D215): D209's count is a real `COUNT(*)` that reads **0** until the stamp exists, so a footer shipped a task early renders a correct number that looks like a broken feature — the OU.5 fresh-form trap (last gotcha below) repeating. `CAPTURE_WINDOW_DAYS = 30` is a local constant and deliberately not `x.outliers.sinceDays` (D209). What OU.6 leaves it: the tab now has FOUR mount reads (`searches.defaults`, `searches.list`, `channels.list`, `voice.targets`) — a fifth is not needed, `GET /x/searches` already carries `capture` on the list call OU.5 wired (D208a), so the footer is a render, not a fetch. Gate reminders: `bun run test` (bare `bun test` targets the file DB and `inspect.test.ts` fails 2/2); extension-touching work owes `cd extension && bun run build` **plus** the extension's own `typecheck`; biome forbids non-null assertions (`x!`), a `let` assigned once and a backtick string with no interpolation, and sorts import specifiers **case-sensitively** — run `bunx biome check --write` on the changed files FIRST, it reformats JSX aggressively.

## Ledger

Status: `[ ]` todo · `[~]` in progress (lane claimed) · `[x]` done (sha + date) · `[s]` skipped (reason in deviations).

**Waves 0–8 are CLOSED — 149/149. Wave 9 is OPEN — 6/8, total 155/157.** Per-task entries for the closed waves
(shas, parents, dates, notes) live in `STATE-ARCHIVE.md` — Waves 0–4 at UI.11, Wave 5 at GT.9, Wave 6 at JD.8,
Wave 7 at RC.5, **Wave 8 at RA.8**. Grep by task id. Wave 9's rows are live below and stay here until OU.8.

- **Wave 0 — Foundations (13/13 ✓)**: UI.1, UI.8, UI.9, UI.10, ST.1–ST.9. Closed by `d1902e5` ST.9 studio docs+smoke.
- **Wave 1 — Prompt & identity core (32/32 ✓)**: RU.1–RU.3, N.1–N.9, ME.1–ME.7, AI.1–AI.13. Closed by `f86e06a` AI.13 AI docs+smoke.
- **Wave 2 — Reply machine & on-page surfaces (29/29 ✓)**: RU.4–RU.10, AX.1–AX.7, RL.1–RL.8, NT.1–NT.7. Closed by `5d4a1a4` NT.7 NT docs+smoke.
- **Wave 3 — Ambient data & guardrails (16/16 ✓)**: HV.1–HV.6, GR.1–GR.10. Closed by `docs(guardrails): GR docs-sync + $0 smoke-guardrails.ts (GR.10)`, parent `7adfbca`.
- **Wave 4 — Authoring 3.0 (15/15 ✓)**: A3.1–A3.15. Took migration `0023_slimy_night_thrasher` (`articles`). Closed by `docs(authoring): Authoring 3.0 docs-sync + $0 smoke-authoring3.ts (A3.15)`, parent `819c61d`.
- **Wave 5 — Settings moat + polish (16/16 ✓)**: UI.2–UI.7, UI.11–UI.17. Closed by `docs(ui): cockpit overhaul docs-sync + $0 smoke-settings.ts (UI.17)`, parent `7b10239`.
- **Wave 6 — Coach, judge & growth tactics (25/25 ✓, + GT.5 `[s]` by design)**: SC.1–SC.9, GT.1–GT.9, JD.1–JD.8. Took migration `0024_soft_leopardon` (`draft_judgments`). Closed by `docs(judge): LLM-judge docs-sync + $0 smoke-judge.ts (JD.8)`, parent `fc44d1c`.
- **Wave 7 — Radar follow-ups: curated drafting & humanize-at-pick (10/10 ✓)**: HM.1–HM.5, RC.1–RC.5. Took migration `0025_curvy_edwin_jarvis` (`radar_drafts.curation_score`). Closed by `docs(radar): RC docs-sync + $0 smoke-radar-curate.ts (RC.5)`, parent `80a2f2b`.
- **Wave 8 — Radar access from a Claude Code session (8/8 ✓)**: RA.1–RA.8, plan `plans/2026-08-17-radar-access.md`, opened by `d968fe9`. **$0 lane.** Took migration `0029_blushing_expediter` (`radar_sightings`). Closed by `docs(radar): RA.8 radar-access docs-sync + $0 smoke-radar-access.ts`, parent `c02ff88`, 2026-08-18.

- **Wave 9 — Outliers: X advanced-search compiler, clipboard hand-off, saved hunts (6/8)**: plan
  `plans/2026-08-03-search-query-builder.md` (written 2026-08-03, **revised 2026-08-24** — the revision is the spec,
  the 08-03 text is superseded in six places it names). Registered in `plans/MASTERPLAN.md` by `4ebceb3`; ledger
  re-opened by OU.2. **$0 lane — no `xFetch`, no `askLLM`, no image call on any path.** Took migration
  `0031_sharp_screwball` (`saved_searches`); **the wave takes no further migration**. **The two no-dep tasks are spent —
  from OU.4 on this is one serial lane.**
  - [x] **OU.2** `saved_searches` table + migration `0031` — `feat(outliers): saved_searches table + migration 0031 (OU.2)`, parent `813dafc`, 2026-08-24. **Also carried the wave's re-opening** (D198). Schema-only: no route, no consumer, no new test.
  - [x] **OU.1** pure compiler `src/shared/searchQuery.ts` + `FAVES_LADDER` — `feat(outliers): pure x.com search-query compiler + validator (OU.1)`, parent `6721b48`, 2026-08-24. **The x.com spot check was RUN, not deferred** — 2026-08-24, live, recorded in the module header (see the gotcha on the VERIFY-DEBT ceiling). 2 files, both new, **no consumer yet**: OU.4 mounts the route, OU.5 adds the shim. D201–D203.
  - [x] **OU.3** `outliers` settings group, 6 `scope: 'server'` knobs — `feat(outliers): outliers settings group — default engagement floors + window (OU.3)`, parent `1ff9166`, 2026-08-24. Registry **63→69 knobs / 15→16 groups / mirrored UNMOVED at 33 / 17 prompts**, recounted not trusted — the plan's predicted 69/16/33 held. The repo's **first all-`server` group**, so §7.24's seven-edit move was the server three. D204–D206. **Its code half arrived in the working tree from a prior session and this task finished the docs half + bookkeeping** (D206).
  - [x] **OU.4** `/x/searches` CRUD + `compile`/`run`/`defaults` + mount — `feat(outliers): /x/searches CRUD + compile/run/defaults routes (OU.4)`, parent `8e97de7`, 2026-08-24. 3 files, 2 new; **the composed app was hit for real**, not just the bare-Hono suite. Suite 2557 → **2583** / 130 files. D207–D209.
  - [x] **OU.5** Outliers tab — form, live preview, Copy + Open in X, saved list, the 12th shim — `feat(outliers): Outliers tab — query builder, clipboard hand-off, saved hunts (OU.5)`, parent `37d8fd2`, 2026-08-25. 7 files, 2 new; **all extension-side**, so the gates were `bun run build` + the extension typecheck + a `dist` grep, and the **suite did NOT move (2583/130)** — panel components carry no unit tests (§5). Tabs **14 → 15**, shims **11 → 12**. The claim the grep alone cannot make was paid by a throwaway composed-app round-trip: the panel's local compile is **byte-identical** to what `POST /x/searches` stores. D210–D212.
  - [x] **OU.6** prefills — channel keywords, target roster, faves ladder, `SettingsGear` — `feat(outliers): channel/target prefills, faves ladder, settings gear (OU.6)`, parent `385a70c`, 2026-08-25. 4 files, **2 new** (`extension/src/shared/outlierSeed.ts` + its test); all extension-side, and **`api.ts` needed no edit at all** — `channels.list` and `voice.targets` already existed, so the plan's "add only what is missing" added nothing. Suite **2583 → 2590 / 131** (D213 — the plan's own Tests bullet, not a slip). **The D195(plan) decision is taken: OU.7 keeps the footer** (D215). D213–D216.
  - [ ] **OU.7** `voice_tweets.source = 'outlier_search'` provenance + footer count — deps OU.4, OU.5, OU.6, **xhigh**. First-save-wins; do NOT extend `onConflictDoUpdate`'s set-clause to `source`.
  - [ ] **OU.8** OU docs-sync + `$0 scripts/smoke-outliers.ts` + the browser pass — deps all, high. **Also owes `b92d783` a codemap §5 line** (unstamped since 2026-08-23).

## Hot-file locks

**Wave 9's locks, declared by OU.2, updated at OU.4.** Nothing is held right now — the server half is finished and
`src/x/routes/searches.ts` released — and from here the only contended file is the panel component:

| File | Owner / order | Why |
|---|---|---|
| `extension/src/sidepanel/Outliers.tsx` | **OU.7 alone** (OU.6 released it) | The wave's hot file, and the contention is over: OU.7 is the last writer. The plan tags OU.7 `[parallel-ok]`; **that tag was wrong** (D195 in `plans/MASTERPLAN.md`) — OU.7's last bullet renders the capture-count footer *in the tab*, so all three wrote the same component. **OU.7 also takes `extension/src/content.ts`, which no OU task has touched yet.** The RC/HM `Radar.tsx` situation repeating: a plan sizes tasks by concern, the masterplan sizes lanes by file. |
| `src/x/routes/searches.ts` | **released by OU.4** | Written once and finished; no server-side hot-file race exists in this wave. OU.5–OU.7 CALL it and none of them should need to edit it — if one does, note it, because the route's contract is now quoted in three places (its own header, codemap §3.4, and the next-up above). |
| `src/shared/searchQuery.ts` | **released by OU.1** | Written once and finished. OU.4 and OU.5 IMPORT it; neither should edit it. If a later task finds the compiler wrong, that is a change to a module two surfaces already render — fix it there, and re-run the header's x.com spot check before trusting a new operator. |
| `src/x/db/schema.ts` + migrations journal | **released by OU.2** | The wave takes no further migration; the journal is free from `0032` for any *other* lane. |

**The wave's only parallel pair (OU.1 ∥ OU.3) is spent — both shipped, and everything from OU.4 on is a single
lane, so no lane-picking decision remains in this wave.** `src/x/settings/registry.ts` was held by OU.3 and is
**released**; the wave touches it no further. The documented
way to reach a closed lane's file notes is to **grep `STATE-ARCHIVE.md` by filename** before touching a file that
lane built. One standing invariant survives the table: **never run two migration-generating tasks in parallel
sessions** (journal conflicts), ignore any hardcoded migration number in plan text — *a plan quoting one is quoting
the day it was written* — and always `bun run db:generate` against the current journal, then inspect the SQL for
dropped seed INSERTs (codemap §4). The journal is free from **`0030`**.


## Deviations & decisions register

**Every lane's register is in `STATE-ARCHIVE.md`** — grep by task id or by the filename the lane built. Waves 0–3,
the Wave-4 closer D127, the registry lane D128–D133, the polish lane D134–D140, the GT/SC lanes, the whole JD lane
(D149/D160/D162–D171) at JD.8, the HM lane (D175/D178/D180/D182) at HM.5, the RC lane (D176/D177/D179/D181/D183/D184)
at RC.5, and **the whole RA lane (D188–D194) at RA.8**. What stays below is only what is **standing** — true of the
repo regardless of what you are building — plus D171 and D184, whose findings bind any future smoke or docs pass.

- **D7** (standing): all NEW UI from Wave 1 on uses UI.10 primitives + `--strat-*` tokens; Wave-5 polish passes touch only pre-masterplan tabs.
- **D97** (standing, bookkeeping): **the ledger records the commit SUBJECT LINE, not a sha.** Three tasks in a row wasted a Step-0 investigation proving a recorded sha was an amend-orphan, and every time the resolution was "the subject line is the identity". A sha can only be written into the commit that changes it by amending, which changes it again — the churn is structural, not carelessness. Ledger entries carry the subject line + the PARENT sha (stable, already in history), the codemap header stamps `<parent>+<TASK>`, and Step 0 is `git log -1 --format='%h %s'`.
- **D113(d)/(e)** (GR.10, standing — binds every future smoke; parts (a)–(c) are in the archive): **(d) A smoke over a surface whose READS WRITE cannot follow `smoke-passive-harvest.ts`.** D98c's namespace-then-delete rule assumes every write is attributable; two Guardrails writes are GLOBAL (a complete-run reconcile marks EVERY unseen live handle `gone`; `GET /following/queue` releases rows at read time). So `smoke-guardrails.ts` additionally **snapshots and restores** every foreign `following.status` (from the success path AND from `fail()`), plus `commitments` and the seeded `streaks`/`digests` keys — and, because its fixtures sit inside today's window while `GET /x/brief` writes the C9 diary, it closes by **re-reading the brief** so the diary describes clean data rather than deleted fixtures. Copy this, not D98c alone. **(e) A fixture fact the plan's sequence hides:** "unseen" in the reconcile is `last_run_id != runId` — per **run**, not per batch, so proving `gone`/`confirmed` needs TWO runs.
- **D171** (JD.8, standing — binds every future closing docs-sync and every future smoke; full four-part text in the archive): **the two halves that outlived their lane.** **(a) A task whose output is a PROMPT or a SELECTION RULE changes what every draft says, and belongs in the tab doc of the surface that RENDERS it** — "which tab does the user see this on" always has an answer, even when "which tab did I edit" does not. GT.9 wrote this as a note and JD.1 shipped invisible three tasks later, which is how a note fails; RC.1 is what it looks like when it works (a prompt task with no tab of its own wrote its paragraph into `docs/settings-tab.md`, where the Prompts subtab renders it). **(c) `--live` is not a style choice: ask what a $0 run cannot claim, and if that list is empty ship no flag.** Also (b): a phase line goes in `PLAN.md`'s blockquote block above §"Product, in one paragraph each", never §"Phased build", which is the original five-phase build-out and takes no new phases.
- **D184** (RC.5, standing — Wave 7's last entry; full text in the archive): **two findings that bind any future work.** **(a) A BEST-EFFORT write must be verified by a READ-BACK, and the failure message must name the real cause.** `persistRadarDrafts` swallows insert failures by design (§7.8), so a missing column is **zero rows**, not a throw — a smoke asserting "the call didn't throw" is green on an unmigrated database. Generalizes to every `safeLog…`/`persist…` side hook. **(b) State the claim a smoke cannot make, in its header.** RC.5 could not prove "a ⊕ pin never reaches the curate request" — that is the panel's `partitionForCurate`, and `scripts/` may not import the extension build (§5) — so it says so and proves the two halves the route layer owns instead. A silently dropped done-when reads as coverage the script does not have.
- **D-NUMBER COLLISION, resolved by SOURCE not by renumbering (OU.2).** `plans/MASTERPLAN.md`'s Wave-9 seed block is
  labelled **D195–D197**, and STATE.md already spent **D195** on RA.8 below. Both stay as they are: every OU task
  block and the Wave-9 table cite the plan's numbers, and renumbering would break those citations. **Cite a Wave-9
  seed as "D195/D196/D197 in `plans/MASTERPLAN.md`"** — D195 unqualified below always means RA.8's entry. The live
  STATE-side register resumes at **D198**.
- **The OU lane's spent register — D198/D199/D200/D201/D202/D204/D205/D206 — moved to `STATE-ARCHIVE.md` at OU.6** (the size discipline's early-archive clause; every one of them binds a task that has shipped). Grep the archive by the D-number or by `saved_searches`/`registry.ts` if a late OU task needs the reasoning. What stays below is D203 (the compiler's warn semantics, which OU.8's docs describe) and D207–D212, which bind OU.7/OU.8.
- **D203** (OU.1, standing for the compiler — **a multi-word term in `any`/`none` WARNS**). Not in the plan's rule list, but the same family as the `:`-in-a-keyword warn it does mandate, and it is a real mis-parse rather than a style opinion: `-build in public` compiles to `-build AND in AND public` (only "build" is excluded, and the other two words become REQUIRED), and a multi-word member inside the OR group ANDs within it. Both **warn and still compile** (§7.23a — the warn half never refuses). **A silent auto-quote to `-"build in public"` was considered and refused:** the compiled string is displayed live right where the user is looking, so a rewrite would be invisible in the one place it needed to be visible; the warn plus the visible string teaches what X will actually do. `all` is NOT warned — it is space-joined AND either way, so a multi-word term there means exactly what it looks like.
- **D195** (RA.8, standing — the masterplan's last entry; three divergences from the closing task's own plan text, and each one generalizes). **(a) A smoke that needs a config must BRING one, not trust the operator's.** The plan's "mount `settings` for the admitted-flip check" left open *what* to flip; against the real DB the live sweep filters are whatever the operator last tuned, so fixtures built to "clear the gates" are only deterministic by luck. `smoke-radar-access.ts` instead PATCHes the **eight admission knobs** to a known wide-open set (asserting all three rows admitted), then moves **one** knob and asserts two verdicts change — which is a stronger claim than the plan's, because the only variable is the knob. Both the patch and the row deletes snapshot-restore by `isDefault` from `fail()` as well as the success path (D113(d)). **(b) "Confirm the counts are still right rather than assuming" found them wrong, and a closing task fixes what it finds.** `docs/settings-tab.md` claimed 67 knobs / 16 groups / 32 mirrored / 16 prompts against a registry of **61 / 15 / 31 / 17** — the 2026-08-12 read deletion had taken the whole **Mentions** group and four of five **Workers** knobs with the billed reads they configured, and nothing asserts any of those strings. RA.1 had recorded it as "not RA's to fix", which was right while a next task existed; with the masterplan closing there is no next task, and a wrong number left behind with a note pointing at nobody is worse than a five-minute edit. **Generalize: a "not mine to fix" deferral is a bet that someone comes after you. The task that closes the lane is the one that loses that bet.** **(c) The browser end-to-end went to `VERIFY-DEBT.md` (`0w`) rather than being done, and the reason is structural rather than scheduling.** The RA.2 gotcha said "do them at RA.8 rather than filing a sixth debt entry" — but the panel is a Chrome *side panel*, a page tab cannot read another extension's `chrome.storage.local`, and the service worker has no console a coding session can reach, so RA.8 could not have paid them however long it sat. Filing beats claiming: `0w` names the five checks and the one open question (whether the angle-tab strip renders a **scoreless** composed variant gracefully) so the human at the browser can walk them in one sitting.
- **D207** (OU.4, binds OU.5 — **`sort` has exactly ONE authority and it is the COLUMN; the stored JSON never carries it**).
  D200/D201 settled where the *default* comes from and left open where the *value* lives, and the table plus the
  `SearchQuery` type give it two homes. The route resolves `body.sort ?? normalizedQuery.sort ?? x.outliers.sort`
  (never the column's `'live'`), writes it to the **column**, and **strips `sort` out of the JSON** it stores
  (`storedQuery()`); every read merges the column back in, so the API always hands out a *complete* `SearchQuery`
  while the two representations can never diverge. The alternative — store it in both and keep them in sync — was
  refused because a disagreement between them would be invisible, which is the same failure D200 was written about
  one layer down. **Consequence for OU.5:** the form binds straight to `saved.query` (its `sort` field is populated)
  and posts the whole object back; an explicit body `sort` is accepted but redundant, because a patched query's own
  `sort` field moves the column with it. A test reads the raw column and asserts the JSON has no `sort` key.
- **D208** (OU.4, binds OU.5 and OU.8 — **three shape calls the plan's Design §3 table left open**). (a) **`GET
  /x/searches` items are the SAME `{saved, compiled, url}` shape as `GET /x/searches/:id`.** The table specifies the
  detail shape and says only `searches: [...]` for the list; making them identical means OU.5's Load path is one
  function instead of two, and the list already has to carry `compiled` for its one-line preview. (b) **`POST
  /x/searches/compile` answers `200` even when the query has errors**, with them in `problems` and `url: null` — it
  is a *preview*, the form disables Copy off `problems` (§7.23a's warn/error split is already in the payload), and a
  400 would tell it nothing the body doesn't. Only the WRITE paths 400 on an error problem, which is where refusing
  actually prevents something (a stored row whose Copy button can never work). (c) **`GET /x/searches/defaults`
  returns `problems` alongside `{query, ladder}`** — the plan's table omits the field but its How-text requires the
  `lang` warn to go somewhere, and swallowing it would leave the one unvalidated knob (D204) silently ignored.
- **D209** (OU.4, binds OU.7 — **the capture window is a local constant, deliberately not `x.outliers.sinceDays`**).
  `capture.days` is `CAPTURE_WINDOW_DAYS = 30` in `routes/searches.ts`. Binding it to the registry knob was the
  obvious move and is wrong: `sinceDays` is *how far back a hunt looks*, so re-tuning a hunt would silently redefine
  what the footer counts and make two numbers on the same screen mean different things. The count itself is a real
  `COUNT(*)` over `voice_tweets.source = 'outlier_search'` filtered on `savedAt` (not `createdAt` — the question is
  when WE stashed it, not when it was posted), returning 0 until OU.7 stamps the source; a test inserts such a row
  and asserts the number moves by one, which is the only way to prove a zero is a measurement rather than a literal.
  **OU.7 therefore changes the writer and touches nothing here.**
- **D210** (OU.5, binds OU.6/OU.8 — **a hand-off is a run, whichever button did it**). Task 5's How-text attaches the
  `api.searches.run(id)` stamp to the **Open in X** bullet, but names the clipboard in the same sentence's failure clause
  ("must never block the clipboard or the tab"). Stamping only Open would make `last_run_at` mean *the last time I used the
  secondary button* — and the 08-24 revision made **Copy the primary hand-off** precisely because pasting is what the user
  actually does. So **both paths stamp**, fire-and-forget, and the response's `lastRunAt` is patched into local list state
  rather than triggering a refetch. An unsaved ad-hoc query still skips it entirely (there is no row). Nothing about OU.8's
  smoke changes — it drives `POST /searches/:id/run` directly.
- **D211** (OU.5, binds OU.6 — **phrases split on NEWLINES only; every other list field splits on commas OR newlines**).
  Not a rule the plan states. `splitTerms` is `/[\n,]/` so a pasted list works either way, but a comma inside an exact
  wording is *part of the phrase* — cutting `"build in public, fast"` into two phrases would silently change what X matches,
  and the compiler cannot detect it because both halves are legal. It is the one field where the separator choice changes
  semantics rather than ergonomics. **Consequence for OU.6:** the channel-keyword prefill targets `any`, which is
  comma-joined, so appending is `set({ any: [...existing, ...fresh].join(', ') })` — string-level, deduped against what is
  already there, and `parseSearchQuery` does the trimming.
- **D212** (OU.5, standing for any client that previews a server-normalized value — **the panel runs the NORMALIZER, not
  just the formatter**). `toQuery(form)` is literally `parseSearchQuery({...raw form strings...})` rather than a hand-built
  `SearchQuery`. The cheap reason is `exactOptionalPropertyTypes` (a direct build is nineteen conditional spreads); the
  load-bearing one is that dedupe, the 20-term cap and the `0`-floor carve-out all live in `parseSearchQuery`, so compiling
  the **raw** form would preview a string the server would never store — which is exactly the divergence §7.27's shim exists
  to prevent, reintroduced one layer up. Checked, not assumed: a throwaway script drove the composed app and asserted the
  panel's local `compileSearchQuery(toQuery(f))` is **byte-identical** to the `compiled.query` a `POST /x/searches` of the
  same value returns, that `url` matches `searchUrl` exactly, and that a `GET /x/searches` item is byte-identical to the
  `GET /x/searches/:id` body (D208a — Load really is one function). **Generalize: sharing the compiler is only half of
  §7.27; a preview that skips the storage-boundary normalizer still drifts.**

- **D213** (OU.6, corrects this file rather than the plan — **the suite MOVED, and the plan is why**). STATE's next-up
  predicted "the suite count must NOT move from 2583/130", reasoning from §5's convention that panel components carry no
  unit tests. That convention is about **components**; it is not a rule that a task touching only components may add no
  test. Task 6's own Tests bullet says the opposite in advance: *"If any pure helper falls out of this task (e.g. a
  dedupe-merge for the keyword append), put it in `extension/src/shared/` and bun-test it there rather than inlining it in
  the component."* `mergeTerms` is exactly that helper — case-insensitive dedupe plus a cap with a `dropped` count, three
  edge cases worth pinning — so it shipped as `extension/src/shared/outlierSeed.ts` + `outlierSeed.test.ts` (+7 tests, 131
  files). **Generalize: a prediction in the next-up is a forecast, not a constraint; when the source plan explicitly
  provides for the thing the forecast rules out, the plan wins and the forecast gets an entry.**
- **D214** (OU.6, binds OU.7/OU.8 — **the ladder STEPS through `nextRung`/`prevRung`; the fetched `ladder` fills a
  datalist**). The plan and this file both said "the rungs come from `api.searches.defaults()`'s `ladder` field so the panel
  and server cannot disagree". Taken literally that requires a step function over an arbitrary array — i.e. a second copy
  of `nextRung`/`prevRung` inside the panel, forking the exact logic OU.1 wrote and tested, and leaving those two exports
  with no consumer in the tree. The disagreement it guards against **cannot occur**: `extension/src/searchQuery.ts` inlines
  `src/shared/searchQuery.ts` into the build, and the route's `ladder` is literally `[...FAVES_LADDER]` from that same
  module — the panel's rungs and the server's have one source, exactly as the *compiler* already does (OU.5 shipped a
  locally-compiled preview on that basis, so requiring server authority for the rungs but not for the query would be
  inconsistent). So: stepping calls the pure helpers, and the fetched `ladder` gets a **real** job instead of being dead
  API surface (§7.33) — a shared `<datalist id="outlier-rungs">` on all three floor boxes, so the rungs are visible
  without clicking. **Generalize: "so X and Y cannot disagree" is a claim about the import graph — check whether they
  already share a source before paying a fork to enforce it.**
- **D215** (OU.6, the decision `plans/MASTERPLAN.md`'s D195 left open, taken out loud — **OU.7 keeps the capture-count
  footer**). D209 made the count a real `COUNT(*)` over `voice_tweets.source = 'outlier_search'`, which reads **0** until
  OU.7 stamps that source. A footer shipped here would therefore render a correct number that looks like a broken feature
  for one task — the same trap as OU.5's fresh form opening in an error state (last gotcha below), and the reason `dropped`
  counts exist in `mergeTerms` at all. OU.7 already owns the writer that makes the number non-zero, so the footer costs it
  nothing extra. Nothing about OU.8's smoke changes either way — it drives the route, not the tab.
- **D216** (OU.6, binds OU.8's browser pass — **"New hunt" now RE-READS `GET /x/searches/defaults`**, and that is what makes
  the gear observable). OU.5's New hunt replayed the mount-time seed, so done-when #6's "changing a default in the tab's
  gear changes what the next fresh form opens with" would have been false until a panel reload — the gear would have looked
  inert, which is worse than absent. `loadDefaults()` is now a `useCallback` used by both the mount effect and the button,
  and a failed re-read falls back to the last seed we did get. **One window survives and is not worth closing:**
  `useSettingsEditor` debounces its PATCH by 400 ms, so a New hunt clicked in the same breath as a slider drag can still
  read the old number; closing the popover first is enough, and the code says so at the call site.

## Gotchas log

Things the next implementer must know that aren't obvious from the code. Append-only, one line each, newest last.

**Every closed lane's gotchas are in `STATE-ARCHIVE.md`** — grep it by task id or filename before touching a file a
closed lane built (Wave 6's at JD.8, the HM lane's at HM.5, the RC lane's at RC.5, **the RA lane's 22 at RA.8**).
What stays below is the standing set: test/lint/typecheck traps that bite any task, the Wave-3 carry-forward, and
the three RA findings that are about the repo rather than about the Radar.
**Browser-verification debt is not here — it is `VERIFY-DEBT.md`**; a debt parked among facts reads as a fact.

- **Settings types are extension-local mirrors.** The extension MUST NOT import `src/x/settings/registry.ts` (§5 build-isolation); it mirrors the `GET /x/settings` JSON in `extension/src/shared/types.ts`, and a new server-side `SettingDef` field is hand-synced there. **The same wall bites `scripts/`, in the other direction:** a smoke may not import the extension build, which is why `smoke-humanizer.ts` keeps a local `mulberry32` and `smoke-radar-curate.ts` cannot test `partitionForCurate`. (Full block in the archive; grep `Settings types are`.)
- **`exactOptionalPropertyTypes` pass-through pattern (UI.10):** primitives forwarding a maybe-undefined optional (`Slider.unit`, `SettingRow.onReset`, `GearPopover.onReset`/`label`) type the prop as `T | undefined` explicitly — else TS rejects `prop={maybeUndefined}`. Reuse this for new primitives that relay optionals. Root tsconfig also has **`noUncheckedIndexedAccess`**, so `arr[0]` is `T | undefined` — name your fixtures as consts rather than indexing them in a script.
- **`inspect.test.ts` fails 2/2 under bare `bun test`, GREEN under `bun run test`** (the canonical `SQLITE_PATH=:memory: bun test`). `src/db/client.ts` defaults to `:memory:` when `NODE_ENV==='test'`, but `src/x/data/inspect.ts`'s readonly connection still defaults to `./stratus.db` when `SQLITE_PATH` is unset — the primary writes memory, the readonly reads the file, seeded rows are invisible. **Always gate with `bun run test`.** One-line fix for a future data-core task: make `inspect.ts` honor the same `NODE_ENV==='test'` default (or have `client.ts` `process.env.SQLITE_PATH ??=` set it so both agree).
- **A route suite over the composed `app` tests the WIRING; a bare-Hono suite tests the ROUTE** (D179a, generalized). `src/app.test.ts`'s guards sit behind `describe.if(authed)` and need `API_TOKEN`, and an LLM-gated router refuses to mount without a provider key (§7.22) — so on a clean checkout those tests do not run at all. An LLM route needs its own bare-Hono suite (`judge.test.ts` / `drafter.test.ts` / `replies.test.ts` / `humanizer.test.ts`) or its refusal ladder is untested on any machine that isn't fully configured. **There is no `mock.module` anywhere in this repo:** the established substitute is a 400 ladder ending in a forced 503 with both provider keys unset in a `finally` (which also proves for free that the prompt + input rendered), plus unit tests over the post-spend parsers.
- **NT.1: extension typecheck does NOT cover `*.test.ts`** — `extension/tsconfig.app.json` has `"exclude": ["src/**/*.test.ts"]`, and root `tsconfig.json` only includes `src/**/*` + `scripts/**/*` + `drizzle.config.ts`. So an extension test file is checked by **`bun run test` alone**; a type error in one is invisible to both typechecks.
- **NT.7: `app.request(...)` is typed `Response | Promise<Response>`.** A helper declared `function f(): Promise<Response> { return app.request(...) }` fails root typecheck; make the helper `async`. `bun run typecheck` covers `scripts/**`, so this bites in smoke scripts, not in route suites (which `await` inline).
- **CLAUDE.md was slimmed to guardrails-only (2026-07-23, out-of-skill docs refactor).** The full phase-entry ledger moved **verbatim** to `docs/PHASE-HISTORY.md`. **Every docs-sync task (MASTERPLAN global rule 6, codemap §7 rule 29) appends its phase entry to `docs/PHASE-HISTORY.md`, NOT CLAUDE.md**; CLAUDE.md changes only when a guardrail (invariant, workflow, stack quirk) changes. Plan text still saying "CLAUDE.md phase entry" means the history file.
- **Wave-3 carry-forward — the four repo-wide facts (everything else HV/GR is in the archive):** **(1) MCP tool count is asserted exactly.** `src/mcp.test.ts` asserts **28** (RA.4 last moved it); every future tool bumps that number *and* the **six** unasserted strings in `docs/s2-mcp-server.md` — see the `current state` line above for the full six-plus-three move — **in the same commit**. That doc was silently 5 tools stale for four phases, and its `### <tier> (N)` heading was found stale again at RA.3. **(2) Docs assert user-visible strings.** `docs/harvest-tab.md`, `docs/playbook-tab.md`, `docs/people-tab.md`, `docs/today-tab.md`, `docs/composer-tab.md`, `docs/replies-tab.md`, `docs/radar-tab.md` and `docs/settings-tab.md` quote real copy — **reword a quoted string and you owe the doc in the same commit** (`docs/today-tab.md` is numbered §1–§18, so an inserted card renumbers rather than appends). **(3) Real-DB fixture rules that outlive their lane:** a seeded `posts_published` row is written **`retired: true`** (NT.7 — otherwise it is a candidate for the daily *billed* pass), a `following` fixture needs a `following_runs` row first (`last_run_id` is a notNull FK), people-layer handles must be **≤15 chars** (longer ones are silently skipped and the assertions go vacuous), and any suite touching `scheduled_posts`/`posts_published` inside the monitor's windows must delete its rows in `afterAll` — `monitor.test.ts` asserts `clusterCount === baseline + 1` and a leaked pending pair breaks a different file. **(4) Five reads WRITE and none of them may be polled:** `/radar/drafts` (48h expiry), `/following/queue` (release + revoke), `/x/goals`, `/x/brief` and `/x/digest` (all three settle `active → achieved|missed`). A3.8's Today card and A3.14's week board both sit on `/x/brief` — a refresh loop there silently advances goal statuses.

- **RA.6 — a smoke script casts `await res.json()`, so NOTHING type-checks the field names it asserts.**
  `scripts/smoke-passive-harvest.ts` was red for a week because `db96a4c` renamed `FunnelCell.band` → `bucket`;
  no typecheck, test or lint covers a smoke's assertions about a response shape. **Renaming a field on a response
  any smoke reads is a two-file change** — `grep -rn '<oldField>' scripts/` before landing it — and **a red smoke
  is evidence about the SCRIPT until you have located the assertion.** (Also in codemap §7 as the RA.6 addendum.)
- **RA.7 — `.claude/skills/radar-analyst/` is a RENAME-COUPLED surface, like the quoted strings in `docs/*.md`.**
  It names ten MCP tools, four routes, a dozen response fields, a storage key (`radarSightingSync`), the model
  string `claude-code-mcp`, the panel's three note strings and ~20 real column names. Nothing asserts any of it.
  A task renaming any of them owes this skill in the same commit; the cheap check for the SQL half is D194d's
  `runSelect()` sweep. Same rule for `.claude/skills/stratus/`.
- **RA.7/D194d — a documentation task CAN have a gate, and a doc shipping SQL should have one.** Extract every
  block and run it through **`runSelect()`** — the same function `x_query` calls — against a freshly migrated DB
  (`SQLITE_PATH=<tmp>` so `inspect.ts`'s readonly connection and the primary agree; see the `inspect.test.ts`
  gotcha above). It proves the recipes parse AND that every identifier is real, and costs nothing. Throwaway
  script, not committed.
- **OU.2 — `git diff --stat src/db/migrations/` does NOT show a new migration; the `.sql` and its snapshot are
  UNTRACKED.** The diff shows only the `_journal.json` append, which reads exactly like the SQL never landed. Several
  prior deltas in codemap §4 describe the diff as showing all three files, and that description is wrong — it was
  presumably run after a `git add`. **Use `git status --porcelain src/db/migrations/`** for the three-file check
  (`M meta/_journal.json`, `?? 00NN_*.sql`, `?? meta/00NN_snapshot.json`), and keep the fresh-`:memory:` boot as the
  real proof.
- **OU.2 — a "no index" table still reports one index, and it is SQLite's, not yours.** `PRAGMA index_list` on any
  table with a `text` PRIMARY KEY returns `sqlite_autoindex_<table>_1` with `origin: 'pk'` and `sql: null`. Check
  `origin` before concluding a table you declared index-free grew one — `reply_lists` is the identical control.
- **RA.6 — `chrome.storage.local` is unreachable from every tool in a coding session, so a toggle question goes to
  the operator.** The stratus panel is a Chrome *side panel*, not a tab; a page tab cannot read another extension's
  storage, the claude-in-chrome MCP drives tabs only, and the extension service worker has no console you can reach
  from here. Every `VERIFY-DEBT.md` browser item has the same ceiling: what they need is the human at the browser.
- **OU.1 — the `VERIFY-DEBT.md` ceiling is about the SIDE PANEL, not about the browser, and OU.1 is the worked
  counter-example.** Every debt entry says "what they need is the human at the browser" because a page tab cannot
  read another extension's `chrome.storage.local` and the service worker has no reachable console. **None of that
  applies to an ordinary web page.** OU.1's plan-mandated x.com operator check was run live from the session with the
  claude-in-chrome MCP — navigate to `https://x.com/search?q=…&f=live`, `get_page_text` to read the top result's own
  reply/repost/like/view counts, confirm the floor held — and it took four navigations. **Before filing a browser
  item as debt, ask which half it needs:** panel/extension storage ⇒ genuinely blocked, file it; x.com's own pages ⇒
  pay it now. A bonus the method gives for free: reading the METRICS off the returned posts is what proves a filter
  fired, whereas "results came back" proves nothing — a retired operator returns the unfiltered firehose.
- **OU.1 — `USERNAME_RE` is the EIGHTH copy in the tree, not the plan's "third".** The task block says to copy the
  constant and not refactor the two it names (`routes/voice.ts`, `routes/replyLists.ts`); the instruction stands and
  was followed, but the count in it is stale — `grep -rn 'USERNAME_RE' src extension` finds it also in
  `radar/corpus.ts`, `routes/harvest.ts`, `routes/replies.ts`, `routes/cannon.ts`, `people/store.ts` and (as
  `CANNED_USERNAME_RE`) `extension/src/content.ts`. All eight are the identical `/^[A-Za-z0-9_]{1,15}$/`. **A
  consolidation is now a real task rather than a drive-by** — it touches seven route/impure files plus the content
  IIFE, so it needs its own plan, not a paragraph in someone else's diff.
- **OU.1 — the plan's Read-first pointer for the normalizing-validator shape is one file off.**
  `parseHumanizerConfig` lives in **`src/shared/humanize.ts`** (HM.1 promoted it there verbatim);
  `src/x/replyLists/engine.ts` only re-exports it. Read the shared copy — the exemplar's whole point is that it has
  no DB and no store, which the engine's file no longer makes obvious.
- **OU.1 — a pure `src/shared/` task owes NO extension build.** The shim (`extension/src/searchQuery.ts`) is OU.5's,
  so `cd extension && bun run build` was not run and was not owed here; the standing rule attaches to touching an
  `extension/` file, not to writing a module the extension will later import. Same for the docs count strings — a
  module with no consumer moves none of them.

- **OU.3 — a `scope:'server'` GROUP is the cheap one, and the registry now has a worked example.** Every prior
  multi-knob group mirrored at least one knob, so §7.24's "a mirrored knob is SEVEN edits" reads like the price of a
  knob. It is the price of *mirroring*. `outliers` is six knobs for **three** edits total (`registry.ts` group array +
  `GROUP_LABELS`, `registry.test.ts`'s key list, `docs/settings-tab.md`'s counts + row) — `shared/serverSettings.ts`,
  `SERVER_DEFAULTS`, `readServerConfig` and `serverSettings.test.ts` are untouched, **and no extension build is owed**.
  The test asserts `every(d => d.scope === 'server')` so the property is pinned rather than incidental. **The deciding
  question is D181d's, not a preference: does the PAGE act on this number?** If the panel only ever receives the
  number's effect (here, resolved into `GET /x/searches/defaults`), mirroring it is dead weight that still costs seven.
- **OU.3 — the mirrored-list assertion in `registry.test.ts` does NOT move for a server-only group.** The `current
  state` line calls `registry.test.ts` "twice" (the group's key list *and* the exact mirrored list). Only the first
  fired here. Worth knowing before hunting for a second edit that does not exist — and worth re-reading the mirrored
  assertion anyway, because a knob accidentally typed `scope:'mirrored'` fails there rather than in the group test,
  which is the failure you want.
- **OU.4 — a bare-Hono route suite does NOT prove the route is MOUNTED.** `searches.test.ts` builds its own
  `new Hono()` and `app.route('/x', searchesRouter)` (the `replyLists.test.ts` harness), so it stays green whether or
  not `src/x/index.ts` ever imports the router — and `src/app.test.ts` only exercises auth/CORS/validation, not the
  mount table. OU.4 closed the gap by importing the **composed** `src/app.ts` in a throwaway script and hitting
  `/x/searches/defaults` + `/x/searches` with the bearer (both 200, `since` 30 days back, `capture` zeroed). **Do the
  same for any new router**: it is one command and it is the only thing that catches a forgotten `app.route`.
- **OU.4 — biome accepts `const { sort: _sort, ...rest }` for the omit-a-key idiom**, which matters because the
  alternatives are all blocked here: `delete rest.sort` trips biome's `performance/noDelete`, and `rest.sort =
  undefined` trips tsconfig's `exactOptionalPropertyTypes`. Checked empirically, not assumed.
- **OU.4 — `x.outliers.lang` is settable to garbage by design, which is what makes its test possible.** The knob is a
  plain `string` with no membership check (D204), so `setSettings({'x.outliers.lang':'zz'})` succeeds and
  `/x/searches/defaults` is where it gets caught. Any future test needing an invalid registry value should look for a
  knob shaped like this one — the validated knobs refuse in `setSettings` and never reach the consumer.

- **OU.5 — the `dist/content.js` half of the shim grep is as load-bearing as the `dist/sidepanel.js` half.** The check is
  `min_faves` / `-filter:replies` / `x.com/search` == **1 each in `sidepanel.js` and 0 each in `content.js`**: the compiler is
  side-panel-only, the content script is a self-contained IIFE (§7.26), and pulling a 400-line module into it to read one
  string would bloat every x.com page load. **OU.7 touches `content.ts` and must not import `../searchQuery.ts` there** — it
  reports `location.pathname` and the SERVER decides the source.
- **OU.5 — a `204` from the background transport is already handled** (`background.ts:203` returns `{ok:true, data:undefined}`
  before the `res.json()`), so a `DELETE` through `api.*.remove` needs no special casing. Checked because `api.searches.remove`
  is typed `Promise<unknown>` and a `.json()` on an empty body would have thrown at runtime only.
- **OU.5 — a FRESH Outliers form is deliberately in an error state, and it looks like a bug.** The registry defaults are
  `minFaves` + `since` + `sort` and nothing else, so the compile raises *"Filters and floors narrow a search, they don't find
  one"* with Copy and Open both disabled until a keyword/phrase/handle/hashtag is typed. That is done-when #5 working, not a
  broken tab — if OU.6 or the OU.8 browser pass gets a "the tab opens broken" report, this is it.

- **OU.6 — a `title` on a DISABLED button is not a way to tell the user anything.** Chrome suppresses pointer events on a
  disabled form control, so the tooltip the plan asked for ("channels without keywords are rendered disabled with a title
  saying so") may never appear. The chip keeps the `title` **and** appends a visible `· no keywords` to its label, which is
  what actually carries the information. Same trap anywhere a disabled control is the only carrier of an explanation.
- **OU.6 — `GET /x/voice/targets` answers `targets: []` whenever `account_snapshots` is empty**, because there is no "my
  size" to band against — and that table has been frozen since 2026-08-12 (invariant #8). So the roster picker legitimately
  does not render on a fresh DB, and on an old one the band comes from a stale follower count. The tab says
  *"No roster in the 2–10× band yet — the From box takes any handle"* rather than showing nothing, so **OU.8's browser pass
  should not file a missing picker as a bug** without checking that table first.
- **OU.6 — `set(patch)` now clears `seedNote` as well as `copied`, so a seed sets its note AFTER calling `set`.** React
  batches the two updates and the later write wins; reversing the order silently swallows the note. Worth knowing before
  adding a fourth seed.
- **OU.6 — the tab's mount now makes FOUR $0 reads** (`searches.defaults`, `searches.list`, `channels.list`,
  `voice.targets`), the last two in one `Promise.allSettled` so either failing degrades to a muted line instead of taking
  the tab down. **The capture count needs no fifth:** `GET /x/searches` already carries `capture` (D208a), so OU.7's footer
  is a render off state OU.5 already fetches.

## Planning-error log

Corrections to MASTERPLAN.md itself (wrong dep, wrong order discovered live).

- **2026-07-16-niche.md Task 3 done-when** — the "`Pitești` hits nothing" grep contradicts the same task's bit-for-bit equivalence requirement (post prompt §6/§9/§0 carry builder biography outside the §1/§5 extraction scope; no niche field exists to hold them). Resolved at N.3 in favor of equivalence; see D28b for the full resolution + what N.9 must scope differently. Source plans are never edited — this entry is the correction.
- **2026-07-17-ai-layer.md — no task owns the post drafter's askLLM migration.** Task 5's edit list names replies/pillars/playbook/voiceExtract; Task 6 only flips drafter's MOUNT gate; Task 7 adds a sibling route. Yet the plan's Why-section + Done-when #1 spirit require every draft surface to honor the provider setting, and the Task-6 gate flip would 502 `/posts/draft` on OpenRouter-only setups. Resolved at AI.5 by migrating `drafter.ts` there (D47b) — the call-site-migration task was the right home.
