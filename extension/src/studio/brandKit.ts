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
  /** SURFACES S4 — the fixed style suffix appended to every AI background
   *  prompt. Consistency across months of posts IS the brand; the "no text"
   *  clause is load-bearing (image models garble words — brand text is always
   *  canvas-rendered on top, never generated). */
  imageStyleSuffix: string;
  /** SURFACES S5.3 — show the deterministic cloud mascot on cards that support
   *  it (quote/stat/banner). Default true; legacy kits without the field read
   *  as true so an old import keeps the mascot. */
  mascot: boolean;
}

export const DEFAULT_IMAGE_STYLE_SUFFIX =
  'flat vector illustration, soft muted palette, subtle grain, generous negative space, no text, no letters, no words, no logos, no watermark';

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
  imageStyleSuffix: DEFAULT_IMAGE_STYLE_SUFFIX,
  mascot: true,
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
    imageStyleSuffix:
      typeof o.imageStyleSuffix === 'string' && o.imageStyleSuffix.trim() !== ''
        ? o.imageStyleSuffix.trim()
        : DEFAULT_BRAND_KIT.imageStyleSuffix,
    mascot: typeof o.mascot === 'boolean' ? o.mascot : DEFAULT_BRAND_KIT.mascot,
  };
}

export function serializeBrandKit(kit: BrandKit): string {
  return JSON.stringify(kit, null, 2);
}

// --------------------------------------------------------- multi-preset (S5.4)

/** A named set of brand kits with one active — a whole brand switches in one
 *  click. Stored client-side (no server table; the kit has always been
 *  extension-local, export/import JSON is the portability story). */
export interface BrandKits {
  active: string;
  kits: Record<string, BrandKit>;
}

/** Built-in starter presets offered when the store is empty. Midnight is the
 *  current default; Paper is a light background (contrastOn flips the ink);
 *  Neon is a high-accent near-black. All three carry every field (incl.
 *  `mascot`) so a preset load never drops one. */
export const STARTER_KITS: Record<string, BrandKit> = {
  Midnight: { ...DEFAULT_BRAND_KIT },
  Paper: { ...DEFAULT_BRAND_KIT, bg: '#f7f9f9', accent: '#0f6fd1' },
  Neon: { ...DEFAULT_BRAND_KIT, bg: '#0a0e12', accent: '#00e5a0' },
};
export const STARTER_ACTIVE = 'Midnight';

function starterBundle(): BrandKits {
  const kits: Record<string, BrandKit> = {};
  for (const [name, kit] of Object.entries(STARTER_KITS)) kits[name] = { ...kit };
  return { active: STARTER_ACTIVE, kits };
}

/** The active kit by reference (stable across renders unless it's edited), so a
 *  React effect keyed on it doesn't re-fire every render. */
export function activeKit(bundle: BrandKits): BrandKit {
  return bundle.kits[bundle.active] ?? DEFAULT_BRAND_KIT;
}

export function serializeBrandKits(bundle: BrandKits): string {
  return JSON.stringify(bundle, null, 2);
}

/** Lenient parse of the multi-preset shape — each kit falls back field-by-field
 *  through parseBrandKit; the active pointer is clamped to an existing kit.
 *  Null only when there isn't a single salvageable kit. */
function parseBrandKitsObject(o: Record<string, unknown>): BrandKits | null {
  if (!o.kits || typeof o.kits !== 'object' || Array.isArray(o.kits)) return null;
  const kits: Record<string, BrandKit> = {};
  for (const [name, v] of Object.entries(o.kits as Record<string, unknown>)) {
    if (!v || typeof v !== 'object' || Array.isArray(v)) continue;
    const kit = parseBrandKit(JSON.stringify(v));
    if (kit) kits[name] = kit;
  }
  const names = Object.keys(kits);
  if (names.length === 0) return null;
  const active = typeof o.active === 'string' && kits[o.active] ? o.active : (names[0] as string);
  return { active, kits };
}

/** Import parse accepting BOTH file shapes: the S5.4 multi bundle AND a legacy
 *  single-kit JSON (wrapped into `{ active: 'default', kits: { default } }`).
 *  Null on non-object / unparseable JSON. */
export function parseBrandKitsFile(raw: string): BrandKits | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const o = parsed as Record<string, unknown>;
  if ('kits' in o) return parseBrandKitsObject(o);
  const single = parseBrandKit(raw);
  return single ? { active: 'default', kits: { default: single } } : null;
}

// ------------------------------------------------------- pure preset mutations

export function patchActiveKit(bundle: BrandKits, partial: Partial<BrandKit>): BrandKits {
  const next = { ...activeKit(bundle), ...partial };
  return { active: bundle.active, kits: { ...bundle.kits, [bundle.active]: next } };
}

export function setActivePreset(bundle: BrandKits, name: string): BrandKits {
  return name in bundle.kits ? { ...bundle, active: name } : bundle;
}

/** Save `kit` under `name` and activate it (overwrites an existing name). */
export function savePresetAs(bundle: BrandKits, name: string, kit: BrandKit): BrandKits {
  const n = name.trim();
  if (n === '') return bundle;
  return { active: n, kits: { ...bundle.kits, [n]: { ...kit } } };
}

export function renamePreset(bundle: BrandKits, from: string, to: string): BrandKits {
  const n = to.trim();
  if (!(from in bundle.kits) || n === '' || n === from) return bundle;
  const kits: Record<string, BrandKit> = {};
  for (const [k, v] of Object.entries(bundle.kits)) kits[k === from ? n : k] = v;
  return { active: bundle.active === from ? n : bundle.active, kits };
}

/** The last preset can never be deleted — the store must never reach zero kits
 *  (mirrors the pillars last-active guard). */
export function canDeletePreset(bundle: BrandKits, name: string): boolean {
  return name in bundle.kits && Object.keys(bundle.kits).length > 1;
}

export function deletePreset(bundle: BrandKits, name: string): BrandKits {
  if (!canDeletePreset(bundle, name)) return bundle;
  const kits: Record<string, BrandKit> = {};
  for (const [k, v] of Object.entries(bundle.kits)) if (k !== name) kits[k] = v;
  const active = bundle.active === name ? (Object.keys(kits)[0] as string) : bundle.active;
  return { active, kits };
}

// ------------------------------------------------------------ chrome storage

const KEY_BRAND_KIT = 'studio:brandKit'; // legacy single-kit (still written)
const KEY_BRAND_KITS = 'studio:brandKits'; // S5.4 multi-preset

/** Load the multi-preset bundle: the new key wins; else migrate a legacy single
 *  kit into `kits.default`; else seed the built-in starters. Persists the
 *  result so migration/seed happen exactly once. */
export async function loadBrandKits(): Promise<BrandKits> {
  const out = await chrome.storage.local.get([KEY_BRAND_KITS, KEY_BRAND_KIT]);
  const rawMulti = out[KEY_BRAND_KITS];
  if (typeof rawMulti === 'string') {
    const multi = parseBrandKitsFile(rawMulti);
    if (multi) return multi;
  }
  const legacyRaw = out[KEY_BRAND_KIT];
  const bundle =
    typeof legacyRaw === 'string' && parseBrandKit(legacyRaw)
      ? { active: 'default', kits: { default: parseBrandKit(legacyRaw) as BrandKit } }
      : starterBundle();
  await saveBrandKits(bundle);
  return bundle;
}

export async function saveBrandKits(bundle: BrandKits): Promise<void> {
  await chrome.storage.local.set({ [KEY_BRAND_KITS]: serializeBrandKits(bundle) });
  // Keep the legacy key pointing at the active kit so a rollback build (which
  // only reads studio:brandKit) still loads the right brand.
  const active = bundle.kits[bundle.active];
  if (active) await chrome.storage.local.set({ [KEY_BRAND_KIT]: serializeBrandKit(active) });
}
