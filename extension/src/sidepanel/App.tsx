import { type JSX, useEffect, useState } from 'react';
import { CalendarPanel } from './Calendar.tsx';
import { ChannelsPanel } from './Channels.tsx';
import { ComposerPanel } from './Composer.tsx';
import { HarvestPanel } from './Harvest.tsx';
import { IdeasPanel } from './Ideas.tsx';
import { MePanel } from './Me.tsx';
import { PeoplePanel } from './People.tsx';
import { PlaybookPanel } from './Playbook.tsx';
import { RepliesPanel } from './Replies.tsx';
import { SettingsPanel } from './Settings.tsx';
import { StudioPanel, type StudioSeed } from './Studio.tsx';
import { TodayPanel } from './Today.tsx';
import { VoicePanel } from './Voice.tsx';
import { isConfigured, useSettings } from './storage.ts';
import { EmptyState } from './ui/EmptyState.tsx';

type Tab =
  | 'today'
  | 'me'
  | 'people'
  | 'channels'
  | 'calendar'
  | 'composer'
  | 'studio'
  | 'harvest'
  | 'voice'
  | 'replies'
  | 'ideas'
  | 'playbook'
  | 'settings';

// The rail is grouped by intent (eyebrow dividers). OPERATE = the daily loop,
// AUTHOR = making things, LIBRARY = stored inputs, LEARN = measurement, SYSTEM
// = config. Groups render top-to-bottom in this order.
const TAB_GROUPS: { label: string; tabs: { id: Tab; label: string }[] }[] = [
  {
    label: 'Operate',
    tabs: [
      { id: 'today', label: 'Today' },
      { id: 'people', label: 'People' },
      { id: 'me', label: 'Me' },
      { id: 'channels', label: 'Channels' },
    ],
  },
  {
    label: 'Author',
    tabs: [
      { id: 'composer', label: 'Composer' },
      { id: 'calendar', label: 'Calendar' },
      { id: 'studio', label: 'Studio' },
      { id: 'ideas', label: 'Ideas' },
    ],
  },
  {
    label: 'Library',
    tabs: [
      { id: 'voice', label: 'Voice' },
      { id: 'replies', label: 'Replies' },
      { id: 'harvest', label: 'Harvest' },
    ],
  },
  {
    label: 'Learn',
    tabs: [{ id: 'playbook', label: 'Playbook' }],
  },
  {
    label: 'System',
    tabs: [{ id: 'settings', label: 'Settings' }],
  },
];

export function App(): JSX.Element {
  const { settings, loading } = useSettings();
  const [tab, setTab] = useState<Tab>('today');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [remixTweetId, setRemixTweetId] = useState<string | null>(null);
  // C1: handle to open in the People dossier — any handle rendered anywhere in
  // the panel routes here via openPerson.
  const [personHandle, setPersonHandle] = useState<string | null>(null);
  const [studioSeed, setStudioSeed] = useState<StudioSeed | null>(null);
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
  // S3: seed the Studio's quote card from the Composer ("Make visual") or a
  // profile-click leader (quote-tweet + card is the strongest re-up format).
  const openStudio = (seed: StudioSeed) => {
    setStudioSeed(seed);
    setTab('studio');
  };
  const onSaved = () => setRefreshKey((k) => k + 1);

  // AX.6: a timeline chip or the tweet-page context panel writes
  // chrome.storage.session['stratus:openPerson'] via the background (single
  // writer). Consume it on mount + live, route to the dossier, then clear it so
  // a later panel open can't replay the stale handle. Only setState setters are
  // referenced (stable), so the empty dep array is exhaustive.
  useEffect(() => {
    const consume = (v: unknown) => {
      const handle = (v as { handle?: unknown } | null)?.handle;
      if (typeof handle === 'string' && handle) {
        setPersonHandle(handle.replace(/^@/, '').toLowerCase());
        setTab('people');
        void chrome.runtime.sendMessage({ type: 'stratus/open-person-clear' }).catch(() => {});
      }
    };
    void chrome.storage.session
      .get('stratus:openPerson')
      .then((out) => consume(out['stratus:openPerson']))
      .catch(() => {});
    const onChanged = (changes: { [k: string]: chrome.storage.StorageChange }, area: string) => {
      if (area === 'session' && changes['stratus:openPerson']) {
        consume(changes['stratus:openPerson'].newValue);
      }
    };
    chrome.storage.onChanged.addListener(onChanged);
    return () => chrome.storage.onChanged.removeListener(onChanged);
  }, []);

  const configured = isConfigured(settings);
  const activeTab: Tab = !configured && tab !== 'settings' ? 'settings' : tab;

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <img className="brand-mark" src="/icons/icon128.png" alt="" width={22} height={22} />
          <span className="brand-word">stratus</span>
        </div>
        <nav className="tabs">
          {TAB_GROUPS.map((g) => (
            <div key={g.label} className="tab-group">
              <div className="tab-group-eyebrow">{g.label}</div>
              {g.tabs.map((t) => (
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
            </div>
          ))}
        </nav>
      </header>

      <main className="content">
        {loading ? (
          <div className="panel muted">Loading…</div>
        ) : !configured && activeTab !== 'settings' ? (
          <div className="panel">
            <EmptyState
              line="Connect stratus to get started."
              hint="Open Settings and paste your server URL and bearer token."
            />
          </div>
        ) : activeTab === 'today' ? (
          <TodayPanel
            key={`today-${refreshKey}`}
            settings={settings}
            onOpenPerson={openPerson}
            onMakeVisual={(text) => openStudio({ text })}
          />
        ) : activeTab === 'people' ? (
          <PeoplePanel
            settings={settings}
            openHandle={personHandle}
            onClearOpen={() => setPersonHandle(null)}
          />
        ) : activeTab === 'me' ? (
          <MePanel settings={settings} />
        ) : activeTab === 'channels' ? (
          <ChannelsPanel settings={settings} onOpenPerson={openPerson} />
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
            onMakeVisual={openStudio}
          />
        ) : activeTab === 'studio' ? (
          <StudioPanel
            settings={settings}
            seed={studioSeed}
            onClearSeed={() => setStudioSeed(null)}
          />
        ) : activeTab === 'harvest' ? (
          <HarvestPanel settings={settings} />
        ) : activeTab === 'voice' ? (
          <VoicePanel settings={settings} onRemix={startRemix} onOpenPerson={openPerson} />
        ) : activeTab === 'replies' ? (
          <RepliesPanel
            key={`replies-${refreshKey}`}
            settings={settings}
            onOpenPerson={openPerson}
          />
        ) : activeTab === 'ideas' ? (
          <IdeasPanel settings={settings} />
        ) : activeTab === 'playbook' ? (
          <PlaybookPanel settings={settings} />
        ) : (
          <SettingsPanel />
        )}
      </main>
    </div>
  );
}
