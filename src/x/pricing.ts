// X price table (Apr 2026, USD). One switch keyed off (method, path).
//
// Add a branch when `endpoints.ts` grows a new wrapper — don't pre-stub the
// whole API surface. Anything we haven't mapped yet returns 0 so the cost row
// still lands (with a visible "$0 / unknown endpoint" we can grep later).
//
// `items` is the response item count for per-result endpoints (search, lists,
// batch lookups). xFetch threads it through from the response body, so a page
// of N results bills N× the per-result rate. It's `null` for single-object
// responses (priced as one unit).

const POST_CREATE_BASE = 0.015;
// URL surcharge ($0.20 vs $0.015) can't be inferred from the path alone.
// `createPost` already blocks URL writes unless `allowUrlSurcharge: true`,
// so opting in is a deliberate, observable choice — the cost row will read
// $0.015 even when the bill was actually $0.20. Wire body-aware pricing
// (or a `costHint` opt) when we start posting URLs in earnest.
const POST_DELETE = 0.01;
const OWNED_READ = 0.001;
const OTHER_READ = 0.005;
const SEARCH_PER_RESULT = 0.005;

export function priceFor(
  endpoint: string,
  method: string,
  status: number,
  items: number | null,
): number {
  // X doesn't bill 4xx (validation/auth/rate-limit) or our retried 5xx paths.
  if (status >= 400) return 0;

  const q = endpoint.indexOf('?');
  const path = q === -1 ? endpoint : endpoint.slice(0, q);
  const m = method.toUpperCase();

  if (m === 'POST' && path === '/2/tweets') return POST_CREATE_BASE;
  if (m === 'DELETE' && /^\/2\/tweets\/[^/]+$/.test(path)) return POST_DELETE;

  if (m === 'GET' && path === '/2/users/me') return OWNED_READ;

  // Own-timeline pull (`GET /2/users/:id/tweets`) and batch tweet lookup
  // (`GET /2/tweets?ids=`) are only ever called on the authenticated user's own
  // tweets — discovery + the daily metrics snapshot. Owned reads bill
  // $0.001/result; multiply by the response item count. We never read OTHER
  // users through these paths (the voice library is DOM-scraped, never API-read
  // — see CLAUDE.md), so the owned rate is correct, not optimistic.
  if (m === 'GET' && /^\/2\/users\/[^/]+\/tweets$/.test(path)) return OWNED_READ * (items ?? 1);
  if (m === 'GET' && path === '/2/tweets') return OWNED_READ * (items ?? 1);

  // Single-tweet lookup: $0.001 owned vs $0.005 other-user — can't tell from
  // the path. Price as other-user (the conservative/upper bound) until a
  // call site tells us it's owned.
  if (m === 'GET' && /^\/2\/tweets\/[^/]+$/.test(path)) return OTHER_READ;

  if (m === 'GET' && path === '/2/tweets/search/recent') {
    return SEARCH_PER_RESULT * (items ?? 1);
  }

  return 0;
}
