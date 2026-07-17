# Plan template

Copy this structure into `plans/YYYY-MM-DD-<slug>.md`. Every `⟨…⟩` is filled;
sections that genuinely don't apply say "none" rather than disappearing (the
absence must be visibly deliberate).

```markdown
# ⟨Feature name⟩

- **Status:** planned ⟨date⟩ · not started
- **Goal fit:** ⟨which of the 4 goals, one line⟩
- **Cost impact:** ⟨recurring $/day, one-time $, per-click $ — or "$0"⟩
- **Invariants touched:** ⟨map §7/§8 numbers + one clause each⟩
- **Codemap sections relevant:** ⟨§ numbers in .claude/skills/plan-feature/references/codemap.md⟩

## Why / what changes for the user
⟨2–5 sentences. The observable behavior after the last task, not the mechanism.⟩

## Design
⟨The shape: data → pure logic → routes/workers → extension → measurement.
Name real symbols and exemplar files. Include the API contract (method, path,
body, responses incl. error codes) for any new endpoint, and the schema DDL
sketch for any new table/column. Short — details live in tasks.⟩

## Decisions taken
⟨Each fork considered + what was chosen + why. Includes user answers from
AskUserQuestion. Implementers must not re-litigate these.⟩

## Done when
⟨3–6 verifiable statements about the finished feature — the goal-backward
anchor. At least one must be observable end-to-end (a smoke run, a browser
check), not just "tests pass".⟩

---

## Task 1: ⟨imperative title⟩  ⟨[parallel-ok] if independent⟩
**Depends on:** ⟨none | Task N⟩
**Session budget:** ⟨~lines of diff, files touched⟩

**Read first:** ⟨exact files/ranges the implementer must read before editing —
the minimal context set. Always includes the codemap header + relevant §.⟩

**Edit:** ⟨exact paths, one line each on what changes there⟩

**How:** ⟨implementation notes anchored to real symbols: which helper to
reuse, which pattern (§-number) to follow, which exemplar file to imitate,
what NOT to do. Enough that no design decision is left to the implementer;
little enough that no code is written here.⟩

**Tests:** ⟨which test file, which cases — happy path + the failure/gate/
boundary cases this repo always covers⟩

**Done when:**
- [ ] ⟨behavioral check⟩
- [ ] ⟨test/gate check⟩
- [ ] `bun test` + `bun run typecheck` + `bun run lint` green
- [ ] Committed: `⟨conventional commit message⟩`

**Cost note:** ⟨what this task can spend and the guard that bounds it — or "$0"⟩

---

⟨…Tasks 2..N-1 same shape…⟩

---

## Task N (final): docs-sync + smoke
**Depends on:** all prior.

- [ ] `scripts/smoke-⟨slug⟩.ts` — rerunnable, $0 default, cleans up after
      itself; `--live` flag only if one paid verification is genuinely needed.
- [ ] CLAUDE.md: one phase-style entry (what shipped, date, cost, gotchas).
- [ ] ⟨PLAN.md | CIRCLES-PLAN.md | SURFACES-PLAN.md⟩ status updated.
- [ ] `docs/⟨tab⟩-tab.md` updated if an extension tab changed.
- [ ] `.claude/skills/plan-feature/references/codemap.md`: touched sections
      updated + header re-stamped to the new commit.

## Out of scope (do NOT build)
⟨Adjacent things an eager implementer might add. Be specific.⟩

## Risks / watch items
⟨Ambiguities that survive planning, live verifications pending ("done when"
tails), thresholds that are opening guesses.⟩
```

## Sizing calibration ("one coding session")

A session ≈ what a focused Claude Code run completes with tests green without
context strain: **one concern, ≤~6 files, ≤~400 diff lines** including tests.
Reference points from this repo's history: "add gated playbook section +
loader + tab section" = one session; "new table + route + extension tab +
hooks" = three to four sessions, not one. When unsure, split — two small green
commits always beat one stalled session.
