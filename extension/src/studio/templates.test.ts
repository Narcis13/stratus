// S3.2 templates — snapshot the *layer lists* (kinds, key text, geometry
// anchors), never pixels: the specs are pure over (data, kit), so a changed
// layer list is a changed design decision and should fail loudly here.

import { describe, expect, test } from 'bun:test';
import type { BrandKit } from './brandKit.ts';
import { MONO_ADVANCE } from './codeTokens.ts';
import {
  BANNER,
  CODE_CARD,
  LIST_CARD,
  MILESTONE_CARD,
  PFP_FRAME,
  QUOTE_CARD,
  STAT_CARD,
  STREAK_CARD,
  THREAD_COVER,
  bannerSpec,
  codeCardSpec,
  fmtCount,
  listCardSpec,
  milestoneCardSpec,
  parseListItems,
  pfpFrameSpec,
  quoteCardSpec,
  statCardSpec,
  streakCardSpec,
  threadCoverSpec,
} from './templates.ts';

// mascot off by default so the S3/S4 snapshots below stay byte-identical; the
// mascot-wiring block flips it on explicitly.
const kit: BrandKit = {
  bg: '#0f1419',
  accent: '#1d9bf0',
  fontFamily: 'TestFont',
  handle: 'narcis',
  watermark: true,
  watermarkText: 'stratus',
  imageStyleSuffix: 'flat vector, no text',
  mascot: false,
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

describe('mascot wiring (S5.3)', () => {
  const withMascot: BrandKit = { ...kit, mascot: true };
  const hasPath = (spec: { layers: Array<{ kind: string }> }): boolean =>
    spec.layers.some((l) => l.kind === 'path');

  test('quote: mascot adds path layers; mascot:false is byte-identical', () => {
    const off = quoteCardSpec({ text: 'ship' }, kit);
    const on = quoteCardSpec({ text: 'ship' }, withMascot);
    expect(hasPath(off)).toBe(false);
    expect(hasPath(on)).toBe(true);
    // stripping the mascot paths from `on` reproduces the pre-mascot card exactly
    expect(on.layers.filter((l) => l.kind !== 'path')).toEqual(off.layers);
  });

  test('quote: an AI background suppresses the mascot', () => {
    const spec = quoteCardSpec({ text: 'ship', background: STUB_BG }, withMascot);
    expect(hasPath(spec)).toBe(false);
  });

  test('stat: celebrates on a positive week, idles otherwise', () => {
    const base = {
      followers: 1000,
      delta: null,
      sparkline: [],
      weekLabel: 'w',
      posts: null,
      replies: null,
      topPostText: null,
      topPostViews: null,
      streakDays: null,
    };
    const up = statCardSpec({ ...base, delta: 25 }, withMascot);
    const down = statCardSpec({ ...base, delta: -5 }, withMascot);
    const upPaths = up.layers.filter((l) => l.kind === 'path').length;
    const downPaths = down.layers.filter((l) => l.kind === 'path').length;
    // celebrating adds arm puffs + confetti → strictly more path layers than happy
    expect(upPaths).toBeGreaterThan(downPaths);
    expect(downPaths).toBeGreaterThan(0);
    expect(hasPath(statCardSpec({ ...base, delta: 25 }, kit))).toBe(false);
  });

  test('banner: thinking mascot only with no milestone and no AI background', () => {
    expect(hasPath(bannerSpec({ headline: 'h', keywords: [], followers: null }, withMascot))).toBe(
      true,
    );
    expect(hasPath(bannerSpec({ headline: 'h', keywords: [], followers: 980 }, withMascot))).toBe(
      false,
    );
    expect(
      hasPath(
        bannerSpec(
          { headline: 'h', keywords: [], followers: null, background: STUB_BG },
          withMascot,
        ),
      ),
    ).toBe(false);
  });
});

describe('milestoneCardSpec (S5.5)', () => {
  const withMascot: BrandKit = { ...kit, mascot: true };
  const textOf = (l: { kind: string }): string => (l as { text?: string }).text ?? '';

  test('crossed milestone → confetti backdrop, giant number, followers, subtitle', () => {
    const spec = milestoneCardSpec(
      { milestone: 1000, followers: 1024, dateLabel: 'reached 2026-07-10' },
      kit,
    );
    expect(spec.w).toBe(MILESTONE_CARD.w);
    expect(spec.h).toBe(MILESTONE_CARD.h);
    // fill, then the blobs confetti UNDER the content.
    expect(spec.layers[0]).toMatchObject({ kind: 'fill' });
    expect(spec.layers[1]).toMatchObject({ kind: 'pattern', pattern: 'blobs' });
    expect(spec.layers.some((l) => l.kind === 'text' && textOf(l) === '1k')).toBe(true);
    expect(spec.layers.some((l) => l.kind === 'text' && textOf(l) === 'followers')).toBe(true);
    expect(
      spec.layers.some((l) => l.kind === 'text' && /1,024 and counting · reached/.test(textOf(l))),
    ).toBe(true);
  });

  test('confetti is deterministic — the same data renders byte-identically', () => {
    const data = { milestone: 500, followers: 512, dateLabel: 'x' };
    expect(milestoneCardSpec(data, kit)).toEqual(milestoneCardSpec(data, kit));
  });

  test('mascot celebrates with a value; mascot:false has no path', () => {
    expect(
      milestoneCardSpec({ milestone: 500, followers: null, dateLabel: '' }, withMascot).layers.some(
        (l) => l.kind === 'path',
      ),
    ).toBe(true);
    expect(
      milestoneCardSpec({ milestone: 500, followers: null, dateLabel: '' }, kit).layers.some(
        (l) => l.kind === 'path',
      ),
    ).toBe(false);
  });

  test('null milestone → graceful placeholder, no mascot, no crash', () => {
    const spec = milestoneCardSpec({ milestone: null, followers: null, dateLabel: '' }, withMascot);
    expect(
      spec.layers.some((l) => l.kind === 'text' && /no milestone crossed yet/.test(textOf(l))),
    ).toBe(true);
    // no value to cheer → the celebrating cloud is suppressed
    expect(spec.layers.some((l) => l.kind === 'path')).toBe(false);
  });
});

describe('streakCardSpec (S5.5)', () => {
  const withMascot: BrandKit = { ...kit, mascot: true };
  const textOf = (l: { kind: string }): string => (l as { text?: string }).text ?? '';

  test('days → giant count, quest framing, mascot', () => {
    const spec = streakCardSpec({ days: 7, dateLabel: '2026-07-04' }, withMascot);
    expect(spec.w).toBe(STREAK_CARD.w);
    expect(spec.layers[1]).toMatchObject({ kind: 'pattern', pattern: 'blobs' });
    expect(spec.layers.some((l) => l.kind === 'text' && textOf(l) === '7')).toBe(true);
    expect(
      spec.layers.some(
        (l) => l.kind === 'text' && /showed up every day since 2026-07-04/.test(textOf(l)),
      ),
    ).toBe(true);
    expect(spec.layers.some((l) => l.kind === 'path')).toBe(true);
  });

  test('no start date → the fallback framing line', () => {
    const spec = streakCardSpec({ days: 3, dateLabel: '' }, kit);
    expect(
      spec.layers.some((l) => l.kind === 'text' && /showed up, every single day/.test(textOf(l))),
    ).toBe(true);
  });

  test('null days → graceful placeholder, no mascot', () => {
    const spec = streakCardSpec({ days: null, dateLabel: '' }, withMascot);
    expect(spec.layers.some((l) => l.kind === 'text' && /no streak yet/.test(textOf(l)))).toBe(
      true,
    );
    expect(spec.layers.some((l) => l.kind === 'path')).toBe(false);
  });
});

describe('codeCardSpec (S5.6)', () => {
  const textLayers = (spec: { layers: Array<{ kind: string }> }) =>
    spec.layers.filter((l) => l.kind === 'text') as Array<{
      text: string;
      color: string;
      box: { x: number };
      font: { sizePx: number; weight: number };
    }>;

  test('window chrome: desktop fill, panel, three discs, then text', () => {
    const spec = codeCardSpec({ code: 'const x = 1', title: 'a.ts' }, kit);
    expect(spec.w).toBe(CODE_CARD.w);
    expect(spec.h).toBe(CODE_CARD.h);
    expect(kinds(spec).slice(0, 6)).toEqual(['fill', 'panel', 'ring', 'ring', 'ring', 'text']);
    // the title bar text is the filename
    expect((spec.layers[5] as { text: string }).text).toBe('a.ts');
  });

  test('tokens are kit-colored — keyword=accent, comment=muted ink', () => {
    const spec = codeCardSpec({ code: 'const x = 1 // note', title: '' }, kit);
    const kw = textLayers(spec).find((l) => l.text === 'const');
    const comment = textLayers(spec).find((l) => l.text === '// note');
    expect(kw?.color).toBe(kit.accent);
    expect(comment?.color).toMatch(/^rgba\(/);
  });

  test('column x-math: token x = codeLeft + col · sizePx · MONO_ADVANCE', () => {
    // two keywords at columns 0 and 6 on the same line
    const spec = codeCardSpec({ code: 'const const', title: '' }, kit);
    const kws = textLayers(spec).filter((l) => l.text === 'const');
    expect(kws.length).toBe(2);
    const [a, b] = kws as [(typeof kws)[0], (typeof kws)[0]];
    const size = a.font.sizePx;
    expect(b.box.x - a.box.x).toBeCloseTo(6 * size * MONO_ADVANCE, 5);
  });

  test('over-cap input hard-truncates with a "trimmed" footer', () => {
    const code = Array.from({ length: 40 }, () => 'x').join('\n');
    const spec = codeCardSpec({ code, title: '' }, kit);
    const lineNums = textLayers(spec)
      .map((l) => l.text)
      .filter((t) => /^\d+$/.test(t));
    // 18-line cap: 17 shown lines + the trimmed footer
    expect(lineNums.at(-1)).toBe('17');
    expect(textLayers(spec).some((l) => /trimmed/.test(l.text))).toBe(true);
  });

  test('an over-wide line is clipped to the column cap', () => {
    const spec = codeCardSpec({ code: 'a'.repeat(100), title: '' }, kit);
    const body = textLayers(spec).find((l) => l.text.startsWith('a'));
    expect(body?.text.length).toBe(62);
  });

  test('deterministic — same input renders byte-identically', () => {
    const data = { code: 'export fn main() {}', title: 'm.rs' };
    expect(codeCardSpec(data, kit)).toEqual(codeCardSpec(data, kit));
  });
});

describe('threadCoverSpec (S5.7)', () => {
  const withMascot: BrandKit = { ...kit, mascot: true };

  test('full kit → rule, hook, "a thread · 1/N" badge, handle, watermark', () => {
    const spec = threadCoverSpec({ hook: 'ship in public every day', count: 5 }, kit);
    expect(spec.w).toBe(THREAD_COVER.w);
    expect(spec.h).toBe(THREAD_COVER.h);
    expect(kinds(spec)).toEqual(['fill', 'rule', 'text', 'badge', 'text', 'watermark']);
    // The hook is ExtraBold and shrinks to a floor of 36 (never overflows).
    expect(spec.layers[2]).toMatchObject({
      kind: 'text',
      text: 'ship in public every day',
      font: { weight: 800, sizePx: 72 },
      minSizePx: 36,
      maxLines: 4,
    });
    expect(spec.layers[3]).toMatchObject({ kind: 'badge', texts: ['a thread', '1/5'] });
    expect(spec.layers[4]).toMatchObject({ kind: 'text', text: '@narcis' });
  });

  test('count is rounded and floored at 1 for the badge', () => {
    expect(
      (threadCoverSpec({ hook: 'x', count: 3.7 }, kit).layers[3] as { texts: string[] }).texts[1],
    ).toBe('1/4');
    expect(
      (threadCoverSpec({ hook: 'x', count: 0 }, kit).layers[3] as { texts: string[] }).texts[1],
    ).toBe('1/1');
  });

  test('no handle, watermark off → rule, hook, badge only', () => {
    const spec = threadCoverSpec({ hook: 'x', count: 3 }, { ...kit, handle: '', watermark: false });
    expect(kinds(spec)).toEqual(['fill', 'rule', 'text', 'badge']);
  });

  test('mascot adds thinking path layers; mascot:false is byte-identical', () => {
    const off = threadCoverSpec({ hook: 'x', count: 3 }, kit);
    const on = threadCoverSpec({ hook: 'x', count: 3 }, withMascot);
    expect(on.layers.some((l) => l.kind === 'path')).toBe(true);
    expect(on.layers.filter((l) => l.kind !== 'path')).toEqual(off.layers);
  });

  test('an AI background suppresses the mascot', () => {
    const spec = threadCoverSpec({ hook: 'x', count: 3, background: STUB_BG }, withMascot);
    expect(spec.layers.some((l) => l.kind === 'path')).toBe(false);
    // image cover + scrim, THEN the content.
    expect(kinds(spec).slice(0, 2)).toEqual(['image', 'fill']);
  });

  test('a pattern threads through the base layers', () => {
    const spec = threadCoverSpec({ hook: 'x', count: 3, patternKind: 'plus' }, kit);
    expect(spec.layers[1]).toMatchObject({ kind: 'pattern', pattern: 'plus' });
  });

  test('deterministic — same data renders byte-identically', () => {
    const data = { hook: 'ship', count: 4 };
    expect(threadCoverSpec(data, withMascot)).toEqual(threadCoverSpec(data, withMascot));
  });

  // A long hook still produces a single configured text layer (shrink is a
  // render-time behavior; the spec just declares the floor).
  test('hook layer declares the shrink floor regardless of length', () => {
    const long = 'word '.repeat(60);
    const spec = threadCoverSpec({ hook: long, count: 2 }, kit);
    expect(spec.layers[2]).toMatchObject({ minSizePx: 36, font: { sizePx: 72 } });
  });
});

describe('listCardSpec (S5.7)', () => {
  const textOf = (l: { kind: string }): string => (l as { text?: string }).text ?? '';

  test('title + three rows: a disc + digit + item per row, then identity', () => {
    const spec = listCardSpec({ title: 'top lessons', items: ['first', 'second', 'third'] }, kit);
    expect(spec.w).toBe(LIST_CARD.w);
    expect(spec.h).toBe(LIST_CARD.h);
    // one ring (accent disc) per row
    expect(spec.layers.filter((l) => l.kind === 'ring').length).toBe(3);
    // the numbered digits
    expect(spec.layers.some((l) => l.kind === 'text' && textOf(l) === '1')).toBe(true);
    expect(spec.layers.some((l) => l.kind === 'text' && textOf(l) === '3')).toBe(true);
    // the item bodies survive verbatim
    for (const item of ['first', 'second', 'third']) {
      expect(spec.layers.some((l) => l.kind === 'text' && textOf(l) === item)).toBe(true);
    }
    // handle + watermark close the card
    expect(spec.layers.at(-2)).toMatchObject({ kind: 'text', text: '@narcis' });
    expect(spec.layers.at(-1)).toMatchObject({ kind: 'watermark' });
  });

  test('the accent disc is a width=2r ring (fills the disc)', () => {
    const spec = listCardSpec({ title: 't', items: ['a'] }, kit);
    const ring = spec.layers.find((l) => l.kind === 'ring') as { r: number; width: number };
    expect(ring.width).toBe(2 * ring.r);
  });

  test('empty items → a graceful placeholder instead of rows', () => {
    const spec = listCardSpec({ title: 't', items: [] }, { ...kit, handle: '', watermark: false });
    expect(spec.layers.filter((l) => l.kind === 'ring').length).toBe(0);
    expect(
      spec.layers.some((l) => l.kind === 'text' && /add one item per line/.test(textOf(l))),
    ).toBe(true);
  });

  test('a pattern threads through the base layers', () => {
    const spec = listCardSpec({ title: 't', items: ['a'], patternKind: 'grid' }, kit);
    expect(spec.layers[1]).toMatchObject({ kind: 'pattern', pattern: 'grid' });
  });

  test('caps at 6 rows even if handed more', () => {
    const spec = listCardSpec({ title: 't', items: ['1', '2', '3', '4', '5', '6', '7', '8'] }, kit);
    expect(spec.layers.filter((l) => l.kind === 'ring').length).toBe(6);
  });
});

describe('parseListItems (S5.7)', () => {
  test('strips leading number/bullet markers', () => {
    expect(parseListItems('1. first\n2) second\n- third\n* fourth\n• fifth')).toEqual([
      'first',
      'second',
      'third',
      'fourth',
      'fifth',
    ]);
  });

  test('drops blank and whitespace-only lines', () => {
    expect(parseListItems('a\n\n   \nb')).toEqual(['a', 'b']);
  });

  test('whitespace-only input → []', () => {
    expect(parseListItems('   \n  \n\t')).toEqual([]);
  });

  test('caps at 6', () => {
    const raw = Array.from({ length: 9 }, (_, i) => `item ${i + 1}`).join('\n');
    expect(parseListItems(raw).length).toBe(6);
  });

  test('a bare number without a marker punctuation is preserved', () => {
    // "3 lessons" has no `.`/`)` after the digit → not a marker, kept whole.
    expect(parseListItems('3 lessons learned')).toEqual(['3 lessons learned']);
  });
});

describe('background patterns (S5.4)', () => {
  test('quote: a pattern adds a [fill, pattern] base carrying the kind through', () => {
    const spec = quoteCardSpec({ text: 'ship', patternKind: 'dots' }, { ...kit, watermark: false });
    // fill (gradient) then the pattern layer, THEN the card content.
    expect(spec.layers[0]).toMatchObject({ kind: 'fill' });
    expect(spec.layers[1]).toMatchObject({ kind: 'pattern', pattern: 'dots' });
    // full-card box + low-alpha ink derived from the bg (works on light presets).
    expect(spec.layers[1]).toMatchObject({ box: { x: 0, y: 0, w: QUOTE_CARD.w, h: QUOTE_CARD.h } });
    expect((spec.layers[1] as { color: string }).color).toMatch(/^rgba\(/);
  });

  test('quote: no pattern is byte-identical to before (backwards-compatible)', () => {
    const plain = quoteCardSpec({ text: 'ship' }, kit);
    expect(plain.layers.some((l) => l.kind === 'pattern')).toBe(false);
  });

  test('quote: an AI background wins — the pattern is dropped', () => {
    const spec = quoteCardSpec(
      { text: 'ship', background: STUB_BG, patternKind: 'grid' },
      { ...kit, watermark: false },
    );
    expect(spec.layers[0]).toMatchObject({ kind: 'image' });
    expect(spec.layers[1]).toMatchObject({ kind: 'fill' }); // scrim
    expect(spec.layers.some((l) => l.kind === 'pattern')).toBe(false);
  });

  test('blobs seed threads through to the pattern layer', () => {
    const a = quoteCardSpec({ text: 'x', patternKind: 'blobs', patternSeed: 7 }, kit);
    const b = quoteCardSpec({ text: 'x', patternKind: 'blobs', patternSeed: 8 }, kit);
    expect((a.layers[1] as { seed?: number }).seed).toBe(7);
    expect((b.layers[1] as { seed?: number }).seed).toBe(8);
  });

  test('banner carries a pattern through too', () => {
    const spec = bannerSpec(
      { headline: 'h', keywords: [], followers: null, patternKind: 'plus' },
      kit,
    );
    expect(spec.layers[1]).toMatchObject({ kind: 'pattern', pattern: 'plus' });
  });
});
