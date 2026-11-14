import { useLayoutEffect, useRef } from 'react';
import { Menu, UserCircle, Wifi, WifiOff } from 'lucide-react';
import type { TabId } from '../types';
import { useApp } from '../context/AppContext';
import { cn } from '../lib/cn';
import { SyncBar, SyncButton } from './SyncBar';

interface HeaderProps {
  tab: TabId;
  menuOpen: boolean;
  onOpenMenu: () => void;
}

export function Header({ tab, menuOpen, onOpenMenu }: HeaderProps) {
  const { isOnline, isLive, orgConfig, username, role } = useApp();
  const ref = useRef<HTMLElement>(null);

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
          <button type="button" onClick={onOpenMenu} aria-label="Open account and navigation menu" aria-haspopup="dialog" aria-expanded={menuOpen} aria-controls="app-menu" className="relative flex min-h-touch min-w-touch shrink-0 items-center justify-center rounded-xl hover:bg-white/10 focus-visible:outline-white">
            <img src="/pwa-64x64.png" alt="" className="h-10 w-10 rounded-xl ring-1 ring-white/30" />
            <span className="absolute -bottom-0.5 -right-0.5 rounded-full bg-white p-0.5 text-brand-700 shadow-sm"><Menu className="h-3 w-3" aria-hidden="true" /></span>
          </button>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-lg font-bold leading-tight">{orgConfig.orgName || 'SRM Suite'}</h1>
            <p className="truncate text-xs text-brand-100">
              {isLive ? 'Student Record Manager' : 'Connect your Google Sheet to get started'}
            </p>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            {!isLive && (
              <span className="rounded-md bg-amber-300 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-950">
                Not connected
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
          </div>
        </div>
        <div className="mt-3 flex items-center justify-between gap-3">
          <button type="button" onClick={onOpenMenu} aria-label={username ? `Open account menu for ${username}` : 'Open account menu'} aria-haspopup="dialog" aria-expanded={menuOpen} aria-controls="app-menu" className="flex min-h-touch min-w-0 items-center gap-2 rounded-xl px-1 text-left hover:bg-white/10 focus-visible:outline-white">
            <UserCircle className="h-6 w-6 shrink-0 text-brand-100" aria-hidden="true" />
            <span className="min-w-0">
              <span className="block text-[10px] uppercase tracking-wide text-brand-100">{username ? 'Signed in as' : 'Account'}</span>
              <span className="block truncate text-sm font-semibold" title={username || undefined}>{username || 'Not signed in'}</span>
            </span>
            {role && <span className="shrink-0 rounded-full bg-white/15 px-2 py-0.5 text-[10px] font-semibold capitalize">{role}</span>}
          </button>
          <div className="shrink-0"><SyncButton /></div>
        </div>
      </div>
      <SyncBar />
    </header>
  );
}
