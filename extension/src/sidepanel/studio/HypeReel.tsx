// The hype reel — a full-panel, screen-recordable animation of one of my own
// posts' metrics climbing from zero to what the $0 DOM harvest measured.
//
// It exists to be filmed: the chrome (picker, replay, close) fades out while
// the counters run and comes back when they land, so a screen capture of the
// side panel is already the clip. Nothing here renders to canvas or exports —
// the Studio's PNG pipeline is untouched; this is DOM + requestAnimationFrame.
//
// The numbers are NOT invented: every target comes from `/x/metrics/own-posts`,
// which is the harvest's own view of my originals. $0, one read per open.

import { type JSX, useCallback, useEffect, useRef, useState } from 'react';
import type { BrandKit } from '../../studio/brandKit.ts';
import { contrastOn, shade } from '../../studio/compose.ts';
import {
  DEFAULT_TIMING,
  formatHypeCount,
  hypeBars,
  hypeDone,
  hypeDurationMs,
  hypeEngagementPct,
  hypeFrame,
  hypeMetrics,
  metricProgress,
} from '../../studio/hype.ts';
import type { OwnHarvestedPost } from '../api.ts';

/** Longest tweet text the stage shows before eliding — a wall of text kills the
 *  shot, and the numbers are the point. */
const TEXT_MAX = 220;

function clampText(text: string): string {
  const t = text.trim().replace(/\s+/g, ' ');
  return t.length <= TEXT_MAX ? t : `${t.slice(0, TEXT_MAX - 1).trimEnd()}…`;
}

function postedLabel(iso: string | null): string {
  if (iso === null) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

interface Props {
  posts: OwnHarvestedPost[];
  index: number;
  kit: BrandKit;
  onIndex: (i: number) => void;
  onClose: () => void;
}

/** Fixed-length bar row under the counters — keys are precomputed so the row
 *  never keys off a map index. */
const BAR_COUNT = 14;
const BAR_KEYS = Array.from({ length: BAR_COUNT }, (_, i) => `hype-bar-${i}`);

export function HypeReel({ posts, index, kit, onIndex, onClose }: Props): JSX.Element | null {
  const post = posts[index];
  // Replay re-stamps `startedAt`, which re-arms the effect — no unmount, and
  // the ◀ ▶ picker rides on the same restart (a new post is a new `post`).
  const [startedAt, setStartedAt] = useState(() => performance.now());
  const [elapsed, setElapsed] = useState(0);
  const frameRef = useRef<number | null>(null);

  const metrics = post ? hypeMetrics(post) : [];
  const total = hypeDurationMs(metrics.length);

  useEffect(() => {
    if (!post) return;
    setElapsed(0);
    const tick = (now: number): void => {
      const e = now - startedAt;
      setElapsed(e);
      // Stop scheduling once the reel has landed — a finished reel holding a
      // rAF loop would keep the panel repainting for as long as it's open.
      if (e < total) frameRef.current = requestAnimationFrame(tick);
    };
    frameRef.current = requestAnimationFrame(tick);
    return () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    };
  }, [post, total, startedAt]);

  // Esc closes, Space replays — a recording hand shouldn't have to find a button.
  const replay = useCallback(() => setStartedAt(performance.now()), []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        replay();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, replay]);

  if (!post) return null;

  const ink = contrastOn(kit.bg);
  const cells = hypeFrame(metrics, elapsed);
  const hero = cells[0];
  const rest = cells.slice(1);
  const done = hypeDone(metrics.length, elapsed);
  const bars = hypeBars(BAR_COUNT, metricProgress(elapsed, 0, DEFAULT_TIMING)).map((h, i) => ({
    key: BAR_KEYS[i] as string,
    h,
  }));
  const engagement = hypeEngagementPct(post);
  const handle = kit.handle.trim() !== '' ? kit.handle.trim() : 'you';

  return (
    <div
      className="hype-stage"
      style={{
        // The stage follows the brand kit, not the panel theme — same rule the
        // Studio canvas plays by, so the clip matches the cards.
        background: `radial-gradient(120% 80% at 50% 0%, ${shade(kit.accent, -0.55)} 0%, ${kit.bg} 55%, ${shade(kit.bg, -0.3)} 100%)`,
        color: ink,
        fontFamily: kit.fontFamily,
      }}
    >
      <div className="hype-top">
        <span className="hype-handle" style={{ color: kit.accent }}>
          @{handle}
        </span>
        {postedLabel(post.tweetTime) !== '' && (
          <span className="hype-date">{postedLabel(post.tweetTime)}</span>
        )}
      </div>

      <p className="hype-text">{clampText(post.text)}</p>

      {hero && (
        <div className="hype-hero">
          <div
            className={`hype-hero-value${hero.progress >= 1 ? ' hype-landed' : ''}`}
            style={{ color: kit.accent, textShadow: `0 0 28px ${kit.accent}55` }}
          >
            {formatHypeCount(hero.value)}
          </div>
          <div className="hype-hero-label">{hero.label}</div>
        </div>
      )}

      <div className="hype-bars" aria-hidden="true">
        {bars.map((b) => (
          <span
            key={b.key}
            className="hype-bar"
            style={{
              height: `${Math.max(4, b.h * 100)}%`,
              background: kit.accent,
              opacity: 0.35 + b.h * 0.65,
            }}
          />
        ))}
      </div>

      <div className="hype-grid">
        {rest.map((c) => (
          <div key={c.key} className={`hype-cell${c.progress >= 1 ? ' hype-landed' : ''}`}>
            <span className="hype-cell-value">{formatHypeCount(c.value)}</span>
            <span className="hype-cell-label">{c.label}</span>
          </div>
        ))}
      </div>

      <div className={`hype-foot${done ? ' hype-foot-in' : ''}`}>
        {engagement === null ? (
          <span className="hype-rate">no view count on this capture</span>
        ) : (
          <span className="hype-rate">{engagement}% engagement</span>
        )}
        {kit.watermark && kit.watermarkText.trim() !== '' && (
          <span className="hype-mark">{kit.watermarkText}</span>
        )}
      </div>

      {/* Chrome fades out while the counters run so the capture is clean, and
          comes back the moment the reel lands. */}
      <div className={`hype-controls${done ? '' : ' hype-controls-hidden'}`}>
        <button
          type="button"
          onClick={() => onIndex(index - 1)}
          disabled={index === 0}
          title="Newer post"
        >
          ◀
        </button>
        <span className="hype-pos">
          {index + 1}/{posts.length}
        </span>
        <button
          type="button"
          onClick={() => onIndex(index + 1)}
          disabled={index >= posts.length - 1}
          title="Older post"
        >
          ▶
        </button>
        <button type="button" onClick={replay} title="Replay (Space)">
          Replay
        </button>
        <button type="button" onClick={onClose} title="Close (Esc)">
          Close
        </button>
      </div>
    </div>
  );
}
