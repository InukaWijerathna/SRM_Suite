import { CircleAlert, CircleCheck, CloudUpload, LoaderCircle, RefreshCw } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { clockTime } from '../lib/time';
import { cn } from '../lib/cn';

/**
 * Header button. With unsubmitted marks it reads "Sync 12 Records" and posts them in one
 * batch; with nothing queued it is a plain "Sync" that refreshes the student list.
 */
export function SyncButton() {
  const { queue, syncStatus, syncNow, rosterStatus } = useApp();
  const pending = queue.length;
  const busy = syncStatus.state === 'syncing' || (pending === 0 && rosterStatus.state === 'loading');

  const label =
    pending > 0 ? `Sync ${pending} Record${pending === 1 ? '' : 's'}` : 'Sync';

  return (
    <button
      type="button"
      onClick={() => void syncNow()}
      disabled={busy}
      className={cn(
        'flex min-h-touch items-center gap-2 rounded-xl px-3.5 text-sm font-semibold transition',
        'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white',
        pending > 0
          ? 'bg-white text-brand-700 shadow-sm hover:bg-brand-50'
          : 'bg-white/15 text-white hover:bg-white/25',
        busy && 'opacity-80',
      )}
    >
      {busy ? (
        <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />
      ) : pending > 0 ? (
        <CloudUpload className="h-4 w-4" aria-hidden="true" />
      ) : (
        <RefreshCw className="h-4 w-4" aria-hidden="true" />
      )}
      <span>{label}</span>
    </button>
  );
}

/** Slim status strip under the tabs: sync result, roster freshness and the auto-sync switch. */
export function SyncBar() {
  const { syncStatus, rosterStatus, autoSync, setAutoSync, isOnline, students } = useApp();

  let tone: 'ok' | 'error' | 'busy' | 'neutral' = 'neutral';
  let text = '';
  if (syncStatus.state === 'syncing') {
    tone = 'busy';
    text = 'Syncing…';
  } else if (syncStatus.state === 'error') {
    tone = 'error';
    text = syncStatus.message ?? 'Sync failed';
  } else if (rosterStatus.error && students.length > 0) {
    tone = 'error';
    text = `Couldn't refresh the student list (${rosterStatus.error}). Using saved copy.`;
  } else if (syncStatus.message) {
    tone = 'ok';
    text = syncStatus.message;
  } else if (rosterStatus.fetchedAt) {
    text = `Student list updated ${clockTime(rosterStatus.fetchedAt)} · ${students.length} students`;
  }

  return (
    <div
      className={cn(
        'border-t border-white/10 text-xs',
        tone === 'error' && 'bg-rose-50 text-rose-800',
        tone === 'ok' && 'bg-emerald-50 text-emerald-800',
        tone === 'busy' && 'bg-brand-50 text-brand-800',
        tone === 'neutral' && 'bg-white text-slate-500',
      )}
    >
      <div className="mx-auto flex min-h-9 max-w-3xl items-center justify-between gap-3 px-4 py-1">
        <p className="flex min-w-0 items-center gap-1.5" role="status" aria-live="polite">
          {tone === 'error' && <CircleAlert className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />}
          {tone === 'ok' && <CircleCheck className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />}
          {tone === 'busy' && <LoaderCircle className="h-3.5 w-3.5 shrink-0 animate-spin" aria-hidden="true" />}
          <span className="truncate">{text || (isOnline ? 'Ready' : 'Offline')}</span>
        </p>

        <label className="flex shrink-0 cursor-pointer items-center gap-2 py-1 font-medium">
          <span>Auto-sync</span>
          <input
            type="checkbox"
            role="switch"
            checked={autoSync}
            onChange={(e) => setAutoSync(e.target.checked)}
            className="peer sr-only"
          />
          <span
            aria-hidden="true"
            className={cn(
              'relative h-5 w-9 rounded-full bg-slate-300 transition-colors',
              'after:absolute after:left-0.5 after:top-0.5 after:h-4 after:w-4 after:rounded-full after:bg-white after:shadow after:transition-transform',
              'peer-checked:bg-emerald-500 peer-checked:after:translate-x-4',
              'peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-brand-600',
            )}
          />
        </label>
      </div>
    </div>
  );
}
