// The extension half of the settings platform (UI.6) — the mirrored knobs.
//
// The background service worker is the only fetcher and the only writer of the
// `settings:server` blob (§7.24/7.25); every reader resolves it through this
// module — the side panel via useServerSettings(), the content script via an
// init read + chrome.storage.onChanged — so the server and the page can never
// fork on what a knob means (§7.27).
//
// The baked defaults below are the ONE owner of each mirrored number inside the
// extension: composerLogic's cadence/gate params default to them, so an
// unreachable or never-configured server degrades to today's behavior instead
// of breaking a suggestion or a badge.
//
// Only keys the server registry marks `scope:'mirrored'` belong here — check
// `GET /x/settings/values?scope=mirrored` before adding one, and add the
// matching baked fallback in the same edit.

/** chrome.storage.local key the background writes the flat blob to. */
export const SERVER_SETTINGS_KEY = 'settings:server';

/** The wire shape: the flat `{ key: value }` map the values route returns. */
export type ServerSettingsBlob = Record<string, unknown>;

/** The mirrored knobs, resolved into the shape consumers actually use. */
export interface ServerConfig {
  /** x.doctrine.anchors3 — local hours the 3/day cadence ladder anchors on. */
  anchors3: number[];
  /** x.doctrine.anchors4 — local hours the 4/day ladder anchors on. */
  anchors4: number[];
  /** x.doctrine.ladderSwitchAt — filled slots at which the 4/day ladder wins. */
  ladderSwitchAt: number;
  /** x.gates.bestTimeMinN — measured posts a cell needs to be recommendable. */
  bestTimeMinN: number;
  /** x.mentions.panelRefreshCap — inbox refreshes the panel offers per day.
   *  Deliberately NOT the server's own cap: that one is the real limit, this is
   *  only the panel's budget, so a missing blob still degrades gracefully. */
  panelRefreshCap: number;
}

export const SERVER_DEFAULTS: ServerConfig = {
  anchors3: [9, 13, 18],
  anchors4: [8, 12, 16, 20],
  ladderSwitchAt: 4,
  bestTimeMinN: 3,
  panelRefreshCap: 4,
};

// Ranges/steps were already enforced by the registry when the value was
// written, so these guards are about a corrupted or half-written blob, not
// about re-implementing policy: anything that isn't the right *shape* falls
// back to the baked value, per key, leaving the rest of the blob usable.
function readNumber(blob: ServerSettingsBlob, key: string, fallback: number): number {
  const v = blob[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

function readHours(blob: ServerSettingsBlob, key: string, fallback: number[]): number[] {
  const v = blob[key];
  if (!Array.isArray(v) || v.length === 0) return fallback;
  if (!v.every((h): h is number => typeof h === 'number' && Number.isFinite(h))) return fallback;
  return v;
}

/** Resolve a stored blob (or anything at all) into a usable config. A missing,
 *  malformed or partial blob yields the baked defaults for whatever it can't
 *  supply — reading settings never throws and never returns undefined. */
export function readServerConfig(raw: unknown): ServerConfig {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return SERVER_DEFAULTS;
  const blob = raw as ServerSettingsBlob;
  return {
    anchors3: readHours(blob, 'x.doctrine.anchors3', SERVER_DEFAULTS.anchors3),
    anchors4: readHours(blob, 'x.doctrine.anchors4', SERVER_DEFAULTS.anchors4),
    ladderSwitchAt: readNumber(blob, 'x.doctrine.ladderSwitchAt', SERVER_DEFAULTS.ladderSwitchAt),
    bestTimeMinN: readNumber(blob, 'x.gates.bestTimeMinN', SERVER_DEFAULTS.bestTimeMinN),
    panelRefreshCap: readNumber(
      blob,
      'x.mentions.panelRefreshCap',
      SERVER_DEFAULTS.panelRefreshCap,
    ),
  };
}
