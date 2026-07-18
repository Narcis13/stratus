// N0.1 — niche defaults + store over the real (in-memory, auto-migrated) SQLite
// DB. `bun run test` runs with SQLITE_PATH=:memory:, so the boot describe reads
// the pristine migrated seed (builder row + content_pillars backfilled).

import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import { db } from '../../db/client.ts';
import { contentPillars, niches } from '../db/schema.ts';
import { DEFAULT_PILLAR_SLUGS } from '../posts/pillars.ts';
import {
  DEFAULT_DOCTRINE,
  DEFAULT_NICHE,
  NICHE_SLUG_RE,
  isValidNicheSlug,
  resolveDoctrine,
} from './defaults.ts';
import { loadActiveNiche, loadDoctrine } from './store.ts';

function seedBuilder() {
  return db.insert(niches).values({
    slug: DEFAULT_NICHE.slug,
    label: DEFAULT_NICHE.label,
    description: DEFAULT_NICHE.description,
    persona: DEFAULT_NICHE.persona,
    beliefs: DEFAULT_NICHE.beliefs,
    replyPersona: DEFAULT_NICHE.replyPersona,
    active: true,
  });
}

describe('resolveDoctrine', () => {
  test('null / undefined / garbage → all defaults', () => {
    expect(resolveDoctrine(null)).toEqual(DEFAULT_DOCTRINE);
    expect(resolveDoctrine(undefined)).toEqual(DEFAULT_DOCTRINE);
    expect(resolveDoctrine('nope')).toEqual(DEFAULT_DOCTRINE);
    expect(resolveDoctrine(42)).toEqual(DEFAULT_DOCTRINE);
    expect(resolveDoctrine([])).toEqual(DEFAULT_DOCTRINE);
  });
  test('partial → merged over defaults', () => {
    expect(resolveDoctrine({ replyTargetMin: 3, targetBandMaxX: 5 })).toEqual({
      ...DEFAULT_DOCTRINE,
      replyTargetMin: 3,
      targetBandMaxX: 5,
    });
  });
  test('non-numeric / zero / negative / NaN / Infinity fields rejected', () => {
    expect(
      resolveDoctrine({
        replyTargetMin: 0,
        replyTargetMax: -5,
        weekReplyTargetPct: 'x',
        targetBandMinX: Number.NaN,
        targetBandMaxX: Number.POSITIVE_INFINITY,
      }),
    ).toEqual(DEFAULT_DOCTRINE);
  });
  test('finite positive fields win', () => {
    expect(resolveDoctrine({ weekReplyTargetPct: 80 }).weekReplyTargetPct).toBe(80);
  });
});

describe('DEFAULT_NICHE (seed mirror) + slug rule', () => {
  test('fields non-empty, slug valid, doctrine null', () => {
    expect(DEFAULT_NICHE.slug).toBe('builder');
    expect(NICHE_SLUG_RE.test(DEFAULT_NICHE.slug)).toBe(true);
    expect(isValidNicheSlug(DEFAULT_NICHE.slug)).toBe(true);
    expect(DEFAULT_NICHE.label.length).toBeGreaterThan(0);
    expect(DEFAULT_NICHE.persona.length).toBeGreaterThan(0);
    expect(DEFAULT_NICHE.beliefs.length).toBeGreaterThan(0);
    expect(DEFAULT_NICHE.replyPersona.length).toBeGreaterThan(0);
    expect((DEFAULT_NICHE.description ?? '').length).toBeGreaterThan(0);
    expect(DEFAULT_NICHE.active).toBe(true);
    expect(DEFAULT_NICHE.doctrine).toBeNull();
  });
  test('NICHE_SLUG_RE rejects bad slugs', () => {
    expect(isValidNicheSlug('')).toBe(false);
    expect(isValidNicheSlug('-bad')).toBe(false);
    expect(isValidNicheSlug('UPPER')).toBe(false);
    expect(isValidNicheSlug('a')).toBe(false); // <2 chars
    expect(isValidNicheSlug(42)).toBe(false);
    expect(isValidNicheSlug('ok-slug')).toBe(true);
  });
});

describe('migration boot: seed + backfill', () => {
  test('niches seeded with builder mirroring DEFAULT_NICHE byte-for-byte', () => {
    const row = db.select().from(niches).where(eq(niches.slug, 'builder')).get();
    expect(row).toBeTruthy();
    if (!row) return;
    expect(row.label).toBe(DEFAULT_NICHE.label);
    expect(row.persona).toBe(DEFAULT_NICHE.persona);
    expect(row.beliefs).toBe(DEFAULT_NICHE.beliefs);
    expect(row.replyPersona).toBe(DEFAULT_NICHE.replyPersona);
    expect(row.description).toBe(DEFAULT_NICHE.description);
    expect(row.active).toBe(true);
    expect(row.doctrine).toBeNull();
  });
  test('pre-existing content_pillars seed rows backfilled niche=builder', () => {
    for (const slug of DEFAULT_PILLAR_SLUGS) {
      const row = db.select().from(contentPillars).where(eq(contentPillars.slug, slug)).get();
      expect(row?.niche).toBe('builder');
    }
  });
});

describe('loadActiveNiche / loadDoctrine', () => {
  beforeEach(async () => {
    // Normalize to exactly the seeded single-builder state before each test.
    await db.delete(niches);
    await seedBuilder();
  });
  afterAll(async () => {
    // Leave the shared in-memory DB with the seed row present.
    await db.delete(niches);
    await seedBuilder();
  });

  test('empty table → the DEFAULT_NICHE object (reference)', async () => {
    await db.delete(niches);
    expect(loadActiveNiche()).toBe(DEFAULT_NICHE);
    expect(loadDoctrine()).toEqual(DEFAULT_DOCTRINE);
  });

  test('an active row wins over the default fallback', async () => {
    await db.delete(niches);
    await db.insert(niches).values({
      slug: 'nutrition',
      label: 'Nutrition',
      persona: 'p',
      beliefs: 'b',
      replyPersona: 'r',
      active: true,
    });
    expect(loadActiveNiche().slug).toBe('nutrition');
  });

  test('active row chosen among rows; inactive ignored', async () => {
    // builder (active, from beforeEach) must win over an inactive second row.
    await db.insert(niches).values({
      slug: 'nutrition',
      label: 'Nutrition',
      persona: 'p',
      beliefs: 'b',
      replyPersona: 'r',
      active: false,
    });
    expect(loadActiveNiche().slug).toBe('builder');
  });

  test("loadDoctrine resolves the active niche's stored doctrine", async () => {
    await db.delete(niches);
    await db.insert(niches).values({
      slug: 'nutrition',
      label: 'Nutrition',
      persona: 'p',
      beliefs: 'b',
      replyPersona: 'r',
      doctrine: { replyTargetMin: 3, targetBandMaxX: 5 },
      active: true,
    });
    expect(loadDoctrine()).toEqual({ ...DEFAULT_DOCTRINE, replyTargetMin: 3, targetBandMaxX: 5 });
  });
});
