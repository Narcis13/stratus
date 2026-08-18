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
//
// The imports here are shims over shared pure modules — `../cannon.ts` and
// `../radarSweep.ts` — and nothing else: content.ts already inlines both into
// the IIFE, and CANNON/SWEEP are the canonical owners of their defaults on BOTH
// sides of the wire, so re-typing those numbers here would be the second-owner
// bug this file exists to prevent. The rule this module actually lives by is
// "nothing that can't be inlined into the content-script IIFE" (§7.26) — no
// React, no sidepanel module, nothing with its own dependencies.

import { CANNON, type CannonThresholds } from '../cannon.ts';
import { SWEEP, type SweepConfig, type SweepMediaFilter } from '../radarSweep.ts';

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
  /** x.cannon.* — every threshold the Cannon view filters and tints with. The
   *  server's cannon routes read the same four knobs, so one number moves both
   *  sides; `scoreMin` is a MEASURED floor (see src/shared/cannon.ts). */
  cannon: CannonThresholds;
  /** x.sweep.* — the thirteen knobs an armed sweep admits on (RS.1), and now the
   *  ONLY rule that decides what a tweet qualifies for. The server reads them
   *  too (`sweepConfigFromSettings`, for the Playbook's timeline funnel), so one
   *  number moves both sides; a `0` on any `max*` means no ceiling. */
  sweep: SweepConfig;
  /** x.display.doNextCap — rows the Today "Do next" strip shows before the
   *  overflow line (UI.12). */
  doNextCap: number;
  /** x.display.doNextSnoozeH — how far the "zz" button pushes a follow-up out.
   *  The snooze itself is stored server-side at press time. */
  doNextSnoozeH: number;
  /** x.display.fansAmberTopN — how deep into Top fans an unacknowledged fan
   *  still ambers. */
  fansAmberTopN: number;
  /** x.display.radarDraftCap — tweets one "Draft replies" click batches. Always
   *  use it through `radarBatchSize()`, never raw: the server enforces
   *  `batchReplyCap` and refuses (not truncates) anything above it. */
  radarDraftCap: number;
  /** x.ai.batchReplyCap — the batch size the SERVER enforces. Mirrored only so
   *  the panel can stop asking for a batch it knows will be refused. */
  batchReplyCap: number;
  /** x.radar.curatedCount — tweets that survive a "Curate & draft" pass (RC.3).
   *  Mirrored for two panel-only jobs the server can't do: the button's label,
   *  and deciding whether the button renders at all. Use it through
   *  `curatedBatchSize()`, never raw — the drafting call still enforces
   *  `batchReplyCap` on top of it. */
  curatedCount: number;
  /** x.followups.neglectedTargetDays — days cold before a roster target reads as
   *  neglected. The same key the follow-up queue and the weekly digest use: the
   *  Today roster tint must not disagree with the queue that nags about it. */
  neglectedTargetDays: number;
  /** x.display.dossierListLen — rows each capped dossier list shows (replies,
   *  their mentions, their saved tweets). The timeline below stays uncapped:
   *  the dossier's whole job is "what's my history with this person?" (UI.14). */
  dossierListLen: number;
  /** x.display.channelPostsShown — own posts a channel room lists under its
   *  mapped pillar. The median line above is over every measured post. */
  channelPostsShown: number;
  /** x.display.voiceListLimit — saved tweets one Voice query fetches. $0 local
   *  SQL, so this is a scroll budget, not a spend one. */
  voiceListLimit: number;
  /** x.display.repliesListLimit — reply drafts the Replies tab loads into its
   *  History list. Local rows, so also a scroll budget (UI.15). */
  repliesListLimit: number;
  /** x.identity.selfHandle — my X handle, no @. Mirrored so the Harvest tab's
   *  "My replies" preset can prefill it. Blank means unset: every consumer must
   *  degrade to "ask the user", never guess a handle (§7.11). */
  selfHandle: string;
}

export const SERVER_DEFAULTS: ServerConfig = {
  anchors3: [9, 13, 18],
  anchors4: [8, 12, 16, 20],
  ladderSwitchAt: 4,
  bestTimeMinN: 3,
  cannon: CANNON,
  sweep: SWEEP,
  doNextCap: 5,
  doNextSnoozeH: 24,
  fansAmberTopN: 10,
  radarDraftCap: 20,
  batchReplyCap: 25,
  curatedCount: 25,
  neglectedTargetDays: 7,
  dossierListLen: 5,
  channelPostsShown: 8,
  voiceListLimit: 100,
  repliesListLimit: 100,
  selfHandle: '',
};

/** The batch size a "Draft replies" click may actually ask for: the display cap,
 *  clamped to the cap the server enforces. Both knobs are independently editable
 *  and the ceiling can move under either one, so the clamp lives here — one
 *  place — rather than in the Radar's render. */
export function radarBatchSize(cfg: ServerConfig): number {
  return Math.max(1, Math.min(cfg.radarDraftCap, cfg.batchReplyCap));
}

/** How many tweets one "Curate & draft" pass drafts (RC.4): the curated size,
 *  clamped by the same server-enforced batch cap. The server computes this
 *  identically (`curateKeepTarget()`) to decide how many ids to KEEP; the panel
 *  needs its own copy for the button label and the "is the queue big enough to
 *  bother curating" test, both of which happen before any call is made. Two
 *  readers of one pair of knobs, not two owners of a number. */
export function curatedBatchSize(cfg: ServerConfig): number {
  return Math.max(1, Math.min(cfg.curatedCount, cfg.batchReplyCap));
}

// Ranges/steps were already enforced by the registry when the value was
// written, so these guards are about a corrupted or half-written blob, not
// about re-implementing policy: anything that isn't the right *shape* falls
// back to the baked value, per key, leaving the rest of the blob usable.
function readNumber(blob: ServerSettingsBlob, key: string, fallback: number): number {
  const v = blob[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

function readString(blob: ServerSettingsBlob, key: string, fallback: string): string {
  const v = blob[key];
  return typeof v === 'string' ? v : fallback;
}

function readBoolean(blob: ServerSettingsBlob, key: string, fallback: boolean): boolean {
  const v = blob[key];
  return typeof v === 'boolean' ? v : fallback;
}

// The mirror's first ENUM key. Same per-key discipline as the rest, and the
// membership test is the point: a blob carrying a value this build has never
// heard of — a knob whose options were widened server-side — falls back to the
// baked default rather than reaching `passesContentGates` as a string that
// matches neither branch and silently disables the gate.
function readMediaFilter(
  blob: ServerSettingsBlob,
  key: string,
  fallback: SweepMediaFilter,
): SweepMediaFilter {
  const v = blob[key];
  return v === 'any' || v === 'with' || v === 'without' ? v : fallback;
}

function readHours(blob: ServerSettingsBlob, key: string, fallback: number[]): number[] {
  const v = blob[key];
  if (!Array.isArray(v) || v.length === 0) return fallback;
  if (!v.every((h): h is number => typeof h === 'number' && Number.isFinite(h))) return fallback;
  return v;
}

// Per-key discipline, the same one every resolver here follows: the page's Cannon
// view and the server's cannon routes filter on these four, so a corrupt
// `scoreMin` must not also drop the age cutoff back to baked.
function readCannon(blob: ServerSettingsBlob): CannonThresholds {
  return {
    scoreMin: readNumber(blob, 'x.cannon.scoreMin', CANNON.scoreMin),
    maxAgeMin: readNumber(blob, 'x.cannon.maxAgeMin', CANNON.maxAgeMin),
    redAgeMin: readNumber(blob, 'x.cannon.redAgeMin', CANNON.redAgeMin),
    placedTarget: readNumber(blob, 'x.cannon.placedTarget', CANNON.placedTarget),
  };
}

// Same per-key discipline again, and here it is the sharpest: these thirteen are
// the ONLY rule deciding what an armed sweep captures, so a corrupt `minViews`
// dropping the other ten back to baked would quietly re-open the intake with a
// config the user never chose. Per key, the baked `SWEEP` value stands in.
function readSweep(blob: ServerSettingsBlob): SweepConfig {
  return {
    minViews: readNumber(blob, 'x.sweep.minViews', SWEEP.minViews),
    maxViews: readNumber(blob, 'x.sweep.maxViews', SWEEP.maxViews),
    minLikes: readNumber(blob, 'x.sweep.minLikes', SWEEP.minLikes),
    maxLikes: readNumber(blob, 'x.sweep.maxLikes', SWEEP.maxLikes),
    minReplies: readNumber(blob, 'x.sweep.minReplies', SWEEP.minReplies),
    maxReplies: readNumber(blob, 'x.sweep.maxReplies', SWEEP.maxReplies),
    maxAgeMin: readNumber(blob, 'x.sweep.maxAgeMin', SWEEP.maxAgeMin),
    media: readMediaFilter(blob, 'x.sweep.media', SWEEP.media),
    excludeAds: readBoolean(blob, 'x.sweep.excludeAds', SWEEP.excludeAds),
    verifiedOnly: readBoolean(blob, 'x.sweep.verifiedOnly', SWEEP.verifiedOnly),
    campedBypass: readBoolean(blob, 'x.sweep.campedBypass', SWEEP.campedBypass),
    circleBypass: readBoolean(blob, 'x.sweep.circleBypass', SWEEP.circleBypass),
    autoStopMin: readNumber(blob, 'x.sweep.autoStopMin', SWEEP.autoStopMin),
  };
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
    cannon: readCannon(blob),
    sweep: readSweep(blob),
    doNextCap: readNumber(blob, 'x.display.doNextCap', SERVER_DEFAULTS.doNextCap),
    doNextSnoozeH: readNumber(blob, 'x.display.doNextSnoozeH', SERVER_DEFAULTS.doNextSnoozeH),
    fansAmberTopN: readNumber(blob, 'x.display.fansAmberTopN', SERVER_DEFAULTS.fansAmberTopN),
    radarDraftCap: readNumber(blob, 'x.display.radarDraftCap', SERVER_DEFAULTS.radarDraftCap),
    batchReplyCap: readNumber(blob, 'x.ai.batchReplyCap', SERVER_DEFAULTS.batchReplyCap),
    curatedCount: readNumber(blob, 'x.radar.curatedCount', SERVER_DEFAULTS.curatedCount),
    neglectedTargetDays: readNumber(
      blob,
      'x.followups.neglectedTargetDays',
      SERVER_DEFAULTS.neglectedTargetDays,
    ),
    dossierListLen: readNumber(blob, 'x.display.dossierListLen', SERVER_DEFAULTS.dossierListLen),
    channelPostsShown: readNumber(
      blob,
      'x.display.channelPostsShown',
      SERVER_DEFAULTS.channelPostsShown,
    ),
    voiceListLimit: readNumber(blob, 'x.display.voiceListLimit', SERVER_DEFAULTS.voiceListLimit),
    repliesListLimit: readNumber(
      blob,
      'x.display.repliesListLimit',
      SERVER_DEFAULTS.repliesListLimit,
    ),
    selfHandle: readString(blob, 'x.identity.selfHandle', SERVER_DEFAULTS.selfHandle),
  };
}
