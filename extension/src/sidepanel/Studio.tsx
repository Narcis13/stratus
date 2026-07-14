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
import { ApiError, type ContentPillar, type MediaAsset, api } from './api.ts';
import type { Settings } from './storage.ts';

/** ImageBitmap from a data: URL — same-origin, so it never taints the canvas
 *  (the whole point of the server returning base64 instead of an xAI URL). */
async function bitmapFromDataUrl(dataUrl: string): Promise<ImageBitmap> {
  const blob = await (await fetch(dataUrl)).blob();
  return createImageBitmap(blob);
}

async function blobToBase64(blob: Blob): Promise<string> {
  const buf = new Uint8Array(await blob.arrayBuffer());
  let bin = '';
  for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i] as number);
  return btoa(bin);
}

/** Prompt seeding, not writing (§S4): pillar subject + the kit's fixed style
 *  suffix. The "no text" clause in the suffix is load-bearing. */
function seedImagePrompt(pillarLabel: string | null, styleSuffix: string): string {
  const subject =
    pillarLabel && pillarLabel.trim() !== '' ? pillarLabel.trim() : 'abstract concept';
  return `${subject}. ${styleSuffix}`;
}

/** Templates that composite an AI background under their text. */
const BG_TEMPLATES = new Set<TemplateId>(['quote', 'banner']);

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

  // S4: AI background composited under the quote/banner text.
  const [bgBitmap, setBgBitmap] = useState<ImageBitmap | null>(null);
  const [bgPrompt, setBgPrompt] = useState('');
  const [pillars, setPillars] = useState<ContentPillar[]>([]);
  const [pillarSlug, setPillarSlug] = useState('');
  const [genLoading, setGenLoading] = useState(false);
  const [genCost, setGenCost] = useState<number | null>(null);
  const bgPromptSeeded = useRef(false);

  // S4: the asset library history rail.
  const [library, setLibrary] = useState<MediaAsset[]>([]);
  const [savingAsset, setSavingAsset] = useState(false);

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

  // S4: history rail — metadata only ($0 read), refreshed after save/delete.
  const loadLibrary = useCallback(async () => {
    try {
      setLibrary(await api.assets.list(settings));
    } catch {
      // The rest of the Studio works without the library.
    }
  }, [settings]);

  // Seed the AI-background prompt from the first active pillar + the kit's fixed
  // style suffix, and load the library — once, when a background-capable
  // template first comes into view.
  useEffect(() => {
    if (!kit || !BG_TEMPLATES.has(template) || bgPromptSeeded.current) return;
    bgPromptSeeded.current = true;
    void (async () => {
      try {
        const ps = await api.pillars.list(settings, { active: true });
        setPillars(ps);
        setPillarSlug(ps[0]?.slug ?? '');
        setBgPrompt(seedImagePrompt(ps[0]?.label ?? null, kit.imageStyleSuffix));
      } catch {
        setBgPrompt(seedImagePrompt(null, kit.imageStyleSuffix));
      }
      void loadLibrary();
    })();
  }, [kit, template, settings, loadLibrary]);

  const reseedPrompt = (slug: string): void => {
    setPillarSlug(slug);
    if (kit)
      setBgPrompt(
        seedImagePrompt(pillars.find((p) => p.slug === slug)?.label ?? null, kit.imageStyleSuffix),
      );
  };

  const generateBackground = async (): Promise<void> => {
    const prompt = bgPrompt.trim();
    if (prompt === '') {
      setError('Add a prompt first.');
      return;
    }
    setGenLoading(true);
    setError(null);
    setNotice(null);
    try {
      const res = await api.images.generate(settings, { prompt, n: 1 });
      const first = res.images[0];
      if (!first) {
        setError('No image returned.');
        return;
      }
      setBgBitmap(await bitmapFromDataUrl(first.dataUrl));
      setGenCost(res.costUsd);
      setNotice(`Background generated — $${res.costUsd.toFixed(3)}. Composited under your text.`);
    } catch (e) {
      const code = e instanceof ApiError ? e.code : '';
      setError(
        code === 'image_budget_exceeded'
          ? "Daily image budget reached — a paint session can't melt the wallet. Try tomorrow."
          : code === 'grok_not_configured'
            ? 'Set XAI_API_KEY on the server to generate images.'
            : e instanceof ApiError
              ? `Generate failed: ${e.code}`
              : 'Generate failed',
      );
    } finally {
      setGenLoading(false);
    }
  };

  const clearBackground = (): void => {
    setBgBitmap(null);
    setGenCost(null);
  };

  const saveToLibrary = async (): Promise<void> => {
    const blob = lastBlob.current;
    if (!blob) return;
    setSavingAsset(true);
    setError(null);
    setNotice(null);
    try {
      const pngBase64 = await blobToBase64(blob);
      const t = TEMPLATES.find((x) => x.id === template);
      const [w, h] = (t?.size ?? '').split('×').map((n) => Number.parseInt(n, 10));
      await api.assets.save(settings, {
        pngBase64,
        kind: template,
        ...(bgBitmap && bgPrompt.trim() !== '' ? { prompt: bgPrompt.trim() } : {}),
        ...(Number.isFinite(w) ? { width: w } : {}),
        ...(Number.isFinite(h) ? { height: h } : {}),
      });
      setNotice('Saved to your asset library.');
      await loadLibrary();
    } catch (e) {
      setError(e instanceof ApiError ? `Save failed: ${e.code}` : 'Save failed');
    } finally {
      setSavingAsset(false);
    }
  };

  const reopenAsset = async (asset: MediaAsset): Promise<void> => {
    setError(null);
    setNotice(null);
    try {
      const { base64, mediaType } = await api.assets.png(settings, asset.id);
      const bmp = await bitmapFromDataUrl(`data:${mediaType};base64,${base64}`);
      if (!BG_TEMPLATES.has(template)) setTemplate('quote');
      setBgBitmap(bmp);
      if (asset.prompt) setBgPrompt(asset.prompt);
      setNotice('Re-opened as the background layer — add your text on top.');
    } catch (e) {
      setError(e instanceof ApiError ? `Open failed: ${e.code}` : 'Open failed');
    }
  };

  const deleteAsset = async (id: string): Promise<void> => {
    try {
      await api.assets.remove(settings, id);
      await loadLibrary();
    } catch (e) {
      setError(e instanceof ApiError ? `Delete failed: ${e.code}` : 'Delete failed');
    }
  };

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
            ? quoteCardSpec(
                { text: quoteText.trim() || 'Your words, pixel-crisp.', background: bgBitmap },
                kit,
              )
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
                      background: bgBitmap,
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
    bgBitmap,
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
          <label className="field">
            <span>AI background style suffix (the brand — keep "no text")</span>
            <textarea
              value={kit.imageStyleSuffix}
              onChange={(e) => patchKit({ imageStyleSuffix: e.target.value })}
              rows={2}
            />
          </label>
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

      {BG_TEMPLATES.has(template) && (
        <section className="studio-bg">
          <div className="row studio-data-row">
            <span className="muted">AI background (composited under your text)</span>
            {bgBitmap && (
              <button type="button" onClick={clearBackground}>
                Remove background
              </button>
            )}
          </div>
          {pillars.length > 0 && (
            <label className="field">
              <span>Seed from pillar</span>
              <select value={pillarSlug} onChange={(e) => reseedPrompt(e.target.value)}>
                {pillars.map((p) => (
                  <option key={p.slug} value={p.slug}>
                    {p.label}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="field">
            <span>
              Prompt (style suffix from your brand kit; the "no text" clause is load-bearing)
            </span>
            <textarea value={bgPrompt} onChange={(e) => setBgPrompt(e.target.value)} rows={3} />
          </label>
          <div className="row">
            <button type="button" onClick={() => void generateBackground()} disabled={genLoading}>
              {genLoading ? 'Generating…' : 'Generate background (~$0.02)'}
            </button>
            {genCost !== null && <span className="muted">last: ${genCost.toFixed(3)}</span>}
          </div>
        </section>
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
        <button
          type="button"
          onClick={() => void saveToLibrary()}
          disabled={!lastBlob.current || savingAsset}
          title="Store this composed PNG in your asset library — re-open it later as a base layer"
        >
          {savingAsset ? 'Saving…' : 'Save to library'}
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

      {library.length > 0 && (
        <section className="studio-library">
          <div className="panel-header">
            <h3>Library</h3>
            <button type="button" onClick={() => void loadLibrary()}>
              Refresh
            </button>
          </div>
          <div className="studio-library-rail">
            {library.map((a) => (
              <div key={a.id} className="studio-asset">
                <button
                  type="button"
                  className="studio-asset-open"
                  onClick={() => void reopenAsset(a)}
                  title={a.prompt ?? a.kind}
                >
                  <span className="studio-asset-kind">{a.kind}</span>
                  <span className="muted">
                    {a.width && a.height ? `${a.width}×${a.height}` : ''}
                  </span>
                </button>
                <button
                  type="button"
                  className="studio-asset-del"
                  onClick={() => void deleteAsset(a.id)}
                  title="Delete asset"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
