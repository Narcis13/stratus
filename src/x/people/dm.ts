// DM drafting (Authoring 3.0 A3.9) — one grounded direct message for a person I
// already have real shared context with. Pure: no DB, no clock; the route loads
// the grounding (the same `renderIcebreakerGrounding` block the openers use —
// decision 8) and this module only shapes the prompt + parses the reply.
//
// The whole contract is decision 8's: the GROUNDING block is the model's entire
// world for this person and the prompt forbids referencing anything outside it,
// so a thin dossier can never let Grok improvise familiarity. The route refuses
// (422) before it ever gets here when there is nothing real to ground on.
//
// PURE module by construction: `prompts/registry.ts` imports DM_PROMPT_TEMPLATE
// as the `dm` key's default, so this file must never import from a route or from
// the registry (that would cycle — the RL.4 rule). The placeholder substitution
// is the same inline split/join `buildIcebreakerInput` uses, not `renderPrompt`.

import type { GrokMessage } from '../../grok/index.ts';

// Registry default (key `dm`, A3.9). Stable instruction prefix, with the
// language contract (decision 13) stated in the prefix so a Romanian idea in the
// tail never changes the cacheable prefix bytes. GROUNDING/PURPOSE/IDEA
// substitute at the tail — the prefix stays a shared cache prefix (§7.15).
export const DM_PROMPT_TEMPLATE = `You write direct messages for me on X (Twitter). About me, exactly this and nothing more: solopreneur; passionate about programming, AI and marketing; builds in public.

I want to send a DM to the person described in the GROUNDING block. Write exactly ONE direct message.

The PURPOSE and IDEA below may be written in any language (I often think in Romanian); your DM is ALWAYS natural English — translate the intent, never word-for-word.

HARD RULES:
- The GROUNDING block is everything I know about this person. Reference ONLY what is in it. Never imply I read, saw, or remember anything not listed. Never invent shared history, mutual friends, their work, numbers, or biography — theirs or mine.
- If the grounding is thin, stay general about THEM and concrete about the topic we share — never fake specificity or familiarity.
- 2 to 4 sentences. No links unless the IDEA supplies one. No flattery openers ("love your work"), no "long-time follower", no "quick question" cold-DM energy, no hashtags, no emoji.
- Sound like one human writing to another: casual, low-pressure, no ask bigger than a light question.

Return JSON {"dm": "..."} — nothing else.

PURPOSE (optional steer for this DM):
{{PURPOSE}}

IDEA (optional seed for what to say):
{{IDEA}}

GROUNDING:
{{GROUNDING}}`;

const GROUNDING_PLACEHOLDER = '{{GROUNDING}}';
const IDEA_PLACEHOLDER = '{{IDEA}}';
const PURPOSE_PLACEHOLDER = '{{PURPOSE}}';

// Sentinels for the absent optionals — the model still sees a labeled slot so it
// never treats a missing steer as an instruction to omit.
const NO_IDEA = '(none — react to something concrete in the grounding)';
const NO_PURPOSE = '(none — a warm, low-pressure check-in)';

export const DM_SCHEMA = {
  type: 'object',
  properties: {
    dm: {
      type: 'string',
      description:
        'The direct message: 2–4 sentences, natural English, grounded only on the GROUNDING block.',
    },
  },
  required: ['dm'],
  additionalProperties: false,
} as const;

// `template` is the registry-loaded body (DB override or the default above). The
// grounding/idea/purpose substitute token-tolerantly; a token-less custom
// override still gets the grounding appended (icebreaker precedent). Byte-
// identical prefix regardless of the tail values — the language clause lives in
// the prefix, so a Romanian idea never shifts the cacheable bytes.
export function buildDmPrompt(
  grounding: string,
  idea: string | null,
  purpose: string | null,
  template: string = DM_PROMPT_TEMPLATE,
): GrokMessage[] {
  const ideaText = idea?.trim() ? idea.trim() : NO_IDEA;
  const purposeText = purpose?.trim() ? purpose.trim() : NO_PURPOSE;

  let content = template;
  if (content.includes(PURPOSE_PLACEHOLDER)) {
    content = content.split(PURPOSE_PLACEHOLDER).join(purposeText);
  }
  if (content.includes(IDEA_PLACEHOLDER)) {
    content = content.split(IDEA_PLACEHOLDER).join(ideaText);
  }
  content = content.includes(GROUNDING_PLACEHOLDER)
    ? content.split(GROUNDING_PLACEHOLDER).join(grounding)
    : `${content}\n\nGROUNDING:\n${grounding}`;

  return [{ role: 'user', content }];
}

export function parseDm(raw: string): { dm: string } | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const v = parsed as Record<string, unknown>;
  const dm = typeof v.dm === 'string' ? v.dm.trim() : '';
  if (dm === '') return null;
  return { dm };
}
