// The Studio's composition engine (SURFACES S3.1): a tiny declarative layer
// model rendered to a canvas and exported as PNG. Deterministic by design —
// same spec + same fonts = same pixels, so the live preview IS the artifact.
//
// The hard 20% — text measurement, wrapping, shrink-to-fit, ellipsis — is kept
// as pure functions over an injected `MeasureFn`, so the whole layout matrix is
// unit-testable in bun with a fake metrics object (no canvas, no DOM). The
// canvas only enters in `render()`, which builds a real MeasureFn from
// `ctx.measureText` and walks the layers.
//
// S4's AI backgrounds will land as `image` layers UNDER the text layers: image
// models garble words, so brand text is always canvas-rendered on top.

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type Align = 'left' | 'center' | 'right';
export type VAlign = 'top' | 'middle';

export interface FontSpec {
  family: string;
  weight: number;
  sizePx: number;
}

export type Layer =
  | {
      /** Solid background, or a vertical gradient when `color2` is present. */
      kind: 'fill';
      color: string;
      color2?: string;
    }
  | {
      /** Cover-fit bitmap; `circle` clips to the box's inscribed circle. */
      kind: 'image';
      src: ImageBitmap;
      fit: 'cover';
      box: Box;
      circle?: boolean;
    }
  | {
      kind: 'text';
      text: string;
      font: FontSpec;
      box: Box;
      color: string;
      align?: Align;
      vAlign?: VAlign;
      /** Line-height factor (default 1.3). */
      lineHeight?: number;
      /** Shrink-to-fit floor; omitted = no shrinking, ellipsize instead. */
      minSizePx?: number;
      maxLines?: number;
      /** Extra px between glyphs — for small-caps labels only (no wrapping). */
      letterSpacingPx?: number;
    }
  | {
      kind: 'sparkline';
      points: number[];
      box: Box;
      color: string;
      strokeWidth?: number;
      /** Area fill under the curve (rgba string); omitted = stroke only. */
      fill?: string;
    }
  | {
      /** A left-to-right row of pill badges; overflowing pills are dropped. */
      kind: 'badge';
      texts: string[];
      x: number;
      y: number;
      font: FontSpec;
      color: string;
      bg?: string;
      borderColor?: string;
      gap?: number;
      padX?: number;
      padY?: number;
      maxWidth?: number;
    }
  | {
      /** Filled bar with fully rounded ends — accents and separators. */
      kind: 'rule';
      box: Box;
      color: string;
    }
  | {
      /** Stroked circle; width == 2r fills a disc. */
      kind: 'ring';
      cx: number;
      cy: number;
      r: number;
      width: number;
      color: string;
    }
  | {
      /** Small bottom-right anchored mark. */
      kind: 'watermark';
      text: string;
      font: FontSpec;
      color: string;
      margin?: number;
    }
  | {
      /** SVG path data authored in a 100×100 viewbox, scaled into `box`. The
       *  mascot's building block; Path2D-from-string works on both canvas
       *  contexts, so keep it in the `Ctx2D` union. */
      kind: 'path';
      d: string;
      box: Box;
      fill?: string;
      stroke?: string;
      strokeWidth?: number;
    }
  | {
      /** Rounded rect with optional stroke and drop shadow — terminal windows,
       *  list rows, cards behind cards. */
      kind: 'panel';
      box: Box;
      radius: number;
      fill?: string;
      stroke?: string;
      strokeWidth?: number;
      shadow?: { blur: number; color: string; dy: number };
    }
  | {
      /** Deterministic background texture. `blobs` uses the seeded mulberry32
       *  PRNG (never Math.random) so the same spec+seed paints the same pixels
       *  forever — the S3 determinism contract. No `box` = full canvas. */
      kind: 'pattern';
      pattern: PatternKind;
      color: string;
      box?: Box;
      spacing?: number;
      size?: number;
      seed?: number;
    };

export interface RenderSpec {
  w: number;
  h: number;
  layers: Layer[];
}

// ---------------------------------------------------------------- pure: color

/** #rgb or #rrggbb → components; null on anything else. */
export function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const s = m[1] as string;
  const full = s.length === 3 ? s.replace(/./g, (c) => c + c) : s;
  return {
    r: Number.parseInt(full.slice(0, 2), 16),
    g: Number.parseInt(full.slice(2, 4), 16),
    b: Number.parseInt(full.slice(4, 6), 16),
  };
}

const DARK_INK = '#0f1419';
const LIGHT_INK = '#f7f9f9';

/** Ink color that reads on the given background (perceptual luma cut). */
export function contrastOn(bg: string): string {
  const rgb = hexToRgb(bg);
  if (!rgb) return LIGHT_INK;
  const luma = (0.299 * rgb.r + 0.587 * rgb.g + 0.114 * rgb.b) / 255;
  return luma > 0.6 ? DARK_INK : LIGHT_INK;
}

/** Lighten (amount > 0) or darken (amount < 0) toward white/black, -1..1. */
export function shade(hex: string, amount: number): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return hex;
  const t = Math.max(-1, Math.min(1, amount));
  const target = t > 0 ? 255 : 0;
  const mix = (c: number): number => Math.round(c + (target - c) * Math.abs(t));
  const to2 = (c: number): string => c.toString(16).padStart(2, '0');
  return `#${to2(mix(rgb.r))}${to2(mix(rgb.g))}${to2(mix(rgb.b))}`;
}

export function withAlpha(hex: string, alpha: number): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return hex;
  const a = Math.max(0, Math.min(1, alpha));
  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${a})`;
}

// ----------------------------------------------------------- pure: text layout

/** Width of `text` at `fontSizePx` — injected so layout is testable sans canvas. */
export type MeasureFn = (text: string, fontSizePx: number) => number;

export interface TextLayoutOpts {
  text: string;
  maxWidth: number;
  maxHeight: number;
  fontSizePx: number;
  /** Shrink-to-fit floor; defaults to fontSizePx (no shrinking). */
  minSizePx?: number;
  /** Line-height factor (default 1.3). */
  lineHeight?: number;
  maxLines?: number;
}

export interface TextLayout {
  lines: string[];
  fontSizePx: number;
  lineHeightPx: number;
  truncated: boolean;
}

const ELLIPSIS = '…';
const SHRINK_STEP = 2;
export const DEFAULT_LINE_HEIGHT = 1.3;

/** Greedy word wrap of a single paragraph; words wider than the box are
 *  hard-broken by characters so nothing ever overflows horizontally. */
export function wrapLine(
  line: string,
  fontSizePx: number,
  maxWidth: number,
  measure: MeasureFn,
): string[] {
  const words = line.split(/\s+/).filter((w) => w !== '');
  if (words.length === 0) return [''];

  const out: string[] = [];
  let cur = '';
  const pushWord = (word: string): void => {
    if (measure(word, fontSizePx) <= maxWidth) {
      cur = word;
      return;
    }
    // Hard-break an over-wide word (URLs, long handles) by characters.
    let chunk = '';
    for (const ch of word) {
      if (chunk !== '' && measure(chunk + ch, fontSizePx) > maxWidth) {
        out.push(chunk);
        chunk = ch;
      } else {
        chunk += ch;
      }
    }
    cur = chunk;
  };

  for (const word of words) {
    if (cur === '') {
      pushWord(word);
      continue;
    }
    const candidate = `${cur} ${word}`;
    if (measure(candidate, fontSizePx) <= maxWidth) {
      cur = candidate;
    } else {
      out.push(cur);
      cur = '';
      pushWord(word);
    }
  }
  if (cur !== '') out.push(cur);
  return out.length > 0 ? out : [''];
}

function wrapAll(text: string, fontSizePx: number, maxWidth: number, measure: MeasureFn): string[] {
  // Explicit newlines are paragraph breaks; blank lines survive (tweets use
  // them as rhythm, and the quote card must reproduce that rhythm).
  return text
    .replace(/\r\n/g, '\n')
    .split('\n')
    .flatMap((l) => (l.trim() === '' ? [''] : wrapLine(l, fontSizePx, maxWidth, measure)));
}

function ellipsize(line: string, fontSizePx: number, maxWidth: number, measure: MeasureFn): string {
  if (measure(line + ELLIPSIS, fontSizePx) <= maxWidth) return line + ELLIPSIS;
  let cut = line;
  while (cut.length > 0 && measure(cut.trimEnd() + ELLIPSIS, fontSizePx) > maxWidth) {
    cut = cut.slice(0, -1);
  }
  return cut.trimEnd() + ELLIPSIS;
}

/** Wrap → shrink until the block fits the box → ellipsize at the floor.
 *  Pure over `measure`; this is the function the test matrix hammers. */
export function layoutText(opts: TextLayoutOpts, measure: MeasureFn): TextLayout {
  const lineHeight = opts.lineHeight ?? DEFAULT_LINE_HEIGHT;
  const minSize = Math.min(opts.minSizePx ?? opts.fontSizePx, opts.fontSizePx);

  for (let size = opts.fontSizePx; size >= minSize; size -= SHRINK_STEP) {
    const lines = wrapAll(opts.text, size, opts.maxWidth, measure);
    const lineHeightPx = size * lineHeight;
    const fitsHeight = lines.length * lineHeightPx <= opts.maxHeight + 0.5;
    const fitsLines = opts.maxLines === undefined || lines.length <= opts.maxLines;
    if (fitsHeight && fitsLines) {
      return { lines, fontSizePx: size, lineHeightPx, truncated: false };
    }
  }

  // Nothing fit at the floor: keep as many lines as the box allows and
  // ellipsize the last one. Never return zero lines.
  const lineHeightPx = minSize * lineHeight;
  const all = wrapAll(opts.text, minSize, opts.maxWidth, measure);
  const byHeight = Math.max(1, Math.floor((opts.maxHeight + 0.5) / lineHeightPx));
  const keep = Math.max(1, Math.min(all.length, byHeight, opts.maxLines ?? all.length));
  const lines = all.slice(0, keep);
  const last = lines[keep - 1] ?? '';
  lines[keep - 1] = ellipsize(last, minSize, opts.maxWidth, measure);
  return { lines, fontSizePx: minSize, lineHeightPx, truncated: true };
}

// --------------------------------------------------------- pure: sparkline fit

/** Normalize a point series into box coordinates; [] below 2 points. */
export function sparklineCoords(points: number[], box: Box): Array<{ x: number; y: number }> {
  if (points.length < 2) return [];
  const min = Math.min(...points);
  const span = Math.max(...points) - min || 1;
  const last = points.length - 1;
  return points.map((v, i) => ({
    x: box.x + (i / last) * box.w,
    y: box.y + box.h - ((v - min) / span) * box.h,
  }));
}

// ------------------------------------------------------------ pure: patterns

export type PatternKind = 'dots' | 'grid' | 'diagonal' | 'plus' | 'blobs';

export interface PatternPoint {
  x: number;
  y: number;
  /** Per-point radius — only `blobs` sets it; lattice marks leave it undefined. */
  r?: number;
}

/** Mulberry32 — a tiny seedable [0,1) PRNG. `Math.random` is forbidden in the
 *  Studio: the same spec + seed must yield the same pixels forever, since the
 *  live preview IS the artifact and specs are snapshot-tested. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Box-local geometry for a background pattern in a `w × h` area. Pure so the
 *  layout is unit-testable without a canvas. `dots|grid|diagonal|plus` share a
 *  regular lattice (mark centers / line anchors, top-left-first); `blobs`
 *  returns seeded-random points each with their own radius. drawPattern offsets
 *  these by the layer's box origin. */
export function patternCoords(
  pattern: PatternKind,
  w: number,
  h: number,
  spacing: number,
  seed: number,
): PatternPoint[] {
  const step = Math.max(1, spacing);
  if (pattern === 'blobs') {
    const rand = mulberry32(seed);
    const count = Math.max(1, Math.floor(w / step)) * Math.max(1, Math.floor(h / step));
    const out: PatternPoint[] = [];
    for (let i = 0; i < count; i += 1) {
      // Three draws per blob (x, y, r) — order fixed so the sequence is stable.
      out.push({ x: rand() * w, y: rand() * h, r: step * (0.25 + rand() * 0.5) });
    }
    return out;
  }
  const out: PatternPoint[] = [];
  for (let y = step / 2; y < h; y += step) {
    for (let x = step / 2; x < w; x += step) {
      out.push({ x, y });
    }
  }
  return out;
}

// ------------------------------------------------------------------- rendering

type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

function fontString(font: FontSpec, sizePx: number): string {
  return `${font.weight} ${sizePx}px ${font.family}`;
}

function drawFill(ctx: Ctx2D, layer: Extract<Layer, { kind: 'fill' }>, spec: RenderSpec): void {
  if (layer.color2) {
    const grad = ctx.createLinearGradient(0, 0, 0, spec.h);
    grad.addColorStop(0, layer.color);
    grad.addColorStop(1, layer.color2);
    ctx.fillStyle = grad;
  } else {
    ctx.fillStyle = layer.color;
  }
  ctx.fillRect(0, 0, spec.w, spec.h);
}

function drawImage(ctx: Ctx2D, layer: Extract<Layer, { kind: 'image' }>): void {
  const { box, src } = layer;
  const scale = Math.max(box.w / src.width, box.h / src.height);
  const sw = box.w / scale;
  const sh = box.h / scale;
  const sx = (src.width - sw) / 2;
  const sy = (src.height - sh) / 2;
  ctx.save();
  if (layer.circle) {
    const r = Math.min(box.w, box.h) / 2;
    ctx.beginPath();
    ctx.arc(box.x + box.w / 2, box.y + box.h / 2, r, 0, Math.PI * 2);
    ctx.clip();
  }
  ctx.drawImage(src, sx, sy, sw, sh, box.x, box.y, box.w, box.h);
  ctx.restore();
}

function drawText(ctx: Ctx2D, layer: Extract<Layer, { kind: 'text' }>): void {
  ctx.save();
  if (layer.letterSpacingPx !== undefined && 'letterSpacing' in ctx) {
    ctx.letterSpacing = `${layer.letterSpacingPx}px`;
  }
  const measure: MeasureFn = (text, sizePx) => {
    ctx.font = fontString(layer.font, sizePx);
    return ctx.measureText(text).width;
  };
  const layout = layoutText(
    {
      text: layer.text,
      maxWidth: layer.box.w,
      maxHeight: layer.box.h,
      fontSizePx: layer.font.sizePx,
      ...(layer.minSizePx !== undefined ? { minSizePx: layer.minSizePx } : {}),
      ...(layer.lineHeight !== undefined ? { lineHeight: layer.lineHeight } : {}),
      ...(layer.maxLines !== undefined ? { maxLines: layer.maxLines } : {}),
    },
    measure,
  );

  ctx.font = fontString(layer.font, layout.fontSizePx);
  ctx.fillStyle = layer.color;
  ctx.textBaseline = 'top';

  const blockH = layout.lines.length * layout.lineHeightPx;
  const startY =
    layer.vAlign === 'middle' ? layer.box.y + Math.max(0, (layer.box.h - blockH) / 2) : layer.box.y;
  // Center each line inside its line-height slot so ascent/descent balance.
  const inset = (layout.lineHeightPx - layout.fontSizePx) / 2;

  layout.lines.forEach((line, i) => {
    if (line === '') return;
    const width = ctx.measureText(line).width;
    const x =
      layer.align === 'center'
        ? layer.box.x + (layer.box.w - width) / 2
        : layer.align === 'right'
          ? layer.box.x + layer.box.w - width
          : layer.box.x;
    ctx.fillText(line, x, startY + i * layout.lineHeightPx + inset);
  });
  ctx.restore();
}

function drawSparkline(ctx: Ctx2D, layer: Extract<Layer, { kind: 'sparkline' }>): void {
  const coords = sparklineCoords(layer.points, layer.box);
  if (coords.length < 2) return;
  const first = coords[0] as { x: number; y: number };
  const last = coords[coords.length - 1] as { x: number; y: number };

  if (layer.fill) {
    ctx.beginPath();
    ctx.moveTo(first.x, layer.box.y + layer.box.h);
    for (const p of coords) ctx.lineTo(p.x, p.y);
    ctx.lineTo(last.x, layer.box.y + layer.box.h);
    ctx.closePath();
    ctx.fillStyle = layer.fill;
    ctx.fill();
  }

  ctx.beginPath();
  ctx.moveTo(first.x, first.y);
  for (const p of coords.slice(1)) ctx.lineTo(p.x, p.y);
  ctx.strokeStyle = layer.color;
  ctx.lineWidth = layer.strokeWidth ?? 4;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.stroke();

  // End dot — reads as "today".
  ctx.beginPath();
  ctx.arc(last.x, last.y, (layer.strokeWidth ?? 4) * 1.4, 0, Math.PI * 2);
  ctx.fillStyle = layer.color;
  ctx.fill();
}

function drawBadges(ctx: Ctx2D, layer: Extract<Layer, { kind: 'badge' }>): void {
  const padX = layer.padX ?? 18;
  const padY = layer.padY ?? 10;
  const gap = layer.gap ?? 12;
  ctx.font = fontString(layer.font, layer.font.sizePx);
  ctx.textBaseline = 'top';
  const pillH = layer.font.sizePx + padY * 2;

  let x = layer.x;
  for (const text of layer.texts) {
    const w = ctx.measureText(text).width + padX * 2;
    if (layer.maxWidth !== undefined && x + w > layer.x + layer.maxWidth) break;
    ctx.beginPath();
    ctx.roundRect(x, layer.y, w, pillH, pillH / 2);
    if (layer.bg) {
      ctx.fillStyle = layer.bg;
      ctx.fill();
    }
    if (layer.borderColor) {
      ctx.strokeStyle = layer.borderColor;
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    ctx.fillStyle = layer.color;
    ctx.fillText(text, x + padX, layer.y + padY);
    x += w + gap;
  }
}

function drawRule(ctx: Ctx2D, layer: Extract<Layer, { kind: 'rule' }>): void {
  ctx.beginPath();
  ctx.roundRect(layer.box.x, layer.box.y, layer.box.w, layer.box.h, layer.box.h / 2);
  ctx.fillStyle = layer.color;
  ctx.fill();
}

function drawRing(ctx: Ctx2D, layer: Extract<Layer, { kind: 'ring' }>): void {
  ctx.beginPath();
  ctx.arc(layer.cx, layer.cy, layer.r, 0, Math.PI * 2);
  ctx.strokeStyle = layer.color;
  ctx.lineWidth = layer.width;
  ctx.stroke();
}

function drawPath(ctx: Ctx2D, layer: Extract<Layer, { kind: 'path' }>): void {
  const { box } = layer;
  const sx = box.w / 100;
  const sy = box.h / 100;
  ctx.save();
  ctx.translate(box.x, box.y);
  ctx.scale(sx, sy);
  const path = new Path2D(layer.d);
  if (layer.fill) {
    ctx.fillStyle = layer.fill;
    ctx.fill(path);
  }
  if (layer.stroke) {
    // Undo the mean scale so the stroke keeps its intended px width.
    const meanScale = (sx + sy) / 2 || 1;
    ctx.strokeStyle = layer.stroke;
    ctx.lineWidth = (layer.strokeWidth ?? 1) / meanScale;
    ctx.lineJoin = 'round';
    ctx.stroke(path);
  }
  ctx.restore();
}

function drawPanel(ctx: Ctx2D, layer: Extract<Layer, { kind: 'panel' }>): void {
  const { box } = layer;
  ctx.save();
  if (layer.shadow) {
    ctx.shadowBlur = layer.shadow.blur;
    ctx.shadowColor = layer.shadow.color;
    ctx.shadowOffsetY = layer.shadow.dy;
  }
  ctx.beginPath();
  ctx.roundRect(box.x, box.y, box.w, box.h, layer.radius);
  if (layer.fill) {
    ctx.fillStyle = layer.fill;
    ctx.fill();
  }
  if (layer.stroke) {
    // Drop the shadow before stroking so the border isn't doubled by a halo.
    ctx.shadowColor = 'transparent';
    ctx.strokeStyle = layer.stroke;
    ctx.lineWidth = layer.strokeWidth ?? 2;
    ctx.stroke();
  }
  ctx.restore();
}

function drawPattern(
  ctx: Ctx2D,
  layer: Extract<Layer, { kind: 'pattern' }>,
  spec: RenderSpec,
): void {
  const box = layer.box ?? { x: 0, y: 0, w: spec.w, h: spec.h };
  const spacing = Math.max(1, layer.spacing ?? 40);
  const size = layer.size ?? Math.max(2, spacing * 0.08);
  const coords = patternCoords(layer.pattern, box.w, box.h, spacing, layer.seed ?? 1);

  ctx.save();
  ctx.beginPath();
  ctx.rect(box.x, box.y, box.w, box.h);
  ctx.clip();

  if (layer.pattern === 'dots' || layer.pattern === 'blobs') {
    ctx.fillStyle = layer.color;
    for (const p of coords) {
      ctx.beginPath();
      ctx.arc(box.x + p.x, box.y + p.y, p.r ?? size, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (layer.pattern === 'plus') {
    ctx.strokeStyle = layer.color;
    ctx.lineWidth = Math.max(1, size / 3);
    ctx.lineCap = 'round';
    for (const p of coords) {
      const cx = box.x + p.x;
      const cy = box.y + p.y;
      ctx.beginPath();
      ctx.moveTo(cx - size, cy);
      ctx.lineTo(cx + size, cy);
      ctx.moveTo(cx, cy - size);
      ctx.lineTo(cx, cy + size);
      ctx.stroke();
    }
  } else if (layer.pattern === 'grid') {
    ctx.strokeStyle = layer.color;
    ctx.lineWidth = Math.max(1, size / 4);
    for (const x of new Set(coords.map((p) => p.x))) {
      ctx.beginPath();
      ctx.moveTo(box.x + x, box.y);
      ctx.lineTo(box.x + x, box.y + box.h);
      ctx.stroke();
    }
    for (const y of new Set(coords.map((p) => p.y))) {
      ctx.beginPath();
      ctx.moveTo(box.x, box.y + y);
      ctx.lineTo(box.x + box.w, box.y + y);
      ctx.stroke();
    }
  } else {
    // diagonal — parallel lines from box+spacing, sweeping past both corners.
    ctx.strokeStyle = layer.color;
    ctx.lineWidth = Math.max(1, size / 4);
    for (let o = -box.h; o < box.w; o += spacing) {
      ctx.beginPath();
      ctx.moveTo(box.x + o, box.y);
      ctx.lineTo(box.x + o + box.h, box.y + box.h);
      ctx.stroke();
    }
  }

  ctx.restore();
}

function drawWatermark(
  ctx: Ctx2D,
  layer: Extract<Layer, { kind: 'watermark' }>,
  spec: RenderSpec,
): void {
  const margin = layer.margin ?? 40;
  ctx.font = fontString(layer.font, layer.font.sizePx);
  ctx.fillStyle = layer.color;
  ctx.textBaseline = 'bottom';
  const w = ctx.measureText(layer.text).width;
  ctx.fillText(layer.text, spec.w - margin - w, spec.h - margin);
}

function drawLayer(ctx: Ctx2D, layer: Layer, spec: RenderSpec): void {
  switch (layer.kind) {
    case 'fill':
      drawFill(ctx, layer, spec);
      break;
    case 'image':
      drawImage(ctx, layer);
      break;
    case 'text':
      drawText(ctx, layer);
      break;
    case 'sparkline':
      drawSparkline(ctx, layer);
      break;
    case 'badge':
      drawBadges(ctx, layer);
      break;
    case 'rule':
      drawRule(ctx, layer);
      break;
    case 'ring':
      drawRing(ctx, layer);
      break;
    case 'watermark':
      drawWatermark(ctx, layer, spec);
      break;
    case 'path':
      drawPath(ctx, layer);
      break;
    case 'panel':
      drawPanel(ctx, layer);
      break;
    case 'pattern':
      drawPattern(ctx, layer, spec);
      break;
  }
}

/** Render a spec to a PNG blob. Defaults to an OffscreenCanvas; the Studio tab
 *  passes a detached document canvas instead so custom FontFaces are
 *  guaranteed visible to measureText/fillText. */
export async function render(
  spec: RenderSpec,
  canvas?: OffscreenCanvas | HTMLCanvasElement,
): Promise<Blob> {
  const cv = canvas ?? new OffscreenCanvas(spec.w, spec.h);
  cv.width = spec.w;
  cv.height = spec.h;
  const ctx = cv.getContext('2d') as Ctx2D | null;
  if (!ctx) throw new Error('no_2d_context');

  for (const layer of spec.layers) drawLayer(ctx, layer, spec);

  if ('convertToBlob' in cv) return cv.convertToBlob({ type: 'image/png' });
  return new Promise((resolve, reject) => {
    (cv as HTMLCanvasElement).toBlob(
      (b) => (b ? resolve(b) : reject(new Error('to_blob_failed'))),
      'image/png',
    );
  });
}
