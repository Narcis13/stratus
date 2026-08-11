// The server half of the sweep filters.
//
// src/shared/radarSweep.ts is shared with the page and must stay
// dependency-free (§7.26/7.27), so it can never read the settings store
// itself — the config arrives as an argument. This is the one place that turns
// the `x.sweep.*` rows into that argument for a SERVER caller, so the page's
// capture rule and any server-side reading of it can't drift.
//
// This replaces `bandThresholds.ts`, deleted with the reply-band classifier:
// the sweep is now the only rule that decides what a tweet qualifies for, so
// it is also the only axis a server-side measurement may bucket against.
//
// Read at REQUEST time (the store is sync + Map-cached, invalidated on write),
// so a PATCH moves the next call with no restart. The page half is
// extension/src/shared/serverSettings.ts, fed by the mirrored blob.

import type { SweepConfig } from '../../shared/radarSweep.ts';
import { getSetting } from './registry.ts';

/** Every `SweepConfig` field ↔ the registry key that holds it, in the order the
 *  gear reads them. Exhaustive by TYPE (`{[K in keyof SweepConfig]: string}`), so
 *  a twelfth field on the interface fails to compile until it is named here —
 *  which is the point: a preset that silently omitted a knob would load a config
 *  the user believes they saved. Both directions below go through this map. */
export const SWEEP_SETTING_KEYS: { [K in keyof SweepConfig]: string } = {
  minViews: 'x.sweep.minViews',
  maxViews: 'x.sweep.maxViews',
  minLikes: 'x.sweep.minLikes',
  maxLikes: 'x.sweep.maxLikes',
  minReplies: 'x.sweep.minReplies',
  maxReplies: 'x.sweep.maxReplies',
  maxAgeMin: 'x.sweep.maxAgeMin',
  verifiedOnly: 'x.sweep.verifiedOnly',
  campedBypass: 'x.sweep.campedBypass',
  circleBypass: 'x.sweep.circleBypass',
  autoStopMin: 'x.sweep.autoStopMin',
};

export function sweepConfigFromSettings(): SweepConfig {
  return {
    minViews: getSetting<number>(SWEEP_SETTING_KEYS.minViews),
    maxViews: getSetting<number>(SWEEP_SETTING_KEYS.maxViews),
    minLikes: getSetting<number>(SWEEP_SETTING_KEYS.minLikes),
    maxLikes: getSetting<number>(SWEEP_SETTING_KEYS.maxLikes),
    minReplies: getSetting<number>(SWEEP_SETTING_KEYS.minReplies),
    maxReplies: getSetting<number>(SWEEP_SETTING_KEYS.maxReplies),
    maxAgeMin: getSetting<number>(SWEEP_SETTING_KEYS.maxAgeMin),
    verifiedOnly: getSetting<boolean>(SWEEP_SETTING_KEYS.verifiedOnly),
    campedBypass: getSetting<boolean>(SWEEP_SETTING_KEYS.campedBypass),
    circleBypass: getSetting<boolean>(SWEEP_SETTING_KEYS.circleBypass),
    autoStopMin: getSetting<number>(SWEEP_SETTING_KEYS.autoStopMin),
  };
}

/** The inverse — a `SweepConfig` as a `PATCH /x/settings` body (SP.1). Loading a
 *  preset is exactly this patch, so it re-enters the registry's own validation:
 *  the floors and ceilings are the policy guard (§ Decision 5), and a stored
 *  preset is not a way around them. Pure — no store read, so it is testable
 *  without a DB. */
export function sweepSettingsPatch(cfg: SweepConfig): Record<string, number | boolean> {
  const patch: Record<string, number | boolean> = {};
  for (const [field, key] of Object.entries(SWEEP_SETTING_KEYS) as Array<
    [keyof SweepConfig, string]
  >) {
    patch[key] = cfg[field];
  }
  return patch;
}
