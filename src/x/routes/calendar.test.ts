// S3 "visual made" marker: media_note lifecycle over the real (in-memory,
// auto-migrated) SQLite DB — set at create, stamp/clear via PATCH, validation
// guards, and the brief passthrough contract (the field must survive the today
// select or the amber chip never renders).

import { afterAll, describe, expect, test } from 'bun:test';
import { inArray } from 'drizzle-orm';
import { Hono } from 'hono';
import { db } from '../../db/client.ts';
import { scheduledPosts } from '../db/schema.ts';
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
}

afterAll(async () => {
  if (createdIds.length > 0) {
    await db.delete(scheduledPosts).where(inArray(scheduledPosts.id, createdIds));
  }
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
