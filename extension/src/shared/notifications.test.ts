// NT.1 notification-cell parser over fixture HTML (happy-dom) — the structural
// skeleton X renders on /notifications: a leading glyph, an avatar row, the
// header line, and (for like/repost) the quoted post text.
//
// The icon `d` prefixes are unverified against the live DOM, so the fixtures
// build their glyphs FROM the exported constants: the tests lock the matching
// mechanism, and correcting a prefix after NT.5's browser walk needs no test
// edit.

import { describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import {
  FOLLOW_ICON_PREFIXES,
  LIKE_ICON_PREFIXES,
  REPOST_ICON_PREFIXES,
  parseNotificationCell,
} from './notifications.ts';

const LIKE_ICON = `${LIKE_ICON_PREFIXES[0]}c-1.222-.06-2.679.51-3.89 2.16z`;
const REPOST_ICON = `${REPOST_ICON_PREFIXES[0]}l4.432 4.14-1.364 1.46z`;
const FOLLOW_ICON = `${FOLLOW_ICON_PREFIXES[0]}c1.355 0 2.872-.15 3.84-1.256z`;

function cell(opts: {
  icon?: string;
  header: string;
  handles?: string[];
  target?: string;
  extraAuto?: string;
}): string {
  const avatars = (opts.handles ?? [])
    .map((h) => `<div data-testid="UserAvatar-Container-${h}"><img alt="${h}" /></div>`)
    .join('');
  return `
    <article data-testid="notification">
      ${opts.icon ? `<svg viewBox="0 0 24 24"><path d="${opts.icon}"></path></svg>` : ''}
      <div>${avatars}</div>
      <div dir="ltr">${opts.header}</div>
      ${opts.target ? `<div dir="auto">${opts.target}</div>` : ''}
      ${opts.extraAuto ? `<div dir="auto">${opts.extraAuto}</div>` : ''}
    </article>`;
}

function firstCell(html: string): Element {
  const window = new Window({ url: 'https://x.com/notifications' });
  window.document.body.innerHTML = html;
  const el = window.document.querySelector('article');
  if (!el) throw new Error('fixture has no article');
  return el as unknown as Element;
}

describe('parseNotificationCell', () => {
  test('single-liker cell: kind, handle, target text', () => {
    const parsed = parseNotificationCell(
      firstCell(
        cell({
          icon: LIKE_ICON,
          header: 'Alice liked your post',
          handles: ['Alice'],
          target: 'shipping is the only feedback loop that tells the truth',
        }),
      ),
    );
    expect(parsed).toEqual({
      kind: 'like',
      handles: ['alice'],
      targetText: 'shipping is the only feedback loop that tells the truth',
    });
  });

  test('aggregated cell: every avatar handle, deduped, in DOM order', () => {
    const parsed = parseNotificationCell(
      firstCell(
        cell({
          icon: LIKE_ICON,
          header: 'Alice and Bob liked your post',
          handles: ['Alice', 'bob', 'alice', 'Carol'],
          target: 'the roster grows itself',
        }),
      ),
    );
    expect(parsed?.kind).toBe('like');
    expect(parsed?.handles).toEqual(['alice', 'bob', 'carol']);
  });

  test('repost cell', () => {
    const parsed = parseNotificationCell(
      firstCell(
        cell({
          icon: REPOST_ICON,
          header: 'Dana reposted your post',
          handles: ['dana'],
          target: 'a reply is my own tweet',
        }),
      ),
    );
    expect(parsed).toEqual({
      kind: 'repost',
      handles: ['dana'],
      targetText: 'a reply is my own tweet',
    });
  });

  test('follow cell has no target text — even when a bio rides along', () => {
    const parsed = parseNotificationCell(
      firstCell(
        cell({
          icon: FOLLOW_ICON,
          header: 'Erin followed you',
          handles: ['erin'],
          extraAuto: 'building small tools in public, mostly at night',
        }),
      ),
    );
    expect(parsed).toEqual({ kind: 'follow', handles: ['erin'], targetText: null });
  });

  test('unrecognised cell parses as other', () => {
    const parsed = parseNotificationCell(
      firstCell(
        cell({
          header: 'There was a login to your account from a new device',
          handles: ['frank'],
        }),
      ),
    );
    expect(parsed?.kind).toBe('other');
  });

  test('romanian header classifies through the keyword fallback', () => {
    const like = parseNotificationCell(
      firstCell(cell({ header: 'Gabi ți-a apreciat postarea', handles: ['gabi'] })),
    );
    const repost = parseNotificationCell(
      firstCell(cell({ header: 'Horia ți-a redistribuit postarea', handles: ['horia'] })),
    );
    const follow = parseNotificationCell(
      firstCell(cell({ header: 'Ioana a început să te urmărească', handles: ['ioana'] })),
    );
    expect([like?.kind, repost?.kind, follow?.kind]).toEqual(['like', 'repost', 'follow']);
  });

  test('icon wins over a misleading header', () => {
    const parsed = parseNotificationCell(
      firstCell(
        cell({
          icon: REPOST_ICON,
          header: 'Jo liked your post',
          handles: ['jo'],
          target: 'x',
        }),
      ),
    );
    expect(parsed?.kind).toBe('repost');
  });

  test('skeleton cell: no avatars, no target', () => {
    const parsed = parseNotificationCell(
      firstCell('<article data-testid="notification"><div></div></article>'),
    );
    expect(parsed).toEqual({ kind: 'other', handles: [], targetText: null });
  });

  test('unresolved avatar placeholders are skipped', () => {
    const parsed = parseNotificationCell(
      firstCell(
        cell({
          icon: LIKE_ICON,
          header: 'Someone liked your post',
          handles: ['unknown', 'kim', 'a-bad-handle'],
          target: 'text',
        }),
      ),
    );
    expect(parsed?.handles).toEqual(['kim']);
  });

  test('trailing ellipsis is stripped from the target text', () => {
    const unicode = parseNotificationCell(
      firstCell(
        cell({ icon: LIKE_ICON, header: 'Lee liked your post', target: 'the first 30 minutes…' }),
      ),
    );
    const ascii = parseNotificationCell(
      firstCell(
        cell({ icon: LIKE_ICON, header: 'Lee liked your post', target: 'the first 30 minutes...' }),
      ),
    );
    expect(unicode?.targetText).toBe('the first 30 minutes');
    expect(ascii?.targetText).toBe('the first 30 minutes');
  });

  test('the longest non-header block wins as target text', () => {
    const parsed = parseNotificationCell(
      firstCell(
        cell({
          icon: LIKE_ICON,
          header: 'Mo liked your post',
          target: 'short',
          extraAuto: 'a considerably longer quoted post body',
        }),
      ),
    );
    expect(parsed?.targetText).toBe('a considerably longer quoted post body');
  });

  test('a non-notification element parses as null', () => {
    const window = new Window({ url: 'https://x.com/notifications' });
    window.document.body.innerHTML = '<article data-testid="tweet"><div>hi</div></article>';
    const el = window.document.querySelector('article') as unknown as Element;
    expect(parseNotificationCell(el)).toBeNull();
  });
});
