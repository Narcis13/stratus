// The "cursor already blinking" hand-off. Taking a drafted reply in the side
// panel (a Radar angle, the Replies editor) copies the text and opens the
// tweet in a NEW TAB — an anchor's default, so the panel never owns that tab.
// Without this the human lands on the status page and still has to click the
// composer before ⌘V.
//
// So the panel drops a one-shot request in chrome.storage.local keyed by tweet
// id, and the content script on whichever tab shows that status page claims it
// (removes the key) and focuses X's reply box. Storage rather than a message
// because the tab doesn't exist yet at click time.
//
// One-shot + TTL on purpose: a stale request must never steal focus on some
// unrelated later visit to the same tweet, and stealing focus is exactly the
// kind of thing that is invisible when it works and infuriating when it
// misfires. This module is the pure core; the chrome plumbing lives in
// sidepanel/Radar.tsx + sidepanel/Replies.tsx (writers) and content.ts (reader).

export const REPLY_FOCUS_KEY = 'replyMaster:focusReply';

/** How long a request stays claimable. Long enough for a cold tab + X's own
 *  render, short enough that a tab opened and abandoned goes stale. */
export const REPLY_FOCUS_TTL_MS = 120_000;

export interface ReplyFocusRequest {
  tweetId: string;
  /** epoch ms, stamped at click time */
  at: number;
}

export function isReplyFocusRequest(v: unknown): v is ReplyFocusRequest {
  if (!v || typeof v !== 'object') return false;
  const r = v as Record<string, unknown>;
  return typeof r.tweetId === 'string' && r.tweetId !== '' && typeof r.at === 'number';
}

export function makeReplyFocusRequest(tweetId: string, now: number): ReplyFocusRequest {
  return { tweetId, at: now };
}

/** Panel side: ask whichever tab lands on `tweetId` to focus its composer.
 *  Best-effort — a failed write only costs the human one click. */
export async function requestReplyFocus(tweetId: string): Promise<void> {
  try {
    await chrome.storage.local.set({
      [REPLY_FOCUS_KEY]: makeReplyFocusRequest(tweetId, Date.now()),
    });
  } catch (err) {
    console.warn('[stratus] reply focus request failed', err);
  }
}

/** Does this stored value ask THIS page to focus its composer? */
export function shouldFocusReply(
  stored: unknown,
  focusedTweetId: string | null,
  now: number,
): boolean {
  if (focusedTweetId === null) return false;
  if (!isReplyFocusRequest(stored)) return false;
  if (stored.tweetId !== focusedTweetId) return false;
  return now - stored.at >= 0 && now - stored.at <= REPLY_FOCUS_TTL_MS;
}
