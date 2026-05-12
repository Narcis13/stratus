// Content script for x.com / twitter.com — injects a "Save to stratus" button
// onto each tweet's action row, and harvests tweet content from the DOM.
//
// On a tweet-detail page (/<user>/status/<id>), clicking the button on the
// focused tweet sends the original *plus* up to 10 surrounding tweets
// (parents above, replies below) in one shot. DOM-scraping the replies
// avoids ~$0.005 per other-user read at the API layer.
//
// X is a heavy SPA: tweets are virtualised in/out of the DOM as you scroll
// and the action row is rebuilt frequently. We watch the whole document with
// one MutationObserver and dedupe per action-row element via a WeakSet.
//
// The server endpoint POST /x/voice/scrape is the next Phase 5 bullet — until
// it lands, clicks will surface "Failed: http_404"; the payload shape here is
// what that route will accept.

import type { ApiRequest, ApiResponse } from './shared/messages.ts';
import type { PostContext, ReplyDraft, TopComment } from './shared/types.ts';

const BUTTON_CLASS = 'stratus-save-btn';
const REPLY_BTN_CLASS = 'stratus-reply-master-btn';
const STYLE_ID = 'stratus-save-style';
const STATUS_PERSIST_MS = 2500;
const REPLY_HARVEST_KEY = 'replyHarvestLimit';
const REPLY_HARVEST_DEFAULT = 0;
const REPLY_HARVEST_MAX = 10;
const REPLY_MASTER_STORAGE_KEY = 'replyMaster:lastDraft';
const REPLY_SYSTEM_PROMPT_KEY = 'replyMaster:systemPromptOverride';
const REPLY_TOP_COMMENTS_MAX = 10;
const REPLY_BTN_LABEL = '🪄 Reply Master';

const handled = new WeakSet<Element>();
const replyMasterHandled = new WeakSet<Element>();

// Mirrors the side panel's setting (chrome.storage.local key
// `replyHarvestLimit`). 0 = save the focused tweet only; up to 10 captures
// the surrounding parents/replies on a tweet-detail page.
let replyHarvestLimit = REPLY_HARVEST_DEFAULT;

function clampReplyLimit(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return REPLY_HARVEST_DEFAULT;
  const n = Math.floor(value);
  if (n < 0) return 0;
  if (n > REPLY_HARVEST_MAX) return REPLY_HARVEST_MAX;
  return n;
}

interface ScrapedTweet {
  tweetId: string;
  username: string;
  displayName: string | null;
  text: string;
  createdAt: string | null;
  url: string;
}

interface ScrapeBody {
  original: ScrapedTweet;
  replies: ScrapedTweet[];
}

function injectStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    .${BUTTON_CLASS} {
      all: unset;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      box-sizing: border-box;
      cursor: pointer;
      font: 600 12px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
      letter-spacing: 0.02em;
      padding: 4px 10px;
      border-radius: 9999px;
      color: rgb(113, 118, 123);
      border: 1px solid rgba(113, 118, 123, 0.4);
      background: transparent;
      margin-left: 6px;
      transition: color 120ms, border-color 120ms, background 120ms;
    }
    .${BUTTON_CLASS}:hover {
      color: rgb(29, 155, 240);
      border-color: rgb(29, 155, 240);
      background: rgba(29, 155, 240, 0.1);
    }
    .${BUTTON_CLASS}[data-state="saving"] {
      color: rgb(113, 118, 123);
      border-color: rgba(113, 118, 123, 0.4);
      cursor: progress;
    }
    .${BUTTON_CLASS}[data-state="saved"] {
      color: rgb(0, 186, 124);
      border-color: rgb(0, 186, 124);
      background: rgba(0, 186, 124, 0.12);
    }
    .${BUTTON_CLASS}[data-state="failed"] {
      color: rgb(244, 33, 46);
      border-color: rgb(244, 33, 46);
      background: rgba(244, 33, 46, 0.12);
    }
    .${REPLY_BTN_CLASS} {
      all: unset;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      box-sizing: border-box;
      cursor: pointer;
      font: 600 12px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
      letter-spacing: 0.02em;
      padding: 4px 10px;
      border-radius: 9999px;
      color: rgb(170, 100, 220);
      border: 1px solid rgba(170, 100, 220, 0.5);
      background: transparent;
      margin-left: 6px;
      transition: color 120ms, border-color 120ms, background 120ms;
    }
    .${REPLY_BTN_CLASS}:hover {
      color: rgb(192, 132, 232);
      border-color: rgb(192, 132, 232);
      background: rgba(170, 100, 220, 0.12);
    }
    .${REPLY_BTN_CLASS}[data-state="working"] {
      color: rgb(113, 118, 123);
      border-color: rgba(113, 118, 123, 0.4);
      cursor: progress;
    }
    .${REPLY_BTN_CLASS}[data-state="done"] {
      color: rgb(0, 186, 124);
      border-color: rgb(0, 186, 124);
      background: rgba(0, 186, 124, 0.12);
    }
    .${REPLY_BTN_CLASS}[data-state="failed"] {
      color: rgb(244, 33, 46);
      border-color: rgb(244, 33, 46);
      background: rgba(244, 33, 46, 0.12);
    }
  `;
  document.head.appendChild(style);
}

function focusedTweetIdFromUrl(): string | null {
  const m = location.pathname.match(/^\/[^/]+\/status\/(\d+)/);
  return m && m[1] ? m[1] : null;
}

function parseStatusHref(href: string): { username: string; tweetId: string } | null {
  // The first /status/ link in DOM order is the outer tweet's timestamp link.
  // Quote-tweet previews are nested as `div role="link"`, not `article`, so
  // their /status/ links sit *after* the outer tweet's permalink.
  const m = href.match(/^\/([^/]+)\/status\/(\d+)/);
  if (!m || !m[1] || !m[2]) return null;
  return { username: m[1], tweetId: m[2] };
}

function findPermalink(
  article: Element,
): { username: string; tweetId: string; url: string } | null {
  const link = article.querySelector<HTMLAnchorElement>('a[href*="/status/"]');
  if (!link) return null;
  const parsed = parseStatusHref(link.pathname);
  if (!parsed) return null;
  return {
    ...parsed,
    url: `https://x.com/${parsed.username}/status/${parsed.tweetId}`,
  };
}

function scrapeTweet(article: Element): ScrapedTweet | null {
  const permalink = findPermalink(article);
  if (!permalink) return null;

  // querySelector returns the *first* match in DOM order, which is the outer
  // tweet's content — quote-tweet previews are nested below it.
  const textEl = article.querySelector('[data-testid="tweetText"]');
  const text = textEl?.textContent?.trim() ?? '';

  const userNameEl = article.querySelector('[data-testid="User-Name"]');
  const nameLink = userNameEl?.querySelector<HTMLAnchorElement>('a');
  const displayName = nameLink?.textContent?.trim() || null;

  const timeEl = article.querySelector('time');
  const createdAt = timeEl?.getAttribute('datetime') || null;

  return {
    tweetId: permalink.tweetId,
    username: permalink.username,
    displayName,
    text,
    createdAt,
    url: permalink.url,
  };
}

function harvestReplies(
  focusedArticle: Element,
  focusedTweetId: string,
  limit: number,
): ScrapedTweet[] {
  // Walk *all* tweet articles in DOM order, skipping the focused one. This
  // captures parent tweets shown above the focused tweet (when it's itself a
  // reply) plus the replies shown below — both useful conversational context.
  const out: ScrapedTweet[] = [];
  if (limit <= 0) return out;
  const articles = document.querySelectorAll<HTMLElement>('article[data-testid="tweet"]');
  for (const a of articles) {
    if (a === focusedArticle) continue;
    const r = scrapeTweet(a);
    if (!r) continue;
    if (r.tweetId === focusedTweetId) continue;
    out.push(r);
    if (out.length >= limit) break;
  }
  return out;
}

function setState(
  btn: HTMLButtonElement,
  state: 'idle' | 'saving' | 'saved' | 'failed',
  label: string,
): void {
  btn.dataset.state = state;
  btn.textContent = label;
}

function scheduleReset(btn: HTMLButtonElement): void {
  setTimeout(() => {
    if (btn.isConnected) setState(btn, 'idle', 'Save to stratus');
  }, STATUS_PERSIST_MS);
}

// X renders action-row aria-label like "12 replies, 5 reposts, 100 likes, 2,345 views, ..."
// Pull each metric independently — order isn't guaranteed across locales/A-B tests.
function parseMetricsLabel(label: string): PostContext['metrics'] {
  const n = (re: RegExp): number => {
    const m = label.match(re);
    if (!m || !m[1]) return 0;
    const v = Number(m[1].replace(/[,.\s]/g, ''));
    return Number.isFinite(v) ? v : 0;
  };
  return {
    replies: n(/([\d.,]+)\s+repl/i),
    reposts: n(/([\d.,]+)\s+repost/i),
    likes: n(/([\d.,]+)\s+like/i),
    views: n(/([\d.,]+)\s+view/i),
  };
}

function scrapeTopComment(article: Element, focusedTweetId: string): TopComment | null {
  const permalink = findPermalink(article);
  if (!permalink) return null;
  if (permalink.tweetId === focusedTweetId) return null;
  const text = article.querySelector('[data-testid="tweetText"]')?.textContent?.trim() ?? '';
  if (text === '') return null;
  const userNameEl = article.querySelector('[data-testid="User-Name"]');
  const author = userNameEl?.querySelector<HTMLAnchorElement>('a')?.textContent?.trim() ?? '';
  return {
    author: author || permalink.username,
    handle: `@${permalink.username}`,
    text,
  };
}

function scrapePostContext(focusedArticle: Element, focusedTweetId: string): PostContext | null {
  const permalink = findPermalink(focusedArticle);
  if (!permalink || permalink.tweetId !== focusedTweetId) return null;

  const text = focusedArticle.querySelector('[data-testid="tweetText"]')?.textContent?.trim() ?? '';
  const userNameEl = focusedArticle.querySelector('[data-testid="User-Name"]');
  const author =
    userNameEl?.querySelector<HTMLAnchorElement>('a')?.textContent?.trim() || permalink.username;

  const timeEl = focusedArticle.querySelector('time');
  // Server validates postedAt as Date-parseable; fall back to now if X hasn't
  // rendered the timestamp (rare on a focused tweet, but possible mid-hydration).
  const postedAt = timeEl?.getAttribute('datetime') || new Date().toISOString();

  // Action row of the focused article — the aria-label carries the metric blob.
  const reply = focusedArticle.querySelector('[data-testid="reply"]');
  const actionRow = reply?.closest('div[role="group"]');
  const ariaLabel = actionRow?.getAttribute('aria-label') ?? '';
  const metrics = parseMetricsLabel(ariaLabel);

  const topComments: TopComment[] = [];
  const articles = document.querySelectorAll<HTMLElement>('article[data-testid="tweet"]');
  for (const a of articles) {
    if (a === focusedArticle) continue;
    const c = scrapeTopComment(a, focusedTweetId);
    if (!c) continue;
    topComments.push(c);
    if (topComments.length >= REPLY_TOP_COMMENTS_MAX) break;
  }

  return {
    tweetId: focusedTweetId,
    handle: permalink.username,
    author,
    text,
    url: permalink.url,
    postedAt,
    metrics,
    topComments,
  };
}

function setReplyState(
  btn: HTMLButtonElement,
  state: 'idle' | 'working' | 'done' | 'failed',
  label: string,
): void {
  btn.dataset.state = state;
  btn.textContent = label;
}

function scheduleReplyReset(btn: HTMLButtonElement): void {
  setTimeout(() => {
    if (btn.isConnected) setReplyState(btn, 'idle', REPLY_BTN_LABEL);
  }, STATUS_PERSIST_MS);
}

async function onReplyMasterClick(btn: HTMLButtonElement): Promise<void> {
  if (btn.dataset.state === 'working') return;

  const focusedId = focusedTweetIdFromUrl();
  if (!focusedId) {
    setReplyState(btn, 'failed', 'Failed: not_status_page');
    scheduleReplyReset(btn);
    return;
  }
  const article = btn.closest<HTMLElement>('article[data-testid="tweet"]');
  if (!article) {
    setReplyState(btn, 'failed', 'Failed: detached');
    scheduleReplyReset(btn);
    return;
  }

  const ctx = scrapePostContext(article, focusedId);
  if (!ctx) {
    setReplyState(btn, 'failed', 'Failed: scrape_failed');
    scheduleReplyReset(btn);
    return;
  }

  setReplyState(btn, 'working', 'Drafting…');

  // Read the side panel's persisted system-prompt override fresh on every
  // click — cheap, and avoids stale state if the user just tweaked it.
  let systemPromptOverride: string | undefined;
  try {
    const out = await chrome.storage.local.get(REPLY_SYSTEM_PROMPT_KEY);
    const v = out[REPLY_SYSTEM_PROMPT_KEY];
    if (typeof v === 'string' && v.trim() !== '') systemPromptOverride = v;
  } catch (err) {
    console.warn('[stratus] reply master read override failed', err);
  }

  const request: ApiRequest = {
    type: 'stratus/api',
    method: 'POST',
    path: '/x/replies/generate',
    body: systemPromptOverride ? { context: ctx, systemPromptOverride } : { context: ctx },
  };

  let res: ApiResponse<ReplyDraft> | undefined;
  try {
    res = (await chrome.runtime.sendMessage(request)) as ApiResponse<ReplyDraft> | undefined;
  } catch (err) {
    console.error('[stratus] reply master sendMessage failed', err);
  }

  if (!res || !res.ok) {
    const code = res && !res.ok ? res.code : 'no_response';
    setReplyState(btn, 'failed', `Failed: ${code}`);
    scheduleReplyReset(btn);
    return;
  }

  const draft = res.data;
  const replyText = draft.replyTextEdited ?? draft.replyText;

  // Clipboard first — fails quietly past the user-activation window on some
  // builds; storage write below is what the side panel observes.
  let copied = true;
  try {
    await navigator.clipboard.writeText(replyText);
  } catch (err) {
    copied = false;
    console.warn('[stratus] clipboard write failed', err);
  }

  try {
    await chrome.storage.local.set({ [REPLY_MASTER_STORAGE_KEY]: draft });
  } catch (err) {
    console.warn('[stratus] storage.set lastDraft failed', err);
  }

  setReplyState(btn, 'done', copied ? 'Copied ✓' : 'Drafted (copy manually)');
  scheduleReplyReset(btn);
}

function attachReplyMasterButton(article: Element, focusedTweetId: string): void {
  const reply = article.querySelector('[data-testid="reply"]');
  if (!reply) return;
  const actionRow = reply.closest('div[role="group"]');
  if (!actionRow || replyMasterHandled.has(actionRow)) return;

  const permalink = findPermalink(article);
  if (!permalink || permalink.tweetId !== focusedTweetId) return;

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = REPLY_BTN_CLASS;
  btn.title = 'Generate a Grok-assisted reply, copy to clipboard';
  setReplyState(btn, 'idle', REPLY_BTN_LABEL);
  btn.addEventListener('click', (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    void onReplyMasterClick(btn);
  });

  actionRow.appendChild(btn);
  replyMasterHandled.add(actionRow);
}

async function onSaveClick(btn: HTMLButtonElement): Promise<void> {
  if (btn.dataset.state === 'saving') return;

  // Resolve the article fresh at click time — X recycles DOM nodes as you
  // scroll, so the action row our button lives in may now belong to a
  // different tweet than when we attached.
  const article = btn.closest<HTMLElement>('article[data-testid="tweet"]');
  if (!article) {
    setState(btn, 'failed', 'Failed: detached');
    scheduleReset(btn);
    return;
  }

  const original = scrapeTweet(article);
  if (!original) {
    setState(btn, 'failed', 'Failed: no_permalink');
    scheduleReset(btn);
    return;
  }

  setState(btn, 'saving', 'Saving…');

  const focusedId = focusedTweetIdFromUrl();
  const replies =
    focusedId && focusedId === original.tweetId
      ? harvestReplies(article, original.tweetId, replyHarvestLimit)
      : [];

  const body: ScrapeBody = { original, replies };
  const request: ApiRequest = {
    type: 'stratus/api',
    method: 'POST',
    path: '/x/voice/scrape',
    body,
  };

  let res: ApiResponse | undefined;
  try {
    res = (await chrome.runtime.sendMessage(request)) as ApiResponse | undefined;
  } catch (err) {
    console.error('[stratus] sendMessage failed', err);
  }

  if (res?.ok) {
    const label = replies.length > 0 ? `Saved thread (${replies.length + 1})` : 'Saved';
    setState(btn, 'saved', label);
  } else {
    const code = res && !res.ok ? res.code : 'no_response';
    setState(btn, 'failed', `Failed: ${code}`);
    console.warn('[stratus] save failed', code);
  }
  scheduleReset(btn);
}

function attachButton(article: Element): void {
  // Find the real action row by anchoring on the reply button. This skips
  // poll widgets and quote-tweet previews (which lack a reply button).
  const reply = article.querySelector('[data-testid="reply"]');
  if (!reply) return;
  const actionRow = reply.closest('div[role="group"]');
  if (!actionRow || handled.has(actionRow)) return;

  if (!findPermalink(article)) return;

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = BUTTON_CLASS;
  btn.title = 'Save to stratus voice library (whole thread on a status page)';
  setState(btn, 'idle', 'Save to stratus');
  btn.addEventListener('click', (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    void onSaveClick(btn);
  });

  actionRow.appendChild(btn);
  handled.add(actionRow);
}

function scan(root: ParentNode): void {
  const focusedId = focusedTweetIdFromUrl();
  for (const article of root.querySelectorAll('article[data-testid="tweet"]')) {
    attachButton(article);
    if (focusedId) attachReplyMasterButton(article, focusedId);
  }
}

let scheduled = false;
function scheduleScan(): void {
  if (scheduled) return;
  scheduled = true;
  // requestAnimationFrame coalesces mutation bursts — X emits hundreds of
  // subtree mutations per scroll tick.
  requestAnimationFrame(() => {
    scheduled = false;
    scan(document);
  });
}

function loadReplyHarvestLimit(): void {
  chrome.storage.local.get(REPLY_HARVEST_KEY, (out) => {
    replyHarvestLimit = clampReplyLimit(out[REPLY_HARVEST_KEY]);
  });
}

function start(): void {
  injectStyles();
  loadReplyHarvestLimit();
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    const change = changes[REPLY_HARVEST_KEY];
    if (!change) return;
    replyHarvestLimit = clampReplyLimit(change.newValue);
  });
  scan(document);
  const observer = new MutationObserver(scheduleScan);
  observer.observe(document.body, { childList: true, subtree: true });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', start, { once: true });
} else {
  start();
}
