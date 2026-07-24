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

/** A registry default sourced from an env var (UI.4): precedence is
 *  override row > env > baked default. An env value that isn't a finite number
 *  inside the knob's own range is ignored — a typo in the unit file must never
 *  hand the store a default its own validator would reject. */
function envNumberDefault(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < min || n > max) {
    console.warn(`settings: ignoring out-of-range ${name}=${raw} (using ${fallback})`);
    return fallback;
  }
  return n;
}

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

// People (CIRCLES-PLAN C1) — the stage-machine thresholds computeStage() reads.
// Opening guesses (2 exchange days → mutual, 4/60d → ally), revisited after ~30
// days of real events. They only affect FUTURE recomputes: the ratchet never
// auto-demotes, so lowering a threshold can't strip a rank someone already earned.
// NB the 2–10x target-band multipliers are NOT here — they're owned by the active
// niche (niches.doctrine, N.5) and read via loadDoctrine(), same call as the reply
// band; a settings key would be a second silent owner (D2/D30c, the UI.2 drop).
const PEOPLE: SettingDef[] = [
  {
    key: 'x.people.mutualExchangeDays',
    group: 'people',
    label: 'Mutual after',
    description:
      'Distinct two-way exchange days (an inbound and an outbound on the same day) before a relationship reaches "mutual". Only affects future recomputes — stages never auto-demote.',
    type: 'number',
    default: 2,
    min: 1,
    max: 10,
    unit: 'days',
    scope: 'server',
  },
  {
    key: 'x.people.allyExchangeDays',
    group: 'people',
    label: 'Ally after',
    description:
      'Two-way exchange days inside the ally window before a relationship reaches "ally". Only affects future recomputes.',
    type: 'number',
    default: 4,
    min: 2,
    max: 20,
    unit: 'days',
    scope: 'server',
  },
  {
    key: 'x.people.allyWindowDays',
    group: 'people',
    label: 'Ally window',
    description:
      'The rolling window the ally exchange-day count must fall inside. Only affects future recomputes.',
    type: 'number',
    default: 60,
    min: 14,
    max: 180,
    unit: 'days',
    scope: 'server',
  },
];

// Follow-ups (CIRCLES-PLAN C5) — the queue windows classifyFollowups() and the
// re-up / momentum / fan helpers read. Opening guesses; the follow-up route reads
// them per request via getSetting and passes them down (the pure modules take
// params defaulted to today's constants). The weekly digest's neglected windows
// read the same neglectedTargetDays/neglectedAllyDays keys — one owner, two
// consumers — so a change moves both surfaces at once.
const FOLLOWUPS: SettingDef[] = [
  {
    key: 'x.followups.chainLiveMaxAgeH',
    group: 'followups',
    label: 'Chain-live max age',
    description:
      'How recent an inbound reply-to-your-reply must be to count as a live chain (top of the queue).',
    type: 'number',
    default: 24,
    min: 1,
    max: 72,
    unit: 'h',
    scope: 'server',
  },
  {
    key: 'x.followups.dmReadyWindowDays',
    group: 'followups',
    label: 'DM-ready window',
    description:
      'How recently a person must have advanced to responded/mutual to still surface as a good DM moment.',
    type: 'number',
    default: 7,
    min: 1,
    max: 30,
    unit: 'days',
    scope: 'server',
  },
  {
    key: 'x.followups.neglectedTargetDays',
    group: 'followups',
    label: 'Neglected target after',
    description:
      'Days without a reply from you before a roster target surfaces as neglected (also drives the weekly digest neglected-targets list).',
    type: 'number',
    default: 7,
    min: 1,
    max: 60,
    unit: 'days',
    scope: 'server',
  },
  {
    key: 'x.followups.neglectedAllyDays',
    group: 'followups',
    label: 'Neglected ally after',
    description:
      'Days without any exchange (either way) before a mutual/ally surfaces as neglected (also drives the weekly digest neglected-allies list).',
    type: 'number',
    default: 14,
    min: 1,
    max: 90,
    unit: 'days',
    scope: 'server',
  },
  {
    key: 'x.followups.momentumWeeklyPct',
    group: 'followups',
    label: 'Momentum threshold',
    description:
      'Weekly follower-growth rate (%/week of the segment base) an account must clear — and beat its prior rate — to flag as heating up.',
    type: 'number',
    default: 5,
    min: 1,
    max: 50,
    unit: '%',
    scope: 'server',
  },
  {
    key: 'x.followups.reupMinAgeDays',
    group: 'followups',
    label: 'Re-up min age',
    description: 'Youngest an own post may be to surface as a quote-tweet re-up candidate.',
    type: 'number',
    default: 14,
    min: 3,
    max: 180,
    unit: 'days',
    scope: 'server',
  },
  {
    key: 'x.followups.reupMaxAgeDays',
    group: 'followups',
    label: 'Re-up max age',
    description: 'Oldest an own post may be to surface as a quote-tweet re-up candidate.',
    type: 'number',
    default: 60,
    min: 3,
    max: 180,
    unit: 'days',
    scope: 'server',
  },
  {
    key: 'x.followups.fanUnacknowledgedDays',
    group: 'followups',
    label: 'Fan unacknowledged after',
    description:
      'Days since your last reply to a top fan before the panel ambers them as unacknowledged.',
    type: 'number',
    default: 7,
    min: 1,
    max: 30,
    unit: 'days',
    scope: 'server',
  },
];

// Pinned watch (S0.9) — the two nudges buildPinnedWatch() applies to the pinned
// tweet (profile visits land there). The 30d candidate horizon stays a constant.
const PINNED: SettingDef[] = [
  {
    key: 'x.pinned.staleDays',
    group: 'pinned',
    label: 'Pin stale after',
    description: 'Days the pinned tweet can go unchanged before the brief warns it is stale.',
    type: 'number',
    default: 21,
    min: 7,
    max: 90,
    unit: 'days',
    scope: 'server',
  },
  {
    key: 'x.pinned.outperformRatio',
    group: 'pinned',
    label: 'Pin outperform ratio',
    description:
      'How many times the pinned tweet’s measured views a recent post must beat before the brief flags it as a better pin.',
    type: 'number',
    default: 3,
    min: 1.5,
    max: 10,
    step: 0.5,
    unit: '×',
    scope: 'server',
  },
];

// Digest (Sunday review) — presentation cap on the weekly neglected lists. The
// windows those lists use come from the follow-ups group (single owner).
const DIGEST: SettingDef[] = [
  {
    key: 'x.digest.neglectedCap',
    group: 'digest',
    label: 'Neglected list cap',
    description: 'Most entries the weekly digest lists per neglected group (targets, allies).',
    type: 'number',
    default: 5,
    min: 1,
    max: 20,
    scope: 'server',
  },
];

// Reply band (UI.7) — the classifier behind the on-page badge AND the
// /x/replies/generate gate. Every knob is `mirrored`: the badge and the gate
// must never disagree about what "hot" means, which is the whole reason
// src/shared/replyBand.ts is one module shared by server and page (§7.27).
// §7.19 still stands — these are calibration numbers, not a gate you can wish
// away, so every description carries the >=100-measured warning. Ordering
// (baitViews < bigViews, earlyReplies < midReplies, baitVPM < risingVPM) is
// meaning, not validation: the registry validates per key, so an inverted pair
// classifies oddly rather than erroring.
const RECAL = 'Recalibrate only with >=100 measured replies — see the Playbook band table.';

const BAND_KNOBS: SettingDef[] = [
  {
    key: 'x.band.bigViews',
    group: 'band',
    label: 'View floor',
    description: `Views a post needs before it is worth a reply at all. ${RECAL}`,
    type: 'number',
    default: 300,
    min: 50,
    max: 5000,
    unit: 'views',
    scope: 'mirrored',
  },
  {
    key: 'x.band.baitViews',
    group: 'band',
    label: 'View floor (reply-bait)',
    description: `The lower view floor a question/poll/take-bait post gets — bait pulls the threads where an early sharp reply is seen. Keep it below the main view floor. ${RECAL}`,
    type: 'number',
    default: 180,
    min: 20,
    max: 5000,
    unit: 'views',
    scope: 'mirrored',
  },
  {
    key: 'x.band.earlyReplies',
    group: 'band',
    label: 'Early-reply ceiling',
    description: `Replies already on the post below which you are still near the top of the thread (the hot/warm split). ${RECAL}`,
    type: 'number',
    default: 40,
    min: 1,
    max: 500,
    scope: 'mirrored',
  },
  {
    key: 'x.band.midReplies',
    group: 'band',
    label: 'Buried-at',
    description: `Replies past which the thread is too deep to be seen — the post bands as "buried" whatever its size. ${RECAL}`,
    type: 'number',
    default: 120,
    min: 5,
    max: 1000,
    scope: 'mirrored',
  },
  {
    key: 'x.band.freshMin',
    group: 'band',
    label: 'Freshness window',
    description: `Minutes a post counts as fresh, which is the only window where velocity alone can clear the view floor. ${RECAL}`,
    type: 'number',
    default: 15,
    min: 1,
    max: 240,
    unit: 'min',
    scope: 'mirrored',
  },
  {
    key: 'x.band.risingVPM',
    group: 'band',
    label: 'Rising velocity',
    description: `Views per minute that project a fresh post into the band before it has the views. ${RECAL}`,
    type: 'number',
    default: 20,
    min: 1,
    max: 500,
    unit: 'v/min',
    scope: 'mirrored',
  },
  {
    key: 'x.band.baitVPM',
    group: 'band',
    label: 'Rising velocity (reply-bait)',
    description: `The relaxed rising bar for reply-bait posts. Keep it below the plain rising velocity. ${RECAL}`,
    type: 'number',
    default: 12,
    min: 1,
    max: 500,
    unit: 'v/min',
    scope: 'mirrored',
  },
  {
    key: 'x.band.watchVPM',
    group: 'band',
    label: 'Watch velocity',
    description: `Views per minute that make a fresh post promising-but-unproven — it bands "watch" rather than "reply now". ${RECAL}`,
    type: 'number',
    default: 8,
    min: 1,
    max: 500,
    unit: 'v/min',
    scope: 'mirrored',
  },
  {
    key: 'x.band.watchReplyCeiling',
    group: 'band',
    label: 'Watch reply ceiling',
    description: `Replies past which promising velocity stops earning a "watch" — the thread already has a crowd. ${RECAL}`,
    type: 'number',
    default: 25,
    min: 1,
    max: 500,
    scope: 'mirrored',
  },
  {
    key: 'x.band.tooSmallAgeMin',
    group: 'band',
    label: 'Dead-zone age',
    description: `Minutes after which a small, slow, non-bait post is written off as "will not grow" (with the two knobs below — all three must hold). ${RECAL}`,
    type: 'number',
    default: 20,
    min: 1,
    max: 1440,
    unit: 'min',
    scope: 'mirrored',
  },
  {
    key: 'x.band.tooSmallViews',
    group: 'band',
    label: 'Dead-zone views',
    description: `Views under which an aged, slow, non-bait post is written off. Shipped equal to the view floor; raising the floor does NOT widen the dead zone unless you raise this too. ${RECAL}`,
    type: 'number',
    default: 300,
    min: 0,
    max: 5000,
    unit: 'views',
    scope: 'mirrored',
  },
  {
    key: 'x.band.tooSmallVpm',
    group: 'band',
    label: 'Dead-zone velocity',
    description: `Views per minute under which an aged, small, non-bait post is written off. ${RECAL}`,
    type: 'number',
    default: 15,
    min: 0,
    max: 500,
    unit: 'v/min',
    scope: 'mirrored',
  },
];

// Stat gates (§7.19) — the minimum-sample bars below which a measured cell is
// "no data", never advice. The knob exists so exploration is possible; the
// doctrine lives in the description copy, not in a lock.
const GATES: SettingDef[] = [
  {
    key: 'x.gates.minCellN',
    group: 'gates',
    label: 'Playbook cell gate',
    description:
      'Measured samples a Playbook cell needs before it reads as evidence rather than "insufficient data". Below 20 is exploration, not evidence — the `?minN=` query param still overrides per read.',
    type: 'number',
    default: 20,
    min: 5,
    max: 100,
    scope: 'server',
  },
  {
    key: 'x.gates.bestTimeMinN',
    group: 'gates',
    label: 'Best-time cell gate',
    description:
      'Measured posts a (weekday, hour) cell needs before it can be recommended as a slot — in the best-times list and in the Today cadence gaps.',
    type: 'number',
    default: 3,
    min: 1,
    max: 20,
    scope: 'mirrored',
  },
];

// Radar (CIRCLES-PLAN C0) — how long a batch-drafted reply stays useful. Expiry
// is a lazy status flip on read, never a delete, so raising this resurrects
// nothing: rows already flipped to `expired` stay expired.
const RADAR: SettingDef[] = [
  {
    key: 'x.radar.draftTtlH',
    group: 'radar',
    label: 'Draft time-to-live',
    description:
      'Hours a radar reply draft stays in the ready queue before it is flipped to expired (a reply to a post that has been dead this long is worthless anyway).',
    type: 'number',
    default: 48,
    min: 6,
    max: 168,
    unit: 'h',
    scope: 'server',
  },
];

// Workers — cadence and the bounded winner re-read. The two cadence knobs are
// `appliesOn:'restart'`: startXWorkers reads them ONCE to arm its timers
// (decision 10 — no hot-reloading timers). The winner knobs are read at the
// start of each daily pass instead, so they land on the next 03:00 run without
// a restart; both are money bounds (≤ cap × $0.001/day) checked before any
// billed call, and cap 0 disables re-reads entirely.
const WORKERS: SettingDef[] = [
  {
    key: 'x.workers.dailyMetricsHourUtc',
    group: 'workers',
    label: 'Daily pass hour',
    description:
      'UTC hour the once-daily discovery + snapshot pass fires. Snapshots must stay well inside the 30-day private-metrics window — this moves the time of day, never the cadence.',
    type: 'number',
    default: 3,
    min: 0,
    max: 23,
    unit: 'h UTC',
    scope: 'server',
    appliesOn: 'restart',
  },
  {
    key: 'x.workers.publisherIntervalSec',
    group: 'workers',
    label: 'Publisher interval',
    description:
      'Seconds between publisher ticks. A due post waits at most this long; every tick is $0 until a row is actually due.',
    type: 'number',
    default: 60,
    min: 30,
    max: 600,
    unit: 's',
    scope: 'server',
    appliesOn: 'restart',
  },
  {
    key: 'x.workers.winnerRereadMinViews',
    group: 'workers',
    label: 'Winner re-read floor',
    description:
      'Views a post’s first snapshot must have cleared to earn one extra day-7 read (the "which content compounds" series). Defaults from WINNER_REREAD_MIN_VIEWS when that env var is set.',
    type: 'number',
    default: envNumberDefault('WINNER_REREAD_MIN_VIEWS', 500, 100, 100_000),
    min: 100,
    max: 100_000,
    unit: 'views',
    scope: 'server',
  },
  {
    key: 'x.workers.winnerRereadCap',
    group: 'workers',
    label: 'Winner re-reads per day',
    description:
      'Most day-7 re-reads the daily pass may buy in one run, at $0.001 each. 0 disables re-reads entirely (the pass short-circuits before claiming anything).',
    type: 'number',
    default: 5,
    min: 0,
    max: 10,
    scope: 'server',
  },
];

// Budgets (§8) — the two spend ceilings, both read at REQUEST time inside the
// refuse-before-spend ladder so a PATCH binds the very next call with no
// restart. Env vars stay the default source (precedence: override row > env >
// baked), validated through envNumberDefault so a typo can't seed an invalid
// default. The CHECKS themselves are never settings (Decision 5): the X
// watchdog always logs, the image gate always refuses — only the amounts move.
const BUDGETS: SettingDef[] = [
  {
    key: 'x.budgets.xSoftDailyUsd',
    group: 'budgets',
    label: 'X soft daily budget',
    description:
      'Daily (UTC) X-API spend that trips the watchdog. SOFT: it logs loudly and flags /cost/today — it never blocks a call. Defaults from X_DAILY_BUDGET_USD when that env var is set.',
    type: 'number',
    default: envNumberDefault('X_DAILY_BUDGET_USD', 0.15, 0.01, 1),
    min: 0.01,
    max: 1,
    step: 0.01,
    unit: 'usd',
    scope: 'server',
  },
  {
    key: 'x.budgets.imageDailyUsd',
    group: 'budgets',
    label: 'Image hard daily budget',
    description:
      'Daily (UTC) image-generation spend, checked BEFORE the paid call — at or over it, /x/images/generate refuses with 429. Unlike the X watchdog this one blocks; 0 disables image generation entirely. Defaults from XAI_IMAGE_DAILY_BUDGET_USD.',
    type: 'number',
    default: envNumberDefault('XAI_IMAGE_DAILY_BUDGET_USD', 0.5, 0, 2),
    min: 0,
    max: 2,
    step: 0.05,
    unit: 'usd',
    scope: 'server',
  },
];

// AI call params — the per-surface HOUSE DEFAULTS askLLM merges last. Precedence
// is unchanged (request body > the global `ai` blob from Settings → AI > these),
// so these knobs tune exactly the tier the `ai` blob defers to when its own
// fields are null. They are request params, not prompt text: raising a token cap
// raises cost per draft ~linearly but leaves the cacheable prefix (§7.15) alone.
const AI: SettingDef[] = [
  {
    key: 'x.ai.replyMaxOutputTokens',
    group: 'ai',
    label: 'Reply token cap',
    description:
      'Output-token ceiling for a single reply draft. A safety ceiling, not a length lever — length is enforced by the prompt. Three variants of JSON measure ~225 tokens, so the floor leaves headroom: too low truncates the third variant, which costs a paid call and returns a parse error.',
    type: 'number',
    default: 520,
    min: 300,
    max: 2000,
    unit: 'tokens',
    scope: 'server',
  },
  {
    key: 'x.ai.replyTemperature',
    group: 'ai',
    label: 'Reply temperature',
    description:
      'Sampling temperature for reply drafting (single and batch). A request-body value still wins, as does a temperature set in Settings → AI.',
    type: 'number',
    default: 0.7,
    min: 0,
    max: 1.5,
    step: 0.1,
    scope: 'server',
  },
  {
    key: 'x.ai.replyReasoningEffort',
    group: 'ai',
    label: 'Reply reasoning effort',
    description:
      'How much the model may think before drafting a reply. Higher costs more per call for little gain at this length — raise it only if drafts read as shallow.',
    type: 'enum',
    default: 'low',
    options: ['none', 'low', 'medium', 'high'],
    scope: 'server',
  },
  {
    key: 'x.ai.drafterMaxOutputTokens',
    group: 'ai',
    label: 'Post-draft token cap',
    description:
      'Output-token ceiling for an original post draft. The thread and rewrite surfaces keep their own (larger) baked ceilings — this is the single-post drafter.',
    type: 'number',
    default: 600,
    min: 200,
    max: 3000,
    unit: 'tokens',
    scope: 'server',
  },
  {
    key: 'x.ai.digestMaxOutputTokens',
    group: 'ai',
    label: 'Digest token cap',
    description:
      'Output-token ceiling for the weekly digest narration. The facts are free SQL — this bounds only the one narration call.',
    type: 'number',
    default: 700,
    min: 200,
    max: 3000,
    unit: 'tokens',
    scope: 'server',
  },
  {
    key: 'x.ai.batchReplyCap',
    group: 'ai',
    label: 'Batch reply cap',
    description:
      'Most tweets one batch-drafting call may cover (a bigger batch is refused, not truncated). Cost scales with the batch: one call, ~420 output tokens per tweet.',
    type: 'number',
    default: 25,
    min: 5,
    max: 50,
    scope: 'server',
  },
];

// Mentions (§7.5) — the inbox pull bounds. Owned reads bill $0.001 per result,
// so these are money knobs: the two refresh caps bound how often a human can
// buy a pull, and pullMax is the per-request page size (invariant #5 — it is
// max_results that caps cost, never a JS-side slice). Raising pullMax does not
// raise an incremental pull's bill (since_id already floors the walk); it does
// raise the first-ever cold pull, which is bounded by pullMax alone.
const MENTIONS: SettingDef[] = [
  {
    key: 'x.mentions.serverRefreshCap',
    group: 'mentions',
    label: 'Server refresh cap',
    description:
      'Most on-demand mention pulls the server will run per UTC day — the backstop behind the panel button, so a runaway client cannot spend. 0 refuses every manual refresh (the daily pass still runs).',
    type: 'number',
    default: 6,
    min: 0,
    max: 12,
    scope: 'server',
  },
  {
    key: 'x.mentions.panelRefreshCap',
    group: 'mentions',
    label: 'Panel refresh cap',
    description:
      'How many refreshes the inbox panel offers per rolling day before greying the button. Keep it at or below the server cap — the server one is the real limit.',
    type: 'number',
    default: 4,
    min: 0,
    max: 8,
    scope: 'mirrored',
  },
  {
    key: 'x.mentions.pullMax',
    group: 'mentions',
    label: 'Mentions per page',
    description:
      'Page size for a mention pull (X bills every result in the response body). An incremental pull still walks to X’s 800 hard cap from the since_id checkpoint; this only sizes each request, and bounds the first-ever pull.',
    type: 'number',
    default: 50,
    min: 10,
    max: 100,
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

export const SETTINGS_REGISTRY: SettingDef[] = [
  ...DOCTRINE,
  ...QUESTS,
  ...PEOPLE,
  ...FOLLOWUPS,
  ...PINNED,
  ...DIGEST,
  ...BAND_KNOBS,
  ...GATES,
  ...RADAR,
  ...WORKERS,
  ...BUDGETS,
  ...AI,
  ...MENTIONS,
  ...DISPLAY,
];

/** Human labels for each group id, in the order they should render. */
export const GROUP_LABELS: Record<string, string> = {
  doctrine: 'Doctrine',
  quests: 'Quests',
  people: 'People',
  followups: 'Follow-ups',
  pinned: 'Pinned watch',
  digest: 'Digest',
  band: 'Reply band',
  gates: 'Stat gates',
  radar: 'Radar',
  workers: 'Workers',
  budgets: 'Budgets',
  ai: 'AI calls',
  mentions: 'Mentions',
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
