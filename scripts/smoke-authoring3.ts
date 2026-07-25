// One-shot smoke for Authoring 3.0 (Wave 4, A3.1–A3.15) — the four surfaces the
// phase shipped: audience Active-times capture, manual publishing (mark-posted +
// the daily reconcile), grounded DM drafts, and the long-form Writer/articles.
// Mounts analytics + calendar + dms + articles in-process against the real DB:
// no port, no workers, no X API, no LLM (the default run is $0 — every DM and
// article assertion sits on the pre-spend refusal ladder, so it never spends
// even if XAI_API_KEY happens to be set on the box).
//
// What it drives, in order:
//   a) POST/GET /analytics/active-times round-trip + a validation rejection
//   b) manual publishing: create a manual row with a URL in the text (accepted —
//      the URL surcharge guard is pending-only, decision 5), assert the
//      publisher's due-select (pending-only) never claims it, mark-posted flips
//      it to `posted` writing NO tweet id (decision 6), then link a SECOND manual
//      row to a synthetic posts_published original via the pure matchManualRows +
//      the wrapper's atomic stamp (the private reconcileManualPosts wrapper only
//      runs inside the PAID daily pass / POST /posts/reconcile, so the $0 test
//      exercises the exported matcher + replays the stamp — D127)
//   c) DM drafts: the $0 refusal ladder 404 unknown_person → 422 no_shared_context
//      on a thin throwaway person, and PATCH-sent event idempotency via a
//      directly-inserted draft row (marking sent twice logs one manual_dm_logged)
//   d) articles CRUD round-trip + the assist refusal ladder (invalid_mode /
//      *_required / not_found / discarded_locked all $0; the 503 only when Grok is
//      genuinely unconfigured — the sole line gated on key state)
//
//   --live  (needs a Grok key): ONE article assist (~$0.02) seeded with a
//           Romanian idea → asserts the proposal is English (no Romanian
//           diacritics) and a cost_events row lands under platform 'grok'.
//
// REAL-DB SAFETY: this smoke only CREATES rows (no route here mutates rows it did
// not make — unlike the guardrails smoke's read-that-writes), so the discipline
// is namespace-then-delete (D98c): every row is namespaced (`a315 …` text, `888…`
// tweet ids, `a315_*` handles, collected ids) and cleanup deletes exactly those.
// A seeded posts_published original is written `retired: true` (NT.7) so an
// aborted run can never leave a candidate the daily 03:00 pass would pay to read.
//
// Run: bun run scripts/smoke-authoring3.ts   (+ --live for one Grok call)

import { and, eq, gte, inArray, like, lte } from 'drizzle-orm';
import { Hono } from 'hono';
import { db } from '../src/db/client.ts';
import { costEvents } from '../src/db/shared-schema.ts';
import { llmConfigured } from '../src/llm/index.ts';
import {
  ACTIVE_TIMES_COLS,
  ACTIVE_TIMES_MAX_ROWS,
  ACTIVE_TIMES_MIN_ROWS,
} from '../src/shared/activeTimes.ts';
import {
  articles,
  audienceActivity,
  dmDrafts,
  people,
  personEvents,
  postsPublished,
  scheduledPosts,
} from '../src/x/db/schema.ts';
import { type PublishedCandidate, matchManualRows } from '../src/x/posts/manualReconcile.ts';
import { analyticsRouter } from '../src/x/routes/analytics.ts';
import { articlesRouter } from '../src/x/routes/articles.ts';
import { calendar } from '../src/x/routes/calendar.ts';
import { dmsRouter } from '../src/x/routes/dms.ts';

const LIVE = process.argv.includes('--live');

const app = new Hono();
app.route('/x', analyticsRouter);
app.route('/x', calendar);
app.route('/x', dmsRouter);
app.route('/x', articlesRouter);

const MIN_MS = 60_000;

// ---------------------------------------------------------------- namespacing

// Text prefix on everything we schedule; `a315` (no real draft produces it).
const TEXT_PREFIX = 'a315 smoke';
// 18-digit ids: real tweet ids are 19-digit snowflakes starting 1 or 2, so an
// `888…` prefix can never collide with a discovered tweet.
const TWEET_ID = '888000000000001';
// ≤15 chars, lowercase — normalizePersonHandle silently drops anything longer,
// which would make the DM assertions vacuous (NT.2).
const DM_HANDLE = 'a315_dm';
const THIN_HANDLE = 'a315_thin';
const GHOST_HANDLE = 'a315_ghost'; // deliberately never inserted → the 404 path
const ALL_HANDLES = [DM_HANDLE, THIN_HANDLE, GHOST_HANDLE];

const createdArticleIds: string[] = [];
const createdCaptureIds: number[] = [];

// ------------------------------------------------------------ cleanup + checks

function cleanup(): void {
  try {
    // FK order: person_events + dm_drafts reference people; posts_published
    // references scheduled_posts.
    db.delete(personEvents).where(inArray(personEvents.handle, ALL_HANDLES)).run();
    db.delete(dmDrafts).where(inArray(dmDrafts.handle, ALL_HANDLES)).run();
    db.delete(people).where(inArray(people.handle, ALL_HANDLES)).run();
    db.delete(postsPublished)
      .where(inArray(postsPublished.tweetId, [TWEET_ID]))
      .run();
    db.delete(scheduledPosts)
      .where(like(scheduledPosts.text, `${TEXT_PREFIX}%`))
      .run();
    if (createdArticleIds.length > 0) {
      db.delete(articles).where(inArray(articles.id, createdArticleIds)).run();
      createdArticleIds.length = 0;
    }
    if (createdCaptureIds.length > 0) {
      db.delete(audienceActivity).where(inArray(audienceActivity.id, createdCaptureIds)).run();
      createdCaptureIds.length = 0;
    }
  } catch (err) {
    console.error('cleanup failed:', err instanceof Error ? err.message : err);
  }
}

function fail(msg: string): never {
  console.error(`FAIL: ${msg}`);
  cleanup();
  process.exit(1);
}

function check(ok: boolean, msg: string): void {
  if (!ok) fail(msg);
}

const jsonInit = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

// `app.request` is typed `Response | Promise<Response>`; a helper returning it
// must be async or root typecheck (which covers scripts/) rejects it. Tolerates
// an empty 204 body (article DELETE).
async function req<T>(path: string, init?: RequestInit): Promise<{ status: number; body: T }> {
  const res = await app.request(path, init);
  const text = await res.text();
  return { status: res.status, body: (text ? JSON.parse(text) : null) as T };
}

// Leftovers from an aborted run would poison the assertions below.
cleanup();

// ===================================================== a) active-times capture

// A valid 7×24 grid (hourly rows, the live A3.3 shape) with one hot cell.
const GRID_ROWS = 24;
const grid: number[][] = Array.from({ length: ACTIVE_TIMES_COLS }, (_, col) =>
  Array.from({ length: GRID_ROWS }, (_, row) => (col === 5 && row === 18 ? 1 : 0.1)),
);

const postCap = await req<{ capture: { id: number; metric: string; cols: number; rows: number } }>(
  '/x/analytics/active-times',
  jsonInit('POST', {
    metric: 'likes',
    tzOffsetMin: 0,
    cols: ACTIVE_TIMES_COLS,
    rows: GRID_ROWS,
    grid,
  }),
);
check(postCap.status === 201, `POST /x/analytics/active-times returned ${postCap.status}`);
check(typeof postCap.body.capture.id === 'number', 'capture came back without an id');
createdCaptureIds.push(postCap.body.capture.id);
check(postCap.body.capture.rows === GRID_ROWS, `capture rows ${postCap.body.capture.rows}`);

const getCap = await req<{ capture: { id: number } | null }>('/x/analytics/active-times');
check(getCap.status === 200, `GET /x/analytics/active-times returned ${getCap.status}`);
check(
  getCap.body.capture?.id === postCap.body.capture.id,
  'GET did not return the just-captured newest row',
);

// A grid whose rows fall below ACTIVE_TIMES_MIN_ROWS is rejected before any
// write (the parser and the route must agree on what a plausible grid is, D114).
const badRows = ACTIVE_TIMES_MIN_ROWS - 1;
const badGrid = Array.from({ length: ACTIVE_TIMES_COLS }, () =>
  Array.from({ length: badRows }, () => 0),
);
const reject = await req<{ error: string }>(
  '/x/analytics/active-times',
  jsonInit('POST', {
    metric: 'likes',
    tzOffsetMin: 0,
    cols: ACTIVE_TIMES_COLS,
    rows: badRows,
    grid: badGrid,
  }),
);
check(reject.status === 400, `an out-of-range grid returned ${reject.status}, expected 400`);
check(reject.body.error === 'invalid_rows', `rejection error ${reject.body.error}`);
console.log(
  `active-times: POST/GET round-trip (rows in [${ACTIVE_TIMES_MIN_ROWS}, ${ACTIVE_TIMES_MAX_ROWS}]) + an under-range grid 400s`,
);

// ================================================= b) manual publish lifecycle

const now = Date.now();

// A manual row whose slot is already in the PAST — if it were `pending` the
// publisher would claim it; a URL in the text is accepted (guard is pending-only).
const MANUAL_A_TEXT = `${TEXT_PREFIX} — link post read the write-up at https://example.com/post`;
const manualA = await req<{
  id: string;
  status: string;
  postedTweetId: string | null;
  warnings: unknown;
}>(
  '/x/posts/scheduled',
  jsonInit('POST', {
    text: MANUAL_A_TEXT,
    status: 'manual',
    scheduledFor: new Date(now - 5 * MIN_MS).toISOString(),
  }),
);
check(manualA.status === 201, `manual create with a URL returned ${manualA.status}`);
check(manualA.body.status === 'manual', `manual create status ${manualA.body.status}`);
const manualAId = manualA.body.id;

// The publisher's claim predicate (publisher.ts::claimOne) is `status='pending'
// AND scheduled_for <= now` — replayed read-only here (claimOne isn't exported
// and driving tickPublisher needs a token + would call X). Assert our manual row
// is absent from the due set even though its slot has passed.
const dueRows = await db
  .select({ id: scheduledPosts.id })
  .from(scheduledPosts)
  .where(and(eq(scheduledPosts.status, 'pending'), lte(scheduledPosts.scheduledFor, new Date())));
check(
  !dueRows.some((r) => r.id === manualAId),
  'a due-but-manual row appeared in the publisher pending due-select',
);

const marked = await req<{ status: string; postedTweetId: string | null }>(
  `/x/posts/scheduled/${manualAId}/mark-posted`,
  jsonInit('POST', {}),
);
check(marked.status === 200, `mark-posted returned ${marked.status}`);
check(marked.body.status === 'posted', `mark-posted left status ${marked.body.status}`);
// Decision 6: mark-posted writes NO tweet id — the daily reconcile links it (a
// DOM-known id parked above the since_id checkpoint hides same-day tweets).
check(marked.body.postedTweetId === null, 'mark-posted wrote a tweet id — the checkpoint trap');

// mark-posted only accepts a manual row: a second call now 409s not_manual.
const reMark = await req<{ error: string }>(
  `/x/posts/scheduled/${manualAId}/mark-posted`,
  jsonInit('POST', {}),
);
check(
  reMark.status === 409 && reMark.body.error === 'not_manual',
  're-marking a posted row must 409 not_manual',
);

// A SECOND manual row that the reconcile will link to a synthetic discovered
// original by text + time.
const MANUAL_B_TEXT = `${TEXT_PREFIX} — an original that i pasted by hand and the daily pass will link back`;
const manualB = await req<{ id: string }>(
  '/x/posts/scheduled',
  jsonInit('POST', {
    text: MANUAL_B_TEXT,
    status: 'manual',
    scheduledFor: new Date(now - 30 * MIN_MS).toISOString(),
  }),
);
check(manualB.status === 201, `the second manual row returned ${manualB.status}`);
const manualBId = manualB.body.id;

// The tweet discovery WOULD have inserted (retired so it's never a billed
// candidate, NT.7); posted within the [slot−1h, slot+7d] window.
await db.insert(postsPublished).values({
  tweetId: TWEET_ID,
  text: MANUAL_B_TEXT.replace(' ', '  '), // whitespace differs — collapse must still match
  postedAt: new Date(now - 20 * MIN_MS),
  isReply: false,
  source: 'a315-smoke',
  retired: true,
});

// Drive the reconcile through the exported pure matcher (the wrapper is private
// and its route runs the paid daily pass), then replay the wrapper's atomic
// two-sided stamp (dailyMetrics.ts::reconcileManualPosts).
const rowB = await db
  .select({
    id: scheduledPosts.id,
    text: scheduledPosts.text,
    scheduledFor: scheduledPosts.scheduledFor,
    status: scheduledPosts.status,
  })
  .from(scheduledPosts)
  .where(eq(scheduledPosts.id, manualBId));
const candidates: PublishedCandidate[] = await db
  .select({
    tweetId: postsPublished.tweetId,
    text: postsPublished.text,
    postedAt: postsPublished.postedAt,
    isReply: postsPublished.isReply,
    scheduledPostId: postsPublished.scheduledPostId,
  })
  .from(postsPublished)
  .where(eq(postsPublished.tweetId, TWEET_ID));
const rowBScheduledFor = rowB[0]?.scheduledFor;
check(rowBScheduledFor != null, 'manual row B lost its scheduled_for');
const links = matchManualRows(
  [
    {
      id: manualBId,
      text: MANUAL_B_TEXT,
      scheduledFor: rowBScheduledFor as Date,
      status: 'manual',
    },
  ],
  candidates,
);
check(links.length === 1, `matchManualRows produced ${links.length} links, expected 1`);
check(links[0]?.tweetId === TWEET_ID, 'the matcher linked the wrong tweet');

const link = links[0];
if (link) {
  db.transaction((tx) => {
    tx.update(scheduledPosts)
      .set({ postedTweetId: link.tweetId, status: 'posted', updatedAt: new Date() })
      .where(eq(scheduledPosts.id, link.scheduledPostId))
      .run();
    tx.update(postsPublished)
      .set({ scheduledPostId: link.scheduledPostId })
      .where(eq(postsPublished.tweetId, link.tweetId))
      .run();
  });
}

const linkedRow = await db
  .select({ status: scheduledPosts.status, postedTweetId: scheduledPosts.postedTweetId })
  .from(scheduledPosts)
  .where(eq(scheduledPosts.id, manualBId));
check(
  linkedRow[0]?.postedTweetId === TWEET_ID,
  'reconcile did not stamp posted_tweet_id on the row',
);
check(linkedRow[0]?.status === 'posted', 'reconcile left the row un-posted');
const linkedPub = await db
  .select({ scheduledPostId: postsPublished.scheduledPostId })
  .from(postsPublished)
  .where(eq(postsPublished.tweetId, TWEET_ID));
check(
  linkedPub[0]?.scheduledPostId === manualBId,
  'reconcile did not stamp scheduled_post_id on the tweet',
);
console.log(
  'manual publish: URL text accepted, publisher due-select skips it, mark-posted → posted (no tweet id), reconcile links a pasted original by text',
);

// ===================================================== c) DM drafts

// 404: a handle with no person row refuses before any spend.
const dm404 = await req<{ error: string }>(
  '/x/dms/draft',
  jsonInit('POST', { handle: GHOST_HANDLE }),
);
check(
  dm404.status === 404 && dm404.body.error === 'unknown_person',
  `unknown person → ${dm404.status}`,
);

// 422: a person with no shared context refuses before the LLM gate (so this is
// $0 even when a Grok key is present).
await db.insert(people).values({ handle: THIN_HANDLE, source: 'manual', stage: 'stranger' });
const dm422 = await req<{ error: string }>(
  '/x/dms/draft',
  jsonInit('POST', { handle: THIN_HANDLE, idea: 'salut' }),
);
check(
  dm422.status === 422 && dm422.body.error === 'no_shared_context',
  `a thin dossier → ${dm422.status} ${dm422.body.error}, expected 422 no_shared_context`,
);

// PATCH-sent event idempotency: a directly-inserted draft (bypassing the paid
// draft path, the routes/dms.test.ts convention). Marking sent logs exactly one
// manual_dm_logged; marking sent again is an idempotent no-op.
await db.insert(people).values({ handle: DM_HANDLE, source: 'manual', stage: 'engaged' });
const draftId = crypto.randomUUID();
await db
  .insert(dmDrafts)
  .values({ id: draftId, handle: DM_HANDLE, text: 'Loved your thread on X.', status: 'draft' });

const send1 = await req<{ status: string; sentAt: number | string | null }>(
  `/x/dms/${draftId}`,
  jsonInit('PATCH', { status: 'sent' }),
);
check(
  send1.status === 200 && send1.body.status === 'sent',
  `mark sent → ${send1.status} ${send1.body.status}`,
);
check(send1.body.sentAt !== null, 'mark sent did not stamp sent_at');

const events1 = await db
  .select({ id: personEvents.id })
  .from(personEvents)
  .where(and(eq(personEvents.handle, DM_HANDLE), eq(personEvents.type, 'manual_dm_logged')));
check(
  events1.length === 1,
  `mark sent logged ${events1.length} manual_dm_logged events, expected 1`,
);

const send2 = await req<{ status: string }>(
  `/x/dms/${draftId}`,
  jsonInit('PATCH', { status: 'sent' }),
);
check(send2.status === 200, `re-marking sent returned ${send2.status}`);
const events2 = await db
  .select({ id: personEvents.id })
  .from(personEvents)
  .where(and(eq(personEvents.handle, DM_HANDLE), eq(personEvents.type, 'manual_dm_logged')));
check(
  events2.length === 1,
  `re-marking sent logged a second event (${events2.length}) — must be idempotent`,
);
console.log(
  'dm drafts: 404 unknown_person → 422 no_shared_context (both $0), mark-sent logs one event and is idempotent',
);

// ===================================================== d) articles CRUD + assist

const BODY = '# Hello\n\nfirst para.';
const create = await req<{ id: string; title: string; status: string; bodyMd: string }>(
  '/x/articles',
  jsonInit('POST', { title: `${TEXT_PREFIX} draft`, bodyMd: BODY }),
);
check(create.status === 201, `POST /x/articles returned ${create.status}`);
const articleId = create.body.id;
createdArticleIds.push(articleId);
check(create.body.status === 'draft', `new article status ${create.body.status}`);

const read = await req<{ id: string; bodyMd: string }>(`/x/articles/${articleId}`);
check(
  read.status === 200 && read.body.bodyMd === BODY,
  'GET /x/articles/:id did not return body_md',
);

const list = await req<{ articles: Array<Record<string, unknown>> }>('/x/articles?status=draft');
check(list.status === 200, `GET /x/articles list returned ${list.status}`);
const listed = list.body.articles.find((a) => a.id === articleId);
check(listed !== undefined, 'the draft is missing from the status=draft list');
check(!('bodyMd' in (listed ?? {})), 'the list leaked body_md (it must ship only bodyChars)');
check(listed?.bodyChars === BODY.length, `bodyChars ${listed?.bodyChars}, expected ${BODY.length}`);

const publish = await req<{ status: string; publishedAt: number | string | null }>(
  `/x/articles/${articleId}`,
  jsonInit('PATCH', { status: 'published', publishedUrl: 'https://x.com/i/article/1' }),
);
check(publish.status === 200 && publish.body.status === 'published', 'publish did not take');
check(publish.body.publishedAt !== null, 'publish did not stamp published_at');

// published → draft keeps published_at as history.
const reopen = await req<{ status: string; publishedAt: number | string | null }>(
  `/x/articles/${articleId}`,
  jsonInit('PATCH', { status: 'draft' }),
);
check(
  reopen.body.status === 'draft' && reopen.body.publishedAt !== null,
  're-opening lost the publish stamp',
);

// Discard, then the freeze: a content edit on a discarded row 409s; assist on a
// discarded row 409s (before the LLM gate, so $0); reviving to draft is allowed.
await req(`/x/articles/${articleId}`, jsonInit('PATCH', { status: 'discarded' }));
const frozen = await req<{ error: string }>(
  `/x/articles/${articleId}`,
  jsonInit('PATCH', { subtitle: 'x' }),
);
check(
  frozen.status === 409 && frozen.body.error === 'discarded_locked',
  `a frozen edit → ${frozen.status}`,
);
const assistFrozen = await req<{ error: string }>(
  `/x/articles/${articleId}/assist`,
  jsonInit('POST', { mode: 'outline', idea: 'anything' }),
);
check(
  assistFrozen.status === 409 && assistFrozen.body.error === 'discarded_locked',
  `assist on a discarded article → ${assistFrozen.status}, expected 409 discarded_locked`,
);
const revive = await req<{ status: string }>(
  `/x/articles/${articleId}`,
  jsonInit('PATCH', { status: 'draft' }),
);
check(revive.body.status === 'draft', 'reviving a discarded article to draft failed');

// The assist refusal ladder, all $0 (decided before the LLM gate):
const badMode = await req<{ error: string }>(
  `/x/articles/${articleId}/assist`,
  jsonInit('POST', { mode: 'nope' }),
);
check(
  badMode.status === 400 && badMode.body.error === 'invalid_mode',
  `bad mode → ${badMode.status}`,
);
const noIdea = await req<{ error: string }>(
  `/x/articles/${articleId}/assist`,
  jsonInit('POST', { mode: 'outline' }),
);
check(
  noIdea.status === 400 && noIdea.body.error === 'idea_required',
  `outline w/o idea → ${noIdea.status}`,
);
const noHeading = await req<{ error: string }>(
  `/x/articles/${articleId}/assist`,
  jsonInit('POST', { mode: 'section' }),
);
check(
  noHeading.status === 400 && noHeading.body.error === 'heading_required',
  `section w/o heading → ${noHeading.status}`,
);
const noSelection = await req<{ error: string }>(
  `/x/articles/${articleId}/assist`,
  jsonInit('POST', { mode: 'polish' }),
);
check(
  noSelection.status === 400 && noSelection.body.error === 'selection_required',
  `polish w/o selection → ${noSelection.status}`,
);
const missing = await req<{ error: string }>(
  `/x/articles/${crypto.randomUUID()}/assist`,
  jsonInit('POST', { mode: 'outline', idea: 'anything' }),
);
check(
  missing.status === 404 && missing.body.error === 'not_found',
  `assist on a missing article → ${missing.status}`,
);

// The 503 is the ONLY assertion gated on key state: when Grok is unconfigured a
// fully-valid assist refuses at the gate (still $0). When a key IS present we
// skip it rather than spend on the default run (that path is --live).
if (!llmConfigured()) {
  const gated = await req<{ error: string }>(
    `/x/articles/${articleId}/assist`,
    jsonInit('POST', { mode: 'outline', idea: 'a clear idea for an outline' }),
  );
  check(
    gated.status === 503 && gated.body.error === 'grok_not_configured',
    `no-Grok assist → ${gated.status}, expected 503 grok_not_configured`,
  );
  console.log('articles: CRUD round-trip + assist ladder (400/404/409) + 503 grok_not_configured');
} else {
  console.log(
    'articles: CRUD round-trip + assist ladder (400/404/409); 503 skipped (Grok configured — see --live)',
  );
}

const del = await app.request(`/x/articles/${articleId}`, { method: 'DELETE' });
check(del.status === 204, `DELETE /x/articles/:id returned ${del.status}`);
const gone = await req<{ error: string }>(`/x/articles/${articleId}`);
check(gone.status === 404, `a deleted article still reads ${gone.status}`);

// ===================================================== --live: one Grok assist

if (LIVE) {
  if (!llmConfigured()) fail('--live needs a Grok key (XAI_API_KEY) — llmConfigured() is false');
  const liveArticle = await req<{ id: string }>(
    '/x/articles',
    jsonInit('POST', { title: `${TEXT_PREFIX} live` }),
  );
  check(liveArticle.status === 201, `--live article create returned ${liveArticle.status}`);
  const liveId = liveArticle.body.id;
  createdArticleIds.push(liveId);

  const since = new Date(Date.now() - 1000);
  const assist = await req<{
    mode: string;
    proposal: { title?: string; subtitle?: string; markdown?: string };
    costUsd: number;
    model: string;
  }>(
    `/x/articles/${liveId}/assist`,
    // Any-language in, English out (decision 13) — a Romanian steer must not shift
    // the output language.
    jsonInit('POST', {
      mode: 'full',
      idea: 'Scrie un articol despre cum să construiești în public și să câștigi primii o mie de urmăritori pe X.',
    }),
  );
  check(assist.status === 200, `--live assist returned ${assist.status}`);
  const proposal = assist.body.proposal;
  const outText =
    `${proposal.title ?? ''}\n${proposal.subtitle ?? ''}\n${proposal.markdown ?? ''}`.trim();
  check(outText.length > 0, '--live assist returned an empty proposal');
  // The cheap language heuristic (plan): Romanian-specific diacritics in the
  // output mean it ignored the English contract.
  const romanianDiacritics = /[ăâîșțĂÂÎȘȚşţŞŢ]/;
  check(
    !romanianDiacritics.test(outText),
    `--live output carries Romanian diacritics: "${outText.slice(0, 80)}"`,
  );
  check(typeof assist.body.costUsd === 'number', '--live assist returned no costUsd');

  // The Grok client fire-and-forgets its cost log; give it a beat to land.
  await new Promise((r) => setTimeout(r, 500));
  const costRows = await db
    .select({ platform: costEvents.platform })
    .from(costEvents)
    .where(and(eq(costEvents.platform, 'grok'), gte(costEvents.ts, since)));
  check(costRows.length > 0, 'no cost_events row landed under platform grok for the --live assist');
  console.log(
    `--live: full draft in English, $${assist.body.costUsd.toFixed(4)} on ${assist.body.model}, cost_events(grok) logged`,
  );
}

// ===================================================== cleanup + verification

cleanup();

const leftSlots = await db
  .select({ id: scheduledPosts.id })
  .from(scheduledPosts)
  .where(like(scheduledPosts.text, `${TEXT_PREFIX}%`));
check(leftSlots.length === 0, `${leftSlots.length} seeded scheduled posts survived cleanup`);
const leftPub = await db
  .select({ tweetId: postsPublished.tweetId })
  .from(postsPublished)
  .where(inArray(postsPublished.tweetId, [TWEET_ID]));
check(leftPub.length === 0, `${leftPub.length} seeded posts_published survived cleanup`);
const leftPeople = await db
  .select({ handle: people.handle })
  .from(people)
  .where(inArray(people.handle, ALL_HANDLES));
check(leftPeople.length === 0, `${leftPeople.length} seeded people survived cleanup`);
const leftArticles = await db
  .select({ id: articles.id })
  .from(articles)
  .where(like(articles.title, `${TEXT_PREFIX}%`));
check(leftArticles.length === 0, `${leftArticles.length} seeded articles survived cleanup`);
console.log('cleanup: every seeded row removed');

console.log(`SMOKE PASS (${LIVE ? 'with --live Grok call' : '$0 — no X API, no LLM'})`);
process.exit(0);
