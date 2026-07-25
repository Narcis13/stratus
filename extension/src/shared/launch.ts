// The Launch Room (CIRCLES-PLAN C7) — the first-30-minutes protocol. The
// background sets a chrome.alarm per pending scheduled post (+90s grace for
// the publisher's 60s tick); at fire time it verifies the post actually went
// live, notifies, and opens a 30-minute "room" the Today tab takes over. The
// content script streams the early repliers it sees in the DOM into the room.
//
// This module is the pure, unit-testable core (alarm computation, room
// liveness, early-reply merge). Chrome plumbing lives in background.ts
// (single writer of the session keys) and sidepanel/LaunchRoom.tsx (reader).

export const LAUNCH_SYNC_ALARM = 'stratus-launch-sync';
export const LAUNCH_ALARM_PREFIX = 'stratus-launch:';
export const LAUNCH_RETRY_PREFIX = 'stratus-launch-retry:';

/** Publisher ticks every 60s — fire the room slightly after the post should
 *  actually be live, not at the scheduled minute. */
export const LAUNCH_GRACE_MS = 90_000;
/** The doctrine's window: be present for the first 30 minutes. */
export const LAUNCH_ROOM_MS = 30 * 60_000;
/** At fire time the row may still be pending/publishing — re-check on this
 *  cadence, this many times, before giving up. */
export const LAUNCH_RETRY_MS = 60_000;
export const LAUNCH_MAX_RETRIES = 5;
export const LAUNCH_SYNC_PERIOD_MIN = 15;

// chrome.storage.session keys — cleared when the browser closes, same
// lifetime discipline as the radar buffer. Background is the single writer.
export const LAUNCH_ACTIVE_KEY = 'launch:active';
export const LAUNCH_REPLIES_KEY = 'launch:replies';

export const EARLY_REPLIES_CAP = 100;

export interface ActiveLaunch {
  postId: string;
  tweetId: string;
  text: string;
  url: string;
  /** When the room opened (the alarm verified the post live) — the 30-minute
   *  window and the elapsed timer count from here. */
  firedAt: string;
  /** §8.2 link-in-first-reply threads: remind the user to pin that reply. */
  linkInFirstReply: boolean;
}

export interface EarlyReply {
  tweetId: string;
  handle: string;
  author: string | null;
  text: string;
  postedAt: string | null;
}

export interface LaunchAlarm {
  name: string;
  when: number;
}

interface SchedulablePost {
  id: string;
  status: string;
  scheduledFor: string | null;
}

/** One alarm per pending post: scheduledFor + grace. Posts whose room window
 *  has already fully passed are skipped; a fire time in the recent past is
 *  clamped just ahead of `now` so chrome.alarms fires it immediately (the
 *  browser may have been closed at the scheduled minute — the room is still
 *  worth opening mid-window). */
export function computeLaunchAlarms(posts: SchedulablePost[], nowMs: number): LaunchAlarm[] {
  const alarms: LaunchAlarm[] = [];
  for (const p of posts) {
    if (p.status !== 'pending' || !p.scheduledFor) continue;
    const scheduled = Date.parse(p.scheduledFor);
    if (Number.isNaN(scheduled)) continue;
    const fireAt = scheduled + LAUNCH_GRACE_MS;
    if (fireAt < nowMs - LAUNCH_ROOM_MS) continue; // window long gone
    alarms.push({ name: LAUNCH_ALARM_PREFIX + p.id, when: Math.max(fireAt, nowMs + 1000) });
  }
  return alarms.sort((a, b) => a.when - b.when);
}

/** Parse a fire or retry alarm back to its post id + attempt (0 = first
 *  fire). Null for alarms that aren't ours. */
export function parseLaunchAlarm(name: string): { postId: string; attempt: number } | null {
  if (name.startsWith(LAUNCH_RETRY_PREFIX)) {
    const rest = name.slice(LAUNCH_RETRY_PREFIX.length);
    const sep = rest.lastIndexOf(':');
    if (sep <= 0) return null;
    const attempt = Number(rest.slice(sep + 1));
    if (!Number.isInteger(attempt) || attempt < 1) return null;
    return { postId: rest.slice(0, sep), attempt };
  }
  if (name.startsWith(LAUNCH_ALARM_PREFIX)) {
    return { postId: name.slice(LAUNCH_ALARM_PREFIX.length), attempt: 0 };
  }
  return null;
}

export function retryAlarmName(postId: string, attempt: number): string {
  return `${LAUNCH_RETRY_PREFIX}${postId}:${attempt}`;
}

/** Is the room still inside its 30-minute window? */
export function launchIsLive(firedAt: string, nowMs: number): boolean {
  const t = Date.parse(firedAt);
  if (Number.isNaN(t)) return false;
  return nowMs - t < LAUNCH_ROOM_MS && nowMs >= t - 1000;
}

/** Merge a report batch into the stored feed, keyed by tweetId — first
 *  sighting wins (the feed is arrival-ordered, oldest first). Returns the
 *  merged list plus which entries actually entered, so the background only
 *  forwards genuinely new repliers to the server. Past the cap the newest
 *  arrivals are dropped: 100 replies in 30 minutes means the feed's job
 *  (reply to the early ones) is already done. */
export function mergeEarlyReplies(
  existing: EarlyReply[],
  incoming: EarlyReply[],
  cap = EARLY_REPLIES_CAP,
): { merged: EarlyReply[]; added: EarlyReply[] } {
  const have = new Set(existing.map((r) => r.tweetId));
  const added: EarlyReply[] = [];
  for (const r of incoming) {
    if (have.has(r.tweetId)) continue;
    have.add(r.tweetId);
    added.push(r);
  }
  const merged = [...existing, ...added].slice(0, cap);
  const kept = new Set(merged.map((r) => r.tweetId));
  return { merged, added: added.filter((r) => kept.has(r.tweetId)) };
}

// Same regex family as the server's URL surcharge guard (src/x/endpoints.ts).
const URL_RE = /(^|\s)https?:\/\//i;

/** §8.2 pattern detection: a thread whose tail carries the link — the room's
 *  checklist then reminds the user to pin that first reply. */
export function threadLinkInFirstReply(
  thread: Array<{ threadPosition: number | null; text: string }> | undefined,
): boolean {
  if (!thread) return false;
  return thread.some((s) => (s.threadPosition ?? 1) >= 2 && URL_RE.test(s.text));
}

/** «snippet» just went live — open the Launch Room */
export function notificationText(postText: string, max = 80): string {
  const collapsed = postText.replace(/\s+/g, ' ').trim();
  const clipped = collapsed.length <= max ? collapsed : `${collapsed.slice(0, max - 1)}…`;
  return `«${clipped}» just went live — open the Launch Room`;
}

export function isActiveLaunch(v: unknown): v is ActiveLaunch {
  if (!v || typeof v !== 'object') return false;
  const r = v as Record<string, unknown>;
  return (
    typeof r.postId === 'string' &&
    typeof r.tweetId === 'string' &&
    typeof r.text === 'string' &&
    typeof r.url === 'string' &&
    typeof r.firedAt === 'string' &&
    typeof r.linkInFirstReply === 'boolean'
  );
}

export function isEarlyReplies(v: unknown): v is EarlyReply[] {
  if (!Array.isArray(v)) return false;
  return v.every((r) => {
    if (!r || typeof r !== 'object') return false;
    const x = r as Record<string, unknown>;
    return (
      typeof x.tweetId === 'string' && typeof x.handle === 'string' && typeof x.text === 'string'
    );
  });
}

// ------------------------------------------------ manual-publish alarms (A3.8)
//
// A `manual` scheduled post is one the USER pastes into X by hand at its slot
// (Studio visuals, link posts dodging the $0.20 URL surcharge — nothing
// auto-publishes). The background sets one chrome.alarm per manual row AT its
// scheduledFor and, at fire time, drops a due entry for the Today card + fires a
// "Time to post" notification. Unlike the Launch Room there is no grace and no
// retry: there is no publisher tick to wait on and the row's status is
// authoritative the instant it fires (marked posted, or not).

export const MANUAL_ALARM_PREFIX = 'stratus-manual:';
export const MANUAL_DUE_KEY = 'manual:due';

/** A manual slot missed by more than this is left to the Calendar/Today overdue
 *  chip — no alarm, no notification (a reminder that late is just noise). A fire
 *  time inside this window clamps to now so a reopened browser still nudges. */
export const MANUAL_MISS_GRACE_MS = 30 * 60_000;
/** The Today card self-expires from view this long after it fired; the session
 *  storage entry harmlessly lingers until the browser closes. */
export const MANUAL_CARD_TTL_MS = 60 * 60_000;
/** At most this many due cards at once — two manual posts can share an evening. */
export const MANUAL_DUE_CAP = 5;

/** One due manual post awaiting a hand-paste — written by the background at fire
 *  time (single writer), read by the Today card. `firedAt` drives both the
 *  newest-first order and the 60-minute render expiry. */
export interface ManualDue {
  postId: string;
  text: string;
  mediaNote: string | null;
  scheduledFor: string | null;
  firedAt: string;
}

/** One alarm per manual row AT scheduledFor (no grace, unlike launch). A slot
 *  more than MANUAL_MISS_GRACE_MS in the past is dropped (the overdue chip owns
 *  it); a recent miss clamps just ahead of now so chrome.alarms fires at once. */
export function computeManualAlarms(posts: SchedulablePost[], nowMs: number): LaunchAlarm[] {
  const alarms: LaunchAlarm[] = [];
  for (const p of posts) {
    if (p.status !== 'manual' || !p.scheduledFor) continue;
    const scheduled = Date.parse(p.scheduledFor);
    if (Number.isNaN(scheduled)) continue;
    if (scheduled < nowMs - MANUAL_MISS_GRACE_MS) continue; // too late to nudge
    alarms.push({ name: MANUAL_ALARM_PREFIX + p.id, when: Math.max(scheduled, nowMs + 1000) });
  }
  return alarms.sort((a, b) => a.when - b.when);
}

/** postId for a manual alarm, or null for any alarm that isn't ours. */
export function parseManualAlarm(name: string): string | null {
  return name.startsWith(MANUAL_ALARM_PREFIX) ? name.slice(MANUAL_ALARM_PREFIX.length) : null;
}

/** Prepend a fired manual post to the due list — newest first, deduped by postId
 *  (a re-fire of the same still-unposted slot refreshes it rather than stacking),
 *  capped. Pure so the background's cap/dedup is unit-testable. */
export function mergeManualDue(
  existing: ManualDue[],
  entry: ManualDue,
  cap = MANUAL_DUE_CAP,
): ManualDue[] {
  const rest = existing.filter((e) => e.postId !== entry.postId);
  return [entry, ...rest].slice(0, cap);
}

/** Should the Today card still show this due entry? (60 min from firedAt) */
export function manualCardVisible(firedAt: string, nowMs: number): boolean {
  const t = Date.parse(firedAt);
  if (Number.isNaN(t)) return false;
  return nowMs - t < MANUAL_CARD_TTL_MS && nowMs >= t - 1000;
}

/** Time to post: «snippet» — the notification body, clipped short. */
export function manualNotificationText(postText: string, max = 60): string {
  const collapsed = postText.replace(/\s+/g, ' ').trim();
  const clipped = collapsed.length <= max ? collapsed : `${collapsed.slice(0, max - 1)}…`;
  return `Time to post: «${clipped}»`;
}

export function isManualDueList(v: unknown): v is ManualDue[] {
  if (!Array.isArray(v)) return false;
  return v.every((e) => {
    if (!e || typeof e !== 'object') return false;
    const x = e as Record<string, unknown>;
    return (
      typeof x.postId === 'string' &&
      typeof x.text === 'string' &&
      (x.mediaNote === null || typeof x.mediaNote === 'string') &&
      (x.scheduledFor === null || typeof x.scheduledFor === 'string') &&
      typeof x.firedAt === 'string'
    );
  });
}
