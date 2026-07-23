// GR.2 — the /following list cell parser over fixture HTML (happy-dom), the same
// skeleton X renders per person: avatar container testid, a profile link, a name
// block, the @handle block, an optional "Follows you" badge, then the bio.

import { describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { handleFromAvatarTestid, parseUserCell } from './userCell.ts';

interface CellOpts {
  followsBack?: boolean;
  badgeText?: string;
  name?: string;
  avatar?: boolean;
  bio?: string;
}

function cellHtml(handle: string, opts: CellOpts = {}): string {
  const badge =
    opts.followsBack === true
      ? `<div dir="ltr"><span data-testid="userFollowIndicator">${opts.badgeText ?? 'Follows you'}</span></div>`
      : '';
  const avatar =
    opts.avatar === false ? '' : `<div data-testid="UserAvatar-Container-${handle}"></div>`;
  return `
    <button data-testid="UserCell">
      ${avatar}
      <a href="/${handle}" role="link">
        <div><div dir="ltr"><span>${opts.name ?? 'Alice Example'}</span></div></div>
        <div><div dir="ltr"><span>@${handle}</span></div>${badge}</div>
      </a>
      <button data-testid="123-unfollow"><span>Following</span></button>
      ${opts.bio === undefined ? '' : `<div dir="auto"><span>${opts.bio}</span></div>`}
    </button>`;
}

function cellsOf(html: string): Element[] {
  const window = new Window({ url: 'https://x.com/narcis/following' });
  window.document.body.innerHTML = html;
  return Array.from(
    window.document.querySelectorAll('[data-testid="UserCell"]'),
  ) as unknown as Element[];
}

function firstCell(html: string): Element {
  const [cell] = cellsOf(html);
  if (!cell) throw new Error('fixture rendered no cell');
  return cell;
}

describe('parseUserCell', () => {
  test('a plain row: handle, display name, no badge', () => {
    expect(parseUserCell(firstCell(cellHtml('alice')))).toEqual({
      handle: 'alice',
      displayName: 'Alice Example',
      followsBack: false,
    });
  });

  test('the badge element — not its text — is what says they follow back', () => {
    expect(parseUserCell(firstCell(cellHtml('alice', { followsBack: true })))?.followsBack).toBe(
      true,
    );
  });

  // The badge label is localized; reading its own text (rather than matching
  // "Follows you") is what keeps both the flag and the name locale-proof.
  test('a non-English badge still reads as follows-back and never as the name', () => {
    const parsed = parseUserCell(
      firstCell(cellHtml('alice', { followsBack: true, badgeText: 'Te urmărește' })),
    );
    expect(parsed).toEqual({ handle: 'alice', displayName: 'Alice Example', followsBack: true });
  });

  test('a cell with neither an avatar testid nor a profile link is not a row', () => {
    expect(
      parseUserCell(firstCell('<div data-testid="UserCell"><div dir="ltr">…</div></div>')),
    ).toBeNull();
  });

  test('the handle falls back to the profile link when the avatar testid is gone', () => {
    expect(parseUserCell(firstCell(cellHtml('alice', { avatar: false })))?.handle).toBe('alice');
  });

  // A bio's @mentions render as profile links too, so the avatar testid has to
  // win — otherwise a re-ordered DOM would file the wrong person.
  test('a bio mention never wins the handle', () => {
    const html = `
      <button data-testid="UserCell">
        <div data-testid="UserAvatar-Container-alice"></div>
        <div><div dir="ltr"><span>Alice Example</span></div></div>
        <div><div dir="ltr"><span>@alice</span></div></div>
        <div dir="auto">building with <a href="/bob">@bob</a></div>
      </button>`;
    expect(parseUserCell(firstCell(html))?.handle).toBe('alice');
  });

  test('the handle is lowercased — the ledger keys on it', () => {
    expect(parseUserCell(firstCell(cellHtml('AliceExample')))?.handle).toBe('aliceexample');
  });

  test('the bio is not mistaken for the display name', () => {
    expect(parseUserCell(firstCell(cellHtml('alice', { bio: 'ships things' })))?.displayName).toBe(
      'Alice Example',
    );
  });

  // A missing name is unknown, never invented (§7.11) — and it must not cost the
  // row, since a dropped handle reads as "unfollowed" to a complete run.
  test('a nameless cell still yields the handle', () => {
    const html = `
      <div data-testid="UserCell">
        <div data-testid="UserAvatar-Container-alice"></div>
        <div><div dir="ltr"><span>@alice</span></div></div>
      </div>`;
    expect(parseUserCell(firstCell(html))).toEqual({
      handle: 'alice',
      displayName: null,
      followsBack: false,
    });
  });
});

describe('handleFromAvatarTestid', () => {
  test('reads and lowercases the suffix', () => {
    expect(handleFromAvatarTestid('UserAvatar-Container-Narcis')).toBe('narcis');
  });

  test('rejects anything that is not a handle-shaped suffix', () => {
    expect(handleFromAvatarTestid('UserAvatar-Container-')).toBeNull();
    expect(handleFromAvatarTestid('UserAvatar-Container-unknown-user')).toBeNull();
    expect(handleFromAvatarTestid('UserAvatar-Container-sixteencharacter')).toBeNull();
    expect(handleFromAvatarTestid('SomethingElse-alice')).toBeNull();
    expect(handleFromAvatarTestid(null)).toBeNull();
    expect(handleFromAvatarTestid(undefined)).toBeNull();
  });
});
