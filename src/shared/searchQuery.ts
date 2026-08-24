// The x.com advanced-search compiler (Outliers, OU.1) — the whole feature's
// intelligence, and the only place a query string is ever built.
//
// Canonical home (§7.27): consumed by BOTH the server (`POST /x/searches`
// validates and stores through `parseSearchQuery`) and the extension (the
// Outliers tab's live preview, through the re-export shim
// `extension/src/searchQuery.ts` that Vite inlines), so the string the panel
// previews and the string the server stores can never disagree.
// Dependency-free by contract — not one import.
//
// **Web dialect only, and that is the whole cost decision** (plan decision 1).
// X API v2 has no `min_faves`/`min_retweets`/`min_replies` operator at any
// tier, so the API version of this feature would pay ~$0.005 per returned
// result to discard most of them. Nothing here reaches `xFetch` or `askLLM`,
// and nothing should: this module compiles a string a human pastes into x.com's
// own search box. Do NOT add a `dialect` parameter or an `api` compile path,
// and do not add a threshold estimator — the floors are hand-tuned registry
// knobs by decision 10, and this module has no DB access by construction.
//
// **Operator spot check — 2026-08-24, run against live x.com** (§7.33: X's
// parser is the oracle and it lives off-machine, so a retired operator returns
// the UNFILTERED firehose, which looks exactly like a working feature).
// Confirmed by reading the returned posts' own metrics, not by trusting docs:
//
//   min_faves:N        `min_faves:50 bun` → top hit 55 likes.
//   ( .. OR .. )       `("build in public" OR "indie hacker") min_faves:400
//   + "phrase"          -filter:replies since:2026-07-01` → top hit 1K likes
//                       and matched on ONE of the two phrases, so OR is
//                       disjunctive rather than a literal word match.
//   -filter:replies    same query → top-level posts only.
//   since:YYYY-MM-DD   same query → nothing older than the bound.
//   #hashtag           `#buildinpublic min_faves:100 -filter:replies` → a real
//                       hashtag post, 134 likes.
//   filter:native_video / lang: / -filter:nativeretweets / -filter:links
//                      parse and NARROW — a compound of all four returned zero
//                       results rather than the firehose, which is the negative
//                       evidence that matters here.
//   ?q=encodeURIComponent(query)
//                      round-trips: every query above rendered in X's own
//                       search box byte-identical to what was sent, which is
//                       what makes the Open-in-X hand-off equal to the Copy one.
//
// `min_retweets` / `min_replies` / `to:` / `@mentions` / `filter:images` /
// `filter:videos` / `filter:media` come from the user-verified August 2026
// cheatsheet and were not re-run individually. If X ever retires an operator,
// DELETE it from `SearchQuery` here — never leave one compiling.

// ---------------------------------------------------------------- shape

export type RepliesFilter = 'any' | 'exclude' | 'only';
export type MediaFilter = 'any' | 'media' | 'images' | 'videos' | 'native_video';
export type SearchSort = 'live' | 'top';

/** The structured params. Saved rows store THIS (plan decision 5) — a compiled
 *  string can't be loaded back into a form, and a compiler fix then can't reach
 *  rows already saved. The string is derived on every read. */
export interface SearchQuery {
  /** AND-ed bare keywords. */
  all?: string[];
  /** OR-ed keywords. ALWAYS parenthesized on the way out, even a group of one. */
  any?: string[];
  /** Exact phrases; quoted on the way out. */
  phrases?: string[];
  /** Excluded keywords; one leading `-` is stripped at normalization. */
  none?: string[];
  from?: string;
  to?: string;
  mentions?: string[];
  hashtags?: string[];
  minFaves?: number;
  minRetweets?: number;
  minReplies?: number;
  /** Enum, not a boolean: two booleans could say "exclude" and "only" at once. */
  replies?: RepliesFilter;
  /** Same reason. `'any'` emits no clause. */
  media?: MediaFilter;
  /** `true` → `filter:links`, `false` → `-filter:links`, absent → no clause.
   *  Both arms are real hunts (link-drops vs plain-text posts), and a boolean
   *  cannot contradict itself the way the two above could. */
  hasLinks?: boolean;
  /** `true` → `-filter:nativeretweets`. Deliberately NOT symmetric with
   *  `hasLinks`: the name is already negative, and a retweets-ONLY hunt is a
   *  different feature. `false` means "don't exclude them" and emits nothing. */
  noRetweets?: boolean;
  lang?: string;
  since?: string;
  until?: string;
  /** The results TAB, not part of the query string — `searchUrl` reads it.
   *  Absent on purpose when the caller hasn't chosen: the product default is
   *  the `x.outliers.sort` registry knob, which this module cannot see. */
  sort?: SearchSort;
}

export type ProblemLevel = 'error' | 'warn';

/** `error` means do not run; `warn` means this WILL run but may not do what you
 *  think (§7.23a — the warn half never refuses). A list, not an exception, so
 *  the form can show every fault at once (plan decision 7). */
export interface Problem {
  level: ProblemLevel;
  field: string;
  message: string;
}

export interface CompileResult {
  query: string;
  length: number;
  overLimit: boolean;
  problems: Problem[];
}

// ---------------------------------------------------------------- constants

/** X's self-serve recent-search limit — the tighter of the two known bounds,
 *  used as the web budget too because x.com's own limit is undocumented. Not a
 *  registry knob: it is X's number, not ours, and a knob there buys a silent
 *  400. */
export const MAX_QUERY_LENGTH = 512;
/** Exported so the route and the form can explain a silent drop. */
export const MAX_TERMS_PER_FIELD = 20;
export const MAX_TERM_LENGTH = 120;

/** Deliberately a small explicit allowlist, not a regex: an unknown `lang:`
 *  code returns zero results on X, which reads exactly like "no matches".
 *  `en` and `ro` are the two this product actually hunts in and the two the
 *  2026-08-24 spot check exercised; the rest are the common codes. Adding one
 *  is a one-line change. */
export const SEARCH_LANGS = [
  'en',
  'ro',
  'es',
  'fr',
  'de',
  'it',
  'pt',
  'nl',
  'pl',
  'ru',
  'tr',
  'ja',
  'ko',
  'zh',
  'ar',
  'hi',
] as const;

/** The entire "estimation" this feature ships. The cheatsheet's advice is
 *  *start at 300–500 and increase gradually*, and a ▲▼ stepper walking these
 *  rungs is that advice made clickable. One ladder, three fields (faves,
 *  retweets, replies) — see decision 10 for the measured version that is
 *  deliberately NOT built. */
export const FAVES_LADDER = [50, 100, 200, 300, 500, 800, 1200, 2000, 5000] as const;

const USERNAME_RE = /^[A-Za-z0-9_]{1,15}$/;
// A leading digit is legal on X but matches nothing useful — warn, don't error.
const HASHTAG_RE = /^[A-Za-z0-9_]{1,100}$/;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

const MEDIA_OPERATOR: Record<Exclude<MediaFilter, 'any'>, string> = {
  media: 'filter:media',
  images: 'filter:images',
  videos: 'filter:videos',
  native_video: 'filter:native_video',
};

// ---------------------------------------------------------------- ladder

/** Smallest rung strictly greater than `n`; the top rung once `n` is at or past
 *  it. Pure — no clamping to the field's registry max, the form owns that. */
export function nextRung(n: number): number {
  const top = FAVES_LADDER.at(-1) ?? 0;
  if (!Number.isFinite(n)) return FAVES_LADDER[0];
  for (const rung of FAVES_LADDER) if (rung > n) return rung;
  return top;
}

/** Mirrors `nextRung` downward with a floor of `0`, which means "off" — the
 *  stepper has to be able to walk the floor back out of the query entirely. */
export function prevRung(n: number): number {
  if (!Number.isFinite(n)) return 0;
  let below = 0;
  for (const rung of FAVES_LADDER) {
    if (rung >= n) break;
    below = rung;
  }
  return below;
}

// ---------------------------------------------------------------- normalize

function normTerms(v: unknown, strip?: (s: string) => string): string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out: string[] = [];
  const seen = new Set<string>();
  for (const entry of v) {
    if (typeof entry !== 'string') continue;
    const trimmed = entry.trim();
    const term = (strip ? strip(trimmed) : trimmed).trim();
    if (term === '' || term.length > MAX_TERM_LENGTH) continue;
    const key = term.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(term);
    if (out.length >= MAX_TERMS_PER_FIELD) break;
  }
  return out.length > 0 ? out : undefined;
}

const stripAt = (s: string): string => s.replace(/^@/, '');
const stripHash = (s: string): string => s.replace(/^#/, '');
const stripMinus = (s: string): string => s.replace(/^-/, '');

/** Shape only. Whether the handle is LEGAL is the compiler's call, so a bad one
 *  survives normalization and comes back as a per-field problem instead of
 *  vanishing between what the user typed and what the preview shows. */
function normHandle(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  const handle = stripAt(v.trim()).trim();
  return handle === '' ? undefined : handle;
}

/** `0` and negatives coerce to absent. A deliberate §7.11 carve-out: here `0`
 *  is a real user intent ("no floor"), not unknown, and a `min_faves:0` clause
 *  is inert noise that eats the 512-char budget. */
function normFloor(v: unknown): number | undefined {
  if (typeof v !== 'number' || !Number.isFinite(v)) return undefined;
  const n = Math.floor(v);
  return n > 0 ? n : undefined;
}

function normText(v: unknown, lower = false): string | undefined {
  if (typeof v !== 'string') return undefined;
  const s = lower ? v.trim().toLowerCase() : v.trim();
  return s === '' ? undefined : s;
}

function normReplies(v: unknown): RepliesFilter | undefined {
  if (v === undefined) return undefined;
  return v === 'exclude' || v === 'only' || v === 'any' ? v : 'any';
}

function normMedia(v: unknown): MediaFilter | undefined {
  if (v === undefined) return undefined;
  return v === 'media' || v === 'images' || v === 'videos' || v === 'native_video' || v === 'any'
    ? v
    : 'any';
}

/** Unlike `replies`/`media`, an unrecognized `sort` DROPS rather than falling
 *  back. The default for this one field lives outside this module — it is the
 *  `x.outliers.sort` knob (`top`) — and freezing `'live'` into a stored row
 *  here would let the column default stand in for the product default, which
 *  is exactly what D200 forbids. Absent and unrecognized therefore mean the
 *  same thing to the caller: you decide. */
function normSort(v: unknown): SearchSort | undefined {
  return v === 'live' || v === 'top' ? v : undefined;
}

function normBool(v: unknown): boolean | undefined {
  return typeof v === 'boolean' ? v : undefined;
}

/** Normalizing validator at the storage boundary (`parseHumanizerConfig`'s
 *  shape): `null` ONLY when the value isn't an object at all, everything else
 *  degrades field by field. Key order is the declaration order above, so
 *  `JSON.stringify` of a normalized query is stable and a saved-search diff
 *  means something. */
export function parseSearchQuery(raw: unknown): SearchQuery | null {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;

  const all = normTerms(r.all);
  const any = normTerms(r.any);
  const phrases = normTerms(r.phrases);
  const none = normTerms(r.none, stripMinus);
  const from = normHandle(r.from);
  const to = normHandle(r.to);
  const mentions = normTerms(r.mentions, stripAt);
  const hashtags = normTerms(r.hashtags, stripHash);
  const minFaves = normFloor(r.minFaves);
  const minRetweets = normFloor(r.minRetweets);
  const minReplies = normFloor(r.minReplies);
  const replies = normReplies(r.replies);
  const media = normMedia(r.media);
  const hasLinks = normBool(r.hasLinks);
  // `false` here means "don't exclude retweets", which is the no-clause state —
  // so it normalizes away rather than being stored as dead weight.
  const noRetweets = r.noRetweets === true ? true : undefined;
  const lang = normText(r.lang, true);
  const since = normText(r.since);
  const until = normText(r.until);
  const sort = normSort(r.sort);

  return {
    ...(all ? { all } : {}),
    ...(any ? { any } : {}),
    ...(phrases ? { phrases } : {}),
    ...(none ? { none } : {}),
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
    ...(mentions ? { mentions } : {}),
    ...(hashtags ? { hashtags } : {}),
    ...(minFaves ? { minFaves } : {}),
    ...(minRetweets ? { minRetweets } : {}),
    ...(minReplies ? { minReplies } : {}),
    ...(replies ? { replies } : {}),
    ...(media ? { media } : {}),
    ...(hasLinks === undefined ? {} : { hasLinks }),
    ...(noRetweets ? { noRetweets } : {}),
    ...(lang ? { lang } : {}),
    ...(since ? { since } : {}),
    ...(until ? { until } : {}),
    ...(sort ? { sort } : {}),
  };
}

// ---------------------------------------------------------------- compile

// Total over junk: `compileSearchQuery` is typed but its input crosses a wire,
// so every field is re-guarded here rather than trusted. This is what makes
// "never throws" a property instead of a hope.
function terms(v: string[] | undefined): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const t of v) if (typeof t === 'string' && t.trim() !== '') out.push(t.trim());
  return out;
}

function text(v: string | undefined): string {
  return typeof v === 'string' ? v.trim() : '';
}

function positive(v: number | undefined): number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0;
}

/** `null` when the value is a real `YYYY-MM-DD` calendar date, otherwise the
 *  message saying why not. A syntactically valid impossible date (2026-02-31)
 *  is as wrong as a malformed one — X silently widens the window either way. */
function dateFault(value: string): string | null {
  const m = DATE_RE.exec(value);
  if (!m) return `"${value}" is not a date — use YYYY-MM-DD.`;
  const [, ys = '', ms = '', ds = ''] = m;
  const y = Number(ys);
  const mo = Number(ms);
  const d = Number(ds);
  const dt = new Date(Date.UTC(y, mo - 1, d));
  const real = dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
  return real ? null : `"${value}" is not a real calendar date.`;
}

/** Compiles in the fixed clause order below — keywords → entities → negations →
 *  engagement → filters → lang → dates — so the same params always produce a
 *  byte-identical string. Never throws; an invalid clause is SKIPPED and
 *  reported, so the preview shows what would actually run rather than a string
 *  containing the mistake. */
export function compileSearchQuery(q: SearchQuery): CompileResult {
  const problems: Problem[] = [];
  const err = (field: string, message: string): void => {
    problems.push({ level: 'error', field, message });
  };
  const warn = (field: string, message: string): void => {
    problems.push({ level: 'warn', field, message });
  };

  // A keyword is emittable unless it carries a `"` — X has no escape character,
  // so one unbalanced quote re-parses everything after it. `#tag` / `@user` /
  // `$TICK` are left alone on purpose: they are entity operators, not keywords.
  const usable = (term: string, field: string): boolean => {
    if (term.includes('"')) {
      err(field, `"${term}" contains a quote — put the exact wording in Phrases instead.`);
      return false;
    }
    if (term.includes(':')) {
      // The likeliest failure mode of the whole form: pasting `min_faves:50`
      // into a keyword box. Advisory, never a refusal (§7.23a).
      warn(field, `"${term}" contains ":" — X reads that as an operator, not a keyword.`);
    }
    return true;
  };

  const matchers: string[] = [];
  const rest: string[] = [];

  // 1. AND-ed keywords, bare.
  const allTerms = terms(q.all);
  for (const t of allTerms) if (usable(t, 'all')) matchers.push(t);

  // 2. The OR group, ALWAYS parenthesized — AND binds tighter than OR on X, so
  //    an unparenthesized group re-associates the moment another clause lands
  //    beside it, and `or` in lowercase is a literal word rather than the
  //    operator. A group of one is parenthesized too: it may gain members later.
  const anyTerms: string[] = [];
  for (const t of terms(q.any)) {
    if (!usable(t, 'any')) continue;
    if (/\s/.test(t)) {
      warn('any', `"${t}" is more than one word — X reads it as an AND inside the OR group.`);
    }
    anyTerms.push(t);
  }
  if (anyTerms.length > 0) matchers.push(`(${anyTerms.join(' OR ')})`);

  // 3. Phrases.
  for (const p of terms(q.phrases)) {
    if (p.includes('"')) {
      err('phrases', `"${p}" already contains a quote — X has no escape character for one.`);
      continue;
    }
    matchers.push(`"${p}"`);
  }

  // 4. from: / to:
  const from = text(q.from);
  if (from !== '') {
    if (USERNAME_RE.test(from)) matchers.push(`from:${from}`);
    else err('from', `"${from}" is not a handle — letters, numbers and _ only, up to 15.`);
  }
  const to = text(q.to);
  if (to !== '') {
    if (USERNAME_RE.test(to)) matchers.push(`to:${to}`);
    else err('to', `"${to}" is not a handle — letters, numbers and _ only, up to 15.`);
  }

  // 5. @mentions
  for (const m of terms(q.mentions)) {
    if (USERNAME_RE.test(m)) matchers.push(`@${m}`);
    else err('mentions', `"${m}" is not a handle — letters, numbers and _ only, up to 15.`);
  }

  // 6. #hashtags
  for (const h of terms(q.hashtags)) {
    if (!HASHTAG_RE.test(h)) {
      err('hashtags', `"${h}" is not a hashtag — letters, numbers and _ only.`);
      continue;
    }
    if (/^\d/.test(h)) warn('hashtags', `#${h} starts with a digit — X matches almost nothing.`);
    matchers.push(`#${h}`);
  }

  // 7. Negations.
  for (const n of terms(q.none)) {
    if (!usable(n, 'none')) continue;
    if (/\s/.test(n)) {
      warn('none', `"${n}" is more than one word — only "${n.split(/\s+/)[0]}" is excluded.`);
    }
    rest.push(`-${n}`);
  }

  // 8. Engagement floors.
  const minFaves = positive(q.minFaves);
  if (minFaves > 0) rest.push(`min_faves:${minFaves}`);
  const minRetweets = positive(q.minRetweets);
  if (minRetweets > 0) rest.push(`min_retweets:${minRetweets}`);
  const minReplies = positive(q.minReplies);
  if (minReplies > 0) rest.push(`min_replies:${minReplies}`);

  // 9–12. Filters.
  if (q.replies === 'exclude') rest.push('-filter:replies');
  else if (q.replies === 'only') rest.push('filter:replies');
  if (q.media !== undefined && q.media !== 'any') {
    const operator = MEDIA_OPERATOR[q.media];
    if (operator !== undefined) rest.push(operator);
  }
  if (q.hasLinks === true) rest.push('filter:links');
  else if (q.hasLinks === false) rest.push('-filter:links');
  if (q.noRetweets === true) rest.push('-filter:nativeretweets');

  // 13. lang:
  const lang = text(q.lang).toLowerCase();
  if (lang !== '') {
    if ((SEARCH_LANGS as readonly string[]).includes(lang)) rest.push(`lang:${lang}`);
    else err('lang', `"${lang}" is not a language X search accepts — it would return nothing.`);
  }

  // 14. since: / until:
  const since = text(q.since);
  const until = text(q.until);
  const sinceFault = since === '' ? null : dateFault(since);
  const untilFault = until === '' ? null : dateFault(until);
  if (sinceFault) err('since', sinceFault);
  else if (since !== '') rest.push(`since:${since}`);
  if (untilFault) err('until', untilFault);
  else if (until !== '') rest.push(`until:${until}`);
  if (!sinceFault && !untilFault && since !== '' && until !== '' && until < since) {
    err('until', `until (${until}) is before since (${since}) — that window is empty.`);
  }

  // A search needs something to MATCH. Floors and filters narrow a result set;
  // on their own they ask for the firehose minus a bit of it. Raised only when
  // no matcher was attempted — when one was and it failed validation, the
  // per-field error above already says so and a second one would just confuse.
  const attempted =
    allTerms.length > 0 ||
    terms(q.any).length > 0 ||
    terms(q.phrases).length > 0 ||
    text(q.from) !== '' ||
    text(q.to) !== '' ||
    terms(q.mentions).length > 0 ||
    terms(q.hashtags).length > 0;
  if (!attempted) {
    err(
      'query',
      rest.length === 0
        ? 'Empty search — add a keyword, phrase, handle or hashtag.'
        : "Filters and floors narrow a search, they don't find one — add a keyword, phrase, handle or hashtag.",
    );
  }

  const query = [...matchers, ...rest].join(' ');
  const overLimit = query.length > MAX_QUERY_LENGTH;
  if (overLimit) {
    err('query', `${query.length} characters — X search takes at most ${MAX_QUERY_LENGTH}.`);
  }

  return { query, length: query.length, overLimit, problems };
}

// ---------------------------------------------------------------- url

export interface SearchUrlOptions {
  /** Overrides `query.sort` — the tab's Top/Latest toggle flips the results tab
   *  without editing (or re-saving) the hunt. */
  sort?: SearchSort;
}

/** The Open-in-X hand-off. `null` iff the compile has any error, so the type
 *  system carries the refuse-before-run gate rather than a caller remembering
 *  to check. `f=live` unless the effective sort says `top`. */
export function searchUrl(q: SearchQuery, opts?: SearchUrlOptions): string | null {
  const compiled = compileSearchQuery(q);
  if (compiled.problems.some((p) => p.level === 'error')) return null;
  const sort = opts?.sort ?? q.sort ?? 'live';
  return `https://x.com/search?q=${encodeURIComponent(compiled.query)}&f=${sort}`;
}
