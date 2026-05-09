// Background service worker — typed API client with auth-header injection.
// All extension contexts (side panel, content script) can route /x/... calls
// through here via chrome.runtime.sendMessage with an ApiRequest payload; we
// load apiUrl + bearer from chrome.storage.local and stamp the Authorization
// header on every outgoing request.

import { type ApiRequest, type ApiResponse, isApiRequest } from './shared/messages.ts';

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

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!isApiRequest(msg)) return false;
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
});
