// The hype reel's pure animation core — the count-up math behind the Studio's
// "Hype reel" button (a full-panel, screen-recordable animation of one of my
// own posts' metrics climbing from zero to what the DOM harvest measured).
//
// Pure on purpose, per the extension's split: the numbers a frame shows are a
// function of elapsed time alone, so they're fixture-testable here and the
// React shell only owns requestAnimationFrame and pixels. No clock is read in
// this module.

/** One counter in the reel, with the real number it climbs to. */
export interface HypeMetric {
  key: string;
  label: string;
  target: number;
}

export interface HypeTiming {
  /** How long a single counter takes to reach its target. */
  durationMs: number;
  /** Head start between consecutive counters, so they land in sequence. */
  staggerMs: number;
  /** Dead air before the first counter moves — room for the text to read. */
  leadInMs: number;
  /** Held on the final numbers before `hypeDone` reports true. */
  holdMs: number;
}

export const DEFAULT_TIMING: HypeTiming = {
  durationMs: 2600,
  staggerMs: 320,
  leadInMs: 500,
  holdMs: 1400,
};

/** Fast start, long glide into the final number — the odometer feel. */
export function easeOutExpo(t: number): number {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  return 1 - 2 ** (-10 * t);
}

/** 0..1 for the counter at `index`, given the reel's elapsed time. */
export function metricProgress(elapsedMs: number, index: number, timing: HypeTiming): number {
  const start = timing.leadInMs + index * timing.staggerMs;
  if (elapsedMs <= start) return 0;
  if (timing.durationMs <= 0) return 1;
  return Math.min(1, (elapsedMs - start) / timing.durationMs);
}

/** The number on screen at `progress`. Rounded UP so the counter reaches its
 *  target exactly at the end instead of a frame early, and so a target of 1
 *  spends the whole animation on 1 rather than flicking 0 → 1 at the finish. */
export function countUpValue(target: number, progress: number): number {
  if (progress <= 0) return 0;
  if (progress >= 1) return target;
  return Math.ceil(target * easeOutExpo(progress));
}

export interface HypeFrameCell extends HypeMetric {
  value: number;
  progress: number;
}

/** Every counter's state for one frame. Order is the order handed in — the
 *  stagger is positional, so the caller controls which number lands first. */
export function hypeFrame(
  metrics: HypeMetric[],
  elapsedMs: number,
  timing: HypeTiming = DEFAULT_TIMING,
): HypeFrameCell[] {
  return metrics.map((m, i) => {
    const progress = metricProgress(elapsedMs, i, timing);
    return { ...m, progress, value: countUpValue(m.target, progress) };
  });
}

/** Total wall time of a reel with `count` counters, including lead-in and hold. */
export function hypeDurationMs(count: number, timing: HypeTiming = DEFAULT_TIMING): number {
  const last = Math.max(0, count - 1);
  return timing.leadInMs + last * timing.staggerMs + timing.durationMs + timing.holdMs;
}

export function hypeDone(
  count: number,
  elapsedMs: number,
  timing: HypeTiming = DEFAULT_TIMING,
): boolean {
  return elapsedMs >= hypeDurationMs(count, timing);
}

/** Compact display form — 1234 → "1,234", 12345 → "12.3K", 1234567 → "1.23M".
 *  Thousands only kick in above 10K so a mid-count number doesn't jitter
 *  between "9,999" and "10.0K" on every frame. */
export function formatHypeCount(n: number): string {
  if (!Number.isFinite(n)) return '0';
  const v = Math.max(0, Math.trunc(n));
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(2)}M`;
  if (v >= 10_000) return `${(v / 1000).toFixed(1)}K`;
  return v.toLocaleString('en-US');
}

/** Metric row of the reel, in landing order: the headline number first, then
 *  the engagement counters. A zero still gets a tile — "0 reposts" is a fact,
 *  and dropping it would reshuffle the grid between posts. */
export function hypeMetrics(post: {
  views: number;
  likes: number;
  replies: number;
  reposts: number;
  bookmarks: number;
}): HypeMetric[] {
  return [
    { key: 'views', label: 'views', target: post.views },
    { key: 'likes', label: 'likes', target: post.likes },
    { key: 'replies', label: 'replies', target: post.replies },
    { key: 'reposts', label: 'reposts', target: post.reposts },
    { key: 'bookmarks', label: 'bookmarks', target: post.bookmarks },
  ];
}

/** Engagement rate over views, as a percentage — the reel's closing line.
 *  null when views is 0: a rate over a zero denominator is a fabricated number,
 *  not a 0%. */
export function hypeEngagementPct(post: {
  views: number;
  likes: number;
  replies: number;
  reposts: number;
  bookmarks: number;
}): number | null {
  if (post.views <= 0) return null;
  const acts = post.likes + post.replies + post.reposts + post.bookmarks;
  return Math.round((acts / post.views) * 1000) / 10;
}

/** Bar height 0..1 for the sparkline that grows under the counters — the same
 *  eased curve, so the bar and the number move together. */
export function hypeBars(count: number, progress: number): number[] {
  const eased = easeOutExpo(Math.min(1, Math.max(0, progress)));
  return Array.from({ length: count }, (_, i) => {
    // Each bar completes at its own point along the reel, left to right.
    const at = (i + 1) / count;
    return Math.min(1, eased / at) * at;
  });
}
