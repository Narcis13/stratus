// The Studio (SURFACES S3.3): template picker → live preview → Copy PNG /
// Download. The preview IS the artifact — every field edit re-renders the
// exact pixels that will be exported, because the engine is deterministic.
// Export ends in a human paste: /2/media/upload still needs OAuth 1.0a, so
// stratus never attaches images via the API. $0 throughout.

import { type ChangeEvent, type JSX, useCallback, useEffect, useRef, useState } from 'react';
import {
  type BrandKit,
  DEFAULT_BRAND_KIT,
  loadBrandKit,
  parseBrandKit,
  saveBrandKit,
} from '../studio/brandKit.ts';
import { render } from '../studio/compose.ts';
import { ensureStudioFonts } from '../studio/fonts.ts';
import {
  BANNER,
  PFP_FRAME,
  QUOTE_CARD,
  STAT_CARD,
  type StatCardData,
  bannerSpec,
  pfpFrameSpec,
  quoteCardSpec,
  statCardSpec,
} from '../studio/templates.ts';
import { ApiError, api } from './api.ts';
import type { Settings } from './storage.ts';

/** Seed handed over from the Composer's "Make visual" or a leader's re-up. */
export interface StudioSeed {
  text: string;
  /** Calendar row the visual belongs to — enables the media_note stamp. */
  postId?: string;
}

type TemplateId = 'quote' | 'stat' | 'banner' | 'pfp';

const TEMPLATES: Array<{ id: TemplateId; label: string; size: string }> = [
  { id: 'quote', label: 'Quote card', size: `${QUOTE_CARD.w}×${QUOTE_CARD.h}` },
  { id: 'stat', label: 'Stat card', size: `${STAT_CARD.w}×${STAT_CARD.h}` },
  { id: 'banner', label: 'Banner', size: `${BANNER.w}×${BANNER.h}` },
  { id: 'pfp', label: 'Profile pic', size: `${PFP_FRAME.w}×${PFP_FRAME.h}` },
];

const EMPTY_STAT: StatCardData = {
  followers: null,
  delta: null,
  sparkline: [],
  weekLabel: '',
  posts: null,
  replies: null,
  topPostText: null,
  topPostViews: null,
  streakDays: null,
};

// <input type="color"> only speaks #rrggbb.
function toColorInput(hex: string): string {
  const m = /^#([0-9a-f]{3})$/i.exec(hex);
  if (!m) return hex;
  const s = m[1] as string;
  return `#${s.replace(/./g, (c) => c + c)}`;
}

interface Props {
  settings: Settings;
  seed: StudioSeed | null;
  onClearSeed: () => void;
}

export function StudioPanel({ settings, seed, onClearSeed }: Props): JSX.Element {
  const [kit, setKit] = useState<BrandKit | null>(null);
  const [kitOpen, setKitOpen] = useState(false);
  const [template, setTemplate] = useState<TemplateId>('quote');

  const [quoteText, setQuoteText] = useState('');
  const [seedPostId, setSeedPostId] = useState<string | null>(null);
  const [stamped, setStamped] = useState(false);

  const [statData, setStatData] = useState<StatCardData | null>(null);
  const [statLoading, setStatLoading] = useState(false);

  const [bannerHeadline, setBannerHeadline] = useState('');
  const [bannerKeywords, setBannerKeywords] = useState('');
  const [bannerFollowers, setBannerFollowers] = useState<number | null>(null);
  const [bannerMilestone, setBannerMilestone] = useState(true);
  const bannerSeeded = useRef(false);

  const [pfpBitmap, setPfpBitmap] = useState<ImageBitmap | null>(null);

  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [rendering, setRendering] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const lastBlob = useRef<Blob | null>(null);
  const renderToken = useRef(0);

  useEffect(() => {
    void loadBrandKit().then(setKit);
  }, []);

  // Seed from Composer / re-up: quote card, text prefilled, stamp target kept.
  useEffect(() => {
    if (!seed) return;
    setTemplate('quote');
    setQuoteText(seed.text);
    setSeedPostId(seed.postId ?? null);
    setStamped(false);
    onClearSeed();
  }, [seed, onClearSeed]);

  // Stat card data: brief (sparkline, live followers, streak) + the week's
  // digest FACTS — factsOnly, so this read can never trigger Grok narration.
  const loadStatData = useCallback(async () => {
    setStatLoading(true);
    setError(null);
    try {
      const [brief, digest] = await Promise.all([
        api.brief(settings),
        api.digest(settings, { factsOnly: true }),
      ]);
      const facts = digest.facts;
      const top = facts.topTweets.find((t) => !t.isReply) ?? facts.topTweets[0] ?? null;
      setStatData({
        followers: brief.account.followers,
        delta: facts.followers.delta,
        sparkline: brief.account.sparkline.map((p) => p.followers),
        weekLabel: `week of ${facts.weekKey}`,
        posts: facts.activity.posts,
        replies: facts.activity.replies,
        topPostText: top ? top.text : null,
        topPostViews: top ? top.views : null,
        streakDays: brief.quests.streak.current > 0 ? brief.quests.streak.current : null,
      });
    } catch (e) {
      setError(e instanceof ApiError ? `Week data failed: ${e.message}` : 'Week data failed');
      setStatData(EMPTY_STAT);
    } finally {
      setStatLoading(false);
    }
  }, [settings]);

  // Banner: pillar labels feed the keyword strip, brief feeds the milestone.
  const loadBannerData = useCallback(async () => {
    try {
      const [pillars, brief] = await Promise.all([
        api.pillars.list(settings, { active: true }),
        api.brief(settings),
      ]);
      setBannerFollowers(brief.account.followers);
      setBannerKeywords((prev) => (prev !== '' ? prev : pillars.map((p) => p.label).join(', ')));
    } catch {
      // Banner still renders from typed fields.
    }
  }, [settings]);

  useEffect(() => {
    if (template === 'stat' && statData === null && !statLoading) void loadStatData();
    if (template === 'banner' && !bannerSeeded.current) {
      bannerSeeded.current = true;
      void loadBannerData();
    }
  }, [template, statData, statLoading, loadStatData, loadBannerData]);

  // The live preview: debounce edits, render, drop stale results.
  useEffect(() => {
    if (!kit) return;
    const token = ++renderToken.current;
    const timer = setTimeout(async () => {
      setRendering(true);
      try {
        await ensureStudioFonts();
        const spec =
          template === 'quote'
            ? quoteCardSpec({ text: quoteText.trim() || 'Your words, pixel-crisp.' }, kit)
            : template === 'stat'
              ? statCardSpec(statData ?? EMPTY_STAT, kit)
              : template === 'banner'
                ? bannerSpec(
                    {
                      headline: bannerHeadline.trim() || 'Building in public',
                      keywords: bannerKeywords
                        .split(',')
                        .map((k) => k.trim())
                        .filter((k) => k !== ''),
                      followers: bannerMilestone ? bannerFollowers : null,
                    },
                    kit,
                  )
                : pfpFrameSpec({ photo: pfpBitmap, initial: kit.handle }, kit);
        // A document canvas (not OffscreenCanvas) so the loaded FontFaces are
        // guaranteed visible to measureText/fillText.
        const blob = await render(spec, document.createElement('canvas'));
        if (token !== renderToken.current) return;
        lastBlob.current = blob;
        setPreviewUrl((prev) => {
          if (prev) URL.revokeObjectURL(prev);
          return URL.createObjectURL(blob);
        });
        setError(null);
      } catch {
        if (token === renderToken.current) setError('Render failed');
      } finally {
        if (token === renderToken.current) setRendering(false);
      }
    }, 150);
    return () => clearTimeout(timer);
  }, [
    kit,
    template,
    quoteText,
    statData,
    bannerHeadline,
    bannerKeywords,
    bannerFollowers,
    bannerMilestone,
    pfpBitmap,
  ]);

  useEffect(
    () => () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    },
    [previewUrl],
  );

  const patchKit = (partial: Partial<BrandKit>): void => {
    setKit((prev) => {
      if (!prev) return prev;
      const next = { ...prev, ...partial };
      void saveBrandKit(next);
      return next;
    });
  };

  const copyPng = async (): Promise<void> => {
    const blob = lastBlob.current;
    if (!blob) return;
    setNotice(null);
    setError(null);
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      setNotice('PNG copied — paste it straight into the X composer.');
    } catch {
      setError('Clipboard refused the image — use Download instead.');
    }
  };

  const download = (): void => {
    const blob = lastBlob.current;
    if (!blob) return;
    const t = TEMPLATES.find((x) => x.id === template);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `stratus-${template}-${t?.size ?? ''}.png`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  // S3.4: stamp the "visual made" marker so Calendar/Today remind at publish
  // time that this slot ships manually with its image.
  const stampVisualMade = async (): Promise<void> => {
    if (!seedPostId) return;
    setError(null);
    try {
      const label = TEMPLATES.find((x) => x.id === template)?.label ?? 'visual';
      await api.update(settings, seedPostId, { mediaNote: `${label} made in Studio` });
      setStamped(true);
      setNotice('Post marked — it renders an amber "post manually" chip now.');
    } catch (e) {
      setError(e instanceof ApiError ? `Stamp failed: ${e.message}` : 'Stamp failed');
    }
  };

  const exportKit = (): void => {
    if (!kit) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(
      new Blob([JSON.stringify(kit, null, 2)], { type: 'application/json' }),
    );
    a.download = 'stratus-brand-kit.json';
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const importKit = async (e: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const parsed = parseBrandKit(await file.text());
    if (!parsed) {
      setError('Not a brand kit JSON.');
      return;
    }
    setKit(parsed);
    await saveBrandKit(parsed);
    setNotice('Brand kit imported.');
  };

  const onPickPhoto = async (e: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      setPfpBitmap(await createImageBitmap(file));
    } catch {
      setError('Could not read that image.');
    }
  };

  if (!kit) return <div className="panel muted">Loading…</div>;

  return (
    <div className="panel">
      <div className="panel-header">
        <h2>Studio</h2>
        <button type="button" onClick={() => setKitOpen((o) => !o)}>
          {kitOpen ? 'Close brand kit' : 'Brand kit'}
        </button>
      </div>

      {kitOpen && (
        <section className="studio-kit">
          <div className="studio-kit-row">
            <label className="studio-color">
              <span>Background</span>
              <input
                type="color"
                value={toColorInput(kit.bg)}
                onChange={(e) => patchKit({ bg: e.target.value })}
              />
            </label>
            <label className="studio-color">
              <span>Accent</span>
              <input
                type="color"
                value={toColorInput(kit.accent)}
                onChange={(e) => patchKit({ accent: e.target.value })}
              />
            </label>
          </div>
          <label className="field">
            <span>Handle (no @)</span>
            <input
              type="text"
              value={kit.handle}
              onChange={(e) => patchKit({ handle: e.target.value.replace(/^@+/, '') })}
              placeholder="yourhandle"
            />
          </label>
          <div className="studio-kit-row">
            <label className="row studio-check">
              <input
                type="checkbox"
                checked={kit.watermark}
                onChange={(e) => patchKit({ watermark: e.target.checked })}
              />
              <span>Watermark</span>
            </label>
            <input
              type="text"
              value={kit.watermarkText}
              onChange={(e) => patchKit({ watermarkText: e.target.value })}
              disabled={!kit.watermark}
            />
          </div>
          <div className="row studio-kit-actions">
            <button type="button" onClick={exportKit}>
              Export JSON
            </button>
            <label className="studio-import">
              Import
              <input type="file" accept="application/json" onChange={(e) => void importKit(e)} />
            </label>
            <button
              type="button"
              onClick={() => {
                setKit({ ...DEFAULT_BRAND_KIT });
                void saveBrandKit({ ...DEFAULT_BRAND_KIT });
              }}
            >
              Reset
            </button>
          </div>
        </section>
      )}

      <div className="studio-templates">
        {TEMPLATES.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`studio-template${template === t.id ? ' studio-template-active' : ''}`}
            onClick={() => setTemplate(t.id)}
          >
            <span>{t.label}</span>
            <span className="muted">{t.size}</span>
          </button>
        ))}
      </div>

      {template === 'quote' && (
        <label className="field">
          <span>Quote text</span>
          <textarea
            value={quoteText}
            onChange={(e) => setQuoteText(e.target.value)}
            rows={4}
            placeholder="Paste the draft or line worth framing…"
          />
        </label>
      )}

      {template === 'stat' && (
        <div className="row studio-data-row">
          <span className="muted">
            {statLoading
              ? 'Reading the week…'
              : statData
                ? `Live data: ${statData.weekLabel}`
                : 'No data yet'}
          </span>
          <button type="button" onClick={() => void loadStatData()} disabled={statLoading}>
            Reload
          </button>
        </div>
      )}

      {template === 'banner' && (
        <>
          <label className="field">
            <span>Headline</span>
            <input
              type="text"
              value={bannerHeadline}
              onChange={(e) => setBannerHeadline(e.target.value)}
              placeholder="Building in public"
            />
          </label>
          <label className="field">
            <span>Keywords (comma-separated — prefilled from your pillars)</span>
            <input
              type="text"
              value={bannerKeywords}
              onChange={(e) => setBannerKeywords(e.target.value)}
            />
          </label>
          <label className="row studio-check">
            <input
              type="checkbox"
              checked={bannerMilestone}
              onChange={(e) => setBannerMilestone(e.target.checked)}
            />
            <span>
              Show follower milestone
              {bannerFollowers !== null ? ` (${bannerFollowers})` : ' (no snapshot yet)'}
            </span>
          </label>
        </>
      )}

      {template === 'pfp' && (
        <label className="field">
          <span>Photo (circle-cropped in your brand ring)</span>
          <input type="file" accept="image/*" onChange={(e) => void onPickPhoto(e)} />
        </label>
      )}

      <div className="studio-preview">
        {previewUrl ? (
          <img src={previewUrl} alt={`${template} preview`} />
        ) : (
          <div className="muted">{rendering ? 'Rendering…' : 'Preview appears here.'}</div>
        )}
      </div>

      {error && <div className="error">{error}</div>}
      {notice && <div className="ok">{notice}</div>}

      <div className="row">
        <button
          type="button"
          className="primary"
          onClick={() => void copyPng()}
          disabled={!lastBlob.current}
          title="Copies the PNG — paste it directly into X's composer"
        >
          Copy PNG
        </button>
        <button type="button" onClick={download} disabled={!lastBlob.current}>
          Download
        </button>
        {seedPostId && (
          <button
            type="button"
            onClick={() => void stampVisualMade()}
            disabled={stamped}
            title="Stamps media_note on the calendar row — the publisher can't attach images (OAuth 1.0a), so the row reminds you to post manually"
          >
            {stamped ? 'Marked ✓' : 'Mark "visual made"'}
          </button>
        )}
      </div>
      <small className="muted">
        X can't receive images via the stratus API (OAuth 1.0a wall) — Copy, open the X composer,
        paste. Under 30 seconds, every time.
      </small>
    </div>
  );
}
