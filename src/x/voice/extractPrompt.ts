// Pure template-extraction prompt pieces (§8.3), shared by the voice-tweet
// extract routes (routes/voiceExtract.ts) and the C4 own-winner extraction
// (routes/playbook.ts) — one prompt, one schema, one output cap, so the two
// extract paths can never drift.
//
// Moved out of routes/voiceExtract.ts at AI.5: the prompt registry needs the
// default template, and a registry → route-file import would cycle with the
// route's registry import (routes → registry → templates, never the reverse).

export const TEMPLATE_EXTRACT_MAX_OUTPUT_TOKENS = 250;

export const TEMPLATE_LENGTHS = ['short', 'medium', 'long'] as const;
export type TemplateLength = (typeof TEMPLATE_LENGTHS)[number];

export interface ExtractedTemplate {
  hookType: string;
  skeleton: string;
  lineBreakPattern: string;
  length: TemplateLength;
  device: string;
}

export const TEMPLATE_SCHEMA = {
  type: 'object',
  properties: {
    hookType: {
      type: 'string',
      description:
        'First-line hook pattern in 2-4 words, e.g. "stat hook", "contrast hook", "story hook", "question hook", "bold claim"',
    },
    skeleton: {
      type: 'string',
      description:
        'Beat-by-beat structure in compact notation, e.g. "contrast hook -> short declarative -> list of 3 -> question close"',
    },
    lineBreakPattern: {
      type: 'string',
      description:
        'How lines and whitespace are used, e.g. "one-liner", "3 short paragraphs", "list with blank lines"',
    },
    length: { type: 'string', enum: [...TEMPLATE_LENGTHS] },
    device: {
      type: 'string',
      description:
        'Main rhetorical device, e.g. "repetition", "numbered list", "before/after", "direct address"',
    },
  },
  required: ['hookType', 'skeleton', 'lineBreakPattern', 'length', 'device'],
  additionalProperties: false,
} as const;

// Registry default (key `voice-extract`, AI.5). The post text substitutes at
// the {{TWEET_TEXT}} tail — the old EXTRACT_PROMPT_PREFIX + text concatenation,
// byte-identical when rendered.
export const EXTRACT_PROMPT_TEMPLATE = `Analyze the STRUCTURE of the X post below for a personal swipe file. Describe only the reusable skeleton — the shape of the writing, never its topic, claims, or specifics. Someone reading your output alone must not be able to tell what the post was about.

Return JSON: {"hookType": "…", "skeleton": "…", "lineBreakPattern": "…", "length": "…", "device": "…"}
- hookType: the first-line hook pattern in 2-4 words ("stat hook", "contrast hook", "story hook", "question hook", "bold claim", …).
- skeleton: the beat-by-beat structure in compact arrow notation ("contrast hook -> short declarative -> list of 3 -> question close").
- lineBreakPattern: how lines/whitespace carry the rhythm ("one-liner", "3 short paragraphs", "list with blank lines", "wall of text").
- length: short (under 140 chars) | medium (140-280) | long (over 280).
- device: the main rhetorical device ("repetition", "numbered list", "before/after", "direct address", "irony", …).

THE POST:

{{TWEET_TEXT}}`;

// Exported for unit tests (pure).
export function parseExtractedTemplate(raw: string): ExtractedTemplate | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const v = parsed as Record<string, unknown>;
  for (const k of ['hookType', 'skeleton', 'lineBreakPattern', 'device'] as const) {
    if (typeof v[k] !== 'string' || (v[k] as string).trim() === '') return null;
  }
  const length = (TEMPLATE_LENGTHS as readonly string[]).includes(v.length as string)
    ? (v.length as TemplateLength)
    : 'medium';
  return {
    hookType: (v.hookType as string).trim(),
    skeleton: (v.skeleton as string).trim(),
    lineBreakPattern: (v.lineBreakPattern as string).trim(),
    length,
    device: (v.device as string).trim(),
  };
}
