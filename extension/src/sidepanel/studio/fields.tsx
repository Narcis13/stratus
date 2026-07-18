// Per-template field sections (SURFACES S5.2): dumb, props-driven components
// extracted verbatim from Studio.tsx. The shell owns all state, loading, and
// handlers; these only render inputs and relay changes. BackgroundFields and
// LibraryRail are the presentational halves of the shell-owned AI-background
// and asset-library machinery.

import type { ChangeEvent, JSX } from 'react';
import type { StatCardData } from '../../studio/templates.ts';
import type { ContentPillar, MediaAsset } from '../api.ts';

export function QuoteFields({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}): JSX.Element {
  return (
    <label className="field">
      <span>Quote text</span>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={4}
        placeholder="Paste the draft or line worth framing…"
      />
    </label>
  );
}

export function StatFields({
  loading,
  data,
  onReload,
}: {
  loading: boolean;
  data: StatCardData | null;
  onReload: () => void;
}): JSX.Element {
  return (
    <div className="row studio-data-row">
      <span className="muted">
        {loading ? 'Reading the week…' : data ? `Live data: ${data.weekLabel}` : 'No data yet'}
      </span>
      <button type="button" onClick={onReload} disabled={loading}>
        Reload
      </button>
    </div>
  );
}

// S5.5 celebration cards: an auto-detected status line + a manual number
// override (blank = use the detected value). The shell owns the loading and the
// override→data resolution; these only render the input and status.
export function MilestoneFields({
  loading,
  statusLabel,
  override,
  onOverride,
  onReload,
}: {
  loading: boolean;
  statusLabel: string;
  override: number | null;
  onOverride: (v: number | null) => void;
  onReload: () => void;
}): JSX.Element {
  return (
    <>
      <div className="row studio-data-row">
        <span className="muted">{loading ? 'Reading your account…' : statusLabel}</span>
        <button type="button" onClick={onReload} disabled={loading}>
          Reload
        </button>
      </div>
      <label className="field">
        <span>Override number (blank = auto-detected)</span>
        <input
          type="number"
          value={override ?? ''}
          onChange={(e) => onOverride(e.target.value === '' ? null : Number(e.target.value))}
          placeholder="e.g. 1000"
        />
      </label>
    </>
  );
}

export function StreakFields({
  loading,
  statusLabel,
  override,
  onOverride,
  onReload,
}: {
  loading: boolean;
  statusLabel: string;
  override: number | null;
  onOverride: (v: number | null) => void;
  onReload: () => void;
}): JSX.Element {
  return (
    <>
      <div className="row studio-data-row">
        <span className="muted">{loading ? 'Reading your streak…' : statusLabel}</span>
        <button type="button" onClick={onReload} disabled={loading}>
          Reload
        </button>
      </div>
      <label className="field">
        <span>Override days (blank = your live streak)</span>
        <input
          type="number"
          value={override ?? ''}
          onChange={(e) => onOverride(e.target.value === '' ? null : Number(e.target.value))}
          placeholder="e.g. 7"
        />
      </label>
    </>
  );
}

export function CodeFields({
  title,
  code,
  onTitle,
  onCode,
}: {
  title: string;
  code: string;
  onTitle: (v: string) => void;
  onCode: (v: string) => void;
}): JSX.Element {
  return (
    <>
      <label className="field">
        <span>Filename</span>
        <input
          type="text"
          value={title}
          onChange={(e) => onTitle(e.target.value)}
          placeholder="snippet.ts"
        />
      </label>
      <label className="field">
        <span>Code (≤18 lines · ≤62 cols — longer is trimmed)</span>
        <textarea
          value={code}
          onChange={(e) => onCode(e.target.value)}
          rows={8}
          spellCheck={false}
          placeholder="Paste a snippet — blank shows a sample…"
        />
      </label>
    </>
  );
}

// S5.7 thread cover: the head-tweet hook + the thread length driving the "1/N"
// badge. The Composer's thread-mode "Make visual" seeds the hook.
export function ThreadFields({
  hook,
  count,
  onHook,
  onCount,
}: {
  hook: string;
  count: number;
  onHook: (v: string) => void;
  onCount: (v: number) => void;
}): JSX.Element {
  return (
    <>
      <label className="field">
        <span>Hook (the first tweet — what stops the scroll)</span>
        <textarea
          value={hook}
          onChange={(e) => onHook(e.target.value)}
          rows={3}
          placeholder="The one thing nobody tells you about…"
        />
      </label>
      <label className="field">
        <span>Thread length (the "1/N" badge)</span>
        <input
          type="number"
          min={1}
          value={count}
          onChange={(e) => onCount(Math.max(1, Number(e.target.value) || 1))}
        />
      </label>
    </>
  );
}

// S5.7 list card: a title + one item per line. parseListItems strips markers,
// drops blanks and caps at 6, so the hint says "showing first 6".
export function ListFields({
  title,
  items,
  onTitle,
  onItems,
}: {
  title: string;
  items: string;
  onTitle: (v: string) => void;
  onItems: (v: string) => void;
}): JSX.Element {
  return (
    <>
      <label className="field">
        <span>Title</span>
        <input
          type="text"
          value={title}
          onChange={(e) => onTitle(e.target.value)}
          placeholder="5 lessons from building in public"
        />
      </label>
      <label className="field">
        <span>Items (one per line · showing first 6)</span>
        <textarea
          value={items}
          onChange={(e) => onItems(e.target.value)}
          rows={7}
          placeholder={'Ship every day\nReply more than you post\n…'}
        />
      </label>
    </>
  );
}

export function BannerFields({
  headline,
  keywords,
  milestone,
  followers,
  onHeadline,
  onKeywords,
  onMilestone,
}: {
  headline: string;
  keywords: string;
  milestone: boolean;
  followers: number | null;
  onHeadline: (v: string) => void;
  onKeywords: (v: string) => void;
  onMilestone: (v: boolean) => void;
}): JSX.Element {
  return (
    <>
      <label className="field">
        <span>Headline</span>
        <input
          type="text"
          value={headline}
          onChange={(e) => onHeadline(e.target.value)}
          placeholder="Building in public"
        />
      </label>
      <label className="field">
        <span>Keywords (comma-separated — prefilled from your pillars)</span>
        <input type="text" value={keywords} onChange={(e) => onKeywords(e.target.value)} />
      </label>
      <label className="row studio-check">
        <input
          type="checkbox"
          checked={milestone}
          onChange={(e) => onMilestone(e.target.checked)}
        />
        <span>
          Show follower milestone
          {followers !== null ? ` (${followers})` : ' (no snapshot yet)'}
        </span>
      </label>
    </>
  );
}

export function PfpFields({
  onPickPhoto,
}: {
  onPickPhoto: (e: ChangeEvent<HTMLInputElement>) => void;
}): JSX.Element {
  return (
    <label className="field">
      <span>Photo (circle-cropped in your brand ring)</span>
      <input type="file" accept="image/*" onChange={onPickPhoto} />
    </label>
  );
}

export function BackgroundFields({
  hasBackground,
  pillars,
  pillarSlug,
  prompt,
  loading,
  cost,
  onClear,
  onReseed,
  onPromptChange,
  onGenerate,
}: {
  hasBackground: boolean;
  pillars: ContentPillar[];
  pillarSlug: string;
  prompt: string;
  loading: boolean;
  cost: number | null;
  onClear: () => void;
  onReseed: (slug: string) => void;
  onPromptChange: (v: string) => void;
  onGenerate: () => void;
}): JSX.Element {
  return (
    <section className="studio-bg">
      <div className="row studio-data-row">
        <span className="muted">AI background (composited under your text)</span>
        {hasBackground && (
          <button type="button" onClick={onClear}>
            Remove background
          </button>
        )}
      </div>
      {pillars.length > 0 && (
        <label className="field">
          <span>Seed from pillar</span>
          <select value={pillarSlug} onChange={(e) => onReseed(e.target.value)}>
            {pillars.map((p) => (
              <option key={p.slug} value={p.slug}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
      )}
      <label className="field">
        <span>Prompt (style suffix from your brand kit; the "no text" clause is load-bearing)</span>
        <textarea value={prompt} onChange={(e) => onPromptChange(e.target.value)} rows={3} />
      </label>
      <div className="row">
        <button type="button" onClick={onGenerate} disabled={loading}>
          {loading ? 'Generating…' : 'Generate background (~$0.02)'}
        </button>
        {cost !== null && <span className="muted">last: ${cost.toFixed(3)}</span>}
      </div>
    </section>
  );
}

export function LibraryRail({
  library,
  onRefresh,
  onReopen,
  onDelete,
}: {
  library: MediaAsset[];
  onRefresh: () => void;
  onReopen: (asset: MediaAsset) => void;
  onDelete: (id: string) => void;
}): JSX.Element {
  return (
    <section className="studio-library">
      <div className="panel-header">
        <h3>Library</h3>
        <button type="button" onClick={onRefresh}>
          Refresh
        </button>
      </div>
      <div className="studio-library-rail">
        {library.map((a) => (
          <div key={a.id} className="studio-asset">
            <button
              type="button"
              className="studio-asset-open"
              onClick={() => onReopen(a)}
              title={a.prompt ?? a.kind}
            >
              <span className="studio-asset-kind">{a.kind}</span>
              <span className="muted">{a.width && a.height ? `${a.width}×${a.height}` : ''}</span>
            </button>
            <button
              type="button"
              className="studio-asset-del"
              onClick={() => onDelete(a.id)}
              title="Delete asset"
            >
              ✕
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}
