// Drains due `voice_tweets` rows by snapshotting public metrics from X. Runs
// every 60s in-process. Lighter cadence than `metricsPoll` because other-user
// reads cost 5× owned reads ($0.005 vs $0.001) — see PLAN.md §"Cadence ladders":
//   0–6 h    → +1 h    (6 polls)
//   6 h–48 h → +6 h    (7)
//   2 d–7 d  → +24 h   (5)
//   ≥7 d     → retired
// ≈18 polls × $0.005 ≈ $0.09/tweet over 7 days. Per-author guardrail
// (`max_polled_tweets`, default 20) is enforced upstream by `voicePull` —
// this worker only drains what `voicePull` queued.
//
// Only `public_metrics` is recorded. `non_public_metrics` / `organic_metrics`
// require ownership and are silently null for other-user posts; the schema's
// `voice_metrics_snapshots` table has no columns for them.
//
// Per-row transaction with `FOR UPDATE SKIP LOCKED` (same shape as metricsPoll):
// the X call happens inside the lock so a second tick can't double-snapshot
// or race past the next_poll_at update. pollCount is bumped only on a real
// snapshot — transient errors push next_poll_at forward without crediting it.

import { and, asc, eq, lte, sql } from 'drizzle-orm';
import { db } from '../../db/client.ts';
import { voiceMetricsSnapshots, voiceTweets } from '../db/schema.ts';
import { getTweet } from '../endpoints.ts';
import { XApiError } from '../errors.ts';
import { getValidAccessToken } from '../token-store.ts';

export interface VoiceMetricsPollDeps {
  clientId: string;
  clientSecret: string;
}

export interface VoiceMetricsPollOptions extends VoiceMetricsPollDeps {
  intervalMs?: number;
  batchSize?: number;
}

const DEFAULT_INTERVAL_MS = 60_000;
const DEFAULT_BATCH_SIZE = 10;
// Defer transient failures past the 60s tick so we don't hot-loop on the same
// row inside a single tick's batch. Tuned to the first cadence step.
const TRANSIENT_RETRY_DELAY_MS = 60 * 60_000;

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const RETIRE_AT_MS = 7 * DAY;

/**
 * Returns the delay (ms) until the next voice-metrics poll for a tweet of the
 * given age, or `null` if the tweet should be retired.
 *
 * Pure function — covered by unit tests in src/test.test.ts.
 */
export function nextVoicePollDelay(ageMs: number): number | null {
  if (ageMs >= RETIRE_AT_MS) return null;
  if (ageMs < 6 * HOUR) return HOUR;
  if (ageMs < 48 * HOUR) return 6 * HOUR;
  return DAY;
}

export interface VoiceMetricsPollTickResult {
  polled: number;
  retired: number;
  failed: number;
}

export async function tickVoiceMetricsPoll(
  opts: VoiceMetricsPollOptions,
): Promise<VoiceMetricsPollTickResult> {
  const result: VoiceMetricsPollTickResult = { polled: 0, retired: 0, failed: 0 };

  let token: string;
  try {
    token = await getValidAccessToken({
      clientId: opts.clientId,
      clientSecret: opts.clientSecret,
    });
  } catch (err) {
    console.error('voiceMetricsPoll: token fetch failed:', describe(err));
    return result;
  }

  const batchSize = opts.batchSize ?? DEFAULT_BATCH_SIZE;
  for (let i = 0; i < batchSize; i++) {
    const outcome = await processOne(token);
    if (outcome === 'idle') break;
    if (outcome === 'polled') result.polled++;
    else if (outcome === 'retired') result.retired++;
    else result.failed++;
  }

  if (result.polled > 0 || result.retired > 0 || result.failed > 0) {
    console.log(
      `voiceMetricsPoll: polled=${result.polled} retired=${result.retired} failed=${result.failed}`,
    );
  }
  return result;
}

async function processOne(token: string): Promise<'polled' | 'retired' | 'failed' | 'idle'> {
  return db.transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(voiceTweets)
      .where(and(eq(voiceTweets.retired, false), lte(voiceTweets.nextPollAt, new Date())))
      .orderBy(asc(voiceTweets.nextPollAt))
      .limit(1)
      .for('update', { skipLocked: true });

    const row = rows[0];
    if (!row) return 'idle';

    const now = new Date();
    const ageMs = now.getTime() - row.createdAt.getTime();

    let tweet: Awaited<ReturnType<typeof getTweet>>;
    try {
      // Other-user read — never request private metrics (silently null).
      tweet = await getTweet(token, row.tweetId);
    } catch (err) {
      if (err instanceof XApiError && (err.status === 404 || err.status === 403)) {
        // Deleted, suspended, or now protected — retire so we stop spending.
        await tx
          .update(voiceTweets)
          .set({ retired: true, lastSeenAt: now })
          .where(eq(voiceTweets.tweetId, row.tweetId));
        console.log(`voiceMetricsPoll: ${row.tweetId} retired (${err.status})`);
        return 'retired';
      }
      await tx
        .update(voiceTweets)
        .set({ nextPollAt: new Date(now.getTime() + TRANSIENT_RETRY_DELAY_MS) })
        .where(eq(voiceTweets.tweetId, row.tweetId));
      console.error(`voiceMetricsPoll: ${row.tweetId} failed: ${describe(err)}`);
      return 'failed';
    }

    await tx.insert(voiceMetricsSnapshots).values({
      tweetId: row.tweetId,
      publicMetrics: tweet.public_metrics ?? null,
    });

    const delay = nextVoicePollDelay(ageMs);
    const nextPollAt = delay === null ? null : new Date(now.getTime() + delay);
    const retired = delay === null;

    await tx
      .update(voiceTweets)
      .set({
        pollCount: sql`${voiceTweets.pollCount} + 1`,
        lastSeenAt: now,
        nextPollAt,
        retired,
      })
      .where(eq(voiceTweets.tweetId, row.tweetId));

    return retired ? 'retired' : 'polled';
  });
}

export function startVoiceMetricsPoll(opts: VoiceMetricsPollOptions): () => void {
  const intervalMs = opts.intervalMs ?? DEFAULT_INTERVAL_MS;
  let running = false;

  const safeTick = async (): Promise<void> => {
    if (running) return;
    running = true;
    try {
      await tickVoiceMetricsPoll(opts);
    } catch (err) {
      console.error('voiceMetricsPoll: tick crashed:', describe(err));
    } finally {
      running = false;
    }
  };

  const handle = setInterval(() => {
    void safeTick();
  }, intervalMs);

  return () => clearInterval(handle);
}

function describe(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
