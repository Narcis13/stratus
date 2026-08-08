// The reply-mode table + topic detection — what a reply has to know about the
// ROOM it is being written into.
//
// `language.ts`'s twin, and built to the same contract: consumed by BOTH the
// server-side drafting path and (through a tsconfig shim) the extension build,
// dependency-free, no settings store, `null` means UNKNOWN. Where `language.ts`
// answers "what alphabet is this room speaking", this answers "what KIND of room
// is this" — and the two are orthogonal: a Japanese grief post is `ja` +
// `wholesome`, an English Reuters wire is `null` + `news`.
//
// WHY THIS EXISTS, in one measurement. Of 182 own replies harvested
// 2026-08-06→07, the 42 whose parent sat in my lane (dev/AI/build/SaaS) averaged
// 27 views; the 140 off-lane parents averaged 229 and carried **96.5% of the
// day's reply impressions**. The drafting prompt was written for the 3.5%. It
// stamps a solopreneur/programming/build-in-public persona unconditionally and
// then orders "specific beats generic", so under a cat video or a news wire the
// model has exactly one well of specificity available — the persona — and it
// bridges to it. "Private airport security means more code for booking flows
// that actually work" under a 27k-view Reuters story earned 2 views. That is not
// a reply, it is an advert, and this module is what lets the prompt know the
// difference before it drafts.
//
// `personaUse` is the field the whole table exists for, and the three levels are
// deliberately distinguishable (in SQL, later, when there are enough rows to read
// them):
//   * `full`   — biography and lane nouns ARE the material. Use them hard.
//   * `stance` — I may hold an opinion in first person, but no lane nouns (code,
//                ship, build, SaaS, solopreneur, AI, marketing, startup) and no
//                biography. This is what a news post needs; collapsing it into
//                `off` loses every take, into `full` loses the whole point.
//   * `off`    — no first-person claim about my work at all. The post is the
//                material; I am not.
//
// EVERY NUMBER AND EVERY `moves` LINE IS AN OPENING GUESS (§7.19). The character
// ranges come from the winners (the top five replies of the day are 34–110
// characters), not from a regression — and the tempting 40–79 band's 339 avg
// yield vs the 80–139 band's 99 is **parent-size confounded** (45,280 avg parent
// views vs 6,066), so it is not evidence and it is deliberately not encoded here.
// The `moves` lines are argued from scanning mechanics and are the softest thing
// in the table: at n=182 the opening-word crosstab does not separate on capture
// rate (2,309–3,845 bp across all four opening classes, with the best RAW group
// scoring the WORST capture). Recalibrate at ≥30 harvested replies per mode from
// `loadOwnReplyPerformance`, never by feel.
//
// DETECTION is a hint, never an assertion, and it is the LAST resort: the
// resolver that consumes it tries an explicit override, the curate pass's
// classification and the roster pin (`cannon_targets.topic`) first, because the
// Cannon doctrine is *camp a roster* — @fabrizioromano is always football,
// @9to5mac is always Apple news — and a pin is both free and exact. Detection
// scores weighted keyword hits per mode and answers `null` unless one mode
// reaches 2 points with a strict lead. `null` is UNKNOWN, not `general`: the
// caller maps unknown to `general` (§7.11), so a near-miss never silently ships a
// register the post did not earn.

/** How much of the persona block the drafter may use. See the header. */
export type PersonaUse = 'full' | 'stance' | 'off';

export type ReplyModeId = 'expertise' | 'hot-take' | 'news' | 'wholesome' | 'banter' | 'general';

/**
 * The angle union, canonical home.
 *
 * `observation` (one specific noticed detail, no argument — the wholesome/banter
 * workhorse) and `question` (a genuine question the OP would want to answer)
 * join the original three because `contrarian` and `debate` under a funeral post
 * or a cat video are a report risk and forfeit the strongest ranking signal
 * there is: the OP replying to you.
 *
 * `story` is deliberately absent. A one-line lived parallel is the strongest
 * move in the reference templates, but under `personaUse: 'off'` it would
 * require inventing a life, and the persona block's hardest rule is that a
 * fabricated anecdote is worse than no specific at all.
 */
export const REPLY_ANGLES = ['extends', 'contrarian', 'debate', 'observation', 'question'] as const;
export type ReplyAngle = (typeof REPLY_ANGLES)[number];

/**
 * The day the vocabulary above went from three angles to five (RC.4) — a HARD
 * boundary for every angle crosstab, and the reason it is a constant rather than
 * a sentence in a comment: the Playbook renders it.
 *
 * Before this date `observation` and `question` were unrepresentable, so every
 * reply that would have been one was drafted as `extends` (or as a `contrarian`
 * under a post that had no argument to take). An `extends` cell spanning the
 * boundary is therefore two different populations averaged together, and the
 * post-boundary angles start at n=0 by construction — the same trap ML.6 flagged
 * for the language cells, second instance. Split by date; never compare across
 * it, and never read a young `observation` cell as "the new angle is losing".
 */
export const ANGLE_VOCABULARY_WIDENED_AT = '2026-08-08';

export interface ReplyMode {
  id: ReplyModeId;
  /** Extra spellings a caller (a panel override, an LLM's classification, a
   *  roster pin typed by hand) might hand us, matched case- and
   *  space-insensitively by `resolveModeId`. */
  aliases: readonly string[];
  /** How much of the persona block is usable here. The field this table exists
   *  for — see the header. */
  personaUse: PersonaUse;
  /** Ordered: the first is the primary pick. Narrows the structured-output
   *  schema, so an angle absent here is unrepresentable rather than merely
   *  discouraged. */
  angles: readonly ReplyAngle[];
  /** Target floor for a variant, in characters. Opening guess (§7.19). */
  minChars: number;
  /** Target ceiling for a variant, in characters. Opening guess (§7.19). */
  maxChars: number;
  /** One line: how this room talks. The commonest failure the corpus shows is
   *  one flat middlebrow voice under every kind of post. */
  registerNote: string;
  /** The opening move for this room, concrete. What a hook IS differs per room,
   *  and at a 40–90 character target the hook and the reply are the same words. */
  moves: string;
}

/** The fallback every caller falls through to. `detectReplyMode` never returns
 *  it — resolving unknown to `general` is the RESOLVER's job, not detection's. */
export const GENERAL_MODE: ReplyMode = {
  id: 'general',
  aliases: ['unknown', 'fallback', 'other', 'default'],
  // Unresolvable is `general`, never a guess (§7.11). `stance` because a take is
  // safe under almost anything while a biography is not.
  personaUse: 'stance',
  angles: ['extends', 'observation', 'contrarian'],
  minChars: 40,
  maxChars: 140,
  registerNote:
    'Neutral and plain. Match whatever the post is already doing rather than importing a voice.',
  moves: 'Open on the noun the post is actually about, then the turn.',
};

export const REPLY_MODES: readonly ReplyMode[] = [
  {
    id: 'expertise',
    aliases: ['dev', 'tech', 'ai', 'build', 'lane', 'programming', 'business', 'saas', 'marketing'],
    // The only mode where the persona is material rather than background.
    personaUse: 'full',
    angles: ['extends', 'contrarian', 'debate'],
    minChars: 80,
    maxChars: 200,
    registerNote:
      'Peer-to-peer shop talk. Concrete nouns, no throat-clearing, no credentialing — jargon is welcome here and nowhere else in this table.',
    moves:
      'Open on the mechanism or the counter-number. The credential lives in the specificity; never state it. "Postgres does this with a partial index and 4 lines", not "As someone who has coded 30 years…".',
  },
  {
    id: 'hot-take',
    // No 'hottake'/'hot take' here: `normalizeKey` already folds both onto the
    // id, and a duplicate key is asserted against.
    aliases: ['opinion', 'take', 'relationships', 'culture', 'money', 'self-improvement'],
    personaUse: 'off',
    angles: ['contrarian', 'debate', 'extends'],
    minChars: 60,
    maxChars: 120,
    registerNote:
      'An argument in a bar, not a seminar. A first-person opinion is welcome; my job is not.',
    moves:
      'Open on the contradiction, inside the first four words. "Five years apart isn\'t predatory." Never open by conceding.',
  },
  {
    id: 'news',
    aliases: ['wire', 'reported', 'event', 'launch', 'headline', 'markets', 'finance'],
    // A wire story earns a take, never a biography.
    personaUse: 'stance',
    angles: ['observation', 'extends', 'question'],
    minChars: 50,
    maxChars: 110,
    registerNote:
      'Dry and flat. The room is already informed, so restating the headline is dead air.',
    moves:
      'Open on the second-order consequence. The event is already in the post; restating it is what killed "i track migration stories the same way I track model updates" — 22 views on a 102k parent.',
  },
  {
    id: 'wholesome',
    aliases: ['warm', 'animals', 'kids', 'grief', 'art', 'aesthetic', 'motivation', 'wins'],
    personaUse: 'off',
    angles: ['observation', 'question', 'extends'],
    minChars: 30,
    maxChars: 90,
    registerNote:
      'Warm and small. No advice, no analysis, no lesson drawn. Notice one thing and say it.',
    moves:
      'Open on the specific detail: a timestamp, a body part, a corner of the frame, a number from the post. Nothing else proves I looked. "The ear twitch at 0:04." Never an adjective, never an emotion word.',
  },
  {
    id: 'banter',
    aliases: ['football', 'soccer', 'sports', 'meme', 'memes', 'chaos', 'joke', 'no-context'],
    personaUse: 'off',
    angles: ['observation', 'extends'],
    minChars: 20,
    maxChars: 60,
    registerNote:
      'Fast and loose. Lowercase, fragments, no punctuation discipline. If it needs a setup it is already too long.',
    moves: 'Open on the punchline. No setup at all — the reply is the last four words of a joke.',
  },
  GENERAL_MODE,
];

/** Universal opening bans, shared by every mode. Prose for the prompt, not a
 *  gate — see the header on why the opening rules ship as guesses. */
export const OPENING_BANS: readonly string[] = [
  'Never open with "I" or "my" unless the reply IS the anecdote — a self-referential opening tells a scanner the reply is about me, and they scroll.',
  'Never open with a subordinate clause ("While…", "Although…", "Given that…") — the scanner leaves before the main clause arrives.',
  'Never open with determiner + abstraction ("The reality of…", "This kind of…", "That moment when…").',
  'Never open by restating the post.',
];

// ---------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------

// Two hard overrides, checked before scoring, because they are the only signals
// in the corpus precise enough to beat a keyword vote outright: an explicit wire
// prefix, and a news-agency short link. Both fire even when the story is about
// my lane — "JUST IN: OpenAI raises" is a wire story, not shop talk, and the
// register a wire story wants is `stance`, not a biography.
// `update:` is deliberately NOT here: it is a build-in-public prefix at least as
// often as a wire one, and forcing `news`/`stance` onto "Update: shipped v2"
// loses the persona on exactly the post that earns it.
const NEWS_PREFIX_RE = /(^|[\s|"“(])(just in|breaking(?: news)?|developing|exclusive)\s*:/i;
const NEWS_DOMAIN_RE =
  /\b(reut\.rs|reuters\.com|apnews\.com|ap\.org|bloomberg\.com|cnbc\.com|ft\.com|wsj\.com|nytimes\.com|bbc\.(?:com|co\.uk)|axios\.com|cnn\.com|9to5mac\.com|theverge\.com|techcrunch\.com)\b/i;

interface ModeMarkers {
  id: Exclude<ReplyModeId, 'general'>;
  /** Category-defining. Weight 2 — one of these alone clears the floor. */
  strong: readonly string[];
  /** Supporting context. Weight 1 — two of these clear the floor together. */
  weak: readonly string[];
}

// The marker tables are drawn from the actual harvested parent distribution
// (`harvest_rows.orig_text`), not imagined: the CJK entries exist because the
// handles that pay — @hiiragi2280, @yoshi_majime, @dokuneee — post raw Japanese
// since the harvester stopped translating, and an English-only lexicon would
// answer `null` on the single highest-yield segment in the corpus.
const MODE_MARKERS: readonly ModeMarkers[] = [
  {
    id: 'expertise',
    strong: [
      'saas',
      'mrr',
      'arr',
      'api',
      'llm',
      'postgres',
      'sqlite',
      'typescript',
      'javascript',
      'python',
      'github',
      'repo',
      'devops',
      'kubernetes',
      'frontend',
      'backend',
      'codebase',
      'compiler',
      'regex',
      'cli',
      'ide',
      'mcp',
      'claude code',
      'vibe coding',
      'vibe coder',
      'indie hacker',
      'bootstrapped',
      'open source',
      'prompt engineering',
      'turbo pascal',
      'foxpro',
      'delphi',
      'sysadmin',
      'startup',
      'founder',
      'solopreneur',
      'developer',
      'engineer',
      'engineering',
      'programmer',
      'programming',
      'landing page',
      'copywriting',
      'seo',
      // `ai` earns strong weight because in this corpus it is the single most
      // lane-defining token there is, and `\bai\b` almost never fires by
      // accident. `agent` deliberately stays WEAK: "free agent" is a football
      // post, and a strong `agent` would drag those into `expertise`.
      'ai',
    ],
    weak: [
      'agent',
      'model',
      'code',
      'coding',
      'dev',
      'build',
      'building',
      'ship',
      'shipping',
      'shipped',
      'product',
      'launch',
      'marketing',
      'funnel',
      'revenue',
      'customer',
      'user',
      'subscription',
      'pricing',
      'software',
      'app',
      'tool',
      'stack',
      'deploy',
      'server',
      'database',
      'bug',
      'feature',
      'automation',
      'workflow',
      'token',
      'prompt',
      'gpt',
      'grok',
      'gemini',
      'openai',
      'anthropic',
      'chatgpt',
      'claude',
      'opus',
      'copilot',
      'cursor',
      'training',
      'benchmark',
      'distribution',
      'browser',
      'hackathon',
    ],
  },
  {
    id: 'news',
    strong: [
      'bitcoin',
      'crypto',
      'stocks',
      'crude',
      'inflation',
      'earnings',
      'ipo',
      'bull',
      'bear',
      'rate hike',
      'senate',
      'parliament',
      'election',
      'minister',
      'president',
      'lawsuit',
      'indicted',
      'acquisition',
      'acquires',
      'confirms',
      'announces',
    ],
    weak: [
      'gold',
      'oil',
      'fed',
      'index',
      'indicator',
      'yields',
      'market',
      'quarter',
      'billion',
      'million',
      'government',
      'official',
      'police',
      'court',
      'ruling',
      'killed',
      'arrested',
      'report',
      'plans',
      'seeks',
      'terminates',
      'rises',
      'falls',
      'plunge',
      'surge',
      'signed',
      'deal',
    ],
  },
  {
    id: 'hot-take',
    strong: [
      'hot take',
      'unpopular opinion',
      'nobody tells you',
      'change my mind',
      'red flag',
      'masculinity',
      'feminine',
      'predatory',
      'divorce',
      'dating',
      'relationship',
      'girlfriend',
      'boyfriend',
      'marriage',
      'wife',
      'husband',
      'libido',
      'testosterone',
      'romance',
      'romantic',
      'woman',
      'women',
      'high value',
      'self-improvement',
    ],
    weak: [
      'men',
      'man',
      'guys',
      'girls',
      'attractive',
      'money',
      'rich',
      'wealth',
      'broke',
      'success',
      'hustle',
      'grind',
      'habits',
      'lazy',
      'average',
      'society',
      'culture',
      'opinion',
      'overrated',
      'underrated',
      'advice',
      'lesson',
      'life',
      'should',
      'mindset',
      'discipline',
      'confidence',
      'self-esteem',
    ],
  },
  {
    id: 'wholesome',
    strong: [
      'funeral',
      'passed away',
      'rest in peace',
      'grandmother',
      'grandma',
      'grandfather',
      'grandpa',
      'cancer',
      'hospital',
      'wedding',
      'congratulations',
      'newborn',
      'puppy',
      'kitten',
      'cat',
      'dog',
      'baby',
      'kid',
      'child',
      'children',
      'son',
      'daughter',
      'mom',
      'dad',
      'fan art',
      'fanart',
      'illustration',
      'artwork',
      'depression',
      'anxiety',
      'mental health',
      'adjustment disorder',
      'burnout',
      'therapy',
      '葬儀',
      'お葬式',
      '亡くなっ',
      '祖父',
      '祖母',
      '子ども',
      '子供',
      '赤ちゃん',
      '病気',
      '適応障害',
      'うつ病',
      'メンタル',
      'イラスト',
      'ファンアート',
      // Food delight is squarely this room in the Japanese corpus, and it is
      // usually the ONLY marker such a post carries.
      '美味し',
      'おいし',
    ],
    weak: [
      'mother',
      'father',
      'sister',
      'brother',
      'sibling',
      'siblings',
      'family',
      'love',
      'proud',
      'beautiful',
      'cute',
      'wholesome',
      'smile',
      'tears',
      'crying',
      'grief',
      'healing',
      'art',
      'drawing',
      'sketch',
      'photo',
      'sunset',
      'flowers',
      '猫',
      '犬',
      '家族',
      '兄弟',
      '姉妹',
      '涙',
      'かわいい',
      '幸せ',
      'ありがとう',
      '絵',
    ],
  },
  {
    id: 'banter',
    strong: [
      'arsenal',
      'chelsea',
      'liverpool',
      'tottenham',
      'man utd',
      'manchester united',
      'real madrid',
      'barcelona',
      'premier league',
      'champions league',
      'ballon',
      'goalkeeper',
      'striker',
      'midfielder',
      'offside',
      'transfer window',
      'hat-trick',
      'clean sheet',
      'me when',
      'pov',
      'lmao',
      'lmfao',
    ],
    weak: [
      'goal',
      'player',
      'trophy',
      'trophies',
      'squad',
      'lineup',
      'club',
      'match',
      'season',
      'football',
      'soccer',
      'scored',
      'penalty',
      'fixture',
      'bench',
      'manager',
      'coach',
      'lol',
      'bro',
      'meme',
    ],
  },
];

/**
 * A marker made of ASCII only matches on word boundaries with an optional plural
 * `s`/`es` ("goalkeepers" must hit `goalkeeper`); anything else — every CJK entry
 * — matches as a substring, because Japanese has no word boundary to anchor to
 * and `\b` would never fire.
 *
 * The marker is put through `normalizeForMatch` FIRST and its internal spaces
 * become `\s+`. Both halves matter: the haystack is normalized too, so a marker
 * carrying punctuation ("self-esteem", "hat-trick") would otherwise be
 * unmatchable against its own normalized form, and the `\s+` is what lets
 * `rate hike` hit "Rate-Hike".
 */
function markerPattern(marker: string): RegExp {
  const normalized = normalizeForMatch(marker).trim();
  const ascii = /^[ -~]+$/.test(normalized); // printable ASCII, space through tilde
  const escaped = normalized
    .split(/\s+/)
    .map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('\\s+');
  return ascii ? new RegExp(`\\b${escaped}(?:e?s)?\\b`, 'i') : new RegExp(escaped, 'i');
}

interface CompiledMarkers {
  id: Exclude<ReplyModeId, 'general'>;
  strong: readonly RegExp[];
  weak: readonly RegExp[];
}

const COMPILED: readonly CompiledMarkers[] = MODE_MARKERS.map((m) => ({
  id: m.id,
  strong: m.strong.map(markerPattern),
  weak: m.weak.map(markerPattern),
}));

/** Hyphens, slashes, bullets and smart punctuation all become spaces so
 *  "rate-hike" hits `rate hike` and "romance," hits `romance`. Letters, digits
 *  and CJK survive untouched. */
function normalizeForMatch(text: string): string {
  return text.replace(/[^\p{L}\p{N}\s]+/gu, ' ');
}

const STRONG_WEIGHT = 2;
const WEAK_WEIGHT = 1;
/** One strong marker, or two weak ones. Below this the vote is noise. */
const MIN_SCORE = 2;

function byId(id: ReplyModeId): ReplyMode {
  return REPLY_MODES.find((m) => m.id === id) ?? GENERAL_MODE;
}

/**
 * Guess the mode of a parent post from its text. A hint, never an assertion.
 *
 * Returns `null` when nothing scores, when the leader fails to reach `MIN_SCORE`,
 * or on a tie — `null` means UNKNOWN (§7.11), and it is the CALLER that maps
 * unknown to `general`. Never returns `general` itself: "I could not tell" and "I
 * decided this is the neutral room" have to stay distinguishable, because the
 * first is worth fixing with a roster pin and the second is not.
 *
 * Distinct markers are counted, not occurrences, so a post repeating one word
 * twenty times cannot outvote a post that genuinely spans a category.
 */
export function detectReplyMode(text: string): ReplyMode | null {
  if (!text) return null;

  // The two hard overrides run against the RAW text — the URL test needs its
  // dots, and the prefix test needs its colon.
  if (NEWS_PREFIX_RE.test(text) || NEWS_DOMAIN_RE.test(text)) return byId('news');

  const haystack = normalizeForMatch(text);

  let leader: ReplyModeId | null = null;
  let best = 0;
  let second = 0;

  for (const m of COMPILED) {
    let score = 0;
    for (const re of m.strong) if (re.test(haystack)) score += STRONG_WEIGHT;
    for (const re of m.weak) if (re.test(haystack)) score += WEAK_WEIGHT;

    if (score > best) {
      second = best;
      best = score;
      leader = m.id;
    } else if (score > second) {
      second = score;
    }
  }

  if (leader === null || best < MIN_SCORE || best === second) return null;
  return byId(leader);
}

/** Lowercase and strip ALL whitespace, so `'  Hot Take '` and `'hot-take'` both
 *  normalize toward a table key. Hyphens and underscores go too — a roster pin
 *  typed by hand and an LLM's `hot_take` have to land on the same row. */
function normalizeKey(s: string): string {
  return s.toLowerCase().replace(/[\s\-_]+/g, '');
}

/**
 * Resolve an id / name / alias to a mode, case-, space- and hyphen-insensitively.
 *
 * Returns `null` for anything unrecognized — deliberately NOT a near-miss guess.
 * An unknown string has to fall through to the caller's own precedence chain
 * rather than silently draft in the wrong register (§7.11).
 */
export function resolveModeId(input: string | null | undefined): ReplyMode | null {
  if (!input) return null;
  const key = normalizeKey(input);
  if (!key) return null;
  for (const m of REPLY_MODES) {
    if (normalizeKey(m.id) === key) return m;
    for (const a of m.aliases) {
      if (normalizeKey(a) === key) return m;
    }
  }
  return null;
}
