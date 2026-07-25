// Reply-list engine (RL.1). Pure: no DB, no clock, no Math.random — the route
// loads the rows and injects `rng`; this module renders the template, picks the
// item, and roughens the result just enough that it doesn't read as a form
// letter.
//
// Why the humanizer exists at all: canned replies are the fastest way to answer
// the people the machinery already surfaces (Launch Room early commenters, open
// loops), and also the fastest way to look like a bot. Small independent
// jitters (prefix/suffix/casing/typo) buy back the human read. Names, handles
// and URLs are never mutated — a typo'd @mention breaks the mention and a
// typo'd name reads as disrespect, both worse than sounding robotic.
//
// Every probability is an opening guess (prefix .25, suffix .20, lowercase .15,
// drop-period .10, typo .05); per-list `humanizer` JSON overrides them.

export const MAX_REPLY_LENGTH = 280;

export const TEMPLATE_VARS = ['name', 'first_name', 'handle'] as const;
export type TemplateVar = (typeof TEMPLATE_VARS)[number];

export interface HumanizerConfig {
  prefixes: string[];
  suffixes: string[];
  prefixChance: number;
  suffixChance: number;
  lowercaseChance: number;
  dropPeriodChance: number;
  typoChance: number;
}

export const DEFAULT_HUMANIZER: HumanizerConfig = {
  prefixes: ['honestly,', 'man,', 'ngl', 'tbh', 'yeah,', 'ok so'],
  suffixes: ['well said', 'love this', 'good stuff', 'solid point', 'nice one'],
  prefixChance: 0.25,
  suffixChance: 0.2,
  lowercaseChance: 0.15,
  dropPeriodChance: 0.1,
  typoChance: 0.05,
};

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

export interface HumanizeResult {
  text: string;
  /** Which jitters fired, e.g. `['prefix', 'typo:swap']`. */
  applied: string[];
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

const LETTER_RE = /\p{L}/u;
const SPACE_RE = /\s/;
const LETTERS_ONLY_RE = /^\p{L}+$/u;
const LEADING_NON_LETTERS_RE = /^[^\p{L}]+/u;
const TRAILING_NON_LETTERS_RE = /[^\p{L}]+$/u;
// Flags (regional indicators) and skin-tone modifiers aren't Extended_Pictographic.
const EMOJI_RE =
  /[\p{Extended_Pictographic}\p{Emoji_Modifier}\p{Regional_Indicator}]|\u200D|\uFE0F/gu;
// A token that looks like a link never gets typo'd; `\p{L}.\p{L}` catches bare
// domains ("stratus.dev") alongside explicit schemes.
const URL_ISH_RE = /^https?:\/\/|^www\.|\p{L}\.\p{L}/u;
const VAR_TOKEN_RE = /\{(name|first_name|handle)\}/g;
// The optional groups let a missing var take one adjacent separator with it, so
// "Thank you, {name}!" degrades to "Thank you!" and not "Thank you, !".
const VAR_SLOT_RE = /(\s*,\s*|\s+)?\{(name|first_name|handle)\}(\s*,\s*|\s+)?/g;

function isTemplateVar(v: string): v is TemplateVar {
  return (TEMPLATE_VARS as readonly string[]).includes(v);
}

/** Uniform pick over a pool from one rng draw; null on an empty pool. */
function pickFrom<T>(pool: readonly T[], draw: number): T | null {
  if (pool.length === 0) return null;
  const idx = Math.min(pool.length - 1, Math.max(0, Math.floor(draw * pool.length)));
  return pool[idx] ?? null;
}

// ---------------------------------------------------------------- humanizer config

function parsePool(v: unknown): string[] | null {
  if (!Array.isArray(v)) return null;
  // An explicitly empty pool is a valid choice ("no prefixes on this list").
  return v
    .filter((e): e is string => typeof e === 'string')
    .map((e) => e.trim())
    .filter((e) => e !== '');
}

function parseChance(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1 ? v : null;
}

/** Lenient field-by-field parse (brandKit.ts spirit): unknown fields ignored,
 *  bad fields fall back to the defaults. Null ONLY when the value isn't an
 *  object at all — that's what lets the CRUD route 400 an invalid humanizer
 *  while still storing a partially-specified one. */
export function parseHumanizerConfig(raw: unknown): HumanizerConfig | null {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  return {
    prefixes: parsePool(r.prefixes) ?? [...DEFAULT_HUMANIZER.prefixes],
    suffixes: parsePool(r.suffixes) ?? [...DEFAULT_HUMANIZER.suffixes],
    prefixChance: parseChance(r.prefixChance) ?? DEFAULT_HUMANIZER.prefixChance,
    suffixChance: parseChance(r.suffixChance) ?? DEFAULT_HUMANIZER.suffixChance,
    lowercaseChance: parseChance(r.lowercaseChance) ?? DEFAULT_HUMANIZER.lowercaseChance,
    dropPeriodChance: parseChance(r.dropPeriodChance) ?? DEFAULT_HUMANIZER.dropPeriodChance,
    typoChance: parseChance(r.typoChance) ?? DEFAULT_HUMANIZER.typoChance,
  };
}

/** What the /use path wants: a stored humanizer JSON (or null) → a usable config. */
export function resolveHumanizer(raw: unknown): HumanizerConfig {
  return parseHumanizerConfig(raw) ?? DEFAULT_HUMANIZER;
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

// ---------------------------------------------------------------- humanizer

const TYPO_KINDS = ['drop', 'swap', 'neighbor', 'double_space'] as const;
type TypoKind = (typeof TYPO_KINDS)[number];

const QWERTY_ROWS = ['qwertyuiop', 'asdfghjkl', 'zxcvbnm'];

/** Fixed number of rng draws per call, whether or not a step fires — so a
 *  stubbed sequence maps to steps by position:
 *  0 prefix chance · 1 prefix pick · 2 suffix chance · 3 suffix pick ·
 *  4 lowercase · 5 drop-period · 6 typo chance · 7 typo word · 8 typo kind ·
 *  9 typo position. */
export const HUMANIZE_DRAWS = 10;

function stripEdges(word: string): string {
  return word.replace(LEADING_NON_LETTERS_RE, '').replace(TRAILING_NON_LETTERS_RE, '');
}

/** A word is protected when it sits inside (or contains) something we promised
 *  never to mangle — the person's name or handle. */
function isProtectedWord(word: string, protectedValues: readonly string[]): boolean {
  const w = word.toLowerCase();
  if (w === '') return true;
  for (const raw of protectedValues) {
    const p = raw.trim().toLowerCase();
    if (p.length < 2) continue;
    if (p.includes(w)) return true;
    if (p.length >= 3 && w.includes(p)) return true;
  }
  return false;
}

function findFirstLetter(text: string, from: number): number {
  for (let i = Math.max(0, from); i < text.length; i++) {
    const ch = text[i];
    if (ch !== undefined && LETTER_RE.test(ch)) return i;
  }
  return -1;
}

function wordAt(text: string, idx: number): string {
  let start = idx;
  while (start > 0 && !SPACE_RE.test(text[start - 1] ?? ' ')) start--;
  let end = idx;
  while (end < text.length && !SPACE_RE.test(text[end] ?? ' ')) end++;
  return text.slice(start, end);
}

function lowercaseFirstLetter(
  text: string,
  from: number,
  protectedValues: readonly string[],
): string {
  const idx = findFirstLetter(text, from);
  if (idx === -1) return text;
  const ch = text[idx];
  if (ch === undefined || ch === ch.toLowerCase()) return text;
  const word = wordAt(text, idx);
  if (word.startsWith('@') || word.startsWith('#')) return text;
  if (isProtectedWord(stripEdges(word), protectedValues)) return text;
  return text.slice(0, idx) + ch.toLowerCase() + text.slice(idx + 1);
}

interface TypoTarget {
  start: number;
  word: string;
}

function typoTargets(text: string, protectedValues: readonly string[]): TypoTarget[] {
  const targets: TypoTarget[] = [];
  for (const m of text.matchAll(/\S+/g)) {
    const token = m[0];
    const at = m.index ?? -1;
    if (at < 0 || token.startsWith('@') || token.startsWith('#') || URL_ISH_RE.test(token))
      continue;
    const lead = token.match(LEADING_NON_LETTERS_RE)?.[0].length ?? 0;
    const word = token.slice(lead).replace(TRAILING_NON_LETTERS_RE, '');
    if (word.length < 4 || !LETTERS_ONLY_RE.test(word)) continue;
    if (isProtectedWord(word, protectedValues)) continue;
    targets.push({ start: at + lead, word });
  }
  return targets;
}

/** `min + uniform over [0, span)` from one draw. */
function offset(draw: number, span: number, min: number): number {
  return min + Math.min(span - 1, Math.max(0, Math.floor(draw * span)));
}

function neighborKey(ch: string, seed: number): string | null {
  const lower = ch.toLowerCase();
  for (const row of QWERTY_ROWS) {
    const at = row.indexOf(lower);
    if (at === -1) continue;
    const opts: string[] = [];
    const left = row[at - 1];
    const right = row[at + 1];
    if (left !== undefined) opts.push(left);
    if (right !== undefined) opts.push(right);
    const nb = opts[seed % Math.max(1, opts.length)];
    if (nb === undefined) return null;
    return ch === lower ? nb : nb.toUpperCase();
  }
  return null;
}

function mutate(text: string, t: TypoTarget, kind: TypoKind, draw: number): string | null {
  const w = t.word;
  const end = t.start + w.length;
  if (kind === 'drop') {
    const i = offset(draw, w.length - 1, 1);
    return text.slice(0, t.start + i) + text.slice(t.start + i + 1);
  }
  if (kind === 'swap') {
    const i = offset(draw, w.length - 1, 0);
    const a = w[i];
    const b = w[i + 1];
    if (a === undefined || b === undefined || a === b) return null;
    return text.slice(0, t.start + i) + b + a + text.slice(t.start + i + 2);
  }
  if (kind === 'neighbor') {
    const i = offset(draw, w.length, 0);
    const ch = w[i];
    if (ch === undefined) return null;
    const nb = neighborKey(ch, i);
    if (nb === null) return null;
    return text.slice(0, t.start + i) + nb + text.slice(t.start + i + 1);
  }
  if (t.start > 0 && text[t.start - 1] === ' ')
    return `${text.slice(0, t.start)} ${text.slice(t.start)}`;
  if (text[end] === ' ') return `${text.slice(0, end)} ${text.slice(end)}`;
  return null;
}

export function humanize(
  text: string,
  config: HumanizerConfig,
  rng: () => number,
  protectedValues: readonly string[] = [],
): HumanizeResult {
  // All draws up front: the count is fixed (see HUMANIZE_DRAWS) so a stubbed
  // sequence lines up with the steps regardless of what fires.
  const draw = {
    prefix: rng(),
    prefixPick: rng(),
    suffix: rng(),
    suffixPick: rng(),
    lowercase: rng(),
    dropPeriod: rng(),
    typo: rng(),
    typoWord: rng(),
    typoKind: rng(),
    typoPos: rng(),
  };

  const applied: string[] = [];
  let out = text;
  // Where the item's own text starts, so a prefix doesn't shield the first
  // letter from the (independent) lowercase roll.
  let bodyStart = 0;

  const prefix = pickFrom(config.prefixes, draw.prefixPick);
  if (prefix !== null && draw.prefix < config.prefixChance) {
    const next = `${prefix} ${out}`;
    // Overflowing jitters are skipped, never truncated mid-word.
    if (next.length <= MAX_REPLY_LENGTH) {
      out = next;
      bodyStart = prefix.length + 1;
      applied.push('prefix');
    }
  }

  const suffix = pickFrom(config.suffixes, draw.suffixPick);
  if (suffix !== null && draw.suffix < config.suffixChance) {
    const next = `${out}${/[.!?…]$/.test(out) ? ' ' : ', '}${suffix}`;
    if (next.length <= MAX_REPLY_LENGTH) {
      out = next;
      applied.push('suffix');
    }
  }

  if (draw.lowercase < config.lowercaseChance) {
    const next = lowercaseFirstLetter(out, bodyStart, protectedValues);
    if (next !== out) {
      out = next;
      applied.push('lowercase');
    }
  }

  // `[^.]\.$` keeps an ellipsis intact — dropping one dot from "..." looks broken.
  if (draw.dropPeriod < config.dropPeriodChance && /[^.]\.$/.test(out)) {
    out = out.slice(0, -1);
    applied.push('drop_period');
  }

  if (draw.typo < config.typoChance) {
    const target = pickFrom(typoTargets(out, protectedValues), draw.typoWord);
    const kind = pickFrom(TYPO_KINDS, draw.typoKind);
    if (target !== null && kind !== null) {
      const next = mutate(out, target, kind, draw.typoPos);
      if (next !== null && next !== out && next.length <= MAX_REPLY_LENGTH) {
        out = next;
        applied.push(`typo:${kind}`);
      }
    }
  }

  return { text: out, applied };
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
