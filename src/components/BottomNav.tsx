import { useLayoutEffect, useRef } from 'react';
import { useApp } from '../context/AppContext';
import { ClipboardCheck, QrCode, Users, type LucideIcon } from 'lucide-react';
import type { TabId } from '../types';
import { cn } from '../lib/cn';

interface NavDef {
  id: TabId;
  label: string;
  icon: LucideIcon;
}

const NAV_ITEMS: NavDef[] = [
  { id: 'directory', label: 'Home', icon: Users },
  { id: 'attendance', label: 'Attendance', icon: ClipboardCheck },
  { id: 'scanner', label: 'Scanner', icon: QrCode },
];

interface BottomNavProps {
  tab: TabId;
  onTabChange: (tab: TabId) => void;
}

/** Fixed bottom tab bar: the app's primary navigation, styled after a dashboard-app bottom bar. */
export function BottomNav({ tab, onTabChange }: BottomNavProps) {
  const { canEdit } = useApp();
  const navRef = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const nav = navRef.current;
    if (!nav) return;
    const publish = () => document.documentElement.style.setProperty('--bottom-nav-h', `${nav.getBoundingClientRect().height}px`);
    publish();
    const observer = new ResizeObserver(publish);
    observer.observe(nav);
    return () => {
      observer.disconnect();
      document.documentElement.style.removeProperty('--bottom-nav-h');
    };
  }, []);
  return (
    <nav
      ref={navRef}
      role="tablist"
      aria-label="Sections"
      className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white pb-[env(safe-area-inset-bottom)] shadow-[0_-2px_12px_rgba(15,23,42,0.06)]"
    >
      <div className="mx-auto flex max-w-3xl items-stretch">
        {NAV_ITEMS.filter(item => canEdit || item.id === 'directory').map(({ id, label, icon: Icon }) => {
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
              className="flex min-h-touch flex-1 flex-col items-center justify-center gap-0.5 py-1.5 text-[11px] font-semibold"
            >
              <Icon
                className={cn('h-5 w-5 transition', active ? 'text-brand-600' : 'text-slate-400')}
                aria-hidden="true"
              />
              <span className={cn('transition', active ? 'text-brand-600' : 'text-slate-500')}>{label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
