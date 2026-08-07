// RC.3 — the mode RESOLUTION rule, over the real (in-memory, auto-migrated)
// SQLite DB; bun test runs with SQLITE_PATH=:memory:. The DB is shared across
// suites, so every cannon_target this file creates is deleted in afterAll.
//
// The taxonomy and the keyword vote are `src/shared/replyMode.test.ts`'s job.
// What is asserted here is the PRECEDENCE and the per-post shape — the two
// things that make single and batch unable to fork.

import { afterAll, describe, expect, test } from 'bun:test';
import { inArray } from 'drizzle-orm';
import { db } from '../../db/client.ts';
import { cannonTargets } from '../db/schema.ts';
import { resolveReplyMode } from './mode.ts';

const H_PINNED = 'rc3pinned';
const H_BENCHED = 'rc3benched';
const H_STALE = 'rc3stale';
const H_UNKNOWN = 'rc3stranger';
const HANDLES = [H_PINNED, H_BENCHED, H_STALE];

// Real shapes: a football post, a wire headline, a dev post, and one that no
// keyword vote can separate.
const FOOTBALL = 'Arsenal fans after that penalty decision lmao';
const WIRE = 'JUST IN: Fed leaves rates unchanged';
const DEV = 'Rewrote the whole thing in TypeScript and the codebase halved';
const OPAQUE = 'ok';

async function pin(handle: string, topic: string | null, active = true): Promise<void> {
  await db
    .insert(cannonTargets)
    .values({ handle, active, topic })
    .onConflictDoUpdate({ target: cannonTargets.handle, set: { topic, active } });
}

afterAll(async () => {
  await db.delete(cannonTargets).where(inArray(cannonTargets.handle, HANDLES));
});

describe('resolveReplyMode (RC.3) — the precedence', () => {
  test('an explicit override beats the pin, the curate call and detection', async () => {
    await pin(H_PINNED, 'banter');

    const [out] = await resolveReplyMode({
      explicit: 'wholesome',
      targets: [{ handle: H_PINNED, text: DEV, curated: 'expertise' }],
    });
    expect(out?.mode.id).toBe('wholesome');
    expect(out?.source).toBe('explicit');
  });

  test('an explicit value we do not recognize falls THROUGH, it does not guess (§7.11)', async () => {
    const [out] = await resolveReplyMode({
      explicit: 'shitposting',
      targets: [{ handle: H_UNKNOWN, text: DEV }],
    });
    expect(out?.mode.id).toBe('expertise');
    expect(out?.source).toBe('detected');
  });

  test('the curate classification beats the pin — it read the post, the pin only knows the account', async () => {
    await pin(H_PINNED, 'banter');

    const [out] = await resolveReplyMode({
      targets: [{ handle: H_PINNED, text: FOOTBALL, curated: 'news' }],
    });
    expect(out?.mode.id).toBe('news');
    expect(out?.source).toBe('curated');
  });

  test('the roster pin beats detection — a football account posting a wire headline', async () => {
    await pin(H_PINNED, 'banter');

    const [out] = await resolveReplyMode({ targets: [{ handle: H_PINNED, text: WIRE }] });
    expect(out?.mode.id).toBe('banter');
    expect(out?.source).toBe('roster');
  });

  test('a pin is matched through the alias table and stored canonical', async () => {
    // 'football' is a `banter` alias — a hand-typed pin has to land on the row.
    await pin(H_PINNED, 'football');

    const [out] = await resolveReplyMode({ targets: [{ handle: H_PINNED, text: OPAQUE }] });
    expect(out?.mode.id).toBe('banter');
    expect(out?.source).toBe('roster');
  });

  test('a BENCHED pin still answers — benching means stop camping, not change register', async () => {
    await pin(H_BENCHED, 'wholesome', false);

    const [out] = await resolveReplyMode({ targets: [{ handle: H_BENCHED, text: WIRE }] });
    expect(out?.mode.id).toBe('wholesome');
    expect(out?.source).toBe('roster');
  });

  test('a pin naming a mode that no longer exists falls through to detection', async () => {
    await pin(H_STALE, 'sports-banter');

    const [out] = await resolveReplyMode({ targets: [{ handle: H_STALE, text: WIRE }] });
    expect(out?.mode.id).toBe('news');
    expect(out?.source).toBe('detected');
  });

  test('an unpinned handle detects from the post', async () => {
    const [out] = await resolveReplyMode({ targets: [{ handle: H_UNKNOWN, text: FOOTBALL }] });
    expect(out?.mode.id).toBe('banter');
    expect(out?.source).toBe('detected');
  });

  test('unresolvable is `general` with source `fallback` — not a guess, and it says so', async () => {
    const [out] = await resolveReplyMode({ targets: [{ handle: H_UNKNOWN, text: OPAQUE }] });
    expect(out?.mode.id).toBe('general');
    expect(out?.source).toBe('fallback');
    expect(out?.mode.personaUse).toBe('stance');
  });
});

// The asymmetry with ML.3 that the module exists for: a Cannon queue is
// deliberately heterogeneous, so every post gets its OWN room. A set-wide answer
// here would hand 24 posts the register of whichever one voted loudest.
describe('resolveReplyMode (RC.3) — per post, not per call', () => {
  test('a mixed batch resolves each post independently, aligned by index', async () => {
    await pin(H_PINNED, 'banter');

    const out = await resolveReplyMode({
      targets: [
        { handle: H_PINNED, text: FOOTBALL },
        { handle: H_UNKNOWN, text: WIRE },
        { handle: H_UNKNOWN, text: DEV },
        { handle: H_UNKNOWN, text: OPAQUE },
      ],
    });
    expect(out.map((r) => r.mode.id)).toEqual(['banter', 'news', 'expertise', 'general']);
    expect(out.map((r) => r.source)).toEqual(['roster', 'detected', 'detected', 'fallback']);
  });

  test('an empty target set resolves to nothing — there is no post to pick a room for', async () => {
    expect(await resolveReplyMode({ targets: [] })).toEqual([]);
    expect(await resolveReplyMode({ explicit: 'banter', targets: [] })).toEqual([]);
  });

  test('the single path is the same function over one target', async () => {
    const out = await resolveReplyMode({ targets: [{ handle: H_UNKNOWN, text: DEV }] });
    expect(out).toHaveLength(1);
    expect(out[0]?.mode.id).toBe('expertise');
  });
});
