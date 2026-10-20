import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ClipboardCheck, QrCode, Settings2, Users, Wifi, WifiOff, type LucideIcon } from 'lucide-react';
import type { TabId } from '../types';
import { useApp } from '../context/AppContext';
import { cn } from '../lib/cn';
import { Settings } from './Settings';
import { SyncBar, SyncButton } from './SyncBar';

interface TabDef {
  id: TabId;
  label: string;
  shortLabel: string;
  icon: LucideIcon;
}

const TABS: TabDef[] = [
  { id: 'directory', label: 'Directory', shortLabel: 'Directory', icon: Users },
  { id: 'attendance', label: 'Rapid Attendance', shortLabel: 'Attendance', icon: ClipboardCheck },
  { id: 'scanner', label: 'QR Scanner', shortLabel: 'Scanner', icon: QrCode },
];

interface HeaderProps {
  tab: TabId;
  onTabChange: (tab: TabId) => void;
}

export function Header({ tab, onTabChange }: HeaderProps) {
  const { isOnline, isLive, orgConfig, setupSeen, markSetupSeen } = useApp();
  const ref = useRef<HTMLElement>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  // First-ever launch (nothing configured, instructions never shown): open Settings
  // automatically so a new install isn't just a silent "Demo" badge with no next step.
  useEffect(() => {
    if (!setupSeen && !isLive) setSettingsOpen(true);
  }, [setupSeen, isLive]);

  const closeSettings = () => {
    setSettingsOpen(false);
    markSetupSeen();
  };

  // Publish the header's height so sticky toolbars below it can offset themselves.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const publish = () =>
      document.documentElement.style.setProperty('--header-h', `${el.getBoundingClientRect().height}px`);
    publish();
    const observer = new ResizeObserver(publish);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <header ref={ref} className="sticky top-0 z-30 bg-brand-700 text-white shadow-md">
      <div className="mx-auto max-w-3xl">
        <div className="flex items-center gap-3 px-4 pb-2 pt-[max(0.5rem,env(safe-area-inset-top))]">
          <img src="/pwa-64x64.png" alt="" className="h-9 w-9 rounded-lg" />
          <div className="hidden min-w-0 sm:block">
            <h1 className="truncate text-base font-bold leading-tight">{orgConfig.orgName || 'SRM Suite'}</h1>
            <p className="text-xs leading-tight text-brand-100">
              {orgConfig.orgName ? 'SRM Suite' : 'Student Record Manager'}
            </p>
          </div>
          {!isLive && (
            <span
              title="Using demo data. Connect your Google Sheet in Settings to use real data."
              className="rounded-md bg-amber-300 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-950"
            >
              Demo
            </span>
          )}

          <div className="ml-auto flex items-center gap-2">
            <span
              role="status"
              className={cn(
                'flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold',
                isOnline ? 'bg-emerald-400/20 text-emerald-100' : 'bg-amber-300 text-amber-950',
              )}
            >
              {isOnline ? (
                <Wifi className="h-3.5 w-3.5" aria-hidden="true" />
              ) : (
                <WifiOff className="h-3.5 w-3.5" aria-hidden="true" />
              )}
              {isOnline ? 'Online' : 'Offline'}
            </span>
            <SyncButton />
            <button
              type="button"
              onClick={() => setSettingsOpen(true)}
              aria-label="Settings: connect your Google Sheet"
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white/15 text-white hover:bg-white/25"
            >
              <Settings2 className="h-5 w-5" aria-hidden="true" />
            </button>
          </div>
        </div>

        <nav className="flex" role="tablist" aria-label="Sections">
          {TABS.map(({ id, label, shortLabel, icon: Icon }) => {
            const active = tab === id;
            return (
              <button
                key={id}
                type="button"
                role="tab"
                id={`tab-${id}`}
                aria-selected={active}
                aria-controls="panel"
                onClick={() => onTabChange(id)}
                className={cn(
                  'flex min-h-touch flex-1 items-center justify-center gap-2 border-b-[3px] px-2 text-sm font-semibold transition',
                  active
                    ? 'border-white text-white'
                    : 'border-transparent text-brand-100 hover:bg-white/10 hover:text-white',
                )}
              >
                <Icon className="h-5 w-5" aria-hidden="true" />
                <span className="sm:hidden">{shortLabel}</span>
                <span className="hidden sm:inline">{label}</span>
              </button>
            );
          })}
        </nav>
      </div>
      <SyncBar />
      {settingsOpen && <Settings onClose={closeSettings} />}
    </header>
  );
}
