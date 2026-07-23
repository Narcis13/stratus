// AI item generator for reply lists (POST /x/reply-lists/:id/generate, RL.4).
// One structured-outputs LLM call turns a category prompt ("short congratulation
// replies, some with {name}") into a proposal. Proposal-first by design
// (Decision 3): nothing here or in the route writes a row — the panel previews
// the items and the user applies them through the plain /items CRUD, so
// "overwrite my list" stays an explicit human click.
//
// TS-only default (AI-layer Decision 9 — the .md ↔ TS byte-sync convention is
// kept for the three big authoring prompts only); the editing surface is the DB
// prompt editor under registry key `reply-list`. All per-call content sits at
// the tail (§7.15) and the prompt carries NO persona token, so the cacheable
// instruction prefix is niche-independent and the route's cache key needs no
// niche suffix (same as `ideas` / `rewrite`).

import type { GrokMessage } from '../../grok/index.ts';
import { MAX_REPLY_LENGTH } from './engine.ts';

export interface GeneratedItem {
  text: string;
}

/** What the panel asks for when the user doesn't say. */
export const DEFAULT_GENERATED_ITEMS = 12;
/** Hard ceiling — past this a human can't triage the preview grid, and the
 *  batch stops fitting the output-token budget. */
export const MAX_GENERATED_ITEMS = 30;
/** The category prompt is a sentence or two, not a document. */
export const MAX_GEN_PROMPT_LEN = 2000;
// Enough for "more like these" to have a shape without spending the prefix on a
// whole swipe file (lists grow past this by design — MAX_ITEMS_PER_CALL is per
// call, not per list).
const MAX_EXISTING_SHOWN = 30;

// Structured-outputs schema. Deliberately NO minItems/maxItems — strict mode
// plus array bounds is a documented rejection risk on both providers (the
// ideas/rewrite/thread/RU.3 convention); the route clamps `count` and 502s when
// nothing survives parsing.
export const REPLY_LIST_GEN_SCHEMA = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          text: {
            type: 'string',
            description: 'One complete reply, ready to paste with zero editing',
          },
        },
        required: ['text'],
        additionalProperties: false,
      },
    },
  },
  required: ['items'],
  additionalProperties: false,
} as const;

export const REPLY_LIST_PROMPT_TEMPLATE = `## The job

Generate items for one of my reply lists — premade replies I keep on hand and
paste under other people's posts. An item is a complete, standalone reply, not
a sketch I still have to finish. I click one, it lands on my clipboard, I paste
it. It has to work with zero editing.

## Rules

- One short reply per item, under 200 characters. Shorter usually wins — most
  of these are acknowledgments, not arguments.
- Vary register and length across the set: some three-word reactions, some a
  full sentence, some warm, some dry. A list where every item has the same
  rhythm reads as a macro the moment two of them land in the same thread.
- Personalization vars available: {name} (their display name), {first_name},
  and {handle} (their username, no @). Use one in roughly a third of the items,
  never more than one per item, and only where a person would actually say the
  name out loud. Every other item must read naturally with no name at all —
  many of these go out with nothing to fill in.
- Write like a person typing fast on a phone: plain words, contractions, no
  corporate warmth, no "Great insight!" filler, no compliment sandwiches.
- Never invent specifics. No numbers, no claims about what their post said, no
  biography, nothing that could be wrong under a post I haven't read — these
  items are used blind.
- No hashtags, no emoji, no numbering, no surrounding quotes, no commentary
  about the item.
- No two items that say the same thing in different words.
- Write in English unless my request asks otherwise. My request itself may be
  in Romanian — translate the intent, not the words.

## Output

Return JSON {"items": [{"text": "..."}]} — nothing else. {{COUNT}} items unless
my request says otherwise.

## MY REQUEST (the category / flavor of list I want)

{{REQUEST}}

## ITEMS ALREADY IN THIS LIST (don't repeat these; match their spirit unless my request says otherwise)

{{EXISTING_ITEMS}}`;

const COUNT_PLACEHOLDER = '{{COUNT}}';
const REQUEST_PLACEHOLDER = '{{REQUEST}}';
const EXISTING_PLACEHOLDER = '{{EXISTING_ITEMS}}';

export interface BuildListGenOptions {
  /** The user's category prompt (Romanian OK). */
  prompt: string;
  count?: number;
  /** Texts already in the list — "more like these", and don't repeat them. */
  existingItems?: string[];
  /** Registry-loaded prompt body (AI.3): the DB override when one exists, else
   *  the shipped default. */
  template?: string;
}

export function buildListGenInput(opts: BuildListGenOptions): GrokMessage[] {
  const count = opts.count ?? DEFAULT_GENERATED_ITEMS;
  const existing = (opts.existingItems ?? []).slice(0, MAX_EXISTING_SHOWN);

  // split/join (not replace) so '$' in the user's prompt or in an existing item
  // can't trigger String.prototype.replace's special replacement patterns.
  let content = (opts.template ?? REPLY_LIST_PROMPT_TEMPLATE)
    .split(COUNT_PLACEHOLDER)
    .join(`Exactly ${count}`);
  content = content.split(REQUEST_PLACEHOLDER).join(opts.prompt.trim());
  content = content
    .split(EXISTING_PLACEHOLDER)
    .join(existing.length === 0 ? '(none yet — this list is empty)' : existing.join('\n'));
  return [{ role: 'user', content }];
}

// Strict structured outputs guarantee the shape, but a truncated body
// (max_output_tokens) must degrade to null rather than to malformed items. null
// = the `items` field is missing or not an array (parse error). An individual
// entry that is empty or longer than an item column can hold is dropped, as is
// a near-duplicate: the dedupe key is lowercased + whitespace-collapsed, since
// two items differing only in casing defeat the whole point of the anti-repeat
// pick. The returned array may be empty (the route 502s on that), never a bad
// row.
export function parseGeneratedItems(
  raw: string,
  maxCount = MAX_GENERATED_ITEMS,
): GeneratedItem[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const arr = (parsed as Record<string, unknown>).items;
  if (!Array.isArray(arr)) return null;

  const seen = new Set<string>();
  const out: GeneratedItem[] = [];
  for (const entry of arr) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const value = (entry as Record<string, unknown>).text;
    if (typeof value !== 'string') continue;
    const text = value.trim();
    if (text === '' || text.length > MAX_REPLY_LENGTH) continue;
    const key = text.toLowerCase().replace(/\s+/g, ' ');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ text });
    if (out.length >= maxCount) break;
  }
  return out;
}
