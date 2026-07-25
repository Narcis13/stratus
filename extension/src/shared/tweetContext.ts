// Status-page context panel (Augmented X UI v2, AX.4) — the view-model behind
// the collapsible "stratus context" panel injected under a tweet's action row.
// It consumes the C1 dossier (GET /x/people/:handle) as received over HTTP —
// so every Date field arrives as an ISO string, not a Date. Pure and
// dependency-free on purpose so Vite inlines it into the content IIFE; the DOM
// plumbing lives in content.ts (Task 5).
//
// Field names come verbatim from the dossier route (src/x/routes/people.ts).
// Everything is null-safe: a hover-only person has a people row but no events,
// no replies, no snapshots, no mentions.

// Same min-sample discipline as the server (MIN_MEASURED_FOR_ANGLE_PREFERENCE
// in src/x/people/relationship.ts): an angle preference measured on fewer than
// 3 posted+measured replies is noise. Re-declared here to keep the IIFE free of
// server imports.
export const MIN_MEASURED_FOR_ANGLE_PREFERENCE = 3;

const DAY_MS = 86_400_000;
const MAX_OUTCOMES = 3;
const SNIPPET_MAX = 140;

// The event types the people-list route counts as inbound vs outbound (kept in
// sync with src/x/people/store.ts). Inbound = they reached toward me; outbound
// = my reply to them.
const INBOUND_TYPES = new Set(['their_mention', 'their_reply_to_me']);
const OUTBOUND_TYPE = 'my_reply';

// ---------------------------------------------------------------- dossier types
// Only the fields the panel consumes. All timestamps are ISO strings (JSON).

export interface DossierPerson {
  handle: string;
  displayName: string | null;
  stage: string;
  followersCount: number | null;
  notes: string | null;
  tags: string[] | null;
  firstSeenAt: string | null;
  lastInboundAt: string | null;
  lastOutboundAt: string | null;
}

export interface DossierEvent {
  type: string;
  at: string;
}

export interface DossierOutcome {
  sourceTweetId: string;
  replyText: string;
  postedTweetId: string | null;
  postedAt: string | null;
  draftCreatedAt: string;
  // The dossier route does not yet emit a per-outcome angle (it only feeds the
  // aggregate `angles` crosstab), so this is optional and reads null today.
  angle?: string | null;
  outcome: {
    views: number | null;
    profileVisits: number | null;
  } | null;
}

export interface DossierMention {
  tweetId: string;
  text: string;
  postedAt: string;
  status: string;
}

// Mirrors AngleCell (src/x/people/angles.ts) — only the fields the pick reads.
export interface DossierAngleCell {
  angle: string | null;
  measured: number;
  medianViews: number | null;
  medianProfileVisits: number | null;
}

export interface DossierFollowerPoint {
  followersCount: number;
  capturedAt: string;
}

export interface Dossier {
  person: DossierPerson;
  events: DossierEvent[];
  replies: { outcomes: DossierOutcome[] };
  angles: DossierAngleCell[];
  mentions: DossierMention[];
  followerSeries: DossierFollowerPoint[];
}

// ---------------------------------------------------------------- view-model

export interface TweetContextHeader {
  handle: string;
  displayName: string | null;
  stage: string;
  /** Days since first seen; null when firstSeenAt is unknown. */
  sinceDays: number | null;
  followersCount: number | null;
  /** followers/day across the whole follower series; null with <2 points. */
  momentumPerDay: number | null;
  tags: string[];
}

export interface TweetContextRelationship {
  inbound: number;
  outbound: number;
  lastInboundAt: string | null;
  lastOutboundAt: string | null;
}

export interface AlreadyReplied {
  postedTweetId: string | null;
  ageMin: number;
}

export interface OpenLoopItem {
  tweetId: string;
  text: string;
  ageDays: number;
}

export interface OutcomeItem {
  text: string;
  views: number | null;
  profileVisits: number | null;
  angle: string | null;
  postedAt: string | null;
}

export interface AnglePreference {
  angle: string;
  measured: number;
}

export interface TweetContextModel {
  header: TweetContextHeader;
  relationship: TweetContextRelationship;
  /** Set when a posted reply of mine already answers THIS tweet. */
  alreadyReplied: AlreadyReplied | null;
  /** Unanswered mentions from this person, oldest debt first. */
  openLoops: OpenLoopItem[];
  /** My last measured replies to them, newest first (≤3, measured only). */
  outcomes: OutcomeItem[];
  anglePreference: AnglePreference | null;
  notes: string | null;
}

/** Build the panel view-model from the dossier JSON. `tweetId` is the tweet the
 *  panel is rendered under (drives `alreadyReplied`); `nowMs` is the clock (all
 *  ages derive from it — the caller passes Date.now()). */
export function buildTweetContextModel(
  dossier: Dossier,
  tweetId: string,
  nowMs: number,
): TweetContextModel {
  const p = dossier.person;

  let inbound = 0;
  let outbound = 0;
  for (const e of dossier.events) {
    if (INBOUND_TYPES.has(e.type)) inbound++;
    else if (e.type === OUTBOUND_TYPE) outbound++;
  }

  const header: TweetContextHeader = {
    handle: p.handle,
    displayName: p.displayName,
    stage: p.stage,
    sinceDays: p.firstSeenAt
      ? Math.max(0, Math.floor((nowMs - Date.parse(p.firstSeenAt)) / DAY_MS))
      : null,
    followersCount: p.followersCount ?? null,
    momentumPerDay: momentumPerDay(dossier.followerSeries),
    tags: p.tags ?? [],
  };

  const relationship: TweetContextRelationship = {
    inbound,
    outbound,
    lastInboundAt: p.lastInboundAt ?? null,
    lastOutboundAt: p.lastOutboundAt ?? null,
  };

  const alreadyReplied = pickAlreadyReplied(dossier.replies.outcomes, tweetId, nowMs);

  const openLoops: OpenLoopItem[] = dossier.mentions
    .filter((m) => m.status === 'unanswered')
    .map((m) => ({
      tweetId: m.tweetId,
      text: m.text,
      ageDays: Math.max(0, Math.floor((nowMs - Date.parse(m.postedAt)) / DAY_MS)),
    }))
    .sort((a, b) => b.ageDays - a.ageDays);

  const outcomes: OutcomeItem[] = dossier.replies.outcomes
    .filter((o) => o.outcome !== null)
    .sort((a, b) => effectiveTime(b) - effectiveTime(a))
    .slice(0, MAX_OUTCOMES)
    .map((o) => ({
      text: snippet(o.replyText),
      views: o.outcome?.views ?? null,
      profileVisits: o.outcome?.profileVisits ?? null,
      angle: o.angle ?? null,
      postedAt: o.postedAt ?? null,
    }));

  return {
    header,
    relationship,
    alreadyReplied,
    openLoops,
    outcomes,
    anglePreference: pickAnglePreference(dossier.angles),
    notes: p.notes?.trim() || null,
  };
}

// followers/day between the first and last series points, span clamped to ≥1
// day (mirrors authorMomentum in src/x/routes/voice.ts). Null with <2 points.
function momentumPerDay(points: DossierFollowerPoint[]): number | null {
  if (points.length < 2) return null;
  const ordered = [...points].sort((a, b) => Date.parse(a.capturedAt) - Date.parse(b.capturedAt));
  const first = ordered[0] as DossierFollowerPoint;
  const last = ordered[ordered.length - 1] as DossierFollowerPoint;
  const days = (Date.parse(last.capturedAt) - Date.parse(first.capturedAt)) / DAY_MS;
  const delta = last.followersCount - first.followersCount;
  return round2(delta / Math.max(days, 1));
}

// The most recent posted reply of mine that answers this exact tweet.
function pickAlreadyReplied(
  outcomes: DossierOutcome[],
  tweetId: string,
  nowMs: number,
): AlreadyReplied | null {
  const matches = outcomes
    .filter((o) => o.sourceTweetId === tweetId)
    .sort((a, b) => effectiveTime(b) - effectiveTime(a));
  const best = matches[0];
  if (!best) return null;
  return {
    postedTweetId: best.postedTweetId,
    ageMin: Math.max(0, Math.floor((nowMs - effectiveTime(best)) / 60_000)),
  };
}

// Gate + pick, mirroring pickAnglePreference (src/x/people/relationship.ts):
// null under the min sample; otherwise the angle whose measured replies earned
// the best median profile visits (views break ties, then sample size).
function pickAnglePreference(cells: DossierAngleCell[]): AnglePreference | null {
  const totalMeasured = cells.reduce((n, c) => n + c.measured, 0);
  if (totalMeasured < MIN_MEASURED_FOR_ANGLE_PREFERENCE) return null;
  const ranked = cells
    .filter((c): c is DossierAngleCell & { angle: string } => c.angle !== null && c.measured > 0)
    .sort(
      (a, b) =>
        (b.medianProfileVisits ?? -1) - (a.medianProfileVisits ?? -1) ||
        (b.medianViews ?? -1) - (a.medianViews ?? -1) ||
        b.measured - a.measured,
    );
  const best = ranked[0];
  if (!best) return null;
  return { angle: best.angle, measured: best.measured };
}

// When my reply went out: the published time when linked, the draft time
// otherwise (an unlinked posted draft still happened).
function effectiveTime(o: DossierOutcome): number {
  return Date.parse(o.postedAt ?? o.draftCreatedAt);
}

function snippet(text: string, max = SNIPPET_MAX): string {
  const collapsed = text.replace(/\s+/g, ' ').trim();
  return collapsed.length <= max ? collapsed : `${collapsed.slice(0, max - 1)}…`;
}

function round2(x: number): number {
  return Math.round(x * 100) / 100;
}
