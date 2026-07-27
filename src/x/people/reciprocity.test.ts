// GT.6 — the reciprocity membership set behind the band-gate carve-out and (next)
// the daily quest, over the real (in-memory, auto-migrated) SQLite DB.
//
// Shared-DB discipline (§9): every fixture handle is `gt6*` and is deleted in a
// try/finally inside each test as well as in afterAll — test files share one
// in-memory DB, so an afterAll alone still leaks rows into the tests that run
// after these in this file. The roster half needs a "my size" reading, and
// `loadTargetHandles` takes the LATEST account snapshot: the fixture is dated
// 3000-01-01 so it wins over every other suite's snapshot (including
// playbook.test.ts's 2999 one) and is removed on the way out.

import { afterAll, describe, expect, test } from 'bun:test';
import { eq, inArray } from 'drizzle-orm';
import { db } from '../../db/client.ts';
import { accountSnapshots, people, voiceAuthors } from '../db/schema.ts';
import {
  RECIPROCITY_MIN_STAGE,
  isReciprocityHandle,
  loadReciprocityHandles,
} from './reciprocity.ts';
import { STAGES, stageRank } from './stage.ts';

const HANDLES = ['gt6engaged', 'gt6noticed', 'gt6retired', 'gt6target', 'gt6ally'];
const FUTURE = new Date('3000-01-01T00:00:00Z');

async function cleanup(): Promise<void> {
  await db.delete(people).where(inArray(people.handle, HANDLES));
  await db.delete(voiceAuthors).where(inArray(voiceAuthors.handle, HANDLES));
  await db.delete(accountSnapshots).where(eq(accountSnapshots.snapshotAt, FUTURE));
}

afterAll(cleanup);

describe('reciprocity membership (GT.6)', () => {
  test('the floor is above ambient sighting — `noticed` is NOT my people', () => {
    // The rule this task deviates on: `noticed` is reachable by hover_sighting
    // alone (ambient AX.1 capture), so the floor sits one rung higher.
    expect(stageRank(RECIPROCITY_MIN_STAGE)).toBeGreaterThan(stageRank('noticed'));
    expect(STAGES.includes(RECIPROCITY_MIN_STAGE)).toBe(true);
  });

  test('stage ≥ engaged is in, below the floor and retired are out', async () => {
    try {
      await db.insert(people).values([
        { handle: 'gt6engaged', stage: 'engaged' },
        { handle: 'gt6ally', stage: 'ally' },
        { handle: 'gt6noticed', stage: 'noticed' },
        { handle: 'gt6retired', stage: 'engaged', retired: true },
      ]);

      const set = await loadReciprocityHandles();
      expect(set.has('gt6engaged')).toBe(true);
      expect(set.has('gt6ally')).toBe(true);
      expect(set.has('gt6noticed')).toBe(false);
      expect(set.has('gt6retired')).toBe(false);

      expect(await isReciprocityHandle('gt6engaged')).toBe(true);
      expect(await isReciprocityHandle('gt6noticed')).toBe(false);
      expect(await isReciprocityHandle('gt6retired')).toBe(false);
      // A handle with no people row at all — the stranger the gate still refuses.
      expect(await isReciprocityHandle('gt6nobody')).toBe(false);
    } finally {
      await cleanup();
    }
  });

  test('a 2–10x roster target is in even with no people row', async () => {
    try {
      await db.insert(accountSnapshots).values({
        snapshotAt: FUTURE,
        followersCount: 1000, // band = 2k–10k
        followingCount: 100,
        tweetCount: 10,
        listedCount: 0,
      });
      await db.insert(voiceAuthors).values([
        { handle: 'gt6target', followersCount: 5000 },
        { handle: 'gt6noticed', followersCount: 50_000 }, // out of band
      ]);

      const set = await loadReciprocityHandles();
      expect(set.has('gt6target')).toBe(true);
      expect(set.has('gt6noticed')).toBe(false);
      expect(await isReciprocityHandle('gt6target')).toBe(true);
    } finally {
      await cleanup();
    }
  });

  test('handles are matched normalized (@ prefix, case)', async () => {
    try {
      await db.insert(people).values({ handle: 'gt6engaged', stage: 'engaged' });
      expect(await isReciprocityHandle('@GT6Engaged')).toBe(true);
      // Not a legal X handle → false, never a query with garbage in it.
      expect(await isReciprocityHandle('not a handle')).toBe(false);
      expect(await isReciprocityHandle('')).toBe(false);
    } finally {
      await cleanup();
    }
  });
});
