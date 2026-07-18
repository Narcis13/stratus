// The Studio template registry (SURFACES S5.2): one entry per template with its
// metadata and a pure spec-dispatch closure. Adding a template is one registry
// row + one field section — not another ternary branch in the render loop.

import type { BrandKit } from '../../studio/brandKit.ts';
import type { PatternKind, RenderSpec } from '../../studio/compose.ts';
import {
  BANNER,
  CODE_CARD,
  MILESTONE_CARD,
  type MilestoneCardData,
  PFP_FRAME,
  QUOTE_CARD,
  STAT_CARD,
  STREAK_CARD,
  type StatCardData,
  type StreakCardData,
  bannerSpec,
  codeCardSpec,
  milestoneCardSpec,
  pfpFrameSpec,
  quoteCardSpec,
  statCardSpec,
  streakCardSpec,
} from '../../studio/templates.ts';

export type TemplateId = 'quote' | 'stat' | 'banner' | 'pfp' | 'milestone' | 'streak' | 'code';

export interface TemplateMeta {
  id: TemplateId;
  label: string;
  size: { w: number; h: number };
  /** Composites an AI background under the text (S4). */
  supportsAiBackground: boolean;
}

export const TEMPLATES: TemplateMeta[] = [
  {
    id: 'quote',
    label: 'Quote card',
    size: { w: QUOTE_CARD.w, h: QUOTE_CARD.h },
    supportsAiBackground: true,
  },
  {
    id: 'stat',
    label: 'Stat card',
    size: { w: STAT_CARD.w, h: STAT_CARD.h },
    supportsAiBackground: false,
  },
  { id: 'banner', label: 'Banner', size: { w: BANNER.w, h: BANNER.h }, supportsAiBackground: true },
  {
    id: 'pfp',
    label: 'Profile pic',
    size: { w: PFP_FRAME.w, h: PFP_FRAME.h },
    supportsAiBackground: false,
  },
  {
    id: 'milestone',
    label: 'Milestone',
    size: { w: MILESTONE_CARD.w, h: MILESTONE_CARD.h },
    supportsAiBackground: false,
  },
  {
    id: 'streak',
    label: 'Streak',
    size: { w: STREAK_CARD.w, h: STREAK_CARD.h },
    supportsAiBackground: false,
  },
  {
    id: 'code',
    label: 'Code card',
    size: { w: CODE_CARD.w, h: CODE_CARD.h },
    supportsAiBackground: false,
  },
];

/** The union is closed and every id has a row, so this never misses. */
export function templateMeta(id: TemplateId): TemplateMeta {
  return TEMPLATES.find((t) => t.id === id) as TemplateMeta;
}

export function supportsAiBackground(id: TemplateId): boolean {
  return templateMeta(id).supportsAiBackground;
}

/** Stat card with no data yet — also the render fallback while the week loads. */
export const EMPTY_STAT: StatCardData = {
  followers: null,
  delta: null,
  sparkline: [],
  weekLabel: '',
  posts: null,
  replies: null,
  topPostText: null,
  topPostViews: null,
  streakDays: null,
};

/** Celebration cards before their data loads (or when it's absent). */
export const EMPTY_MILESTONE: MilestoneCardData = {
  milestone: null,
  followers: null,
  dateLabel: '',
};
export const EMPTY_STREAK: StreakCardData = { days: null, dateLabel: '' };

/** Every per-template input the shell owns; buildSpec reads what each template needs. */
export interface TemplateState {
  quoteText: string;
  statData: StatCardData | null;
  bannerHeadline: string;
  bannerKeywords: string;
  bannerFollowers: number | null;
  bannerMilestone: boolean;
  pfpBitmap: ImageBitmap | null;
  bgBitmap: ImageBitmap | null;
  /** S5.4 background pattern for background-capable templates (null = gradient
   *  or an AI bitmap is set). Seed only matters for `blobs`. */
  patternKind: PatternKind | null;
  patternSeed: number;
  /** S5.5 celebration cards — resolved by the shell from the account series /
   *  C9 streak, with the manual override already folded in. */
  milestoneData: MilestoneCardData;
  streakData: StreakCardData;
  /** S5.6 code card — filename + raw snippet. */
  codeTitle: string;
  codeText: string;
}

/** A sample snippet so the code card previews immediately (empty input → this). */
export const DEFAULT_CODE = `// stratus — ship in public
async function post(draft) {
  const slot = await bestTime();
  return schedule(draft, slot);
}`;

/** Behavior-neutral dispatch — identical output to the pre-refactor render ternary. */
export function buildSpec(id: TemplateId, state: TemplateState, kit: BrandKit): RenderSpec {
  switch (id) {
    case 'quote':
      return quoteCardSpec(
        {
          text: state.quoteText.trim() || 'Your words, pixel-crisp.',
          background: state.bgBitmap,
          ...(state.patternKind
            ? { patternKind: state.patternKind, patternSeed: state.patternSeed }
            : {}),
        },
        kit,
      );
    case 'stat':
      return statCardSpec(state.statData ?? EMPTY_STAT, kit);
    case 'banner':
      return bannerSpec(
        {
          headline: state.bannerHeadline.trim() || 'Building in public',
          keywords: state.bannerKeywords
            .split(',')
            .map((k) => k.trim())
            .filter((k) => k !== ''),
          followers: state.bannerMilestone ? state.bannerFollowers : null,
          background: state.bgBitmap,
          ...(state.patternKind
            ? { patternKind: state.patternKind, patternSeed: state.patternSeed }
            : {}),
        },
        kit,
      );
    case 'pfp':
      return pfpFrameSpec({ photo: state.pfpBitmap, initial: kit.handle }, kit);
    case 'milestone':
      return milestoneCardSpec(state.milestoneData, kit);
    case 'streak':
      return streakCardSpec(state.streakData, kit);
    case 'code':
      return codeCardSpec(
        {
          code: state.codeText.trim() !== '' ? state.codeText : DEFAULT_CODE,
          title: state.codeTitle.trim() || 'snippet.ts',
        },
        kit,
      );
  }
}
