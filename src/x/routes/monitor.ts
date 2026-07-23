// GET /x/monitor — the activity monitor (Guardrails §B). $0 by construction:
// nothing in this file can reach `xFetch`, every rule is read-time SQL over data
// already collected and paid for (§7.12 — no alerts table, no worker).
//
// The loaders are exported because the brief serves the same block (GR.6): one
// place owns the windows and the column choices, so the Today card and
// `GET /x/monitor` can never disagree about what "today's churn" means. Same
// discipline as `loadBestTimeCells` between metrics and brief.
//
// Static path, no `:param` — §7.20 is a "keep it that way" note here, not a
// live trap.

import { and, eq, gte, isNotNull } from 'drizzle-orm';
import { Hono } from 'hono';
import { db } from '../../db/client.ts';
import { following, postsPublished, replyDrafts, scheduledPosts } from '../db/schema.ts';
import {
  type MonitorInputs,
  NEAR_DUPLICATE_WINDOW_MS,
  REPLY_BURST_LOOKBACK_MS,
  UNFOLLOW_CHURN_WINDOW_MS,
  runMonitor,
  worstOf,
} from '../monitor.ts';

export const monitorRouter = new Hono();

/** Everything the five rules read, in four queries. The windows come from the
 *  pure module's constants so a recalibration there moves the SQL with it. */
export async function loadMonitorInputs(now: Date): Promise<MonitorInputs> {
  const t = now.getTime();
  const [originals, replies, marks, slots] = await Promise.all([
    // ORIGINALS only: thread tails are published as self-replies, so a thread
    // stays one row and can't read as a posting burst. The 14-day window is the
    // near-duplicate rule's; the burst rule narrows it to 24h itself. No row
    // limit — a fortnight of one person's originals is structurally small, and a
    // limit would quietly shrink the pool the duplicate scan sees.
    db
      .select({
        tweetId: postsPublished.tweetId,
        text: postsPublished.text,
        postedAt: postsPublished.postedAt,
      })
      .from(postsPublished)
      .where(
        and(
          eq(postsPublished.isReply, false),
          gte(postsPublished.postedAt, new Date(t - NEAR_DUPLICATE_WINDOW_MS)),
        ),
      ),
    // `updatedAt` on a posted draft is the paste time (§ the brief's quota reads
    // the same column the same way).
    db
      .select({ at: replyDrafts.updatedAt })
      .from(replyDrafts)
      .where(
        and(
          eq(replyDrafts.status, 'posted'),
          gte(replyDrafts.updatedAt, new Date(t - REPLY_BURST_LOOKBACK_MS)),
        ),
      ),
    db
      .select({ at: following.unfollowMarkedAt })
      .from(following)
      .where(
        and(
          isNotNull(following.unfollowMarkedAt),
          gte(following.unfollowMarkedAt, new Date(t - UNFOLLOW_CHURN_WINDOW_MS)),
        ),
      ),
    // Pending only — `draft`/`segment` rows aren't going anywhere on a timer,
    // and worker-owned `publishing`/`posted` rows are already spent.
    db
      .select({ id: scheduledPosts.id, scheduledFor: scheduledPosts.scheduledFor })
      .from(scheduledPosts)
      .where(and(eq(scheduledPosts.status, 'pending'), isNotNull(scheduledPosts.scheduledFor))),
  ]);

  return {
    now,
    originals,
    replyPastedAts: replies.map((r) => r.at),
    unfollowMarks: marks.map((r) => r.at as Date),
    pendingSlots: slots.map((s) => ({ id: s.id, scheduledFor: s.scheduledFor as Date })),
  };
}

monitorRouter.get('/monitor', async (c) => {
  const now = new Date();
  const alerts = runMonitor(await loadMonitorInputs(now));
  return c.json({ alerts, worst: worstOf(alerts), checkedAt: now.toISOString() });
});
