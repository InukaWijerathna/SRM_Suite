import { memo, useMemo, useState } from 'react';
import { CheckCheck, CloudOff, Eraser, LoaderCircle, Search, Send, X } from 'lucide-react';
import { useApp } from '../context/AppContext';
import type { AttendanceStatus, ChildRecord } from '../types';
import { hasMedicalAlert } from '../lib/health';
import { compareText, humanize } from '../lib/roster';
import { cn } from '../lib/cn';

const OPTIONS: {
  status: AttendanceStatus;
  selected: string;
  idle: string;
  row: string;
}[] = [
  {
    status: 'Present',
    selected: 'bg-emerald-600 text-white ring-emerald-600',
    idle: 'text-emerald-800 hover:bg-emerald-50',
    row: 'bg-emerald-50/60',
  },
  {
    status: 'Late',
    selected: 'bg-amber-400 text-amber-950 ring-amber-400',
    idle: 'text-amber-800 hover:bg-amber-50',
    row: 'bg-amber-50/70',
  },
  {
    status: 'Absent',
    selected: 'bg-rose-600 text-white ring-rose-600',
    idle: 'text-rose-800 hover:bg-rose-50',
    row: 'bg-rose-50/60',
  },
];

interface RowProps {
  child: ChildRecord;
  status?: AttendanceStatus;
  pending: boolean;
  onToggle: (childId: string, status: AttendanceStatus) => void;
}

// Row props are primitives + stable callbacks so memo() skips the ~550 untouched rows
// each time one child is toggled.
const AttendanceRow = memo(function AttendanceRow({ child, status, pending, onToggle }: RowProps) {
  const tint = OPTIONS.find((o) => o.status === status)?.row ?? 'bg-white';

  return (
    <li className={cn('rounded-2xl p-3 shadow-sm ring-1 ring-slate-200 transition-colors', tint)}>
      <div className="mb-2.5 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="flex items-center gap-2">
            <span className="truncate text-base font-semibold text-slate-900">{child.fullName}</span>
            {hasMedicalAlert(child) && (
              <span
                title={child.medicalCondition}
                className="shrink-0 rounded-full bg-rose-100 px-1.5 py-0.5 text-[11px] font-bold text-rose-700 ring-1 ring-inset ring-rose-300"
              >
                Medical
              </span>
            )}
          </p>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-slate-500">
            <span className="font-mono">{child.childId}</span>
            <span>{humanize(child.schoolGrade)}</span>
          </p>
        </div>
        {status && (
          <span
            className={cn(
              'shrink-0 text-[11px] font-semibold uppercase tracking-wide',
              pending ? 'text-slate-500' : 'text-emerald-700',
            )}
          >
            {pending ? 'Queued' : 'Synced'}
          </span>
        )}
      </div>

      <div className="grid grid-cols-3 gap-2" role="group" aria-label={`Attendance for ${child.fullName}`}>
        {OPTIONS.map((o) => {
          const active = status === o.status;
          return (
            <button
              key={o.status}
              type="button"
              aria-pressed={active}
              onClick={() => onToggle(child.childId, o.status)}
              className={cn(
                'min-h-[52px] rounded-xl bg-white text-[15px] font-bold ring-1 ring-inset ring-slate-300 transition active:scale-95',
                active ? o.selected : o.idle,
              )}
            >
              {o.status}
            </button>
          );
        })}
      </div>
    </li>
  );
});

export function AttendanceList() {
  const { students, marks, queue, toggleMark, markAllPresent, clearPending, syncNow, syncStatus, isOnline } =
    useApp();
  const [query, setQuery] = useState('');

  // Active students ordered by GN division, then name.
  const active = useMemo(
    () =>
      students
        .filter((s) => s.status === 'active')
        .sort((a, b) => compareText(a.gnDivision, b.gnDivision) || compareText(a.fullName, b.fullName)),
    [students],
  );

  const visible = useMemo(() => {
    const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (tokens.length === 0) return active;
    return active.filter((s) => {
      const hay = `${s.fullName} ${s.childId}`.toLowerCase();
      return tokens.every((t) => hay.includes(t));
    });
  }, [active, query]);

  const groups = useMemo(() => {
    const out: { division: string; items: ChildRecord[] }[] = [];
    for (const child of visible) {
      const division = child.gnDivision || 'No GN division';
      const last = out[out.length - 1];
      if (last && last.division === division) last.items.push(child);
      else out.push({ division, items: [child] });
    }
    return out;
  }, [visible]);

  const totals = useMemo(() => {
    const t = { Present: 0, Late: 0, Absent: 0, pending: 0 };
    for (const s of active) {
      const m = marks.get(s.childId);
      if (m) t[m.status]++;
      else t.pending++;
    }
    return t;
  }, [active, marks]);

  const filtering = query.trim() !== '';
  const syncing = syncStatus.state === 'syncing';

  const handleMarkAll = () => {
    const ids = visible.map((s) => s.childId);
    const overwritten = visible.filter((s) => {
      const m = marks.get(s.childId);
      return m?.pending && m.status !== 'Present';
    }).length;
    if (overwritten > 0 && !window.confirm(`${overwritten} Late/Absent mark(s) will be changed to Present. Continue?`)) {
      return;
    }
    markAllPresent(ids);
  };

  const handleClear = () => {
    const ids = visible.filter((s) => marks.get(s.childId)?.pending).map((s) => s.childId);
    if (ids.length === 0) return;
    if (window.confirm(`Clear ${ids.length} unsubmitted mark(s)?`)) clearPending(ids);
  };

  if (active.length === 0) {
    return <p className="mt-16 px-4 text-center text-slate-500">No active students to mark yet.</p>;
  }

  return (
    <section aria-label="Rapid attendance" className="pb-4">
      <div className="space-y-3 px-4 pt-4">
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400"
            aria-hidden="true"
          />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Find a student by name or ID"
            aria-label="Find a student"
            autoComplete="off"
            className="min-h-touch w-full rounded-2xl border-0 bg-white pl-11 pr-12 text-base shadow-sm ring-1 ring-slate-300 placeholder:text-slate-400 focus:ring-2 focus:ring-brand-600 [&::-webkit-search-cancel-button]:hidden"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery('')}
              aria-label="Clear search"
              className="absolute right-1 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full text-slate-400 hover:text-slate-700"
            >
              <X className="h-5 w-5" aria-hidden="true" />
            </button>
          )}
        </div>

        <div className="grid grid-cols-[1fr_auto] gap-2">
          <button
            type="button"
            onClick={handleMarkAll}
            disabled={visible.length === 0}
            className="flex min-h-touch items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 font-bold text-white transition hover:bg-emerald-700 active:scale-[0.98] disabled:opacity-50"
          >
            <CheckCheck className="h-5 w-5" aria-hidden="true" />
            {filtering ? `Mark ${visible.length} Shown Present` : 'Mark All Present'}
          </button>
          <button
            type="button"
            onClick={handleClear}
            className="flex min-h-touch items-center justify-center gap-2 rounded-xl bg-white px-4 font-bold text-slate-700 ring-1 ring-inset ring-slate-300 transition hover:bg-slate-100 active:scale-[0.98]"
          >
            <Eraser className="h-5 w-5" aria-hidden="true" />
            Clear All
          </button>
        </div>
      </div>

      {visible.length === 0 ? (
        <p className="mt-12 text-center text-slate-500">No students match &ldquo;{query}&rdquo;.</p>
      ) : (
        <div className="mt-2 space-y-5 px-4">
          {groups.map((g) => {
            const marked = g.items.filter((c) => marks.has(c.childId)).length;
            return (
              <div key={g.division}>
                <h2 className="sticky top-[var(--header-h,0px)] z-10 -mx-4 mb-2 flex items-baseline justify-between bg-slate-100/95 px-4 py-1.5 text-xs font-bold uppercase tracking-wider text-slate-600 backdrop-blur">
                  <span>{g.division}</span>
                  <span className="font-semibold normal-case tracking-normal tabular-nums">
                    {marked}/{g.items.length} marked
                  </span>
                </h2>
                <ul className="space-y-2.5">
                  {g.items.map((child) => {
                    const mark = marks.get(child.childId);
                    return (
                      <AttendanceRow
                        key={child.childId}
                        child={child}
                        status={mark?.status}
                        pending={mark?.pending ?? false}
                        onToggle={toggleMark}
                      />
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </div>
      )}

      <footer className="sticky bottom-0 z-20 mt-6 border-t border-slate-200 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-4 py-2.5">
          <dl className="grid flex-1 grid-cols-2 gap-x-3 text-xs font-semibold tabular-nums">
            <div className="flex justify-between text-emerald-700">
              <dt>Present</dt>
              <dd>{totals.Present}</dd>
            </div>
            <div className="flex justify-between text-rose-700">
              <dt>Absent</dt>
              <dd>{totals.Absent}</dd>
            </div>
            <div className="flex justify-between text-amber-700">
              <dt>Late</dt>
              <dd>{totals.Late}</dd>
            </div>
            <div className="flex justify-between text-slate-600">
              <dt>Pending</dt>
              <dd>{totals.pending}</dd>
            </div>
          </dl>

          <button
            type="button"
            onClick={() => void syncNow()}
            disabled={queue.length === 0 || syncing || !isOnline}
            className="flex min-h-[52px] shrink-0 items-center justify-center gap-2 rounded-xl bg-brand-600 px-5 font-bold text-white shadow-sm transition hover:bg-brand-700 active:scale-[0.98] disabled:bg-slate-300 disabled:text-slate-500"
          >
            {syncing ? (
              <LoaderCircle className="h-5 w-5 animate-spin" aria-hidden="true" />
            ) : !isOnline ? (
              <CloudOff className="h-5 w-5" aria-hidden="true" />
            ) : (
              <Send className="h-5 w-5" aria-hidden="true" />
            )}
            {!isOnline ? 'Offline' : syncing ? 'Saving…' : 'Save & Submit'}
          </button>
        </div>
      </footer>
    </section>
  );
}
