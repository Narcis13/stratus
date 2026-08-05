// Pure scoring for the Cannon queue — the arbitrage reading of the radar buffer.
//
// Canonical home, `replyBand.ts`'s twin: consumed by BOTH the extension's Cannon
// view (via the re-export shim extension/src/cannon.ts, inlined into the content
// IIFE by Vite) and the server-side cannon routes, so the two can never disagree
// on what "worth arbitraging" means (§7.26/7.27). Dependency-free by contract —
// the only import is a TYPE, erased at build time.
//
// The model, in one line: `views / (replies + 1)`. A post with a lot of eyes and
// almost no replies is a slot where an early reply is actually read; a post with
// a crowd already under it is not, whatever its size. It deliberately knows
// nothing about the author — author size is a $0.010 lookup that measures the
// wrong axis (a 200k account's dead post is worth less than a 2k account's live
// one). The `+ 1` is both the divide-by-zero guard and the source
// measurement's own formula; it is not `max(replies, 1)`.
//
// CORPUS REPLAY (§7.33), run 2026-08-05 before these defaults shipped, over the
// S1 explorer ($0, read-only SQL): every `harvest_rows` row with
// `mode IN ('timeline','posts')` captured in the last 30 days — **1,841 rows,
// 296 handles, 2026-07-16 → 2026-08-04** (1,650 distinct tweets). Per-row
// `views/(comments+1)`:
//
//   p50 45.3 · p75 65.8 · p90 120.5 · p95 270.0 · p99 3977.3 · max 30691.3
//   clearing 5,000: **0.60%** (11 rows) · 2,000: 1.74% · 1,000: 2.93% · 500: 3.91%
//   (deduped to one row per tweet: p90 127.7, clearing 5,000 0.61%)
//
// So the 5,000 floor carried over from the source plan is **NOT shipped**: at
// 0.60% it sits under the ~2% bar and would have made the Cannon view empty on
// almost every session — a floor nothing crosses is indistinguishable from a
// broken feature (the SC.6 lesson). The shipped `scoreMin` is the measured
// **p90 of that corpus, 120.5, rounded to 120** — the top decile of what we
// actually see, which is what "worth arbitraging" has to mean here.
//
// Two caveats a recalibration should start from: (a) harvest rows are captured
// at arbitrary post ages while the queue only ever scores posts under
// `maxAgeMin`, and young posts carry both fewer views and fewer replies, so the
// live distribution may sit elsewhere; (b) the same corpus scored the ROSTER way
// (median(views)/(median(comments)+1) per handle, ≥5 posts, 37 handles) runs
// p50 33.8 / p90 100.2 / max 3,359 — the roster floor and the per-sighting floor
// are the same knob today, and if the two distributions keep diverging they want
// splitting rather than a compromise value.
//
// All four numbers are settings knobs (`x.cannon.*`, all mirrored), so they
// arrive as an ARGUMENT on both sides of the wire — this module never reads a
// store. §7.19 stands: recalibrate from a replay like the one above, never by
// feel.

import type { TweetSignals } from './replyBand.ts';

/** Every number the Cannon reads. UI.7's rule: the registry defaults ARE this
 *  constant, and the group is asserted to be exactly this shape. */
export interface CannonThresholds {
  /** Minimum views-per-reply for a sighting to be cannon-eligible. */
  scoreMin: number;
  /** Minutes past which a sighting leaves the queue entirely. */
  maxAgeMin: number;
  /** Minutes past which the displayed age renders red (still eligible). */
  redAgeMin: number;
  /** The Cannon head's own "placed today" stretch number — display only. */
  placedTarget: number;
}

export const CANNON: CannonThresholds = {
  scoreMin: 120, // measured p90, NOT the borrowed 5,000 — see the replay above
  maxAgeMin: 30, // opening guess: past half an hour the slot is gone
  redAgeMin: 15, // opening guess: the same freshness window BAND uses
  placedTarget: 18, // opening guess: the Cannon head's own stretch number
};

/** Views per reply — the whole model. `replies + 1` is the zero guard AND the
 *  source formula; do not "fix" it to `max(replies, 1)`. */
export function cannonScore(s: TweetSignals): number {
  return s.views / (s.replies + 1);
}

/** Fresh enough AND dense enough to be worth a reply slot. Deliberately does NOT
 *  know about roster membership — that half needs the people layer, and this
 *  module has to stay dependency-free for the content IIFE. */
export function isCannonEligible(s: TweetSignals, t: CannonThresholds = CANNON): boolean {
  return s.ageMin <= t.maxAgeMin && cannonScore(s) >= t.scoreMin;
}

/** How the displayed age renders. Strict `>` — exactly `redAgeMin` still reads
 *  'ok', mirroring how the glance thresholds read their boundary. */
export function cannonAgeTone(ageMin: number, t: CannonThresholds = CANNON): 'ok' | 'red' {
  return ageMin > t.redAgeMin ? 'red' : 'ok';
}
