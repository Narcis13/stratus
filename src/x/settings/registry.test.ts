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
    expect(settingsRegistry.validate('x.doctrine.replyTargetMin', 15)).toBeNull();
    expect(settingsRegistry.validate('x.doctrine.replyTargetMin', 0)).toBe('out_of_range');
    expect(settingsRegistry.get('x.doctrine.anchors3')?.scope).toBe('mirrored');
    expect(settingsRegistry.get('x.doctrine.replyTargetMin')?.scope).toBe('server');
  });

  test('settingsByGroup returns the doctrine group with a label and all its defs', () => {
    const groups = settingsByGroup();
    const doctrine = groups.find((g) => g.id === 'doctrine');
    expect(doctrine).toBeDefined();
    expect(doctrine?.label).toBe('Doctrine');
    const keys = doctrine?.defs.map((d) => d.key) ?? [];
    expect(keys).toContain('x.doctrine.replyTargetMin');
    expect(keys).toContain('x.doctrine.anchors3');
    expect(keys.length).toBe(SETTINGS_REGISTRY.filter((d) => d.group === 'doctrine').length);
  });
});
