// Async iterator over X's `next_token` pagination.
//
// COST WARNING: `maxItems` is a JS-side trim, not a billing cap. X bills for
// every result it returns in the response body — the `for` loop breaking
// early does not unbill them. To control cost, the caller must also lower
// the per-request `max_results` (or equivalent) on the URL itself, not just
// rely on `maxItems` here. See `searchRecent` in endpoints.ts for the pattern.
//
// Hard caps you must respect (X plan §6.1):
//   /users/:id/tweets        3,200
//   /users/:id/mentions      800
//   /tweets/:id/retweeted_by 100 (no pagination beyond)
//   /tweets/:id/liking_users 100 (no pagination beyond)
//   /tweets/search/all       1 req/sec server-enforced — pass perPageSleepMs: 1100

export interface Page<T> {
  // Optional: X omits `data` on an empty result, returning only `meta`.
  data?: T[];
  meta?: { next_token?: string; result_count?: number };
}

export interface PaginateOptions {
  maxItems?: number;
  maxPages?: number;
  perPageSleepMs?: number;
}

export async function* paginate<T>(
  fetchPage: (nextToken: string | undefined) => Promise<Page<T>>,
  opts: PaginateOptions = {},
): AsyncIterable<T> {
  let nextToken: string | undefined;
  let pageCount = 0;
  let itemCount = 0;

  while (true) {
    if (opts.maxPages !== undefined && pageCount >= opts.maxPages) return;

    const page = await fetchPage(nextToken);
    pageCount++;

    // X omits `data` entirely on an empty result (e.g. a since_id pull with no
    // new tweets returns just `{ meta: { result_count: 0 } }`) — default to []
    // so the common "nothing new" case doesn't throw.
    for (const item of page.data ?? []) {
      yield item;
      itemCount++;
      if (opts.maxItems !== undefined && itemCount >= opts.maxItems) return;
    }

    nextToken = page.meta?.next_token;
    if (!nextToken) return;

    if (opts.perPageSleepMs && opts.perPageSleepMs > 0) {
      await new Promise((r) => setTimeout(r, opts.perPageSleepMs));
    }
  }
}
