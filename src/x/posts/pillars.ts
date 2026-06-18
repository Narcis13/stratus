// Content pillars — the editable taxonomy the post drafter declares against
// (§8.1/§8.4). Once hardcoded in POST_PROMPT_TEMPLATE §4 as "3 locked pillars";
// now first-class `content_pillars` rows. This module is the lowest layer
// (no imports from prompt.ts/drafter.ts) so both can depend on it without a
// cycle: it owns the default seed, the prompt-block renderer, the slug rules,
// and the steer parser.

/** One pillar's prompt-facing definition — what Grok reads. The DB row carries
 *  more (sortOrder/active/timestamps); the drafter only needs these three. */
export interface PillarDef {
  slug: string;
  label: string;
  body: string;
}

// The original three, text lifted verbatim from POST_PROMPT_TEMPLATE §4. Single
// code source of truth: the seed migration mirrors these, and the drafter falls
// back to them when `content_pillars` is empty (fresh DB, pre-migration).
export const DEFAULT_PILLARS: PillarDef[] = [
  {
    slug: 'ai-craft',
    label: 'AI-native craft — the WHAT',
    body: 'Daily lab journal: AI agents, Claude Code, skills, judgment encoded in code. Why only me: 30 years of code + active AI power-user who actually writes skills for agents. Dominant register: plain; spicy when taking a stance against a popular pattern. Avoid tutorial-speak — state the pattern/judgment, show I live with it. Concrete commit/skill/workflow > generic advice.',
  },
  {
    slug: 'builder-51',
    label: 'The 51-year-old builder — the WHO / WHY',
    body: 'Atypical solopreneur journal; the reverse of the 22-year-old-SF-founder template. Rarity = memorability; I lived the 386→2026 arc, juniors can\'t fabricate it. Dominant register: reflective. Flashback → reframe → punchy landing. A specific tech reference (Turbo Pascal, DOS 3.1, 386) beats "back in my day." Don\'t overdo nostalgia. Real constraints (08–15 hospital job, Romania, building post-50) → forced creativity.',
  },
  {
    slug: 'unsexy-problems',
    label: 'Unsexy problems — the WHERE / WHAT-FOR',
    body: 'Real SMB and public-system problems, far from the VC echo chamber — where leverage actually lives. Why only me: two real laboratories (the hospital, the ~20 SMB accounting clients). Dominant register: spicy. Specific observation > generic critique. Name the unsexy thing: an ANAF report, an Excel reconciliation, a hospital procurement form. Abstraction kills the angle.',
  },
];

export const DEFAULT_PILLAR_SLUGS: string[] = DEFAULT_PILLARS.map((p) => p.slug);

// Kebab-case, 2–41 chars, starts alphanumeric. Keep it tight — the slug rides
// in the structured-output enum and in historical `pillar` text columns.
export const PILLAR_SLUG_RE = /^[a-z0-9][a-z0-9-]{1,40}$/;

export function isValidPillarSlug(value: unknown): boolean {
  return typeof value === 'string' && PILLAR_SLUG_RE.test(value);
}

/** Renders the active pillars into the prompt's PILLARS block — the §4-style
 *  list the drafter injects at the variable tail (keeps the instruction block a
 *  stable, cacheable prefix). */
export function renderPillars(pillars: PillarDef[]): string {
  if (pillars.length === 0) return '(no pillars configured)';
  return pillars.map((p) => `**${p.slug}** — ${p.label}\n${p.body}`).join('\n\n');
}

// Steer parser: accepts the canonical slug or 1/2/3 shorthand (the order the
// pillars are listed in). `slugs` defaults to the seed set so existing callers
// and tests keep working; the drafter passes the live ordered slug list.
export function parsePillar(
  value: unknown,
  slugs: string[] = DEFAULT_PILLAR_SLUGS,
): string | undefined | 'invalid' {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'number') {
    return slugs[value - 1] ?? 'invalid';
  }
  if (typeof value === 'string' && slugs.includes(value)) {
    return value;
  }
  return 'invalid';
}
