// One-shot smoke test for M1 (Me / My Profile). Mounts the me router in-process
// (no port, no workers) against the REAL DB: creates one entry of each kind + a
// followers goal + an mrr goal, exercises the window flag (a 40-day event falls
// out of window), renders the post + reply context blocks, then surgically
// deletes exactly the rows it created (by id — never wipes the table). $0.
//
//   bun run scripts/smoke-me.ts

import { inArray } from 'drizzle-orm';
import { Hono } from 'hono';
import { db } from '../src/db/client.ts';
import { meEntries, meGoals } from '../src/x/db/schema.ts';
import { me } from '../src/x/routes/me.ts';

const app = new Hono();
app.route('/x', me);

const entryIds: string[] = [];
const goalIds: string[] = [];

function cleanup(): void {
  if (entryIds.length > 0) db.delete(meEntries).where(inArray(meEntries.id, entryIds)).run();
  if (goalIds.length > 0) db.delete(meGoals).where(inArray(meGoals.id, goalIds)).run();
}

function fail(msg: string): never {
  console.error(`FAIL: ${msg}`);
  cleanup();
  process.exit(1);
}

async function json<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await app.request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (res.status !== 201) fail(`POST ${path} → ${res.status}: ${await res.text()}`);
  return json<T>(res);
}

const DAY = 86_400_000;

// 1. One entry of each kind.
const fact = await post<{ id: string }>('/x/me/entries', {
  kind: 'fact',
  text: 'smoke: I build in public',
});
entryIds.push(fact.id);
const emotion = await post<{ id: string }>('/x/me/entries', {
  kind: 'emotion',
  text: 'smoke: excited to ship M1',
});
entryIds.push(emotion.id);
const note = await post<{ id: string }>('/x/me/entries', {
  kind: 'note',
  text: 'smoke: a throwaway note',
});
entryIds.push(note.id);
const event = await post<{ id: string }>('/x/me/entries', {
  kind: 'event',
  text: 'smoke: shipped the me tab',
  happenedAt: new Date(Date.now() - 2 * DAY).toISOString(),
});
entryIds.push(event.id);
console.log('entries: created 4 (fact/emotion/note/event)');

// 2. Window flag: patch the event to 40 days old → out of window.
const patched = await app.request(`/x/me/entries/${event.id}`, {
  method: 'PATCH',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ happenedAt: new Date(Date.now() - 40 * DAY).toISOString() }),
});
if (patched.status !== 200) fail(`patch event happenedAt → ${patched.status}`);

const list = await json<{
  entries: Array<{ id: string; kind: string; inWindow: boolean }>;
  goals: unknown[];
}>(await app.request('/x/me'));
const listedEvent = list.entries.find((e) => e.id === event.id);
if (!listedEvent) fail('event missing from GET /me');
if (listedEvent.inWindow !== false) fail('40-day event should be out of window');
const listedEmotion = list.entries.find((e) => e.id === emotion.id);
if (listedEmotion?.inWindow !== true) fail('fresh emotion should be in window');
console.log('window: 40d event out, fresh emotion in — inWindow computed server-side');

// 3. Goals: a followers goal (auto-progress from account_snapshots, may be null
// on a fresh DB) and an mrr goal (deterministic manual progress).
const followers = await post<{ id: string }>('/x/me/goals', {
  label: 'smoke: reach 1000 followers',
  kind: 'followers',
  target: 1000,
});
goalIds.push(followers.id);
const mrr = await post<{ id: string }>('/x/me/goals', {
  label: 'smoke: 5K MRR',
  kind: 'mrr',
  target: 5000,
  unit: 'USD',
  currentValue: 800,
});
goalIds.push(mrr.id);

const withGoals = await json<{
  goals: Array<{ id: string; kind: string; progress: { pct: number; current: number } | null }>;
}>(await app.request('/x/me'));
const m = withGoals.goals.find((g) => g.id === mrr.id);
if (m?.progress?.pct !== 16) fail(`mrr progress should be 16%, got ${m?.progress?.pct}`);
const f = withGoals.goals.find((g) => g.id === followers.id);
console.log(
  `goals: mrr 800/5000 = 16%; followers progress = ${
    f?.progress ? `${f.progress.pct}% (${f.progress.current} followers)` : 'null (no snapshot yet)'
  }`,
);

// 4. Context renders both modes, includes the fresh emotion.
const postCtx = await json<{ block: string | null }>(await app.request('/x/me/context?mode=post'));
if (!postCtx.block || !postCtx.block.includes('excited to ship M1'))
  fail('post context should include the fresh emotion');
const replyCtx = await json<{ block: string | null }>(
  await app.request('/x/me/context?mode=reply'),
);
if (!replyCtx.block) fail('reply context should render a brief');
console.log(
  `context: post block ${postCtx.block.length} chars, reply brief ${replyCtx.block.length} chars`,
);

// 5. Cleanup and confirm empty for the rows we made.
cleanup();
entryIds.length = 0;
goalIds.length = 0;
const after = await json<{ entries: Array<{ id: string }>; goals: Array<{ id: string }> }>(
  await app.request('/x/me'),
);
if (after.entries.some((e) => e.id === fact.id) || after.goals.some((g) => g.id === mrr.id))
  fail('smoke rows survived cleanup');
console.log('cleanup: all smoke rows removed');

console.log('SMOKE OK');
process.exit(0);
