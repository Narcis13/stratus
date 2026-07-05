// Icebreakers (CIRCLES-PLAN C9): two conversation starters grounded STRICTLY
// on real shared context — their saved tweets, channel overlap, past
// exchanges, my notes. Pure — no DB, no clock reads; the route loads the rows.
//
// No fabricated familiarity is the whole contract: the grounding block is the
// model's entire world for this person, and the prompt forbids referencing
// anything outside it. When there is nothing real to ground on, the renderer
// returns null and the route refuses (422) instead of letting Grok improvise.

import type { GrokMessage } from '../../grok/index.ts';
import type { Stage } from './stage.ts';

export const MAX_GROUNDING_EXCHANGES = 8;
export const MAX_GROUNDING_TWEETS = 5;

export interface GroundingExchange {
  direction: 'inbound' | 'outbound';
  at: Date;
  summary: string;
}

export interface IcebreakerGroundingInputs {
  handle: string;
  displayName: string | null;
  stage: Stage;
  bio: string | null;
  notes: string | null;
  /** Timeline events that carry a summary, newest first. */
  exchanges: GroundingExchange[];
  /** Their tweets I saved to the voice library, newest first. */
  savedTweets: Array<{ text: string; createdAt: Date | null }>;
  /** Channel slugs we share (their tags ∩ my channels). */
  sharedChannels: string[];
}

/** Render the grounding block, or null when there is no real shared context —
 *  a stage chip alone is not something to open a conversation with. */
export function renderIcebreakerGrounding(g: IcebreakerGroundingInputs, now: Date): string | null {
  const hasMaterial =
    g.exchanges.length > 0 ||
    g.savedTweets.length > 0 ||
    (g.notes?.trim() ?? '') !== '' ||
    (g.bio?.trim() ?? '') !== '';
  if (!hasMaterial) return null;

  const lines: string[] = [
    `PERSON: @${g.handle}${g.displayName ? ` (${g.displayName})` : ''} — relationship stage: ${g.stage}.`,
  ];
  const bio = g.bio?.trim();
  if (bio) lines.push(`THEIR BIO: ${oneLine(bio, 280)}`);
  const notes = g.notes?.trim();
  if (notes) lines.push(`MY NOTES ON THEM (verbatim): ${oneLine(notes, 500)}`);
  if (g.sharedChannels.length > 0) {
    lines.push(`TOPICS WE SHARE (my channels they're filed under): ${g.sharedChannels.join(', ')}`);
  }
  if (g.exchanges.length > 0) {
    lines.push('PAST EXCHANGES (newest first):');
    for (const e of g.exchanges.slice(0, MAX_GROUNDING_EXCHANGES)) {
      const who = e.direction === 'outbound' ? 'me → them' : 'them → me';
      lines.push(`- ${who}, ${ago(e.at, now)}: ${oneLine(e.summary, 200)}`);
    }
  }
  if (g.savedTweets.length > 0) {
    lines.push('THEIR TWEETS I SAVED (I genuinely rated these):');
    for (const t of g.savedTweets.slice(0, MAX_GROUNDING_TWEETS)) {
      lines.push(`- "${oneLine(t.text, 240)}"`);
    }
  }
  return lines.join('\n');
}

// ----------------------------------------------------------------- prompt

export const ICEBREAKER_SCHEMA = {
  type: 'object',
  properties: {
    reply: {
      type: 'string',
      description:
        'Reply-style opener: something I could post under one of their tweets. Max 280 chars.',
    },
    dm: {
      type: 'string',
      description: 'DM-style opener: short, low-pressure direct message. Max 280 chars.',
    },
  },
  required: ['reply', 'dm'],
  additionalProperties: false,
} as const;

// Static prefix (cacheable); the grounding block rides at the variable tail.
const ICEBREAKER_INSTRUCTIONS = `You write conversation openers for me on X (Twitter). About me, exactly this and nothing more: solopreneur; passionate about programming, AI and marketing; builds in public.

I want to warm up a relationship with the person described in the GROUNDING block. Propose exactly two openers:
- "reply": a reply-style opener I could post under one of their tweets — react to something concrete from the grounding.
- "dm": a DM-style opener — short, casual, low-pressure, no ask bigger than a question.

HARD RULES:
- The GROUNDING block is everything I know about this person. Reference ONLY what is in it. Never imply I read, saw, or remember anything not listed. Never invent shared history, mutual friends, their work, numbers, or biography — theirs or mine.
- If the grounding is thin, stay general about THEM and concrete about the topic we share — never fake specificity.
- No flattery openers ("love your work"), no "long-time follower", no "quick question" cold-DM energy, no hashtags, no emoji.
- Each opener under 280 characters, in English, sounding like one human to another.

Return JSON {"reply": "...", "dm": "..."} — nothing else.`;

export function buildIcebreakerInput(grounding: string): GrokMessage[] {
  return [{ role: 'user', content: `${ICEBREAKER_INSTRUCTIONS}\n\nGROUNDING:\n${grounding}` }];
}

export interface Icebreakers {
  reply: string;
  dm: string;
}

export function parseIcebreakers(raw: string): Icebreakers | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const v = parsed as Record<string, unknown>;
  const reply = typeof v.reply === 'string' ? v.reply.trim() : '';
  const dm = typeof v.dm === 'string' ? v.dm.trim() : '';
  if (reply === '' || dm === '') return null;
  return { reply, dm };
}

// ---------------------------------------------------------------- helpers

function oneLine(text: string, max: number): string {
  const collapsed = text.replace(/\s+/g, ' ').trim();
  return collapsed.length <= max ? collapsed : `${collapsed.slice(0, max - 1)}…`;
}

function ago(at: Date, now: Date): string {
  const min = Math.max(0, (now.getTime() - at.getTime()) / 60_000);
  if (min < 60) return `${Math.round(min)}m ago`;
  if (min < 24 * 60) return `${Math.floor(min / 60)}h ago`;
  const day = Math.floor(min / 1440);
  if (day < 30) return `${day}d ago`;
  return `${Math.floor(day / 30)}mo ago`;
}
