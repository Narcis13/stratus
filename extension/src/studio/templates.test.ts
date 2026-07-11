// S3.2 templates — snapshot the *layer lists* (kinds, key text, geometry
// anchors), never pixels: the specs are pure over (data, kit), so a changed
// layer list is a changed design decision and should fail loudly here.

import { describe, expect, test } from 'bun:test';
import type { BrandKit } from './brandKit.ts';
import {
  BANNER,
  PFP_FRAME,
  QUOTE_CARD,
  STAT_CARD,
  bannerSpec,
  fmtCount,
  pfpFrameSpec,
  quoteCardSpec,
  statCardSpec,
} from './templates.ts';

const kit: BrandKit = {
  bg: '#0f1419',
  accent: '#1d9bf0',
  fontFamily: 'TestFont',
  handle: 'narcis',
  watermark: true,
  watermarkText: 'stratus',
  imageStyleSuffix: 'flat vector, no text',
};

// A stub bitmap — templates only store the ref (no methods called), so a plain
// object typed as ImageBitmap is enough to exercise the S4 background branch.
const STUB_BG = { width: 1200, height: 675 } as unknown as ImageBitmap;

function kinds(spec: { layers: Array<{ kind: string }> }): string[] {
  return spec.layers.map((l) => l.kind);
}

describe('fmtCount', () => {
  test('deterministic tiers', () => {
    expect(fmtCount(999)).toBe('999');
    expect(fmtCount(1000)).toBe('1k');
    expect(fmtCount(1500)).toBe('1.5k');
    expect(fmtCount(12_345)).toBe('12.3k');
    expect(fmtCount(2_000_000)).toBe('2M');
  });
});

describe('quoteCardSpec', () => {
  test('full kit → fill, accent rule, quote, handle, watermark', () => {
    const spec = quoteCardSpec({ text: 'ship small, ship daily' }, kit);
    expect(spec.w).toBe(QUOTE_CARD.w);
    expect(spec.h).toBe(QUOTE_CARD.h);
    expect(kinds(spec)).toEqual(['fill', 'rule', 'text', 'text', 'watermark']);

    const quote = spec.layers[2];
    expect(quote).toMatchObject({
      kind: 'text',
      text: 'ship small, ship daily',
      vAlign: 'middle',
      minSizePx: 32,
    });
    expect(spec.layers[3]).toMatchObject({ kind: 'text', text: '@narcis', color: kit.accent });
    expect(spec.layers[4]).toMatchObject({ kind: 'watermark', text: 'stratus' });
  });

  test('no handle, watermark off → just the quote', () => {
    const spec = quoteCardSpec({ text: 'x' }, { ...kit, handle: '', watermark: false });
    expect(kinds(spec)).toEqual(['fill', 'rule', 'text']);
  });

  test('gradient background derives from the kit bg', () => {
    const spec = quoteCardSpec({ text: 'x' }, kit);
    expect(spec.layers[0]).toMatchObject({ kind: 'fill', color: '#0f1419' });
    expect((spec.layers[0] as { color2?: string }).color2).toMatch(/^#[0-9a-f]{6}$/);
  });

  test('S4 AI background: image cover + scrim UNDER the text', () => {
    const spec = quoteCardSpec({ text: 'ship daily', background: STUB_BG }, kit);
    // image (cover, full canvas) then a semi-transparent scrim, THEN the text.
    expect(kinds(spec)).toEqual(['image', 'fill', 'rule', 'text', 'text', 'watermark']);
    expect(spec.layers[0]).toMatchObject({
      kind: 'image',
      src: STUB_BG,
      fit: 'cover',
      box: { x: 0, y: 0, w: QUOTE_CARD.w, h: QUOTE_CARD.h },
    });
    // The scrim is an rgba wash of the brand bg — it keeps text legible.
    expect((spec.layers[1] as { kind: string; color: string }).color).toMatch(/^rgba\(/);
    // The quote still renders on top, unchanged.
    expect(spec.layers[3]).toMatchObject({ kind: 'text', text: 'ship daily' });
  });

  test('background=null renders the plain gradient (backwards-compatible)', () => {
    const spec = quoteCardSpec({ text: 'x', background: null }, kit);
    expect(kinds(spec)).toEqual(['fill', 'rule', 'text', 'text', 'watermark']);
  });
});

describe('statCardSpec', () => {
  const full = {
    followers: 1234,
    delta: 12,
    sparkline: [1200, 1210, 1225, 1234],
    weekLabel: 'week of 2026-07-06',
    posts: 18,
    replies: 61,
    topPostText: 'the post that went places',
    topPostViews: 15_400,
    streakDays: 4,
  };

  test('full data → number, delta badge, sparkline, top post, footer', () => {
    const spec = statCardSpec(full, kit);
    expect(spec.w).toBe(STAT_CARD.w);
    expect(kinds(spec)).toEqual([
      'fill',
      'text', // THIS WEEK
      'text', // streak + week label
      'text', // follower count
      'text', // "followers"
      'badge', // delta
      'sparkline',
      'rule',
      'text', // TOP POST
      'text', // snippet
      'text', // views
      'text', // posts · replies
      'text', // handle
      'watermark',
    ]);
    expect(spec.layers[2]).toMatchObject({ text: '4-day streak · week of 2026-07-06' });
    expect(spec.layers[3]).toMatchObject({ text: '1.2k' });
    expect(spec.layers[5]).toMatchObject({ kind: 'badge', texts: ['+12 this week'] });
    expect(spec.layers[10]).toMatchObject({ text: '15.4k views', align: 'right' });
    expect(spec.layers[11]).toMatchObject({ text: '18 posts · 61 replies' });
  });

  test('a negative week keeps its sign', () => {
    const spec = statCardSpec({ ...full, delta: -3 }, kit);
    const badge = spec.layers.find((l) => l.kind === 'badge');
    expect(badge).toMatchObject({ texts: ['-3 this week'] });
  });

  test('empty account → no number, no sparkline, fallback line instead of top post', () => {
    const spec = statCardSpec(
      {
        followers: null,
        delta: null,
        sparkline: [],
        weekLabel: 'week of 2026-07-06',
        posts: null,
        replies: null,
        topPostText: null,
        topPostViews: null,
        streakDays: null,
      },
      { ...kit, handle: '', watermark: false },
    );
    expect(kinds(spec)).toEqual(['fill', 'text', 'text', 'rule', 'text']);
    expect(spec.layers[4]).toMatchObject({
      text: 'first full week — numbers land next Sunday',
    });
  });
});

describe('bannerSpec', () => {
  test('headline + keywords + milestone + handle-as-identity', () => {
    const spec = bannerSpec(
      { headline: 'building stratus in public', keywords: ['ai craft', 'builder'], followers: 980 },
      kit,
    );
    expect(spec.w).toBe(BANNER.w);
    expect(spec.h).toBe(BANNER.h);
    expect(kinds(spec)).toEqual(['fill', 'rule', 'text', 'badge', 'text', 'text', 'watermark']);
    expect(spec.layers[3]).toMatchObject({ texts: ['ai craft', 'builder'] });
    expect(spec.layers[4]).toMatchObject({ text: '980', color: kit.accent });
    // The handle signs the banner even with the watermark toggle on.
    expect(spec.layers[6]).toMatchObject({ kind: 'watermark', text: '@narcis' });
  });

  test('no milestone → headline gets the full width', () => {
    const spec = bannerSpec({ headline: 'h', keywords: [], followers: null }, kit);
    expect(kinds(spec)).toEqual(['fill', 'rule', 'text', 'watermark']);
    const headline = spec.layers[2] as { box: { w: number } };
    expect(headline.box.w).toBe(1340);
  });

  test('no handle falls back to the watermark text', () => {
    const spec = bannerSpec(
      { headline: 'h', keywords: [], followers: null },
      { ...kit, handle: '' },
    );
    expect(spec.layers[spec.layers.length - 1]).toMatchObject({
      kind: 'watermark',
      text: 'stratus',
    });
  });
});

describe('pfpFrameSpec', () => {
  test('photo → circle-cropped image inside the accent ring', () => {
    const photo = { width: 800, height: 600 } as ImageBitmap;
    const spec = pfpFrameSpec({ photo, initial: 'n' }, kit);
    expect(spec.w).toBe(PFP_FRAME.w);
    expect(kinds(spec)).toEqual(['fill', 'image', 'ring']);
    expect(spec.layers[1]).toMatchObject({ kind: 'image', circle: true, fit: 'cover' });
    expect(spec.layers[2]).toMatchObject({ kind: 'ring', color: kit.accent });
  });

  test('no photo → monogram disc, uppercased', () => {
    const spec = pfpFrameSpec({ photo: null, initial: 'narcis' }, kit);
    expect(kinds(spec)).toEqual(['fill', 'ring', 'text', 'ring']);
    expect(spec.layers[2]).toMatchObject({ text: 'N', align: 'center' });
    // Regression: the glyph's line box must fit its text box, or the layout
    // engine ellipsizes the single letter into "N…" at render time.
    const mono = spec.layers[2] as {
      font: { sizePx: number };
      lineHeight?: number;
      box: { h: number };
    };
    expect(mono.font.sizePx * (mono.lineHeight ?? 1.3)).toBeLessThanOrEqual(mono.box.h);
  });

  test('empty initial still renders something', () => {
    const spec = pfpFrameSpec({ photo: null, initial: '' }, kit);
    expect(spec.layers[2]).toMatchObject({ text: '?' });
  });
});
