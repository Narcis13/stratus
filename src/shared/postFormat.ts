// Deterministic post-format classifier: one STRUCTURAL label per draft.
//
// Orthogonality contract: pillar = topic, register = tone, angle = reply
// stance, FORMAT = STRUCTURE. Four independent axes — this module never
// reads or implies the other three. The label is measurement metadata
// (§7.19): it feeds Playbook cells (SC.5) and cooldown counters (SC.6),
// never advice — no surface tells the user which format to write. It is
// never stored (SC decision 2): classified at read time from
// posts_published.text / scheduled_posts.text, so a classifier improvement
// retroactively re-labels the entire measured history.
//
// Canonical home (§7.3): src/shared/, zero-dependency and IIFE-safe (§7.26).
// The extension re-export shim arrives with the first panel consumer.
//
// Provenance: re-implemented from the cascade DESCRIPTION in
// evals/x-builder-static-engine-analysis.md §L0. Order is load-bearing —
// declared shapes (would-you-rather, polls) before frame openers (hot take,
// confession, milestone) before ask-markers (CTA) before structural
// fallbacks (list, one-liner, substance). x-builder's 26 formats are
// trimmed to 14 stratus can produce AND accumulate n on — a format nobody
// posts is a permanently empty Playbook cell. Fixtures in the test file are
// hand-labelled real rows of posts_published (136 originals reviewed).
// creynir/x-builder ships no LICENSE; every regex and label here is fresh.

export type PostFormat =
  | 'would_you_rather'
  | 'poll_list'
  | 'binary_choice'
  | 'hot_take'
  | 'confession'
  | 'milestone'
  | 'audience_cta'
  | 'question'
  | 'data_comparison'
  | 'story'
  | 'list'
  | 'one_liner'
  | 'substance'
  | 'other';

/** Cascade order — earlier wins when a draft matches two shapes. */
export const POST_FORMATS: readonly PostFormat[] = [
  'would_you_rather',
  'poll_list',
  'binary_choice',
  'hot_take',
  'confession',
  'milestone',
  'audience_cta',
  'question',
  'data_comparison',
  'story',
  'list',
  'one_liner',
  'substance',
  'other',
];

export const FORMAT_LABELS: Record<PostFormat, string> = {
  would_you_rather: 'Would-you-rather',
  poll_list: 'Poll list',
  binary_choice: 'A-or-B choice',
  hot_take: 'Hot take',
  confession: 'Confession',
  milestone: 'Milestone',
  audience_cta: 'Audience CTA',
  question: 'Question',
  data_comparison: 'Data comparison',
  story: 'Story',
  list: 'List',
  one_liner: 'One-liner',
  substance: 'Substance',
  other: 'Other',
};

// ---------------------------------------------------------------------------
// Normalization. posts_published.text stores X's HTML-escaped entities and
// curly apostrophes; URLs (t.co) are structure-noise, not structure.

const URL_RE = /https?:\/\/\S+/g;

function normalize(text: string): string {
  return text
    .replace(/’/g, "'")
    .replace(/&gt;/g, '>')
    .replace(/&lt;/g, '<')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

// Same word rule as postCoach: a token counts when it carries a letter/digit.
function countWords(line: string): number {
  return line.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
}

// ---------------------------------------------------------------------------
// Branch predicates. Each regex block is owned by exactly one branch below.

const POLL_PROMPT =
  /\b(are you|do you|would you|which|what's your|what is your|prefer|choose|pick|vote)\b/;

const MILESTONE_OPEN =
  /^\$?\d[\d,.]*[km]?\+?\s*(followers?|subscribers?|users?|customers?|sales|downloads|stars|mrr)\b/;
const MILESTONE_HIT_MONEY = /\b(just\s+)?(hit|crossed|passed|reached)\s+(the\s+)?\$\d/;
const MILESTONE_HIT_COUNT =
  /\b(just\s+)?(hit|crossed|passed|reached)\s+[\d,.]+[km]?\s*(followers?|subscribers?|users?|customers?|mrr|sales|downloads|stars)\b/;

const HOT_TAKE_OPEN =
  /^(hot take|unpopular opinion|controversial (take|opinion)|harsh truth|nobody wants to (hear|say) (this|it))/;

const CONFESSION_OPEN = /^(i'll admit|time to be honest|honest truth)/;

// An explicit ask for an audience action. Whole-text markers; the
// standalone-closer ("Go." / "Your turn.") and line-start markers ("Mine:",
// "Name one…") are checked per line to avoid mid-sentence false fires
// ("Mine still hurts", "in one sentence").
const CTA_MARKERS: readonly RegExp[] = [
  /\bdrop (a|an|one|your|it|them|the|what)\b/,
  /\breply (with|below|if you|to this)\b/,
  /\bin a reply\b/,
  /\bshare (below|yours)\b/,
  /\bcomment (below|with)\b/,
  /\bi'll (go first|start|read every)\b/,
  /\bi (go first|read every)\b/,
  /\b(in|with) (\d+|one|a single) words?\b/,
  /\blet's connect\b/,
  /\bwhat are you (building|working on|shipping|making)\b/,
  /(^|[.!?]\s+)(choose|pick one)[.!]?(\s|$)/,
  /[\u{1F447}\u{2935}]/u, // 👇 ⤵
];
const CTA_LINE_START = /^(mine[:,]\s|name (a|an|one|the)\b)/;
const CTA_CLOSER = /(^|[.!?]\s+)(go|your turn)[.!]*$/;

const NUM_CONTRAST = /(->|→|\bvs\.?\b|\bversus\b)/;

const FIRST_PERSON = /\b(i|i'm|i've|i'd|i'll|my|mine|we|we're|we've|our|me)\b/;
const PAST_VERB =
  /\b(was|were|did|got|made|built|shipped|spent|started|launched|ran|wrote|grew|sold|taught|learned|hit|posted|asked|read|felt|quit|came|went|woke|found|lost|paid|earned|told|worked)\b/;
const AGE_YEARS = /\b\d{1,2}\s*(years? old|yo)\b|\bi'?m \d{1,2}\b|\b\d{1,2} years of\b/;
const IMPLICIT_PAST_OPEN =
  /^(started|built|shipped|launched|spent|woke|grew|sold|made|wrote|quit|back from)\b/;

const BULLET_LINE = /^([-•*]|\d+[.)]\s|[✅✓→])\s?/;

// Strip trailing emoji/symbols so "What's yours? ⤵️" still ends in '?'.
const TRAIL_JUNK = /[^\p{L}\p{N}?!."')]+$/u;

/** One structural label per draft. Pure, $0, safe on any string. */
export function classifyFormat(text: string): PostFormat {
  const decoded = normalize(text).trim();
  // Degenerate: empty, a retweet (someone else's structure), or URL-only.
  if (decoded === '') return 'other';
  if (/^rt @\w/i.test(decoded)) return 'other';

  const stripped = decoded.replace(URL_RE, ' ');
  const lower = stripped.toLowerCase();
  const contentLines = stripped
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (contentLines.length === 0) return 'other';
  const lowerLines = contentLines.map((l) => l.toLowerCase());
  const first = lowerLines[0] ?? '';
  const firstTwo = lowerLines.slice(0, 2).join('\n');
  const last = (lowerLines[lowerLines.length - 1] ?? '').replace(TRAIL_JUNK, '');
  const wordCount = countWords(stripped);

  // 1. would_you_rather — the most literal shape: the phrase itself, or the
  //    3-line "option / or / option" layout with short options. Before
  //    question because it always ends in one.
  if (/\bwould you rather\b/.test(lower)) return 'would_you_rather';
  for (let i = 0; i + 2 < lowerLines.length; i++) {
    if (
      lowerLines[i + 1] === 'or' &&
      countWords(contentLines[i] ?? '') <= 8 &&
      countWords(contentLines[i + 2] ?? '') <= 8
    ) {
      return 'would_you_rather';
    }
  }

  // 2. poll_list — a pick-one prompt followed by ≥3 short option lines.
  //    Before binary_choice: a 3+-option poll may still use A)/B) markers.
  //    The prompt-word requirement keeps question-shaped LIST items ("Did
  //    anything ship?") from turning an audit list into a poll.
  for (let i = 0; i < lowerLines.length; i++) {
    const line = lowerLines[i] ?? '';
    if (!(line.endsWith(':') || line.endsWith('?'))) continue;
    if (!POLL_PROMPT.test(line)) continue;
    let opts = 0;
    for (let j = i + 1; j < contentLines.length; j++) {
      if (countWords(contentLines[j] ?? '') > 5) break;
      opts += 1;
    }
    if (opts >= 3) return 'poll_list';
  }

  // 3. binary_choice — exactly the two-option ask: A)/B) lines or the
  //    literal "reply with A or B".
  const hasA = lowerLines.some((l) => /^a[).]\s/.test(l));
  const hasB = lowerLines.some((l) => /^b[).]\s/.test(l));
  if ((hasA && hasB) || /\breply with a or b\b/.test(lower)) return 'binary_choice';

  // 4. hot_take — a declared frame beats every marker below it ("Hot take:
  //    … Am I wrong?" is a hot take, not a question). First line only.
  if (HOT_TAKE_OPEN.test(first)) return 'hot_take';

  // 5. confession — same reasoning as hot_take; kept narrow (the literal
  //    word or an admit-opener) so vulnerability-flavored stories stay story.
  if (/\bconfession\b/.test(first) || CONFESSION_OPEN.test(first)) return 'confession';

  // 6. milestone — an OWN-count announcement in the opening two lines: the
  //    post leads with the number ("571 followers. Not 500.") or hits/crosses
  //    one. Scoped to the top so "your first 10 users" advice lines don't
  //    fire; noun list excludes impressions/views (those are data_comparison
  //    or story territory). Before CTA: "Just hit 1k — drop a 👋" announces.
  if (
    MILESTONE_OPEN.test(first) ||
    MILESTONE_HIT_MONEY.test(firstTwo) ||
    MILESTONE_HIT_COUNT.test(firstTwo)
  ) {
    return 'milestone';
  }

  // 7. audience_cta — an explicit ask to reply/drop/share. Before question:
  //    a question wrapped in an ask ("What did you ship? Reply below") is
  //    engineered for answers, and that is the structure worth measuring.
  if (
    CTA_MARKERS.some((re) => re.test(lower)) ||
    lowerLines.some((l) => CTA_LINE_START.test(l)) ||
    CTA_CLOSER.test(last)
  ) {
    return 'audience_cta';
  }

  // 8. question — the post leaves on a question mark with no reply-ask
  //    attached. Final content line decides: an opener question answered by
  //    the post itself ("Running low on things to post? Say it again.") is
  //    not a question post.
  if (last.endsWith('?')) return 'question';

  // 9. data_comparison — numbers doing contrast work: a digit sharing a line
  //    with vs/→/->, or ≥3 "label: value" lines. Before story so "I posted
  //    X: 461 vs 260" reads as the numbers, not the narrator.
  const numArrow = lowerLines.some((l) => /\d/.test(l) && NUM_CONTRAST.test(l));
  const colonValueLines = lowerLines.filter((l) => {
    const idx = l.indexOf(':');
    return idx >= 0 && /\d/.test(l.slice(idx + 1));
  }).length;
  if (numArrow || colonValueLines >= 3) return 'data_comparison';

  // 10. story — first-person narrative signals in the opening line (past
  //     tense, an age/years-of marker, or X's dropped-subject past opener
  //     "Started on a 386…"), a 🧵 marker, or a Day-N sequence. Before list:
  //     a biography opener followed by a colon-list body is still a story.
  if (decoded.includes('\u{1F9F5}')) return 'story';
  if (lowerLines.filter((l) => /^day \d/.test(l)).length >= 2) return 'story';
  if (
    AGE_YEARS.test(first) ||
    IMPLICIT_PAST_OPEN.test(first) ||
    (FIRST_PERSON.test(first) && PAST_VERB.test(first))
  ) {
    return 'story';
  }

  // 11. list — a colon-header in the first two lines with ≥3 lines under it
  //     (or a "?"-hook first line doing the same job), or ≥3 bullet lines.
  for (let i = 0; i < Math.min(2, lowerLines.length); i++) {
    const line = lowerLines[i] ?? '';
    const isHeader = line.endsWith(':') || (i === 0 && line.endsWith('?'));
    if (isHeader && contentLines.length - (i + 1) >= 3) return 'list';
  }
  if (lowerLines.filter((l) => BULLET_LINE.test(l)).length >= 3) return 'list';

  // 12/13. Structural fallbacks, mirroring x-builder's wisdom_one_liner /
  //     insight_share split: a single line that matched nothing is a
  //     one-liner, a multi-line draft that matched nothing is substance.
  if (contentLines.length === 1 && wordCount >= 4) return 'one_liner';
  if (contentLines.length >= 2 || wordCount >= 8) return 'substance';

  // 14. other — sub-4-word fragments and anything unclassifiable (§7.11:
  //     null = unknown; never a silent bucket).
  return 'other';
}
