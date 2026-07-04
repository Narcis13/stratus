import { type JSX, useState } from 'react';
import { CalendarPanel } from './Calendar.tsx';
import { ComposerPanel } from './Composer.tsx';
import { HarvestPanel } from './Harvest.tsx';
import { PeoplePanel } from './People.tsx';
import { PlaybookPanel } from './Playbook.tsx';
import { RepliesPanel } from './Replies.tsx';
import { SettingsPanel } from './Settings.tsx';
import { TodayPanel } from './Today.tsx';
import { VoicePanel } from './Voice.tsx';
import { isConfigured, useSettings } from './storage.ts';

type Tab =
  | 'today'
  | 'people'
  | 'calendar'
  | 'composer'
  | 'harvest'
  | 'voice'
  | 'replies'
  | 'playbook'
  | 'settings';

const TABS: { id: Tab; label: string }[] = [
  { id: 'today', label: 'Today' },
  { id: 'people', label: 'People' },
  { id: 'calendar', label: 'Calendar' },
  { id: 'composer', label: 'Composer' },
  { id: 'harvest', label: 'Harvest' },
  { id: 'voice', label: 'Voice' },
  { id: 'replies', label: 'Replies' },
  { id: 'playbook', label: 'Playbook' },
  { id: 'settings', label: 'Settings' },
];

export function App(): JSX.Element {
  const { settings, loading } = useSettings();
  const [tab, setTab] = useState<Tab>('today');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [remixTweetId, setRemixTweetId] = useState<string | null>(null);
  // C1: handle to open in the People dossier — any handle rendered anywhere in
  // the panel routes here via openPerson.
  const [personHandle, setPersonHandle] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const startEdit = (id: string) => {
    setEditingId(id);
    setTab('composer');
  };
  const clearEdit = () => setEditingId(null);
  // §8.3 → §8.1: Voice tab's Remix button seeds the Composer drafter.
  const startRemix = (tweetId: string) => {
    setEditingId(null);
    setRemixTweetId(tweetId);
    setTab('composer');
  };
  const openPerson = (handle: string) => {
    setPersonHandle(handle.replace(/^@/, '').toLowerCase());
    setTab('people');
  };
  const onSaved = () => setRefreshKey((k) => k + 1);

  const configured = isConfigured(settings);
  const activeTab: Tab = !configured && tab !== 'settings' ? 'settings' : tab;

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">stratus</div>
        <nav className="tabs">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              className={`tab${activeTab === t.id ? ' tab-active' : ''}`}
              onClick={() => {
                if (t.id === 'composer') clearEdit();
                setTab(t.id);
              }}
              disabled={!configured && t.id !== 'settings'}
            >
              {t.label}
            </button>
          ))}
        </nav>
      </header>

      <main className="content">
        {loading ? (
          <div className="panel muted">Loading…</div>
        ) : !configured && activeTab !== 'settings' ? (
          <div className="panel">
            <p className="muted">Configure API URL and bearer token first.</p>
          </div>
        ) : activeTab === 'today' ? (
          <TodayPanel key={`today-${refreshKey}`} settings={settings} onOpenPerson={openPerson} />
        ) : activeTab === 'people' ? (
          <PeoplePanel
            settings={settings}
            openHandle={personHandle}
            onClearOpen={() => setPersonHandle(null)}
          />
        ) : activeTab === 'calendar' ? (
          <CalendarPanel key={`cal-${refreshKey}`} settings={settings} onEdit={startEdit} />
        ) : activeTab === 'composer' ? (
          <ComposerPanel
            settings={settings}
            editingId={editingId}
            remixTweetId={remixTweetId}
            onClearRemix={() => setRemixTweetId(null)}
            onClearEdit={clearEdit}
            onSaved={onSaved}
            onEdit={startEdit}
          />
        ) : activeTab === 'harvest' ? (
          <HarvestPanel />
        ) : activeTab === 'voice' ? (
          <VoicePanel settings={settings} onRemix={startRemix} onOpenPerson={openPerson} />
        ) : activeTab === 'replies' ? (
          <RepliesPanel
            key={`replies-${refreshKey}`}
            settings={settings}
            onOpenPerson={openPerson}
          />
        ) : activeTab === 'playbook' ? (
          <PlaybookPanel settings={settings} />
        ) : (
          <SettingsPanel />
        )}
      </main>
    </div>
  );
}
