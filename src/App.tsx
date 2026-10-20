import { lazy, Suspense, useCallback, useState } from 'react';
import { LoaderCircle } from 'lucide-react';
import { AppProvider, useApp } from './context/AppContext';
import type { TabId } from './types';
import { Header } from './components/Header';
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
      <Header tab={tab} onTabChange={changeTab} />
      <main id="panel" role="tabpanel" aria-labelledby={`tab-${tab}`} className="mx-auto max-w-3xl">
        {tab === 'directory' && <StudentDirectory />}
        {tab === 'attendance' && <AttendanceList />}
        {scannerOpened && (
          <Suspense
            fallback={
              <div className="mt-24 flex justify-center" role="status" aria-label="Loading scanner">
                <LoaderCircle className="h-8 w-8 animate-spin text-brand-600" aria-hidden="true" />
              </div>
            }
          >
            <QRScanner active={tab === 'scanner'} />
          </Suspense>
        )}
      </main>
    </div>
  );
}

/** Gates the app behind Login whenever a real sheet is connected and nobody's signed in. */
function Gate() {
  const { requiresLogin, username } = useApp();
  return requiresLogin && !username ? <Login /> : <Shell />;
}

export default function App() {
  return (
    <AppProvider>
      <Gate />
    </AppProvider>
  );
}
