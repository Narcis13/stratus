// Format cooldown: how often each STRUCTURAL shape went out in a rolling
// window, so the Composer can say "that's the fourth audience-CTA this week"
// while you are still typing the fourth one.
//
// Canonical home (§7.3): src/shared/, zero-dependency and IIFE-safe (§7.26).
// Only the server builds cells today (the panel reads them off the route and
// looks up the draft's own format), so no extension re-export shim ships with
// this — the extension mirrors the wire shape in `shared/types.ts`, the same
// way it mirrors `CoachLexiconResponse`. A shim is a two-line add whenever a
// panel surface actually needs to BUILD cells.
//
// Provenance: the repetition window in
// evals/x-builder-static-engine-analysis.md §Inputs — originals only, rolling
// 7 days, ≥4 = cooldown / ≥2 = warming. Its second half (cluster the window by
// stop-worded token-set Jaccard ≥0.45 so it counts repeated *ideas* rather than
// repeated shapes) is deliberately NOT ported, and the reason is a measurement
// rather than a preference: over stratus's own 137 published originals, the
// single most similar same-format pair inside any 7-day window scores **0.238**
// — p95 is 0.077 — because a 280-character post carries a median of 15 content
// tokens and two posts making the same point share almost none of them. At 0.45
// every cluster is a singleton, so a cluster-keyed counter is silent forever;
// at any threshold the corpus does reach, the top scorers are provably distinct
// ideas ("Nobody is coming to build your app" vs "Someone else's launch going
// viral"), so it would fire on shared vocabulary instead. SC decision 1 is the
// rule here — a number is a measurement or it is absent.
//
// Idea-repetition is not lost, it already has an owner: `nearDuplicate` in
// src/x/monitor.ts (word-SHINGLE Jaccard ≥0.8 over 14 days) is the surface that
// catches "you posted this twice". This module owns the orthogonal axis nothing
// else measures — the shape.
//
// §7.19: the verdict is queue metadata, never advice. Nothing sorts, gates,
// blocks or refuses on it, and the chip it feeds is advisory (SC decision 4).

import { POST_FORMATS, type PostFormat, classifyFormat } from './postFormat.ts';

export type CooldownStatus = 'clear' | 'warming' | 'cooldown';

export interface CooldownCell {
  format: PostFormat;
  /** Originals of this format published inside the window. */
  count: number;
  status: CooldownStatus;
  /** True when the format is a non-detection and can never warn (see below). */
  exempt: boolean;
  /** ISO timestamp of the most recent one — the tooltip's "last used". */
  lastPostedAt: string;
  /** That same post's text, so the tooltip can show what the shape looked like. */
  exampleText: string;
}

export const COOLDOWN_WINDOW_DAYS = 7;
/** x-builder's bars, kept as opening guesses (C1-threshold spirit). Measured
 *  lit-rate over the real corpus at the time of writing, counting only the
 *  windows in which the format appeared at all: audience_cta 68%, list 43%,
 *  story 35%, hot_take 0% cooldown / 48% warming. High, but the chip is
 *  contingent — it renders only while you are drafting THAT shape, which is
 *  exactly the moment the count is worth knowing. Revisit at ~30 days of use. */
export const COOLDOWN_THRESHOLD = 4;
export const WARMING_THRESHOLD = 2;

/** The three fallback labels mean "no format detected", not "this format"
 *  (`substance` = a multi-line draft that matched no shape, `one_liner` = a
 *  single line that matched none, `other` = retweets / URL-only / fragments).
 *  Counting them would make the chip a liar and, at 43% of this account's
 *  originals landing in `substance`, a permanent one — D146(b) asks SC.6 to
 *  pick a resolution and this is it: the cooldown speaks only about shapes the
 *  classifier positively identified. Their cells still ship (the tally is worth
 *  reading) with `exempt: true` and a pinned `clear` status, so no consumer has
 *  to carry a copy of this list. */
export const COOLDOWN_EXEMPT_FORMATS: readonly PostFormat[] = ['substance', 'one_liner', 'other'];

const DAY_MS = 24 * 60 * 60 * 1000;

function statusFor(format: PostFormat, count: number): CooldownStatus {
  if (COOLDOWN_EXEMPT_FORMATS.includes(format)) return 'clear';
  if (count >= COOLDOWN_THRESHOLD) return 'cooldown';
  if (count >= WARMING_THRESHOLD) return 'warming';
  return 'clear';
}

/** One cell per format that appeared in the window, in `POST_FORMATS` cascade
 *  order (the same enumeration order the Playbook's format table uses, so the
 *  two surfaces read alike). Pure, $0, safe on an empty corpus.
 *
 *  Callers pass ORIGINALS only — replies have their own cadence doctrine — and
 *  pass `posts_published.text` RAW: `classifyFormat` normalizes X's stored
 *  entities itself (D146c). */
export function buildCooldowns(
  posts: readonly { text: string; postedAt: Date }[],
  now: Date,
  windowDays: number = COOLDOWN_WINDOW_DAYS,
): CooldownCell[] {
  const end = now.getTime();
  const start = end - windowDays * DAY_MS;
  const byFormat = new Map<PostFormat, { count: number; latest: Date; text: string }>();

  for (const post of posts) {
    const at = post.postedAt.getTime();
    // A future-dated row is somebody's fixture, not a post you made this week.
    if (!Number.isFinite(at) || at < start || at > end) continue;
    const format = classifyFormat(post.text);
    const seen = byFormat.get(format);
    if (!seen) {
      byFormat.set(format, { count: 1, latest: post.postedAt, text: post.text });
      continue;
    }
    seen.count += 1;
    if (at > seen.latest.getTime()) {
      seen.latest = post.postedAt;
      seen.text = post.text;
    }
  }

  const cells: CooldownCell[] = [];
  for (const format of POST_FORMATS) {
    const seen = byFormat.get(format);
    if (!seen) continue;
    cells.push({
      format,
      count: seen.count,
      status: statusFor(format, seen.count),
      exempt: COOLDOWN_EXEMPT_FORMATS.includes(format),
      lastPostedAt: seen.latest.toISOString(),
      exampleText: seen.text,
    });
  }
  return cells;
}
