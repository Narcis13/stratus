// SC.4 — the coach's compact form.
//
// The Composer prints the full column (score + fix rows + a passing
// disclosure). Every surface that instead offers a CHOICE between finished
// reply drafts prints this: one tone-coded number per variant, with the top two
// things to fix in its tooltip. Same engine, same tones, a fraction of the ink.
//
// Presentation only. The chip never reorders, pre-selects or disables the
// variant it labels (SC decision 4) — it is read at the moment of picking, and
// a low number is information, not a refusal.
//
// The tone maps live here rather than beside the Composer's column because the
// score pill, the fix rows and these chips must speak ONE colour vocabulary; a
// second one for the same engine is how a badge and its gate fork.

import type { JSX } from 'react';
import {
  COACH_BAND_LABEL,
  COACH_DISCLAIMER,
  type CoachBand,
  type CoachResult,
  type CoachStatus,
  scoreDraft,
} from '../postCoach.ts';

export const COACH_TONE: Record<CoachStatus, string> = {
  fix: 'coach-tone-fix',
  nudge: 'coach-tone-nudge',
  pass: 'coach-tone-pass',
};

export const COACH_BAND_TONE: Record<CoachBand, CoachStatus> = {
  top: 'pass',
  ship: 'pass',
  almost: 'nudge',
  rework: 'fix',
};

// How many non-pass labels the tooltip names. Two is the whole budget: a
// tooltip is read at a glance while choosing between three drafts, and the
// Composer is where the full list already lives.
const TOOLTIP_ISSUES = 2;

/** The chip's tooltip: the score, then the worst two things about this draft,
 *  then the floor-not-target sentence rendered verbatim from the engine's own
 *  export (SC.1 — it is never retyped, so rewording it moves every surface).
 *  Fixes before nudges, rule order within each — the same reading order the
 *  Composer's column uses, so the two can't disagree about what matters most. */
export function coachChipTitle(result: CoachResult): string {
  const issues = [
    ...result.checks.filter((c) => c.status === 'fix'),
    ...result.checks.filter((c) => c.status === 'nudge'),
  ]
    .slice(0, TOOLTIP_ISSUES)
    .map((c) => c.label);
  const head = `${result.score}/100 · ${COACH_BAND_LABEL[result.band]}`;
  return [head, ...issues, COACH_DISCLAIMER].join('\n');
}

/** A score chip for one finished reply draft. `isReply` is fixed on purpose:
 *  every caller is a reply picker, and a reply is graded without the hook and
 *  breathing-room rules a standalone post owes (SC.1). Renders nothing for an
 *  empty draft — a "0" against no text is a verdict on nothing. */
export function CoachChip({ text }: { text: string }): JSX.Element | null {
  const result = scoreDraft(text, { isReply: true });
  if (result.checks.length === 0) return null;
  return (
    <span
      className={`coach-chip ${COACH_TONE[COACH_BAND_TONE[result.band]]}`}
      title={coachChipTitle(result)}
    >
      {result.score}
    </span>
  );
}
