// "Do next" strip (CIRCLES-PLAN C5): the follow-up queue, capped at 5 — a
// queue, not a dashboard. Chain-live first (someone replied to my reply and
// the window is hot), then dm-ready, then neglected targets/allies, then
// momentum lines. One $0 GET; snoozes persist server-side (followup_snoozes).

import { type JSX, useCallback, useEffect, useState } from 'react';
import { IcebreakerBox } from './Icebreakers.tsx';
import {
  ApiError,
  type FollowupItem,
  type FollowupKind,
  type FollowupsResponse,
  api,
} from './api.ts';
import type { Settings } from './storage.ts';

const STRIP_CAP = 5;
const SNOOZE_HOURS = 24;

const KIND_LABEL: Record<FollowupKind, string> = {
  chain_live: 'chain',
  dm_ready: 'DM',
  neglected_target: 'target',
  neglected_ally: 'ally',
  reup_candidate: 'reup',
  momentum: 'rising',
};

// reup items have no person handle — key/snooze on the tweet instead.
function itemKey(item: FollowupItem): string {
  return item.kind === 'reup_candidate'
    ? `reup:${item.tweetId ?? ''}`
    : `${item.kind}:${item.handle}`;
}

export function DoNextSection({
  settings,
  onOpenPerson,
}: {
  settings: Settings;
  onOpenPerson: (handle: string) => void;
}): JSX.Element {
  const [data, setData] = useState<FollowupsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  // C9: at most one opener box open at a time — it's a nudge, not a workbench.
  const [openerHandle, setOpenerHandle] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setData(await api.people.followups(settings));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to load follow-ups');
    }
  }, [settings]);

  useEffect(() => {
    void load();
  }, [load]);

  const snooze = async (item: FollowupItem): Promise<void> => {
    setBusyKey(itemKey(item));
    const snoozedUntil = new Date(Date.now() + SNOOZE_HOURS * 3600_000).toISOString();
    try {
      await api.people.snoozeFollowup(
        settings,
        item.kind === 'reup_candidate'
          ? { kind: item.kind, tweetId: item.tweetId ?? '', snoozedUntil }
          : { kind: item.kind, handle: item.handle, snoozedUntil },
      );
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Snooze failed');
    } finally {
      setBusyKey(null);
    }
  };

  // §S0.6 — draft a quote-tweet re-up of a proven winner. Drafts land in the
  // calendar (§8.1 pipeline); the candidate then drops off the queue on reload
  // because a scheduled_posts row now carries its quote_tweet_id.
  const draftReup = async (item: FollowupItem): Promise<void> => {
    if (!item.tweetId) return;
    setBusyKey(itemKey(item));
    setNote(null);
    try {
      const res = await api.drafts.reup(settings, { tweetId: item.tweetId });
      setNote(`${res.drafts.length} quote drafts in the calendar ($${res.costUsd.toFixed(4)}).`);
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? `Re-up failed: ${e.message}` : 'Re-up failed');
    } finally {
      setBusyKey(null);
    }
  };

  const items = data?.items.slice(0, STRIP_CAP) ?? [];
  const overflow = (data?.items.length ?? 0) - items.length;

  return (
    <section className="brief-section">
      <h3>
        Do next
        {data && data.counts.total > 0 && ` (${data.counts.total})`}
      </h3>

      {error && <div className="error">{error}</div>}
      {note && <div className="status-line">{note}</div>}

      {data &&
        (items.length === 0 ? (
          <div className="muted">
            Nothing owed{data.counts.snoozed > 0 ? ` (${data.counts.snoozed} snoozed)` : ''} — go
            hunting.
          </div>
        ) : (
          <>
            <ul className="donext-list">
              {items.map((item) => {
                const isReup = item.kind === 'reup_candidate';
                return (
                  <li key={itemKey(item)} className={`donext-row donext-${item.kind}`}>
                    <span className={`donext-kind donext-kind-${item.kind}`}>
                      {KIND_LABEL[item.kind]}
                    </span>
                    <div className="donext-main">
                      {isReup ? (
                        <span className="donext-self">your post</span>
                      ) : (
                        <button
                          type="button"
                          className="person-link"
                          title="Open dossier"
                          onClick={() => onOpenPerson(item.handle)}
                        >
                          @{item.handle}
                        </button>
                      )}
                      <span className="donext-reason">{item.reason}</span>
                    </div>
                    {item.url && (
                      <a
                        className="target-ext"
                        href={item.url}
                        target="_blank"
                        rel="noreferrer"
                        title={isReup ? 'Open the post on X' : 'Open their reply on X'}
                      >
                        ↗
                      </a>
                    )}
                    {isReup ? (
                      <button
                        type="button"
                        className="donext-opener"
                        title="Draft quote-tweet re-ups (§8.1 pipeline)"
                        disabled={busyKey === itemKey(item)}
                        onClick={() => void draftReup(item)}
                      >
                        draft
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="donext-opener"
                        title="Suggest an opener (C9)"
                        onClick={() =>
                          setOpenerHandle(openerHandle === item.handle ? null : item.handle)
                        }
                      >
                        opener
                      </button>
                    )}
                    <button
                      type="button"
                      className="donext-snooze"
                      title={`Snooze ${SNOOZE_HOURS}h`}
                      disabled={busyKey === itemKey(item)}
                      onClick={() => void snooze(item)}
                    >
                      zz
                    </button>
                    {!isReup && openerHandle === item.handle && (
                      <div className="donext-opener-box">
                        <IcebreakerBox settings={settings} handle={item.handle} />
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
            {overflow > 0 && <div className="muted donext-more">+{overflow} more in the queue</div>}
          </>
        ))}
    </section>
  );
}
