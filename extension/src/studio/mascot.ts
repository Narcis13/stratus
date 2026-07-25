// The Studio's cloud mascot (SURFACES S5.3). "stratus" is a cloud, so the brand
// mascot is a deterministic lobed-cloud vector — $0, pixel-identical forever,
// snapshot-testable — never AI-generated (that pipeline stays for backgrounds
// only). Pure: `mascotLayers(opts) → Layer[]`; all ink derives from the kit's
// accent via compose's `shade`, so the mascot re-skins when the brand preset
// switches (S5.4). Every part is authored in one shared 100×100 viewbox rendered
// through a single `path` box, so a pose only changes the face and add-ons —
// one coordinate system, one scale, fully deterministic (no `Math.random`).

import type { BrandKit } from './brandKit.ts';
import { type Box, type Layer, patternCoords, shade } from './compose.ts';

export type MascotPose = 'happy' | 'celebrating' | 'thinking' | 'sleeping';

export interface MascotOpts {
  pose: MascotPose;
  /** Top-left of the mascot box, in card pixels. */
  x: number;
  y: number;
  /** 1 = a 100×80px cloud; the quote card uses ~0.55, the banner ~1.5. */
  scale: number;
  kit: BrandKit;
  /** Confetti seed for `celebrating` (deterministic; default 7). */
  seed?: number;
}

// The cloud silhouette — three lobes over a flat-ish base in a 100×100 viewbox,
// the body occupying y≈30..78. Authored once so every mascot is the same cloud;
// only the face and add-ons change between poses.
const CLOUD_PATH =
  'M26 78 Q10 78 10 64 Q10 51 24 50 Q26 34 44 36 Q50 24 66 30 Q84 28 84 46 Q96 48 96 60 Q96 78 82 78 Z';

/** A filled circle as SVG path data (two half-arcs) so eyes, cheeks and confetti
 *  are `path` layers sharing the mascot's viewbox — no per-feature canvas math. */
function circlePath(cx: number, cy: number, r: number): string {
  return `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${r * 2} 0a${r} ${r} 0 1 0 ${-r * 2} 0Z`;
}

/** Deterministic vector mascot as a list of `path` (+ one `text` for the sleeping
 *  "zzz") layers. Same inputs → deep-equal output; colours track `kit.accent`. */
export function mascotLayers(opts: MascotOpts): Layer[] {
  const { pose, x, y, scale, kit } = opts;
  const box: Box = { x, y, w: 100 * scale, h: 80 * scale };
  const bodyFill = shade(kit.accent, 0.85);
  const faceInk = shade(kit.accent, -0.55);
  const bodyStrokeW = Math.max(1.5, 3 * scale);
  const faceStrokeW = Math.max(1.2, 2.4 * scale);

  const filled = (d: string, fill: string): Layer => ({ kind: 'path', d, box, fill });
  const stroked = (d: string, stroke: string, strokeWidth: number): Layer => ({
    kind: 'path',
    d,
    box,
    stroke,
    strokeWidth,
  });

  const body: Layer = {
    kind: 'path',
    d: CLOUD_PATH,
    box,
    fill: bodyFill,
    stroke: kit.accent,
    strokeWidth: bodyStrokeW,
  };

  if (pose === 'happy') {
    return [
      body,
      filled(circlePath(40, 54, 4.5), faceInk),
      filled(circlePath(62, 54, 4.5), faceInk),
      stroked('M42 63 Q51 71 60 63', faceInk, faceStrokeW),
    ];
  }

  if (pose === 'celebrating') {
    const confettiColors = [kit.accent, shade(kit.accent, 0.4), shade(kit.accent, -0.3)];
    const confetti = patternCoords('blobs', 100, 24, 24, opts.seed ?? 7).map((p, i) =>
      filled(
        circlePath(p.x, p.y + 2, Math.max(2, Math.min(4.5, (p.r ?? 3) * 0.28))),
        confettiColors[i % confettiColors.length] as string,
      ),
    );
    return [
      // Raised "arm" puffs behind the cloud (drawn first so they peek out).
      filled(circlePath(12, 46, 9), bodyFill),
      filled(circlePath(88, 46, 9), bodyFill),
      body,
      stroked('M34 54 Q39 48 44 54', faceInk, faceStrokeW),
      stroked('M56 54 Q61 48 66 54', faceInk, faceStrokeW),
      filled('M41 60 Q51 74 59 60 Z', faceInk),
      ...confetti,
    ];
  }

  if (pose === 'thinking') {
    return [
      body,
      filled(circlePath(44, 52, 4), faceInk),
      filled(circlePath(66, 52, 4), faceInk),
      stroked('M46 65 L58 63', faceInk, faceStrokeW),
      // Thought-dot trail rising off to the upper right.
      filled(circlePath(82, 40, 2.5), faceInk),
      filled(circlePath(90, 30, 3.5), faceInk),
      filled(circlePath(99, 18, 5), faceInk),
    ];
  }

  // sleeping — closed-eye arcs, a soft mouth, and a plain-text "zzz" (no emoji).
  return [
    body,
    stroked('M34 54 Q39 59 44 54', faceInk, faceStrokeW),
    stroked('M56 54 Q61 59 66 54', faceInk, faceStrokeW),
    stroked('M46 65 Q51 68 56 65', faceInk, faceStrokeW),
    {
      kind: 'text',
      text: 'zzz',
      font: { family: kit.fontFamily, weight: 700, sizePx: Math.round(22 * scale) },
      box: { x: x + box.w * 0.72, y: y - box.h * 0.06, w: box.w * 0.6, h: box.h * 0.4 },
      color: faceInk,
      align: 'left',
    },
  ];
}
