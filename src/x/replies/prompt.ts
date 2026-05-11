// Default system prompt + user-turn renderer for /x/replies/generate.
// Lives here so prompt iteration doesn't need a redeploy and tests can
// import the renderer without standing up the route.

import type { GrokMessage } from '../../grok/index.ts';

export interface PostContext {
  url: string;
  tweetId: string;
  author: string;
  handle: string;
  text: string;
  postedAt: string;
  metrics: { views: number; replies: number; reposts: number; likes: number };
  topComments: { author: string; handle: string; text: string }[];
}

export const DEFAULT_SYSTEM_PROMPT = `You are drafting a single reply tweet on X. Hard constraints:
- ≤ 270 characters (leave room for typos and "Reply" prefix).
- One self-contained idea. No threads, no numbered lists.
- Don't address the author by name unless it adds value.
- No hashtags unless the original used them. No emoji unless the original used them.
- Don't summarize the parent tweet back at the author.
- Match the original's tone (terse if terse, playful if playful).
- Output the reply text only — no preamble, no quotation marks.`;

const MAX_TOP_COMMENTS = 10;

export function buildGrokInput(ctx: PostContext, override?: string): GrokMessage[] {
  const system = override && override.trim().length > 0 ? override : DEFAULT_SYSTEM_PROMPT;
  return [
    { role: 'system', content: system },
    { role: 'user', content: renderUserTurn(ctx) },
  ];
}

function renderUserTurn(ctx: PostContext): string {
  const handle = stripAt(ctx.handle);
  const relative = relativeTime(ctx.postedAt);
  const m = ctx.metrics;
  const lines: string[] = [
    'ORIGINAL TWEET',
    `@${handle} (${ctx.author}, ${relative}):`,
    ctx.text,
    '',
    'ENGAGEMENT',
    `likes=${m.likes} reposts=${m.reposts} replies=${m.replies} views=${m.views}`,
  ];

  if (ctx.topComments.length > 0) {
    const limited = ctx.topComments.slice(0, MAX_TOP_COMMENTS);
    lines.push('', `TOP REPLIES (oldest first, up to ${MAX_TOP_COMMENTS})`);
    limited.forEach((c, i) => {
      lines.push(`${i + 1}. @${stripAt(c.handle)}: ${c.text}`);
    });
  }

  return lines.join('\n');
}

function stripAt(handle: string): string {
  return handle.replace(/^@/, '');
}

function relativeTime(postedAt: string): string {
  const t = new Date(postedAt).getTime();
  if (Number.isNaN(t)) return 'unknown time ago';
  const diffMs = Date.now() - t;
  if (diffMs < 60_000) return 'just now';
  const min = Math.floor(diffMs / 60_000);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day}d ago`;
  return `${Math.floor(day / 30)}mo ago`;
}
