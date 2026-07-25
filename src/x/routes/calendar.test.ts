// S3 "visual made" marker: media_note lifecycle over the real (in-memory,
// auto-migrated) SQLite DB — set at create, stamp/clear via PATCH, validation
// guards, and the brief passthrough contract (the field must survive the today
// select or the amber chip never renders).
//
// GR.6 adds the schedule-time advisory: `warnings` on the POST response. Its
// fixtures live ~90–130 days out, well clear of every other suite's calendar
// rows, because the cluster check is the one assertion here that a stray
// pending row elsewhere could perturb.

import { afterAll, describe, expect, test } from 'bun:test';
import { inArray } from 'drizzle-orm';
import { Hono } from 'hono';
import { db } from '../../db/client.ts';
import { postsPublished, scheduledPosts } from '../db/schema.ts';
import { calendar } from './calendar.ts';

const app = new Hono();
app.route('/x', calendar);

const createdIds: string[] = [];

async function send<T>(
  path: string,
  method: string,
  body?: unknown,
): Promise<{ status: number; body: T }> {
  const res = await app.request(path, {
    method,
    ...(body !== undefined
      ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }
      : {}),
  });
  const parsed = res.status === 204 ? (undefined as T) : ((await res.json()) as T);
  return { status: res.status, body: parsed };
}

interface Row {
  id: string;
  text: string;
  status: string;
  mediaNote: string | null;
  warnings: string[];
}

const DUPE_ID = 'gr6_cal_dupe';
const DUPE_TEXT =
  'the boring version of the feature shipped on tuesday and nobody complained about it';

afterAll(async () => {
  if (createdIds.length > 0) {
    await db.delete(scheduledPosts).where(inArray(scheduledPosts.id, createdIds));
  }
  await db.delete(postsPublished).where(inArray(postsPublished.tweetId, [DUPE_ID]));
});

describe('media_note (S3)', () => {
  test('create with a note, stamp via PATCH, clear via null and empty string', async () => {
    const created = await send<Row>('/x/posts/scheduled', 'POST', {
      text: 'draft that will get a visual',
      mediaNote: 'quote card',
    });
    expect(created.status).toBe(201);
    expect(created.body.mediaNote).toBe('quote card');
    createdIds.push(created.body.id);

    const restamped = await send<Row>(`/x/posts/scheduled/${created.body.id}`, 'PATCH', {
      mediaNote: '  stat card — paste the PNG  ',
    });
    expect(restamped.status).toBe(200);
    expect(restamped.body.mediaNote).toBe('stat card — paste the PNG');

    const cleared = await send<Row>(`/x/posts/scheduled/${created.body.id}`, 'PATCH', {
      mediaNote: null,
    });
    expect(cleared.status).toBe(200);
    expect(cleared.body.mediaNote).toBeNull();

    const stampedAgain = await send<Row>(`/x/posts/scheduled/${created.body.id}`, 'PATCH', {
      mediaNote: 'banner',
    });
    expect(stampedAgain.body.mediaNote).toBe('banner');
    const clearedByEmpty = await send<Row>(`/x/posts/scheduled/${created.body.id}`, 'PATCH', {
      mediaNote: '',
    });
    expect(clearedByEmpty.status).toBe(200);
    expect(clearedByEmpty.body.mediaNote).toBeNull();
  });

  test('a PATCH without mediaNote leaves the stamp alone', async () => {
    const created = await send<Row>('/x/posts/scheduled', 'POST', {
      text: 'stamped, then edited',
      mediaNote: 'quote card',
    });
    createdIds.push(created.body.id);
    const edited = await send<Row>(`/x/posts/scheduled/${created.body.id}`, 'PATCH', {
      text: 'stamped, then edited (v2)',
    });
    expect(edited.status).toBe(200);
    expect(edited.body.mediaNote).toBe('quote card');
  });

  test('validation: non-string and over-long notes are 400, pre-insert', async () => {
    const bad = await send<{ error: string }>('/x/posts/scheduled', 'POST', {
      text: 'bad note',
      mediaNote: 42,
    });
    expect(bad.status).toBe(400);
    expect(bad.body.error).toBe('invalid_media_note');

    const long = await send<{ error: string }>('/x/posts/scheduled', 'POST', {
      text: 'too long note',
      mediaNote: 'x'.repeat(281),
    });
    expect(long.status).toBe(400);
    expect(long.body.error).toBe('invalid_media_note');

    const created = await send<Row>('/x/posts/scheduled', 'POST', { text: 'patch guard' });
    createdIds.push(created.body.id);
    const badPatch = await send<{ error: string }>(
      `/x/posts/scheduled/${created.body.id}`,
      'PATCH',
      { mediaNote: ['nope'] },
    );
    expect(badPatch.status).toBe(400);
    expect(badPatch.body.error).toBe('invalid_media_note');
  });
});

describe('schedule-time advisory (GR.6)', () => {
  const DAY_MS = 24 * 3_600_000;
  const at = (days: number, minutes = 0): string =>
    new Date(Date.now() + days * DAY_MS + minutes * 60_000).toISOString();

  async function schedule(text: string, when: string): Promise<Row> {
    const res = await send<Row>('/x/posts/scheduled', 'POST', {
      text,
      scheduledFor: when,
      status: 'pending',
    });
    expect(res.status).toBe(201);
    createdIds.push(res.body.id);
    return res.body;
  }

  test('a lone pending post in open calendar space warns about nothing', async () => {
    const row = await schedule('gr6 advisory: a post with nothing near it', at(90));
    expect(row.warnings).toEqual([]);
    expect(row.status).toBe('pending');
  });

  test('a second slot inside the cluster window warns — and still saves the row', async () => {
    const row = await schedule(
      'gr6 advisory: unrelated words entirely, no overlap here',
      at(90, 20),
    );
    expect(row.id).toBeTruthy();
    expect(row.status).toBe('pending');
    const cluster = row.warnings.find((w) => w.includes('within'));
    expect(cluster).toBeDefined();
    // The 20-minute neighbour seeded by the previous test, reported by distance.
    expect(cluster).toContain('20 min away');
  });

  test('near-duplicate of a recent published original warns', async () => {
    await db.insert(postsPublished).values({
      tweetId: DUPE_ID,
      text: DUPE_TEXT,
      postedAt: new Date(Date.now() - 3 * DAY_MS),
      isReply: false,
      source: 'test',
      // A leftover own post is a candidate for the daily billed pass (NT.7).
      retired: true,
    });

    const row = await schedule(DUPE_TEXT, at(110));
    const dupe = row.warnings.find((w) => w.startsWith('Very similar to a post from'));
    expect(dupe).toBeDefined();
    expect(dupe).toContain('3 days ago');
    expect(dupe).toContain('100% overlap');
  });

  test('near-duplicate of a post already queued warns before either goes out', async () => {
    const row = await schedule(DUPE_TEXT, at(130));
    expect(
      row.warnings.some((w) => w.startsWith('Very similar to another post already queued')),
    ).toBe(true);
  });

  test('drafts carry no advisory — nothing is scheduled to happen yet', async () => {
    const res = await send<Row>('/x/posts/scheduled', 'POST', { text: DUPE_TEXT });
    expect(res.status).toBe(201);
    createdIds.push(res.body.id);
    expect(res.body.status).toBe('draft');
    expect(res.body.warnings).toEqual([]);
  });
});

// A3.5 manual publish. Fixtures sit ~150 days out — clear of the GR.6 advisory
// fixtures above (90–130 d) and the brief suite's monitor pair (~200 d), so no
// cluster window overlaps another suite's rows.
describe('manual publish (A3.5)', () => {
  const DAY_MS = 24 * 3_600_000;
  const at = (days: number, minutes = 0): string =>
    new Date(Date.now() + days * DAY_MS + minutes * 60_000).toISOString();
  const URL_TEXT = 'a35 manual link post, read this: https://example.com/essay';

  async function createManual(text: string, when: string): Promise<Row & { updatedAt: string }> {
    const res = await send<Row & { updatedAt: string }>('/x/posts/scheduled', 'POST', {
      text,
      scheduledFor: when,
      status: 'manual',
    });
    expect(res.status).toBe(201);
    createdIds.push(res.body.id);
    return res.body;
  }

  test('create requires scheduledFor, exactly like pending', async () => {
    const res = await send<{ error: string }>('/x/posts/scheduled', 'POST', {
      text: 'a35 manual without a slot',
      status: 'manual',
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('scheduled_for_required_when_pending');
  });

  test('an unknown create status names manual in its error', async () => {
    const res = await send<{ error: string }>('/x/posts/scheduled', 'POST', {
      text: 'a35 bad status',
      status: 'whenever',
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('create_status_must_be_draft_pending_or_manual');
  });

  test('a URL is accepted at create — no API call, no surcharge (decision 5)', async () => {
    const row = await createManual(URL_TEXT, at(150));
    expect(row.status).toBe('manual');
    expect(Array.isArray(row.warnings)).toBe(true);
  });

  test('a URL is accepted at PATCH while the row stays manual', async () => {
    const row = await createManual('a35 manual, url arrives later', at(151));
    const patched = await send<Row>(`/x/posts/scheduled/${row.id}`, 'PATCH', {
      text: `${URL_TEXT} v2`,
    });
    expect(patched.status).toBe(200);
    expect(patched.body.status).toBe('manual');
  });

  test('manual→pending promotion re-checks the URL guard', async () => {
    const row = await createManual(URL_TEXT, at(152));
    const rejected = await send<{ error: string }>(`/x/posts/scheduled/${row.id}`, 'PATCH', {
      status: 'pending',
    });
    expect(rejected.status).toBe(400);
    expect(rejected.body.error).toBe('url_in_text');
    // Without the URL the same promotion goes through.
    const promoted = await send<Row>(`/x/posts/scheduled/${row.id}`, 'PATCH', {
      text: 'a35 promoted back to the API path, link removed',
      status: 'pending',
    });
    expect(promoted.status).toBe(200);
    expect(promoted.body.status).toBe('pending');
  });

  test('manual PATCH final-state still requires scheduledFor', async () => {
    const row = await createManual('a35 manual losing its slot', at(153));
    const res = await send<{ error: string }>(`/x/posts/scheduled/${row.id}`, 'PATCH', {
      scheduledFor: null,
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('scheduled_for_required_when_pending');
  });

  test('mark-posted flips manual→posted; a second call 409s on the posted row', async () => {
    const row = await createManual('a35 manual, pasted and confirmed', at(154));
    const marked = await send<Row & { postedTweetId: string | null }>(
      `/x/posts/scheduled/${row.id}/mark-posted`,
      'POST',
    );
    expect(marked.status).toBe(200);
    expect(marked.body.status).toBe('posted');
    // Decision 6 (checkpoint trap): the flip must never invent a tweet id —
    // linking is the daily reconcile's job.
    expect(marked.body.postedTweetId).toBeNull();

    const again = await send<{ error: string }>(`/x/posts/scheduled/${row.id}/mark-posted`, 'POST');
    expect(again.status).toBe(409);
    expect(again.body.error).toBe('not_manual');

    // Worker-owned lock still applies after the flip (§7.23).
    const edit = await send<{ error: string }>(`/x/posts/scheduled/${row.id}`, 'PATCH', {
      text: 'too late',
    });
    expect(edit.status).toBe(409);
  });

  test('mark-posted refuses pending and draft rows', async () => {
    const pending = await send<Row>('/x/posts/scheduled', 'POST', {
      text: 'a35 pending row, publisher territory',
      scheduledFor: at(156),
      status: 'pending',
    });
    createdIds.push(pending.body.id);
    const onPending = await send<{ error: string }>(
      `/x/posts/scheduled/${pending.body.id}/mark-posted`,
      'POST',
    );
    expect(onPending.status).toBe(409);
    expect(onPending.body.error).toBe('not_manual');

    const draft = await send<Row>('/x/posts/scheduled', 'POST', { text: 'a35 draft row' });
    createdIds.push(draft.body.id);
    const onDraft = await send<{ error: string }>(
      `/x/posts/scheduled/${draft.body.id}/mark-posted`,
      'POST',
    );
    expect(onDraft.status).toBe(409);
    expect(onDraft.body.error).toBe('not_manual');
  });

  test('mark-posted: 400 on a malformed id, 404 on an absent one', async () => {
    const bad = await send<{ error: string }>('/x/posts/scheduled/not-a-uuid/mark-posted', 'POST');
    expect(bad.status).toBe(400);
    expect(bad.body.error).toBe('invalid_id');

    const gone = await send<{ error: string }>(
      '/x/posts/scheduled/00000000-0000-4000-8000-00000000a350/mark-posted',
      'POST',
    );
    expect(gone.status).toBe(404);
    expect(gone.body.error).toBe('not_found');
  });

  test('posted stays un-PATCHable directly — mark-posted is the only transition', async () => {
    const row = await createManual('a35 regression: no posted via PATCH', at(157));
    const res = await send<{ error: string }>(`/x/posts/scheduled/${row.id}`, 'PATCH', {
      status: 'posted',
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('status_not_settable_via_patch');
  });

  test('threads reject manual at create and at promotion (decision 7)', async () => {
    const created = await send<{ error: string }>('/x/posts/threads', 'POST', {
      segments: ['a35 thread head', 'a35 thread tail'],
      scheduledFor: at(158),
      status: 'manual',
    });
    expect(created.status).toBe(400);
    expect(created.body.error).toBe('manual_threads_unsupported');

    // The PATCH promotion path is closed too — a manual thread member would
    // strand its tails (mark-posted flips one row; tails ride a pending head).
    const thread = await send<{ segments: Array<{ id: string }> }>('/x/posts/threads', 'POST', {
      segments: ['a35 draft thread head', 'a35 draft thread tail'],
    });
    expect(thread.status).toBe(201);
    for (const s of thread.body.segments) createdIds.push(s.id);
    const head = thread.body.segments[0] as { id: string };
    const flipped = await send<{ error: string }>(`/x/posts/scheduled/${head.id}`, 'PATCH', {
      scheduledFor: at(159),
      status: 'manual',
    });
    expect(flipped.status).toBe(400);
    expect(flipped.body.error).toBe('manual_threads_unsupported');
  });

  test('a manual row stays cancellable and deletable until posted', async () => {
    const row = await createManual('a35 manual, cancelled then deleted', at(160));
    const cancelled = await send<Row>(`/x/posts/scheduled/${row.id}`, 'PATCH', {
      status: 'cancelled',
    });
    expect(cancelled.status).toBe(200);
    const deleted = await send<undefined>(`/x/posts/scheduled/${row.id}`, 'DELETE');
    expect(deleted.status).toBe(204);
  });
});

// A3.7 (D117): the schedule-time advisory is blind to nothing once manual rows
// exist — a manual slot fires warnings, and manual and pending count as each
// other's neighbors. Fixtures sit ~300 d out, clear of every band above.
describe('manual rows are first-class in scheduleWarnings (A3.7)', () => {
  const DAY_MS = 24 * 3_600_000;
  const at = (days: number, minutes = 0): string =>
    new Date(Date.now() + days * DAY_MS + minutes * 60_000).toISOString();

  test('a manual slot near a pending one warns, proving both fire and see each other', async () => {
    const pending = await send<Row>('/x/posts/scheduled', 'POST', {
      text: 'a37 pending anchor for the cluster check',
      scheduledFor: at(300),
      status: 'pending',
    });
    expect(pending.status).toBe(201);
    createdIds.push(pending.body.id);
    // The pending row is alone in its band, so it warns about nothing yet.
    expect(pending.body.warnings.some((w) => w.includes('within'))).toBe(false);

    const manual = await send<Row>('/x/posts/scheduled', 'POST', {
      text: 'a37 manual pasted right after the pending one',
      scheduledFor: at(300, 20),
      status: 'manual',
    });
    expect(manual.status).toBe(201);
    createdIds.push(manual.body.id);
    const cluster = manual.body.warnings.find((w) => w.includes('within'));
    expect(cluster).toBeDefined();
    expect(cluster).toContain('20 min away');
  });
});
