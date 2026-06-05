// xFetch — the one place all X API calls go through.
// Adds: bearer auth, retry on 429/5xx, error parsing, optional cost log.

import { XApiError, fromResponse } from './errors.ts';

const X_API_BASE = 'https://api.x.com';

export interface FetchOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown; // serialized as JSON
  /** Bearer token — either OAuth 2.0 user token or app-only Bearer. */
  token: string;
  /** Max retry attempts on 429/5xx/network. Default 4. */
  maxAttempts?: number;
  /** Optional logger; called once per call regardless of retries. */
  onCost?: (info: CostInfo) => void;
  signal?: AbortSignal;
}

export interface CostInfo {
  endpoint: string;
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  status: number;
  /** Results X returned in the body — drives per-result billing (invariant #5). */
  items: number | null;
  durationMs: number;
  attempts: number;
  rateLimitRemaining: number | null;
  rateLimitResetAt: number | null;
}

// Module-level fallback so every X call gets logged without each endpoint
// wrapper having to thread `onCost` through. `app.ts` installs this once at
// boot via `startXWorkers()`. Per-call `opts.onCost` still wins.
let defaultOnCost: ((info: CostInfo) => void) | null = null;
export function setDefaultOnCost(fn: ((info: CostInfo) => void) | null): void {
  defaultOnCost = fn;
}

/**
 * Call any X API endpoint. Pass the path starting with `/2/...`.
 *
 * Retries 429 (honoring x-rate-limit-reset), 5xx, and network errors.
 * Throws XApiError on 4xx that aren't retried.
 */
export async function xFetch<T>(endpoint: string, opts: FetchOptions): Promise<T> {
  const url = buildUrl(endpoint, opts.query);
  const maxAttempts = opts.maxAttempts ?? 4;
  const method = opts.method ?? 'GET';
  const start = performance.now();
  const onCost = opts.onCost ?? defaultOnCost;

  let attempt = 0;
  let lastErr: unknown;
  while (attempt < maxAttempts) {
    attempt++;
    try {
      const init: RequestInit = {
        method,
        headers: {
          authorization: `Bearer ${opts.token}`,
          'content-type': 'application/json',
          accept: 'application/json',
        },
      };
      if (opts.body !== undefined) init.body = JSON.stringify(opts.body);
      if (opts.signal) init.signal = opts.signal;
      const res = await fetch(url, init);

      const remaining = numHeader(res.headers, 'x-rate-limit-remaining');
      const resetAt = numHeader(res.headers, 'x-rate-limit-reset');

      if (res.ok) {
        const data = (await res.json()) as T;
        onCost?.({
          endpoint,
          method,
          status: res.status,
          items: itemCount(data),
          durationMs: performance.now() - start,
          attempts: attempt,
          rateLimitRemaining: remaining,
          rateLimitResetAt: resetAt,
        });
        return data;
      }

      const err = await fromResponse(res);

      if (shouldRetry(err) && attempt < maxAttempts) {
        await sleep(retryDelay(err, resetAt, attempt));
        continue;
      }

      onCost?.({
        endpoint,
        method,
        status: res.status,
        items: null,
        durationMs: performance.now() - start,
        attempts: attempt,
        rateLimitRemaining: remaining,
        rateLimitResetAt: resetAt,
      });
      throw err;
    } catch (err) {
      lastErr = err;
      if (err instanceof XApiError) throw err; // already non-retriable above
      if (attempt < maxAttempts) {
        await sleep(retryDelay(null, null, attempt));
        continue;
      }
      throw err;
    }
  }
  throw lastErr ?? new Error('xFetch: exhausted attempts');
}

function shouldRetry(err: XApiError): boolean {
  return err.status === 429 || (err.status >= 500 && err.status <= 504);
}

function retryDelay(err: XApiError | null, resetAt: number | null, attempt: number): number {
  if (err?.status === 429 && resetAt) {
    const waitMs = Math.max(0, resetAt * 1000 - Date.now()) + jitter();
    return Math.min(waitMs, 60_000);
  }
  // exponential 1s, 2s, 4s, 8s + jitter
  return Math.min(16_000, 1000 * 2 ** (attempt - 1)) + jitter();
}

function jitter(): number {
  return Math.floor(Math.random() * 500);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function numHeader(h: Headers, k: string): number | null {
  const v = h.get(k);
  return v == null ? null : Number.parseInt(v, 10);
}

// X list endpoints return `{ data: [...], meta: { result_count } }`; single-
// object endpoints return `{ data: {...} }`. Count results so per-result
// endpoints (search, own-timeline, batch lookup) bill by what X actually
// returned rather than as a single item — see invariant #5 in CLAUDE.md.
// `null` when there's nothing array-like, which prices as a single unit.
function itemCount(body: unknown): number | null {
  if (body == null || typeof body !== 'object') return null;
  const b = body as { data?: unknown; meta?: { result_count?: number } };
  if (Array.isArray(b.data)) return b.data.length;
  if (typeof b.meta?.result_count === 'number') return b.meta.result_count;
  return null;
}

function buildUrl(
  endpoint: string,
  query?: Record<string, string | number | boolean | undefined>,
): string {
  const url = new URL(endpoint, X_API_BASE);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    }
  }
  return url.toString();
}
