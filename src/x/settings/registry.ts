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
import { CANNON } from '../../shared/cannon.ts';
import { SWEEP } from '../../shared/radarSweep.ts';
import { SEARCH_LANGS } from '../../shared/searchQuery.ts';

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

// Identity — who the account IS. First group in the render order because every
// other knob tunes a decision, while this one names the subject those decisions
// are about. Exactly one knob today; it exists because the server genuinely has
// no other way to learn the handle (SELF_X_USER_ID is a numeric id and
// account_snapshots stores no username).
const IDENTITY: SettingDef[] = [
  {
    key: 'x.identity.selfHandle',
    group: 'identity',
    label: 'My X handle',
    description:
      'Your X handle without the @. The server has no other way to know it (`SELF_X_USER_ID` is a numeric id). Unset means every own-activity read answers empty rather than guessing.',
    type: 'string',
    default: '',
    scope: 'mirrored',
  },
];

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
    // Mirrored since UI.12: the Today Targets roster tints a row "neglected" on
    // the panel side, and the follow-up queue surfaces the same person from the
    // server side. Two owners of "how cold is cold" would let the roster look
    // calm while the queue is nagging, so the panel reads this very key rather
    // than minting an x.display.targetsNeglectDays twin.
    key: 'x.followups.neglectedTargetDays',
    group: 'followups',
    label: 'Neglected target after',
    description:
      'Days without a reply from you before a roster target surfaces as neglected — the follow-up queue, the Today targets tint, and the weekly digest list all read this one number.',
    type: 'number',
    default: 7,
    min: 1,
    max: 60,
    unit: 'days',
    scope: 'mirrored',
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
    // Re-homed 2026-08-12 from `x.workers.winnerRereadMinViews`, whose worker no
    // longer exists. Same number, same default (env WINNER_REREAD_MIN_VIEWS), but
    // it now bounds nothing but a SELECT: $0 SQL asking which measured post is
    // worth quoting again. An override row under the old key is orphaned, not
    // read — re-set it here if the floor was ever tuned in prod.
    key: 'x.followups.reupMinViews',
    group: 'followups',
    label: 'Re-up view floor',
    description:
      'Views a post’s snapshot must have measured for it to surface as a quote-tweet re-up candidate. Reads existing snapshots only — $0, nothing here buys a read. Defaults from WINNER_REREAD_MIN_VIEWS when that env var is set.',
    type: 'number',
    default: envNumberDefault('WINNER_REREAD_MIN_VIEWS', 500, 100, 100_000),
    min: 100,
    max: 100_000,
    unit: 'views',
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
// nothing: rows already flipped to `expired` stay expired. RC.3 adds the second
// knob: how much of a scored queue is worth drafting.
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
  {
    // `mirrored` because the panel needs the number twice before any call: to
    // label the button ("Curate & draft (25)") and to decide the button is worth
    // showing at all. The ceiling matches `x.ai.batchReplyCap`'s — the effective
    // size is the LOWER of the two (the drafting call refuses a bigger batch, so
    // a curated set above the cap would only move the refusal one click later),
    // which is why raising this alone does nothing once it passes the cap.
    key: 'x.radar.curatedCount',
    group: 'radar',
    label: 'Curated batch size',
    description:
      'How many tweets survive a Curate & draft pass and get drafted; the scored-out rest are dismissed from the queue. Effective size is the lower of this and the batch reply cap. An opening guess — recalibrate from measured reply outcomes, never by feel.',
    type: 'number',
    default: 25,
    min: 5,
    max: 50,
    scope: 'mirrored',
  },
];

// Sweep (RS.1) — what an armed sweep is allowed to put into the Radar queue.
// The Radar is manual by default; these eleven numbers are the ONLY admission
// rule while a sweep runs, which is why every one of them is `mirrored`: the
// content script decides capture with `passesSweep`; the server reads them too,
// through `sweepConfigFromSettings`, so the Playbook's timeline funnel can
// bucket against the same rule the page captured with. The defaults ARE `SWEEP` (never retyped),
// and a group-shape test asserts the group is exactly `keyof SweepConfig`, so a
// knob cannot be half-exposed. Provenance for each number is in the header of
// src/shared/radarSweep.ts. These are now the ONLY knobs that decide what a
// tweet qualifies for — the twelve `x.band.*` thresholds that used to compete
// with them are deleted, not hidden.
const SWEEP_RECAL = 'An opening guess — recalibrate at n >= 100 swept rows, never by feel.';
const NO_CEILING = '0 means no ceiling.';

const SWEEP_KNOBS: SettingDef[] = [
  {
    key: 'x.sweep.minViews',
    group: 'sweep',
    label: 'Min impressions',
    description: `Impressions a tweet needs before a sweep admits it. Ships at the number the reply band's "worth a reply" floor uses, restated rather than shared — moving this does not move the on-page border. ${SWEEP_RECAL}`,
    type: 'number',
    default: SWEEP.minViews,
    min: 0,
    max: 1_000_000,
    unit: 'views',
    scope: 'mirrored',
  },
  {
    key: 'x.sweep.maxViews',
    group: 'sweep',
    label: 'Max impressions',
    description: `Impressions past which a tweet is too big to be worth replying to — your reply lands under a crowd. Ships as a real ceiling, an order of magnitude above the floor; ${NO_CEILING} ${SWEEP_RECAL}`,
    type: 'number',
    default: SWEEP.maxViews,
    min: 0,
    max: 1_000_000,
    unit: 'views',
    scope: 'mirrored',
  },
  {
    key: 'x.sweep.minLikes',
    group: 'sweep',
    label: 'Min likes',
    description: `Likes a tweet needs before a sweep admits it. A floor of 0 is no floor. ${SWEEP_RECAL}`,
    type: 'number',
    default: SWEEP.minLikes,
    min: 0,
    max: 1_000_000,
    unit: 'likes',
    scope: 'mirrored',
  },
  {
    key: 'x.sweep.maxLikes',
    group: 'sweep',
    label: 'Max likes',
    description: `Likes past which a tweet is too far along to bother replying to. Ships as a real ceiling, matching the impressions one at the ~1% like rate a small post runs at; ${NO_CEILING} ${SWEEP_RECAL}`,
    type: 'number',
    default: SWEEP.maxLikes,
    min: 0,
    max: 1_000_000,
    unit: 'likes',
    scope: 'mirrored',
  },
  {
    key: 'x.sweep.minReplies',
    group: 'sweep',
    label: 'Min replies',
    description: `Replies a tweet needs before a sweep admits it — a floor on "is anyone actually there". A floor of 0 is no floor. ${SWEEP_RECAL}`,
    type: 'number',
    default: SWEEP.minReplies,
    min: 0,
    max: 1_000_000,
    unit: 'replies',
    scope: 'mirrored',
  },
  {
    key: 'x.sweep.maxReplies',
    group: 'sweep',
    label: 'Max replies',
    description: `Replies past which you are buried in the thread. Ships at the reply band's "still near the top" number, restated rather than shared. ${NO_CEILING} ${SWEEP_RECAL}`,
    type: 'number',
    default: SWEEP.maxReplies,
    min: 0,
    max: 1_000_000,
    unit: 'replies',
    scope: 'mirrored',
  },
  {
    key: 'x.sweep.maxAgeMin',
    group: 'sweep',
    label: 'Max tweet age',
    description: `Minutes old past which nothing is swept in. The ONE age rule: it applies to every arm, including the camped and circle bypasses, and it is also the flood control on those two. Always enforced — unlike the other maximums, 0 here is not a "no ceiling" sentinel and the floor is 1. ${SWEEP_RECAL}`,
    type: 'number',
    default: SWEEP.maxAgeMin,
    min: 1,
    max: 1440,
    unit: 'min',
    scope: 'mirrored',
  },
  {
    key: 'x.sweep.media',
    group: 'sweep',
    label: 'Photos & videos',
    description: `Whether a tweet's own photos/videos decide it in or out. \`any\` is the gate off — what ships, because neither direction is measured yet. \`with\` sweeps in only tweets carrying media (the post already earned the look; your reply rides it); \`without\` sweeps in only plain-text posts (nothing competes with the reply for attention). A link preview's thumbnail is not media — the tweet is a link — but a quoted tweet's photo is, because the cell in front of you does show one. Like the ads switch and unlike the metric filters, this is enforced on every arm, camped and circle bypasses included. ${SWEEP_RECAL}`,
    type: 'enum',
    default: SWEEP.media,
    options: ['any', 'with', 'without'],
    scope: 'mirrored',
  },
  {
    key: 'x.sweep.excludeAds',
    group: 'sweep',
    label: 'Skip promoted posts',
    description: `Drop promoted/sponsored posts instead of queueing them. Ships ON, and unlike the numbers around it that is not a guess: a reply under somebody's ad spend reaches the advertiser's audience on the advertiser's terms. Most ads never got this far anyway — they render no metrics label, so nothing could read them — this closes the ones that do. Enforced on every arm, bypasses included: an ad is an ad whoever is camped on it. ${SWEEP_RECAL}`,
    type: 'boolean',
    default: SWEEP.excludeAds,
    scope: 'mirrored',
  },
  {
    key: 'x.sweep.verifiedOnly',
    group: 'sweep',
    label: 'Verified authors only',
    description: `Sweep in only tweets whose author carries the verified badge. Ships ON, on the monetization pivot's own argument: only Premium viewers' impressions count, so a reply under an unverified author is unpaid work. An unreadable author counts as NOT verified, so a drift in the badge selector shows up as an empty queue — turn this off first when that happens. ${SWEEP_RECAL}`,
    type: 'boolean',
    default: SWEEP.verifiedOnly,
    scope: 'mirrored',
  },
  {
    key: 'x.sweep.campedBypass',
    group: 'sweep',
    label: 'Camped accounts bypass',
    description: `Let posts from camped Cannon accounts in without meeting the metric filters (they still obey the max age). A camped account's three-minute-old post has no numbers yet, and camping adjacent Premium niches is the strategy's own prescription. ${SWEEP_RECAL}`,
    type: 'boolean',
    default: SWEEP.campedBypass,
    scope: 'mirrored',
  },
  {
    key: 'x.sweep.circleBypass',
    group: 'sweep',
    label: 'Circle accounts bypass',
    description: `Let posts from your CRM circle in without meeting the metric filters (they still obey the max age). Ships OFF — the ambient circle arm survives as a switch, not as a default. ${SWEEP_RECAL}`,
    type: 'boolean',
    default: SWEEP.circleBypass,
    scope: 'mirrored',
  },
  {
    key: 'x.sweep.autoStopMin',
    group: 'sweep',
    label: 'Sweep auto-stop',
    description: `How long one armed sweep runs before it stops on its own. Not an admission filter: it bounds the session. Expiry is evaluated when the page reads the state, so a tab that slept past the deadline captures nothing on wake. ${SWEEP_RECAL}`,
    type: 'number',
    default: SWEEP.autoStopMin,
    min: 1,
    max: 240,
    unit: 'min',
    scope: 'mirrored',
  },
];

// Cannon — the arbitrage reading of the radar buffer. Every knob is `mirrored`
// for the UI.7 reason: the page's Cannon view and the server's cannon routes
// decide eligibility with the same `src/shared/cannon.ts`, so a server-only knob
// would fork the two. The defaults ARE `CANNON` (never retyped here) — the
// registry is not a second calibration — and `scoreMin` in particular is a
// MEASURED number, not the 5,000 the source plan carried: see the corpus replay
// in the module header before touching it.
const CANNON_RECAL = 'Recalibrate from a corpus replay (see src/shared/cannon.ts), never by feel.';

const CANNON_KNOBS: SettingDef[] = [
  {
    key: 'x.cannon.scoreMin',
    group: 'cannon',
    label: 'Cannon score floor',
    description: `Views per reply a post needs to be worth a reply slot. Shipped at the measured p90 of our own harvest corpus (the borrowed 5,000 cleared only 0.60% of rows and would have kept the view empty). ${CANNON_RECAL}`,
    type: 'number',
    default: CANNON.scoreMin,
    min: 10,
    max: 100_000,
    unit: 'v/reply',
    scope: 'mirrored',
  },
  {
    key: 'x.cannon.maxAgeMin',
    group: 'cannon',
    label: 'Cannon age cutoff',
    description: `Minutes past which a post leaves the Cannon view entirely — a stale entry costs a reply slot for a handful of views. An opening guess. ${CANNON_RECAL}`,
    type: 'number',
    default: CANNON.maxAgeMin,
    min: 5,
    max: 180,
    unit: 'min',
    scope: 'mirrored',
  },
  {
    key: 'x.cannon.redAgeMin',
    group: 'cannon',
    label: 'Cannon age warning',
    description: `Minutes past which a still-eligible post renders its age red. Keep it below the age cutoff. An opening guess. ${CANNON_RECAL}`,
    type: 'number',
    default: CANNON.redAgeMin,
    min: 1,
    max: 180,
    unit: 'min',
    scope: 'mirrored',
  },
  {
    key: 'x.cannon.placedTarget',
    group: 'cannon',
    label: 'Cannon placed/day target',
    description: `The Cannon head's own stretch number for replies placed today — DISPLAY ONLY. The daily replies quest resolves its real target from the niche doctrine, not from this. An opening guess. ${CANNON_RECAL}`,
    type: 'number',
    default: CANNON.placedTarget,
    min: 1,
    max: 100,
    scope: 'mirrored',
  },
];

// Outliers (OU.3) — the DEFAULT shape of an outlier hunt, not a rule anything
// enforces. Every knob here is a starting value handed to a fresh Outliers form
// through `GET /x/searches/defaults`; the user overrides any of them per hunt,
// and a saved search keeps its own copy. That is why all six are `scope:'server'`
// and none is mirrored (§7.24 stays clean): the panel receives them already
// resolved, inside a payload it asks for once, and there is no client-side
// decision to make off them. The floors are flat hand-tuned numbers on purpose —
// decision 10 records the measured version (P90 of the timeline corpus, or the
// author's median × 3) and deliberately does not build it, because an honest
// computed threshold needs a provenance line in the UI and a recalibration
// clause, not a magic number wearing a lab coat.
const OUTLIERS: SettingDef[] = [
  {
    key: 'x.outliers.minFaves',
    group: 'outliers',
    label: 'Default min likes',
    description:
      'Likes floor a fresh hunt opens with — the one number that decides whether you are reading outliers or reading the firehose. Start at 300–500 and raise it until the results thin out; the up/down stepper on the field walks a ladder for exactly that. 0 omits the operator entirely.',
    type: 'number',
    default: 400,
    min: 0,
    max: 100_000,
    unit: 'likes',
    scope: 'server',
  },
  {
    key: 'x.outliers.minRetweets',
    group: 'outliers',
    label: 'Default min reposts',
    description:
      'Reposts floor a fresh hunt opens with. Ships OFF (0 = no operator) because likes and reposts measure the same thing on most posts, and stacking two floors thins results far faster than it sharpens them — raise this only when you are hunting specifically for things people forwarded.',
    type: 'number',
    default: 0,
    min: 0,
    max: 100_000,
    unit: 'reposts',
    scope: 'server',
  },
  {
    key: 'x.outliers.minReplies',
    group: 'outliers',
    label: 'Default min replies',
    description:
      'Replies floor a fresh hunt opens with. Ships OFF (0 = no operator). This is the floor to raise when the hunt is for a reply target rather than for swipe-file copy: replies mean an argument is already happening, which is where one sharp reply gets read.',
    type: 'number',
    default: 0,
    min: 0,
    max: 100_000,
    unit: 'replies',
    scope: 'server',
  },
  {
    key: 'x.outliers.sinceDays',
    group: 'outliers',
    label: 'Default window',
    description:
      'How far back a fresh hunt looks, in days from today. 30 is the compromise the swipe file wants: wide enough that a floor of a few hundred likes still returns a page, narrow enough that what comes back is still about the conversation you are in.',
    type: 'number',
    default: 30,
    min: 1,
    max: 365,
    unit: 'days',
    scope: 'server',
  },
  {
    key: 'x.outliers.lang',
    group: 'outliers',
    label: 'Default language',
    description: `Language code a fresh hunt opens with; empty means no \`lang:\` operator at all, which is what ships. Anything outside the compiler's allowlist (${SEARCH_LANGS.join(', ')}) is dropped with a warning rather than compiled — an unknown code returns zero results on X, which reads exactly like "no matches".`,
    type: 'string',
    default: '',
    scope: 'server',
  },
  {
    key: 'x.outliers.sort',
    group: 'outliers',
    label: 'Default results tab',
    description:
      'Which x.com results tab the Open in X button lands on. Ships `top` because an outlier hunt wants best-performing, not newest — `live` is the one to pick when you are hunting a conversation as it happens rather than a post that already won.',
    type: 'enum',
    default: 'top',
    options: ['live', 'top'],
    scope: 'server',
  },
];

// Workers — the publisher is the only one left, so this group is one cadence
// knob. `appliesOn:'restart'`: startXWorkers reads it ONCE to arm the timer
// (decision 10 — no hot-reloading timers). The daily-pass hour, the winner
// re-read floor/cap and the discovery reply-exclusion knob were deleted
// 2026-08-12 with the pass they configured; nothing here bounds spend anymore
// because nothing here spends (CLAUDE.md invariant #8).
const WORKERS: SettingDef[] = [
  {
    key: 'x.workers.publisherIntervalSec',
    group: 'workers',
    label: 'Publisher interval',
    description:
      'Seconds between publisher ticks. A due post waits at most this long; every tick is $0 until a row is actually due.',
    type: 'number',
    default: 60,
    min: 30,
    // Capped at 300s so /healthz keeps its 5-minute floor as a meaningful liveness
    // check (startXWorkers scales the staleness window off this value, so a longer
    // interval would only make a dead publisher take longer to notice).
    max: 300,
    unit: 's',
    scope: 'server',
    appliesOn: 'restart',
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
    // Mirrored since UI.12 so the Radar can clamp its own draft cap to it. The
    // server refuses an oversized batch rather than truncating it, so without
    // the number on the client the only way to discover the ceiling is a failed
    // click; the panel is not the enforcer, it just stops asking for what it
    // knows will be refused.
    key: 'x.ai.batchReplyCap',
    group: 'ai',
    label: 'Batch reply cap',
    description:
      'Most tweets one batch-drafting call may cover (a bigger batch is refused, not truncated). Cost scales with the batch: one call, ~420 output tokens per tweet.',
    type: 'number',
    default: 25,
    min: 5,
    max: 50,
    scope: 'mirrored',
  },
];

// Display — soft presentation limits applied to already-collected data; they
// never change what is measured or billed, only how much of it is shown. The
// first two are read by the brief route; the four UI.12 added are read by the
// side panel off the mirrored blob, which is why they are `mirrored` and the
// other two are not. `radarDraftCap` is the one with teeth: it sizes a batch
// the server then charges for, so the panel clamps it to `x.ai.batchReplyCap`
// (also mirrored) instead of letting a raised cap turn into a refused click.
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
  {
    key: 'x.display.doNextCap',
    group: 'display',
    label: 'Do-next rows',
    description:
      'How many follow-ups the Today "Do next" strip shows at once. It is a queue, not a dashboard — everything past this still counts, it just reads as "+N more".',
    type: 'number',
    default: 5,
    min: 1,
    max: 15,
    scope: 'mirrored',
  },
  {
    key: 'x.display.doNextSnoozeH',
    group: 'display',
    label: 'Do-next snooze',
    description:
      'How far the "zz" button pushes a follow-up out of the queue. Snoozes are stored server-side when you press it, so a change here only sizes new ones.',
    type: 'number',
    default: 24,
    min: 1,
    max: 168,
    unit: 'h',
    scope: 'mirrored',
  },
  {
    key: 'x.display.fansAmberTopN',
    group: 'display',
    label: 'Fan amber rank',
    description:
      'How far down the Top-fans list an unacknowledged fan still ambers. Past this rank the reciprocity nudge goes quiet — the ranking itself is unchanged.',
    type: 'number',
    default: 10,
    min: 1,
    max: 50,
    scope: 'mirrored',
  },
  {
    key: 'x.display.radarDraftCap',
    group: 'display',
    label: 'Radar draft cap',
    description:
      'How many radar tweets one "Draft replies" click sends in a single batch. The panel clamps this to the AI batch reply cap, which is the number the server actually enforces.',
    type: 'number',
    default: 20,
    min: 1,
    max: 50,
    scope: 'mirrored',
  },
  {
    key: 'x.display.dossierListLen',
    group: 'display',
    label: 'Dossier list rows',
    description:
      'How many rows each capped dossier list shows — my replies to them, their mentions of me, their saved tweets. The full history is always in the timeline below; this only sizes the summaries.',
    type: 'number',
    default: 5,
    min: 3,
    max: 25,
    scope: 'mirrored',
  },
  {
    key: 'x.display.channelPostsShown',
    group: 'display',
    label: 'Channel post rows',
    description:
      'How many of my own posts a channel room lists under its mapped pillar. The median line above it is computed over every measured post, not just these.',
    type: 'number',
    default: 8,
    min: 3,
    max: 30,
    scope: 'mirrored',
  },
  {
    key: 'x.display.voiceListLimit',
    group: 'display',
    label: 'Voice list size',
    description:
      'How many saved tweets one Voice query fetches. Reads are $0 local SQL, so raising this costs nothing but scroll — the swipe file is DOM-scraped, never read from the X API.',
    type: 'number',
    default: 100,
    min: 20,
    max: 500,
    scope: 'mirrored',
  },
  {
    key: 'x.display.repliesListLimit',
    group: 'display',
    label: 'Reply history size',
    description:
      'How many reply drafts the Replies tab loads into its History list. Local rows, so this is a scroll budget, not a spend one — the day groups collapse anything you are not looking at.',
    type: 'number',
    default: 100,
    min: 20,
    max: 500,
    scope: 'mirrored',
  },
];

export const SETTINGS_REGISTRY: SettingDef[] = [
  ...IDENTITY,
  ...DOCTRINE,
  ...QUESTS,
  ...PEOPLE,
  ...FOLLOWUPS,
  ...PINNED,
  ...DIGEST,
  ...GATES,
  ...RADAR,
  ...SWEEP_KNOBS,
  ...CANNON_KNOBS,
  ...OUTLIERS,
  ...WORKERS,
  ...BUDGETS,
  ...AI,
  ...DISPLAY,
];

/** Human labels for each group id, in the order they should render. */
export const GROUP_LABELS: Record<string, string> = {
  identity: 'Identity',
  doctrine: 'Doctrine',
  quests: 'Quests',
  people: 'People',
  followups: 'Follow-ups',
  pinned: 'Pinned watch',
  digest: 'Digest',
  gates: 'Stat gates',
  radar: 'Radar',
  sweep: 'Sweep',
  cannon: 'Cannon',
  outliers: 'Outliers',
  workers: 'Workers',
  budgets: 'Budgets',
  ai: 'AI calls',
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
