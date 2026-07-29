// JD.6 — the Composer's paid second opinion.
//
// The static coach (SC.3) is a free floor that catches own-goals as you type.
// This is the other half: one LLM call that reads the draft on the 13-dimension
// rubric and comes back with a band, twelve named scores, and up to twelve fixes
// each quoted verbatim out of your own text — click one and it selects that
// phrase in the textarea. "Apply all fixes" rewrites from those fixes, re-judges
// the result, and keeps it only if it scores strictly better.
//
// Four properties this component exists to hold:
//
//   - **Nothing here gates anything.** No score sorts, blocks Save, pre-selects
//     or refuses (JD decision 4, SC decision 4 — five tasks have now honoured
//     it). `JUDGE_DISCLAIMER` is the engine's own copy and is never retyped.
//   - **A verdict is only ever shown beside the exact text it judged.** The
//     panel derives that from `text` rather than clearing it in an effect: a
//     verdict whose draft changed is not rendered, and reverting the edit brings
//     it back, because it does describe that text again (§J4, D167).
//   - **The rubric's vocabulary comes from `src/shared/judge.ts`**, through the
//     extension shim: the twelve rows, their labels, the band copy, the two
//     dimensions where HIGH is bad, and the quote→offset walk. A panel that
//     hand-typed any of them would eventually grade a different rubric than the
//     server stored (§7 rule 4c).
//   - **`improved: false` is a SUCCESS.** The never-worse guard kept your words;
//     the panel says so rather than rendering a failure.
//
// Both buttons carry their price in the label (the AI.8 convention) and neither
// is ever called automatically — no polling, no debounce, no on-mount fetch.

import { type JSX, type RefObject, useMemo, useRef, useState } from 'react';
import {
  JUDGE_DIMENSION_LABEL,
  JUDGE_DISCLAIMER,
  JUDGE_HIGHER_IS_WORSE,
  JUDGE_SUB_DIMENSIONS,
  JUDGE_VERDICT_LABEL,
  type JudgeDimension,
  type JudgeSeverity,
  type JudgeVerdict,
  type JudgeVerdictLabel,
  deriveApproved,
  locateAnnotations,
} from '../judge.ts';
import { COACH_TONE } from './CoachChip.tsx';
import { ApiError, api } from './api.ts';
import type { Settings } from './storage.ts';
import { EmptyState } from './ui/EmptyState.tsx';
import { Section } from './ui/Section.tsx';

// The two cut points this panel colours by. They are PRESENTATION and they are
// this panel's alone: the coach's 45/60/85 grade a different scale entirely, and
// re-deriving either from the other would colour a number nobody was shown (the
// UI.7 badge-vs-gate fork). Opening guesses — recalibrate against real verdicts.
const STRONG_AT = 70;
const WEAK_BELOW = 40;

/** Tone for one dimension score. The POLARITY is a rubric fact and is read from
 *  `JUDGE_HIGHER_IS_WORSE`, never guessed here: `negativeRisk: 94` and
 *  `statusDependency: 94` are bad news, and green-high on them would say the
 *  opposite of what the rubric means (D163). A null score (`audienceMatch` with
 *  no active niche) is unknown, not zero — it renders muted (§7.11). */
function dimensionTone(dimension: JudgeDimension, score: number | null): string {
  if (score === null) return 'muted';
  const oriented = JUDGE_HIGHER_IS_WORSE.includes(dimension) ? 100 - score : score;
  if (oriented >= STRONG_AT) return COACH_TONE.pass;
  if (oriented < WEAK_BELOW) return COACH_TONE.fix;
  return COACH_TONE.nudge;
}

/** Band → tone, off `deriveApproved` rather than a hand-typed four-entry map:
 *  the two approved labels read as pass, then the two rework labels split. One
 *  fewer place for the label and its colour to disagree. */
function bandTone(label: JudgeVerdictLabel): string {
  if (deriveApproved(label)) return COACH_TONE.pass;
  return label === 'major_rework' ? COACH_TONE.nudge : COACH_TONE.fix;
}

/** A `warning` is the rubric's own "this will cost you"; a `suggestion` is the
 *  smaller half. Same two-colour reading as the coach's fix/nudge rows. */
function severityTone(severity: JudgeSeverity): string {
  return severity === 'warning' ? COACH_TONE.fix : COACH_TONE.nudge;
}

/** The judge's error codes say something specific enough to be worth saying.
 *  `http_404` is what an unmounted route looks like from here — the judge rides
 *  the LLM gate, so no provider key means no route at all (§7.22). */
function errorCopy(err: unknown, fallback: string): string {
  if (!(err instanceof ApiError)) return fallback;
  switch (err.code) {
    case 'stale_verdict':
      return 'This draft changed after it was judged — run the judge again first.';
    case 'nothing_to_apply':
      return 'Nothing to apply — this verdict flagged no fixes.';
    case 'judgment_not_found':
      return 'That verdict is gone from the server — run the judge again.';
    case 'http_404':
    case 'llm_not_configured':
      return 'No AI provider is configured — add a key in Settings → AI.';
    default:
      return `${fallback} (${err.message})`;
  }
}

/** A one-line status under the block. `info` covers the kept-your-version case,
 *  which is a 200 and not an error. */
interface Note {
  kind: 'info' | 'error';
  text: string;
}

type JudgeState =
  | { status: 'idle'; note: Note | null }
  | { status: 'running' }
  | {
      status: 'judged';
      verdict: JudgeVerdict;
      /** The row `/judge/apply` loads. **null when the best-effort insert
       *  failed** (JD decision 9) — there is then nothing to apply against. */
      judgmentId: string | null;
      /** Exactly what was judged. The verdict renders only while the live draft
       *  still equals this. */
      judgedText: string;
      /** The grader (decision 11 — recorded and shown, never silently baked in). */
      model: string;
      provider: string;
      note: Note | null;
    };

interface Props {
  settings: Settings;
  /** The live single-post draft. */
  text: string;
  /** Swap in a winning rewrite — the Composer owns the text state. */
  onApplyText: (next: string) => void;
  /** The Composer's single-post textarea: clicking a fix selects its span. */
  textareaRef: RefObject<HTMLTextAreaElement | null>;
}

export function JudgePanel({ settings, text, onApplyText, textareaRef }: Props): JSX.Element {
  const [judge, setJudge] = useState<JudgeState>({ status: 'idle', note: null });
  const [applying, setApplying] = useState(false);
  // The live draft, readable from an async handler. An apply call takes seconds
  // and the textarea stays editable throughout, so the swap has to be able to
  // ask whether the text it is about to replace is still the text it judged —
  // `text` inside the handler's closure is the value from the render that
  // started it.
  const liveText = useRef(text);
  liveText.current = text;

  // The reset-on-edit rule, derived instead of stored (D167): a verdict that no
  // longer describes the draft simply isn't rendered. Editing a character hides
  // it; undoing that edit brings it back, which is correct — the verdict does
  // describe that text again, and a re-judge would pay $0.003 to reproduce a
  // number we are holding.
  const view: JudgeState =
    judge.status === 'judged' && judge.judgedText !== text ? { status: 'idle', note: null } : judge;
  const verdict = view.status === 'judged' ? view.verdict : null;

  // Offsets into the LIVE text, so a click lands on the right span even though
  // the server judged the trimmed spelling. An unmatched or hallucinated quote
  // is dropped by the locator and renders nothing at all (§J1).
  const fixes = useMemo(
    () => (verdict ? locateAnnotations(text, verdict.annotations) : []),
    [verdict, text],
  );

  const runJudge = async (): Promise<void> => {
    const draft = text;
    if (draft.trim() === '') return;
    setJudge({ status: 'running' });
    try {
      const res = await api.judge.run(settings, { text: draft.trim() });
      setJudge({
        status: 'judged',
        verdict: res,
        judgmentId: res.id,
        judgedText: draft,
        model: res.model,
        provider: res.provider,
        note:
          res.id === null
            ? { kind: 'info', text: 'Verdict not stored — “Apply all fixes” needs a stored one.' }
            : null,
      });
    } catch (err) {
      setJudge({ status: 'idle', note: { kind: 'error', text: errorCopy(err, 'Judge failed') } });
    }
  };

  const applyFixes = async (): Promise<void> => {
    if (view.status !== 'judged') return;
    const current = view;
    const judgmentId = current.judgmentId;
    if (judgmentId === null) return;
    setApplying(true);
    try {
      const res = await api.judge.apply(settings, {
        judgmentId,
        // The trimmed spelling is what was judged; `judgeTextHash` normalizes
        // whitespace anyway, so this can only ever fail the 409 on a real edit.
        text: current.judgedText.trim(),
      });
      if (!res.improved) {
        // A 200, and the whole point of the guard: the rewrite did not score
        // strictly better, so the composer is left exactly as it was.
        setJudge({
          ...current,
          note: { kind: 'info', text: 'Kept your version — the rewrite did not score better.' },
        });
        return;
      }
      // Never overwrite something typed while the rewrite was running. The
      // textarea has no undo across a controlled `setText`, so a swap that
      // lands on a draft the user has moved on from destroys their words to
      // apply fixes to a version that no longer exists.
      if (liveText.current !== current.judgedText) {
        setJudge({
          status: 'idle',
          note: {
            kind: 'info',
            text: 'You edited the draft while the rewrite was running — it was not swapped in.',
          },
        });
        return;
      }
      onApplyText(res.text);
      setJudge({
        status: 'judged',
        verdict: res,
        judgmentId: res.judgmentId,
        judgedText: res.text,
        model: res.model,
        provider: res.provider,
        note: { kind: 'info', text: 'Rewritten and re-judged — this version scored better.' },
      });
    } catch (err) {
      setJudge({
        ...current,
        note: { kind: 'error', text: errorCopy(err, 'Apply failed') },
      });
    } finally {
      setApplying(false);
    }
  };

  // The anchored half of the whole feature: a fix names a phrase, and clicking
  // it puts your cursor on that phrase. Focus first — focusing after selecting
  // collapses the selection in some engines.
  const selectSpan = (from: number, to: number): void => {
    const el = textareaRef.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(from, to);
  };

  const canApply =
    view.status === 'judged' &&
    view.judgmentId !== null &&
    (view.verdict.annotations.length > 0 || view.verdict.improvements.length > 0);

  const note = view.status === 'running' ? null : view.note;

  return (
    <Section title="Judge">
      {view.status !== 'judged' ? (
        <EmptyState
          line="A second opinion on this draft: one call grades it on thirteen dimensions and quotes the exact phrases worth changing."
          hint={JUDGE_DISCLAIMER}
          action={
            <button
              type="button"
              onClick={() => void runJudge()}
              disabled={view.status === 'running' || text.trim() === ''}
            >
              {view.status === 'running' ? 'Judging…' : 'Run judge (~$0.003)'}
            </button>
          }
        />
      ) : (
        <div className="judge">
          <div className="judge-head">
            <span className={`judge-score ${bandTone(view.verdict.verdict)}`}>
              {view.verdict.scores.overall}
            </span>
            <span className="muted">
              /100 · {JUDGE_VERDICT_LABEL[view.verdict.verdict]}
              {view.verdict.confidence && ` · ${view.verdict.confidence} confidence`}
            </span>
          </div>

          {view.verdict.headline !== '' && (
            <div className="judge-headline">{view.verdict.headline}</div>
          )}

          {/* The useful part (JUDGE_DISCLAIMER says so): each row is a phrase in
              the box above, and clicking it selects that phrase. */}
          {fixes.length > 0 && (
            <ul className="judge-fixes">
              {fixes.map((fix) => (
                <li key={`${fix.from}:${fix.to}:${fix.quote}`}>
                  <button
                    type="button"
                    className={`judge-fix ${severityTone(fix.severity)}`}
                    onClick={() => selectSpan(fix.from, fix.to)}
                    title="Select this phrase in the draft"
                  >
                    <span className="judge-fix-quote">“{fix.quote}”</span>
                    <span className="judge-fix-rec">{fix.recommendation}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          <details className="judge-detail">
            <summary>{JUDGE_SUB_DIMENSIONS.length} dimensions</summary>
            <ul className="judge-dims">
              {JUDGE_SUB_DIMENSIONS.map((d) => {
                const score = view.verdict.scores[d];
                return (
                  <li className="judge-dim" key={d}>
                    <span>{JUDGE_DIMENSION_LABEL[d]}</span>
                    <span className={`judge-dim-score ${dimensionTone(d, score)}`}>
                      {score ?? '—'}
                    </span>
                  </li>
                );
              })}
            </ul>
          </details>

          {(view.verdict.strengths.length > 0 || view.verdict.improvements.length > 0) && (
            <details className="judge-detail">
              <summary>
                {view.verdict.strengths.length} strengths · {view.verdict.improvements.length} to
                improve
              </summary>
              <ul className="judge-notes">
                {view.verdict.strengths.map((s) => (
                  <li className={COACH_TONE.pass} key={`s:${s}`}>
                    {s}
                  </li>
                ))}
                {view.verdict.improvements.map((s) => (
                  <li className={COACH_TONE.nudge} key={`i:${s}`}>
                    {s}
                  </li>
                ))}
              </ul>
            </details>
          )}

          <div className="row judge-actions">
            <button type="button" onClick={() => void runJudge()} disabled={applying}>
              Re-judge (~$0.003)
            </button>
            {canApply && (
              <button type="button" onClick={() => void applyFixes()} disabled={applying}>
                {applying ? 'Applying…' : 'Apply all fixes (~$0.007)'}
              </button>
            )}
          </div>

          <small className="muted">
            Graded by {view.model} ({view.provider}). {JUDGE_DISCLAIMER}
          </small>
        </div>
      )}

      {note && (
        <div className={note.kind === 'error' ? 'error' : 'muted judge-note'}>{note.text}</div>
      )}
    </Section>
  );
}
