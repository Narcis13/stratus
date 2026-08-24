# Masterplan execution state

> Dynamic memory for `/masterplan`. Updated after EVERY task, in the task's own commit.
> Plan: `plans/MASTERPLAN.md` (static — order, reasoning levels, waves, D1–D10 + Wave-6 seeds D141–D144 + Wave-7 seeds D172–D174 + Wave-8 seeds D185–D187 + **Wave-9 seeds D195–D197, whose numbers COLLIDE with this file's D195 — see the collision note in the register**).
> Codemap: `.claude/skills/plan-feature/references/codemap.md` (updated per task too).
> History: `.claude/skills/masterplan/STATE-ARCHIVE.md` (frozen, grep-only — closed-lane deviations, gotchas, priors, ledger rows).
> Debt: `.claude/skills/masterplan/VERIFY-DEBT.md` (**unpaid**, not history — browser-verify + CA.2. Read it when you have Chrome open; skip it otherwise).

## WAVE 9 IS OPEN — 151/157. Next up: OU.3 (the last task with no deps), then OU.4.

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
task needs; if a pass slips, pay it as a standalone housekeeping commit (the `55c6d19`/`c9c8ade` precedent).

- **last-commit:** **identity is the SUBJECT LINE — no sha is recorded (D97).** HEAD should read `feat(outliers): pure x.com search-query compiler + validator (OU.1)`, parent `6721b48`. **Step 0 is one command:** `git log -1 --format='%h %s'`. **Expect ad-hoc commits between masterplan tasks** — four lanes ran outside the skill since RA.8, so a HEAD that doesn’t name a task is normal now; reconcile against this line, not against the whole log.
- **current state of the repo (as of OU.1, 2026-08-24 — recounted, not carried forward):** suite **2555** across **129** files; tables **44**; migrations through **`0031_sharp_screwball`** — **the journal is FREE from `0032`**; registry **15 groups / 63 knobs, 33 mirrored** and **17 prompt keys** (RA.8’s line said 61/31 — SW.1 added `x.sweep.media` + `x.sweep.excludeAds`, both mirrored); MCP **28 tools** (3 schema / 19 curated / 6 write) — **Wave 9 bumps none of them by decision**; smoke scripts **40**; extension tsconfig `include` shims **11**; panel tabs **14**; whole-repo lint **0 errors**. **`docs/settings-tab.md`’s count strings were correct at RA.8 and are now stale again by SW.1’s two knobs — OU.3 owes them anyway, so fix them there.** The four multi-file moves a new task will hit, each with the assertions that make them fail loudly: **a mirrored knob is SEVEN edits** — `registry.ts` (group array; order decides mirrored position), `registry.test.ts` **twice** (the group’s exact key list *and* the exact mirrored list), `docs/settings-tab.md`’s **three** count strings (prose, asserted by nothing) **plus its group table row**, and extension-side `ServerConfig` + `SERVER_DEFAULTS` + `readServerConfig`, pinned by `serverSettings.test.ts`’s exact `Object.keys` list AND its full-blob `toEqual` (D181d — the server half alone ships a knob that silently does nothing). **`x.outliers.*` is `scope: 'server'` throughout, so OU.3 owes the server three of those seven, not all seven.** **A registry prompt key is FOUR** (`PROMPT_KEYS` + `PROMPT_SPECS`, the default exported from a **pure** module or the import cycles, `registry.test.ts`’s exact key list, and `docs/settings-tab.md`’s three prompt strings). **An MCP tool is SIX doc strings plus three asserted numbers**: `src/mcp.test.ts`’s exact **28**, `scripts/smoke-mcp.ts`’s expected-names list, and in `docs/s2-mcp-server.md` the prose total, the `## The tools` heading, the end-to-end verification line, the `### <tier> (N)` heading **of the tier you touched**, the intro’s prose enumeration of the write tools, and the §"Security & cost invariants" write-ceiling row — plus the counts in codemap §3.3’s `mcp.ts` row **and** §6. **A migration** never runs in two parallel sessions, ignores any number quoted in plan text, and is inspected for dropped seed INSERTs by `git status --porcelain src/db/migrations/` (**not `git diff --stat`** — the new `.sql` and its snapshot are UNTRACKED, so a diff shows only the `_journal.json` append and reads like the SQL never landed) plus a fresh `:memory:` boot counting `content_pillars` (3) — never by grepping for `INSERT INTO`, which `0000`’s `INSERT OR IGNORE` spellings make return 0 (D177a).
- **next-up:** **OU.3** (`outliers` settings group, 6 `scope: 'server'` knobs, **high**) — the wave's last task with no deps, and after it everything is a single lane (OU.4 → OU.5 → OU.6 → OU.7 → OU.8). OU.1's compiler is on disk and exports the names OU.4/OU.5 import; **it has no consumer yet, so nothing breaks if OU.3 runs first.** OU.3 owes `docs/settings-tab.md`'s count strings, already stale by SW.1's two knobs. **`x.outliers.*` is `scope: 'server'` throughout, so OU.3 owes the server three of the seven mirrored-knob edits, not all seven** — and its `sort` knob default is `top`, which D200 + D201 both turn on. Standing gate reminders: `bun run test` (bare `bun test` targets the file DB and `inspect.test.ts` fails 2/2); biome forbids `delete process.env.X` / `: any` in `scripts/`, **non-null assertions (`x!`) anywhere**, a `let` assigned once, and a backtick string with no interpolation — it also sorts imports case-sensitively (`FAVES_LADDER` before `compileSearchQuery`), collapses short chained calls, and rejects a `console.log` string-concat unless every operand interpolates (run `bunx biome check --write` on the changed files FIRST). Extension-touching work adds `cd extension && bun run build` **and** its own `typecheck`, then `grep -cE '^\s*import[ {]' extension/dist/content.js` == 0.

## Ledger

Status: `[ ]` todo · `[~]` in progress (lane claimed) · `[x]` done (sha + date) · `[s]` skipped (reason in deviations).

**Waves 0–8 are CLOSED — 149/149. Wave 9 is OPEN — 2/8, total 151/157.** Per-task entries for the closed waves
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

- **Wave 9 — Outliers: X advanced-search compiler, clipboard hand-off, saved hunts (2/8)**: plan
  `plans/2026-08-03-search-query-builder.md` (written 2026-08-03, **revised 2026-08-24** — the revision is the spec,
  the 08-03 text is superseded in six places it names). Registered in `plans/MASTERPLAN.md` by `4ebceb3`; ledger
  re-opened by OU.2. **$0 lane — no `xFetch`, no `askLLM`, no image call on any path.** Took migration
  `0031_sharp_screwball` (`saved_searches`); **the wave takes no further migration**.
  - [x] **OU.2** `saved_searches` table + migration `0031` — `feat(outliers): saved_searches table + migration 0031 (OU.2)`, parent `813dafc`, 2026-08-24. **Also carried the wave's re-opening** (D198). Schema-only: no route, no consumer, no new test.
  - [x] **OU.1** pure compiler `src/shared/searchQuery.ts` + `FAVES_LADDER` — `feat(outliers): pure x.com search-query compiler + validator (OU.1)`, parent `6721b48`, 2026-08-24. **The x.com spot check was RUN, not deferred** — 2026-08-24, live, recorded in the module header (see the gotcha on the VERIFY-DEBT ceiling). 2 files, both new, **no consumer yet**: OU.4 mounts the route, OU.5 adds the shim. D201–D203.
  - [ ] **OU.3** `outliers` settings group, 6 `scope: 'server'` knobs — no deps, high. Copies the `RADAR` block in `registry.ts`. Owes `docs/settings-tab.md`'s count strings, already stale by SW.1's two.
  - [ ] **OU.4** `/x/searches` CRUD + `compile`/`run`/`defaults` + mount — deps OU.1, OU.2, OU.3, high. Bound by D199 + D200.
  - [ ] **OU.5** Outliers tab — form, live preview, Copy + Open in X, saved list, the 12th shim — deps OU.1, OU.4, high.
  - [ ] **OU.6** prefills — channel keywords, target roster, faves ladder, `SettingsGear` — deps OU.5, high. **Owes the D195(plan) decision in its commit** (footer in OU.6 or OU.7).
  - [ ] **OU.7** `voice_tweets.source = 'outlier_search'` provenance + footer count — deps OU.4, OU.5, OU.6, **xhigh**. First-save-wins; do NOT extend `onConflictDoUpdate`'s set-clause to `source`.
  - [ ] **OU.8** OU docs-sync + `$0 scripts/smoke-outliers.ts` + the browser pass — deps all, high. **Also owes `b92d783` a codemap §5 line** (unstamped since 2026-08-23).

## Hot-file locks

**Wave 9's locks, declared by OU.2 (the lane's first commit).** Nothing is held right now — OU.2 released
`src/x/db/schema.ts` and the migrations journal on commit — but three serialization facts bind the rest of the wave:

| File | Owner / order | Why |
|---|---|---|
| `extension/src/sidepanel/Outliers.tsx` | **OU.5 → OU.6 → OU.7, strictly serial** | The wave's hot file. The plan tags OU.7 `[parallel-ok]`; **that tag is wrong** (D195 in `plans/MASTERPLAN.md`) — OU.7's last bullet renders the capture-count footer *in the tab*, so all three write the same component. The RC/HM `Radar.tsx` situation repeating: a plan sizes tasks by concern, the masterplan sizes lanes by file. |
| `src/x/routes/searches.ts` | **OU.4 only, written once** | No server-side hot-file race exists in this wave. |
| `src/shared/searchQuery.ts` | **released by OU.1** | Written once and finished. OU.4 and OU.5 IMPORT it; neither should edit it. If a later task finds the compiler wrong, that is a change to a module two surfaces already render — fix it there, and re-run the header's x.com spot check before trusting a new operator. |
| `src/x/db/schema.ts` + migrations journal | **released by OU.2** | The wave takes no further migration; the journal is free from `0032` for any *other* lane. |

**The wave's only parallel pair (OU.1 ∥ OU.3) is spent — OU.1 shipped, so OU.3 is now simply the next task and
everything from OU.4 on is a single lane.** The documented
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
- **D198** (OU.2 — the re-opening changed hands). `plans/MASTERPLAN.md`'s D196 assigns the Wave-9 re-opening to
  **OU.1**, but the wave table runs **OU.2 first** (order 9.1, the migration-alone slot) and the skill requires the
  re-opening in the lane's **FIRST commit** — a ledger that is still closed has no row to tick. So OU.2 did it:
  the eight ledger rows, the Wave-9 lock table, and D196's recount. **OU.1 no longer owes any of it.** D196's two
  named staleness claims were both correct — migration head was `0030_famous_wrecker` (so this task owned `0031`,
  and the plan's number was right for once) and the registry is **63 knobs / 33 mirrored**, not 61/31. **Generalize:
  when a plan assigns the re-opening to a task that is not first in the wave order, the FIRST task to run does it —
  the assignment is about the work, not about the task id.**
- **D199** (OU.2, binds OU.4 — **do not "upgrade" the `query` column**). `saved_searches.query` is a plain
  `text('query').notNull()`, **not** `text({ mode: 'json' }).$type<SearchQuery>()`, and the Design §2 line about
  "the exact discipline `reply_lists.humanizer` uses with `parseHumanizerConfig`" refers to the **normalization**
  discipline (normalize at the storage boundary), not to the column mode. Two reasons, and the second is the load-
  bearing one: (a) Task 4's own How-text says the write path stores `JSON.stringify` of the normalized value and the
  read path `JSON.parse`s it — string semantics throughout; (b) **drizzle parses a json column during result
  mapping, inside `.all()`**, so a single row edited out of band (a sqlite CLI session, a restored backup) would
  throw where no route code can catch it and take the **whole list** with it — which is exactly the degradation
  Task 4 forbids ("a parse failure degrades that row to `compiled: null, url: null` rather than dropping it").
  Bonus: it left OU.2 with **zero dependency on OU.1's not-yet-existing `SearchQuery` type**, which is why the two
  tasks really are order-independent. Verified: `mode: 'json'` and plain text emit byte-identical SQL (`text`), so
  this is reversible without a migration — but reversing it re-introduces the 500.
- **D200** (OU.2, binds OU.4 — **the column default is not the product default**). `saved_searches.sort` defaults to
  `'live'` (the plan's Design §2 sketch), while the product default is the `x.outliers.sort` registry knob, whose
  default is **`top`** ("an outlier hunt wants best-performing, not newest"). The column default exists only so the
  column can be `notNull` without every writer thinking about it. **OU.4 must resolve an omitted `sort` from the
  registry via the bound `getSetting`, never let the column default stand in for it** — otherwise a POST without
  `sort` silently saves `live` while `/x/searches/defaults` hands the form `top`, and the two disagree forever. The
  schema comment says so at the column; this entry is the second copy because a comment is easy to skim past.
- **D201** (OU.1, binds OU.3/OU.4/OU.5 — **an unrecognized `sort` DROPS, it does not fall back**). Task 1's How-text says `parseSearchQuery` should "coerce an unknown `sort`/`replies`/`media` to its default". That is right for two of the three and wrong for `sort`, because **`sort`'s default is the only one that lives outside this module** — it is the `x.outliers.sort` knob (`top`), and D200 already forbids letting the column default (`live`) stand in for it. Coercing an unknown `sort` to `'live'` here would have re-created that exact bug one layer up: a client sending `sort: 'newest'` would silently store `live` while `/x/searches/defaults` hands the form `top`. So `normSort` returns `undefined` for anything that is not `'live'`/`'top'`, and **absent and unrecognized mean the same thing to the caller: you decide.** `replies`/`media` DO coerce to `'any'` as written, because their default is in this module and `'any'` emits no clause. Pinned by a test. **OU.4 must still resolve an omitted `sort` from the registry** — nothing here does that for it.
- **D202** (OU.1, binds OU.5's form — **`hasLinks` compiles BOTH arms; `noRetweets` compiles only one**). The plan's compile order names `filter:links` and `-filter:nativeretweets`, one arm each. Shipping `hasLinks` that way would leave `hasLinks: false` emitting nothing — a boolean field with an inert value, which is the same silent-feature failure §7.33 exists to prevent, and "plain-text posts only" is a real outlier hunt. So `true` → `filter:links`, `false` → `-filter:links`, absent → no clause. **The asymmetry with `noRetweets` is deliberate, not an oversight:** its name is already negative, a retweets-ONLY hunt is a different feature, and so `false` normalizes AWAY rather than being stored as dead weight (`parseSearchQuery` drops it). The enum lesson the plan states — two booleans could say "exclude" and "only" at once — does not apply to either, because a single boolean cannot contradict itself. **OU.5's form should render `hasLinks` as a three-state control (any / with / without), not a checkbox.**
- **D203** (OU.1, standing for the compiler — **a multi-word term in `any`/`none` WARNS**). Not in the plan's rule list, but the same family as the `:`-in-a-keyword warn it does mandate, and it is a real mis-parse rather than a style opinion: `-build in public` compiles to `-build AND in AND public` (only "build" is excluded, and the other two words become REQUIRED), and a multi-word member inside the OR group ANDs within it. Both **warn and still compile** (§7.23a — the warn half never refuses). **A silent auto-quote to `-"build in public"` was considered and refused:** the compiled string is displayed live right where the user is looking, so a rewrite would be invisible in the one place it needed to be visible; the warn plus the visible string teaches what X will actually do. `all` is NOT warned — it is space-joined AND either way, so a multi-word term there means exactly what it looks like.
- **D195** (RA.8, standing — the masterplan's last entry; three divergences from the closing task's own plan text, and each one generalizes). **(a) A smoke that needs a config must BRING one, not trust the operator's.** The plan's "mount `settings` for the admitted-flip check" left open *what* to flip; against the real DB the live sweep filters are whatever the operator last tuned, so fixtures built to "clear the gates" are only deterministic by luck. `smoke-radar-access.ts` instead PATCHes the **eight admission knobs** to a known wide-open set (asserting all three rows admitted), then moves **one** knob and asserts two verdicts change — which is a stronger claim than the plan's, because the only variable is the knob. Both the patch and the row deletes snapshot-restore by `isDefault` from `fail()` as well as the success path (D113(d)). **(b) "Confirm the counts are still right rather than assuming" found them wrong, and a closing task fixes what it finds.** `docs/settings-tab.md` claimed 67 knobs / 16 groups / 32 mirrored / 16 prompts against a registry of **61 / 15 / 31 / 17** — the 2026-08-12 read deletion had taken the whole **Mentions** group and four of five **Workers** knobs with the billed reads they configured, and nothing asserts any of those strings. RA.1 had recorded it as "not RA's to fix", which was right while a next task existed; with the masterplan closing there is no next task, and a wrong number left behind with a note pointing at nobody is worse than a five-minute edit. **Generalize: a "not mine to fix" deferral is a bet that someone comes after you. The task that closes the lane is the one that loses that bet.** **(c) The browser end-to-end went to `VERIFY-DEBT.md` (`0w`) rather than being done, and the reason is structural rather than scheduling.** The RA.2 gotcha said "do them at RA.8 rather than filing a sixth debt entry" — but the panel is a Chrome *side panel*, a page tab cannot read another extension's `chrome.storage.local`, and the service worker has no console a coding session can reach, so RA.8 could not have paid them however long it sat. Filing beats claiming: `0w` names the five checks and the one open question (whether the angle-tab strip renders a **scoreless** composed variant gracefully) so the human at the browser can walk them in one sitting.

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

## Planning-error log

Corrections to MASTERPLAN.md itself (wrong dep, wrong order discovered live).

- **2026-07-16-niche.md Task 3 done-when** — the "`Pitești` hits nothing" grep contradicts the same task's bit-for-bit equivalence requirement (post prompt §6/§9/§0 carry builder biography outside the §1/§5 extraction scope; no niche field exists to hold them). Resolved at N.3 in favor of equivalence; see D28b for the full resolution + what N.9 must scope differently. Source plans are never edited — this entry is the correction.
- **2026-07-17-ai-layer.md — no task owns the post drafter's askLLM migration.** Task 5's edit list names replies/pillars/playbook/voiceExtract; Task 6 only flips drafter's MOUNT gate; Task 7 adds a sibling route. Yet the plan's Why-section + Done-when #1 spirit require every draft surface to honor the provider setting, and the Task-6 gate flip would 502 `/posts/draft` on OpenRouter-only setups. Resolved at AI.5 by migrating `drafter.ts` there (D47b) — the call-site-migration task was the right home.
