// The brand-kit editor (SURFACES S5.2, presets S5.4): the preset dropdown +
// Save-as / rename / delete, the active kit's colors/handle/watermark/mascot/
// style-suffix, and export/import/reset. Whole-bundle swaps (import/reset) and
// every preset mutation go through callbacks so the shell persists them.

import { type ChangeEvent, type JSX, useState } from 'react';
import {
  type BrandKit,
  type BrandKits,
  activeKit,
  canDeletePreset,
  parseBrandKitsFile,
  serializeBrandKits,
} from '../../studio/brandKit.ts';

// <input type="color"> only speaks #rrggbb.
function toColorInput(hex: string): string {
  const m = /^#([0-9a-f]{3})$/i.exec(hex);
  if (!m) return hex;
  const s = m[1] as string;
  return `#${s.replace(/./g, (c) => c + c)}`;
}

interface Props {
  bundle: BrandKits;
  /** Field-level edit of the active kit — merged and persisted by the shell. */
  onPatch: (partial: Partial<BrandKit>) => void;
  onSelectPreset: (name: string) => void;
  /** Save the active kit under a new name and activate it. */
  onSaveAs: (name: string) => void;
  onRename: (from: string, to: string) => void;
  onDelete: (name: string) => void;
  /** Whole-bundle swap (import / reset) — persisted by the shell. */
  onImport: (bundle: BrandKits) => void;
  onResetActive: () => void;
  onError: (msg: string) => void;
  onNotice: (msg: string) => void;
}

export function KitEditor({
  bundle,
  onPatch,
  onSelectPreset,
  onSaveAs,
  onRename,
  onDelete,
  onImport,
  onResetActive,
  onError,
  onNotice,
}: Props): JSX.Element {
  const kit = activeKit(bundle);
  const names = Object.keys(bundle.kits);
  const [newName, setNewName] = useState('');

  const exportKit = (): void => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(
      new Blob([serializeBrandKits(bundle)], { type: 'application/json' }),
    );
    a.download = 'stratus-brand-kits.json';
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const importKit = async (e: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const parsed = parseBrandKitsFile(await file.text());
    if (!parsed) {
      onError('Not a brand kit JSON.');
      return;
    }
    onImport(parsed);
    onNotice('Brand kit imported.');
  };

  const saveAs = (): void => {
    const n = newName.trim();
    if (n === '') return;
    onSaveAs(n);
    setNewName('');
    onNotice(`Saved preset "${n}".`);
  };

  const rename = (): void => {
    const n = newName.trim();
    if (n === '' || n === bundle.active) return;
    onRename(bundle.active, n);
    setNewName('');
  };

  return (
    <section className="studio-kit">
      <div className="studio-kit-row">
        <label className="field">
          <span>Preset</span>
          <select value={bundle.active} onChange={(e) => onSelectPreset(e.target.value)}>
            {names.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          onClick={() => onDelete(bundle.active)}
          disabled={!canDeletePreset(bundle, bundle.active)}
          title="Delete the active preset (the last preset can't be deleted)"
        >
          Delete preset
        </button>
      </div>
      <div className="studio-kit-row">
        <input
          type="text"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="New preset name"
        />
        <button type="button" onClick={saveAs} disabled={newName.trim() === ''}>
          Save as
        </button>
        <button
          type="button"
          onClick={rename}
          disabled={newName.trim() === '' || newName.trim() === bundle.active}
        >
          Rename
        </button>
      </div>

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
      <label className="row studio-check">
        <input
          type="checkbox"
          checked={kit.mascot}
          onChange={(e) => onPatch({ mascot: e.target.checked })}
        />
        <span>Cloud mascot</span>
      </label>
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
        <button type="button" onClick={onResetActive}>
          Reset preset
        </button>
      </div>
    </section>
  );
}
