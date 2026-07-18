// The Studio (SURFACES S3.3, refactored S5.2 into a template registry + field
// components): template picker → live preview → Copy PNG / Download. The preview
// IS the artifact — every field edit re-renders the exact pixels that will be
// exported, because the engine is deterministic. Export ends in a human paste:
// /2/media/upload still needs OAuth 1.0a, so stratus never attaches images via
// the API. $0 throughout.

import { type ChangeEvent, type JSX, useCallback, useEffect, useRef, useState } from 'react';
import {
  type BrandKit,
  type BrandKits,
  DEFAULT_BRAND_KIT,
  activeKit,
  deletePreset,
  loadBrandKits,
  patchActiveKit,
  renamePreset,
  saveBrandKits,
  savePresetAs,
  setActivePreset,
} from '../studio/brandKit.ts';
import { type PatternKind, render } from '../studio/compose.ts';
import { ensureStudioFonts } from '../studio/fonts.ts';
import type { StatCardData } from '../studio/templates.ts';
import { ApiError, type ContentPillar, type MediaAsset, api } from './api.ts';
import type { Settings } from './storage.ts';
import { KitEditor } from './studio/KitEditor.tsx';
import {
  BackgroundFields,
  BannerFields,
  LibraryRail,
  PfpFields,
  QuoteFields,
  StatFields,
} from './studio/fields.tsx';
import {
  EMPTY_STAT,
  TEMPLATES,
  type TemplateId,
  buildSpec,
  supportsAiBackground,
  templateMeta,
} from './studio/registry.ts';

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

// S5.4: the background of a background-capable template — the plain gradient, a
// deterministic $0 pattern, or the ~$0.02 AI image. Patterns and the AI bitmap
// are mutually exclusive; `bgMode` is the single source of truth (patternKind
// derives from it).
type BgMode = 'gradient' | PatternKind | 'ai';
const BG_MODES: Array<{ id: BgMode; label: string }> = [
  { id: 'gradient', label: 'Gradient' },
  { id: 'dots', label: 'Dots' },
  { id: 'grid', label: 'Grid' },
  { id: 'diagonal', label: 'Diagonal' },
  { id: 'plus', label: 'Plus' },
  { id: 'blobs', label: 'Blobs' },
  { id: 'ai', label: 'AI image' },
];

/** Seed handed over from the Composer's "Make visual" or a leader's re-up. */
export interface StudioSeed {
  text: string;
  /** Calendar row the visual belongs to — enables the media_note stamp. */
  postId?: string;
}

interface Props {
  settings: Settings;
  seed: StudioSeed | null;
  onClearSeed: () => void;
}

export function StudioPanel({ settings, seed, onClearSeed }: Props): JSX.Element {
  const [bundle, setBundle] = useState<BrandKits | null>(null);
  const kit = bundle ? activeKit(bundle) : null;
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

  // S4/S5.4: the background of a background-capable template. `bgMode` is the
  // single source of truth; the AI bitmap only applies while mode === 'ai'.
  const [bgMode, setBgMode] = useState<BgMode>('gradient');
  const [patternSeed, setPatternSeed] = useState(7);
  const patternKind: PatternKind | null = bgMode !== 'gradient' && bgMode !== 'ai' ? bgMode : null;
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
    void loadBrandKits().then(setBundle);
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
    if (!kit || !supportsAiBackground(template) || bgPromptSeeded.current) return;
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

  // Picking a pattern (or gradient) drops any AI bitmap — patterns and AI
  // backgrounds are mutually exclusive; 'ai' keeps the bitmap for regeneration.
  const chooseBgMode = (mode: BgMode): void => {
    setBgMode(mode);
    if (mode !== 'ai') clearBackground();
  };

  const saveToLibrary = async (): Promise<void> => {
    const blob = lastBlob.current;
    if (!blob) return;
    setSavingAsset(true);
    setError(null);
    setNotice(null);
    try {
      const pngBase64 = await blobToBase64(blob);
      const { w, h } = templateMeta(template).size;
      await api.assets.save(settings, {
        pngBase64,
        kind: template,
        ...(bgBitmap && bgPrompt.trim() !== '' ? { prompt: bgPrompt.trim() } : {}),
        width: w,
        height: h,
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
      if (!supportsAiBackground(template)) setTemplate('quote');
      setBgMode('ai');
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
        const spec = buildSpec(
          template,
          {
            quoteText,
            statData,
            bannerHeadline,
            bannerKeywords,
            bannerFollowers,
            bannerMilestone,
            pfpBitmap,
            bgBitmap,
            patternKind,
            patternSeed,
          },
          kit,
        );
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
    patternKind,
    patternSeed,
  ]);

  useEffect(
    () => () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    },
    [previewUrl],
  );

  // Every kit/preset edit maps to a pure bundle transform, then persists.
  const applyBundle = (fn: (b: BrandKits) => BrandKits): void => {
    setBundle((prev) => {
      if (!prev) return prev;
      const next = fn(prev);
      void saveBrandKits(next);
      return next;
    });
  };
  const patchKit = (partial: Partial<BrandKit>): void =>
    applyBundle((b) => patchActiveKit(b, partial));
  const importBundle = (next: BrandKits): void => applyBundle(() => next);
  const resetActiveKit = (): void =>
    applyBundle((b) => patchActiveKit(b, { ...DEFAULT_BRAND_KIT }));

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
    const { w, h } = templateMeta(template).size;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `stratus-${template}-${w}×${h}.png`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  // S3.4: stamp the "visual made" marker so Calendar/Today remind at publish
  // time that this slot ships manually with its image.
  const stampVisualMade = async (): Promise<void> => {
    if (!seedPostId) return;
    setError(null);
    try {
      const label = templateMeta(template).label;
      await api.update(settings, seedPostId, { mediaNote: `${label} made in Studio` });
      setStamped(true);
      setNotice('Post marked — it renders an amber "post manually" chip now.');
    } catch (e) {
      setError(e instanceof ApiError ? `Stamp failed: ${e.message}` : 'Stamp failed');
    }
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

  if (!bundle || !kit) return <div className="panel muted">Loading…</div>;

  return (
    <div className="panel">
      <div className="panel-header">
        <h2>Studio</h2>
        <button type="button" onClick={() => setKitOpen((o) => !o)}>
          {kitOpen ? 'Close brand kit' : 'Brand kit'}
        </button>
      </div>

      {kitOpen && (
        <KitEditor
          bundle={bundle}
          onPatch={patchKit}
          onSelectPreset={(name) => applyBundle((b) => setActivePreset(b, name))}
          onSaveAs={(name) => applyBundle((b) => savePresetAs(b, name, activeKit(b)))}
          onRename={(from, to) => applyBundle((b) => renamePreset(b, from, to))}
          onDelete={(name) => applyBundle((b) => deletePreset(b, name))}
          onImport={importBundle}
          onResetActive={resetActiveKit}
          onError={setError}
          onNotice={setNotice}
        />
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
            <span className="muted">
              {t.size.w}×{t.size.h}
            </span>
          </button>
        ))}
      </div>

      {template === 'quote' && <QuoteFields value={quoteText} onChange={setQuoteText} />}

      {template === 'stat' && (
        <StatFields loading={statLoading} data={statData} onReload={() => void loadStatData()} />
      )}

      {template === 'banner' && (
        <BannerFields
          headline={bannerHeadline}
          keywords={bannerKeywords}
          milestone={bannerMilestone}
          followers={bannerFollowers}
          onHeadline={setBannerHeadline}
          onKeywords={setBannerKeywords}
          onMilestone={setBannerMilestone}
        />
      )}

      {template === 'pfp' && <PfpFields onPickPhoto={(e) => void onPickPhoto(e)} />}

      {supportsAiBackground(template) && (
        <div className="studio-bg-modes">
          <span className="muted">Background</span>
          <div className="studio-templates">
            {BG_MODES.map((m) => (
              <button
                key={m.id}
                type="button"
                className={`studio-template${bgMode === m.id ? ' studio-template-active' : ''}`}
                onClick={() => chooseBgMode(m.id)}
              >
                <span>{m.label}</span>
              </button>
            ))}
          </div>
          {bgMode === 'blobs' && (
            <button
              type="button"
              onClick={() => setPatternSeed((s) => s + 1)}
              title="Reroll the blob placement"
            >
              Reroll
            </button>
          )}
        </div>
      )}

      {supportsAiBackground(template) && bgMode === 'ai' && (
        <BackgroundFields
          hasBackground={bgBitmap !== null}
          pillars={pillars}
          pillarSlug={pillarSlug}
          prompt={bgPrompt}
          loading={genLoading}
          cost={genCost}
          onClear={clearBackground}
          onReseed={reseedPrompt}
          onPromptChange={setBgPrompt}
          onGenerate={() => void generateBackground()}
        />
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
        <LibraryRail
          library={library}
          onRefresh={() => void loadLibrary()}
          onReopen={(a) => void reopenAsset(a)}
          onDelete={(id) => void deleteAsset(id)}
        />
      )}
    </div>
  );
}
