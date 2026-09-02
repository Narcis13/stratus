// Calibrate the E-score reference against OUR corpus (XR.3) — §7.33/§7.34.
//
//   bun run scripts/calibrate-ranker.ts        # $0, read-only, rerunnable
//
// `X_OBSERVED_RATES` in `src/shared/xRankerSignals.ts` is what the retrospective
// **E** score normalizes against: what a typical post really does per view. It
// shipped in XR.2 as Bangermeter's 141-post sample of *their* For You feed. This
// script derives the same three numbers from `harvest_rows` where `mode =
// 'timeline'` — our passive Home-Timeline harvest, the closest thing we own to a
// feed sample — and prints them ready to paste, plus what swapping them does to
// the score distribution over that same corpus.
//
// **$0 and structurally so:** one `SELECT`, no writes, nothing on this path can
// reach `xFetch` or `askLLM`. It creates nothing, so there is nothing to clean up.
//
// ---------------------------------------------------------------- the method
//
// **Per-post MEDIAN, never pooled.** Pooled (`Σevents / Σviews`) answers "what
// rate does a random impression see", which a handful of viral posts dominate —
// on this corpus pooled reads 0.0103 favorite against a median of 0.0294, a 2.9×
// gap. The score compares one post against a reference POST, so the reference has
// to be the typical post, not the typical impression. The quantile is
// `calibrate.js`'s: sort ascending, take index `min(len-1, floor(p*len))`.
//
// **Deduped at `min(captured_at)`** — first sighting, the same reading
// `loadTimelineFunnel` uses (`routes/playbook.ts`, `PASSIVE_HARVEST_MODE`): the
// reading that mattered is the one at first sighting, not at the tenth re-scroll.
// Then `views > 0`, because a rate needs a denominator.
//
// ------------------------------------------------------- maturity, and why it
// ------------------------------------------------------- is REPORTED, not cut
//
// The XR plan asked for a 48h maturity cut, on the theory that a young post is
// still accruing views and reads high. Measured, that cut cannot be applied and
// would not help:
//
//   1. **No feed sample can satisfy it.** Age at capture here tops out at ~45h
//      (median ~4h) — a Home Timeline shows you recent posts, so a passive
//      harvest of it structurally cannot hold a settled reading. Bangermeter's
//      own reference sample has the identical shape: median 6h, max 43h, and
//      **zero** of its 141 For You posts were 48h old at scrape. The cut would
//      empty the corpus it was borrowed from. It is the plan author's addition,
//      not part of the ported method (`calibration/calibrate.js` filters only on
//      `views > 0`, and never reads its own `ageMin` column).
//   2. **Clocking it against the sample's newest post measures the wrong thing.**
//      That is a collection-recency filter, not a maturity filter: it drops
//      whatever was harvested last regardless of how mature those readings were.
//      Here it drops 80 of 766 rows and moves the medians by under 8% — less
//      than the gap between any two age strata.
//   3. **The reference must be sampled like the thing it scores.** Every post E
//      scores is a DOM reading off a live page — a Radar sighting, a swipe-file
//      save, an on-page badge — with exactly this maturity profile. A reference
//      built only from settled posts would read every fresh sighting as
//      above-baseline: a bias in the flattering direction.
//   4. The plan's real worry — "clocking against `Date.now()` makes the same
//      corpus answer differently next week" — is already answered by clocking
//      against `captured_at`, which is frozen per row. Rerun this next month and
//      the same rows give the same medians.
//
// So `MATURITY_REPORT_HOURS` is a **diagnostic**: the run prints the age-at-
// capture distribution and how many readings cleared 48h (expect zero), and the
// constant carries that profile in its caveat. Hiding it behind a filter that
// removes nothing would be worse than not filtering at all.
//
// ---------------------------------------------------------------------- gates
//
// Below `MIN_SAMPLE` rows the medians are noise and a labeled import is the more
// honest placeholder, so the script refuses to emit constants and says so. It
// prints `n` either way.

import { eq, sql } from 'drizzle-orm';
import { db } from '../src/db/client.ts';
import { normalizeScore, scoreHeads } from '../src/shared/xRanker.ts';
import {
  ENGAGEMENT_SHRINKAGE_PSEUDO_VIEWS,
  X_OBSERVED_RATES,
  X_OBSERVED_RATES_SAMPLE,
  scoreMeasured,
} from '../src/shared/xRankerSignals.ts';
import { harvestRows } from '../src/x/db/schema.ts';

/** The passive Home-Timeline harvest. `mode` is the only thing separating it
 *  from the user's hand-run harvests — `routes/playbook.ts` carries the same
 *  constant, and a reader without it silently mixes two corpora. */
const PASSIVE_HARVEST_MODE = 'timeline';

/** Below this the per-post medians are noise; the imported set stays. */
const MIN_SAMPLE = 100;

/** Reported, never applied as a filter — see the header. */
const MATURITY_REPORT_HOURS = 48;

/** Bangermeter's `calibration/feed-sample-2026-08-13.csv`, For You slice, read
 *  off its own `ageMin` column. Quoted here because it is the whole argument
 *  that our sample is not unusually green — it is what a feed sample IS. */
const IMPORT_SAMPLE_AGE = { medianHours: 6.0, maxHours: 43.0, over48h: 0, n: 141 };

type Rates = { favorite: number; reply: number; retweet: number };

interface Post {
  views: number;
  likes: number;
  replies: number;
  reposts: number;
  capturedAtMs: number;
  tweetTimeMs: number | null;
}

/** `calibrate.js`'s quantile, kept bit-for-bit: sort ascending, index
 *  `min(len-1, floor(p*len))`. Not interpolated, and deliberately not the
 *  repo's `median()` in `playbook.ts` — this one is the borrowed method, and
 *  the whole point of the exercise is to run THEIR method on OUR rows. */
function q(values: readonly number[], p: number): number {
  const s = [...values].sort((a, b) => a - b);
  const at = s[Math.min(s.length - 1, Math.floor(p * s.length))];
  return at ?? Number.NaN;
}

/** Six decimals, matching `calibrate.js`. These are ratios of small integers;
 *  the digits past six are an artefact of f64, not a measurement. */
function round6(n: number): number {
  return Number(n.toFixed(6));
}

function ageHours(p: Post): number | null {
  if (p.tweetTimeMs === null) return null;
  return (p.capturedAtMs - p.tweetTimeMs) / 3_600_000;
}

function medians(posts: readonly Post[]): Rates {
  const rateOf = (pick: (p: Post) => number): number => round6(q(posts.map(pick), 0.5));
  return {
    favorite: rateOf((p) => p.likes / p.views),
    reply: rateOf((p) => p.replies / p.views),
    retweet: rateOf((p) => p.reposts / p.views),
  };
}

/** `scoreMeasured`'s arithmetic with the reference as a PARAMETER, so the run
 *  can score the same corpus against two different references. Faithfulness is
 *  not assumed: the run asserts this reproduces `scoreMeasured` exactly on
 *  every row when handed the shipped rates (the D184a read-back habit — a
 *  helper that silently drifts would make the whole comparison a fiction). */
function eScore(p: Post, rates: Rates): number {
  const K = ENGAGEMENT_SHRINKAGE_PSEUDO_VIEWS;
  const shrunk = (n: number, p0: number): number =>
    Math.min(1, Math.max(0, (n + K * p0) / (p.views + K)));
  const raw = scoreHeads({
    favorite: shrunk(p.likes, rates.favorite),
    reply: shrunk(p.replies, rates.reply),
    retweet: shrunk(p.reposts, rates.retweet),
  }).raw;
  const baseline = scoreHeads({
    favorite: rates.favorite,
    reply: rates.reply,
    retweet: rates.retweet,
  }).raw;
  return Math.round(normalizeScore(raw, baseline));
}

function pct(values: readonly number[], keep: (n: number) => boolean): string {
  return `${Math.round((100 * values.filter(keep).length) / values.length)}%`;
}

function isoDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

async function main(): Promise<void> {
  // First sighting per tweet. With exactly one min/max aggregate every bare
  // column comes from the matching input row — SQLite's documented form, and
  // the one `loadTimelineFunnel` relies on.
  const seen = await db
    .select({
      capturedAt: sql<number>`min(${harvestRows.capturedAt})`,
      views: harvestRows.views,
      likes: harvestRows.likes,
      comments: harvestRows.comments,
      reposts: harvestRows.reposts,
      tweetTime: harvestRows.tweetTime,
    })
    .from(harvestRows)
    .where(eq(harvestRows.mode, PASSIVE_HARVEST_MODE))
    .groupBy(harvestRows.tweetId);

  const posts: Post[] = seen
    .map((r) => ({
      views: r.views,
      likes: r.likes,
      replies: r.comments,
      reposts: r.reposts,
      capturedAtMs: Number(r.capturedAt),
      tweetTimeMs: r.tweetTime === null ? null : r.tweetTime.getTime(),
    }))
    .filter((p) => p.views > 0);

  console.log('calibrate-ranker — the E-score reference, measured off our own corpus\n');
  console.log(
    `corpus     : harvest_rows mode='${PASSIVE_HARVEST_MODE}' (the passive Home-Timeline harvest)`,
  );
  console.log(
    `             ${seen.length} tweets deduped at min(captured_at) → ${posts.length} with views > 0`,
  );

  if (posts.length === 0) {
    console.log('\nNo rows. Nothing to calibrate — X_OBSERVED_RATES stays as it is.');
    console.log(`(This machine's DB is probably empty; point SQLITE_PATH at one with a harvest.)`);
    return;
  }

  const captured = posts.map((p) => p.capturedAtMs);
  const range = `${isoDay(Math.min(...captured))}..${isoDay(Math.max(...captured))}`;
  console.log(`collected  : ${range}`);

  const ages = posts.map(ageHours).filter((h): h is number => h !== null);
  const over = ages.filter((h) => h >= MATURITY_REPORT_HOURS).length;
  console.log(
    `maturity   : age at capture median ${q(ages, 0.5).toFixed(1)}h, ` +
      `p90 ${q(ages, 0.9).toFixed(1)}h, max ${Math.max(...ages).toFixed(1)}h ` +
      `(${ages.length}/${posts.length} rows carry a tweet_time)`,
  );
  console.log(
    `             ${over} of ${posts.length} readings were ≥ ${MATURITY_REPORT_HOURS}h old. Reported, not cut:`,
  );
  console.log(
    `             the imported sample is the same shape (n=${IMPORT_SAMPLE_AGE.n}, ` +
      `median ${IMPORT_SAMPLE_AGE.medianHours}h, max ${IMPORT_SAMPLE_AGE.maxHours}h, ` +
      `${IMPORT_SAMPLE_AGE.over48h} over ${MATURITY_REPORT_HOURS}h).`,
  );

  const measured = medians(posts);
  const rt = posts.map((p) => p.reposts / p.views);
  console.log(`\nmeasured per-post medians (n=${posts.length})`);
  console.log(
    `  favorite ${measured.favorite.toFixed(6)}   ` +
      `reply ${measured.reply.toFixed(6)}   retweet ${measured.retweet.toFixed(6)}`,
  );
  console.log(
    `  median views ${q(
      posts.map((p) => p.views),
      0.5,
    )}   ` +
      `zero reposts ${pct(rt, (n) => n === 0)}   ` +
      `zero replies ${pct(
        posts.map((p) => p.replies),
        (n) => n === 0,
      )}   ` +
      `zero likes ${pct(
        posts.map((p) => p.likes),
        (n) => n === 0,
      )}`,
  );
  if (measured.retweet === 0) {
    console.log(
      '  retweet median is 0 because most feed posts have none. That is the honest ' +
        'central\n  value, not a missing measurement: the head becomes one-sided ' +
        '(at-reference for a post\n  with no reposts, above it for any post with one) ' +
        'and nothing divides by it.',
    );
  }

  const shipped: Rates = {
    favorite: X_OBSERVED_RATES.favorite,
    reply: X_OBSERVED_RATES.reply,
    retweet: X_OBSERVED_RATES.retweet,
  };
  console.log(
    `\nshipped X_OBSERVED_RATES (n=${X_OBSERVED_RATES_SAMPLE.n}, ` +
      `${X_OBSERVED_RATES_SAMPLE.feed}, ${X_OBSERVED_RATES_SAMPLE.collected})`,
  );
  console.log(
    `  favorite ${shipped.favorite.toFixed(6)}   ` +
      `reply ${shipped.reply.toFixed(6)}   retweet ${shipped.retweet.toFixed(6)}`,
  );

  // The helper is only trustworthy if it IS `scoreMeasured` when handed the
  // shipped rates. Prove it on every row before believing the counterfactual.
  const drift = posts.filter((p) => {
    const real = scoreMeasured({
      likes: p.likes,
      replies: p.replies,
      reposts: p.reposts,
      views: p.views,
    });
    return !real.available || real.score !== eScore(p, shipped);
  }).length;
  console.log(
    `\nhelper check: reproduces scoreMeasured on ${posts.length - drift}/${posts.length} rows` +
      `${drift === 0 ? '' : ' — DRIFTED, the table below is not trustworthy'}`,
  );

  console.log('\nE-score distribution over this corpus');
  console.log('  reference                          p10  median   p90    >50');
  const row = (label: string, rates: Rates): void => {
    const s = posts.map((p) => eScore(p, rates));
    console.log(
      `  ${label.padEnd(32)}${String(q(s, 0.1)).padStart(4)}` +
        `${String(q(s, 0.5)).padStart(8)}${String(q(s, 0.9)).padStart(6)}` +
        `${pct(s, (n) => n > 50).padStart(7)}`,
    );
  };
  row('shipped', shipped);
  row('measured (this corpus)', measured);
  console.log('  A centred scale puts the median post of the reference feed at 50.');

  const shippedScores = posts.map((p) => eScore(p, shipped));
  const measuredScores = posts.map((p) => eScore(p, measured));
  const medViews = q(
    posts.map((p) => p.views),
    0.5,
  );
  const pull = Math.round(
    (100 * ENGAGEMENT_SHRINKAGE_PSEUDO_VIEWS) / (medViews + ENGAGEMENT_SHRINKAGE_PSEUDO_VIEWS),
  );
  console.log('\nverdict');
  console.log(
    `  centring : shipped reads this feed at a median of ${q(shippedScores, 0.5)}` +
      ` (${pct(shippedScores, (n) => n > 50)} above 50); measured reads ${q(measuredScores, 0.5)}` +
      ` (${pct(measuredScores, (n) => n > 50)}).`,
  );
  // Not a licence to retune K here — that is a measured recalibration (plan
  // Decision 5, CLAUDE.md's thresholds rule), and this run is what will
  // eventually justify one. Naming the number now is what makes it visible.
  for (const line of [
    `  spread   : p10..p90 spans ${q(measuredScores, 0.1)}..${q(measuredScores, 0.9)}. Our median post has ${medViews} views`,
    `             against K=${ENGAGEMENT_SHRINKAGE_PSEUDO_VIEWS} pseudo-views, so a typical reading is pulled ~${pull}% onto the`,
    '             reference before it is scored. E separates our feed weakly, and that is',
    '             the shrinkage constant, not the rates. XR.4 owns the re-cut; K moves',
    '             only on a measured recalibration.',
  ]) {
    console.log(line);
  }

  if (posts.length < MIN_SAMPLE) {
    for (const line of [
      `\nREFUSING to emit constants: n=${posts.length} < ${MIN_SAMPLE}. Below that the medians`,
      'are noise and a labeled import is the more honest placeholder. Leave',
      "X_OBSERVED_RATES alone and set its provenance to 'imported-pending-calibration'.",
    ]) {
      console.log(line);
    }
    return;
  }

  console.log('\npaste into src/shared/xRankerSignals.ts:\n');
  console.log(
    `export const X_OBSERVED_RATES: Readonly<Record<'favorite' | 'reply' | 'retweet', number>> = {`,
  );
  console.log(`  favorite: ${measured.favorite},`);
  console.log(`  reply: ${measured.reply},`);
  console.log(`  retweet: ${measured.retweet},`);
  console.log('};\n');
  console.log(`export const X_OBSERVED_RATES_PROVENANCE = 'measured' as const;\n`);
  console.log('export const X_OBSERVED_RATES_SAMPLE = {');
  console.log(`  n: ${posts.length},`);
  console.log(`  feed: 'home-timeline',`);
  console.log(`  collected: '${range}',`);
  console.log(`  source: "harvest_rows mode='${PASSIVE_HARVEST_MODE}'",`);
  console.log('} as const;');
}

await main();
process.exit(0);
