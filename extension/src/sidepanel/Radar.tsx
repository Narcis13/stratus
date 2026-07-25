// The Radar (OVERHAUL-PLAN §7.2): hot/warm band sightings the content script
// streamed to chrome.storage.session while the user browsed X, ranked as a
// worked queue — band, then views-per-minute, then recency. Each row shows the
// "why" (views · replies · age · bait) so judgment stays with the human.
//
// "Draft replies" makes ONE Grok call (POST /x/replies/generate-batch) for the
// queued tweets and attaches a reply to each through the background (the
// buffer's single writer). A drafted row is marked, shows its reply, and
// opening the tweet copies that reply to the clipboard — paste, done.

import { type JSX, useEffect, useState } from 'react';
import { formatCount } from '../replyBand.ts';
import type {
  RadarClick,
  RadarConfirm,
  RadarDismiss,
  RadarRehydrate,
  RadarReplies,
} from '../shared/messages.ts';
import {
  RADAR_SIGHTINGS_KEY,
  type RadarSighting,
  groupQueue,
  isRadarSightings,
  rankSightings,
  splitClicked,
} from '../shared/radar.ts';
import { radarBatchSize } from '../shared/serverSettings.ts';
import { ChannelTagPicker } from './ChannelTags.tsx';
import { SettingsGear } from './SettingsGear.tsx';
import { ApiError, type BatchReplyTweet, api } from './api.ts';
import { useServerSettings } from './serverSettingsHook.ts';
import type { SettingsEditor } from './settingsEditor.ts';
import type { Settings } from './storage.ts';
import { EmptyState } from './ui/EmptyState.tsx';
import { Section } from './ui/Section.tsx';

// UI.12 — the batch size is now two knobs, not one baked constant: the display
// cap (how many tweets THIS click sends) clamped by the server's own batch cap
// (how many it will accept at all). `radarBatchSize` is the one place that
// clamp lives; reading `radarDraftCap` raw here would resurrect the failed-click
// footgun the mirror was widened to remove.
const RADAR_KEYS = ['x.display.radarDraftCap', 'x.ai.batchReplyCap'];

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
function confirmDraft(tweetId: string): void {
  const msg: RadarConfirm = { type: 'stratus/radar-confirm', tweetId };
  void (async () => {
    try {
      await chrome.runtime.sendMessage(msg);
    } catch (err) {
      console.warn('[stratus] radar confirm failed', err);
    }
  })();
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
  const [drafting, setDrafting] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  // C0: ask the background to pull the server's radar_drafts copy — after a
  // browser restart the session buffer is empty but paid-for drafts survive.
  useEffect(() => {
    const msg: RadarRehydrate = { type: 'stratus/radar-rehydrate' };
    chrome.runtime
      .sendMessage(msg)
      .catch((err) => console.warn('[stratus] radar rehydrate failed', err));
  }, []);

  // Draft only freshly-discovered tweets (no reply yet), newest-ranked first.
  const undrafted = fresh.slice(0, radarBatchSize(server));

  const draftReplies = async (): Promise<void> => {
    if (undrafted.length === 0) return;
    setDrafting(true);
    setNote(null);
    // band/signals ride along for the server's radar_drafts copy (C0) — they
    // never reach the Grok prompt.
    const tweets: BatchReplyTweet[] = undrafted.map((s) => ({
      tweetId: s.tweetId,
      handle: s.handle,
      author: s.author ?? s.handle,
      text: s.text,
      url: s.url,
      band: s.band,
      signals: s.signals,
    }));
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
      setNote(`${res.replies.length}/${res.requested} drafted · $${res.costUsd.toFixed(4)}`);
    } catch (e) {
      setNote(e instanceof ApiError ? `Draft failed: ${e.message}` : 'Draft failed');
    } finally {
      setDrafting(false);
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
              disabled={drafting || undrafted.length === 0}
              title="One Grok call drafts a reply for each un-drafted tweet"
            >
              {drafting
                ? 'Drafting…'
                : `Draft replies${undrafted.length ? ` (${undrafted.length})` : ''}`}
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
            note="One click, one Grok call — the batch is the lower of these two. What lands on the radar at all is the Reply band group in Settings → Tuning, the same twelve thresholds the on-page badge uses."
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
              />
            )}
            {fresh.length > 0 && (
              <RadarGroup
                label={`New (${fresh.length})`}
                rows={fresh}
                settings={settings}
                onOpenPerson={onOpenPerson}
              />
            )}
          </>
        )
      ) : clicked.length === 0 ? (
        <EmptyState
          line="Replies you copy land here — most recent first."
          hint="Opening a drafted tweet copies its reply and moves the row across."
        />
      ) : (
        <ul className="radar-list">
          {clicked.map((s) => (
            <RadarRow key={s.tweetId} s={s} settings={settings} onOpenPerson={onOpenPerson} />
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
}: {
  label: string;
  rows: RadarSighting[];
  settings: Settings;
  onOpenPerson: (handle: string) => void;
}): JSX.Element {
  return (
    <>
      <div className="radar-group-label">{label}</div>
      <ul className="radar-list">
        {rows.map((s) => (
          <RadarRow key={s.tweetId} s={s} settings={settings} onOpenPerson={onOpenPerson} />
        ))}
      </ul>
    </>
  );
}

function RadarRow({
  s,
  settings,
  onOpenPerson,
}: {
  s: RadarSighting;
  settings: Settings;
  onOpenPerson: (handle: string) => void;
}): JSX.Element {
  const [copied, setCopied] = useState(false);
  // C8: channel tags live on the server's radar_drafts copy (keyed by tweetId),
  // which only exists once a reply was drafted — so the picker shows then.
  // Session-local mirror; the persisted copy is what the aggregate reads.
  const [tags, setTags] = useState<string[]>([]);

  // Opening a drafted tweet copies its reply (user gesture → clipboard allowed)
  // and moves the row to the Clicked view; the anchor's default still opens the
  // tweet in a new tab.
  const onOpen = (): void => {
    if (!s.reply) return;
    markClicked(s.tweetId);
    confirmDraft(s.tweetId);
    void navigator.clipboard
      .writeText(s.reply)
      .then(() => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1500);
      })
      .catch((err) => console.warn('[stratus] clipboard write failed', err));
  };

  return (
    <li className={`radar-row${s.reply ? ' radar-row-replied' : ''}`}>
      <div className="radar-row-head">
        <span className={`radar-band radar-band-${s.band}`}>{s.band}</span>
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
        {s.variants && s.variants.length > 1 && (
          <span className="radar-angles" title="Angle variants ready on the tweet page">
            {s.variants.length} angles
          </span>
        )}
        <button
          type="button"
          className="radar-dismiss"
          title="Dismiss — done or not worth it"
          onClick={() => dismiss([s.tweetId])}
        >
          ✕
        </button>
      </div>
      <a className="radar-text" href={s.url} target="_blank" rel="noreferrer" onClick={onOpen}>
        {s.text || s.url}
      </a>
      <div className="radar-why">{whyLine(s)}</div>
      {s.reply && (
        <div className="radar-reply" title="Opening the tweet copies this to your clipboard">
          {s.reply}
          <span className="radar-reply-hint">{copied ? 'copied ✓' : 'open → copies'}</span>
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

// S0.3 chip tooltip — why this author outranks a louder rando.
function tierLabel(tier: NonNullable<RadarSighting['personTier']>): string {
  if (tier === 'ally') return 'Ally — an established two-way relationship';
  if (tier === 'mutual') return 'Mutual — you two go back and forth';
  return 'Target — an in-band 2–10x account worth building';
}

// "1.5k views · 8 replies · 22m · 70/min · bait"
function whyLine(s: RadarSighting): string {
  const { views, replies, vpm, bait } = s.signals;
  // A ⊕ manual add (RU.8) with no captured metrics — don't render a line of
  // zeros; a cold tweet the human pinned has nothing to quantify yet.
  if (s.band === 'manual' && views === 0 && replies === 0) {
    return `manually added · ${fmtAge(displayAgeMin(s))}`;
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
