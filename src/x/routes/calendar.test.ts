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
