// RC.6 — the SELECTION rule for the measured few-shot, over the real
// (in-memory, auto-migrated) SQLite DB; bun test runs with SQLITE_PATH=:memory:.
// The DB is shared across suites, so every row this file writes is deleted in
// afterAll and every handle it uses is namespaced.
//
// Rendering is `prompt.test.ts`'s job. What is asserted here is what gets into
// the pool and what does not — the floor, the dedup, the language scope, and the
// two §7.11 drops (an unscraped parent and a room nothing resolved).

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { eq, inArray } from 'drizzle-orm';
import { db } from '../../db/client.ts';
import { LANGUAGE_PROFILES } from '../../shared/language.ts';
import { cannonTargets, harvestRows, harvestRuns } from '../db/schema.ts';
import { resetSettings, setSettings } from '../settings/registry.ts';
import { loadReplyWinners } from './winners.ts';

const RUN_ID = 'd0000000-0000-4000-8000-0000000000c6';
const SELF = 'rc6me';
// Parents, one per room. `rc6pinned` is on the roster with a topic; the rest
// resolve by keyword detection alone.
const P_PINNED = 'rc6pinned';
const P_FOOTBALL = 'rc6football';
const P_DEV = 'rc6dev';
const P_OPAQUE = 'rc6opaque';
const HANDLES = [P_PINNED];

const FOOTBALL = 'Arsenal fans after that penalty decision lmao';
const DEV = 'Rewrote the whole thing in TypeScript and the codebase halved';
const WARM = 'my grandmother knitted this blanket for the puppy and i am not ok';
// Nothing votes on it — the resolver answers `general` by FALLBACK, which is not
// an attribution (§7.11).
const OPAQUE = 'ok';

const now = Date.now();
const at = (minAgo: number): Date => new Date(now - minAgo * 60_000);

interface RowOpts {
  tweetId: string;
  text: string;
  views: number;
  parentHandle?: string;
  parentText?: string | null;
  minAgo?: number;
}

function row(o: RowOpts) {
  return {
    runId: RUN_ID,
    tweetId: o.tweetId,
    handle: SELF,
    mode: 'replies',
    text: o.text,
    views: o.views,
    likes: 1,
    comments: 0,
    tweetTime: at(o.minAgo ?? 60),
    capturedAt: at(30),
    origTweetId: `${o.tweetId}_parent`,
    origHandle: o.parentHandle ?? P_FOOTBALL,
    origText: o.parentText === undefined ? FOOTBALL : o.parentText,
    origTime: at((o.minAgo ?? 60) + 30),
    origComments: 5,
    origViews: 50_000,
  };
}

beforeAll(async () => {
  await db
    .insert(harvestRuns)
    .values({ id: RUN_ID, handle: SELF, mode: 'replies', scope: 'recent' })
    .onConflictDoNothing();
  await db
    .insert(cannonTargets)
    .values({ handle: P_PINNED, active: true, topic: 'wholesome' })
    .onConflictDoUpdate({
      target: cannonTargets.handle,
      set: { topic: 'wholesome', active: true },
    });
  await db.insert(harvestRows).values([
    // banter (detected off the parent), three of them, out of yield order.
    row({ tweetId: 'rc6_b1', text: 'offside by a shoelace', views: 900 }),
    row({ tweetId: 'rc6_b2', text: 'var strikes again lol', views: 4_100 }),
    row({ tweetId: 'rc6_b3', text: 'the keeper was on his phone', views: 120 }),
    // Under the floor — a reply that underperformed is not a winner.
    row({ tweetId: 'rc6_weak', text: 'this weak one must never render', views: 12 }),
    // The same words replied twice: one exemplar, not two — and it is the copy
    // that did BEST, which is why this one is inserted second and scores higher.
    row({ tweetId: 'rc6_dup1', text: 'offside by a shoelace', views: 1_500 }),
    // expertise, detected.
    row({
      tweetId: 'rc6_e1',
      text: 'a partial index does this in 4 lines',
      views: 800,
      parentHandle: P_DEV,
      parentText: DEV,
    }),
    // wholesome, by the roster PIN — the parent text reads football.
    row({
      tweetId: 'rc6_w1',
      text: 'the ear twitch at 0:04',
      views: 600,
      parentHandle: P_PINNED,
      parentText: FOOTBALL,
    }),
    // Japanese, under a wholesome parent — the English path must not show it.
    row({
      tweetId: 'rc6_ja',
      text: 'その開き直り、こっちまで軽くなる',
      views: 3_486,
      parentHandle: P_PINNED,
      parentText: WARM,
    }),
    // The scrape missed the parent — unplaceable, not `general`.
    row({
      tweetId: 'rc6_noparent',
      text: 'this orphan must never render',
      views: 5_000,
      parentText: null,
    }),
    // Nothing resolves the parent — `fallback`, which is also not `general`.
    row({
      tweetId: 'rc6_opaque',
      text: 'this unplaced one must never render',
      views: 5_000,
      parentHandle: P_OPAQUE,
      parentText: OPAQUE,
    }),
  ]);
  setSettings({ 'x.identity.selfHandle': SELF });
});

afterAll(async () => {
  await db.delete(harvestRows).where(eq(harvestRows.runId, RUN_ID));
  await db.delete(harvestRuns).where(eq(harvestRuns.id, RUN_ID));
  await db.delete(cannonTargets).where(inArray(cannonTargets.handle, HANDLES));
  resetSettings({ keys: ['x.identity.selfHandle'] });
});

describe('loadReplyWinners (RC.6) — what earns a place in the few-shot', () => {
  test('a room gets its own replies, yield-sorted, and no other room’s', async () => {
    const out = await loadReplyWinners(['banter']);
    expect(out.map((w) => w.text)).toEqual([
      'var strikes again lol',
      'offside by a shoelace',
      'the keeper was on his phone',
    ]);
    expect(out.every((w) => w.mode === 'banter')).toBe(true);
    expect(out[0]?.views).toBe(4_100);
  });

  test('the same words replied twice are one exemplar', async () => {
    const out = await loadReplyWinners(['banter']);
    expect(out.filter((w) => w.text === 'offside by a shoelace')).toHaveLength(1);
    // The higher-yield copy is the one kept (1,500, not the 900 that the DB
    // returns first) — the dedup runs after the sort, not inside the filter.
    expect(out.find((w) => w.text === 'offside by a shoelace')?.views).toBe(1_500);
  });

  test('a reply that underperformed the corpus is not a winner', async () => {
    const out = await loadReplyWinners(['banter']);
    expect(out.some((w) => w.text.includes('weak'))).toBe(false);
  });

  test('the roster pin places a reply the parent text would have read as football', async () => {
    const out = await loadReplyWinners(['wholesome']);
    expect(out.map((w) => w.text)).toEqual(['the ear twitch at 0:04']);
  });

  test('an unscraped parent and an unresolvable one are DROPPED, not filed as general', async () => {
    const every = await loadReplyWinners([
      'banter',
      'expertise',
      'wholesome',
      'news',
      'hot-take',
      'general',
    ]);
    const texts = every.map((w) => w.text);
    expect(texts).not.toContain('this orphan must never render');
    expect(texts).not.toContain('this unplaced one must never render');
    expect(every.some((w) => w.mode === 'general')).toBe(false);
  });

  test('rooms come back in the order they were asked for — the batch legend order', async () => {
    const out = await loadReplyWinners(['expertise', 'banter']);
    expect(out[0]?.mode).toBe('expertise');
    expect(out.at(-1)?.mode).toBe('banter');
  });

  test('perMode caps each room', async () => {
    const out = await loadReplyWinners(['banter'], { perMode: 2 });
    expect(out).toHaveLength(2);
  });

  test('the few-shot is written in the language of the call', async () => {
    const ja = LANGUAGE_PROFILES.find((p) => p.code === 'ja') ?? null;
    // English path: the 3,486-view Japanese reply is the highest-yield row in
    // the room and is still absent — it would teach the wrong alphabet.
    const english = await loadReplyWinners(['wholesome']);
    expect(english.some((w) => w.text.startsWith('その'))).toBe(false);
    // Japanese path: it is the only one that qualifies.
    const japanese = await loadReplyWinners(['wholesome'], { profile: ja });
    expect(japanese.map((w) => w.text)).toEqual(['その開き直り、こっちまで軽くなる']);
  });

  test('a window that predates the rows answers empty rather than reaching further back', async () => {
    expect(await loadReplyWinners(['banter'], { windowDays: 0 })).toEqual([]);
  });

  test('no rooms asked, no rows read', async () => {
    expect(await loadReplyWinners([])).toEqual([]);
  });

  test('an unset self handle answers empty rather than borrowing someone else’s corpus', async () => {
    resetSettings({ keys: ['x.identity.selfHandle'] });
    expect(await loadReplyWinners(['banter'])).toEqual([]);
    setSettings({ 'x.identity.selfHandle': SELF });
  });
});
