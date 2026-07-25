// Top Fans (CIRCLES-PLAN C5): people who already notice you — inbound
// mentions/replies ranked over a trailing 30/90d window, each with "last
// acknowledged" (my last outbound to them). A top-10 fan I haven't answered
// in >7d shows amber: attention already given, reciprocity owed. One $0 GET.
// C10 adds a display-only engagement count (likes/reposts/follows harvested
// from the notifications tab) — it never enters the ranking.

import { type JSX, useCallback, useEffect, useState } from 'react';
import { SettingsGear } from './SettingsGear.tsx';
import { ApiError, type FansResponse, api } from './api.ts';
import { useServerSettings } from './serverSettingsHook.ts';
import type { SettingsEditor } from './settingsEditor.ts';
import type { Settings } from './storage.ts';
import { EmptyState } from './ui/EmptyState.tsx';
import { Section } from './ui/Section.tsx';

// UI.12 — how deep the amber goes is presentation (x.display.fansAmberTopN); how
// long someone may go unacknowledged before it fires is the server's own
// x.followups.fanUnacknowledgedDays, which is what sets `unacknowledged` on the
// row. Both in one gear, because the pair is a single question to the user.
const FANS_KEYS = ['x.display.fansAmberTopN', 'x.followups.fanUnacknowledgedDays'];

export function FansSection({
  settings,
  onOpenPerson,
  editor,
}: {
  settings: Settings;
  onOpenPerson: (handle: string) => void;
  editor: SettingsEditor;
}): JSX.Element {
  const server = useServerSettings();
  const [days, setDays] = useState<30 | 90>(30);
  const [data, setData] = useState<FansResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setData(await api.people.fans(settings, { days }));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to load fans');
    }
  }, [settings, days]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <Section
      title={`Top fans${data && data.count > 0 ? ` (${data.count})` : ''}`}
      actions={
        <>
          <span className="fans-window">
            {([30, 90] as const).map((d) => (
              <button
                key={d}
                type="button"
                className={`fans-window-btn${days === d ? ' active' : ''}`}
                onClick={() => setDays(d)}
              >
                {d}d
              </button>
            ))}
          </span>
          <SettingsGear
            editor={editor}
            keys={FANS_KEYS}
            label="Configure the reciprocity nudge"
            note="Only the amber nudge moves — the ranking itself is inbound volume over the window you picked."
          />
        </>
      }
    >
      {error && <div className="error">{error}</div>}

      {data &&
        (data.fans.length === 0 ? (
          <EmptyState
            line={`No inbound in the last ${data.days} days.`}
            hint="Fans show up here once people reply to or mention you — replying to targets is what starts that."
          />
        ) : (
          <ul className="fans-list">
            {data.fans.map((f) => {
              const amber = f.unacknowledged && f.rank <= server.fansAmberTopN;
              return (
                <li key={f.handle} className="fan-row">
                  <span className="fan-count">{f.inboundCount}×</span>
                  <button
                    type="button"
                    className="person-link"
                    title="Open dossier"
                    onClick={() => onOpenPerson(f.handle)}
                  >
                    @{f.handle}
                  </button>
                  {f.stage && f.stage !== 'stranger' && (
                    <span className={`stage-chip stage-${f.stage}`}>{f.stage}</span>
                  )}
                  {f.engagementCount > 0 && (
                    <span className="fan-engagements" title="Likes/reposts/follows in this window">
                      · {f.engagementCount} engagements
                    </span>
                  )}
                  <span className={`fan-ack${amber ? ' target-neglected' : ''}`}>
                    {f.lastOutboundAt === null
                      ? 'never acknowledged'
                      : `acknowledged ${fmtAgo(f.lastOutboundAt)}`}
                  </span>
                </li>
              );
            })}
          </ul>
        ))}
    </Section>
  );
}

function fmtAgo(iso: string): string {
  const min = Math.max(0, (Date.now() - Date.parse(iso)) / 60000);
  if (min < 60) return `${Math.round(min)}m ago`;
  if (min < 24 * 60) return `${Math.floor(min / 60)}h ago`;
  return `${Math.floor(min / 1440)}d ago`;
}
