import { describe, expect, test } from 'bun:test';
import {
  type GlanceEntry,
  NEGLECT_DAYS,
  type PersonChip,
  buildPersonChips,
  isCannonPerson,
  isReciprocityPerson,
} from './glance.ts';

const NOW = Date.parse('2026-07-20T12:00:00Z');
const DAY_MS = 86_400_000;
const daysAgo = (n: number) => new Date(NOW - n * DAY_MS).toISOString();

function entry(over: Partial<GlanceEntry> = {}): GlanceEntry {
  return {
    stage: 'stranger',
    isTarget: false,
    isCannon: false,
    openLoops: 0,
    lastOutboundAt: null,
    lastInboundAt: null,
    followersCount: null,
    ...over,
  };
}

const kinds = (chips: PersonChip[]) => chips.map((c) => c.kind);

describe('buildPersonChips — stage gate', () => {
  test('below engaged renders no stage chip', () => {
    for (const stage of ['stranger', 'noticed']) {
      expect(kinds(buildPersonChips(entry({ stage }), NOW))).not.toContain('stage');
    }
  });

  test('engaged and up render a stage chip labelled with the stage word', () => {
    for (const stage of ['engaged', 'responded', 'mutual', 'ally']) {
      const [chip] = buildPersonChips(entry({ stage }), NOW);
      expect(chip.kind).toBe('stage');
      expect(chip.label).toBe(stage);
      expect(chip.tone).toBe(stage as PersonChip['tone']);
    }
  });

  test('unknown/future stage renders no stage chip', () => {
    expect(kinds(buildPersonChips(entry({ stage: 'legend' }), NOW))).not.toContain('stage');
  });
});

describe('buildPersonChips — target', () => {
  test('◎ chip only when isTarget', () => {
    expect(kinds(buildPersonChips(entry({ isTarget: false }), NOW))).not.toContain('target');
    const [chip] = buildPersonChips(entry({ isTarget: true }), NOW);
    expect(chip.kind).toBe('target');
    expect(chip.label).toBe('◎');
    expect(chip.tooltip).toBe('2–10x target roster');
    expect(chip.tone).toBe('target');
  });
});

describe('buildPersonChips — owed', () => {
  test('no owed chip at openLoops 0', () => {
    expect(kinds(buildPersonChips(entry({ openLoops: 0 }), NOW))).not.toContain('owed');
  });

  test('owed chip carries the count in the label; singular vs plural tooltip', () => {
    const [one] = buildPersonChips(entry({ openLoops: 1 }), NOW);
    expect(one).toEqual({
      kind: 'owed',
      label: '↩ 1',
      tooltip: '1 unanswered mention from them',
      tone: 'warn',
    });
    const [two] = buildPersonChips(entry({ openLoops: 2 }), NOW);
    expect(two.label).toBe('↩ 2');
    expect(two.tooltip).toBe('2 unanswered mentions from them');
  });
});

describe('buildPersonChips — neglected', () => {
  test('exactly 7d is not neglected; 8d is', () => {
    expect(
      kinds(
        buildPersonChips(entry({ isTarget: true, lastOutboundAt: daysAgo(NEGLECT_DAYS) }), NOW),
      ),
    ).not.toContain('neglected');
    const [, chip] = buildPersonChips(entry({ isTarget: true, lastOutboundAt: daysAgo(8) }), NOW);
    expect(chip.kind).toBe('neglected');
    expect(chip.label).toBe('8d');
    expect(chip.tooltip).toBe('no reply from you in 8d');
    expect(chip.tone).toBe('warn');
  });

  test('null lastOutbound + inbound present + isTarget → neglected (days since inbound)', () => {
    const chips = buildPersonChips(
      entry({ isTarget: true, lastOutboundAt: null, lastInboundAt: daysAgo(3) }),
      NOW,
    );
    const chip = chips.find((c) => c.kind === 'neglected');
    expect(chip?.label).toBe('3d');
    expect(chip?.tooltip).toBe('no reply from you in 3d');
  });

  test('null lastOutbound with no inbound is NOT neglected (the whole roster)', () => {
    expect(
      kinds(
        buildPersonChips(entry({ isTarget: true, lastOutboundAt: null, lastInboundAt: null }), NOW),
      ),
    ).not.toContain('neglected');
  });

  test('ally/mutual are eligible even without isTarget', () => {
    expect(
      kinds(buildPersonChips(entry({ stage: 'mutual', lastOutboundAt: daysAgo(10) }), NOW)),
    ).toContain('neglected');
    expect(
      kinds(
        buildPersonChips(
          entry({ stage: 'ally', lastOutboundAt: null, lastInboundAt: daysAgo(1) }),
          NOW,
        ),
      ),
    ).toContain('neglected');
  });

  test('non-target stranger is never neglected', () => {
    expect(
      kinds(
        buildPersonChips(
          entry({ stage: 'stranger', lastOutboundAt: daysAgo(90), lastInboundAt: daysAgo(90) }),
          NOW,
        ),
      ),
    ).not.toContain('neglected');
    // engaged/responded (below mutual) without target flag are also not eligible
    expect(
      kinds(buildPersonChips(entry({ stage: 'engaged', lastOutboundAt: daysAgo(30) }), NOW)),
    ).not.toContain('neglected');
  });
});

describe('buildPersonChips — order & assembly', () => {
  test('chips are ordered stage, target, owed, neglected', () => {
    const chips = buildPersonChips(
      entry({ stage: 'mutual', isTarget: true, openLoops: 2, lastOutboundAt: daysAgo(20) }),
      NOW,
    );
    expect(kinds(chips)).toEqual(['stage', 'target', 'owed', 'neglected']);
  });

  test('a fully cold unknown handle produces no chips', () => {
    expect(buildPersonChips(entry(), NOW)).toEqual([]);
  });
});

describe('isReciprocityPerson (GT.8 — the Radar roster capture)', () => {
  test('mirrors the server floor: engaged and up are mine', () => {
    for (const stage of ['engaged', 'responded', 'mutual', 'ally']) {
      expect(isReciprocityPerson(entry({ stage }))).toBe(true);
    }
  });

  test('presence in the map is NOT membership — hover capture stops at noticed', () => {
    // The whole reason this predicate exists: the glance map holds every
    // non-retired person, and ambient AX.1 hover capture makes most of the
    // timeline `noticed`. RECIPROCITY_MIN_STAGE was measured onto `engaged`.
    for (const stage of ['stranger', 'noticed']) {
      expect(isReciprocityPerson(entry({ stage }))).toBe(false);
    }
  });

  test('a 2–10x target is mine at any stage (the roster half is unconditional)', () => {
    expect(isReciprocityPerson(entry({ stage: 'stranger', isTarget: true }))).toBe(true);
    expect(isReciprocityPerson(entry({ stage: 'noticed', isTarget: true }))).toBe(true);
  });

  test('an unknown handle, and an unknown stage word, are not mine', () => {
    expect(isReciprocityPerson(undefined)).toBe(false);
    // A server that grows a stage the cached client has never heard of must fail
    // toward the gate's refusal default, not toward membership.
    expect(isReciprocityPerson(entry({ stage: 'confidant' }))).toBe(false);
  });

  test('the chip gate and the membership rule share one floor', () => {
    // If these ever disagree, the timeline shows a stage chip for someone the
    // Radar refuses to capture (or worse, the reverse) — same STAGE_ORDER,
    // same ENGAGED_RANK, asserted rather than assumed.
    for (const stage of ['stranger', 'noticed', 'engaged', 'responded', 'mutual', 'ally']) {
      const hasStageChip = kinds(buildPersonChips(entry({ stage }), NOW)).includes('stage');
      expect(isReciprocityPerson(entry({ stage }))).toBe(hasStageChip);
    }
  });
});

describe('isCannonPerson (CQ.4)', () => {
  test('true only for an entry the server marked camped', () => {
    expect(isCannonPerson(entry({ isCannon: true }))).toBe(true);
    expect(isCannonPerson(entry({ isCannon: false }))).toBe(false);
  });

  test('an unknown handle is not camped', () => {
    expect(isCannonPerson(undefined)).toBe(false);
  });

  test('a server too old to send isCannon reads as not camped', () => {
    // The refusal default: `=== true`, not truthiness, so a payload from before
    // CQ.3 never opens the capture arm by accident.
    const legacy = entry();
    const { isCannon: _dropped, ...rest } = legacy;
    expect(isCannonPerson(rest as GlanceEntry)).toBe(false);
  });

  test('the two lanes are independent — cannon is not a stage or a target rule', () => {
    // A camped account with no relationship is the EXPECTED shape (you camp for
    // reach, not for a relationship), and a mutual/target is not camped by
    // implication. If this ever couples, the roster definition has forked.
    expect(isCannonPerson(entry({ stage: 'stranger', isCannon: true }))).toBe(true);
    expect(isCannonPerson(entry({ stage: 'ally', isTarget: true }))).toBe(false);
    expect(isReciprocityPerson(entry({ stage: 'stranger', isCannon: true }))).toBe(false);
  });
});
