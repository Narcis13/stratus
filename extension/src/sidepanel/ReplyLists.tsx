// RL.5 — the Lists subtab of the Replies tab: manage premade canned replies.
//
// The panel is deliberately dumb about picking. Every render goes through the
// server (`/use`, `preview:true` here) because the anti-repeat state lives in
// `reply_list_items.lastUsedAt` (Decision 1) — a local pick would fork it. The
// AI generator is proposal-first (Decision 3): `/generate` writes nothing, and
// "Overwrite"/"Append" go through the plain items CRUD, so the destructive step
// stays an explicit human click.

import { type JSX, useCallback, useEffect, useState } from 'react';
import {
  ApiError,
  type GenerateItemsResponse,
  type HumanizerConfig,
  type ReplyList,
  type ReplyListDetail,
  type ReplyListItem,
  type ReplyListSummary,
  type UseReplyResponse,
  api,
} from './api.ts';
import type { Settings } from './storage.ts';

interface Props {
  settings: Settings;
}

/** Mirrors the server's per-call cap (`MAX_ITEMS_PER_CALL`) so a big paste gets
 *  a readable message instead of a bare 400. */
const MAX_ITEMS_PER_CALL = 100;
const MAX_ITEM_LENGTH = 280;
const MAX_GENERATED_ITEMS = 30;
const DEFAULT_GENERATED_ITEMS = 12;

const ERR: Record<string, string> = {
  invalid_name: 'A list needs a name (1–120 characters).',
  invalid_description: 'That description is too long (2000 characters max).',
  invalid_humanizer: 'Those humanizer settings are malformed.',
  invalid_items: `Each item must be 1–${MAX_ITEM_LENGTH} characters, ${MAX_ITEMS_PER_CALL} per save at most.`,
  invalid_text: `An item must be 1–${MAX_ITEM_LENGTH} characters.`,
  invalid_prompt: 'Describe the kind of replies you want (1–2000 characters).',
  invalid_count: `Ask for between 1 and ${MAX_GENERATED_ITEMS} items.`,
  empty_patch: 'Nothing changed.',
  no_enabled_items: 'Nothing to pick from — add items and switch at least one on.',
  // D80: the generator goes through askLLM, so a keyless server answers
  // llm_not_configured — NOT the old grok_not_configured.
  llm_not_configured: 'AI generation is off — the server has no LLM provider key.',
  items_parse_error: 'The model returned something unreadable. Try again.',
  items_invalid: 'Nothing usable came back — try a more specific prompt.',
  not_found: 'That list is gone. Refresh.',
};

function errMsg(e: unknown, fallback: string): string {
  if (e instanceof ApiError) return ERR[e.code] ?? `${e.code} (${e.status})`;
  return fallback;
}

function usedLine(item: ReplyListItem): string {
  if (item.useCount === 0 || !item.lastUsedAt) return 'never used';
  const days = Math.floor((Date.now() - new Date(item.lastUsedAt).getTime()) / 86_400_000);
  const when = days <= 0 ? 'today' : days === 1 ? 'yesterday' : `${days}d ago`;
  return `used ${item.useCount}× · last ${when}`;
}

export function ReplyListsPanel({ settings }: Props): JSX.Element {
  const [lists, setLists] = useState<ReplyListSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ReplyListDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadLists = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setLists(await api.replyLists.list(settings));
    } catch (e) {
      setError(errMsg(e, 'Failed to load reply lists'));
    } finally {
      setLoading(false);
    }
  }, [settings]);

  useEffect(() => {
    void loadLists();
  }, [loadLists]);

  // Keep the current selection while it still exists; otherwise fall to the
  // first list (and to nothing when there are none).
  useEffect(() => {
    setSelectedId((prev) => {
      if (lists.length === 0) return null;
      if (prev && lists.some((l) => l.id === prev)) return prev;
      return lists[0]?.id ?? null;
    });
  }, [lists]);

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    setLoadingDetail(true);
    api.replyLists
      .get(settings, selectedId)
      .then((d) => {
        if (!cancelled) setDetail(d);
      })
      .catch((e) => {
        if (!cancelled) setError(errMsg(e, 'Failed to load that list'));
      })
      .finally(() => {
        if (!cancelled) setLoadingDetail(false);
      });
    return () => {
      cancelled = true;
    };
  }, [settings, selectedId]);

  const onListSaved = (updated: ReplyList): void => {
    setDetail((prev) => (prev && prev.list.id === updated.id ? { ...prev, list: updated } : prev));
    setLists((prev) => prev.map((l) => (l.id === updated.id ? { ...l, ...updated } : l)));
  };

  const onListDeleted = (id: string): void => {
    setLists((prev) => prev.filter((l) => l.id !== id));
    setDetail(null);
  };

  const onItemsChanged = (items: ReplyListItem[]): void => {
    setDetail((prev) => (prev ? { ...prev, items } : prev));
    setLists((prev) =>
      prev.map((l) =>
        l.id === selectedId
          ? { ...l, itemCount: items.length, enabledCount: items.filter((i) => i.enabled).length }
          : l,
      ),
    );
  };

  return (
    <div className="rl-panel">
      <div className="row rl-head">
        <p className="muted">
          Premade replies for the moments the machinery already surfaces. Picked with an anti-repeat
          shuffle, vars filled from the target, lightly humanized — then copied for a manual paste.
        </p>
        <button type="button" onClick={() => void loadLists()} disabled={loading}>
          {loading ? 'Loading…' : 'Refresh'}
        </button>
      </div>

      {error && <div className="error">{error}</div>}

      {loading && lists.length === 0 ? (
        <p className="muted">Loading lists…</p>
      ) : lists.length === 0 ? (
        <p className="muted">No lists yet. Create one below, then add or generate items.</p>
      ) : (
        <div className="rl-rail">
          {lists.map((l) => (
            <button
              key={l.id}
              type="button"
              className={`rl-rail-item${l.id === selectedId ? ' active' : ''}${
                l.active ? '' : ' rl-rail-inactive'
              }`}
              onClick={() => setSelectedId(l.id)}
            >
              <span className="rl-rail-name">{l.name}</span>
              <span className="rl-rail-meta">
                {l.itemCount} item{l.itemCount === 1 ? '' : 's'} · {l.enabledCount} on
                {l.active ? '' : ' · off'}
              </span>
            </button>
          ))}
        </div>
      )}

      <CreateList
        settings={settings}
        onCreated={(created) => {
          setLists((prev) => [...prev, { ...created, itemCount: 0, enabledCount: 0 }]);
          setSelectedId(created.id);
        }}
      />

      {loadingDetail && !detail && <p className="muted">Loading list…</p>}

      {detail && (
        <ListDetail
          key={detail.list.id}
          settings={settings}
          detail={detail}
          onListSaved={onListSaved}
          onListDeleted={onListDeleted}
          onItemsChanged={onItemsChanged}
        />
      )}
    </div>
  );
}

// ----------------------------------------------------------------- create

function CreateList({
  settings,
  onCreated,
}: {
  settings: Settings;
  onCreated: (list: ReplyList) => void;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const create = async (): Promise<void> => {
    setBusy(true);
    setErr(null);
    try {
      const created = await api.replyLists.create(settings, {
        name: name.trim(),
        ...(description.trim() ? { description: description.trim() } : {}),
      });
      onCreated(created);
      setName('');
      setDescription('');
      setOpen(false);
    } catch (e) {
      setErr(errMsg(e, 'Create failed'));
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <div className="pillar-add-bar">
        <button type="button" onClick={() => setOpen(true)}>
          + New list
        </button>
      </div>
    );
  }

  return (
    <div className="pillar-card pillar-add">
      <div className="pillar-card-head">
        <strong>New list</strong>
      </div>
      <label className="field">
        <span>Name</span>
        <input
          placeholder="e.g. early-commenter thanks"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </label>
      <label className="field">
        <span>What it's for (optional)</span>
        <input value={description} onChange={(e) => setDescription(e.target.value)} />
      </label>
      {err && <div className="error">{err}</div>}
      <div className="pillar-card-actions">
        <button
          type="button"
          className="primary"
          onClick={() => void create()}
          disabled={busy || name.trim() === ''}
        >
          {busy ? '…' : 'Create'}
        </button>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setErr(null);
          }}
          disabled={busy}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

// ----------------------------------------------------------------- detail

interface DetailProps {
  settings: Settings;
  detail: ReplyListDetail;
  onListSaved: (list: ReplyList) => void;
  onListDeleted: (id: string) => void;
  onItemsChanged: (items: ReplyListItem[]) => void;
}

function ListDetail({
  settings,
  detail,
  onListSaved,
  onListDeleted,
  onItemsChanged,
}: DetailProps): JSX.Element {
  const { list, items } = detail;
  return (
    <div className="rl-detail">
      <ListSettings
        settings={settings}
        list={list}
        onSaved={onListSaved}
        onDeleted={onListDeleted}
      />
      <ItemsEditor
        settings={settings}
        listId={list.id}
        items={items}
        onItemsChanged={onItemsChanged}
      />
      <HumanizerEditor settings={settings} list={list} onSaved={onListSaved} />
      <TestRender settings={settings} listId={list.id} />
      <GenerateBox settings={settings} listId={list.id} onApplied={onItemsChanged} />
    </div>
  );
}

function ListSettings({
  settings,
  list,
  onSaved,
  onDeleted,
}: {
  settings: Settings;
  list: ReplyList;
  onSaved: (list: ReplyList) => void;
  onDeleted: (id: string) => void;
}): JSX.Element {
  const [name, setName] = useState(list.name);
  const [description, setDescription] = useState(list.description ?? '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  // Re-sync when the row is replaced by a server response.
  useEffect(() => {
    setName(list.name);
    setDescription(list.description ?? '');
  }, [list.name, list.description]);

  const dirty = name !== list.name || description !== (list.description ?? '');

  const run = async (fn: () => Promise<void>): Promise<void> => {
    setBusy(true);
    setErr(null);
    try {
      await fn();
    } catch (e) {
      setErr(errMsg(e, 'Update failed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={`pillar-card${list.active ? '' : ' pillar-inactive'}`}>
      <div className="pillar-card-head">
        <strong>{list.name}</strong>
        {!list.active && <span className="badge badge-paused">inactive</span>}
        {dirty && <span className="badge badge-auto">unsaved</span>}
      </div>

      <label className="field">
        <span>Name</span>
        <input value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <label className="field">
        <span>What it's for</span>
        <input value={description} onChange={(e) => setDescription(e.target.value)} />
      </label>

      {err && <div className="error">{err}</div>}

      <div className="pillar-card-actions">
        <button
          type="button"
          className="primary"
          disabled={busy || !dirty || name.trim() === ''}
          onClick={() =>
            void run(async () => {
              onSaved(
                await api.replyLists.patch(settings, list.id, {
                  name: name.trim(),
                  description: description.trim() === '' ? null : description.trim(),
                }),
              );
            })
          }
        >
          {busy ? '…' : 'Save'}
        </button>
        <button
          type="button"
          disabled={busy || !dirty}
          onClick={() => {
            setName(list.name);
            setDescription(list.description ?? '');
          }}
        >
          Reset
        </button>
        <button
          type="button"
          disabled={busy}
          title="An inactive list stays usable — it just reads as parked."
          onClick={() =>
            void run(async () => {
              onSaved(await api.replyLists.patch(settings, list.id, { active: !list.active }));
            })
          }
        >
          {list.active ? 'Deactivate' : 'Activate'}
        </button>
        {confirming ? (
          <>
            <button
              type="button"
              className="danger"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await api.replyLists.remove(settings, list.id);
                  onDeleted(list.id);
                })
              }
            >
              {busy ? '…' : 'Confirm delete'}
            </button>
            <button type="button" disabled={busy} onClick={() => setConfirming(false)}>
              cancel
            </button>
          </>
        ) : (
          <button
            type="button"
            className="danger"
            disabled={busy}
            title="Deletes the list and its items — the use history survives"
            onClick={() => setConfirming(true)}
          >
            Delete
          </button>
        )}
      </div>
    </div>
  );
}

// ----------------------------------------------------------------- items

function ItemsEditor({
  settings,
  listId,
  items,
  onItemsChanged,
}: {
  settings: Settings;
  listId: string;
  items: ReplyListItem[];
  onItemsChanged: (items: ReplyListItem[]) => void;
}): JSX.Element {
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const add = async (): Promise<void> => {
    const lines = draft
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l !== '');
    if (lines.length === 0) {
      setErr('Type at least one line — one reply per line.');
      return;
    }
    if (lines.length > MAX_ITEMS_PER_CALL) {
      setErr(`${lines.length} lines — ${MAX_ITEMS_PER_CALL} per save at most.`);
      return;
    }
    const tooLong = lines.find((l) => l.length > MAX_ITEM_LENGTH);
    if (tooLong) {
      setErr(`"${tooLong.slice(0, 40)}…" is over ${MAX_ITEM_LENGTH} characters.`);
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      onItemsChanged(
        await api.replyLists.setItems(settings, listId, {
          mode: 'append',
          items: lines.map((text) => ({ text })),
        }),
      );
      setDraft('');
    } catch (e) {
      setErr(errMsg(e, 'Add failed'));
    } finally {
      setBusy(false);
    }
  };

  const onItemSaved = (updated: ReplyListItem): void => {
    onItemsChanged(items.map((i) => (i.id === updated.id ? updated : i)));
  };
  const onItemDeleted = (id: string): void => {
    onItemsChanged(items.filter((i) => i.id !== id));
  };

  return (
    <div className="pillar-card">
      <div className="pillar-card-head">
        <strong>Items</strong>
        <span className="status-line">
          {items.length} total · {items.filter((i) => i.enabled).length} enabled
        </span>
      </div>

      {items.length === 0 ? (
        <p className="muted">
          No items yet. Add a few below — <code>{'{name}'}</code>, <code>{'{first_name}'}</code> and{' '}
          <code>{'{handle}'}</code> get filled from whoever you're replying to.
        </p>
      ) : (
        <ul className="rl-items">
          {items.map((item) => (
            <li key={item.id}>
              <ItemRow
                settings={settings}
                listId={listId}
                item={item}
                onSaved={onItemSaved}
                onDeleted={onItemDeleted}
              />
            </li>
          ))}
        </ul>
      )}

      <label className="field">
        <span>
          Add items <small>one reply per line</small>
        </span>
        <textarea
          rows={3}
          placeholder={'Thanks for the early read, {name}!\nthis one’s going in the swipe file'}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
      </label>

      {err && <div className="error">{err}</div>}

      <div className="pillar-card-actions">
        <button
          type="button"
          className="primary"
          onClick={() => void add()}
          disabled={busy || draft.trim() === ''}
        >
          {busy ? '…' : 'Add'}
        </button>
      </div>
    </div>
  );
}

function ItemRow({
  settings,
  listId,
  item,
  onSaved,
  onDeleted,
}: {
  settings: Settings;
  listId: string;
  item: ReplyListItem;
  onSaved: (item: ReplyListItem) => void;
  onDeleted: (id: string) => void;
}): JSX.Element {
  const [text, setText] = useState(item.text);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setText(item.text);
  }, [item.text]);

  const dirty = text !== item.text;

  const run = async (fn: () => Promise<void>): Promise<void> => {
    setBusy(true);
    setErr(null);
    try {
      await fn();
    } catch (e) {
      setErr(errMsg(e, 'Update failed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={`rl-item${item.enabled ? '' : ' rl-item-off'}`}>
      <textarea
        rows={2}
        value={text}
        onChange={(e) => setText(e.target.value)}
        className="rl-item-text"
      />
      <div className="rl-item-foot">
        <span className="status-line">
          {usedLine(item)}
          {item.source === 'ai' ? ' · ai' : ''}
        </span>
        <div className="rl-item-actions">
          {dirty && (
            <button
              type="button"
              className="primary"
              disabled={busy || text.trim() === ''}
              onClick={() =>
                void run(async () => {
                  onSaved(
                    await api.replyLists.patchItem(settings, listId, item.id, {
                      text: text.trim(),
                    }),
                  );
                })
              }
            >
              Save
            </button>
          )}
          <button
            type="button"
            disabled={busy}
            title={item.enabled ? 'Stop picking this one' : 'Put it back in the rotation'}
            onClick={() =>
              void run(async () => {
                onSaved(
                  await api.replyLists.patchItem(settings, listId, item.id, {
                    enabled: !item.enabled,
                  }),
                );
              })
            }
          >
            {item.enabled ? 'On' : 'Off'}
          </button>
          <button
            type="button"
            className="danger"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                await api.replyLists.removeItem(settings, listId, item.id);
                onDeleted(item.id);
              })
            }
          >
            ✕
          </button>
        </div>
      </div>
      {err && <div className="error">{err}</div>}
    </div>
  );
}

// ------------------------------------------------------------- humanizer

const CHANCE_FIELDS: { key: keyof HumanizerConfig; label: string }[] = [
  { key: 'prefixChance', label: 'Prefix' },
  { key: 'suffixChance', label: 'Suffix' },
  { key: 'lowercaseChance', label: 'Lowercase start' },
  { key: 'dropPeriodChance', label: 'Drop final period' },
  { key: 'typoChance', label: 'Typo' },
];

function HumanizerEditor({
  settings,
  list,
  onSaved,
}: {
  settings: Settings;
  list: ReplyList;
  onSaved: (list: ReplyList) => void;
}): JSX.Element {
  const stored = list.humanizer;
  const [prefixes, setPrefixes] = useState((stored?.prefixes ?? []).join('\n'));
  const [suffixes, setSuffixes] = useState((stored?.suffixes ?? []).join('\n'));
  const [chances, setChances] = useState<Record<string, number>>(() => chanceMap(stored));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setPrefixes((stored?.prefixes ?? []).join('\n'));
    setSuffixes((stored?.suffixes ?? []).join('\n'));
    setChances(chanceMap(stored));
  }, [stored]);

  const run = async (fn: () => Promise<void>): Promise<void> => {
    setBusy(true);
    setErr(null);
    try {
      await fn();
    } catch (e) {
      setErr(errMsg(e, 'Update failed'));
    } finally {
      setBusy(false);
    }
  };

  // No local copy of DEFAULT_HUMANIZER: PATCHing `{}` makes the server
  // lenient-parse every field to its default and hand the whole config back, so
  // the form is always seeded from the engine's own numbers.
  if (!stored) {
    return (
      <div className="pillar-card">
        <div className="pillar-card-head">
          <strong>Humanizer</strong>
          <span className="badge badge-auto">defaults</span>
        </div>
        <p className="muted">
          Using the engine defaults — an occasional neutral prefix or suffix, a lowercase start, a
          dropped final period, and a rare deliberate typo (never inside a name, handle or link).
        </p>
        {err && <div className="error">{err}</div>}
        <div className="pillar-card-actions">
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                onSaved(await api.replyLists.patch(settings, list.id, { humanizer: {} }));
              })
            }
          >
            {busy ? '…' : 'Customize for this list'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="pillar-card">
      <div className="pillar-card-head">
        <strong>Humanizer</strong>
        <span className="badge badge-pending">custom</span>
      </div>

      <label className="field">
        <span>
          Prefixes <small>one per line</small>
        </span>
        <textarea rows={3} value={prefixes} onChange={(e) => setPrefixes(e.target.value)} />
      </label>
      <label className="field">
        <span>
          Suffixes <small>one per line</small>
        </span>
        <textarea rows={3} value={suffixes} onChange={(e) => setSuffixes(e.target.value)} />
      </label>

      <div className="rl-chances">
        {CHANCE_FIELDS.map((f) => (
          <label className="field rl-chance" key={f.key}>
            <span>
              {f.label} <strong>{Math.round((chances[f.key] ?? 0) * 100)}%</strong>
            </span>
            <input
              type="range"
              min={0}
              max={100}
              step={5}
              value={Math.round((chances[f.key] ?? 0) * 100)}
              onChange={(e) =>
                setChances((prev) => ({ ...prev, [f.key]: Number(e.target.value) / 100 }))
              }
            />
          </label>
        ))}
      </div>

      {err && <div className="error">{err}</div>}

      <div className="pillar-card-actions">
        <button
          type="button"
          className="primary"
          disabled={busy}
          onClick={() =>
            void run(async () => {
              onSaved(
                await api.replyLists.patch(settings, list.id, {
                  humanizer: {
                    prefixes: splitLines(prefixes),
                    suffixes: splitLines(suffixes),
                    prefixChance: chances.prefixChance ?? 0,
                    suffixChance: chances.suffixChance ?? 0,
                    lowercaseChance: chances.lowercaseChance ?? 0,
                    dropPeriodChance: chances.dropPeriodChance ?? 0,
                    typoChance: chances.typoChance ?? 0,
                  },
                }),
              );
            })
          }
        >
          {busy ? '…' : 'Save humanizer'}
        </button>
        <button
          type="button"
          disabled={busy}
          title="Go back to the engine defaults"
          onClick={() =>
            void run(async () => {
              onSaved(await api.replyLists.patch(settings, list.id, { humanizer: null }));
            })
          }
        >
          Reset to defaults
        </button>
      </div>
    </div>
  );
}

function chanceMap(cfg: HumanizerConfig | null): Record<string, number> {
  const out: Record<string, number> = {};
  for (const f of CHANCE_FIELDS) {
    const v = cfg?.[f.key];
    out[f.key] = typeof v === 'number' ? v : 0;
  }
  return out;
}

function splitLines(raw: string): string[] {
  return raw
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l !== '');
}

// ----------------------------------------------------------- test render

function TestRender({ settings, listId }: { settings: Settings; listId: string }): JSX.Element {
  const [name, setName] = useState('Ana Pop');
  const [handle, setHandle] = useState('anapop');
  const [result, setResult] = useState<UseReplyResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const run = async (): Promise<void> => {
    setBusy(true);
    setErr(null);
    try {
      // preview:true — renders a sample without touching the anti-repeat state,
      // so testing never burns a fresh item on nobody.
      setResult(
        await api.replyLists.use(settings, listId, {
          vars: {
            ...(name.trim() ? { name: name.trim() } : {}),
            ...(handle.trim() ? { handle: handle.trim() } : {}),
          },
          preview: true,
        }),
      );
    } catch (e) {
      setErr(errMsg(e, 'Test render failed'));
      setResult(null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="pillar-card">
      <div className="pillar-card-head">
        <strong>Test render</strong>
        <span className="status-line">preview only — nothing is marked used</span>
      </div>
      <div className="rl-testvars">
        <label className="field">
          <span>{'{name}'}</span>
          <input value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="field">
          <span>{'{handle}'}</span>
          <input value={handle} onChange={(e) => setHandle(e.target.value)} spellCheck={false} />
        </label>
      </div>

      {err && <div className="error">{err}</div>}

      {result && (
        <div className="rl-preview">
          <div className="rl-preview-text">{result.text}</div>
          <div className="status-line">
            {result.applied.length > 0 ? `jitter: ${result.applied.join(', ')}` : 'no jitter fired'}
            {result.missingVars.length > 0 && <> · missing: {result.missingVars.join(', ')}</>}
          </div>
        </div>
      )}

      <div className="pillar-card-actions">
        <button type="button" onClick={() => void run()} disabled={busy}>
          {busy ? '…' : 'Test render'}
        </button>
      </div>
    </div>
  );
}

// -------------------------------------------------------------- generate

function GenerateBox({
  settings,
  listId,
  onApplied,
}: {
  settings: Settings;
  listId: string;
  onApplied: (items: ReplyListItem[]) => void;
}): JSX.Element {
  const [prompt, setPrompt] = useState('');
  const [count, setCount] = useState(DEFAULT_GENERATED_ITEMS);
  const [proposal, setProposal] = useState<GenerateItemsResponse | null>(null);
  const [texts, setTexts] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [applying, setApplying] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const generate = async (): Promise<void> => {
    setBusy(true);
    setErr(null);
    try {
      const res = await api.replyLists.generate(settings, listId, {
        prompt: prompt.trim(),
        count,
      });
      setProposal(res);
      setTexts(res.items.map((i) => i.text));
    } catch (e) {
      setErr(errMsg(e, 'Generate failed'));
    } finally {
      setBusy(false);
    }
  };

  // The generator never persists anything (Decision 3) — this is the click that
  // does, through the plain items CRUD.
  const apply = async (mode: 'append' | 'replace'): Promise<void> => {
    if (
      mode === 'replace' &&
      !confirm(`Replace every item in this list with these ${texts.length}?`)
    )
      return;
    setApplying(true);
    setErr(null);
    try {
      onApplied(
        await api.replyLists.setItems(settings, listId, {
          mode,
          items: texts.map((text) => ({ text })),
          source: 'ai',
        }),
      );
      setProposal(null);
      setTexts([]);
    } catch (e) {
      setErr(errMsg(e, 'Apply failed'));
    } finally {
      setApplying(false);
    }
  };

  return (
    <div className="pillar-card">
      <div className="pillar-card-head">
        <strong>Generate with AI</strong>
        <span className="status-line">
          one call ≈ $0.003–0.01 · nothing is saved until you apply
        </span>
      </div>

      <label className="field">
        <span>What kind of replies?</span>
        <textarea
          rows={2}
          placeholder="short congratulation replies, some using {name}, no emoji"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
        />
      </label>
      <label className="field rl-count">
        <span>How many</span>
        <input
          type="number"
          min={1}
          max={MAX_GENERATED_ITEMS}
          value={count}
          onChange={(e) => setCount(Number(e.target.value))}
        />
      </label>

      {err && <div className="error">{err}</div>}

      {proposal && (
        <div className="rl-proposals">
          <div className="status-line">
            {texts.length} of {proposal.requested} proposed · {proposal.model} · $
            {proposal.costUsd.toFixed(4)}
          </div>
          <ul className="rl-items">
            {texts.map((t, i) => (
              // Proposals are plain strings with no id — index keys are fine
              // here because the list is only ever filtered, never reordered.
              <li key={`${i}-${t.slice(0, 24)}`}>
                <div className="rl-item">
                  <div className="rl-proposal-text">{t}</div>
                  <div className="rl-item-actions">
                    <button
                      type="button"
                      className="danger"
                      disabled={applying}
                      title="Drop this one before applying"
                      onClick={() => setTexts((prev) => prev.filter((_, idx) => idx !== i))}
                    >
                      ✕
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="pillar-card-actions">
        <button
          type="button"
          className="primary"
          onClick={() => void generate()}
          disabled={busy || applying || prompt.trim() === ''}
        >
          {busy ? 'Generating…' : proposal ? 'Regenerate' : 'Generate'}
        </button>
        {proposal && (
          <>
            <button
              type="button"
              disabled={applying || texts.length === 0}
              onClick={() => void apply('append')}
            >
              {applying ? '…' : 'Append'}
            </button>
            <button
              type="button"
              className="danger"
              disabled={applying || texts.length === 0}
              onClick={() => void apply('replace')}
            >
              {applying ? '…' : 'Overwrite list'}
            </button>
            <button
              type="button"
              disabled={applying}
              onClick={() => {
                setProposal(null);
                setTexts([]);
              }}
            >
              Discard
            </button>
          </>
        )}
      </div>
    </div>
  );
}
