// The brand-kit editor (SURFACES S5.2): colors, handle, watermark, AI-background
// style suffix, and export/import/reset — extracted verbatim from Studio.tsx.
// Whole-kit swaps (import/reset) go through onReplace so the shell persists them.

import type { ChangeEvent, JSX } from 'react';
import { type BrandKit, DEFAULT_BRAND_KIT, parseBrandKit } from '../../studio/brandKit.ts';

// <input type="color"> only speaks #rrggbb.
function toColorInput(hex: string): string {
  const m = /^#([0-9a-f]{3})$/i.exec(hex);
  if (!m) return hex;
  const s = m[1] as string;
  return `#${s.replace(/./g, (c) => c + c)}`;
}

interface Props {
  kit: BrandKit;
  /** Field-level edit — merged and persisted by the shell. */
  onPatch: (partial: Partial<BrandKit>) => void;
  /** Whole-kit swap (import / reset) — persisted by the shell. */
  onReplace: (kit: BrandKit) => void;
  onError: (msg: string) => void;
  onNotice: (msg: string) => void;
}

export function KitEditor({ kit, onPatch, onReplace, onError, onNotice }: Props): JSX.Element {
  const exportKit = (): void => {
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
      onError('Not a brand kit JSON.');
      return;
    }
    onReplace(parsed);
    onNotice('Brand kit imported.');
  };

  return (
    <section className="studio-kit">
      <div className="studio-kit-row">
        <label className="studio-color">
          <span>Background</span>
          <input
            type="color"
            value={toColorInput(kit.bg)}
            onChange={(e) => onPatch({ bg: e.target.value })}
          />
        </label>
        <label className="studio-color">
          <span>Accent</span>
          <input
            type="color"
            value={toColorInput(kit.accent)}
            onChange={(e) => onPatch({ accent: e.target.value })}
          />
        </label>
      </div>
      <label className="field">
        <span>Handle (no @)</span>
        <input
          type="text"
          value={kit.handle}
          onChange={(e) => onPatch({ handle: e.target.value.replace(/^@+/, '') })}
          placeholder="yourhandle"
        />
      </label>
      <div className="studio-kit-row">
        <label className="row studio-check">
          <input
            type="checkbox"
            checked={kit.watermark}
            onChange={(e) => onPatch({ watermark: e.target.checked })}
          />
          <span>Watermark</span>
        </label>
        <input
          type="text"
          value={kit.watermarkText}
          onChange={(e) => onPatch({ watermarkText: e.target.value })}
          disabled={!kit.watermark}
        />
      </div>
      <label className="field">
        <span>AI background style suffix (the brand — keep "no text")</span>
        <textarea
          value={kit.imageStyleSuffix}
          onChange={(e) => onPatch({ imageStyleSuffix: e.target.value })}
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
        <button type="button" onClick={() => onReplace({ ...DEFAULT_BRAND_KIT })}>
          Reset
        </button>
      </div>
    </section>
  );
}
