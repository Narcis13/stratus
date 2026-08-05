// The language profile table + script detection — what a reply has to know when
// it is not written in English.
//
// `replyBand.ts` / `cannon.ts`'s third sibling: consumed by BOTH the extension
// (via the re-export shim extension/src/language.ts, inlined into the content
// IIFE by Vite) and the server-side drafting path, so the page and the server can
// never disagree on how long a Japanese reply is allowed to be. Dependency-free
// by contract — this module has ZERO runtime imports (a value import would break
// the IIFE) and reads no settings store: the profile table is CODE, not a knob.
// The `bandThresholds` pattern deliberately does not apply here — "Arabic is
// weight 1" is a fact about X's counter, not a number to recalibrate.
//
// WEIGHTED LENGTH — twitter-text's rule, verbatim (the whole reason this file
// exists). X does not count characters; it counts a weighted sum over
// CODEPOINTS. Weight 1 for codepoints in [0,4351], [8192,8205], [8208,8223],
// [8242,8247]; weight 2 for everything else. The iteration is over codepoints
// (`for (const ch of text)`) — `String.length` counts UTF-16 units, which is the
// bug this replaces: it double-counts every astral codepoint (emoji, rare kanji)
// while under-counting nothing.
//
// The consequence that motivated the whole table, spelled out because it is
// counter-intuitive: **Arabic, Cyrillic, Hebrew and Devanagari all sit inside
// [0,4351] and are therefore weight 1 — a 280-character Arabic reply is exactly
// 280 characters, no length change at all. CJK, Kana and Hangul are weight 2, so
// those languages get ~140 real characters.** A later reader who reasons
// "non-English ⇒ halve the budget" will halve Arabic for no reason and lose half
// the reply. That is what `maxChars` on each profile records: the 280-weight
// budget expressed in that language's OWN characters.
//
// SCRIPT DETECTION is a hint, never an assertion. It votes over letters only —
// digits, whitespace, punctuation and emoji cast no vote — so a Japanese tweet
// quoting "Claude Code" still reads `ja` instead of drifting to Latin. Two rules
// carry all the ambiguity:
//   * Han is SHARED and cannot separate Japanese from Chinese on its own:
//     presence of Hiragana or Katakana ⇒ `ja` (kanji votes fold into Japanese);
//     Han alone ⇒ `zh`; Hangul ⇒ `ko`.
//   * Cyrillic ⇒ `ru` is a coarse call — uk/bg/sr/mk share the script and the
//     table has exactly one Cyrillic member today. If a second one is ever added,
//     detection must stop answering on script alone for that bucket.
// `null` means UNKNOWN, not "English" (§7.11): no letters voted, no script
// cleared a simple majority, or the vote tied. Callers fall through to their
// existing language-less behaviour on `null` — they never coerce a near-miss.

/** Which script a profile owns for detection purposes. `'latin'` profiles are
 *  resolvable by name but are never *detected* — Latin cannot identify a
 *  language on its own, and guessing between es/pt/fr/de/ro would be worse than
 *  answering `null`. */
type ScriptTag = 'japanese' | 'han' | 'hangul' | 'arabic' | 'hebrew' | 'cyrillic' | 'latin';

export interface LanguageProfile {
  /** BCP-47 primary subtag; unique across the table. */
  code: string;
  /** English name, also matched by `resolveLanguageProfile`. */
  name: string;
  /** Extra spellings a caller (or an LLM) might hand us, all matched
   *  case- and space-insensitively. */
  aliases: readonly string[];
  /** The script this profile owns for `detectScript`. */
  script: ScriptTag;
  /** Right-to-left — the drafting surface needs it for `dir`, and a preview that
   *  gets it wrong is unreadable rather than merely ugly. */
  rtl: boolean;
  /** The 280-WEIGHT budget expressed in this language's own characters: 140
   *  where the script is weight 2, 280 where it is weight 1. Never derive this
   *  from "is it English" — see the header. */
  maxChars: number;
  /** This language's own politeness/formality axis, in one sentence. A reply
   *  that picks the wrong register is wrong in a way length limits never catch,
   *  and the axis is different per language — there is no universal "formal". */
  registerAxis: string;
}

/** X's weighted budget for a single post. */
export const MAX_WEIGHTED = 280;

export const LANGUAGE_PROFILES: readonly LanguageProfile[] = [
  {
    code: 'ja',
    name: 'Japanese',
    aliases: ['jpn', 'jp', 'ja-jp', '日本語'],
    script: 'japanese',
    rtl: false,
    maxChars: 140,
    registerAxis:
      'だ・である (plain) / です・ます (polite) / 敬語 (honorific) — pick one level and hold it for the whole reply; mixing levels reads as machine translation.',
  },
  {
    code: 'zh',
    name: 'Chinese',
    aliases: ['zho', 'chi', 'mandarin', 'zh-cn', 'zh-tw', 'zh-hans', 'zh-hant', '中文'],
    script: 'han',
    rtl: false,
    maxChars: 140,
    registerAxis:
      '你 vs 您 for address, and 口语 (colloquial) vs 书面语 (written) diction — a reply mixing 您 with slang reads as a form letter.',
  },
  {
    code: 'ko',
    name: 'Korean',
    aliases: ['kor', 'kr', 'ko-kr', '한국어'],
    script: 'hangul',
    rtl: false,
    maxChars: 140,
    registerAxis:
      '해체 (plain) / 해요체 (polite) / 합니다체 (formal) — speech level is grammaticalised in every verb ending, so it cannot be left unchosen.',
  },
  {
    code: 'ar',
    name: 'Arabic',
    aliases: ['ara', 'arb', 'ar-sa', 'العربية'],
    script: 'arabic',
    rtl: true,
    // Arabic is weight 1: the full 280. Do NOT "correct" this to 140.
    maxChars: 280,
    registerAxis:
      'Modern Standard Arabic (الفصحى) vs a regional dialect (Egyptian / Gulf / Levantine) — MSA reads formal-to-distant, dialect reads native but picks a region.',
  },
  {
    code: 'he',
    name: 'Hebrew',
    aliases: ['heb', 'iw', 'he-il', 'עברית'],
    script: 'hebrew',
    rtl: true,
    maxChars: 280,
    registerAxis:
      'Literary vs spoken register, plus gendered second person (אתה / את) — Hebrew forces a gender choice on direct address that English hides.',
  },
  {
    code: 'ru',
    name: 'Russian',
    aliases: ['rus', 'ru-ru', 'русский'],
    script: 'cyrillic',
    rtl: false,
    maxChars: 280,
    registerAxis: 'The T–V distinction: ты (familiar) vs вы (respectful/plural).',
  },
  {
    code: 'es',
    name: 'Spanish',
    aliases: ['spa', 'castellano', 'es-es', 'es-mx', 'español', 'espanol'],
    script: 'latin',
    rtl: false,
    maxChars: 280,
    registerAxis: 'The T–V distinction: tú (and vos in the Río de la Plata) vs usted.',
  },
  {
    code: 'pt',
    name: 'Portuguese',
    aliases: ['por', 'pt-br', 'pt-pt', 'português', 'portugues'],
    script: 'latin',
    rtl: false,
    maxChars: 280,
    registerAxis:
      'The T–V distinction: tu / você vs o senhor, a senhora — and você is neutral in Brazil but marked in Portugal.',
  },
  {
    code: 'fr',
    name: 'French',
    aliases: ['fra', 'fre', 'fr-fr', 'français', 'francais'],
    script: 'latin',
    rtl: false,
    maxChars: 280,
    registerAxis: 'The T–V distinction: tu vs vous.',
  },
  {
    code: 'de',
    name: 'German',
    aliases: ['deu', 'ger', 'de-de', 'deutsch'],
    script: 'latin',
    rtl: false,
    maxChars: 280,
    registerAxis: 'The T–V distinction: du vs Sie (capitalised, and it governs the verb).',
  },
  {
    code: 'ro',
    name: 'Romanian',
    aliases: ['ro', 'ron', 'rum', 'ro-ro', 'română', 'romana'],
    script: 'latin',
    rtl: false,
    maxChars: 280,
    registerAxis: 'The T–V distinction: tu vs dumneavoastră (and the softer dumneata).',
  },
];

/**
 * X's weighted character count — twitter-text's rule, over CODEPOINTS.
 *
 * Weight 1 for [0,4351] (Latin, Greek, Cyrillic, Hebrew, Arabic, Devanagari, …),
 * [8192,8205], [8208,8223], [8242,8247]; weight 2 for everything else (CJK, Kana,
 * Hangul, emoji). Never use `text.length` for this: it counts UTF-16 units and
 * double-counts astral codepoints.
 */
export function weightedLength(text: string): number {
  let total = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0;
    const light =
      cp <= 4351 ||
      (cp >= 8192 && cp <= 8205) ||
      (cp >= 8208 && cp <= 8223) ||
      (cp >= 8242 && cp <= 8247);
    total += light ? 1 : 2;
  }
  return total;
}

/** Only letters vote — digits, whitespace, punctuation, symbols and emoji are
 *  skipped so quoted English ("Claude Code") cannot swing a Japanese tweet. */
const LETTER = /\p{L}/u;

/** Ordered because Hiragana/Katakana must be tested BEFORE Han: a kana hit is
 *  what disambiguates Japanese from Chinese, and Han alone cannot. */
const SCRIPT_TESTS: readonly (readonly [ScriptTag, RegExp])[] = [
  ['japanese', /\p{Script=Hiragana}|\p{Script=Katakana}/u],
  ['han', /\p{Script=Han}/u],
  ['hangul', /\p{Script=Hangul}/u],
  ['arabic', /\p{Script=Arabic}/u],
  ['hebrew', /\p{Script=Hebrew}/u],
  ['cyrillic', /\p{Script=Cyrillic}/u],
];

/**
 * Guess the language of `text` from its script. A hint, never an assertion.
 *
 * Returns the profile owning the majority script, or `null` when nothing voted,
 * when the leader has no simple majority, or on a tie — `null` means UNKNOWN
 * (§7.11), so the caller keeps its language-less behaviour. Latin-script text
 * always answers `null`: the script cannot pick between es/pt/fr/de/ro.
 */
export function detectScript(text: string): LanguageProfile | null {
  const votes = new Map<ScriptTag, number>();
  let total = 0;

  for (const ch of text) {
    if (!LETTER.test(ch)) continue;
    for (const [tag, re] of SCRIPT_TESTS) {
      if (!re.test(ch)) continue;
      votes.set(tag, (votes.get(tag) ?? 0) + 1);
      total += 1;
      break;
    }
  }
  if (total === 0) return null;

  // Han is shared: kanji belongs to the Japanese vote the moment any kana shows
  // up, and only then. Without this, a kanji-heavy Japanese sentence reads `zh`.
  const kana = votes.get('japanese') ?? 0;
  const han = votes.get('han') ?? 0;
  if (kana > 0 && han > 0) {
    votes.set('japanese', kana + han);
    votes.delete('han');
  }

  let leader: ScriptTag | null = null;
  let best = 0;
  let tied = false;
  for (const [tag, n] of votes) {
    if (n > best) {
      leader = tag;
      best = n;
      tied = false;
    } else if (n === best) {
      tied = true;
    }
  }
  if (leader === null || tied) return null;
  if (best * 2 <= total) return null; // no simple majority

  return LANGUAGE_PROFILES.find((p) => p.script === leader) ?? null;
}

/** Lowercase and strip ALL whitespace, so `'  japanese '` and `'zh Hans'` both
 *  normalize to a table key. */
function normalize(s: string): string {
  return s.toLowerCase().replace(/\s+/g, '');
}

/**
 * Resolve a code / name / alias to a profile, case- and space-insensitively.
 *
 * Returns `null` for anything unrecognized — deliberately NOT a near-miss guess:
 * an unknown string has to fall through to the caller's language-less path
 * rather than silently draft in the wrong language (§7.11).
 */
export function resolveLanguageProfile(input: string | null | undefined): LanguageProfile | null {
  if (!input) return null;
  const key = normalize(input);
  if (!key) return null;
  for (const p of LANGUAGE_PROFILES) {
    if (normalize(p.code) === key || normalize(p.name) === key) return p;
    for (const a of p.aliases) {
      if (normalize(a) === key) return p;
    }
  }
  return null;
}
