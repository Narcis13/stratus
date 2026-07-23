// GR.5 monitor route over the real (in-memory) DB. The thresholds are the pure
// suite's job; what this file proves is the WIRING — that each rule reads the
// column and window the design says it does.
//
// Assertions are baseline-relative on purpose: this suite shares one in-memory
// DB with every other route suite, so "no alerts on an empty DB" is not a thing
// that can be asserted here. The baseline is captured once, each rule is proven
// by what it adds to it, and the final test proves the DB came back unchanged.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { inArray } from 'drizzle-orm';
import { Hono } from 'hono';
import { db } from '../../db/client.ts';
import {
  following,
  followingRuns,
  postsPublished,
  replyDrafts,
  scheduledPosts,
} from '../db/schema.ts';
import type { MonitorAlert, MonitorRule, MonitorSeverity } from '../monitor.ts';
import { UNFOLLOW_CHURN_WARN } from '../monitor.ts';
import { monitorRouter } from './monitor.ts';

const app = new Hono();
app.route('/x', monitorRouter);

const MIN_MS = 60_000;
const DAY_MS = 24 * 60 * MIN_MS;

interface MonitorBody {
  alerts: MonitorAlert[];
  worst: MonitorSeverity | null;
  checkedAt: string;
}

const BURST_IDS = ['gr5_b1', 'gr5_b2', 'gr5_b3', 'gr5_b4', 'gr5_b5'];
const DUPE_IDS = ['gr5_d1', 'gr5_d2'];
const POST_IDS = [...BURST_IDS, ...DUPE_IDS];
const DRAFT_IDS = Array.from({ length: 12 }, (_, i) => `gr5-draft-${i}`);
const HANDLES = Array.from({ length: UNFOLLOW_CHURN_WARN }, (_, i) => `gr5_f${i}`);
const SLOT_IDS = ['gr5-slot-a', 'gr5-slot-b'];

let runId = '';
let baseline: MonitorBody;

function minsAgo(n: number): Date {
  return new Date(Date.now() - n * MIN_MS);
}

async function getMonitor(): Promise<MonitorBody> {
  const res = await app.request('/x/monitor');
  expect(res.status).toBe(200);
  return (await res.json()) as MonitorBody;
}

function alertFor(body: MonitorBody, rule: MonitorRule): MonitorAlert | undefined {
  return body.alerts.find((a) => a.rule === rule);
}

function rulesOf(body: MonitorBody): string[] {
  return body.alerts.map((a) => a.rule).sort();
}

/** The rule's evidence as it stood at baseline — `{}` when it wasn't firing, so
 *  a `?? 0` on any counter reads correctly either way. */
function baseEvidence(rule: MonitorRule): Record<string, unknown> {
  return alertFor(baseline, rule)?.evidence ?? {};
}

async function cleanup(): Promise<void> {
  await db.delete(postsPublished).where(inArray(postsPublished.tweetId, POST_IDS));
  await db.delete(replyDrafts).where(inArray(replyDrafts.id, DRAFT_IDS));
  await db.delete(following).where(inArray(following.handle, HANDLES));
  if (runId) await db.delete(followingRuns).where(inArray(followingRuns.id, [runId]));
  await db.delete(scheduledPosts).where(inArray(scheduledPosts.id, SLOT_IDS));
}

beforeAll(async () => {
  await cleanup();
  baseline = await getMonitor();
});

afterAll(cleanup);

describe('GET /x/monitor', () => {
  test('answers with the alert envelope', async () => {
    expect(Array.isArray(baseline.alerts)).toBe(true);
    expect(Number.isNaN(Date.parse(baseline.checkedAt))).toBe(false);
    // `worst` is always derived from the alerts it ships with, never stale.
    const severities = new Set(baseline.alerts.map((a) => a.severity));
    if (severities.size === 0) expect(baseline.worst).toBeNull();
    else expect(severities.has(baseline.worst as MonitorSeverity)).toBe(true);
  });

  test('postBurst reads own originals, not replies', async () => {
    await db.insert(postsPublished).values([
      // Five originals inside twenty minutes — volume AND spacing.
      ...BURST_IDS.map((tweetId, i) => ({
        tweetId,
        text: `monitor fixture number ${i} about ${'abcde'[i]} entirely unrelated things`,
        postedAt: minsAgo(2 + i * 3),
        isReply: false,
        source: 'test',
        // A leftover own post is a candidate for the daily billed pass (NT.7).
        retired: true,
      })),
    ]);

    const withOriginals = alertFor(await getMonitor(), 'postBurst');
    expect(withOriginals?.severity).toBe('warn');
    const count = Number(withOriginals?.evidence.count24h);
    expect(count).toBeGreaterThanOrEqual(BURST_IDS.length);

    // A pile of self-replies in the same minutes must NOT move the count: a
    // thread posts its tail this way and X's heuristics don't punish it.
    const segIds = Array.from({ length: 8 }, (_, i) => `gr5_b1_seg${i}`);
    await db.insert(postsPublished).values(
      segIds.map((tweetId, i) => ({
        tweetId,
        text: `thread tail ${i}`,
        postedAt: minsAgo(2),
        isReply: true,
        inReplyToTweetId: BURST_IDS[0] as string,
        source: 'test',
        retired: true,
      })),
    );
    POST_IDS.push(...segIds);

    expect(Number(alertFor(await getMonitor(), 'postBurst')?.evidence.count24h)).toBe(count);
  });

  test('nearDuplicate reads the 14-day original texts', async () => {
    const text = 'the same post about shipping the boring version twice in one fortnight';
    await db.insert(postsPublished).values(
      DUPE_IDS.map((tweetId, i) => ({
        tweetId,
        text,
        postedAt: new Date(Date.now() - (3 + i) * DAY_MS),
        isReply: false,
        source: 'test',
        retired: true,
      })),
    );

    const alert = alertFor(await getMonitor(), 'nearDuplicate');
    expect(alert?.severity).toBe('warn');
    // Identical text scores 1.0, which sorts ahead of everything else, so the
    // pair is guaranteed to be inside the listed sample.
    expect(alert?.evidence.pairs).toContainEqual({ a: DUPE_IDS[0], b: DUPE_IDS[1], similarity: 1 });
    expect(Number(alert?.evidence.pairCount)).toBeGreaterThanOrEqual(1);
  });

  test('replyBurst reads posted reply_drafts by paste time', async () => {
    await db.insert(replyDrafts).values(
      DRAFT_IDS.map((id, i) => ({
        id,
        sourceTweetId: '9001',
        sourceAuthorUsername: 'gr5_author',
        sourceText: 'what do you think?',
        sourceUrl: 'https://x.com/gr5_author/status/9001',
        contextSnapshot: {},
        replyText: `monitor fixture reply ${i}`,
        model: 'test',
        status: 'posted',
        // Paste time — the posted flip stamps updatedAt.
        updatedAt: minsAgo(1 + i * 2),
      })),
    );

    const alert = alertFor(await getMonitor(), 'replyBurst');
    expect(alert).toBeDefined();
    expect(Number(alert?.evidence.peakPerHour)).toBeGreaterThanOrEqual(DRAFT_IDS.length);
  });

  test('unfollowChurn reads following.unfollow_marked_at in the trailing 24h', async () => {
    const [run] = await db.insert(followingRuns).values({}).returning();
    runId = run?.id ?? '';
    await db.insert(following).values(
      HANDLES.map((handle, i) => ({
        handle,
        followsBack: false,
        firstSeenAt: new Date(Date.now() - 30 * DAY_MS),
        lastSeenAt: new Date(),
        lastRunId: runId,
        status: 'done',
        // The mark is what churn counts — status is not.
        unfollowMarkedAt: minsAgo(10 + i),
      })),
    );

    const alert = alertFor(await getMonitor(), 'unfollowChurn');
    expect(alert).toBeDefined();
    expect(Number(alert?.evidence.count)).toBeGreaterThanOrEqual(UNFOLLOW_CHURN_WARN);
  });

  test('scheduleCluster reads pending slots only, and counts the new pair', async () => {
    // A month out, so the pair can only cluster with itself — no other suite's
    // calendar fixture is anywhere near it.
    const far = Date.now() + 30 * DAY_MS;
    await db.insert(scheduledPosts).values([
      {
        id: SLOT_IDS[0] as string,
        text: 'monitor fixture slot one',
        scheduledFor: new Date(far),
        status: 'pending',
        source: 'test',
      },
      {
        id: SLOT_IDS[1] as string,
        text: 'monitor fixture slot two',
        scheduledFor: new Date(far + 30 * MIN_MS),
        status: 'pending',
        source: 'test',
      },
      // A draft 5 minutes after the second one: not pending, so not a cluster.
      {
        id: 'gr5-slot-draft',
        text: 'monitor fixture draft',
        scheduledFor: new Date(far + 35 * MIN_MS),
        status: 'draft',
        source: 'test',
      },
    ]);
    SLOT_IDS.push('gr5-slot-draft');

    const alert = alertFor(await getMonitor(), 'scheduleCluster');
    expect(alert?.severity).toBe('info');
    expect(Number(alert?.evidence.clusterCount)).toBe(
      Number(baseEvidence('scheduleCluster').clusterCount ?? 0) + 1,
    );
  });

  test('worst is the loudest severity now that several rules fire', async () => {
    const body = await getMonitor();
    expect(body.alerts.length).toBeGreaterThanOrEqual(4);
    // One alert per rule, always.
    expect(new Set(body.alerts.map((a) => a.rule)).size).toBe(body.alerts.length);
    expect(body.worst).toBe(body.alerts[0]?.severity ?? null);
  });

  test('removing the fixtures returns the monitor to its baseline', async () => {
    await cleanup();
    expect(rulesOf(await getMonitor())).toEqual(rulesOf(baseline));
  });
});
