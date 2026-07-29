// The humanizer core (HM.1 — promoted verbatim out of `src/x/replyLists/engine.ts`,
// RL.1). Pure and **zero-dep**: no DB, no clock, no `Math.random` — callers inject
// `rng` and pass the config as an ARGUMENT, so the extension shim can inline the
// whole module into the sidepanel build (the replyBand/postCoach discipline).
//
// Why the humanizer exists at all: canned replies are the fastest way to answer
// the people the machinery already surfaces (Launch Room early commenters, open
// loops), and also the fastest way to look like a bot. Small independent
// jitters (prefix/suffix/casing/typo) buy back the human read. Names, handles
// and URLs are never mutated — a typo'd @mention breaks the mention and a
// typo'd name reads as disrespect, both worse than sounding robotic.
//
// Every probability is an opening guess (prefix .25, suffix .20, lowercase .15,
// drop-period .10, typo .05); per-list `humanizer` JSON and the project-level
// `app_settings` 'humanizer' row override them.
//
// `engine.ts` re-exports everything public here, so RL.1's callers and its 39
// tests are byte-compatible with the pre-move layout.

export const MAX_REPLY_LENGTH = 280;

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

export interface HumanizeResult {
  text: string;
  /** Which jitters fired, e.g. `['prefix', 'typo:swap']`. */
  applied: string[];
}

const LETTER_RE = /\p{L}/u;
const SPACE_RE = /\s/;
const LETTERS_ONLY_RE = /^\p{L}+$/u;
const LEADING_NON_LETTERS_RE = /^[^\p{L}]+/u;
const TRAILING_NON_LETTERS_RE = /[^\p{L}]+$/u;
// A token that looks like a link never gets typo'd; `\p{L}.\p{L}` catches bare
// domains ("stratus.dev") alongside explicit schemes.
const URL_ISH_RE = /^https?:\/\/|^www\.|\p{L}\.\p{L}/u;

/** Uniform pick over a pool from one rng draw; null on an empty pool. Exported
 *  because `engine.ts`'s anti-repeat `pickItem` shares it. */
export function pickFrom<T>(pool: readonly T[], draw: number): T | null {
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

/** P(at least one jitter fires) — the five rolls are independent (see
 *  `humanize`). An upper bound, not a promise: lowercase can't fire on a
 *  lowercase opener and drop-period can't fire on text that ends in "!". It
 *  exists so "the humanizer does nothing" is answerable with a number. */
export function jitterOdds(cfg: HumanizerConfig): number {
  const rolls = [
    cfg.prefixes.length > 0 ? cfg.prefixChance : 0,
    cfg.suffixes.length > 0 ? cfg.suffixChance : 0,
    cfg.lowercaseChance,
    cfg.dropPeriodChance,
    cfg.typoChance,
  ];
  return 1 - rolls.reduce((acc, p) => acc * (1 - Math.min(1, Math.max(0, p))), 1);
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
