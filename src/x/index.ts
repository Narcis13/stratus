// Public surface of the X platform slice. `app.ts` is the only outside caller —
// it wires routes via `mountX(app)` and starts in-process workers via
// `startXWorkers()`. Nothing else should import from inside `src/x/`.

import type { Hono } from 'hono';
import { registerHeartbeat, unregisterHeartbeat } from '../heartbeats.ts';
// S2: the X platform's MCP tools. Re-exported so the platform-agnostic MCP
// bridge (src/mcp.ts) reaches them through this public surface, not a deep
// import — same discipline as mountX/startXWorkers.
export { registerXTools } from './mcp.ts';
import { makeOnCost } from '../middleware/costTracker.ts';
import { setDefaultOnCost } from './client.ts';
import { brief } from './routes/brief.ts';
import { calendar } from './routes/calendar.ts';
import { channelsRouter } from './routes/channels.ts';
import { conversations } from './routes/conversations.ts';
import { data, explorer } from './routes/data.ts';
import { digest } from './routes/digest.ts';
import { drafter } from './routes/drafter.ts';
import { followups } from './routes/followups.ts';
import { harvest } from './routes/harvest.ts';
import { ideasRouter } from './routes/ideas.ts';
import { launch } from './routes/launch.ts';
import { createMentionsRouter } from './routes/mentions.ts';
import { metrics } from './routes/metrics.ts';
import { peopleRouter } from './routes/people.ts';
import { pillars } from './routes/pillars.ts';
import { playbook } from './routes/playbook.ts';
import { createPostsRouter } from './routes/posts.ts';
import { radar } from './routes/radar.ts';
import { replies } from './routes/replies.ts';
import { createVoiceRouter } from './routes/voice.ts';
import { voiceExtract } from './routes/voiceExtract.ts';
import { DAILY_METRICS_HEARTBEAT, startDailyMetrics } from './workers/dailyMetrics.ts';
import { PUBLISHER_HEARTBEAT, startPublisher } from './workers/publisher.ts';

interface XConfig {
  selfXUserId: string;
  clientId: string;
  clientSecret: string;
}

function loadConfig(): XConfig {
  return {
    selfXUserId: requireEnv('SELF_X_USER_ID'),
    clientId: requireEnv('X_CLIENT_ID'),
    clientSecret: requireEnv('X_CLIENT_SECRET'),
  };
}

export function mountX(app: Hono): void {
  const cfg = loadConfig();
  app.route('/x', brief);
  app.route('/x', calendar);
  app.route('/x', metrics);
  app.route('/x', pillars);
  app.route('/x', createPostsRouter(cfg));
  app.route('/x', createVoiceRouter());
  app.route('/x', harvest);
  // C0: radar draft reads/status flips are $0 and mount without the Grok key;
  // only the insert path (generate-batch, below) needs XAI_API_KEY.
  app.route('/x', radar);
  // C6: Idea Inbox — pure SQL, always mounted; consumption happens inside the
  // Grok-gated draft routes, but capture/list/reopen must work without the key.
  app.route('/x', ideasRouter);
  // C8: channels — topic rooms as saved views over tags, pure SQL, always $0.
  app.route('/x', channelsRouter);
  // S1: read-only data explorer API over the SQLite state — { readonly: true }
  // connection, always mounted, $0. The explorer UI shell is served at the root
  // path GET /explorer (data-free, public — every fetch it makes needs the
  // bearer), so it sits OUTSIDE the /x/* auth middleware.
  app.route('/x', data);
  app.route('/', explorer);
  // C5: follow-up queue + Top Fans. MUST mount before peopleRouter —
  // 'followups'/'fans' are valid usernames, so GET /people/:handle would
  // otherwise swallow these static paths as dossier lookups.
  app.route('/x', followups);
  // C1: the people layer — pure SQL over already-collected data, always $0.
  app.route('/x', peopleRouter);
  // C7: Launch Room early-replier ingest — DOM-scraped, people+events only, $0.
  app.route('/x', launch);
  // C2: threaded inbox — groups mentions + my posts by conversation_id, $0.
  app.route('/x', conversations);
  // C9: Sunday Digest — facts are $0 SQL; the one weekly narration checks
  // XAI_API_KEY at runtime and degrades to facts-only without it.
  app.route('/x', digest);
  // C4: the Playbook — pure SQL over measured outcomes, $0; only its
  // extract-winners POST needs Grok and it checks XAI_API_KEY at runtime.
  app.route('/x', playbook);
  app.route('/x', createMentionsRouter(cfg));
  // Grok-backed; refuse to mount when the key is missing — same shape as mountGrok.
  if (process.env.XAI_API_KEY) {
    app.route('/x', replies);
    app.route('/x', drafter);
    app.route('/x', voiceExtract);
  } else {
    console.log(
      'x/replies: XAI_API_KEY not set — /x/replies/*, /x/posts/draft and /x/voice/*/extract not mounted',
    );
  }
}

export interface XWorkers {
  /** Stops timers AND drains in-flight ticks — await before process exit. */
  stop(): Promise<void>;
}

export function startXWorkers(): XWorkers {
  // Install before any worker tick so the very first X call is logged. The
  // daily budget watchdog rides on the same callback ($0.15/day soft cap).
  setDefaultOnCost(
    makeOnCost('x', { dailyBudgetUsd: Number(process.env.X_DAILY_BUDGET_USD ?? '0.15') }),
  );

  const cfg = loadConfig();
  const stops: Array<() => void | Promise<void>> = [];
  const heartbeats: string[] = [];

  // Heartbeats: /healthz flags (503) when a worker stops beating — a dead
  // publisher must page the deploy check, not fail silently.
  registerHeartbeat(PUBLISHER_HEARTBEAT, 5 * 60_000);
  heartbeats.push(PUBLISHER_HEARTBEAT);
  stops.push(startPublisher(cfg));

  // One daily 03:00 UTC pass that discovers own tweets/replies and snapshots
  // each once at ~24h (replaces the old 60s metricsPoll + 24h ownReconcile).
  if (process.env.DAILY_METRICS_ENABLED !== 'false') {
    registerHeartbeat(DAILY_METRICS_HEARTBEAT, 25 * 60 * 60_000);
    heartbeats.push(DAILY_METRICS_HEARTBEAT);
    stops.push(startDailyMetrics(cfg));
  } else {
    console.log(
      'dailyMetrics: timer disabled via DAILY_METRICS_ENABLED=false (manual POST /x/posts/reconcile still works)',
    );
  }
  // The voice library is a pure DOM-scrape swipe file now — no X-API author
  // pulls or metrics polling, so there are no voice workers to start.

  return {
    async stop() {
      await Promise.all(stops.map((s) => s()));
      for (const name of heartbeats) unregisterHeartbeat(name);
      setDefaultOnCost(null);
    },
  };
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is required`);
  return v;
}
