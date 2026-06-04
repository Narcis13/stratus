// Pure scoring for the on-page "reply now" highlight — no DOM, unit-testable.
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

export type Band = 'hot' | 'warm' | 'skip' | null;

export interface TweetSignals {
  views: number;
  replies: number;
  ageMin: number; // minutes since the post went up
  vpm: number; // views per minute = views / max(ageMin, 1)
  bait: boolean; // question / poll / take-bait format
}

export const BAND = {
  bigViews: 300, // floor to be "worth a reply" (recal 800->300, see header)
  baitViews: 180, // lower floor when the post is reply-bait (stays below bigViews)
  earlyReplies: 40, // still near the top of the thread
  midReplies: 120, // past this you're buried in the thread
  freshMin: 15, // the "early reply" window
  risingVPM: 20, // views/min that projects into the band while still fresh
  baitVPM: 12, // relaxed rising bar for bait
  watchVPM: 8, // promising-but-unproven velocity
} as const;

export function classifyBand(s: TweetSignals): Band {
  const { views, replies, ageMin, vpm, bait } = s;
  const fresh = ageMin <= BAND.freshMin;

  if (replies > BAND.midReplies) return 'skip'; // deep thread, you'd be buried
  if (ageMin > 20 && views < 300 && vpm < 15 && !bait) return null; // too small, won't grow (aligned to bigViews floor)

  const viewFloor = bait ? BAND.baitViews : BAND.bigViews;
  const vpmFloor = bait ? BAND.baitVPM : BAND.risingVPM;
  const bigEnough = views >= viewFloor || (fresh && vpm >= vpmFloor);
  const earlyEnough = replies <= BAND.earlyReplies;

  if (bigEnough && earlyEnough) return 'hot';
  if (bigEnough && replies <= BAND.midReplies) return 'warm'; // good size, mid-pack
  if (fresh && vpm >= BAND.watchVPM && replies <= 25) return 'warm'; // early, promising
  return null;
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
