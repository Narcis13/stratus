// Pure reader for X's `[data-testid="UserCell"]` rows — one per person on a
// /following list page (GR.2). It lives here rather than in harvester.ts for the
// §7.27 reason: the scroll engine around it is browser-verified by convention,
// but the DOM parse is the part that silently rots when X renames a testid, so
// it gets fixture tests. Dependency-free apart from the handle rules it must not
// fork (profileHandleFromUrl owns the reserved-word list).

import { profileHandleFromUrl } from './harvest.ts';

const AVATAR_PREFIX = 'UserAvatar-Container-';
const USERNAME_RE = /^[A-Za-z0-9_]{1,15}$/;

export interface UserCell {
  /** Lowercased — the ledger keys on it, and X renders display casing. */
  handle: string;
  displayName: string | null;
  /** True when X rendered the "Follows you" badge on this row. */
  followsBack: boolean;
}

/** The handle encoded in a `UserAvatar-Container-<handle>` testid, or null.
 *  Shared with the harvester's logged-in-account probe — the same attribute
 *  NT.1's notification parser was live-verified against. */
export function handleFromAvatarTestid(testid: string | null | undefined): string | null {
  if (typeof testid !== 'string' || !testid.startsWith(AVATAR_PREFIX)) return null;
  const handle = testid.slice(AVATAR_PREFIX.length);
  return USERNAME_RE.test(handle) ? handle.toLowerCase() : null;
}

function cellHandle(cell: Element): string | null {
  const avatar = cell.querySelector(`[data-testid^="${AVATAR_PREFIX}"]`);
  const fromAvatar = handleFromAvatarTestid(avatar?.getAttribute('data-testid'));
  if (fromAvatar) return fromAvatar;
  // Fallback, deliberately second: a bio's @mentions render as profile links
  // too, so the avatar's testid is the reading that can't pick the wrong person.
  for (const a of Array.from(cell.querySelectorAll('a[href]'))) {
    const handle = profileHandleFromUrl(a.getAttribute('href') ?? '');
    if (handle) return handle.toLowerCase();
  }
  return null;
}

function textOf(el: Element): string {
  return (el.textContent ?? '').replace(/\s+/g, ' ').trim();
}

// The display name is the first innermost `[dir]` text block that is neither the
// @handle nor the follows-you badge. Comparing against the badge's OWN text
// (instead of a hardcoded "Follows you") is what keeps this locale-proof, and
// skipping blocks that wrap another `[dir]` is what keeps a container from
// reading as "Alice @alice Follows you".
function cellDisplayName(cell: Element, indicator: Element | null): string | null {
  const badge = indicator === null ? null : textOf(indicator);
  for (const el of Array.from(cell.querySelectorAll('[dir]'))) {
    if (el.querySelector('[dir]') !== null) continue;
    const text = textOf(el);
    if (text === '' || text.startsWith('@')) continue;
    if (badge !== null && badge !== '' && text === badge) continue;
    return text;
  }
  return null;
}

/** null = this element isn't a readable user cell (a skeleton mid-render, or a
 *  renamed testid). The caller must treat that as "nothing seen here" and let a
 *  later sweep retry — never as a row. */
export function parseUserCell(cell: Element): UserCell | null {
  const handle = cellHandle(cell);
  if (handle === null) return null;
  const indicator = cell.querySelector('[data-testid="userFollowIndicator"]');
  return {
    handle,
    displayName: cellDisplayName(cell, indicator),
    // Presence of the element, never its text — X localizes the label.
    followsBack: indicator !== null,
  };
}
