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
// "🗂 Canned" (RL.9) is a third: the reply-list picker on a focused tweet's
// action row — one click spends a pick server-side and types it into the reply
// composer. See the section near the variant chips.

import { suggestChannels } from './channelSuggest.ts';
import { extractArticle, initHarvest, isHarvestActive } from './harvester.ts';
import { classifyBand, textLooksLikeReplyBait } from './replyBand.ts';
import type { BandThresholds, TweetSignals } from './replyBand.ts';
import {
  type ExtractedActiveTimes,
  extractActiveTimesSection,
  gridsEqual,
  parseHeatColors,
} from './shared/activeTimes.ts';
import { parseEarlyReplies } from './shared/earlyReplies.ts';
import { GLANCE_TTL_MS, buildPersonChips, isReciprocityPerson } from './shared/glance.ts';
import type { GlanceMap } from './shared/glance.ts';
import type { HarvestIngestRow } from './shared/harvest.ts';
import type { ActiveLaunch, EarlyReply } from './shared/launch.ts';
import type {
  ApiRequest,
  ApiResponse,
  LaunchGet,
  LaunchReport,
  NotifContextGet,
  NotifContextMap,
  NotifContextResponse,
  OpenPerson,
  RadarReport,
  RadarVariantPasted,
  RadarVariantsGet,
} from './shared/messages.ts';
import { parseMetricsAria, reportUnparsed } from './shared/metricsAria.ts';
import { parseNotificationCell } from './shared/notifications.ts';
import type { EngagementKind } from './shared/notifications.ts';
import {
  PASSIVE_BATCH_MAX,
  PASSIVE_FLUSH_MS,
  PASSIVE_HARVEST_KEY,
  isHomeTimelinePath,
  shouldRecordPassive,
  toPassiveIngestRow,
} from './shared/passiveHarvest.ts';
import { personTierFor } from './shared/radar.ts';
import type { PersonTier, RadarBand, RadarSighting, RankMap } from './shared/radar.ts';
import { REPLY_FOCUS_KEY, shouldFocusReply } from './shared/replyFocus.ts';
import { SERVER_DEFAULTS, SERVER_SETTINGS_KEY, readServerConfig } from './shared/serverSettings.ts';
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
  ReplyListSummary,
  ReplyVariant,
  ScrapeBody,
  ScrapedAuthor,
  ScrapedTweet,
  TopComment,
  UseReplyResponse,
} from './shared/types.ts';
import { isReplyVariants, variantChipPreview } from './shared/variantChips.ts';

const BUTTON_CLASS = 'stratus-save-btn';
const REPLY_BTN_CLASS = 'stratus-reply-master-btn';
const AUTHOR_BTN_CLASS = 'stratus-save-author-btn';
// UI.18 — every stratus control on a tweet's action row lives in ONE cluster
// appended to that row, not as four independently-appended pills. X's action row
// is a flex line with no slack: four labelled pills wrapped it onto a second line
// and collided with the "View quotes" affordance. Members are icon-only at rest
// (`.stratus-act`, 30px hit target, X's own icon language) and expand to show
// their status label only while they have something to report.
const ACTIONS_CLASS = 'stratus-actions';
const ACT_CLASS = 'stratus-act';
const ACT_LABEL_CLASS = 'stratus-act-lbl';
const ACT_CARET_CLASS = 'stratus-act-caret';
// Fixed left-to-right order regardless of which scan pass injected which button.
const ACT_ORDER = { save: 1, radar: 2, reply: 3, canned: 4 } as const;
const CHAN_CHIP_CLASS = 'stratus-chan-chip';
const CHAN_WRAP_CLASS = 'stratus-chan-chips';
const PERSON_CHIPS_CLASS = 'stratus-person-chips';
const PERSON_CHIP_CLASS = 'stratus-person-chip';
const CONTEXT_PANEL_CLASS = 'stratus-context-panel';
// On-page radar variant chips (RU.7).
const VARIANT_CHIPS_CLASS = 'stratus-variant-chips';
const VARIANT_CHIP_CLASS = 'stratus-variant-chip';
const VARIANT_ANGLE_CLASS = 'stratus-variant-angle';
const VARIANT_PREVIEW_CLASS = 'stratus-variant-preview';
const VARIANT_HINT_CLASS = 'stratus-variant-hint';
// On-page canned-reply picker (RL.9) — the reply-list end of the feature, on
// the tweet's own action row.
const CANNED_BTN_CLASS = 'stratus-canned-btn';
const CANNED_POP_CLASS = 'stratus-canned-pop';
const CANNED_ITEM_CLASS = 'stratus-canned-item';
const CANNED_NAME_CLASS = 'stratus-canned-name';
const CANNED_META_CLASS = 'stratus-canned-meta';
const CANNED_TEXT_CLASS = 'stratus-canned-text';
const CANNED_HINT_CLASS = 'stratus-canned-hint';
const CANNED_HEAD_CLASS = 'stratus-canned-head';
const CANNED_TITLE_CLASS = 'stratus-canned-title';
const CANNED_CLOSE_CLASS = 'stratus-canned-close';
const CANNED_BODY_CLASS = 'stratus-canned-body';
const RADAR_ADD_CLASS = 'stratus-radar-add-btn';
const STYLE_ID = 'stratus-save-style';
const STATUS_PERSIST_MS = 2500;
const REPLY_MASTER_STORAGE_KEY = 'replyMaster:lastDraft';
const REPLY_SYSTEM_PROMPT_KEY = 'replyMaster:systemPromptOverride';
const REPLY_IDEA_KEY = 'replyMaster:idea';
// C6: set when the steer was picked from the Idea Inbox dropdown — rides along
// as `ideaId` so the server consumes the stored idea (status flip + backlink).
const REPLY_IDEA_ID_KEY = 'replyMaster:ideaId';
const REPLY_TOP_COMMENTS_MAX = 10;
// Idle labels are the accessible name / tooltip now, not painted text — the
// buttons only render them when a status has to be read (UI.18).
const REPLY_BTN_LABEL = 'Reply Master';
const CANNED_BTN_LABEL = 'Canned';
// One GET serves a browsing session's worth of opens; short enough that a list
// created in the panel shows up without a page reload.
const CANNED_CACHE_TTL_MS = 60_000;
const SAVE_BTN_LABEL = 'Save to stratus';
const RADAR_BTN_LABEL = 'Add to Radar';
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

// UI.16 — the ONE palette every injected overlay reads. These are deliberately
// NOT the panel's `--strat-*` tokens: overlays sit on X's own timeline (white /
// dim / black, the user's choice) so they must be theme-neutral, which is what
// the `rgb()` + low-alpha-fill pairs buy. Values are X's companion palette (the
// DS `--x-*` block: blue #1d9bf0, muted #71767b, red #f4212e) plus the band
// signal colors the side panel mirrors in `--strat-band-*`.
//
// Alpha ramp, uniform across tones: `-line` = the 1px outline, `-fill` = the
// tinted background, `-hairline` = a structural divider. A future chip family
// (augmented-x-ui, notifications) adds a tone here and references it — never a
// fresh literal, or the two families drift apart one hex at a time.
const OVERLAY_TOKENS = `
    :root {
      --stratus-font: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;

      --stratus-muted: rgb(113, 118, 123);
      --stratus-muted-line: rgba(113, 118, 123, 0.4);
      --stratus-muted-fill: rgba(113, 118, 123, 0.12);
      --stratus-muted-hairline: rgba(113, 118, 123, 0.3);

      --stratus-blue: rgb(29, 155, 240);
      --stratus-blue-line: rgba(29, 155, 240, 0.5);
      --stratus-blue-fill: rgba(29, 155, 240, 0.12);

      --stratus-hot: rgb(0, 186, 124);
      --stratus-hot-line: rgba(0, 186, 124, 0.5);
      --stratus-hot-fill: rgba(0, 186, 124, 0.12);

      --stratus-warm: rgb(255, 179, 0);
      --stratus-warm-text: rgb(214, 150, 0);
      --stratus-warm-line: rgba(255, 179, 0, 0.5);
      --stratus-warm-fill: rgba(255, 179, 0, 0.12);

      --stratus-danger: rgb(244, 33, 46);
      --stratus-danger-fill: rgba(244, 33, 46, 0.12);

      --stratus-pillar: rgb(170, 100, 220);
      --stratus-pillar-hover: rgb(192, 132, 232);
      --stratus-pillar-line: rgba(170, 100, 220, 0.5);
      --stratus-pillar-fill: rgba(170, 100, 220, 0.12);
    }`;

// ------------------------------------------------------- action-row icons (UI.18)
//
// 24×24 stroke glyphs drawn in X's own icon language (currentColor, round caps),
// built through createElementNS rather than innerHTML: x.com enforces Trusted
// Types, and an isolated world is not a licence to reach for an HTML sink.
const SVG_NS = 'http://www.w3.org/2000/svg';

/** Upload-to-cloud — "save to stratus", the app's own namesake glyph. */
const ICON_SAVE = [
  'M20.4 18.4A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3.5 16.3',
  'M16 16l-4-4-4 4',
  'M12 12v9',
];
/** Sparkle — a generated draft, the same signal the panel uses for AI actions. */
const ICON_WAND = ['M12 3.2l1.7 4.6 4.6 1.7-4.6 1.7L12 15.8l-1.7-4.6L5.7 9.5l4.6-1.7z'];
const ICON_WAND_SPARK = ['M18.4 14.6l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z'];
/** Stacked lines — a list of premade replies. */
const ICON_LIST = ['M4.5 7.5h13', 'M4.5 12h13', 'M4.5 16.5h8'];
const ICON_PLUS_CIRCLE = ['M12 3.5a8.5 8.5 0 1 1 0 17 8.5 8.5 0 0 1 0-17z', 'M12 8v8', 'M8 12h8'];
const ICON_CLOSE = ['M6 6l12 12', 'M18 6L6 18'];

function svgIcon(paths: string[], opts: { size?: number; filled?: boolean } = {}): SVGSVGElement {
  const size = opts.size ?? 17;
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.setAttribute('fill', opts.filled ? 'currentColor' : 'none');
  if (!opts.filled) {
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '1.8');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
  }
  for (const d of paths) {
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', d);
    svg.appendChild(path);
  }
  return svg;
}

/** The one action cluster per action row — created on first use, shared by all
 *  four controls so they stay one visually-grouped unit in a fixed order. */
function actionCluster(actionRow: Element): HTMLElement {
  const existing = actionRow.querySelector<HTMLElement>(`:scope > .${ACTIONS_CLASS}`);
  if (existing) return existing;
  const wrap = document.createElement('div');
  wrap.className = ACTIONS_CLASS;
  actionRow.appendChild(wrap);
  return wrap;
}

interface ActButtonSpec {
  icons: SVGSVGElement[];
  tone: 'muted' | 'blue' | 'pillar';
  order: number;
  title: string;
  label: string;
  extraClass?: string;
  caret?: boolean;
}

/** Icon at rest, icon + status label while reporting. The label element always
 *  exists so `setActLabel` never has to rebuild the face (and blow away the
 *  icon, which is what plain `textContent =` did before UI.18). */
function makeActButton(spec: ActButtonSpec): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = spec.extraClass ? `${ACT_CLASS} ${spec.extraClass}` : ACT_CLASS;
  btn.dataset.tone = spec.tone;
  btn.dataset.state = 'idle';
  btn.style.order = String(spec.order);
  btn.title = spec.title;
  btn.append(...spec.icons);
  if (spec.caret) {
    const caret = document.createElement('span');
    caret.className = ACT_CARET_CLASS;
    caret.setAttribute('aria-hidden', 'true');
    caret.textContent = '▾';
    btn.appendChild(caret);
  }
  const label = document.createElement('span');
  label.className = ACT_LABEL_CLASS;
  btn.appendChild(label);
  setActLabel(btn, spec.label);
  return btn;
}

/** Writes the status line without touching the icon; the accessible name tracks
 *  it so a screen reader hears the same thing sighted users read. */
function setActLabel(btn: HTMLButtonElement, label: string): void {
  const el = btn.querySelector<HTMLElement>(`.${ACT_LABEL_CLASS}`);
  // Buttons outside the cluster (the profile-page "save author" pill) are plain
  // labelled pills with no icon to protect, so they take the text directly.
  if (el) el.textContent = label;
  else btn.textContent = label;
  btn.setAttribute('aria-label', label);
}

function injectStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `${OVERLAY_TOKENS}
    /* UI.18 — the action cluster. One flex island at the end of X's action row,
       hairline-separated from X's native icons so it reads as "another app's
       controls" instead of four stray pills competing with them. */
    .${ACTIONS_CLASS} {
      display: inline-flex;
      align-items: center;
      gap: 2px;
      flex: 0 0 auto;
      margin-left: 8px;
      padding-left: 8px;
      border-left: 1px solid var(--stratus-muted-hairline);
      vertical-align: middle;
    }
    .${ACT_CLASS} {
      all: unset;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 5px;
      box-sizing: border-box;
      cursor: pointer;
      min-width: 30px;
      height: 30px;
      padding: 0 6px;
      border-radius: 9999px;
      border: 1px solid transparent;
      background: transparent;
      font: 600 12px/1 var(--stratus-font);
      letter-spacing: 0.01em;
      color: var(--stratus-muted);
      transition: color 120ms, background 120ms, border-color 120ms;
    }
    .${ACT_CLASS} svg { display: block; flex: 0 0 auto; }
    .${ACT_CARET_CLASS} { font-size: 9px; line-height: 1; opacity: 0.75; }
    /* Compact at rest; the button widens only while it has a status to report,
       which is what keeps four controls inside one un-wrapped row. */
    .${ACT_LABEL_CLASS} { display: none; white-space: nowrap; }
    .${ACT_CLASS}[data-state]:not([data-state="idle"]) .${ACT_LABEL_CLASS} { display: inline; }
    .${ACT_CLASS}[data-tone="blue"]   { color: var(--stratus-blue); }
    .${ACT_CLASS}[data-tone="pillar"] { color: var(--stratus-pillar); }
    .${ACT_CLASS}[data-tone="muted"]:hover,
    .${ACT_CLASS}[data-tone="blue"]:hover,
    .${ACT_CLASS}[data-tone="blue"][aria-expanded="true"] {
      color: var(--stratus-blue);
      background: var(--stratus-blue-fill);
    }
    .${ACT_CLASS}[data-tone="pillar"]:hover {
      color: var(--stratus-pillar-hover);
      background: var(--stratus-pillar-fill);
    }
    .${ACT_CLASS}:focus-visible { border-color: currentColor; }
    .${ACT_CLASS}[data-state="saving"],
    .${ACT_CLASS}[data-state="working"] {
      color: var(--stratus-muted);
      background: var(--stratus-muted-fill);
      cursor: progress;
    }
    .${ACT_CLASS}[data-state="saved"],
    .${ACT_CLASS}[data-state="added"],
    .${ACT_CLASS}[data-state="done"] {
      color: var(--stratus-hot);
      background: var(--stratus-hot-fill);
    }
    .${ACT_CLASS}[data-state="failed"] {
      color: var(--stratus-danger);
      background: var(--stratus-danger-fill);
    }
    /* Profile-page "save author" keeps its labelled-pill shape — it sits in a
       header with room to spare, not in the action row's flex crush. */
    .${AUTHOR_BTN_CLASS} {
      all: unset;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      box-sizing: border-box;
      cursor: pointer;
      font: 600 13px/1 var(--stratus-font);
      letter-spacing: 0.02em;
      padding: 6px 14px;
      border-radius: 9999px;
      color: var(--stratus-muted);
      border: 1px solid var(--stratus-muted-line);
      background: transparent;
      margin-left: 6px;
      transition: color 120ms, border-color 120ms, background 120ms;
    }
    .${AUTHOR_BTN_CLASS}:hover {
      color: var(--stratus-blue);
      border-color: var(--stratus-blue);
      background: var(--stratus-blue-fill);
    }
    .${AUTHOR_BTN_CLASS}[data-state="saving"] {
      color: var(--stratus-muted);
      border-color: var(--stratus-muted-line);
      cursor: progress;
    }
    .${AUTHOR_BTN_CLASS}[data-state="saved"] {
      color: var(--stratus-hot);
      border-color: var(--stratus-hot);
      background: var(--stratus-hot-fill);
    }
    .${AUTHOR_BTN_CLASS}[data-state="failed"] {
      color: var(--stratus-danger);
      border-color: var(--stratus-danger);
      background: var(--stratus-danger-fill);
    }
    article[data-testid="tweet"][data-stratus-band="hot"]  { box-shadow: inset 4px 0 0 var(--stratus-hot); }
    article[data-testid="tweet"][data-stratus-band="warm"] { box-shadow: inset 4px 0 0 var(--stratus-warm); }
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
      font: 600 11px/1 var(--stratus-font);
      letter-spacing: 0.02em;
      padding: 2px 7px;
      border-radius: 9999px;
      white-space: nowrap;
      border: 1px solid transparent;
    }
    .${PERSON_CHIP_CLASS}[data-tone="ally"]      { color: var(--stratus-hot);       border-color: var(--stratus-hot-line);   background: var(--stratus-hot-fill); }
    .${PERSON_CHIP_CLASS}[data-tone="mutual"]    { color: var(--stratus-blue);      border-color: var(--stratus-blue-line);  background: var(--stratus-blue-fill); }
    .${PERSON_CHIP_CLASS}[data-tone="responded"] { color: var(--stratus-warm-text); border-color: var(--stratus-warm-line);  background: var(--stratus-warm-fill); }
    .${PERSON_CHIP_CLASS}[data-tone="engaged"]   { color: var(--stratus-muted);     border-color: var(--stratus-muted-line); background: var(--stratus-muted-fill); }
    .${PERSON_CHIP_CLASS}[data-tone="target"]    { color: var(--stratus-blue);      border-color: var(--stratus-blue-line);  background: var(--stratus-blue-fill); }
    .${PERSON_CHIP_CLASS}[data-tone="warn"]      { color: var(--stratus-warm-text); border-color: var(--stratus-warm-line);  background: var(--stratus-warm-fill); }
    .${PERSON_CHIP_CLASS}:hover { filter: brightness(1.15); }
    /* Notifications surface (C10). Muted gray reads on both X themes, same as
       every other injected control here. */
    .${NOTIF_CTX_CLASS} {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 6px;
      margin-top: 4px;
      font: 400 12px/1.3 var(--stratus-font);
      color: var(--stratus-muted);
    }
    .stratus-notif-ctx-quote { font-style: italic; }
    .stratus-notif-answered {
      display: inline-flex;
      align-items: center;
      padding: 1px 6px;
      border-radius: 9999px;
      font-weight: 600;
      color: var(--stratus-hot);
      border: 1px solid var(--stratus-hot-line);
      background: var(--stratus-hot-fill);
    }
    .${NOTIF_TIERS_CLASS} {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 4px;
      margin-top: 4px;
    }
    .${NOTIF_TIER_CLASS} {
      all: unset;
      display: inline-flex;
      align-items: center;
      box-sizing: border-box;
      cursor: pointer;
      font: 600 11px/1 var(--stratus-font);
      letter-spacing: 0.02em;
      padding: 2px 7px;
      border-radius: 9999px;
      white-space: nowrap;
      border: 1px solid transparent;
    }
    .${NOTIF_TIER_CLASS}[data-tone="ally"]   { color: var(--stratus-hot);       border-color: var(--stratus-hot-line);  background: var(--stratus-hot-fill); }
    .${NOTIF_TIER_CLASS}[data-tone="mutual"] { color: var(--stratus-blue);      border-color: var(--stratus-blue-line); background: var(--stratus-blue-fill); }
    .${NOTIF_TIER_CLASS}[data-tone="target"] { color: var(--stratus-warm-text); border-color: var(--stratus-warm-line); background: var(--stratus-warm-fill); }
    .${NOTIF_TIER_CLASS}:hover { filter: brightness(1.15); }
    .${NOTIF_SYNC_CLASS} {
      all: unset;
      display: inline-flex;
      align-items: center;
      box-sizing: border-box;
      cursor: pointer;
      font: 600 12px/1 var(--stratus-font);
      letter-spacing: 0.02em;
      padding: 4px 10px;
      border-radius: 9999px;
      margin-left: 10px;
      white-space: nowrap;
      color: var(--stratus-muted);
      border: 1px solid var(--stratus-muted-line);
      background: transparent;
      transition: color 120ms, border-color 120ms, background 120ms;
    }
    .${NOTIF_SYNC_CLASS}:hover {
      color: var(--stratus-blue);
      border-color: var(--stratus-blue);
      background: var(--stratus-blue-fill);
    }
    .${NOTIF_SYNC_CLASS}[data-state="working"] { cursor: progress; }
    .${NOTIF_SYNC_CLASS}[data-state="done"] {
      color: var(--stratus-hot);
      border-color: var(--stratus-hot);
      background: var(--stratus-hot-fill);
    }
    .${NOTIF_SYNC_CLASS}[data-state="failed"] {
      color: var(--stratus-danger);
      border-color: var(--stratus-danger);
      background: var(--stratus-danger-fill);
    }
    .${CHAN_WRAP_CLASS} { display: inline-flex; gap: 4px; margin-left: 4px; align-items: center; }
    .${CHAN_CHIP_CLASS} {
      all: unset;
      display: inline-flex;
      align-items: center;
      box-sizing: border-box;
      cursor: pointer;
      font: 600 11px/1 var(--stratus-font);
      letter-spacing: 0.02em;
      padding: 3px 8px;
      border-radius: 9999px;
      color: var(--stratus-blue);
      border: 1px dashed var(--stratus-blue-line);
      background: transparent;
      white-space: nowrap;
    }
    .${CHAN_CHIP_CLASS}:hover { background: var(--stratus-blue-fill); }
    .${CHAN_CHIP_CLASS}[data-state="tagged"] {
      color: var(--stratus-hot);
      border: 1px solid var(--stratus-hot);
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
      border-top: 1px solid var(--stratus-muted-hairline);
      font: 400 13px/1.4 var(--stratus-font);
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
    .stratus-ctx-since { color: var(--stratus-muted); font-size: 12px; }
    .stratus-ctx-toggle {
      all: unset;
      cursor: pointer;
      color: var(--stratus-muted);
      font-size: 13px;
      line-height: 1;
      padding: 2px 6px;
      border-radius: 6px;
    }
    .stratus-ctx-toggle:hover { background: var(--stratus-muted-fill); }
    .${CONTEXT_PANEL_CLASS}[data-collapsed="true"] .stratus-ctx-body { display: none; }
    .stratus-ctx-body {
      display: flex;
      flex-direction: column;
      gap: 8px;
      margin-top: 8px;
    }
    .stratus-ctx-meta { color: var(--stratus-muted); font-size: 12px; }
    .stratus-ctx-tags { display: flex; flex-wrap: wrap; gap: 4px; }
    .stratus-ctx-tag {
      font-size: 11px;
      padding: 1px 7px;
      border-radius: 9999px;
      color: var(--stratus-muted);
      border: 1px solid var(--stratus-muted-hairline);
    }
    .stratus-ctx-banner {
      font-size: 12px;
      padding: 4px 8px;
      border-radius: 6px;
      color: var(--stratus-hot);
      background: var(--stratus-hot-fill);
    }
    .stratus-ctx-row { display: flex; flex-direction: column; gap: 3px; }
    .stratus-ctx-label {
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      color: var(--stratus-muted);
    }
    .stratus-ctx-val { font-size: 13px; }
    .stratus-ctx-list { display: flex; flex-direction: column; gap: 4px; }
    .stratus-ctx-loop { font-size: 12px; }
    .stratus-ctx-outcome { display: flex; flex-direction: column; gap: 1px; }
    .stratus-ctx-outcome-text { font-size: 12px; }
    .stratus-ctx-outcome-meta { font-size: 11px; color: var(--stratus-muted); }
    .stratus-ctx-notes {
      font-size: 12px;
      color: var(--stratus-muted);
      white-space: pre-wrap;
      border-left: 2px solid var(--stratus-muted-hairline);
      padding-left: 8px;
    }
    .stratus-ctx-empty { font-size: 12px; color: var(--stratus-muted); }
    .${VARIANT_CHIPS_CLASS} {
      display: inline-flex;
      flex-direction: column;
      align-items: stretch;
      gap: 4px;
      margin-left: 8px;
      max-width: 260px;
      vertical-align: middle;
    }
    .${VARIANT_CHIP_CLASS} {
      all: unset;
      display: inline-flex;
      align-items: baseline;
      gap: 6px;
      box-sizing: border-box;
      cursor: pointer;
      max-width: 100%;
      font: 400 12px/1.2 var(--stratus-font);
      padding: 3px 9px;
      border-radius: 9999px;
      color: var(--stratus-pillar);
      border: 1px solid var(--stratus-pillar-line);
      background: transparent;
      transition: color 120ms, border-color 120ms, background 120ms;
    }
    .${VARIANT_CHIP_CLASS}:hover { background: var(--stratus-pillar-fill); }
    .${VARIANT_CHIP_CLASS}[data-active="1"] {
      color: var(--stratus-hot);
      border-color: var(--stratus-hot);
      background: var(--stratus-hot-fill);
    }
    .${VARIANT_ANGLE_CLASS} {
      flex: 0 0 auto;
      font-weight: 600;
      font-size: 11px;
      letter-spacing: 0.02em;
      text-transform: uppercase;
    }
    .${VARIANT_PREVIEW_CLASS} {
      flex: 1 1 auto;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      color: var(--stratus-muted);
    }
    .${VARIANT_HINT_CLASS} { font-size: 11px; color: var(--stratus-muted); }
    .${VARIANT_HINT_CLASS}:empty { display: none; }
    /* The popover is portalled to <body> and positioned in viewport coordinates
       (UI.18): anchored absolutely inside the action row it was clipped by X's
       own overflow and buried under the "View quotes" affordance. Fixed +
       flip-up + viewport clamp means it is always fully on screen. */
    .${CANNED_POP_CLASS} {
      position: fixed;
      top: 0;
      left: 0;
      z-index: 2147483000;
      width: max-content;
      min-width: 260px;
      max-width: 360px;
      box-sizing: border-box;
      display: flex;
      flex-direction: column;
      padding: 6px;
      border-radius: 14px;
      border: 1px solid var(--stratus-muted-line);
      /* Overwritten inline with the page's own computed colors (X ships three
         themes and exposes no stable surface variable); these are the fallback. */
      background: Canvas;
      color: CanvasText;
      box-shadow: 0 12px 32px rgba(0, 0, 0, 0.45), 0 2px 6px rgba(0, 0, 0, 0.2);
      font: 400 13px/1.35 var(--stratus-font);
      overflow: hidden;
    }
    .${CANNED_HEAD_CLASS} {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 4px 4px 8px 8px;
      border-bottom: 1px solid var(--stratus-muted-hairline);
      margin-bottom: 6px;
      flex: 0 0 auto;
    }
    .${CANNED_TITLE_CLASS} {
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: var(--stratus-muted);
    }
    .${CANNED_CLOSE_CLASS} {
      all: unset;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      width: 24px;
      height: 24px;
      border-radius: 9999px;
      color: var(--stratus-muted);
      transition: color 120ms, background 120ms;
    }
    .${CANNED_CLOSE_CLASS}:hover { color: var(--stratus-danger); background: var(--stratus-danger-fill); }
    .${CANNED_BODY_CLASS} {
      display: flex;
      flex-direction: column;
      gap: 2px;
      min-height: 0;
      overflow-y: auto;
      overscroll-behavior: contain;
      padding: 0 2px 2px;
    }
    .${CANNED_ITEM_CLASS} {
      all: unset;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      box-sizing: border-box;
      cursor: pointer;
      padding: 8px 10px;
      border-radius: 9px;
      color: inherit;
      transition: background 120ms, color 120ms;
    }
    .${CANNED_ITEM_CLASS}:hover { background: var(--stratus-blue-fill); color: var(--stratus-blue); }
    .${CANNED_ITEM_CLASS}[aria-disabled="true"] { cursor: not-allowed; opacity: 0.45; }
    .${CANNED_ITEM_CLASS}[aria-disabled="true"]:hover { background: transparent; color: inherit; }
    .${CANNED_NAME_CLASS} { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .${CANNED_META_CLASS} {
      font-size: 10px;
      font-weight: 600;
      letter-spacing: 0.02em;
      color: var(--stratus-muted);
      white-space: nowrap;
      padding: 2px 7px;
      border-radius: 9999px;
      border: 1px solid var(--stratus-muted-hairline);
    }
    .${CANNED_TEXT_CLASS} {
      margin: 4px 0;
      padding: 8px 10px;
      border-radius: 9px;
      border: 1px solid var(--stratus-muted-hairline);
      background: var(--stratus-muted-fill);
      white-space: pre-wrap;
      overflow-wrap: anywhere;
    }
    .${CANNED_HINT_CLASS} { font-size: 11px; color: var(--stratus-muted); padding: 2px 4px; }
    .${CANNED_HINT_CLASS}:empty { display: none; }
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
  // The cluster orders its children explicitly (UI.18) — without a matching
  // order the chips would flex to the front of the row instead of sitting
  // beside the save button they belong to.
  wrap.style.order = String(ACT_ORDER.save);
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
  setActLabel(btn, label);
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

  const btn = makeActButton({
    icons: [svgIcon(ICON_SAVE)],
    tone: 'muted',
    order: ACT_ORDER.save,
    title: 'Save this tweet to the stratus voice library',
    label: SAVE_BTN_LABEL,
    extraClass: BUTTON_CLASS,
  });
  setState(btn, 'idle', SAVE_BTN_LABEL);
  btn.addEventListener('click', (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    void onSaveClick(btn);
  });

  actionCluster(actionRow).appendChild(btn);
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
    ...(sig ? { signals: { band: classifyBand(sig, bandThresholds), ...sig } } : {}),
  };
}

function setReplyState(
  btn: HTMLButtonElement,
  state: 'idle' | 'working' | 'done' | 'failed',
  label: string,
): void {
  btn.dataset.state = state;
  setActLabel(btn, label);
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
    setReplyState(btn, 'working', 'Filling…');
    const mode = await deliverToReplyBox(replyText);
    setReplyState(
      btn,
      'done',
      mode === 'inserted' ? 'Typed ✓' : mode === 'copied' ? 'Copied — press ⌘V' : 'Copy manually',
    );
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

  const btn = makeActButton({
    icons: [svgIcon([...ICON_WAND, ...ICON_WAND_SPARK], { filled: true })],
    tone: 'pillar',
    order: ACT_ORDER.reply,
    title: 'Reply Master — generate a Grok-assisted reply',
    label: REPLY_BTN_LABEL,
    extraClass: REPLY_BTN_CLASS,
  });
  setReplyState(btn, 'idle', REPLY_BTN_LABEL);
  btn.addEventListener('click', (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    void onReplyMasterClick(btn);
  });

  actionCluster(actionRow).appendChild(btn);
  replyMasterHandled.add(actionRow);
}

// -------------------------------------------------- on-page variant chips (RU.7)
//
// When a radar-drafted tweet's status page is open, inject a strip of angle
// chips (extends / contrarian / debate) next to its action row. Clicking a chip
// copies that variant and marks the draft posted — the radar reply becomes a
// measured reply_drafts row. Posting stays manual (§7.28): the chip only puts
// the text on the clipboard; the human pastes it and hits Reply.
//
// RD.3: the chip deliberately does NOT fill X's composer. Even the verified
// single-shot fill (`deliverToReplyBox`) lands wrong often enough on this
// surface — a half-filled Draft.js editor is worse than a clean ⌘V, and the
// text is on the clipboard either way. The Reply Master button and the canned
// picker still fill, since a failed fill there falls back the same way.

// tweetId → variants (null = fetched, none). Fetched once per tweetId (a drafted
// tweet's variants don't change within a session; a page reload clears this).
const variantCache = new Map<string, ReplyVariant[] | null>();
const variantFetchInFlight = new Set<string>();
const variantChipsHandled = new WeakSet<Element>();

function syncVariantChips(focusedId: string | null): void {
  if (!focusedId) return;
  for (const article of document.querySelectorAll<HTMLElement>('article[data-testid="tweet"]')) {
    const permalink = findPermalink(article);
    if (!permalink || permalink.tweetId !== focusedId) continue;
    const reply = article.querySelector('[data-testid="reply"]');
    if (!reply) return;
    const actionRow = reply.closest('div[role="group"]');
    if (!actionRow || variantChipsHandled.has(actionRow)) return;

    if (!variantCache.has(focusedId)) {
      requestVariants(focusedId); // chips inject on the re-scan after it resolves
      return;
    }
    const variants = variantCache.get(focusedId);
    if (!variants || variants.length === 0) return; // fetched, no radar variants
    injectVariantChips(actionRow, focusedId, variants);
    variantChipsHandled.add(actionRow);
    return;
  }
}

function requestVariants(tweetId: string): void {
  if (variantFetchInFlight.has(tweetId)) return;
  variantFetchInFlight.add(tweetId);
  const msg: RadarVariantsGet = { type: 'stratus/radar-variants-get', tweetId };
  void chrome.runtime
    .sendMessage(msg)
    .then((res: { ok?: boolean; variants?: unknown } | undefined) => {
      variantCache.set(tweetId, res?.ok && isReplyVariants(res.variants) ? res.variants : null);
    })
    .catch((err) => {
      console.warn('[stratus] radar variants-get failed', err);
      variantCache.set(tweetId, null);
    })
    .finally(() => {
      variantFetchInFlight.delete(tweetId);
      scheduleScan();
    });
}

function injectVariantChips(actionRow: Element, tweetId: string, variants: ReplyVariant[]): void {
  const strip = document.createElement('div');
  strip.className = VARIANT_CHIPS_CLASS;
  strip.dataset.tweetId = tweetId;
  for (const v of variants) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = VARIANT_CHIP_CLASS;
    btn.title = v.text;
    const angleEl = document.createElement('span');
    angleEl.className = VARIANT_ANGLE_CLASS;
    angleEl.textContent = v.angle;
    const previewEl = document.createElement('span');
    previewEl.className = VARIANT_PREVIEW_CLASS;
    previewEl.textContent = variantChipPreview(v.text);
    btn.append(angleEl, previewEl);
    btn.addEventListener('click', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      void onVariantChipClick(btn, strip, tweetId, v.text);
    });
    strip.appendChild(btn);
  }
  const hint = document.createElement('span');
  hint.className = VARIANT_HINT_CLASS;
  strip.appendChild(hint);
  actionRow.appendChild(strip);
}

// Empty X's reply composer before filling it — select-all + delete only when
// it's non-empty (don't fight an empty editor's selection). The selection is
// built with a Range rather than `execCommand('selectAll')`, which reaches for
// the document when the editor hasn't taken focus yet.
function clearReplyEditor(editor: HTMLElement): void {
  editor.focus();
  if (editorText(editor).trim() === '') return;
  selectAllIn(editor);
  document.execCommand('delete');
}

async function onVariantChipClick(
  btn: HTMLButtonElement,
  strip: HTMLElement,
  tweetId: string,
  text: string,
): Promise<void> {
  for (const el of strip.querySelectorAll<HTMLElement>(`.${VARIANT_CHIP_CLASS}`)) {
    el.removeAttribute('data-active');
  }
  btn.dataset.active = '1';
  const hint = strip.querySelector<HTMLElement>(`.${VARIANT_HINT_CLASS}`);

  if (hint) hint.textContent = DELIVER_HINT[await copyForPaste(text)];

  // Confirm-if-needed + flip to posted happens in the background (single
  // Authorization owner). Best-effort — the text is already on the clipboard.
  const msg: RadarVariantPasted = { type: 'stratus/radar-variant-pasted', tweetId, text };
  try {
    await chrome.runtime.sendMessage(msg);
  } catch (err) {
    console.warn('[stratus] variant paste report failed', err);
  }
}

// ------------------------------------------ on-page canned replies (RL.9)
//
// The reply-list feature's one-click end, on x.com itself: a "Canned" button on
// the focused tweet's action row opens the lists defined in the side panel, and
// one click on a list types a pick straight into the reply composer.
//
// Deliberately dumb, exactly like the panel's QuickReplyPicker (RL.6 Decision
// 1): the page NEVER picks. One click is one `POST /use`, and the server owns
// the anti-repeat shuffle, the {name}/{first_name}/{handle} fill and the
// humanizer jitter, then hands back finished text. Picking here — or sending
// `preview: true` to dodge "spending" an item — would fork the anti-repeat state
// the DB is the only copy of, and the same line would come back twice.
//
// Posting stays manual (§7.28): the click fills the composer, the human hits
// Reply.

const cannedHandled = new WeakSet<Element>();
let cannedCache: { lists: ReplyListSummary[]; at: number } | null = null;
let cannedInflight: Promise<ReplyListSummary[]> | null = null;
// The one open popover, so a second button (or a click anywhere else) closes it.
// It is portalled to <body>, so the button it belongs to is tracked separately —
// there is no parent chain to walk back up any more.
let openCannedPop: HTMLElement | null = null;
let openCannedBtn: HTMLButtonElement | null = null;
let cannedOutsideBound = false;
/** Breathing room between the button and the popover, and popover-to-viewport. */
const CANNED_POP_GAP = 8;
const CANNED_POP_MARGIN = 10;
/** Below this the popover isn't worth showing downward — flip it above instead. */
const CANNED_POP_MIN_H = 180;

/** Mirrors the route's `USERNAME_RE` — a malformed handle is a hard 400, and
 *  audit metadata is never worth losing the whole use over. */
const CANNED_USERNAME_RE = /^[A-Za-z0-9_]{1,15}$/;
/** The route's `MAX_VAR_LEN`; a longer display name 400s `invalid_vars`. */
const CANNED_MAX_VAR_LEN = 120;

const CANNED_ERR: Record<string, string> = {
  no_enabled_items: 'Nothing switched on in that list.',
  not_found: 'That list is gone — reopen the Lists subtab.',
  unconfigured: 'Set the API URL and token in the side panel first.',
};

async function getCannedLists(): Promise<ReplyListSummary[]> {
  if (cannedCache && Date.now() - cannedCache.at < CANNED_CACHE_TTL_MS) return cannedCache.lists;
  if (!cannedInflight) {
    const request: ApiRequest = { type: 'stratus/api', method: 'GET', path: '/x/reply-lists' };
    cannedInflight = chrome.runtime
      .sendMessage(request)
      .then((res: ApiResponse<ReplyListSummary[]> | undefined) => {
        if (!res?.ok || !Array.isArray(res.data))
          throw new Error(res && !res.ok ? res.code : 'no_response');
        cannedCache = { lists: res.data, at: Date.now() };
        return res.data;
      })
      .finally(() => {
        cannedInflight = null;
      });
  }
  return cannedInflight;
}

function closeCannedPop(): void {
  if (!openCannedPop) return;
  openCannedPop.remove();
  openCannedPop = null;
  openCannedBtn = null;
  for (const b of document.querySelectorAll<HTMLElement>(`.${CANNED_BTN_CLASS}`)) {
    b.setAttribute('aria-expanded', 'false');
  }
}

/** Places the popover in viewport coordinates: below the button when it fits,
 *  flipped above when it doesn't, always clamped inside the viewport and capped
 *  to the space actually available (the body scrolls past that). */
function placeCannedPop(): void {
  const pop = openCannedPop;
  const btn = openCannedBtn;
  if (!pop || !btn) return;
  // A virtualised re-render can take the anchor out from under us mid-scroll.
  if (!btn.isConnected) {
    closeCannedPop();
    return;
  }
  const r = btn.getBoundingClientRect();
  const below = window.innerHeight - r.bottom - CANNED_POP_GAP - CANNED_POP_MARGIN;
  const above = r.top - CANNED_POP_GAP - CANNED_POP_MARGIN;
  const flip = below < CANNED_POP_MIN_H && above > below;
  pop.style.maxHeight = `${Math.max(CANNED_POP_MIN_H, flip ? above : below)}px`;

  const h = pop.offsetHeight;
  const w = pop.offsetWidth;
  const top = flip
    ? r.top - CANNED_POP_GAP - h
    : Math.min(r.bottom + CANNED_POP_GAP, window.innerHeight - CANNED_POP_MARGIN - h);
  const maxLeft = Math.max(CANNED_POP_MARGIN, window.innerWidth - CANNED_POP_MARGIN - w);
  pop.style.top = `${Math.max(CANNED_POP_MARGIN, top)}px`;
  pop.style.left = `${Math.min(Math.max(CANNED_POP_MARGIN, r.left), maxLeft)}px`;
}

function bindCannedOutsideClose(): void {
  if (cannedOutsideBound) return;
  cannedOutsideBound = true;
  document.addEventListener(
    'mousedown',
    (ev) => {
      if (!openCannedPop) return;
      const target = ev.target as Node | null;
      if (target && (openCannedPop.contains(target) || openCannedBtn?.contains(target))) return;
      closeCannedPop();
    },
    true,
  );
  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && openCannedPop) {
      closeCannedPop();
      openCannedBtn?.focus();
    }
  });
  // Fixed positioning means the popover no longer rides along with the page —
  // it has to be re-placed on every viewport change while it is open.
  const follow = () => placeCannedPop();
  window.addEventListener('scroll', follow, { capture: true, passive: true });
  window.addEventListener('resize', follow, { passive: true });
}

interface CannedTarget {
  tweetId: string;
  handle: string;
  name: string | null;
}

/** Who we're replying to, for the template vars and the use log. */
function cannedTargetFrom(article: Element, focusedTweetId: string): CannedTarget | null {
  const permalink = findPermalink(article);
  if (!permalink || permalink.tweetId !== focusedTweetId) return null;
  const userNameEl = article.querySelector('[data-testid="User-Name"]');
  const displayName =
    userNameEl?.querySelector<HTMLAnchorElement>('a')?.textContent?.trim() || null;
  return { tweetId: permalink.tweetId, handle: permalink.username, name: displayName };
}

/** X ships three themes (white / dim / lights-out) and exposes no stable surface
 *  token, so an opaque popover has to read the page's own computed colors. A
 *  transparent body means the theme hasn't painted yet — leave the CSS system
 *  colors in place rather than baking in a wrong one. */
function applyPageSurface(el: HTMLElement): void {
  const style = getComputedStyle(document.body);
  const bg = style.backgroundColor;
  if (bg && bg !== 'transparent' && !bg.startsWith('rgba(0, 0, 0, 0)')) el.style.background = bg;
  if (style.color) el.style.color = style.color;
}

function cannedRow(label: string, className = CANNED_HINT_CLASS): HTMLElement {
  const el = document.createElement('div');
  el.className = className;
  el.textContent = label;
  return el;
}

/** The popover shell: a titled card with its own close affordance. Only the
 *  body is ever re-rendered, so the header survives every state change. */
function createCannedPop(): HTMLElement {
  const pop = document.createElement('div');
  pop.className = CANNED_POP_CLASS;
  pop.setAttribute('role', 'dialog');
  pop.setAttribute('aria-label', 'Canned replies');
  applyPageSurface(pop);

  const head = document.createElement('div');
  head.className = CANNED_HEAD_CLASS;
  const title = document.createElement('span');
  title.className = CANNED_TITLE_CLASS;
  title.textContent = 'Canned replies';
  const close = document.createElement('button');
  close.type = 'button';
  close.className = CANNED_CLOSE_CLASS;
  close.setAttribute('aria-label', 'Close');
  close.title = 'Close';
  close.appendChild(svgIcon(ICON_CLOSE, { size: 14 }));
  close.addEventListener('click', (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    closeCannedPop();
  });
  head.append(title, close);

  const body = document.createElement('div');
  body.className = CANNED_BODY_CLASS;
  pop.append(head, body);
  // X's action row is a link-and-hover minefield; the pop is ours alone.
  pop.addEventListener('click', (e) => e.stopPropagation());
  return pop;
}

/** Swap the popover's contents and re-measure — every state it moves through
 *  (menu → picking → the used text) is a different height. */
function setCannedBody(pop: HTMLElement, ...nodes: Node[]): void {
  const body = pop.querySelector<HTMLElement>(`.${CANNED_BODY_CLASS}`);
  if (!body) return;
  body.replaceChildren(...nodes);
  if (pop === openCannedPop) placeCannedPop();
}

/** The list menu — rebuilt whenever the pop returns to its picking state. */
function renderCannedMenu(pop: HTMLElement, btn: HTMLButtonElement, target: CannedTarget): void {
  setCannedBody(pop, cannedRow('Loading lists…'));
  void getCannedLists().then(
    (lists) => {
      if (!pop.isConnected) return;
      // `active` is presentation state (D79e): an inactive list stays usable by
      // id, it just isn't offered here.
      const offered = lists.filter((l) => l.active);
      if (offered.length === 0) {
        setCannedBody(pop, cannedRow('No active reply lists — make one in the panel.'));
        return;
      }
      const frag = document.createDocumentFragment();
      for (const list of offered) {
        const item = document.createElement('button');
        item.type = 'button';
        item.className = CANNED_ITEM_CLASS;
        item.title = list.description ?? list.name;
        const name = document.createElement('span');
        name.className = CANNED_NAME_CLASS;
        name.textContent = list.name;
        const meta = document.createElement('span');
        meta.className = CANNED_META_CLASS;
        meta.textContent = `${list.enabledCount} on`;
        item.append(name, meta);
        if (list.enabledCount === 0) {
          item.setAttribute('aria-disabled', 'true');
          item.title = 'Nothing switched on in this list';
        } else {
          item.addEventListener('click', (ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            void onCannedPick(pop, btn, list, target);
          });
        }
        frag.appendChild(item);
      }
      setCannedBody(pop, frag);
    },
    (err: unknown) => {
      if (!pop.isConnected) return;
      const code = err instanceof Error ? err.message : 'fetch_failed';
      setCannedBody(pop, cannedRow(CANNED_ERR[code] ?? `Couldn't load lists (${code})`));
    },
  );
}

function setCannedState(
  btn: HTMLButtonElement,
  state: 'idle' | 'working' | 'done' | 'failed',
  label: string,
): void {
  btn.dataset.state = state;
  setActLabel(btn, label);
}

function resetCannedState(btn: HTMLButtonElement): void {
  setTimeout(() => {
    if (btn.isConnected) setCannedState(btn, 'idle', CANNED_BTN_LABEL);
  }, STATUS_PERSIST_MS);
}

// One click = one spent item. The pop stays open showing exactly what went in
// the composer, because the item is already spent: if the typing failed, the
// text has to remain readable/copyable or the pick is simply lost.
async function onCannedPick(
  pop: HTMLElement,
  btn: HTMLButtonElement,
  list: ReplyListSummary,
  target: CannedTarget,
): Promise<void> {
  if (btn.dataset.state === 'working') return;
  setCannedState(btn, 'working', 'Picking…');
  setCannedBody(pop, cannedRow(`Picking from ${list.name}…`));

  const name = target.name?.slice(0, CANNED_MAX_VAR_LEN);
  const handle = target.handle.replace(/^@/, '');
  const auditHandle = handle.toLowerCase();

  const request: ApiRequest = {
    type: 'stratus/api',
    method: 'POST',
    path: `/x/reply-lists/${encodeURIComponent(list.id)}/use`,
    body: {
      vars: {
        ...(name ? { name } : {}),
        ...(handle.length <= CANNED_MAX_VAR_LEN ? { handle } : {}),
      },
      targetTweetId: target.tweetId,
      ...(CANNED_USERNAME_RE.test(auditHandle) ? { targetHandle: auditHandle } : {}),
    },
  };

  let res: ApiResponse<UseReplyResponse> | undefined;
  try {
    res = (await chrome.runtime.sendMessage(request)) as ApiResponse<UseReplyResponse> | undefined;
  } catch (err) {
    console.warn('[stratus] canned use failed', err);
  }

  if (!res || !res.ok) {
    const code = res && !res.ok ? res.code : 'no_response';
    setCannedState(btn, 'failed', 'Pick failed');
    resetCannedState(btn);
    if (pop.isConnected) {
      setCannedBody(
        pop,
        cannedRow(CANNED_ERR[code] ?? `Pick failed (${code})`),
        cannedPickAnotherButton(pop, btn, target),
      );
    }
    return;
  }

  const used = res.data;

  // The item is spent server-side from here on — every remaining failure is
  // cosmetic, and the text stays on screen so nothing is lost.
  const hint = DELIVER_HINT[await deliverToReplyBox(used.text)];

  setCannedState(btn, 'done', 'Picked ✓');
  resetCannedState(btn);

  if (!pop.isConnected) return;
  const text = document.createElement('div');
  text.className = CANNED_TEXT_CLASS;
  text.textContent = used.text;
  // What the humanizer actually did to this pick — the jitter is per-use and
  // probabilistic, so without this line "it did nothing" and "it fired" look
  // identical from the outside.
  const jitter =
    used.applied.length > 0 ? `jitter: ${used.applied.join(', ')}` : 'no jitter this time';
  const missing =
    used.missingVars.length > 0 ? ` · no ${used.missingVars.join(', ')} for this target` : '';
  setCannedBody(
    pop,
    cannedRow(hint),
    text,
    cannedRow(`${list.name} · ${jitter}${missing}`),
    cannedPickAnotherButton(pop, btn, target),
  );
}

function cannedPickAnotherButton(
  pop: HTMLElement,
  btn: HTMLButtonElement,
  target: CannedTarget,
): HTMLButtonElement {
  const again = document.createElement('button');
  again.type = 'button';
  again.className = CANNED_ITEM_CLASS;
  const label = document.createElement('span');
  label.className = CANNED_NAME_CLASS;
  label.textContent = '← Pick another';
  again.appendChild(label);
  again.addEventListener('click', (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    renderCannedMenu(pop, btn, target);
  });
  return again;
}

function attachCannedButton(article: Element, focusedTweetId: string): void {
  const reply = article.querySelector('[data-testid="reply"]');
  if (!reply) return;
  const actionRow = reply.closest('div[role="group"]');
  if (!actionRow || cannedHandled.has(actionRow)) return;

  const target = cannedTargetFrom(article, focusedTweetId);
  if (!target) return;

  bindCannedOutsideClose();

  const btn = makeActButton({
    icons: [svgIcon(ICON_LIST)],
    tone: 'blue',
    order: ACT_ORDER.canned,
    title: 'Canned replies — one click spends a pick and types it in',
    label: CANNED_BTN_LABEL,
    extraClass: CANNED_BTN_CLASS,
    caret: true,
  });
  btn.setAttribute('aria-haspopup', 'dialog');
  btn.setAttribute('aria-expanded', 'false');
  btn.addEventListener('click', (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    if (openCannedBtn === btn) {
      closeCannedPop();
      return;
    }
    closeCannedPop();
    const pop = createCannedPop();
    document.body.appendChild(pop);
    openCannedPop = pop;
    openCannedBtn = btn;
    btn.setAttribute('aria-expanded', 'true');
    placeCannedPop();
    // Re-read the target: the article element outlives a virtualised re-render,
    // but the display name can arrive after the button was injected.
    renderCannedMenu(pop, btn, cannedTargetFrom(article, focusedTweetId) ?? target);
  });

  actionCluster(actionRow).appendChild(btn);
  cannedHandled.add(actionRow);
}

// --------------------------------------------------------- reply-target band

// Highlight timeline tweets that sit in the 1k–8k-view sweet spot worth
// replying to early. Every signal is read from the DOM ($0). The scoring model
// lives in replyBand.ts; the rationale is in evals/reply-eval-*.md.

// UI.7: the thresholds come from the mirrored settings blob the background
// writes (§7.24/7.25 — the page never fetches them itself), so the badge and
// the server's /x/replies/generate gate classify with the same twelve numbers.
// Baked defaults until the first read resolves: an unconfigured, offline or
// half-loaded profile bands exactly as it did before this knob existed, never
// blank.
let bandThresholds: BandThresholds = SERVER_DEFAULTS.band;

function initBandThresholds(): void {
  chrome.storage.local
    .get(SERVER_SETTINGS_KEY)
    .then((out) => {
      bandThresholds = readServerConfig(out[SERVER_SETTINGS_KEY]).band;
    })
    .catch(() => {
      /* keep defaults */
    });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    const change = changes[SERVER_SETTINGS_KEY];
    if (change) bandThresholds = readServerConfig(change.newValue).band;
  });
}

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

// GT.8 flood control: a roster capture is an ambient auto-capture like a band
// sighting, and without an age guard one deep scroll fills a cap-100 queue with
// week-old debts. "Skip when the age is unknown" comes free — readTweetSignals
// returns null without a parseable <time>.
const ROSTER_MAX_AGE_MIN = 24 * 60;

// Does a tweet the classifier passed on still belong in the queue because of WHO
// posted it (GT.8)? Cheap gates first — applyBand re-runs on every mutation
// burst, so the free age check comes before the DOM read that yields the handle
// (one querySelector, the same one applyPersonChips already pays per article).
function isRosterSighting(article: Element, sig: TweetSignals, glance: GlanceMap): boolean {
  if (sig.ageMin > ROSTER_MAX_AGE_MIN) return false;
  const permalink = findPermalink(article);
  if (!permalink) return false;
  // Membership is the reply gate's own rule, never "is the author in the map":
  // the glance map holds every stage, most of it ambient hover capture.
  return isReciprocityPerson(glance[permalink.username.toLowerCase()]);
}

function applyBand(article: HTMLElement, glance: GlanceMap): void {
  const sig = readTweetSignals(article);
  const band = sig ? classifyBand(sig, bandThresholds) : null;
  if (band) article.dataset.stratusBand = band;
  else delete article.dataset.stratusBand;
  if (sig && (band === 'hot' || band === 'warm')) recordRadarSighting(article, band, sig);
  // A quiet post by someone already mine still enters the queue — the border and
  // the dim stay exactly as the classifier called them, this only feeds the
  // Radar (GT.8).
  else if (sig && isRosterSighting(article, sig, glance)) {
    recordRadarSighting(article, 'roster', sig);
  }
  // Every band, including skip — the opportunity funnel needs the denominator.
  // A null sig is an ad/promoted row (no metrics label), which filters itself.
  if (sig) recordPassiveHarvest(article);
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

// AX.6: a timeline chip or the tweet-page context-panel header opens the
// person's dossier in the side panel. The background owns sidePanel.open (the
// click is a user gesture) and the `stratus:openPerson` session handoff key.
function sendOpenPerson(handle: string): void {
  const msg: OpenPerson = { type: 'stratus/open-person', handle };
  void chrome.runtime.sendMessage(msg).catch(() => {});
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
    // AX.6: open the dossier; preventDefault/stopPropagation so the click never
    // bubbles into X's row → tweet navigation.
    btn.addEventListener('click', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      sendOpenPerson(handle);
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
  title.dataset.handle = handle;
  // AX.6: the title opens the dossier. The collapse toggle is a sibling (not a
  // child of title), so a toggle click never lands here.
  title.addEventListener('click', (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    sendOpenPerson(handle);
  });

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

// ------------------------------------------------- manual add to Radar (RU.8)
//
// A round ⊕ on every tweet's action row pushes it into the Radar queue
// regardless of band — "I want to reply to this one, period." The sighting
// carries band: 'manual' (queue metadata, ranked first; never a classifier
// verdict — the confirm endpoint coerces it away from the reply snapshot), real
// signals when the metrics label is present, synthesized zeros otherwise. Sent
// through the same radar-report path the background (single writer, §7.24) owns,
// flushed immediately — it's one deliberate click, not a scroll-time capture.

const radarAddHandled = new WeakSet<Element>();

function synthManualSignals(article: Element): TweetSignals {
  const dt = article.querySelector('time')?.getAttribute('datetime');
  const posted = dt ? Date.parse(dt) : Number.NaN;
  const ageMin = Number.isNaN(posted) ? 0 : Math.max(0, (Date.now() - posted) / 60000);
  return { views: 0, replies: 0, ageMin, vpm: 0, bait: false };
}

function attachRadarAddButton(article: Element): void {
  const reply = article.querySelector('[data-testid="reply"]');
  if (!reply) return;
  const actionRow = reply.closest('div[role="group"]');
  if (!actionRow || radarAddHandled.has(actionRow)) return;
  if (!findPermalink(article)) return;

  const btn = makeActButton({
    icons: [svgIcon(ICON_PLUS_CIRCLE)],
    tone: 'muted',
    order: ACT_ORDER.radar,
    title: 'Add this tweet to the stratus Radar queue',
    label: RADAR_BTN_LABEL,
    extraClass: RADAR_ADD_CLASS,
  });
  btn.dataset.state = 'idle';
  btn.addEventListener('click', (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    onRadarAddClick(btn);
  });

  actionCluster(actionRow).appendChild(btn);
  radarAddHandled.add(actionRow);
}

function onRadarAddClick(btn: HTMLButtonElement): void {
  const article = btn.closest<HTMLElement>('article[data-testid="tweet"]');
  if (!article) return;
  const permalink = findPermalink(article);
  if (!permalink) return;

  const sig = readTweetSignals(article) ?? synthManualSignals(article);
  const text = article.querySelector('[data-testid="tweetText"]')?.textContent?.trim() ?? '';
  const userNameEl = article.querySelector('[data-testid="User-Name"]');
  const author = userNameEl?.querySelector<HTMLAnchorElement>('a')?.textContent?.trim() || null;
  const now = new Date().toISOString();

  const sighting: RadarSighting = {
    tweetId: permalink.tweetId,
    url: permalink.url,
    handle: permalink.username,
    author,
    text: text.slice(0, 500),
    band: 'manual',
    signals: { ...sig, ageMin: Math.round(sig.ageMin), vpm: Math.round(sig.vpm * 10) / 10 },
    firstSeenAt: now,
    lastSeenAt: now,
  };

  // Flip to the green "added" face optimistically; the background is the single
  // buffer writer (§7.24).
  btn.dataset.state = 'added';
  setActLabel(btn, 'Added to Radar');
  window.setTimeout(() => {
    if (!btn.isConnected) return;
    btn.dataset.state = 'idle';
    setActLabel(btn, RADAR_BTN_LABEL);
  }, 1500);

  const msg: RadarReport = { type: 'stratus/radar-report', sightings: [sighting] };
  void (async () => {
    try {
      await chrome.runtime.sendMessage(msg);
    } catch (err) {
      console.warn('[stratus] radar add failed', err);
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

// ------------------------------------------ passive timeline harvest (HV.2)
//
// Every tweet the algorithm puts in front of you on /home joins the same
// harvest_rows longitudinal series a hand-run harvest fills, at $0 — the swipe
// file and the band-calibration denominators grow from normal scrolling. The
// row is built by the harvester's own DOM reader (§7.27: one reader, not two)
// and shipped on the flushSightings transport. A failed flush warns and drops
// and is never retried: a lost sighting is a missing point on a view curve,
// never a lost user action. The server owns the per-day run, the recapture
// gate, the 2,000/day cap and the 60-day prune (POST /x/harvest/passive).

// Default ON (opt-out via Settings): absent key means enabled.
let passiveHarvestEnabled = true;

function initPassiveHarvestSetting(): void {
  chrome.storage.local
    .get(PASSIVE_HARVEST_KEY)
    .then((out) => {
      passiveHarvestEnabled = out[PASSIVE_HARVEST_KEY] !== false;
    })
    .catch(() => {
      /* keep default */
    });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    const change = changes[PASSIVE_HARVEST_KEY];
    if (change) passiveHarvestEnabled = change.newValue !== false;
  });
}

const pendingPassive = new Map<string, HarvestIngestRow>();
const passiveSentAt = new Map<string, number>();
let passiveFlushTimer: number | null = null;

function recordPassiveHarvest(article: Element): void {
  if (!passiveHarvestEnabled) return;
  // Re-read per call, not once at start(): X navigates without reloading.
  if (!isHomeTimelinePath(location.pathname)) return;
  if (isHarvestActive()) return;

  // Cheap gate first — applyBand re-runs on every mutation burst, so the
  // throttle is settled off one querySelector before extractArticle's full read.
  const permalink = findPermalink(article);
  if (!permalink) return;
  const tweetId = permalink.tweetId;
  if (pendingPassive.has(tweetId)) return;
  if (!shouldRecordPassive(passiveSentAt.get(tweetId), Date.now())) return;

  const row = toPassiveIngestRow(extractArticle(article));
  if (!row) return;
  pendingPassive.set(tweetId, row);
  if (passiveFlushTimer === null) {
    passiveFlushTimer = window.setTimeout(flushPassiveHarvest, PASSIVE_FLUSH_MS);
  }
}

function flushPassiveHarvest(): void {
  passiveFlushTimer = null;
  if (pendingPassive.size === 0) return;
  const batch = [...pendingPassive.entries()].slice(0, PASSIVE_BATCH_MAX);
  for (const [tweetId] of batch) pendingPassive.delete(tweetId);
  if (pendingPassive.size > 0) {
    // Overflow beyond one server batch waits for the next window.
    passiveFlushTimer = window.setTimeout(flushPassiveHarvest, PASSIVE_FLUSH_MS);
  }

  // One entry per distinct tweet seen this session. A marathon scroll resets the
  // map rather than pruning it — forgetting costs one early re-send per tweet,
  // which the server's own recapture gate absorbs as skippedRecent.
  if (passiveSentAt.size > 5000) passiveSentAt.clear();
  const at = Date.now();
  for (const [tweetId] of batch) passiveSentAt.set(tweetId, at);

  const request: ApiRequest = {
    type: 'stratus/api',
    method: 'POST',
    path: '/x/harvest/passive',
    body: { rows: batch.map(([, row]) => row) },
  };
  void (async () => {
    try {
      const res = (await chrome.runtime.sendMessage(request)) as ApiResponse | undefined;
      if (res && !res.ok && res.code !== 'unconfigured') {
        console.warn('[stratus] passive harvest failed', res.code);
      }
    } catch (err) {
      console.warn('[stratus] passive harvest failed', err);
    }
  })();
}

// ---------------------------------------- active-times capture (A3.3)
//
// x.com/i/account_analytics renders the audience "Active times" heat grid —
// presence data the Composer's best-slot ranking blends in below own measured
// cells (A3.4). Captured passively whenever the user happens to visit the
// page ($0, no tab automation — decision 3): once per visit, parsed by the
// A3.1 shared module (§7.27 — one parser), shipped through ApiRequest. The
// server route is append-only and never suppresses (a duplicate POST is
// harmless); the only chatter gate is client-side — skip when the grid is
// unchanged AND the last send is under 12h old, stamped in
// chrome.storage.local. A failed send retries on the next mutation scan.

// Verify live on first run — X owns this path; sub-tabs (Audience) share the prefix.
const ACTIVE_TIMES_PATH_PREFIX = '/i/account_analytics';
// Duplicated from the shared DOM extractor (module-private there): only used
// to anchor the metric-dropdown read next to the same section.
const ACTIVE_TIMES_HEADING_SELECTOR = 'h1, h2, h3, h4, [role="heading"]';
const ACTIVE_TIMES_HEADING_RE = /active times/i;
const ACTIVE_TIMES_METRIC_SELECTOR = 'select, [role="combobox"]';
const ACTIVE_TIMES_METRIC_HOPS = 8;
/** Mirrors the server's metric length clamp (routes/analytics.ts). */
const ACTIVE_TIMES_METRIC_MAX = 40;
const ACTIVE_TIMES_FALLBACK_METRIC = 'likes';
const ACTIVE_TIMES_LAST_SENT_KEY = 'activeTimes:lastSent';
const ACTIVE_TIMES_RESEND_MS = 12 * 60 * 60 * 1000;

interface ActiveTimesLastSent {
  grid: number[][];
  sentAt: number;
}

let activeTimesDone = false; // sent or suppressed this visit
let activeTimesInFlight = false;
let activeTimesFailLogged = false;

function parseActiveTimesLastSent(raw: unknown): ActiveTimesLastSent | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const rec = raw as { grid?: unknown; sentAt?: unknown };
  if (!Array.isArray(rec.grid) || typeof rec.sentAt !== 'number') return null;
  return { grid: rec.grid as number[][], sentAt: rec.sentAt };
}

function dropdownLabel(el: Element | null): string | null {
  if (!el) return null;
  const text =
    el instanceof HTMLSelectElement
      ? el.selectedOptions[0]?.textContent || el.value
      : el.textContent;
  return text?.trim().toLowerCase().slice(0, ACTIVE_TIMES_METRIC_MAX) || null;
}

// The analytics dropdown names which metric the heatmap is showing ('likes',
// …). Best-effort: the capture is worth storing even when the label isn't
// readable, so an unfound dropdown falls back rather than blocking.
function readActiveTimesMetric(): string {
  const headings = [...document.querySelectorAll(ACTIVE_TIMES_HEADING_SELECTOR)];
  const heading = headings.find((h) => ACTIVE_TIMES_HEADING_RE.test(h.textContent ?? ''));
  let container: Element | null = heading?.parentElement ?? null;
  for (let hop = 0; hop < ACTIVE_TIMES_METRIC_HOPS && container; hop++) {
    const label = dropdownLabel(container.querySelector(ACTIVE_TIMES_METRIC_SELECTOR));
    if (label) return label;
    container = container.parentElement;
  }
  // Live (verified 2026-07-24): the metric combobox ("Likes") sits above the
  // whole Audience tab, outside every ≤8-hop ancestor of the section heading,
  // and it is that page's only combobox — the page-level read is unambiguous.
  return (
    dropdownLabel(document.querySelector(ACTIVE_TIMES_METRIC_SELECTOR)) ??
    ACTIVE_TIMES_FALLBACK_METRIC
  );
}

async function sendActiveTimes(extracted: ExtractedActiveTimes, grid: number[][]): Promise<void> {
  let last: ActiveTimesLastSent | null = null;
  try {
    const out = await chrome.storage.local.get(ACTIVE_TIMES_LAST_SENT_KEY);
    last = parseActiveTimesLastSent(out[ACTIVE_TIMES_LAST_SENT_KEY]);
  } catch {
    // Unreadable stamp = never sent; worst case is one early re-send.
  }
  if (last && gridsEqual(last.grid, grid) && Date.now() - last.sentAt < ACTIVE_TIMES_RESEND_MS) {
    activeTimesDone = true; // unchanged and fresh — nothing new to store
    return;
  }
  const request: ApiRequest = {
    type: 'stratus/api',
    method: 'POST',
    path: '/x/analytics/active-times',
    body: {
      metric: readActiveTimesMetric(),
      tzOffsetMin: -new Date().getTimezoneOffset(),
      cols: extracted.cols,
      rows: extracted.rows,
      grid,
    },
  };
  try {
    const res = (await chrome.runtime.sendMessage(request)) as ApiResponse | undefined;
    if (res?.ok) {
      activeTimesDone = true;
      const stamp: ActiveTimesLastSent = { grid, sentAt: Date.now() };
      void chrome.storage.local.set({ [ACTIVE_TIMES_LAST_SENT_KEY]: stamp }).catch(() => {});
      return;
    }
    if (res && res.code === 'unconfigured') {
      activeTimesDone = true; // no server to talk to — stop asking this visit
      return;
    }
    if (!activeTimesFailLogged) {
      activeTimesFailLogged = true;
      console.warn('[stratus] active-times capture failed', res?.code);
    }
  } catch (err) {
    if (!activeTimesFailLogged) {
      activeTimesFailLogged = true;
      console.warn('[stratus] active-times capture failed', err);
    }
  }
}

function syncActiveTimesCapture(): void {
  // Pathname re-read per scan, not once: X navigates without reloading. The
  // off-page branch is also the visit reset — returning later captures again.
  if (!location.pathname.startsWith(ACTIVE_TIMES_PATH_PREFIX)) {
    activeTimesDone = false;
    activeTimesFailLogged = false;
    return;
  }
  if (!passiveCaptureEnabled) return;
  if (activeTimesDone || activeTimesInFlight) return;
  // Gate order is the perf contract (HV.2): the flags above settle for free;
  // the DOM walk below runs only on the analytics page while uncaptured.
  const extracted = extractActiveTimesSection(document);
  if (!extracted) return; // section still rendering — next mutation scan retries
  const grid = parseHeatColors(extracted.colors, extracted.cols, extracted.rows);
  if (!grid) return;
  activeTimesInFlight = true;
  void sendActiveTimes(extracted, grid).finally(() => {
    activeTimesInFlight = false;
  });
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

// ------------------------------------------- notifications surface (C10, NT.5)
//
// x.com/notifications is the only place likes, reposts and follows are visible
// at all — the relationship signals stratus otherwise never sees. Three
// read-only augmentations plus one $0 harvest, all gated on the pathname (X
// navigates without reloads, so the check is per scan, not once):
//
//   (a) every reply notification stratus already knows (an API-pulled `mentions`
//       row) gets a "↳ on your post: …" line, plus ✓ when the inbox already
//       settled it — no more clicking through to remember which post it's on;
//   (b) aggregated cells get a tier chip per handle that matters (ally / mutual
//       / in-band target) so the eye goes to the people worth answering;
//   (c) those same cells are harvested into people rows + timeline events,
//       behind the existing passiveCapture toggle — no new setting (decision 5);
//   (d) a "sync replies" chip runs the capped mentions pull on a human click.
//
// Only (d) spends, one already-capped POST per deliberate click: a page visit is
// never consent to spend (decision 4), so nothing here auto-refreshes.
//
// The `mentions` table is NEVER written from this surface. Its max stored
// tweet_id IS the since_id checkpoint, so inserting a DOM-scraped reply id would
// skip every mention the API hasn't returned yet (§4; C7's launch.ts routes
// around the same trap). Parent context is a pure read of what the daily pull
// already billed for.

const NOTIF_CTX_CLASS = 'stratus-notif-ctx';
const NOTIF_TIERS_CLASS = 'stratus-notif-tiers';
const NOTIF_TIER_CLASS = 'stratus-notif-tier';
const NOTIF_SYNC_CLASS = 'stratus-notif-sync';
const NOTIF_SYNC_LABEL = 'stratus: sync replies';

const NOTIF_CONTEXT_THROTTLE_MS = 60_000;
const NOTIF_PARENT_MAX = 90;
const NOTIF_TIER_CHIP_MAX = 3;
const ENGAGEMENT_FLUSH_MS = 2000;
// Mirrors MAX_ENGAGEMENTS_PER_BATCH server-side; an over-long batch is a 400
// for the WHOLE batch, so the client never lets one form.
const ENGAGEMENT_BATCH_MAX = 50;
const ENGAGEMENT_KEY_TARGET_CHARS = 40;

/** What crosses the wire to POST /x/people/engagements. `'other'` is dropped
 *  client-side and deliberately isn't representable (the server's whitelist
 *  would 400 the whole batch on it). */
interface EngagementReport {
  kind: Exclude<EngagementKind, 'other'>;
  handle: string;
  targetText: string | null;
  seenAt: string;
}

let notifMentions: NotifContextMap = {};
let notifRankMap: RankMap = {};
let notifContextAt = 0;
let notifContextInFlight: Promise<void> | null = null;

const engagementHandled = new WeakSet<Element>();
const pendingEngagements = new Map<string, EngagementReport>();
const engagementSent = new Set<string>();
let engagementFlushTimer: number | null = null;

function onNotificationsPage(): boolean {
  return location.pathname.startsWith('/notifications');
}

function clipText(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

// One message serves both augmentations: it warms the background's 5-min
// mentions cache and the 10-min S0.3 rank map in parallel. The response is
// always ok:true — an unconfigured extension, a failed fetch or a thrown
// handler all degrade to empty (or last-good) maps, so `{}` means "no context
// yet", never an error worth surfacing on someone else's page.
async function fetchNotifContext(force: boolean): Promise<void> {
  const msg: NotifContextGet = force
    ? { type: 'stratus/notif-context', force: true }
    : { type: 'stratus/notif-context' };
  try {
    const res = (await chrome.runtime.sendMessage(msg)) as NotifContextResponse | undefined;
    if (res?.ok) {
      notifMentions = res.mentions;
      notifRankMap = res.rankMap;
    }
  } catch (err) {
    console.warn('[stratus] notif context failed', err);
  }
  // Stamped on settle, not only on success: the background already decides what
  // to cache on failure (it keeps the last good map), so this throttle only
  // governs how often we ask — and stamping unconditionally is what stops a
  // failing ask from re-firing on every animation frame.
  notifContextAt = Date.now();
  // The notifications page can go mutation-quiet between arrivals, so nothing
  // else would repaint the lines once the maps land.
  scheduleScan();
}

// scan() is synchronous: use whatever is cached now and kick a refresh when the
// throttle window has passed. The forced variant (sync chip) never comes through
// here — it must not be swallowed by an in-flight bare ask.
function syncNotifContext(): void {
  if (notifContextInFlight) return;
  if (notifContextAt !== 0 && Date.now() - notifContextAt < NOTIF_CONTEXT_THROTTLE_MS) return;
  notifContextInFlight = fetchNotifContext(false).finally(() => {
    notifContextInFlight = null;
  });
}

// (a) The reply notification's own tweet id is what findPermalink yields here,
// and that is exactly how the mentions map is keyed.
function applyNotifParentContext(article: Element): void {
  const existing = article.querySelector<HTMLElement>(`.${NOTIF_CTX_CLASS}`);
  const permalink = findPermalink(article);
  const entry = permalink ? notifMentions[permalink.tweetId] : undefined;
  const parentText = entry?.parentText ?? null;
  const answered = entry?.status === 'answered';

  // Nothing known about this reply — also clears a line a recycled node kept.
  if (!parentText && !answered) {
    existing?.remove();
    return;
  }

  const sig = `${answered ? 'a' : '-'}:${parentText ? clipText(parentText, NOTIF_PARENT_MAX) : ''}`;
  if (existing && existing.dataset.sig === sig) return;

  const line = existing ?? document.createElement('div');
  if (!existing) {
    line.className = NOTIF_CTX_CLASS;
    // Under the reply's own text when there is one; X sometimes renders a
    // media-only reply, and then the cell itself is the only anchor.
    const anchor = article.querySelector('[data-testid="tweetText"]');
    if (anchor) anchor.insertAdjacentElement('afterend', line);
    else article.appendChild(line);
  }
  line.dataset.sig = sig;
  line.textContent = '';
  if (parentText) {
    line.appendChild(ctxEl('span', 'stratus-notif-ctx-label', '↳ on your post: '));
    line.appendChild(
      ctxEl('span', 'stratus-notif-ctx-quote', `“${clipText(parentText, NOTIF_PARENT_MAX)}”`),
    );
  }
  // An answered mention with no parent post of mine still earns the chip — it is
  // the "don't reply to this twice" signal, which is the point.
  if (answered) line.appendChild(ctxEl('span', 'stratus-notif-answered', '✓ answered'));
}

// (b) Tweet-article notifications already get the richer AX.3 glance chips from
// the shared scan loop; this covers the aggregated cells, which carry up to ~8
// handles and no User-Name row, so one compact chip per handle that matters is
// the right density.
function applyNotifTierChips(cell: Element, handles: string[]): void {
  const existing = cell.querySelector<HTMLElement>(`.${NOTIF_TIERS_CLASS}`);
  const chips: { handle: string; tier: PersonTier }[] = [];
  for (const handle of handles) {
    const tier = personTierFor(notifRankMap[handle]);
    if (tier) chips.push({ handle, tier });
    if (chips.length >= NOTIF_TIER_CHIP_MAX) break;
  }

  const header = cell.querySelector('[dir]');
  if (chips.length === 0 || !header) {
    existing?.remove();
    return;
  }

  const sig = chips.map((c) => `${c.tier}:${c.handle}`).join('|');
  if (existing && existing.dataset.sig === sig) return;

  const span = existing ?? document.createElement('span');
  if (!existing) {
    span.className = NOTIF_TIERS_CLASS;
    // AFTER the header block, never inside it: the parser reads the first [dir]
    // element as the header line and the longest [dir="auto"] as the target
    // post, so chips nested in either would feed our own text back into the
    // next parse. A plain span with no dir attribute is invisible to both.
    header.insertAdjacentElement('afterend', span);
  }
  span.dataset.sig = sig;
  span.textContent = '';
  for (const chip of chips) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = NOTIF_TIER_CLASS;
    btn.dataset.tone = chip.tier;
    btn.dataset.handle = chip.handle;
    btn.title = `@${chip.handle} — ${chip.tier}. Open their dossier.`;
    btn.textContent = `${chip.tier} @${chip.handle}`;
    btn.addEventListener('click', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      sendOpenPerson(chip.handle);
    });
    span.appendChild(btn);
  }
}

// (b) + (c) share one parse per cell per scan.
function scanNotificationCells(): void {
  for (const cell of document.querySelectorAll('article[data-testid="notification"]')) {
    const parsed = parseNotificationCell(cell);
    if (!parsed) continue;
    applyNotifTierChips(cell, parsed.handles);

    if (!passiveCaptureEnabled || engagementHandled.has(cell)) continue;
    // 'other' is X's bell cell ("New post notifications for … and 6 others") —
    // never sent. An empty handle list is a skeleton X hasn't filled in yet:
    // leave both unmarked so a later scan retries them once they resolve
    // (the capturePassiveHoverCards discipline).
    if (parsed.kind === 'other' || parsed.handles.length === 0) continue;

    engagementHandled.add(cell);
    const seenAt = new Date().toISOString();
    for (const handle of parsed.handles) {
      recordEngagement({ kind: parsed.kind, handle, targetText: parsed.targetText, seenAt });
    }
  }
}

function recordEngagement(engagement: EngagementReport): void {
  const key = `${engagement.kind}:${engagement.handle}:${
    engagement.targetText?.slice(0, ENGAGEMENT_KEY_TARGET_CHARS) ?? ''
  }`;
  if (engagementSent.has(key)) return;
  pendingEngagements.set(key, engagement);
  if (engagementFlushTimer === null) {
    engagementFlushTimer = window.setTimeout(flushEngagements, ENGAGEMENT_FLUSH_MS);
  }
}

function flushEngagements(): void {
  engagementFlushTimer = null;
  if (pendingEngagements.size === 0) return;

  const engagements: EngagementReport[] = [];
  for (const [key, engagement] of pendingEngagements) {
    if (engagements.length >= ENGAGEMENT_BATCH_MAX) break;
    engagements.push(engagement);
    pendingEngagements.delete(key);
    engagementSent.add(key);
  }
  if (pendingEngagements.size > 0) {
    // Overflow beyond one server batch waits for the next window.
    engagementFlushTimer = window.setTimeout(flushEngagements, ENGAGEMENT_FLUSH_MS);
  }
  // Chatter guard only: the server's deterministic event ids make a re-send a
  // no-op, so forgetting keys costs one redundant POST, never a double event.
  if (engagementSent.size > 3000) engagementSent.clear();

  const request: ApiRequest = {
    type: 'stratus/api',
    method: 'POST',
    path: '/x/people/engagements',
    body: { engagements },
  };
  void (async () => {
    try {
      const res = (await chrome.runtime.sendMessage(request)) as ApiResponse | undefined;
      if (res && !res.ok && res.code !== 'unconfigured') {
        console.warn('[stratus] engagement report failed', res.code);
      }
    } catch (err) {
      console.warn('[stratus] engagement report failed', err);
    }
  })();
}

// (d) One chip per notifications pageview, next to X's own "Notifications"
// heading. Re-injected when X rebuilds the header (sub-tab switches do).
function syncNotifSyncChip(): void {
  if (document.querySelector(`.${NOTIF_SYNC_CLASS}`)) return;
  const header = document.querySelector('[data-testid="primaryColumn"] h2');
  if (!header) return;

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = NOTIF_SYNC_CLASS;
  btn.textContent = NOTIF_SYNC_LABEL;
  btn.title =
    'Pull the newest mentions so the "on your post" lines cover fresh replies (capped 6/day)';
  btn.addEventListener('click', (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    void onSyncChipClick(btn);
  });
  header.insertAdjacentElement('afterend', btn);
}

function resetSyncChip(btn: HTMLButtonElement): void {
  setTimeout(() => {
    if (btn.isConnected) {
      btn.dataset.state = 'idle';
      btn.textContent = NOTIF_SYNC_LABEL;
    }
  }, STATUS_PERSIST_MS);
}

async function onSyncChipClick(btn: HTMLButtonElement): Promise<void> {
  if (btn.dataset.state === 'working') return;
  btn.dataset.state = 'working';
  btn.textContent = 'syncing…';

  const request: ApiRequest = {
    type: 'stratus/api',
    method: 'POST',
    path: '/x/mentions/refresh',
    body: {},
  };
  let res: ApiResponse | undefined;
  try {
    res = (await chrome.runtime.sendMessage(request)) as ApiResponse | undefined;
  } catch (err) {
    console.warn('[stratus] mentions refresh failed', err);
  }

  if (!res?.ok) {
    // The server's 6/day cap is the real limit and stays the only one — no
    // client-side bypass, and no retry loop that would spend on its own.
    const limited = res?.status === 429 || res?.code === 'refresh_limit';
    btn.dataset.state = 'failed';
    btn.textContent = limited ? 'limit reached' : 'sync failed';
    resetSyncChip(btn);
    return;
  }

  // The pull is already paid for: force past the background's 5-min mentions
  // cache (it drains any in-flight pull first) so the rows it just fetched show
  // up now rather than up to five minutes from now.
  await fetchNotifContext(true);
  btn.dataset.state = 'done';
  btn.textContent = 'synced';
  resetSyncChip(btn);
}

// --------------------------------------------------------------- scan loop

function scan(root: ParentNode): void {
  const focusedId = focusedTweetIdFromUrl();
  const glance = getGlanceMap();
  const onNotifications = onNotificationsPage();
  for (const article of root.querySelectorAll<HTMLElement>('article[data-testid="tweet"]')) {
    attachButton(article);
    attachRadarAddButton(article);
    applyBand(article, glance);
    applyPersonChips(article, glance);
    if (focusedId) {
      attachReplyMasterButton(article, focusedId);
      attachCannedButton(article, focusedId);
    }
    if (onNotifications) applyNotifParentContext(article);
  }
  syncContextPanel(focusedId);
  syncVariantChips(focusedId);
  syncAuthorButton();
  capturePassiveHoverCards();
  captureLaunchReplies();
  syncActiveTimesCapture();
  if (onNotifications) {
    syncNotifContext();
    scanNotificationCells();
    syncNotifSyncChip();
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

function start(): void {
  injectStyles();
  initHarvest();
  initTypeFromClipboard();
  initPassiveCaptureSetting();
  initPassiveHarvestSetting();
  initContextCollapsed();
  initBandThresholds();
  initReplyFocus();
  scan(document);
  const observer = new MutationObserver(scheduleScan);
  observer.observe(document.body, { childList: true, subtree: true });
}

// --------------------------------------------------- fill-from-clipboard
//
// Cmd+B fills the focused composer with the clipboard text. It used to "type"
// it in one `execCommand('insertText')` per character (18ms apart) so a draft
// landed like manual keystrokes — that is DEAD, and this is why: X's composer
// now applies its own model update on `beforeinput` **and** lets the browser
// apply the native one, so every synthetic keystroke went in twice and the
// duplication snowballed ("good one, maybe…" came out as several hundred
// characters of "gogogogd…"). Per-character insertion into an editor that
// re-renders from its own model underneath you is unwinnable.
//
// So: one replace-all attempt, VERIFIED against the editor's own text, with the
// clipboard as the fallback that always works —
//   1. `clipboard.writeText` unconditionally, so ⌘V is available no matter what
//   2. a synthetic `paste` ClipboardEvent — one operation, and the path a
//      Draft.js/Lexical-style editor handles itself
//   3. one whole-string `execCommand('insertText')`
//   4. leave the composer EMPTY and say "press ⌘V" — a mangled composer is a
//      worse outcome than an empty one, since the text is on the clipboard.
// Every surface that fills the reply box goes through `deliverToReplyBox`.

/** Long enough for the editor to re-render from its model before we verify. */
const EDITOR_SETTLE_MS = 60;
let typingInFlight = false;

type DeliverMode = 'inserted' | 'copied' | 'failed';

const DELIVER_HINT: Record<DeliverMode, string> = {
  inserted: 'Typed into the reply box ✓',
  copied: 'Copied — press ⌘V in the reply box',
  failed: 'Copy this by hand',
};

function focusedEditable(): HTMLElement | null {
  const el = document.activeElement as HTMLElement | null;
  if (!el) return null;
  if (el.isContentEditable) return el;
  if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') return el;
  return null;
}

function editorText(target: HTMLElement): string {
  if (target.isContentEditable) return target.textContent ?? '';
  return (target as HTMLTextAreaElement).value ?? '';
}

/** Compare what we asked for against what the editor really holds: nbsp for
 *  space, one newline flavour, ends trimmed. Anything else is a failed fill. */
function sameEditorText(a: string, b: string): boolean {
  const norm = (s: string) =>
    s
      .replace(/\u00a0/g, ' ')
      .replace(/\r\n?/g, '\n')
      .trim();
  return norm(a) === norm(b);
}

function selectAllIn(target: HTMLElement): void {
  target.focus();
  if (!target.isContentEditable) {
    (target as HTMLTextAreaElement).select();
    return;
  }
  const sel = window.getSelection();
  if (!sel) return;
  const range = document.createRange();
  range.selectNodeContents(target);
  sel.removeAllRanges();
  sel.addRange(range);
}

function pasteInto(target: HTMLElement, text: string): void {
  target.focus();
  const data = new DataTransfer();
  data.setData('text/plain', text);
  target.dispatchEvent(
    new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data }),
  );
}

/** Replace the editor's whole contents with `text`, verifying each strategy and
 *  clearing up after itself when none of them took. */
async function fillEditor(target: HTMLElement, text: string): Promise<boolean> {
  if (typingInFlight) return false;
  typingInFlight = true;
  try {
    for (const via of ['paste', 'insertText'] as const) {
      clearReplyEditor(target);
      if (via === 'paste') pasteInto(target, text);
      else {
        target.focus();
        document.execCommand('insertText', false, text);
      }
      await sleep(EDITOR_SETTLE_MS);
      if (sameEditorText(editorText(target), text)) return true;
    }
    clearReplyEditor(target);
    return false;
  } finally {
    typingInFlight = false;
  }
}

/** Clipboard only (RD.3) — the delivery the radar variant chips use. Same first
 *  step as `deliverToReplyBox`, minus the fill: on that surface the fill was the
 *  unreliable part, and a mangled composer costs more than a ⌘V. */
async function copyForPaste(text: string): Promise<DeliverMode> {
  try {
    await navigator.clipboard.writeText(text);
    return 'copied';
  } catch (err) {
    console.warn('[stratus] clipboard write failed', err);
    return 'failed';
  }
}

/** The ONE way anything fills X's reply box. Always leaves the text on the
 *  clipboard first, so a failed fill still ends in a one-keystroke paste. */
async function deliverToReplyBox(text: string): Promise<DeliverMode> {
  let copied = true;
  try {
    await navigator.clipboard.writeText(text);
  } catch (err) {
    copied = false;
    console.warn('[stratus] clipboard write failed', err);
  }
  const editor = findReplyEditor();
  if (editor && (await fillEditor(editor, text))) return 'inserted';
  return copied ? 'copied' : 'failed';
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
  // Already on the clipboard by definition — a failed fill costs nothing here,
  // the user just presses ⌘V themselves.
  if (text) await fillEditor(target, text);
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

// ------------------------------------------------ focus-on-arrival (replyFocus)
//
// The side panel copies a drafted reply and opens the tweet in a new tab; this
// end puts the caret in X's composer so the landing keystroke is ⌘V. The
// request is claimed (key removed) BEFORE the composer is even looked for —
// at-most-once is the whole point: a request that survived its attempt would
// steal focus again later, mid-typing, on a page the human is already working.
//
// X renders the status page well after document_idle, so a claimed request
// polls for the composer instead of giving up on the first miss.
const FOCUS_POLL_MS = 250;
const FOCUS_POLL_TRIES = 40; // ~10s

let replyFocusPending = false;

/** Caret into X's reply box, at the end of whatever is already there. */
function focusReplyEditor(): boolean {
  const editor = findReplyEditor();
  if (!editor) return false;
  editor.focus();
  if (editor.isContentEditable) {
    const sel = window.getSelection();
    if (sel) {
      const range = document.createRange();
      range.selectNodeContents(editor);
      range.collapse(false);
      sel.removeAllRanges();
      sel.addRange(range);
    }
  }
  return document.activeElement === editor || editor.contains(document.activeElement);
}

async function pollFocusReplyEditor(): Promise<void> {
  if (replyFocusPending) return;
  replyFocusPending = true;
  try {
    for (let i = 0; i < FOCUS_POLL_TRIES; i++) {
      // The human beat us to it (or started typing elsewhere) — never yank the
      // caret out from under them.
      if (focusedEditable()) return;
      if (focusReplyEditor()) return;
      await sleep(FOCUS_POLL_MS);
    }
  } finally {
    replyFocusPending = false;
  }
}

/** Claim a pending focus request for the tweet this page is showing. */
async function claimReplyFocus(focusedId: string | null): Promise<void> {
  if (focusedId === null || replyFocusPending) return;
  let stored: unknown;
  try {
    const out = await chrome.storage.local.get(REPLY_FOCUS_KEY);
    stored = out[REPLY_FOCUS_KEY];
  } catch {
    return;
  }
  if (!shouldFocusReply(stored, focusedId, Date.now())) return;
  try {
    await chrome.storage.local.remove(REPLY_FOCUS_KEY);
  } catch {
    // Couldn't claim it → don't act on it; another tab may be about to.
    return;
  }
  await pollFocusReplyEditor();
}

function initReplyFocus(): void {
  void claimReplyFocus(focusedTweetIdFromUrl());
  // The panel can also fire while this tab is already parked on the tweet (a
  // second angle taken from the same row) — no navigation, so onChanged is the
  // only signal.
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes[REPLY_FOCUS_KEY]) return;
    if (changes[REPLY_FOCUS_KEY].newValue === undefined) return;
    void claimReplyFocus(focusedTweetIdFromUrl());
  });
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
  // Escape used to abort a multi-second character stream; a fill is a single
  // operation now, so there is nothing left to interrupt.
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
