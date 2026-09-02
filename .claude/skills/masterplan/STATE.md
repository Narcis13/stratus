# Masterplan execution state

> Dynamic memory for `/masterplan`. Updated after EVERY task, in the task's own commit.
> Plan: `plans/MASTERPLAN.md` (static — order, reasoning levels, waves, D1–D10 + the per-wave seed blocks, whose numbering COLLIDES with this file's from Wave 9 on — see the collision note in the register).
> Codemap: `.claude/skills/plan-feature/references/codemap.md` (updated per task too).
> History: `.claude/skills/masterplan/STATE-ARCHIVE.md` (frozen, grep-only — closed-lane deviations, gotchas, priors, ledger rows).
> Debt: `.claude/skills/masterplan/VERIFY-DEBT.md` (**unpaid**, not history — browser-verify + CA.2. Read it when you have Chrome open; skip it otherwise).

## WAVE 10 IS OPEN — XR, the X ranker port. **162 / 165.**

`plans/2026-09-02-x-ranker-port.md` (XR.1–XR.8) re-opens the masterplan a **third** time, closed at OU.8 /
157-of-157 since 2026-08-25. It puts a second number beside the Composer's coach pill — **C**, computed from
X's *published production* For You weights — plus an **E** score (the same weights over a post's *measured*
rates) and, in XR.3/XR.4, the falsification cell that says whether either number means anything on our
corpus. `plans/MASTERPLAN.md`'s legend, header note and Wave-10 section were registered by `52d0bd8`; **XR.1
owed the ledger re-opening and the `current state` recount, and both are below.**

**The whole wave is $0 and structurally so:** every read is over rows already stored (`harvest_rows`,
`voice_tweets`, `chrome.storage.local`), no task can reach `xFetch` or `askLLM`, and invariant #8 is
untouched — nothing here adds a billed read back to get a count the DOM did not give us.

**The Bangermeter tree is at `/Users/narcisbrindusescu/Downloads/bangermeter-main/`** — a Downloads folder
tracked by nothing, so `ls` it before relying on it and go upstream per D225 if it is gone. **Two files, two
attributions, and neither is a mistake** (D228): `xRanker.ts` = Apache-2.0/xAI (the published weights, read
off `xai-org/x-algorithm`), `xRankerSignals.ts` = MIT/Ryan Lenk (the priors, shrinkage and head-split, which
have no upstream). Do not "correct" either to match the other.

**Wave 9 (OU — Outliers) closed at OU.8 on 2026-08-25**, taking 149/149 to 157; its whole register, gotchas,
ledger rows and lock table are in `STATE-ARCHIVE.md` under *"Archived at OU.8"* (grep by task id, D-number or
filename). One line survives because it binds the next money decision: **that wave was $0 by DECISION rather
than by luck** (X API v2 has no `min_faves` operator at any tier), **and Wave 10 is $0 on the same footing**.
Invariant #8's "decide out loud" cuts both ways.

**Expect ad-hoc commits between lanes, and expect them not to be here.** Since RA.8, five lanes shipped
outside the skill and are deliberately absent from the ledger — **RQ.1–RQ.5** (radar live queue, migration
`0030`), **SW.1**, **OFF-PILLAR/REMIX** (`813dafc`/`3868981`), `b92d783` (calendar tray draft-delete). **The
codemap §11 log and its header stamps are the record for all of them**; grep it by lane code, not this file.
A HEAD that doesn't name a masterplan task is normal now.

**A new lane starts by writing a plan (`/plan-feature`), registering it in `plans/MASTERPLAN.md`, and
re-opening the ledger below in that lane's FIRST commit** — RA.1, OU.2 and **XR.1** are the worked examples.
All three got one thing right worth copying: **recount** the `current state` numbers off the running code
instead of carrying the line forward. OU.2 found two stale, OU.8 found `docs/README.md` wrong, and **XR.1
found the suite line 96 tests and 2 files behind** after five ad-hoc lanes. Cross-checking the codemap header
stamps against this file is the cheap version of the recount.

**What is still owed, and it is not a task.** `VERIFY-DEBT.md` holds **thirty** unpaid items — browser checks
that shipped with automated gates only, plus CA.2 step 2. Newest is `0y` (OU's ⊕ on a search page); `0n(b)`
and `0l` are the only two that spend (~$0.003, ~$0.010). None needs a session of its own: fold them into
whichever session next has Chrome open on the panel, and **delete each entry as you pay it.** Deliberately not
in the archive — a debt filed among history stops being owed. Most are structurally unpayable (a page tab
cannot read another extension's `chrome.storage.local`; the service worker has no reachable console), **but
check WHICH half a check needs before filing** — X's own pages are payable from here, injected UI on them is
not (the OU.1/OU.8 gotcha).

**Size discipline (paid sixteen times; distilled at XR.5, which is itself a payment — the long version is in
`STATE-ARCHIVE.md` under the XR.5 trade).** STATE.md must load in a **single `Read`**, and the cap that bites
is the tool's ~25k **tokens**, not 256 KB. **Measured: 61.7 KB came back TRUNCATED at 25,023 tokens ⇒ ≈405
tokens/KB ⇒ ceiling ≈61.5 KB. Aim at 60 and leave 1.5 unspent.** `wc -c` for BYTES, not `.length` (this file
is full of multibyte `—`/`≥`/`✓`), and **run it BETWEEN entries, not only before the commit — an ordinary task
breaches it too.** Five lessons, each of which cost real sessions: a breach is never one big entry but six
affordable ones; a closing pass archives the lane in front of it and misses the weight behind it, so also ask
what stopped binding two waves ago; *"it still binds an open task"* is a reason to **distil**, not to keep
19 KB; a CLOSED lane's lock row and pointer lines are weight, not state; never fix a breach by deleting what
an open task needs — if a pass slips, pay it as a standalone housekeeping commit (`55c6d19`/`c9c8ade`).
**Every addition from here is a TRADE.** XR.1 alone added ~14 KB (a wave re-opening is the most expensive
entry type there is); XR.3 paid by distilling the standing D-entries; XR.5 paid by deleting the duplicated
D223/D224. **XR.4 added three D-entries and paid ~5 KB for them: D226/D227/D229/D233 folded into ONE
facts-only entry (they were four payments of one lesson), D230 and D232's K half reduced to pointers now that
they are discharged, and D225/D231/D234/D235 compressed to what still binds an open task.** Cheapest reduction
left: the XR.1/XR.2 gotchas, once the wave closes.

- **last-commit:** **identity is the SUBJECT LINE — no sha is recorded (D97).** HEAD should read `feat(playbook): does the ranker score predict our views? gated quartile cell (XR.4)`, parent `3147c2f` (XR.5). **Step 0 is one command:** `git log -1 --format='%h %s'`. Reconcile against this line, not against the whole log.
- **current state of the repo (recounted at XR.1, 2026-09-02, moved per task since — RECOUNTED off the running code, not carried forward; the previous line was stamped at OU.8 and five ad-hoc lanes had shipped past it):** suite **2771** across **136** files (2695/135 at XR.1 → 2731/136 at XR.2 → 2736 at XR.3 → 2754 at XR.5 → **+17 tests, no new file, at XR.4**); tables **44**; migrations through **`0031_sharp_screwball`** (32 journal entries, `0000`–`0031`) — **the journal is FREE from `0032`, which XR.7 owns and must still confirm off the journal rather than off this line**; registry **16 groups / 69 knobs, 33 mirrored** and **17 prompt keys** (recounted by importing `SETTINGS_REGISTRY` and `PROMPT_KEYS`, not by grepping); MCP **28 tools** (`src/mcp.test.ts:122` asserts it); smoke scripts **41** (a `calibrate-*` script is NOT one — XR.8 still owns 42); extension `tsconfig.app.json` `include` **15 entries = 14 out-of-tree shims** (the first entry is the extension's own `src/**/*` — **count the shims, not the array**; XR.5 took them 12 → 14 and nothing left is owed a shim); panel tabs **15**; whole-repo lint **0 errors**. The four multi-file moves a new task will hit — **none of them is owed by any remaining XR task except the migration**, so the full step lists live in `STATE-ARCHIVE.md` (grep `registry.ts`, `PROMPT_KEYS`, `mcp.test.ts`) and only the sizes and the silent-failure modes stay here. **A mirrored settings knob is SEVEN edits** (`registry.ts`, `registry.test.ts` **twice**, `docs/settings-tab.md`'s three count strings **plus** its group-table row, and extension-side `ServerConfig`/`SERVER_DEFAULTS`/`readServerConfig`) — **the server half alone ships a knob that silently does nothing**; a `scope:'server'` group is three of the seven and no extension build. **A registry prompt key is FOUR** (the default must be exported from a **pure** module or the imports cycle). **An MCP tool is SIX doc strings plus three asserted numbers** (`src/mcp.test.ts`'s exact 28, `scripts/smoke-mcp.ts`'s name list, and five places in `docs/s2-mcp-server.md` + codemap §3.3/§6). **A migration** never runs in two parallel sessions, ignores any number quoted in plan text, and is inspected for dropped seed INSERTs by `git status --porcelain src/db/migrations/` (**not `git diff --stat`** — the new `.sql` and its snapshot are UNTRACKED, so a diff shows only the `_journal.json` append and reads like the SQL never landed) plus a fresh `:memory:` boot counting `content_pillars` (3) — never by grepping for `INSERT INTO`, which `0000`'s `INSERT OR IGNORE` spellings make return 0.
- **next-up:** **XR.6 ∥ XR.7 are the only open implementation tasks and they share no file** — but XR.7 is the migration task and **runs alone**, so in practice: XR.6 now, XR.7 alone, XR.8 last.
  **XR.6** (E chip on Radar sightings; **high**; deps XR.5 ✓). Scores the **sighting**, never the drafted reply (plan Decision 9), and is **not** OON-rescored (D231). Copy XR.5's settled calls rather than re-deriving: tone comes from **`chips.ts`**, borrowing no coach colour class (D235); an unobservable input stays **absent, never 0/false** (§7.11); anything the arithmetic cannot say is said as a **word** (D229). **Two things XR.4 changed under it:** the band function it must call is now **`rankerMeasuredBand`**, not `rankerBand` (which no longer exists — two functions, no flag, D236), and `strong` is now REACHABLE on real sightings (0.0% → ~17% on the 712 stored `radar_sightings`), which is the whole reason the chip is worth rendering. `radar_sightings` carries `views`/`likes`/`replies` and **no reposts column** — that head goes absent, not zero.
  **XR.7** (migration `0032`, 5 nullable `voice_tweets` columns + server-computed `ranker_e` + on-page badge; **xhigh, RUNS ALONE**; deps XR.5 ✓). Journal still free from `0032` — confirm off the journal, never off this line. Its inline proof is `grep -c 'rust_home_mixer_favorite_weight' extension/dist/content.js`, `0` today, `1` after.
  **XR.8** closes: docs-sync (`docs/composer-tab.md`, `docs/radar-tab.md`, `docs/playbook-tab.md`, `docs/PHASE-HISTORY.md`) + `$0 scripts/smoke-x-ranker.ts` (smoke 41 → 42) + the browser pass. **`rankerScoreEffectiveness` is its consumer** and on prod that cell reads `totalPosted: 0` — the smoke must say so honestly rather than reading empty as broken (D238).
  Standing gate reminders: `bun run test` (bare `bun test` targets the file DB and `inspect.test.ts` fails 2/2); a pure `src/shared/` task owes **no** extension build and moves **no** docs count (OU.1) — **XR.6/XR.7 owe the build**; biome forbids non-null assertions, a `let` assigned once and a backtick string with no interpolation, sorts import specifiers **case-sensitively** with `type` members ahead of value members of the same stem, and will reformat a >100-col call — run `bunx biome check --fix <files>` before the gate.

## Ledger

Status: `[ ]` todo · `[~]` in progress (lane claimed) · `[x]` done (sha + date) · `[s]` skipped (reason in deviations).

**Waves 0–9 are CLOSED — 157/157; Wave 10 is OPEN at 5/8, so the masterplan stands at 162/165.** Per-task entries (shas, parents, dates, notes) for the closed waves live in
`STATE-ARCHIVE.md` — Waves 0–4 at UI.11, Wave 5 at GT.9, Wave 6 at JD.8, Wave 7 at RC.5, Wave 8 at RA.8,
**Wave 9 at OU.8**. Grep by task id.

- **Wave 0 — Foundations (13/13 ✓)**: UI.1, UI.8, UI.9, UI.10, ST.1–ST.9. Closed by `d1902e5` ST.9 studio docs+smoke.
- **Wave 1 — Prompt & identity core (32/32 ✓)**: RU.1–RU.3, N.1–N.9, ME.1–ME.7, AI.1–AI.13. Closed by `f86e06a` AI.13 AI docs+smoke.
- **Wave 2 — Reply machine & on-page surfaces (29/29 ✓)**: RU.4–RU.10, AX.1–AX.7, RL.1–RL.8, NT.1–NT.7. Closed by `5d4a1a4` NT.7 NT docs+smoke.
- **Wave 3 — Ambient data & guardrails (16/16 ✓)**: HV.1–HV.6, GR.1–GR.10. Closed by `docs(guardrails): GR docs-sync + $0 smoke-guardrails.ts (GR.10)`, parent `7adfbca`.
- **Wave 4 — Authoring 3.0 (15/15 ✓)**: A3.1–A3.15. Took migration `0023_slimy_night_thrasher` (`articles`). Closed by `docs(authoring): Authoring 3.0 docs-sync + $0 smoke-authoring3.ts (A3.15)`, parent `819c61d`.
- **Wave 5 — Settings moat + polish (16/16 ✓)**: UI.2–UI.7, UI.11–UI.17. Closed by `docs(ui): cockpit overhaul docs-sync + $0 smoke-settings.ts (UI.17)`, parent `7b10239`.
- **Wave 6 — Coach, judge & growth tactics (25/25 ✓, + GT.5 `[s]` by design)**: SC.1–SC.9, GT.1–GT.9, JD.1–JD.8. Took migration `0024_soft_leopardon` (`draft_judgments`). Closed by `docs(judge): LLM-judge docs-sync + $0 smoke-judge.ts (JD.8)`, parent `fc44d1c`.
- **Wave 7 — Radar follow-ups: curated drafting & humanize-at-pick (10/10 ✓)**: HM.1–HM.5, RC.1–RC.5. Took migration `0025_curvy_edwin_jarvis` (`radar_drafts.curation_score`). Closed by `docs(radar): RC docs-sync + $0 smoke-radar-curate.ts (RC.5)`, parent `80a2f2b`.
- **Wave 8 — Radar access from a Claude Code session (8/8 ✓)**: RA.1–RA.8, plan `plans/2026-08-17-radar-access.md`, opened by `d968fe9`. **$0 lane.** Took migration `0029_blushing_expediter` (`radar_sightings`). Closed by `docs(radar): RA.8 radar-access docs-sync + $0 smoke-radar-access.ts`, parent `c02ff88`, 2026-08-18.
- **Wave 9 — Outliers: X advanced-search compiler, clipboard hand-off, saved hunts (8/8 ✓)**: OU.1–OU.8, plan `plans/2026-08-03-search-query-builder.md`, registered by `4ebceb3`, ledger re-opened by OU.2. **$0 lane — no `xFetch`, no `askLLM`, no image call on any path, by decision rather than by luck.** Took migration `0031_sharp_screwball` (`saved_searches`). Closed by `docs(outliers): OU docs-sync + $0 smoke-outliers.ts (OU.8)`, parent `47b5f56`, 2026-08-25 — **which closes the masterplan at 157/157.**

- **Wave 10 — XR: the X ranker port (5/8)**, plan `plans/2026-09-02-x-ranker-port.md`, registered by `52d0bd8`, ledger re-opened by **XR.1**. **$0 lane by construction** — no `xFetch`, no `askLLM`, no image call on any path; every read is over rows already stored. Owns migration **`0032`** at XR.7 (the journal is free from it today). Order is the MASTERPLAN table's, which is NOT numeric — `XR.5` runs before `XR.4`.
  - `[x]` **XR.1** — `src/shared/xRanker.ts`: 26 published weights + `ScoringWeights::new` sums + `offsetScore`/`scoreHeads`/`replyWeightFor`/`oonApplies`/`diversityMultiplier`/`normalizeScore`. 2 files, both new, **no consumer yet**. `feat(ranker): port X's published For You weights + ranking_scorer arithmetic (XR.1)`, parent `52d0bd8`, 2026-09-02. Suite 2627 → **2695** / 134 → **135**. Deps: none.
  - `[x]` **XR.2** — `src/shared/xRankerSignals.ts`: `X_BASELINE_P` (20 priors) + `X_OBSERVED_RATES` (placeholder) + **`X_MODIFIERS` (23)** + `signalsToHeadPs` / `scoreDraftRanker` (C) / `scoreMeasured` (E). 2 files, both new, **still no consumer**. `feat(ranker): map postCoach/postFormat signals onto ranker heads (XR.2)`, parent `88af95b`, 2026-09-02. Suite 2695 → **2731** / 135 → **136**. Deps: XR.1 ✓.
  - `[x]` **XR.3** — `scripts/calibrate-ranker.ts` (NEW, **not a smoke**) + measured `X_OBSERVED_RATES` — favorite `0.029412`, reply `0.019774`, retweet **`0`**, n=766 over `harvest_rows mode='timeline'` 2026-07-24..2026-08-17. **The plan's 48h maturity cut was falsified and ships as a diagnostic (D232); retweet 0 is the honest median (D233); a broken XR.2 test was the finding (D234).** `feat(ranker): calibrate the E-score baseline against our own harvest corpus (XR.3)`, parent `1156ff1`, 2026-09-02. Suite 2731 → **2736** / 136 unmoved. Deps: XR.2 ✓.
  - `[x]` **XR.5** — the two shims (`include` **12 → 14** shims / 15 entries) + the Composer's **C** pill: `chips.ts::rankerBandChip`, `composerLogic.ts::rankerDraftFeatures`/`rankerPillLabel`/`rankerPillTitle`, two memos + one `.coach-head` span + one `<small>` in `Composer.tsx`, one non-colour `.ranker-pill` rule. **The tone map moved to `chips.ts` and borrows NO coach colour class (D235); only `below` is coloured; the tooltip calls 50 signal-free, not typical.** `feat(composer): ranker C score beside the coach pill (XR.5)`, parent `916d758`, 2026-09-02. Suite 2736 → **2754** / 136 unmoved. Deps: XR.2 ✓.
  - `[x]` **XR.4** — `buildRankerScoreEffectiveness` (playbook §15b: quartile cells cut from the sample, ties kept together, `spread` naming its gated pair, `contentCells` = the same rows scored prospectively) + `latestOwnPostRows` (`harvest_rows mode='posts'`, never the frozen `metrics_snapshots`) + `rankerScoreEffectiveness` on `/x/playbook`. **Both re-cuts paid, with evidence, and the answers were not the expected ones: `RANKER_BAND_CUTS` splits into two MEASURED pairs (D236) and K stays at 2000 (D237).** On prod the cell reads `totalPosted: 0` (D238). `feat(playbook): does the ranker score predict our views? gated quartile cell (XR.4)`, parent `3147c2f`, 2026-09-02. Suite 2754 → **2771** / 136 unmoved. Deps: XR.3 ✓.
  - `[ ]` **XR.6** — **E** chip on Radar sightings (scores the *target*, never the drafted reply). Deps: XR.5.
  - `[ ]` **XR.7** — migration **`0032`** (5 nullable `voice_tweets` columns) + server-computed `ranker_e` on `scrapeSave` + on-page badge + the two `extractArticle` fixes. **xhigh, RUNS ALONE.** Deps: XR.5.
  - `[ ]` **XR.8** — XR docs-sync + `$0 scripts/smoke-x-ranker.ts` (smoke 41 → 42) + the browser pass. Deps: all.

## Hot-file locks

**Nothing is held right now.** XR.4 released `src/x/playbook.ts`, `src/x/routes/playbook.ts`,
`src/shared/xRankerSignals.ts` and `scripts/calibrate-ranker.ts` on commit. **`xRankerSignals.ts` is now
CLOSED to edits for the rest of the wave** — its last unmeasured constant was the band cuts and XR.4 spent
them; XR.6/XR.7 import it and nothing more. The Wave-10 ownership map:

| File | Owner | Note |
|---|---|---|
| `src/shared/xRanker.ts` | **XR.1 (released)** | XR.2 only *imports* it. Do not re-open it to add an estimate — that is XR.2's file, and the split is the whole point. |
| `src/shared/xRankerSignals.ts` | **XR.4 (released, and CLOSED)**; XR.6/XR.7 only import | Every constant in it is now measured and stamped. `rankerBand` no longer exists — call **`rankerDraftBand`** or **`rankerMeasuredBand`** (D236). |
| `src/x/playbook.ts` + `src/x/routes/playbook.ts` | **XR.4 (released)** | |
| `extension/src/sidepanel/Composer.tsx` | **XR.5 (released)** | one owner each, no overlap. XR.5 also released `chips.ts`, `composerLogic.ts`, `CoachChip.test.ts`, `styles.css` and `tsconfig.app.json` — **`include` is finished at 14 shims; no remaining XR task adds one.** |
| `extension/src/sidepanel/Radar.tsx` | XR.6 | **Eligible now** (deps XR.5 ✓). |
| `extension/src/content.ts` + `harvester.ts` | XR.7 | **Eligible now** (deps XR.5 ✓), but it is the migration task — **runs alone**. |
| `scripts/calibrate-ranker.ts` | **XR.4 (released)** | Rerunnable, read-only, $0. Now derives BOTH the E-score rates and the band cut points. XR.8's smoke may call it; nothing else owns it. |
| migrations journal (`0032`) | **XR.7, alone** | global rule 1 |

The measurement lane is CLOSED. What remains is one serial extension lane — **XR.6, then XR.7 alone, then
XR.8** — so the concurrency ceiling for the rest of the wave is **1**. Two standing rules bind regardless:

- **Never run two migration-generating tasks in parallel sessions** (journal conflicts). Ignore any hardcoded
  migration number in plan text — *a plan quoting one is quoting the day it was written* — always
  `bun run db:generate` against the current journal, then inspect the SQL for dropped seed INSERTs
  (codemap §4). **The journal is free from `0032`.**
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
- **D225** (XR.1 — **when a Read-first path is missing, ask what that file was a copy OF**). The plan's four
  Bangermeter files did not exist at the time. Reconstructing 26 weights from memory would have been
  fabrication with a green suite; instead XR.1 went one layer upstream to `xai-org/x-algorithm`, which `curl`
  reaches unauthenticated and which Bangermeter itself ported. **Consequence the plan could not anticipate:
  that repo is Apache-2.0, not MIT**, so `xRanker.ts`'s header credits xAI with commit + retrieval date and
  credits Bangermeter truthfully as the prior art that inspired the feature. **A citation is a factual claim
  like any other — fix it to match what you actually read.** Extended by D228.
- **D226 / D227 / D229 / D233** (XR.1–XR.3, **distilled at XR.4 — four payments of one lesson, kept for the
  facts rather than the narrative**). The lesson: **trust a plan's STRUCTURE further than its literals; a
  number in a plan is a claim dated the day it was written, and where the lane's own earlier tasks have since
  MEASURED what a literal asserts, the measurement wins and the test becomes the claim that is actually
  true.** The facts still worth having. **(D226)** the plan's zeroed-head list names `dwell`, which is
  **0.05**; the fifth zeroed head is **`vqv`** — the suite asserts the zeroed set BY NAME. **(D227)**
  `offsetScore`'s true supremum for a net-negative sum is **`0.000894437`**, not the plan's `0.000894`; the
  suite DERIVES it from `X_WEIGHT_SUMS`, and pins `offsetScore(0.4) === 0.401` and
  `offsetScore(-negative_sum) === 0` exactly. **(D229)** `offsetScore` SQUASHES rather than clamps, so an
  all-negative post lands in `(0, 0.000894437)` and never on 0 — the plan's "normalizes to 0" would have
  encoded a `Math.max(x,0)` that destroys the ordering the squash exists to preserve; the assertion is an
  ORDERING claim, and `RankerDraftResult.netNegative` lets a surface say the words instead of waiting for a
  zero that cannot arrive. **(D233)** the measured retweet median is exactly **0** (66% of our feed posts have
  none) — a value, not a gap: the head goes one-sided and nothing divides by it. D234/D235/D236 are the same
  lesson's later payments.
- **D228** (XR.2 — **attribution is per-FILE and per-READ, not per-feature**). The Bangermeter tree D225
  recorded as absent was supplied hours after XR.1 shipped. The tempting move — "correct" `xRanker.ts`'s
  Apache-2.0/xAI header to the plan's mandated MIT notice — is wrong: that header is a factual claim about
  what XR.1 read, and XR.1 read X's own repository. XR.2's material (`baselineP`, `observedRates`, the
  shrinkage, the head split) has no upstream, was read at first hand, and so `xRankerSignals.ts` carries the
  MIT/Ryan Lenk notice. **Two files, two attributions, and neither is a mistake. When a source reappears, ask
  what THIS file's author actually opened, never what the project now has on disk.** Binds XR.8's docs-sync.
- **D230** (XR.2 — a borrowed CUT POINT is a borrowed number, §7.34) — **DISCHARGED at XR.4; see D236.** What
  it got right: 40/65 was off-centre on our modifier set, and neither available fix (nudge the cuts, shave the
  factors) was allowed, because both were vibes. What it got wrong, and only measurement catches it: it
  predicted `strong` would be the modal band. On 308 real own originals `strong` is 31% and **`below` is
  0.3%** — the dead end was the LOWER cut.
- **D231** (XR.2 — **a retrospective score must not re-apply a factor the measurement already contains**).
  Bangermeter runs the OON 0.75 rescore over measured counts; ours does not, for their own stated reason about
  community notes — a post's actual counts already embed whatever suppression happened, so rescoring
  double-counts it and makes two sightings incomparable on a viewer assumption. The reply WEIGHT still varies
  by mutual-follow (a question about the viewer's ranker, not the post's history) while the baseline stays
  pinned at the base weight, which is what makes a mutual scoring above it a finding. **Binds XR.6:** the E
  chip scores the target and is not rescored; any OON caveat there is about a reply's For-You eligibility
  (plan Decision 9), not about the number.
- **D232** (XR.3 — **the plan's maturity cut is unsatisfiable, and you catch that by running a borrowed filter
  against the corpus it was borrowed FROM**). XR.3 asks to drop rows within 48h of the sample's newest post.
  Measured: **zero of our 766 passive-timeline rows are 48h old at capture** (median 3.1h, max 44.6h — a Home
  Timeline shows recent posts, so the corpus *structurally* cannot hold a settled reading) and **zero of
  Bangermeter's own 141-post reference sample are either** (median 6h, max 43h, off its `ageMin` column, which
  `calibrate.js` never filters on). The cut empties the corpus it came from. It ships as a reported
  diagnostic: the reference must be sampled like the thing it scores, and rerun stability already comes from
  clocking against `captured_at`, frozen per row. **Generalize: check a borrowed filter against the SOURCE
  corpus first. A filter that removes nothing is worse than no filter — the next reader believes it fired.**
  Its second half — "K=2000 is the binding constraint on E" — was measured at XR.4 and is **false** (D237).
- **D234** (XR.3 — **the new reference broke an XR.2 test, and the break WAS the finding**). *"a 1-like/10-view
  post scores below a 100-like/1000-view post"* went red because its fixture carried 5 replies — 3.7x above the
  imported reply reference and 0.25x below the measured one — and reply carries X's published 5.0 against
  favorite's 0.5. **Fixture re-picked rather than the assertion loosened, and the old fixture kept as its own
  test of what it exposed. Generalize: a test that reddens when a constant is measured was testing the
  constant, not the claim in its name.**
- **D235** (XR.5 — **the plan put a second engine's band into the coach's colour vocabulary, and the file the
  wave itself had already written says why that is wrong**). Task XR.5's Edit list adds `RANKER_BAND_TONE` to
  `CoachChip.tsx`. Three facts postdating the plan say otherwise: `xRankerSignals.ts`'s own header refuses
  `CoachBand`'s vocabulary because sharing the words invites the two pills to be read as one number (and a
  shared colour ramp invites it harder); UI.14 is explicit that a chip vocabulary maps onto a tone in
  **`chips.ts`**, and the C pill IS a chip; and `COACH_TONE` has no neutral. So `rankerBandChip` lives in
  `chips.ts`, returns `.chip` + a `chip-*` tone, and **only `below` is coloured** (`chip-warn`) while
  `typical`/`strong` stay `chip-muted` — **still true after XR.4's re-cut, and the reason is now sharper:
  centred is not validated** (`rankerScoreEffectiveness` still has no rows). `CoachChip.test.ts` asserts the
  two vocabularies share **no** class, both directions. Second half, and it binds XR.6/XR.7: an unobservable
  input stays **absent, not `false`** (§7.11) — the Composer has no video affordance, so a `false` would be a
  measurement nobody took, and `signalsToHeadPs` drops an absent head rather than scoring it zero.
- **D236** (XR.4 — **the re-cut D230 handed over, and the measurement found a different defect than the one
  it was sent to fix**). `RANKER_BAND_CUTS` 40/65 was checked against four independent $0 samples of our own
  corpus, as below/typical/strong: C over 308 own published originals **0.3 / 68.5 / 31.2**, E over 712
  `radar_sightings` 11.7 / 88.3 / **0.0**, E over 3,567 harvested sightings 13.6 / 86.3 / **0.1**, E over the
  766-post timeline reference 11.4 / 88.4 / 0.3. **A dead band at each end, at OPPOSITE ends — a three-valued
  instrument reading two values.** D230 predicted only half of that. The defect underneath is
  structural: `rankerBand` was ONE function over TWO distributions (C q1/q3 = 56/68, E q1/q3 = 46/51), so no
  single pair can centre both — moving the cuts to fit C would have made E almost entirely `below`, which is
  worse than leaving it. Shipped: two measured pairs (`draft {typical 56, strong 68}`, `measured {typical 46,
  strong 51}`), each **the q1/q3 of the corpus its scale is applied to**, so a band means a QUARTILE POSITION
  and the RULE (not the numbers) is what the suite pins against `RANKER_BAND_CUTS_SAMPLE`; provenance
  `'measured'`; and `rankerBand` becomes `rankerDraftBand`/`rankerMeasuredBand` — **two functions, never
  `rankerBand(score, scale)`**, which is `latestOwnReplyRows`'s own no-flag rule (a wrong flag here is silent:
  61 reads `typical` on one scale and `strong` on the other). `scripts/calibrate-ranker.ts` grew the
  derivation, and re-emits both pairs exactly against a scratch DB seeded from prod. **Generalize: check a
  borrowed threshold at BOTH ends, and ask whether one threshold is quietly serving two distributions. A band
  that fires on ~0% or ~100% of a real corpus is a dead instrument that reads as a working one.**
- **D237** (XR.4 — **the standing suspicion was measured and it was wrong, which is a result and not a
  non-event**). `ENGAGEMENT_SHRINKAGE_PSEUDO_VIEWS` carried XR.3's note that K=2000 "is too strong for this
  corpus" and was "the binding constraint on E". Two measurements say otherwise: beta-binomial
  method-of-moments over the timeline corpus puts K near **1066** on `favorite` and returns **negative**
  between-post variance on `reply` and `retweet` (their whole observed spread is binomial noise off small
  view counts — only 2.4% of `favorite`'s variance is between-post), and at K=1066 only **0.2%** of sightings
  clear the old cut of 65, at K=500 only 1.9%. **Lowering K would amplify noise, and could not have fixed the
  dead band anyway — that was the cut (D236).** K stays at 2000 on evidence rather than on inertia, and the
  constant's comment now carries the numbers. **Generalize: when a recorded suspicion names a constant, the
  cheap first move is to compute what the corpus says that constant should be — the answer may close the
  question instead of licensing the change.**
- **D238** (XR.4 — **the falsification cell is correct and its population is EMPTY, and those are two separate
  facts**). The plan's population is own harvested originals (`harvest_rows mode='posts'`, `handle =
  selfHandle`). On prod that is **zero rows**: `13_narcissus` has never run a `posts`-mode harvest on its own
  profile, and the 2,537 tweets under that mode are 19 OTHER people's profiles — this file's earlier "~2,434
  tweets on prod" hint was that count misread. Widening to `metrics_snapshots` is forbidden (Decision 6, and
  it carries no reply/repost counts) and a proxy would be invented data, so the cell ships over the right
  population and **reports the empty reading**: `totalPosted: 0` with every spread `null` is a correct answer
  to "does the score predict our views", and the corpus is one own-profile harvest away. Proven correct
  against a scratch DB by pointing `selfHandle` at a real 481-post profile harvest — **C spread 1.71x** (q4
  3,256 median views vs q1 1,905, both gated) and **E spread 0.50x**, E backwards exactly as the cell's own
  header says it must be, because views is E's denominator. **Generalize: an instrument reading zero is not
  the same as a broken one, and the way to tell them apart is to run it against a corpus that is not yours.**


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

- **XR.1 — source transcription from off-machine: plain `curl` + `grep` from Bash, never `WebFetch`** (it summarizes, and silently reformatted a Rust macro into a tidy table). Full method + the unauthenticated GitHub endpoints that work in `STATE-ARCHIVE.md`, grep `reachable from Bash`.
- **XR.1 — the XR upstream map, kept because re-verifying against a newer X commit is a real future task.**
  `xai-org/x-algorithm` @ `7ba77684` (main, 2026-09-01), Apache-2.0. `home-mixer/params/param.rs` — every
  `param!(Name, f64, "rust_home_mixer_…", default)`, weights at ~285–480. `params/config.rs:40` —
  `NEGATIVE_SCORES_OFFSET = 0.001`. `scorers/ranking_scorer.rs` — `ScoringWeights::from_params` (~105–130),
  `compute_weighted_parts` (~400–460, **the 26-entry `terms` array IS the claim that there are 26 heads**),
  `offset_score` (~472), `reply_weight_for` (~186), `diversity_multiplier` (~562), `oon_applies` (~679).
  Confirmed gate defaults: `EnableMultiplicativePostUnexplored` **false**,
  `EnableOonRescoreForInNetworkRepliesRetweets` **true**, `MinVideoDurationMs` **10_000**, `TopicOonWeightFactor`
  0.5 (unported).
- **XR.1 — `X_WEIGHT_SUMS` is COMPUTED from the members list, never written down.** `positive` is
  `43.339999999999996`, not `43.34`; summing left-to-right in source order reproduces the Rust f64 exactly,
  whereas a hand-typed literal would drift the moment a weight changes and would silently disagree with the
  Rust in the last bits. Assert sums with `toBeCloseTo(…, 10)`, never `toBe`.
- **XR.1 — a `const` with a numeric literal breaks a faithfully-ported `!= 0` guard.**
  `BIDIRECTIONAL_FOLLOW_REPLY_BOOST` had to be annotated `: number` (not left to infer the literal type `15`),
  or `tsc` rejects the source's own `boost !== 0` check as *"types '15' and '0' have no overlap"*. Any future
  port of a feature-switch guard hits this; the annotation is the fix, and the reason belongs in a comment
  (it is a switch X can turn off, not a constant a compiler should fold away).

- **XR.2 — the precedent for a `src/shared/` module importing a sibling is `postCooldown.ts`, not `cannon.ts`.**
  The plan cites `cannon.ts`, which is a **type-only** import (`import type { TweetSignals }`) and therefore
  proves nothing about runtime. `postCooldown.ts` value-imports `POST_FORMATS, classifyFormat` from
  `./postFormat.ts` and is the actual precedent `xRankerSignals.ts` follows (it value-imports from
  `xRanker.ts`, `postCoach.ts` and `postFormat.ts`). Both stay IIFE-legal because §7.26's rule is that the
  bundle has no *external* runtime import — siblings inline together. **XR.7 must confirm all four inline**,
  since it is the task that actually puts them in the content script.
- **XR.2 — `postCoach` has a check id `profile_click` AND `xRanker` has a head named `profile_click`, and
  they are unrelated.** The head is weighted **0.0**, so wiring the check to the same-named head would be a
  silent no-op that looks correct in review. The `own_proof` modifier maps the check onto **`follow_author`
  (4.0)** on purpose, and says so in its `why`. Check the head's weight before trusting a name match.
- **XR.2 — a signal-free draft is a hard fixture to write, and that is itself the calibration finding.**
  Twelve modifiers fire on a `postCoach` check PASSING, so almost any competent sentence trips three or more.
  The suite's anchor (`SIGNAL_FREE`) is deliberately flat: no first-person, no digit, no contrast word,
  nothing quotable, one line, ≤30 words, classified `one_liner`. A later task adding a modifier keyed on a
  common pass **will break that test**, and the right response is to re-pick the fixture, not to loosen the
  assertion — the exact-50 anchor is what proves `score` is measured against the signal-free baseline.

- **XR.3 — the production corpus is NOT on this machine, and `POST /x/data/query` is how you get it.** Local
  `stratus.db` has **zero** `harvest_rows`; prod has 2,708 `posts` / 2,625 `replies` / 879 `timeline`. That
  read-only SQL route (`src/x/routes/data.ts`, the `runSelect` `x_query` calls) answers over HTTP with the
  `.env` bearer, so `curl … -o dump.json` costs no context, and `group_concat(line, char(10))` returns all 879
  rows past the 500-row cap in ONE cell. Seed a scratchpad DB (`SQLITE_PATH=<scratch> bun run
  scripts/migrate.ts`, then insert — `harvest_rows.run_id` is a notNull FK, so write a `harvest_runs` row
  first) and run the REAL script against it, so the constants come from the deliverable rather than from a
  second implementation in SQL. **Copy this for any future calibration task.**
- **XR.3 — our feed is not a general X feed, and every number in this lane inherits that.** The passive
  Home-Timeline corpus is small founder/engagement-bait accounts: median **297** views against Bangermeter's
  **6,600**, median reply rate **0.0198** against their 0.00135 (14.6x), 66% of posts with zero reposts. Right
  reference for scoring OUR sightings, **not** a population constant for X. The For You / Following split is
  **not recorded** by the harvester and theirs ran ~2x apart, so ours is a blend of unknown proportions — say
  so wherever the number is quoted.
- **XR.3 — the script is $0 and safe to rerun; on a dev box it prints `0 tweets` and exits cleanly.** That is
  the honest empty path, not a failure.
- **XR.4 — the scratch-DB recipe, extended, and it is now the way to test a PLAYBOOK route without prod.**
  Dump prod with `POST /x/data/query` (`json_group_array(json_object(...))` in ONE cell beats the 500-row cap),
  `SQLITE_PATH=<scratch> bun run scripts/migrate.ts`, insert with raw `bun:sqlite` — **`posts_published` has
  no `id` column** (`tweet_id` is the PK) and `source` is notNull, and `harvest_rows.run_id` is a notNull FK so
  the runs go first. Then run the REAL deliverable: `scripts/calibrate-ranker.ts` re-emitted both band pairs
  exactly, and the composed app (`const { app } = await import('src/app.ts')` — **not** a default export) served
  `/x/playbook` over 481 real harvested posts by pointing `x.identity.selfHandle` at a handle that is actually
  in the table. **Pointing the self-handle setting at someone else's harvested profile is the cheapest way to
  exercise an own-corpus cell that has no own corpus yet** — it proves the SQL, the gate and the wiring without
  fabricating a row.
- **XR.4 — the C distribution is robust to the two things you would expect to move it**, which is why the band
  cuts are safe to freeze: over 308 own published originals the quartiles come out 56/61/68 with the active
  niche lexicon, without it, and with or without the recorded `has_media` flag. The calibration deliberately
  runs WITHOUT the lexicon — a constant that changes when the niche is re-pinned is not a constant.

- **XR.5 — the extension `include` array is FINISHED at 14 shims, and the count that matters is still not the
  array length** (15 entries, 14 shims — `src/**/*` is the first). No remaining XR task adds one: XR.6 and
  XR.7 both consume `extension/src/xRankerSignals.ts`, which now exists. Inline proof is the OU.5 pattern —
  `grep -c 'rust_home_mixer_favorite_weight' extension/dist/sidepanel.js` is **1** today, and **XR.7's
  counterpart is that same string in `dist/content.js`**, `0` until XR.7 makes it 1.
- **XR.5 — where the C pill renders, and the one thing that must not be re-derived.** Third child of
  `.coach-head` in `Composer.tsx`, inside the existing `showCoach` gate, so it never faces an empty draft and
  there is no second "verdict box" to clear. It reads **`coachInput`** (the debounced string, segment 1 in
  thread mode) and the **same `coach` object** the score pill renders, passed as
  `scoreDraftRanker(text, feats, { coach })`. Letting the ranker re-run the coach would be the bug: two
  evaluations of one draft, disagreeing at the moment the user reads them side by side.
- **XR.5 — the Composer's only honest image signal is `original.mediaNote`**, and there is no video one at
  all. No attach-image affordance exists (no API media upload — out of scope), so a Studio visual pinned to
  the row is the whole evidence a post ships with an image; it is `null` on every unsaved draft, which is
  correct — an image that does not exist yet is not a feature of the draft (D235's §7.11 half).

## Planning-error log

Corrections to MASTERPLAN.md itself (wrong dep, wrong order discovered live).

- **2026-07-16-niche.md Task 3 done-when** — the "`Pitești` hits nothing" grep contradicts the same task's bit-for-bit equivalence requirement (post prompt §6/§9/§0 carry builder biography outside the §1/§5 extraction scope; no niche field exists to hold them). Resolved at N.3 in favor of equivalence; see D28b for the full resolution + what N.9 must scope differently. Source plans are never edited — this entry is the correction.
- **2026-07-17-ai-layer.md — no task owns the post drafter's askLLM migration.** Task 5's edit list names replies/pillars/playbook/voiceExtract; Task 6 only flips drafter's MOUNT gate; Task 7 adds a sibling route. Yet the plan's Why-section + Done-when #1 spirit require every draft surface to honor the provider setting, and the Task-6 gate flip would 502 `/posts/draft` on OpenRouter-only setups. Resolved at AI.5 by migrating `drafter.ts` there (D47b) — the call-site-migration task was the right home.