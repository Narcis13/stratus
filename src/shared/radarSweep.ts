// The sweep — what a scroll is allowed to put into the Radar queue (RS.1).
//
// The model, in one line: **the Radar is manual by default**, and a sweep is a
// bounded session during which tweets may also enter by themselves, admitted by
// numbers the user states rather than by a classifier's opinion. `passesSweep`
// is the whole admission rule and it lives here, once — consumed by the content
// script's capture arm (through the re-export shim `extension/src/radarSweep.ts`,
// which Vite inlines into the content IIFE) and by the settings registry, whose
// `sweep` group's defaults ARE the `SWEEP` constant below. §7.26/7.27: one rule,
// one home, so the page and the catalog can never disagree about what a sweep
// admits.
//
// Dependency-free by contract — not one import, type or value — because the
// content IIFE has no module loader. It reads NO store: the config arrives as an
// ARGUMENT on both sides of the wire (`cannon.ts`'s rule), so the page passes
// the mirrored blob and the server passes the registry defaults.
//
// Every number below is an OPENING GUESS (§7.19). Provenance, key by key:
//
//   minViews    300  the number BAND.bigViews uses. **Restated, not imported**
//                    (§7.33) — the sweep must be tunable without moving the
//                    classifier that draws the on-page border, and the two sets
//                    share numbers today only by coincidence of origin.
//   maxViews   2000  a ceiling, not "no ceiling": a reply under a post already
//                    past a couple thousand impressions lands beneath a crowd,
//                    and the queue filling with those is what a `0` here bought.
//                    Sits an order of magnitude above minViews so the admitted
//                    band is wide enough to fill a session.
//   minLikes      0  no floor.
//   maxLikes     20  the like ceiling that matches the impressions one at the
//                    ~1% like-rate a small post runs at. Same argument as
//                    maxViews: it bounds "already crowded".
//   minReplies    0  no floor.
//   maxReplies   40  the number BAND.earlyReplies uses — "still near the top of
//                    the thread". Restated for the same reason as minViews.
//   maxAgeMin    60  opening guess. CANNON.maxAgeMin is 30 and is about a
//                    *slot*; this is about a *feed session*.
//   media     'any' ships neutral — the filter exists, off. A timeline is
//                    mixed and neither direction is the measured one yet: 'with'
//                    hunts the posts whose media already earned the attention,
//                    'without' hunts the plain-text posts where a reply is the
//                    only thing to look at. Ships 'any' because shipping either
//                    opinion would halve the intake on a guess (§7.19).
//   excludeAds  true ships ON, and it is the one default here that is not a
//                    guess: a promoted post is somebody's ad spend, replies
//                    under it reach the advertiser's audience on the
//                    advertiser's terms, and there is no reading of the four
//                    goals under which one belongs in the queue. Most ads never
//                    reached the gate anyway (no metrics label ⇒ no capture);
//                    this closes the ones that do.
//   verifiedOnly true ships ON, on the monetization pivot's own argument: only
//                    Premium viewers' impressions count toward the 500K, so a
//                    reply under an unverified author's post is unpaid work.
//                    It shipped OFF while the badge selector was unproven — a
//                    filter that empties the queue on a selector drift is the
//                    worse failure — and the browser pass since has held. The
//                    failure mode remains visible: an unreadable author counts
//                    as NOT verified, so drift shows up as an empty queue, and
//                    this is the first switch to flip when one appears.
//   campedBypass true  a camped cannon account's 3-minute-old post has no
//                    numbers yet, and camping adjacent Premium niches is the
//                    pivot's own prescription.
//   circleBypass false the CRM arm survives as a switch, off.
//   autoStopMin  30  a guess about attention span, not a measurement. The honest
//                    signal that it is wrong is pressing Start twice in a sitting.
//
// Recalibrate from measured outcomes at n >= 100 swept rows — the `band` column
// on `radar_drafts` carries the origin, so the question is one SQL query — never
// from a session's impression.

/** What the media gate is set to. `'any'` is not "no opinion about media" but
 *  "the gate is off" — the same shape as a `0` ceiling, spelled as an enum
 *  because the two directions are opposite intents rather than ends of a range. */
export type SweepMediaFilter = 'any' | 'with' | 'without';

/** What a sweep is allowed to admit. Every `max*` field uses **0 to mean "no
 *  ceiling"**, and that is the only sentinel in this module; a `min*` needs none
 *  (`>= 0` is vacuous). `maxAgeMin` is the one exception and is deliberately
 *  NOT a sentinel field: it is always enforced, on every arm including the two
 *  bypasses, and its registry floor is 1. */
export interface SweepConfig {
  /** Impressions a tweet needs to be swept in. */
  minViews: number;
  /** Impressions past which it is too big to be worth a reply. 0 = no ceiling. */
  maxViews: number;
  /** Likes a tweet needs. */
  minLikes: number;
  /** Likes past which it is too big. 0 = no ceiling. */
  maxLikes: number;
  /** Replies a tweet needs (a floor on "is anyone there"). */
  minReplies: number;
  /** Replies past which you are buried in the thread. 0 = no ceiling. */
  maxReplies: number;
  /** Minutes old past which nothing is swept — ALWAYS enforced, no sentinel. */
  maxAgeMin: number;
  /** Photos/videos: sweep everything ('any'), only tweets carrying media
   *  ('with'), or only tweets without it ('without'). A CONTENT gate — enforced
   *  on every arm, bypasses included, like `maxAgeMin`. */
  media: SweepMediaFilter;
  /** Drop promoted/sponsored posts. The other content gate, same always-on
   *  reach: an ad is an ad no matter who is camped on it. */
  excludeAds: boolean;
  /** Only sweep in tweets whose author carries the verified badge. */
  verifiedOnly: boolean;
  /** Camped cannon accounts skip the METRIC gates (never the age gate). */
  campedBypass: boolean;
  /** Circle/CRM accounts skip the METRIC gates (never the age gate). */
  circleBypass: boolean;
  /** How long one armed sweep lasts. Not an admission field. */
  autoStopMin: number;
}

export const SWEEP: SweepConfig = {
  minViews: 300,
  maxViews: 2000,
  minLikes: 0,
  maxLikes: 20,
  minReplies: 0,
  maxReplies: 40,
  maxAgeMin: 60,
  media: 'any',
  excludeAds: true,
  verifiedOnly: true,
  campedBypass: true,
  circleBypass: false,
  autoStopMin: 30,
};

/** One tweet as the page reads it. `verified: null` = unknown (the name block
 *  was unreadable), which is NOT the same as "not verified" — see `passesSweep`
 *  for which way this module resolves that. `hasMedia` carries the same
 *  three-way reading; `promoted` does not, because "no promoted marker anywhere
 *  in the article" is a complete answer rather than a missing anchor. */
export interface SweepCandidate {
  views: number;
  likes: number;
  replies: number;
  ageMin: number;
  verified: boolean | null;
  /** Photos or videos of its own. `null` = not read (the gate is off, or the
   *  caller has no way to know — a stored row from before the column existed). */
  hasMedia: boolean | null;
  /** A promoted/sponsored post. `false` when the caller didn't look. */
  promoted: boolean;
}

/** Does this tweet clear the filters?
 *
 *  Gate ORDER is a perf contract, not style (§7.4's refuse-before-spend applied
 *  to a DOM read): `applyBand` re-runs on every mutation burst, so the numeric
 *  comparisons — already in hand from the one aria parse — decide first, and the
 *  caller pays for reading the verified badge only when `sweepNeedsVerified` says
 *  the answer can still matter. Do not reorder to "read everything, then test". */
export function passesSweep(c: SweepCandidate, cfg: SweepConfig = SWEEP): boolean {
  if (c.views < cfg.minViews) return false;
  if (cfg.maxViews > 0 && c.views > cfg.maxViews) return false;
  if (c.likes < cfg.minLikes) return false;
  if (cfg.maxLikes > 0 && c.likes > cfg.maxLikes) return false;
  if (c.replies < cfg.minReplies) return false;
  if (cfg.maxReplies > 0 && c.replies > cfg.maxReplies) return false;
  // Always enforced — 0 is not a sentinel here, and the registry floor is 1.
  if (c.ageMin > cfg.maxAgeMin) return false;
  if (!passesContentGates(c, cfg)) return false;
  // Deliberately the OPPOSITE direction from §7.11: unknown fails. This is a
  // GATE, not a bucket — admitting on unknown would silently defeat the filter,
  // whereas failing on unknown surfaces a drifted badge selector as a visibly
  // empty queue.
  if (cfg.verifiedOnly && c.verified !== true) return false;
  return true;
}

/** The two gates about WHAT the tweet is rather than how it is doing: ads and
 *  media.
 *
 *  Split out and exported because they are **not metric gates**, and the
 *  camped/circle bypasses skip only the metric ones. A promoted post is an ad
 *  whoever is camped on it, and a media rule you set is a rule about your own
 *  reply, not about the author's numbers — so `applyCapture`'s bypass arms call
 *  this directly, exactly as they already enforce `maxAgeMin`. Keeping them in
 *  one named predicate is what stops the three arms from drifting apart.
 *
 *  Unknown `hasMedia` REFUSES under either direction, the `verified` rule again:
 *  a gate that admits on unknown has stopped being a gate. The asymmetry worth
 *  knowing is that the page's reader answers `false`, never `null`, when its
 *  selectors drift — so a drift empties the queue under `'with'` (visible) and
 *  quietly lets media through under `'without'` (silent). That is the same
 *  bargain `verifiedOnly` takes, and the same first move when a queue empties:
 *  put the gate back to `'any'`. */
export function passesContentGates(
  c: Pick<SweepCandidate, 'hasMedia' | 'promoted'>,
  cfg: SweepConfig,
): boolean {
  if (cfg.excludeAds && c.promoted) return false;
  if (cfg.media === 'with' && c.hasMedia !== true) return false;
  if (cfg.media === 'without' && c.hasMedia !== false) return false;
  return true;
}

/** Whether the caller must read the verified badge off the DOM at all. One line
 *  on purpose, and NOT inlined at the call site: the gate-order perf contract
 *  above is only reviewable if the skip has a name. */
export function sweepNeedsVerified(cfg: SweepConfig): boolean {
  return cfg.verifiedOnly;
}

/** Same contract for the media read: a scan that isn't filtering on media must
 *  not pay for the querySelectorAll, and `'any'` is the shipped default, so the
 *  ordinary scroll pays nothing. */
export function sweepNeedsMedia(cfg: SweepConfig): boolean {
  return cfg.media !== 'any';
}

/** And for the promoted marker. Cheap, but the same rule: with the gate off the
 *  answer cannot change anything, so it isn't read. */
export function sweepNeedsPromoted(cfg: SweepConfig): boolean {
  return cfg.excludeAds;
}

// -------------------------------------------------------- the band ratchet

/** WHY a row is in the Radar queue. Four values, and there is no longer any
 *  other kind of band: the reply-band classifier that produced 'hot'/'warm'
 *  verdicts is deleted, so every band here is a statement about how the row got
 *  captured, not a judgement about the tweet.
 *
 *  - `manual` — the user pinned this tweet via the ⊕ button (RU.8).
 *  - `sweep`  — an armed sweep's filters admitted it (RS.2): the min/max
 *    impressions/likes/replies, age, media/ads and verified-only rules above are
 *    the entire reason it is here. The ordinary way a row arrives.
 *  - `cannon` — a camped-roster capture (CQ.4), metric filters bypassed.
 *  - `roster` — a fresh post by someone already in my circle (GT.8), metric
 *    filters bypassed; the reciprocity lane is about who posted it.
 *
 *  Lives in this module rather than in the extension's radar core because the
 *  SERVER ratchets bands too since RA.1 — `radar_sightings` upserts one row per
 *  tweet, so a re-sighting resolves a band on both sides of the wire (§7.27:
 *  one rule, one home). `extension/src/shared/radar.ts` keeps `RadarBand` as an
 *  alias of this union, so no importer on the page side had to change. */
export type RadarBandName = 'manual' | 'roster' | 'cannon' | 'sweep';

/** How strongly a stored band resists being overwritten by a re-sighting. A
 *  human pin outranks everything; a sweep or cannon capture — filters the user
 *  wrote and armed, or a roster they camp on purpose — outranks a circle
 *  capture, which only says "someone I know posted this". Equal stickiness →
 *  the fresher incoming band wins.
 *
 *  The asymmetry matters in both directions: a `roster` row that a later sweep
 *  admits on its numbers takes the upgrade, while a swept row is never demoted
 *  to `roster` on the next scroll past it. */
export function bandStickiness(b: RadarBandName): number {
  if (b === 'manual') return 2;
  if (b === 'roster') return 0;
  return 1; // sweep / cannon
}

// ------------------------------------------------------------ the session

/** `chrome.storage.local` key holding the armed sweep. ABSENT = manual, which is
 *  the default state: a fresh install, a cleared profile and an expired session
 *  all land there, and it is the safe one. */
export const SWEEP_STATE_KEY = 'radar:sweep';

/** One armed sweep. ISO strings so a stored session is legible in the storage
 *  inspector; `expiresAt` is the only field anything decides on. */
export interface SweepSession {
  startedAt: string;
  expiresAt: string;
}

/** Arm a sweep now, expiring `autoStopMin` from now. */
export function startSweepSession(nowMs: number, cfg: SweepConfig = SWEEP): SweepSession {
  return {
    startedAt: new Date(nowMs).toISOString(),
    expiresAt: new Date(nowMs + cfg.autoStopMin * 60_000).toISOString(),
  };
}

/** The stored value resolved into "is a sweep running right now".
 *
 *  **Expiry is evaluated at READ time and no timer owns the truth** — a page that
 *  was asleep past the expiry cannot capture one tweet on wake. Lenient like
 *  `readServerConfig`: anything that isn't `{startedAt, expiresAt}` with a
 *  parseable expiry still in the future returns `null` (= manual). Never throws.
 *  Exactly `expiresAt` is already over. */
export function sweepActiveAt(raw: unknown, nowMs: number): SweepSession | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const { startedAt, expiresAt } = raw as { startedAt?: unknown; expiresAt?: unknown };
  if (typeof startedAt !== 'string' || typeof expiresAt !== 'string') return null;
  const expiresMs = Date.parse(expiresAt);
  if (!Number.isFinite(expiresMs) || expiresMs <= nowMs) return null;
  return { startedAt, expiresAt };
}

/** Whole minutes left on an armed sweep — the countdown's only arithmetic (RS.4).
 *
 *  Rounds **up**: a 30-minute sweep must read "30m left" the instant it is armed,
 *  not "29m", and the last partial minute is still a minute you can capture in.
 *  Takes a resolved `SweepSession` rather than the raw stored value because a
 *  LABEL must never be what decides whether a sweep is live — `sweepActiveAt`
 *  has already answered that, at read time, on every render. Floors at 0 so an
 *  expiry observed between that resolve and this call can't print a negative. */
export function sweepMinutesLeft(session: SweepSession, nowMs: number): number {
  const ms = Date.parse(session.expiresAt) - nowMs;
  if (!Number.isFinite(ms) || ms <= 0) return 0;
  return Math.ceil(ms / 60_000);
}

// ---------------------------------------------------------- the queue TTL

// How long a sighting stays queueable. Replacing "until the browser closes",
// and 24h because a tweet you first saw yesterday is not a reply opportunity
// today. (It used to be stated as "the same 24h ROSTER_MAX_AGE_MIN uses" — that
// constant is gone at RS.3: every capture arm now takes its age bound from the
// user's `x.sweep.maxAgeMin`, default 60. This TTL stays independent — how long
// a captured row is workable is not how fresh a tweet must be to be captured.) A tweet
// you first saw yesterday is not a reply opportunity today, and the server
// expires its own drafted copy at 48h anyway. This is the ONLY implicit way a
// row leaves the queue — everything else is a dismiss the human asked for.
//
// It lives HERE, not in the extension, since RQ.3: `GET /radar/sightings?queue=true`
// reconstructs the panel's queue server-side, and the server's window and the
// page's `pruneStale` must be the same number or the two answers to "what is in
// my queue" drift apart. `extension/src/shared/radar.ts` re-exports it as
// `RADAR_TTL_MS`, so every call site there is untouched.
export const RADAR_QUEUE_TTL_MS = 24 * 60 * 60 * 1000;
