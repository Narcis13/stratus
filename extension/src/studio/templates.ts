// The Studio's templates (SURFACES S3.2). Each template is a pure
// `spec(data, kit) → RenderSpec` — no canvas, no fetch, no clock — so the
// layer lists snapshot-test in bun and the same inputs always produce the
// same card. All ink derives from the kit's two colors (contrastOn/withAlpha):
// the palette constraint is what makes months of cards read as one brand.

import type { BrandKit } from './brandKit.ts';
import type { ChartCell } from './chartData.ts';
import { MONO_ADVANCE, type TokenKind, tokenizeLine } from './codeTokens.ts';
import {
  type Layer,
  type PatternKind,
  type RenderSpec,
  contrastOn,
  shade,
  withAlpha,
} from './compose.ts';
import { mascotLayers } from './mascot.ts';

export const QUOTE_CARD = { w: 1200, h: 675 } as const;
export const STAT_CARD = { w: 1200, h: 675 } as const;
export const BANNER = { w: 1500, h: 500 } as const;
export const PFP_FRAME = { w: 400, h: 400 } as const;
export const MILESTONE_CARD = { w: 1200, h: 675 } as const;
export const STREAK_CARD = { w: 1200, h: 675 } as const;
export const CODE_CARD = { w: 1200, h: 675 } as const;
export const THREAD_COVER = { w: 1200, h: 675 } as const;
export const LIST_CARD = { w: 1200, h: 675 } as const;
export const CHART_CARD = { w: 1200, h: 675 } as const;

/** Bundled JetBrains Mono (loaded via FontFace as 'StudioMono'); the code card
 *  always renders monospace regardless of the kit's display font, and its
 *  fixed advance ratio (MONO_ADVANCE) is what keeps the layout measure-free.
 *  The tail is the system-mono fallback when the woff2s fail to load. */
export const STUDIO_MONO_STACK =
  "'StudioMono', ui-monospace, 'SFMono-Regular', Menlo, Consolas, monospace";

/** Deterministic count format (fixed locale — no machine drift). */
export function fmtCount(n: number): string {
  if (n >= 1_000_000) return `${trimZero((n / 1_000_000).toFixed(1))}M`;
  if (n >= 1000) return `${trimZero((n / 1000).toFixed(1))}k`;
  return n.toLocaleString('en-US');
}

function trimZero(s: string): string {
  return s.replace(/\.0$/, '');
}

function font(kit: BrandKit, weight: number, sizePx: number) {
  return { family: kit.fontFamily, weight, sizePx };
}

function background(kit: BrandKit): Layer {
  return { kind: 'fill', color: kit.bg, color2: shade(kit.bg, -0.4) };
}

// SURFACES S4: an AI background sits UNDER the text. The image is cover-fit to
// the whole card, then a scrim (a semi-transparent wash of the brand bg) keeps
// canvas-rendered text legible over arbitrary imagery — the brand text never
// competes with the generated pixels. Without a background it's the plain
// gradient fill, so every template stays backwards-compatible.
//
// SURFACES S5.4: a deterministic pattern is the $0 alternative to the AI
// background — a faint texture over the gradient. An AI `bg` bitmap always wins
// (patterns and AI backgrounds are mutually exclusive); the pattern ink derives
// from contrastOn(kit.bg) at low alpha so it reads on light presets too.
function baseLayers(
  kit: BrandKit,
  w: number,
  h: number,
  bg: ImageBitmap | null | undefined,
  scrimAlpha: number,
  pattern?: { kind: PatternKind; seed: number } | null,
): Layer[] {
  if (bg) {
    return [
      { kind: 'image', src: bg, fit: 'cover', box: { x: 0, y: 0, w, h } },
      { kind: 'fill', color: withAlpha(kit.bg, scrimAlpha) },
    ];
  }
  const layers: Layer[] = [background(kit)];
  if (pattern) {
    layers.push({
      kind: 'pattern',
      pattern: pattern.kind,
      color: withAlpha(contrastOn(kit.bg), 0.07),
      box: { x: 0, y: 0, w, h },
      seed: pattern.seed,
    });
  }
  return layers;
}

/** A pattern arg for baseLayers from a card's optional pattern fields (seed
 *  defaults to 7 — only `blobs` reads it, but it's threaded for reroll). */
function patternArg(
  kind: PatternKind | undefined,
  seed: number | undefined,
): { kind: PatternKind; seed: number } | null {
  return kind ? { kind, seed: seed ?? 7 } : null;
}

function watermarkLayer(kit: BrandKit, ink: string, sizePx = 24, margin = 40): Layer[] {
  if (!kit.watermark || kit.watermarkText === '') return [];
  return [
    {
      kind: 'watermark',
      text: kit.watermarkText,
      font: font(kit, 600, sizePx),
      color: withAlpha(ink, 0.5),
      margin,
    },
  ];
}

// ------------------------------------------------------------------ quote card

export interface QuoteCardData {
  text: string;
  /** SURFACES S4 — optional AI background composited under the quote. */
  background?: ImageBitmap | null;
  /** SURFACES S5.4 — deterministic pattern (ignored when a background is set). */
  patternKind?: PatternKind;
  patternSeed?: number;
}

/** 1200×675 — a draft/tweet as a branded, pixel-crisp pull-quote. */
export function quoteCardSpec(data: QuoteCardData, kit: BrandKit): RenderSpec {
  const ink = contrastOn(kit.bg);
  const layers: Layer[] = [
    ...baseLayers(
      kit,
      QUOTE_CARD.w,
      QUOTE_CARD.h,
      data.background,
      0.68,
      patternArg(data.patternKind, data.patternSeed),
    ),
    { kind: 'rule', box: { x: 96, y: 104, w: 96, h: 10 }, color: kit.accent },
    {
      kind: 'text',
      text: data.text,
      font: font(kit, 700, 64),
      box: { x: 96, y: 150, w: 1008, h: 344 },
      color: ink,
      align: 'left',
      vAlign: 'middle',
      lineHeight: 1.28,
      minSizePx: 32,
    },
  ];
  if (kit.handle !== '') {
    layers.push({
      kind: 'text',
      text: `@${kit.handle}`,
      font: font(kit, 700, 30),
      box: { x: 96, y: 556, w: 700, h: 44 },
      color: kit.accent,
    });
  }
  // A small happy cloud tucked into the bottom-left, below the handle and clear
  // of the bottom-right watermark. Skipped under an AI background — the art wins.
  if (kit.mascot && !data.background) {
    layers.push(...mascotLayers({ pose: 'happy', x: 96, y: 598, scale: 0.55, kit }));
  }
  layers.push(...watermarkLayer(kit, ink));
  return { w: QUOTE_CARD.w, h: QUOTE_CARD.h, layers };
}

// ------------------------------------------------------------------- stat card

export interface StatCardData {
  followers: number | null;
  /** Follower delta over the week (digest facts). */
  delta: number | null;
  /** Follower curve, oldest → newest (account_snapshots via /x/brief). */
  sparkline: number[];
  /** e.g. "week of 2026-07-06". */
  weekLabel: string;
  posts: number | null;
  replies: number | null;
  topPostText: string | null;
  topPostViews: number | null;
  streakDays: number | null;
}

/** 1200×675 — the week's digest facts as build-in-public ammo: follower curve,
 *  top post, activity. Generated from real data, zero typing. */
export function statCardSpec(data: StatCardData, kit: BrandKit): RenderSpec {
  const ink = contrastOn(kit.bg);
  const muted = withAlpha(ink, 0.65);

  const headerRight =
    data.streakDays !== null && data.streakDays > 0
      ? `${data.streakDays}-day streak · ${data.weekLabel}`
      : data.weekLabel;

  const layers: Layer[] = [
    background(kit),
    {
      kind: 'text',
      text: 'THIS WEEK',
      font: font(kit, 800, 26),
      box: { x: 80, y: 64, w: 500, h: 34 },
      color: kit.accent,
      letterSpacingPx: 4,
    },
    {
      kind: 'text',
      text: headerRight,
      font: font(kit, 400, 24),
      box: { x: 580, y: 66, w: 540, h: 32 },
      color: muted,
      align: 'right',
      maxLines: 1,
      minSizePx: 18,
    },
  ];

  if (data.followers !== null) {
    layers.push(
      {
        kind: 'text',
        text: fmtCount(data.followers),
        font: font(kit, 800, 112),
        box: { x: 80, y: 130, w: 540, h: 124 },
        color: ink,
        maxLines: 1,
        minSizePx: 64,
      },
      {
        kind: 'text',
        text: 'followers',
        font: font(kit, 400, 28),
        box: { x: 80, y: 262, w: 540, h: 36 },
        color: muted,
      },
    );
  }
  if (data.delta !== null) {
    layers.push({
      kind: 'badge',
      texts: [`${data.delta >= 0 ? '+' : ''}${data.delta} this week`],
      x: 80,
      y: 316,
      font: font(kit, 700, 26),
      color: kit.accent,
      bg: withAlpha(kit.accent, 0.16),
      borderColor: kit.accent,
    });
  }
  if (data.sparkline.length >= 2) {
    layers.push({
      kind: 'sparkline',
      points: data.sparkline,
      box: { x: 660, y: 140, w: 460, h: 190 },
      color: kit.accent,
      strokeWidth: 5,
      fill: withAlpha(kit.accent, 0.14),
    });
  }

  layers.push({
    kind: 'rule',
    box: { x: 80, y: 402, w: 1040, h: 2 },
    color: withAlpha(ink, 0.14),
  });

  if (data.topPostText !== null) {
    layers.push(
      {
        kind: 'text',
        text: 'TOP POST',
        font: font(kit, 800, 22),
        box: { x: 80, y: 434, w: 300, h: 30 },
        color: kit.accent,
        letterSpacingPx: 3,
      },
      {
        kind: 'text',
        text: data.topPostText,
        font: font(kit, 600, 30),
        box: { x: 80, y: 474, w: 780, h: 112 },
        color: ink,
        lineHeight: 1.25,
        minSizePx: 22,
        maxLines: 3,
      },
    );
    if (data.topPostViews !== null) {
      layers.push({
        kind: 'text',
        text: `${fmtCount(data.topPostViews)} views`,
        font: font(kit, 800, 30),
        box: { x: 880, y: 474, w: 240, h: 40 },
        color: ink,
        align: 'right',
        maxLines: 1,
      });
    }
  } else {
    layers.push({
      kind: 'text',
      text: 'first full week — numbers land next Sunday',
      font: font(kit, 400, 26),
      box: { x: 80, y: 474, w: 780, h: 40 },
      color: muted,
    });
  }
  if (data.posts !== null && data.replies !== null) {
    layers.push({
      kind: 'text',
      text: `${data.posts} posts · ${data.replies} replies`,
      font: font(kit, 400, 22),
      box: { x: 880, y: 520, w: 240, h: 32 },
      color: muted,
      align: 'right',
      maxLines: 1,
    });
  }

  // The mascot celebrates a growing week and idles otherwise — tucked under the
  // sparkline, above the divider. Data-driven pose, no typing.
  if (kit.mascot) {
    const pose = data.delta !== null && data.delta > 0 ? 'celebrating' : 'happy';
    layers.push(...mascotLayers({ pose, x: 1020, y: 334, scale: 0.6, kit }));
  }

  if (kit.handle !== '') {
    layers.push({
      kind: 'text',
      text: `@${kit.handle}`,
      font: font(kit, 700, 26),
      box: { x: 80, y: 608, w: 500, h: 36 },
      color: kit.accent,
    });
  }
  layers.push(...watermarkLayer(kit, ink, 22, 36));
  return { w: STAT_CARD.w, h: STAT_CARD.h, layers };
}

// ---------------------------------------------------------------------- banner

export interface BannerData {
  headline: string;
  /** Pillar keywords strip — prefilled from the active content pillars. */
  keywords: string[];
  followers: number | null;
  /** Billboard mode (eval §3.4): a right-side stance line that REPLACES the
   *  follower milestone. When set, the keywords render as a plain "·"-joined
   *  tagline under a gold divider (not pills), the headline honors explicit
   *  newlines, and the @handle sign is dropped (the crew line owns the
   *  bottom-right). Empty/undefined = the classic headline + pills + count. */
  stance?: string;
  /** Billboard second line under the stance, e.g. "1,000+ of us". */
  crew?: string;
  /** A gold anchor glyph beside the headline (billboard flourish). */
  anchor?: boolean;
  /** SURFACES S4 — optional AI background composited under the header. */
  background?: ImageBitmap | null;
  /** SURFACES S5.4 — deterministic pattern (ignored when a background is set). */
  patternKind?: PatternKind;
  patternSeed?: number;
}

/** 1500×500 — profile header. Two shapes: the classic headline + pillar pills +
 *  live follower milestone, and the eval §3.4 "billboard" (a stance + crew count
 *  in place of the number). Regenerate monthly; S0.1's conversion rate judges
 *  the before/after. */
export function bannerSpec(data: BannerData, kit: BrandKit): RenderSpec {
  const ink = contrastOn(kit.bg);
  const muted = withAlpha(ink, 0.7);
  const billboard = data.stance !== undefined && data.stance.trim() !== '';
  const withMilestone = !billboard && data.followers !== null;

  const layers: Layer[] = [
    ...baseLayers(
      kit,
      BANNER.w,
      BANNER.h,
      data.background,
      0.6,
      patternArg(data.patternKind, data.patternSeed),
    ),
    { kind: 'rule', box: { x: 80, y: 96, w: 88, h: 10 }, color: kit.accent },
  ];

  if (billboard) {
    // Two-line headline (explicit \n survives layout), a gold anchor flourish, a
    // divider, a "·"-joined tagline, and the stance + crew on the right where the
    // follower count used to sit. No @handle sign — a banner already IS the
    // profile, and the crew line owns the bottom-right (eval law #4).
    layers.push({
      kind: 'text',
      text: data.headline,
      font: font(kit, 800, 66),
      box: { x: 80, y: 118, w: 900, h: 172 },
      color: ink,
      lineHeight: 1.16,
      minSizePx: 38,
      maxLines: 2,
    });
    if (data.anchor) {
      // U+FE0E forces text (monochrome) presentation so the canvas fill recolors
      // the anchor gold — default emoji presentation ignores fillStyle.
      layers.push({
        kind: 'text',
        text: '⚓︎',
        font: font(kit, 400, 62),
        box: { x: 1010, y: 188, w: 130, h: 94 },
        color: kit.accent,
        vAlign: 'middle',
        maxLines: 1,
      });
    }
    layers.push({
      kind: 'rule',
      box: { x: 80, y: 298, w: 470, h: 4 },
      color: withAlpha(kit.accent, 0.9),
    });
    if (data.keywords.length > 0) {
      layers.push({
        kind: 'text',
        text: data.keywords.join(' · '),
        font: font(kit, 600, 30),
        box: { x: 80, y: 320, w: 900, h: 44 },
        color: muted,
        maxLines: 1,
        minSizePx: 20,
      });
    }
    layers.push({
      kind: 'text',
      text: data.stance as string,
      font: font(kit, 800, 34),
      box: { x: 760, y: 376, w: 660, h: 46 },
      color: kit.accent,
      align: 'right',
      maxLines: 1,
      minSizePx: 22,
      letterSpacingPx: 1,
    });
    if (data.crew !== undefined && data.crew.trim() !== '') {
      layers.push({
        kind: 'text',
        text: data.crew,
        font: font(kit, 700, 28),
        box: { x: 760, y: 424, w: 660, h: 40 },
        color: withAlpha(ink, 0.85),
        align: 'right',
        maxLines: 1,
        minSizePx: 18,
      });
    }
    return { w: BANNER.w, h: BANNER.h, layers };
  }

  layers.push({
    kind: 'text',
    text: data.headline,
    font: font(kit, 800, 76),
    box: { x: 80, y: 140, w: withMilestone ? 900 : 1340, h: 200 },
    color: ink,
    lineHeight: 1.15,
    minSizePx: 40,
    maxLines: 3,
  });
  if (data.keywords.length > 0) {
    layers.push({
      kind: 'badge',
      texts: data.keywords,
      x: 80,
      y: 372,
      font: font(kit, 600, 26),
      color: ink,
      borderColor: withAlpha(ink, 0.35),
      maxWidth: withMilestone ? 900 : 1340,
    });
  }
  if (data.followers !== null) {
    layers.push(
      {
        kind: 'text',
        text: fmtCount(data.followers),
        font: font(kit, 800, 96),
        box: { x: 1020, y: 168, w: 400, h: 106 },
        color: kit.accent,
        align: 'center',
        maxLines: 1,
        minSizePx: 56,
      },
      {
        kind: 'text',
        text: 'followers',
        font: font(kit, 400, 30),
        box: { x: 1020, y: 288, w: 400, h: 40 },
        color: muted,
        align: 'center',
      },
    );
  }
  // A thinking cloud only when the right side is free (no follower milestone
  // there to fill it) and no AI background is washing it out.
  if (kit.mascot && !data.background && data.followers === null) {
    layers.push(...mascotLayers({ pose: 'thinking', x: 1190, y: 140, scale: 1.5, kit }));
  }
  // Bottom-right identity: the handle wins; the watermark only fills in when
  // no handle is set (a banner already IS the profile — don't double-sign).
  if (kit.handle !== '') {
    layers.push({
      kind: 'watermark',
      text: `@${kit.handle}`,
      font: font(kit, 700, 28),
      color: withAlpha(ink, 0.8),
      margin: 40,
    });
  } else {
    layers.push(...watermarkLayer(kit, ink, 24, 40));
  }
  return { w: BANNER.w, h: BANNER.h, layers };
}

// ------------------------------------------------------------- profile picture

export interface PfpData {
  photo: ImageBitmap | null;
  /** Fallback monogram when no photo is uploaded (first letter of the handle). */
  initial: string;
}

/** 400×400 — uploaded photo circle-cropped inside a brand-color ring. */
export function pfpFrameSpec(data: PfpData, kit: BrandKit): RenderSpec {
  const ink = contrastOn(kit.bg);
  const layers: Layer[] = [background(kit)];

  if (data.photo) {
    layers.push({
      kind: 'image',
      src: data.photo,
      fit: 'cover',
      box: { x: 26, y: 26, w: 348, h: 348 },
      circle: true,
    });
  } else {
    // Disc via a full-width ring stroke (r ± width/2 spans 0..174).
    layers.push(
      { kind: 'ring', cx: 200, cy: 200, r: 87, width: 174, color: shade(kit.bg, 0.16) },
      {
        kind: 'text',
        text: data.initial.slice(0, 1).toUpperCase() || '?',
        font: font(kit, 800, 150),
        box: { x: 0, y: 108, w: 400, h: 184 },
        color: withAlpha(ink, 0.9),
        align: 'center',
        vAlign: 'middle',
        // Unit line-height: at 1.3 the 150px glyph's line box (195px) would
        // overflow the 184px box and the layout engine would ellipsize a
        // single letter into "N…".
        lineHeight: 1,
        maxLines: 1,
      },
    );
  }
  layers.push({ kind: 'ring', cx: 200, cy: 200, r: 183, width: 14, color: kit.accent });
  return { w: PFP_FRAME.w, h: PFP_FRAME.h, layers };
}

// ------------------------------------------------------------- celebration cards

// The confetti backdrop uses a fixed PRNG seed so the celebration is
// deterministic — same spec always paints the same blobs (preview-IS-artifact).
const CONFETTI_SEED = 11;

/** A translucent-accent `blobs` backdrop shared by the milestone/streak cards —
 *  a built-in confetti, not the S5.4 background-pattern picker (these cards
 *  aren't background-capable). */
function confettiLayer(kit: BrandKit, w: number, h: number): Layer {
  return {
    kind: 'pattern',
    pattern: 'blobs',
    color: withAlpha(kit.accent, 0.25),
    box: { x: 0, y: 0, w, h },
    seed: CONFETTI_SEED,
  };
}

/** A small-caps accent eyebrow centered across the card. */
function eyebrow(kit: BrandKit, text: string, w: number): Layer {
  return {
    kind: 'text',
    text,
    font: font(kit, 800, 26),
    box: { x: 0, y: 96, w, h: 34 },
    color: kit.accent,
    align: 'center',
    letterSpacingPx: 6,
  };
}

export interface MilestoneCardData {
  /** The crossed rung to celebrate (auto-detected or a manual override).
   *  null = nothing crossed and nothing typed → a graceful placeholder. */
  milestone: number | null;
  /** Current follower count, shown as "N and counting" context. */
  followers: number | null;
  /** e.g. "reached 2026-07-10" (empty = omit). */
  dateLabel: string;
}

/** 1200×675 — a crossed follower milestone as build-in-public ammo. */
export function milestoneCardSpec(data: MilestoneCardData, kit: BrandKit): RenderSpec {
  const ink = contrastOn(kit.bg);
  const muted = withAlpha(ink, 0.65);
  const { w, h } = MILESTONE_CARD;
  const layers: Layer[] = [background(kit), confettiLayer(kit, w, h), eyebrow(kit, 'MILESTONE', w)];

  if (data.milestone !== null) {
    const parts: string[] = [];
    if (data.followers !== null)
      parts.push(`${data.followers.toLocaleString('en-US')} and counting`);
    if (data.dateLabel !== '') parts.push(data.dateLabel);
    const subtitle = parts.join(' · ');

    layers.push(
      { kind: 'rule', box: { x: 540, y: 156, w: 120, h: 10 }, color: kit.accent },
      {
        kind: 'text',
        text: fmtCount(data.milestone),
        font: font(kit, 800, 180),
        box: { x: 100, y: 196, w: 1000, h: 228 },
        color: ink,
        align: 'center',
        vAlign: 'middle',
        maxLines: 1,
        minSizePx: 90,
      },
      {
        kind: 'text',
        text: 'followers',
        font: font(kit, 400, 40),
        box: { x: 0, y: 438, w, h: 50 },
        color: muted,
        align: 'center',
      },
    );
    if (subtitle !== '') {
      layers.push({
        kind: 'text',
        text: subtitle,
        font: font(kit, 400, 28),
        box: { x: 100, y: 502, w: 1000, h: 36 },
        color: muted,
        align: 'center',
        maxLines: 1,
      });
    }
    // Celebrating cloud to the right of the number — only with a value to cheer.
    if (kit.mascot) {
      layers.push(...mascotLayers({ pose: 'celebrating', x: 960, y: 180, scale: 0.72, kit }));
    }
  } else {
    layers.push({
      kind: 'text',
      text: 'no milestone crossed yet',
      font: font(kit, 700, 46),
      box: { x: 100, y: 260, w: 1000, h: 140 },
      color: muted,
      align: 'center',
      vAlign: 'middle',
      maxLines: 2,
      minSizePx: 28,
    });
  }

  if (kit.handle !== '') {
    layers.push({
      kind: 'text',
      text: `@${kit.handle}`,
      font: font(kit, 700, 26),
      box: { x: 0, y: 600, w, h: 36 },
      color: kit.accent,
      align: 'center',
    });
  }
  layers.push(...watermarkLayer(kit, ink, 22, 36));
  return { w, h, layers };
}

export interface StreakCardData {
  /** Days shown up in a row (auto from the C9 streak or a manual override).
   *  null = no streak yet → a graceful placeholder. */
  days: number | null;
  /** Streak start date, e.g. "2026-07-04" (empty = omit the "since" line). */
  dateLabel: string;
}

/** 1200×675 — the C9 quest streak as a celebration card. */
export function streakCardSpec(data: StreakCardData, kit: BrandKit): RenderSpec {
  const ink = contrastOn(kit.bg);
  const muted = withAlpha(ink, 0.65);
  const { w, h } = STREAK_CARD;
  const layers: Layer[] = [background(kit), confettiLayer(kit, w, h), eyebrow(kit, 'STREAK', w)];

  if (data.days !== null) {
    const subtitle =
      data.dateLabel !== ''
        ? `showed up every day since ${data.dateLabel}`
        : 'showed up, every single day';
    layers.push(
      { kind: 'rule', box: { x: 540, y: 156, w: 120, h: 10 }, color: kit.accent },
      {
        kind: 'text',
        text: `${data.days}`,
        font: font(kit, 800, 180),
        box: { x: 100, y: 196, w: 1000, h: 228 },
        color: ink,
        align: 'center',
        vAlign: 'middle',
        maxLines: 1,
        minSizePx: 90,
      },
      {
        kind: 'text',
        text: 'day streak',
        font: font(kit, 400, 40),
        box: { x: 0, y: 438, w, h: 50 },
        color: muted,
        align: 'center',
      },
      {
        kind: 'text',
        text: subtitle,
        font: font(kit, 400, 28),
        box: { x: 100, y: 502, w: 1000, h: 36 },
        color: muted,
        align: 'center',
        maxLines: 1,
      },
    );
    if (kit.mascot) {
      layers.push(...mascotLayers({ pose: 'celebrating', x: 960, y: 180, scale: 0.72, kit }));
    }
  } else {
    layers.push({
      kind: 'text',
      text: 'no streak yet — show up today',
      font: font(kit, 700, 46),
      box: { x: 100, y: 260, w: 1000, h: 140 },
      color: muted,
      align: 'center',
      vAlign: 'middle',
      maxLines: 2,
      minSizePx: 28,
    });
  }

  if (kit.handle !== '') {
    layers.push({
      kind: 'text',
      text: `@${kit.handle}`,
      font: font(kit, 700, 26),
      box: { x: 0, y: 600, w, h: 36 },
      color: kit.accent,
      align: 'center',
    });
  }
  layers.push(...watermarkLayer(kit, ink, 22, 36));
  return { w, h, layers };
}

// ------------------------------------------------------------- thread cover / list

export interface ThreadCoverData {
  /** The head tweet (segment 1) — the hook that stops the scroll. */
  hook: string;
  /** Thread length, rendered as the "1/N" badge (plain text — §7.31 no emoji). */
  count: number;
  /** SURFACES S4 — optional AI background composited under the hook. */
  background?: ImageBitmap | null;
  /** SURFACES S5.4 — deterministic pattern (ignored when a background is set). */
  patternKind?: PatternKind;
  patternSeed?: number;
}

/** 1200×675 — the quote-card skeleton, heavier: an ExtraBold hook, an "a thread
 *  · 1/N" badge, and the thinking cloud (a thread cover is thinking out loud). */
export function threadCoverSpec(data: ThreadCoverData, kit: BrandKit): RenderSpec {
  const { w, h } = THREAD_COVER;
  const ink = contrastOn(kit.bg);
  const n = Math.max(1, Math.round(data.count));
  const layers: Layer[] = [
    ...baseLayers(kit, w, h, data.background, 0.68, patternArg(data.patternKind, data.patternSeed)),
    { kind: 'rule', box: { x: 96, y: 104, w: 96, h: 10 }, color: kit.accent },
    {
      kind: 'text',
      text: data.hook,
      font: font(kit, 800, 72),
      box: { x: 96, y: 158, w: 1008, h: 300 },
      color: ink,
      align: 'left',
      vAlign: 'middle',
      lineHeight: 1.18,
      minSizePx: 36,
      maxLines: 4,
    },
    {
      kind: 'badge',
      texts: ['a thread', `1/${n}`],
      x: 96,
      y: 480,
      font: font(kit, 700, 26),
      color: kit.accent,
      bg: withAlpha(kit.accent, 0.16),
      borderColor: kit.accent,
    },
  ];
  if (kit.handle !== '') {
    layers.push({
      kind: 'text',
      text: `@${kit.handle}`,
      font: font(kit, 700, 30),
      box: { x: 96, y: 556, w: 700, h: 44 },
      color: kit.accent,
    });
  }
  // A thinking cloud bottom-right, sized like the quote card's. Skipped under an
  // AI background — the art wins, exactly as the quote card does.
  if (kit.mascot && !data.background) {
    layers.push(...mascotLayers({ pose: 'thinking', x: 1030, y: 548, scale: 0.55, kit }));
  }
  layers.push(...watermarkLayer(kit, ink));
  return { w, h, layers };
}

export interface ListCardData {
  title: string;
  /** Already parsed + capped to 6 by parseListItems. */
  items: string[];
  /** SURFACES S4 — optional AI background composited under the rows. */
  background?: ImageBitmap | null;
  /** SURFACES S5.4 — deterministic pattern (ignored when a background is set). */
  patternKind?: PatternKind;
  patternSeed?: number;
}

const LIST_ROW_START = 196;
const LIST_ROW_H = 64;

/** Split a textarea into list rows: trim, drop blanks, strip leading `1.`/`-`/`•`
 *  markers, cap at 6 (the fields say "showing first 6"). Whitespace-only → []. */
export function parseListItems(raw: string): string[] {
  return raw
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l !== '')
    .map((l) => l.replace(/^\s*(?:\d+[.)]|[-*•])\s+/, '').trim())
    .filter((l) => l !== '')
    .slice(0, 6);
}

/** 1200×675 — a numbered listicle: title, then up to 6 accent-disc rows. */
export function listCardSpec(data: ListCardData, kit: BrandKit): RenderSpec {
  const { w, h } = LIST_CARD;
  const ink = contrastOn(kit.bg);
  const discInk = contrastOn(kit.accent);
  const layers: Layer[] = [
    ...baseLayers(kit, w, h, data.background, 0.62, patternArg(data.patternKind, data.patternSeed)),
    { kind: 'rule', box: { x: 80, y: 64, w: 72, h: 9 }, color: kit.accent },
    {
      kind: 'text',
      text: data.title,
      font: font(kit, 800, 42),
      box: { x: 80, y: 90, w: 1040, h: 80 },
      color: ink,
      align: 'left',
      lineHeight: 1.15,
      minSizePx: 26,
      maxLines: 2,
    },
  ];

  const items = data.items.slice(0, 6);
  if (items.length === 0) {
    layers.push({
      kind: 'text',
      text: 'add one item per line',
      font: font(kit, 400, 30),
      box: { x: 80, y: LIST_ROW_START, w: 1040, h: 60 },
      color: withAlpha(ink, 0.6),
    });
  } else {
    items.forEach((item, i) => {
      const rowY = LIST_ROW_START + i * LIST_ROW_H;
      layers.push(
        // Accent disc: a ring stroke of width 2r fills a disc of radius 2r
        // (the pfp monogram uses the same trick). r=11,width=22 → radius-22 disc.
        { kind: 'ring', cx: 104, cy: rowY + 22, r: 11, width: 22, color: kit.accent },
        {
          kind: 'text',
          text: `${i + 1}`,
          font: font(kit, 800, 26),
          box: { x: 82, y: rowY, w: 44, h: 44 },
          color: discInk,
          align: 'center',
          vAlign: 'middle',
          maxLines: 1,
        },
        {
          kind: 'text',
          text: item,
          font: font(kit, 600, 28),
          box: { x: 150, y: rowY, w: 990, h: 44 },
          color: ink,
          align: 'left',
          vAlign: 'middle',
          lineHeight: 1.15,
          minSizePx: 18,
          maxLines: 2,
        },
      );
    });
  }

  if (kit.handle !== '') {
    layers.push({
      kind: 'text',
      text: `@${kit.handle}`,
      font: font(kit, 700, 26),
      box: { x: 80, y: 604, w: 600, h: 36 },
      color: kit.accent,
    });
  }
  layers.push(...watermarkLayer(kit, ink, 22, 36));
  return { w, h, layers };
}

// ------------------------------------------------------------------- code card

export interface CodeCardData {
  /** Raw snippet — newlines are line breaks; hard-truncated to the caps below. */
  code: string;
  /** Filename / title shown centered in the window's title bar. */
  title: string;
}

function monoFont(weight: number, sizePx: number) {
  return { family: STUDIO_MONO_STACK, weight, sizePx };
}

// Fixed-advance layout constants — no canvas measurement (that's why the mono
// font is bundled). A token at column c sits at codeLeft + c·SIZE·MONO_ADVANCE.
const CODE_FONT_PX = 22;
const CODE_LINE_H = 1.28;
const CODE_MAX_LINES = 18;
const CODE_MAX_COLS = 62;
const CODE_PANEL = { x: 72, y: 44, w: 1056, h: 588 };
const CODE_PAD_X = 40;
const CODE_GUTTER_W = 48;
const CODE_TITLE_BAR_H = 60;
const CODE_TOP = CODE_PANEL.y + CODE_TITLE_BAR_H + 12;
const CODE_LEFT = CODE_PANEL.x + CODE_PAD_X;
const CODE_TEXT_LEFT = CODE_LEFT + CODE_GUTTER_W;

function tokenColor(kind: TokenKind, kit: BrandKit, ink: string): string {
  switch (kind) {
    case 'keyword':
      return kit.accent;
    case 'string':
      return shade(kit.accent, 0.45);
    case 'number':
      return shade(kit.accent, -0.25);
    case 'comment':
      return withAlpha(ink, 0.45);
    default:
      return ink;
  }
}

/** 1200×675 — a code snippet as a branded terminal window. Measure-free
 *  monospace layout keeps the spec pure/snapshot-testable; token colors all
 *  derive from the kit's two colors, so it re-skins with the brand. */
export function codeCardSpec(data: CodeCardData, kit: BrandKit): RenderSpec {
  const { w, h } = CODE_CARD;
  const ink = contrastOn(kit.bg);
  const advance = CODE_FONT_PX * MONO_ADVANCE;
  const lineHeightPx = CODE_FONT_PX * CODE_LINE_H;

  const rawLines = data.code.replace(/\r\n/g, '\n').split('\n');
  const trimmed = rawLines.length > CODE_MAX_LINES;
  const shown = rawLines.slice(0, trimmed ? CODE_MAX_LINES - 1 : CODE_MAX_LINES);

  const layers: Layer[] = [
    // A dark "desktop" behind the terminal, then the window panel (its fill IS
    // the kit bg, so ink=contrastOn(kit.bg) reads on it).
    { kind: 'fill', color: shade(kit.bg, -0.5) },
    {
      kind: 'panel',
      box: CODE_PANEL,
      radius: 20,
      fill: kit.bg,
      shadow: { blur: 44, color: withAlpha('#000000', 0.4), dy: 16 },
    },
  ];

  // Three monochrome window discs (no hardcoded Apple colors — muted ink).
  const discY = CODE_PANEL.y + CODE_TITLE_BAR_H / 2;
  [0.28, 0.2, 0.14].forEach((alpha, i) => {
    layers.push({
      kind: 'ring',
      cx: CODE_PANEL.x + 32 + i * 34,
      cy: discY,
      r: 10,
      width: 20,
      color: withAlpha(ink, alpha),
    });
  });

  const title = data.title.trim();
  if (title !== '') {
    layers.push({
      kind: 'text',
      text: title,
      font: monoFont(400, 22),
      box: { x: CODE_PANEL.x, y: CODE_PANEL.y + 18, w: CODE_PANEL.w, h: 30 },
      color: withAlpha(ink, 0.6),
      align: 'center',
      maxLines: 1,
      minSizePx: 16,
    });
  }

  shown.forEach((rawLine, li) => {
    const y = CODE_TOP + li * lineHeightPx;
    // Line number, right-aligned in the gutter.
    layers.push({
      kind: 'text',
      text: `${li + 1}`,
      font: monoFont(400, CODE_FONT_PX),
      box: { x: CODE_LEFT, y, w: CODE_GUTTER_W - 14, h: lineHeightPx },
      color: withAlpha(ink, 0.35),
      align: 'right',
      maxLines: 1,
    });

    let col = 0;
    for (const token of tokenizeLine(rawLine.slice(0, CODE_MAX_COLS))) {
      const x = CODE_TEXT_LEFT + col * advance;
      // A generous box (full font px per char ≫ 0.6 advance) guarantees the
      // single-line, left-aligned token never wraps or ellipsizes.
      layers.push({
        kind: 'text',
        text: token.text,
        font: monoFont(token.kind === 'keyword' ? 700 : 400, CODE_FONT_PX),
        box: { x, y, w: token.text.length * CODE_FONT_PX + 8, h: lineHeightPx },
        color: tokenColor(token.kind, kit, ink),
        maxLines: 1,
      });
      col += token.text.length;
    }
  });

  if (trimmed) {
    layers.push({
      kind: 'text',
      text: '⌄ trimmed',
      font: monoFont(400, CODE_FONT_PX),
      box: {
        x: CODE_TEXT_LEFT,
        y: CODE_TOP + shown.length * lineHeightPx,
        w: 400,
        h: lineHeightPx,
      },
      color: withAlpha(ink, 0.4),
      maxLines: 1,
    });
  }

  return { w, h, layers };
}

// ------------------------------------------------------------------ chart card

export interface ChartCardData {
  mode: 'growth' | 'heatmap';
  /** Growth: raw follower points (oldest → newest), fed to the sparkline. */
  points: number[];
  firstLabel: string;
  lastLabel: string;
  delta: number;
  /** Heatmap: the full 7×24 grid from chartData.heatmapCells (null intensity =
   *  below the gate → rendered muted, never a confident color). */
  cells: ChartCell[];
}

// Heatmap grid geometry (7 weekday rows × 24 hour columns) — the weekday
// initials sit in the left gutter, the 0h/6h/12h/18h markers above the grid.
const HEAT_LEFT = 128;
const HEAT_TOP = 214;
const HEAT_CELL_W = 38;
const HEAT_CELL_H = 40;
const HEAT_GAP_X = 4;
const HEAT_GAP_Y = 5;
const WEEKDAY_INITIALS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

/** 1200×675 — the daily follower curve OR the best-times heatmap, both from $0
 *  already-billed reads. All normalization is done in chartData.ts; this spec
 *  only places plain arrays, so it stays pure/snapshot-testable. */
export function chartCardSpec(data: ChartCardData, kit: BrandKit): RenderSpec {
  const { w, h } = CHART_CARD;
  const ink = contrastOn(kit.bg);
  const muted = withAlpha(ink, 0.65);

  if (data.mode === 'heatmap') {
    const layers: Layer[] = [
      background(kit),
      {
        kind: 'text',
        text: 'BEST TIMES TO POST',
        font: font(kit, 800, 26),
        box: { x: 80, y: 64, w: 700, h: 34 },
        color: kit.accent,
        letterSpacingPx: 4,
      },
      {
        kind: 'text',
        text: 'brighter = more views per day · faint = too little data',
        font: font(kit, 400, 22),
        box: { x: 80, y: 108, w: 1040, h: 30 },
        color: muted,
        maxLines: 1,
      },
    ];

    // Hour markers across the top (every 6h).
    for (const hour of [0, 6, 12, 18]) {
      layers.push({
        kind: 'text',
        text: `${hour}h`,
        font: font(kit, 700, 20),
        box: { x: HEAT_LEFT + hour * (HEAT_CELL_W + HEAT_GAP_X), y: HEAT_TOP - 30, w: 60, h: 24 },
        color: muted,
        maxLines: 1,
      });
    }
    // Weekday initials down the left.
    WEEKDAY_INITIALS.forEach((initial, weekday) => {
      layers.push({
        kind: 'text',
        text: initial,
        font: font(kit, 700, 22),
        box: {
          x: 80,
          y: HEAT_TOP + weekday * (HEAT_CELL_H + HEAT_GAP_Y),
          w: 36,
          h: HEAT_CELL_H,
        },
        color: muted,
        align: 'center',
        vAlign: 'middle',
        maxLines: 1,
      });
    });
    // 7×24 cells: a measured cell scales the accent alpha with intensity; a
    // below-gate cell is a barely-there ink wash (never a confident color).
    for (const cell of data.cells) {
      const color =
        cell.sufficient && cell.intensity !== null
          ? withAlpha(kit.accent, 0.15 + 0.75 * cell.intensity)
          : withAlpha(ink, 0.06);
      layers.push({
        kind: 'rule',
        box: {
          x: HEAT_LEFT + cell.hour * (HEAT_CELL_W + HEAT_GAP_X),
          y: HEAT_TOP + cell.weekday * (HEAT_CELL_H + HEAT_GAP_Y),
          w: HEAT_CELL_W,
          h: HEAT_CELL_H,
        },
        color,
      });
    }
    layers.push(...watermarkLayer(kit, ink, 22, 36));
    return { w, h, layers };
  }

  // Growth mode.
  const layers: Layer[] = [
    background(kit),
    {
      kind: 'text',
      text: 'FOLLOWER GROWTH',
      font: font(kit, 800, 26),
      box: { x: 80, y: 64, w: 600, h: 34 },
      color: kit.accent,
      letterSpacingPx: 4,
    },
  ];

  if (data.points.length < 2) {
    layers.push({
      kind: 'text',
      text: 'not enough follower history yet — check back after a few daily snapshots',
      font: font(kit, 400, 30),
      box: { x: 80, y: 260, w: 1040, h: 140 },
      color: muted,
      lineHeight: 1.3,
      maxLines: 3,
      minSizePx: 22,
    });
    layers.push(...watermarkLayer(kit, ink, 22, 36));
    return { w, h, layers };
  }

  const last = data.points[data.points.length - 1] as number;
  const peak = Math.max(...data.points);
  const low = Math.min(...data.points);

  layers.push(
    {
      kind: 'text',
      text: `${data.firstLabel} → ${data.lastLabel}`,
      font: font(kit, 400, 24),
      box: { x: 520, y: 66, w: 600, h: 32 },
      color: muted,
      align: 'right',
      maxLines: 1,
      minSizePx: 18,
    },
    {
      kind: 'text',
      text: fmtCount(last),
      font: font(kit, 800, 96),
      box: { x: 80, y: 118, w: 560, h: 108 },
      color: ink,
      maxLines: 1,
      minSizePx: 56,
    },
    {
      kind: 'text',
      text: 'followers',
      font: font(kit, 400, 28),
      box: { x: 80, y: 232, w: 560, h: 34 },
      color: muted,
    },
    {
      kind: 'badge',
      texts: [`${data.delta >= 0 ? '+' : ''}${data.delta} in ${data.points.length} days`],
      x: 80,
      y: 292,
      font: font(kit, 700, 26),
      color: kit.accent,
      bg: withAlpha(kit.accent, 0.16),
      borderColor: kit.accent,
    },
    // Peak / low value labels on the right, framing the chart.
    {
      kind: 'text',
      text: `peak ${fmtCount(peak)}`,
      font: font(kit, 400, 22),
      box: { x: 820, y: 340, w: 300, h: 28 },
      color: muted,
      align: 'right',
      maxLines: 1,
    },
    {
      kind: 'text',
      text: `low ${fmtCount(low)}`,
      font: font(kit, 400, 22),
      box: { x: 820, y: 566, w: 300, h: 28 },
      color: muted,
      align: 'right',
      maxLines: 1,
    },
    {
      kind: 'sparkline',
      points: data.points,
      box: { x: 80, y: 372, w: 1040, h: 200 },
      color: kit.accent,
      strokeWidth: 6,
      fill: withAlpha(kit.accent, 0.14),
    },
    // Endpoint dates under the curve.
    {
      kind: 'text',
      text: data.firstLabel,
      font: font(kit, 400, 22),
      box: { x: 80, y: 600, w: 300, h: 28 },
      color: muted,
      maxLines: 1,
    },
    {
      kind: 'text',
      text: data.lastLabel,
      font: font(kit, 400, 22),
      box: { x: 820, y: 600, w: 300, h: 28 },
      color: muted,
      align: 'right',
      maxLines: 1,
    },
  );
  layers.push(...watermarkLayer(kit, ink, 22, 36));
  return { w, h, layers };
}
