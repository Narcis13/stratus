# Masterplan execution state

> Dynamic memory for `/masterplan`. Updated after EVERY task, in the task's own commit.
> Plan: `plans/MASTERPLAN.md` (static — order, reasoning levels, waves, D1–D10 + Wave-6 seeds D141–D144 + Wave-7 seeds D172–D174).
> Codemap: `.claude/skills/plan-feature/references/codemap.md` (updated per task too).
> History: `.claude/skills/masterplan/STATE-ARCHIVE.md` (frozen, grep-only — closed-lane deviations, gotchas, priors, ledger rows).
> Debt: `.claude/skills/masterplan/VERIFY-DEBT.md` (**unpaid**, not history — browser-verify + CA.2. Read it when you have Chrome open; skip it otherwise).

## WAVE 8 IS OPEN — 145/149. Next: RA.5 or RA.7 (RA.6 floats and can run beside anything).

Waves 0–7 closed at 141/141 (RC.5, 2026-07-28). `d968fe9` re-opened the masterplan with **Wave 8 (RA —
`plans/2026-08-17-radar-access.md`, 8 tasks)**: the Radar's swept queue, readable and draftable from a
Claude Code session. **The whole wave is $0** — no `xFetch`, no `askLLM`, no image call on any path; reply
drafting moves off Grok onto the operator's own session, so RA can only reduce spend. RA.1 shipped the
table + ingest + the D185 rule move and did the re-opening below.

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

- **last-commit:** **identity is the SUBJECT LINE — no sha is recorded (D97).** HEAD should read `feat(radar): RA.4 compose radar drafts + x_radar_draft_reply MCP tool`, parent `f6c845b` (RA.3). **Step 0 is one command:** `git log -1 --format='%h %s'`.
- **current state of the repo (RECOUNTED at RA.1 — the pre-RA line here was three lanes stale and the plan predicted it; every number below was read off the code, not carried forward):** suite **2448** across 127 files (RA.4 added no file — +5 in `radar/corpus.test.ts`, +7 in `routes/radar.test.ts`, +1 in `src/mcp.test.ts`); tables **43**; migrations through **`0029_blushing_expediter`** — **the journal is FREE from `0030`**; registry **15 groups / 61 knobs, 31 mirrored** and **17 prompt keys** (both read out of the running registry, not off any doc — see the gotcha: `docs/settings-tab.md` currently claims 67/16 and 16, and is wrong on all three); MCP **28 tools** (3 schema / 19 curated / 6 write — RA.3 took it 25 → 27, RA.4 27 → 28; **no remaining RA task adds one**); smoke scripts **39**; extension tsconfig `include` shims **11**; whole-repo lint **0 errors**. The four multi-file moves a new task will hit, each with the assertions that make them fail loudly: **a mirrored knob is SEVEN edits** — `registry.ts` (group array; order decides mirrored position), `registry.test.ts` **twice** (the group's exact key list *and* the exact mirrored list), `docs/settings-tab.md`'s **three** count strings (prose, asserted by nothing), plus extension-side `ServerConfig` + `SERVER_DEFAULTS` + `readServerConfig`, pinned by `serverSettings.test.ts`'s exact `Object.keys` list AND its full-blob `toEqual` (D181d — the server half alone ships a knob that silently does nothing). **RA needed none of it, and RA.2 CONFIRMED that rather than assuming it: D187's browser toggle left the registry untouched, so the 61/15/31 and 17 above still hold and `docs/settings-tab.md`'s three KNOB/PROMPT count strings are unmoved. What RA.2 did move in that doc is a different, unasserted trio — the behaviour-TOGGLE count, four → five (section head, opt-out recipe, troubleshooting line).** **A registry prompt key is FOUR** (`PROMPT_KEYS` + `PROMPT_SPECS`, the default exported from a **pure** module or the import cycles, `registry.test.ts`'s exact key list, and `docs/settings-tab.md`'s three counts). **An MCP tool bumps `src/mcp.test.ts`'s exact 28 and `docs/s2-mcp-server.md`'s counts in the same commit** — and RA.3 found there are **FOUR** count strings in that doc, not three: the prose total, the `## The tools` heading, the end-to-end verification line, AND the `### <tier> (N)` heading. **RA.4 corrected the fourth: it is the heading of the TIER you touched, not always Curated** (RA.4's tool is write-tier, so `### Write tier (5)` → `(6)` while Curated stayed 19), and it also found a **fifth and sixth** unasserted string the count changes: the intro's prose enumeration of the write tools ("five tiny non-billed writes (…)") and the §"Security & cost invariants" row claiming the write tier "tops out at a `draft` calendar row" — now two ceilings. **The `src/x/mcp.ts` row in codemap §3.3 also carries the counts and was 25/17/5 stale through RA.3; RA.4 fixed it. Bump both it and §6.** **A migration** never runs in two parallel sessions, ignores any number quoted in plan text, and is inspected for dropped seed INSERTs by `git diff --stat src/db/migrations/` plus a fresh `:memory:` boot counting `content_pillars` (3) — never by grepping for `INSERT INTO`, which `0000`'s `INSERT OR IGNORE` spellings make return 0 (D177a).
- **next-up:** **RA.5** (Radar tab **Fetch drafts** button, high, extension-only — `Radar.tsx`, reusing the existing `stratus/radar-rehydrate` message) or **RA.7** (the `radar-analyst` skill, high, deps RA.3 ✓ RA.4 ✓ — pure `.claude/skills/` authoring, no repo code). They are disjoint and either order works; RA.5 is what makes RA.4 visible to the human, RA.7 is what makes it usable by a session. **RA.6 floats** (owns only `content.ts` + harvest docs). **RA.8 closes and needs all of them.** Server-side, the RA lane is DONE: `src/x/routes/radar.ts` and `src/mcp.test.ts` are free for good, and no remaining task needs a migration, a registry knob or an MCP tool. RA.5 must read the RA.2 gotcha about `shipSightings` hanging off the `isRadarReport` branch **before** touching the rehydrate path. Standing gate reminders: `bun run test` (bare `bun test` targets the file DB and `inspect.test.ts` fails 2/2); biome forbids `delete process.env.X` / `: any` in `scripts/`, **non-null assertions (`x!`) anywhere**, a `let` assigned once, and a backtick string with no interpolation — it also sorts imports case-sensitively, collapses short chained calls, and rejects a `console.log` string-concat unless every operand interpolates (run `bunx biome check --write` on the changed files FIRST). Extension-touching work adds `cd extension && bun run build` **and** its own `typecheck`, then `grep -cE '^\s*import[ {]' extension/dist/content.js` == 0.

## Ledger

Status: `[ ]` todo · `[~]` in progress (lane claimed) · `[x]` done (sha + date) · `[s]` skipped (reason in deviations).

**Waves 0–7 are CLOSED — 141/141.** Per-task entries (shas, parents, dates, notes) live in
`STATE-ARCHIVE.md` — Waves 0–4 at UI.11, Wave 5 at GT.9, Wave 6 at JD.8, **Wave 7 at RC.5**. Grep by task id.

- **Wave 0 — Foundations (13/13 ✓)**: UI.1, UI.8, UI.9, UI.10, ST.1–ST.9. Closed by `d1902e5` ST.9 studio docs+smoke.
- **Wave 1 — Prompt & identity core (32/32 ✓)**: RU.1–RU.3, N.1–N.9, ME.1–ME.7, AI.1–AI.13. Closed by `f86e06a` AI.13 AI docs+smoke.
- **Wave 2 — Reply machine & on-page surfaces (29/29 ✓)**: RU.4–RU.10, AX.1–AX.7, RL.1–RL.8, NT.1–NT.7. Closed by `5d4a1a4` NT.7 NT docs+smoke.
- **Wave 3 — Ambient data & guardrails (16/16 ✓)**: HV.1–HV.6, GR.1–GR.10. Closed by `docs(guardrails): GR docs-sync + $0 smoke-guardrails.ts (GR.10)`, parent `7adfbca`.
- **Wave 4 — Authoring 3.0 (15/15 ✓)**: A3.1–A3.15. Took migration `0023_slimy_night_thrasher` (`articles`). Closed by `docs(authoring): Authoring 3.0 docs-sync + $0 smoke-authoring3.ts (A3.15)`, parent `819c61d`.
- **Wave 5 — Settings moat + polish (16/16 ✓)**: UI.2–UI.7, UI.11–UI.17. Closed by `docs(ui): cockpit overhaul docs-sync + $0 smoke-settings.ts (UI.17)`, parent `7b10239`.
- **Wave 6 — Coach, judge & growth tactics (25/25 ✓, + GT.5 `[s]` by design)**: SC.1–SC.9, GT.1–GT.9, JD.1–JD.8. Took migration `0024_soft_leopardon` (`draft_judgments`). Closed by `docs(judge): LLM-judge docs-sync + $0 smoke-judge.ts (JD.8)`, parent `fc44d1c`.
- **Wave 7 — Radar follow-ups: curated drafting & humanize-at-pick (10/10 ✓)**: HM.1–HM.5 (project humanizer), RC.1–RC.5 (curated drafting). Took migration `0025_curvy_edwin_jarvis` (`radar_drafts.curation_score`). Closed by `docs(radar): RC docs-sync + $0 smoke-radar-curate.ts (RC.5)`, parent `80a2f2b`.
- **Wave 8 — Radar access from a Claude Code session (2/8)**, plan `plans/2026-08-17-radar-access.md`, opened by `d968fe9` (`wave 8` — plan + MASTERPLAN registration only, no code, no STATE.md; RA.1 owed the re-opening and did it). **$0 lane.** Took migration `0029_blushing_expediter` (`radar_sightings`).
  - `[x]` **RA.1** — `radar_sightings` + `POST /x/radar/sightings` + migration `0029` + the D185 `bandStickiness` move. `feat(radar): RA.1 radar_sightings table + $0 sighting ingest`, parent `d968fe9`, 2026-08-17. Gates: suite 2396/0 fail, typecheck ✓, lint ✓, extension typecheck+build ✓, `content.js` imports 0, one `bandStickiness` in the tree, `:memory:` boot → 3 `content_pillars`.
  - `[x]` **RA.2** — background ships every sighting + the `radarSightingSync` toggle (D187: no registry knob, confirmed). `feat(extension): RA.2 mirror radar sightings to the server`, parent `0e7bf6c`, 2026-08-17. Gates: suite 2412/0 fail, typecheck ✓ (root + extension), lint ✓, extension build ✓, `content.js` imports 0. Browser end-to-end (rows landing per page, the toggle stopping them) is RA.8's — see the gotcha.
  - `[x]` **RA.3** — `GET /x/radar/sightings(/:tweetId)` + `x_radar`/`x_radar_tweet` (MCP 25 → 27). `feat(radar): RA.3 sighting read layer + x_radar/x_radar_tweet`, parent `41f6a07`, 2026-08-17. Gates: suite 2435/0 fail, typecheck ✓, lint ✓ (no extension file touched). No schema, no migration, no registry knob.
  - `[x]` **RA.4** — `POST /x/radar/drafts/compose` + `x_radar_draft_reply` (D186; MCP 27 → 28). `feat(radar): RA.4 compose radar drafts + x_radar_draft_reply MCP tool`, parent `f6c845b`, 2026-08-17. Gates: suite 2448/0 fail, typecheck ✓, lint ✓ (no extension file touched). No schema, no migration, no registry knob.
  - `[ ]` **RA.5** — Radar tab **Fetch drafts** action. Pointless before RA.4 ✓, so it is live now. high.
  - `[ ]` **RA.6** — passive `/home` capture repair (the 2026-07-27 stop). No deps, `[parallel-ok]`. high.
  - `[ ]` **RA.7** — the `radar-analyst` skill. Deps RA.3, RA.4. high.
  - `[ ]` **RA.8** — RA docs-sync + `$0 scripts/smoke-radar-access.ts` + the browser end-to-end check. Deps all. high.

## Hot-file locks

A lane claims a file before starting, releases on commit. **RA.1 released everything it held** — no file is
locked right now. The documented way to reach a closed lane's file notes is to **grep `STATE-ARCHIVE.md` by
filename** before touching a file that lane built.

| File | Owner |
|---|---|
| `src/x/routes/radar.ts` | — (**free for good — no remaining RA task touches it.** RA.1 added `POST /radar/sightings`; RA.3 added both GETs after it (static before `:tweetId`, §7.20); RA.4 added `POST /radar/drafts/compose` in the `/radar/drafts` block above the `:tweetId` forms, plus four file-local helpers at the bottom from RA.3 — `loadSightingContext`, `compareSightings`/`sightingTieBreak`, `intParam`, `boolParam`. The file is 990 lines and `$0` by construction; its header says nothing in it may import `xFetch`/`askLLM`.) |
| `src/mcp.test.ts`'s exact tool count (**28**) | — (**free for good — no remaining RA task adds a tool.** The next MCP task anywhere in the repo owes, in one commit: this exact number, `scripts/smoke-mcp.ts`'s expected-names list, `docs/s2-mcp-server.md`'s **six** strings, and the counts in codemap §3.3's `mcp.ts` row **and** §6 — see the recount sentence in `current state`.) |
| `extension/src/background.ts` | — (free, and **no remaining RA task touches it** — RA.2 was the only one, and it released the file. RA.2 also added `extension/src/shared/radarIngest.ts`, which nothing else in the lane owns.) |
| `extension/src/shared/radar.ts` | — (free; **RA.1 already made its edit** — the `RadarBand` alias + the `bandStickiness` import. RA.2/RA.5 touch the extension elsewhere.) |
| `src/db/migrations/` journal (any migration task) | — (**RA.1 took `0029_blushing_expediter` (`radar_sightings`); the next migrating task owns `0030`.** No later RA task needs a migration — the lane is one table wide. JD.4 took `0024_soft_leopardon` (`draft_judgments`) before it. Standing invariant: never run two migration-generating tasks in parallel sessions (journal conflicts), ignore any hardcoded number in plan text — **JD.4's plan said "0018", which is RL.2's `reply_lists`; a plan quoting a migration number is quoting the day it was written** — and always `bun run db:generate` against the current journal, then inspect the SQL for dropped seed INSERTs, codemap §4) |

## Deviations & decisions register

**Wave 8 (open) — D185–D188.** D185–D187 are the plan's own seeds (full text in `plans/MASTERPLAN.md`
§"Wave-8 seeds"): **D185** the `bandStickiness` move (done at RA.1), **D186** the `draftRowToSighting`
contract that binds RA.4, **D187** the browser-toggle kill switch that binds RA.2. New at RA.1:

- **D188** (RA.1, binds RA.2 and any later reader of `radar_sightings`): **three places the plan and the
  code had to be reconciled, and one of them changes the wire contract.** **(a) The merge's freshness
  tie-break is `>=`, not `>`.** The plan's rule was "metrics only move when the incoming sighting is
  newer", which read as strict — and it is wrong in the one case the route deliberately creates: a band
  change punches through the 60s throttle, so the second POST lands in the *same millisecond* as the
  first, `newer` was false, and an ACCEPTED re-sighting stored nothing but a bumped `seen_count`. Ties now
  resolve to the incoming row (the same "fresher copy wins" tie-break the batch dedup and the band ratchet
  already use); only a strictly-older sighting is held back, which is the case the guard exists for. A
  route test would not have caught this — the corpus unit test did, via the route test failing on a real
  clock. **(b) `§7.407`, cited five times in the plan header, is not a codemap section.** §7 stops at 36.
  The rules it names ("free-text/server-owned parent, lazy prune, warn-and-drop client, throttle mirrors
  the server window, gate order is the perf contract") are the HV.1 passive-ingest ones and are readable
  off `POST /harvest/passive` in `routes/harvest.ts` — read them there, not by grepping the codemap. Same
  for `§7.415a`. **(c) `parseSightingWireRow` takes `nowMs` as a second parameter** (defaulted), which the
  plan's signature did not have: `seenAt` both defaults to now AND is clamped to ≤ now, and neither is
  testable if the module reads its own clock. RA.2's throttle must assume the server may clamp a
  fast-clock `seenAt` down.

- **D189** (RA.2, binds RA.3/RA.4/RA.8 and any future ingest pair): **`toSightingWireRow` returns
  `SightingWireInput | null`, which the plan's signature did not allow — and the reason generalizes.**
  RA.1's route parses every row before writing any and **400s the whole batch on its first bad row**
  (deliberate: a client shipping 100 rows a minute has to know which reader drifted). RA.2's client is
  warn-and-drop and never retries (also deliberate: a lost sighting must never cost a user action).
  Each half is right on its own; composed, **one unrepresentable row silently costs up to 99 good ones**,
  and nothing logs why. So the mapper refuses the row client-side: a failed REQUIRED field (`tweetId`,
  `handle`, non-finite/negative counts, `ageMin` past the server's one-year ceiling) drops the row, a
  failed OPTIONAL field (`url`/`author`/`sourcePath` too long) is sent as `null`, since unknown is legal
  there and losing a display name is no reason to lose a sighting. The four ceilings are **restated**
  in `shared/radarIngest.ts` (§7.33 — the extension cannot import `src/x/radar/corpus.ts`, whose
  `MAX_AGE_MIN` is module-private), so **a future change to any of them is a two-file change**. The one
  real-world casualty is a ⊕ pin on a tweet older than a year: the server calls that a parse bug, the
  page does not, and the pin still enters the local queue and drafts normally — it just isn't mirrored.
  Left as-is rather than widening the server's ceiling, because `src/x/routes/radar.ts` is RA.3/RA.4's
  hot file; revisit there if a real pin is ever lost.

- **D190** (RA.3, binds RA.4 and any later reader of this corpus): **three calls the plan's route table did not make, and one of them is a rule worth reusing.** **(a) `admitted` and `worked` got their OWN 400 codes** (`invalid_admitted` / `invalid_worked`), beyond the plan's five. The repo's existing boolean query params are lenient (`c.req.query('retired') === 'true'`), and that is right for them — they are opt-in switches whose default is off, so a typo costs you the switch. These two **narrow a result set**: `admitted=1` reading as "no filter" hands back a full list the caller believes is filtered, which is a *wrong answer*, not a missing one. Rule: a lenient boolean is fine for a flag, never for a filter. **(b) A read ceiling was added the plan did not have.** "Read the window, then sort in JS" is correct at the default 7 days and is ~120k rows at `days=60`, so `SIGHTING_SCAN_CAP = 5000` bounds the SQL read (newest-first, `+1` so `truncated` is a fact rather than an inference from a full page) and the body reports `scanned`/`truncated`. Paired with the `summary`-covers-the-whole-filtered-set / `sightings[]`-is-the-`limit`-slice split, so `count < summary.total` means the LIST was cut and the ANSWER was not (D184b — state the claim the surface cannot make). **(c) The detail response carries `sweep` and returns the sighting as the same enriched VIEW**, not the raw row the plan's `{sighting, drafts[], replies[]}` implied: `sighting.admitted` is meaningless without the config that produced it, and two shapes for one row is how a consumer ends up with two parsers. Also worth carrying forward: the plan said to drive the config-flip test through `PATCH /x/settings`; `radar.test.ts` is a bare-Hono mount of the radar router alone and already has the `setSettings`/`resetSettings`-in-a-`finally` precedent (the `x.radar.draftTtlH` test), so that is what was used — the registry is the same object either way.

- **D191** (RA.4, binds RA.5/RA.7/RA.8 and any later writer of `radar_drafts`): **three plan-vs-code
  reconciliations, and the middle one is a number the plan could not have known was missing.**
  **(a) `sightingVpm` did not exist.** The plan's Design section lists it among `corpus.ts`'s functions,
  but RA.1/RA.3 inlined `round2(views / max(ageMin,1))` inside `buildSightingViews` with a module-private
  `round2`. RA.4 needs the same number for `signals.vpm`, so rather than write the formula a second time
  it was **extracted and exported**, with `buildSightingViews` now calling it — the view's `vpm` and a
  draft's `signals.vpm` are the same rule by construction, not by agreement (§7.27). `coerceBand` was
  exported for the same reason: the compose route has to narrow the stored free-text band, and the
  "a legacy verdict means sweep" fold already had two copies (here and `extension/src/shared/radar.ts`).
  **(b) "Fall back to the stored age relationship when `posted_at` is null" names a relationship the row
  does not carry.** `first_seen_at`/`last_seen_at` are CAPTURE times; the only post-time fact is
  `posted_at`, and the view's own `ageMinAtLastSeen` is null exactly when it is. So the fallback had to be
  chosen, not looked up: **`now − last_seen_at`**, a lower bound (the post demonstrably existed when the
  queue last saw it), and never null — because a null `signals` is the invisible-draft case (D186), which
  is strictly worse than an age we can defend. Only reachable on a hand-written row; the ingest always
  derives a `posted_at`. **(c) Validation is stricter than the plan's five codes in one place and looser
  in another.** The 400s carry an **`index`** (which variant failed — the ingest's own convention, and a
  caller shipping three variants needs to know which one), and `invalid_angle` echoes `allowed`. But the
  stored `angle` column stays free text: it holds rows written before `observation`/`question` existed,
  and RA.4 only refuses what a caller writes TODAY. Same split as `band` — strict on the wire, tolerant
  in the column.

**All 184 earlier D-entries are in `STATE-ARCHIVE.md`** — grep by task id or by the filename the lane built.
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

- **RA.1 — `docs/settings-tab.md`'s three count strings are STALE, and nothing asserts them.** The doc says
  "**67 knobs in 16 groups**" and "**16 prompts**" (×2); the running registry says **61 knobs / 15 groups /
  31 mirrored** and **17 prompt keys** (`reply-batch-network` is the 17th). RA.1 recounted rather than
  carried forward, and the numbers in the `current state` line above are the recount. **RA touches none of
  them** (D187 — the sighting feed's switch is a browser toggle), so this is not RA's to fix; but the next
  task that "bumps the three count strings" must bump them *from the truth*, not from the doc, or it ships
  a fourth wrong number. Same lesson as the MCP doc being 5 tools stale for four phases.
- **RA.1 — the sighting ingest's two twins live on opposite sides of the wire and nothing links them in
  code.** `SIGHTING_RECAPTURE_MS` (`src/x/routes/radar.ts`) mirrors `RADAR_RESEND_MS`
  (`extension/src/content.ts:3108`) at 60s, *including* the "unless the band changed" clause. If RA.2 gives
  the background its own throttle, it must be the same window: shorter on the client and the wire carries
  rows the server can only count as `skippedRecent`; longer and the corpus silently loses re-sightings.
  Both files say so in a comment — that comment is the only link.
- **Settings types are extension-local mirrors.** The extension MUST NOT import `src/x/settings/registry.ts` (§5 build-isolation); it mirrors the `GET /x/settings` JSON in `extension/src/shared/types.ts`, and a new server-side `SettingDef` field is hand-synced there. **The same wall bites `scripts/`, in the other direction:** a smoke may not import the extension build, which is why `smoke-humanizer.ts` keeps a local `mulberry32` and `smoke-radar-curate.ts` cannot test `partitionForCurate`. (Full block in the archive; grep `Settings types are`.)
- **`exactOptionalPropertyTypes` pass-through pattern (UI.10):** primitives forwarding a maybe-undefined optional (`Slider.unit`, `SettingRow.onReset`, `GearPopover.onReset`/`label`) type the prop as `T | undefined` explicitly — else TS rejects `prop={maybeUndefined}`. Reuse this for new primitives that relay optionals. Root tsconfig also has **`noUncheckedIndexedAccess`**, so `arr[0]` is `T | undefined` — name your fixtures as consts rather than indexing them in a script.
- **`inspect.test.ts` fails 2/2 under bare `bun test`, GREEN under `bun run test`** (the canonical `SQLITE_PATH=:memory: bun test`). `src/db/client.ts` defaults to `:memory:` when `NODE_ENV==='test'`, but `src/x/data/inspect.ts`'s readonly connection still defaults to `./stratus.db` when `SQLITE_PATH` is unset — the primary writes memory, the readonly reads the file, seeded rows are invisible. **Always gate with `bun run test`.** One-line fix for a future data-core task: make `inspect.ts` honor the same `NODE_ENV==='test'` default (or have `client.ts` `process.env.SQLITE_PATH ??=` set it so both agree).
- **A route suite over the composed `app` tests the WIRING; a bare-Hono suite tests the ROUTE** (D179a, generalized). `src/app.test.ts`'s guards sit behind `describe.if(authed)` and need `API_TOKEN`, and an LLM-gated router refuses to mount without a provider key (§7.22) — so on a clean checkout those tests do not run at all. An LLM route needs its own bare-Hono suite (`judge.test.ts` / `drafter.test.ts` / `replies.test.ts` / `humanizer.test.ts`) or its refusal ladder is untested on any machine that isn't fully configured. **There is no `mock.module` anywhere in this repo:** the established substitute is a 400 ladder ending in a forced 503 with both provider keys unset in a `finally` (which also proves for free that the prompt + input rendered), plus unit tests over the post-spend parsers.
- **NT.1: extension typecheck does NOT cover `*.test.ts`** — `extension/tsconfig.app.json` has `"exclude": ["src/**/*.test.ts"]`, and root `tsconfig.json` only includes `src/**/*` + `scripts/**/*` + `drizzle.config.ts`. So an extension test file is checked by **`bun run test` alone**; a type error in one is invisible to both typechecks.
- **NT.7: `app.request(...)` is typed `Response | Promise<Response>`.** A helper declared `function f(): Promise<Response> { return app.request(...) }` fails root typecheck; make the helper `async`. `bun run typecheck` covers `scripts/**`, so this bites in smoke scripts, not in route suites (which `await` inline).
- **CLAUDE.md was slimmed to guardrails-only (2026-07-23, out-of-skill docs refactor).** The full phase-entry ledger moved **verbatim** to `docs/PHASE-HISTORY.md`. **Every docs-sync task (MASTERPLAN global rule 6, codemap §7 rule 29) appends its phase entry to `docs/PHASE-HISTORY.md`, NOT CLAUDE.md**; CLAUDE.md changes only when a guardrail (invariant, workflow, stack quirk) changes. Plan text still saying "CLAUDE.md phase entry" means the history file.
- **Wave-3 carry-forward — the four repo-wide facts (everything else HV/GR is in the archive):** **(1) MCP tool count is asserted exactly.** `src/mcp.test.ts` asserts **23**; every future tool bumps that number *and* `docs/s2-mcp-server.md`'s three counts (total / curated tier / write tier) **in the same commit** — that doc was silently 5 tools stale for four phases. **(2) Docs assert user-visible strings.** `docs/harvest-tab.md`, `docs/playbook-tab.md`, `docs/people-tab.md`, `docs/today-tab.md`, `docs/composer-tab.md`, `docs/replies-tab.md`, `docs/radar-tab.md` and `docs/settings-tab.md` quote real copy — **reword a quoted string and you owe the doc in the same commit** (`docs/today-tab.md` is numbered §1–§18, so an inserted card renumbers rather than appends). **(3) Real-DB fixture rules that outlive their lane:** a seeded `posts_published` row is written **`retired: true`** (NT.7 — otherwise it is a candidate for the daily *billed* pass), a `following` fixture needs a `following_runs` row first (`last_run_id` is a notNull FK), people-layer handles must be **≤15 chars** (longer ones are silently skipped and the assertions go vacuous), and any suite touching `scheduled_posts`/`posts_published` inside the monitor's windows must delete its rows in `afterAll` — `monitor.test.ts` asserts `clusterCount === baseline + 1` and a leaked pending pair breaks a different file. **(4) Five reads WRITE and none of them may be polled:** `/radar/drafts` (48h expiry), `/following/queue` (release + revoke), `/x/goals`, `/x/brief` and `/x/digest` (all three settle `active → achieved|missed`). A3.8's Today card and A3.14's week board both sit on `/x/brief` — a refresh loop there silently advances goal statuses.

- **RA.2 — the 60 s window now has THREE copies, and the middle one is the non-obvious one.**
  `RADAR_RESEND_MS` (`content.ts`) throttles ONE page's captures; `RADAR_INGEST_RESEND_MS`
  (`shared/radarIngest.ts`) throttles what reaches the wire from EVERY tab at once — two x.com tabs hold
  two independent content-side maps and a reload empties one, so the background's map is not redundant
  with the page's; `SIGHTING_RECAPTURE_MS` (`routes/radar.ts`) has the last word. All three carry the
  same "unless the band changed" clause, and all three are 60 s **by agreement, not by construction** —
  each file says so in a comment, and that comment is still the only link.
- **RA.2 — only PAGE reports are mirrored, and that is load-bearing for RA.5.** `shipSightings` hangs off
  the `isRadarReport` branch's success arm, so a sighting rehydrated out of `radar_drafts`
  (`rehydrateSightings`) is never shipped back to the server that just served it, and a failed buffer
  write mirrors nothing. RA.5's **Fetch drafts** reuses `stratus/radar-rehydrate`, which is a different
  branch — **do not "unify" the two by moving the ship hook into `addSightings`**, or MCP-composed drafts
  will loop back into `radar_sightings` as fake sightings with the wrong `source_path`.
- **RA.2 — three `Settings` object literals live OUTSIDE `sidepanel/storage.ts`** and a tenth field has
  to reach all of them: `Settings.tsx`'s `currentSettings` memo (**and its deps array**), `Settings.tsx`'s
  `onSave` `next`, and `sidepanel/storage.test.ts`'s round-trip blob. Typecheck catches every one, so this
  is a "why did tsc fail" note, not a trap — but the deps array is the one that type-checks green while
  going stale, so add the field there in the same edit.
- **RA.2 — what is still BROWSER-UNVERIFIED, and it is RA.8's done-when #3/#5, not a new debt entry.**
  Everything RA.2 shipped is gated by unit tests and a build; nothing proves rows actually land with the
  right `source_path` from `/home`, `/search` and a list page, that a ⊕ pin lands one, that
  `radarSightingSync: false` stops the POSTs, or that an unconfigured server stays silent. The plan
  already owns those as RA.8's checks — do them there rather than filing a sixth `VERIFY-DEBT` entry.

- **RA.3 — `docs/s2-mcp-server.md` has FOUR count strings, not three, and the fourth is the one that rots.**
  The prose total (§intro), the `## The tools` heading, the end-to-end verification line — and
  **`### Curated tier (N)`**, which nothing asserts and which no previous MCP task is recorded as
  having touched. RA.3 moved it 17 → 19 along with 25 → 27 in the other three. RA.4 owes all four.
- **RA.3 — `admitted` is judged at the LAST SIGHTING's age, and that is load-bearing, not incidental.**
  Judging at `now` makes every row older than `maxAgeMin` (default 60 min) read `false`, so the whole
  field would say nothing about anything but the last hour. It is the `deriveTimelineBucket` reading
  (playbook.ts) — **minus** that function's `verifiedOnly: false` override, which exists only because
  the passive corpus never recorded a badge; `radar_sightings.verified` IS stored, which is the whole
  reason RA's verdict is exact rather than approximate. A `corpus.test.ts` case pins it (a row last
  seen 5 days ago with a 12-minute age still admits). Do not "fix" it to `now`.
- **RA.3 — the two unknowns in `passesSweep` resolve in OPPOSITE directions on purpose.**
  Unknown `verified` REFUSES (the module's own gate rule: a drifted badge selector must surface as an
  empty queue, not as a filter that silently stopped filtering). Unknown `likes` reads as **0**, the
  lenient direction — because that is what the page itself passes (`cap.likes` is 0 when X renders no
  like count), and failing on unknown there would filter out exactly the quiet posts the sweep exists
  to find. The test asserts a `likes: 25` case beside it so the ceiling is proved non-vacuous.
- **RA.3 — both sighting GETs write NOTHING, and one line is all it would take to break that.**
  `GET /radar/drafts` flips stale `ready` rows to `expired` on the way (lazy TTL). The sighting reads
  deliberately do not: an agent paging the corpus must not advance the panel's queue. The visible cost
  is that a stale `ready` draft still reads `ready` in `GET /radar/sightings/:tweetId` until a panel
  read flips it — accepted, and asserted by a 100h-old fixture. Same property `GET /radar/placed-today`
  is built on, and the same reason: a route that writes cannot be paged.
- **RA.3 — the ordering fixtures are built so the three orders are three DIFFERENT sequences.**
  With the obvious fixture set (`views` roughly tracking `vpm`) `order=views` and `order=vpm` return
  the same list and the parameter is untested by construction. `routes/radar.test.ts`'s RA.3 block sets
  views/age/last-seen so all three rankings differ. Keep that property if you add a fixture.
- **RA.4 — the compose route's `model` string is a CONTRACT, not a label, and RA.7/RA.8 both depend on
  it.** `COMPOSE_MODEL = 'claude-code-mcp'` is copied onto `reply_drafts.model` by the confirm route, so
  every "did Claude's drafting beat Grok's" split is `WHERE model = 'claude-code-mcp'` over `reply_drafts`
  → outcomes. Change the string and the cohort silently starts over at n=0 with no error anywhere. It is
  asserted in `routes/radar.test.ts` (both at compose and after confirm) and in `src/mcp.test.ts`.
- **RA.4 — a composed draft makes its own sighting read `worked: true` immediately, by design.** RA.3's
  `worked` counts a `radar_drafts` row of ANY status, so the moment `x_radar_draft_reply` returns, that
  tweet leaves the `worked=false` queue. That is correct — the composing IS the work — but it means an
  analyst session cannot use `worked=false` to re-find what it drafted five minutes ago; use
  `x_radar_tweet` or `GET /radar/drafts`. Worth stating in the RA.7 skill so it doesn't read as a bug.
- **RA.4 — `GET /radar/drafts?tweetId=` is the surface that proves a composed draft is real, and it is
  not the one the route returns.** The 201 body is the inserted row; the panel rehydrates through
  `GET /radar/drafts`, which applies the lazy TTL flip and its own status defaulting. The happy-path test
  re-reads through it for exactly that reason. RA.5's button and RA.8's browser check should assert the
  same way — a 201 is not evidence the Radar shows anything.
- **RA.3 — `worked` is deliberately asymmetric across its two halves.** ANY `radar_drafts` status
  counts (an expired draft still means I worked it), but `reply_drafts` counts **only `status='posted'`**
  — a `copied` draft never reached anyone. Both halves are pinned by their own fixture. RA.4's composed
  drafts will therefore read `worked: true` the instant they are written, which is correct: the
  composing *is* the work.

## Planning-error log

Corrections to MASTERPLAN.md itself (wrong dep, wrong order discovered live).

- **2026-07-16-niche.md Task 3 done-when** — the "`Pitești` hits nothing" grep contradicts the same task's bit-for-bit equivalence requirement (post prompt §6/§9/§0 carry builder biography outside the §1/§5 extraction scope; no niche field exists to hold them). Resolved at N.3 in favor of equivalence; see D28b for the full resolution + what N.9 must scope differently. Source plans are never edited — this entry is the correction.
- **2026-07-17-ai-layer.md — no task owns the post drafter's askLLM migration.** Task 5's edit list names replies/pillars/playbook/voiceExtract; Task 6 only flips drafter's MOUNT gate; Task 7 adds a sibling route. Yet the plan's Why-section + Done-when #1 spirit require every draft surface to honor the provider setting, and the Task-6 gate flip would 502 `/posts/draft` on OpenRouter-only setups. Resolved at AI.5 by migrating `drafter.ts` there (D47b) — the call-site-migration task was the right home.
