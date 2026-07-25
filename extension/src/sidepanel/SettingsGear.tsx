// The inline-config affordance as the tabs actually use it (UI.12): a `⚙` next
// to a feature that edits the very same registry knobs the Settings → Tuning tab
// edits, through the very same write discipline (`useSettingsEditor`).
//
// The tab owns ONE editor — one `GET /x/settings`, one debounce map — and hands
// it to every gear on the page. Two editors on one tab would each hold their own
// copy of the registry, so a knob edited in a gear would stay stale in Tuning
// until a reload, which is exactly the kind of disagreement the shared hook
// exists to prevent.
//
// A gear renders nothing at all when its keys are unavailable (registry still
// loading, server unreachable, or the knob was renamed). A gear that opens onto
// an empty card is worse than no gear: it reads as a broken feature rather than
// an offline server, and the feature itself still works off the mirrored blob.

import type { JSX } from 'react';
import { entriesForKeys } from './settingsClient.ts';
import type { SettingsEditor } from './settingsEditor.ts';
import { GearPopover } from './ui/GearPopover.tsx';

interface Props {
  /** The tab's single editor — never one per gear. */
  editor: SettingsEditor;
  /** Registry keys this gear tunes, in the order they should read. */
  keys: string[];
  /** Accessible name for the trigger ("Configure the quest targets"). */
  label: string;
  /** Ownership/context line above the rows — see GearPopover's `note`. */
  note?: string | undefined;
}

export function SettingsGear({ editor, keys, label, note }: Props): JSX.Element | null {
  const entries = editor.groups === null ? [] : entriesForKeys(editor.groups, keys);
  if (entries.length === 0) return null;
  return (
    <GearPopover
      settings={entries}
      onPatch={editor.change}
      onReset={editor.resetKey}
      label={label}
      note={note}
      errors={editor.rowErrors}
    />
  );
}
