import { describe, expect, test } from 'bun:test';
import type { SettingEntry, SettingsGroup } from './api.ts';
import {
  applyOptimisticValue,
  entriesForKeys,
  filterSettingGroups,
  flattenSettings,
} from './settingsClient.ts';

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

// UI.12 — the two pure halves of the shared settings-editing discipline. Both
// are used by the Settings Tuning panel AND by the inline Today gears, so a
// regression here desynchronizes two surfaces at once.
describe('entriesForKeys', () => {
  test('returns the caller order, not registry order', () => {
    // A gear's rows are a curated sequence — "cap, then snooze" — and it pulls
    // them from groups that know nothing about each other.
    expect(
      entriesForKeys(GROUPS, ['x.band.freshMin', 'x.budgets.imageDailyUsd']).map((s) => s.key),
    ).toEqual(['x.band.freshMin', 'x.budgets.imageDailyUsd']);
  });

  test('an unknown key is skipped, not faked', () => {
    // Gears name keys as string literals; if one is renamed server-side the row
    // should vanish rather than render a control over nothing.
    expect(entriesForKeys(GROUPS, ['x.gone.away', 'x.band.bigViews']).map((s) => s.key)).toEqual([
      'x.band.bigViews',
    ]);
    expect(entriesForKeys(GROUPS, [])).toEqual([]);
    expect(entriesForKeys([], ['x.band.bigViews'])).toEqual([]);
  });
});

describe('applyOptimisticValue', () => {
  test('the edited row moves and every other row is untouched', () => {
    const next = applyOptimisticValue(GROUPS, 'x.band.bigViews', 900);
    const edited = next[1]?.settings[0];
    expect([edited?.key, edited?.value, edited?.isDefault]).toEqual([
      'x.band.bigViews',
      900,
      false,
    ]);
    expect(next[1]?.settings[1]).toEqual(GROUPS[1]?.settings[1] as SettingEntry);
    expect(next[0]).toEqual(GROUPS[0] as SettingsGroup);
    // Pure: the caller's state is what re-renders, so the input must survive.
    expect(GROUPS[1]?.settings[0]?.value).toBe(1);
  });

  test('editing back TO the default clears the reset dot', () => {
    // isDefault drives the accent dot, and it has to track a slider dragged all
    // the way home — otherwise the dot claims an override that no longer exists.
    const moved = applyOptimisticValue(GROUPS, 'x.band.bigViews', 900);
    const home = applyOptimisticValue(moved, 'x.band.bigViews', 1);
    expect(home[1]?.settings[0]?.isDefault).toBe(true);
  });

  test('array values compare by contents, not identity', () => {
    // The anchor-hour knobs are numberArray; a fresh array with equal contents
    // IS the default, and `===` would call it an override forever.
    const groups: SettingsGroup[] = [
      {
        id: 'doctrine',
        label: 'Doctrine',
        settings: [
          entry({
            key: 'x.doctrine.anchors3',
            group: 'doctrine',
            type: 'numberArray',
            default: [9, 13, 18],
            value: [9, 13, 18],
          }),
        ],
      },
    ];
    expect(
      applyOptimisticValue(groups, 'x.doctrine.anchors3', [9, 13, 18])[0]?.settings[0],
    ).toEqual({ ...(groups[0]?.settings[0] as SettingEntry), isDefault: true });
    expect(
      applyOptimisticValue(groups, 'x.doctrine.anchors3', [9, 13])[0]?.settings[0]?.isDefault,
    ).toBe(false);
  });

  test('an unknown key changes nothing', () => {
    expect(applyOptimisticValue(GROUPS, 'x.gone.away', 5)).toEqual(GROUPS);
  });
});
