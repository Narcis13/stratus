// S5.3 mascot — snapshot the *layer lists*, never pixels. The renderer is pure
// over (opts), all colours derive from the kit accent, and the confetti PRNG is
// seeded, so the same inputs must produce a deep-equal layer list forever.

import { describe, expect, test } from 'bun:test';
import type { BrandKit } from './brandKit.ts';
import { shade } from './compose.ts';
import { type MascotPose, mascotLayers } from './mascot.ts';

const kit: BrandKit = {
  bg: '#0f1419',
  accent: '#1d9bf0',
  fontFamily: 'TestFont',
  handle: 'narcis',
  watermark: true,
  watermarkText: 'stratus',
  imageStyleSuffix: 'flat vector, no text',
  mascot: true,
};

function kinds(layers: Array<{ kind: string }>): string[] {
  return layers.map((l) => l.kind);
}

const POSES: MascotPose[] = ['happy', 'celebrating', 'thinking', 'sleeping'];

describe('mascotLayers', () => {
  test('every pose starts with the cloud body path, coloured from the kit', () => {
    for (const pose of POSES) {
      const layers = mascotLayers({ pose, x: 0, y: 0, scale: 1, kit });
      // celebrating draws the arm puffs before the body; the body is still a path.
      const body = layers.find((l) => l.kind === 'path' && 'fill' in l && l.stroke === kit.accent);
      expect(body).toMatchObject({
        kind: 'path',
        fill: shade(kit.accent, 0.85),
        stroke: kit.accent,
      });
    }
  });

  test('same inputs → deep-equal output (pure + seeded)', () => {
    for (const pose of POSES) {
      const a = mascotLayers({ pose, x: 12, y: 34, scale: 0.6, kit });
      const b = mascotLayers({ pose, x: 12, y: 34, scale: 0.6, kit });
      expect(a).toEqual(b);
    }
  });

  test('box math: scale drives a 100×80 viewbox box at (x, y)', () => {
    const [body] = mascotLayers({ pose: 'happy', x: 20, y: 30, scale: 0.5, kit });
    expect(body).toMatchObject({ kind: 'path', box: { x: 20, y: 30, w: 50, h: 40 } });
  });

  test('colours re-skin with the accent — no hardcoded hexes', () => {
    const other: BrandKit = { ...kit, accent: '#ff6600' };
    const [body] = mascotLayers({ pose: 'happy', x: 0, y: 0, scale: 1, kit: other });
    expect(body).toMatchObject({ fill: shade('#ff6600', 0.85), stroke: '#ff6600' });
  });

  test('happy: body + two eyes + a smile', () => {
    const layers = mascotLayers({ pose: 'happy', x: 0, y: 0, scale: 1, kit });
    expect(kinds(layers)).toEqual(['path', 'path', 'path', 'path']);
  });

  test('celebrating adds arms + confetti, strictly more layers than happy', () => {
    const celebrating = mascotLayers({ pose: 'celebrating', x: 0, y: 0, scale: 1, kit });
    const happy = mascotLayers({ pose: 'happy', x: 0, y: 0, scale: 1, kit });
    expect(celebrating.length).toBeGreaterThan(happy.length);
    // all celebrating layers are paths (confetti dots included)
    expect(celebrating.every((l) => l.kind === 'path')).toBe(true);
  });

  test('celebrating confetti is deterministic for a fixed seed, varies by seed', () => {
    const a = mascotLayers({ pose: 'celebrating', x: 0, y: 0, scale: 1, kit, seed: 7 });
    const b = mascotLayers({ pose: 'celebrating', x: 0, y: 0, scale: 1, kit, seed: 7 });
    const c = mascotLayers({ pose: 'celebrating', x: 0, y: 0, scale: 1, kit, seed: 8 });
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
  });

  test('thinking adds a rising thought-dot trail', () => {
    const layers = mascotLayers({ pose: 'thinking', x: 0, y: 0, scale: 1, kit });
    // body + 2 eyes + mouth + 3 trail dots
    expect(layers.length).toBe(7);
    expect(layers.every((l) => l.kind === 'path')).toBe(true);
  });

  test('sleeping draws a plain-text "zzz" (no emoji)', () => {
    const layers = mascotLayers({ pose: 'sleeping', x: 0, y: 0, scale: 1, kit });
    const zzz = layers.find((l) => l.kind === 'text');
    expect(zzz).toMatchObject({ kind: 'text', text: 'zzz' });
  });
});
