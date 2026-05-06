// Async iterator over X's `next_token` pagination.
// Hard caps you must respect (X plan §6.1):
//   /users/:id/tweets        3,200
//   /users/:id/mentions      800
//   /tweets/:id/retweeted_by 100 (no pagination beyond)
//   /tweets/:id/liking_users 100 (no pagination beyond)
//   /tweets/search/all       1 req/sec server-enforced — pass perPageSleepMs: 1100

export interface Page<T> {
  data: T[];
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

    for (const item of page.data) {
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
