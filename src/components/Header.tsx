import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Settings2, Wifi, WifiOff } from 'lucide-react';
import type { TabId } from '../types';
import { useApp } from '../context/AppContext';
import { cn } from '../lib/cn';
import { Settings } from './Settings';
import { SyncBar, SyncButton } from './SyncBar';

interface HeaderProps {
  tab: TabId;
}

export function Header({ tab }: HeaderProps) {
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
  }, [tab]);

  return (
    <header ref={ref} className="sticky top-0 z-30 bg-gradient-to-br from-brand-600 to-brand-800 text-white shadow-md">
      <div className="mx-auto max-w-3xl px-4 pb-5 pt-[max(0.75rem,env(safe-area-inset-top))]">
        <div className="flex items-start gap-3">
          <img src="/pwa-64x64.png" alt="" className="mt-0.5 h-10 w-10 shrink-0 rounded-xl ring-1 ring-white/30" />
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-lg font-bold leading-tight">Hi, {orgConfig.orgName || 'SRM Suite'}</h1>
            <p className="truncate text-xs text-brand-100">
              {orgConfig.orgName ? 'Student Record Manager' : 'Connect your Google Sheet to get started'}
            </p>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            {!isLive && (
              <span className="rounded-md bg-amber-300 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-950">
                Demo
              </span>
            )}
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
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/15 text-white hover:bg-white/25"
            >
              <Settings2 className="h-5 w-5" aria-hidden="true" />
            </button>
          </div>
        </div>
      </div>
      <SyncBar />
      {settingsOpen && <Settings onClose={closeSettings} />}
    </header>
  );
}
