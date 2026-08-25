// OU.5 — Outliers: the x.com advanced-search hunt. A structured form compiles
// to a correct operator string, shows it live, and hands it off — Copy first
// (paste into X's own search box), Open in X second.
//
// **The preview never touches the network.** The form recompiles through the
// `../searchQuery.ts` shim on every render — pure, dependency-free, microseconds
// — so there is no debounce, no request per keystroke, and no way for what the
// panel shows to disagree with what a save would store (§7.27). `POST
// /x/searches/compile` exists for callers that have no copy of the compiler;
// this tab is not one of them, which is why `api.searches` has no `compile`.
//
// **Everything here is $0.** The hand-off is a clipboard write and a tab move
// (§7.28's manual-paste discipline in a new place); the results are worked on
// x.com, where `content.ts`'s save-button attach has no path gate, so every
// result already carries **Save to stratus** with no capture code of its own.
//
// The unsaved form is mirrored into `chrome.storage.local` under
// `outliers:draft` so closing the panel mid-hunt doesn't lose it. That is a
// panel-owned control key, not session buffer state, so §7.24's single-writer
// rule does not apply.

import { type JSX, useCallback, useEffect, useState } from 'react';
import {
  MAX_QUERY_LENGTH,
  type MediaFilter,
  type Problem,
  type RepliesFilter,
  SEARCH_LANGS,
  type SearchQuery,
  type SearchSort,
  compileSearchQuery,
  parseSearchQuery,
  searchUrl,
} from '../searchQuery.ts';
import { ApiError, type SavedSearchItem, api } from './api.ts';
import { readActiveContext } from './harvestClient.ts';
import type { Settings } from './storage.ts';
import { EmptyState } from './ui/EmptyState.tsx';
import { Section } from './ui/Section.tsx';

interface Props {
  settings: Settings;
}

const DRAFT_KEY = 'outliers:draft';
const DRAFT_WRITE_MS = 400;
/** The counter ramps neutral → warn before the 512 cliff (the `.counter` scale
 *  the Composer already uses), so going over is never a surprise. */
const NEAR_LIMIT = Math.floor(MAX_QUERY_LENGTH * 0.85);

const MEDIA_VALUES: MediaFilter[] = ['any', 'media', 'images', 'videos', 'native_video'];
const MEDIA_LABEL: Record<MediaFilter, string> = {
  any: 'any',
  media: 'has media',
  images: 'images',
  videos: 'videos',
  native_video: 'native video',
};
const REPLIES_VALUES: RepliesFilter[] = ['any', 'exclude', 'only'];
const REPLIES_LABEL: Record<RepliesFilter, string> = {
  any: 'any',
  exclude: 'top-level only',
  only: 'replies only',
};
/** Three states, not a checkbox: the compiler emits BOTH arms (`filter:links`
 *  and `-filter:links`), and "plain-text posts only" is a real hunt (D202). */
type LinksMode = 'any' | 'with' | 'without';
const LINKS_LABEL: Record<LinksMode, string> = {
  any: 'any',
  with: 'with a link',
  without: 'no links',
};

const ERR: Record<string, string> = {
  invalid_body: 'That hunt could not be read.',
  invalid_name: 'A hunt needs a name (1–120 characters).',
  invalid_query: 'X would refuse that query — fix the errors under the fields first.',
  invalid_sort: 'That results tab is not one X has.',
  invalid_pinned: 'That pin value is not a boolean.',
  invalid_id: 'That hunt id is malformed.',
  empty_patch: 'Nothing changed.',
  uncompilable: 'That saved query no longer compiles — load it and fix it.',
  not_found: 'That hunt is gone. Refresh.',
};

function errMsg(e: unknown, fallback: string): string {
  if (e instanceof ApiError) return ERR[e.code] ?? `${e.code} (${e.status})`;
  return fallback;
}

// ---------------------------------------------------------------- form state

interface FormState {
  all: string;
  any: string;
  phrases: string;
  none: string;
  from: string;
  to: string;
  mentions: string;
  hashtags: string;
  minFaves: string;
  minRetweets: string;
  minReplies: string;
  replies: RepliesFilter;
  media: MediaFilter;
  links: LinksMode;
  noRetweets: boolean;
  lang: string;
  since: string;
  until: string;
  sort: SearchSort;
}

// Floors are held as STRINGS, not numbers: `Number('')` is 0 and 0 is a real
// value here ("no floor"), so an emptied box must stay empty rather than
// becoming a floor of zero on its way through the compiler.
const EMPTY_FORM: FormState = {
  all: '',
  any: '',
  phrases: '',
  none: '',
  from: '',
  to: '',
  mentions: '',
  hashtags: '',
  minFaves: '',
  minRetweets: '',
  minReplies: '',
  replies: 'any',
  media: 'any',
  links: 'any',
  noRetweets: false,
  lang: '',
  since: '',
  until: '',
  sort: 'top',
};

/** Commas OR newlines, so a pasted list works either way. Trimming, dropping
 *  empties, deduping and the per-field cap are all `parseSearchQuery`'s job —
 *  doing any of it here would fork the normalization the server runs. */
const splitTerms = (s: string): string[] => s.split(/[\n,]/);
/** Phrases split on newlines ONLY — a comma inside an exact wording is part of
 *  the phrase, and silently cutting it in two would change what X matches. */
const splitLines = (s: string): string[] => s.split('\n');

function numOrUndefined(s: string): number | undefined {
  const t = s.trim();
  if (t === '') return undefined;
  const n = Number(t);
  return Number.isFinite(n) ? n : undefined;
}

/** The form as the server would store it. Routed through `parseSearchQuery` so
 *  the previewed string is compiled from the SAME normalized value a save
 *  writes — dedupe, caps and all. `null` is unreachable (the argument is always
 *  an object) and degrades to an empty query, which the compiler reports. */
function toQuery(f: FormState): SearchQuery {
  return (
    parseSearchQuery({
      all: splitTerms(f.all),
      any: splitTerms(f.any),
      phrases: splitLines(f.phrases),
      none: splitTerms(f.none),
      from: f.from,
      to: f.to,
      mentions: splitTerms(f.mentions),
      hashtags: splitTerms(f.hashtags),
      minFaves: numOrUndefined(f.minFaves),
      minRetweets: numOrUndefined(f.minRetweets),
      minReplies: numOrUndefined(f.minReplies),
      replies: f.replies,
      media: f.media,
      hasLinks: f.links === 'any' ? undefined : f.links === 'with',
      noRetweets: f.noRetweets,
      lang: f.lang,
      since: f.since,
      until: f.until,
      sort: f.sort,
    }) ?? {}
  );
}

function fromQuery(q: SearchQuery): FormState {
  return {
    all: (q.all ?? []).join(', '),
    any: (q.any ?? []).join(', '),
    phrases: (q.phrases ?? []).join('\n'),
    none: (q.none ?? []).join(', '),
    from: q.from ?? '',
    to: q.to ?? '',
    mentions: (q.mentions ?? []).join(', '),
    hashtags: (q.hashtags ?? []).join(', '),
    minFaves: q.minFaves ? String(q.minFaves) : '',
    minRetweets: q.minRetweets ? String(q.minRetweets) : '',
    minReplies: q.minReplies ? String(q.minReplies) : '',
    replies: q.replies ?? 'any',
    media: q.media ?? 'any',
    links: q.hasLinks === undefined ? 'any' : q.hasLinks ? 'with' : 'without',
    noRetweets: q.noRetweets === true,
    lang: q.lang ?? '',
    since: q.since ?? '',
    until: q.until ?? '',
    sort: q.sort ?? 'top',
  };
}

/** The stored draft is a round-trip of our own writes, but it crosses
 *  `chrome.storage.local` — an older shape, or a hand-edited key, must degrade
 *  field by field rather than throw the tab away. */
function coerceForm(v: unknown): FormState | null {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return null;
  const r = v as Record<string, unknown>;
  const str = (k: string): string => {
    const raw = r[k];
    return typeof raw === 'string' ? raw : '';
  };
  return {
    all: str('all'),
    any: str('any'),
    phrases: str('phrases'),
    none: str('none'),
    from: str('from'),
    to: str('to'),
    mentions: str('mentions'),
    hashtags: str('hashtags'),
    minFaves: str('minFaves'),
    minRetweets: str('minRetweets'),
    minReplies: str('minReplies'),
    replies: REPLIES_VALUES.find((x) => x === r.replies) ?? 'any',
    media: MEDIA_VALUES.find((x) => x === r.media) ?? 'any',
    links: r.links === 'with' || r.links === 'without' ? r.links : 'any',
    noRetweets: r.noRetweets === true,
    lang: str('lang'),
    since: str('since'),
    until: str('until'),
    sort: r.sort === 'live' ? 'live' : 'top',
  };
}

function lastRunLine(iso: string | null): string {
  if (!iso) return 'never run';
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (!Number.isFinite(days)) return 'never run';
  return days <= 0 ? 'run today' : days === 1 ? 'run yesterday' : `run ${days}d ago`;
}

// ---------------------------------------------------------------- small parts

function Problems({ list }: { list: Problem[] }): JSX.Element {
  if (list.length === 0) return <></>;
  return (
    <>
      {list.map((p) => (
        <small
          key={`${p.level}:${p.field}:${p.message}`}
          className={`outlier-problem outlier-problem-${p.level}`}
        >
          {p.message}
        </small>
      ))}
    </>
  );
}

function TextRow({
  label,
  hint,
  value,
  placeholder,
  problems,
  onChange,
}: {
  label: string;
  hint: string;
  value: string;
  placeholder: string;
  problems: Problem[];
  onChange: (v: string) => void;
}): JSX.Element {
  return (
    <label className="field">
      <span>
        {label}
        <small className="muted">{hint}</small>
      </span>
      <input
        type="text"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
      <Problems list={problems} />
    </label>
  );
}

function FloorRow({
  label,
  value,
  problems,
  onChange,
}: {
  label: string;
  value: string;
  problems: Problem[];
  onChange: (v: string) => void;
}): JSX.Element {
  return (
    <label className="field outlier-floor">
      <span>{label}</span>
      <input
        type="number"
        min={0}
        step={1}
        value={value}
        placeholder="off"
        onChange={(e) => onChange(e.target.value)}
      />
      <Problems list={problems} />
    </label>
  );
}

// ---------------------------------------------------------------- the tab

export function OutliersPanel({ settings }: Props): JSX.Element {
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [seed, setSeed] = useState<FormState>(EMPTY_FORM);
  const [seedProblems, setSeedProblems] = useState<Problem[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [saved, setSaved] = useState<SavedSearchItem[]>([]);
  const [name, setName] = useState('');
  const [loadedId, setLoadedId] = useState<string | null>(null);
  const [copied, setCopied] = useState<'yes' | 'no' | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const query = toQuery(form);
  const compiled = compileSearchQuery(query);
  const errors = compiled.problems.filter((p) => p.level === 'error');
  const blocked = errors.length > 0;
  const forField = (field: string): Problem[] => compiled.problems.filter((p) => p.field === field);
  const set = (patch: Partial<FormState>): void => {
    setForm((f) => ({ ...f, ...patch }));
    setCopied(null);
  };

  const refresh = useCallback(async () => {
    try {
      const res = await api.searches.list(settings);
      setSaved(res.searches);
    } catch (e) {
      setError(errMsg(e, 'Could not load saved hunts'));
    }
  }, [settings]);

  // Mount: the registry defaults seed a FRESH form, but a draft the user
  // already started always wins — a later defaults fetch never overwrites work
  // in progress.
  useEffect(() => {
    let alive = true;
    void (async () => {
      const stored = await chrome.storage.local.get(DRAFT_KEY).catch(() => ({}));
      const draft = coerceForm((stored as Record<string, unknown>)[DRAFT_KEY]);
      try {
        const d = await api.searches.defaults(settings);
        if (!alive) return;
        const seeded = fromQuery(d.query);
        setSeed(seeded);
        setSeedProblems(d.problems);
        setForm(draft ?? seeded);
      } catch (e) {
        if (!alive) return;
        if (draft) setForm(draft);
        setError(errMsg(e, 'Could not read the outlier defaults'));
      } finally {
        if (alive) setHydrated(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, [settings]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Mirror the in-progress form so a panel close doesn't lose a half-built
  // hunt. Debounced only to keep a keystroke off the storage bus.
  useEffect(() => {
    if (!hydrated) return;
    const t = setTimeout(() => {
      void chrome.storage.local.set({ [DRAFT_KEY]: form }).catch(() => {});
    }, DRAFT_WRITE_MS);
    return () => clearTimeout(t);
  }, [form, hydrated]);

  /** Best-effort `last_run_at` (§7.8) — a failed stamp never blocks the
   *  clipboard or the tab, and an unsaved ad-hoc query skips it entirely. */
  const stampRun = (id: string | null): void => {
    if (!id) return;
    void api.searches
      .run(settings, id)
      .then((r) => {
        setSaved((rows) =>
          rows.map((x) =>
            x.saved.id === id ? { ...x, saved: { ...x.saved, lastRunAt: r.lastRunAt } } : x,
          ),
        );
      })
      .catch(() => {});
  };

  /** The clipboard write happens INSIDE the click handler with nothing awaited
   *  before it — Chrome gates it on a focused document plus a user gesture
   *  (the `QuickReplyPicker` discipline). A refusal is never fatal: the string
   *  stays on screen in the monospace preview, selectable by hand. */
  const copy = async (text: string, id: string | null): Promise<void> => {
    setError(null);
    setNotice(null);
    try {
      await navigator.clipboard.writeText(text);
      setCopied('yes');
    } catch {
      setCopied('no');
    }
    stampRun(id);
  };

  // Deliberately NOT harvestClient's `resolveTab`: that helper waits for a
  // content-script handshake on a harvest target, and a search-results page has
  // no such handshake to wait for.
  const openInX = async (url: string, id: string | null): Promise<void> => {
    setError(null);
    stampRun(id);
    try {
      const ctx = await readActiveContext();
      if (ctx.tabId !== null && ctx.onX) await chrome.tabs.update(ctx.tabId, { url, active: true });
      else await chrome.tabs.create({ url, active: true });
    } catch {
      setError('Could not open a tab for that search.');
    }
  };

  const save = async (asNew: boolean): Promise<void> => {
    const trimmed = name.trim();
    if (trimmed === '') {
      setError('Name the hunt before saving it.');
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const item =
        !asNew && loadedId
          ? await api.searches.patch(settings, loadedId, { name: trimmed, query })
          : await api.searches.create(settings, { name: trimmed, query });
      setLoadedId(item.saved.id);
      setNotice(`Saved "${item.saved.name}".`);
      await refresh();
    } catch (e) {
      setError(errMsg(e, 'Could not save that hunt'));
    } finally {
      setBusy(false);
    }
  };

  const load = (item: SavedSearchItem): void => {
    if (!item.saved.query) return;
    setForm(fromQuery(item.saved.query));
    setName(item.saved.name);
    setLoadedId(item.saved.id);
    setCopied(null);
    setNotice(null);
    setError(null);
  };

  const remove = async (id: string): Promise<void> => {
    setBusy(true);
    try {
      await api.searches.remove(settings, id);
      if (loadedId === id) setLoadedId(null);
      await refresh();
    } catch (e) {
      setError(errMsg(e, 'Could not delete that hunt'));
    } finally {
      setConfirming(null);
      setBusy(false);
    }
  };

  const pin = async (item: SavedSearchItem): Promise<void> => {
    try {
      await api.searches.patch(settings, item.saved.id, { pinned: !item.saved.pinned });
      await refresh();
    } catch (e) {
      setError(errMsg(e, 'Could not pin that hunt'));
    }
  };

  const counterTone =
    compiled.length > MAX_QUERY_LENGTH ? ' over' : compiled.length >= NEAR_LIMIT ? ' near' : '';

  return (
    <div className="panel">
      <div className="panel-header">
        <h2>Outliers</h2>
        <button
          type="button"
          onClick={() => {
            setForm(seed);
            setName('');
            setLoadedId(null);
            setCopied(null);
            setNotice(null);
          }}
        >
          New hunt
        </button>
      </div>
      <p className="muted">
        Build the search, copy it, paste it into X. Every result on the page carries the usual{' '}
        <strong>Save to stratus</strong> button — nothing here spends.
      </p>

      {error && <div className="error">{error}</div>}
      {seedProblems.map((p) => (
        <div key={`seed:${p.field}:${p.message}`} className="warn">
          {p.message}
        </div>
      ))}

      <Section title="Words">
        <TextRow
          label="All of these"
          hint="comma or newline · AND"
          value={form.all}
          placeholder="bun, sqlite"
          problems={forField('all')}
          onChange={(v) => set({ all: v })}
        />
        <TextRow
          label="Any of these"
          hint="OR — always parenthesized"
          value={form.any}
          placeholder="drizzle, prisma"
          problems={forField('any')}
          onChange={(v) => set({ any: v })}
        />
        <label className="field">
          <span>
            Exact phrases
            <small className="muted">one per line</small>
          </span>
          <textarea
            rows={2}
            value={form.phrases}
            placeholder={'build in public\nindie hacker'}
            onChange={(e) => set({ phrases: e.target.value })}
          />
          <Problems list={forField('phrases')} />
        </label>
        <TextRow
          label="None of these"
          hint="excluded"
          value={form.none}
          placeholder="crypto, nft"
          problems={forField('none')}
          onChange={(v) => set({ none: v })}
        />
      </Section>

      <Section title="People & tags">
        <div className="outlier-grid">
          <TextRow
            label="From"
            hint="one handle"
            value={form.from}
            placeholder="levelsio"
            problems={forField('from')}
            onChange={(v) => set({ from: v })}
          />
          <TextRow
            label="Replying to"
            hint="one handle"
            value={form.to}
            placeholder="paulg"
            problems={forField('to')}
            onChange={(v) => set({ to: v })}
          />
          <TextRow
            label="Mentions"
            hint="handles"
            value={form.mentions}
            placeholder="stripe, vercel"
            problems={forField('mentions')}
            onChange={(v) => set({ mentions: v })}
          />
          <TextRow
            label="Hashtags"
            hint="no # needed"
            value={form.hashtags}
            placeholder="buildinpublic"
            problems={forField('hashtags')}
            onChange={(v) => set({ hashtags: v })}
          />
        </div>
      </Section>

      <Section title="Engagement floor">
        <div className="outlier-grid">
          <FloorRow
            label="Min likes"
            value={form.minFaves}
            problems={forField('minFaves')}
            onChange={(v) => set({ minFaves: v })}
          />
          <FloorRow
            label="Min reposts"
            value={form.minRetweets}
            problems={forField('minRetweets')}
            onChange={(v) => set({ minRetweets: v })}
          />
          <FloorRow
            label="Min replies"
            value={form.minReplies}
            problems={forField('minReplies')}
            onChange={(v) => set({ minReplies: v })}
          />
        </div>
      </Section>

      <Section title="Shape & window">
        <div className="outlier-grid">
          <label className="field">
            <span>Replies</span>
            <select
              value={form.replies}
              onChange={(e) => set({ replies: e.target.value as RepliesFilter })}
            >
              {REPLIES_VALUES.map((v) => (
                <option key={v} value={v}>
                  {REPLIES_LABEL[v]}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Media</span>
            <select
              value={form.media}
              onChange={(e) => set({ media: e.target.value as MediaFilter })}
            >
              {MEDIA_VALUES.map((v) => (
                <option key={v} value={v}>
                  {MEDIA_LABEL[v]}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Links</span>
            <select
              value={form.links}
              onChange={(e) => set({ links: e.target.value as LinksMode })}
            >
              {(['any', 'with', 'without'] as LinksMode[]).map((v) => (
                <option key={v} value={v}>
                  {LINKS_LABEL[v]}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Language</span>
            <select value={form.lang} onChange={(e) => set({ lang: e.target.value })}>
              <option value="">any</option>
              {SEARCH_LANGS.map((code) => (
                <option key={code} value={code}>
                  {code}
                </option>
              ))}
            </select>
            <Problems list={forField('lang')} />
          </label>
          <label className="field">
            <span>Since</span>
            <input
              type="date"
              value={form.since}
              onChange={(e) => set({ since: e.target.value })}
            />
            <Problems list={forField('since')} />
          </label>
          <label className="field">
            <span>Until</span>
            <input
              type="date"
              value={form.until}
              onChange={(e) => set({ until: e.target.value })}
            />
            <Problems list={forField('until')} />
          </label>
        </div>
        <label className="outlier-toggle">
          <input
            type="checkbox"
            checked={form.noRetweets}
            onChange={(e) => set({ noRetweets: e.target.checked })}
          />
          Hide retweets
        </label>
      </Section>

      <Section
        title="Hand-off"
        actions={
          <div className="row">
            {(['top', 'live'] as SearchSort[]).map((v) => (
              <button
                key={v}
                type="button"
                className="chip"
                aria-pressed={form.sort === v}
                onClick={() => set({ sort: v })}
              >
                {v === 'top' ? 'Top' : 'Latest'}
              </button>
            ))}
            <span className={`counter${counterTone}`}>
              {compiled.length}/{MAX_QUERY_LENGTH}
            </span>
          </div>
        }
      >
        <code className="outlier-preview">{compiled.query || '—'}</code>
        <Problems list={forField('query')} />
        {copied === 'no' && (
          <div className="warn">
            The clipboard refused — select the string above and copy it by hand.
          </div>
        )}
        {copied === 'yes' && <div className="ok">Copied — paste it into X's search box.</div>}
        <div className="row">
          <button
            type="button"
            className="primary"
            disabled={blocked}
            onClick={() => void copy(compiled.query, loadedId)}
          >
            Copy
          </button>
          <button
            type="button"
            disabled={blocked}
            onClick={() => {
              const url = searchUrl(query);
              if (url) void openInX(url, loadedId);
            }}
          >
            Open in X
          </button>
          <input
            type="text"
            className="outlier-name"
            value={name}
            placeholder="name this hunt"
            onChange={(e) => setName(e.target.value)}
          />
          <button type="button" disabled={blocked || busy} onClick={() => void save(false)}>
            {loadedId ? 'Save' : 'Save hunt'}
          </button>
          {loadedId && (
            <button type="button" disabled={blocked || busy} onClick={() => void save(true)}>
              Save as new
            </button>
          )}
        </div>
        {notice && <div className="ok">{notice}</div>}
      </Section>

      <Section title="Saved hunts">
        {saved.length === 0 ? (
          <EmptyState
            line="No saved hunts yet."
            hint="Name a query above and save it — the good ones are worth re-running."
          />
        ) : (
          <ul className="outlier-saved">
            {saved.map((item) => (
              <li
                key={item.saved.id}
                className={`outlier-saved-row${loadedId === item.saved.id ? ' loaded' : ''}`}
              >
                <div className="outlier-saved-head">
                  <strong>{item.saved.name}</strong>
                  {item.saved.pinned && <span className="chip chip-accent">pinned</span>}
                  <span className="chip chip-muted">
                    {item.saved.sort === 'top' ? 'top' : 'latest'}
                  </span>
                  <span className="muted">{lastRunLine(item.saved.lastRunAt)}</span>
                </div>
                <code className="outlier-saved-query">
                  {item.compiled?.query ?? 'unreadable — saved outside the app'}
                </code>
                <div className="row">
                  <button
                    type="button"
                    disabled={!item.url || !item.compiled}
                    onClick={() => void copy(item.compiled?.query ?? '', item.saved.id)}
                  >
                    Copy
                  </button>
                  <button
                    type="button"
                    disabled={!item.url}
                    onClick={() => {
                      if (item.url) void openInX(item.url, item.saved.id);
                    }}
                  >
                    Open in X
                  </button>
                  <button type="button" disabled={!item.saved.query} onClick={() => load(item)}>
                    Load
                  </button>
                  <button type="button" onClick={() => void pin(item)}>
                    {item.saved.pinned ? 'Unpin' : 'Pin'}
                  </button>
                  <button
                    type="button"
                    className="danger"
                    disabled={busy}
                    onClick={() =>
                      confirming === item.saved.id
                        ? void remove(item.saved.id)
                        : setConfirming(item.saved.id)
                    }
                  >
                    {confirming === item.saved.id ? 'Really delete?' : 'Delete'}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}
