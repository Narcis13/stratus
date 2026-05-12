// Typed wrapper around chrome.storage.local for the `replyMaster:lastDraft`
// key — the handoff slot the content script writes to after a successful
// generation, and the side panel observes to swap the editor into the new row.
//
// Also owns the `replyMaster:systemPromptOverride` key — a persisted free-form
// system prompt that replaces the server default when non-empty. Both the side
// panel's Regenerate button and the content-script button read it before
// hitting POST /x/replies/generate.

import { useEffect, useState } from 'react';
import type { ReplyDraft } from '../shared/types.ts';

export const LAST_DRAFT_KEY = 'replyMaster:lastDraft';
export const SYSTEM_PROMPT_OVERRIDE_KEY = 'replyMaster:systemPromptOverride';

function isReplyDraft(v: unknown): v is ReplyDraft {
  if (!v || typeof v !== 'object') return false;
  const r = v as Record<string, unknown>;
  return typeof r.id === 'string' && typeof r.replyText === 'string';
}

export async function getLastDraft(): Promise<ReplyDraft | null> {
  const out = await chrome.storage.local.get(LAST_DRAFT_KEY);
  const v = out[LAST_DRAFT_KEY];
  return isReplyDraft(v) ? v : null;
}

export async function setLastDraft(draft: ReplyDraft): Promise<void> {
  await chrome.storage.local.set({ [LAST_DRAFT_KEY]: draft });
}

export async function clearLastDraft(): Promise<void> {
  await chrome.storage.local.remove(LAST_DRAFT_KEY);
}

// Subscribe to chrome.storage.onChanged so the panel re-renders whenever the
// content-script button writes a new draft — even with the panel already open.
export function useLastDraft(): {
  draft: ReplyDraft | null;
  loading: boolean;
  refresh: () => Promise<void>;
} {
  const [draft, setDraft] = useState<ReplyDraft | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    getLastDraft().then((d) => {
      if (!alive) return;
      setDraft(d);
      setLoading(false);
    });

    const onChanged = (
      changes: Record<string, chrome.storage.StorageChange>,
      area: chrome.storage.AreaName,
    ): void => {
      if (area !== 'local') return;
      const change = changes[LAST_DRAFT_KEY];
      if (!change) return;
      const v = change.newValue;
      setDraft(isReplyDraft(v) ? v : null);
    };
    chrome.storage.onChanged.addListener(onChanged);
    return () => {
      alive = false;
      chrome.storage.onChanged.removeListener(onChanged);
    };
  }, []);

  const refresh = async (): Promise<void> => {
    const d = await getLastDraft();
    setDraft(d);
  };

  return { draft, loading, refresh };
}

export async function getSystemPromptOverride(): Promise<string> {
  const out = await chrome.storage.local.get(SYSTEM_PROMPT_OVERRIDE_KEY);
  const v = out[SYSTEM_PROMPT_OVERRIDE_KEY];
  return typeof v === 'string' ? v : '';
}

export async function setSystemPromptOverride(value: string): Promise<void> {
  if (value === '') {
    await chrome.storage.local.remove(SYSTEM_PROMPT_OVERRIDE_KEY);
    return;
  }
  await chrome.storage.local.set({ [SYSTEM_PROMPT_OVERRIDE_KEY]: value });
}

export function useSystemPromptOverride(): {
  value: string;
  loading: boolean;
  save: (next: string) => Promise<void>;
} {
  const [value, setValue] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    getSystemPromptOverride().then((v) => {
      if (!alive) return;
      setValue(v);
      setLoading(false);
    });

    const onChanged = (
      changes: Record<string, chrome.storage.StorageChange>,
      area: chrome.storage.AreaName,
    ): void => {
      if (area !== 'local') return;
      const change = changes[SYSTEM_PROMPT_OVERRIDE_KEY];
      if (!change) return;
      const v = change.newValue;
      setValue(typeof v === 'string' ? v : '');
    };
    chrome.storage.onChanged.addListener(onChanged);
    return () => {
      alive = false;
      chrome.storage.onChanged.removeListener(onChanged);
    };
  }, []);

  const save = async (next: string): Promise<void> => {
    await setSystemPromptOverride(next);
    setValue(next);
  };

  return { value, loading, save };
}
