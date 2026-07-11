// Brand kit (SURFACES S3.1): the two colors, font stack, handle and watermark
// toggle every template renders with. Lives in chrome.storage.local so it
// survives the panel; export/import is plain JSON so the brand can move
// between machines (or be versioned in a gist). Parsing/serializing is pure
// and bun-tested; only load/save touch chrome.*.

import { hexToRgb } from './compose.ts';

export interface BrandKit {
  /** Card background. Ink color is derived from it (contrastOn), so two
   *  colors are the whole palette — the constraint IS the brand. */
  bg: string;
  accent: string;
  fontFamily: string;
  /** Bare handle, no @ (rendered with the @ where templates want it). */
  handle: string;
  watermark: boolean;
  watermarkText: string;
}

/** Bundled Inter (public/fonts/*.woff2, loaded via FontFace as 'StudioInter')
 *  keeps typography deterministic across machines; the tail is the fallback
 *  when the font files fail to load. */
export const STUDIO_FONT_STACK = "'StudioInter', -apple-system, 'Segoe UI', Roboto, sans-serif";

export const DEFAULT_BRAND_KIT: BrandKit = {
  bg: '#0f1419',
  accent: '#1d9bf0',
  fontFamily: STUDIO_FONT_STACK,
  handle: '',
  watermark: true,
  watermarkText: 'stratus',
};

function isValidColor(v: unknown): v is string {
  return typeof v === 'string' && hexToRgb(v) !== null;
}

export function normalizeHandle(v: string): string {
  return v.trim().replace(/^@+/, '');
}

/** Lenient parse: unknown fields ignored, missing/invalid fields fall back to
 *  the default kit — an imported JSON from an older build still lands. Null
 *  only on non-object JSON or a parse error. */
export function parseBrandKit(raw: string): BrandKit | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const o = parsed as Record<string, unknown>;
  return {
    bg: isValidColor(o.bg) ? (o.bg as string).trim() : DEFAULT_BRAND_KIT.bg,
    accent: isValidColor(o.accent) ? (o.accent as string).trim() : DEFAULT_BRAND_KIT.accent,
    fontFamily:
      typeof o.fontFamily === 'string' && o.fontFamily.trim() !== ''
        ? o.fontFamily.trim()
        : DEFAULT_BRAND_KIT.fontFamily,
    handle: typeof o.handle === 'string' ? normalizeHandle(o.handle) : DEFAULT_BRAND_KIT.handle,
    watermark: typeof o.watermark === 'boolean' ? o.watermark : DEFAULT_BRAND_KIT.watermark,
    watermarkText:
      typeof o.watermarkText === 'string' && o.watermarkText.trim() !== ''
        ? o.watermarkText.trim()
        : DEFAULT_BRAND_KIT.watermarkText,
  };
}

export function serializeBrandKit(kit: BrandKit): string {
  return JSON.stringify(kit, null, 2);
}

// ------------------------------------------------------------ chrome storage

const KEY_BRAND_KIT = 'studio:brandKit';

export async function loadBrandKit(): Promise<BrandKit> {
  const out = await chrome.storage.local.get(KEY_BRAND_KIT);
  const raw = out[KEY_BRAND_KIT];
  if (typeof raw !== 'string') return { ...DEFAULT_BRAND_KIT };
  return parseBrandKit(raw) ?? { ...DEFAULT_BRAND_KIT };
}

export async function saveBrandKit(kit: BrandKit): Promise<void> {
  await chrome.storage.local.set({ [KEY_BRAND_KIT]: serializeBrandKit(kit) });
}
