// Background service worker — typed API client with auth-header injection.
// All extension contexts (side panel, content script) can route /x/... calls
// through here via chrome.runtime.sendMessage with an ApiRequest payload; we
// load apiUrl + bearer from chrome.storage.local and stamp the Authorization
// header on every outgoing request.

import {
  type ActiveLaunch,
  type EarlyReply,
  LAUNCH_ACTIVE_KEY,
  LAUNCH_ALARM_PREFIX,
  LAUNCH_MAX_RETRIES,
  LAUNCH_REPLIES_KEY,
  LAUNCH_RETRY_MS,
  LAUNCH_ROOM_MS,
  LAUNCH_SYNC_ALARM,
  LAUNCH_SYNC_PERIOD_MIN,
  computeLaunchAlarms,
  isActiveLaunch,
  isEarlyReplies,
  launchIsLive,
  mergeEarlyReplies,
  notificationText,
  parseLaunchAlarm,
  retryAlarmName,
  threadLinkInFirstReply,
} from './shared/launch.ts';
import {
  type ApiRequest,
  type ApiResponse,
  isApiRequest,
  isLaunchDismiss,
  isLaunchGet,
  isLaunchReport,
  isLaunchSync,
  isRadarClick,
  isRadarDismiss,
  isRadarRehydrate,
  isRadarReplies,
  isRadarReport,
} from './shared/messages.ts';
import {
  RADAR_DISMISSED_KEY,
  RADAR_SIGHTINGS_KEY,
  type RadarDraftRow,
  type RadarSighting,
  type RankMap,
  appendDismissed,
  draftRowToSighting,
  isRadarSightings,
  mergeSightings,
  stampTiers,
} from './shared/radar.ts';
import type { ScheduledPost, ScheduledPostWithThread } from './shared/types.ts';

chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((err) => console.error('[stratus] sidePanel.setPanelBehavior failed', err));

// --------------------------------------------------------- idea capture (C6)
//
// Right-click any selected text anywhere → "Send selection to stratus ideas".
// Selection + page URL land in the Idea Inbox ($0 DOM; Romanian welcome). The
// action badge flashes ✓/! as feedback — no notifications permission needed.

const IDEA_MENU_ID = 'stratus-send-idea';

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create(
    {
      id: IDEA_MENU_ID,
      title: 'Send selection to stratus ideas',
      contexts: ['selection'],
    },
    () => {
      // "duplicate id" on extension reload is expected — swallow it.
      void chrome.runtime.lastError;
    },
  );
});

function flashBadge(text: string, color: string): void {
  void chrome.action.setBadgeBackgroundColor({ color });
  void chrome.action.setBadgeText({ text });
  setTimeout(() => void chrome.action.setBadgeText({ text: '' }), 2500);
}

chrome.contextMenus.onClicked.addListener((info) => {
  if (info.menuItemId !== IDEA_MENU_ID) return;
  const text = info.selectionText?.trim();
  if (!text) return;
  void handleApiRequest({
    type: 'stratus/api',
    method: 'POST',
    path: '/x/ideas',
    body: { text, ...(info.pageUrl ? { sourceUrl: info.pageUrl } : {}) },
  }).then(
    (res) => {
      if (res.ok) flashBadge('✓', '#00ba7c');
      else {
        console.warn('[stratus] idea capture failed', res.code);
        flashBadge('!', '#f4212e');
      }
    },
    (err) => {
      console.warn('[stratus] idea capture failed', err);
      flashBadge('!', '#f4212e');
    },
  );
});

interface Settings {
  apiUrl: string;
  bearer: string;
}

async function loadSettings(): Promise<Settings> {
  const out = await chrome.storage.local.get(['apiUrl', 'bearer']);
  return {
    apiUrl: typeof out.apiUrl === 'string' ? out.apiUrl : '',
    bearer: typeof out.bearer === 'string' ? out.bearer : '',
  };
}

async function handleApiRequest(req: ApiRequest): Promise<ApiResponse> {
  const { apiUrl, bearer } = await loadSettings();
  if (!apiUrl || !bearer) {
    return { ok: false, status: 0, code: 'unconfigured' };
  }

  const qs = req.query ? new URLSearchParams(req.query).toString() : '';
  const url = `${apiUrl}${req.path}${qs ? `?${qs}` : ''}`;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${bearer}`,
  };
  const hasBody = req.body !== undefined && req.body !== null;
  if (hasBody) headers['Content-Type'] = 'application/json';

  let r: Response;
  try {
    r = await fetch(url, {
      method: req.method,
      headers,
      body: hasBody ? JSON.stringify(req.body) : null,
    });
  } catch (err) {
    console.error('[stratus] fetch failed', err);
    return { ok: false, status: 0, code: 'network_error' };
  }

  if (!r.ok) {
    let code = `http_${r.status}`;
    try {
      const errBody = (await r.json()) as { error?: unknown };
      if (typeof errBody.error === 'string') code = errBody.error;
    } catch {
      // body wasn't JSON — keep generic code
    }
    return { ok: false, status: r.status, code };
  }

  if (r.status === 204) return { ok: true, status: r.status, data: undefined };

  // §S4: binary responses (image blobs) ride back as base64 — the message
  // channel is JSON-only, so a Blob can't cross it. The caller opted in with
  // `binary: true` and unpacks { base64, mediaType }.
  if (req.binary) {
    try {
      const buf = new Uint8Array(await r.arrayBuffer());
      let bin = '';
      for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i] as number);
      return {
        ok: true,
        status: r.status,
        data: { base64: btoa(bin), mediaType: r.headers.get('content-type') ?? 'image/png' },
      };
    } catch (err) {
      console.error('[stratus] binary read failed', err);
      return { ok: false, status: r.status, code: 'binary_read_error' };
    }
  }

  let data: unknown;
  try {
    data = await r.json();
  } catch {
    data = undefined;
  }
  return { ok: true, status: r.status, data };
}

// --------------------------------------------------------------- radar (§7.2)
//
// Session-scoped ring buffer of hot/warm sightings streamed by the content
// script, read by the side panel. Writes are funneled through one promise
// chain: reports arrive from every x.com tab plus dismissals from the panel,
// and chrome.storage has no transactions — interleaved read-modify-writes
// would silently drop entries.

let radarChain: Promise<void> = Promise.resolve();
function enqueueRadar(fn: () => Promise<void>): Promise<void> {
  const next = radarChain.then(fn);
  radarChain = next.catch((err) => console.error('[stratus] radar write failed', err));
  return next;
}

// --- roster tiering (S0.3): who the author is beats how loud the post is ---
//
// A cached handle → {stage, isTarget} map from GET /x/people/rankmap. Refreshed
// on the radar rehydrate cadence (panel mount), TTL 10 min. Every buffer write
// re-stamps RadarSighting.personTier from this, so tiers reflect the latest
// relationship state without the pure merge/rank code needing DB access.
const RANKMAP_TTL_MS = 10 * 60 * 1000;
let rankMap: RankMap = {};
let rankMapAt = 0;
let rankMapInflight: Promise<void> | null = null;

async function refreshRankMap(): Promise<void> {
  if (Date.now() - rankMapAt < RANKMAP_TTL_MS) return;
  if (rankMapInflight) return rankMapInflight;
  rankMapInflight = (async () => {
    const res = await handleApiRequest({
      type: 'stratus/api',
      method: 'GET',
      path: '/x/people/rankmap',
    });
    if (res.ok) {
      const map = (res.data as { map?: RankMap } | undefined)?.map;
      if (map && typeof map === 'object') {
        rankMap = map;
        rankMapAt = Date.now();
      }
    }
  })().finally(() => {
    rankMapInflight = null;
  });
  return rankMapInflight;
}

async function readRadar(): Promise<{ sightings: RadarSighting[]; dismissed: string[] }> {
  const out = await chrome.storage.session.get([RADAR_SIGHTINGS_KEY, RADAR_DISMISSED_KEY]);
  const s = out[RADAR_SIGHTINGS_KEY];
  const d = out[RADAR_DISMISSED_KEY];
  return {
    sightings: isRadarSightings(s) ? s : [],
    dismissed: Array.isArray(d) ? d.filter((x): x is string => typeof x === 'string') : [],
  };
}

async function addSightings(incoming: RadarSighting[]): Promise<void> {
  const { sightings, dismissed } = await readRadar();
  const merged = mergeSightings(sightings, incoming, dismissed);
  await chrome.storage.session.set({
    [RADAR_SIGHTINGS_KEY]: stampTiers(merged, rankMap),
  });
}

async function dismissSightings(tweetIds: string[]): Promise<void> {
  const { sightings, dismissed } = await readRadar();
  const gone = new Set(tweetIds);
  await chrome.storage.session.set({
    [RADAR_SIGHTINGS_KEY]: sightings.filter((s) => !gone.has(s.tweetId)),
    [RADAR_DISMISSED_KEY]: appendDismissed(dismissed, tweetIds),
  });
}

// Attach batch-drafted replies onto matching sightings (§7.2). Single writer,
// same as add/dismiss — a sighting evicted between draft and attach is simply
// skipped (the panel only renders what's in the buffer).
async function attachReplies(items: { tweetId: string; reply: string }[]): Promise<void> {
  const { sightings } = await readRadar();
  const byId = new Map(items.map((i) => [i.tweetId, i.reply]));
  await chrome.storage.session.set({
    [RADAR_SIGHTINGS_KEY]: sightings.map((s) =>
      byId.has(s.tweetId) ? { ...s, reply: byId.get(s.tweetId) } : s,
    ),
  });
}

// Stamp a sighting clicked (§7.2 Clicked view). Single writer, same as the
// others — a sighting evicted between click and write is simply skipped.
async function markClicked(tweetId: string, clickedAt: string): Promise<void> {
  const { sightings } = await readRadar();
  await chrome.storage.session.set({
    [RADAR_SIGHTINGS_KEY]: sightings.map((s) => (s.tweetId === tweetId ? { ...s, clickedAt } : s)),
  });
}

// --- server copy (C0): radar_drafts is the restart-surviving mirror of the
// session buffer. Status flips + rehydration are best-effort — the buffer
// stays authoritative for the live session.

// Fire-and-forget: mirror a click/dismiss onto the server rows so a worked
// tweet doesn't resurrect at the next rehydrate. Losing this write only costs
// a duplicate queue entry after a restart, never a wrong live queue.
function markDraftsOnServer(tweetIds: string[], status: 'clicked' | 'expired'): void {
  if (tweetIds.length === 0) return;
  void handleApiRequest({
    type: 'stratus/api',
    method: 'PATCH',
    path: '/x/radar/drafts',
    body: { tweetIds, status },
  }).then(
    (res) => {
      if (!res.ok && res.code !== 'unconfigured') {
        console.warn('[stratus] radar draft status sync failed', res.code);
      }
    },
    (err) => console.warn('[stratus] radar draft status sync failed', err),
  );
}

// Merge server drafts into the buffer and re-stamp every row's tier from the
// current rankmap. Only tweetIds the buffer does NOT hold come in — a live
// sighting has fresher signals than its hours-old draft row, and mergeSightings
// would let the stale copy win. Dismissed ids are filtered by mergeSightings as
// usual. Runs even with no rows so a refreshed rankmap re-tiers the whole
// buffer. Returns how many drafts entered.
async function rehydrateSightings(rows: RadarDraftRow[]): Promise<number> {
  const { sightings, dismissed } = await readRadar();
  const have = new Set(sightings.map((s) => s.tweetId));
  const gone = new Set(dismissed);
  const incoming: RadarSighting[] = [];
  for (const row of rows) {
    if (have.has(row.tweetId) || gone.has(row.tweetId)) continue;
    const s = draftRowToSighting(row);
    if (s) incoming.push(s);
  }
  const merged = incoming.length ? mergeSightings(sightings, incoming, dismissed) : sightings;
  await chrome.storage.session.set({
    [RADAR_SIGHTINGS_KEY]: stampTiers(merged, rankMap),
  });
  return incoming.length;
}

async function rehydrateFromServer(): Promise<{ added: number }> {
  // Refresh the roster map first (10 min TTL) so the re-stamp below reflects the
  // latest relationship state; a failed fetch keeps the last-known map.
  await refreshRankMap();
  const res = await handleApiRequest({
    type: 'stratus/api',
    method: 'GET',
    path: '/x/radar/drafts',
    query: { status: 'ready' },
  });
  const rows = res.ok ? (res.data as { drafts?: RadarDraftRow[] } | undefined)?.drafts : undefined;
  let added = 0;
  await enqueueRadar(async () => {
    added = await rehydrateSightings(Array.isArray(rows) ? rows : []);
  });
  return { added };
}

// ----------------------------------------------------------- launch room (C7)
//
// The doctrine's highest-leverage window is the 30 minutes right after a post
// goes live. On worker start, panel load and every 15 min we fetch today's
// pending scheduled posts and set one chrome.alarm per scheduledFor (+90s
// grace for the publisher tick). At fire time we verify the post actually
// went live (retrying while the publisher works), then open the room: an
// ActiveLaunch in chrome.storage.session plus a chrome notification. The
// content script streams the early repliers it sees in the DOM; we merge
// them (single writer, same promise-chain discipline as the radar) and
// mirror each NEW replier to POST /x/launch/replies — they engaged first,
// prime CRM material.

let launchChain: Promise<void> = Promise.resolve();
function enqueueLaunch(fn: () => Promise<void>): Promise<void> {
  const next = launchChain.then(fn);
  launchChain = next.catch((err) => console.error('[stratus] launch write failed', err));
  return next;
}

async function readActiveLaunch(): Promise<ActiveLaunch | null> {
  const out = await chrome.storage.session.get(LAUNCH_ACTIVE_KEY);
  const v = out[LAUNCH_ACTIVE_KEY];
  return isActiveLaunch(v) ? v : null;
}

async function syncLaunchAlarms(): Promise<void> {
  // Recently-past window included: a missed fire (browser was closed) still
  // opens the room mid-window via the clamped alarm.
  const from = new Date(Date.now() - LAUNCH_ROOM_MS).toISOString();
  const to = new Date(Date.now() + 24 * 3_600_000).toISOString();
  const res = await handleApiRequest({
    type: 'stratus/api',
    method: 'GET',
    path: '/x/posts/scheduled',
    query: { status: 'pending', from, to },
  });
  if (!res.ok) {
    if (res.code !== 'unconfigured') console.warn('[stratus] launch sync failed', res.code);
    return;
  }
  const posts = Array.isArray(res.data) ? (res.data as ScheduledPost[]) : [];
  const wanted = computeLaunchAlarms(posts, Date.now());
  const wantedNames = new Set(wanted.map((w) => w.name));

  // Drop fire alarms for posts that moved/cancelled; leave retry alarms alone
  // (they resolve themselves against the row's live status).
  const existing = await chrome.alarms.getAll();
  for (const a of existing) {
    if (a.name.startsWith(LAUNCH_ALARM_PREFIX) && !wantedNames.has(a.name)) {
      await chrome.alarms.clear(a.name);
    }
  }
  for (const w of wanted) chrome.alarms.create(w.name, { when: w.when });
}

async function handleLaunchFire(postId: string, attempt: number): Promise<void> {
  const res = await handleApiRequest({
    type: 'stratus/api',
    method: 'GET',
    path: `/x/posts/scheduled/${postId}`,
  });
  if (!res.ok) {
    if (res.code !== 'unconfigured') scheduleLaunchRetry(postId, attempt);
    return;
  }
  const row = res.data as ScheduledPostWithThread;

  if (row.status === 'posted' && row.postedTweetId) {
    // A stale wake (laptop slept through the window) must not shout "just
    // went live" an hour later.
    const scheduledMs = row.scheduledFor ? Date.parse(row.scheduledFor) : Number.NaN;
    if (!Number.isNaN(scheduledMs) && Date.now() - scheduledMs > LAUNCH_ROOM_MS) return;
    await openLaunchRoom(row, row.postedTweetId);
    return;
  }
  // pending: the publisher hasn't ticked yet; publishing: claim in flight (or
  // ambiguous after a 5xx — reconcile may still resolve it). Re-check soon.
  if (row.status === 'pending' || row.status === 'publishing') {
    scheduleLaunchRetry(postId, attempt);
  }
  // failed/cancelled/draft: no room — the calendar shows what happened.
}

function scheduleLaunchRetry(postId: string, attempt: number): void {
  if (attempt >= LAUNCH_MAX_RETRIES) return;
  chrome.alarms.create(retryAlarmName(postId, attempt + 1), {
    when: Date.now() + LAUNCH_RETRY_MS,
  });
}

async function openLaunchRoom(row: ScheduledPostWithThread, tweetId: string): Promise<void> {
  const active: ActiveLaunch = {
    postId: row.id,
    tweetId,
    text: row.text,
    // /i/web/status resolves without knowing my handle.
    url: `https://x.com/i/web/status/${tweetId}`,
    firedAt: new Date().toISOString(),
    linkInFirstReply: threadLinkInFirstReply(row.thread),
  };
  await enqueueLaunch(async () => {
    await chrome.storage.session.set({ [LAUNCH_ACTIVE_KEY]: active, [LAUNCH_REPLIES_KEY]: [] });
  });
  chrome.notifications.create(`stratus-launch-note:${row.id}`, {
    type: 'basic',
    iconUrl: chrome.runtime.getURL('icons/icon128.png'),
    title: 'stratus — Launch Room',
    message: notificationText(row.text),
    priority: 2,
  });
}

// Merge reported early replies into the session feed; mirror the genuinely
// new ones to the server (person upsert + inbound person_event). Best-effort:
// a server hiccup costs CRM bookkeeping, never the live feed.
async function recordEarlyReplies(tweetId: string, replies: EarlyReply[]): Promise<void> {
  const active = await readActiveLaunch();
  if (!active || active.tweetId !== tweetId) return; // stale report
  let added: EarlyReply[] = [];
  await enqueueLaunch(async () => {
    const out = await chrome.storage.session.get(LAUNCH_REPLIES_KEY);
    const existing = isEarlyReplies(out[LAUNCH_REPLIES_KEY]) ? out[LAUNCH_REPLIES_KEY] : [];
    const merged = mergeEarlyReplies(existing, replies);
    added = merged.added;
    await chrome.storage.session.set({ [LAUNCH_REPLIES_KEY]: merged.merged });
  });
  if (added.length === 0) return;
  void handleApiRequest({
    type: 'stratus/api',
    method: 'POST',
    path: '/x/launch/replies',
    body: { replies: added },
  }).then(
    (res) => {
      if (!res.ok && res.code !== 'unconfigured') {
        console.warn('[stratus] launch replies sync failed', res.code);
      }
    },
    (err) => console.warn('[stratus] launch replies sync failed', err),
  );
}

// Runs on every service-worker start; re-creating the periodic alarm is
// idempotent (same name replaces).
chrome.alarms.create(LAUNCH_SYNC_ALARM, { periodInMinutes: LAUNCH_SYNC_PERIOD_MIN });
void syncLaunchAlarms();

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === LAUNCH_SYNC_ALARM) {
    void syncLaunchAlarms();
    return;
  }
  const fire = parseLaunchAlarm(alarm.name);
  if (fire) void handleLaunchFire(fire.postId, fire.attempt);
});

// A notification click is a user gesture, which sidePanel.open needs. Best
// effort — if Chrome disagrees, the panel is one action-click away.
chrome.notifications.onClicked.addListener((id) => {
  if (!id.startsWith('stratus-launch-note:')) return;
  chrome.notifications.clear(id);
  chrome.windows.getLastFocused((win) => {
    if (win?.id !== undefined) {
      chrome.sidePanel.open({ windowId: win.id }).catch(() => {
        /* no gesture credit — ignore */
      });
    }
  });
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (isApiRequest(msg)) {
    void handleApiRequest(msg).then(
      (res) => sendResponse(res),
      (err) => {
        console.error('[stratus] api request crashed', err);
        const fallback: ApiResponse = { ok: false, status: 0, code: 'background_error' };
        sendResponse(fallback);
      },
    );
    // returning true keeps the message channel open for the async sendResponse above
    return true;
  }
  if (isRadarReport(msg)) {
    void enqueueRadar(() => addSightings(msg.sightings)).then(
      () => sendResponse({ ok: true }),
      () => sendResponse({ ok: false }),
    );
    return true;
  }
  if (isRadarDismiss(msg)) {
    markDraftsOnServer(msg.tweetIds, 'expired');
    void enqueueRadar(() => dismissSightings(msg.tweetIds)).then(
      () => sendResponse({ ok: true }),
      () => sendResponse({ ok: false }),
    );
    return true;
  }
  if (isRadarReplies(msg)) {
    void enqueueRadar(() => attachReplies(msg.replies)).then(
      () => sendResponse({ ok: true }),
      () => sendResponse({ ok: false }),
    );
    return true;
  }
  if (isRadarClick(msg)) {
    markDraftsOnServer([msg.tweetId], 'clicked');
    void enqueueRadar(() => markClicked(msg.tweetId, msg.clickedAt)).then(
      () => sendResponse({ ok: true }),
      () => sendResponse({ ok: false }),
    );
    return true;
  }
  if (isRadarRehydrate(msg)) {
    void rehydrateFromServer().then(
      (r) => sendResponse({ ok: true, added: r.added }),
      (err) => {
        console.warn('[stratus] radar rehydrate failed', err);
        sendResponse({ ok: false });
      },
    );
    return true;
  }
  if (isLaunchSync(msg)) {
    void syncLaunchAlarms().then(
      () => sendResponse({ ok: true }),
      () => sendResponse({ ok: false }),
    );
    return true;
  }
  if (isLaunchGet(msg)) {
    void readActiveLaunch().then(
      (active) =>
        sendResponse({
          ok: true,
          active: active && launchIsLive(active.firedAt, Date.now()) ? active : null,
        }),
      () => sendResponse({ ok: false }),
    );
    return true;
  }
  if (isLaunchReport(msg)) {
    void recordEarlyReplies(msg.tweetId, msg.replies).then(
      () => sendResponse({ ok: true }),
      () => sendResponse({ ok: false }),
    );
    return true;
  }
  if (isLaunchDismiss(msg)) {
    void enqueueLaunch(async () => {
      await chrome.storage.session.remove([LAUNCH_ACTIVE_KEY, LAUNCH_REPLIES_KEY]);
    }).then(
      () => sendResponse({ ok: true }),
      () => sendResponse({ ok: false }),
    );
    return true;
  }
  return false;
});
