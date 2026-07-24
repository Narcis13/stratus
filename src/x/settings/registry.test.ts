// UI.1 registry: the type/range/enum/numberArray validation matrix + grouping.
// Pure — no DB. The route wiring (store round-trip) is covered in
// ../routes/settings.test.ts.

import { describe, expect, test } from 'bun:test';
import {
  SETTINGS_REGISTRY,
  type SettingDef,
  settingsByGroup,
  settingsRegistry,
  validateSettingValue,
} from './registry.ts';

function def(over: Partial<SettingDef>): SettingDef {
  return {
    key: 'x.test.k',
    group: 'test',
    label: 'K',
    description: '',
    type: 'number',
    default: 0,
    scope: 'server',
    ...over,
  };
}

describe('validateSettingValue', () => {
  test('number: type + range', () => {
    const d = def({ type: 'number', min: 1, max: 100 });
    expect(validateSettingValue(d, 10)).toBeNull();
    expect(validateSettingValue(d, 1)).toBeNull();
    expect(validateSettingValue(d, 100)).toBeNull();
    expect(validateSettingValue(d, 0)).toBe('out_of_range');
    expect(validateSettingValue(d, 101)).toBe('out_of_range');
    expect(validateSettingValue(d, '10')).toBe('not_a_number');
    expect(validateSettingValue(d, Number.NaN)).toBe('not_a_number');
    expect(validateSettingValue(d, Number.POSITIVE_INFINITY)).toBe('not_a_number');
  });

  test('boolean', () => {
    const d = def({ type: 'boolean', default: false });
    expect(validateSettingValue(d, true)).toBeNull();
    expect(validateSettingValue(d, false)).toBeNull();
    expect(validateSettingValue(d, 'true')).toBe('not_a_boolean');
    expect(validateSettingValue(d, 1)).toBe('not_a_boolean');
  });

  test('string', () => {
    const d = def({ type: 'string', default: '' });
    expect(validateSettingValue(d, 'anything')).toBeNull();
    expect(validateSettingValue(d, 5)).toBe('not_a_string');
  });

  test('enum', () => {
    const d = def({ type: 'enum', default: 'low', options: ['none', 'low', 'high'] });
    expect(validateSettingValue(d, 'low')).toBeNull();
    expect(validateSettingValue(d, 'high')).toBeNull();
    expect(validateSettingValue(d, 'medium')).toBe('not_in_options');
    expect(validateSettingValue(d, 3)).toBe('not_a_string');
  });

  test('numberArray: entries, range, item count, sorted-unique', () => {
    const d = def({
      type: 'numberArray',
      default: [9, 13, 18],
      min: 0,
      max: 23,
      minItems: 1,
      maxItems: 8,
      sortedUnique: true,
    });
    expect(validateSettingValue(d, [8, 14, 19])).toBeNull();
    expect(validateSettingValue(d, [0])).toBeNull();
    expect(validateSettingValue(d, 5)).toBe('not_an_array');
    expect(validateSettingValue(d, [])).toBe('array_length');
    expect(validateSettingValue(d, [1, 2, 3, 4, 5, 6, 7, 8, 9])).toBe('array_length');
    expect(validateSettingValue(d, [1, '2'])).toBe('not_a_number');
    expect(validateSettingValue(d, [5, 24])).toBe('out_of_range');
    expect(validateSettingValue(d, [-1, 5])).toBe('out_of_range');
    expect(validateSettingValue(d, [18, 9])).toBe('not_sorted_unique');
    expect(validateSettingValue(d, [9, 9])).toBe('not_sorted_unique');
  });

  test('numberArray without sortedUnique allows any order', () => {
    const d = def({ type: 'numberArray', default: [], min: 0, max: 100 });
    expect(validateSettingValue(d, [5, 3, 3])).toBeNull();
  });
});

describe('registry adapter + grouping', () => {
  test('unknown key → undefined / unknown_setting', () => {
    expect(settingsRegistry.get('x.nope.key')).toBeUndefined();
    expect(settingsRegistry.validate('x.nope.key', 1)).toBe('unknown_setting');
  });

  test('known key validates through its def', () => {
    expect(settingsRegistry.validate('x.doctrine.ladderSwitchAt', 4)).toBeNull();
    expect(settingsRegistry.validate('x.doctrine.ladderSwitchAt', 1)).toBe('out_of_range');
    // anchors are mirrored to the extension; the quest knobs are server-only.
    expect(settingsRegistry.get('x.doctrine.anchors3')?.scope).toBe('mirrored');
    expect(settingsRegistry.get('x.quests.originalsTarget')?.scope).toBe('server');
  });

  // D2/D30c: the reply band (min/max), week-reply-% and 2–10x multipliers are
  // owned by the active niche, NOT the settings store — UI.2 dropped those keys.
  test('the niche-owned doctrine band keys are absent from the registry', () => {
    for (const gone of [
      'x.doctrine.replyTargetMin',
      'x.doctrine.replyTargetMax',
      'x.doctrine.weekReplyTargetPct',
    ]) {
      expect(settingsRegistry.get(gone)).toBeUndefined();
    }
  });

  test('settingsByGroup returns every group in GROUP_LABELS order, each labelled', () => {
    const groups = settingsByGroup();
    expect(groups.map((g) => g.id)).toEqual([
      'doctrine',
      'quests',
      'people',
      'followups',
      'pinned',
      'digest',
      'display',
    ]);
    expect(groups.map((g) => g.label)).toEqual([
      'Doctrine',
      'Quests',
      'People',
      'Follow-ups',
      'Pinned watch',
      'Digest',
      'Display',
    ]);

    const doctrine = groups.find((g) => g.id === 'doctrine');
    const dkeys = doctrine?.defs.map((d) => d.key) ?? [];
    // Only the cadence ladder survives in the doctrine group.
    expect(dkeys).toEqual([
      'x.doctrine.anchors3',
      'x.doctrine.anchors4',
      'x.doctrine.ladderSwitchAt',
    ]);

    const quests = groups.find((g) => g.id === 'quests');
    expect(quests?.defs.map((d) => d.key)).toContain('x.quests.originalsTarget');
    const display = groups.find((g) => g.id === 'display');
    expect(display?.defs.map((d) => d.key)).toContain('x.display.sparklineDays');

    // Every def belongs to exactly one group (no orphans).
    const grouped = groups.reduce((n, g) => n + g.defs.length, 0);
    expect(grouped).toBe(SETTINGS_REGISTRY.length);
  });

  test('UI.3 groups carry their knobs; the niche-owned band multipliers stay out', () => {
    const groups = settingsByGroup();
    const keysOf = (id: string) => groups.find((g) => g.id === id)?.defs.map((d) => d.key) ?? [];

    expect(keysOf('people')).toEqual([
      'x.people.mutualExchangeDays',
      'x.people.allyExchangeDays',
      'x.people.allyWindowDays',
    ]);
    expect(keysOf('followups')).toEqual([
      'x.followups.chainLiveMaxAgeH',
      'x.followups.dmReadyWindowDays',
      'x.followups.neglectedTargetDays',
      'x.followups.neglectedAllyDays',
      'x.followups.momentumWeeklyPct',
      'x.followups.reupMinAgeDays',
      'x.followups.reupMaxAgeDays',
      'x.followups.fanUnacknowledgedDays',
    ]);
    expect(keysOf('pinned')).toEqual(['x.pinned.staleDays', 'x.pinned.outperformRatio']);
    expect(keysOf('digest')).toEqual(['x.digest.neglectedCap']);

    // The 2–10x target-band multipliers are niche doctrine (loadDoctrine), never
    // settings keys — the D2/D30c single-owner call, same as the reply band.
    const allKeys = SETTINGS_REGISTRY.map((d) => d.key);
    expect(allKeys).not.toContain('x.people.targetBandMinX');
    expect(allKeys).not.toContain('x.people.targetBandMaxX');
  });

  test('validation honors UI.3 ranges (fractional outperform ratio + bounds)', () => {
    expect(settingsRegistry.validate('x.people.mutualExchangeDays', 3)).toBeNull();
    expect(settingsRegistry.validate('x.people.mutualExchangeDays', 0)).toBe('out_of_range');
    expect(settingsRegistry.validate('x.followups.chainLiveMaxAgeH', 72)).toBeNull();
    expect(settingsRegistry.validate('x.followups.chainLiveMaxAgeH', 73)).toBe('out_of_range');
    expect(settingsRegistry.validate('x.pinned.outperformRatio', 2.5)).toBeNull();
    expect(settingsRegistry.validate('x.pinned.outperformRatio', 1)).toBe('out_of_range');
  });
});
