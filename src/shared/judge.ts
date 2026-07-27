// LLM-judge vocabulary: the 13-dimension rubric keys, the derived verdict band,
// and the annotation locator that turns a quoted fix into a textarea selection.
//
// Canonical home (§7.3): src/shared/, zero-dependency and IIFE-safe (§7.26) —
// the panel reaches it through the re-export shim extension/src/judge.ts (§7.27)
// and the server through this file, so a band can never mean two things. Nothing
// here hashes, prompts or scores: the rubric prompt, the schema and the parser
// are JD.3 (`src/x/judge/prompt.ts`, server-only — `node:crypto` does not exist
// in the panel), and no LLM call lives below this line.
//
// Provenance: written from the dimension TABLE in
// evals/x-builder-judge-generate-analysis.md §J0-§J2 (the study of
// creynir/x-builder, which ships no LICENSE — the dimension list, the derived
// verdict and the quote-anchoring idea are unprotectable, their prompt copy,
// schemas and naming are not). Every string and every signature here is ours.
//
// Two rubric properties this module exists to keep in one place:
//   - The verdict label is DERIVED from `scores.overall`, never model-supplied
//     (JD decision 3) — the schema omits it, the route spreads it last, and the
//     label and the number can therefore never disagree.
//   - `overall` is a DIAGNOSTIC, not a target (JD decision 4). Read as targets,
//     `answerEffort` and `strangerAnswerability` are the reply-farm gradient the
//     static-engine study flagged; `negativeRisk` balances them only while a
//     human reads both. So no surface sorts, gates, auto-selects, blocks
//     Schedule or refuses on the score, and JUDGE_DISCLAIMER is the copy that
//     says so wherever a number is rendered.

export type JudgeDimension =
  | 'overall'
  | 'replies'
  | 'profileClicks'
  | 'impressions'
  | 'bookmarkValue'
  | 'dwellProxy'
  | 'voiceMatch'
  | 'negativeRisk'
  | 'answerEffort'
  | 'strangerAnswerability'
  | 'statusDependency'
  | 'replyVsQuoteOrientation'
  | 'audienceMatch';

/** Render order — `overall` is the headline number, the twelve follow as rows. */
export const JUDGE_DIMENSIONS: readonly JudgeDimension[] = [
  'overall',
  'replies',
  'profileClicks',
  'impressions',
  'bookmarkValue',
  'dwellProxy',
  'voiceMatch',
  'negativeRisk',
  'answerEffort',
  'strangerAnswerability',
  'statusDependency',
  'replyVsQuoteOrientation',
  'audienceMatch',
];

/** The twelve detail rows — JUDGE_DIMENSIONS minus the headline. Exported so a
 *  panel never hand-maintains a twin list that drifts from the rubric. */
export const JUDGE_SUB_DIMENSIONS: readonly JudgeDimension[] = JUDGE_DIMENSIONS.filter(
  (d) => d !== 'overall',
);

export const JUDGE_DIMENSION_LABEL: Record<JudgeDimension, string> = {
  overall: 'Overall',
  replies: 'Reply pull',
  profileClicks: 'Profile pull',
  impressions: 'Reach hook',
  bookmarkValue: 'Save value',
  dwellProxy: 'Dwell',
  voiceMatch: 'Voice match',
  negativeRisk: 'Negative risk',
  answerEffort: 'Answer effort',
  strangerAnswerability: 'Stranger answerability',
  statusDependency: 'Status dependency',
  replyVsQuoteOrientation: 'Replies vs quotes',
  audienceMatch: 'Audience match',
};

/** The two dimensions where a HIGH number is a problem: `negativeRisk` is the
 *  rubric's own penalty axis (ragebait / overclaim / hype), and 100 on
 *  `statusDependency` means the post only lands if you already have the bio —
 *  the worst possible reading for a small account. A consumer that colours
 *  scores reads this instead of inventing a polarity map (§7 rule 4c).
 *  `answerEffort` and `strangerAnswerability` are deliberately NOT here: high is
 *  neither good nor bad on them, which is exactly why nothing sorts on the
 *  score (decision 4). */
export const JUDGE_HIGHER_IS_WORSE: readonly JudgeDimension[] = [
  'negativeRisk',
  'statusDependency',
];

/** All 13, 0-100. `audienceMatch` is nullable because a judge run with no active
 *  niche has nothing to match against — null is unknown, never 0 (§7.11). */
export interface JudgeScores {
  overall: number;
  replies: number;
  profileClicks: number;
  impressions: number;
  bookmarkValue: number;
  dwellProxy: number;
  voiceMatch: number;
  negativeRisk: number;
  answerEffort: number;
  strangerAnswerability: number;
  statusDependency: number;
  replyVsQuoteOrientation: number;
  audienceMatch: number | null;
}

export type JudgeSeverity = 'suggestion' | 'warning';

/** One anchored fix. `quote` is an exact substring of the judged draft — that is
 *  what makes "apply every fix" meaningful, and what `locateAnnotations` checks. */
export interface JudgeAnnotation {
  quote: string;
  severity: JudgeSeverity;
  recommendation: string;
}

export type JudgeConfidence = 'low' | 'medium' | 'high';

export type JudgeVerdictLabel = 'post_now' | 'slight_rework' | 'major_rework' | 'do_not_post';

/** The model-derived half of a judgment: what JD.3's `parseVerdict` returns and
 *  what the panel renders. The route adds the transport/provenance fields
 *  (`id`, `textHash`, `model`, `provider`, `costUsd`, `requestId`). */
export interface JudgeVerdict {
  verdict: JudgeVerdictLabel;
  approved: boolean;
  headline: string;
  confidence: JudgeConfidence | null;
  scores: JudgeScores;
  annotations: JudgeAnnotation[];
  strengths: string[];
  improvements: string[];
}

export const JUDGE_VERDICT_LABEL: Record<JudgeVerdictLabel, string> = {
  post_now: 'post it',
  slight_rework: 'slight rework',
  major_rework: 'major rework',
  do_not_post: 'do not post',
};

export const JUDGE_DISCLAIMER =
  "One model's opinion, not a gate — nothing here blocks scheduling; the fixes are the useful part.";

/** The ONLY place the cut points live. A consumer that re-derives them grades a
 *  different number than the panel showed the moment either side moves. A
 *  non-finite score reads as the most conservative band rather than throwing. */
export function deriveVerdictBand(overall: number): JudgeVerdictLabel {
  if (!Number.isFinite(overall)) return 'do_not_post';
  if (overall >= 85) return 'post_now';
  if (overall >= 70) return 'slight_rework';
  if (overall >= 40) return 'major_rework';
  return 'do_not_post';
}

/** Single source of "approved" for producer and panel alike. */
export function deriveApproved(verdict: JudgeVerdictLabel): boolean {
  return verdict === 'post_now' || verdict === 'slight_rework';
}

export interface LocatedAnnotation extends JudgeAnnotation {
  from: number;
  to: number;
}

/** Resolve each annotation's quote to a `[from, to)` offset pair in `text`,
 *  left to right from a consumed offset — so the same phrase quoted twice
 *  anchors on its first and then its second occurrence.
 *
 *  Degradation contract (x-builder §J1, worth copying verbatim as a rule): a
 *  quote that is absent, empty or blank is SILENTLY DROPPED and does not
 *  advance the offset, so the fixes around it still locate. A judge that
 *  hallucinates a quote costs you a row, not a composer — this function never
 *  throws, on any input.
 *
 *  Accepted limitation of the consumed-offset walk: annotations arriving out of
 *  document order lose the earlier-in-text one (its quote sits behind the
 *  offset). Models emit them in reading order, and the cost is a dropped row;
 *  claimed-range matching would fix it at the price of overlap semantics
 *  nothing has yet needed. Revisit against real judgments, not by guessing. */
export function locateAnnotations(
  text: string,
  annotations: readonly JudgeAnnotation[],
): LocatedAnnotation[] {
  const located: LocatedAnnotation[] = [];
  let consumed = 0;
  for (const annotation of annotations) {
    const quote = annotation.quote;
    if (!quote || quote.trim() === '') continue;
    const from = text.indexOf(quote, consumed);
    if (from === -1) continue;
    const to = from + quote.length;
    located.push({ ...annotation, from, to });
    consumed = to;
  }
  return located;
}
