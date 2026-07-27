// Deterministic pre-publish coach: pure checks + a 0-100 score over draft text.
//
// Canonical home (§7.3): lives in src/shared/, zero-dependency and IIFE-safe
// (§7.26) so the extension consumes it via a re-export shim (arrives with SC.3)
// and the content script can inline it. No imports, no store reads — the
// lexicon arrives as an ARGUMENT (SC.7 fills it from the active niche +
// channels; the default is deliberately neutral, decision 7).
//
// Provenance: re-implemented from the rule inventory in
// evals/x-builder-static-engine-analysis.md (§L1 checks, §L2 aggregation).
// creynir/x-builder ships no LICENSE (default all rights reserved); the rules
// themselves are unprotectable facts ("cap hashtags at 2", "15 raw lines
// triggers show-more") but every regex, list and label here is written fresh —
// nothing is transcribed.
//
// The score is a FLOOR that catches own-goals, never a lift: x-builder's own
// architecture doc concedes writing quality is nearly uncorrelated with
// impressions. No surface may sort, gate, block or refuse on it (decision 4).

export type CoachStatus = 'pass' | 'nudge' | 'fix';
export type CoachGroup = 'hygiene' | 'craft' | 'signal';
export type CoachBand = 'top' | 'ship' | 'almost' | 'rework';

export interface CoachCheck {
  id: string;
  group: CoachGroup;
  status: CoachStatus;
  label: string;
  why?: string;
}

export interface CoachCounts {
  pass: number;
  nudge: number;
  fix: number;
}

export interface CoachResult {
  score: number;
  band: CoachBand;
  checks: CoachCheck[];
  counts: CoachCounts;
}

export interface CoachLexicon {
  specificTerms: string[]; // domain words that count as concrete detail
  tribeTerms: string[]; // audience vocatives that count as a hook ("founders,")
}

// Neutral on purpose: a niche-less coach is still right about platform and
// prose facts (em-dash, show-more, hedges); audience facts arrive via SC.7.
export const DEFAULT_LEXICON: CoachLexicon = { specificTerms: [], tribeTerms: [] };

export const COACH_DISCLAIMER =
  'Signals, not verdicts — 60+ reads ship-ready; the goal is the post, not the score.';

export const COACH_BAND_LABEL: Record<CoachBand, string> = {
  top: 'top tier',
  ship: 'ship it',
  almost: 'almost there',
  rework: 'rework',
};

// ---------------------------------------------------------------------------
// Facts — computed once; no rule re-splits the text.

interface DraftFacts {
  trimmed: string;
  lower: string;
  rawLines: string[]; // split on \n after trim — blank lines count (show-more counts rendered lines)
  contentLines: string[]; // non-empty, trimmed
  firstLine: string; // lowercased first content line ('' when none)
  lastLine: string; // lowercased last content line
  wordCount: number; // tokens containing at least one letter/digit ("—" is not a word)
  charCount: number;
  hasDigit: boolean;
  hasAnchor: boolean; // digit | % | $ | lexicon specific term
  firstPersonProof: boolean; // first person + (proof verb | number)
  paragraphCount: number; // blank-line-separated blocks
  isReply: boolean;
  lexicon: CoachLexicon;
}

const FIRST_PERSON = /\b(i|i'm|i've|i'll|my|mine|we|we're|we've|our)\b/i;
const PROOF_VERBS =
  /\b(built|build|shipped|ship|grew|made|wrote|launched|launch|sold|tested|spent|measured|cut|tried|ran|hit|earned|learned|deleted|fixed)\b/i;

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Word-boundary term match over lowercased text (\b breaks on apostrophes and
// "?"-final terms, so boundaries are non-word-or-edge instead).
function hasTerm(lower: string, term: string): boolean {
  return new RegExp(`(^|[^a-z0-9])${escapeRe(term)}([^a-z0-9]|$)`, 'i').test(lower);
}

function findTerm(lower: string, terms: readonly string[]): string | null {
  for (const t of terms) {
    if (hasTerm(lower, t)) return t;
  }
  return null;
}

function countWords(line: string): number {
  return line.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
}

function computeFacts(trimmed: string, lexicon: CoachLexicon, isReply: boolean): DraftFacts {
  const lower = trimmed.toLowerCase();
  const rawLines = trimmed.split('\n');
  const contentLines = rawLines.map((l) => l.trim()).filter((l) => l.length > 0);
  const hasDigit = /\d/.test(trimmed);
  const hasAnchor =
    hasDigit || /[%$€]/.test(trimmed) || lexicon.specificTerms.some((t) => hasTerm(lower, t));
  let paragraphCount = 0;
  let inBlock = false;
  for (const line of rawLines) {
    const filled = line.trim().length > 0;
    if (filled && !inBlock) paragraphCount += 1;
    inBlock = filled;
  }
  return {
    trimmed,
    lower,
    rawLines,
    contentLines,
    firstLine: (contentLines[0] ?? '').toLowerCase(),
    lastLine: (contentLines[contentLines.length - 1] ?? '').toLowerCase(),
    wordCount: countWords(trimmed),
    charCount: trimmed.length,
    hasDigit,
    hasAnchor,
    firstPersonProof: FIRST_PERSON.test(lower) && (PROOF_VERBS.test(lower) || hasDigit),
    paragraphCount,
    isReply,
    lexicon,
  };
}

// ---------------------------------------------------------------------------
// Rules — each a pure predicate over the facts. null = not applicable
// (isReply relaxes the craft group: a reply needs no hook or breathing room).

type Rule = (f: DraftFacts) => CoachCheck | null;

function mk(
  id: string,
  group: CoachGroup,
  status: CoachStatus,
  label: string,
  why?: string,
): CoachCheck {
  return why === undefined ? { id, group, status, label } : { id, group, status, label, why };
}

// --- hygiene (13) ----------------------------------------------------------

const BUZZWORDS = [
  'synergy',
  'synergies',
  'leverage',
  'leveraging',
  'circle back',
  'move the needle',
  'game-changer',
  'game changer',
  'disrupt',
  'disrupting',
  'disruption',
  'paradigm',
  'best-in-class',
  'thought leader',
  'thought leadership',
  'value-add',
  'low-hanging fruit',
  'win-win',
] as const;

const AI_TELLS = [
  'delve',
  'delving',
  'tapestry',
  'realm of',
  'embark on',
  'unleash',
  'harness the power',
  'navigate the complexities',
  'elevate your',
  "in today's fast-paced",
  "it's important to note",
  'furthermore',
  'moreover',
  'in conclusion',
] as const;

const WEAK_CLOSERS = [
  'thoughts?',
  'agree?',
  "who's with me?",
  'am i right?',
  'let that sink in',
  'let that sink in.',
] as const;

const WEAK_OPENERS = ['just ', 'honestly', 'i think', 'in my opinion', 'imo ', 'imo,'] as const;

const HEDGES = [
  'maybe',
  'perhaps',
  'might',
  'probably',
  'possibly',
  'arguably',
  'somewhat',
  'sort of',
  'kind of',
  'seems',
  'i guess',
  'i think',
  'a bit',
] as const;

// Acronyms that read as vocabulary, not shouting (≥3 letters only — the caps
// regex never sees 2-letter words like AI or UX).
const CAPS_ALLOWED = new Set([
  'AMA',
  'API',
  'ARR',
  'ASAP',
  'CEO',
  'CFO',
  'COO',
  'CSS',
  'CTA',
  'CTO',
  'DIY',
  'ETA',
  'FAQ',
  'FYI',
  'GPT',
  'HTML',
  'HTTP',
  'HTTPS',
  'ICYMI',
  'IDK',
  'IMO',
  'KPI',
  'LLM',
  'LOL',
  'MVP',
  'NGL',
  'NYC',
  'PDF',
  'POV',
  'PSA',
  'ROI',
  'SEO',
  'SQL',
  'TBH',
  'TIL',
  'URL',
  'USA',
  'USD',
  'UTC',
]);

const substance: Rule = (f) => {
  if (f.wordCount < 4) {
    return mk(
      'substance',
      'hygiene',
      'fix',
      'Add substance — under 4 words reads as a stray fragment, not a post.',
    );
  }
  if (f.wordCount < 7) {
    return mk(
      'substance',
      'hygiene',
      'nudge',
      'Thin — under 7 words needs every one of them to earn the slot.',
    );
  }
  return mk('substance', 'hygiene', 'pass', 'Enough substance to stand alone.');
};

const emDash: Rule = (f) =>
  /[—–]/.test(f.trimmed)
    ? mk(
        'em_dash',
        'hygiene',
        'nudge',
        'Drop the em-dash: a period or a comma reads more human on X.',
      )
    : mk('em_dash', 'hygiene', 'pass', 'No em-dashes.');

const weakCloser: Rule = (f) => {
  const hit = WEAK_CLOSERS.find((c) => f.lower.endsWith(c));
  return hit
    ? mk(
        'weak_closer',
        'hygiene',
        'nudge',
        `Cut the canned "${hit}" closer — it reads as reply-farming; ask something specific instead.`,
      )
    : mk('weak_closer', 'hygiene', 'pass', 'No canned closer.');
};

const buzzwords: Rule = (f) => {
  const hit = findTerm(f.lower, BUZZWORDS);
  return hit
    ? mk('buzzwords', 'hygiene', 'nudge', `Corporate buzzword ("${hit}") — say the plain thing.`)
    : mk('buzzwords', 'hygiene', 'pass', 'No corporate buzzwords.');
};

const aiTells: Rule = (f) => {
  const hit = findTerm(f.lower, AI_TELLS);
  return hit
    ? mk('ai_tells', 'hygiene', 'nudge', `AI-tell phrase ("${hit}") — rewrite it in your voice.`)
    : mk('ai_tells', 'hygiene', 'pass', 'No AI-tell phrases.');
};

const hashtags: Rule = (f) => {
  const count = (f.trimmed.match(/#[\p{L}\p{N}_]+/gu) ?? []).length;
  return count > 2
    ? mk('hashtags', 'hygiene', 'nudge', `${count} hashtags — cap at 2; more reads as spam.`)
    : mk('hashtags', 'hygiene', 'pass', 'Hashtags under control.');
};

const allCaps: Rule = (f) => {
  const caps = f.trimmed
    .split(/\s+/)
    .map((w) => w.replace(/^[^A-Za-z]+|[^A-Za-z]+$/g, ''))
    .filter((w) => /^[A-Z]{3,}$/.test(w) && !CAPS_ALLOWED.has(w));
  return caps.length >= 2
    ? mk(
        'all_caps',
        'hygiene',
        'nudge',
        `Ease off the caps lock (${caps.slice(0, 3).join(', ')}) — shouting reads as spam.`,
      )
    : mk('all_caps', 'hygiene', 'pass', 'No shouting.');
};

const spammyPunct: Rule = (f) =>
  /(!{2,}|\?{2,}|!\?|\?!)/.test(f.trimmed)
    ? mk(
        'spammy_punct',
        'hygiene',
        'nudge',
        'Stacked punctuation (!!, ?!) — one mark carries more.',
      )
    : mk('spammy_punct', 'hygiene', 'pass', 'Punctuation clean.');

const weakOpener: Rule = (f) => {
  const hit = WEAK_OPENERS.find((o) => f.firstLine.startsWith(o));
  return hit
    ? mk(
        'weak_opener',
        'hygiene',
        'nudge',
        `Weak opener ("${hit.trim()}") — it gives the reader permission to scroll past.`,
      )
    : mk('weak_opener', 'hygiene', 'pass', 'Opener commits.');
};

const oneBreath: Rule = (f) =>
  f.contentLines.length === 1 && f.wordCount >= 25
    ? mk(
        'one_breath',
        'hygiene',
        'nudge',
        'One unbroken block — split it into lines so it can breathe.',
      )
    : mk('one_breath', 'hygiene', 'pass', 'Not a single-breath wall.');

const showMore: Rule = (f) => {
  const n = f.rawLines.length;
  if (n >= 15) {
    const cut = n - 14;
    return mk(
      'show_more',
      'hygiene',
      'fix',
      `Cut ${cut} line${cut === 1 ? '' : 's'} — 15 raw lines hides the post behind "show more"; 14 shows in full.`,
      'A platform mechanic, not a taste rule: the fold costs real reach.',
    );
  }
  return mk('show_more', 'hygiene', 'pass', 'Under the show-more fold.');
};

const wordCount: Rule = (f) =>
  f.wordCount > 30
    ? mk(
        'word_count',
        'hygiene',
        'nudge',
        `${f.wordCount} words — the punchiest posts land under 30; cut until it hurts.`,
      )
    : mk('word_count', 'hygiene', 'pass', 'Tight enough.');

const hedges: Rule = (f) => {
  let count = 0;
  for (const h of HEDGES) {
    const matches = f.lower.match(new RegExp(`(^|[^a-z0-9])${escapeRe(h)}([^a-z0-9]|$)`, 'gi'));
    count += matches ? matches.length : 0;
  }
  return count > 2
    ? mk(
        'hedges',
        'hygiene',
        'nudge',
        `${count} hedges — pick a position; a hedged claim reads as no claim.`,
      )
    : mk('hedges', 'hygiene', 'pass', 'Position held, not hedged.');
};

// --- craft (7) ---------------------------------------------------------------

const hookOpener: Rule = (f) => {
  if (f.isReply) return null; // a reply lands mid-conversation; no hook needed
  const line = f.firstLine;
  const vocative = f.lexicon.tribeTerms.some(
    (t) => line.startsWith(`${t.toLowerCase()},`) || line.startsWith(`${t.toLowerCase()}:`),
  );
  const hooked =
    /\?$/.test(line) ||
    /\d/.test(line) ||
    /^(how |why |what |when |stop |never |nobody |everyone |most people|the real |here's |unpopular|i |i'm|i've|my |we |after )/.test(
      line,
    ) ||
    line.endsWith(':') ||
    vocative;
  return hooked
    ? mk('hook_opener', 'craft', 'pass', 'First line hooks.')
    : mk(
        'hook_opener',
        'craft',
        'nudge',
        'Flat opener — lead with the number, the claim, or the question; line one decides the scroll.',
      );
};

const tension: Rule = (f) =>
  /\b(but|yet|however|instead|vs|versus|while|until|unless|not|stop)\b/i.test(f.lower)
    ? mk('tension', 'craft', 'pass', 'Has a turn or contrast.')
    : mk(
        'tension',
        'craft',
        'nudge',
        'No turn — add the contrast ("X, not Y") that makes it worth finishing.',
      );

const concreteDetail: Rule = (f) =>
  f.hasAnchor
    ? mk('concrete_detail', 'craft', 'pass', 'Concrete detail present.')
    : mk(
        'concrete_detail',
        'craft',
        'nudge',
        'No concrete detail — a number, a name, or a before/after beats an adjective.',
      );

const quotable: Rule = (f) => {
  const punchy = (f.contentLines.length === 1 && f.wordCount <= 12) || countWords(f.lastLine) <= 8;
  return punchy
    ? mk('quotable', 'craft', 'pass', 'Quotable shape.')
    : mk(
        'quotable',
        'craft',
        'nudge',
        'Not quotable — end on a line short enough to screenshot (8 words or fewer).',
      );
};

const valueSignal: Rule = (f) => {
  const practical =
    /\b(how to|here's how|steps?|checklist|template|use this|try this|start with|do this)\b/i.test(
      f.lower,
    );
  const insight =
    /\b(learned|realized|lesson|mistake|truth|nobody tells|counterintuitive|turns out)\b/i.test(
      f.lower,
    );
  const proof = f.hasDigit && PROOF_VERBS.test(f.lower);
  const humor = /\b(lol|lmao|joke)\b/i.test(f.lower) || f.trimmed.includes('😂');
  return practical || insight || proof || humor
    ? mk('value_signal', 'craft', 'pass', 'Delivers value (insight, practice, proof, or humor).')
    : mk(
        'value_signal',
        'craft',
        'nudge',
        'No clear value — teach, prove, or amuse; a post that does none is a diary entry.',
      );
};

const breathingRoom: Rule = (f) => {
  if (f.isReply) return null; // replies are short; spacing rules don't apply
  let crowded = false;
  for (let i = 0; i < f.rawLines.length - 1; i++) {
    const cur = f.rawLines[i];
    const next = f.rawLines[i + 1];
    if (cur !== undefined && next !== undefined && cur.trim() && next.trim()) {
      crowded = true;
      break;
    }
  }
  return crowded
    ? mk('breathing_room', 'craft', 'nudge', 'Crowded lines — put a blank line between thoughts.')
    : mk('breathing_room', 'craft', 'pass', 'Breathing room between thoughts.');
};

const endsQuestion: Rule = (f) =>
  /\?\s*$/.test(f.trimmed)
    ? mk('ends_question', 'craft', 'pass', 'Ends on a question.')
    : mk(
        'ends_question',
        'craft',
        'nudge',
        'Statement ending — a question at the end invites the reply you want.',
      );

// --- signal (9) --------------------------------------------------------------

const CURIOSITY_BAIT = [
  "you won't believe",
  'what if i told you',
  'blow your mind',
  'something big',
  'big news',
  'stay tuned',
  "i can't say much",
  'wait for it',
  'this will change everything',
] as const;

const answerableQuestion: Rule = (f) => {
  const questions = (f.trimmed.match(/\?+/g) ?? []).length;
  if (questions >= 3) {
    return mk(
      'answerable_question',
      'signal',
      'fix',
      `${questions} questions stacked — nobody answers a quiz; keep the one you want answered.`,
    );
  }
  if (questions === 2) {
    return mk(
      'answerable_question',
      'signal',
      'nudge',
      'Two questions — pick the one you actually want answered.',
    );
  }
  return mk('answerable_question', 'signal', 'pass', 'At most one clear question.');
};

const vagueCuriosity: Rule = (f) => {
  const hit = findTerm(f.lower, CURIOSITY_BAIT);
  return hit && !f.hasAnchor
    ? mk(
        'vague_curiosity',
        'signal',
        'fix',
        `Curiosity bait with no payload ("${hit}") — give the concrete detail or cut the tease.`,
      )
    : mk('vague_curiosity', 'signal', 'pass', 'No empty teasing.');
};

const standaloneContext: Rule = (f) => {
  const bare =
    /^(this|that|it)\b/.test(f.firstLine) &&
    countWords(f.firstLine) <= 5 &&
    !/\d/.test(f.firstLine);
  return bare
    ? mk(
        'standalone_context',
        'signal',
        'nudge',
        '"This/that/it" with no subject — a reader landing cold has no idea what changed.',
      )
    : mk('standalone_context', 'signal', 'pass', 'Stands alone without prior context.');
};

const sweepingClaim: Rule = (f) => {
  const sweep = /\b(everyone|nobody|no one|always|never|the only way)\b/i.test(f.lower);
  return sweep && !f.hasDigit && !f.firstPersonProof
    ? mk(
        'sweeping_claim',
        'signal',
        'nudge',
        'Sweeping claim, zero evidence — one number or one lived example makes it credible.',
      )
    : mk('sweeping_claim', 'signal', 'pass', 'Claims carry evidence (or stay scoped).');
};

const profileClick: Rule = (f) =>
  f.firstPersonProof
    ? mk('profile_click', 'signal', 'pass', 'Gives a stranger a reason to click the profile.')
    : mk(
        'profile_click',
        'signal',
        'nudge',
        'No profile-click reason — one line of your own proof beats generic advice.',
        'Profile clicks are a measured outcome column; generic advice earns none.',
      );

const oneIdea: Rule = (f) => {
  const switches = /(also,|another thing|btw|on another note|speaking of|one more thing)/i.test(
    f.lower,
  );
  const sprawl = f.paragraphCount > 4 && f.wordCount > 60;
  return switches || sprawl
    ? mk(
        'one_idea',
        'signal',
        'nudge',
        'More than one idea — split the second thought into its own post.',
      )
    : mk('one_idea', 'signal', 'pass', 'One idea, focused.');
};

const denseLine: Rule = (f) => {
  const longest = f.rawLines.reduce((max, l) => Math.max(max, l.length), 0);
  return longest >= 180
    ? mk(
        'dense_line',
        'signal',
        'nudge',
        `A ${longest}-char line — break it; dense walls lose mobile readers.`,
      )
    : mk('dense_line', 'signal', 'pass', 'No wall-of-text lines.');
};

// Same regex as the createPost guard (invariant #1). The coach SURFACES the
// surcharge; calendar.ts's 400 stays the only enforcement (decision 8).
const urlCost: Rule = (f) => {
  if (!/(^|\s)https?:\/\//i.test(f.trimmed)) {
    return mk('url_cost', 'signal', 'pass', 'No URL surcharge.');
  }
  if (f.isReply) {
    return mk('url_cost', 'signal', 'pass', 'Link in a reply — the $0.015 path.');
  }
  return mk(
    'url_cost',
    'signal',
    'fix',
    'A URL in a standalone post bills $0.20 vs $0.015 — move the link to the first reply (§8.2).',
    'Invariant #1: the calendar guard will 400 this at schedule time anyway.',
  );
};

const mentionDensity: Rule = (f) => {
  const mentions = (f.trimmed.match(/(^|[^\w@])@[A-Za-z0-9_]{1,15}/g) ?? []).length;
  return mentions >= 3
    ? mk(
        'mention_density',
        'signal',
        'nudge',
        `${mentions} @mentions — more than two reads as tag-spam.`,
      )
    : mk('mention_density', 'signal', 'pass', 'Mentions under control.');
};

const RULES: Rule[] = [
  // hygiene
  substance,
  emDash,
  weakCloser,
  buzzwords,
  aiTells,
  hashtags,
  allCaps,
  spammyPunct,
  weakOpener,
  oneBreath,
  showMore,
  wordCount,
  hedges,
  // craft
  hookOpener,
  tension,
  concreteDetail,
  quotable,
  valueSignal,
  breathingRoom,
  endsQuestion,
  // signal
  answerableQuestion,
  vagueCuriosity,
  standaloneContext,
  sweepingClaim,
  profileClick,
  oneIdea,
  denseLine,
  urlCost,
  mentionDensity,
];

// ---------------------------------------------------------------------------
// Score (x-builder §L2 arithmetic, ported as-is — the one part worth keeping):
//   standard = mean(pass 1 / nudge 0.5 / fix 0) over hygiene+craft × 100
//   quality  = 40 + 60 × passRate over signal   (the 40 floor keeps a valid
//              one-liner from collapsing to zero)
//   score    = min(standard, quality)           (weakest link — hygiene alone
//              can't carry a draft past a failed signal group)
// capped at 25 under 4 words / 15 chars, 65 under 7 words / 30 chars.

const CHECK_VALUE: Record<CoachStatus, number> = { pass: 1, nudge: 0.5, fix: 0 };

function toBand(score: number): CoachBand {
  if (score >= 85) return 'top';
  if (score >= 60) return 'ship';
  if (score >= 45) return 'almost';
  return 'rework';
}

export function scoreDraft(
  text: string,
  opts?: { lexicon?: CoachLexicon; isReply?: boolean },
): CoachResult {
  const trimmed = text.trim();
  if (!trimmed) {
    return { score: 0, band: 'rework', checks: [], counts: { pass: 0, nudge: 0, fix: 0 } };
  }

  const facts = computeFacts(trimmed, opts?.lexicon ?? DEFAULT_LEXICON, opts?.isReply === true);
  const checks: CoachCheck[] = [];
  for (const rule of RULES) {
    const check = rule(facts);
    if (check) checks.push(check);
  }

  const standardChecks = checks.filter((c) => c.group !== 'signal');
  const signalChecks = checks.filter((c) => c.group === 'signal');
  const standard =
    (standardChecks.reduce((sum, c) => sum + CHECK_VALUE[c.status], 0) /
      Math.max(standardChecks.length, 1)) *
    100;
  const quality =
    40 +
    60 *
      (signalChecks.filter((c) => c.status === 'pass').length / Math.max(signalChecks.length, 1));

  let score = Math.min(standard, quality);
  if (facts.wordCount < 4 || facts.charCount < 15) {
    score = Math.min(score, 25);
  } else if (facts.wordCount < 7 || facts.charCount < 30) {
    score = Math.min(score, 65);
  }
  score = Math.round(score);

  const counts: CoachCounts = { pass: 0, nudge: 0, fix: 0 };
  for (const c of checks) counts[c.status] += 1;

  return { score, band: toBand(score), checks, counts };
}
