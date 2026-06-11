// The Radar (OVERHAUL-PLAN §7.2): hot/warm band sightings the content script
// streamed to chrome.storage.session while the user browsed X, ranked as a
// worked queue — band, then views-per-minute, then recency. Each row shows the
// "why" (views · replies · age · bait) so judgment stays with the human; click
// opens the tweet, where Reply Master is one click away. Dismissals route
// through the background (the buffer's single writer) so a still-on-screen
// tweet can't immediately re-enter.

import { type JSX, useEffect, useState } from 'react';
import { formatCount } from '../replyBand.ts';
import type { RadarDismiss } from '../shared/messages.ts';
import {
  RADAR_SIGHTINGS_KEY,
  type RadarSighting,
  isRadarSightings,
  rankSightings,
} from '../shared/radar.ts';

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

export function RadarSection(): JSX.Element {
  const ranked = rankSightings(useRadarSightings());

  return (
    <section className="brief-section">
      <div className="radar-head">
        <h3>Radar{ranked.length > 0 && ` (${ranked.length})`}</h3>
        {ranked.length > 0 && (
          <button
            type="button"
            className="radar-clear"
            onClick={() => dismiss(ranked.map((s) => s.tweetId))}
          >
            Clear
          </button>
        )}
      </div>
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
  return (
    <li className="radar-row">
      <div className="radar-row-head">
        <span className={`radar-band radar-band-${s.band}`}>{s.band}</span>
        <span className="radar-author">{s.author ?? `@${s.handle}`}</span>
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
