// Sunday Digest card (CIRCLES-PLAN C9) — the coach's weekly note. On Sundays
// it loads on mount (the narration is cached per week server-side, so opening
// the panel twice never re-spends); any other day it waits behind a button.
// "Rewrite" is the one explicit re-spend path (?refresh=true).

import { type JSX, useCallback, useEffect, useState } from 'react';
import { ApiError, type DigestResponse, type DigestScorecard, api } from './api.ts';
import type { Settings } from './storage.ts';

// GR.9 — the five scorecard components, in weight order. A component the server
// scored `null` had no data this week and was dropped from the blend; listing it
// as a blank would read as a zero, so it is omitted from the breakdown.
const SCORECARD_LABELS: Array<[keyof DigestScorecard['components'], string]> = [
  ['questAdherence', 'quests'],
  ['cadenceConsistency', 'cadence'],
  ['replyQuota', 'replies'],
  ['goalPacing', 'goals'],
  ['ratioAdherence', 'ratio'],
];

/** The week graded 0–100. Renders only when the server shipped a score — under
 *  the 4-day gate the whole card is null and this shows nothing at all, rather
 *  than a grade nobody can stand behind. */
function ScorecardBadge({ card }: { card: DigestScorecard }): JSX.Element {
  const breakdown = SCORECARD_LABELS.filter(([k]) => card.components[k] !== null)
    .map(([k, label]) => `${label} ${card.components[k]}`)
    .join(' · ');
  return (
    <div className="digest-grade">
      <span className="digest-grade-score" title={breakdown}>
        {card.score}
        <span className="muted">/100</span>
      </span>
      {/* A better week is worth saying out loud; a worse one is stated plainly
          and left alone (the C9 no-guilt contract). */}
      {card.delta !== null && (
        <span className={card.delta > 0 ? 'ok' : 'muted'}>
          {card.delta > 0 ? '+' : ''}
          {card.delta} vs last week
        </span>
      )}
      <span className="muted">{card.daysTracked} days tracked</span>
    </div>
  );
}

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

          {/* GR.9 — gated: absent on digests cached before this landed, null
              under the tracked-days gate. */}
          {data.facts.scorecard?.score != null && <ScorecardBadge card={data.facts.scorecard} />}

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
