// Quests & streaks (CIRCLES-PLAN C9). Pure — no DB, no clock reads: the brief
// route loads the rows, this module decides what today's quest block says and
// how long the streak is. Tone contract with the panel: a quest that had no
// opportunity today (no launch, nothing neglected, inbox already clear) counts
// as done with a `note` saying why — the streak never punishes a quiet day.
//
// A quest hit is measured from the same rows the rest of the brief reads:
// posted reply_drafts (updatedAt = paste time), posts_published (the publisher
// inserts at post time), mentions.answeredAt, and the 2–10x target roster.

const DAY_MS = 24 * 60 * 60 * 1000;

export const QUEST_KEYS = ['replies', 'original', 'targets', 'loop', 'launch'] as const;
export type QuestKey = (typeof QUEST_KEYS)[number];

// How long after a post goes live a pasted reply still counts as "attended the
// launch room" — the C7 room itself lives for 30 minutes.
export const LAUNCH_ATTEND_WINDOW_MS = 30 * 60_000;
// A target neglected = no reply from me in the trailing week (same reading as
// the C5 neglected_target window).
export const NEGLECTED_TARGET_DAYS = 7;
export const NEGLECTED_TARGETS_QUEST_TARGET = 2;

export interface Quest {
  key: QuestKey;
  label: string;
  /** Progress numerator (what happened today). */
  n: number;
  /** Progress denominator; 0 means the quest had no opportunity today. */
  target: number;
  done: boolean;
  /** Gentle context when the quest is vacuously done or worth a word. */
  note: string | null;
}

export interface QuestInputs {
  /** Posted reply_drafts today (paste time). */
  repliesPostedToday: number;
  repliesTarget: number;
  /** Non-reply posts_published with postedAt inside today. */
  originalsPostedToday: number;
  /** Targets that were already neglected when the day started. */
  neglectedTargetsAtDayStart: number;
  /** Of those, how many got a reply today. */
  neglectedTargetsTouched: number;
  /** Mentions flipped to answered today. */
  loopsClosedToday: number;
  /** Mentions still unanswered right now. */
  openLoopsNow: number;
  /** Non-reply posts that went live today (launches). */
  launchesToday: number;
  /** Launches with at least one pasted reply inside the 30-min window. */
  launchesAttended: number;
}

export function computeQuests(i: QuestInputs): Quest[] {
  const targetsTarget = Math.min(NEGLECTED_TARGETS_QUEST_TARGET, i.neglectedTargetsAtDayStart);
  const loopVacuous = i.loopsClosedToday === 0 && i.openLoopsNow === 0;
  return [
    {
      key: 'replies',
      label: `${i.repliesTarget} quality replies`,
      n: i.repliesPostedToday,
      target: i.repliesTarget,
      done: i.repliesPostedToday >= i.repliesTarget,
      note: null,
    },
    {
      key: 'original',
      label: '1 original post',
      n: i.originalsPostedToday,
      target: 1,
      done: i.originalsPostedToday >= 1,
      note: null,
    },
    {
      key: 'targets',
      label: '2 neglected targets touched',
      n: i.neglectedTargetsTouched,
      target: targetsTarget,
      done: i.neglectedTargetsTouched >= targetsTarget,
      note: targetsTarget === 0 ? 'no one on the roster is neglected' : null,
    },
    {
      key: 'loop',
      label: '1 open loop closed',
      n: i.loopsClosedToday,
      target: loopVacuous ? 0 : 1,
      done: i.loopsClosedToday >= 1 || i.openLoopsNow === 0,
      note: loopVacuous ? 'inbox already clear' : null,
    },
    {
      key: 'launch',
      label: 'launch room attended',
      n: i.launchesAttended,
      target: i.launchesToday > 0 ? 1 : 0,
      done: i.launchesToday === 0 || i.launchesAttended >= 1,
      note: i.launchesToday === 0 ? 'no launch today' : null,
    },
  ];
}

export function allQuestsDone(quests: Quest[]): boolean {
  return quests.every((q) => q.done);
}

export function completedMap(quests: Quest[]): Record<string, boolean> {
  return Object.fromEntries(quests.map((q) => [q.key, q.done]));
}

// ------------------------------------------------------------------ streak

/** YYYY-MM-DD of the viewer's local day (tzOffsetMin follows JS
 *  Date.getTimezoneOffset() sign: UTC − local). */
export function localDayKey(now: Date, tzOffsetMin: number): string {
  return new Date(now.getTime() - tzOffsetMin * 60_000).toISOString().slice(0, 10);
}

function prevDayKey(day: string): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) - DAY_MS).toISOString().slice(0, 10);
}

export interface StreakDay {
  day: string;
  allDone: boolean;
}

export interface Streak {
  /** Consecutive all-done days ending today (or yesterday while today is
   *  still in progress). */
  current: number;
  todayComplete: boolean;
}

/** Walk back from today. An incomplete today doesn't break the streak — the
 *  day isn't over — but a missing or incomplete *yesterday* does. */
export function computeStreak(rows: StreakDay[], todayKey: string): Streak {
  const byDay = new Map(rows.map((r) => [r.day, r.allDone]));
  const todayComplete = byDay.get(todayKey) === true;
  let current = 0;
  let day = todayComplete ? todayKey : prevDayKey(todayKey);
  while (byDay.get(day) === true) {
    current++;
    day = prevDayKey(day);
  }
  return { current, todayComplete };
}

// --------------------------------------------- neglected-target arithmetic

/** Which roster targets were neglected as of the day's start, given each
 *  handle's last posted reply BEFORE today (paste time). */
export function neglectedTargetsAtDayStart(
  targetHandles: Iterable<string>,
  priorOutboundByHandle: Map<string, Date>,
  todayStart: Date,
): Set<string> {
  const cutoff = todayStart.getTime() - NEGLECTED_TARGET_DAYS * DAY_MS;
  const out = new Set<string>();
  for (const h of targetHandles) {
    const prior = priorOutboundByHandle.get(h);
    if (!prior || prior.getTime() < cutoff) out.add(h);
  }
  return out;
}

/** Attendance: a launch counts as attended when at least one reply was pasted
 *  inside its 30-minute window. */
export function launchesAttended(launchPostedAts: Date[], replyPastedAts: Date[]): number {
  let attended = 0;
  for (const p of launchPostedAts) {
    const from = p.getTime();
    const to = from + LAUNCH_ATTEND_WINDOW_MS;
    if (replyPastedAts.some((r) => r.getTime() >= from && r.getTime() <= to)) attended++;
  }
  return attended;
}
