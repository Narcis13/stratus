// Studio asset library (SURFACES S4). Composed PNGs and AI backgrounds are
// stored as SQLite BLOBs (right at single-user scale, no object store, rides the
// DB backup). Always mounted, all $0 — no X/Grok calls here.
//
//   POST   /assets            { pngBase64, kind, prompt?, width?, height?, usedOnTweetId? }
//   GET    /assets            metadata only (never the blob)
//   GET    /assets/:id/png    streams the raw image (extension re-open + browser)
//   DELETE /assets/:id
//
// The list deliberately excludes the blob column: a history rail of 100 cards
// must not ship 100 megabytes; the extension pulls bytes only when it re-opens
// one via the /png stream (routed through the background's binary transport).

import { desc, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { db } from '../../db/client.ts';
import { mediaAssets } from '../db/schema.ts';

export const assets = new Hono();

// SQLite BLOBs are fine at KB–MB; the cap keeps a runaway paste from bloating
// the single-file DB. 2MB comfortably holds a 1500×500 PNG.
const MAX_ASSET_BYTES = 2 * 1024 * 1024;
const LIST_LIMIT = 200;
const ASSET_KINDS = new Set(['quote', 'stat', 'banner', 'pfp', 'background', 'other']);

// Metadata projection — everything BUT the blob.
const META_COLUMNS = {
  id: mediaAssets.id,
  kind: mediaAssets.kind,
  prompt: mediaAssets.prompt,
  mediaType: mediaAssets.mediaType,
  width: mediaAssets.width,
  height: mediaAssets.height,
  byteLength: mediaAssets.byteLength,
  usedOnTweetId: mediaAssets.usedOnTweetId,
  createdAt: mediaAssets.createdAt,
} as const;

assets.post('/assets', async (c) => {
  const raw = await c.req.json().catch(() => null);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw))
    return c.json({ error: 'invalid_body' }, 400);
  const b = raw as Record<string, unknown>;

  const pngBase64 = typeof b.pngBase64 === 'string' ? b.pngBase64 : '';
  if (pngBase64 === '') return c.json({ error: 'invalid_png' }, 400);

  let bytes: Buffer;
  try {
    bytes = Buffer.from(pngBase64, 'base64');
  } catch {
    return c.json({ error: 'invalid_png' }, 400);
  }
  if (bytes.length === 0) return c.json({ error: 'invalid_png' }, 400);
  if (bytes.length > MAX_ASSET_BYTES)
    return c.json(
      { error: 'asset_too_large', maxBytes: MAX_ASSET_BYTES, bytes: bytes.length },
      413,
    );

  const kind = typeof b.kind === 'string' && ASSET_KINDS.has(b.kind) ? b.kind : 'other';
  const prompt =
    typeof b.prompt === 'string' && b.prompt.trim() !== '' ? b.prompt.trim().slice(0, 4000) : null;
  const mediaType =
    typeof b.mediaType === 'string' && b.mediaType.startsWith('image/') ? b.mediaType : 'image/png';
  const width = Number.isInteger(b.width) ? (b.width as number) : null;
  const height = Number.isInteger(b.height) ? (b.height as number) : null;
  const usedOnTweetId =
    typeof b.usedOnTweetId === 'string' && b.usedOnTweetId.trim() !== ''
      ? b.usedOnTweetId.trim()
      : null;

  const [row] = await db
    .insert(mediaAssets)
    .values({
      kind,
      prompt,
      png: bytes,
      mediaType,
      width,
      height,
      byteLength: bytes.length,
      usedOnTweetId,
    })
    .returning(META_COLUMNS);
  return c.json(row, 201);
});

assets.get('/assets', async (c) => {
  const rows = await db
    .select(META_COLUMNS)
    .from(mediaAssets)
    .orderBy(desc(mediaAssets.createdAt))
    .limit(LIST_LIMIT);
  return c.json({ assets: rows });
});

assets.get('/assets/:id/png', async (c) => {
  const id = c.req.param('id');
  const [row] = await db
    .select({ png: mediaAssets.png, mediaType: mediaAssets.mediaType })
    .from(mediaAssets)
    .where(eq(mediaAssets.id, id));
  if (!row) return c.json({ error: 'not_found' }, 404);
  // bun:sqlite hands BLOBs back as Uint8Array; copy into a plain ArrayBuffer-
  // backed view so Hono's body type (Uint8Array<ArrayBuffer>) is satisfied.
  const src = row.png instanceof Uint8Array ? row.png : new Uint8Array(row.png as ArrayBuffer);
  const bytes = new Uint8Array(src.byteLength);
  bytes.set(src);
  return c.body(bytes, 200, {
    'Content-Type': row.mediaType || 'image/png',
    'Cache-Control': 'private, max-age=31536000, immutable',
  });
});

assets.delete('/assets/:id', async (c) => {
  const id = c.req.param('id');
  const [existing] = await db
    .select({ id: mediaAssets.id })
    .from(mediaAssets)
    .where(eq(mediaAssets.id, id));
  if (!existing) return c.json({ error: 'not_found' }, 404);
  await db.delete(mediaAssets).where(eq(mediaAssets.id, id));
  return c.json({ ok: true });
});
