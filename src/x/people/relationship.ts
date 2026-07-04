// Relationship-aware reply drafting (CIRCLES-PLAN C3): render what the people
// layer knows about a reply target as an optional prompt block. Pure — no DB,
// no clock reads (callers pass `now`); the facts loader lives in store.ts.
//
// The block is injected at the VARIABLE TAIL of the reply prompt (same pattern
// as the §8.6 pillars opt-in): reply prompt.md / REPLY_PROMPT_TEMPLATE stay
// byte-identical and their sync test untouched. The drafting instruction lives
// INSIDE the rendered block, never in the static cacheable prefix.

import type { AngleCell } from './angles.ts';
import type { Stage } from './stage.ts';

export const RELATIONSHIP_INSTRUCTION =
  'Use this as context and continuity — reference the running thread naturally if it fits; never recite it.';

// Same min-sample discipline as the BAND recalibration gate: an angle
// preference measured on fewer than 3 posted+measured replies is noise.
export const MIN_MEASURED_FOR_ANGLE_PREFERENCE = 3;

export interface ExchangeSummary {
  at: Date;
  summary: string;
}

export interface AnglePreference {
  angle: string;
  /** Measured replies shipped with this angle. */
  measured: number;
  /** Measured replies to this person across all angles (the gate input). */
  totalMeasured: number;
  medianViews: number | null;
  medianProfileVisits: number | null;
}

export interface RelationshipFacts {
  handle: string;
  stage: Stage;
  /** Total timeline events — a facts object only exists when ≥1. */
  eventCount: number;
  /** their_mention + their_reply_to_me events. */
  inboundCount: number;
  /** my_reply events. */
  outboundCount: number;
  /** Most recent outbound event that carries a summary (the topic line). */
  lastOutbound: ExchangeSummary | null;
  /** Most recent inbound event that carries a summary. */
  lastInbound: ExchangeSummary | null;
  /** Already gated: null unless ≥MIN_MEASURED_FOR_ANGLE_PREFERENCE measured. */
  anglePreference: AnglePreference | null;
  /** people.notes — rendered verbatim (human-written context wins). */
  notes: string | null;
}

/** Gate + pick: null under the min sample; otherwise the angle whose measured
 *  replies earned the best median profile visits (views break ties — profile
 *  visits are the follow-precursor and often null on small samples). */
export function pickAnglePreference(
  cells: AngleCell[],
  minMeasured = MIN_MEASURED_FOR_ANGLE_PREFERENCE,
): AnglePreference | null {
  const totalMeasured = cells.reduce((n, c) => n + c.measured, 0);
  if (totalMeasured < minMeasured) return null;
  const ranked = cells
    .filter((c): c is AngleCell & { angle: string } => c.angle !== null && c.measured > 0)
    .sort(
      (a, b) =>
        (b.medianProfileVisits ?? -1) - (a.medianProfileVisits ?? -1) ||
        (b.medianViews ?? -1) - (a.medianViews ?? -1) ||
        b.measured - a.measured,
    );
  const best = ranked[0];
  if (!best) return null;
  return {
    angle: best.angle,
    measured: best.measured,
    totalMeasured,
    medianViews: best.medianViews,
    medianProfileVisits: best.medianProfileVisits,
  };
}

/** Full block for the single-reply path. Empty string when there is nothing
 *  to say (no facts / no events) — callers skip injection on ''. */
export function renderRelationship(facts: RelationshipFacts | null, now: Date): string {
  if (!facts || facts.eventCount === 0) return '';
  const lines = [
    `## My history with @${facts.handle} (context, not content)`,
    '',
    RELATIONSHIP_INSTRUCTION,
    '',
    `- ${stageLine(facts)}`,
  ];
  const last = lastExchangeLine(facts, now);
  if (last) lines.push(`- ${last}`);
  if (facts.anglePreference) lines.push(`- ${angleLine(facts.anglePreference)}`);
  const notes = facts.notes?.trim();
  if (notes) lines.push(`- My notes on them (verbatim): ${notes}`);
  return lines.join('\n');
}

/** Batch path: same facts, capped to 2 lines/person to protect the token
 *  budget (the shared instruction rides once per batch, in prompt.ts). */
export function renderRelationshipBrief(facts: RelationshipFacts | null, now: Date): string {
  if (!facts || facts.eventCount === 0) return '';
  let first = `RELATIONSHIP: ${stageLine(facts)}`;
  if (facts.anglePreference) {
    const p = facts.anglePreference;
    first += ` Best angle so far: ${p.angle} (${p.measured}/${p.totalMeasured} measured).`;
  }
  const parts: string[] = [];
  const last = facts.lastOutbound ?? facts.lastInbound;
  if (last) {
    const who = last === facts.lastOutbound ? 'my reply' : 'their reply';
    parts.push(`Last exchange (${who}, ${ago(last.at, now)}): ${oneLine(last.summary)}`);
  }
  const notes = facts.notes?.trim();
  if (notes) parts.push(`Notes: ${oneLine(notes)}`);
  return parts.length > 0 ? `${first}\n${parts.join(' ')}` : first;
}

function stageLine(f: RelationshipFacts): string {
  const exchanges = f.inboundCount + f.outboundCount;
  if (exchanges === 0) {
    return `Stage: ${f.stage} — no direct exchanges yet (I've been tracking their posts).`;
  }
  return (
    `Stage: ${f.stage} — ${exchanges} prior exchange${exchanges === 1 ? '' : 's'} ` +
    `(my replies: ${f.outboundCount}, their replies/mentions back: ${f.inboundCount}).`
  );
}

function lastExchangeLine(f: RelationshipFacts, now: Date): string | null {
  const parts: string[] = [];
  if (f.lastOutbound) {
    parts.push(
      `my last reply (${ago(f.lastOutbound.at, now)}): ${oneLine(f.lastOutbound.summary)}`,
    );
  }
  if (f.lastInbound) {
    parts.push(`their last (${ago(f.lastInbound.at, now)}): ${oneLine(f.lastInbound.summary)}`);
  }
  return parts.length > 0 ? `Last exchange — ${parts.join('; ')}` : null;
}

function angleLine(p: AnglePreference): string {
  const views = p.medianViews !== null ? `, median ${p.medianViews} views` : '';
  return (
    `Measured angle preference: '${p.angle}' lands best with them ` +
    `(${p.measured} of ${p.totalMeasured} measured replies${views}).`
  );
}

// Event summaries are already snippet()-capped at write time; this is a
// belt-and-suspenders clamp for notes and any uncapped source.
function oneLine(text: string, max = 140): string {
  const collapsed = text.replace(/\s+/g, ' ').trim();
  return collapsed.length <= max ? collapsed : `${collapsed.slice(0, max - 1)}…`;
}

function ago(at: Date, now: Date): string {
  const diffMs = now.getTime() - at.getTime();
  if (diffMs < 60_000) return 'just now';
  const min = Math.floor(diffMs / 60_000);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day}d ago`;
  return `${Math.floor(day / 30)}mo ago`;
}
