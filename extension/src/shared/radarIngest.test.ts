import { describe, expect, it } from 'bun:test';
import type { RadarSighting } from './radar.ts';
import {
  RADAR_INGEST_RESEND_MS,
  SIGHTING_MAX_AGE_MIN,
  pathFromTabUrl,
  shouldShipSighting,
  toSightingWireRow,
} from './radarIngest.ts';

const BASE: RadarSighting = {
  tweetId: '1234567890',
  url: 'https://x.com/someone/status/1234567890',
  handle: 'someone',
  author: 'Some One',
  text: 'a tweet worth answering',
  band: 'sweep',
  signals: { views: 4000, replies: 12, ageMin: 30, vpm: 133.3, bait: false },
  firstSeenAt: '2026-08-17T10:00:00.000Z',
  lastSeenAt: '2026-08-17T10:05:00.000Z',
};

describe('shouldShipSighting', () => {
  it('ships a tweet never sent before', () => {
    expect(shouldShipSighting(undefined, 'sweep', 1_000_000)).toBe(true);
  });

  it('skips a re-sighting inside the window on the same band', () => {
    const sent = { at: 1_000_000, band: 'sweep' as const };
    expect(shouldShipSighting(sent, 'sweep', 1_000_000 + RADAR_INGEST_RESEND_MS - 1)).toBe(false);
  });

  it('ships inside the window when the band changed', () => {
    const sent = { at: 1_000_000, band: 'sweep' as const };
    // A ⊕ pin landing on a swept row is a real event, not scroll noise — the
    // same carve-out the page and the route both make.
    expect(shouldShipSighting(sent, 'manual', 1_000_000 + 1)).toBe(true);
  });

  it('ships once the window has elapsed', () => {
    const sent = { at: 1_000_000, band: 'sweep' as const };
    expect(shouldShipSighting(sent, 'sweep', 1_000_000 + RADAR_INGEST_RESEND_MS)).toBe(true);
  });

  it('honors an explicit window', () => {
    const sent = { at: 0, band: 'roster' as const };
    expect(shouldShipSighting(sent, 'roster', 5_000, 10_000)).toBe(false);
    expect(shouldShipSighting(sent, 'roster', 10_000, 10_000)).toBe(true);
  });
});

describe('toSightingWireRow', () => {
  it('maps a full sighting onto the wire row', () => {
    const row = toSightingWireRow({ ...BASE, likes: 91, verified: true }, '/home');
    expect(row).toEqual({
      tweetId: '1234567890',
      url: 'https://x.com/someone/status/1234567890',
      handle: 'someone',
      author: 'Some One',
      text: 'a tweet worth answering',
      band: 'sweep',
      views: 4000,
      replies: 12,
      likes: 91,
      bait: false,
      verified: true,
      ageMin: 30,
      seenAt: '2026-08-17T10:05:00.000Z',
      sourcePath: '/home',
    });
  });

  it('omits likes/verified entirely when they were never read', () => {
    const row = toSightingWireRow(BASE, '/search');
    expect(row).not.toBeNull();
    // Absent, not `undefined`-valued: absent is the wire's "unknown" (§7.11),
    // and the route reads a present-but-undefined key the same way only by luck
    // of JSON.stringify.
    expect(row && 'likes' in row).toBe(false);
    expect(row && 'verified' in row).toBe(false);
  });

  it('keeps a false `verified` — it is a reading, not a missing one', () => {
    const row = toSightingWireRow({ ...BASE, verified: false }, null);
    expect(row?.verified).toBe(false);
  });

  it('passes a null sourcePath through', () => {
    expect(toSightingWireRow(BASE, null)?.sourcePath).toBeNull();
  });

  it('sends the capture time as seenAt, not the first sighting', () => {
    expect(toSightingWireRow(BASE, null)?.seenAt).toBe('2026-08-17T10:05:00.000Z');
  });

  // The route parses every row before writing any and 400s the whole batch on
  // its first bad row, while the client warns and drops — so a row it would
  // refuse has to die here, alone, instead of taking the batch with it.
  it('drops a sighting older than the server age ceiling', () => {
    const ancient = { ...BASE, signals: { ...BASE.signals, ageMin: SIGHTING_MAX_AGE_MIN + 1 } };
    expect(toSightingWireRow(ancient, '/home')).toBeNull();
    const oldest = { ...BASE, signals: { ...BASE.signals, ageMin: SIGHTING_MAX_AGE_MIN } };
    expect(toSightingWireRow(oldest, '/home')).not.toBeNull();
  });

  it('drops a sighting whose id or handle no reader should have produced', () => {
    expect(toSightingWireRow({ ...BASE, tweetId: 'not-an-id' }, null)).toBeNull();
    expect(toSightingWireRow({ ...BASE, handle: 'a handle with spaces' }, null)).toBeNull();
    expect(toSightingWireRow({ ...BASE, handle: 'sixteencharacters' }, null)).toBeNull();
  });

  it('drops a sighting with unusable counts', () => {
    const negative = { ...BASE, signals: { ...BASE.signals, views: -1 } };
    expect(toSightingWireRow(negative, null)).toBeNull();
    const nan = { ...BASE, signals: { ...BASE.signals, replies: Number.NaN } };
    expect(toSightingWireRow(nan, null)).toBeNull();
  });

  it('nulls an over-long optional field instead of dropping the row', () => {
    // "unknown" is legal for these; losing a display name is not a reason to
    // lose the sighting.
    const row = toSightingWireRow({ ...BASE, author: 'x'.repeat(200) }, '/'.padEnd(400, 'a'));
    expect(row?.author).toBeNull();
    expect(row?.sourcePath).toBeNull();
    expect(row?.tweetId).toBe('1234567890');
  });
});

describe('pathFromTabUrl', () => {
  it('reads the pathname off a real x.com URL', () => {
    expect(pathFromTabUrl('https://x.com/search?q=bun&f=live')).toBe('/search');
    expect(pathFromTabUrl('https://x.com/i/lists/1789')).toBe('/i/lists/1789');
    expect(pathFromTabUrl('https://x.com/home')).toBe('/home');
  });

  it('answers null for a tab with no readable URL', () => {
    // A chrome:// page, a discarded tab or a stripped sender is normal.
    expect(pathFromTabUrl(undefined)).toBeNull();
    expect(pathFromTabUrl('')).toBeNull();
    expect(pathFromTabUrl('not a url')).toBeNull();
  });
});
