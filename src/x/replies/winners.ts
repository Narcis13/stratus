// RC.6 — the measured few-shot: MY replies that actually worked, selected by
// ROOM.
//
// The post drafter has shipped `{{MY_WINNERS}}` since day one; the reply drafter
// never had an equivalent, so RC.1's twenty negative rules ("no em dashes", "no
// antithesis", "no tricolon"…) had nothing positive to pull against. Ground
// truth in my own voice is the counterweight, and it is the single highest-value
// humanization lever in the plan — a model shown three replies that earned
// 19,088 / 3,486 / 2,248 views writes the fourth one in that register far more
// reliably than one told twenty things not to do.
//
// Cost: $0. `latestOwnReplyRows` reads `harvest_rows` — DOM-scraped for free —
// and the attribution below is the same $0 SQL + pure detection the drafting
// path already runs. Nothing here can reach xFetch or an LLM. Both routes call
// it INSIDE the refuse-before-spend ladder, after the band gate (§7.4).
//
// WHY THIS IS A RENDERED TAIL VALUE AND NOT A `{{REPLY_WINNERS}}` TEMPLATE TOKEN
// (the plan names the token; the cost argument in its own §Design overrules the
// name): the winners are selected PER MODE, so they vary per call. A varying
// block substituted into the template head would bust the cacheable prefix on
// every single reply call — exactly what RC.5 put the mode clause at the tail to
// avoid. So the winners ride where the mode rides, and after RC.1 `reply
// prompt.md` and both TS literals still do not move again in this plan (§7.14).
//
// ATTRIBUTION IS DERIVED AT READ TIME, from the CURRENT roster and the current
// table — `loadOwnReplyPerformance`'s arm axis is the precedent and the reason
// is the same: a stored mode column on `harvest_rows` would go stale the moment
// a handle is pinned or the taxonomy moves, and these rows were harvested before
// the taxonomy existed at all.
//
// §7.11 runs through the selection. A row whose scrape MISSED the parent cannot
// be placed in a room, and a row whose parent resolves only by `fallback` was
// not placed either — `general` there means "nothing answered", not "this is a
// general-room exemplar". Both are dropped rather than guessed into a room, so a
// `general` draft gets a few-shot only from parents actually pinned `general`.
// Fewer examples, none of them mislabeled.

import { type LanguageProfile, detectScript } from '../../shared/language.ts';
import type { ReplyModeId } from '../../shared/replyMode.ts';
import { configuredSelfHandle, latestOwnReplyRows } from '../routes/playbook.ts';
import { resolveReplyMode } from './mode.ts';

/** One measured exemplar, ready to render. `views` is the yield the reply
 *  actually earned — never a prediction, never a score. */
export interface ReplyWinner {
  mode: ReplyModeId;
  text: string;
  views: number;
}

/** How far back the pool reaches. Wider than the Playbook's 14-day §2.2 window
 *  on purpose: that one measures a CURRENT rate, where stale rows are noise;
 *  this one wants the best writing I have, and a great reply from three weeks
 *  ago is still a great reply. Opening guess (§7.19). */
const WINDOW_DAYS = 21;
/** The floor under "winner". The 2026-08-07 baseline is 183 views/reply, so a
 *  reply under 50 views underperformed the corpus by ~3.7× and showing it as
 *  something that worked teaches the wrong shape. Opening guess (§7.19) —
 *  recalibrate off `loadOwnReplyPerformance`, never by feel. */
const MIN_WINNER_VIEWS = 50;
/** Plan says 4–6 per room; 5 is the middle, and matches `MAX_WINNERS` on the
 *  post drafter's `{{MY_WINNERS}}`. */
const MAX_PER_MODE = 5;
/** Rows considered before attribution, highest-yield first. Bounds the work at a
 *  constant regardless of how big the harvest corpus grows — a reply outside the
 *  top 200 of three weeks is not going to be anyone's exemplar. */
const MAX_POOL = 200;
/** A runaway row (a scrape that swallowed a thread) is not a reply exemplar. */
const MAX_WINNER_CHARS = 320;

export interface LoadReplyWinnersOptions {
  /** The resolved language profile for this call (ML.3). A few-shot must be in
   *  the language being written: an English winner under a "write in Japanese"
   *  instruction is a contradiction the model gets to arbitrate. `null`/absent =
   *  the English path, which keeps only replies `detectScript` cannot place —
   *  i.e. Latin and unknown — so a Japanese winner never leaks into it. */
  profile?: LanguageProfile | null;
  windowDays?: number;
  perMode?: number;
}

/**
 * The best measured replies for each of `modes`, grouped in the order the modes
 * were asked for (queue order in the batch, so the block reads in the order the
 * legend does) and sorted by yield inside each group.
 *
 * The single path asks for one mode; the batch asks for the distinct rooms in
 * its queue. One function, so the two cannot select differently (§7.16).
 */
export async function loadReplyWinners(
  modes: readonly ReplyModeId[],
  opts?: LoadReplyWinnersOptions,
): Promise<ReplyWinner[]> {
  const wanted = new Set(modes);
  if (wanted.size === 0) return [];

  // §7.11 again, and the same answer `loadOwnReplyPerformance` gives: an unset
  // handle means the server does not know who I am, which is a different fact
  // from "no replies". Someone else's corpus is not an answer.
  const selfHandle = configuredSelfHandle();
  if (selfHandle === '') return [];

  const windowDays = opts?.windowDays ?? WINDOW_DAYS;
  const perMode = opts?.perMode ?? MAX_PER_MODE;
  const profile = opts?.profile ?? null;

  const rows = await latestOwnReplyRows(selfHandle, Date.now() - windowDays * 24 * 60 * 60 * 1000);

  const eligible = rows
    .filter((r) => {
      const text = r.text.trim();
      if (text === '' || text.length > MAX_WINNER_CHARS) return false;
      if (r.views < MIN_WINNER_VIEWS) return false;
      // A parent we never scraped cannot be placed in a room (§7.11).
      if (!r.parentText || r.parentText.trim() === '') return false;
      // The few-shot must be written in the language of the call — see
      // `LoadReplyWinnersOptions.profile`. `detectScript` answers `null` for
      // Latin, which IS the English bucket here rather than an unknown.
      return (detectScript(text)?.code ?? null) === (profile?.code ?? null);
    })
    .sort((a, b) => b.views - a.views);

  // Dedup runs AFTER the sort, never inside the filter: "congrats" replied under
  // nine posts is one exemplar, and it should be the copy that did BEST, not
  // whichever row the query happened to return first.
  const seenText = new Set<string>();
  const pool: typeof eligible = [];
  for (const r of eligible) {
    const key = r.text.trim().toLowerCase().replace(/\s+/g, ' ');
    if (seenText.has(key)) continue;
    seenText.add(key);
    pool.push(r);
    if (pool.length >= MAX_POOL) break;
  }
  if (pool.length === 0) return [];

  // One call, so the per-handle memo inside the resolver holds across the whole
  // pool: a camped roster of nine accounts is nine SELECTs, not 200.
  const resolved = await resolveReplyMode({
    targets: pool.map((r) => ({ handle: r.parentHandle ?? '', text: r.parentText ?? '' })),
  });

  const byMode = new Map<ReplyModeId, ReplyWinner[]>();
  for (const [i, row] of pool.entries()) {
    const r = resolved[i];
    // `fallback` = nothing answered; see the header on why that is not `general`.
    if (!r || r.source === 'fallback') continue;
    const id = r.mode.id;
    if (!wanted.has(id)) continue;
    const group = byMode.get(id) ?? [];
    if (group.length >= perMode) continue;
    group.push({ mode: id, text: row.text.trim(), views: row.views });
    byMode.set(id, group);
  }

  // Requested order out — `pool` is already yield-sorted, so each group is too.
  const out: ReplyWinner[] = [];
  for (const id of modes) {
    if (out.some((w) => w.mode === id)) continue; // a repeated request id
    out.push(...(byMode.get(id) ?? []));
  }
  return out;
}

/** §7.8: a side-hook failure never fails the paying path. No winners is the
 *  ordinary state anyway (an empty harvest, a fresh DB), so the drafting call
 *  proceeds exactly as it did before RC.6. */
export async function loadReplyWinnersSafe(
  modes: readonly ReplyModeId[],
  opts?: LoadReplyWinnersOptions,
): Promise<ReplyWinner[]> {
  try {
    return await loadReplyWinners(modes, opts);
  } catch (err) {
    console.error(
      'replies: winners lookup failed (the draft proceeds without them):',
      err instanceof Error ? err.message : err,
    );
    return [];
  }
}
