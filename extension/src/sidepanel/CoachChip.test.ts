// SC.4 — the chip itself is a panel component (untested by convention), but the
// tooltip it hands the user IS a contract: which two of up to 27 checks get
// named, and in what order. That is what this pins.

import { describe, expect, test } from 'bun:test';
import { COACH_DISCLAIMER, type CoachResult, scoreDraft } from '../postCoach.ts';
import { COACH_BAND_TONE, COACH_TONE, coachChipTitle } from './CoachChip.tsx';

function result(partial: Partial<CoachResult>): CoachResult {
  return {
    score: 70,
    band: 'ship',
    checks: [],
    counts: { pass: 0, nudge: 0, fix: 0 },
    ...partial,
  };
}

describe('coachChipTitle', () => {
  test('a clean draft is just the score and the floor-not-target line', () => {
    const lines = coachChipTitle(result({ score: 88, band: 'top' })).split('\n');
    expect(lines).toEqual(['88/100 · top tier', COACH_DISCLAIMER]);
  });

  test('fixes are named before nudges that fire earlier in rule order', () => {
    // An em-dash (hygiene nudge, early) plus 15 raw lines (hygiene fix, later):
    // the reading order is severity first, matching the Composer's column.
    const draft = `Fast — but wrong.\n\n${Array.from({ length: 13 }, (_, i) => `line ${i + 1}`).join('\n')}`;
    const lines = coachChipTitle(scoreDraft(draft, { isReply: true })).split('\n');
    expect(lines[1]).toContain('show more');
    expect(lines[2]).toContain('em-dash');
  });

  test('never names more than two issues, however many fired', () => {
    const many = scoreDraft(
      'Honestly, this is a game-changer — it will 10x your workflow. thoughts?',
      {
        isReply: true,
      },
    );
    expect(many.checks.filter((c) => c.status !== 'pass').length).toBeGreaterThan(2);
    expect(coachChipTitle(many).split('\n')).toHaveLength(4); // head + 2 + disclaimer
  });

  test('the disclaimer is the engine export, never a retyped copy', () => {
    expect(coachChipTitle(result({}))).toEndWith(COACH_DISCLAIMER);
  });
});

describe('coach tones', () => {
  test('every band resolves to one of the three tone classes', () => {
    for (const band of ['top', 'ship', 'almost', 'rework'] as const) {
      expect(Object.values(COACH_TONE)).toContain(COACH_TONE[COACH_BAND_TONE[band]]);
    }
    // The two ship-ready bands read the same: the chip is a floor check, not a
    // ranking — `top` must not out-shout `ship` at the moment of picking.
    expect(COACH_BAND_TONE.top).toBe(COACH_BAND_TONE.ship);
  });
});
