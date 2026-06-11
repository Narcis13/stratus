// One-shot smoke test for OVERHAUL-PLAN Phase 8 (authoring) + the Phase 9
// guards around it. Mounts the calendar/metrics routers in-process (no port,
// no workers, NO X API — $0) against the real DB:
//
//   - creates a 3-segment thread draft → head + 'segment' tails share a
//     thread_id; GET :id returns the chain; segment schedule/status locked;
//     DELETE via head cascades (deleting a tail is refused)
//   - URL guards: pending head with URL refused; tail segments may carry URLs
//   - GET /x/metrics/best-times and /x/metrics/pillars return sane shapes
//   - voice tweets list accepts the §8.3 hook/extracted filters
//
// `--live` adds the Grok-backed checks (~$0.02–0.03 xAI, still $0 X API):
//   - POST /x/posts/draft {pillar: 2} → three register-distinct drafts in the
//     calendar (cleaned up)
//   - POST /x/posts/reup on the most recent published post → quote drafts with
//     quote_tweet_id stamped (cleaned up)
//
// Run: bun run scripts/smoke-authoring.ts [--live]

import { desc, eq, inArray } from 'drizzle-orm';
import { Hono } from 'hono';
import { db, pool } from '../src/db/client.ts';
import { postsPublished, scheduledPosts } from '../src/x/db/schema.ts';
import { calendar } from '../src/x/routes/calendar.ts';
import { drafter } from '../src/x/routes/drafter.ts';
import { metrics } from '../src/x/routes/metrics.ts';
import { createVoiceRouter } from '../src/x/routes/voice.ts';

const LIVE = process.argv.includes('--live');

const app = new Hono();
app.route('/x', calendar);
app.route('/x', metrics);
app.route('/x', createVoiceRouter());
if (LIVE) app.route('/x', drafter);

const JSON_HEADERS = { 'Content-Type': 'application/json' };
const cleanupIds: string[] = [];

function fail(msg: string): never {
  console.error(`FAIL: ${msg}`);
  process.exit(1);
}

async function cleanup(): Promise<void> {
  if (cleanupIds.length > 0) {
    await db.delete(scheduledPosts).where(inArray(scheduledPosts.id, cleanupIds));
  }
}

try {
  // ---- thread creation (draft) -------------------------------------------
  const create = await app.request('/x/posts/threads', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({
      segments: [
        'smoke: hook segment',
        'smoke: middle with https://example.com/link',
        'smoke: closer',
      ],
      pillar: 'ai-craft',
    }),
  });
  if (create.status !== 201) fail(`thread create returned ${create.status}`);
  const created = (await create.json()) as {
    threadId: string;
    segments: Array<{ id: string; status: string; threadPosition: number; pillar: string | null }>;
  };
  for (const s of created.segments) cleanupIds.push(s.id);
  if (created.segments.length !== 3) fail(`expected 3 rows, got ${created.segments.length}`);
  const [head, ...tail] = created.segments;
  if (!head || head.status !== 'draft' || head.threadPosition !== 1) {
    fail(`head wrong: ${JSON.stringify(head)}`);
  }
  if (!tail.every((s) => s.status === 'segment')) fail('tails must be status=segment');
  if (!created.segments.every((s) => s.pillar === 'ai-craft')) fail('pillar not stamped');
  console.log(`thread created: ${created.threadId} (head draft + ${tail.length} segments)`);

  // ---- GET :id returns the chain ------------------------------------------
  const get = await app.request(`/x/posts/scheduled/${head.id}`);
  if (get.status !== 200) fail(`GET :id returned ${get.status}`);
  const withThread = (await get.json()) as { thread?: Array<{ threadPosition: number }> };
  if (withThread.thread?.length !== 3) fail('GET :id missing thread siblings');
  console.log('GET /x/posts/scheduled/:id returns all 3 siblings');

  // ---- segment locks -------------------------------------------------------
  const seg = tail[0];
  if (!seg) fail('no tail segment');
  const patchSchedule = await app.request(`/x/posts/scheduled/${seg.id}`, {
    method: 'PATCH',
    headers: JSON_HEADERS,
    body: JSON.stringify({ scheduledFor: new Date(Date.now() + 3600_000).toISOString() }),
  });
  if (patchSchedule.status !== 409)
    fail(`segment schedule PATCH should 409, got ${patchSchedule.status}`);
  const patchText = await app.request(`/x/posts/scheduled/${seg.id}`, {
    method: 'PATCH',
    headers: JSON_HEADERS,
    body: JSON.stringify({
      text: 'smoke: middle edited, link in tail is fine https://example.com',
    }),
  });
  if (patchText.status !== 200) fail(`segment text PATCH should 200, got ${patchText.status}`);
  const delSeg = await app.request(`/x/posts/scheduled/${seg.id}`, { method: 'DELETE' });
  if (delSeg.status !== 409) fail(`segment DELETE should 409, got ${delSeg.status}`);
  console.log('segment locks hold: schedule 409, text edit 200, delete 409');

  // ---- promote head to pending (no URL in head → allowed) ------------------
  const promote = await app.request(`/x/posts/scheduled/${head.id}`, {
    method: 'PATCH',
    headers: JSON_HEADERS,
    body: JSON.stringify({
      status: 'pending',
      // Far future so the publisher worker (if running elsewhere) never claims it.
      scheduledFor: new Date('2030-01-01T12:34:00Z').toISOString(),
    }),
  });
  if (promote.status !== 200) fail(`head promote returned ${promote.status}`);
  const urlInHead = await app.request(`/x/posts/scheduled/${head.id}`, {
    method: 'PATCH',
    headers: JSON_HEADERS,
    body: JSON.stringify({ text: 'smoke head with https://example.com' }),
  });
  if (urlInHead.status !== 400) fail(`URL into pending head should 400, got ${urlInHead.status}`);
  console.log('head promoted to pending; URL into pending head refused (400)');

  // ---- DELETE via head cascades --------------------------------------------
  const delHead = await app.request(`/x/posts/scheduled/${head.id}`, { method: 'DELETE' });
  if (delHead.status !== 204) fail(`head DELETE returned ${delHead.status}`);
  const left = await db
    .select({ id: scheduledPosts.id })
    .from(scheduledPosts)
    .where(eq(scheduledPosts.threadId, created.threadId));
  if (left.length !== 0) fail(`thread rows left after head delete: ${left.length}`);
  cleanupIds.length = 0;
  console.log('DELETE via head removed the whole thread');

  // ---- analytics endpoints ($0, pure SQL) ----------------------------------
  const bt = await app.request('/x/metrics/best-times');
  if (bt.status !== 200) fail(`best-times returned ${bt.status}`);
  const btBody = (await bt.json()) as { measuredPosts: number; cells: unknown[]; top: unknown[] };
  console.log(`best-times: ${btBody.measuredPosts} measured posts, ${btBody.cells.length} cells`);

  const pl = await app.request('/x/metrics/pillars');
  if (pl.status !== 200) fail(`pillars returned ${pl.status}`);
  const plBody = (await pl.json()) as { count: number; pillars: Array<{ pillar: string }> };
  console.log(`pillars: ${plBody.count} tagged tweets, ${plBody.pillars.length} buckets`);

  // ---- voice template filters (§8.3) ---------------------------------------
  const vt = await app.request('/x/voice/tweets?extracted=false&limit=5');
  if (vt.status !== 200) fail(`voice tweets extracted=false returned ${vt.status}`);
  const vtRows = (await vt.json()) as Array<{ templateExtractedAt: string | null }>;
  if (vtRows.some((r) => r.templateExtractedAt !== null)) fail('extracted=false filter leaked');
  console.log(`voice filter extracted=false: ${vtRows.length} rows, all un-extracted`);

  // ---- live Grok checks -----------------------------------------------------
  if (LIVE) {
    const draft = await app.request('/x/posts/draft', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({
        pillar: 2,
        idea: 'smoke test: building tools at night after the day job',
      }),
    });
    if (draft.status !== 201) fail(`drafter returned ${draft.status}: ${await draft.text()}`);
    const draftBody = (await draft.json()) as {
      drafts: Array<{
        id: string;
        status: string;
        pillar: string | null;
        register: string | null;
        text: string;
      }>;
      winnersUsed: number;
      costUsd: number;
    };
    for (const d of draftBody.drafts) cleanupIds.push(d.id);
    if (draftBody.drafts.length !== 3) fail(`expected 3 drafts, got ${draftBody.drafts.length}`);
    const registers = new Set(draftBody.drafts.map((d) => d.register));
    if (registers.size !== 3)
      fail(`expected 3 distinct registers, got ${[...registers].join(',')}`);
    if (!draftBody.drafts.every((d) => d.status === 'draft' && d.pillar === 'builder-51')) {
      fail('drafts must be status=draft pillar=builder-51');
    }
    console.log(
      `drafter: 3 register-distinct drafts (${[...registers].join('/')}), ` +
        `${draftBody.winnersUsed} winners injected, $${draftBody.costUsd.toFixed(4)}`,
    );
    for (const d of draftBody.drafts) console.log(`  [${d.register}] ${d.text.slice(0, 90)}…`);

    const [latestPost] = await db
      .select({ tweetId: postsPublished.tweetId })
      .from(postsPublished)
      .where(eq(postsPublished.isReply, false))
      .orderBy(desc(postsPublished.postedAt))
      .limit(1);
    if (latestPost) {
      const reup = await app.request('/x/posts/reup', {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify({ tweetId: latestPost.tweetId }),
      });
      if (reup.status !== 201) fail(`reup returned ${reup.status}: ${await reup.text()}`);
      const reupBody = (await reup.json()) as {
        drafts: Array<{ id: string; quoteTweetId: string | null }>;
        costUsd: number;
      };
      for (const d of reupBody.drafts) cleanupIds.push(d.id);
      if (!reupBody.drafts.every((d) => d.quoteTweetId === latestPost.tweetId)) {
        fail('reup drafts missing quote_tweet_id');
      }
      console.log(
        `reup: ${reupBody.drafts.length} quote drafts on ${latestPost.tweetId}, $${reupBody.costUsd.toFixed(4)}`,
      );
    } else {
      console.log('reup: skipped (no published posts to quote)');
    }
  } else {
    console.log('(skip Grok drafter/reup — run with --live to spend ~$0.02–0.03 xAI)');
  }

  console.log('\nSMOKE OK');
} finally {
  await cleanup();
  await pool.end();
}
