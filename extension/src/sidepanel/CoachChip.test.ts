// SC.4 — the chip itself is a panel component (untested by convention), but the
// tooltip it hands the user IS a contract: which two of up to 27 checks get
// named, and in what order. That is what this pins.

import { describe, expect, test } from 'bun:test';
import { COACH_DISCLAIMER, type CoachResult, scoreDraft } from '../postCoach.ts';
import type { RankerBand } from '../xRankerSignals.ts';
import { COACH_BAND_TONE, COACH_TONE, coachChipTitle } from './CoachChip.tsx';
import { rankerBandChip } from './chips.ts';

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

// XR.5 — `rankerBandChip` lives in `chips.ts` (UI.14), but the claim under test
// is about THIS file's vocabulary: that the ranker's C pill does not borrow it.
// Two engines sharing one colour ramp is how a reader starts averaging two
// numbers that answer different questions (plan Decision 2).
describe('ranker band tone', () => {
  const BANDS: RankerBand[] = ['below', 'typical', 'strong'];

  test('every band resolves to the shared chip shape plus a real chip tone', () => {
    const TONES = ['chip-ok', 'chip-accent', 'chip-warn', 'chip-strong', 'chip-muted'];
    for (const band of BANDS) {
      const classes = rankerBandChip(band).split(' ');
      expect(classes[0]).toBe('chip');
      expect(TONES).toContain(classes[1] ?? '');
    }
  });

  test('it borrows no class from the coach, in either direction', () => {
    const coachClasses = new Set(Object.values(COACH_TONE));
    for (const band of BANDS) {
      for (const cls of rankerBandChip(band).split(' ')) {
        expect(coachClasses.has(cls)).toBe(false);
      }
    }
  });

  test('only `below` takes a tone while the cut points stay unvalidated (D230)', () => {
    // `strong` is the MODAL band on our modifier set, not the exceptional one,
    // so colouring it would sell a borrowed cut point as a verdict. XR.4's
    // falsification cell owns the re-cut; until then the two upper bands are
    // as quiet as the chip family's base.
    expect(rankerBandChip('typical')).toBe(rankerBandChip('strong'));
    expect(rankerBandChip('strong')).toContain('chip-muted');
    expect(rankerBandChip('below')).toContain('chip-warn');
  });
});
