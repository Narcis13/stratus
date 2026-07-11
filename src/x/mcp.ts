// SURFACES-PLAN S2 — MCP tools for the X platform slice. `registerXTools`
// attaches every X tool to a fresh (stateless) McpServer; the transport bridge
// that turns HTTP into a server instance lives in the platform-agnostic
// ../mcp.ts so a future src/linkedin/mcp.ts adds its own tools to the SAME
// mount. Per-platform isolation holds: nothing X-specific leaks into the bridge.
//
// Three tiers, all $0 by construction:
//   Schema  — x_list_tables / x_describe_table / x_query hit the S1 read-only
//             { readonly: true } connection directly (tokens-blind, row-capped).
//   Curated — each tool calls the existing /x (or /cost) route IN-PROCESS via
//             app.request with the caller's bearer, so the routes stay the one
//             source of truth and every route improvement is inherited free.
//   Write   — deliberately tiny and never X-billed: add an idea, a person note,
//             or a DRAFT post. A draft never reaches the publisher/createPost;
//             only the human promotes draft → pending.

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Hono } from 'hono';
import { z } from 'zod';
import { InspectError, describeTable, listTables, runSelect } from './data/inspect.ts';

type ToolResult = {
  content: { type: 'text'; text: string }[];
  isError?: boolean;
};

function ok(data: unknown): ToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
}

function err(data: unknown): ToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }], isError: true };
}

/** Wrap a synchronous read-only-core call, mapping InspectError → an error result
 *  (the model sees the code, e.g. `tokens_forbidden`, instead of a thrown 500). */
function tryCore(fn: () => unknown): ToolResult {
  try {
    return ok(fn());
  } catch (e) {
    if (e instanceof InspectError) return err({ error: e.code });
    throw e;
  }
}

/** Call a stratus route in-process, carrying the MCP caller's bearer so the
 *  route's own auth passes. Returns the parsed JSON body (or raw text) plus
 *  whether the route answered 2xx. */
async function callRoute(
  app: Hono,
  authHeader: string,
  path: string,
  init?: { method?: string; body?: unknown },
): Promise<ToolResult> {
  const headers: Record<string, string> = { authorization: authHeader };
  const reqInit: { method?: string; headers: Record<string, string>; body?: string } = { headers };
  if (init?.method) reqInit.method = init.method;
  if (init?.body !== undefined) {
    headers['content-type'] = 'application/json';
    reqInit.body = JSON.stringify(init.body);
  }
  const res = await app.request(path, reqInit);
  const text = await res.text();
  let body: unknown = text;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    /* non-JSON (shouldn't happen for our routes) — keep the raw text */
  }
  return res.ok ? ok(body) : err({ status: res.status, body });
}

// Optional integer query param → `?key=value` (empty when absent). Encodes the
// value so it's URL-safe.
function qp(key: string, value: number | undefined): string {
  return value === undefined ? '' : `?${key}=${encodeURIComponent(String(value))}`;
}

export function registerXTools(server: McpServer, app: Hono, authHeader: string): void {
  const route = (path: string, init?: { method?: string; body?: unknown }): Promise<ToolResult> =>
    callRoute(app, authHeader, path, init);

  // ------------------------------------------------------------- Schema tier

  server.registerTool(
    'x_list_tables',
    {
      title: 'List DB tables',
      description:
        'List every stratus SQLite table with its row count and columns. Free, local, read-only (the secret `tokens` table is never exposed). Start here to learn the schema, then use x_query.',
      inputSchema: {},
    },
    async () => tryCore(() => ({ tables: listTables() })),
  );

  server.registerTool(
    'x_describe_table',
    {
      title: 'Describe a DB table',
      description:
        'Columns (name, type, nullability, primary-key) and row count for one table. Free, local, read-only.',
      inputSchema: { table: z.string().describe('Table name, as returned by x_list_tables') },
    },
    async ({ table }) => tryCore(() => describeTable(table)),
  );

  server.registerTool(
    'x_query',
    {
      title: 'Run a read-only SQL query',
      description:
        'Run a single SELECT (or WITH…SELECT) over the stratus SQLite state and get up to 500 rows back. Free, local, read-only — anything but a SELECT is rejected, and the `tokens` table is off-limits. This is the most powerful tool: e.g. "which reply angle earned the most profile clicks this month?"',
      inputSchema: {
        sql: z
          .string()
          .describe('A single SELECT / WITH statement. No writes, no PRAGMA, no ATTACH.'),
      },
    },
    async ({ sql }) => tryCore(() => runSelect(sql)),
  );

  // ------------------------------------------------------------ Curated tier
  // Each forwards to an existing route; the route is the single source of truth.

  server.registerTool(
    'x_brief',
    {
      title: 'Daily brief',
      description:
        'The growth-coach daily brief: follower count + delta, yesterday’s posts/replies with metrics, today’s scheduled slots and cadence gaps, reply quota, spend. Free, local read (no X API cost).',
      inputSchema: {
        tzOffsetMin: z
          .number()
          .int()
          .optional()
          .describe(
            'JS getTimezoneOffset() minutes; day boundaries in your local day. Default UTC.',
          ),
      },
    },
    async ({ tzOffsetMin }) => route(`/x/brief${qp('tzOffsetMin', tzOffsetMin)}`),
  );

  server.registerTool(
    'x_playbook',
    {
      title: 'The Playbook',
      description:
        'Measured, gated effectiveness: angle × author-size, pillar × register, structures, band calibration, batch-vs-single, relationship lift, media/latency/roster/idea payoff. Cells below the sample gate read "insufficient data". Free, local read.',
      inputSchema: {
        minN: z
          .number()
          .int()
          .min(1)
          .optional()
          .describe(
            'Override the per-cell minimum sample (default 20). Lower to explore thin data.',
          ),
      },
    },
    async ({ minN }) => route(`/x/playbook${qp('minN', minN)}`),
  );

  server.registerTool(
    'x_person',
    {
      title: 'Person dossier',
      description:
        'Full dossier for one handle: relationship stage, interaction timeline, my replies with measured outcomes, per-angle crosstab, their mentions of me, saved tweets, follower series. Free, local read.',
      inputSchema: {
        handle: z.string().describe('X handle, with or without a leading @.'),
      },
    },
    async ({ handle }) => route(`/x/people/${encodeURIComponent(handle.replace(/^@/, ''))}`),
  );

  server.registerTool(
    'x_followups',
    {
      title: 'Follow-up queue',
      description:
        'The "do next" queue: live reply-chains, DM-ready relationships, neglected targets/allies, momentum risers, plus the best self-quote re-up candidate. Free, local read.',
      inputSchema: {},
    },
    async () => route('/x/people/followups'),
  );

  server.registerTool(
    'x_conversations',
    {
      title: 'Conversations & open loops',
      description:
        'The mention inbox as threads — open loops (they spoke last, I owe a reply) ranked to the top, chains flagged (they replied to my reply). Free, local read.',
      inputSchema: {},
    },
    async () => route('/x/conversations'),
  );

  server.registerTool(
    'x_metrics_account',
    {
      title: 'Account KPI series',
      description:
        'The follower/following/tweet/listed count series from the daily getMe snapshots, with per-day deltas. Free, local read.',
      inputSchema: {
        days: z
          .number()
          .int()
          .min(1)
          .optional()
          .describe('Trailing window hint (the route currently returns the full series).'),
      },
    },
    async ({ days }) => route(`/x/metrics/account${qp('days', days)}`),
  );

  server.registerTool(
    'x_best_times',
    {
      title: 'Best times to post',
      description:
        'Weekday × hour cells ranked by age-normalized views, gated at a minimum sample. Free, local read.',
      inputSchema: {
        minN: z
          .number()
          .int()
          .min(1)
          .optional()
          .describe('Minimum posts per cell to advise (default 3).'),
        tzOffsetMin: z
          .number()
          .int()
          .optional()
          .describe(
            'JS getTimezoneOffset() minutes; buckets by your local wall clock. Default UTC.',
          ),
      },
    },
    async ({ minN, tzOffsetMin }) => {
      const parts: string[] = [];
      if (minN !== undefined) parts.push(`minN=${encodeURIComponent(String(minN))}`);
      if (tzOffsetMin !== undefined)
        parts.push(`tzOffsetMin=${encodeURIComponent(String(tzOffsetMin))}`);
      return route(`/x/metrics/best-times${parts.length ? `?${parts.join('&')}` : ''}`);
    },
  );

  server.registerTool(
    'x_cost',
    {
      title: 'Spend dashboard',
      description:
        'Daily API spend, zero-filled, per platform (X + Grok), for the trailing window. This reports past cost — it spends nothing. Free, local read.',
      inputSchema: {
        days: z
          .number()
          .int()
          .min(1)
          .max(90)
          .optional()
          .describe('Trailing UTC days (default 30, max 90).'),
      },
    },
    async ({ days }) => route(`/cost/daily${qp('days', days)}`),
  );

  server.registerTool(
    'x_search_voice',
    {
      title: 'Search the voice library',
      description:
        'Substring-search the $0 DOM-scraped swipe file of other authors’ saved tweets. Free, local read.',
      inputSchema: {
        q: z.string().describe('Substring to match against saved tweet text.'),
      },
    },
    async ({ q }) => route(`/x/voice/tweets?q=${encodeURIComponent(q)}`),
  );

  server.registerTool(
    'x_digest',
    {
      title: 'Weekly digest',
      description:
        'The Monday-week digest facts (and, if already generated, the narrative): follower delta, top tweets, stage transitions, top fans, neglected relationships, spend, quest days. Free, local read of already-billed data.',
      inputSchema: {
        week: z
          .string()
          .optional()
          .describe('Week key YYYY-MM-DD (a Monday). Omit for the current week.'),
        tzOffsetMin: z
          .number()
          .int()
          .optional()
          .describe('JS getTimezoneOffset() minutes. Default UTC.'),
      },
    },
    async ({ week, tzOffsetMin }) => {
      const parts: string[] = [];
      if (week !== undefined) parts.push(`week=${encodeURIComponent(week)}`);
      if (tzOffsetMin !== undefined)
        parts.push(`tzOffsetMin=${encodeURIComponent(String(tzOffsetMin))}`);
      // factsOnly so the MCP read never triggers the (Grok-billed) narration.
      parts.push('factsOnly=true');
      return route(`/x/digest?${parts.join('&')}`);
    },
  );

  // -------------------------------------------------------------- Write tier
  // Tiny, never X-billed. The write ceiling is a DRAFT calendar row — MCP can
  // propose, only the human promotes it to `pending`.

  server.registerTool(
    'x_add_idea',
    {
      title: 'Add an idea',
      description:
        'Capture an idea into the Idea Inbox for a future post or reply. Free, local write (no X/Grok cost).',
      inputSchema: {
        text: z.string().min(1).describe('The idea, in any language.'),
        tags: z.array(z.string()).optional().describe('Optional tags.'),
      },
    },
    async ({ text, tags }) => {
      const body: Record<string, unknown> = { text };
      if (tags !== undefined) body.tags = tags;
      return route('/x/ideas', { method: 'POST', body });
    },
  );

  server.registerTool(
    'x_add_person_note',
    {
      title: 'Add a person note',
      description:
        'Log a manual note on a person’s dossier timeline. Creates the person if unknown. Free, local write.',
      inputSchema: {
        handle: z.string().describe('X handle, with or without a leading @.'),
        text: z.string().min(1).describe('The note.'),
      },
    },
    async ({ handle, text }) =>
      route(`/x/people/${encodeURIComponent(handle.replace(/^@/, ''))}/events`, {
        method: 'POST',
        body: { type: 'note', summary: text },
      }),
  );

  server.registerTool(
    'x_draft_post',
    {
      title: 'Draft a post',
      description:
        'Create a calendar post as a DRAFT — visible in the Composer, NOT scheduled. It can never publish on its own; only the human promotes a draft to `pending`. Free, local write (no X API cost). Provide scheduledFor only as a suggested time carried on the draft.',
      inputSchema: {
        text: z
          .string()
          .min(1)
          .describe('The post text. A URL is allowed in a draft (re-checked at promotion).'),
        pillar: z
          .string()
          .optional()
          .describe(
            'Optional content-pillar slug (see x_query on content_pillars). Invalid slugs are rejected.',
          ),
        scheduledFor: z
          .string()
          .optional()
          .describe(
            'Optional ISO timestamp carried on the draft as a suggested slot; the draft still stays a draft.',
          ),
      },
    },
    async ({ text, pillar, scheduledFor }) => {
      // status is HARD-CODED to 'draft' — the schema exposes no status field, so
      // a caller can never request 'pending' and reach the publisher/createPost.
      const body: Record<string, unknown> = { text, status: 'draft' };
      if (pillar !== undefined) body.pillar = pillar;
      if (scheduledFor !== undefined) body.scheduledFor = scheduledFor;
      return route('/x/posts/scheduled', { method: 'POST', body });
    },
  );
}
