// Sunday Digest card (CIRCLES-PLAN C9) — the coach's weekly note. On Sundays
// it loads on mount (the narration is cached per week server-side, so opening
// the panel twice never re-spends); any other day it waits behind a button.
// "Rewrite" is the one explicit re-spend path (?refresh=true).

import { type JSX, useCallback, useEffect, useState } from 'react';
import { ApiError, type DigestResponse, api } from './api.ts';
import type { Settings } from './storage.ts';

export function DigestSection({ settings }: { settings: Settings }): JSX.Element {
  const [data, setData] = useState<DigestResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isSunday = new Date().getDay() === 0;

  const load = useCallback(
    async (refresh = false): Promise<void> => {
      setBusy(true);
      setError(null);
      try {
        setData(await api.digest(settings, refresh ? { refresh: true } : {}));
      } catch (e) {
        setError(e instanceof ApiError ? `Digest failed: ${e.message}` : 'Digest failed');
      } finally {
        setBusy(false);
      }
    },
    [settings],
  );

  useEffect(() => {
    if (isSunday) void load();
  }, [isSunday, load]);

  return (
    <section className="brief-section">
      <h3>This week{isSunday ? ' — Sunday digest' : ''}</h3>
      {error && <div className="error">{error}</div>}

      {!data && (
        <div>
          {isSunday && busy ? (
            <div className="muted">Reading your week…</div>
          ) : (
            <button type="button" disabled={busy} onClick={() => void load()}>
              {busy ? 'Reading your week…' : "Read the week's digest"}
            </button>
          )}
        </div>
      )}

      {data && (
        <>
          {data.narrative ? (
            <div className="digest-narrative">
              {data.narrative.split(/\n{2,}|\n/).map((p, i) => (
                // Paragraph order is the identity here; the digest is regenerated wholesale.
                // biome-ignore lint/suspicious/noArrayIndexKey: static narrative paragraphs
                <p key={i}>{p}</p>
              ))}
            </div>
          ) : (
            <div className="muted">
              {data.narrativeError === 'llm_not_configured'
                ? 'Facts only — no LLM provider is configured on the server.'
                : 'The coach lost their voice this time — the numbers below still stand.'}
            </div>
          )}

          <div className="digest-facts">
            {data.facts.followers.delta !== null && (
              <span>
                {data.facts.followers.delta >= 0 ? '+' : ''}
                {data.facts.followers.delta} followers
              </span>
            )}
            {data.facts.conversion?.rate != null && (
              <span title="earned profile visits that converted to follows this week">
                {data.facts.conversion.profileClicks} visits →{' '}
                {(data.facts.conversion.rate * 100).toFixed(1)}%
              </span>
            )}
            <span>
              {data.facts.activity.posts} posts · {data.facts.activity.replies} replies
            </span>
            {/* S0.7 — gated: absent on digests cached before this landed. */}
            {data.facts.rosterCoverage?.majorityInBand != null && (
              <span title="of this week's replies to known-size authors, share aimed at 2–10x targets (doctrine wants a majority)">
                {data.facts.rosterCoverage.inBandPctOfKnown}% in-band
                {data.facts.rosterCoverage.majorityInBand ? ' ✓' : ''}
              </span>
            )}
            {data.facts.quests.daysTracked > 0 && (
              <span>
                {data.facts.quests.daysAllDone}/{data.facts.quests.daysTracked} quest days
              </span>
            )}
            <span>${data.facts.spend.totalUsd.toFixed(2)} spent</span>
          </div>

          <div className="digest-foot">
            <span className="muted">
              week of {data.weekKey}
              {data.cached ? '' : ' · fresh'}
            </span>
            <button
              type="button"
              disabled={busy}
              title="Regenerate the narration (~$0.01)"
              onClick={() => void load(true)}
            >
              {busy ? '…' : 'Rewrite'}
            </button>
          </div>
        </>
      )}
    </section>
  );
}
