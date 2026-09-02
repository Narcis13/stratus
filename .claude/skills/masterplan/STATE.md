# Masterplan execution state

> Dynamic memory for `/masterplan`. Updated after EVERY task, in the task's own commit.
> Plan: `plans/MASTERPLAN.md` (static — order, reasoning levels, waves, D1–D10 + the per-wave seed blocks, whose numbering COLLIDES with this file's from Wave 9 on — see the collision note in the register).
> Codemap: `.claude/skills/plan-feature/references/codemap.md` (updated per task too).
> History: `.claude/skills/masterplan/STATE-ARCHIVE.md` (frozen, grep-only — closed-lane deviations, gotchas, priors, ledger rows).
> Debt: `.claude/skills/masterplan/VERIFY-DEBT.md` (**unpaid**, not history — browser-verify + CA.2. Read it when you have Chrome open; skip it otherwise).

## THE MASTERPLAN IS CLOSED — **165 / 165.** Wave 10 (XR) closed at XR.8, 2026-09-02.

`plans/2026-09-02-x-ranker-port.md` (XR.1–XR.8) re-opened the masterplan a **third** time — closed at OU.8 /
157-of-157 since 2026-08-25 — and closed it again eight tasks later. X's published production For You weights
now sit beside the coach as **C** (prospective, over a draft's shape) and **E** (retrospective, over a post's
measured rates), on three surfaces, plus the falsification cell that asks whether either separates our own
posts by median views. **The whole wave was $0 and structurally so** — every read was over rows already
stored, no task could reach `xFetch` or `askLLM`, and invariant #8 is untouched. That is now the third wave
running ($0 by DECISION rather than by luck, RA → OU → XR); invariant #8's "decide out loud" cuts both ways.

**The lane's register (D225–D244), its gotchas and its per-task ledger rows are in `STATE-ARCHIVE.md` under
*"Archived at XR.8"*** — grep by task id, D-number, or filename. Two things it leaves open and neither is a
task: `rankerScoreEffectiveness` reads `totalPosted: 0` on prod and will until a `posts`-mode harvest runs on
my own profile (the cell is correct, its population is empty — D238), and the XR browser pass is **filed, not
paid**, as `VERIFY-DEBT.md` **(0z)**.

**Two files stay CLOSED to drive-by edits.** `src/shared/xRanker.ts` — transcribed facts; X syncs those
weights from production by cron, so re-verifying against a newer commit is a real (cheap) task of its own,
never a drive-by. `src/shared/xRankerSignals.ts` — every constant in it is measured and stamped, and there is
no `rankerBand`: call **`rankerDraftBand`** or **`rankerMeasuredBand`** (D236). **Attribution is per-FILE** —
`xRanker.ts` Apache-2.0/xAI, `xRankerSignals.ts` MIT/Ryan Lenk, each citing what its author actually read
(D228). Do not "correct" either to match the other.

**Expect ad-hoc commits between lanes, and expect them not to be here.** Since RA.8 five lanes shipped
outside the skill and are deliberately absent from the ledger — **RQ.1–RQ.5** (radar live queue, migration
`0030`), **SW.1**, **OFF-PILLAR/REMIX** (`813dafc`/`3868981`), `b92d783` (calendar tray draft-delete). **The
codemap §11 log and its header stamps are the record for all of them**; grep it by lane code, not this file.
A HEAD that doesn't name a masterplan task is normal now. **A new lane starts by writing a plan
(`/plan-feature`), registering it in `plans/MASTERPLAN.md`, and re-opening the ledger below in that lane's
FIRST commit** — RA.1, OU.2 and XR.1 are the worked examples, and all three **recounted** the `current state`
numbers off the running code instead of carrying the line forward (XR.1 found the suite line 96 tests and 2
files behind). Cross-checking the codemap header stamps against this file is the cheap version of that.

**What is still owed, and it is not a task.** `VERIFY-DEBT.md` holds **thirty-one** unpaid browser checks plus
CA.2 step 2 — shipped with automated gates only. Newest is `0z` (XR's three injected surfaces: the C pill, the
E chip, the on-page badge); `0n(b)` and `0l` are the only two that spend (~$0.003, ~$0.010). None needs a
session of its own — fold them into whichever session next has Chrome open on the panel, and **delete each
entry as you pay it**. Deliberately not in the archive: a debt filed among history stops being owed. Most are
structurally unpayable (a page tab cannot read another extension's `chrome.storage.local`; the service worker
has no reachable console), **but check WHICH half a check needs before filing** — X's own pages are payable
from here, injected UI on them is not (the OU.1/OU.8 gotcha, and D222).

**Size discipline (paid seventeen times).** STATE.md must load in a **single `Read`**, and the cap that bites
is the tool's ~25k **tokens**, not 256 KB. **Measured: 61.7 KB came back TRUNCATED at 25,023 tokens ⇒ ≈405
tokens/KB ⇒ ceiling ≈61.5 KB. Aim at 60 and leave 1.5 unspent.** `wc -c` for BYTES, not `.length` (this file
is full of multibyte `—`/`≥`/`✓`), and **run it FIRST, and again AFTER drafting — an ordinary task breaches it
too, and an up-front payment sized against last task's entries is not a budget.** Six lessons, each of which
cost real sessions: a breach is never one big entry but six affordable ones; a closing pass archives the lane
in front of it and misses the weight behind it, so also ask what stopped binding two waves ago; *"it still
binds an open task"* is a reason to **distil**, not to keep 19 KB; a CLOSED lane's lock row and pointer lines
are weight, not state; never fix a breach by deleting what an open task needs — if a pass slips, pay it as a
standalone housekeeping commit (`55c6d19`/`c9c8ade`); and **the cheapest payment of all is a lane closing**,
which is what took this file from **60.5 KB to ~38 KB at XR.8**. That headroom is the next lane's to spend,
and a wave re-opening is the most expensive entry type there is (XR.1 alone cost ~14 KB). The long version of
the trade — and XR.1–XR.7's individual payments — is in `STATE-ARCHIVE.md`.

- **last-commit:** **identity is the SUBJECT LINE — no sha is recorded (D97).** HEAD should read `docs(ranker): XR docs-sync + $0 smoke-x-ranker.ts (XR.8)`, parent `102d1dd` (XR.7). **Step 0 is one command:** `git log -1 --format='%h %s'`. Reconcile against this line, not against the whole log.
- **current state of the repo (recounted at XR.1, 2026-09-02, moved per task since — RECOUNTED off the running code, not carried forward; the previous line was stamped at OU.8 and five ad-hoc lanes had shipped past it):** suite **2805** across **138** files (**unmoved at XR.8 — a smoke script is not a test file**); tables **44** (42 in `src/x/db/schema.ts` + 2 shared — codemap §3.3 said 41/43 until XR.8 recounted it); migrations through **`0032_ordinary_iron_lad`** (33 journal entries, `0000`–`0032`) — **the journal is FREE from `0033`, and no task owns it, so the next lane confirms off the journal rather than off this line**; registry **16 groups / 69 knobs, 33 mirrored** and **17 prompt keys** (recounted by importing `SETTINGS_REGISTRY` and `PROMPT_KEYS`, not by grepping); MCP **28 tools** (`src/mcp.test.ts:122` asserts it); smoke scripts **42** (`smoke-x-ranker.ts` is the newest; a `calibrate-*` script is NOT one); extension `tsconfig.app.json` `include` **15 entries = 14 out-of-tree shims** (the first entry is the extension's own `src/**/*` — **count the shims, not the array**); panel tabs **15**; whole-repo lint **0 errors**. **None of the four multi-file moves is owed by anything** (mirrored settings knob = 7 edits,
- **current state of the repo (recounted at XR.1, 2026-09-02, moved per task since — RECOUNTED off the running code, not carried forward; the previous line was stamped at OU.8 and five ad-hoc lanes had shipped past it):** suite **2805** across **138** files (2695/135 at XR.1 → 2731/136 at XR.2 → 2736 at XR.3 → 2754 at XR.5 → 2771 at XR.4 → 2784 at XR.6 → **+21 tests, 12 of them in ONE new file, at XR.7**); tables **44** (`voice_tweets` is 22 columns after XR.7, not a new table); migrations through **`0032_ordinary_iron_lad`** (33 journal entries, `0000`–`0032`) — **the journal is FREE from `0033`; no remaining XR task owns one, so the next lane confirms off the journal rather than off this line**; registry **16 groups / 69 knobs, 33 mirrored** and **17 prompt keys** (recounted by importing `SETTINGS_REGISTRY` and `PROMPT_KEYS`, not by grepping); MCP **28 tools** (`src/mcp.test.ts:122` asserts it); smoke scripts **41** (a `calibrate-*` script is NOT one — XR.8 owns the 42nd); extension `tsconfig.app.json` `include` **15 entries = 14 out-of-tree shims** (the first entry is the extension's own `src/**/*` — **count the shims, not the array**; XR.5 took them 12 → 14 and nothing left is owed a shim); panel tabs **15**; whole-repo lint **0 errors**. **None of the four multi-file moves is owed by any remaining task** (mirrored settings knob = 7 edits,
registry prompt key = 4, MCP tool = 6 doc strings + 3 asserted numbers, migration = journal-first) — the full
step lists and their silent-failure modes are in `STATE-ARCHIVE.md`; grep `registry.ts`, `PROMPT_KEYS`,
`mcp.test.ts`, `content_pillars`.

- **next-up:** **nothing. The masterplan is closed at 165/165 and no ledger entry is open.** The next
  masterplan session is a NEW LANE, and it starts the way RA.1 / OU.2 / XR.1 did: write the plan with
  `/plan-feature`, register it in `plans/MASTERPLAN.md`, then **re-open the ledger below in that lane's first
  commit** and **recount** the `current state` line off the running code rather than carrying it forward —
  three lanes in a row have found it stale, and the ad-hoc commits between lanes are why. Standing gate
  reminders that survive the wave: `bun run test` (bare `bun test` targets the file DB and `inspect.test.ts`
  fails 2/2); biome forbids non-null assertions, a `let` assigned once and a backtick string with no
  interpolation, sorts import specifiers **case-sensitively** with `type` members ahead of value members of
  the same stem, and will reformat a >100-col call — run `bunx biome check --fix <files>` before the gate,
  **but never on a file that does not parse** (the XR gotcha below). The migration journal is free from
  `0033`; confirm that off the journal, not off this file.

## Ledger

Status: `[ ]` todo · `[~]` in progress (lane claimed) · `[x]` done (sha + date) · `[s]` skipped (reason in deviations).

**Every wave is CLOSED — 165/165, at XR.8 on 2026-09-02.** Per-task entries (shas, parents, dates, notes) live in
`STATE-ARCHIVE.md` — Waves 0–4 at UI.11, Wave 5 at GT.9, Wave 6 at JD.8, Wave 7 at RC.5, Wave 8 at RA.8,
**Wave 9 at OU.8, Wave 10 at XR.8**. Grep by task id.

- **Waves 0–7 — 156 tasks ✓ across 8 waves** (Foundations 13 · Prompt & identity 32 · Reply machine &
  on-page 29 · Ambient data & guardrails 16 · Authoring 3.0 15 · Settings moat 16 · Coach/judge/growth 25
  incl. GT.5 `[s]` by design · Radar follow-ups 10). Migrations taken: `0023` articles (Wave 4), `0024`
  draft_judgments (Wave 6), `0025` radar_drafts.curation_score (Wave 7). Closing commits, per-task rows and
  the task-id lists are in `STATE-ARCHIVE.md` — grep by task id (UI/ST/RU/N/ME/AI/AX/RL/NT/HV/GR/A3/SC/GT/JD/HM/RC).
- **Wave 8 — Radar access from a Claude Code session (8/8 ✓)**: RA.1–RA.8, plan `plans/2026-08-17-radar-access.md`, opened by `d968fe9`. **$0 lane.** Took migration `0029_blushing_expediter` (`radar_sightings`). Closed by `docs(radar): RA.8 radar-access docs-sync + $0 smoke-radar-access.ts`, parent `c02ff88`, 2026-08-18.
- **Wave 9 — Outliers: X advanced-search compiler, clipboard hand-off, saved hunts (8/8 ✓)**: OU.1–OU.8, plan `plans/2026-08-03-search-query-builder.md`, registered by `4ebceb3`, ledger re-opened by OU.2. **$0 lane — no `xFetch`, no `askLLM`, no image call on any path, by decision rather than by luck.** Took migration `0031_sharp_screwball` (`saved_searches`). Closed by `docs(outliers): OU docs-sync + $0 smoke-outliers.ts (OU.8)`, parent `47b5f56`, 2026-08-25 — **which closes the masterplan at 157/157.**

- **Wave 10 — XR: the X ranker port (8/8 ✓)**: XR.1–XR.8, plan `plans/2026-09-02-x-ranker-port.md`, registered by `52d0bd8`, ledger re-opened by XR.1. **$0 lane by construction** — no `xFetch`, no `askLLM`, no image call on any path; every read is over rows already stored. Took migration `0032_ordinary_iron_lad` at XR.7 (`voice_tweets` +5 nullable columns); **the journal is free from `0033`**. Order was the MASTERPLAN table's, which is NOT numeric — `XR.5` ran before `XR.4`. Closed by `docs(ranker): XR docs-sync + $0 smoke-x-ranker.ts (XR.8)`, parent `102d1dd`, 2026-09-02 — **which closes the masterplan at 165/165.** Per-task rows in `STATE-ARCHIVE.md`; grep by task id.

## Hot-file locks

**Nothing is held. No lane is open, so there is no ownership map** — every wave's per-file rows are in
`STATE-ARCHIVE.md` (grep by filename). The next lane writes its own table here in its first commit. The two
ranker modules are still closed to drive-by edits, but that is a property of the files rather than a lock —
it is stated once in the header above and does not need a row.

Two standing rules bind regardless:

- **Never run two migration-generating tasks in parallel sessions** (journal conflicts). Ignore any
  hardcoded migration number in plan text — *a plan quoting one is quoting the day it was written* — always
  `bun run db:generate` against the current journal, then inspect the SQL for dropped seed INSERTs
  (codemap §4). **The journal is free from `0033`.**
- **A plan sizes tasks by concern; the masterplan sizes lanes by FILE.** Every wave so far has found at least
  one `[parallel-ok]` tag that was wrong because two "independent" tasks both wrote one panel component
  (`Radar.tsx` in Waves 6–7, `Outliers.tsx` in Wave 9). Before trusting a parallel tag, grep the two task
  blocks' Edit lists for a shared file. The documented way to reach a closed lane's file notes is to
  **grep `STATE-ARCHIVE.md` by filename**.

## Deviations & decisions register

**Every lane's register is in `STATE-ARCHIVE.md`** — grep by task id or by the filename the lane built. Waves
0–3, the Wave-4 closer D127, the registry lane D128–D133, the polish lane D134–D140, the GT/SC lanes, the
whole JD lane at JD.8, the HM lane at HM.5, the RC lane at RC.5, **the RA lane (D188–D194) at RA.8**, and
**the whole OU lane (D198–D220) across OU.6 / OU.7 / OU.8**. What stays below is only what is **standing** —
true of the repo regardless of what you are building.

- **D7** (standing): all NEW UI from Wave 1 on uses UI.10 primitives + `--strat-*` tokens; Wave-5 polish passes touch only pre-masterplan tabs.
- **D97** (standing, bookkeeping): **the ledger records the commit SUBJECT LINE, not a sha.** Three tasks in a row wasted a Step-0 investigation proving a recorded sha was an amend-orphan, and every time the resolution was "the subject line is the identity". A sha can only be written into the commit that changes it by amending, which changes it again — the churn is structural, not carelessness. Ledger entries carry the subject line + the PARENT sha (stable, already in history), the codemap header stamps `<parent>+<TASK>`, and Step 0 is `git log -1 --format='%h %s'`.
- **D113(d)/(e)** (GR.10, standing — binds every smoke; full text in the archive): **(d) a smoke whose READS
  WRITE cannot use the namespace-then-delete rule** (a reconcile marks every unseen handle `gone`;
  `GET /following/queue` releases at read time) — `smoke-guardrails.ts` is the pattern: **snapshot and restore**
  every foreign row, from `fail()` too, then re-read `/x/brief` so the diary describes clean data. **(e)**
  "unseen" is `last_run_id != runId`, so proving `gone`/`confirmed` needs TWO runs.
- **D171** (JD.8, standing — binds every closing docs-sync and smoke; full text in the archive): **(a) a task
  whose output is a PROMPT or a SELECTION RULE belongs in the tab doc of the surface that RENDERS it** —
  "which tab does the user see this on" always has an answer even when "which tab did I edit" does not (GT.9
  wrote it as a note and JD.1 shipped invisible three tasks later). **(b)** a phase line goes in `PLAN.md`'s
  blockquote above §"Product, in one paragraph each", never §"Phased build". **(c) `--live` is not a style
  choice: ask what a $0 run cannot claim, and ship no flag if that list is empty.**
- **D184** (RC.5, standing; full text in the archive): **(a) a BEST-EFFORT write must be verified by a
  READ-BACK, and the failure message must name the real cause** — `persistRadarDrafts` swallows insert failures
  by design (§7.8), so a missing column is **zero rows**, not a throw, and a smoke asserting "it didn't throw"
  is green on an unmigrated DB. Generalizes to every `safeLog…`/`persist…` side hook. **(b) state the claim a
  smoke CANNOT make, in its header** — a silently dropped done-when reads as coverage.
- **D-number collision (OU.2):** `plans/MASTERPLAN.md`'s Wave-9 seed block is also labelled D195–D197. **D195
  unqualified below always means RA.8's entry**; cite a seed as "D195 in `plans/MASTERPLAN.md`".
- **D195** (RA.8, standing; full text in the archive). **(a) A smoke that needs a config must BRING one, not
  trust the operator's** — live filters are whatever was last tuned, so fixtures built to "clear the gates" are
  deterministic only by luck: PATCH the knobs to a known set, assert all rows admitted, then move **one** knob
  and assert the verdicts change. Restore by `isDefault`, from `fail()` too (D113d). **(b) "Confirm the counts
  rather than assuming" found them wrong** — `docs/settings-tab.md` claimed 67/16/32/16 against a registry of
  61/15/31/17. **A "not mine to fix" deferral is a bet that someone comes after you; the task that closes the
  lane loses that bet.** **(c)** a structurally unpayable browser check goes to `VERIFY-DEBT.md` — **filing
  beats claiming**.
- **D221** (OU.8 — **an inherited debt is a claim about the repo; check it against the diff before paying
  it**). This file and the plan header both recorded that the codemap "owes `b92d783` a §5 line". It did not —
  **that commit had written its own §5 line**; two further details in the record were wrong (the files it
  touched), and what was actually owed was the codemap **header stamp**, a different artefact. **Generalize: a
  debt recorded in prose outlives the fix; `git show --stat <sha>` costs one command and is the only thing that
  says whether it is still owed.**
- **D222** (OU.8) — the browser pass could not be paid, and the reason generalizes: **X's OWN rendering is
  payable from a coding session, INJECTED rendering is not.** Full statement in the gotchas log (OU.1/OU.8),
  which is where it binds; not repeated here.
- **D223** (OU.8 — **D195(b) applied twice more, one right and one wrong**). OU.8 re-read the four
  `docs/settings-tab.md` count strings this file had flagged and found them **correct** (69/16/33/17,
  recounted off `SETTINGS_REGISTRY` — confirming rather than assuming is the whole discipline). It then found
  two the wave had never looked at: **`docs/README.md` still said "the 63 knobs"**, and **codemap §3.1's
  migrations row still read `0000`–`0028`** — four stale, with §4 carrying the truth the whole time.
  **Generalize: a count string in a file NOBODY on the lane opened is the one that rots — check the index pages
  (`docs/README.md`, codemap §3) as well as the ones the feature touched.**
- **D224** (OU.8 — **the smoke asserts two things the plan's list did not ask for**). **(a)** `POST
  /searches/compile` is the only route in the feature with no production caller, and a route whose only caller
  is a suite that mounts it bare has never been proven to answer over a composed request (it also pins D208b:
  **200 with `problems` and `url: null`**, because a preview's 400 tells the form nothing). **(b)** the list
  item vs detail read identity (D208a), one `JSON.stringify` apart. **Generalize: a plan's Tests list is a
  floor. The two cheapest additions are usually the route nothing in production calls and the "these two shapes
  are identical" promise some other task was allowed to rely on.**
- **D225–D244 (the whole XR lane) — archived at XR.8**, verbatim, in `STATE-ARCHIVE.md` under *"Archived at XR.8"*; grep by number. Nothing there binds an open task. Three are worth knowing exist before touching the two ranker modules: **D228** — attribution is per-FILE and per-READ (`xRanker.ts` Apache-2.0/xAI, `xRankerSignals.ts` MIT/Ryan Lenk, and neither is a mistake). **D236** — `rankerBand` no longer exists; call `rankerDraftBand` or `rankerMeasuredBand`, never one function with a `scale` flag, because a wrong flag there is silent. **D238** — `rankerScoreEffectiveness` reads `totalPosted: 0` on prod and is CORRECT: its population is own harvested originals and no `posts`-mode harvest of my own profile has ever been run.

## Gotchas log

Things the next implementer must know that aren't obvious from the code. Append-only, one line each, newest last.

**Every closed lane's gotchas are in `STATE-ARCHIVE.md`** — grep it by task id or filename before touching a
file a closed lane built (Wave 6's at JD.8, the HM lane's at HM.5, the RC lane's at RC.5, the RA lane's 22 at
RA.8, **the OU lane's at OU.6 / OU.7 / OU.8**). What stays below is the standing set: test/lint/typecheck traps
that bite any task, the Wave-3 carry-forward, and the findings that are about the repo rather than about a
feature.
**Browser-verification debt is not here — it is `VERIFY-DEBT.md`**; a debt parked among facts reads as a fact.

- **Settings types are extension-local mirrors.** The extension MUST NOT import `src/x/settings/registry.ts` (§5 build-isolation); it mirrors the `GET /x/settings` JSON in `extension/src/shared/types.ts`, and a new server-side `SettingDef` field is hand-synced there. **The same wall bites `scripts/`, in the other direction:** a smoke may not import the extension build, which is why `smoke-humanizer.ts` keeps a local `mulberry32` and `smoke-radar-curate.ts` cannot test `partitionForCurate`. (Full block in the archive; grep `Settings types are`.)
- **`exactOptionalPropertyTypes` pass-through pattern (UI.10):** primitives forwarding a maybe-undefined optional (`Slider.unit`, `SettingRow.onReset`, `GearPopover.onReset`/`label`) type the prop as `T | undefined` explicitly — else TS rejects `prop={maybeUndefined}`. Reuse this for new primitives that relay optionals. Root tsconfig also has **`noUncheckedIndexedAccess`**, so `arr[0]` is `T | undefined` — name your fixtures as consts rather than indexing them in a script.
- **`inspect.test.ts` fails 2/2 under bare `bun test`, GREEN under `bun run test`** (the canonical `SQLITE_PATH=:memory: bun test`). `src/db/client.ts` defaults to `:memory:` when `NODE_ENV==='test'`, but `src/x/data/inspect.ts`'s readonly connection still defaults to `./stratus.db` when `SQLITE_PATH` is unset — the primary writes memory, the readonly reads the file, seeded rows are invisible. **Always gate with `bun run test`.** One-line fix for a future data-core task: make `inspect.ts` honor the same `NODE_ENV==='test'` default (or have `client.ts` `process.env.SQLITE_PATH ??=` set it so both agree).
- **A route suite over the composed `app` tests the WIRING; a bare-Hono suite tests the ROUTE** (D179a, generalized). `src/app.test.ts`'s guards sit behind `describe.if(authed)` and need `API_TOKEN`, and an LLM-gated router refuses to mount without a provider key (§7.22) — so on a clean checkout those tests do not run at all. An LLM route needs its own bare-Hono suite (`judge.test.ts` / `drafter.test.ts` / `replies.test.ts` / `humanizer.test.ts`) or its refusal ladder is untested on any machine that isn't fully configured. **There is no `mock.module` anywhere in this repo:** the established substitute is a 400 ladder ending in a forced 503 with both provider keys unset in a `finally` (which also proves for free that the prompt + input rendered), plus unit tests over the post-spend parsers.
- **NT.1: extension typecheck does NOT cover `*.test.ts`** — `extension/tsconfig.app.json` has `"exclude": ["src/**/*.test.ts"]`, and root `tsconfig.json` only includes `src/**/*` + `scripts/**/*` + `drizzle.config.ts`. So an extension test file is checked by **`bun run test` alone**; a type error in one is invisible to both typechecks.
- **NT.7: `app.request(...)` is typed `Response | Promise<Response>`.** A helper declared `function f(): Promise<Response> { return app.request(...) }` fails root typecheck; make the helper `async`. `bun run typecheck` covers `scripts/**`, so this bites in smoke scripts, not in route suites (which `await` inline).
- **CLAUDE.md was slimmed to guardrails-only (2026-07-23, out-of-skill docs refactor).** The full phase-entry ledger moved **verbatim** to `docs/PHASE-HISTORY.md`. **Every docs-sync task (MASTERPLAN global rule 6, codemap §7 rule 29) appends its phase entry to `docs/PHASE-HISTORY.md`, NOT CLAUDE.md**; CLAUDE.md changes only when a guardrail (invariant, workflow, stack quirk) changes. Plan text still saying "CLAUDE.md phase entry" means the history file.
- **Wave-3 carry-forward — four repo-wide facts (the rest of HV/GR is in the archive):** **(1) The MCP tool
  count is asserted exactly** — `src/mcp.test.ts` asserts **28**, and every new tool bumps that number plus six
  unasserted strings in `docs/s2-mcp-server.md` **in the same commit** (that doc was silently 5 tools stale for
  four phases). **(2) Docs assert user-visible strings** — `docs/{harvest,playbook,people,today,composer,replies,radar,settings}-tab.md`
  quote real copy, so **rewording a quoted string owes the doc in the same commit** (`docs/today-tab.md` is
  numbered §1–§18, so an inserted card renumbers rather than appends). **(3) Real-DB fixture rules that outlive
  their lane:** a seeded `posts_published` row is written **`retired: true`**; a `following` fixture needs a
  `following_runs` row first (notNull FK); people-layer handles must be **≤15 chars** (longer ones are silently
  skipped and the assertions go vacuous); any suite touching `scheduled_posts`/`posts_published` inside the
  monitor's windows must delete its rows in `afterAll`. **(4) Five reads WRITE and none may be polled:**
  `/radar/drafts` (48h expiry), `/following/queue` (release + revoke), and `/x/goals` + `/x/brief` + `/x/digest`
  (all three settle `active → achieved|missed`) — a refresh loop on `/x/brief` silently advances goal statuses.

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
- **RA.6 — `chrome.storage.local` is unreachable from every tool in a coding session, so a toggle question goes to
  the operator.** The stratus panel is a Chrome *side panel*, not a tab; a page tab cannot read another extension's
  storage, the claude-in-chrome MCP drives tabs only, and the extension service worker has no console you can reach
  from here. Every `VERIFY-DEBT.md` browser item has the same ceiling: what they need is the human at the browser.
- **OU.1/OU.8 — the `VERIFY-DEBT.md` ceiling is about the SIDE PANEL, not the browser, and it splits in two.**
  Debt entries say "what they need is the human at the browser" because a page tab cannot read another
  extension's `chrome.storage.local` and the service worker has no reachable console. **None of that applies to
  an ordinary web page:** OU.1's x.com check was run live from a coding session with the claude-in-chrome MCP
  (navigate to `/search?q=…&f=live`, `get_page_text`, read the returned posts' OWN metrics — which is what
  proves a filter fired; "results came back" proves nothing). **But X's OWN rendering is payable and INJECTED
  rendering is not** (D222): confirming a stratus button needs the content script, and the MCP's Chrome has no
  stratus extension loaded — OU.8's control found neither **Save to stratus** nor the ⊕ on `/home`, where both
  certainly work. **Run the control on a page where the thing definitely works before recording a pass OR a
  failure**; without one, an absence is inconclusive rather than a finding.
- **OU.1 — `USERNAME_RE` has EIGHT identical copies** (`/^[A-Za-z0-9_]{1,15}$/`; `grep -rn` it across `src
  extension`). Consolidating is a real task, not a drive-by — seven impure files plus the content IIFE. Full
  list in the archive.
- **OU.1 — a pure `src/shared/` task owes NO extension build.** The shim (`extension/src/searchQuery.ts`) is OU.5's,
  so `cd extension && bun run build` was not run and was not owed here; the standing rule attaches to touching an
  `extension/` file, not to writing a module the extension will later import. Same for the docs count strings — a
  module with no consumer moves none of them.

- **OU.4 — a bare-Hono route suite does NOT prove the route is MOUNTED.** `searches.test.ts` builds its own
  `new Hono()` and `app.route('/x', searchesRouter)` (the `replyLists.test.ts` harness), so it stays green whether or
  not `src/x/index.ts` ever imports the router — and `src/app.test.ts` only exercises auth/CORS/validation, not the
  mount table. OU.4 closed the gap by importing the **composed** `src/app.ts` in a throwaway script and hitting
  `/x/searches/defaults` + `/x/searches` with the bearer (both 200, `since` 30 days back, `capture` zeroed). **Do the
  same for any new router**: it is one command and it is the only thing that catches a forgotten `app.route`.
- **OU.6 — a `title` on a DISABLED button is not a way to tell the user anything.** Chrome suppresses pointer events on a
  disabled form control, so the tooltip the plan asked for ("channels without keywords are rendered disabled with a title
  saying so") may never appear. The chip keeps the `title` **and** appends a visible `· no keywords` to its label, which is
  what actually carries the information. Same trap anywhere a disabled control is the only carrier of an explanation.
- **OU.7 — `wc -l` on `extension/dist/content.js` lies about whether a change landed; grep the built file instead.**
  The content pass is an IIFE bundle, so a one-field change shows up as `sourcePath = location.pathname` on a real
  line (`grep -n sourcePath extension/dist/content.js`) — worth doing once after any content-script edit, because the
  extension typecheck and the panel build are both green whether or not the content pass actually re-emitted.
- **OU.7 — a `cd extension` in one Bash call persists into the next.** Two verification commands in this session ran
  from `extension/` without meaning to (`ls extension/dist` came back empty while `dist/content.js` existed). The
  working directory persists between calls even though shell state does not; prefix verification commands with
  `cd /Users/narcisbrindusescu/newme/stratus &&` after any build step, or read a wrong answer as fact.
- **OU.7 — the composed app is `export const app`, not a default export.** `(await import('src/app.ts')).default` is
  `undefined` and fails one line later with `app.request is not a function`, which reads like a mount problem. Every
  throwaway composed-app script in this wave (OU.4, OU.5, OU.7) needed the same one-line fix; write
  `const { app } = await import(...)` and pass `API_TOKEN` + a scratchpad `SQLITE_PATH` so the real DB is never touched.
- **OU.8 — status shapes that cost a smoke run.** `POST /x/voice/scrape` and `POST /x/searches` answer **201**
  (not 200); `DELETE /x/searches/:id` answers **204 with no body**, so a helper that unconditionally
  `await res.json()` throws on the happy path — **branch on 204 first**; `POST /x/searches/compile` answers
  **200 even for a query full of errors**.
- **OU.8 — `bun run test` piped into `tail` in a BACKGROUND shell produced no output and never finished;
  run redirected to a file instead.** The suite itself takes **~3.3 s** (2599 tests / 132 files), so a run
  that has been "going" for minutes is a harness artefact, not a hung test. `bun run test > log 2>&1` then
  `tail` the file — the same one-line habit the smoke scripts already use.

- **XR (archived at XR.8; the whole lane's gotchas are in `STATE-ARCHIVE.md` under *"Archived at XR.8"* — grep by task id or filename).** Four survive because they are about the REPO, not about the ranker.
  **(a) `bunx biome check --fix` on a file that does NOT PARSE rewrites it destructively** (also codemap §7): a backtick inside a CSS comment closed `content.ts`'s `injectStyles` template early, biome parsed the rest as JavaScript and ate ~120 lines of styling — typecheck, lint and the build all stayed green, because it is a template string. Run `bunx biome check` WITHOUT `--fix` when a file may not parse, and `git diff` immediately if a fix pass says *"Some errors were emitted while applying fixes"*. Repair from `git show HEAD:<file>`. **No backtick and no bare `${` inside those CSS comments.**
  **(b) The production corpus is not on this machine, and the scratch-DB recipe is how to reach it** (long form in the archive, grep `scratch-DB recipe`; doctrine half in codemap §7.34). Local `stratus.db` has **zero** `harvest_rows`. `POST /x/data/query` answers read-only SQL over HTTP with the `.env` bearer, so `curl … -o dump.json` costs no context and `json_group_array(json_object(...))` in ONE cell beats the 500-row cap; then `SQLITE_PATH=<scratch> bun run scripts/migrate.ts` and insert with raw `bun:sqlite` (**`harvest_runs` before `harvest_rows`** — notNull FK; **`posts_published` has no `id` column**). Run the REAL deliverable against it, never a second implementation in SQL. The composed app is `const { app } = await import('src/app.ts')`, not a default export.
  **(c) Source transcription from off-machine is plain `curl` + `grep` from Bash, never `WebFetch`** — it summarizes, and silently reformatted a Rust macro into a tidy table. The unauthenticated GitHub endpoints that work are in the archive, grep `reachable from Bash`.
  **(d) The precedent for a `src/shared/` module importing a sibling is `postCooldown.ts`, not `cannon.ts`** (which is type-only and proves nothing about runtime). §7.26's rule is that the content bundle has no *external* runtime import — siblings inline together, and rollup tree-shakes whatever the entry point cannot reach.
- **XR.8 — two partition traps, now carried by codemap §9 rather than re-derived.** `RankerScoreCell.posted` is the rows in the cell and `n` is the measured subset, so a partition check that sums `n` silently stops checking a partition; and a Playbook-cell fixture that varies only the counts leaves the C table as one undifferentiated bucket, because both cells are cut over the same rows. Generalizes to every `OutcomeCell`-shaped table: **`posted` counts membership, `n` counts measurement, and the gate is on `n`.**

## Planning-error log

Corrections to MASTERPLAN.md itself (wrong dep, wrong order discovered live).

- **2026-07-16-niche.md Task 3 done-when** — the "`Pitești` hits nothing" grep contradicts the same task's bit-for-bit equivalence requirement (post prompt §6/§9/§0 carry builder biography outside the §1/§5 extraction scope; no niche field exists to hold them). Resolved at N.3 in favor of equivalence; see D28b for the full resolution + what N.9 must scope differently. Source plans are never edited — this entry is the correction.
- **2026-07-17-ai-layer.md — no task owns the post drafter's askLLM migration.** Task 5's edit list names replies/pillars/playbook/voiceExtract; Task 6 only flips drafter's MOUNT gate; Task 7 adds a sibling route. Yet the plan's Why-section + Done-when #1 spirit require every draft surface to honor the provider setting, and the Task-6 gate flip would 502 `/posts/draft` on OpenRouter-only setups. Resolved at AI.5 by migrating `drafter.ts` there (D47b) — the call-site-migration task was the right home.