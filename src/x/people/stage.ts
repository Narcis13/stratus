// Relationship stage engine (CIRCLES-PLAN C1). Pure — no DB, no clock reads.
// Stages describe *reciprocity*, nothing else: how far a stranger has moved
// toward a real two-way relationship. computeStage only ever reports what the
// events support; the ratchet (never auto-demote) is applied by the caller via
// maxStage — a human demote via PATCH sticks until the events re-earn the rank.
//
// The thresholds (2 exchange days → mutual, 4/60d → ally) are opening guesses,
// to be revisited after ~30 days of real events — same spirit as the BAND
// ≥100-outcomes gate. They are now tunable via the settings registry (the
// `people` group, UI.3): computeStage takes a StageThresholds param defaulted to
// STAGE_DEFAULTS, and recomputePerson (store.ts) reads the overrides. Change the
// DEFAULTS here and the test matrix together — a custom-thresholds test in
// stage.test.ts pins the param path independently.

export const STAGES = ['stranger', 'noticed', 'engaged', 'responded', 'mutual', 'ally'] as const;
export type Stage = (typeof STAGES)[number];

export const PERSON_EVENT_TYPES = [
  'saved_tweet',
  'saved_author',
  'my_reply',
  'their_mention',
  'their_reply_to_me',
  'hover_sighting',
  'harvest_seen',
  'their_like',
  'their_repost',
  'their_follow',
  'note',
  'manual_dm_logged',
] as const;
export type PersonEventType = (typeof PERSON_EVENT_TYPES)[number];

// Which event types mean what to the stage machine. harvest_seen, the three
// notification-harvested engagement types (C10) and the manual types are
// timeline-only — they never advance a stage on their own. Engagement is NOT
// reciprocity: someone can like fifty posts without a word being exchanged, so
// their_like/their_repost/their_follow deliberately appear in no set below.
const NOTICED_TYPES: readonly PersonEventType[] = ['saved_tweet', 'saved_author', 'hover_sighting'];
export const INBOUND_TYPES: readonly PersonEventType[] = ['their_mention', 'their_reply_to_me'];
export const OUTBOUND_TYPES: readonly PersonEventType[] = ['my_reply'];

const DAY_MS = 24 * 60 * 60 * 1000;

/** The stage-machine thresholds. Overridable per-request via the settings store
 *  (see recomputePerson); computeStage defaults to STAGE_DEFAULTS. */
export interface StageThresholds {
  /** Two-way exchange days before a relationship reaches "mutual". */
  mutualExchangeDays: number;
  /** Two-way exchange days inside the ally window before reaching "ally". */
  allyExchangeDays: number;
  /** The rolling window the ally exchange-day count must fall inside. */
  allyWindowDays: number;
}

export const STAGE_DEFAULTS: StageThresholds = {
  mutualExchangeDays: 2,
  allyExchangeDays: 4,
  allyWindowDays: 60,
};

export interface StageEvent {
  type: PersonEventType;
  at: Date;
}

export function stageRank(s: Stage): number {
  return STAGES.indexOf(s);
}

export function isStage(v: unknown): v is Stage {
  return typeof v === 'string' && (STAGES as readonly string[]).includes(v);
}

export function maxStage(a: Stage, b: Stage): Stage {
  return stageRank(a) >= stageRank(b) ? a : b;
}

/** Distinct UTC days (as day indices since epoch) on which the exchange went
 *  BOTH ways — at least one inbound and one outbound event on the same day.
 *  Sorted ascending. */
export function exchangeDays(events: StageEvent[]): number[] {
  const inboundDays = new Set<number>();
  const outboundDays = new Set<number>();
  for (const e of events) {
    const day = Math.floor(e.at.getTime() / DAY_MS);
    if (INBOUND_TYPES.includes(e.type)) inboundDays.add(day);
    else if (OUTBOUND_TYPES.includes(e.type)) outboundDays.add(day);
  }
  return [...inboundDays].filter((d) => outboundDays.has(d)).sort((a, b) => a - b);
}

/** Highest stage the event history supports at `now` (events after `now` are
 *  ignored — nothing should time-travel a stage). Thresholds default to
 *  STAGE_DEFAULTS; the store-backed overrides are read by recomputePerson. */
export function computeStage(
  events: StageEvent[],
  now: Date,
  thresholds: StageThresholds = STAGE_DEFAULTS,
): Stage {
  const nowMs = now.getTime();
  const past = events.filter((e) => e.at.getTime() <= nowMs);

  const firstReplyAt = past
    .filter((e) => OUTBOUND_TYPES.includes(e.type))
    .reduce<number | null>((min, e) => {
      const t = e.at.getTime();
      return min === null || t < min ? t : min;
    }, null);

  const days = exchangeDays(past);

  // ally: ≥N two-way exchange days inside any rolling window. Sliding window
  // over the sorted day list; window includes both endpoints.
  for (let i = 0; i + thresholds.allyExchangeDays - 1 < days.length; i++) {
    const last = days[i + thresholds.allyExchangeDays - 1] as number;
    if (last - (days[i] as number) <= thresholds.allyWindowDays) return 'ally';
  }

  if (days.length >= thresholds.mutualExchangeDays) return 'mutual';

  if (
    firstReplyAt !== null &&
    past.some((e) => INBOUND_TYPES.includes(e.type) && e.at.getTime() >= firstReplyAt)
  ) {
    return 'responded';
  }

  if (firstReplyAt !== null) return 'engaged';

  if (past.some((e) => NOTICED_TYPES.includes(e.type))) return 'noticed';

  return 'stranger';
}
