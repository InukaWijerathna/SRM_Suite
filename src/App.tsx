import { lazy, Suspense, useState } from 'react';
import { LoaderCircle } from 'lucide-react';
import { AppProvider } from './context/AppContext';
import type { TabId } from './types';
import { Header } from './components/Header';
import { StudentDirectory } from './components/StudentDirectory';
import { AttendanceList } from './components/AttendanceList';

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

export default function App() {
  return (
    <AppProvider>
      <Shell />
    </AppProvider>
  );
}
