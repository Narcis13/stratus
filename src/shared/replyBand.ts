// Pure scoring for reply-target selection — no DOM, unit-testable.
//
// Canonical home (OVERHAUL-PLAN §7.3): consumed by BOTH the extension's
// on-page badge (via the re-export shim extension/src/replyBand.ts, inlined by
// Vite) and the server-side band gate in /x/replies/generate, so the two can
// never disagree on thresholds.
//
// Orients reply effort toward the 1k–8k-view sweet spot found in
// evals/reply-eval-*.md. The model:
//   - reply count is the "am I too late" gate (a deep thread buries you);
//   - views + velocity decide "is it big enough to matter";
//   - reply-bait formats (questions/polls) earn a lower bar, since they pull
//     the threads where an early sharp reply gets seen.
//
// Thresholds recalibrated (2026-06-04) against a 345-reply OUTCOME set from
// @santoshstack (evals/santoshstack_replies.csv, analyzed in
// evals/analyze-santoshstack.ts): tweets the model tagged hot/warm earned a
// median 49 reply-views vs 14 for null, at a 55% vs 12% hit-rate, and only 1 of
// 51 'hot' calls flopped. The view floor came DOWN 800->300 because the
// 300-1k-view band is where his replies actually landed (median 44 reply-views,
// clearing the hit bar); <300 stayed the dead zone (median 12). Freshness was a
// WEAK predictor here (reply-views peaked at 15m-3h, not <15m), so don't lean on
// the velocity paths. Still one account over ~6 days, and original metrics were
// scraped after the fact (so inflated for older posts) — re-check against your
// own logged HOT outcomes before trusting the margins.
//
// UI.7 made every threshold a settings knob (`x.band.*`, all mirrored to the
// extension). The numbers below are the shipped defaults and the fallback both
// sides degrade to; §7.19 is unchanged — a recalibration is still a deliberate
// edit at >=100 measured replies, the knobs only remove the rebuild.

export type Band = 'hot' | 'warm' | 'skip' | null;

export interface TweetSignals {
  views: number;
  replies: number;
  ageMin: number; // minutes since the post went up
  vpm: number; // views per minute = views / max(ageMin, 1)
  bait: boolean; // question / poll / take-bait format
}

/** Every number the classifier reads. UI.7 made these configurable
 *  (`x.band.*`), so they arrive as an ARGUMENT on both sides of the wire — the
 *  server resolves them from the settings store, the page from the mirrored
 *  blob. This module stays dependency-free (Vite inlines it into the content
 *  script IIFE, §7.26), so it must never read a store or chrome.storage itself. */
export interface BandThresholds {
  bigViews: number;
  baitViews: number;
  earlyReplies: number;
  midReplies: number;
  freshMin: number;
  risingVPM: number;
  baitVPM: number;
  watchVPM: number;
  tooSmallAgeMin: number;
  tooSmallViews: number;
  tooSmallVpm: number;
  watchReplyCeiling: number;
}

export const BAND: BandThresholds = {
  bigViews: 300, // floor to be "worth a reply" (recal 800->300, see header)
  baitViews: 180, // lower floor when the post is reply-bait (stays below bigViews)
  earlyReplies: 40, // still near the top of the thread
  midReplies: 120, // past this you're buried in the thread
  freshMin: 15, // the "early reply" window
  risingVPM: 20, // views/min that projects into the band while still fresh
  baitVPM: 12, // relaxed rising bar for bait
  watchVPM: 8, // promising-but-unproven velocity
  // The "won't grow" early return, hoisted out of the classifier body at UI.7:
  // ONE rule spelled in three numbers — past this age, under this many views,
  // at under this velocity, a non-bait post is dead. tooSmallViews shadows
  // bigViews by design (both are 300); they are separate knobs because raising
  // the "worth a reply" floor should not silently widen the dead zone.
  tooSmallAgeMin: 20,
  tooSmallViews: 300,
  tooSmallVpm: 15,
  // Ceiling on the fresh-and-rising 'warm' path: promising velocity stops
  // mattering once the thread already has a crowd.
  watchReplyCeiling: 25,
};

export function classifyBand(s: TweetSignals, t: BandThresholds = BAND): Band {
  const { views, replies, ageMin, vpm, bait } = s;
  const fresh = ageMin <= t.freshMin;

  if (replies > t.midReplies) return 'skip'; // deep thread, you'd be buried
  if (ageMin > t.tooSmallAgeMin && views < t.tooSmallViews && vpm < t.tooSmallVpm && !bait) {
    return null; // too small, won't grow
  }

  const viewFloor = bait ? t.baitViews : t.bigViews;
  const vpmFloor = bait ? t.baitVPM : t.risingVPM;
  const bigEnough = views >= viewFloor || (fresh && vpm >= vpmFloor);
  const earlyEnough = replies <= t.earlyReplies;

  if (bigEnough && earlyEnough) return 'hot';
  if (bigEnough && replies <= t.midReplies) return 'warm'; // good size, mid-pack
  if (fresh && vpm >= t.watchVPM && replies <= t.watchReplyCeiling) return 'warm'; // early, promising
  return null;
}

const BAIT_PHRASES =
  /\b(agree or disagree|what'?s your|which one|be honest|your take|hot take|thoughts\??|am i wrong|change my mind|guess the)\b/i;

// Text-only half of the bait check, shared so the server-side gate scores the
// same way as the badge. The extension layers a DOM poll check on top
// (content.ts::looksLikeReplyBait) — polls aren't recoverable from text alone.
export function textLooksLikeReplyBait(text: string): boolean {
  const t = text.trim();
  if (/\?$/.test(t)) return true; // ends on a question
  return BAIT_PHRASES.test(t);
}

export const BAND_LABEL: Record<'hot' | 'warm' | 'skip', string> = {
  hot: 'reply now',
  warm: 'watch',
  skip: 'buried',
};

// "1541" -> "1.5k", "70000" -> "70k", "500" -> "500", "2100000" -> "2.1M".
export function formatCount(n: number): string {
  if (n >= 1e6) return `${(n / 1e6).toFixed(1).replace(/\.0$/, '')}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1).replace(/\.0$/, '')}k`;
  return String(n);
}
