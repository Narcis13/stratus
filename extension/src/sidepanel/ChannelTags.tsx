// Channel tag chips (CIRCLES-PLAN C8) — the one tagging affordance, reused on
// Voice tweets, People dossiers, Ideas and Radar rows. Renders every active
// channel as a toggleable chip; keyword auto-suggested channels (pure, $0 —
// suggestChannels over the row's text) sort first and get a hint dot, the
// human always confirms by clicking. Non-channel tags already on the row are
// preserved verbatim through every toggle.

import { type JSX, useEffect, useState } from 'react';
import { suggestChannels } from '../channelSuggest.ts';
import { type Channel, api } from './api.ts';
import type { Settings } from './storage.ts';

// One fetch per panel session (all pickers share it); the Channels tab
// invalidates after edits so new rooms show up without a panel reload.
const CACHE_TTL_MS = 60_000;
let cache: { channels: Channel[]; at: number } | null = null;
let inflight: Promise<Channel[]> | null = null;

export async function loadActiveChannels(settings: Settings): Promise<Channel[]> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.channels;
  if (!inflight) {
    inflight = api.channels
      .list(settings, { active: true })
      .then((channels) => {
        cache = { channels, at: Date.now() };
        return channels;
      })
      .finally(() => {
        inflight = null;
      });
  }
  return inflight;
}

export function invalidateChannelsCache(): void {
  cache = null;
}

interface Props {
  settings: Settings;
  /** Current tags on the row (may include non-channel strings — preserved). */
  tags: string[] | null;
  /** Persist the full new tag set; the caller owns the API call. */
  onSave: (tags: string[]) => Promise<void>;
  /** Text to run keyword auto-suggest over (tweet text, idea text, bio…). */
  suggestFrom?: string | undefined;
}

export function ChannelTagPicker({ settings, tags, onSave, suggestFrom }: Props): JSX.Element {
  const [channels, setChannels] = useState<Channel[] | null>(null);
  const [busySlug, setBusySlug] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    loadActiveChannels(settings)
      .then((chs) => {
        if (alive) setChannels(chs);
      })
      .catch(() => {
        if (alive) setChannels([]);
      });
    return () => {
      alive = false;
    };
  }, [settings]);

  if (channels === null) return <div className="channel-tags" />;
  if (channels.length === 0) return <></>;

  const current = tags ?? [];
  const suggested = suggestFrom ? suggestChannels(suggestFrom, channels) : [];
  const suggestedRank = new Map(suggested.map((slug, i) => [slug, i]));
  const ordered = [...channels].sort((a, b) => {
    const ra = suggestedRank.get(a.slug) ?? Number.MAX_SAFE_INTEGER;
    const rb = suggestedRank.get(b.slug) ?? Number.MAX_SAFE_INTEGER;
    return ra - rb || a.sortOrder - b.sortOrder || a.slug.localeCompare(b.slug);
  });

  const toggle = async (slug: string): Promise<void> => {
    if (busySlug) return;
    setBusySlug(slug);
    const next = current.includes(slug) ? current.filter((t) => t !== slug) : [...current, slug];
    try {
      await onSave(next);
    } catch (err) {
      console.warn('[stratus] tag save failed', err);
    } finally {
      setBusySlug(null);
    }
  };

  return (
    <div className="channel-tags">
      {ordered.map((ch) => {
        const selected = current.includes(ch.slug);
        const hinted = !selected && suggestedRank.has(ch.slug);
        return (
          <button
            key={ch.slug}
            type="button"
            className={`channel-chip${selected ? ' channel-chip-on' : ''}${hinted ? ' channel-chip-hint' : ''}`}
            style={ch.color && selected ? { borderColor: ch.color, color: ch.color } : undefined}
            title={hinted ? 'Suggested from keywords — click to confirm' : ch.label}
            disabled={busySlug !== null}
            onClick={() => void toggle(ch.slug)}
          >
            #{ch.slug}
            {busySlug === ch.slug ? '…' : ''}
          </button>
        );
      })}
    </div>
  );
}
