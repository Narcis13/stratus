// Conversations & open loops (CIRCLES-PLAN C2): pure thread grouping over the
// union of my published posts and their mentions, keyed by conversation_id.
// No conversation table — these functions recompute threads on every read from
// rows the daily pass already fills; conversation_meta only adds Slack-style
// read state (last_read_at / snoozed_until / muted). Route: routes/conversations.ts.

export type ThreadItem =
  | {
      kind: 'inbound';
      tweetId: string;
      text: string;
      postedAt: Date;
      authorUsername: string | null;
      authorName: string | null;
      status: string;
      inReplyToTweetId: string | null;
    }
  | {
      kind: 'outbound';
      tweetId: string;
      text: string;
      postedAt: Date;
      isReply: boolean;
    };

export interface InboundInput {
  tweetId: string;
  conversationId: string | null;
  authorUsername: string | null;
  authorName: string | null;
  text: string;
  postedAt: Date;
  inReplyToTweetId: string | null;
  status: string; // unanswered | answered | dismissed
}

export interface OutboundInput {
  tweetId: string;
  conversationId: string | null;
  text: string;
  postedAt: Date;
  isReply: boolean;
}

export interface ThreadMetaInput {
  conversationId: string;
  snoozedUntil: Date | null;
  lastReadAt: Date | null;
  muted: boolean;
}

export interface ConversationThread {
  conversationId: string;
  items: ThreadItem[];
  lastActivityAt: Date;
  /** Latest inbound author — the human on the other side of the exchange. */
  counterpartHandle: string | null;
  counterpartName: string | null;
  inboundCount: number;
  outboundCount: number;
  /** The last word is theirs: an unanswered inbound with none of my posts after it. */
  openLoop: boolean;
  /** Oldest unanswered inbound after my last outbound — the age of the debt. */
  owedSince: Date | null;
  /** Open loop where the owed inbound replies to MY REPLY — the 75x moment. */
  chain: boolean;
  unread: boolean;
  snoozedUntil: Date | null;
  /** snoozedUntil is still in the future (relative to `now`). */
  snoozed: boolean;
  muted: boolean;
}

/** A mention with no conversation_id still deserves a thread — its own tweet id
 *  is the (stable) fallback key, shared with conversation_meta rows. */
export function threadKeyFor(m: { conversationId: string | null; tweetId: string }): string {
  return m.conversationId ?? m.tweetId;
}

// Snowflake ids sort numerically; postedAt ties (same-second exchanges) break on id.
function itemOrder(a: ThreadItem, b: ThreadItem): number {
  const dt = a.postedAt.getTime() - b.postedAt.getTime();
  if (dt !== 0) return dt;
  return a.tweetId.length !== b.tweetId.length
    ? a.tweetId.length - b.tweetId.length
    : a.tweetId.localeCompare(b.tweetId);
}

export function buildThreads(
  inbound: InboundInput[],
  outbound: OutboundInput[],
  metas: ThreadMetaInput[],
  opts: { now: Date; myReplyIds?: Set<string> },
): ConversationThread[] {
  const myReplyIds = opts.myReplyIds ?? new Set<string>();
  const nowMs = opts.now.getTime();

  // Threads exist only where at least one mention landed — my posts nobody
  // engaged with are the calendar's business, not the inbox's.
  const byKey = new Map<string, { inbound: InboundInput[]; outbound: OutboundInput[] }>();
  for (const m of inbound) {
    const key = threadKeyFor(m);
    const t = byKey.get(key) ?? { inbound: [], outbound: [] };
    t.inbound.push(m);
    byKey.set(key, t);
  }
  for (const p of outbound) {
    if (p.conversationId === null) continue;
    const t = byKey.get(p.conversationId);
    if (t) t.outbound.push(p);
  }

  const metaByKey = new Map(metas.map((m) => [m.conversationId, m]));

  const threads: ConversationThread[] = [];
  for (const [key, group] of byKey) {
    const items: ThreadItem[] = [
      ...group.inbound.map(
        (m): ThreadItem => ({
          kind: 'inbound',
          tweetId: m.tweetId,
          text: m.text,
          postedAt: m.postedAt,
          authorUsername: m.authorUsername,
          authorName: m.authorName,
          status: m.status,
          inReplyToTweetId: m.inReplyToTweetId,
        }),
      ),
      ...group.outbound.map(
        (p): ThreadItem => ({
          kind: 'outbound',
          tweetId: p.tweetId,
          text: p.text,
          postedAt: p.postedAt,
          isReply: p.isReply,
        }),
      ),
    ].sort(itemOrder);

    const lastActivityAt = items[items.length - 1]?.postedAt as Date;

    const lastOutboundMs = group.outbound.reduce(
      (max, p) => Math.max(max, p.postedAt.getTime()),
      0,
    );
    // "Yours is owed": unanswered inbound with no post of mine after it. A
    // mention marked answered/dismissed by hand is settled even before my
    // reply (if any) gets discovered.
    const owed = group.inbound
      .filter((m) => m.status === 'unanswered' && m.postedAt.getTime() > lastOutboundMs)
      .sort((a, b) => a.postedAt.getTime() - b.postedAt.getTime());
    const openLoop = owed.length > 0;

    // In-thread reply ids back up the caller's set — a my-reply row whose
    // conversation_id discovery hasn't filled yet is still catchable via ids.
    const threadReplyIds = new Set(group.outbound.filter((p) => p.isReply).map((p) => p.tweetId));
    const chain =
      openLoop &&
      owed.some(
        (m) =>
          m.inReplyToTweetId !== null &&
          (myReplyIds.has(m.inReplyToTweetId) || threadReplyIds.has(m.inReplyToTweetId)),
      );

    const latestInbound = group.inbound.reduce((best, m) =>
      m.postedAt.getTime() > best.postedAt.getTime() ? m : best,
    );

    const meta = metaByKey.get(key) ?? null;
    const snoozedUntil = meta?.snoozedUntil ?? null;

    threads.push({
      conversationId: key,
      items,
      lastActivityAt,
      counterpartHandle: latestInbound.authorUsername,
      counterpartName: latestInbound.authorName,
      inboundCount: group.inbound.length,
      outboundCount: group.outbound.length,
      openLoop,
      owedSince: owed[0]?.postedAt ?? null,
      chain,
      unread: lastActivityAt.getTime() > (meta?.lastReadAt?.getTime() ?? 0),
      snoozedUntil,
      snoozed: snoozedUntil !== null && snoozedUntil.getTime() > nowMs,
      muted: meta?.muted ?? false,
    });
  }

  return rankThreads(threads);
}

/** A thread the user snoozed or muted isn't debt right now. */
export function isActionable(t: ConversationThread): boolean {
  return t.openLoop && !t.snoozed && !t.muted;
}

// Chain open loops first (that's the multiplier moment), then plain open loops
// — both oldest-debt-first — then settled threads by latest activity. Snoozed/
// muted threads sink to the settled section regardless of their loop state.
export function rankThreads(threads: ConversationThread[]): ConversationThread[] {
  const tier = (t: ConversationThread): number => {
    if (!isActionable(t)) return 2;
    return t.chain ? 0 : 1;
  };
  return [...threads].sort((a, b) => {
    const dt = tier(a) - tier(b);
    if (dt !== 0) return dt;
    if (tier(a) < 2) {
      return (a.owedSince?.getTime() ?? 0) - (b.owedSince?.getTime() ?? 0);
    }
    return b.lastActivityAt.getTime() - a.lastActivityAt.getTime();
  });
}
