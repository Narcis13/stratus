import { describe, expect, test } from 'bun:test';
import { buildAuthorizeUrl, generatePkcePair } from './x/auth.ts';
import { containsUrl } from './x/endpoints.ts';
import { XApiError, classify } from './x/errors.ts';
import { defaultPostParams } from './x/fields.ts';
import { priceFor } from './x/pricing.ts';
import { nextPollDelay } from './x/workers/metricsPoll.ts';
import { nextVoicePollDelay } from './x/workers/voiceMetricsPoll.ts';

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

describe('pricing.priceFor', () => {
  test('POST /2/tweets is the $0.015 base (URL surcharge handled at call site)', () => {
    expect(priceFor('/2/tweets', 'POST', 201, null)).toBe(0.015);
  });

  test('DELETE /2/tweets/:id is $0.010', () => {
    expect(priceFor('/2/tweets/1234567890', 'DELETE', 200, null)).toBe(0.01);
  });

  test('GET /2/users/me is an owned read at $0.001', () => {
    expect(priceFor('/2/users/me', 'GET', 200, null)).toBe(0.001);
  });

  test('GET /2/tweets/:id prices as other-user $0.005 (conservative)', () => {
    expect(priceFor('/2/tweets/abc', 'GET', 200, null)).toBe(0.005);
  });

  test('search/recent multiplies $0.005 by item count', () => {
    expect(priceFor('/2/tweets/search/recent', 'GET', 200, 10)).toBeCloseTo(0.05, 5);
  });

  test('search/recent with unknown items defaults to one result (undercount)', () => {
    expect(priceFor('/2/tweets/search/recent', 'GET', 200, null)).toBe(0.005);
  });

  test('query string is stripped before matching', () => {
    expect(priceFor('/2/users/me?user.fields=id', 'GET', 200, null)).toBe(0.001);
  });

  test('4xx returns 0 — X does not bill failed client requests', () => {
    expect(priceFor('/2/tweets', 'POST', 403, null)).toBe(0);
    expect(priceFor('/2/tweets/abc', 'GET', 429, null)).toBe(0);
  });

  test('unknown endpoint returns 0 (visible gap, not fabricated number)', () => {
    expect(priceFor('/2/something/new', 'GET', 200, null)).toBe(0);
  });
});

describe('metricsPoll cadence', () => {
  const MIN = 60_000;
  const HOUR = 60 * MIN;
  const DAY = 24 * HOUR;

  test('0–30 min → +5 min', () => {
    expect(nextPollDelay(0)).toBe(5 * MIN);
    expect(nextPollDelay(29 * MIN)).toBe(5 * MIN);
  });

  test('30 min boundary flips to +15 min', () => {
    expect(nextPollDelay(30 * MIN)).toBe(15 * MIN);
    expect(nextPollDelay(5 * HOUR)).toBe(15 * MIN);
  });

  test('6 h – 48 h → +1 h', () => {
    expect(nextPollDelay(6 * HOUR)).toBe(HOUR);
    expect(nextPollDelay(47 * HOUR)).toBe(HOUR);
  });

  test('2 d – 7 d → +6 h', () => {
    expect(nextPollDelay(2 * DAY)).toBe(6 * HOUR);
    expect(nextPollDelay(6 * DAY)).toBe(6 * HOUR);
  });

  test('7 d – 30 d → +24 h', () => {
    expect(nextPollDelay(7 * DAY)).toBe(DAY);
    expect(nextPollDelay(29 * DAY)).toBe(DAY);
  });

  test('≥ 30 d → retired (null)', () => {
    expect(nextPollDelay(30 * DAY)).toBeNull();
    expect(nextPollDelay(60 * DAY)).toBeNull();
  });
});

describe('voiceMetricsPoll cadence', () => {
  const MIN = 60_000;
  const HOUR = 60 * MIN;
  const DAY = 24 * HOUR;

  test('0–6 h → +1 h', () => {
    expect(nextVoicePollDelay(0)).toBe(HOUR);
    expect(nextVoicePollDelay(5 * HOUR + 59 * MIN)).toBe(HOUR);
  });

  test('6 h boundary flips to +6 h', () => {
    expect(nextVoicePollDelay(6 * HOUR)).toBe(6 * HOUR);
    expect(nextVoicePollDelay(47 * HOUR)).toBe(6 * HOUR);
  });

  test('2 d – 7 d → +24 h', () => {
    expect(nextVoicePollDelay(2 * DAY)).toBe(DAY);
    expect(nextVoicePollDelay(7 * DAY - MIN)).toBe(DAY);
  });

  test('≥ 7 d → retired (null)', () => {
    expect(nextVoicePollDelay(7 * DAY)).toBeNull();
    expect(nextVoicePollDelay(30 * DAY)).toBeNull();
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
