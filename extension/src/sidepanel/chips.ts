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

import type { DmStatus, FollowingStatus, IdeaStatus, PersonStage } from './api.ts';

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

/** Swipe-file author state: enriched from a profile scrape vs seen only through
 *  a saved tweet, and the retired flag that hides them from drafting. */
export function authorChip(state: 'enriched' | 'tweet-only' | 'retired'): string {
  return chip(state === 'enriched' ? 'ok' : 'muted');
}
