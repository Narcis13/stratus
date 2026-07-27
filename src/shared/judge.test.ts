import { describe, expect, test } from 'bun:test';
import {
  JUDGE_DIMENSIONS,
  JUDGE_DIMENSION_LABEL,
  JUDGE_HIGHER_IS_WORSE,
  JUDGE_SUB_DIMENSIONS,
  JUDGE_VERDICT_LABEL,
  type JudgeAnnotation,
  type JudgeScores,
  type JudgeVerdictLabel,
  deriveApproved,
  deriveVerdictBand,
  locateAnnotations,
} from './judge.ts';

const VERDICTS: JudgeVerdictLabel[] = ['post_now', 'slight_rework', 'major_rework', 'do_not_post'];

/** A fully-populated scores object — the runtime proof that the interface and
 *  JUDGE_DIMENSIONS name the same 13 keys (TS alone checks only one direction). */
const SCORES: JudgeScores = {
  overall: 72,
  replies: 60,
  profileClicks: 80,
  impressions: 55,
  bookmarkValue: 70,
  dwellProxy: 65,
  voiceMatch: 90,
  negativeRisk: 10,
  answerEffort: 40,
  strangerAnswerability: 50,
  statusDependency: 20,
  replyVsQuoteOrientation: 75,
  audienceMatch: null,
};

const annotation = (quote: string, severity: JudgeAnnotation['severity'] = 'suggestion') => ({
  quote,
  severity,
  recommendation: `fix ${quote}`,
});

describe('JUDGE_DIMENSIONS', () => {
  test('is the 13 rubric keys, unique, headline first', () => {
    expect(JUDGE_DIMENSIONS).toHaveLength(13);
    expect(new Set(JUDGE_DIMENSIONS).size).toBe(13);
    expect(JUDGE_DIMENSIONS[0]).toBe('overall');
  });

  test('covers JudgeScores exactly — neither side can gain a key alone', () => {
    expect(Object.keys(SCORES).sort()).toEqual([...JUDGE_DIMENSIONS].sort());
  });

  test('the sub-dimension list is the twelve detail rows, in render order', () => {
    expect(JUDGE_SUB_DIMENSIONS).toHaveLength(12);
    expect(JUDGE_SUB_DIMENSIONS).not.toContain('overall');
    expect(JUDGE_SUB_DIMENSIONS).toEqual(JUDGE_DIMENSIONS.slice(1));
  });

  test('every dimension and every band has render copy', () => {
    for (const dimension of JUDGE_DIMENSIONS) {
      expect(JUDGE_DIMENSION_LABEL[dimension]?.length ?? 0).toBeGreaterThan(0);
    }
    expect(Object.keys(JUDGE_VERDICT_LABEL).sort()).toEqual([...VERDICTS].sort());
  });

  test('only the two penalty axes are higher-is-worse', () => {
    // answerEffort/strangerAnswerability are neutral ON PURPOSE (decision 4) —
    // read as targets they are the reply-farm gradient.
    expect([...JUDGE_HIGHER_IS_WORSE].sort()).toEqual(['negativeRisk', 'statusDependency']);
    for (const dimension of JUDGE_HIGHER_IS_WORSE) {
      expect(JUDGE_DIMENSIONS).toContain(dimension);
    }
  });
});

describe('deriveVerdictBand', () => {
  test('cut points at 85 / 70 / 40', () => {
    expect(deriveVerdictBand(100)).toBe('post_now');
    expect(deriveVerdictBand(85)).toBe('post_now');
    expect(deriveVerdictBand(84)).toBe('slight_rework');
    expect(deriveVerdictBand(70)).toBe('slight_rework');
    expect(deriveVerdictBand(69)).toBe('major_rework');
    expect(deriveVerdictBand(40)).toBe('major_rework');
    expect(deriveVerdictBand(39)).toBe('do_not_post');
    expect(deriveVerdictBand(0)).toBe('do_not_post');
  });

  test('out-of-range and non-finite scores fall to the conservative band', () => {
    expect(deriveVerdictBand(101)).toBe('post_now');
    expect(deriveVerdictBand(-5)).toBe('do_not_post');
    expect(deriveVerdictBand(Number.NaN)).toBe('do_not_post');
    expect(deriveVerdictBand(Number.POSITIVE_INFINITY)).toBe('do_not_post');
  });

  test('fractional scores land on the same side as their integer floor', () => {
    expect(deriveVerdictBand(84.9)).toBe('slight_rework');
    expect(deriveVerdictBand(69.9)).toBe('major_rework');
  });
});

describe('deriveApproved', () => {
  test('approves post_now and slight_rework only', () => {
    expect(deriveApproved('post_now')).toBe(true);
    expect(deriveApproved('slight_rework')).toBe(true);
    expect(deriveApproved('major_rework')).toBe(false);
    expect(deriveApproved('do_not_post')).toBe(false);
  });

  test('every band derived from a score maps to a boolean', () => {
    for (const overall of [0, 39, 40, 69, 70, 84, 85, 100]) {
      expect(typeof deriveApproved(deriveVerdictBand(overall))).toBe('boolean');
    }
  });
});

describe('locateAnnotations', () => {
  const TEXT = 'Ship one small thing every day. Ship it in public. Nobody reads manuals.';

  test('offsets round-trip through slice for every located row', () => {
    const located = locateAnnotations(TEXT, [
      annotation('Ship one small thing'),
      annotation('Nobody reads manuals', 'warning'),
    ]);
    expect(located).toHaveLength(2);
    for (const row of located) {
      expect(TEXT.slice(row.from, row.to)).toBe(row.quote);
    }
    expect(located[0]?.from).toBe(0);
    expect(located[1]?.severity).toBe('warning');
    expect(located[1]?.recommendation).toBe('fix Nobody reads manuals');
  });

  test('a repeated quote resolves to the second occurrence once the first is consumed', () => {
    const [first, second] = locateAnnotations(TEXT, [annotation('Ship'), annotation('Ship')]);
    expect(first?.from).toBe(0);
    expect(second?.from).toBe(TEXT.indexOf('Ship', 1));
    expect(second?.from).toBeGreaterThan(first?.to ?? 0);
    expect(TEXT.slice(second?.from ?? 0, second?.to ?? 0)).toBe('Ship');
  });

  test('a third repeat with only two occurrences is dropped, not mislocated', () => {
    const located = locateAnnotations(TEXT, [
      annotation('Ship'),
      annotation('Ship'),
      annotation('Ship'),
    ]);
    expect(located).toHaveLength(2);
  });

  test('an unmatched quote is dropped and does not disturb the rows around it', () => {
    const located = locateAnnotations(TEXT, [
      annotation('Ship one small thing'),
      annotation('this phrase is not in the draft'),
      annotation('Nobody reads manuals'),
    ]);
    expect(located.map((r) => r.quote)).toEqual(['Ship one small thing', 'Nobody reads manuals']);
    for (const row of located) {
      expect(TEXT.slice(row.from, row.to)).toBe(row.quote);
    }
  });

  test('empty, blank and over-long quotes never produce a zero-width or bogus row', () => {
    const located = locateAnnotations(TEXT, [
      annotation(''),
      annotation('   '),
      annotation(`${TEXT} and then some more text than the draft holds`),
      annotation('in public'),
    ]);
    expect(located).toHaveLength(1);
    expect(located[0]?.quote).toBe('in public');
    expect(TEXT.slice(located[0]?.from ?? 0, located[0]?.to ?? 0)).toBe('in public');
  });

  test('empty text and empty annotation lists return nothing', () => {
    expect(locateAnnotations('', [])).toEqual([]);
    expect(locateAnnotations('', [annotation('anything')])).toEqual([]);
    expect(locateAnnotations(TEXT, [])).toEqual([]);
    expect(locateAnnotations('', [annotation('')])).toEqual([]);
  });

  test('annotations arriving out of document order lose the earlier one', () => {
    // Documented limitation of the consumed-offset walk (see the module header):
    // the later-in-text quote wins and the earlier is silently dropped. Pinned so
    // a future change to claimed-range matching is a deliberate edit.
    const located = locateAnnotations(TEXT, [
      annotation('Nobody reads manuals'),
      annotation('Ship one small thing'),
    ]);
    expect(located.map((r) => r.quote)).toEqual(['Nobody reads manuals']);
  });

  test('multi-line drafts and regex-special characters locate literally', () => {
    const text = 'Cost: $0.20 (13x)\n\nMove the URL to a reply.';
    const located = locateAnnotations(text, [annotation('$0.20 (13x)'), annotation('a reply.')]);
    expect(located).toHaveLength(2);
    for (const row of located) {
      expect(text.slice(row.from, row.to)).toBe(row.quote);
    }
  });

  test('never throws on junk shaped like a payload from a bad model', () => {
    const junk = [
      { quote: null, severity: 'suggestion', recommendation: 'x' },
      { quote: undefined, severity: 'warning', recommendation: 'y' },
      annotation('in public'),
    ] as unknown as JudgeAnnotation[];
    expect(() => locateAnnotations(TEXT, junk)).not.toThrow();
    expect(locateAnnotations(TEXT, junk).map((r) => r.quote)).toEqual(['in public']);
  });
});
