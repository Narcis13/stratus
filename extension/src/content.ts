// Content script for x.com / twitter.com.
//
// Two capture surfaces feed the stratus "voice library" swipe file — a pure
// DOM-scrape store (no X API, $0):
//
//   1. "Save to stratus" on each tweet's action row. Scrapes the tweet (text +
//      the tweetText element's innerHTML, so emoji and formatting survive as a
//      reusable format template) and, best-effort, triggers X's author hover
//      card to grab the author's bio / follower counts. POSTs to
//      /x/voice/scrape. If the hover card never appears we still save the tweet
//      with just handle + display name — the author can be enriched later.
//
//   2. "Save author to stratus" in the profile header (x.com/<handle>). Scrapes
//      the full header — display name, bio, followers, following, pinned tweet —
//      and PUTs to /x/voice/authors/:handle, stamping the author as enriched.
//
// X is a heavy SPA: tweets are virtualised in/out of the DOM and rows are
// rebuilt constantly. We watch the document with one MutationObserver and
// dedupe button injection per action-row element via a WeakSet.
//
// "Reply Master" (Grok-drafted replies) is a separate feature and untouched.

import type { ApiRequest, ApiResponse } from './shared/messages.ts';
import type {
  AuthorProfile,
  PostContext,
  ReplyDraft,
  ScrapeBody,
  ScrapedAuthor,
  ScrapedTweet,
  TopComment,
} from './shared/types.ts';

const BUTTON_CLASS = 'stratus-save-btn';
const REPLY_BTN_CLASS = 'stratus-reply-master-btn';
const AUTHOR_BTN_CLASS = 'stratus-save-author-btn';
const STYLE_ID = 'stratus-save-style';
const STATUS_PERSIST_MS = 2500;
const REPLY_MASTER_STORAGE_KEY = 'replyMaster:lastDraft';
const REPLY_SYSTEM_PROMPT_KEY = 'replyMaster:systemPromptOverride';
const REPLY_TOP_COMMENTS_MAX = 10;
const REPLY_BTN_LABEL = '🪄 Reply Master';
const SAVE_BTN_LABEL = 'Save to stratus';
const AUTHOR_BTN_LABEL = 'Save author to stratus';
// How long to wait for X's hover card to render after we synthesise a hover.
const HOVER_CARD_TIMEOUT_MS = 1500;
const HOVER_CARD_POLL_MS = 100;

// Profile URLs whose first path segment is a reserved app route, not a handle.
const RESERVED_HANDLES = new Set([
  'home',
  'explore',
  'notifications',
  'messages',
  'settings',
  'i',
  'search',
  'compose',
  'hashtag',
  'bookmarks',
  'lists',
  'communities',
  'jobs',
  'login',
  'about',
  'tos',
  'privacy',
  'intent',
  'share',
]);

const handled = new WeakSet<Element>();
const replyMasterHandled = new WeakSet<Element>();

interface ScrapeResult {
  username: string;
  tweetId: string;
  url: string;
}

function injectStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    .${BUTTON_CLASS}, .${AUTHOR_BTN_CLASS} {
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
    .${AUTHOR_BTN_CLASS} { font-size: 13px; padding: 6px 14px; }
    .${BUTTON_CLASS}:hover, .${AUTHOR_BTN_CLASS}:hover {
      color: rgb(29, 155, 240);
      border-color: rgb(29, 155, 240);
      background: rgba(29, 155, 240, 0.1);
    }
    .${BUTTON_CLASS}[data-state="saving"], .${AUTHOR_BTN_CLASS}[data-state="saving"] {
      color: rgb(113, 118, 123);
      border-color: rgba(113, 118, 123, 0.4);
      cursor: progress;
    }
    .${BUTTON_CLASS}[data-state="saved"], .${AUTHOR_BTN_CLASS}[data-state="saved"] {
      color: rgb(0, 186, 124);
      border-color: rgb(0, 186, 124);
      background: rgba(0, 186, 124, 0.12);
    }
    .${BUTTON_CLASS}[data-state="failed"], .${AUTHOR_BTN_CLASS}[data-state="failed"] {
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
  return m?.[1] ? m[1] : null;
}

function parseStatusHref(href: string): { username: string; tweetId: string } | null {
  const m = href.match(/^\/([^/]+)\/status\/(\d+)/);
  if (!m || !m[1] || !m[2]) return null;
  return { username: m[1], tweetId: m[2] };
}

function findPermalink(article: Element): ScrapeResult | null {
  const link = article.querySelector<HTMLAnchorElement>('a[href*="/status/"]');
  if (!link) return null;
  const parsed = parseStatusHref(link.pathname);
  if (!parsed) return null;
  return {
    ...parsed,
    url: `https://x.com/${parsed.username}/status/${parsed.tweetId}`,
  };
}

// --------------------------------------------------------------- tweet scrape

function scrapeTweet(article: Element): ScrapedTweet | null {
  const permalink = findPermalink(article);
  if (!permalink) return null;

  // querySelector returns the *first* match in DOM order, which is the outer
  // tweet's content — quote-tweet previews are nested below it.
  const textEl = article.querySelector('[data-testid="tweetText"]');
  const text = textEl?.textContent?.trim() ?? '';
  // innerHTML keeps emoji <img>, line breaks and links exactly as X rendered
  // them — the whole point of the swipe file (reuse as a format template).
  const html = textEl ? textEl.innerHTML : null;

  const userNameEl = article.querySelector('[data-testid="User-Name"]');
  const nameLink = userNameEl?.querySelector<HTMLAnchorElement>('a');
  const displayName = nameLink?.textContent?.trim() || null;

  const timeEl = article.querySelector('time');
  const createdAt = timeEl?.getAttribute('datetime') || null;

  return {
    tweetId: permalink.tweetId,
    handle: permalink.username,
    displayName,
    text,
    html,
    createdAt,
    url: permalink.url,
  };
}

// --------------------------------------------------------------- hover card

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// "1,234" / "1.2K" / "3M" → integer. Prefers an exact `title` attribute when X
// abbreviates the visible count.
function parseAbbrevCount(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const m = raw.replace(/[\s,]/g, '').match(/([\d.]+)\s*([KMB])?/i);
  if (!m || !m[1]) return null;
  let v = Number.parseFloat(m[1]);
  if (!Number.isFinite(v)) return null;
  const suffix = m[2]?.toUpperCase();
  if (suffix === 'K') v *= 1e3;
  else if (suffix === 'M') v *= 1e6;
  else if (suffix === 'B') v *= 1e9;
  return Math.round(v);
}

function readFollowCount(anchor: Element | null): number | null {
  if (!anchor) return null;
  const titled = anchor.querySelector('[title]')?.getAttribute('title');
  if (titled && /\d/.test(titled)) {
    const n = Number(titled.replace(/[^\d]/g, ''));
    if (Number.isFinite(n)) return n;
  }
  return parseAbbrevCount(anchor.textContent);
}

function readCountsFrom(root: ParentNode): { followers: number | null; following: number | null } {
  const following = readFollowCount(root.querySelector('a[href$="/following"]'));
  const followers = readFollowCount(
    root.querySelector('a[href$="/verified_followers"]') ??
      root.querySelector('a[href$="/followers"]'),
  );
  return { followers, following };
}

async function waitForHoverCard(handle: string): Promise<Element | null> {
  const want = `/${handle.toLowerCase()}`;
  const deadline = Date.now() + HOVER_CARD_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const card = document.querySelector('[data-testid="HoverCard"]');
    if (card) {
      // Confirm the card is for the author we hovered, not a leftover.
      const links = card.querySelectorAll<HTMLAnchorElement>('a[href^="/"]');
      for (const a of links) {
        if (a.pathname.toLowerCase() === want) return card;
      }
    }
    await sleep(HOVER_CARD_POLL_MS);
  }
  return null;
}

// Best-effort: synthesise a hover over the author's name link, wait for X to
// render its hover card, then read what it exposes. Returns null on timeout —
// the caller then saves the tweet without author enrichment.
async function scrapeAuthorFromHoverCard(
  article: Element,
  handle: string,
): Promise<ScrapedAuthor | null> {
  const userNameEl = article.querySelector('[data-testid="User-Name"]');
  const link = userNameEl?.querySelector<HTMLAnchorElement>('a');
  if (!link) return null;

  const fire = (type: string, Ctor: typeof MouseEvent | typeof PointerEvent): void => {
    link.dispatchEvent(new Ctor(type, { bubbles: true, cancelable: true, view: window }));
  };

  fire('pointerover', PointerEvent);
  fire('mouseover', MouseEvent);
  fire('pointerenter', PointerEvent);
  fire('mouseenter', MouseEvent);

  let card: Element | null;
  try {
    card = await waitForHoverCard(handle);
  } finally {
    fire('pointerout', PointerEvent);
    fire('mouseout', MouseEvent);
    fire('pointerleave', PointerEvent);
    fire('mouseleave', MouseEvent);
  }
  if (!card) return null;

  const nameEl = card.querySelector('[data-testid="User-Name"]');
  const displayName = nameEl?.querySelector<HTMLAnchorElement>('a')?.textContent?.trim() || null;
  const bio = card.querySelector('[data-testid="UserDescription"]')?.textContent?.trim() || null;
  const { followers, following } = readCountsFrom(card);

  if (displayName === null && bio === null && followers === null && following === null) {
    return null;
  }
  return {
    handle,
    displayName,
    bio,
    followersCount: followers,
    followingCount: following,
    xUserId: null,
  };
}

// --------------------------------------------------------------- save tweet

function setState(
  btn: HTMLButtonElement,
  state: 'idle' | 'saving' | 'saved' | 'failed',
  label: string,
): void {
  btn.dataset.state = state;
  btn.textContent = label;
}

function scheduleReset(btn: HTMLButtonElement, label: string): void {
  setTimeout(() => {
    if (btn.isConnected) setState(btn, 'idle', label);
  }, STATUS_PERSIST_MS);
}

async function onSaveClick(btn: HTMLButtonElement): Promise<void> {
  if (btn.dataset.state === 'saving') return;

  // Resolve the article fresh at click time — X recycles DOM nodes as you
  // scroll, so the action row our button lives in may now belong to a
  // different tweet than when we attached.
  const article = btn.closest<HTMLElement>('article[data-testid="tweet"]');
  if (!article) {
    setState(btn, 'failed', 'Failed: detached');
    scheduleReset(btn, SAVE_BTN_LABEL);
    return;
  }

  const tweet = scrapeTweet(article);
  if (!tweet) {
    setState(btn, 'failed', 'Failed: no_permalink');
    scheduleReset(btn, SAVE_BTN_LABEL);
    return;
  }

  setState(btn, 'saving', 'Saving…');

  // Best-effort author enrichment — never blocks the save on its own failure.
  let author: ScrapedAuthor | null = null;
  try {
    author = await scrapeAuthorFromHoverCard(article, tweet.handle);
  } catch (err) {
    console.warn('[stratus] hover-card scrape failed', err);
  }

  const body: ScrapeBody = author ? { tweet, author } : { tweet };
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
    setState(btn, 'saved', author ? 'Saved + author' : 'Saved');
  } else {
    const code = res && !res.ok ? res.code : 'no_response';
    setState(btn, 'failed', `Failed: ${code}`);
    console.warn('[stratus] save failed', code);
  }
  scheduleReset(btn, SAVE_BTN_LABEL);
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
  btn.title = 'Save this tweet to the stratus voice library';
  setState(btn, 'idle', SAVE_BTN_LABEL);
  btn.addEventListener('click', (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    void onSaveClick(btn);
  });

  actionRow.appendChild(btn);
  handled.add(actionRow);
}

// --------------------------------------------------------------- save author

function handleFromProfileUrl(): string | null {
  const seg = location.pathname.split('/').filter(Boolean);
  const h = seg[0];
  if (!h || !/^[A-Za-z0-9_]{1,15}$/.test(h)) return null;
  if (RESERVED_HANDLES.has(h.toLowerCase())) return null;
  // /<handle>/status/<id> is a tweet detail page, not a profile header.
  if (seg.length >= 2 && seg[1] === 'status') return null;
  return h;
}

function scrapePinned(handle: string): { id: string; text: string | null } | null {
  // The pinned tweet, when present, is the first article in the timeline and
  // carries a "Pinned" social-context label. A repost would be first instead,
  // so if the first labelled article isn't a pin we conclude there's none.
  const article = document.querySelector('article[data-testid="tweet"]');
  if (!article) return null;
  const sc =
    article.querySelector('[data-testid="socialContext"]')?.textContent?.toLowerCase() ?? '';
  if (!/pin|fixat|épingl|anclado|fijado|festgeh|gepin/.test(sc)) return null;
  const permalink = findPermalink(article);
  if (!permalink || permalink.username.toLowerCase() !== handle.toLowerCase()) return null;
  const text = article.querySelector('[data-testid="tweetText"]')?.textContent?.trim() || null;
  return { id: permalink.tweetId, text };
}

function scrapeProfileHeader(): { handle: string; profile: AuthorProfile } | null {
  const handle = handleFromProfileUrl();
  if (!handle) return null;

  const nameEl = document.querySelector('[data-testid="UserName"]');
  let displayName: string | null = null;
  if (nameEl) {
    const txt = nameEl.textContent ?? '';
    const at = txt.indexOf('@');
    displayName = (at > 0 ? txt.slice(0, at) : txt).trim() || null;
  }

  const bio =
    document.querySelector('[data-testid="UserDescription"]')?.textContent?.trim() || null;
  // Scope counts to the primary column so we don't read a stray hover card.
  const header = document.querySelector('[data-testid="primaryColumn"]') ?? document;
  const { followers, following } = readCountsFrom(header);
  const pinned = scrapePinned(handle);

  return {
    handle,
    profile: {
      displayName,
      bio,
      followersCount: followers,
      followingCount: following,
      pinnedTweetId: pinned?.id ?? null,
      pinnedTweetText: pinned?.text ?? null,
      profileUrl: `https://x.com/${handle}`,
    },
  };
}

async function onSaveAuthorClick(btn: HTMLButtonElement): Promise<void> {
  if (btn.dataset.state === 'saving') return;

  const scraped = scrapeProfileHeader();
  if (!scraped) {
    setState(btn, 'failed', 'Failed: no_profile');
    scheduleReset(btn, AUTHOR_BTN_LABEL);
    return;
  }

  setState(btn, 'saving', 'Saving…');

  const request: ApiRequest = {
    type: 'stratus/api',
    method: 'PUT',
    path: `/x/voice/authors/${scraped.handle.toLowerCase()}`,
    body: scraped.profile,
  };

  let res: ApiResponse | undefined;
  try {
    res = (await chrome.runtime.sendMessage(request)) as ApiResponse | undefined;
  } catch (err) {
    console.error('[stratus] save author sendMessage failed', err);
  }

  if (res?.ok) {
    setState(btn, 'saved', 'Author saved');
  } else {
    const code = res && !res.ok ? res.code : 'no_response';
    setState(btn, 'failed', `Failed: ${code}`);
  }
  scheduleReset(btn, AUTHOR_BTN_LABEL);
}

function syncAuthorButton(): void {
  const onProfile =
    handleFromProfileUrl() !== null && document.querySelector('[data-testid="UserName"]');
  const existing = document.querySelector<HTMLButtonElement>(`.${AUTHOR_BTN_CLASS}`);

  if (!onProfile) {
    existing?.remove();
    return;
  }
  if (existing) return;

  // Drop the button into the header's action row (next to "..." / Follow).
  const actions = document.querySelector('[data-testid="userActions"]');
  const row = actions?.parentElement;
  if (!row) return;

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = AUTHOR_BTN_CLASS;
  btn.title = 'Save this profile (bio, followers, pinned tweet) to stratus';
  setState(btn, 'idle', AUTHOR_BTN_LABEL);
  btn.addEventListener('click', (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    void onSaveAuthorClick(btn);
  });
  row.appendChild(btn);
}

// --------------------------------------------------------------- reply master

// X renders action-row aria-label like "12 replies, 5 reposts, 100 likes, ..."
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
  const postedAt = timeEl?.getAttribute('datetime') || new Date().toISOString();

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

// --------------------------------------------------------------- scan loop

function scan(root: ParentNode): void {
  const focusedId = focusedTweetIdFromUrl();
  for (const article of root.querySelectorAll('article[data-testid="tweet"]')) {
    attachButton(article);
    if (focusedId) attachReplyMasterButton(article, focusedId);
  }
  syncAuthorButton();
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

function start(): void {
  injectStyles();
  scan(document);
  const observer = new MutationObserver(scheduleScan);
  observer.observe(document.body, { childList: true, subtree: true });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', start, { once: true });
} else {
  start();
}
