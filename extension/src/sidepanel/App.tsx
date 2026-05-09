import { type JSX, useState } from 'react';
import { CalendarPanel } from './Calendar.tsx';
import { ComposerPanel } from './Composer.tsx';
import { DraftsPanel } from './Drafts.tsx';
import { SettingsPanel } from './Settings.tsx';
import { isConfigured, useSettings } from './storage.ts';

type Tab = 'calendar' | 'composer' | 'drafts' | 'settings';

const TABS: { id: Tab; label: string }[] = [
  { id: 'calendar', label: 'Calendar' },
  { id: 'composer', label: 'Composer' },
  { id: 'drafts', label: 'Drafts' },
  { id: 'settings', label: 'Settings' },
];

export function App(): JSX.Element {
  const { settings, loading } = useSettings();
  const [tab, setTab] = useState<Tab>('calendar');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const startEdit = (id: string) => {
    setEditingId(id);
    setTab('composer');
  };
  const clearEdit = () => setEditingId(null);
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
        ) : activeTab === 'calendar' ? (
          <CalendarPanel key={`cal-${refreshKey}`} settings={settings} onEdit={startEdit} />
        ) : activeTab === 'composer' ? (
          <ComposerPanel
            settings={settings}
            editingId={editingId}
            onClearEdit={clearEdit}
            onSaved={onSaved}
          />
        ) : activeTab === 'drafts' ? (
          <DraftsPanel key={`draft-${refreshKey}`} settings={settings} onEdit={startEdit} />
        ) : (
          <SettingsPanel />
        )}
      </main>
    </div>
  );
}
