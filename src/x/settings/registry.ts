// The typed settings catalog for the X platform (UI.1). This is the single
// source of truth for every tunable knob: its default, valid range, UI metadata,
// and whether it's mirrored to the extension. Routes and (later) workers read
// values through the bound helpers at the bottom; pure modules never touch the
// store — they take params defaulted to today's constants (Decision 6).
//
// Seeded with the DOCTRINE group only so the routes are testable; later
// masterplan tasks (UI.2–UI.7) append the remaining groups and wire consumers.
// Adding a group = push its SettingDefs here + a GROUP_LABELS entry; the routes
// and the extension mirror pick it up with no other change.

import * as store from '../../settings/store.ts';
import type { SettingScope, SettingsRegistry } from '../../settings/store.ts';

export type { SettingScope };
export { SettingsError } from '../../settings/store.ts';

export type SettingType = 'number' | 'boolean' | 'string' | 'enum' | 'numberArray';

export interface SettingDef {
  /** Dot-namespaced, e.g. 'x.doctrine.anchors3'. */
  key: string;
  /** Group id — the tab section it renders under. */
  group: string;
  label: string;
  /** Carries the "why"/warning copy shown under the control. */
  description: string;
  type: SettingType;
  default: unknown;
  /** Bounds — for `number` the value, for `numberArray` each entry. */
  min?: number;
  max?: number;
  step?: number;
  /** For `enum`. */
  options?: string[];
  /** Display unit ('days' | 'min' | 'usd' | '×' | 'h UTC' …). */
  unit?: string;
  scope: SettingScope;
  /** Worker-cadence knobs are 'restart' — read once at startXWorkers. */
  appliesOn?: 'immediate' | 'restart';
  /** For `numberArray`: entry-count bounds. */
  minItems?: number;
  maxItems?: number;
  /** For `numberArray`: entries must be strictly ascending (⇒ unique). */
  sortedUnique?: boolean;
}

// --------------------------------------------------------------- the catalog

// Doctrine — the cadence ladder (OVERHAUL-PLAN §9). Only the anchor hours and the
// ladder switch-point live here. The reply band (min/max), the week reply-ratio,
// and the 2–10x band multipliers are owned by the ACTIVE NICHE (niches.doctrine,
// N.5) and read via loadDoctrine() — NOT the settings store. UI.2 dropped the three
// duplicate band keys UI.1 had seeded so there is exactly one owner (D2/D30c); the
// Settings tab (UI.11) links those to the Niche card. The anchors + ladder switch
// are consumed by brief.ts (gaps + ladder pick) and mirrored to the extension
// composer (UI.6); here they are inert defaults until UI.2 wires the brief.
const DOCTRINE: SettingDef[] = [
  {
    key: 'x.doctrine.anchors3',
    group: 'doctrine',
    label: '3/day anchor hours',
    description: 'Local hours the 3-posts-a-day cadence ladder anchors on.',
    type: 'numberArray',
    default: [9, 13, 18],
    min: 0,
    max: 23,
    minItems: 1,
    maxItems: 8,
    sortedUnique: true,
    scope: 'mirrored',
  },
  {
    key: 'x.doctrine.anchors4',
    group: 'doctrine',
    label: '4/day anchor hours',
    description: 'Local hours the 4-posts-a-day cadence ladder anchors on.',
    type: 'numberArray',
    default: [8, 12, 16, 20],
    min: 0,
    max: 23,
    minItems: 1,
    maxItems: 8,
    sortedUnique: true,
    scope: 'mirrored',
  },
  {
    key: 'x.doctrine.ladderSwitchAt',
    group: 'doctrine',
    label: 'Ladder switch-at',
    description:
      'Filled-slot count at which the cadence picks the 4/day ladder over the 3/day one.',
    type: 'number',
    default: 4,
    min: 2,
    max: 8,
    scope: 'mirrored',
  },
];

// Quests (CIRCLES-PLAN C9) — the daily-quest targets computeQuests() reads. There
// is deliberately NO x.quests.replyQuestTarget: the reply quest derives from the
// niche reply band (or an active commitment that outranks it — GR.8), so a settings
// key here would be a second, silent owner of the same number.
const QUESTS: SettingDef[] = [
  {
    key: 'x.quests.originalsTarget',
    group: 'quests',
    label: 'Originals per day',
    description:
      'Default daily target for the "original post" quest when no active commitment raises it. 0 makes the quest optional (vacuously done).',
    type: 'number',
    default: 1,
    min: 0,
    max: 10,
    scope: 'server',
  },
  {
    key: 'x.quests.neglectedTargetsCount',
    group: 'quests',
    label: 'Neglected targets per day',
    description:
      'How many neglected roster targets the daily quest asks you to reply to (capped by how many are actually neglected).',
    type: 'number',
    default: 2,
    min: 0,
    max: 10,
    scope: 'server',
  },
  {
    key: 'x.quests.neglectedTargetDays',
    group: 'quests',
    label: 'Neglected after',
    description: 'Days without a reply from you before a roster target counts as neglected.',
    type: 'number',
    default: 7,
    min: 1,
    max: 60,
    unit: 'days',
    scope: 'server',
  },
  {
    key: 'x.quests.launchAttendWindowMin',
    group: 'quests',
    label: 'Launch attend window',
    description:
      'Minutes after a post goes live during which a pasted reply still counts as attending its launch room.',
    type: 'number',
    default: 30,
    min: 5,
    max: 120,
    unit: 'min',
    scope: 'server',
  },
];

// Display — soft presentation limits the brief applies to already-collected data;
// they never change what is measured or billed, only how much of it is shown.
const DISPLAY: SettingDef[] = [
  {
    key: 'x.display.sparklineDays',
    group: 'display',
    label: 'Follower sparkline days',
    description: 'How many days of follower history the Today sparkline spans.',
    type: 'number',
    default: 14,
    min: 7,
    max: 60,
    unit: 'days',
    scope: 'server',
  },
  {
    key: 'x.display.leaderCount',
    group: 'display',
    label: 'Profile-click leaders',
    description: 'How many top profile-click tweets the Today brief lists.',
    type: 'number',
    default: 3,
    min: 1,
    max: 10,
    scope: 'server',
  },
];

export const SETTINGS_REGISTRY: SettingDef[] = [...DOCTRINE, ...QUESTS, ...DISPLAY];

/** Human labels for each group id, in the order they should render. */
export const GROUP_LABELS: Record<string, string> = {
  doctrine: 'Doctrine',
  quests: 'Quests',
  display: 'Display',
};

// ------------------------------------------------------------- validation

/** null = valid; otherwise a short reason code (surfaced as `reason` on the 400).
 *  Assumes `def` describes `key`; unknown keys are caught before this is called. */
export function validateSettingValue(def: SettingDef, v: unknown): string | null {
  switch (def.type) {
    case 'number': {
      if (typeof v !== 'number' || !Number.isFinite(v)) return 'not_a_number';
      if (def.min !== undefined && v < def.min) return 'out_of_range';
      if (def.max !== undefined && v > def.max) return 'out_of_range';
      return null;
    }
    case 'boolean':
      return typeof v === 'boolean' ? null : 'not_a_boolean';
    case 'string':
      return typeof v === 'string' ? null : 'not_a_string';
    case 'enum':
      if (typeof v !== 'string') return 'not_a_string';
      return def.options?.includes(v) ? null : 'not_in_options';
    case 'numberArray': {
      if (!Array.isArray(v)) return 'not_an_array';
      if (def.minItems !== undefined && v.length < def.minItems) return 'array_length';
      if (def.maxItems !== undefined && v.length > def.maxItems) return 'array_length';
      let prev = Number.NEGATIVE_INFINITY;
      for (const entry of v) {
        if (typeof entry !== 'number' || !Number.isFinite(entry)) return 'not_a_number';
        if (def.min !== undefined && entry < def.min) return 'out_of_range';
        if (def.max !== undefined && entry > def.max) return 'out_of_range';
        if (def.sortedUnique && entry <= prev) return 'not_sorted_unique';
        prev = entry;
      }
      return null;
    }
    default:
      return 'unknown_type';
  }
}

export interface SettingGroup {
  id: string;
  label: string;
  defs: SettingDef[];
}

/** The catalog grouped for the GET /x/settings response, group order following
 *  GROUP_LABELS (any group without a label sorts last, keyed by id). */
export function settingsByGroup(): SettingGroup[] {
  const byGroup = new Map<string, SettingDef[]>();
  for (const def of SETTINGS_REGISTRY) {
    const arr = byGroup.get(def.group);
    if (arr) arr.push(def);
    else byGroup.set(def.group, [def]);
  }
  const order = Object.keys(GROUP_LABELS);
  const ids = [...byGroup.keys()].sort((a, b) => {
    const ia = order.indexOf(a);
    const ib = order.indexOf(b);
    if (ia !== -1 && ib !== -1) return ia - ib;
    if (ia !== -1) return -1;
    if (ib !== -1) return 1;
    return a.localeCompare(b);
  });
  return ids.map((id) => ({ id, label: GROUP_LABELS[id] ?? id, defs: byGroup.get(id) ?? [] }));
}

// ------------------------------------------------- the store adapter + binds

const byKey = new Map<string, SettingDef>(SETTINGS_REGISTRY.map((d) => [d.key, d]));

/** Adapter satisfying the platform-agnostic store's SettingsRegistry contract. */
export const settingsRegistry: SettingsRegistry = {
  get(key) {
    const def = byKey.get(key);
    return def ? { default: def.default, scope: def.scope, group: def.group } : undefined;
  },
  list() {
    return SETTINGS_REGISTRY.map((d) => ({
      key: d.key,
      default: d.default,
      scope: d.scope,
      group: d.group,
    }));
  },
  validate(key, value) {
    const def = byKey.get(key);
    if (!def) return 'unknown_setting';
    return validateSettingValue(def, value);
  },
};

// Bound helpers — consumers (routes, workers) import these, never the store
// directly, so they never have to thread the registry through.
export const getSetting = <T>(key: string): T => store.getSetting<T>(settingsRegistry, key);
export const resolveSetting = (key: string): store.ResolvedSetting =>
  store.resolveSetting(settingsRegistry, key);
export const getAllValues = (scope?: SettingScope): Record<string, unknown> =>
  store.getAllValues(settingsRegistry, scope);
export const setSettings = (
  patch: Record<string, unknown>,
): Array<{ key: string; value: unknown }> => store.setSettings(settingsRegistry, patch);
export const resetSettings = (opts: { keys?: string[]; group?: string }): { reset: string[] } =>
  store.resetSettings(settingsRegistry, opts);
