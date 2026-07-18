// The Studio's templates (SURFACES S3.2). Each template is a pure
// `spec(data, kit) → RenderSpec` — no canvas, no fetch, no clock — so the
// layer lists snapshot-test in bun and the same inputs always produce the
// same card. All ink derives from the kit's two colors (contrastOn/withAlpha):
// the palette constraint is what makes months of cards read as one brand.

import type { BrandKit } from './brandKit.ts';
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
  /** SURFACES S4 — optional AI background composited under the header. */
  background?: ImageBitmap | null;
  /** SURFACES S5.4 — deterministic pattern (ignored when a background is set). */
  patternKind?: PatternKind;
  patternSeed?: number;
}

/** 1500×500 — profile header: headline, pillar strip, live follower milestone.
 *  Regenerate monthly; S0.1's conversion rate judges the before/after. */
export function bannerSpec(data: BannerData, kit: BrandKit): RenderSpec {
  const ink = contrastOn(kit.bg);
  const muted = withAlpha(ink, 0.7);
  const withMilestone = data.followers !== null;

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
    {
      kind: 'text',
      text: data.headline,
      font: font(kit, 800, 76),
      box: { x: 80, y: 140, w: withMilestone ? 900 : 1340, h: 200 },
      color: ink,
      lineHeight: 1.15,
      minSizePx: 40,
      maxLines: 3,
    },
  ];
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
