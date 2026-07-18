// The Studio template registry (SURFACES S5.2): one entry per template with its
// metadata and a pure spec-dispatch closure. Adding a template is one registry
// row + one field section — not another ternary branch in the render loop.

import type { BrandKit } from '../../studio/brandKit.ts';
import type { RenderSpec } from '../../studio/compose.ts';
import {
  BANNER,
  PFP_FRAME,
  QUOTE_CARD,
  STAT_CARD,
  type StatCardData,
  bannerSpec,
  pfpFrameSpec,
  quoteCardSpec,
  statCardSpec,
} from '../../studio/templates.ts';

export type TemplateId = 'quote' | 'stat' | 'banner' | 'pfp';

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
}

/** Behavior-neutral dispatch — identical output to the pre-refactor render ternary. */
export function buildSpec(id: TemplateId, state: TemplateState, kit: BrandKit): RenderSpec {
  switch (id) {
    case 'quote':
      return quoteCardSpec(
        { text: state.quoteText.trim() || 'Your words, pixel-crisp.', background: state.bgBitmap },
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
        },
        kit,
      );
    case 'pfp':
      return pfpFrameSpec({ photo: state.pfpBitmap, initial: kit.handle }, kit);
  }
}
