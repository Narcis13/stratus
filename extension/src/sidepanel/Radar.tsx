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

import { type JSX, useEffect, useState } from 'react';
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
  RADAR_CAP,
  RADAR_SIGHTINGS_KEY,
  type RadarSighting,
  groupQueue,
  isRadarSightings,
  partitionForCurate,
  rankSightings,
  splitClicked,
} from '../shared/radar.ts';
import { curatedBatchSize, radarBatchSize } from '../shared/serverSettings.ts';
import type { CurateResponse, HumanizerSettings } from '../shared/types.ts';
import { ChannelTagPicker } from './ChannelTags.tsx';
import { CoachChip } from './CoachChip.tsx';
import { SettingsGear } from './SettingsGear.tsx';
import { ApiError, type BatchReplyTweet, api } from './api.ts';
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
  | { ok: true; drafted: number; requested: number; cost: number }
  | { ok: false; detail: string | null };

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
    void chrome.storage.session.get(RADAR_SIGHTINGS_KEY).then((out) => {
      if (!alive) return;
      const v = out[RADAR_SIGHTINGS_KEY];
      setSightings(isRadarSightings(v) ? v : []);
    });

    const onChanged = (
      changes: Record<string, chrome.storage.StorageChange>,
      area: chrome.storage.AreaName,
    ): void => {
      if (area !== 'session') return;
      const change = changes[RADAR_SIGHTINGS_KEY];
      if (!change) return;
      const v = change.newValue;
      setSightings(isRadarSightings(v) ? v : []);
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
  const [view, setView] = useState<'queue' | 'clicked'>('queue');
  // RC.4 — ONE in-flight flag for both buttons, not one each: a curate pass and
  // a plain draft over the same rows would double-spend on the overlap, and the
  // curated flow dismisses rows the other one is mid-way through drafting.
  const [busy, setBusy] = useState<'draft' | 'curate' | null>(null);
  const [note, setNote] = useState<string | null>(null);
  // HM.3: the project humanizer config (`GET /x/humanizer`, $0). `null` means
  // "not loaded" — the checkbox is then disabled and every pick is byte-identical
  // to the pre-HM.3 path, because decoration must never block the worked queue.
  const [humanizer, setHumanizer] = useState<HumanizerSettings | null>(null);

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
      const res = await api.replies.generateBatch(settings, { tweets });
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
      return { ok: true, drafted: res.replies.length, requested: res.requested, cost: res.costUsd };
    } catch (e) {
      return { ok: false, detail: e instanceof ApiError ? e.message : null };
    }
  };

  const draftReplies = async (): Promise<void> => {
    if (undrafted.length === 0) return;
    setBusy('draft');
    setNote(null);
    try {
      const out = await sendBatch(undrafted);
      if (out.ok) setNote(`${out.drafted}/${out.requested} drafted · $${out.cost.toFixed(4)}`);
      else setNote(out.detail ? `Draft failed: ${out.detail}` : 'Draft failed');
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
        setNote(
          `${prefix} · drafted ${out.drafted}/${out.requested} · $${(res.costUsd + out.cost).toFixed(4)}`,
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

  const shown = view === 'queue' ? queue : clicked;

  return (
    <Section
      title="Radar"
      actions={
        <>
          {view === 'queue' && (
            <button
              type="button"
              className="radar-draft"
              onClick={() => void draftReplies()}
              disabled={busy !== null || undrafted.length === 0}
              title="One Grok call drafts a reply for each un-drafted tweet"
            >
              {busy === 'draft'
                ? 'Drafting…'
                : `Draft replies${undrafted.length ? ` (${undrafted.length})` : ''}`}
            </button>
          )}
          {/* RC.4 — only once the queue outgrows what a curated pass would keep.
              Below that, plain "Draft replies" already covers every fresh row
              and curating would be a second call that changes nothing. */}
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

      {view === 'queue' ? (
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
              />
            )}
            {fresh.length > 0 && (
              <RadarGroup
                label={`New (${fresh.length})`}
                rows={fresh}
                settings={settings}
                onOpenPerson={onOpenPerson}
                humanizer={humanizer}
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
}: {
  label: string;
  rows: RadarSighting[];
  settings: Settings;
  onOpenPerson: (handle: string) => void;
  humanizer: HumanizerSettings | null;
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
}: {
  s: RadarSighting;
  settings: Settings;
  onOpenPerson: (handle: string) => void;
  humanizer: HumanizerSettings | null;
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
        <span
          className={`radar-band radar-band-${s.band}`}
          title={s.band === 'roster' ? ROSTER_BAND_TITLE : undefined}
        >
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
      <div className="radar-why">{whyLine(s)}</div>
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
          {picked.text}
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
function rowAngles(s: RadarSighting): { angle: string | null; text: string }[] {
  if (s.variants && s.variants.length > 0) {
    return s.variants.map((v) => ({ angle: v.angle, text: v.text }));
  }
  return s.reply ? [{ angle: null, text: s.reply }] : [];
}

// The band chip's face. Only 'roster' needs a translation: the stored value is
// the cohort key the server records, "your circle" is what it means to a human
// (GT.8) — and it is the only band whose reason isn't visible in the numbers
// below it, so it is also the only one carrying a tooltip.
const BAND_LABEL: Record<RadarSighting['band'], string> = {
  hot: 'hot',
  warm: 'warm',
  manual: 'manual',
  roster: 'your circle',
};
const ROSTER_BAND_TITLE =
  'Below the reply band, but in the queue anyway: you have replied to them before, or they are on your 2–10x target roster. Same rule the reply gate uses.';

// S0.3 chip tooltip — why this author outranks a louder rando.
function tierLabel(tier: NonNullable<RadarSighting['personTier']>): string {
  if (tier === 'ally') return 'Ally — an established two-way relationship';
  if (tier === 'mutual') return 'Mutual — you two go back and forth';
  return 'Target — an in-band 2–10x account worth building';
}

// "1.5k views · 8 replies · 22m · 70/min · bait"
function whyLine(s: RadarSighting): string {
  const { views, replies, vpm, bait } = s.signals;
  // A queue-metadata row with no captured metrics — don't render a line of
  // zeros; a cold tweet has nothing to quantify yet. The two bands that get here
  // are the ones that entered the queue for a reason the numbers don't hold: a ⊕
  // pin (RU.8) and a roster capture (GT.8). Roster rows usually DO have real
  // (small) numbers, and then the numbers are the honest line — the chip above
  // already says why they're here.
  if (views === 0 && replies === 0 && (s.band === 'manual' || s.band === 'roster')) {
    const why = s.band === 'manual' ? 'manually added' : 'someone in your circle';
    return `${why} · ${fmtAge(displayAgeMin(s))}`;
  }
  const parts = [`${formatCount(views)} views`, `${replies} replies`, fmtAge(displayAgeMin(s))];
  if (vpm >= 1) parts.push(`${formatCount(Math.round(vpm))}/min`);
  if (bait) parts.push('bait');
  return parts.join(' · ');
}

// signals.ageMin was measured at lastSeenAt; the tweet keeps aging while it
// sits in the queue, so show capture age + time since capture.
function displayAgeMin(s: RadarSighting): number {
  const sinceSeen = (Date.now() - Date.parse(s.lastSeenAt)) / 60000;
  return s.signals.ageMin + (Number.isFinite(sinceSeen) ? Math.max(0, sinceSeen) : 0);
}

function fmtAge(min: number): string {
  if (min < 60) return `${Math.round(min)}m`;
  if (min < 24 * 60) return `${Math.floor(min / 60)}h`;
  return `${Math.floor(min / 1440)}d`;
}
