import { useEffect, useRef } from 'react';
import { CloudUpload, Database, LogOut, Settings2, ShieldCheck, UserCircle, Wifi, WifiOff, X } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { useBackHandler } from '../lib/backButton';
import { cn } from '../lib/cn';

interface AccountDrawerProps {
  onClose: () => void;
  onSettings: () => void;
}

export function AccountDrawer({ onClose, onSettings }: AccountDrawerProps) {
  const { username, role, orgConfig, isLive, isOnline, canEdit, queue, syncNow, syncStatus, logout } = useApp();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  useBackHandler(onClose);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const opener = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialog.showModal(); // Native modal traps keyboard focus and makes the background inert.
    closeRef.current?.focus();
    return () => {
      dialog.close();
      document.body.style.overflow = overflow;
      if (opener?.isConnected) opener.focus();
    };
  }, []);

  return (
    <dialog
      id="app-menu"
      ref={dialogRef}
      aria-labelledby="app-menu-title"
      aria-modal="true"
      className="app-drawer fixed inset-y-0 left-0 m-0 h-dvh max-h-none w-[min(21rem,calc(100vw-2rem))] max-w-none border-0 bg-white p-0 text-slate-900 shadow-2xl backdrop:bg-slate-950/50"
      onCancel={(event) => { event.preventDefault(); onClose(); }}
      onClick={(event) => {
        if (event.target !== event.currentTarget) return;
        const bounds = event.currentTarget.getBoundingClientRect();
        if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) onClose();
      }}
    >
      <div className="flex h-full flex-col pb-[env(safe-area-inset-bottom)]">
        <div className="bg-gradient-to-br from-brand-600 to-brand-800 px-5 pb-5 pt-[max(1rem,env(safe-area-inset-top))] text-white">
          <div className="flex items-center justify-between gap-3">
            <h2 id="app-menu-title" className="text-sm font-bold">Account &amp; menu</h2>
            <button ref={closeRef} type="button" onClick={onClose} aria-label="Close account menu" className="flex min-h-touch min-w-touch items-center justify-center rounded-xl hover:bg-white/15 focus-visible:outline-white"><X className="h-5 w-5" aria-hidden="true" /></button>
          </div>
          <UserCircle className="mt-1 h-12 w-12 text-brand-100" aria-hidden="true" />
          <p className="mt-3 text-xs text-brand-100">{username ? 'Signed in as' : 'Account'}</p>
          <p className="mt-0.5 break-words text-xl font-bold">{username || 'Not signed in'}</p>
          {role && <span className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-white/15 px-2.5 py-1 text-xs font-semibold capitalize"><ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />{role}</span>}
          <p className="mt-3 break-words text-sm text-brand-100">{orgConfig.orgName || 'SRM Suite'}</p>
        </div>

        <div className="flex-1 overflow-y-auto px-3 py-4">
          <nav aria-label="Main menu" className="space-y-1">
            <button type="button" onClick={onSettings} className="flex min-h-touch w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-sm font-semibold text-slate-700 hover:bg-slate-50"><Settings2 className="h-5 w-5" aria-hidden="true" />Settings &amp; connection</button>
          </nav>

          <div className="mx-1 mt-5 space-y-3 rounded-2xl bg-slate-50 p-4 text-sm ring-1 ring-slate-200">
            <div className="flex items-center gap-2 text-slate-600">{isOnline ? <Wifi className="h-4 w-4" aria-hidden="true" /> : <WifiOff className="h-4 w-4" aria-hidden="true" />}<span>{isOnline ? 'Online' : 'Offline'}</span></div>
            <div className="flex items-center gap-2 text-slate-600"><Database className="h-4 w-4" aria-hidden="true" /><span>{isLive ? 'Google Sheet connected' : 'Google Sheet not connected'}</span></div>
            {canEdit && <>
              <p className="text-xs text-slate-500" role="status">{queue.length ? `${queue.length} attendance record${queue.length === 1 ? '' : 's'} waiting to sync` : 'No attendance waiting to sync'}</p>
              <button type="button" disabled={!isOnline || !isLive || syncStatus.state === 'syncing'} onClick={() => void syncNow()} className="flex min-h-touch w-full items-center justify-center gap-2 rounded-xl bg-white px-3 text-sm font-semibold text-brand-700 ring-1 ring-slate-200 hover:bg-brand-50 disabled:opacity-50"><CloudUpload className="h-4 w-4" aria-hidden="true" />{syncStatus.state === 'syncing' ? 'Syncing…' : queue.length ? 'Sync attendance' : 'Refresh student list'}</button>
              {syncStatus.message && <p role="status" className={cn('text-xs', syncStatus.state === 'error' ? 'text-rose-700' : 'text-slate-600')}>{syncStatus.message}</p>}
            </>}
          </div>
        </div>

        {username && <div className="border-t border-slate-200 px-4 py-4">
          {queue.length > 0 && <p className="mb-3 text-xs text-slate-500">Unsent attendance stays on this device when you log out.</p>}
          <button type="button" onClick={() => { onClose(); logout(); }} className="flex min-h-touch w-full items-center justify-center gap-2 rounded-xl bg-rose-50 px-4 py-3 text-sm font-bold text-rose-700 hover:bg-rose-100"><LogOut className="h-5 w-5" aria-hidden="true" />Log out</button>
        </div>}
      </div>
    </dialog>
  );
}
