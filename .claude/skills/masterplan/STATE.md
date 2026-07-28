# Masterplan execution state

> Dynamic memory for `/masterplan`. Updated after EVERY task, in the task's own commit.
> Plan: `plans/MASTERPLAN.md` (static — order, reasoning levels, waves, D1–D10 + Wave-6 seeds D141–D144 + Wave-7 seeds D172–D174).
> Codemap: `.claude/skills/plan-feature/references/codemap.md` (updated per task too).
> History: `.claude/skills/masterplan/STATE-ARCHIVE.md` (frozen, grep-only — closed-lane deviations, gotchas, priors, ledger rows).
> Debt: `.claude/skills/masterplan/VERIFY-DEBT.md` (**unpaid**, not history — browser-verify + CA.2. Read it when you have Chrome open; skip it otherwise).

## THE MASTERPLAN IS CLOSED — 141/141 (RC.5, 2026-07-28). There is no next task.

All eight waves are done. `/masterplan next` has nothing to pick; **`/masterplan status` is the only mode
that still means anything**, and a new feature starts with `/plan-feature`, not here. If a new plan is
written, it opens Wave 8 in `plans/MASTERPLAN.md` and re-opens the ledger below — until then, this file's
job is to be the short answer to "what state is the repo in and what is still owed".

**What is still owed, and it is not a task.** `VERIFY-DEBT.md` holds **eighteen** unpaid items — browser
checks that shipped with automated gates only, plus CA.2 step 2. Two came out of Wave 7 (`0m` HM, `0n` RC);
`0n(b)` and `0l` are the only two that spend (~$0.003 and ~$0.010). Nothing there needs a plan or a session
of its own: fold them into whichever session next has Chrome open on the panel, and **delete each entry as
you pay it**. That file is deliberately not in the archive — a debt filed among history stops being owed.

**Where the lane detail went.** Everything task-specific is in `STATE-ARCHIVE.md`, section by closing task:
Waves 0–4 at UI.11, Wave 5 at GT.9, Wave 6 at JD.8, the Wave-7 HM lane at HM.5, and **the Wave-7 RC lane +
all ten Wave-7 ledger rows + D176/D177/D179/D181/D183/D184 at RC.5**. Grep it by task id or by the filename
the lane built, before touching that file. The load-bearing half is also in codemap §5/§7/§10.

**Size discipline (added 2026-07-23 at 339 KB; paid eleven times since — read this before a new wave
re-grows the file).** STATE.md must stay loadable in a **single `Read`**, and the limit that bites is the
tool's **token** cap (~25k), not the 256 KB byte cap. **The budget is measured: at 61.7 KB a single `Read`
came back TRUNCATED at 25,023 tokens, so the real ratio is ≈405 tokens/KB and the ceiling is ≈61.5 KB. Aim
at 60 KB and leave the last 1.5 KB unspent.** Measure BYTES with `wc -c`, not `.length` — this file is full
of multibyte `—`/`≥`/`✓` and a character count reads ~1.5 KB under the truth. **Five lessons, each of which
cost real sessions:** (1) *the breach is never one big entry, it is six good ones that each looked
affordable* — Wave 6 went 48 KB → 156 KB in fifteen tasks; (2) *a closing pass archives the lane in front of
it and misses the weight behind it* — UI.17 left Wave 5's ledger rows and every session until GT.9 paid for
them, so **also ask what stopped binding two waves ago**; (3) *"it still binds an open task" is a reason to
DISTIL, not to keep 19 KB*; (4) **an ORDINARY task breaches it too, so `wc -c` between entries, not only
before the commit** — JD.5 needed two archive passes in one task; (5) **when a lane CLOSES, its hot-file
lock row and its pointer lines are weight, not state** — a pointer to an archived block that no open task
needs is 2 KB of "go read this, though nobody has to". Never "fix" a breach by deleting something an open
task needs; if a pass slips, pay it as a standalone housekeeping commit (the `55c6d19`/`c9c8ade` precedent).

- **last-commit:** **identity is the SUBJECT LINE — no sha is recorded (D97).** HEAD should read `docs(radar): RC docs-sync + $0 smoke-radar-curate.ts (RC.5)`, parent `80a2f2b` = HM.5. **Step 0 is one command:** `git log -1 --format='%h %s'`. With the ledger closed there is nothing left to reconcile it against, so a subject naming something else just means ordinary post-masterplan work happened — that is expected now, not drift.
- **current state of the repo (the numbers a new plan starts from):** suite **1935**; tables **41**; migrations through **`0025_curvy_edwin_jarvis`** — **the journal is FREE from `0026`**; registry **14 groups / 62 knobs, 28 mirrored**; **prompt keys 16**; MCP **23 tools**; smoke scripts **33**; extension tsconfig `include` shims **7**; whole-repo lint **0 errors**. **No file is locked.** The four multi-file moves a new plan will hit, each with the assertions that make them fail loudly: **a mirrored knob is SEVEN edits** — `registry.ts` (group array; order decides mirrored position), `registry.test.ts` **twice** (the group's exact key list *and* the exact mirrored list), `docs/settings-tab.md`'s **three** count strings (prose, asserted by nothing), plus extension-side `ServerConfig` + `SERVER_DEFAULTS` + `readServerConfig`, pinned by `serverSettings.test.ts`'s exact `Object.keys` list AND its full-blob `toEqual` (D181d — the server half alone ships a knob that silently does nothing). **A registry prompt key is FOUR** (`PROMPT_KEYS` + `PROMPT_SPECS`, the default exported from a **pure** module or the import cycles, `registry.test.ts`'s exact key list, and `docs/settings-tab.md`'s three counts). **An MCP tool bumps `src/mcp.test.ts`'s exact 23 and `docs/s2-mcp-server.md`'s three counts in the same commit.** **A migration** never runs in two parallel sessions, ignores any number quoted in plan text, and is inspected for dropped seed INSERTs by `git diff --stat src/db/migrations/` plus a fresh `:memory:` boot counting `content_pillars` (3) — never by grepping for `INSERT INTO`, which `0000`'s `INSERT OR IGNORE` spellings make return 0 (D177a).
- **next-up:** **nothing.** The masterplan is closed. Standing gate reminders for whatever comes next: `bun run test` (bare `bun test` targets the file DB and `inspect.test.ts` fails 2/2); biome forbids `delete process.env.X` / `: any` in `scripts/`, **non-null assertions (`x!`) anywhere**, a `let` assigned once, and a backtick string with no interpolation — it also sorts imports case-sensitively, collapses short chained calls, and rejects a `console.log` string-concat unless every operand interpolates (run `bunx biome check --write` on the changed files FIRST). Extension-touching work adds `cd extension && bun run build` **and** its own `typecheck`, then `grep -cE '^\s*import[ {]' extension/dist/content.js` == 0.

## Ledger

Status: `[ ]` todo · `[~]` in progress (lane claimed) · `[x]` done (sha + date) · `[s]` skipped (reason in deviations).

**All eight waves are CLOSED — 141/141.** Per-task entries (shas, parents, dates, notes) live in
`STATE-ARCHIVE.md` — Waves 0–4 at UI.11, Wave 5 at GT.9, Wave 6 at JD.8, **Wave 7 at RC.5**. Grep by task id.

- **Wave 0 — Foundations (13/13 ✓)**: UI.1, UI.8, UI.9, UI.10, ST.1–ST.9. Closed by `d1902e5` ST.9 studio docs+smoke.
- **Wave 1 — Prompt & identity core (32/32 ✓)**: RU.1–RU.3, N.1–N.9, ME.1–ME.7, AI.1–AI.13. Closed by `f86e06a` AI.13 AI docs+smoke.
- **Wave 2 — Reply machine & on-page surfaces (29/29 ✓)**: RU.4–RU.10, AX.1–AX.7, RL.1–RL.8, NT.1–NT.7. Closed by `5d4a1a4` NT.7 NT docs+smoke.
- **Wave 3 — Ambient data & guardrails (16/16 ✓)**: HV.1–HV.6, GR.1–GR.10. Closed by `docs(guardrails): GR docs-sync + $0 smoke-guardrails.ts (GR.10)`, parent `7adfbca`.
- **Wave 4 — Authoring 3.0 (15/15 ✓)**: A3.1–A3.15. Took migration `0023_slimy_night_thrasher` (`articles`). Closed by `docs(authoring): Authoring 3.0 docs-sync + $0 smoke-authoring3.ts (A3.15)`, parent `819c61d`.
- **Wave 5 — Settings moat + polish (16/16 ✓)**: UI.2–UI.7, UI.11–UI.17. Closed by `docs(ui): cockpit overhaul docs-sync + $0 smoke-settings.ts (UI.17)`, parent `7b10239`.
- **Wave 6 — Coach, judge & growth tactics (25/25 ✓, + GT.5 `[s]` by design)**: SC.1–SC.9, GT.1–GT.9, JD.1–JD.8. Took migration `0024_soft_leopardon` (`draft_judgments`). Closed by `docs(judge): LLM-judge docs-sync + $0 smoke-judge.ts (JD.8)`, parent `fc44d1c`.
- **Wave 7 — Radar follow-ups: curated drafting & humanize-at-pick (10/10 ✓)**: HM.1–HM.5 (project humanizer), RC.1–RC.5 (curated drafting). Took migration `0025_curvy_edwin_jarvis` (`radar_drafts.curation_score`). Closed by `docs(radar): RC docs-sync + $0 smoke-radar-curate.ts (RC.5)`, parent `80a2f2b` — **which also closes the masterplan.**

## Hot-file locks

A lane claims a file before starting, releases on commit. **Every file is free and nothing serializes
anything** — with the ledger closed there is no lane left to claim one. The single row below states a
standing invariant rather than lane state. The documented way to reach a closed lane's file notes is to
**grep `STATE-ARCHIVE.md` by filename** before touching a file that lane built.

| File | Owner |
|---|---|
| `src/db/migrations/` journal (any migration task) | — (**RC.2 took `0025_curvy_edwin_jarvis` (`radar_drafts.curation_score`); the next migrating task owns `0026`.** JD.4 took `0024_soft_leopardon` (`draft_judgments`) before it. Standing invariant: never run two migration-generating tasks in parallel sessions (journal conflicts), ignore any hardcoded number in plan text — **JD.4's plan said "0018", which is RL.2's `reply_lists`; a plan quoting a migration number is quoting the day it was written** — and always `bun run db:generate` against the current journal, then inspect the SQL for dropped seed INSERTs, codemap §4) |

## Deviations & decisions register

**All 184 D-entries are in `STATE-ARCHIVE.md`** — grep by task id or by the filename the lane built.
Waves 0–3, the Wave-4 closer D127, the registry lane D128–D133, the polish lane D134–D140, the GT/SC lanes,
the whole JD lane (D149/D160/D162–D171) at JD.8, the HM lane (D175/D178/D180/D182) at HM.5, and the RC lane
(D176/D177/D179/D181/D183/D184) at RC.5. What stays below is only what is **standing** — true of the repo
regardless of what you are building — plus D171 and D184, whose findings bind any future smoke or docs pass.

- **D7** (standing): all NEW UI from Wave 1 on uses UI.10 primitives + `--strat-*` tokens; Wave-5 polish passes touch only pre-masterplan tabs.
- **D97** (standing, bookkeeping): **the ledger records the commit SUBJECT LINE, not a sha.** Three tasks in a row wasted a Step-0 investigation proving a recorded sha was an amend-orphan, and every time the resolution was "the subject line is the identity". A sha can only be written into the commit that changes it by amending, which changes it again — the churn is structural, not carelessness. Ledger entries carry the subject line + the PARENT sha (stable, already in history), the codemap header stamps `<parent>+<TASK>`, and Step 0 is `git log -1 --format='%h %s'`.
- **D113(d)/(e)** (GR.10, standing — binds every future smoke; parts (a)–(c) are in the archive): **(d) A smoke over a surface whose READS WRITE cannot follow `smoke-passive-harvest.ts`.** D98c's namespace-then-delete rule assumes every write is attributable; two Guardrails writes are GLOBAL (a complete-run reconcile marks EVERY unseen live handle `gone`; `GET /following/queue` releases rows at read time). So `smoke-guardrails.ts` additionally **snapshots and restores** every foreign `following.status` (from the success path AND from `fail()`), plus `commitments` and the seeded `streaks`/`digests` keys — and, because its fixtures sit inside today's window while `GET /x/brief` writes the C9 diary, it closes by **re-reading the brief** so the diary describes clean data rather than deleted fixtures. Copy this, not D98c alone. **(e) A fixture fact the plan's sequence hides:** "unseen" in the reconcile is `last_run_id != runId` — per **run**, not per batch, so proving `gone`/`confirmed` needs TWO runs.
- **D171** (JD.8, standing — binds every future closing docs-sync and every future smoke; full four-part text in the archive): **the two halves that outlived their lane.** **(a) A task whose output is a PROMPT or a SELECTION RULE changes what every draft says, and belongs in the tab doc of the surface that RENDERS it** — "which tab does the user see this on" always has an answer, even when "which tab did I edit" does not. GT.9 wrote this as a note and JD.1 shipped invisible three tasks later, which is how a note fails; RC.1 is what it looks like when it works (a prompt task with no tab of its own wrote its paragraph into `docs/settings-tab.md`, where the Prompts subtab renders it). **(c) `--live` is not a style choice: ask what a $0 run cannot claim, and if that list is empty ship no flag.** Also (b): a phase line goes in `PLAN.md`'s blockquote block above §"Product, in one paragraph each", never §"Phased build", which is the original five-phase build-out and takes no new phases.
- **D184** (RC.5, standing — the masterplan's last entry; full text in the archive): **two findings that bind any future work.** **(a) A BEST-EFFORT write must be verified by a READ-BACK, and the failure message must name the real cause.** `persistRadarDrafts` swallows insert failures by design (§7.8), so a missing column is **zero rows**, not a throw — a smoke asserting "the call didn't throw" is green on an unmigrated database. Generalizes to every `safeLog…`/`persist…` side hook. **(b) State the claim a smoke cannot make, in its header.** RC.5 could not prove "a ⊕ pin never reaches the curate request" — that is the panel's `partitionForCurate`, and `scripts/` may not import the extension build (§5) — so it says so and proves the two halves the route layer owns instead. A silently dropped done-when reads as coverage the script does not have.

## Gotchas log

Things the next implementer must know that aren't obvious from the code. Append-only, one line each, newest last.

**All 200+ closed-lane gotchas are in `STATE-ARCHIVE.md`** — grep it by task id or filename before touching
a file a closed lane built (Wave 6's at JD.8, the HM lane's at HM.5, the RC lane's at RC.5). What stays
below is the standing set: test/lint/typecheck traps that bite any task, and the Wave-3 carry-forward, whose
four items are about how this repo's tests, docs and fixtures work rather than about any lane.
**Browser-verification debt is not here — it is `VERIFY-DEBT.md`**; a debt parked among facts reads as a fact.

- **Settings types are extension-local mirrors.** The extension MUST NOT import `src/x/settings/registry.ts` (§5 build-isolation); it mirrors the `GET /x/settings` JSON in `extension/src/shared/types.ts`, and a new server-side `SettingDef` field is hand-synced there. **The same wall bites `scripts/`, in the other direction:** a smoke may not import the extension build, which is why `smoke-humanizer.ts` keeps a local `mulberry32` and `smoke-radar-curate.ts` cannot test `partitionForCurate`. (Full block in the archive; grep `Settings types are`.)
- **`exactOptionalPropertyTypes` pass-through pattern (UI.10):** primitives forwarding a maybe-undefined optional (`Slider.unit`, `SettingRow.onReset`, `GearPopover.onReset`/`label`) type the prop as `T | undefined` explicitly — else TS rejects `prop={maybeUndefined}`. Reuse this for new primitives that relay optionals. Root tsconfig also has **`noUncheckedIndexedAccess`**, so `arr[0]` is `T | undefined` — name your fixtures as consts rather than indexing them in a script.
- **`inspect.test.ts` fails 2/2 under bare `bun test`, GREEN under `bun run test`** (the canonical `SQLITE_PATH=:memory: bun test`). `src/db/client.ts` defaults to `:memory:` when `NODE_ENV==='test'`, but `src/x/data/inspect.ts`'s readonly connection still defaults to `./stratus.db` when `SQLITE_PATH` is unset — the primary writes memory, the readonly reads the file, seeded rows are invisible. **Always gate with `bun run test`.** One-line fix for a future data-core task: make `inspect.ts` honor the same `NODE_ENV==='test'` default (or have `client.ts` `process.env.SQLITE_PATH ??=` set it so both agree).
- **A route suite over the composed `app` tests the WIRING; a bare-Hono suite tests the ROUTE** (D179a, generalized). `src/app.test.ts`'s guards sit behind `describe.if(authed)` and need `API_TOKEN`, and an LLM-gated router refuses to mount without a provider key (§7.22) — so on a clean checkout those tests do not run at all. An LLM route needs its own bare-Hono suite (`judge.test.ts` / `drafter.test.ts` / `replies.test.ts` / `humanizer.test.ts`) or its refusal ladder is untested on any machine that isn't fully configured. **There is no `mock.module` anywhere in this repo:** the established substitute is a 400 ladder ending in a forced 503 with both provider keys unset in a `finally` (which also proves for free that the prompt + input rendered), plus unit tests over the post-spend parsers.
- **NT.1: extension typecheck does NOT cover `*.test.ts`** — `extension/tsconfig.app.json` has `"exclude": ["src/**/*.test.ts"]`, and root `tsconfig.json` only includes `src/**/*` + `scripts/**/*` + `drizzle.config.ts`. So an extension test file is checked by **`bun run test` alone**; a type error in one is invisible to both typechecks.
- **NT.7: `app.request(...)` is typed `Response | Promise<Response>`.** A helper declared `function f(): Promise<Response> { return app.request(...) }` fails root typecheck; make the helper `async`. `bun run typecheck` covers `scripts/**`, so this bites in smoke scripts, not in route suites (which `await` inline).
- **CLAUDE.md was slimmed to guardrails-only (2026-07-23, out-of-skill docs refactor).** The full phase-entry ledger moved **verbatim** to `docs/PHASE-HISTORY.md`. **Every docs-sync task (MASTERPLAN global rule 6, codemap §7 rule 29) appends its phase entry to `docs/PHASE-HISTORY.md`, NOT CLAUDE.md**; CLAUDE.md changes only when a guardrail (invariant, workflow, stack quirk) changes. Plan text still saying "CLAUDE.md phase entry" means the history file.
- **Wave-3 carry-forward — the four repo-wide facts (everything else HV/GR is in the archive):** **(1) MCP tool count is asserted exactly.** `src/mcp.test.ts` asserts **23**; every future tool bumps that number *and* `docs/s2-mcp-server.md`'s three counts (total / curated tier / write tier) **in the same commit** — that doc was silently 5 tools stale for four phases. **(2) Docs assert user-visible strings.** `docs/harvest-tab.md`, `docs/playbook-tab.md`, `docs/people-tab.md`, `docs/today-tab.md`, `docs/composer-tab.md`, `docs/replies-tab.md`, `docs/radar-tab.md` and `docs/settings-tab.md` quote real copy — **reword a quoted string and you owe the doc in the same commit** (`docs/today-tab.md` is numbered §1–§18, so an inserted card renumbers rather than appends). **(3) Real-DB fixture rules that outlive their lane:** a seeded `posts_published` row is written **`retired: true`** (NT.7 — otherwise it is a candidate for the daily *billed* pass), a `following` fixture needs a `following_runs` row first (`last_run_id` is a notNull FK), people-layer handles must be **≤15 chars** (longer ones are silently skipped and the assertions go vacuous), and any suite touching `scheduled_posts`/`posts_published` inside the monitor's windows must delete its rows in `afterAll` — `monitor.test.ts` asserts `clusterCount === baseline + 1` and a leaked pending pair breaks a different file. **(4) Five reads WRITE and none of them may be polled:** `/radar/drafts` (48h expiry), `/following/queue` (release + revoke), `/x/goals`, `/x/brief` and `/x/digest` (all three settle `active → achieved|missed`). A3.8's Today card and A3.14's week board both sit on `/x/brief` — a refresh loop there silently advances goal statuses.

## Planning-error log

Corrections to MASTERPLAN.md itself (wrong dep, wrong order discovered live).

- **2026-07-16-niche.md Task 3 done-when** — the "`Pitești` hits nothing" grep contradicts the same task's bit-for-bit equivalence requirement (post prompt §6/§9/§0 carry builder biography outside the §1/§5 extraction scope; no niche field exists to hold them). Resolved at N.3 in favor of equivalence; see D28b for the full resolution + what N.9 must scope differently. Source plans are never edited — this entry is the correction.
- **2026-07-17-ai-layer.md — no task owns the post drafter's askLLM migration.** Task 5's edit list names replies/pillars/playbook/voiceExtract; Task 6 only flips drafter's MOUNT gate; Task 7 adds a sibling route. Yet the plan's Why-section + Done-when #1 spirit require every draft surface to honor the provider setting, and the Task-6 gate flip would 502 `/posts/draft` on OpenRouter-only setups. Resolved at AI.5 by migrating `drafter.ts` there (D47b) — the call-site-migration task was the right home.
