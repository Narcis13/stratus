// Background service worker — typed API client with auth-header injection.
// All extension contexts (side panel, content script) can route /x/... calls
// through here via chrome.runtime.sendMessage with an ApiRequest payload; we
// load apiUrl + bearer from chrome.storage.local and stamp the Authorization
// header on every outgoing request.

import {
  type ApiRequest,
  type ApiResponse,
  isApiRequest,
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
  appendDismissed,
  draftRowToSighting,
  isRadarSightings,
  mergeSightings,
} from './shared/radar.ts';

chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((err) => console.error('[stratus] sidePanel.setPanelBehavior failed', err));

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
  await chrome.storage.session.set({
    [RADAR_SIGHTINGS_KEY]: mergeSightings(sightings, incoming, dismissed),
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

// Merge server drafts into the buffer. Only tweetIds the buffer does NOT hold
// come in — a live sighting has fresher signals than its hours-old draft row,
// and mergeSightings would let the stale copy win. Dismissed ids are filtered
// by mergeSightings as usual. Returns how many entered.
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
  if (incoming.length === 0) return 0;
  await chrome.storage.session.set({
    [RADAR_SIGHTINGS_KEY]: mergeSightings(sightings, incoming, dismissed),
  });
  return incoming.length;
}

async function rehydrateFromServer(): Promise<{ added: number }> {
  const res = await handleApiRequest({
    type: 'stratus/api',
    method: 'GET',
    path: '/x/radar/drafts',
    query: { status: 'ready' },
  });
  if (!res.ok) return { added: 0 };
  const rows = (res.data as { drafts?: RadarDraftRow[] } | undefined)?.drafts;
  if (!Array.isArray(rows) || rows.length === 0) return { added: 0 };
  let added = 0;
  await enqueueRadar(async () => {
    added = await rehydrateSightings(rows);
  });
  return { added };
}

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
  return false;
});
