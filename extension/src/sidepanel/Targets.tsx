// Target roster (OVERHAUL-PLAN §7.4): voice authors sized 2–10x my follower
// count, ranked by momentum from the append-only enrich series. Each row shows
// "last replied to" so neglected targets surface — the REPLY GUIDE's private
// list of top voices as a living view instead of vibes. One $0 GET.

import { type JSX, useCallback, useEffect, useState } from 'react';
import { SettingsGear } from './SettingsGear.tsx';
import { ApiError, type VoiceTarget, type VoiceTargets, api } from './api.ts';
import { useServerSettings } from './serverSettingsHook.ts';
import type { SettingsEditor } from './settingsEditor.ts';
import type { Settings } from './storage.ts';
import { EmptyState } from './ui/EmptyState.tsx';
import { Section } from './ui/Section.tsx';

// UI.12 — the roster tint reads `x.followups.neglectedTargetDays`, the SAME key
// the follow-up queue and the weekly digest use, rather than a display twin: a
// roster that looks calm while "Do next" nags about the same person is a bug the
// user experiences as the tool contradicting itself. The 2–10x follower window
// is NOT here — the active niche owns it (D2/D129), which the gear note says.
const TARGETS_KEYS = ['x.followups.neglectedTargetDays'];

export function TargetsSection({
  settings,
  onOpenPerson,
  editor,
}: {
  settings: Settings;
  onOpenPerson: (handle: string) => void;
  editor: SettingsEditor;
}): JSX.Element {
  const server = useServerSettings();
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
    <Section
      title={`Targets${data && data.targets.length > 0 ? ` (${data.targets.length})` : ''}`}
      actions={
        <>
          {data?.band && (
            <span className="targets-band">
              {fmtNum(data.band.min)}–{fmtNum(data.band.max)} followers
            </span>
          )}
          <SettingsGear
            editor={editor}
            keys={TARGETS_KEYS}
            label="Configure the neglected-target window"
            note="The 2–10× follower window itself belongs to your active niche — edit it under Settings → General → Niche. This one number also drives the Do-next queue and the Sunday digest."
          />
        </>
      }
    >
      {error && <div className="error">{error}</div>}

      {data &&
        (data.myFollowers === null ? (
          <EmptyState
            line="No account snapshot yet."
            hint="The band is sized off your own follower count — the first 03:00 UTC pass fills it in."
          />
        ) : data.targets.length === 0 ? (
          <EmptyState
            line="No saved authors in the 2–10x band."
            hint="Save authors from their profile page on X and the ones in-band show up here."
          />
        ) : (
          <ul className="targets-list">
            {data.targets.map((t) => (
              <TargetRow
                key={t.handle}
                t={t}
                neglectDays={server.neglectedTargetDays}
                onOpenPerson={onOpenPerson}
              />
            ))}
          </ul>
        ))}
    </Section>
  );
}

function TargetRow({
  t,
  neglectDays,
  onOpenPerson,
}: {
  t: VoiceTarget;
  neglectDays: number;
  onOpenPerson: (handle: string) => void;
}): JSX.Element {
  const neglected =
    t.lastRepliedAt === null ||
    Date.now() - Date.parse(t.lastRepliedAt) > neglectDays * 24 * 60 * 60 * 1000;

  return (
    <li className="target-row">
      <div className="target-head">
        <button
          type="button"
          className="target-handle person-link"
          title="Open dossier"
          onClick={() => onOpenPerson(t.handle)}
        >
          @{t.handle}
        </button>
        <a
          className="target-ext"
          href={t.profileUrl ?? `https://x.com/${t.handle}`}
          target="_blank"
          rel="noreferrer"
          title="Open profile on X"
        >
          ↗
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
