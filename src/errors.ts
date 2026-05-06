// Errors returned by X API v2 use RFC 7807 problem-details JSON.
// `type` is a URI like `https://api.x.com/2/problems/...` — that's our routing key.

export class XApiError extends Error {
  readonly status: number;
  readonly type: string;
  readonly detail: string;
  readonly rawBody: unknown;
  readonly requestId: string | undefined;

  constructor(args: {
    status: number;
    type: string;
    detail: string;
    rawBody: unknown;
    requestId?: string | undefined;
  }) {
    super(`[${args.status}] ${args.type}: ${args.detail}`);
    this.name = 'XApiError';
    this.status = args.status;
    this.type = args.type;
    this.detail = args.detail;
    this.rawBody = args.rawBody;
    this.requestId = args.requestId;
  }
}

export type ErrorClass =
  | 'auth_invalid' // 401 — refresh once then surface
  | 'duplicate_content' // already posted; treat as silent success
  | 'reply_restriction' // Feb 2026 programmatic-reply policy
  | 'user_suspended'
  | 'rate_limited' // honor x-rate-limit-reset
  | 'usage_capped' // 2M post-reads/month account cap
  | 'scope_or_permission'
  | 'server_error'
  | 'unknown';

export function classify(err: XApiError): ErrorClass {
  if (err.status === 401) return 'auth_invalid';
  if (err.type.includes('client-forbidden') && /duplicate/i.test(err.detail)) return 'duplicate_content';
  if (err.type.includes('client-forbidden') && /not permitted/i.test(err.detail)) return 'reply_restriction';
  if (err.type.includes('client-forbidden') && /user-suspended/i.test(err.detail)) return 'user_suspended';
  if (err.type.includes('rate-limit-exceeded')) return 'rate_limited';
  if (err.type.includes('usage-capped')) return 'usage_capped';
  if (err.type.includes('not-authorized-for-resource')) return 'scope_or_permission';
  if (err.status >= 500) return 'server_error';
  return 'unknown';
}

/**
 * Parse an error response from X into a typed XApiError.
 * X returns either RFC 7807 problem-details on top-level or a `{errors: [...]}` array.
 */
export async function fromResponse(res: Response): Promise<XApiError> {
  const requestId = res.headers.get('x-request-id') ?? undefined;
  let raw: unknown;
  try {
    raw = await res.json();
  } catch {
    raw = await res.text().catch(() => '');
  }
  const body = raw as { type?: string; detail?: string; title?: string; errors?: Array<{ message?: string }> };
  const type = body?.type ?? 'about:blank';
  const detail = body?.detail ?? body?.title ?? body?.errors?.[0]?.message ?? res.statusText;
  return new XApiError({ status: res.status, type, detail, rawBody: raw, requestId });
}
