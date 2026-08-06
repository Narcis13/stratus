// The Radar (OVERHAUL-PLAN §7.2): hot/warm band sightings the content script
// streamed to chrome.storage.session while the user browsed X, ranked as a
// worked queue — band, then views-per-minute, then recency. Each row shows the
// "why" (views · replies · age · bait) so judgment stays with the human.
//
// Its own Operate tab (RD.1) — it used to be the sixth section of Today, but
// it's the surface with the longest dwell time in the daily loop and the only
// live-updating one, so it stopped renting space in a page that reloads a brief.
//
// "Draft replies" makes ONE Grok call (POST /x/replies/generate-batch) for the
// queued tweets and attaches all three angle variants to each through the
// background (the buffer's single writer). A drafted row shows those angles as
// tabs *in the card* (RD.2): clicking the one you want copies it, moves the row
// to Clicked, and opens the tweet — paste, done.

import { type JSX, useCallback, useEffect, useState } from 'react';
import { type HumanizeResult, humanize, jitterOdds } from '../humanize.ts';
import { formatCount } from '../replyBand.ts';
import type {
  RadarClick,
  RadarConfirm,
  RadarDismiss,
  RadarRehydrate,
  RadarReplies,
} from '../shared/messages.ts';
import {
  type CannonRow,
  RADAR_CAP,
  RADAR_SIGHTINGS_KEY,
  type RadarSighting,
  cannonQueue,
  coerceSightings,
  displayAgeMin,
  groupQueue,
  partitionForCurate,
  pruneStale,
  rankSightings,
  splitClicked,
} from '../shared/radar.ts';
import { requestReplyFocus } from '../shared/replyFocus.ts';
import { curatedBatchSize, radarBatchSize } from '../shared/serverSettings.ts';
import type {
  CannonCandidate,
  CannonTarget,
  CurateResponse,
  HumanizerSettings,
  PlacedTodayResponse,
  ReplyLanguageSource,
} from '../shared/types.ts';
import { ChannelTagPicker } from './ChannelTags.tsx';
import { CoachChip } from './CoachChip.tsx';
import { SettingsGear } from './SettingsGear.tsx';
import { ApiError, type BatchReplyTweet, api } from './api.ts';
import { cannonTargetChip } from './chips.ts';
import { useServerSettings } from './serverSettingsHook.ts';
import { type SettingsEditor, useSettingsEditor } from './settingsEditor.ts';
import type { Settings } from './storage.ts';
import { EmptyState } from './ui/EmptyState.tsx';
import { Section } from './ui/Section.tsx';

// UI.12 — the batch size is now two knobs, not one baked constant: the display
// cap (how many tweets THIS click sends) clamped by the server's own batch cap
// (how many it will accept at all). `radarBatchSize` is the one place that
// clamp lives; reading `radarDraftCap` raw here would resurrect the failed-click
// footgun the mirror was widened to remove.
// RC.4 added the third: the curated pass reads its own size knob, and a number
// that decides how many queue rows get DISMISSED has to be reachable from the
// surface it acts on.
const RADAR_KEYS = ['x.display.radarDraftCap', 'x.ai.batchReplyCap', 'x.radar.curatedCount'];

// RC.4 — both calls report failure as a value instead of throwing, so the
// orchestration below reads as the sequence it is (grade → dismiss → draft)
// rather than as nested try blocks. `detail` is null when the failure carried
// no server message.
type BatchOutcome =
  | {
      ok: true;
      drafted: number;
      requested: number;
      cost: number;
      // ML.5 — the language the SERVER settled on, echoed back. Not the same
      // thing as the one this panel sent: the server also resolves from the
      // cannon roster itself and from the posts' own script, so this can name a
      // language no click here chose. `null` = English.
      language: string | null;
      languageSource: ReplyLanguageSource | null;
    }
  | { ok: false; detail: string | null };

// The note's language clause, built from what came BACK. A `null` language is
// English and says nothing — English is the default and announcing it is noise.
// The source is worth a word only when the panel didn't pick it: "in Japanese
// (from the post)" is the honest line for a set the server detected.
function languageNote(out: {
  language: string | null;
  languageSource: ReplyLanguageSource | null;
}): string {
  if (!out.language) return '';
  const how =
    out.languageSource === 'detected'
      ? ' (from the posts)'
      : out.languageSource === 'roster'
        ? ' (roster)'
        : '';
  return ` · in ${out.language}${how}`;
}

type CurateOutcome = { ok: true; res: CurateResponse } | { ok: false; detail: string | null };

// What one curated pass did, in the order the money was spent. `unscored` only
// appears when it isn't zero: a truncated model response is the one case where
// the scored count doesn't account for the whole queue, and leaving it out
// would read as "that was all there was" (RL.9's honesty rule).
function curateNote(res: CurateResponse): string {
  const head = `scored ${res.scored.length}`;
  const tail = `dropped ${res.drop.length}`;
  return res.unscored.length > 0
    ? `${head} · ${res.unscored.length} unscored · ${tail}`
    : `${head} · ${tail}`;
}

function useRadarSightings(): RadarSighting[] {
  const [sightings, setSightings] = useState<RadarSighting[]>([]);

  useEffect(() => {
    let alive = true;
    // A change that lands while the initial read is still in flight wins: the
    // read resolving second would put the pre-write buffer back on screen, and
    // a queue that flickers backwards is exactly what this surface must not do.
    let sawChange = false;
    // chrome.storage.local, not `.session` — the buffer moved (shared/radar.ts).
    void chrome.storage.local.get(RADAR_SIGHTINGS_KEY).then((out) => {
      if (!alive || sawChange) return;
      setSightings(pruneStale(coerceSightings(out[RADAR_SIGHTINGS_KEY]), Date.now()));
    });

    const onChanged = (
      changes: Record<string, chrome.storage.StorageChange>,
      area: chrome.storage.AreaName,
    ): void => {
      if (area !== 'local') return;
      const change = changes[RADAR_SIGHTINGS_KEY];
      if (!change) return;
      sawChange = true;
      setSightings(pruneStale(coerceSightings(change.newValue), Date.now()));
    };
    chrome.storage.onChanged.addListener(onChanged);
    return () => {
      alive = false;
      chrome.storage.onChanged.removeListener(onChanged);
    };
  }, []);

  return sightings;
}

function dismiss(tweetIds: string[]): void {
  const msg: RadarDismiss = { type: 'stratus/radar-dismiss', tweetIds };
  void (async () => {
    try {
      await chrome.runtime.sendMessage(msg);
    } catch (err) {
      console.warn('[stratus] radar dismiss failed', err);
    }
  })();
}

// Mark a reply-ready row clicked (its reply was copied) — the background stamps
// clickedAt and the row moves from the queue to the Clicked view.
function markClicked(tweetId: string): void {
  const msg: RadarClick = {
    type: 'stratus/radar-click',
    tweetId,
    clickedAt: new Date().toISOString(),
  };
  void (async () => {
    try {
      await chrome.runtime.sendMessage(msg);
    } catch (err) {
      console.warn('[stratus] radar click failed', err);
    }
  })();
}

// Promote this row's radar draft into a real reply_drafts row (RU.6) — the
// background POSTs the confirm endpoint and stamps the returned draft id onto
// the sighting for the on-page paste flow (RU.7). Best-effort, like markClicked.
// `text` is the angle the human actually took (RD.2): the background records it
// as the human edit when it isn't the primary, so "what went out" isn't always
// variants[0] just because the picker moved into the card.
function confirmDraft(tweetId: string, text: string): void {
  const msg: RadarConfirm = { type: 'stratus/radar-confirm', tweetId, text };
  void (async () => {
    try {
      await chrome.runtime.sendMessage(msg);
    } catch (err) {
      console.warn('[stratus] radar confirm failed', err);
    }
  })();
}

// CQ.5 — today's placed-reply count for the Cannon head. $0 and write-free (the
// route is a pure SELECT pair on purpose), which is what makes it callable on
// every pick. Best-effort like every other side call on this surface: an
// unreachable server means no counter, never a broken queue.
function fetchPlacedToday(settings: Settings): Promise<PlacedTodayResponse | null> {
  return api.radar.placedToday(settings).catch((err) => {
    console.warn('[stratus] placed-today load failed', err);
    return null;
  });
}

// CQ.7 — the batch's ONE language, or why there isn't one. `/x/replies/
// generate-batch` carries a single instruction block, so a set spanning two
// languages (or one where only some authors declare theirs) is drafted in
// English and the note says so. `null` = nothing to send AND nothing to
// announce: English is already the default.
type LanguagePick = { language: string } | 'mixed' | null;

function sharedCannonLanguage(rows: RadarSighting[], byHandle: Map<string, string>): LanguagePick {
  if (rows.length === 0) return null;
  // '' stands for "this author declares none" so the set-size test covers the
  // partial case too: one declared + one undeclared is still mixed.
  const seen = new Set(rows.map((s) => byHandle.get(normalizeHandleKey(s.handle)) ?? ''));
  if (seen.size !== 1) return 'mixed';
  const only = [...seen][0] ?? '';
  return only === '' ? null : { language: only };
}

function normalizeHandleKey(handle: string): string {
  return handle.replace(/^@/, '').toLowerCase();
}

/** RD.1 — the Operate tab shell. The Section below carries the heading and the
 *  header actions, so there's no second panel title to keep in sync; the tab
 *  owns the settings editor Today used to hand down. */
export function RadarPanel({
  settings,
  onOpenPerson,
}: {
  settings: Settings;
  onOpenPerson: (handle: string) => void;
}): JSX.Element {
  const editor = useSettingsEditor(settings);
  return (
    <div className="panel">
      <RadarSection settings={settings} onOpenPerson={onOpenPerson} editor={editor} />
    </div>
  );
}

export function RadarSection({
  settings,
  onOpenPerson,
  editor,
}: {
  settings: Settings;
  onOpenPerson: (handle: string) => void;
  editor: SettingsEditor;
}): JSX.Element {
  const server = useServerSettings();
  const ranked = rankSightings(useRadarSightings());
  const { queue, clicked } = splitClicked(ranked);
  const { ready, fresh } = groupQueue(queue);
  // CQ.5 — the arbitrage lane, read off the same queue the other two views use:
  // a third reading, never a third buffer. The 30-minute cutoff lives here and
  // nowhere else (decision 5) — the rows it hides keep their place in Queue.
  const cannon = cannonQueue(queue, Date.now(), server.cannon);
  const [view, setView] = useState<'queue' | 'cannon' | 'clicked'>('queue');
  // RC.4 — ONE in-flight flag for both buttons, not one each: a curate pass and
  // a plain draft over the same rows would double-spend on the overlap, and the
  // curated flow dismisses rows the other one is mid-way through drafting.
  const [busy, setBusy] = useState<'draft' | 'curate' | null>(null);
  const [note, setNote] = useState<string | null>(null);
  // HM.3: the project humanizer config (`GET /x/humanizer`, $0). `null` means
  // "not loaded" — the checkbox is then disabled and every pick is byte-identical
  // to the pre-HM.3 path, because decoration must never block the worked queue.
  const [humanizer, setHumanizer] = useState<HumanizerSettings | null>(null);
  // CQ.5 — the Cannon head's daily instrument. `null` until the first read
  // lands (or forever, if the server is unreachable) — the counter simply
  // doesn't render then.
  const [placed, setPlaced] = useState<PlacedTodayResponse | null>(null);
  // CQ.7 — handle → declared reply language, for the Cannon view's draft set.
  // Its own $0 read rather than a lift out of CannonRoster: that copy is
  // mutable state the roster editor owns (add/bench/drop refresh it), and this
  // one only ever answers "what language is this handle's arm?". Empty until it
  // lands (or forever, on an unreachable server) → every draft is English, the
  // pre-CQ.7 behaviour.
  const [cannonLanguages, setCannonLanguages] = useState<Map<string, string>>(new Map());

  // C0: ask the background to pull the server's radar_drafts copy — after a
  // browser restart the session buffer is empty but paid-for drafts survive.
  useEffect(() => {
    const msg: RadarRehydrate = { type: 'stratus/radar-rehydrate' };
    chrome.runtime
      .sendMessage(msg)
      .catch((err) => console.warn('[stratus] radar rehydrate failed', err));
  }, []);

  // One $0 read per mount. A failure is swallowed on purpose: an unreachable
  // server means no jitter, not a broken Radar.
  useEffect(() => {
    let alive = true;
    api.humanizer
      .get(settings)
      .then((cfg) => {
        if (alive) setHumanizer(cfg);
      })
      .catch((err) => console.warn('[stratus] humanizer config load failed', err));
    return () => {
      alive = false;
    };
  }, [settings]);

  // One $0 read per mount (the roster scores come from harvest_rows, never a
  // billed lookup). Swallowed on failure: no languages means English, not a
  // broken Radar.
  useEffect(() => {
    let alive = true;
    api.cannon
      .targets(settings)
      .then((res) => {
        if (!alive) return;
        setCannonLanguages(
          new Map(
            res.targets.flatMap((t) =>
              t.language ? [[normalizeHandleKey(t.handle), t.language] as const] : [],
            ),
          ),
        );
      })
      .catch((err) => console.warn('[stratus] cannon languages load failed', err));
    return () => {
      alive = false;
    };
  }, [settings]);

  // One $0 read per mount, and one more after every pick — never a timer. The
  // route is cheap enough to poll and deliberately writes nothing, but a panel
  // that polls a server route is how a surface starts costing something later,
  // when the route it polls grows a side write. Mount + pick is the whole
  // trigger set.
  useEffect(() => {
    let alive = true;
    void fetchPlacedToday(settings).then((next) => {
      if (alive && next) setPlaced(next);
    });
    return () => {
      alive = false;
    };
  }, [settings]);

  // A pick creates a `copied` reply draft, not a `posted` one: the row only
  // counts as placed once the on-page paste flow PATCHes it (RU.7), seconds
  // later and on another tab. So the refetch fired here is GUARANTEED to be
  // stale, and a plain overwrite would show +1 and immediately take it back.
  // The server stays the authority — its number is adopted whole on a new day
  // and the moment it catches up; within one day the local figure can only ever
  // be ahead by picks whose paste hasn't landed yet.
  const onPicked = (): void => {
    setPlaced((prev) => (prev ? { ...prev, placed: prev.placed + 1 } : prev));
    void fetchPlacedToday(settings).then((next) => {
      if (!next) return;
      setPlaced((prev) =>
        prev && prev.dayKey === next.dayKey && prev.placed > next.placed
          ? { ...next, placed: prev.placed }
          : next,
      );
    });
  };

  // The checkbox writes the project-level flag, so it survives a panel reopen
  // and any future surface reads the same switch. Optimistic: flip locally,
  // then PATCH; a refusal puts the old value back and says so in `note`.
  const toggleHumanize = (next: boolean): void => {
    if (!humanizer) return;
    const prev = humanizer;
    setHumanizer({ ...humanizer, enabled: next });
    void api.humanizer
      .patch(settings, { enabled: next })
      .then((saved) => setHumanizer(saved))
      .catch((e) => {
        setHumanizer(prev);
        setNote(
          e instanceof ApiError ? `Humanize toggle failed: ${e.message}` : 'Humanize toggle failed',
        );
      });
  };

  // Draft only freshly-discovered tweets (no reply yet), newest-ranked first.
  const undrafted = fresh.slice(0, radarBatchSize(server));
  // CQ.5 — the same button in the Cannon view, over the cannon rows instead:
  // score-desc, un-drafted, capped by the same knob. One click still means one
  // Grok call at the same price — this only changes which rows it sends.
  const cannonUndrafted = cannon.rows
    .filter((r) => !r.s.reply)
    .map((r) => r.s)
    .slice(0, radarBatchSize(server));
  const draftSet = view === 'cannon' ? cannonUndrafted : undrafted;
  // RC.4 — how many survive a curated pass, and therefore whether curating is
  // worth a second call at all: below this size "Draft replies" already covers
  // the whole queue.
  const curatedSize = curatedBatchSize(server);
  const canCurate = fresh.length > curatedSize;

  // The one paid drafting call, shared by both buttons (RC.4). It owns the wire
  // shape, the call and the handoff to the background — but deliberately NOT
  // the note: a curated pass folds this call's cost and counts into a line that
  // also reports what the scoring call did, and a note written in here could
  // only ever describe half of it. Never throws; failure is a return value.
  const sendBatch = async (
    rows: RadarSighting[],
    scoreById?: Map<string, number>,
    language?: string,
  ): Promise<BatchOutcome> => {
    // band/signals ride along for the server's radar_drafts copy (C0) — they
    // never reach the Grok prompt. curationScore (RC.2) rides on exactly the
    // same terms: stored as measurement metadata, invisible to the prompt.
    const tweets: BatchReplyTweet[] = rows.map((s) => {
      const score = scoreById?.get(s.tweetId);
      return {
        tweetId: s.tweetId,
        handle: s.handle,
        author: s.author ?? s.handle,
        text: s.text,
        url: s.url,
        band: s.band,
        signals: s.signals,
        // `!== undefined`, never a truthiness test: a ⊕ pin carries no score at
        // all, and a scored-0 tweet is a real verdict the column must keep —
        // collapsing the two is what makes the column worthless (D177b).
        ...(score !== undefined ? { curationScore: score } : {}),
      };
    });
    try {
      // CQ.7: one language for the call, never a per-tweet field — the server's
      // whitelist would drop it there, and the prompt has one instruction block.
      const res = await api.replies.generateBatch(settings, {
        tweets,
        ...(language !== undefined ? { language } : {}),
      });
      if (res.replies.length > 0) {
        const msg: RadarReplies = {
          type: 'stratus/radar-replies',
          replies: res.replies.map((r) => ({
            tweetId: r.tweetId,
            reply: r.text,
            variants: r.variants,
          })),
        };
        await chrome.runtime.sendMessage(msg);
      }
      return {
        ok: true,
        drafted: res.replies.length,
        requested: res.requested,
        cost: res.costUsd,
        language: res.language,
        languageSource: res.languageSource,
      };
    } catch (e) {
      return { ok: false, detail: e instanceof ApiError ? e.message : null };
    }
  };

  const draftReplies = async (rows: RadarSighting[]): Promise<void> => {
    if (rows.length === 0) return;
    setBusy('draft');
    setNote(null);
    // CQ.7 — Cannon view only: the camped roster is the one place a per-author
    // language is declared, and the Queue's rows are mostly strangers.
    const pick = view === 'cannon' ? sharedCannonLanguage(rows, cannonLanguages) : null;
    try {
      const out = await sendBatch(
        rows,
        undefined,
        pick && pick !== 'mixed' ? pick.language : undefined,
      );
      if (out.ok) {
        // ML.5 — the note reports what came BACK, not what was sent. The server
        // resolves a language of its own (roster pin, then the posts' script),
        // so a set this panel called "mixed" can still come back Japanese, and
        // the old pre-computed clause would have called that English. `mixed`
        // is still worth saying when the answer really is English: it explains
        // why a roster of declared languages produced an English batch.
        const why =
          out.language === null && pick === 'mixed'
            ? ' · mixed languages — drafted in English'
            : '';
        setNote(
          `${out.drafted}/${out.requested} drafted · $${out.cost.toFixed(4)}${languageNote(out)}${why}`,
        );
      } else setNote(out.detail ? `Draft failed: ${out.detail}` : 'Draft failed');
    } finally {
      setBusy(null);
    }
  };

  // The scoring call, same never-throws contract as sendBatch. Text-only by
  // construction: band/signals are not even sent (the server would ignore them,
  // §7.19 — but a shape that can't carry them can't leak them either).
  const runCurate = async (rows: RadarSighting[]): Promise<CurateOutcome> => {
    try {
      const res = await api.replies.curate(settings, {
        tweets: rows.map((s) => ({
          tweetId: s.tweetId,
          handle: s.handle,
          author: s.author ?? s.handle,
          text: s.text,
          url: s.url,
        })),
      });
      return { ok: true, res };
    } catch (e) {
      return { ok: false, detail: e instanceof ApiError ? e.message : null };
    }
  };

  // RC.4 — grade the whole fresh queue, dismiss the filler, draft the best.
  // Two calls, and the ORDER is the contract: nothing is dismissed until the
  // scoring call has answered (refuse-before-drop, the client-side twin of
  // §7.4), and ids the model never scored are neither drafted nor dismissed.
  const curateAndDraft = async (): Promise<void> => {
    // The same test the button renders on: curating a queue that already fits
    // in one batch is a second call that changes nothing.
    if (!canCurate) return;
    const { pinned, scoreable, skipped } = partitionForCurate(fresh);
    // Nothing gradeable (an all-pinned or all-textless queue) — the plain button
    // already covers it, and an empty tweets array is a guaranteed 400. Say so
    // rather than returning silently: a spending button that answers a click
    // with nothing at all reads as broken, and the whole note contract on this
    // flow exists so every click explains itself (RL.9's honesty rule).
    if (scoreable.length === 0) {
      setNote(
        `nothing to grade — ${pinned.length} ⊕ pinned, ${skipped.length} with no text · use Draft replies`,
      );
      return;
    }
    setBusy('curate');
    setNote(null);
    try {
      // RADAR_CAP is the server's MAX_CURATE_TWEETS by construction (the ring
      // buffer is *why* that constant is 100). Clamp before asking — the server
      // refuses an over-long batch, it does not truncate one.
      const graded = await runCurate(scoreable.slice(0, RADAR_CAP));
      if (!graded.ok) {
        // Nothing was dismissed: a failed grade must not cost queue rows.
        setNote(graded.detail ? `Curate failed: ${graded.detail}` : 'Curate failed');
        return;
      }
      const res = graded.res;
      if (res.drop.length > 0) dismiss(res.drop);

      const byId = new Map(fresh.map((s) => [s.tweetId, s]));
      // `keep` comes back best-first (D176c), so ⊕ pins first + survivors in
      // that order means the trim below takes the WEAKEST survivors — never a
      // tweet the human pinned by hand (decision 4).
      const survivors = res.keep.flatMap((id) => {
        const s = byId.get(id);
        return s ? [s] : [];
      });
      // `Math.max(1, …)` for the same reason `radarBatchSize`/`curatedBatchSize`
      // carry it: `readServerConfig` guards the blob's SHAPE, not its range, so
      // a corrupted mirror can hand back a 0 here — and a 0 would land after the
      // drops, turning a corrupt config into "dismissed the queue, drafted
      // nothing". Trimming to the cap is policy; trimming to nothing is a bug.
      const set = [...pinned, ...survivors].slice(0, Math.max(1, server.batchReplyCap));
      const prefix = curateNote(res);
      // The trailing figure is always what THIS click spent, so a pass that
      // ends early still says what the grading cost — an unreported call is
      // how a per-click surface starts feeling free.
      const gradedCost = `$${res.costUsd.toFixed(4)}`;
      if (set.length === 0) {
        setNote(`${prefix} · nothing left to draft · ${gradedCost}`);
        return;
      }
      // Jitter is NOT applied here (D172): curated rows are drafted and then
      // taken through the same `onPick`, which humanizes at pick time. A second
      // call site would double-jitter the same text.
      setNote(`${prefix} · drafting…`);
      const out = await sendBatch(set, new Map(res.scored.map((s) => [s.tweetId, s.score])));
      if (out.ok) {
        // This path never sends a language — and since ML.3 the server can still
        // resolve one, so the note says which (the same echo the plain button
        // reads). Silent on English.
        setNote(
          `${prefix} · drafted ${out.drafted}/${out.requested} · $${(res.costUsd + out.cost).toFixed(4)}${languageNote(out)}`,
        );
      } else {
        // The drops stand: they were dismissed on their own merit, not as a
        // side effect of the draft that failed after them. Say so — and still
        // report the grading spend.
        const why = out.detail ? `draft failed: ${out.detail}` : 'draft failed';
        setNote(`${prefix} · ${why} · ${gradedCost}`);
      }
    } finally {
      setBusy(null);
    }
  };

  // What Clear acts on: whatever the current view is showing. A dismiss is
  // global by design (the row leaves every view and never re-enters), so in the
  // Cannon view this clears exactly the rows on screen — not the aged-out ones
  // it is hiding, which are still workable from Queue.
  const shown =
    view === 'queue' ? queue : view === 'cannon' ? cannon.rows.map((r) => r.s) : clicked;

  return (
    <Section
      title="Radar"
      actions={
        <>
          {view !== 'clicked' && (
            <button
              type="button"
              className="radar-draft"
              onClick={() => void draftReplies(draftSet)}
              disabled={busy !== null || draftSet.length === 0}
              title="One Grok call drafts a reply for each un-drafted tweet"
            >
              {busy === 'draft'
                ? 'Drafting…'
                : `Draft replies${draftSet.length ? ` (${draftSet.length})` : ''}`}
            </button>
          )}
          {/* RC.4 — only once the queue outgrows what a curated pass would keep.
              Below that, plain "Draft replies" already covers every fresh row
              and curating would be a second call that changes nothing.

              Queue-only, and it stays that way (CQ.5): the cannon rows are
              already ranked by a MEASUREMENT — views per reply, off the numbers
              the page handed us — and paying a model call to re-rank a set that
              arithmetic already ordered is exactly the spend §7.4 refuses.
              Adding it here is the first thing a later reader will reach for. */}
          {view === 'queue' && canCurate && (
            <button
              type="button"
              className="radar-curate"
              onClick={() => void curateAndDraft()}
              disabled={busy !== null}
              title="One cheap scoring call grades the whole queue for reply payoff, dismisses the filler, then drafts the best of what's left. ⊕ pins are never scored away."
            >
              {busy === 'curate' ? 'Curating…' : `Curate & draft (${curatedSize})`}
            </button>
          )}
          {shown.length > 0 && (
            <button
              type="button"
              className="radar-clear"
              onClick={() => dismiss(shown.map((s) => s.tweetId))}
            >
              Clear
            </button>
          )}
          <SettingsGear
            editor={editor}
            keys={RADAR_KEYS}
            label="Configure radar drafting"
            note="One click, one Grok call — a plain batch is the lower of the first two. The third sizes a Curate & draft pass instead: it grades every fresh tweet, dismisses what scores as filler, and drafts that many survivors (still capped by the batch cap). What lands on the radar by band is the Reply band group in Settings → Tuning (the same twelve thresholds the on-page badge uses); ⊕ pins and fresh posts by your circle get in regardless — and a pin is never scored away."
          />
        </>
      }
    >
      <div className="radar-tabs">
        <button
          type="button"
          className={`radar-tab${view === 'queue' ? ' active' : ''}`}
          onClick={() => setView('queue')}
        >
          Queue{queue.length > 0 ? ` (${queue.length})` : ''}
        </button>
        {/* CQ.5 — the arbitrage lane. Still the hand-rolled strip RD.1 shipped:
            migrating it to the SubTabs primitive is a styling rewrite of two
            existing views and does not belong in the same commit as a new one. */}
        <button
          type="button"
          className={`radar-tab${view === 'cannon' ? ' active' : ''}`}
          onClick={() => setView('cannon')}
          title="Fresh posts with a lot of eyes and almost no replies — sorted by views per reply, gone once they age out."
        >
          Cannon{cannon.rows.length > 0 ? ` (${cannon.rows.length})` : ''}
        </button>
        <button
          type="button"
          className={`radar-tab${view === 'clicked' ? ' active' : ''}`}
          onClick={() => setView('clicked')}
        >
          Clicked{clicked.length > 0 ? ` (${clicked.length})` : ''}
        </button>
      </div>

      {/* HM.3 — opt-in jitter on the angle you click. Queue-only: it decorates
          the act of picking, and the Clicked view is a log of picks already made
          (a re-copy there still honors the flag, it just isn't where you set it). */}
      {view === 'queue' && (
        <label
          className="radar-humanize"
          title="Roughen the angle you click — a prefix, a suffix, lowercase, a dropped period or a small typo. Applied at pick time to what gets copied, never written back to the stored draft; @handles, names and links are never touched."
        >
          <input
            type="checkbox"
            checked={humanizer?.enabled ?? false}
            disabled={humanizer === null}
            onChange={(e) => toggleHumanize(e.target.checked)}
          />
          Humanize picks
          {humanizer && (
            <span className="radar-humanize-odds">
              ~{Math.round(jitterOdds(humanizer) * 100)}% of picks come out changed
            </span>
          )}
        </label>
      )}

      {note && <div className="status-line">{note}</div>}

      {view === 'cannon' ? (
        <>
          {/* The daily instrument. It counts pasted replies (the whole day's,
              from every surface), not cannon shots — the target is the one the
              replies commitment/doctrine already owns, so this head and the
              quest can never show two different numbers. */}
          {placed && (
            <div className="radar-cannon-head">
              <span className="radar-cannon-placed">
                placed today {placed.placed} / {placed.target}
              </span>
            </div>
          )}
          {cannon.rows.length === 0 ? (
            cannon.hidden > 0 ? (
              // "You missed the window" and "there was nothing to shoot at" are
              // different facts, and only one of them is a reason to go change
              // the roster. Never collapse these two into one line.
              <EmptyState
                line={`${cannon.hidden} ${cannon.hidden === 1 ? 'entry' : 'entries'} aged out past ${server.cannon.maxAgeMin} minutes.`}
                hint="They're still in Queue — the cutoff only hides them here. Catching these means browsing closer to when they're posted, not a wider roster."
              />
            ) : (
              <EmptyState
                line={`Nothing scoring above ${formatCount(server.cannon.scoreMin)} right now — the cannon queue fills from posts under ${server.cannon.maxAgeMin} minutes old.`}
                hint="Scroll a roster account's profile or your timeline: a fresh post with a lot of views and almost no replies lands here on sight."
              />
            )
          ) : (
            <ul className="radar-list">
              {cannon.rows.map((r) => (
                <RadarRow
                  key={r.s.tweetId}
                  s={r.s}
                  cannon={r}
                  settings={settings}
                  onOpenPerson={onOpenPerson}
                  humanizer={humanizer}
                  onPicked={onPicked}
                />
              ))}
            </ul>
          )}
          {/* CQ.6 — who you camp, at the foot of the view their posts land in.
              Collapsed and cold on purpose: it is the Sunday review, not part
              of the daily loop, and it must never move while the queue above
              it is being worked. */}
          <CannonRoster settings={settings} onOpenPerson={onOpenPerson} />
        </>
      ) : view === 'queue' ? (
        queue.length === 0 ? (
          <EmptyState
            line="Browse X — hot/warm tweets you scroll past queue up here."
            hint="Nothing is fetched for this; it's what the page already showed you, banded and ranked."
          />
        ) : (
          <>
            {ready.length > 0 && (
              <RadarGroup
                label={`Reply ready (${ready.length})`}
                rows={ready}
                settings={settings}
                onOpenPerson={onOpenPerson}
                humanizer={humanizer}
                onPicked={onPicked}
              />
            )}
            {fresh.length > 0 && (
              <RadarGroup
                label={`New (${fresh.length})`}
                rows={fresh}
                settings={settings}
                onOpenPerson={onOpenPerson}
                humanizer={humanizer}
                onPicked={onPicked}
              />
            )}
          </>
        )
      ) : clicked.length === 0 ? (
        <EmptyState
          line="Replies you copy land here — most recent first."
          hint="Clicking the angle you want copies it, opens the tweet, and moves the row across."
        />
      ) : (
        <ul className="radar-list">
          {clicked.map((s) => (
            <RadarRow
              key={s.tweetId}
              s={s}
              settings={settings}
              onOpenPerson={onOpenPerson}
              humanizer={humanizer}
              onPicked={onPicked}
            />
          ))}
        </ul>
      )}
    </Section>
  );
}

function RadarGroup({
  label,
  rows,
  settings,
  onOpenPerson,
  humanizer,
  onPicked,
}: {
  label: string;
  rows: RadarSighting[];
  settings: Settings;
  onOpenPerson: (handle: string) => void;
  humanizer: HumanizerSettings | null;
  onPicked: () => void;
}): JSX.Element {
  return (
    <>
      <div className="radar-group-label">{label}</div>
      <ul className="radar-list">
        {rows.map((s) => (
          <RadarRow
            key={s.tweetId}
            s={s}
            settings={settings}
            onOpenPerson={onOpenPerson}
            humanizer={humanizer}
            onPicked={onPicked}
          />
        ))}
      </ul>
    </>
  );
}

function RadarRow({
  s,
  settings,
  onOpenPerson,
  humanizer,
  onPicked,
  cannon,
}: {
  s: RadarSighting;
  settings: Settings;
  onOpenPerson: (handle: string) => void;
  humanizer: HumanizerSettings | null;
  /** CQ.5 — a pick is a placement in flight; the head's counter wants to know. */
  onPicked: () => void;
  /** CQ.5 — present only in the Cannon view. The numbers come from the queue
   *  that decided membership, never recomputed here: the row must not be able
   *  to print an age the 30-minute cutoff disagrees with. */
  cannon?: Omit<CannonRow, 's'>;
}): JSX.Element {
  // HM.3 — what the last click actually did, not just that it happened: the
  // humanizer is invisible otherwise, and "it does nothing" has to be answerable.
  const [pickNote, setPickNote] = useState<string | null>(null);
  // C8: channel tags live on the server's radar_drafts copy (keyed by tweetId),
  // which only exists once a reply was drafted — so the picker shows then.
  // Session-local mirror; the persisted copy is what the aggregate reads.
  const [tags, setTags] = useState<string[]>([]);
  // RD.2: the angle picker moved from the tweet page into the card. Index into
  // `angles`, clamped on read — a re-sight can't shrink the set (mergeSightings
  // keeps variants), but a rehydrated row can arrive with fewer.
  const [angleIdx, setAngleIdx] = useState(0);
  const angles = rowAngles(s);
  const picked = angles[angleIdx] ?? angles[0];

  // Taking an angle: copy it (a click is a user gesture → clipboard allowed),
  // move the row to Clicked, and promote the draft with the text that will
  // actually be pasted. The anchor's default still opens the tweet in a new tab.
  const onPick = (text: string): void => {
    // HM.3 — the jitter is decided HERE and never stored: `radar_drafts.variants`
    // stay verbatim (§7.19), and the roughened text is recorded only as what
    // actually went out, through the RD.2 confirm path that already PATCHes
    // `replyTextEdited` when the taken text isn't the primary. Zero wire change.
    // Author + handle ride along as protected spans — a typo'd @mention breaks
    // the mention and a typo'd name reads as disrespect.
    const jittered: HumanizeResult | null =
      humanizer?.enabled === true
        ? humanize(
            text,
            humanizer,
            Math.random,
            [s.author ?? '', s.handle].filter((v) => v !== ''),
          )
        : null;
    const taken = jittered?.text ?? text;
    markClicked(s.tweetId);
    confirmDraft(s.tweetId, taken);
    onPicked();
    // The anchor is about to open the tweet in a new tab — tell the content
    // script on that tab to put the caret in the composer, so the landing
    // keystroke is the ⌘V and nothing else.
    void requestReplyFocus(s.tweetId);
    void navigator.clipboard
      .writeText(taken)
      .then(() => {
        setPickNote(pickNoteFor(jittered));
        window.setTimeout(() => setPickNote(null), PICK_NOTE_MS);
      })
      .catch((err) => console.warn('[stratus] clipboard write failed', err));
  };

  return (
    <li className={`radar-row${s.reply ? ' radar-row-replied' : ''}`}>
      <div className="radar-row-head">
        {cannon && (
          <span
            className="radar-cannon-score"
            title="Views per reply — how many people are reading this post for each reply already under it. The whole arbitrage model; author size is deliberately not in it."
          >
            {formatCount(Math.round(cannon.score))}
          </span>
        )}
        <span className={`radar-band radar-band-${s.band}`} title={BAND_TITLE[s.band]}>
          {BAND_LABEL[s.band]}
        </span>
        <button
          type="button"
          className="radar-author person-link"
          title={`Open @${s.handle}'s dossier`}
          onClick={() => onOpenPerson(s.handle)}
        >
          {s.author ?? `@${s.handle}`}
        </button>
        {s.personTier && (
          <button
            type="button"
            className={`stage-chip radar-tier ${
              s.personTier === 'target' ? 'radar-tier-target' : `stage-${s.personTier}`
            }`}
            title={`${tierLabel(s.personTier)} — open @${s.handle}'s dossier`}
            onClick={() => onOpenPerson(s.handle)}
          >
            {s.personTier}
          </button>
        )}
        {s.reply && <span className="radar-ready">reply ready</span>}
        <button
          type="button"
          className="radar-dismiss"
          title="Dismiss — done or not worth it"
          onClick={() => dismiss([s.tweetId])}
        >
          ✕
        </button>
      </div>
      <a className="radar-text" href={s.url} target="_blank" rel="noreferrer">
        {s.text || s.url}
      </a>
      <div className="radar-why">
        {whyLine(s, cannon?.ageMin ?? displayAgeMin(s, Date.now()), cannon?.tone ?? 'ok')}
      </div>
      {/* SC.4 — the coach score sits with the CHOICE: on the tabs when there is
          one to make, on the reply itself when the row carries a single draft
          (a pre-variant or CLI row). Never on both, and it never reorders the
          angles it labels. */}
      {angles.length > 1 && (
        <div className="radar-angle-tabs">
          {angles.map((v, i) => (
            <button
              key={`${i}:${v.angle ?? ''}`}
              type="button"
              className={`radar-angle-tab${i === angleIdx ? ' active' : ''}`}
              title={v.text}
              onClick={() => setAngleIdx(i)}
            >
              {v.angle ?? `variant ${i + 1}`} <CoachChip text={v.text} />
            </button>
          ))}
        </div>
      )}
      {picked && (
        <a
          className="radar-reply radar-reply-pick"
          href={s.url}
          target="_blank"
          rel="noreferrer"
          title="Copy this angle and open the tweet"
          onClick={() => onPick(picked.text)}
        >
          {/* ML.5: the row carries no resolved language (the batch's echo is a
              property of the CALL, not of a sighting that outlives it), so the
              browser's first-strong-character heuristic is what makes an Arabic
              draft readable. It picks a direction, never a language — and it
              sits on the TEXT, so the hint and the gloss below stay ltr. */}
          <span dir="auto">{picked.text}</span>
          <span className="radar-reply-hint">
            {pickNote ?? 'click → copies + opens the tweet'}
            {angles.length === 1 && (
              <>
                {' '}
                <CoachChip text={picked.text} />
              </>
            )}
          </span>
        </a>
      )}
      {/* The literal English rendering of the picked angle (ML.2), muted and
          under the pick — and OUTSIDE the anchor, so it is not part of the
          click that copies. What lands on the clipboard is `picked.text` and
          nothing else. Absent gloss ⇒ no row at all. */}
      {picked?.gloss && (
        <div className="radar-gloss" dir="ltr">
          {picked.gloss}
        </div>
      )}
      {s.reply && (
        <ChannelTagPicker
          settings={settings}
          tags={tags}
          onSave={async (next) => {
            await api.channels.tagRadarDraft(settings, s.tweetId, next);
            setTags(next);
          }}
          suggestFrom={s.text}
        />
      )}
    </li>
  );
}

// How many discovery rows the block asks for. Small on purpose: the list is a
// prompt to camp one more account, not a directory.
const CANDIDATE_LIMIT = 10;

// The route's own rule (`USERNAME_RE` in src/x/routes/cannon.ts), mirrored so a
// refusal reads as a sentence under the input instead of a bare 400 — the
// HumanizerCard discipline. The server stays the authority either way.
const HANDLE_RE = /^[A-Za-z0-9_]{1,15}$/;

function normalizeHandle(raw: string): string | null {
  const h = raw.trim().replace(/^@/, '').toLowerCase();
  return HANDLE_RE.test(h) ? h : null;
}

// The 400/404 codes these five routes can answer with, spelled out.
const ROSTER_ERR: Record<string, string> = {
  invalid_handle: 'A handle is 1–15 letters, numbers or underscores — no @, no dots.',
  invalid_active: 'The camp/bench switch was refused.',
  invalid_body: 'The server could not read that. Reload the panel.',
  empty_patch: 'Nothing changed, so nothing was sent.',
  not_found: 'Not on the roster any more — reopen the block to refresh it.',
};

function rosterErr(e: unknown, fallback: string): string {
  if (e instanceof ApiError) return ROSTER_ERR[e.code] ?? `${e.code} (${e.status})`;
  return fallback;
}

/** CQ.6 — the cannon roster: camp, bench, drop, rescore, and the candidates the
 *  harvest already knows about.
 *
 *  EVERY call it makes is $0 (the scores come from `harvest_rows`, never from
 *  the X API) and the Rescore button says so, because the two buttons in the
 *  header above it both spend money and nothing on screen would otherwise tell
 *  the two kinds apart.
 *
 *  Cold by construction: it loads on the first expand and then only when the
 *  human changes something. No polling, no auto-rescore — the weekly review is
 *  a person sitting down on Sunday, and numbers that moved under them mid-review
 *  would make the comparison they came for impossible. */
function CannonRoster({
  settings,
  onOpenPerson,
}: {
  settings: Settings;
  onOpenPerson: (handle: string) => void;
}): JSX.Element {
  const [loaded, setLoaded] = useState(false);
  const [floor, setFloor] = useState<number | null>(null);
  const [targets, setTargets] = useState<CannonTarget[]>([]);
  const [candidates, setCandidates] = useState<CannonCandidate[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Both reads together: a handle leaves the candidate list the moment it joins
  // the roster, so showing one refreshed against the other stale would offer to
  // add someone you just added.
  const load = useCallback(async () => {
    setError(null);
    try {
      const [roster, discovery] = await Promise.all([
        api.cannon.targets(settings),
        api.cannon.candidates(settings, { limit: CANDIDATE_LIMIT }),
      ]);
      setFloor(roster.floor);
      setTargets(roster.targets);
      setCandidates(discovery.candidates);
      setLoaded(true);
    } catch (e) {
      setError(rosterErr(e, 'Failed to load the roster'));
    }
  }, [settings]);

  const add = async (raw: string): Promise<void> => {
    const handle = normalizeHandle(raw);
    if (handle === null) {
      setError(ROSTER_ERR.invalid_handle ?? 'That handle is not valid.');
      return;
    }
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const row = await api.cannon.add(settings, { handle });
      setDraft('');
      // Fill-only on the server: re-adding someone you already camp keeps their
      // score, so say which of the two just happened.
      setNote(
        row.score === null
          ? `@${row.handle} camped — unscored until a rescore`
          : `@${row.handle} camped`,
      );
      await load();
    } catch (e) {
      setError(rosterErr(e, 'Add failed'));
    } finally {
      setBusy(false);
    }
  };

  // Bench keeps the row and its score; only `drop` forgets a target.
  const setActive = async (t: CannonTarget, active: boolean): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const row = await api.cannon.patch(settings, t.handle, { active });
      setTargets((prev) => prev.map((r) => (r.handle === row.handle ? row : r)));
    } catch (e) {
      setError(rosterErr(e, 'Update failed'));
    } finally {
      setBusy(false);
    }
  };

  const drop = async (t: CannonTarget): Promise<void> => {
    if (!confirm(`Drop @${t.handle} from the cannon roster? Bench keeps them and their score.`))
      return;
    setBusy(true);
    setError(null);
    try {
      await api.cannon.remove(settings, t.handle);
      setNote(`@${t.handle} dropped`);
      // Reload rather than splice: a dropped handle is a candidate again.
      await load();
    } catch (e) {
      setError(rosterErr(e, 'Drop failed'));
    } finally {
      setBusy(false);
    }
  };

  const rescore = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const res = await api.cannon.rescore(settings);
      // "under sample" is its own count, never folded into `scored`: a handle
      // the harvest hasn't covered is a reason to go scroll their profile, not
      // a reason to drop them.
      setNote(
        `scored ${res.scored} · ${res.skipped.length} under sample (needs ${res.minSample} of their last ${res.samplePosts} posts)`,
      );
      await load();
    } catch (e) {
      setError(rosterErr(e, 'Rescore failed'));
    } finally {
      setBusy(false);
    }
  };

  const camped = targets.filter((t) => t.active).length;
  const benched = targets.length - camped;

  return (
    <details
      className="radar-roster"
      onToggle={(e) => {
        if (e.currentTarget.open && !loaded) void load();
      }}
    >
      <summary className="radar-roster-summary">
        Roster
        {loaded ? ` (${camped} camped${benched > 0 ? ` · ${benched} benched` : ''})` : ''}
      </summary>

      <div className="radar-roster-head">
        <button
          type="button"
          className="radar-roster-rescore"
          onClick={() => void rescore()}
          disabled={busy}
          title="Recompute every target's views-per-reply score from tweets you already harvested. $0 — nothing on this block touches the X API."
        >
          {busy ? '…' : 'Rescore ($0)'}
        </button>
        {floor !== null && (
          <span
            className="radar-roster-floor"
            title="A target scoring under this is the Sunday drop candidate — the same floor the cannon queue uses."
          >
            floor {formatCount(floor)}
          </span>
        )}
      </div>

      {note && <div className="status-line">{note}</div>}
      {error && <div className="error">{error}</div>}

      {loaded && targets.length === 0 ? (
        <EmptyState
          line="Nobody camped yet."
          hint="Add a handle below, or take one from the candidates your harvest already scored."
        />
      ) : (
        <ul className="radar-roster-list">
          {targets.map((t) => (
            <li
              key={t.handle}
              className={`radar-roster-row${t.active ? '' : ' radar-roster-benched'}`}
            >
              <span
                className={cannonTargetChip(
                  t.score === null ? 'unscored' : t.belowFloor ? 'below' : 'scored',
                )}
                title={
                  t.score === null
                    ? 'Never scored — the harvest has nothing of theirs yet.'
                    : t.belowFloor
                      ? 'Under the floor: their posts do not hand you the eyes-per-reply the cannon is for.'
                      : 'Median views per reply across their sampled posts.'
                }
              >
                {t.score === null ? 'unscored' : formatCount(Math.round(t.score))}
              </span>
              <button
                type="button"
                className="radar-roster-handle person-link"
                title={`Open @${t.handle}'s dossier`}
                onClick={() => onOpenPerson(t.handle)}
              >
                @{t.handle}
              </button>
              <span className="radar-roster-meta">
                n{t.sampleN} ·{' '}
                {t.staleDays === null
                  ? 'never scored'
                  : t.staleDays === 0
                    ? 'scored today'
                    : `scored ${t.staleDays}d ago`}
              </span>
              <button
                type="button"
                className="radar-roster-act"
                onClick={() => void setActive(t, !t.active)}
                disabled={busy}
                title={
                  t.active
                    ? 'Bench — stop capturing their posts, keep the row and its score'
                    : 'Camp — capture their fresh posts into the cannon queue again'
                }
              >
                {t.active ? 'bench' : 'camp'}
              </button>
              <button
                type="button"
                className="radar-roster-act danger"
                onClick={() => void drop(t)}
                disabled={busy}
                title="Drop — forget this target entirely"
              >
                drop
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="radar-roster-add">
        <input
          value={draft}
          placeholder="@handle"
          spellCheck={false}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && draft.trim() !== '') void add(draft);
          }}
        />
        <button
          type="button"
          onClick={() => void add(draft)}
          disabled={busy || draft.trim() === ''}
        >
          + add handle
        </button>
      </div>

      {candidates.length > 0 && (
        <div className="radar-roster-candidates">
          <div className="radar-roster-label">
            Candidates — scored off your harvest, not yet camped
          </div>
          <ul className="radar-roster-list">
            {candidates.map((c) => (
              <li key={c.handle} className="radar-roster-row">
                <span
                  className={cannonTargetChip(
                    floor !== null && c.score < floor ? 'below' : 'scored',
                  )}
                  title="Median views per reply across their harvested posts — the same number the roster is ranked by."
                >
                  {formatCount(Math.round(c.score))}
                </span>
                <button
                  type="button"
                  className="radar-roster-handle person-link"
                  title={`Open @${c.handle}'s dossier`}
                  onClick={() => onOpenPerson(c.handle)}
                >
                  @{c.handle}
                </button>
                <span className="radar-roster-meta">n{c.sampleN}</span>
                <button
                  type="button"
                  className="radar-roster-act"
                  onClick={() => void add(c.handle)}
                  disabled={busy}
                  title="Camp this author"
                >
                  + add
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </details>
  );
}

// Longer than the old 1500 ms `copied ✓` flash: the note now carries a list of
// jitters to read, and it is the only place the humanizer is ever visible.
const PICK_NOTE_MS = 2500;

// RL.9's honesty pattern — the answer to "the humanizer does nothing". Three
// distinct states, because "no jitter fired this time" and "the feature is off"
// are different facts and only one of them is a reason to check the settings.
function pickNoteFor(jittered: HumanizeResult | null): string {
  if (jittered === null) return 'copied ✓';
  if (jittered.applied.length === 0) return 'copied ✓ · no jitter this time';
  return `copied ✓ · jitter: ${jittered.applied.join(', ')}`;
}

// The angles offered as tabs on a drafted row (RD.2). The full RU.4 set when
// the batch stored it; a pre-variant / CLI row keeps its single primary with no
// angle label (one entry never renders a tab strip anyway).
function rowAngles(
  s: RadarSighting,
): { angle: string | null; text: string; gloss: string | null }[] {
  if (s.variants && s.variants.length > 0) {
    // ML.5: `gloss` rides along so the card can show the literal English under a
    // non-English draft. `?? null` because a row persisted before ML.2 has no
    // gloss key at all — absent and "the model returned none" render the same.
    return s.variants.map((v) => ({ angle: v.angle, text: v.text, gloss: v.gloss ?? null }));
  }
  return s.reply ? [{ angle: null, text: s.reply, gloss: null }] : [];
}

// The band chip's face. Only 'roster' needs a translation: the stored value is
// the cohort key the server records, "your circle" is what it means to a human
// (GT.8).
const BAND_LABEL: Record<RadarSighting['band'], string> = {
  hot: 'hot',
  warm: 'warm',
  manual: 'manual',
  roster: 'your circle',
  cannon: 'cannon',
};

// A band carries a tooltip when its reason ISN'T visible in the numbers under
// it (the GT.8 rule). Two qualify: a roster capture says nothing about the
// tweet, and a cannon capture is a claim the band chip alone can't distinguish
// from the read-time score — the tweet may be here because of who posted it.
// hot/warm/manual are self-explaining and stay bare.
const BAND_TITLE: Record<RadarSighting['band'], string | undefined> = {
  hot: undefined,
  warm: undefined,
  manual: undefined,
  roster:
    'Below the reply band, but in the queue anyway: you have replied to them before, or they are on your 2–10x target roster. Same rule the reply gate uses.',
  cannon:
    'Captured for the cannon: either it cleared the views-per-reply floor when it was sighted, or its author is on your camped cannon roster. Work it in the Cannon view — the slot closes fast.',
};

// S0.3 chip tooltip — why this author outranks a louder rando.
function tierLabel(tier: NonNullable<RadarSighting['personTier']>): string {
  if (tier === 'ally') return 'Ally — an established two-way relationship';
  if (tier === 'mutual') return 'Mutual — you two go back and forth';
  return 'Target — an in-band 2–10x account worth building';
}

// "1.5k views · 8 replies · 22m · 70/min · bait"
//
// CQ.5 — the age arrives as an argument and so does how it should read. Two
// reasons, and they are the same reason twice: the Cannon view's cutoff already
// computed this row's age and the line must not print a different one, and a
// "too old" TONE is a Cannon judgement, not a fact about the row — so the caller
// decides it and this function stays two branches, not three.
function whyLine(s: RadarSighting, ageMin: number, tone: 'ok' | 'red'): JSX.Element {
  const { views, replies, vpm, bait } = s.signals;
  const age = (
    <span className={tone === 'red' ? 'radar-age-red' : undefined}>{fmtAge(ageMin)}</span>
  );
  // A queue-metadata row with no captured metrics — don't render a line of
  // zeros; a cold tweet has nothing to quantify yet. The two bands that get here
  // are the ones that entered the queue for a reason the numbers don't hold: a ⊕
  // pin (RU.8) and a roster capture (GT.8). Roster rows usually DO have real
  // (small) numbers, and then the numbers are the honest line — the chip above
  // already says why they're here.
  if (views === 0 && replies === 0 && (s.band === 'manual' || s.band === 'roster')) {
    const why = s.band === 'manual' ? 'manually added' : 'someone in your circle';
    return (
      <>
        {`${why} · `}
        {age}
      </>
    );
  }
  const tail: string[] = [];
  if (vpm >= 1) tail.push(`${formatCount(Math.round(vpm))}/min`);
  if (bait) tail.push('bait');
  return (
    <>
      {`${formatCount(views)} views · ${replies} replies · `}
      {age}
      {tail.length > 0 ? ` · ${tail.join(' · ')}` : ''}
    </>
  );
}

function fmtAge(min: number): string {
  if (min < 60) return `${Math.round(min)}m`;
  if (min < 24 * 60) return `${Math.floor(min / 60)}h`;
  return `${Math.floor(min / 1440)}d`;
}
