import { describe, expect, test } from 'bun:test';
import { containsUrl } from './x/endpoints.ts';
import { defaultPostParams } from './x/fields.ts';
import { XApiError, classify } from './x/errors.ts';
import { generatePkcePair, buildAuthorizeUrl } from './x/auth.ts';

describe('containsUrl', () => {
  test('flags http and https in any position', () => {
    expect(containsUrl('check this https://x.com/y')).toBe(true);
    expect(containsUrl('http://x.com is the link')).toBe(true);
    expect(containsUrl('see HTTPS://x.com')).toBe(true);
  });

  test('does not flag plain text', () => {
    expect(containsUrl('no link here')).toBe(false);
    expect(containsUrl(undefined)).toBe(false);
  });
});

describe('defaultPostParams', () => {
  test('owned-private adds non_public_metrics', () => {
    const p = defaultPostParams({ ownedPrivate: true });
    expect(p['tweet.fields']).toContain('non_public_metrics');
    expect(p['tweet.fields']).toContain('organic_metrics');
  });

  test('default omits private metrics', () => {
    const p = defaultPostParams();
    expect(p['tweet.fields']).not.toContain('non_public_metrics');
  });
});

describe('errors.classify', () => {
  test('401 → auth_invalid', () => {
    const e = new XApiError({ status: 401, type: 'about:blank', detail: '', rawBody: null });
    expect(classify(e)).toBe('auth_invalid');
  });

  test('reply restriction by detail keyword', () => {
    const e = new XApiError({
      status: 403,
      type: 'https://api.x.com/2/problems/client-forbidden',
      detail: 'You are not permitted to reply',
      rawBody: null,
    });
    expect(classify(e)).toBe('reply_restriction');
  });

  test('duplicate content', () => {
    const e = new XApiError({
      status: 403,
      type: 'https://api.x.com/2/problems/client-forbidden',
      detail: 'Duplicate content',
      rawBody: null,
    });
    expect(classify(e)).toBe('duplicate_content');
  });

  test('5xx → server_error', () => {
    const e = new XApiError({ status: 503, type: 'about:blank', detail: '', rawBody: null });
    expect(classify(e)).toBe('server_error');
  });
});

describe('PKCE', () => {
  test('verifier is 43+ chars and challenge differs', async () => {
    const { codeVerifier, codeChallenge } = await generatePkcePair();
    expect(codeVerifier.length).toBeGreaterThanOrEqual(43);
    expect(codeChallenge).not.toBe(codeVerifier);
    expect(codeVerifier).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(codeChallenge).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  test('authorize URL has all required params', () => {
    const url = new URL(
      buildAuthorizeUrl({
        clientId: 'cid',
        redirectUri: 'http://127.0.0.1:3000/cb',
        state: 's',
        codeChallenge: 'cc',
      }),
    );
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('client_id')).toBe('cid');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('scope')).toContain('offline.access');
    expect(url.searchParams.get('scope')).toContain('tweet.write');
  });
});
