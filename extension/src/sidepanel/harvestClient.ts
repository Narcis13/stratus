// Side-panel half of the Harvest feature. Detects what the active tab is
// showing, makes sure the right profile timeline is loaded (navigating in place,
// or opening a new tab if the active tab isn't on X), then opens a port to the
// content-script scrape engine and relays its progress events.

import {
  HARVEST_PORT,
  type HarvestCommand,
  type HarvestContextRequest,
  type HarvestContextResult,
  type HarvestEvent,
  type HarvestOptions,
  harvestTargetUrl,
  isAtTarget,
  isXUrl,
  profileHandleFromUrl,
} from '../shared/harvest.ts';

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export interface ActiveContext {
  tabId: number | null;
  url: string | null;
  onX: boolean;
  handle: string | null; // profile handle detected on the active tab
}

const CONTEXT_REQUEST: HarvestContextRequest = { type: 'stratus/harvest-context' };

export async function readActiveContext(): Promise<ActiveContext> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const url = tab?.url ?? null;
  const onX = isXUrl(url);
  return {
    tabId: tab?.id ?? null,
    url,
    onX,
    handle: onX && url ? profileHandleFromUrl(url) : null,
  };
}

// Poll the content script until it answers the context probe AND reports it is
// on the target page. Verifying the URL is what makes this race-free: right
// after an in-place navigation the *old* content script can still answer for a
// moment, but it reports the old URL, so we keep polling until the freshly
// injected one on the target page responds.
async function waitForContentAt(
  tabId: number,
  matches: (res: HarvestContextResult) => boolean,
  timeoutMs = 25_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = (await chrome.tabs.sendMessage(tabId, CONTEXT_REQUEST)) as
        | HarvestContextResult
        | undefined;
      if (res?.ok && matches(res)) return;
    } catch {
      // no listener yet — page still loading / content script not injected
    }
    await sleep(300);
  }
  throw new Error('content_not_ready');
}

// Resolve a tab that is sitting on exactly the target timeline. Navigates the
// active X tab in place, or opens a fresh tab when the active tab isn't on X.
async function resolveTab(handle: string, options: HarvestOptions): Promise<number> {
  const target = harvestTargetUrl(handle, options.mode);
  const atTarget = (res: HarvestContextResult): boolean =>
    isAtTarget(res.url, handle, options.mode);
  const ctx = await readActiveContext();

  if (ctx.tabId !== null && ctx.onX && ctx.url) {
    const tabId = ctx.tabId;
    if (!isAtTarget(ctx.url, handle, options.mode)) {
      await chrome.tabs.update(tabId, { url: target, active: true });
    }
    await waitForContentAt(tabId, atTarget);
    return tabId;
  }

  const created = await chrome.tabs.create({ url: target, active: true });
  if (created.id === undefined) throw new Error('tab_create_failed');
  await waitForContentAt(created.id, atTarget);
  return created.id;
}

export interface HarvestController {
  cancel(): void;
}

// Starts a harvest and streams every engine event to `onEvent`. The returned
// controller cancels the run. The promise rejects only on setup failure (tab
// navigation / content-script readiness); scrape failures arrive as an 'error'
// event instead.
export async function startHarvest(
  handle: string,
  options: HarvestOptions,
  onEvent: (e: HarvestEvent) => void,
): Promise<HarvestController> {
  const tabId = await resolveTab(handle, options);
  const port = chrome.tabs.connect(tabId, { name: HARVEST_PORT });

  let finished = false;
  port.onMessage.addListener((msg) => {
    const e = msg as HarvestEvent;
    if (e.type === 'done' || e.type === 'error') finished = true;
    onEvent(e);
  });
  port.onDisconnect.addListener(() => {
    void chrome.runtime.lastError; // swallow "disconnected" noise
    if (!finished) {
      finished = true;
      onEvent({ type: 'error', code: 'disconnected' });
    }
  });

  const startCmd: HarvestCommand = { type: 'start', options };
  port.postMessage(startCmd);

  return {
    cancel(): void {
      try {
        const cancelCmd: HarvestCommand = { type: 'cancel' };
        port.postMessage(cancelCmd);
      } catch {
        // port already closed
      }
    },
  };
}
