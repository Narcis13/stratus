// Niche store (N0) — the only reader of the `niches` table. `loadActiveNiche`
// returns the active row (else DEFAULT_NICHE when there is no active row: a fresh
// DB or pre-migration table, mirroring how getActivePillars falls back to
// DEFAULT_PILLARS). `loadActiveNicheSafe` never throws — a niche-layer failure
// yields a default-grounded draft, never a failed one (§7.8, the persistRadarDrafts
// discipline). `loadDoctrine` resolves the active niche's doctrine over defaults.
// No consumer wires these yet — the table stays inert until N0.3/N0.4/N0.5.

import { desc, eq } from 'drizzle-orm';
import { db } from '../../db/client.ts';
import { niches } from '../db/schema.ts';
import { DEFAULT_NICHE, type Niche, type NicheDoctrine, resolveDoctrine } from './defaults.ts';

export function loadActiveNiche(): Niche {
  const row = db
    .select()
    .from(niches)
    .where(eq(niches.active, true))
    .orderBy(desc(niches.updatedAt))
    .get();
  return row ?? DEFAULT_NICHE;
}

export function loadActiveNicheSafe(): Niche {
  try {
    return loadActiveNiche();
  } catch (err) {
    console.error(
      'niche: loadActiveNiche failed, using default:',
      err instanceof Error ? err.message : err,
    );
    return DEFAULT_NICHE;
  }
}

export function loadDoctrine(): NicheDoctrine {
  return resolveDoctrine(loadActiveNicheSafe().doctrine);
}
