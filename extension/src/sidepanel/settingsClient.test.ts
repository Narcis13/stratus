import { describe, expect, test } from 'bun:test';
import type { SettingEntry, SettingsGroup } from './api.ts';
import { filterSettingGroups, flattenSettings } from './settingsClient.ts';

function entry(over: Partial<SettingEntry> & { key: string }): SettingEntry {
  return {
    group: 'budgets',
    label: 'Label',
    description: 'Description.',
    type: 'number',
    default: 1,
    value: 1,
    isDefault: true,
    ...over,
  };
}

const GROUPS: SettingsGroup[] = [
  {
    id: 'budgets',
    label: 'Budgets',
    settings: [
      entry({ key: 'x.budgets.imageDailyUsd', label: 'Image budget', description: 'Per day.' }),
      entry({ key: 'x.budgets.xSoftDailyUsd', label: 'Soft X budget', description: 'Warns.' }),
    ],
  },
  {
    id: 'band',
    label: 'Reply band',
    settings: [
      entry({
        key: 'x.band.bigViews',
        group: 'band',
        label: 'Big views',
        description: 'Views that make a post worth a reply.',
      }),
      entry({
        key: 'x.band.freshMin',
        group: 'band',
        label: 'Fresh window',
        description: 'Minutes a post still counts as fresh.',
      }),
    ],
  },
];

describe('filterSettingGroups', () => {
  test('an empty query returns the groups untouched', () => {
    expect(filterSettingGroups(GROUPS, '')).toBe(GROUPS);
    expect(filterSettingGroups(GROUPS, '   ')).toBe(GROUPS);
  });

  test('a group-label match keeps the WHOLE group', () => {
    // "budget" appears in only one of the two rows' own text, but the group is
    // called Budgets — searching a group name must not hide its other knobs.
    const res = filterSettingGroups(GROUPS, 'budget');
    expect(res.length).toBe(1);
    expect(res[0]?.id).toBe('budgets');
    expect(res[0]?.settings.length).toBe(2);
  });

  test('a group-id match keeps the whole group too', () => {
    const res = filterSettingGroups(GROUPS, 'band');
    expect(res.length).toBe(1);
    expect(res[0]?.settings.length).toBe(2);
  });

  test('otherwise filters rows by key, label or description', () => {
    expect(filterSettingGroups(GROUPS, 'bigViews')[0]?.settings.map((s) => s.key)).toEqual([
      'x.band.bigViews',
    ]);
    expect(filterSettingGroups(GROUPS, 'Fresh window')[0]?.settings.map((s) => s.key)).toEqual([
      'x.band.freshMin',
    ]);
    expect(filterSettingGroups(GROUPS, 'worth a reply')[0]?.settings.map((s) => s.key)).toEqual([
      'x.band.bigViews',
    ]);
  });

  test('is case-insensitive', () => {
    expect(filterSettingGroups(GROUPS, 'BIGVIEWS').length).toBe(1);
    expect(filterSettingGroups(GROUPS, 'bUdGeTs').length).toBe(1);
  });

  test('drops groups with no match, and returns [] when nothing matches', () => {
    expect(filterSettingGroups(GROUPS, 'nothing here')).toEqual([]);
  });

  test('does not mutate the input groups', () => {
    const before = JSON.stringify(GROUPS);
    filterSettingGroups(GROUPS, 'bigViews');
    expect(JSON.stringify(GROUPS)).toBe(before);
  });
});

describe('flattenSettings', () => {
  test('concatenates every group in order', () => {
    expect(flattenSettings(GROUPS).map((s) => s.key)).toEqual([
      'x.budgets.imageDailyUsd',
      'x.budgets.xSoftDailyUsd',
      'x.band.bigViews',
      'x.band.freshMin',
    ]);
  });
});
