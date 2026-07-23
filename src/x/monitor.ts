// Activity monitor (Guardrails §B, GR.5). Pure — no DB, no clock reads: the
// route loads the rows and passes `now`, this module decides what looks risky.
//
// What it protects: a suspension zeroes all four goals at once, and every
// pattern X's spam heuristics punish (posting bursts, near-duplicate content,
// unfollow churn) is something I can do to myself in one afternoon. So the
// rules only ever look at MY OWN actions — which is also why the §7.19 sample
// gates don't apply here. A gate exists to stop a thin sample from being read
// as a statistic about the audience; "I pasted 14 replies in an hour" is not an
// inference, it is a count of what I did, and it is true at n=14.
//
// Nothing here blocks anything. Same nudge-not-action discipline as the unfollow
// queue and the pinned watch: the alert says what it saw, the human decides.
//
// Every threshold is an opening guess. They are exported constants so a
// recalibration is a one-line diff — revisit them against real behaviour, never
// by vibes.

import { DAILY_CEILING, MARK_LOOKBACK_MS } from './connections.ts';

const MIN_MS = 60_000;
const HOUR_MS = 60 * MIN_MS;
const DAY_MS = 24 * HOUR_MS;

/** Originals in this trailing window feed `postBurst`. */
export const POST_BURST_WINDOW_MS = DAY_MS;
/** Strictly MORE than this many originals in 24h warns. */
export const POST_BURST_MAX = 4;
/** Two originals closer together than this warn: the publisher jitters its
 *  minutes, so a tight pair means manual posting on top of the schedule. */
export const POST_PAIR_WINDOW_MS = 20 * MIN_MS;

/** The span `replyBurst` measures density over. */
export const REPLY_BURST_WINDOW_MS = HOUR_MS;
/** How far back the densest hour is looked for. Wider than the window on
 *  purpose: a burst that ended 90 minutes ago is still the thing X saw, so the
 *  alert keeps a tail instead of vanishing the moment the hour rolls over. */
export const REPLY_BURST_LOOKBACK_MS = 3 * HOUR_MS;
/** Strictly more than this many pasted replies inside one hour warns. */
export const REPLY_BURST_WARN = 10;
/** Strictly more than this is critical. */
export const REPLY_BURST_CRITICAL = 15;

export const NEAR_DUPLICATE_WINDOW_MS = 14 * DAY_MS;
/** Jaccard AT OR ABOVE this reads as near-duplicate. */
export const NEAR_DUPLICATE_THRESHOLD = 0.8;
export const SHINGLE_SIZE = 3;

/** Marks AT OR ABOVE this in the churn window warn; `DAILY_CEILING` is critical.
 *  The queue's own budget hits 0 at the ceiling, so a critical here can only
 *  mean unfollowing by hand outside the queue — which is exactly the thing
 *  worth saying out loud. */
export const UNFOLLOW_CHURN_WARN = 25;
/** Same trailing window the release budget counts marks over (`connections.ts`),
 *  imported rather than redeclared so the two can never disagree about what
 *  "today's churn" means. */
export const UNFOLLOW_CHURN_WINDOW_MS = MARK_LOOKBACK_MS;

/** Pending slots closer together than this are advice, never danger. */
export const SCHEDULE_CLUSTER_MS = 45 * MIN_MS;

/** How many example pairs an alert carries. The count of matches is always
 *  reported alongside, so the cap can never read as "that was all of them". */
export const MAX_LISTED_PAIRS = 5;

export const MONITOR_RULES = [
  'postBurst',
  'replyBurst',
  'nearDuplicate',
  'unfollowChurn',
  'scheduleCluster',
] as const;
export type MonitorRule = (typeof MONITOR_RULES)[number];

export type MonitorSeverity = 'info' | 'warn' | 'critical';

export interface MonitorAlert {
  rule: MonitorRule;
  severity: MonitorSeverity;
  /** Written for a human reading the Today card — says what was seen, not what
   *  to do about it. */
  message: string;
  /** The numbers behind the message, for the panel/MCP reader that wants them. */
  evidence: Record<string, unknown>;
}

const SEVERITY_RANK: Record<MonitorSeverity, number> = { info: 1, warn: 2, critical: 3 };

export function worstOf(alerts: readonly MonitorAlert[]): MonitorSeverity | null {
  let worst: MonitorSeverity | null = null;
  for (const a of alerts) {
    if (worst === null || SEVERITY_RANK[a.severity] > SEVERITY_RANK[worst]) worst = a.severity;
  }
  return worst;
}

// ------------------------------------------------------------------- inputs

export interface MonitorPost {
  tweetId: string;
  text: string;
  postedAt: Date;
}

export interface MonitorSlot {
  id: string;
  scheduledFor: Date;
}

export interface MonitorInputs {
  now: Date;
  /** Own ORIGINALS (`is_reply = false`) inside `NEAR_DUPLICATE_WINDOW_MS`; the
   *  burst rule narrows to its own 24h window. Thread tails are published as
   *  self-replies, so a 6-tweet thread is ONE row here — which is the point: it
   *  posts six tweets in seconds and none of X's burst heuristics care. */
  originals: MonitorPost[];
  /** Paste times of posted reply drafts (`reply_drafts.updated_at` on the posted
   *  flip — the same reading the brief's reply quota uses), inside
   *  `REPLY_BURST_LOOKBACK_MS`. */
  replyPastedAts: Date[];
  /** `following.unfollow_marked_at` inside `UNFOLLOW_CHURN_WINDOW_MS`. */
  unfollowMarks: Date[];
  /** Pending calendar slots that carry a scheduled time. */
  pendingSlots: MonitorSlot[];
}

// ------------------------------------------------------------ text shingles

const URL_RE = /https?:\/\/\S+/g;
const HANDLE_RE = /@\w+/g;
// Everything that isn't a letter, digit or whitespace — punctuation AND emoji.
// Two posts differing only by an exclamation mark or a rocket ARE the same post
// as far as a repetitive-content penalty is concerned.
const NOISE_RE = /[^\p{L}\p{N}\s]+/gu;

/** Lowercase, drop URLs and @handles, drop punctuation/emoji, split on
 *  whitespace. URLs and handles go FIRST — otherwise stripping punctuation
 *  shatters them into content words. */
export function normalizeForShingles(text: string): string[] {
  return text
    .toLowerCase()
    .replace(URL_RE, ' ')
    .replace(HANDLE_RE, ' ')
    .replace(NOISE_RE, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

function shingleSet(text: string): Set<string> {
  const words = normalizeForShingles(text);
  const out = new Set<string>();
  if (words.length === 0) return out;
  // A post shorter than the shingle size becomes one shingle of itself —
  // otherwise two identical one-word posts would read as 0% similar.
  const size = Math.min(SHINGLE_SIZE, words.length);
  for (let i = 0; i + size <= words.length; i++) out.add(words.slice(i, i + size).join(' '));
  return out;
}

function jaccard(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const s of a) if (b.has(s)) inter++;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

/** Word-shingle Jaccard similarity, 0..1. */
export function shingleJaccard(a: string, b: string): number {
  return jaccard(shingleSet(a), shingleSet(b));
}

// -------------------------------------------------------------------- rules

/** Densest `windowMs` span in a sorted list of timestamps (two pointers). */
function peakInWindow(
  sorted: readonly number[],
  windowMs: number,
): { count: number; endedAt: number | null } {
  let count = 0;
  let endedAt: number | null = null;
  let lo = 0;
  for (let hi = 0; hi < sorted.length; hi++) {
    const end = sorted[hi] as number;
    while (end - (sorted[lo] as number) > windowMs) lo++;
    const n = hi - lo + 1;
    if (n > count) {
      count = n;
      endedAt = end;
    }
  }
  return { count, endedAt };
}

export function postBurst(originals: readonly MonitorPost[], now: Date): MonitorAlert | null {
  const cutoff = now.getTime() - POST_BURST_WINDOW_MS;
  const recent = originals
    .filter((p) => p.postedAt.getTime() >= cutoff)
    .sort((a, b) => a.postedAt.getTime() - b.postedAt.getTime());

  const tooMany = recent.length > POST_BURST_MAX;

  let closestGapMs = Number.POSITIVE_INFINITY;
  let closestPair: [string, string] | null = null;
  for (let i = 1; i < recent.length; i++) {
    const prev = recent[i - 1] as MonitorPost;
    const cur = recent[i] as MonitorPost;
    const gap = cur.postedAt.getTime() - prev.postedAt.getTime();
    if (gap < POST_PAIR_WINDOW_MS && gap < closestGapMs) {
      closestGapMs = gap;
      closestPair = [prev.tweetId, cur.tweetId];
    }
  }

  if (!tooMany && closestPair === null) return null;

  const parts: string[] = [];
  if (tooMany) parts.push(`${recent.length} originals in the last 24h`);
  if (closestPair !== null) parts.push(`two posted ${Math.round(closestGapMs / MIN_MS)} min apart`);

  return {
    rule: 'postBurst',
    severity: 'warn',
    message: `${parts.join(', ')} — the publisher jitters its minutes, so this reads as manual posting on top of the schedule.`,
    evidence: {
      count24h: recent.length,
      max24h: POST_BURST_MAX,
      ...(closestPair === null
        ? {}
        : { closestPairMin: Math.round(closestGapMs / MIN_MS), closestPair }),
    },
  };
}

export function replyBurst(pastedAts: readonly Date[], now: Date): MonitorAlert | null {
  const cutoff = now.getTime() - REPLY_BURST_LOOKBACK_MS;
  const sorted = pastedAts
    .map((d) => d.getTime())
    .filter((t) => t >= cutoff)
    .sort((a, b) => a - b);

  const peak = peakInWindow(sorted, REPLY_BURST_WINDOW_MS);
  if (peak.count <= REPLY_BURST_WARN) return null;

  const critical = peak.count > REPLY_BURST_CRITICAL;
  return {
    rule: 'replyBurst',
    severity: critical ? 'critical' : 'warn',
    message: critical
      ? `${peak.count} replies pasted inside one hour — well past bulk-reply territory; give it a rest today.`
      : `${peak.count} replies pasted inside one hour — X's bulk-reply heuristics watch exactly this shape.`,
    evidence: {
      peakPerHour: peak.count,
      warnAbove: REPLY_BURST_WARN,
      criticalAbove: REPLY_BURST_CRITICAL,
      peakEndedAt: peak.endedAt === null ? null : new Date(peak.endedAt).toISOString(),
      lookbackHours: REPLY_BURST_LOOKBACK_MS / HOUR_MS,
    },
  };
}

export function nearDuplicate(originals: readonly MonitorPost[], now: Date): MonitorAlert | null {
  const cutoff = now.getTime() - NEAR_DUPLICATE_WINDOW_MS;
  // Shingle each post ONCE — the comparison itself is O(n²), which is nothing at
  // single-user scale (a fortnight of originals), but re-tokenizing inside the
  // loop would not be.
  const shingled = originals
    .filter((p) => p.postedAt.getTime() >= cutoff)
    .map((p) => ({ post: p, set: shingleSet(p.text) }));

  const pairs: { a: string; b: string; similarity: number }[] = [];
  for (let i = 0; i < shingled.length; i++) {
    for (let j = i + 1; j < shingled.length; j++) {
      const left = shingled[i] as { post: MonitorPost; set: Set<string> };
      const right = shingled[j] as { post: MonitorPost; set: Set<string> };
      const similarity = jaccard(left.set, right.set);
      if (similarity >= NEAR_DUPLICATE_THRESHOLD) {
        pairs.push({ a: left.post.tweetId, b: right.post.tweetId, similarity });
      }
    }
  }
  if (pairs.length === 0) return null;

  // Most similar first; tweet ids break ties so the listed sample is stable
  // between two reads of the same data.
  pairs.sort((x, y) => y.similarity - x.similarity || (x.a < y.a ? -1 : x.a > y.a ? 1 : 0));

  return {
    rule: 'nearDuplicate',
    severity: 'warn',
    message: `${pairs.length} near-duplicate pair${pairs.length === 1 ? '' : 's'} among your originals in the last ${NEAR_DUPLICATE_WINDOW_MS / DAY_MS} days — repetitive content is its own penalty.`,
    evidence: {
      pairCount: pairs.length,
      threshold: NEAR_DUPLICATE_THRESHOLD,
      windowDays: NEAR_DUPLICATE_WINDOW_MS / DAY_MS,
      pairs: pairs.slice(0, MAX_LISTED_PAIRS),
    },
  };
}

export function unfollowChurn(marks: readonly Date[], now: Date): MonitorAlert | null {
  const cutoff = now.getTime() - UNFOLLOW_CHURN_WINDOW_MS;
  const count = marks.filter((m) => m.getTime() >= cutoff).length;
  if (count < UNFOLLOW_CHURN_WARN) return null;

  const critical = count >= DAILY_CEILING;
  return {
    rule: 'unfollowChurn',
    severity: critical ? 'critical' : 'warn',
    message: critical
      ? `${count} unfollows marked in the last 24h — past the ${DAILY_CEILING}/day ceiling the queue enforces. Stop for today.`
      : `${count} unfollows marked in the last 24h — the queue's ceiling is ${DAILY_CEILING}/day.`,
    evidence: {
      count,
      warnAt: UNFOLLOW_CHURN_WARN,
      dailyCeiling: DAILY_CEILING,
      windowHours: UNFOLLOW_CHURN_WINDOW_MS / HOUR_MS,
    },
  };
}

/** Advice, not danger (§B decision): a tight pair of pending slots is a cadence
 *  smell, and the user is about to be told before the posts exist rather than
 *  after. Takes no `now` — a pending slot the publisher hasn't reached yet is
 *  going to post whether its time is a minute away or a minute past. */
export function scheduleCluster(slots: readonly MonitorSlot[]): MonitorAlert | null {
  const sorted = [...slots].sort((a, b) => a.scheduledFor.getTime() - b.scheduledFor.getTime());
  const pairs: { a: string; b: string; gapMin: number }[] = [];
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1] as MonitorSlot;
    const cur = sorted[i] as MonitorSlot;
    const gap = cur.scheduledFor.getTime() - prev.scheduledFor.getTime();
    if (gap < SCHEDULE_CLUSTER_MS) {
      pairs.push({ a: prev.id, b: cur.id, gapMin: Math.round(gap / MIN_MS) });
    }
  }
  if (pairs.length === 0) return null;

  return {
    rule: 'scheduleCluster',
    severity: 'info',
    message: `${pairs.length} pending pair${pairs.length === 1 ? '' : 's'} scheduled under ${SCHEDULE_CLUSTER_MS / MIN_MS} min apart — spreading them out reads calmer.`,
    evidence: {
      clusterCount: pairs.length,
      thresholdMin: SCHEDULE_CLUSTER_MS / MIN_MS,
      pairs: pairs.slice(0, MAX_LISTED_PAIRS),
    },
  };
}

/** At most one alert per rule, most severe first — the Today card renders them
 *  top-down and a critical must lead. Sort is stable, so ties keep rule order. */
export function runMonitor(i: MonitorInputs): MonitorAlert[] {
  const alerts = [
    postBurst(i.originals, i.now),
    replyBurst(i.replyPastedAts, i.now),
    nearDuplicate(i.originals, i.now),
    unfollowChurn(i.unfollowMarks, i.now),
    scheduleCluster(i.pendingSlots),
  ].filter((a): a is MonitorAlert => a !== null);
  return alerts.sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity]);
}
