// SURFACES-PLAN S2 — the MCP mount. Platform-agnostic transport bridge that
// turns `POST /mcp` into a stateless Model Context Protocol server, so Claude
// Code (or any MCP client) can interrogate the whole X operation with:
//   claude mcp add --transport http stratus https://<host>/mcp \
//     --header "Authorization: Bearer $STRATUS_TOKEN"
//
// Stateless is correct here: every tool is a cheap local read (or a $0 draft
// write), so there is no session to hold. We build a fresh McpServer +
// transport per request (no `sessionIdGenerator` → stateless mode).
//
// We use the SDK's WebStandardStreamableHTTPServerTransport, which speaks web
// Request→Response directly — a clean fit for Hono on Bun, no Node req/res
// shim. (The plan sketched the older fetch-to-node bridge; this SDK version
// ships a first-class web-standard transport that avoids that shim and the
// Bun stream-adapter pitfalls entirely.)
//
// Tool registration is per-platform: `registerXTools` lives under src/x/. A
// future src/linkedin/mcp.ts would export `registerLinkedinTools` and get added
// to this same mount here — the bridge itself stays platform-agnostic.
//
// app.ts applies the existing bearer middleware to `/mcp` BEFORE calling
// mountMcp, so an unauthenticated request never reaches a tool.

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { Context, Hono } from 'hono';
import { registerXTools } from './x/index.ts';

const SERVER_INFO = { name: 'stratus', version: '0.1.1' } as const;

function jsonRpcError(code: number, message: string) {
  return { jsonrpc: '2.0' as const, error: { code, message }, id: null };
}

export function mountMcp(app: Hono): void {
  app.post('/mcp', async (c) => {
    // The caller already passed the bearer guard; forward that exact credential
    // so the in-process route calls the curated tools make authenticate too.
    const authHeader = c.req.header('Authorization') ?? '';

    const server = new McpServer(SERVER_INFO);
    registerXTools(server, app, authHeader);

    // Stateless: OMIT sessionIdGenerator (absent ≡ stateless mode at runtime;
    // under exactOptionalPropertyTypes an explicit `undefined` isn't allowed for
    // the `() => string` field). enableJsonResponse: a single JSON reply instead
    // of an SSE stream — our tools return immediately, nothing streams.
    const transport = new WebStandardStreamableHTTPServerTransport({ enableJsonResponse: true });

    // Cast: the SDK's transport class isn't structurally assignable to its own
    // Transport interface under exactOptionalPropertyTypes (optional onclose) —
    // a type-declaration strictness quirk, not a runtime one.
    await server.connect(transport as Transport);

    const response = await transport.handleRequest(c.req.raw);

    // Stateless + JSON response: the body is fully materialized, so buffer it,
    // release the per-request server/transport, and hand back an identical reply.
    const body = await response.text();
    void transport.close();
    void server.close();
    return new Response(body, { status: response.status, headers: response.headers });
  });

  // Stateless: there is no SSE stream to open (GET) and no session to terminate
  // (DELETE). Answer both with a JSON-RPC "method not allowed" at HTTP 405.
  const methodNotAllowed = (c: Context) => c.json(jsonRpcError(-32000, 'Method not allowed.'), 405);
  app.get('/mcp', methodNotAllowed);
  app.delete('/mcp', methodNotAllowed);
}
