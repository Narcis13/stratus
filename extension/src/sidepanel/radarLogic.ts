// Pure, unit-testable helpers behind the Radar queue's ranker chip (XR.6):
// what a sighting hands the E score, and the words the chip prints. No React,
// no chrome — the panel calls this at render time and stores nothing (§7.24: a
// stamped score would go stale on the next re-sighting and would need a merge
// rule in `mergeSightings` that nothing needs).
//
// **Sidepanel-local rather than in `shared/radar.ts`, deliberately.**
// `content.ts` imports `shared/radar.ts`, so a ranker import there would put
// X's whole weight table into the content-script bundle — a bundle XR.7 owns
// and whose inline proof is that `rust_home_mixer_favorite_weight` appears in
// `dist/content.js` exactly once, after XR.7 and not before. `composerLogic.ts`
// is the precedent: the panel's pure logic lives beside the panel.

import type { RadarSighting } from '../shared/radar.ts';
import { X_HEADS } from '../xRanker.ts';
import {
  type MeasuredCounts,
  RANKER_BAND_LABEL,
  RANKER_DISCLAIMER,
  type RankerMeasuredResult,
  scoreMeasured,
} from '../xRankerSignals.ts';

/** The available half of `scoreMeasured`'s union — what the chip renders. */
export type RankerSightingScore = Extract<RankerMeasuredResult, { available: true }>;

/** What a sighting can honestly hand the E score.
 *
 *  `reposts` is **null, not 0**: a sighting has no repost field at all (nor does
 *  the server's `radar_sightings`), and a zero here would be a claim we counted
 *  and found none. `scoreHeads` then drops the head rather than scoring it,
 *  which is the whole reason XR.1's null-vs-zero rule is load-bearing (§7.11).
 *
 *  `likes` is the same rule one step softer: RS.2 stamps it only when the sweep
 *  read one off the card, so an absent value stays absent.
 *
 *  `replies` is NOT optional on `TweetSignals` and 0 there is a real reading —
 *  X renders no count when a post has no replies, which is what the DOM parses
 *  as zero. It goes through as measured. */
export function sightingCounts(s: RadarSighting): MeasuredCounts {
  return {
    likes: s.likes ?? null,
    replies: s.signals.replies,
    reposts: null,
    views: s.signals.views,
  };
}

/** **E for one sighting.** Scores the POST — the thing you would be replying to
 *  — never the drafted reply (plan Decision 9).
 *
 *  No `DraftFeatures` are passed, and the omission is a decision rather than an
 *  oversight. The only feature `scoreMeasured` reads is the mutual-follow reply
 *  boost (5.0 → 20.0), and the nearest thing a sighting carries is
 *  `personTier`, which is our own CRM stage — a relationship judgement we
 *  assign, not an X follow edge. Spending it as `isMutualFollow` would be a
 *  measurement nobody took (§7.11), would put two rows of one queue on two
 *  different scales, and would silently re-score somebody's posts the day their
 *  stage changes. Every sighting is therefore scored on the base reply weight,
 *  which is also the weight the E baseline is pinned at (D231) — numerator and
 *  denominator on the same terms, so the numbers compare across rows.
 *
 *  Returns the union: `available: false` when there is no view count, and the
 *  caller renders NOTHING in that case. An `E 0` for "we didn't capture views"
 *  is a lie a reader would act on. */
export function sightingRankerScore(s: RadarSighting): RankerMeasuredResult {
  return scoreMeasured(sightingCounts(s));
}

/** The chip's face: `E 52 · strong shape`. The band word is printed rather than
 *  left to the colour because only `below` takes one (D235) — `typical` and
 *  `strong` are the same muted tone, so without the word the chip would be a
 *  bare 0–100 number on an unexplained scale. */
export function rankerChipFace(r: RankerSightingScore): string {
  return `E ${r.score} · ${RANKER_BAND_LABEL[r.band]}`;
}

/** The chip's tooltip.
 *
 *  The head line is DERIVED from the contributions rather than quoting
 *  `scoreMeasured`'s own `note`: that sentence names all three observable heads,
 *  which is true of a harvest row and false here — a sighting carries no
 *  reposts. Saying "likes, replies, reposts" over a score that never saw a
 *  repost is exactly the kind of sentence the next reader believes.
 *
 *  The OON caveat is the reason the chip is where it is (plan Decision 9) and
 *  not a hedge about the number: `OONRetweetReplyFilter` removes out-of-network
 *  replies from For You outright, so scoring the DRAFT would have been close to
 *  meaningless. The post is what there is to read. */
export function rankerChipTitle(r: RankerSightingScore): string {
  const heads = r.contributions.map((c) => X_HEADS[c.head].label);
  const lines = [rankerChipFace(r)];
  lines.push(
    `X's published For You weights over what this post has actually done: ${
      heads.length > 0 ? heads.join(' + ') : 'nothing observable'
    } against ${r.views.toLocaleString()} views. 50 is a post doing the feed's median rates.`,
  );
  lines.push(
    'Reposts are not captured on a sighting, so that head is left out — not counted as zero.',
  );
  if (r.lowSample) lines.push(r.note);
  lines.push(
    'It scores the post, never your reply: an out-of-network reply is dropped from For You outright, so a reply carries no ranker score worth reading.',
  );
  lines.push(
    'Bands are quartiles of the sightings we have actually harvested — where this post sits among them, not what a reply to it will earn.',
  );
  lines.push(RANKER_DISCLAIMER);
  return lines.join('\n');
}
