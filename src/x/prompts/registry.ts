// Prompt registry (AI.3) — the one catalog of editable LLM prompts. Each key
// maps a shipped default (the byte-synced TS template literals stay the source
// of truth, §7.14) to an optional DB override row in `prompt_overrides`:
// row absent = default applies, restore = DELETE (override-rows-only storage —
// a default improved in a later deploy applies automatically unless the user
// overrode it, and "customized" is structural row-presence, never a diff).
//
// Placeholder contract: `required` tokens must survive an edit (the render
// call sites substitute them — an override missing one silently drops that
// content, so the editor refuses the save); `optional` tokens are known and
// substituted token-tolerantly when present (the niche persona family — an
// override that hardcodes its own persona is sanctioned, it just stops
// following niche switches). Anything else matching {{A_Z}} is unknown: a
// warning, not an error.
//
// Later AI-layer tasks append keys (thread, rewrite, ideas, digest,
// icebreaker) — add the spec here plus a call-site `loadPromptSafe` wire;
// nothing else changes. Defaults must come from PURE modules only — importing
// a route file from here cycles (routes → registry → templates, AI.5's
// voice/extractPrompt.ts move exists exactly for that reason).

import { eq } from 'drizzle-orm';
import { db } from '../../db/client.ts';
import { promptOverrides } from '../db/schema.ts';
import { DIGEST_PROMPT_TEMPLATE } from '../digest.ts';
import { ICEBREAKER_PROMPT_TEMPLATE } from '../people/icebreakers.ts';
import { PILLAR_DRAFT_TEMPLATE } from '../posts/pillarDraft.ts';
import { POST_PROMPT_TEMPLATE } from '../posts/prompt.ts';
import { REPLY_BATCH_PROMPT_TEMPLATE, REPLY_PROMPT_TEMPLATE } from '../replies/prompt.ts';
import { EXTRACT_PROMPT_TEMPLATE } from '../voice/extractPrompt.ts';

export const PROMPT_KEYS = [
  'reply',
  'reply-batch',
  'post',
  'voice-extract',
  'pillar-draft',
  'digest',
  'icebreaker',
] as const;
export type PromptKey = (typeof PROMPT_KEYS)[number];

export function isPromptKey(value: unknown): value is PromptKey {
  return typeof value === 'string' && (PROMPT_KEYS as readonly string[]).includes(value);
}

export interface PromptSpec {
  name: string;
  description: string;
  defaultBody: string;
  /** Placeholders an override must keep — the render contract. */
  required: string[];
  /** Known placeholders an override may drop (token-tolerant substitution). */
  optional: string[];
}

export const PROMPT_SPECS: Record<PromptKey, PromptSpec> = {
  reply: {
    name: 'Reply drafts',
    description:
      'The Reply Master prompt behind POST /x/replies/generate — three angle variants per tweet.',
    defaultBody: REPLY_PROMPT_TEMPLATE,
    required: ['{{TWEET_CONTEXT}}', '{{IDEA}}'],
    optional: ['{{REPLY_PERSONA}}'],
  },
  'reply-batch': {
    name: 'Reply drafts (batch)',
    description:
      'The Radar batch prompt behind POST /x/replies/generate-batch — three angle variants for each queued tweet in one call.',
    defaultBody: REPLY_BATCH_PROMPT_TEMPLATE,
    required: ['{{POSTS}}', '{{IDEA}}'],
    optional: ['{{REPLY_PERSONA}}'],
  },
  post: {
    name: 'Post drafts',
    description:
      'The original-post drafter prompt behind POST /x/posts/draft and /x/posts/reup — three register-distinct drafts.',
    defaultBody: POST_PROMPT_TEMPLATE,
    required: ['{{PILLARS}}', '{{MY_WINNERS}}', '{{REMIX}}', '{{PILLAR}}', '{{IDEA}}'],
    optional: ['{{PERSONA}}', '{{BELIEFS}}'],
  },
  'voice-extract': {
    name: 'Template extraction',
    description:
      'The structure-extraction prompt behind voice-tweet extract and playbook extract-winners — distills a post into a reusable skeleton.',
    defaultBody: EXTRACT_PROMPT_TEMPLATE,
    required: ['{{TWEET_TEXT}}'],
    optional: [],
  },
  'pillar-draft': {
    name: 'Pillar drafting',
    description:
      'The meta-prompt behind POST /x/pillars/draft — proposes a new content pillar or tweaks an existing one.',
    defaultBody: PILLAR_DRAFT_TEMPLATE,
    required: ['{{EXISTING_PILLARS}}', '{{JOB}}'],
    optional: ['{{PERSONA}}'],
  },
  digest: {
    name: 'Sunday digest',
    description:
      'The weekly coach narration behind GET /x/digest — narrates the FACTS block in the coach voice, never inventing beyond it.',
    defaultBody: DIGEST_PROMPT_TEMPLATE,
    required: ['{{FACTS}}'],
    optional: [],
  },
  icebreaker: {
    name: 'Icebreakers',
    description:
      'The opener prompt behind POST /x/people/:handle/icebreakers — two conversation starters grounded strictly on real shared context.',
    defaultBody: ICEBREAKER_PROMPT_TEMPLATE,
    required: ['{{GROUNDING}}'],
    optional: [],
  },
};

export interface LoadedPrompt {
  body: string;
  customized: boolean;
  /** Prefix-cache bucket for this exact body — a customized prompt must never
   *  share a cached prefix with the default. Call sites append their own
   *  variable suffixes (the niche `:slug:updatedAtMs` from N0.3/N0.4). */
  cacheKey: string;
}

export function promptCacheKey(key: PromptKey, body: string): string {
  const sha = new Bun.CryptoHasher('sha256').update(body).digest('hex');
  return `stratus-x-${key}:${sha.slice(0, 8)}`;
}

export function loadPrompt(key: PromptKey): LoadedPrompt {
  const row = db.select().from(promptOverrides).where(eq(promptOverrides.key, key)).get();
  const body = row?.body ?? PROMPT_SPECS[key].defaultBody;
  return { body, customized: row !== undefined, cacheKey: promptCacheKey(key, body) };
}

// §7.8 (loadActiveNicheSafe discipline): a prompt-layer read must never fail a
// serving path — on any error the shipped default grounds the draft.
export function loadPromptSafe(key: PromptKey): LoadedPrompt {
  try {
    return loadPrompt(key);
  } catch (err) {
    console.error(
      `prompts: loadPrompt(${key}) failed, using default:`,
      err instanceof Error ? err.message : err,
    );
    const body = PROMPT_SPECS[key].defaultBody;
    return { body, customized: false, cacheKey: promptCacheKey(key, body) };
  }
}

const PLACEHOLDER_RE = /\{\{[A-Z_]+\}\}/g;

export interface PromptValidation {
  ok: boolean;
  missing: string[];
  unknown: string[];
}

export function validatePromptBody(key: PromptKey, body: string): PromptValidation {
  const spec = PROMPT_SPECS[key];
  const missing = spec.required.filter((token) => !body.includes(token));
  const known = new Set([...spec.required, ...spec.optional]);
  const unknown = [...new Set(body.match(PLACEHOLDER_RE) ?? [])].filter((t) => !known.has(t));
  return { ok: missing.length === 0, missing, unknown };
}

// split/join (not replace) so '$' in a value can't trigger
// String.prototype.replace's special replacement patterns.
export function renderPrompt(body: string, vars: Record<string, string>): string {
  let out = body;
  for (const [name, value] of Object.entries(vars)) {
    out = out.split(`{{${name}}}`).join(value);
  }
  return out;
}
