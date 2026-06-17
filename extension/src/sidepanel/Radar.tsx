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
import type { RadarDismiss, RadarReplies } from '../shared/messages.ts';
import {
  RADAR_SIGHTINGS_KEY,
  type RadarSighting,
  isRadarSightings,
  rankSightings,
} from '../shared/radar.ts';
import { ApiError, type BatchReplyTweet, api } from './api.ts';
import type { Settings } from './storage.ts';

// One Grok call per click; cap how many tweets ride along so the batch stays
// cheap and the model keeps each reply anchored.
const RADAR_DRAFT_CAP = 20;

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

export function RadarSection({ settings }: { settings: Settings }): JSX.Element {
  const ranked = rankSightings(useRadarSightings());
  const [drafting, setDrafting] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  // Draft only the tweets that don't already have a reply, newest-ranked first.
  const undrafted = ranked.filter((s) => !s.reply).slice(0, RADAR_DRAFT_CAP);

  const draftReplies = async (): Promise<void> => {
    if (undrafted.length === 0) return;
    setDrafting(true);
    setNote(null);
    const tweets: BatchReplyTweet[] = undrafted.map((s) => ({
      tweetId: s.tweetId,
      handle: s.handle,
      author: s.author ?? s.handle,
      text: s.text,
      url: s.url,
    }));
    try {
      const res = await api.replies.generateBatch(settings, { tweets });
      if (res.replies.length > 0) {
        const msg: RadarReplies = {
          type: 'stratus/radar-replies',
          replies: res.replies.map((r) => ({ tweetId: r.tweetId, reply: r.text })),
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

  return (
    <section className="brief-section">
      <div className="radar-head">
        <h3>Radar{ranked.length > 0 && ` (${ranked.length})`}</h3>
        {ranked.length > 0 && (
          <div className="radar-actions">
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
            <button
              type="button"
              className="radar-clear"
              onClick={() => dismiss(ranked.map((s) => s.tweetId))}
            >
              Clear
            </button>
          </div>
        )}
      </div>
      {note && <div className="status-line">{note}</div>}
      {ranked.length === 0 ? (
        <div className="muted">Browse X — hot/warm tweets you scroll past queue up here.</div>
      ) : (
        <ul className="radar-list">
          {ranked.map((s) => (
            <RadarRow key={s.tweetId} s={s} />
          ))}
        </ul>
      )}
    </section>
  );
}

function RadarRow({ s }: { s: RadarSighting }): JSX.Element {
  const [copied, setCopied] = useState(false);

  // Opening a drafted tweet copies its reply (user gesture → clipboard allowed);
  // the anchor's default still opens the tweet in a new tab.
  const onOpen = (): void => {
    if (!s.reply) return;
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
        <span className="radar-author">{s.author ?? `@${s.handle}`}</span>
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
    </li>
  );
}

// "1.5k views · 8 replies · 22m · 70/min · bait"
function whyLine(s: RadarSighting): string {
  const { views, replies, vpm, bait } = s.signals;
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
