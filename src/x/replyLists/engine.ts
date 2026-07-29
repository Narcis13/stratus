// Reply-list engine (RL.1). Pure: no DB, no clock, no Math.random — the route
// loads the rows and injects `rng`; this module renders the template and picks
// the item, then hands the result to the humanizer.
//
// HM.1 moved the humanizer half verbatim to `src/shared/humanize.ts` (zero-dep,
// so the extension can inline it). It is re-exported below: every existing
// importer — `routes/replyLists.ts`, `db/schema.ts`, `engine.test.ts` — keeps
// importing from here, and the untouched test suite is the proof the move
// changed nothing.

import {
  type HumanizeResult,
  type HumanizerConfig,
  humanize,
  pickFrom,
} from '../../shared/humanize.ts';

export {
  DEFAULT_HUMANIZER,
  HUMANIZE_DRAWS,
  type HumanizeResult,
  type HumanizerConfig,
  MAX_REPLY_LENGTH,
  humanize,
  jitterOdds,
  parseHumanizerConfig,
  resolveHumanizer,
} from '../../shared/humanize.ts';

export const TEMPLATE_VARS = ['name', 'first_name', 'handle'] as const;
export type TemplateVar = (typeof TEMPLATE_VARS)[number];

export interface ReplyVars {
  /** Display name as scraped — emoji are stripped before substitution. */
  name?: string | null | undefined;
  /** With or without the leading @. */
  handle?: string | null | undefined;
}

export interface RenderResult {
  text: string;
  missingVars: TemplateVar[];
}

export interface ComposeResult extends HumanizeResult {
  missingVars: TemplateVar[];
}

export interface PickableItem {
  id: string;
  text: string;
  enabled: boolean;
  lastUsedAt: Date | null;
}

// Flags (regional indicators) and skin-tone modifiers aren't Extended_Pictographic.
const EMOJI_RE =
  /[\p{Extended_Pictographic}\p{Emoji_Modifier}\p{Regional_Indicator}]|\u200D|\uFE0F/gu;
const VAR_TOKEN_RE = /\{(name|first_name|handle)\}/g;
// The optional groups let a missing var take one adjacent separator with it, so
// "Thank you, {name}!" degrades to "Thank you!" and not "Thank you, !".
const VAR_SLOT_RE = /(\s*,\s*|\s+)?\{(name|first_name|handle)\}(\s*,\s*|\s+)?/g;

function isTemplateVar(v: string): v is TemplateVar {
  return (TEMPLATE_VARS as readonly string[]).includes(v);
}

// ---------------------------------------------------------------- template render

export function stripEmoji(s: string): string {
  return s.replace(EMOJI_RE, '').replace(/\s+/g, ' ').trim();
}

interface ResolvedVars {
  name: string | null;
  first_name: string | null;
  handle: string | null;
}

function resolveVars(vars: ReplyVars): ResolvedVars {
  const name = stripEmoji(vars.name ?? '');
  const handle = (vars.handle ?? '').trim().replace(/^@+/, '').trim();
  const first = name.split(/\s+/)[0] ?? '';
  return {
    name: name === '' ? null : name,
    first_name: first === '' ? null : first,
    handle: handle === '' ? null : handle,
  };
}

/** Which of the known vars a template needs, first-appearance order. Unknown
 *  `{foo}` placeholders are intentional text, not vars. */
export function templateVars(template: string): TemplateVar[] {
  const found: TemplateVar[] = [];
  for (const m of template.matchAll(VAR_TOKEN_RE)) {
    const key = m[1];
    if (key !== undefined && isTemplateVar(key) && !found.includes(key)) found.push(key);
  }
  return found;
}

/** The vars a given target can actually fill. */
export function availableVarsFor(vars: ReplyVars): Set<TemplateVar> {
  const resolved = resolveVars(vars);
  const out = new Set<TemplateVar>();
  for (const v of TEMPLATE_VARS) if (resolved[v] !== null) out.add(v);
  return out;
}

function tidy(s: string): string {
  return s
    .replace(/[^\S\r\n]{2,}/g, ' ')
    .replace(/\s+([,.!?;:])/g, '$1')
    .replace(/\s*,+\s*$/, '')
    .replace(/[^\S\r\n]+$/gm, '')
    .trim();
}

export function renderTemplate(template: string, vars: ReplyVars): RenderResult {
  const resolved = resolveVars(vars);
  const missingVars: TemplateVar[] = [];
  const text = template.replace(
    VAR_SLOT_RE,
    (full: string, lead: string | undefined, key: string, trail: string | undefined) => {
      if (!isTemplateVar(key)) return full;
      const value = resolved[key];
      if (value !== null) return `${lead ?? ''}${value}${trail ?? ''}`;
      if (!missingVars.includes(key)) missingVars.push(key);
      // Drop the token plus exactly ONE adjacent separator: the leading one when
      // there is one (mid-sentence), else the trailing one (start of string).
      return lead === undefined ? '' : (trail ?? '');
    },
  );
  return { text: tidy(text), missingVars };
}

// ---------------------------------------------------------------- anti-repeat pick

function compareRecencyDesc(a: PickableItem, b: PickableItem): number {
  const at = a.lastUsedAt?.getTime() ?? Number.NEGATIVE_INFINITY;
  const bt = b.lastUsedAt?.getTime() ?? Number.NEGATIVE_INFINITY;
  return bt - at;
}

/** Anti-repeat shuffle. Enabled items only; items needing a var the target
 *  can't fill are used only when nothing else remains; the most-recently-used
 *  half (never more than n-1, so something always survives) is excluded, and
 *  the pick is uniform among the rest — pure LRU cycling is itself a detectable
 *  pattern, randomness inside the eligible half is the point. */
export function pickItem<T extends PickableItem>(
  items: readonly T[],
  availableVars: ReadonlySet<string>,
  rng: () => number,
): T | null {
  const enabled = items.filter((i) => i.enabled);
  if (enabled.length === 0) return null;
  const ready = enabled.filter((i) => templateVars(i.text).every((v) => availableVars.has(v)));
  const pool = ready.length > 0 ? ready : enabled;
  if (pool.length === 1) return pool[0] ?? null;

  const excludeCount = Math.min(pool.length - 1, Math.floor(pool.length / 2));
  const excluded = new Set(
    [...pool]
      .sort(compareRecencyDesc)
      .slice(0, excludeCount)
      .map((i) => i.id),
  );
  const eligible = pool.filter((i) => !excluded.has(i.id));
  return pickFrom(eligible, rng());
}

/** Render then humanize. The target's own name/handle ride along as protected
 *  spans, so no jitter can ever land on them. */
export function composeReply(
  itemText: string,
  vars: ReplyVars,
  config: HumanizerConfig,
  rng: () => number,
): ComposeResult {
  const rendered = renderTemplate(itemText, vars);
  const resolved = resolveVars(vars);
  const protectedValues = [resolved.name, resolved.first_name, resolved.handle].filter(
    (v): v is string => v !== null,
  );
  const { text, applied } = humanize(rendered.text, config, rng, protectedValues);
  return { text, missingVars: rendered.missingVars, applied };
}
