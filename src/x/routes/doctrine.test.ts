// N0.5 — doctrine knobs (the active niche's REPLY-GUIDE numbers) drive the reply
// quota / week ratio target in GET /brief and the 2–10x band in GET /voice/targets.
// Runs over the shared in-memory auto-migrated DB (bun run test → SQLITE_PATH=:memory:).
// The builder niche is seeded active with a null doctrine (= DEFAULT_DOCTRINE); this
// suite mutates builder.doctrine and MUST restore it to null in afterAll so other
// files reading defaults stay green (the niche.test.ts discipline).

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { eq, inArray } from 'drizzle-orm';
import { Hono } from 'hono';
import { db } from '../../db/client.ts';
import { accountSnapshots, niches, voiceAuthors } from '../db/schema.ts';
import { brief } from './brief.ts';
import { createVoiceRouter } from './voice.ts';

const app = new Hono();
app.route('/x', createVoiceRouter());
app.route('/x', brief);

// Strictly later than playbook.test's 2999-01-01 so this snapshot wins the
// `desc(snapshotAt) limit 1` while this suite runs, whatever the file order.
const FUTURE = new Date('2999-12-01T00:00:00Z');
const IN = 'doctrine_in_test'; // 400 followers: inside 3–5x (300–500), inside 2–10x (200–1000)
const OUT = 'doctrine_out_test'; // 1000 followers: outside 3–5x, inside 2–10x

interface TargetsResponse {
  myFollowers: number | null;
  band: { min: number; max: number } | null;
  targets: { handle: string }[];
}
interface BriefResponse {
  replyQuota: { target: { min: number; max: number } };
  week: { targetReplyPct: number };
}

async function get<T>(path: string): Promise<{ status: number; body: T }> {
  const res = await app.request(path, { method: 'GET' });
  return { status: res.status, body: (await res.json()) as T };
}

function setDoctrine(doctrine: unknown): void {
  db.update(niches)
    .set({ doctrine: doctrine as never })
    .where(eq(niches.active, true))
    .run();
}

beforeAll(() => {
  db.insert(accountSnapshots)
    .values({
      snapshotAt: FUTURE,
      followersCount: 100,
      followingCount: 0,
      tweetCount: 0,
      listedCount: 0,
    })
    .run();
  db.insert(voiceAuthors)
    .values([
      { handle: IN, retired: false, followersCount: 400 },
      { handle: OUT, retired: false, followersCount: 1000 },
    ])
    .run();
  setDoctrine(null); // ensure the regression case starts from defaults
});

afterAll(() => {
  setDoctrine(null);
  db.delete(voiceAuthors)
    .where(inArray(voiceAuthors.handle, [IN, OUT]))
    .run();
  db.delete(accountSnapshots).where(eq(accountSnapshots.snapshotAt, FUTURE)).run();
});

describe('N0.5 doctrine knobs drive brief + targets', () => {
  test('doctrine null → today defaults (10–20/day, 70%, 2–10x band incl. both authors)', async () => {
    const b = await get<BriefResponse>('/x/brief');
    expect(b.status).toBe(200);
    expect(b.body.replyQuota.target).toEqual({ min: 10, max: 20 });
    expect(b.body.week.targetReplyPct).toBe(70);

    const t = await get<TargetsResponse>('/x/voice/targets');
    expect(t.status).toBe(200);
    expect(t.body.band).toEqual({ min: 200, max: 1000 }); // 2–10x of 100
    const handles = t.body.targets.map((x) => x.handle);
    expect(handles).toContain(IN);
    expect(handles).toContain(OUT);
  });

  test('PATCHed doctrine → new quota + band (3–5x excludes the 1000-follower author)', async () => {
    setDoctrine({
      replyTargetMin: 3,
      replyTargetMax: 9,
      weekReplyTargetPct: 55,
      targetBandMinX: 3,
      targetBandMaxX: 5,
    });

    const b = await get<BriefResponse>('/x/brief');
    expect(b.body.replyQuota.target).toEqual({ min: 3, max: 9 });
    expect(b.body.week.targetReplyPct).toBe(55);

    const t = await get<TargetsResponse>('/x/voice/targets');
    expect(t.body.band).toEqual({ min: 300, max: 500 }); // 3–5x of 100
    const handles = t.body.targets.map((x) => x.handle);
    expect(handles).toContain(IN); // 400 in band
    expect(handles).not.toContain(OUT); // 1000 now out of band
  });
});
