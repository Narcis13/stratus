// Sunday Digest (CIRCLES-PLAN C9): the week's facts, computed in SQL by the
// route and assembled here — pure, no DB, no clock reads. Grok's ONLY job is
// narrating the FACTS block in the coach's voice; every number and handle it
// may use is in the block, and the prompt forbids inventing beyond it (same
// no-fabrication discipline as the reply prompt).

import type { GrokMessage } from '../grok/index.ts';
import { conversionRate } from './conversion.ts';
import { type GoalVerdict, type Scorecard, computeScorecard } from './goals.ts';
import type { MediaEffectiveness, RosterCoverage } from './playbook.ts';

const DAY_MS = 24 * 60 * 60 * 1000;

export const DIGEST_TOP_TWEETS = 3;
export const DIGEST_TOP_FANS = 5;

// ------------------------------------------------------------- week bounds

export interface WeekBounds {
  /** Monday 00:00 in the viewer's local tz, as a UTC instant. */
  start: Date;
  end: Date;
  /** ISO date of the local Monday — the digests PK. */
  weekKey: string;
}

/** The Monday-to-Monday week containing `ref`. `tzOffsetMin` follows JS
 *  Date.getTimezoneOffset() sign (UTC − local). */
export function weekBounds(ref: Date, tzOffsetMin: number): WeekBounds {
  const shifted = new Date(ref.getTime() - tzOffsetMin * 60_000);
  const dow = (shifted.getUTCDay() + 6) % 7; // Monday = 0
  const mondayUtcMidnight = Date.UTC(
    shifted.getUTCFullYear(),
    shifted.getUTCMonth(),
    shifted.getUTCDate() - dow,
  );
  return {
    start: new Date(mondayUtcMidnight + tzOffsetMin * 60_000),
    end: new Date(mondayUtcMidnight + tzOffsetMin * 60_000 + 7 * DAY_MS),
    weekKey: new Date(mondayUtcMidnight).toISOString().slice(0, 10),
  };
}

// ------------------------------------------------------------------ facts

export interface DigestTweet {
  text: string;
  isReply: boolean;
  views: number | null;
  profileVisits: number | null;
}

/** M1 (ME.5) — one active goal with its computed progress, for the coach to
 *  narrate. `current`/`pct` are null when the goal has no value yet (a followers
 *  goal before the first daily snapshot). */
export interface DigestGoal {
  label: string;
  unit: string | null;
  target: number;
  current: number | null;
  pct: number | null;
}

/** GR.9 — the week's 0–100 grade as it rides in the facts. `sufficient`/
 *  `daysTracked` come straight from `computeScorecard`; the two delta fields are
 *  the only thing this layer adds. */
export interface DigestScorecard extends Scorecard {
  /** The previous week's score, from that week's cached digest. null = there is
   *  nothing comparable (no digest, or one generated before GR.9) — never 0. */
  prevScore: number | null;
  /** score − prevScore, null when either side is missing. */
  delta: number | null;
}

/** GR.9 — what the scorecard needs that the week's rows can't say. The quest and
 *  activity halves are deliberately NOT here: `buildDigestFacts` derives them
 *  and feeds them to `computeScorecard` itself, so the grade can never disagree
 *  with the facts it is a grade of (the `conversionRate` precedent below). */
export interface ScorecardFactInputs {
  /** Days of the week with ≥1 own original — bucketed in the viewer's local
   *  days, the same boundary the C9 streak diary is written in. */
  daysWithOriginal: number;
  /** Days the week covers: 7 once it is over, the elapsed days while it runs. */
  daysInWeek: number;
  /** Daily reply target × daysInWeek — an ACTIVE `replies` commitment, else
   *  doctrine's floor (the same resolution the brief's quests use, GR.8). */
  repliesTargetWeek: number;
  /** Doctrine's target reply share of the week's tweets. */
  targetReplyPct: number;
  /** Verdicts of the ACTIVE goals; empty drops the component. */
  goalVerdicts: GoalVerdict[];
  prevScore: number | null;
}

export interface DigestFactInputs {
  weekKey: string;
  start: Date;
  end: Date;
  /** Account snapshots inside the window, oldest first. */
  followerPoints: Array<{ snapshotAt: Date; followers: number }>;
  /** Everything published inside the window, with latest measured outcomes. */
  tweets: DigestTweet[];
  /** People whose stage advanced inside the window (already filtered). */
  stageTransitions: Array<{ handle: string; stage: string; at: Date }>;
  /** Inbound counts per handle, this week and the one before. */
  fansThisWeek: Array<{ handle: string; inbound: number }>;
  fansPrevWeek: Array<{ handle: string; inbound: number }>;
  neglectedTargets: string[];
  neglectedAllies: string[];
  spendByPlatform: Array<{ platform: string; costUsd: number }>;
  /** streaks rows whose day falls inside the week. */
  streakDays: Array<{ day: string; allDone: boolean }>;
  /** M1 (ME.5) — active Me goals with progress; null when there are none. */
  goals: DigestGoal[] | null;
  /** The Playbook's gated guidance lines (null when the gate isn't met). */
  guidance: { reply: string | null; post: string | null };
  /** §S0.7 — where the week's posted replies went vs my 2–10x target band. */
  rosterCoverage: RosterCoverage;
  /** §S4 — the week's AI image spend (platform 'xai' in cost_events). */
  imageSpendUsd: number;
  /** §S4/§S0.2 — media-vs-text-only medians over own originals (all-time; the
   *  studio's whole job is to earn this lift). Numbers only when both sides
   *  clear n≥20; below the gate the cells read insufficient. */
  mediaVsText: MediaEffectiveness;
  /** §GR.9 — the half of the scorecard the route must supply. */
  scorecardInputs: ScorecardFactInputs;
}

export interface DigestFacts {
  weekKey: string;
  from: string;
  to: string;
  followers: { start: number | null; end: number | null; delta: number | null };
  // S0.1: earned-visit → follow conversion for the week (rate null < 20 clicks).
  conversion: { profileClicks: number; followerDelta: number | null; rate: number | null };
  activity: { posts: number; replies: number; replyPct: number | null };
  topTweets: DigestTweet[];
  stageTransitions: Array<{ handle: string; stage: string }>;
  topFans: Array<{ handle: string; inbound: number; newThisWeek: boolean }>;
  neglected: { targets: string[]; allies: string[] };
  spend: { totalUsd: number; byPlatform: Array<{ platform: string; costUsd: number }> };
  quests: { daysAllDone: number; daysTracked: number };
  // M1 (ME.5): active goals with progress; null when there are none. Absent on
  // digests cached before this landed (same contract as rosterCoverage/S4).
  goals: DigestGoal[] | null;
  guidance: { reply: string | null; post: string | null };
  // S0.7: where this week's posted replies landed vs my 2–10x target band.
  rosterCoverage: RosterCoverage;
  // S4: the week's AI image spend + the media-vs-text lift the studio earns.
  imageSpendUsd: number;
  mediaVsText: MediaEffectiveness;
  // GR.9: the week graded 0–100. **null whenever the week can't honestly be
  // graded** — under the tracked-days gate, or on digests cached before this
  // landed (the rosterCoverage/S4 contract). Nulling the whole card rather than
  // just the score is deliberate: the narration is told to skip nulls, and a
  // card carrying component scores over a two-day week is exactly the confident
  // grade the gate exists to prevent.
  scorecard: DigestScorecard | null;
}

export function buildDigestFacts(i: DigestFactInputs): DigestFacts {
  const first = i.followerPoints[0] ?? null;
  const last = i.followerPoints.at(-1) ?? null;
  const followerDelta = first && last && first !== last ? last.followers - first.followers : null;
  const profileClicks = i.tweets.reduce((s, t) => s + (t.profileVisits ?? 0), 0);

  const replies = i.tweets.filter((t) => t.isReply).length;
  const posts = i.tweets.length - replies;

  const topTweets = [...i.tweets]
    .filter((t) => t.views !== null)
    .sort((a, b) => (b.views ?? 0) - (a.views ?? 0))
    .slice(0, DIGEST_TOP_TWEETS);

  const prevTop = new Set(
    [...i.fansPrevWeek]
      .sort((a, b) => b.inbound - a.inbound)
      .slice(0, DIGEST_TOP_FANS)
      .map((f) => f.handle),
  );
  const topFans = [...i.fansThisWeek]
    .sort((a, b) => b.inbound - a.inbound || a.handle.localeCompare(b.handle))
    .slice(0, DIGEST_TOP_FANS)
    .map((f) => ({ ...f, newThisWeek: !prevTop.has(f.handle) }));

  const totalUsd = Math.round(i.spendByPlatform.reduce((s, p) => s + p.costUsd, 0) * 1e5) / 1e5;

  const quests = {
    daysAllDone: i.streakDays.filter((d) => d.allDone).length,
    daysTracked: i.streakDays.length,
  };
  const replyPct = i.tweets.length === 0 ? null : Math.round((replies / i.tweets.length) * 100);

  // GR.9: graded from the numbers just derived, never from a second count of
  // the same rows (the conversionRate precedent) — the grade and the facts it
  // grades come out of one pass. `sufficient` alone isn't enough to publish:
  // a week where every component dropped out has a null score and nothing to say.
  const s = i.scorecardInputs;
  const card = computeScorecard({
    daysTracked: quests.daysTracked,
    daysAllDone: quests.daysAllDone,
    daysWithOriginal: s.daysWithOriginal,
    daysInWeek: s.daysInWeek,
    repliesPosted: replies,
    repliesTargetWeek: s.repliesTargetWeek,
    replyPct,
    targetReplyPct: s.targetReplyPct,
    goalVerdicts: s.goalVerdicts,
  });
  const scorecard: DigestScorecard | null =
    card.sufficient && card.score !== null
      ? {
          ...card,
          prevScore: s.prevScore,
          delta: s.prevScore === null ? null : card.score - s.prevScore,
        }
      : null;

  return {
    weekKey: i.weekKey,
    from: i.start.toISOString(),
    to: i.end.toISOString(),
    followers: {
      start: first?.followers ?? null,
      end: last?.followers ?? null,
      delta: followerDelta,
    },
    conversion: {
      profileClicks,
      followerDelta,
      rate: conversionRate(profileClicks, followerDelta),
    },
    activity: { posts, replies, replyPct },
    topTweets,
    stageTransitions: i.stageTransitions.map((s) => ({ handle: s.handle, stage: s.stage })),
    topFans,
    neglected: { targets: i.neglectedTargets, allies: i.neglectedAllies },
    spend: { totalUsd, byPlatform: i.spendByPlatform },
    quests,
    goals: i.goals,
    guidance: i.guidance,
    rosterCoverage: i.rosterCoverage,
    imageSpendUsd: i.imageSpendUsd,
    mediaVsText: i.mediaVsText,
    scorecard,
  };
}

// ----------------------------------------------------------------- prompt

export const DIGEST_SCHEMA = {
  type: 'object',
  properties: {
    narrative: {
      type: 'string',
      description: 'The Sunday digest, 150-220 words, second person, plain text paragraphs.',
    },
  },
  required: ['narrative'],
  additionalProperties: false,
} as const;

// Registry default (key `digest`, AI.6) — the static instruction prefix; the
// FACTS block substitutes at the {{FACTS}} tail so the prefix stays
// prompt-cacheable (same pattern as every other LLM prompt in this repo).
export const DIGEST_PROMPT_TEMPLATE = `You are my growth coach for X (Twitter). I'm a solopreneur building an audience by replying well, posting daily, and taking care of the people who reply back. Once a week you write me a short Sunday note about the week that just ended.

Write the digest in second person ("you"), 150-220 words, 2-4 short paragraphs, plain text (no markdown, no headings, no bullet lists, no emoji).

HARD RULES:
- Use ONLY what is inside the FACTS block. Every number and every @handle you mention must appear there verbatim. Never invent, estimate, round differently, or extrapolate. If a fact is null or a list is empty, silently skip it.
- Shape: what worked this week → who moved closer (the people) → ONE specific thing to change next week (pick it from the facts: a neglected person, a quest that kept missing, a guidance line).
- Tone: warm, direct, concrete. A coach who watched the week, not a report. No guilt, no scolding, no hype words, no exclamation marks.

Return JSON {"narrative": "..."} — nothing else.

FACTS:
{{FACTS}}`;

const FACTS_PLACEHOLDER = '{{FACTS}}';

// AI.6: `template` is the registry-loaded body (DB override or the default
// above). The facts JSON substitutes at {{FACTS}} — byte-identical to the old
// `${prefix}\n\nFACTS:\n${json}` concatenation when the default template runs.
// A custom override that dropped the token still gets the facts appended.
export function buildDigestInput(
  facts: DigestFacts,
  template: string = DIGEST_PROMPT_TEMPLATE,
): GrokMessage[] {
  const factsJson = JSON.stringify(facts, null, 1);
  const content = template.includes(FACTS_PLACEHOLDER)
    ? template.split(FACTS_PLACEHOLDER).join(factsJson)
    : `${template}\n\nFACTS:\n${factsJson}`;
  return [{ role: 'user', content }];
}

/** Strict structured outputs guarantee the shape; degrade odd output to null
 *  rather than storing a malformed narrative. */
export function parseDigestNarrative(raw: string): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const narrative = (parsed as Record<string, unknown>).narrative;
  if (typeof narrative !== 'string' || narrative.trim() === '') return null;
  return narrative.trim();
}
