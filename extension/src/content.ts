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

import { suggestChannels } from './channelSuggest.ts';
import { initHarvest } from './harvester.ts';
import { classifyBand, textLooksLikeReplyBait } from './replyBand.ts';
import type { TweetSignals } from './replyBand.ts';
import { parseEarlyReplies } from './shared/earlyReplies.ts';
import { GLANCE_TTL_MS, buildPersonChips } from './shared/glance.ts';
import type { GlanceMap } from './shared/glance.ts';
import type { ActiveLaunch, EarlyReply } from './shared/launch.ts';
import type {
  ApiRequest,
  ApiResponse,
  LaunchGet,
  LaunchReport,
  RadarReport,
} from './shared/messages.ts';
import { parseMetricsAria, reportUnparsed } from './shared/metricsAria.ts';
import type { RadarBand, RadarSighting } from './shared/radar.ts';
import {
  type HoverCardData,
  type PersonSighting,
  SIGHTING_BATCH_MAX,
  SIGHTING_FLUSH_MS,
  cardHasData,
  mergePendingSighting,
  shouldReportSighting,
} from './shared/sightings.ts';
import { buildTweetContextModel } from './shared/tweetContext.ts';
import type { Dossier, TweetContextModel } from './shared/tweetContext.ts';
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
const CHAN_CHIP_CLASS = 'stratus-chan-chip';
const CHAN_WRAP_CLASS = 'stratus-chan-chips';
const PERSON_CHIPS_CLASS = 'stratus-person-chips';
const PERSON_CHIP_CLASS = 'stratus-person-chip';
const CONTEXT_PANEL_CLASS = 'stratus-context-panel';
const STYLE_ID = 'stratus-save-style';
const STATUS_PERSIST_MS = 2500;
const REPLY_MASTER_STORAGE_KEY = 'replyMaster:lastDraft';
const REPLY_SYSTEM_PROMPT_KEY = 'replyMaster:systemPromptOverride';
const REPLY_IDEA_KEY = 'replyMaster:idea';
// C6: set when the steer was picked from the Idea Inbox dropdown — rides along
// as `ideaId` so the server consumes the stored idea (status flip + backlink).
const REPLY_IDEA_ID_KEY = 'replyMaster:ideaId';
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
    article[data-testid="tweet"][data-stratus-band="hot"]  { box-shadow: inset 4px 0 0 rgb(0, 186, 124); }
    article[data-testid="tweet"][data-stratus-band="warm"] { box-shadow: inset 4px 0 0 rgb(255, 179, 0); }
    article[data-testid="tweet"][data-stratus-band="skip"] { opacity: 0.45; }
    .${PERSON_CHIPS_CLASS} {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      margin-left: 4px;
      flex-shrink: 0;
      overflow: hidden;
      vertical-align: middle;
    }
    .${PERSON_CHIP_CLASS} {
      all: unset;
      display: inline-flex;
      align-items: center;
      box-sizing: border-box;
      cursor: pointer;
      font: 600 11px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
      letter-spacing: 0.02em;
      padding: 2px 7px;
      border-radius: 9999px;
      white-space: nowrap;
      border: 1px solid transparent;
    }
    .${PERSON_CHIP_CLASS}[data-tone="ally"]      { color: rgb(0, 186, 124);  border-color: rgba(0, 186, 124, 0.5);  background: rgba(0, 186, 124, 0.10); }
    .${PERSON_CHIP_CLASS}[data-tone="mutual"]    { color: rgb(29, 155, 240); border-color: rgba(29, 155, 240, 0.5); background: rgba(29, 155, 240, 0.10); }
    .${PERSON_CHIP_CLASS}[data-tone="responded"] { color: rgb(214, 150, 0);  border-color: rgba(255, 179, 0, 0.55); background: rgba(255, 179, 0, 0.12); }
    .${PERSON_CHIP_CLASS}[data-tone="engaged"]   { color: rgb(113, 118, 123); border-color: rgba(113, 118, 123, 0.5); background: rgba(113, 118, 123, 0.10); }
    .${PERSON_CHIP_CLASS}[data-tone="target"]    { color: rgb(29, 155, 240); border-color: rgba(29, 155, 240, 0.5); background: rgba(29, 155, 240, 0.10); }
    .${PERSON_CHIP_CLASS}[data-tone="warn"]      { color: rgb(214, 150, 0);  border-color: rgba(255, 179, 0, 0.55); background: rgba(255, 179, 0, 0.12); }
    .${PERSON_CHIP_CLASS}:hover { filter: brightness(1.15); }
    .${CHAN_WRAP_CLASS} { display: inline-flex; gap: 4px; margin-left: 4px; align-items: center; }
    .${CHAN_CHIP_CLASS} {
      all: unset;
      display: inline-flex;
      align-items: center;
      box-sizing: border-box;
      cursor: pointer;
      font: 600 11px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
      letter-spacing: 0.02em;
      padding: 3px 8px;
      border-radius: 9999px;
      color: rgb(29, 155, 240);
      border: 1px dashed rgba(29, 155, 240, 0.5);
      background: transparent;
      white-space: nowrap;
    }
    .${CHAN_CHIP_CLASS}:hover { background: rgba(29, 155, 240, 0.1); }
    .${CHAN_CHIP_CLASS}[data-state="tagged"] {
      color: rgb(0, 186, 124);
      border: 1px solid rgb(0, 186, 124);
      cursor: default;
    }
    /* The purple sparkle circle is injected by the retired standalone "Reply
       Master" extension (~/newme/clipx/reply-master), NOT by stratus — the real
       fix is uninstalling it in chrome://extensions. This defensive rule only
       guarantees it stays hidden if that extension is ever re-enabled. */
    #reply-master-btn { display: none !important; }
    .${CONTEXT_PANEL_CLASS} {
      box-sizing: border-box;
      width: 100%;
      padding: 12px 16px;
      border-top: 1px solid rgba(113, 118, 123, 0.25);
      font: 400 13px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
      color: inherit;
    }
    .stratus-ctx-header {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .stratus-ctx-title {
      display: flex;
      align-items: center;
      gap: 8px;
      flex: 1 1 auto;
      min-width: 0;
      cursor: pointer;
    }
    .stratus-ctx-since { color: rgb(113, 118, 123); font-size: 12px; }
    .stratus-ctx-toggle {
      all: unset;
      cursor: pointer;
      color: rgb(113, 118, 123);
      font-size: 13px;
      line-height: 1;
      padding: 2px 6px;
      border-radius: 6px;
    }
    .stratus-ctx-toggle:hover { background: rgba(113, 118, 123, 0.12); }
    .${CONTEXT_PANEL_CLASS}[data-collapsed="true"] .stratus-ctx-body { display: none; }
    .stratus-ctx-body {
      display: flex;
      flex-direction: column;
      gap: 8px;
      margin-top: 8px;
    }
    .stratus-ctx-meta { color: rgb(113, 118, 123); font-size: 12px; }
    .stratus-ctx-tags { display: flex; flex-wrap: wrap; gap: 4px; }
    .stratus-ctx-tag {
      font-size: 11px;
      padding: 1px 7px;
      border-radius: 9999px;
      color: rgb(113, 118, 123);
      border: 1px solid rgba(113, 118, 123, 0.35);
    }
    .stratus-ctx-banner {
      font-size: 12px;
      padding: 4px 8px;
      border-radius: 6px;
      color: rgb(0, 186, 124);
      background: rgba(0, 186, 124, 0.1);
    }
    .stratus-ctx-row { display: flex; flex-direction: column; gap: 3px; }
    .stratus-ctx-label {
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      color: rgb(113, 118, 123);
    }
    .stratus-ctx-val { font-size: 13px; }
    .stratus-ctx-list { display: flex; flex-direction: column; gap: 4px; }
    .stratus-ctx-loop { font-size: 12px; }
    .stratus-ctx-outcome { display: flex; flex-direction: column; gap: 1px; }
    .stratus-ctx-outcome-text { font-size: 12px; }
    .stratus-ctx-outcome-meta { font-size: 11px; color: rgb(113, 118, 123); }
    .stratus-ctx-notes {
      font-size: 12px;
      color: rgb(113, 118, 123);
      white-space: pre-wrap;
      border-left: 2px solid rgba(113, 118, 123, 0.35);
      padding-left: 8px;
    }
    .stratus-ctx-empty { font-size: 12px; color: rgb(113, 118, 123); }
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

// The hover card carries no `data-testid="UserDescription"` (the profile header
// does, but the card doesn't). The bio is a bare `div[dir="auto"]` that sits
// between the @handle link and the Following/Followers counts. The card's only
// other dir=auto is the follow button's "Click to Follow …" label, which renders
// *before* the handle — so the positional window cleanly excludes it.
function readHoverCardBio(card: Element, handle: string): string | null {
  const direct = card.querySelector('[data-testid="UserDescription"]')?.textContent?.trim();
  if (direct) return direct;

  const want = `/${handle.toLowerCase()}`;
  let handleLink: HTMLAnchorElement | null = null;
  for (const a of card.querySelectorAll<HTMLAnchorElement>('a[href^="/"]')) {
    if (a.pathname.toLowerCase() === want && a.textContent?.trim().startsWith('@')) {
      handleLink = a;
      break;
    }
  }
  const followingLink = card.querySelector('a[href$="/following"]');
  if (!handleLink || !followingLink) return null;

  const FOLLOWING = Node.DOCUMENT_POSITION_FOLLOWING;
  for (const el of card.querySelectorAll<HTMLElement>('[dir="auto"]')) {
    const afterHandle = handleLink.compareDocumentPosition(el) & FOLLOWING;
    const beforeCounts = el.compareDocumentPosition(followingLink) & FOLLOWING;
    if (afterHandle && beforeCounts) {
      const text = el.textContent?.trim();
      if (text) return text;
    }
  }
  return null;
}

// The follow button's testid is `<numericUserId>-follow` (e.g. `335833273-follow`)
// — the only place the card exposes the author's stable x_user_id. Opportunistic.
function readUserIdFromFollowButton(root: ParentNode): string | null {
  for (const el of root.querySelectorAll('[data-testid$="-follow"]')) {
    const m = el.getAttribute('data-testid')?.match(/^(\d+)-follow$/);
    if (m?.[1]) return m[1];
  }
  return null;
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
  const bio = readHoverCardBio(card, handle);
  const { followers, following } = readCountsFrom(card);
  const xUserId = readUserIdFromFollowButton(card);

  if (
    displayName === null &&
    bio === null &&
    followers === null &&
    following === null &&
    xUserId === null
  ) {
    return null;
  }
  return {
    handle,
    displayName,
    bio,
    followersCount: followers,
    followingCount: following,
    xUserId,
  };
}

// -------------------------------------------------- channel chips (C8, $0)

// Active channels for the save-time chips, fetched through the background API
// channel and cached a few minutes — one GET serves a whole browsing session.
const CHANNEL_CACHE_TTL_MS = 5 * 60_000;
const CHANNEL_CHIP_MAX = 3;
const CHANNEL_CHIPS_PERSIST_MS = 15_000;
let channelCache: { channels: { slug: string; keywords: string[] | null }[]; at: number } | null =
  null;

async function getActiveChannels(): Promise<{ slug: string; keywords: string[] | null }[]> {
  if (channelCache && Date.now() - channelCache.at < CHANNEL_CACHE_TTL_MS) {
    return channelCache.channels;
  }
  const request: ApiRequest = {
    type: 'stratus/api',
    method: 'GET',
    path: '/x/channels?active=true',
  };
  try {
    const res = (await chrome.runtime.sendMessage(request)) as
      | ApiResponse<{ slug: string; keywords: string[] | null }[]>
      | undefined;
    if (res?.ok && Array.isArray(res.data)) {
      channelCache = { channels: res.data, at: Date.now() };
      return res.data;
    }
  } catch (err) {
    console.warn('[stratus] channels fetch failed', err);
  }
  return channelCache?.channels ?? [];
}

// After a successful save, offer keyword-suggested channel chips next to the
// button — the C8 "chip picker in the confirmation" affordance. One click tags
// the just-saved voice tweet (additive PATCH, so quick successive clicks can't
// clobber each other). Suggest-only keeps the action row light; the full
// picker lives in the panel's Voice tab.
async function offerChannelChips(btn: HTMLButtonElement, tweet: ScrapedTweet): Promise<void> {
  const channels = await getActiveChannels();
  const suggested = suggestChannels(tweet.text, channels).slice(0, CHANNEL_CHIP_MAX);
  if (suggested.length === 0 || !btn.isConnected) return;

  btn.parentElement?.querySelector(`.${CHAN_WRAP_CLASS}`)?.remove();
  const wrap = document.createElement('span');
  wrap.className = CHAN_WRAP_CLASS;
  for (const slug of suggested) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = CHAN_CHIP_CLASS;
    chip.textContent = `+ #${slug}`;
    chip.title = `Tag the saved tweet into #${slug}`;
    chip.addEventListener('click', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      if (chip.dataset.state === 'tagged') return;
      chip.disabled = true;
      void (async () => {
        const req: ApiRequest = {
          type: 'stratus/api',
          method: 'PATCH',
          path: `/x/voice/tweets/${tweet.tweetId}`,
          body: { addTags: [slug] },
        };
        let ok = false;
        try {
          const res = (await chrome.runtime.sendMessage(req)) as ApiResponse | undefined;
          ok = res?.ok === true;
        } catch (err) {
          console.warn('[stratus] tag failed', err);
        }
        if (ok) {
          chip.dataset.state = 'tagged';
          chip.textContent = `✓ #${slug}`;
        } else {
          chip.textContent = `! #${slug}`;
          chip.disabled = false;
        }
      })();
    });
    wrap.appendChild(chip);
  }
  btn.insertAdjacentElement('afterend', wrap);
  setTimeout(() => wrap.remove(), CHANNEL_CHIPS_PERSIST_MS);
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
    void offerChannelChips(btn, tweet);
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
  const xUserId = readUserIdFromFollowButton(header);
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
      xUserId,
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
// Locale-hardened parsing lives in shared/metricsAria.ts (§9.3) — a non-English
// UI used to silently zero every metric, poisoning the band model. An aria
// label with numbers nothing matched is reported loudly, never swallowed.
function parseMetricsLabel(label: string): PostContext['metrics'] {
  const m = parseMetricsAria(label);
  if (m.unparsed) reportUnparsed('content', label);
  return { replies: m.replies, reposts: m.reposts, likes: m.likes, views: m.views };
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

  // Stamp the band verdict + classifier inputs at capture time, via the same
  // readTweetSignals path the badge uses — the draft row becomes a labeled
  // training example for recalibrating BAND from own outcomes (plan §6.2).
  const sig = readTweetSignals(focusedArticle);

  return {
    tweetId: focusedTweetId,
    handle: permalink.username,
    author,
    text,
    url: permalink.url,
    postedAt,
    metrics,
    topComments,
    ...(sig ? { signals: { band: classifyBand(sig), ...sig } } : {}),
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

function scheduleReplyReset(btn: HTMLButtonElement, ms = STATUS_PERSIST_MS): void {
  setTimeout(() => {
    if (!btn.isConnected) return;
    delete btn.dataset.force; // band-gate override expires with the prompt
    setReplyState(btn, 'idle', REPLY_BTN_LABEL);
  }, ms);
}

async function onReplyMasterClick(btn: HTMLButtonElement): Promise<void> {
  if (btn.dataset.state === 'working') return;

  // Set when the previous click was refused by the server band gate (§7.3);
  // a deliberate re-click inside the prompt window forces the draft.
  const force = btn.dataset.force === '1';
  delete btn.dataset.force;

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
  let idea: string | undefined;
  let ideaId: string | undefined;
  try {
    const out = await chrome.storage.local.get([
      REPLY_SYSTEM_PROMPT_KEY,
      REPLY_IDEA_KEY,
      REPLY_IDEA_ID_KEY,
    ]);
    const v = out[REPLY_SYSTEM_PROMPT_KEY];
    if (typeof v === 'string' && v.trim() !== '') systemPromptOverride = v;
    const i = out[REPLY_IDEA_KEY];
    if (typeof i === 'string' && i.trim() !== '') idea = i.trim();
    const id = out[REPLY_IDEA_ID_KEY];
    if (idea && typeof id === 'string' && id !== '') ideaId = id;
  } catch (err) {
    console.warn('[stratus] reply master read override failed', err);
  }

  const request: ApiRequest = {
    type: 'stratus/api',
    method: 'POST',
    path: '/x/replies/generate',
    body: {
      context: ctx,
      ...(systemPromptOverride ? { systemPromptOverride } : {}),
      ...(idea ? { idea } : {}),
      ...(ideaId ? { ideaId } : {}),
      ...(force ? { override: true } : {}),
    },
  };

  let res: ApiResponse<ReplyDraft> | undefined;
  try {
    res = (await chrome.runtime.sendMessage(request)) as ApiResponse<ReplyDraft> | undefined;
  } catch (err) {
    console.error('[stratus] reply master sendMessage failed', err);
  }

  if (!res || !res.ok) {
    const code = res && !res.ok ? res.code : 'no_response';
    if (code === 'band_gate') {
      // Server refused a dead (null/skip-band) target. Arm a short window in
      // which a second deliberate click resends with override: true.
      btn.dataset.force = '1';
      setReplyState(btn, 'failed', 'Dead post — click to force');
      scheduleReplyReset(btn, STATUS_PERSIST_MS * 2);
      return;
    }
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
    // The idea steered this draft; clear it so it can't leak into the next one.
    // (When it came from the Idea Inbox the server already consumed the row —
    // re-use is one click from the Ideas tab.)
    if (idea) await chrome.storage.local.remove([REPLY_IDEA_KEY, REPLY_IDEA_ID_KEY]);
  } catch (err) {
    console.warn('[stratus] storage.set lastDraft failed', err);
  }

  // Opt-in (Settings → "Auto-type reply drafts", default off): stream the draft
  // into the reply box like manual keystrokes. Clipboard copy above stays as the
  // fallback, so an absent/unfound composer still leaves the draft pasteable.
  if (await autoTypeReplyEnabled()) {
    const editor = findReplyEditor();
    if (editor) {
      setReplyState(btn, 'working', 'Typing…');
      const typed = await typeTextInto(editor, replyText);
      setReplyState(btn, 'done', typed > 0 ? 'Typed ✓' : 'Open the reply box first');
      scheduleReplyReset(btn);
      return;
    }
    setReplyState(btn, 'done', copied ? 'Copied ✓ (no reply box)' : 'Drafted (copy manually)');
    scheduleReplyReset(btn);
    return;
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

// --------------------------------------------------------- reply-target band

// Highlight timeline tweets that sit in the 1k–8k-view sweet spot worth
// replying to early. Every signal is read from the DOM ($0). The scoring model
// lives in replyBand.ts; the rationale is in evals/reply-eval-*.md.

function looksLikeReplyBait(article: Element): boolean {
  const text = article.querySelector('[data-testid="tweetText"]')?.textContent?.trim() ?? '';
  if (textLooksLikeReplyBait(text)) return true;
  // Best-effort poll detection — selector may drift across X redesigns.
  if (article.querySelector('[role="radiogroup"], [data-testid*="poll" i]')) return true;
  return false;
}

function readTweetSignals(article: Element): TweetSignals | null {
  const reply = article.querySelector('[data-testid="reply"]');
  const actionRow = reply?.closest('div[role="group"]');
  const aria = actionRow?.getAttribute('aria-label');
  if (!aria) return null; // ads / promoted rows carry no metrics label
  const m = parseMetricsLabel(aria);

  const dt = article.querySelector('time')?.getAttribute('datetime');
  if (!dt) return null;
  const posted = Date.parse(dt);
  if (Number.isNaN(posted)) return null;
  const ageMin = Math.max(0, (Date.now() - posted) / 60000);

  return {
    views: m.views,
    replies: m.replies,
    ageMin,
    vpm: m.views / Math.max(ageMin, 1),
    bait: looksLikeReplyBait(article),
  };
}

function applyBand(article: HTMLElement): void {
  const sig = readTweetSignals(article);
  const band = sig ? classifyBand(sig) : null;
  if (band) article.dataset.stratusBand = band;
  else delete article.dataset.stratusBand;
  if (sig && (band === 'hot' || band === 'warm')) recordRadarSighting(article, band, sig);
}

// ----------------------------------------------------- person chips (AX.3, $0)
//
// Right of the name/handle line, small native-looking chips for people stratus
// knows: a stage chip (engaged+), a ◎ target marker, an amber ↩ owed when they
// have unanswered mentions in my inbox, and an `Nd` neglect mark. All derived
// client-side from GET /x/people/glance (pure SQL, $0), cached per session
// (GLANCE_TTL_MS, the channels-cache pattern). The view-model is
// shared/glance.ts; this is only the DOM plumbing. Recomputed every scan (NOT
// deduped) — X recycles article nodes and the neglect age ticks, so a cached
// chip goes stale; a data-sig guard skips the DOM write when nothing changed.

let glanceCache: { map: GlanceMap; at: number } | null = null;
let glanceInFlight: Promise<void> | null = null;

async function refreshGlanceMap(): Promise<void> {
  const request: ApiRequest = { type: 'stratus/api', method: 'GET', path: '/x/people/glance' };
  try {
    const res = (await chrome.runtime.sendMessage(request)) as
      | ApiResponse<{ count: number; map: GlanceMap }>
      | undefined;
    if (res?.ok && res.data && typeof res.data.map === 'object') {
      glanceCache = { map: res.data.map, at: Date.now() };
    }
    // A fresh install (no bearer) returns `unconfigured` — silent: chips just
    // don't render, like the save button on an unconfigured extension.
  } catch (err) {
    console.warn('[stratus] glance fetch failed', err);
  }
}

// scan() is synchronous, so this returns whatever's cached now (stale or empty)
// and kicks off a background refresh when the cache is expired — the fresh map
// lands for the next mutation scan (X emits them constantly).
function getGlanceMap(): GlanceMap {
  const fresh = glanceCache && Date.now() - glanceCache.at < GLANCE_TTL_MS;
  if (!fresh && !glanceInFlight) {
    glanceInFlight = refreshGlanceMap().finally(() => {
      glanceInFlight = null;
    });
  }
  return glanceCache?.map ?? {};
}

function applyPersonChips(article: Element, glance: GlanceMap): void {
  const permalink = findPermalink(article);
  const existing = article.querySelector<HTMLSpanElement>(`.${PERSON_CHIPS_CLASS}`);

  const handle = permalink ? permalink.username.toLowerCase() : '';
  const entry = handle ? glance[handle] : undefined;
  const chips = entry ? buildPersonChips(entry, Date.now()).slice(0, 4) : [];

  // querySelector returns the FIRST User-Name = the outer tweet's author (quote
  // previews nest below), so chips decorate the real author's line only.
  const userName = article.querySelector('[data-testid="User-Name"]');
  if (chips.length === 0 || !userName) {
    existing?.remove(); // unknown handle / no header row → clear any recycled span
    return;
  }

  const sig = chips.map((c) => `${c.kind}:${c.label}:${c.tone}`).join('|');
  if (existing && existing.dataset.handle === handle && existing.dataset.sig === sig) {
    return; // unchanged — skip the DOM write (X mutates the subtree furiously)
  }

  const span = existing ?? document.createElement('span');
  if (!existing) {
    span.className = PERSON_CHIPS_CLASS;
    userName.insertAdjacentElement('afterend', span);
  }
  span.dataset.handle = handle;
  span.dataset.sig = sig;
  span.textContent = '';
  for (const chip of chips) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = PERSON_CHIP_CLASS;
    btn.dataset.tone = chip.tone;
    btn.dataset.handle = handle;
    btn.title = chip.tooltip;
    btn.textContent = chip.label;
    // Task 6 (AX.6) wires the dossier click-through; until then a no-op that
    // keeps the click from bubbling into X's row → tweet navigation.
    btn.addEventListener('click', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
    });
    span.appendChild(btn);
  }
}

// -------------------------------------------- tweet-page context panel (AX.5, $0)
//
// On a /status/ page, below the focused tweet's action row, a collapsible panel
// shows who this person is to me: stage, exchanges, followers + momentum, tags,
// whether I already replied to THIS tweet, open loops I owe them, my last
// measured replies with outcomes, the angle that works, and my notes. All from
// the C1 dossier (GET /x/people/:handle, pure SQL, $0), cached per handle for 5
// min. The pure view-model is shared/tweetContext.ts; this is DOM plumbing only.

const CONTEXT_COLLAPSED_KEY = 'augment:contextCollapsed';
const DOSSIER_TTL_MS = 5 * 60_000;
const CONTEXT_OUTCOME_MAX = 3;

// engaged+ stages have their own tone class; below that (stranger/noticed) fall
// back to the neutral gray `engaged` tone so a stage chip always renders.
const TONED_STAGES = new Set(['engaged', 'responded', 'mutual', 'ally']);

type DossierState = 'ready' | 'missing' | 'unavailable';
interface DossierCacheEntry {
  state: DossierState;
  dossier: Dossier | null;
  at: number;
}

let contextCollapsed = false;
const dossierCache = new Map<string, DossierCacheEntry>();
const dossierInFlight = new Set<string>();

function initContextCollapsed(): void {
  chrome.storage.local
    .get(CONTEXT_COLLAPSED_KEY)
    .then((out) => {
      contextCollapsed = out[CONTEXT_COLLAPSED_KEY] === true;
    })
    .catch(() => {
      /* keep default (expanded) */
    });
}

async function refreshDossier(handle: string): Promise<void> {
  const request: ApiRequest = {
    type: 'stratus/api',
    method: 'GET',
    path: `/x/people/${encodeURIComponent(handle)}`,
  };
  try {
    const res = (await chrome.runtime.sendMessage(request)) as ApiResponse<Dossier> | undefined;
    if (res?.ok && res.data) {
      dossierCache.set(handle, { state: 'ready', dossier: res.data, at: Date.now() });
    } else if (res && !res.ok && res.status === 404) {
      dossierCache.set(handle, { state: 'missing', dossier: null, at: Date.now() });
    } else {
      // unconfigured (no bearer) / network / other — cache so we don't refetch
      // every scan, but render nothing (not a "no file" line).
      dossierCache.set(handle, { state: 'unavailable', dossier: null, at: Date.now() });
    }
  } catch (err) {
    console.warn('[stratus] dossier fetch failed', err);
    dossierCache.set(handle, { state: 'unavailable', dossier: null, at: Date.now() });
  }
}

// Returns the last cached entry (possibly stale, shown while refreshing) and
// kicks a background fetch when expired. Unlike the timeline glance cache this
// re-triggers a scan on fetch completion — a status page can be mutation-quiet,
// so nothing else would re-render the panel once the dossier lands.
function getDossier(handle: string): DossierCacheEntry | null {
  const key = handle.toLowerCase();
  const cached = dossierCache.get(key) ?? null;
  const fresh = cached && Date.now() - cached.at < DOSSIER_TTL_MS;
  if (!fresh && !dossierInFlight.has(key)) {
    dossierInFlight.add(key);
    void refreshDossier(key).finally(() => {
      dossierInFlight.delete(key);
      scheduleScan();
    });
  }
  return cached;
}

function stageTone(stage: string): string {
  return TONED_STAGES.has(stage) ? stage : 'engaged';
}

function ctxEl(tag: string, className: string, text?: string): HTMLElement {
  const e = document.createElement(tag);
  e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

function compactNum(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}K`.replace('.0K', 'K');
  return `${(n / 1_000_000).toFixed(1)}M`.replace('.0M', 'M');
}

function humanizeMinutes(min: number): string {
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function agoLabel(iso: string | null, nowMs: number): string | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return humanizeMinutes(Math.max(0, Math.floor((nowMs - t) / 60_000)));
}

function renderMissingPanel(handle: string, tweetId: string): HTMLElement {
  const panel = ctxEl('div', CONTEXT_PANEL_CLASS);
  panel.dataset.tweetId = tweetId;
  panel.dataset.handle = handle;
  panel.appendChild(ctxEl('div', 'stratus-ctx-empty', `No stratus file on @${handle}`));
  return panel;
}

function renderContextPanel(
  model: TweetContextModel,
  handle: string,
  tweetId: string,
): HTMLElement {
  const now = Date.now();
  const h = model.header;
  const panel = ctxEl('div', CONTEXT_PANEL_CLASS);
  panel.dataset.tweetId = tweetId;
  panel.dataset.handle = handle;
  panel.dataset.collapsed = contextCollapsed ? 'true' : 'false';

  const header = ctxEl('div', 'stratus-ctx-header');
  const title = ctxEl('div', 'stratus-ctx-title');
  title.dataset.handle = handle; // AX.6 wires the dossier click-through here.

  const stageChip = ctxEl('span', PERSON_CHIP_CLASS, h.stage);
  stageChip.dataset.tone = stageTone(h.stage);
  title.appendChild(stageChip);
  title.appendChild(
    ctxEl(
      'span',
      'stratus-ctx-since',
      h.sinceDays !== null ? `in your circles · ${h.sinceDays}d` : 'in your circles',
    ),
  );
  header.appendChild(title);

  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'stratus-ctx-toggle';
  toggle.title = 'Collapse / expand stratus context';
  toggle.textContent = contextCollapsed ? '▸' : '▾';
  toggle.addEventListener('click', (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    contextCollapsed = !contextCollapsed;
    panel.dataset.collapsed = contextCollapsed ? 'true' : 'false';
    toggle.textContent = contextCollapsed ? '▸' : '▾';
    void chrome.storage.local.set({ [CONTEXT_COLLAPSED_KEY]: contextCollapsed }).catch(() => {});
  });
  header.appendChild(toggle);
  panel.appendChild(header);

  const body = ctxEl('div', 'stratus-ctx-body');

  const metaBits: string[] = [];
  if (h.followersCount !== null) metaBits.push(`${compactNum(h.followersCount)} followers`);
  if (h.momentumPerDay !== null && h.momentumPerDay !== 0) {
    metaBits.push(`${h.momentumPerDay > 0 ? '+' : ''}${h.momentumPerDay}/day`);
  }
  if (metaBits.length) body.appendChild(ctxEl('div', 'stratus-ctx-meta', metaBits.join(' · ')));

  if (h.tags.length) {
    const tagRow = ctxEl('div', 'stratus-ctx-tags');
    for (const t of h.tags) tagRow.appendChild(ctxEl('span', 'stratus-ctx-tag', t));
    body.appendChild(tagRow);
  }

  if (model.alreadyReplied) {
    body.appendChild(
      ctxEl(
        'div',
        'stratus-ctx-banner',
        `You already replied to this tweet · ${humanizeMinutes(model.alreadyReplied.ageMin)}`,
      ),
    );
  }

  const r = model.relationship;
  if (r.inbound > 0 || r.outbound > 0) {
    const bits = [`${r.inbound} from them`, `${r.outbound} from you`];
    const lastIn = agoLabel(r.lastInboundAt, now);
    const lastOut = agoLabel(r.lastOutboundAt, now);
    if (lastIn) bits.push(`last in ${lastIn}`);
    if (lastOut) bits.push(`last out ${lastOut}`);
    body.appendChild(ctxRow('exchanges', bits.join(' · ')));
  }

  if (model.openLoops.length) {
    const row = ctxEl('div', 'stratus-ctx-row');
    row.appendChild(ctxEl('span', 'stratus-ctx-label', `you owe · ${model.openLoops.length}`));
    const list = ctxEl('div', 'stratus-ctx-list');
    for (const loop of model.openLoops.slice(0, CONTEXT_OUTCOME_MAX)) {
      list.appendChild(ctxEl('div', 'stratus-ctx-loop', `${loop.ageDays}d · ${loop.text}`));
    }
    row.appendChild(list);
    body.appendChild(row);
  }

  if (model.outcomes.length) {
    const row = ctxEl('div', 'stratus-ctx-row');
    row.appendChild(ctxEl('span', 'stratus-ctx-label', 'your last replies'));
    const list = ctxEl('div', 'stratus-ctx-list');
    for (const o of model.outcomes) {
      const item = ctxEl('div', 'stratus-ctx-outcome');
      item.appendChild(ctxEl('div', 'stratus-ctx-outcome-text', o.text));
      const bits: string[] = [];
      if (o.views !== null) bits.push(`${compactNum(o.views)} views`);
      if (o.profileVisits !== null) bits.push(`${compactNum(o.profileVisits)} profile`);
      if (o.angle) bits.push(o.angle);
      if (bits.length) item.appendChild(ctxEl('div', 'stratus-ctx-outcome-meta', bits.join(' · ')));
      list.appendChild(item);
    }
    row.appendChild(list);
    body.appendChild(row);
  }

  if (model.anglePreference) {
    body.appendChild(
      ctxRow(
        'best angle',
        `${model.anglePreference.angle} · ${model.anglePreference.measured} measured`,
      ),
    );
  }

  if (model.notes) body.appendChild(ctxEl('div', 'stratus-ctx-notes', model.notes));

  panel.appendChild(body);
  return panel;
}

function ctxRow(label: string, value: string): HTMLElement {
  const row = ctxEl('div', 'stratus-ctx-row');
  row.appendChild(ctxEl('span', 'stratus-ctx-label', label));
  row.appendChild(ctxEl('span', 'stratus-ctx-val', value));
  return row;
}

// Once-per-scan: upsert the context panel under the focused tweet, and tear a
// stale panel down on SPA navigation (to the timeline or a different status).
function syncContextPanel(focusedId: string | null): void {
  const existing = document.querySelector<HTMLElement>(`.${CONTEXT_PANEL_CLASS}`);
  if (!focusedId) {
    existing?.remove(); // left the status page
    return;
  }

  let focusedArticle: HTMLElement | null = null;
  let handle = '';
  for (const article of document.querySelectorAll<HTMLElement>('article[data-testid="tweet"]')) {
    const permalink = findPermalink(article);
    if (permalink && permalink.tweetId === focusedId) {
      focusedArticle = article;
      handle = permalink.username.toLowerCase();
      break;
    }
  }
  if (!focusedArticle || !handle) {
    if (existing && existing.dataset.tweetId !== focusedId) existing.remove();
    return;
  }

  const entry = getDossier(handle);
  if (!entry || entry.state === 'unavailable') {
    existing?.remove(); // loading with nothing cached, or unconfigured → render nothing
    return;
  }

  const renderKey =
    entry.state === 'ready'
      ? `ready:${focusedId}:${handle}:${entry.at}`
      : `missing:${focusedId}:${handle}`;
  if (
    existing &&
    existing.dataset.renderKey === renderKey &&
    focusedArticle.nextElementSibling === existing
  ) {
    return; // unchanged and still anchored — skip the rebuild
  }

  existing?.remove();
  const panel =
    entry.state === 'ready' && entry.dossier
      ? renderContextPanel(
          buildTweetContextModel(entry.dossier, focusedId, Date.now()),
          handle,
          focusedId,
        )
      : renderMissingPanel(handle, focusedId);
  panel.dataset.renderKey = renderKey;
  // Insert into the article's PARENT flow (as its next sibling), not inside the
  // article: the action row is the article's last block, so this reads as "below
  // the action row", and a sibling isn't carried when X recycles the article node.
  focusedArticle.insertAdjacentElement('afterend', panel);
}

// --------------------------------------------------------------- radar (§7.2)

// Hot/warm verdicts used to evaporate as you scrolled past. Stream them to the
// background's session ring buffer so the side panel can show a worked queue.
// Batched (one message per flush window, deduped by tweetId) and per-tweet
// throttled — applyBand re-runs on every mutation burst, but the queue only
// needs a fresh number once a minute, sooner if the band itself changes.

const RADAR_FLUSH_MS = 2000;
const RADAR_RESEND_MS = 60_000;

const pendingRadar = new Map<string, RadarSighting>();
const radarSentAt = new Map<string, { at: number; band: RadarBand }>();
let radarFlushTimer: number | null = null;

function recordRadarSighting(article: Element, band: RadarBand, sig: TweetSignals): void {
  const permalink = findPermalink(article);
  if (!permalink) return;
  const sent = radarSentAt.get(permalink.tweetId);
  if (sent && sent.band === band && Date.now() - sent.at < RADAR_RESEND_MS) return;

  const text = article.querySelector('[data-testid="tweetText"]')?.textContent?.trim() ?? '';
  const userNameEl = article.querySelector('[data-testid="User-Name"]');
  const author = userNameEl?.querySelector<HTMLAnchorElement>('a')?.textContent?.trim() || null;
  const now = new Date().toISOString();

  pendingRadar.set(permalink.tweetId, {
    tweetId: permalink.tweetId,
    url: permalink.url,
    handle: permalink.username,
    author,
    // Wider than the 2-line UI clamp on purpose: batch reply drafting (§7.2)
    // feeds this text to Grok, so keep enough of a longer tweet to reply to.
    text: text.slice(0, 500),
    band,
    signals: { ...sig, ageMin: Math.round(sig.ageMin), vpm: Math.round(sig.vpm * 10) / 10 },
    firstSeenAt: now,
    lastSeenAt: now,
  });
  if (radarFlushTimer === null) {
    radarFlushTimer = window.setTimeout(flushRadar, RADAR_FLUSH_MS);
  }
}

function flushRadar(): void {
  radarFlushTimer = null;
  if (pendingRadar.size === 0) return;
  const sightings = [...pendingRadar.values()];
  pendingRadar.clear();

  // Throttle map grows one entry per distinct hot/warm tweet this session;
  // reset rather than prune if a marathon scroll ever gets it huge (the only
  // cost of forgetting is one early re-send per tweet).
  if (radarSentAt.size > 3000) radarSentAt.clear();
  const at = Date.now();
  for (const s of sightings) radarSentAt.set(s.tweetId, { at, band: s.band });

  const msg: RadarReport = { type: 'stratus/radar-report', sightings };
  void (async () => {
    try {
      await chrome.runtime.sendMessage(msg);
    } catch (err) {
      console.warn('[stratus] radar report failed', err);
    }
  })();
}

// ------------------------------------------------- passive hover capture (C6)
//
// When X renders a hover card because the user hovered a handle naturally, we
// parse it with the same readers the explicit-save path uses and queue an
// upsert for POST /x/people/sightings — the roster grows itself from normal
// browsing, no clicks. No hovers are synthesised here; we only read cards X
// already drew (the explicit-save path's synthetic hover gets captured too,
// which is harmless — it upserts the same person). Batched per 2s flush,
// per-handle resend throttled to 60s; the server dedupes events once a day.

const PASSIVE_CAPTURE_KEY = 'passiveCapture';
const HANDLE_RE = /^[A-Za-z0-9_]{1,15}$/;

// Default ON (opt-out via Settings): absent key means enabled.
let passiveCaptureEnabled = true;

function initPassiveCaptureSetting(): void {
  chrome.storage.local
    .get(PASSIVE_CAPTURE_KEY)
    .then((out) => {
      passiveCaptureEnabled = out[PASSIVE_CAPTURE_KEY] !== false;
    })
    .catch(() => {
      /* keep default */
    });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    const change = changes[PASSIVE_CAPTURE_KEY];
    if (change) passiveCaptureEnabled = change.newValue !== false;
  });
}

// Cards whose parse already produced data — never re-captured. A card seen
// while still a skeleton (all fields null) is NOT marked, so a later mutation
// scan retries it once X fills it in.
const capturedHoverCards = new WeakSet<Element>();

const pendingSightings = new Map<string, PersonSighting>();
const sightingSentAt = new Map<string, number>();
let sightingFlushTimer: number | null = null;

// The card's own @handle link is the only reliable identity marker: first
// anchor whose text starts with '@' and whose pathname is a plain username.
function hoverCardHandle(card: Element): string | null {
  for (const a of card.querySelectorAll<HTMLAnchorElement>('a[href^="/"]')) {
    if (!a.textContent?.trim().startsWith('@')) continue;
    const seg = a.pathname.split('/').filter(Boolean);
    const h = seg[0];
    if (seg.length === 1 && h && HANDLE_RE.test(h) && !RESERVED_HANDLES.has(h.toLowerCase())) {
      return h.toLowerCase();
    }
  }
  return null;
}

function parseHoverCardData(card: Element, handle: string): HoverCardData {
  const nameEl = card.querySelector('[data-testid="User-Name"]');
  const displayName = nameEl?.querySelector<HTMLAnchorElement>('a')?.textContent?.trim() || null;
  const bio = readHoverCardBio(card, handle);
  const { followers, following } = readCountsFrom(card);
  return {
    displayName,
    bio,
    followersCount: followers,
    followingCount: following,
    xUserId: readUserIdFromFollowButton(card),
  };
}

function capturePassiveHoverCards(): void {
  if (!passiveCaptureEnabled) return;
  for (const card of document.querySelectorAll('[data-testid="HoverCard"]')) {
    if (capturedHoverCards.has(card)) continue;
    const handle = hoverCardHandle(card);
    if (!handle) continue;
    const data = parseHoverCardData(card, handle);
    if (!cardHasData(data)) continue; // skeleton — retry on a later scan
    capturedHoverCards.add(card);
    recordPersonSighting(handle, data);
  }
}

function recordPersonSighting(handle: string, card: HoverCardData): void {
  if (!shouldReportSighting(sightingSentAt.get(handle), Date.now())) return;
  const sighting: PersonSighting = { handle, card, seenAt: new Date().toISOString() };
  pendingSightings.set(handle, mergePendingSighting(pendingSightings.get(handle), sighting));
  if (sightingFlushTimer === null) {
    sightingFlushTimer = window.setTimeout(flushSightings, SIGHTING_FLUSH_MS);
  }
}

function flushSightings(): void {
  sightingFlushTimer = null;
  if (pendingSightings.size === 0) return;
  const sightings = [...pendingSightings.values()].slice(0, SIGHTING_BATCH_MAX);
  for (const s of sightings) pendingSightings.delete(s.handle);
  if (pendingSightings.size > 0) {
    // Overflow beyond one server batch waits for the next window.
    sightingFlushTimer = window.setTimeout(flushSightings, SIGHTING_FLUSH_MS);
  }

  if (sightingSentAt.size > 3000) sightingSentAt.clear();
  const at = Date.now();
  for (const s of sightings) sightingSentAt.set(s.handle, at);

  const request: ApiRequest = {
    type: 'stratus/api',
    method: 'POST',
    path: '/x/people/sightings',
    body: { sightings },
  };
  void (async () => {
    try {
      const res = (await chrome.runtime.sendMessage(request)) as ApiResponse | undefined;
      if (res && !res.ok && res.code !== 'unconfigured') {
        console.warn('[stratus] sighting report failed', res.code);
      }
    } catch (err) {
      console.warn('[stratus] sighting report failed', err);
    }
  })();
}

// --------------------------------------------------------- launch room (C7)
//
// While a Launch Room is live and the user has the launched tweet open, the
// early replies are right there in the DOM — stream them to the background
// (radar transport pattern: batched flush, per-tweet dedupe, $0). The room
// state lives with the background; we ask it whether a launch is live on a
// 30s throttle instead of reading chrome.storage.session (untrusted context).

const LAUNCH_GET_THROTTLE_MS = 30_000;

let launchTweetId: string | null = null;
let launchCheckedAt = 0;
let launchCheckInFlight = false;
const launchReported = new Set<string>();
const pendingLaunchReplies = new Map<string, EarlyReply>();
let launchFlushTimer: number | null = null;

function refreshActiveLaunch(): void {
  launchCheckInFlight = true;
  const msg: LaunchGet = { type: 'stratus/launch-get' };
  void chrome.runtime
    .sendMessage(msg)
    .then((res: { ok: boolean; active: ActiveLaunch | null } | undefined) => {
      const next = res?.ok && res.active ? res.active.tweetId : null;
      if (next !== launchTweetId) {
        launchTweetId = next;
        launchReported.clear();
        if (next) scheduleScan(); // capture what's already rendered
      }
    })
    .catch(() => {
      /* background asleep mid-navigation — next throttle window retries */
    })
    .finally(() => {
      launchCheckedAt = Date.now();
      launchCheckInFlight = false;
    });
}

function captureLaunchReplies(): void {
  const focusedId = focusedTweetIdFromUrl();
  if (!focusedId) return;
  if (!launchCheckInFlight && Date.now() - launchCheckedAt > LAUNCH_GET_THROTTLE_MS) {
    refreshActiveLaunch();
  }
  if (!launchTweetId || launchTweetId !== focusedId) return;

  const selfHandle = location.pathname.match(/^\/([^/]+)\/status\//)?.[1] ?? null;
  for (const r of parseEarlyReplies(document, focusedId, selfHandle)) {
    if (launchReported.has(r.tweetId) || pendingLaunchReplies.has(r.tweetId)) continue;
    pendingLaunchReplies.set(r.tweetId, r);
  }
  if (pendingLaunchReplies.size > 0 && launchFlushTimer === null) {
    launchFlushTimer = window.setTimeout(flushLaunchReplies, RADAR_FLUSH_MS);
  }
}

function flushLaunchReplies(): void {
  launchFlushTimer = null;
  if (pendingLaunchReplies.size === 0 || !launchTweetId) return;
  const replies = [...pendingLaunchReplies.values()];
  pendingLaunchReplies.clear();
  for (const r of replies) launchReported.add(r.tweetId);

  const msg: LaunchReport = { type: 'stratus/launch-report', tweetId: launchTweetId, replies };
  void (async () => {
    try {
      await chrome.runtime.sendMessage(msg);
    } catch (err) {
      console.warn('[stratus] launch report failed', err);
    }
  })();
}

// --------------------------------------------------------------- scan loop

function scan(root: ParentNode): void {
  const focusedId = focusedTweetIdFromUrl();
  const glance = getGlanceMap();
  for (const article of root.querySelectorAll<HTMLElement>('article[data-testid="tweet"]')) {
    attachButton(article);
    applyBand(article);
    applyPersonChips(article, glance);
    if (focusedId) attachReplyMasterButton(article, focusedId);
  }
  syncContextPanel(focusedId);
  syncAuthorButton();
  capturePassiveHoverCards();
  captureLaunchReplies();
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
  initHarvest();
  initTypeFromClipboard();
  initPassiveCaptureSetting();
  initContextCollapsed();
  scan(document);
  const observer = new MutationObserver(scheduleScan);
  observer.observe(document.body, { childList: true, subtree: true });
}

// --------------------------------------------------- type-from-clipboard
//
// Cmd+B, while a composer / reply box is focused, "types" the clipboard text
// in character by character, so a Grok-drafted reply lands like manual
// keystrokes instead of an instant paste. X's composer is a Draft.js
// contenteditable: setting textContent/value directly is ignored by its
// internal model, so each char goes in via execCommand('insertText'), which
// is exactly the path Draft listens on (its handleBeforeInput). Escape aborts
// an in-flight run; moving focus away stops it too.

const TYPE_CHAR_DELAY_MS = 18;
let typingInFlight = false;
let cancelTyping = false;

function focusedEditable(): HTMLElement | null {
  const el = document.activeElement as HTMLElement | null;
  if (!el) return null;
  if (el.isContentEditable) return el;
  if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') return el;
  return null;
}

function insertChar(target: HTMLElement, ch: string): void {
  if (target.isContentEditable) {
    // Draft.js consumes insertText/insertParagraph through beforeinput.
    const ok =
      ch === '\n'
        ? document.execCommand('insertParagraph')
        : document.execCommand('insertText', false, ch);
    if (!ok) {
      target.dispatchEvent(
        new InputEvent('input', {
          bubbles: true,
          cancelable: true,
          inputType: ch === '\n' ? 'insertLineBreak' : 'insertText',
          data: ch === '\n' ? null : ch,
        }),
      );
    }
    return;
  }
  // Native input/textarea: write through React's value setter so onChange fires.
  const el = target as HTMLInputElement | HTMLTextAreaElement;
  const start = el.selectionStart ?? el.value.length;
  const end = el.selectionEnd ?? el.value.length;
  const next = el.value.slice(0, start) + ch + el.value.slice(end);
  const proto =
    el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  if (setter) setter.call(el, next);
  else el.value = next;
  const caret = start + ch.length;
  el.selectionStart = el.selectionEnd = caret;
  el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: ch }));
}

// Core loop, shared by the Cmd+B shortcut and Reply Master auto-type. Types
// `text` into `target` one char at a time; aborts if Escape was pressed or the
// user moved focus elsewhere mid-run. Returns the count actually typed.
async function typeTextInto(target: HTMLElement, text: string): Promise<number> {
  const normalised = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  if (!normalised) return 0;

  typingInFlight = true;
  cancelTyping = false;
  target.focus();
  let n = 0;
  try {
    for (const ch of Array.from(normalised)) {
      if (cancelTyping) break;
      // Focus moved away (user clicked elsewhere) — stop typing into nothing.
      if (focusedEditable() !== target) break;
      insertChar(target, ch);
      n += 1;
      await sleep(TYPE_CHAR_DELAY_MS);
    }
  } finally {
    typingInFlight = false;
  }
  return n;
}

async function typeClipboardIntoFocused(): Promise<void> {
  if (typingInFlight) return;
  const target = focusedEditable();
  if (!target) return;

  let text = '';
  try {
    text = await navigator.clipboard.readText();
  } catch (err) {
    console.warn('[stratus] clipboard read failed', err);
    return;
  }
  await typeTextInto(target, text);
}

// X's reply composer is a Draft.js contenteditable tagged tweetTextarea_0 (the
// inline reply on a focused tweet; tweetTextarea_0 in the modal too). The
// data-testid element is itself contenteditable, but fall back to a descendant
// in case X re-nests it.
function findReplyEditor(): HTMLElement | null {
  const box = document.querySelector<HTMLElement>('[data-testid^="tweetTextarea_"]');
  if (!box) return null;
  if (box.isContentEditable) return box;
  return box.querySelector<HTMLElement>('[contenteditable="true"]');
}

const AUTOTYPE_SETTING_KEY = 'autoTypeReplyDraft';

async function autoTypeReplyEnabled(): Promise<boolean> {
  try {
    const out = await chrome.storage.local.get(AUTOTYPE_SETTING_KEY);
    return out[AUTOTYPE_SETTING_KEY] === true;
  } catch {
    return false;
  }
}

function onTypeShortcut(e: KeyboardEvent): void {
  if (e.key === 'Escape' && typingInFlight) {
    cancelTyping = true;
    return;
  }
  // Cmd+B (Mac) — modifier-exact so we don't swallow unrelated combos.
  const isCmdB =
    e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey && (e.key === 'b' || e.key === 'B');
  if (!isCmdB) return;
  // Not in an editor — let Cmd+B do whatever the page wants.
  if (!focusedEditable()) return;
  e.preventDefault();
  e.stopPropagation();
  void typeClipboardIntoFocused();
}

function initTypeFromClipboard(): void {
  // Capture phase so we intercept before Draft.js turns Cmd+B into bold.
  document.addEventListener('keydown', onTypeShortcut, true);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', start, { once: true });
} else {
  start();
}
