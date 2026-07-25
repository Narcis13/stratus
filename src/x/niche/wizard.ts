// Niche wizard (N0.8) — turns a pasted prose self-description into a complete
// PROPOSED niche: identity (persona/beliefs/replyPersona/description) + the
// output taxonomy (3 pillars) + the input taxonomy (≤5 channels). One Grok
// structured-outputs call behind `POST /x/niche/draft`; the proposal is NEVER
// persisted here — the extension reviews/edits it, then saves through the CRUD
// routes (the `POST /x/pillars/draft` contract). This module is pure: schema,
// prompt builder, and a lenient parser. The in-prompt EXAMPLE is the built-in
// `builder` niche (DEFAULT_NICHE + DEFAULT_PILLARS) so the model has a concrete,
// well-formed shape to match. The user's description sits at the variable TAIL
// (§7.15) — the instruction+example block is a stable cacheable prefix.

import type { GrokMessage } from '../../grok/index.ts';
import { DEFAULT_PILLARS } from '../posts/pillars.ts';
import { DEFAULT_NICHE, isValidNicheSlug } from './defaults.ts';

export interface NichePillarProposal {
  slug: string;
  label: string;
  body: string;
}

export interface NicheChannelProposal {
  slug: string;
  label: string;
  keywords: string[];
}

export interface NicheProposal {
  slug: string;
  label: string;
  description: string;
  persona: string;
  beliefs: string;
  replyPersona: string;
  pillars: NichePillarProposal[];
  channels: NicheChannelProposal[];
}

// Same length ceilings the CRUD routes enforce (niche.ts LABEL_MAX / TEXT_MAX,
// pillars.ts) — a proposal that clears these round-trips through create without
// a validation 400. Grok at ~2500 output tokens stays well under, but a runaway
// field is rejected rather than shipped.
const LABEL_MAX = 120;
const TEXT_MAX = 10000;
const MAX_CHANNELS = 5;
const MAX_KEYWORDS = 12;

export const NICHE_WIZARD_SCHEMA = {
  type: 'object',
  properties: {
    slug: {
      type: 'string',
      description: 'kebab-case slug for the whole niche, 2-41 chars, e.g. "nutrition".',
    },
    label: {
      type: 'string',
      description:
        'Short human name for the niche, e.g. "Evidence-based nutrition". Under 120 chars.',
    },
    description: {
      type: 'string',
      description:
        'A prose self-description of this niche and voice (3-6 sentences): who they are, what they build or share, the recurring themes, and the unspoken rule they operate from.',
    },
    persona: {
      type: 'string',
      description:
        'The post-prompt "who I am" grounding: a bulleted biography of concrete, reusable facts (background, work, the unfair angle only this person has), ending with an explicit "these facts are the ONLY biography you may use — never invent" clause. Match the EXAMPLE persona in shape, depth and honesty.',
    },
    beliefs: {
      type: 'string',
      description:
        'The post-prompt "what I believe": a short intro, then a bulleted list of active stances this voice argues from, then one honest tension they own. Match the EXAMPLE beliefs in shape.',
    },
    replyPersona: {
      type: 'string',
      description:
        'The reply-prompt short "who I am": just 2-4 inferable identity facts as bullets, then a "that is the entire biography — never invent" clause. Much shorter than persona.',
    },
    pillars: {
      type: 'array',
      description:
        'EXACTLY 3 content pillars — the output taxonomy the post drafter writes against.',
      items: {
        type: 'object',
        properties: {
          slug: { type: 'string', description: 'kebab-case pillar slug, 2-41 chars.' },
          label: { type: 'string', description: 'Short heading in the form "Name — the ANGLE".' },
          body: {
            type: 'string',
            description:
              "One paragraph of drafter guidance: the angle, why only this person can write it, the dominant register, one concrete do and one don't.",
          },
        },
        required: ['slug', 'label', 'body'],
        additionalProperties: false,
      },
    },
    channels: {
      type: 'array',
      description:
        'Up to 5 channels — the input taxonomy (topic rooms) this niche watches and files people, tweets and ideas under.',
      items: {
        type: 'object',
        properties: {
          slug: { type: 'string', description: 'kebab-case channel slug, 2-41 chars.' },
          label: { type: 'string', description: 'Short channel name.' },
          keywords: {
            type: 'array',
            items: { type: 'string' },
            description:
              'A handful of lowercase keywords/phrases that route a tweet or idea into this channel.',
          },
        },
        required: ['slug', 'label', 'keywords'],
        additionalProperties: false,
      },
    },
  },
  required: [
    'slug',
    'label',
    'description',
    'persona',
    'beliefs',
    'replyPersona',
    'pillars',
    'channels',
  ],
  additionalProperties: false,
} as const;

const ANATOMY = `A "niche" is a complete X (Twitter) identity + strategy container. It has:
- slug: a short kebab-case id for the niche itself (e.g. nutrition).
- label: a short human name for it.
- description: a prose self-description of the person and their voice.
- persona: the post-drafter grounding — WHO I am, as a bulleted list of concrete biographical facts plus the "unfair angle" only this person has, ending with a clause forbidding invention beyond those facts.
- beliefs: WHAT I believe — the judgment and stances the voice argues from, plus one honest tension the person owns.
- replyPersona: a much shorter "who I am" for replies — 2-4 inferable identity facts only, with a hard "never invent biography" clause.
- pillars: EXACTLY 3 recurring themes the post drafter writes against (the output taxonomy). Each has a slug, a label "Name — the ANGLE", and one paragraph of drafter guidance (angle, why only me, dominant register, one do + one don't).
- channels: up to 5 shallow topic rooms (the input taxonomy) for filing tweets/people/ideas, each with a slug, a label, and a few routing keywords.`;

export function buildNicheWizardInput(description: string): GrokMessage[] {
  const pillarsExample = DEFAULT_PILLARS.map((p) => `**${p.slug}** — ${p.label}\n${p.body}`).join(
    '\n\n',
  );

  const content = `You design a complete niche for someone's X (Twitter) presence from a prose self-description they paste. Return the structured JSON only.

${ANATOMY}

Below is a COMPLETE, well-formed example niche — the built-in "builder" niche. Match its shape, depth, and honesty, but write entirely for the NEW person described at the very end. Do NOT copy its biography, pillars, or channels.

=== EXAMPLE NICHE ===
slug: ${DEFAULT_NICHE.slug}
label: ${DEFAULT_NICHE.label}
description:
${DEFAULT_NICHE.description}

persona:
${DEFAULT_NICHE.persona}

beliefs:
${DEFAULT_NICHE.beliefs}

replyPersona:
${DEFAULT_NICHE.replyPersona}

pillars (exactly 3):
${pillarsExample}

channels (up to 5): ai-agents, indie-hacking, romania-tech, marketing, tools
=== END EXAMPLE ===

Rules:
- Propose EXACTLY 3 pillars and up to 5 channels. All slugs kebab-case, distinct.
- Ground everything in the description. If it is thin, keep persona/replyPersona facts modest and honest — a fabricated fact is worse than a missing one. Never invent biography the description doesn't support.
- The description may be in another language (Romanian is common); write the niche in English.

Now design the niche for THIS person:
${description}`;

  return [{ role: 'user', content }];
}

// Coerce a slug to kebab-case; return null if it still can't be salvaged. The
// NICHE_SLUG_RE and PILLAR_SLUG_RE are the same value, so one helper covers the
// niche, pillar, and channel slugs.
function coerceSlug(raw: unknown): string | null {
  let s = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  if (!isValidNicheSlug(s)) {
    s = s
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 41);
  }
  return isValidNicheSlug(s) ? s : null;
}

const str = (x: unknown): string => (typeof x === 'string' ? x.trim() : '');

// Strict structured outputs guarantee the shape, but degrade a truncated / odd
// response to null rather than a malformed proposal. Hard requirements (bad
// niche slug, empty required text, pillar count ≠ 3, over-length, junk JSON) →
// null; a single malformed CHANNEL is dropped, not fatal (they're optional and
// the user reviews the rest).
export function parseNicheProposal(raw: string): NicheProposal | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const v = parsed as Record<string, unknown>;

  const slug = coerceSlug(v.slug);
  if (!slug) return null;

  const label = str(v.label);
  const persona = str(v.persona);
  const beliefs = str(v.beliefs);
  const replyPersona = str(v.replyPersona);
  const description = str(v.description);
  if (label === '' || persona === '' || beliefs === '' || replyPersona === '') return null;
  if (label.length > LABEL_MAX) return null;
  if ([persona, beliefs, replyPersona, description].some((t) => t.length > TEXT_MAX)) return null;

  if (!Array.isArray(v.pillars) || v.pillars.length !== 3) return null;
  const pillars: NichePillarProposal[] = [];
  for (const p of v.pillars) {
    if (!p || typeof p !== 'object' || Array.isArray(p)) return null;
    const pp = p as Record<string, unknown>;
    const ps = coerceSlug(pp.slug);
    const pl = str(pp.label);
    const pb = str(pp.body);
    if (!ps || pl === '' || pb === '' || pl.length > LABEL_MAX) return null;
    pillars.push({ slug: ps, label: pl, body: pb });
  }
  // A slug collision would 409 on the second create — reject the whole proposal.
  if (new Set(pillars.map((p) => p.slug)).size !== pillars.length) return null;

  const channels: NicheChannelProposal[] = [];
  if (v.channels !== undefined) {
    if (!Array.isArray(v.channels)) return null;
    for (const ch of v.channels) {
      if (channels.length >= MAX_CHANNELS) break;
      if (!ch || typeof ch !== 'object' || Array.isArray(ch)) continue;
      const cc = ch as Record<string, unknown>;
      const cs = coerceSlug(cc.slug);
      const cl = str(cc.label);
      if (!cs || cl === '' || cl.length > LABEL_MAX) continue;
      if (channels.some((x) => x.slug === cs)) continue;
      const keywords = Array.isArray(cc.keywords)
        ? [
            ...new Set(
              cc.keywords
                .filter((k): k is string => typeof k === 'string')
                .map((k) => k.trim().toLowerCase())
                .filter((k) => k !== ''),
            ),
          ].slice(0, MAX_KEYWORDS)
        : [];
      channels.push({ slug: cs, label: cl, keywords });
    }
  }

  return { slug, label, description, persona, beliefs, replyPersona, pillars, channels };
}
