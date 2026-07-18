// Grok meta-prompt for drafting a NEW content pillar or tweaking an existing
// one (POST /x/pillars/draft, §8.6). The model returns a {slug,label,body}
// proposal — never persisted here; the user reviews/edits it in the extension
// and saves through the CRUD routes. Grounded on the active niche's persona +
// the existing active pillars so a new pillar fits the voice and doesn't overlap.

import type { GrokMessage } from '../../grok/index.ts';
import { DEFAULT_NICHE } from '../niche/defaults.ts';
import { type PillarDef, isValidPillarSlug, renderPillars } from './pillars.ts';

export interface PillarProposal {
  slug: string;
  label: string;
  body: string;
}

export const PILLAR_DRAFT_SCHEMA = {
  type: 'object',
  properties: {
    slug: {
      type: 'string',
      description:
        'kebab-case slug, 2-41 chars, e.g. "ai-craft". For a tweak, keep the given slug.',
    },
    label: {
      type: 'string',
      description: 'Short heading: "Name — the ANGLE", roughly under 60 chars.',
    },
    body: {
      type: 'string',
      description:
        "One paragraph (2-5 sentences) of guidance for the post drafter: the angle, why only I can write it, the dominant register, one concrete do and one don't.",
    },
  },
  required: ['slug', 'label', 'body'],
  additionalProperties: false,
} as const;

const FORMAT_RULES = `What a content pillar is here: a recurring theme the post drafter writes against. Each pillar has:
- slug: a short kebab-case id (e.g. ai-craft).
- label: a short heading in the form "Name — the ANGLE".
- body: ONE paragraph of guidance telling the drafter how to write this pillar — the angle, "why only me" (the unfair edge), the dominant register (plain / spicy / reflective), one concrete do and one don't. Specific > abstract. No fabricated biography beyond the persona above.`;

export interface BuildPillarDraftOptions {
  mode: 'new' | 'tweak';
  existing: PillarDef[];
  /** Persona grounding from the active niche (N0.3) — the route passes
   *  niche.persona (+ description when present). Defaults to the builder niche
   *  so the proposal is never persona-less. Inventing beyond it is forbidden. */
  persona?: string;
  /** Optional Romanian-or-English steer. */
  idea?: string;
  /** Tweak only: the pillar being revised + the change to make. */
  target?: PillarDef;
  instruction?: string;
}

export function buildPillarDraftInput(opts: BuildPillarDraftOptions): GrokMessage[] {
  const existingBlock = opts.existing.length > 0 ? renderPillars(opts.existing) : '(none yet)';

  let job: string;
  if (opts.mode === 'tweak' && opts.target) {
    job = `Revise this existing content pillar. Keep its slug exactly as "${opts.target.slug}". Apply the change requested, keep the house style, and don't drift into another pillar's territory.

PILLAR TO REVISE:
**${opts.target.slug}** — ${opts.target.label}
${opts.target.body}

CHANGE REQUESTED:
${opts.instruction?.trim() || opts.idea?.trim() || 'Sharpen and tighten it; make it more specific and opinionated.'}`;
  } else {
    job = `Propose ONE new content pillar that complements — never duplicates — the existing ones below. Pick a fresh, distinct angle rooted in the persona. Invent a new kebab-case slug that doesn't collide with the existing slugs.${
      opts.idea?.trim()
        ? `\n\nSTEER (may be Romanian — translate the intent):\n${opts.idea.trim()}`
        : ''
    }`;
  }

  const content = `You help maintain the content pillars for my X (Twitter) posting.

${opts.persona ?? DEFAULT_NICHE.persona}

${FORMAT_RULES}

EXISTING PILLARS:
${existingBlock}

## Your job
${job}

Return JSON {"slug": "...", "label": "...", "body": "..."} — nothing else.`;

  return [{ role: 'user', content }];
}

// Strict structured outputs guarantee the shape, but degrade a truncated/odd
// body to null rather than a malformed proposal. `forceSlug` (tweak) overrides
// whatever the model returned so a rename can't slip through.
export function parsePillarProposal(raw: string, forceSlug?: string): PillarProposal | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const v = parsed as Record<string, unknown>;
  const label = typeof v.label === 'string' ? v.label.trim() : '';
  const body = typeof v.body === 'string' ? v.body.trim() : '';
  if (label === '' || body === '') return null;

  let slug = forceSlug ?? (typeof v.slug === 'string' ? v.slug.trim().toLowerCase() : '');
  // Coerce a near-miss slug (spaces/underscores) into kebab-case before giving up.
  if (!isValidPillarSlug(slug)) {
    slug = slug
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 41);
  }
  if (!isValidPillarSlug(slug)) return null;
  return { slug, label, body };
}
