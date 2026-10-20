import { ClipboardCheck, QrCode, Settings2, Users, type LucideIcon } from 'lucide-react';
import type { TabId } from '../types';
import { cn } from '../lib/cn';

interface NavDef {
  id: TabId | 'settings';
  label: string;
  icon: LucideIcon;
}

const NAV_ITEMS: NavDef[] = [
  { id: 'directory', label: 'Home', icon: Users },
  { id: 'attendance', label: 'Attendance', icon: ClipboardCheck },
  { id: 'scanner', label: 'Scanner', icon: QrCode },
  { id: 'settings', label: 'Settings', icon: Settings2 },
];

interface BottomNavProps {
  tab: TabId;
  onTabChange: (tab: TabId) => void;
  onSettings: () => void;
}

/** Fixed bottom tab bar: the app's primary navigation, styled after a dashboard-app bottom bar. */
export function BottomNav({ tab, onTabChange, onSettings }: BottomNavProps) {
  return (
    <nav
      role="tablist"
      aria-label="Sections"
      className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white pb-[env(safe-area-inset-bottom)] shadow-[0_-2px_12px_rgba(15,23,42,0.06)]"
    >
      <div className="mx-auto flex max-w-3xl items-stretch">
        {NAV_ITEMS.map(({ id, label, icon: Icon }) => {
          const active = id === 'settings' ? false : tab === id;
          return (
            <button
              key={id}
              type="button"
              role={id === 'settings' ? undefined : 'tab'}
              id={id === 'settings' ? undefined : `tab-${id}`}
              aria-selected={id === 'settings' ? undefined : active}
              aria-controls={id === 'settings' ? undefined : 'panel'}
              aria-label={id === 'settings' ? 'Settings: connect your Google Sheet' : undefined}
              onClick={() => (id === 'settings' ? onSettings() : onTabChange(id))}
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
