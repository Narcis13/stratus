// Target roster (OVERHAUL-PLAN §7.4): voice authors sized 2–10x my follower
// count, ranked by momentum from the append-only enrich series. Each row shows
// "last replied to" so neglected targets surface — the REPLY GUIDE's private
// list of top voices as a living view instead of vibes. One $0 GET.

import { type JSX, useCallback, useEffect, useState } from 'react';
import { ApiError, type VoiceTarget, type VoiceTargets, api } from './api.ts';
import type { Settings } from './storage.ts';

const NEGLECT_DAYS = 7;

export function TargetsSection({ settings }: { settings: Settings }): JSX.Element {
  const [data, setData] = useState<VoiceTargets | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setData(await api.voice.targets(settings));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to load targets');
    }
  }, [settings]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <section className="brief-section">
      <h3>
        Targets
        {data && data.targets.length > 0 && ` (${data.targets.length})`}
        {data?.band && (
          <span className="targets-band">
            {fmtNum(data.band.min)}–{fmtNum(data.band.max)} followers
          </span>
        )}
      </h3>

      {error && <div className="error">{error}</div>}

      {data &&
        (data.myFollowers === null ? (
          <div className="muted">
            No account snapshot yet — runs after the first 03:00 UTC pass.
          </div>
        ) : data.targets.length === 0 ? (
          <div className="muted">
            No saved authors in the 2–10x band. Save authors from their profile page to build the
            roster.
          </div>
        ) : (
          <ul className="targets-list">
            {data.targets.map((t) => (
              <TargetRow key={t.handle} t={t} />
            ))}
          </ul>
        ))}
    </section>
  );
}

function TargetRow({ t }: { t: VoiceTarget }): JSX.Element {
  const neglected =
    t.lastRepliedAt === null ||
    Date.now() - Date.parse(t.lastRepliedAt) > NEGLECT_DAYS * 24 * 60 * 60 * 1000;

  return (
    <li className="target-row">
      <div className="target-head">
        <a
          className="target-handle"
          href={t.profileUrl ?? `https://x.com/${t.handle}`}
          target="_blank"
          rel="noreferrer"
        >
          @{t.handle}
        </a>
        <span className="target-followers">{fmtNum(t.followersCount)}</span>
        <span className="target-momentum">{fmtMomentum(t)}</span>
      </div>
      <div className={`target-replied${neglected ? ' target-neglected' : ''}`}>
        {t.lastRepliedAt === null
          ? 'never replied to'
          : `replied ${fmtAgo(t.lastRepliedAt)} · ${t.postedReplies}× total`}
      </div>
    </li>
  );
}

function fmtMomentum(t: VoiceTarget): string {
  if (!t.momentum) return 'no trend yet';
  const { perDay } = t.momentum;
  const n = Math.abs(perDay) >= 10 ? Math.round(perDay) : perDay;
  return `${perDay >= 0 ? '+' : ''}${n}/day`;
}

function fmtNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 10_000) return `${(n / 1000).toFixed(1)}k`;
  return n.toLocaleString();
}

function fmtAgo(iso: string): string {
  const min = Math.max(0, (Date.now() - Date.parse(iso)) / 60000);
  if (min < 60) return `${Math.round(min)}m ago`;
  if (min < 24 * 60) return `${Math.floor(min / 60)}h ago`;
  return `${Math.floor(min / 1440)}d ago`;
}
