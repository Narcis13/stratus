// The chip vocabularies (UI.14) — the TS half of the `.chip` family in
// styles.css.
//
// One shape, five tones, many vocabularies. Each vocabulary below maps its
// values onto a tone; nothing here mints CSS. The point is that "consumed"
// (an idea), "confirmed" (a following row) and "sent" (a DM) all mean the same
// thing to the eye — the loop closed — so they all read `ok`, while the panel
// keeps only one place where that judgement is written down.
//
// CRM stages are the exception that keeps its own class names: `.stage-ally`
// and friends are rendered by five files, three of which belong to another
// masterplan lane, so the tone stays where it already is and this module only
// supplies the shared base class.

import type { RankerBand } from '../xRankerSignals.ts';
import type {
  DmStatus,
  FollowingStatus,
  IdeaStatus,
  PersonStage,
  ReplyDraftStatus,
} from './api.ts';

/** The five tones `.chip-*` implements. `muted` is the base's own color. */
export type ChipTone = 'ok' | 'accent' | 'warn' | 'strong' | 'muted';

const chip = (tone: ChipTone): string => `chip chip-${tone}`;

/** A CRM stage: the shared base plus the stage's existing tone alias. */
export function stageChip(stage: PersonStage): string {
  return `chip stage-${stage}`;
}

/** Idea lifecycle. `open` is live work, so it takes the accent the panel uses
 *  everywhere else for "this is yours to act on". */
export function ideaChip(status: IdeaStatus): string {
  switch (status) {
    case 'open':
      return chip('accent');
    case 'consumed':
      return chip('ok');
    case 'discarded':
      return chip('muted');
  }
}

/** Following-ledger status. `queued` warns because it is the only value that
 *  is asking the user for something. */
export function followingChip(status: FollowingStatus): string {
  switch (status) {
    case 'active':
      return chip('strong');
    case 'queued':
      return chip('warn');
    case 'done':
      return chip('accent');
    case 'confirmed':
      return chip('ok');
    case 'gone':
      return chip('muted');
  }
}

/** DM draft status — `draft` is unfinished business, not a closed loop. */
export function dmChip(status: DmStatus): string {
  switch (status) {
    case 'draft':
      return chip('strong');
    case 'sent':
      return chip('ok');
    case 'discarded':
      return chip('muted');
  }
}

/** Reply-draft lifecycle (UI.15). Same judgement as the vocabularies above:
 *  `posted` is the loop closed, `discarded` is dead, and the two live states
 *  split on who is waiting — `generated` is yours to act on (the accent this
 *  panel uses for exactly that), `copied` is on your clipboard waiting for the
 *  paste, so it warns like a queued follow. Before UI.15 this borrowed the
 *  scheduled-post `.badge-*` pipeline ramp, which is a different alphabet. */
export function replyDraftChip(status: ReplyDraftStatus): string {
  switch (status) {
    case 'generated':
      return chip('accent');
    case 'copied':
      return chip('warn');
    case 'posted':
      return chip('ok');
    case 'discarded':
      return chip('muted');
  }
}

/** Cannon roster health (CQ.6). Three states, and the split is the same
 *  judgement the rest of this file makes: `below` warns because it is the only
 *  one asking the human for a decision (drop them on Sunday), while `unscored`
 *  is quiet — the harvest hasn't covered them yet, which is a fact about the
 *  data, not about the target. */
export function cannonTargetChip(state: 'scored' | 'below' | 'unscored'): string {
  switch (state) {
    case 'scored':
      return chip('ok');
    case 'below':
      return chip('warn');
    case 'unscored':
      return chip('muted');
  }
}

/** Swipe-file author state: enriched from a profile scrape vs seen only through
 *  a saved tweet, and the retired flag that hides them from drafting. */
export function authorChip(state: 'enriched' | 'tweet-only' | 'retired'): string {
  return chip(state === 'enriched' ? 'ok' : 'muted');
}

/** XR.5 — the ranker's C band. Deliberately NOT the coach's tone classes and
 *  not `CoachBand`'s words: C is a different scale answering a different
 *  question, and two engines sharing one colour ramp is how a reader starts
 *  averaging them into a single verdict (plan Decision 2). It lands here
 *  rather than beside `COACH_TONE` for the reason UI.14 exists — a chip
 *  vocabulary maps its values onto a tone in this file; the coach's map lives
 *  in CoachChip.tsx because the surfaces it colours (the score pill, the fix
 *  rows) are deliberately not chips.
 *
 *  Only one band takes a tone today. `RANKER_BAND_CUTS` is
 *  `imported-unvalidated` and measurably off-centre on our modifier set —
 *  `strong` is the MODAL band, not the exceptional one (D230) — so painting it
 *  `ok` would sell a borrowed cut point as a verdict. `typical` and `strong`
 *  stay quiet until XR.4's falsification cell re-cuts them; `below` warns for
 *  the same reason a `queued` follow does, because it is the one band asking
 *  the writer to look. Nothing here goes red: the chip family has no danger
 *  tone, which is the correct ceiling for an advisory number (§7.23a). */
export function rankerBandChip(band: RankerBand): string {
  switch (band) {
    case 'below':
      return chip('warn');
    case 'typical':
      return chip('muted');
    case 'strong':
      return chip('muted');
  }
}
