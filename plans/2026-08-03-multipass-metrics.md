# Multi-pass metrics — a comparable-maturity reading on every post

- **Status:** planned 2026-08-03 · not started
- **Goal fit:** Goal 2 (track metrics over time on every published post). This is goal 2's original promise; the shipped implementation only ever delivered one reading per post.
- **Cost impact:** **+~$0.037/day net** recurring (+$0.042 new, −$0.005 from the retired winner re-read) ≈ **$2.7 over the 73-day campaign**. Current spend is $0.15–0.35/day, so this is a ~15% increase. Bounded by a per-run cap knob; cap 0 disables all passes before any candidate query.
- **Invariants touched:** **§7 #7 (retire before you snapshot)** — the whole plan is an application of it; the claim moves from a global `retired` flag to a *per-pass* `poll_count` claim, and getting this backwards is the $3.71 / 3,712-read bug. **§7 #4** (every X call through `xFetch`, here via `getTweetsByIds`). **§7 #5** (`max_results` — n/a, `getTweetsByIds` bills per id sent, so the per-run cap IS the money bound). **§7.3** (refuse before spend — cap ≤ 0 returns before the candidate query). **§7.8** (a side-hook failure never fails the paying path). **§7.13** (sync SQLite; never bind a JS `Date` in a raw `` sql`` `` template). **§7.19** (measurement metadata gates nothing). **§7.29** (docs sync in the same commit). **30-day private-metrics window** (`PRIVATE_FIELDS_MAX_AGE_MS`) bounds every candidate query.
- **Codemap sections relevant:** §3.3 (workers), §4 (tables — **no migration**), §7.3/7.8/7.13/7.19/7.29, §8 (cost), §9 (tests/smoke), §10 (recipes: new worker).

## Why / what changes for the user

Today every post gets **exactly one** metrics reading, taken by the 03:00 UTC daily pass — so a 05:00-slot post is read at 22 hours of accrual and a 17:00-slot post at 10 hours. Comparing those two slots currently compares *ages*, not slots, and that confound sits directly under the week-1 Track A experiment (3 questions/day at 05:00 / 11:00 / 17:00 UTC). After this plan every post and reply gets a **second reading at T+24h**, and every original a **third at T+7d**, so format/slot/variant comparisons are graded on numbers of comparable maturity, and "which content compounds" becomes a real series instead of a winners-only sample.

## Design

Four layers. **No migration anywhere** — both columns this plan needs already exist.

**0. The columns are already there.** `posts_published.poll_count` (integer, notNull, default 0) and `posts_published.next_poll_at` (timestamp_ms, nullable) both ship in migration `0000`, along with a partial index `posts_published_next_poll_idx ON (next_poll_at) WHERE retired = 0`. Nothing in production writes `next_poll_at` — the only references are two assertions in `src/test.test.ts` that it stays null. It is vestigial surface from the original design and this plan claims it.

**The claim model** — the single most important paragraph in this plan:

```
poll_count IS the pass number.  next_poll_at IS the "not before" gate.
retired stays TRUE for the whole ladder, so snapshotDue never sees these rows.

  pass 1   daily 03:00 discovery/snapshot   poll_count 0 → 1   $0 (rides the pull)
  pass 2   next_poll_at = postedAt + 24h    poll_count 1 → 2   originals + replies
  pass 3   next_poll_at = postedAt + 7d     poll_count 2 → 3   originals only

Every pass: UPDATE (poll_count+1, next_poll_at := the next rung or NULL)
            committed BEFORE the billed getTweetsByIds call.
A crash between claim and read loses one reading. It never repeats one.
```

This is `rereadWinners`'s existing discipline (`src/x/workers/dailyMetrics.ts:562–644`, "claim-BEFORE-read: candidates require poll_count = 1, so bumping the count in a committed txn before the billed call removes them from the candidate set forever") generalized from one rung to a ladder. **Read that function before writing any code in this plan.**

**1. Pure logic — `src/x/metrics/passes.ts` (new).** The ladder as data plus the arithmetic, with no DB and no clock of its own (callers pass `now`), following the `people/relationship.ts` / `posts/manualReconcile.ts` shape. Exports:

- `PASS_LADDER: readonly PassRung[]` where `PassRung = { pass: number; delayMs: number; includesReplies: boolean }` — `[{pass:2, delayMs: 24h, includesReplies:true}, {pass:3, delayMs: 7d, includesReplies:false}]`.
- `nextPollAfter(postedAt: Date, completedPass: number, isReply: boolean): Date | null` — the rung arithmetic. Returns `null` when the ladder is exhausted for that row (a reply after pass 2; anything after pass 3), which is what stamps `next_poll_at = NULL` and takes the row out of the candidate set permanently.
- `initialNextPollAt(postedAt: Date): Date` — `postedAt + 24h`, used by the write paths in Task 2.
- `PASS_MAX = 3`, `PASS_2_DELAY_MS`, `PASS_3_DELAY_MS` exported so the worker and the tests can't drift.

**2. Write paths stamp the gate (Task 2).** `next_poll_at` must be stamped at **publish/discovery time, not at pass 1** — a post fired at 05:00 is not seen by the daily pass until 03:00 the next day, by which point T+24h has nearly elapsed and the "±1h" precision is gone. Three insert sites: `workers/publisher.ts` (API posts), `ingestPulledTweet` and `snapshotDue` in `workers/dailyMetrics.ts` (discovered/manual posts). Inert until Task 3 — nothing reads the column.

**3. Worker — `src/x/workers/metricsPasses.ts` (new).** Hourly tick, `startMetricsPasses({intervalMin})`, `METRICS_PASSES_HEARTBEAT = 'x.metricsPasses'`, non-reentrant (a module-level `running` flag, the publisher's shape). Per tick:

```
if (cap <= 0) return                      // §7.3 — refuse before the candidate query
candidates = SELECT tweet_id, posted_at, is_reply, poll_count
             FROM posts_published
             WHERE retired = 1                     -- pass 1 already done
               AND poll_count >= 1 AND poll_count < PASS_MAX
               AND next_poll_at IS NOT NULL AND next_poll_at <= now
               AND posted_at >= now - PRIVATE_FIELDS_MAX_AGE_MS
             ORDER BY next_poll_at ASC
             LIMIT cap
UPDATE ... SET poll_count = poll_count + 1,
               next_poll_at = nextPollAfter(...),   -- per row
               last_seen_at = now
        WHERE tweet_id IN (ids)                     -- COMMITTED
found = await getTweetsByIds(token, ids, { ownedPrivate: true })   -- BILLED
insert one metrics_snapshots row per found tweet, ageAtSnapshotMin = real age
```

`poll_count >= 1` is the guard that keeps this worker off rows the daily pass hasn't retired yet — a row that somehow becomes due before pass 1 simply waits, and `snapshotDue`'s `retired = false` predicate stays untouched. `getTweetsByIds` caps at 100 ids per call (`endpoints.ts:264`), so the per-run cap must stay ≤ 100.

**Removal, same commit:** `rereadWinners` must be **deleted**, not left alongside. It claims the same `poll_count 1 → 2` transition, and two claimers on one counter is precisely the double-billing shape invariant #7 exists to prevent. Pass 3 subsumes it and removes its selection bias (it read only posts clearing `minViews`; pass 3 reads every original). Its two registry knobs (`x.workers.winnerRereadMinViews`, `x.workers.winnerRereadCap`) go with it.

**4. Registry knobs** (`src/x/settings/registry.ts`, the `WORKERS` group at L607–670):

| Key | Type | Default | Range | Scope | Why |
|---|---|---|---|---|---|
| `x.workers.metricsPassesIntervalMin` | number | 60 | 15–180 | server, `appliesOn:'restart'` | Tick cadence; `startXWorkers` reads it once (decision 10, no hot-reloading timers) |
| `x.workers.metricsPassCap` | number | 60 | 0–100 | server | Ids per run = the money bound, read at the **start of each run** so it lands without a restart. **0 disables all passes** before the candidate query |

**5. Measurement.** None added, deliberately (§7.19). The honest measure is that `SELECT poll_count, COUNT(*) FROM posts_published GROUP BY 1` stops being `{1: 1173}` — which the smoke asserts directly. No new Playbook cell: every existing cell is gated at n≥20 and none has 20 multi-pass rows until ~3 weeks after deploy.

## Decisions taken

1. **Hourly worker, 2 new passes (T+24h, T+7d). No T+1h.** *(User choice, 2026-08-03.)* A consistent-maturity reading needs a tick faster than the daily pass; hourly is the coarsest cadence that makes T+24h meaningful. T+1h was rejected because **nothing consumes it** — the surge-alarm surface was cut the same day. When a spike alarm is built, T+1h is one more entry in `PASS_LADDER`.
2. **No rolling-90d window, no expiry curve, no `x_impressions_window` MCP tool.** *(User choice, 2026-08-03.)* X's native analytics is authoritative for the gate number and is read weekly into `me_goals.currentValue` by hand. A second, worse estimate derived from our own snapshots is waste. This is why the plan is 5 tasks and not 12.
3. **No migration.** `poll_count` and `next_poll_at` both exist since `0000`. Claiming a vestigial column beats adding a duplicate one, and it keeps this plan out of the migration-journal serialization rule.
4. **`retired` stays `true` through the whole ladder.** The alternative — un-retiring rows so the existing partial index (`WHERE retired = 0`) applies — would put them back in `snapshotDue`'s candidate set and create a second claimer. The index therefore does **not** serve the new query; at ~1,200 rows scanned hourly that is irrelevant, and saying so is cheaper than a migration.
5. **No backfill.** Existing rows have `next_poll_at IS NULL` and stay out of the ladder forever. This is deliberate: a backfill would bill ~1,200 reads (~$1.20) for posts whose 30-day private-metrics window has mostly closed, to answer nothing. Multi-pass starts at the deploy and serves the experiment from Aug 4 forward.
6. **`next_poll_at` stamped at publish, not at pass 1.** Stamping at pass 1 would make T+24h arrive anywhere in a 24-hour band, which is the exact defect this plan exists to remove.
7. **The ±1h is tick granularity, not a promise.** `age_at_snapshot_min` records the real age on every row; consumers that need a tight window filter on it. A missed tick delays a reading, never duplicates or drops it.
8. **Replies get pass 2 but not pass 3.** Pass 2 on replies is what grades Track B (impressions/reply, baseline 17); a day-7 reply re-read would be $0.03/day to answer a question nobody asked. Same reasoning the current code applies at `dailyMetrics.ts:591–595`.
9. **No consumer thresholds are recalibrated in this plan.** Task 4 makes snapshot *selection* explicit and documents which cells will drift; retuning happens at the stated sample sizes (n≥20 multi-pass rows), never in the same change that moves the data.

## Done when

1. A post published after deploy carries **three** `metrics_snapshots` rows — one at 3–27h (the daily pass), one at ~24h, one at ~7d — and `SELECT poll_count, COUNT(*) FROM posts_published GROUP BY 1` shows rows at 2 and 3.
2. A reply published after deploy carries **two**, and its `next_poll_at` is `NULL` after pass 2.
3. No tweet is ever read twice for the same pass: the smoke forces a claim, kills the read, and asserts the row does not return to the candidate set.
4. `x.workers.metricsPassCap = 0` produces a tick that makes **no candidate query and no X call** (asserted in the worker suite).
5. `rereadWinners` and its two knobs are gone from the source, the registry, `registry.test.ts`'s exact lists, and `docs/settings-tab.md` — with no remaining reader of `poll_count = 1` as a claim.
6. `bun scripts/smoke-metrics-passes.ts` passes at $0; `--live` adds exactly one billed read (~$0.001) and asserts `non_public_metrics` came back non-null on an own post inside the 30-day window.

---

## Task 1: Pure pass ladder — `src/x/metrics/passes.ts`  [parallel-ok]
**Depends on:** none
**Session budget:** ~110 lines + ~160 test lines; 2 files (both new)

**Read first:**
- codemap header + §3.3 (the `src/x/` module layout), §7.13, §7.19
- `src/x/posts/manualReconcile.ts` — the house shape for a pure module with exported window constants and no clock of its own (callers pass `now`)
- `src/x/workers/dailyMetrics.ts:562–644` (`rereadWinners`) — the claim discipline this ladder generalizes; read its header comment in full
- This plan's **Design §1**

**Edit:**
- `src/x/metrics/passes.ts` (new) — `PassRung`, `PASS_LADDER`, `PASS_MAX`, `PASS_2_DELAY_MS`, `PASS_3_DELAY_MS`, `nextPollAfter`, `initialNextPollAt`
- `src/x/metrics/passes.test.ts` (new)

**How:**
`nextPollAfter(postedAt, completedPass, isReply)` walks `PASS_LADDER` for the first rung whose `pass > completedPass` and whose `includesReplies` is true when `isReply` is true; returns `new Date(postedAt.getTime() + rung.delayMs)`, or `null` when no rung qualifies. It must return `null` — never a past date, never a throw — for `completedPass >= PASS_MAX`, for a reply with `completedPass >= 2`, and for a nonsensical `completedPass` (negative, non-integer, `NaN`): a bad input takes the row **out** of the ladder rather than into an unbounded read loop. That direction is the whole safety argument, so state it in the module header.

`initialNextPollAt(postedAt)` is `postedAt + PASS_2_DELAY_MS`. Keep it a named export rather than inlining `+ 24h` at three call sites in Task 2.

Do **not** add a `dueRows` / query helper here — the candidate SELECT is Drizzle and belongs in the worker; a pure module that pretends to know SQL is the wrong seam. Do **not** import `db`, `drizzle-orm`, or anything from `src/x/workers/`.

**Tests:** `src/x/metrics/passes.test.ts` —
- ladder shape asserted literally: exactly two rungs, passes `[2,3]`, `includesReplies` `[true,false]`, and `PASS_MAX === 3` equal to the highest rung's `pass` (so adding a rung without moving `PASS_MAX` reddens)
- original: `completedPass 1` → `postedAt + 24h`; `2` → `postedAt + 7d`; `3` → `null`
- reply: `completedPass 1` → `postedAt + 24h`; `2` → **`null`** (the pass-3 exclusion)
- `0`, `-1`, `1.5`, `NaN`, `Number.MAX_SAFE_INTEGER` as `completedPass` → `null`, and no throw for any of them
- `initialNextPollAt` equals `nextPollAfter(postedAt, 1, false)` and `nextPollAfter(postedAt, 1, true)` — one arithmetic, three callers
- the returned Date is strictly after `postedAt` in every non-null case

**Done when:**
- [ ] Every branch in Design §1 has a test; the junk-input table proves no throw path
- [ ] Module imports nothing outside `node:` types — `grep -c "^import" src/x/metrics/passes.ts` is 0
- [ ] `bun test` + `bun run typecheck` + `bun run lint` green
- [ ] Committed: `feat(metrics): pure multi-pass ladder module`

**Cost note:** $0 — pure module, no DB, no network.

---

## Task 2: Stamp `next_poll_at` on the three write paths
**Depends on:** Task 1
**Session budget:** ~60 lines + ~70 test lines; 3 files

**Read first:**
- codemap header + §3.3 (workers), §4 (`posts_published` — note `next_poll_at` exists since `0000` and nothing writes it), §7.13 (**never bind a JS `Date` in a raw `` sql`` `` template — use Drizzle's `timestamp_ms` column**)
- `src/x/metrics/passes.ts` (Task 1) — `initialNextPollAt`
- `src/x/workers/dailyMetrics.ts:342–424` (`ingestPulledTweet` — the three-branch idempotent insert) and `:464–555` (`snapshotDue`)
- `src/x/workers/publisher.ts` — the `postsPublished` insert after a successful `createPost`
- `src/test.test.ts:320–390` — the two existing assertions that `nextPollAt` is null; **these are the tests this task inverts**

**Edit:**
- `src/x/workers/publisher.ts` — set `nextPollAt: initialNextPollAt(postedAt)` on the `postsPublished` insert
- `src/x/workers/dailyMetrics.ts` — same on `ingestPulledTweet`'s insert branch and on `snapshotDue`'s retire-update
- `src/test.test.ts` — update the two `toBeNull()` assertions to the stamped value

**How:**
This task is **deliberately inert**: nothing reads `next_poll_at` until Task 3, so it lands green and shippable on its own, and if the rest of the plan never ships the only effect is a populated column.

In `ingestPulledTweet`, stamp only on the **insert** branch and the **un-retired row** branch (the two that write a snapshot). The `already-retired` branch must stay a true no-op — it is the idempotency guard, and giving it a write would resurrect rows discovery has already finished with.

In `snapshotDue`, the stamp goes on the same `.set({ ... retired: true, ... })` update that already retires the batch — one write, not two. Rows in the `unserved` branch (X couldn't read them) are retired *without* a stamp: a tweet X won't return is not a candidate for two more attempts to read it.

Use `initialNextPollAt(postedAt)` at all three sites; do not inline the arithmetic. Where `postedAt` is not already in scope, take it from the row being written, never from `now` — the gate is relative to publication, not to discovery.

**Do NOT** touch `rereadWinners` in this task (Task 3 owns its deletion), and do not add the worker or the registry knobs here.

**Tests:** `src/test.test.ts` (the two inverted assertions) plus, in the same describe —
- a publisher-inserted row has `nextPollAt === postedAt + 24h`
- `ingestPulledTweet` on a new tweet stamps it; on an **already-retired** tweet writes nothing at all (assert `nextPollAt` unchanged from a deliberately-set sentinel value, not merely non-null)
- `snapshotDue`'s unserved branch retires with `nextPollAt` still null

**Done when:**
- [ ] All three write paths stamp; the already-retired no-op is proved by a sentinel, not by a null check
- [ ] `grep -n "24 \* 60 \* 60" src/x/workers/` shows no new inlined constant
- [ ] `bun test` + `bun run typecheck` + `bun run lint` green
- [ ] Committed: `feat(metrics): stamp next_poll_at at publish and discovery`

**Cost note:** $0 — column writes on rows already being written.

---

## Task 3: The `metricsPasses` worker + registry knobs + delete `rereadWinners`
**Depends on:** Task 1, Task 2
**Session budget:** ~230 lines + ~200 test lines; 6 files

**Read first:**
- codemap header + §3.3 (workers), §7.3 (refuse before spend), §7.8, §7.13, §8 (cost), §10 (recipe: new worker)
- **`src/x/workers/dailyMetrics.ts:562–644` (`rereadWinners`) in full** — this task both imitates and deletes it
- `src/x/workers/publisher.ts:37–70` + its tick loop — the `startX`/`stop`/`beat`/non-reentrancy shape to copy
- `src/x/index.ts::startXWorkers` — the registration block (heartbeat window derived from the interval, never hardcoded)
- `src/x/settings/registry.ts:607–670` (the `WORKERS` group) and `src/x/settings/registry.test.ts:200–320` (the **exact** group/key/restart-scope lists this task must update)
- `src/x/endpoints.ts:258–280` (`getTweetsByIds` — 100-id ceiling, `ownedPrivate`)
- This plan's **Design §3–§4** and **Decision 4**

**Edit:**
- `src/x/workers/metricsPasses.ts` (new) — `startMetricsPasses`, `runMetricsPasses`, `METRICS_PASSES_HEARTBEAT`
- `src/x/workers/metricsPasses.test.ts` (new)
- `src/x/workers/dailyMetrics.ts` — **delete** `rereadWinners`, its call site, its `RunResult.rereadWinners` field, `WINNER_REREAD_MIN_AGE_MS`, and the two `RunOptions` fields
- `src/x/settings/registry.ts` — remove the two winner knobs, add the two `metricsPasses` knobs
- `src/x/settings/registry.test.ts` — update the exact lists
- `src/x/index.ts` — import, `registerHeartbeat`, `startMetricsPasses`

**How:**
The tick body is Design §3, in that order. Four things carry the money argument and each needs a comment saying so:

1. **`cap <= 0` returns before the candidate query and before any write** (§7.3, and the same short-circuit `rereadWinners` opens with). "Off" must cost nothing and claim nothing.
2. **The claim UPDATE is committed before `getTweetsByIds`.** Per-row `next_poll_at` comes from `nextPollAfter(postedAt, poll_count, isReply)` — the *pre-increment* `poll_count` is the completed pass. Because the rows in one batch can be at different rungs, this is a per-row value: either a small `CASE` expression or a loop of single-row updates inside one `db.transaction` (sync callback, no `await` inside — §7.13). Prefer the transaction-of-updates; a batch of ≤100 single-row updates in one sync txn is microseconds and it is far easier to read than a generated `CASE`.
3. **`LIMIT cap` where cap ≤ 100** — `getTweetsByIds` throws above 100 ids and bills per id sent, so the cap knob IS the money bound (§7 #5's spirit: bound the request, not the iteration). Assert `max: 100` in the registry def.
4. **The snapshot inserts are best-effort per tweet** (§7.8) — a failed insert logs and continues; it must not abort the loop, because the read is already billed and the remaining rows' data would be thrown away.

Failures: wrap the candidate query and the `getTweetsByIds` call in try/catch and `return` (never throw out of a tick — a throwing worker kills the timer). A transient read failure after a successful claim **loses one reading and that is the intended trade** — say so in the header comment, in the same words `rereadWinners` used.

Heartbeat: `registerHeartbeat(METRICS_PASSES_HEARTBEAT, Math.max(5 * 60_000, intervalMin * 60 * 3_000))` — derive the staleness window from the interval exactly as the publisher does; a hardcoded window 503s `/healthz` the moment someone raises the knob, which also fails `deploy.sh`'s closing health check.

Deleting `rereadWinners` is **not optional and not deferrable**: it claims the same `poll_count 1 → 2` transition as pass 2, and two claimers on one counter is the double-billing shape. Grep for `rereadWinners` across `src/`, `scripts/`, and `docs/` and leave none — including the `RunResult` field, which `scripts/` and the smoke may print.

**Do NOT** add an API route, an MCP tool, or a panel surface for any of this (Decision 2 — the plan is a worker and nothing else). **Do NOT** backfill existing rows (Decision 5). **Do NOT** touch `snapshotDue`'s `retired = false` predicate.

**Tests:** `src/x/workers/metricsPasses.test.ts`, over the shared in-memory DB, with an injected fake `getTweetsByIds` (no network — the `openrouter/client.test.ts` injected-`fetchImpl` discipline) —
- `cap = 0` → the fake is never called **and** no row's `poll_count` moved (proves the short-circuit precedes the claim)
- an original at `poll_count 1`, `next_poll_at` in the past → claimed to 2, snapshot written, `next_poll_at` now `postedAt + 7d`
- the same row on the next tick is **not** a candidate (the claim is what removes it) — the core invariant-#7 assertion
- a **reply** at `poll_count 1` → claimed to 2 and `next_poll_at` becomes **`NULL`**; not a candidate ever again
- an original at `poll_count 2` past 7d → claimed to 3, `next_poll_at` `NULL`
- a row with `retired = 0` (pass 1 not done) is **never** a candidate even when `next_poll_at` is past
- a row with `next_poll_at IS NULL` is never a candidate (this is every pre-deploy row — the no-backfill guarantee)
- a row older than `PRIVATE_FIELDS_MAX_AGE_MS` is excluded
- **the claim survives a failed read**: fake throws → `poll_count` is still incremented and the row is not re-offered (the deliberate trade, pinned so a future "helpful" rollback reddens)
- one failing snapshot insert among three found tweets still writes the other two
- `LIMIT cap` respected with more due rows than the cap, ordered by `next_poll_at ASC` (oldest debt first)

**Done when:**
- [ ] Every case above green, especially "not re-offered after a failed read"
- [ ] `grep -rn "rereadWinners\|winnerReread" src scripts docs extension` returns nothing
- [ ] `registry.test.ts`'s exact key/group/restart lists updated and green
- [ ] `/healthz` reports `x.metricsPasses` beating after a local boot
- [ ] `bun test` + `bun run typecheck` + `bun run lint` green
- [ ] Committed: `feat(metrics): hourly multi-pass worker, replacing the winner re-read`

**Cost note:** **+$0.042/day** at steady state (36 ids at T+24h, 6 at T+7d, $0.001 each), **−$0.005/day** from the deleted winner re-read. Bounded by `metricsPassCap` × $0.001 per run; cap 0 spends nothing.

---

## Task 4: Snapshot-selection audit — make "which reading" explicit
**Depends on:** Task 3
**Session budget:** ~120 lines + ~80 test lines; ~4 files

**Read first:**
- codemap header + §3.3, §7.19 (measurement gates nothing), §7.33 (validate a borrowed claim against reality)
- **`src/x/coach/reach.ts:20–45`** — the header comment explaining why it reads the **FIRST** snapshot ("25 of 135 measured originals carry a second snapshot, and those 25 are the winner re-reads … so 'latest' is not one protocol"). **That reasoning is invalidated by this plan** and the header must be corrected.
- `src/x/routes/playbook.ts`, `src/x/routes/coach.ts`, `src/x/routes/goals.ts` — the other three modules that select among multiple snapshots
- The full consumer list: `grep -rln metricsSnapshots src/x | grep -v test` (14 files)

**Edit:**
- `src/x/metrics/passes.ts` — add `SnapshotChoice = 'first' | 'latest' | 'nearest24h'` and a pure `pickSnapshot(rows, choice, postedAt)` helper (rows carry `ageAtSnapshotMin`), so selection is one named function instead of four ad-hoc `ORDER BY`s
- `src/x/coach/reach.ts` — **header comment only** unless the audit finds a real break; the selection stays `first`
- `docs/` — a new `docs/metrics-passes.md` (Task 5 owns the write-up; this task supplies the audit table)

**How:**
Walk all 14 consumers and classify each as: (a) reads a single snapshot per tweet and is unaffected, (b) takes newest-first and will now see **more mature, larger** numbers, (c) explicitly takes first and is unaffected. Record the table — it is the deliverable, more than the code is.

`reach.ts` stays on `first`. Its *reason* changes (the winners-only selection bias is gone) but the *choice* is still right: `first` is the only reading every post has, including the ~1,200 pre-deploy rows, and switching it now would silently re-baseline a fitted band mid-experiment. Correct the header to say the choice is now about corpus continuity rather than selection bias, and note the revisit condition.

**No threshold is retuned in this task** (Decision 9). Where a category-(b) consumer's numbers will drift upward, add a one-line comment naming the recalibration trigger (n≥20 rows carrying a pass-2 snapshot), consistent with "thresholds ship as opening guesses, recalibrated only at the stated sample sizes, never by vibes."

**Do NOT** change any gate value, band cut point, or median threshold in this task. **Do NOT** rewrite the four `ORDER BY` sites to use `pickSnapshot` unless a site is genuinely broken — introducing the helper and migrating every caller in one commit is two changes wearing one hat.

**Tests:** in `src/x/metrics/passes.test.ts` — `pickSnapshot` over a 3-row fixture: `first`/`latest` pick the expected rows; `nearest24h` picks the row whose `ageAtSnapshotMin` is closest to 1440 including a tie (lower age wins, pinned); a 1-row input returns that row for all three choices; an empty input returns `null`.

**Done when:**
- [ ] All 14 consumers classified in a table that ships in the plan's docs page
- [ ] `reach.ts`'s header no longer states a rationale this plan falsified
- [ ] `pickSnapshot` exists and is tested; no consumer's numeric output changed in this commit (assert by running `bun test` — the suites that pin exact medians must be untouched)
- [ ] `bun test` + `bun run typecheck` + `bun run lint` green
- [ ] Committed: `refactor(metrics): explicit snapshot selection + consumer audit`

**Cost note:** $0 — read-time SQL over already-billed data.

---

## Task 5 (final): smoke + docs-sync
**Depends on:** all prior
**Session budget:** ~1 new script + 5 doc files

- [ ] `scripts/smoke-metrics-passes.ts` — rerunnable, **$0 by default with a `--live` flag** (the D171c question, answered *yes*: unlike `smoke-humanizer.ts`, this worker reaches `xFetch`, and only a real call proves `getTweetsByIds` still returns non-null `non_public_metrics` for an own post inside the 30-day window). The $0 half: seed a `__smoke_pass__` original and a reply with `poll_count = 1, retired = 1, next_poll_at` in the past → run one tick with an injected fake → assert both claimed, the original's `next_poll_at` moved to +7d, the reply's is `NULL`, and **a second tick offers neither** (the invariant-#7 assertion). Then `cap = 0` → no claim, no call. **Read back after every write** (the RC.5 lesson — a green call is not proof a column moved). Restore/cleanup fires the instant the DB half ends, including on failure. `--live` adds exactly one real read of one own tweet (~$0.001) and asserts the private fields came back.
- [ ] `docs/metrics-passes.md` (new) — the ladder, the claim model, the money bound, the two knobs, Task 4's consumer table, and an explicit "existing rows are never backfilled and that is deliberate".
- [ ] `docs/settings-tab.md` — the two new knobs in, the two winner knobs out.
- [ ] `docs/PHASE-HISTORY.md` — the phase entry: what shipped, the date, the +$0.037/day, and the load-bearing finding (**`next_poll_at` had been a vestigial indexed column since migration `0000`, so goal 2's multi-pass design needed no migration — only a worker**).
- [ ] `PLAN.md` — phase blockquote under goal 2.
- [ ] `CLAUDE.md` — **only** if a guardrail changed. It does not: invariant #7's text already covers per-pass claiming. Leave it and say so in the commit body.
- [ ] `.claude/skills/plan-feature/references/codemap.md` — §3.3 (the new worker + `rereadWinners` gone from `dailyMetrics`), §3.1/§3.3 (`src/x/metrics/passes.ts`), §4 (`next_poll_at`/`poll_count` semantics; **migrations still through `0025`** — this plan adds none), §7 (the per-pass claim as a named pattern), §9 (smoke count 33 → 34), §11 (update-log entry), header re-stamped. **Re-count every number from the repo at commit time** — do not carry forward the counts this plan was written against (the D164a trap).

## Out of scope (do NOT build)

- **The rolling-90d window card, the expiry curve, the `x_impressions_window` MCP tool.** Decision 2. Adding an MCP tool would also bump `src/mcp.test.ts`'s exact asserted 23 and three counts in `docs/s2-mcp-server.md`.
- **A T+1h pass or any surge/spike alarm.** Decision 1 — add the rung when a consumer exists.
- **Backfilling the ~1,200 existing rows.** Decision 5.
- **Any API route, panel tab, or Today card.** This plan is a worker and a pure module.
- **Retuning band cut points, Playbook gates, or `reach.ts`'s fitted base** to match the new maturity. Decision 9 — recalibrate at n≥20, in its own change.
- **A migration.** If any task finds itself running `db:generate`, the design has drifted — stop and re-read Decision 3.

## Risks / watch items

1. **Two claimers on `poll_count` is the failure mode of this entire plan.** `rereadWinners` must die in the same commit that adds pass 2 (Task 3). If Task 3 is split across sessions, the intermediate state double-reads every winner at day 7. The grep in Task 3's done-when is the guard.
2. **Category-(b) consumers will show larger numbers from deploy day.** Medians, band calibration, and Playbook cells that take the newest snapshot are now reading T+7d instead of T+16h. Nothing breaks, but a mid-experiment step-change in a chart is *this deploy*, not a content effect — Task 4's table is what lets a future session tell those apart, and it is why the deploy should land **before** Aug 4 or **after** Aug 10, not mid-week.
3. **The 30-day private-metrics window is a hard edge.** Pass 3 at T+7d is comfortably inside it; if a rung is ever added past ~25 days, `non_public_metrics` returns null and the reading is worth less than it costs. `PRIVATE_FIELDS_MAX_AGE_MS` bounds the candidate query, so the failure is a skipped read, not a wasted one.
4. **The partial index does not serve the new query** (Decision 4). At ~1,200 rows this is noise; if `posts_published` ever reaches six figures, the fix is an index on `(next_poll_at)` without the `retired = 0` predicate — a migration, deliberately deferred.
5. **Hourly ticks mean at most 24 candidate queries a day at $0**, but a stuck token turns each into a logged failure. The heartbeat is what surfaces that; `/healthz` must 503 if the worker stops beating, exactly as it does for the publisher.
6. **Rollback story:** every layer is independently removable. Task 3 alone → set `x.workers.metricsPassCap = 0` (no restart needed, it is read per run) or drop the `startMetricsPasses` line from `startXWorkers`; the column stays populated and inert. Task 2 alone → `next_poll_at` is written and read by nothing. Task 1 alone → an unimported pure module. Shipping Tasks 1–2 and stopping leaves the repo green with a stamped column and no behavior change; shipping 1–3 and stopping leaves a working ladder with no consumer audit, which is safe but leaves risk 2 undocumented.
