# Masterplan execution state

> Dynamic memory for `/masterplan`. Updated after EVERY task, in the task's own commit.
> Plan: `plans/MASTERPLAN.md` (static — order, reasoning levels, waves, D1–D10 + the per-wave seed blocks, whose numbering COLLIDES with this file's from Wave 9 on — see the collision note in the register).
> Codemap: `.claude/skills/plan-feature/references/codemap.md` (updated per task too).
> History: `.claude/skills/masterplan/STATE-ARCHIVE.md` (frozen, grep-only — closed-lane deviations, gotchas, priors, ledger rows).
> Debt: `.claude/skills/masterplan/VERIFY-DEBT.md` (**unpaid**, not history — browser-verify + CA.2. Read it when you have Chrome open; skip it otherwise).

## WAVE 10 IS OPEN — XR, the X ranker port. **160 / 165.**

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

**The spine is the doctrine, not the UI** (plan Decision 3, §7.33/§7.34): XR.3 recalibrated the E baseline off
our own harvest and **XR.4 ships the quartile cell. Do not re-order it behind XR.5–XR.7** because the visible
half is more satisfying to ship — and XR.4 now owns two re-cuts, not one (D230 + D232's K finding).


**Wave 9 (OU — Outliers) closed at OU.8 on 2026-08-25**, taking 149/149 to 157. Its whole register, gotchas,
ledger rows, lock table and narration are in `STATE-ARCHIVE.md` under *"Archived at OU.8"* — grep by task id,
D-number or filename. One line survives because it binds the next money decision: **that wave was $0 by
decision rather than by luck** (X API v2 has no `min_faves` operator at any tier), **and Wave 10 is $0 on the
same footing**. Invariant #8's "decide out loud" cuts both ways.

**Expect ad-hoc commits between lanes, and expect them not to be here.** Since RA.8, five lanes shipped
outside the skill and are deliberately absent from the ledger — **RQ.1–RQ.5** (radar live queue, migration
`0030`), **SW.1**, **OFF-PILLAR/REMIX** (`813dafc`/`3868981`), `b92d783` (calendar tray draft-delete). **The
codemap §11 log and its header stamps are the record for all of them**; grep it by lane code, not this file.
A HEAD that doesn't name a masterplan task is normal now.

**A new lane starts by writing a plan (`/plan-feature`), registering it in `plans/MASTERPLAN.md`, and
re-opening the ledger below in that lane's FIRST commit.** RA.1, OU.2 and **XR.1** are the worked examples,
and all three got one thing right worth copying: **recount** the `current state` numbers off the running code
instead of carrying the line forward. OU.2 found two stale; OU.8 found `docs/README.md` wrong; **XR.1 found
the suite line 96 tests and 2 files behind**, because five ad-hoc lanes had shipped since the last recount.
Cross-checking the codemap header stamps against this file is the cheap version of the recount.

**What is still owed, and it is not a task.** `VERIFY-DEBT.md` holds **thirty** unpaid items — browser checks
that shipped with automated gates only, plus CA.2 step 2. The newest is `0y` (OU's ⊕ on a search page);
`0n(b)` and `0l` are the only two that spend (~$0.003 and ~$0.010). None needs a plan or a session of its own:
fold them into whichever session next has Chrome open on the panel, and **delete each entry as you pay it.**
That file is deliberately not in the archive — a debt filed among history stops being owed. **The ceiling on
most of them is structural** (a page tab cannot read another extension's `chrome.storage.local`, and the
service worker has no reachable console), **but check WHICH half a check needs before filing it** — see the
OU.1/OU.8 gotcha: X's own pages are payable from here, injected UI on them is not.

**Size discipline (added 2026-07-23 at 339 KB; paid fifteen times since — read this before a new wave
re-grows the file).** STATE.md must stay loadable in a **single `Read`**, and the limit that bites is the
tool's **token** cap (~25k), not the 256 KB byte cap. **The budget is measured: at 61.7 KB a single `Read`
came back TRUNCATED at 25,023 tokens, so the ratio is ≈405 tokens/KB and the ceiling is ≈61.5 KB. Aim at
60 KB and leave the last 1.5 KB unspent.** Measure BYTES with `wc -c`, not `.length` — this file is full of
multibyte `—`/`≥`/`✓` and a character count reads ~1.5 KB under the truth. **Five lessons, each of which cost
real sessions:** (1) *the breach is never one big entry, it is six good ones that each looked affordable* —
Wave 6 went 48 KB → 156 KB in fifteen tasks; (2) *a closing pass archives the lane in front of it and misses
the weight behind it* — UI.17 left Wave 5's ledger rows and every session until GT.9 paid for them, so **also
ask what stopped binding two waves ago**; (3) *"it still binds an open task" is a reason to DISTIL, not to
keep 19 KB*; (4) **an ORDINARY task breaches it too, so `wc -c` between entries, not only before the commit**;
(5) **when a lane CLOSES, its hot-file lock row and its pointer lines are weight, not state.** Never "fix" a
breach by deleting something an open task needs; if a pass slips, pay it as a standalone housekeeping commit
(the `55c6d19`/`c9c8ade` precedent). **XR.1 alone added ~14 KB** (a wave re-opening is the most expensive entry
type there is) and **XR.3 arrived at 60.4 KB with nothing left to spend and still landed at 60.1** — it paid
for three D-entries and three gotchas by distilling the standing D-entries (D113/D171/D184/D195), collapsing
D222 into the gotcha that already stated it, compressing four over-long Wave-3/Wave-9 gotchas, and moving the
`current state` multi-file-move step lists to the archive (which already held them — checked, not assumed).
**That is the pattern for XR.4–XR.8: the file is full, so every addition is now a TRADE.** Cheapest reductions
left: this paragraph, and the XR.1/XR.2 gotchas once the wave closes.

- **last-commit:** **identity is the SUBJECT LINE — no sha is recorded (D97).** HEAD should read `feat(ranker): calibrate the E-score baseline against our own harvest corpus (XR.3)`, parent `1156ff1` (XR.2). **Step 0 is one command:** `git log -1 --format='%h %s'`. Reconcile against this line, not against the whole log.
- **current state of the repo (as of XR.1, 2026-09-02 — RECOUNTED off the running code, not carried forward; the previous line was stamped at OU.8 and five ad-hoc lanes had shipped past it):** suite **2736** across **136** files (2695/135 at XR.1 → 2731/136 at XR.2 → **+5 tests, no new file, at XR.3**); tables **44**; migrations through **`0031_sharp_screwball`** (32 journal entries, `0000`–`0031`) — **the journal is FREE from `0032`, which XR.7 owns and must still confirm off the journal rather than off this line**; registry **16 groups / 69 knobs, 33 mirrored** and **17 prompt keys** (recounted by importing `SETTINGS_REGISTRY` and `PROMPT_KEYS`, not by grepping); MCP **28 tools** (`src/mcp.test.ts:122` asserts it); smoke scripts **41** (a `calibrate-*` script is NOT one — XR.8 still owns 42); extension `tsconfig.app.json` `include` **13 entries = 12 out-of-tree shims** (the first entry is the extension's own `src/**/*` — **count the shims, not the array**, and XR.5 takes them to 14); panel tabs **15**; whole-repo lint **0 errors**. The four multi-file moves a new task will hit — **none of them is owed by any remaining XR task except the migration**, so the full step lists live in `STATE-ARCHIVE.md` (grep `registry.ts`, `PROMPT_KEYS`, `mcp.test.ts`) and only the sizes and the silent-failure modes stay here. **A mirrored settings knob is SEVEN edits** (`registry.ts`, `registry.test.ts` **twice**, `docs/settings-tab.md`'s three count strings **plus** its group-table row, and extension-side `ServerConfig`/`SERVER_DEFAULTS`/`readServerConfig`) — **the server half alone ships a knob that silently does nothing**; a `scope:'server'` group is three of the seven and no extension build. **A registry prompt key is FOUR** (the default must be exported from a **pure** module or the imports cycle). **An MCP tool is SIX doc strings plus three asserted numbers** (`src/mcp.test.ts`'s exact 28, `scripts/smoke-mcp.ts`'s name list, and five places in `docs/s2-mcp-server.md` + codemap §3.3/§6). **A migration** never runs in two parallel sessions, ignores any number quoted in plan text, and is inspected for dropped seed INSERTs by `git status --porcelain src/db/migrations/` (**not `git diff --stat`** — the new `.sql` and its snapshot are UNTRACKED, so a diff shows only the `_journal.json` append and reads like the SQL never landed) plus a fresh `:memory:` boot counting `content_pillars` (3) — never by grepping for `INSERT INTO`, which `0000`'s `INSERT OR IGNORE` spellings make return 0.
- **next-up:** still **two lanes that share no file** — run either, or both in parallel sessions.
  **XR.4** (`buildRankerScoreEffectiveness` + `latestOwnPostRows` + one `/x/playbook` field; **high**; deps XR.3 ✓) is the doctrine half and must not be deferred behind the pills (plan Decision 3). It is the ONLY task that may re-cut a borrowed number, and it now owns **two**: `RANKER_BAND_CUTS` 40/65 (D230) and the K=2000 shrinkage finding (D232) — both are recorded with the evidence, neither moves by vibes. Its population is own harvested ORIGINALS (`harvest_rows mode='posts'`, ~2,434 tweets on prod), never `metrics_snapshots` (frozen since 2026-08-12, and it carries no reply/repost counts). **Reuse `buildCoachScoreEffectiveness`'s `OutcomeCell`/`cellOf`/`median`/`ratio`/`DEFAULT_MIN_CELL_N`; add none of it.**
  **XR.5** (two shims, `include` 12 → **14**, + the Composer's C pill; deps XR.2 ✓, **not** XR.4) is the visible half. It imports and never edits `xRankerSignals.ts`. What the pill reads: `score` (0-100, already rounded), `band` (`below`/`typical`/`strong` — read off the rounded score, so pill and word cannot disagree), `modifiers` (each with `label`/`direction`/`why`), `netNegative`, `format`, `coachScore`, and `RANKER_DISCLAIMER` / `RANKER_BAND_LABEL`. **Three things XR.5 must not get wrong:** a net-negative draft reads ~7, never 0 — render the WORD from `netNegative` (D229); `strong` is the modal band today, so the copy may not present it as a verdict (D230); and the C pill may not reuse `CoachBand`'s vocabulary or colour words (§7.23a, plan Decision 2).
  Standing gate reminders: `bun run test` (bare `bun test` targets the file DB and `inspect.test.ts` fails 2/2); a pure `src/shared/` task owes **no** extension build and moves **no** docs count (OU.1, paid three times now) — **XR.5 does owe the build**; biome forbids non-null assertions, a `let` assigned once and a backtick string with no interpolation, sorts import specifiers **case-sensitively** with `type` members ahead of value members of the same stem, and will reformat a >100-col call — run `bunx biome check --fix <files>` before the gate.

## Ledger

Status: `[ ]` todo · `[~]` in progress (lane claimed) · `[x]` done (sha + date) · `[s]` skipped (reason in deviations).

**Waves 0–9 are CLOSED — 157/157; Wave 10 is OPEN at 3/8, so the masterplan stands at 160/165.** Per-task entries (shas, parents, dates, notes) for the closed waves live in
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

- **Wave 10 — XR: the X ranker port (3/8)**, plan `plans/2026-09-02-x-ranker-port.md`, registered by `52d0bd8`, ledger re-opened by **XR.1**. **$0 lane by construction** — no `xFetch`, no `askLLM`, no image call on any path; every read is over rows already stored. Owns migration **`0032`** at XR.7 (the journal is free from it today). Order is the MASTERPLAN table's, which is NOT numeric — `XR.5` runs before `XR.4`.
  - `[x]` **XR.1** — `src/shared/xRanker.ts`: 26 published weights + `ScoringWeights::new` sums + `offsetScore`/`scoreHeads`/`replyWeightFor`/`oonApplies`/`diversityMultiplier`/`normalizeScore`. 2 files, both new, **no consumer yet**. `feat(ranker): port X's published For You weights + ranking_scorer arithmetic (XR.1)`, parent `52d0bd8`, 2026-09-02. Suite 2627 → **2695** / 134 → **135**. Deps: none.
  - `[x]` **XR.2** — `src/shared/xRankerSignals.ts`: `X_BASELINE_P` (20 priors) + `X_OBSERVED_RATES` (placeholder) + **`X_MODIFIERS` (23)** + `signalsToHeadPs` / `scoreDraftRanker` (C) / `scoreMeasured` (E). 2 files, both new, **still no consumer**. `feat(ranker): map postCoach/postFormat signals onto ranker heads (XR.2)`, parent `88af95b`, 2026-09-02. Suite 2695 → **2731** / 135 → **136**. Deps: XR.1 ✓.
  - `[x]` **XR.3** — `scripts/calibrate-ranker.ts` (NEW, **not a smoke**) + measured `X_OBSERVED_RATES` — favorite `0.029412`, reply `0.019774`, retweet **`0`**, n=766 over `harvest_rows mode='timeline'` 2026-07-24..2026-08-17. **The plan's 48h maturity cut was falsified and ships as a diagnostic (D232); retweet 0 is the honest median (D233); a broken XR.2 test was the finding (D234).** `feat(ranker): calibrate the E-score baseline against our own harvest corpus (XR.3)`, parent `1156ff1`, 2026-09-02. Suite 2731 → **2736** / 136 unmoved. Deps: XR.2 ✓.
  - `[ ]` **XR.5** — the two shims (`include` 12 → **14**) + the Composer's **C** pill. Deps: **XR.2 ✓, not XR.4.** Eligible now; the C pill reads `score`/`band`/`modifiers`/`netNegative`/`RANKER_DISCLAIMER` and must render `netNegative` as a WORD, not wait for a 0 (D229).
  - `[ ]` **XR.4** — `buildRankerScoreEffectiveness` + `latestOwnPostRows` + `rankerScoreEffectiveness` on `/x/playbook`. Deps: XR.3 ✓. **Eligible now**, and it owns BOTH re-cuts (D230, D232).
  - `[ ]` **XR.6** — **E** chip on Radar sightings (scores the *target*, never the drafted reply). Deps: XR.5.
  - `[ ]` **XR.7** — migration **`0032`** (5 nullable `voice_tweets` columns) + server-computed `ranker_e` on `scrapeSave` + on-page badge + the two `extractArticle` fixes. **xhigh, RUNS ALONE.** Deps: XR.5.
  - `[ ]` **XR.8** — XR docs-sync + `$0 scripts/smoke-x-ranker.ts` (smoke 41 → 42) + the browser pass. Deps: all.

## Hot-file locks

**Nothing is held right now** — XR.3 released `src/shared/xRankerSignals.ts` on commit, and **XR.4
(measurement) and XR.5 (extension) are both eligible and share no file**, so two sessions can run. The
Wave-10 ownership map, which is what actually serializes this lane:

| File | Owner | Note |
|---|---|---|
| `src/shared/xRanker.ts` | **XR.1 (released)** | XR.2 only *imports* it. Do not re-open it to add an estimate — that is XR.2's file, and the split is the whole point. |
| `src/shared/xRankerSignals.ts` | **XR.3 (released)**; XR.5/XR.6/XR.7 only import | **The wave's hot file on the server side, and it is FREE.** XR.4 is the only remaining task allowed to edit it, for `RANKER_BAND_CUTS` (D230) — and it may not touch `X_OBSERVED_RATES`, which is now measured. |
| `extension/src/sidepanel/Composer.tsx` | XR.5 | one owner each, no overlap |
| `extension/src/sidepanel/Radar.tsx` | XR.6 | |
| `extension/src/content.ts` + `harvester.ts` | XR.7 | |
| `src/x/playbook.ts` + `src/x/routes/playbook.ts` | XR.4 | |
| `scripts/calibrate-ranker.ts` | **XR.3 (released)** | Rerunnable and read-only. XR.8's smoke may call it; nothing else owns it. |
| migrations journal (`0032`) | **XR.7, alone** | global rule 1 |

Two lanes that share no file: **measurement** (XR.4) ∥ **extension** (XR.5 → XR.6, then XR.7). Ceiling is 2
concurrent sessions. Two standing rules bind regardless:

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
- **D223** (OU.8 — **D195(b) applied twice more, and it found one right and one wrong**). RA.8's rule is that
  a "not mine to fix" deferral is a bet that someone comes after you, and the task closing the lane loses that
  bet. OU.8 re-read the four `docs/settings-tab.md` count strings this file had flagged as rot-prone and found
  them **correct** (69/16/33/17, recounted off `SETTINGS_REGISTRY` — confirming, not assuming, is the whole
  discipline). It then found two the wave had never looked at: **`docs/README.md` still said "the 63 knobs"**,
  and **codemap §3.1's `src/db/migrations/` row still read `0000`–`0028`, "the next migration owns `0029`"** —
  four migrations stale, with §4's deltas carrying the truth the whole time. Both fixed here. **Generalize: a
  count string in a file NOBODY on the lane opened is the one that rots — check the index pages
  (`docs/README.md`, codemap §3) as well as the ones the feature touched.**
- **D224** (OU.8 — **the smoke asserts two things the plan's list did not ask for, and states why**). The task
  block's coverage list is nine items long and does not name (a) `POST /searches/compile` or (b) the list
  item vs detail read identity. Both were added. **(a)** is the only route in the feature with *no* production
  caller at all — the panel compiles locally through the shim (OU.5), so `compile` exists purely for
  smoke/CLI callers, and a route whose only caller is a test suite that mounts it bare has never been proven
  to answer over a composed request. It also carries a shape decision worth pinning (D208b: **200 with
  `problems` and `url: null`**, because it is a preview and a 400 would tell the form nothing it does not
  already have). **(b)** is D208(a) — the claim that makes OU.5's Load path one function instead of two — and
  it costs one `JSON.stringify` comparison. **Generalize: a plan's Tests list is a floor. The two cheapest
  additions are usually the route nothing in production calls and the "these two shapes are identical"
  promise some other task was allowed to rely on.**
- **D225** (XR.1 — **the plan's oracle was gone, so the task went one layer UPSTREAM instead of reconstructing
  it, and the attribution changed to match what was actually read**). Task XR.1's Read-first list names four
  files under `/Users/narcisbrindusescu/Downloads/bangermeter-main/` and **none of them exist** (`find ~ -iname
  '*bangermeter*'` returns nothing; the repo mentions it only in the two plan files). The plan's own xhigh
  rationale says why that matters more here than usual: *the oracle is off-machine, and a test written by the
  session that wrote the module proves self-consistency, not fidelity.* Three responses were available —
  reconstruct the 26 weights from memory (fabrication with a green suite, the precise failure §7.33 exists to
  prevent), stop and ask, or **find a better oracle**. The third was available and cheap: X publishes the
  source Bangermeter itself ported, `curl` reaches it from Bash unauthenticated, and it is one layer *closer*
  than the plan asked for. Every constant and every branch in `xRanker.ts` was read off `xai-org/x-algorithm`
  @ `7ba77684` — `home-mixer/params/param.rs` (the 26 `param!` defaults), `params/config.rs:40`
  (`NEGATIVE_SCORES_OFFSET`), `scorers/ranking_scorer.rs` (`ScoringWeights::from_params`,
  `compute_weighted_parts`, `offset_score`, `reply_weight_for`, the `oon_applies` closure,
  `diversity_multiplier`). **The consequence the plan could not have anticipated: that repo is Apache-2.0, not
  MIT.** The plan mandates a Bangermeter MIT notice in the header; shipping one would have credited a port of
  a file nobody on this task read — a false statement about provenance in the one file whose entire value is
  provenance. The header therefore carries the **Apache-2.0 attribution to xAI** with the exact commit and
  retrieval date, **plus** a Bangermeter credit that says truthfully what it is: the prior art that inspired
  the feature, not the source of these numbers. **Generalize: when a Read-first path is missing, the question
  is not "how do I proceed without it" but "what was that file a copy OF" — and if the answer is reachable,
  the plan's own fidelity argument obliges you to go there. Then fix the attribution to match what you read,
  because a citation is a factual claim like any other.** **Superseded in part by D228: the tree came back the same day.**
- **D226** (XR.1 — **the plan's list of the five zeroed heads names the wrong head, and only reading the
  source catches it**). Task XR.1 says to ship *"the five explicitly-zeroed heads (`profile_click`, `dwell`,
  `quoted_vqv`, `cont_click_dwell_time`, `cont_active_secs_5m_residual_norm`)"*. **`dwell` is `0.05`, not
  zero** (`rust_home_mixer_dwell_weight`); the fifth zeroed head is **`vqv`** (`rust_home_mixer_vqv_weight`,
  0.0, additionally gated by `MinVideoDurationMs`). The likely origin is that `BidirectionalFollowDwellWeight
  **Boost**` IS 0.0 — a neighbouring parameter with `dwell` in its name. Shipped as the source has it, with a
  test asserting the zeroed set by name so the pair can never drift again. **This is the D195(b) rule in a new
  place: a number in a plan is a claim about the world dated the day it was written, and the plan is not the
  oracle even when it is confidently specific.**
- **D227** (XR.1 — **a stated bound that is very slightly wrong is worse than no bound, because a test will
  encode it**). The plan's done-when asks that `offsetScore` squash any net-negative sum into `[0, 0.000894)`.
  The true supremum is `negative_sum / total_sum × NEGATIVE_SCORES_OFFSET` = `367.22 / 410.56 × 0.001` =
  **`0.000894437`**, so a real score can legally sit *above* the plan's ceiling and a literal transcription of
  the done-when would have shipped a flaky assertion. The suite derives the ceiling from `X_WEIGHT_SUMS`
  instead of hardcoding it (so a future weight edit moves the bound with the weights) and pins the derived
  value at `0.000894437`. Two exact facts worth having beside it, both asserted: `offsetScore(0.4) === 0.401`
  **exactly** in f64, and `offsetScore(-negative_sum) === 0` **exactly** — the deepest legal negative lands on
  zero, and anything past it goes under, which is what "squash, never clamp" buys.
- **D228** (XR.2 — **the missing oracle came back mid-lane, and the right response was a SECOND attribution,
  not an amended one**). The Bangermeter tree D225 recorded as absent was supplied by the user hours after
  XR.1 shipped. Tempting move: "correct" `xRanker.ts`'s Apache-2.0/xAI header to the MIT notice the plan
  originally mandated. Wrong — that header is a factual claim about what XR.1 read, and XR.1 read X's own
  repository. What actually changed is XR.2's material: `baselineP`, `observedRates`, the empirical-Bayes
  shrinkage, `engagementScore`, `vqvEligible` and the always-on/enable-only head split have **no upstream to
  go to**, so they were read at first hand and `xRankerSignals.ts` carries the MIT/Ryan Lenk notice with the
  permission paragraph inline. **Generalize: attribution is per-FILE and per-READ, not per-feature. When a
  source reappears, the question is "what did THIS file's author actually open", never "what does the project
  now have on disk".**
- **D229** (XR.2 — **the plan's last test asserts something the ported arithmetic cannot do, and writing it
  would have encoded a clamp we deliberately did not build**). Task XR.2's tests ask that an all-negative post
  "goes net-negative and **normalizes to `0`**". It cannot: `offsetScore` SQUASHES rather than clamps
  (`xRanker.ts` trap 3), so the deepest legal negative lands in `(0, 0.000894437)` — above zero — and both
  normalizers map that to a small positive number (~7 on ours, ~14 on Bangermeter's sqrt scale). A literal
  transcription would have shipped either a permanently red test or, worse, a `Math.max(x,0)` added to make it
  pass, which throws away the ordering the squash exists to preserve. The suite asserts the claim that is
  actually true and actually useful — `raw < offsetScore(0)`, i.e. **below every positive post**, plus two
  net-negatives keeping their order — and `RankerDraftResult` grows a **`netNegative` flag** so XR.5's pill can
  say the words instead of waiting for a zero. **Generalize: when a plan's assertion contradicts the module's
  own documented trap, the trap wins and the test becomes an ORDERING claim.** (D226/D227's rule, third
  payment: trust a plan's structure further than its literals.)
- **D230** (XR.2 — **a borrowed cut point is a borrowed number, and §7.34 applies to it too**). Bangermeter's
  40/65 `scoreLevel` cuts were kept as the plan says — and they are **measurably off-centre on our modifier
  set**. 50 is where a draft with ZERO modifiers lands, but 18 of our 23 modifiers key on `postCoach` checks
  and twelve fire on a **pass**, so an ordinary competent post trips three to seven of them and reads 66–71:
  `strong` is the modal band, not the exceptional one. Theirs behaves because their table is mostly penalties
  and rare enables. Both available fixes were vibes recalibrations (nudge the cuts, or shave the factors until
  the distribution looks nice), which CLAUDE.md forbids. Shipped as-is with
  `RANKER_BAND_CUTS_PROVENANCE = 'imported-unvalidated'` + a TODO naming **XR.4**, exactly as
  `X_OBSERVED_RATES` is marked, plus a fixture pinning today's distribution so the re-cut is a visible
  decision. **XR.5 must not present the band as a verdict; XR.4 owns the re-cut at n>=20.**
- **D231** (XR.2 — **a retrospective score must not re-apply a factor the measurement already contains**).
  Bangermeter's `engagementScore` runs the OON 0.75 rescore over measured counts; ours does not, for their own
  stated reason — they exclude the community-note factor because "a post's actual counts already embed
  whatever suppression occurred", which is true of OON identically. Rescoring would double-count it and make
  two sightings incomparable on a viewer assumption. The reply WEIGHT still varies by mutual-follow (a question
  about the viewer's ranker, not the post's history) while the baseline stays pinned at the base weight, which
  is what makes a mutual scoring above it a finding. **Binds XR.6:** the E chip scores the target and is not
  rescored; any OON caveat there is about a reply's For-You eligibility (plan Decision 9), not the number.

- **D232** (XR.3 — **the plan's maturity cut is unsatisfiable, and you catch that by running a borrowed filter
  against the corpus it was borrowed FROM**). XR.3 asks to drop rows within 48h of the sample's newest post
  ("a young post reads ~1.4x high"). Measured: **zero of our 766 passive-timeline rows are 48h old at capture**
  (median 3.1h, max 44.6h — a Home Timeline shows recent posts, so the corpus *structurally* cannot hold a
  settled reading) and **zero of Bangermeter's own 141-post reference sample are either** (median 6h, max 43h,
  off its `ageMin` column, which `calibrate.js` never filters on). The cut empties the corpus it came from — it
  is the plan author's addition, not the ported method. Clocked the plan's way it is a *collection-recency*
  filter and moves the medians <8%. Ships as a **reported diagnostic**: the reference must be sampled like the
  thing it scores (every post E scores is a feed-time DOM reading too), a settled-only reference would read
  every fresh sighting as above-baseline, and rerun stability already comes from clocking against `captured_at`,
  frozen per row. **Generalize: check a borrowed filter against the SOURCE corpus first. A filter that removes
  nothing is worse than no filter — the next reader believes it fired.**
- **D233** (XR.3 — **the measured retweet median is exactly 0, and that is a value, not a gap**). 66% of our
  feed posts have no reposts, so zero IS the per-post median. Shipped as `0`: the head goes one-sided
  (at-reference with none, above it with any), which is the honest shape, and nothing divides by it — it is a
  shrinkage prior and a baseline term, never a denominator. **Diverges from the plan's test literal "all three
  rates in `(0, 1)`"**, which a correct measurement fails; the suite asserts `[0, 1)` with favorite/reply
  strictly positive, plus a test that a zero reference still scores and still rewards a repost. (D226/D227/D229
  again: trust a plan's structure over its literals.)
- **D234** (XR.3 — **the new reference broke an XR.2 test, and the break WAS the finding**). *"shrinkage: a
  1-like/10-view post scores below a 100-like/1000-view post"* went red: its `real` fixture carried **5
  replies**, 3.7x ABOVE the imported reply reference (0.00135) and 0.25x BELOW the measured one (0.019774).
  Reply carries X's published **5.0** against favorite's **0.5**, so a below-median reply rate outweighs a 10x
  like surplus and the tiny post — handed the median on every head by shrinkage — wins. **Fixture re-picked
  (40 replies, above the median on all three heads) rather than the assertion loosened, and the old fixture
  kept as its own test of what it exposed.** **Generalize: a test that reddens when a constant is measured was
  testing the constant, not the claim in its name — re-pick the fixture, keep the old one as the finding.**
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

- **XR.1 — the network is reachable from Bash, which changes what "the oracle is off-machine" costs.** Plain
  `curl` to `raw.githubusercontent.com` returns 200 from this shell, and
  `api.github.com/repos/<org>/<repo>/git/trees/main?recursive=1` answers unauthenticated — how
  `ranking_scorer.rs` was located without cloning. **`api.github.com/search/code` does NOT work unauthenticated
  (401)**, so finding a constant means fetching candidates and grepping locally. **Prefer `curl` + `grep` over
  `WebFetch` for source transcription:** `WebFetch` answers through a small summarizing model, and its first
  pass silently reformatted the `param!` macro into a tidy markdown table — fine for orientation, **not**
  something to transcribe 26 weights from.
- **XR.1 — the XR upstream map, kept because re-verifying against a newer X commit is a real future task.**
  `xai-org/x-algorithm` @ `7ba77684` (main, 2026-09-01), Apache-2.0. `home-mixer/params/param.rs` — every
  `param!(Name, f64, "rust_home_mixer_…", default)`, weights at ~285–480. `params/config.rs:40` —
  `NEGATIVE_SCORES_OFFSET = 0.001`. `scorers/ranking_scorer.rs` — `ScoringWeights::from_params` (~105–130),
  `compute_weighted_parts` (~400–460, **the 26-entry `terms` array IS the claim that there are 26 heads**),
  `offset_score` (~472), `reply_weight_for` (~186), `diversity_multiplier` (~562), `oon_applies` (~679).
  Confirmed gate defaults: `EnableMultiplicativePostUnexplored` **false**,
  `EnableOonRescoreForInNetworkRepliesRetweets` **true**, `MinVideoDurationMs` **10_000**, `TopicOonWeightFactor`
  0.5 (unported).
- **XR.1 — the plan predicted the arithmetic almost perfectly, and the two things it got wrong were both in
  prose rather than in structure.** Confirmed exactly as written: 26 heads; `positive_sum` excludes the three
  `cont_*` heads **and** both bidirectional boosts; terms split by the sign of the term; `offsetScore` squashes
  rather than clamps; `oonApplies` is a boolean gate firing for in-network replies and reposts;
  `diversityMultiplier` 1 / 0.625 / 0.4375 → 0.25; `replyWeightFor` 5.0 → 20.0 only on a mutual's ORIGINAL.
  Wrong: the zeroed-head list (D226) and the negative-branch ceiling (D227). **Trust a plan's structure further
  than its literals.**
- **XR.1 — `X_WEIGHT_SUMS` is COMPUTED from the members list, never written down.** `positive` is
  `43.339999999999996`, not `43.34`; summing left-to-right in source order reproduces the Rust f64 exactly,
  whereas a hand-typed literal would drift the moment a weight changes and would silently disagree with the
  Rust in the last bits. Assert sums with `toBeCloseTo(…, 10)`, never `toBe`.
- **XR.1 — a `const` with a numeric literal breaks a faithfully-ported `!= 0` guard.**
  `BIDIRECTIONAL_FOLLOW_REPLY_BOOST` had to be annotated `: number` (not left to infer the literal type `15`),
  or `tsc` rejects the source's own `boost !== 0` check as *"types '15' and '0' have no overlap"*. Any future
  port of a feature-switch guard hits this; the annotation is the fix, and the reason belongs in a comment
  (it is a switch X can turn off, not a constant a compiler should fold away).
- **XR.1 — a pure `src/shared/` task owes NO extension build and moves NO docs count**, paid a second time
  (the OU.1 precedent). The shims are XR.5's; a module with no consumer moves no user-visible string. Also:
  the extension `include` array has **13** entries but only **12** shims — the first is the extension's own
  `src/**/*`. Count the shims, not the array length, or XR.5's "12 → 14" will read as already done.

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

## Planning-error log

Corrections to MASTERPLAN.md itself (wrong dep, wrong order discovered live).

- **2026-07-16-niche.md Task 3 done-when** — the "`Pitești` hits nothing" grep contradicts the same task's bit-for-bit equivalence requirement (post prompt §6/§9/§0 carry builder biography outside the §1/§5 extraction scope; no niche field exists to hold them). Resolved at N.3 in favor of equivalence; see D28b for the full resolution + what N.9 must scope differently. Source plans are never edited — this entry is the correction.
- **2026-07-17-ai-layer.md — no task owns the post drafter's askLLM migration.** Task 5's edit list names replies/pillars/playbook/voiceExtract; Task 6 only flips drafter's MOUNT gate; Task 7 adds a sibling route. Yet the plan's Why-section + Done-when #1 spirit require every draft surface to honor the provider setting, and the Task-6 gate flip would 502 `/posts/draft` on OpenRouter-only setups. Resolved at AI.5 by migrating `drafter.ts` there (D47b) — the call-site-migration task was the right home.