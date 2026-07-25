// Timeline person chips (Augmented X UI v2, AX.2) — GET /x/people/glance
// returns a $0 handle → decoration map (all non-retired people + the 2–10x
// target roster, richer than rankmap). The content script fetches it once per
// session (GLANCE_TTL_MS cache) and stamps small native-looking chips right of
// the name/handle row. This module is the pure, unit-testable view-model core
// (map type + chip derivation); the DOM plumbing lives in content.ts.
//
// Dependency-free on purpose so Vite inlines it into the content IIFE.

// One entry of the glance map, typed after the AX.1 JSON. Keyed by lowercased
// handle. stage is `string` (not a union) for the same reason radar's
// RankMapEntry is — a looser client cache tolerates a server that grows a stage.
export interface GlanceEntry {
  stage: string;
  isTarget: boolean;
  openLoops: number; // unanswered mentions from this author
  lastOutboundAt: string | null; // my last posted reply to them (ISO)
  lastInboundAt: string | null; // their last mention/reply to me (ISO)
  followersCount: number | null;
}
export type GlanceMap = Record<string, GlanceEntry>;

// A target with my last reply older than this (or never, once they've reached
// out) reads as neglected — same 7d reading as the Targets amber and the C5
// neglected_target followup (NEGLECTED_TARGET_DAYS).
export const NEGLECT_DAYS = 7;

// The content script caches the whole map for 10 minutes (channels-cache
// pattern) — glance is read-only and cheap to recompute.
export const GLANCE_TTL_MS = 10 * 60_000;

const DAY_MS = 86_400_000;

// The reciprocity ladder, hardcoded so the IIFE stays free of the server
// stage.ts. A stage chip only renders from engaged up (C6 hover capture makes
// half the timeline `noticed`; chips below engaged would be noise).
const STAGE_ORDER = ['stranger', 'noticed', 'engaged', 'responded', 'mutual', 'ally'];
const ENGAGED_RANK = STAGE_ORDER.indexOf('engaged');

export interface PersonChip {
  kind: 'stage' | 'target' | 'owed' | 'neglected';
  label: string;
  tooltip: string;
  tone: 'ally' | 'mutual' | 'responded' | 'engaged' | 'target' | 'warn';
}

// Ordered chips for one timeline row: stage (real relationships only), ◎ target
// marker, ↩ owed (unanswered mentions I haven't cleared), and a `9d` neglect
// mark on targets/allies I've gone quiet on. Order is fixed: stage, target,
// owed, neglected.
export function buildPersonChips(entry: GlanceEntry, nowMs: number): PersonChip[] {
  const chips: PersonChip[] = [];

  const rank = STAGE_ORDER.indexOf(entry.stage);
  if (rank >= ENGAGED_RANK) {
    chips.push({
      kind: 'stage',
      label: entry.stage,
      tooltip: `relationship: ${entry.stage}`,
      tone: entry.stage as PersonChip['tone'],
    });
  }

  if (entry.isTarget) {
    chips.push({ kind: 'target', label: '◎', tooltip: '2–10x target roster', tone: 'target' });
  }

  if (entry.openLoops > 0) {
    const n = entry.openLoops;
    chips.push({
      kind: 'owed',
      label: `↩ ${n}`,
      tooltip: `${n} unanswered mention${n === 1 ? '' : 's'} from them`,
      tone: 'warn',
    });
  }

  const eligible = entry.isTarget || entry.stage === 'ally' || entry.stage === 'mutual';
  if (eligible) {
    const cutoff = nowMs - NEGLECT_DAYS * DAY_MS;
    const outMs = entry.lastOutboundAt ? Date.parse(entry.lastOutboundAt) : null;
    const inMs = entry.lastInboundAt ? Date.parse(entry.lastInboundAt) : null;
    // Neglected when my last reply is older than the window, or I've never
    // replied but they've reached out (a dropped inbound). A target I've never
    // touched who's never reached out is NOT neglected — that's the whole
    // roster, and would be noise.
    const neglectedByOutbound = outMs !== null && outMs < cutoff;
    const neverButOwed = outMs === null && inMs !== null;
    if (neglectedByOutbound || neverButOwed) {
      // Days since my last reply, or since they last reached out when I never
      // replied — either way "how long they've been waiting".
      const sinceMs = outMs ?? (inMs as number);
      const days = Math.max(0, Math.floor((nowMs - sinceMs) / DAY_MS));
      chips.push({
        kind: 'neglected',
        label: `${days}d`,
        tooltip: `no reply from you in ${days}d`,
        tone: 'warn',
      });
    }
  }

  return chips;
}
