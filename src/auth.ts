// OAuth 2.0 PKCE for X API v2.
// Flow:
//   1. generatePkcePair() → store verifier, send user to buildAuthorizeUrl()
//   2. user redirected back with ?code → exchangeCodeForTokens(code, verifier)
//   3. before each API call, refreshIfExpired() rotates if <60s to expiry
//
// CRITICAL: X rotates the refresh token on every refresh. If you lose the new
// refresh token between issuance and persistence, the user is locked out
// permanently. Always persist BEFORE returning the new access token.

const X_AUTHORIZE_URL = 'https://x.com/i/oauth2/authorize';
const X_TOKEN_URL = 'https://api.x.com/2/oauth2/token';
const X_REVOKE_URL = 'https://api.x.com/2/oauth2/revoke';

// Request all up-front. `offline.access` is mandatory — without it, no refresh
// token, and the user re-auths every 2 hours.
export const SCOPES = [
  'tweet.read',
  'tweet.write',
  'tweet.moderate.write',
  'users.read',
  'follows.read',
  'mute.read',
  'like.read',
  'like.write',
  'bookmark.read',
  'media.write',
  'offline.access',
] as const;

export const SCOPE_STRING = SCOPES.join(' ');

export interface PkcePair {
  codeVerifier: string;
  codeChallenge: string;
}

export interface TokenSet {
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // epoch ms
  scope: string;
}

interface XTokenResponse {
  access_token: string;
  refresh_token: string;
  token_type: 'bearer';
  expires_in: number;
  scope: string;
}

/** RFC 7636 PKCE pair. Verifier 43–128 chars; challenge = base64url(sha256(verifier)). */
export async function generatePkcePair(): Promise<PkcePair> {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const codeVerifier = base64url(bytes);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(codeVerifier));
  const codeChallenge = base64url(new Uint8Array(digest));
  return { codeVerifier, codeChallenge };
}

export function buildAuthorizeUrl(args: {
  clientId: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
}): string {
  const url = new URL(X_AUTHORIZE_URL);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', args.clientId);
  url.searchParams.set('redirect_uri', args.redirectUri);
  url.searchParams.set('scope', SCOPE_STRING);
  url.searchParams.set('state', args.state);
  url.searchParams.set('code_challenge', args.codeChallenge);
  url.searchParams.set('code_challenge_method', 'S256');
  return url.toString();
}

/** Exchange the authorization code for tokens. Must happen within 30 seconds of the redirect. */
export async function exchangeCodeForTokens(args: {
  clientId: string;
  clientSecret: string;
  code: string;
  redirectUri: string;
  codeVerifier: string;
}): Promise<TokenSet> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: args.code,
    redirect_uri: args.redirectUri,
    code_verifier: args.codeVerifier,
    client_id: args.clientId,
  });
  return postToken(body, basicAuth(args.clientId, args.clientSecret));
}

/** Refresh tokens. The returned set has a NEW refresh_token — persist it. */
export async function refreshTokens(args: {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}): Promise<TokenSet> {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: args.refreshToken,
    client_id: args.clientId,
  });
  return postToken(body, basicAuth(args.clientId, args.clientSecret));
}

export async function revokeToken(args: {
  clientId: string;
  clientSecret: string;
  token: string;
  tokenTypeHint: 'access_token' | 'refresh_token';
}): Promise<void> {
  const body = new URLSearchParams({ token: args.token, token_type_hint: args.tokenTypeHint });
  const res = await fetch(X_REVOKE_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      authorization: basicAuth(args.clientId, args.clientSecret),
    },
    body,
  });
  if (!res.ok) throw new Error(`revoke failed: ${res.status} ${await res.text()}`);
}

async function postToken(body: URLSearchParams, authHeader: string): Promise<TokenSet> {
  const res = await fetch(X_TOKEN_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      authorization: authHeader,
    },
    body,
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`token endpoint failed: ${res.status} ${detail}`);
  }
  const json = (await res.json()) as XTokenResponse;
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    expiresAt: Date.now() + json.expires_in * 1000,
    scope: json.scope,
  };
}

function basicAuth(clientId: string, clientSecret: string): string {
  return `Basic ${btoa(`${clientId}:${clientSecret}`)}`;
}

function base64url(buf: Uint8Array): string {
  let bin = '';
  for (const b of buf) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
