// UI.11 — the in-product roadmap: planned-but-unbuilt features rendered as inert
// rows under Settings → Tuning, so the roadmap is visible where the knobs live
// (Decision 3). The server registry NEVER carries dead keys — everything here is
// client-side copy and nothing in it is editable.
//
// D8: this manifest is PRUNED, not appended. An entry is deleted in the same
// commit that ships its plan — the plan text's original eleven entries were all
// built during Waves 0–4 (augmented-x-ui, me-profile, niche, notifications,
// radar-reply-unification, reply-lists, studio-2, ai-layer, authoring-3,
// guardrails, harvest-enhancements), leaving exactly the three backlog plans
// below. A shipped feature listed as "coming soon" is worse than no roadmap at
// all, so the shape test asserts every entry still points at a real plan file.
//
// The knob labels are representative, not promises: they name the tuning surface
// each plan argues for, so a reader can tell what would become configurable.

export interface ComingSoonKnob {
  label: string;
  hint: string;
}

export interface ComingSoonFeature {
  id: string;
  title: string;
  /** Repo-relative path — the plan that ships it. */
  planFile: string;
  /** One line on what the feature is, in the product's voice. */
  summary: string;
  knobs: ComingSoonKnob[];
}

export const COMING_SOON: ComingSoonFeature[] = [
  {
    id: 'static-coach',
    title: 'Static coach',
    planFile: 'plans/2026-07-22-static-coach.md',
    summary:
      'Deterministic pre-publish checks on a draft — em-dashes, hedges, hashtags, weak closers, the show-more cutoff — plus a structural format label. $0, no model call.',
    knobs: [
      {
        label: 'Ship-ready score floor',
        hint: 'Where the score stops reading as "needs work". A floor, never a gate — a low score refuses nothing.',
      },
      {
        label: 'Show-more cutoff length',
        hint: 'Character count at which X truncates a post behind "Show more".',
      },
      {
        label: 'Check severity weights',
        hint: 'How much each rule (hedges, hashtags, weak closer) moves the score.',
      },
      {
        label: 'Reach band minimum n',
        hint: 'Measured posts required before a fitted reach band renders at all. Below it the Composer says "insufficient data".',
      },
      {
        label: 'Lexicon source',
        hint: 'Neutral defaults, or the active niche plus your channel keywords.',
      },
    ],
  },
  {
    id: 'llm-judge',
    title: 'LLM judge',
    planFile: 'plans/2026-07-22-llm-judge.md',
    summary:
      'An on-demand 13-dimension read on one draft you are about to schedule, with anchored fixes. Per click only (~$0.003), never automatic, never on replies.',
    knobs: [
      {
        label: 'Judge provider override',
        hint: 'Run the judge on a different model than wrote the draft — a model grading its own output likes it.',
      },
      {
        label: 'Verdict staleness',
        hint: 'How long a verdict still describes the draft before an edit forces a re-run.',
      },
      {
        label: 'Judge max output tokens',
        hint: 'The per-call cost bound on a verdict.',
      },
      {
        label: 'Judge cell minimum n',
        hint: 'Judged posts required before the Playbook reports whether the score predicts anything.',
      },
    ],
  },
  {
    id: 'growth-tactics',
    title: 'Growth tactics',
    planFile: 'plans/2026-07-22-mika-growth-tactics.md',
    summary:
      'The reciprocity lane: small-account replies exempt from the band gate, reply-bait formats, launch seeding, a milestone nudge and a format cooldown.',
    knobs: [
      {
        label: 'Reciprocity quest target',
        hint: 'Reciprocity replies a day before the quest reads done.',
      },
      {
        label: 'Roster stage floor',
        hint: 'How well you must already know someone for their post to skip the band gate. Strangers keep refusing.',
      },
      {
        label: 'Milestone nudge window',
        hint: 'Days a "you just crossed a round number" nudge stays up after the crossing.',
      },
      {
        label: 'Format cooldown window',
        hint: 'How long before the same register or pillar can repeat without a warning.',
      },
    ],
  },
];

/** Case-insensitive match over a feature's title, summary and knob labels — the
 *  Settings search filters the roadmap alongside the live groups. */
export function comingSoonMatches(feature: ComingSoonFeature, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (q === '') return true;
  if (feature.title.toLowerCase().includes(q)) return true;
  if (feature.summary.toLowerCase().includes(q)) return true;
  return feature.knobs.some(
    (k) => k.label.toLowerCase().includes(q) || k.hint.toLowerCase().includes(q),
  );
}
