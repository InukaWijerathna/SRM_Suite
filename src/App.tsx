import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { LoaderCircle } from 'lucide-react';
import { AppProvider, useApp } from './context/AppContext';
import type { TabId } from './types';
import { Header } from './components/Header';
import { AccountDrawer } from './components/AccountDrawer';
import { BottomNav } from './components/BottomNav';
import { Settings } from './components/Settings';
import { Login } from './components/Login';
import { StudentDirectory } from './components/StudentDirectory';
import { AttendanceList } from './components/AttendanceList';
import { useBackHandler } from './lib/backButton';

// The QR decoder is the heaviest dependency: load it only when the scanner tab is opened.
// (The service worker still precaches the chunk, so it works offline.)
const QRScanner = lazy(() => import('./components/QRScanner').then((m) => ({ default: m.QRScanner })));

function Shell() {
  const [tab, setTab] = useState<TabId>('directory');
  // The scanner is loaded on first visit, then kept mounted (hidden) so its camera can be
  // stopped cleanly when the tab changes. The camera itself only runs while it is active.
  const [scannerOpened, setScannerOpened] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const closeMenu = useCallback(() => setMenuOpen(false), []);
  const { isLive, setupSeen, markSetupSeen, canEdit } = useApp();

  // First-ever launch (nothing configured, instructions never shown): open Settings
  // automatically so a new install isn't just a silent "Not connected" badge with no next step.
  useEffect(() => {
    if (!setupSeen && !isLive) setSettingsOpen(true);
  }, [setupSeen, isLive]);

  const closeSettings = () => {
    setSettingsOpen(false);
    markSetupSeen();
  };

  const changeTab = (next: TabId) => {
    if (next === 'scanner') setScannerOpened(true);
    setTab(next);
  };

  // Android back button: from Attendance/Scanner, go back to Directory (the home tab) first,
  // same as any other app's bottom-nav back behaviour. Only registered while off Directory,
  // so pressing back there falls through to the app's default — e.g. exiting.
  useBackHandler(useCallback(() => setTab('directory'), []), tab !== 'directory');

  return (
    <div className="min-h-dvh">
      <Header tab={tab} menuOpen={menuOpen} onOpenMenu={() => setMenuOpen(true)} />
      <main
        id="panel"
        role="tabpanel"
        aria-labelledby={`tab-${tab}`}
        className="mx-auto max-w-3xl pb-[calc(var(--bottom-nav-h,4rem)+0.5rem)]"
      >
        {tab === 'directory' && <StudentDirectory onConfigure={() => setSettingsOpen(true)} />}
        {tab === 'attendance' && canEdit && <AttendanceList />}
        {scannerOpened && canEdit && (
          <Suspense
            fallback={
              <div className="mt-24 flex justify-center" role="status" aria-label="Loading scanner">
                <LoaderCircle className="h-8 w-8 animate-spin text-brand-600" aria-hidden="true" />
              </div>
            }
          >
            <QRScanner active={tab === 'scanner' && !menuOpen && !settingsOpen} />
          </Suspense>
        )}
      </main>
      <BottomNav tab={tab} onTabChange={changeTab} />
      {settingsOpen && <Settings onClose={closeSettings} />}
      {menuOpen && <AccountDrawer onClose={closeMenu} onSettings={() => { closeMenu(); setSettingsOpen(true); }} />}
    </div>
  );
}

/** Gates the app behind Login whenever a real sheet is connected and nobody's signed in. */
function Gate() {
  const { requiresLogin } = useApp();
  return requiresLogin ? <Login /> : <Shell />;
}

export default function App() {
  return (
    <AppProvider>
      <Gate />
    </AppProvider>
  );
}
