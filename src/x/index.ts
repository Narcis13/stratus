// Public surface of the X platform slice. `app.ts` is the only outside caller —
// it wires routes via `mountX(app)` and starts in-process workers via
// `startXWorkers()`. Nothing else should import from inside `src/x/`.

import type { Hono } from 'hono';
import { registerHeartbeat, unregisterHeartbeat } from '../heartbeats.ts';
import { llmConfigured } from '../llm/index.ts';
// S2: the X platform's MCP tools. Re-exported so the platform-agnostic MCP
// bridge (src/mcp.ts) reaches them through this public surface, not a deep
// import — same discipline as mountX/startXWorkers.
export { registerXTools } from './mcp.ts';
import { makeOnCost } from '../middleware/costTracker.ts';
import { setDefaultOnCost } from './client.ts';
import { analyticsRouter } from './routes/analytics.ts';
import { assets } from './routes/assets.ts';
import { brief } from './routes/brief.ts';
import { calendar } from './routes/calendar.ts';
import { channelsRouter } from './routes/channels.ts';
import { conversations } from './routes/conversations.ts';
import { data, explorer } from './routes/data.ts';
import { digest } from './routes/digest.ts';
import { dmsRouter } from './routes/dms.ts';
import { drafter } from './routes/drafter.ts';
import { followingRouter } from './routes/following.ts';
import { followups } from './routes/followups.ts';
import { goalsRouter } from './routes/goals.ts';
import { harvest } from './routes/harvest.ts';
import { ideasRouter } from './routes/ideas.ts';
import { images } from './routes/images.ts';
import { launch } from './routes/launch.ts';
import { me } from './routes/me.ts';
import { createMentionsRouter } from './routes/mentions.ts';
import { metrics } from './routes/metrics.ts';
import { monitorRouter } from './routes/monitor.ts';
import { nicheRouter } from './routes/niche.ts';
import { peopleRouter } from './routes/people.ts';
import { pillars } from './routes/pillars.ts';
import { playbook } from './routes/playbook.ts';
import { createPostsRouter } from './routes/posts.ts';
import { promptsRouter } from './routes/prompts.ts';
import { radar } from './routes/radar.ts';
import { replies } from './routes/replies.ts';
import { replyListsRouter } from './routes/replyLists.ts';
import { settingsRouter } from './routes/settings.ts';
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
  // A3.2: audience Active-times captures — $0 DOM-scraped presence data from
  // X Analytics, stored append-only. Always mounted (no X call, no LLM);
  // static path only, so §7.20 can't bite.
  app.route('/x', analyticsRouter);
  app.route('/x', pillars);
  // AI.4: the prompt editor — CRUD over `prompt_overrides` (the editable half of
  // the AI.3 registry). Always mounted: editing a prompt must work with no LLM
  // key. Static `/prompts/*` paths (the `restore-defaults` static path and the
  // `:key/reset` param path don't collide — different segment counts, §7.20).
  app.route('/x', promptsRouter);
  // N0: niche CRUD + activation ratchet. Always mounted, $0. Static paths plus a
  // `/niches/:slug` param that shadows nothing (no other route lives under niche*).
  app.route('/x', nicheRouter);
  // M1: the Me / My Profile personal-context layer. Always mounted, $0 (pure
  // SQL — no Grok, no X). `/x/me` is a static prefix; its only params are on
  // `/me/entries/:id` + `/me/goals/:id`, shadowing nothing (§7.20).
  app.route('/x', me);
  app.route('/x', createPostsRouter(cfg));
  app.route('/x', createVoiceRouter());
  app.route('/x', harvest);
  // GR: the following ledger — who I follow / who follows back, from one DOM
  // scrape of my own /following page. Always mounted, $0: nothing in the file
  // can reach the X API, and unfollowing stays a manual act in the X app.
  // `/following/queue` (GR.3) registers above `/following/:handle` (§7.20).
  app.route('/x', followingRouter);
  // GR: the activity monitor — read-time rules over posts/replies/following/
  // calendar rows that flag the patterns X's spam heuristics punish. Always
  // mounted, $0 (no X call, no LLM), static path only. Advisory by design:
  // it never blocks a post, a reply or an unfollow.
  app.route('/x', monitorRouter);
  // GR.7: goals + daily commitments. Always mounted, $0. The goals themselves
  // are written through `/x/me/goals` (D4 — one table, one writer); this router
  // owns the pacing view, the lazy achieved/missed flip and the commitments.
  app.route('/x', goalsRouter);
  // C0: radar draft reads/status flips are $0 and mount without an LLM key;
  // only the insert path (generate-batch, below) needs a configured provider.
  app.route('/x', radar);
  // C6: Idea Inbox — pure SQL, always mounted; consumption happens inside the
  // Grok-gated draft routes, but capture/list/reopen must work without the key.
  app.route('/x', ideasRouter);
  // RL: reply lists — premade canned replies. CRUD (and later /use) are pure SQL
  // and always mounted; only /generate (RL.4) needs an LLM and checks at runtime.
  app.route('/x', replyListsRouter);
  // C8: channels — topic rooms as saved views over tags, pure SQL, always $0.
  app.route('/x', channelsRouter);
  // S4: Studio asset library (composed PNGs + AI backgrounds as SQLite BLOBs),
  // always mounted, $0. The image GENERATION route is Grok-gated below.
  app.route('/x', assets);
  // S1: read-only data explorer API over the SQLite state — { readonly: true }
  // connection, always mounted, $0. The explorer UI shell is served at the root
  // path GET /explorer (data-free, public — every fetch it makes needs the
  // bearer), so it sits OUTSIDE the /x/* auth middleware.
  app.route('/x', data);
  app.route('/', explorer);
  // UI.1: the settings platform — app_settings overrides + typed registry.
  // Static paths only (/settings, /settings/values, /settings/reset), so it's
  // §7.20-safe anywhere; always mounted, $0. Lands INERT — no consumer reads the
  // store yet (UI.2+ wire brief/quests/people/… through it).
  app.route('/x', settingsRouter);
  // C5: follow-up queue + Top Fans. MUST mount before peopleRouter —
  // 'followups'/'fans' are valid usernames, so GET /people/:handle would
  // otherwise swallow these static paths as dossier lookups.
  app.route('/x', followups);
  // C1: the people layer — pure SQL over already-collected data, always $0.
  app.route('/x', peopleRouter);
  // A3.9: DM drafts — list/patch are pure SQL and always mounted; only
  // POST /dms/draft spends (one Grok call, LLM-gated at runtime). Mounted after
  // peopleRouter — it imports loadIcebreakerGrounding from it and shares the
  // grounding refusal ladder (decision 8).
  app.route('/x', dmsRouter);
  // C7: Launch Room early-replier ingest — DOM-scraped, people+events only, $0.
  app.route('/x', launch);
  // C2: threaded inbox — groups mentions + my posts by conversation_id, $0.
  app.route('/x', conversations);
  // C9: Sunday Digest — facts are $0 SQL; the one weekly narration checks for
  // an LLM provider at runtime (AI.6) and degrades to facts-only without one.
  app.route('/x', digest);
  // C4: the Playbook — pure SQL over measured outcomes, $0; only its
  // extract-winners POST needs an LLM and it checks llmConfigured() at runtime.
  app.route('/x', playbook);
  app.route('/x', createMentionsRouter(cfg));
  // S4: image generation is always mounted; POST /x/images/generate checks the
  // XAI key at runtime (503 without it) — images stay xAI-only (Decision 6).
  app.route('/x', images);
  // LLM-backed (AI.6): mount when EITHER provider is configured (Grok or
  // OpenRouter); refuse to mount when neither is — askLLM enforces the resolved
  // provider's key per request.
  if (llmConfigured()) {
    app.route('/x', replies);
    app.route('/x', drafter);
    app.route('/x', voiceExtract);
  } else {
    console.log(
      'x/replies: no LLM provider configured (set XAI_API_KEY or OPENROUTER_API_KEY) — /x/replies/*, /x/posts/draft and /x/voice/*/extract not mounted',
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
