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
//
// OU.6 added the three seeds and the gear. **A seed is a one-click fill of an
// ordinary editable field, never a hidden filter** — a channel chip appends its
// keywords into the `any` box the user can then edit, a roster pick types a
// handle into `from`, and the ▲▼ steppers move the number in the floor box.
// Nothing seeds itself: no channel loads because the text matched, no `from:`
// appears because a target was recently viewed. The gear tunes the six
// `x.outliers.*` knobs — all `scope: 'server'`, so the tab reads their EFFECT
// through `GET /x/searches/defaults` rather than a mirrored blob, which is why
// **New hunt re-reads that route** instead of replaying the mount-time seed.

import { type JSX, useCallback, useEffect, useState } from 'react';
import {
  MAX_QUERY_LENGTH,
  MAX_TERMS_PER_FIELD,
  type MediaFilter,
  type Problem,
  type RepliesFilter,
  SEARCH_LANGS,
  type SearchQuery,
  type SearchSort,
  compileSearchQuery,
  nextRung,
  parseSearchQuery,
  prevRung,
  searchUrl,
} from '../searchQuery.ts';
import { mergeTerms } from '../shared/outlierSeed.ts';
import { SettingsGear } from './SettingsGear.tsx';
import {
  ApiError,
  type Channel,
  type SavedSearchCapture,
  type SavedSearchItem,
  type VoiceTarget,
  type VoiceTargets,
  api,
} from './api.ts';
import { readActiveContext } from './harvestClient.ts';
import { useSettingsEditor } from './settingsEditor.ts';
import type { Settings } from './storage.ts';
import { EmptyState } from './ui/EmptyState.tsx';
import { Section } from './ui/Section.tsx';

interface Props {
  settings: Settings;
}

const DRAFT_KEY = 'outliers:draft';
const DRAFT_WRITE_MS = 400;
/** The six knobs the gear tunes — the whole `outliers` registry group, and the
 *  only settings this tab acts on. All `scope: 'server'`: the panel never sees
 *  the numbers themselves, only what `GET /x/searches/defaults` makes of them. */
const OUTLIER_SETTING_KEYS = [
  'x.outliers.minFaves',
  'x.outliers.minRetweets',
  'x.outliers.minReplies',
  'x.outliers.sinceDays',
  'x.outliers.lang',
  'x.outliers.sort',
];
/** Shared by the three floor boxes — the server's ladder rungs offered as
 *  suggestions, so the numbers the ▲▼ walk are also visible without clicking. */
const RUNGS_ID = 'outlier-rungs';
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

/** One rung up or down `FAVES_LADDER`, through the compiler's own pure helpers
 *  (OU.1) rather than a second copy of the rungs — the cheatsheet's "start at
 *  300–500 and increase gradually" made clickable. The bottom rung is `0`, which
 *  renders as an EMPTY box: `0` means "no floor", and the whole reason floors are
 *  held as strings is that an emptied box must not become a floor of zero. */
function stepFloor(value: string, dir: 1 | -1): string {
  const cur = numOrUndefined(value) ?? 0;
  const n = dir === 1 ? nextRung(cur) : prevRung(cur);
  return n === 0 ? '' : String(n);
}

function fmtFollowers(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 10_000) return `${(n / 1000).toFixed(1)}k`;
  return n.toLocaleString();
}

function lastRunLine(iso: string | null): string {
  if (!iso) return 'never run';
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (!Number.isFinite(days)) return 'never run';
  return days <= 0 ? 'run today' : days === 1 ? 'run yesterday' : `run ${days}d ago`;
}

// ---------------------------------------------------------------- small parts

/** The feature's own report card (D209/D215) — a real COUNT over `voice_tweets`
 *  rows stamped `outlier_search`, in a window the SERVER owns (deliberately not
 *  `x.outliers.sinceDays`: re-tuning how far back a hunt looks must not silently
 *  redefine what the counter underneath it measures). Zero is a reading, not an
 *  absence, so it says so rather than hiding the line. */
function captureLine(c: SavedSearchCapture): string {
  const n = c.savedFromSearch;
  if (n === 0) {
    return `No tweets saved from search results yet — Save to stratus on any result counts here (last ${c.days} days).`;
  }
  return `${n} tweet${n === 1 ? '' : 's'} saved from search results, last ${c.days} days.`;
}

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

// A div rather than a `<label>`: the ▲▼ live next to the box, and a button
// inside a label is interactive content the label would also swallow clicks
// for. The input carries its own `aria-label` instead.
function FloorRow({
  label,
  value,
  problems,
  onChange,
  onStep,
}: {
  label: string;
  value: string;
  problems: Problem[];
  onChange: (v: string) => void;
  onStep: (dir: 1 | -1) => void;
}): JSX.Element {
  return (
    <div className="field outlier-floor">
      <span>{label}</span>
      <div className="outlier-floor-input">
        <input
          type="number"
          min={0}
          step={1}
          value={value}
          placeholder="off"
          aria-label={label}
          list={RUNGS_ID}
          onChange={(e) => onChange(e.target.value)}
        />
        <span className="outlier-stepper">
          <button
            type="button"
            aria-label={`${label}: up a rung`}
            title="Up a rung"
            onClick={() => onStep(1)}
          >
            ▲
          </button>
          <button
            type="button"
            aria-label={`${label}: down a rung`}
            title="Down a rung — the bottom one turns the floor off"
            onClick={() => onStep(-1)}
          >
            ▼
          </button>
        </span>
      </div>
      <Problems list={problems} />
    </div>
  );
}

// ---------------------------------------------------------------- the tab

export function OutliersPanel({ settings }: Props): JSX.Element {
  // ONE editor for the tab (D135d) — a second would hold a second copy of the
  // registry, and a knob edited in the gear would stay stale in Tuning.
  const editor = useSettingsEditor(settings);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [seed, setSeed] = useState<FormState>(EMPTY_FORM);
  const [seedProblems, setSeedProblems] = useState<Problem[]>([]);
  const [ladder, setLadder] = useState<number[]>([]);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [targets, setTargets] = useState<VoiceTargets | null>(null);
  const [seedNote, setSeedNote] = useState<string | null>(null);
  const [seedsError, setSeedsError] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [saved, setSaved] = useState<SavedSearchItem[]>([]);
  const [capture, setCapture] = useState<SavedSearchCapture | null>(null);
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
    setSeedNote(null);
  };
  /** The roster row behind whatever is in `from:`, or null when the handle was
   *  typed by hand. Derived, never stored: the field stays the truth. */
  const pickedTarget: VoiceTarget | null =
    targets?.targets.find((t) => t.handle.toLowerCase() === form.from.trim().toLowerCase()) ?? null;

  const refresh = useCallback(async () => {
    try {
      const res = await api.searches.list(settings);
      setSaved(res.searches);
      // The count rides on the list call OU.5 already makes (D208a) — the footer
      // is a render off state we fetch anyway, never a fifth mount read.
      setCapture(res.capture);
    } catch (e) {
      setError(errMsg(e, 'Could not load saved hunts'));
    }
  }, [settings]);

  /** The registry-backed starting spec, plus the ladder rungs the ▲▼ suggest.
   *  Read on mount AND on every New hunt — the gear edits exactly these knobs,
   *  so replaying a mount-time seed would make a knob changed one click earlier
   *  look ignored. Returns the seeded form so the caller can install it. */
  const loadDefaults = useCallback(async (): Promise<FormState | null> => {
    try {
      const d = await api.searches.defaults(settings);
      const seeded = fromQuery(d.query);
      setSeed(seeded);
      setSeedProblems(d.problems);
      setLadder(d.ladder);
      return seeded;
    } catch (e) {
      setError(errMsg(e, 'Could not read the outlier defaults'));
      return null;
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
      const seeded = await loadDefaults();
      if (!alive) return;
      const next = draft ?? seeded;
      if (next) setForm(next);
      setHydrated(true);
    })();
    return () => {
      alive = false;
    };
  }, [loadDefaults]);

  // The two seed sources. Both are $0 reads that already existed; neither is
  // load-bearing, so one failing degrades to a muted line and the fields still
  // work by hand.
  useEffect(() => {
    let alive = true;
    void (async () => {
      const [chs, tgs] = await Promise.allSettled([
        api.channels.list(settings, { active: true }),
        api.voice.targets(settings),
      ]);
      if (!alive) return;
      if (chs.status === 'fulfilled') setChannels(chs.value);
      if (tgs.status === 'fulfilled') setTargets(tgs.value);
      if (chs.status === 'rejected' || tgs.status === 'rejected') {
        setSeedsError('Some seeds could not load — every field below still works by hand.');
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

  /** A channel chip appends its keywords into the `any` group — the OR group,
   *  which is what a topic hunt wants. String-level and deduped against what is
   *  already typed; `parseSearchQuery` does the trimming on the way through. */
  const seedFromChannel = (ch: Channel): void => {
    const words = ch.keywords ?? [];
    if (words.length === 0) return;
    const merged = mergeTerms(splitTerms(form.any), words, MAX_TERMS_PER_FIELD);
    set({ any: merged.terms.join(', ') });
    setSeedNote(
      merged.dropped > 0
        ? `Seeded ${merged.added} from ${ch.label} — ${merged.dropped} left out, the any-group holds ${MAX_TERMS_PER_FIELD} terms.`
        : merged.added === 0
          ? `${ch.label}'s keywords are already in the any-group.`
          : `Seeded ${merged.added} keyword${merged.added === 1 ? '' : 's'} from ${ch.label}.`,
    );
  };

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

  /** A fresh form re-reads the registry rather than replaying the mount-time
   *  seed, so a knob just changed in the gear is what the next hunt opens with.
   *  (The editor debounces its PATCH by 400 ms — a New hunt clicked in the same
   *  breath as a slider drag can still read the old number; closing the gear is
   *  enough.) A failed read falls back to the last seed we did get. */
  const newHunt = async (): Promise<void> => {
    setName('');
    setLoadedId(null);
    setCopied(null);
    setNotice(null);
    setSeedNote(null);
    const seeded = await loadDefaults();
    setForm(seeded ?? seed);
  };

  const counterTone =
    compiled.length > MAX_QUERY_LENGTH ? ' over' : compiled.length >= NEAR_LIMIT ? ' near' : '';

  return (
    <div className="panel">
      <div className="panel-header">
        <h2>Outliers</h2>
        <div className="row">
          <SettingsGear
            editor={editor}
            keys={OUTLIER_SETTING_KEYS}
            label="Configure what a fresh outlier hunt opens with"
            note="The floors, window, language and results tab a NEW hunt starts from — not the form you have open. Every one of them is a starting point you can still edit per hunt, and none of them spends: the whole tab is a compiled string plus a clipboard write."
          />
          <button type="button" onClick={() => void newHunt()}>
            New hunt
          </button>
        </div>
      </div>
      <p className="muted">
        Build the search, copy it, paste it into X. Every result on the page carries the usual{' '}
        <strong>Save to stratus</strong> button — nothing here spends.
      </p>

      {error && <div className="error">{error}</div>}
      {seedsError && <p className="muted">{seedsError}</p>}
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
        {channels.length > 0 && (
          <div className="outlier-seeds">
            <small className="muted">Seed the any-group from a channel</small>
            <div className="chip-row">
              {channels.map((ch) => {
                const words = ch.keywords ?? [];
                return (
                  <button
                    key={ch.slug}
                    type="button"
                    className="chip"
                    disabled={words.length === 0}
                    title={
                      words.length === 0
                        ? `${ch.label} has no keywords yet — add some in the Channels tab and it can seed a hunt.`
                        : `Append: ${words.join(', ')}`
                    }
                    onClick={() => seedFromChannel(ch)}
                  >
                    {/* The suffix, not the title, is what carries this: Chrome
                        suppresses pointer events on a disabled control, so a
                        tooltip there is not something to rely on. */}
                    {words.length === 0 ? `${ch.label} · no keywords` : ch.label}
                  </button>
                );
              })}
            </div>
            {seedNote && <small className="muted outlier-seed-note">{seedNote}</small>}
          </div>
        )}
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
        {/* An empty roster is the frozen `account_snapshots` table, not a bug:
            without a snapshot there is no "my size" to band against, so the
            route answers `targets: []`. Say so rather than showing nothing. */}
        {targets && targets.targets.length === 0 && (
          <small className="muted outlier-seed-note">
            No roster in the 2–10× band yet — the From box takes any handle.
          </small>
        )}
        {targets && targets.targets.length > 0 && (
          <div className="outlier-seeds">
            <label className="field">
              <span>
                Target roster
                <small className="muted">
                  {targets.band
                    ? `${fmtFollowers(targets.band.min)}–${fmtFollowers(targets.band.max)} followers`
                    : '2–10× band'}
                </small>
              </span>
              {/* A seeder, not a mirror: it stays on the placeholder and the
                  From box below is the truth, so a handle typed by hand is
                  never contradicted by a picker claiming nothing is selected. */}
              <select value="" onChange={(e) => set({ from: e.target.value })}>
                <option value="">pick a target…</option>
                {targets.targets.map((t) => (
                  <option key={t.handle} value={t.handle}>
                    @{t.handle} · {fmtFollowers(t.followersCount)}
                  </option>
                ))}
              </select>
            </label>
            {pickedTarget && (
              <small className="muted outlier-seed-note">
                @{pickedTarget.handle} has {fmtFollowers(pickedTarget.followersCount)} followers —
                context only; it sets no floor. Clear the From box to widen the hunt again.
              </small>
            )}
          </div>
        )}
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
            onStep={(dir) => set({ minFaves: stepFloor(form.minFaves, dir) })}
          />
          <FloorRow
            label="Min reposts"
            value={form.minRetweets}
            problems={forField('minRetweets')}
            onChange={(v) => set({ minRetweets: v })}
            onStep={(dir) => set({ minRetweets: stepFloor(form.minRetweets, dir) })}
          />
          <FloorRow
            label="Min replies"
            value={form.minReplies}
            problems={forField('minReplies')}
            onChange={(v) => set({ minReplies: v })}
            onStep={(dir) => set({ minReplies: stepFloor(form.minReplies, dir) })}
          />
        </div>
        {/* The server's rungs, offered as suggestions on all three boxes — the
            same list the ▲▼ walk, so a hunt started by typing and a hunt
            started by stepping land on the same numbers. */}
        {ladder.length > 0 && (
          <datalist id={RUNGS_ID}>
            {ladder.map((n) => (
              <option key={n} value={n} />
            ))}
          </datalist>
        )}
        <small className="muted">
          Start around 300–500 likes and step up until the results thin out — ▲▼ walk the ladder,
          and the bottom rung turns a floor off.
        </small>
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

      {capture && <p className="outlier-capture">{captureLine(capture)}</p>}
    </div>
  );
}
