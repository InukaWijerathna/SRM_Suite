import { useCallback, useDeferredValue, useMemo, useState } from 'react';
import { LoaderCircle, Search, TriangleAlert, X } from 'lucide-react';
import { useApp } from '../context/AppContext';
import type { ChildRecord } from '../types';
import { hasMedicalAlert } from '../lib/health';
import { compareText } from '../lib/roster';
import { cn } from '../lib/cn';
import { StudentCard } from './StudentCard';
import { StudentDetailModal } from './StudentDetailModal';

type Filter = 'all' | 'medical' | 'underweight' | 'overweight';

const FILTERS: { id: Filter; label: string; test: (c: ChildRecord) => boolean }[] = [
  { id: 'all', label: 'All', test: () => true },
  { id: 'medical', label: 'Medical Alert', test: hasMedicalAlert },
  { id: 'underweight', label: 'Underweight', test: (c) => c.weightCategory === 'underweight' },
  { id: 'overweight', label: 'Overweight', test: (c) => c.weightCategory === 'overweight' },
];

export function StudentDirectory() {
  const { students, rosterStatus, refreshRoster } = useApp();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [selected, setSelected] = useState<ChildRecord | null>(null);
  const deferredQuery = useDeferredValue(query);

  // Search runs in memory over the cached roster: no API reads, works offline.
  const index = useMemo(
    () =>
      [...students]
        .sort((a, b) => compareText(a.fullName, b.fullName))
        .map((child) => ({
          child,
          haystack: [
            child.fullName,
            child.nameLocal ?? '',
            child.childId,
            child.gnDivision,
            child.officeName ?? '',
            child.medicalCondition ?? '',
          ]
            .join(' ')
            .toLowerCase(),
        })),
    [students],
  );

  const counts = useMemo(
    () => Object.fromEntries(FILTERS.map((f) => [f.id, students.filter(f.test).length])) as Record<Filter, number>,
    [students],
  );

  const results = useMemo(() => {
    const tokens = deferredQuery.toLowerCase().split(/\s+/).filter(Boolean);
    const test = FILTERS.find((f) => f.id === filter)!.test;
    return index
      .filter(({ child, haystack }) => test(child) && tokens.every((t) => haystack.includes(t)))
      .map(({ child }) => child);
  }, [index, deferredQuery, filter]);

  const closeModal = useCallback(() => setSelected(null), []);

  if (students.length === 0) {
    return rosterStatus.state === 'error' ? (
      <div className="mx-4 mt-10 rounded-2xl bg-white p-6 text-center shadow-sm ring-1 ring-slate-200">
        <TriangleAlert className="mx-auto h-8 w-8 text-amber-500" aria-hidden="true" />
        <p className="mt-3 font-semibold text-slate-900">Couldn&apos;t load students</p>
        <p className="mt-1 text-sm text-slate-500">{rosterStatus.error}</p>
        <button
          type="button"
          onClick={() => void refreshRoster()}
          className="mt-4 min-h-touch rounded-xl bg-brand-600 px-5 font-semibold text-white hover:bg-brand-700"
        >
          Try again
        </button>
      </div>
    ) : (
      <div className="mt-24 flex flex-col items-center gap-3 text-slate-500" role="status">
        <LoaderCircle className="h-8 w-8 animate-spin text-brand-600" aria-hidden="true" />
        <p className="text-sm">Loading students…</p>
      </div>
    );
  }

  return (
    <section aria-label="Student directory" className="px-4 pb-10 pt-4">
      <div className="sticky top-[var(--header-h,0px)] z-10 -mx-4 bg-slate-50/95 px-4 pb-2 pt-1 backdrop-blur">
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400"
            aria-hidden="true"
          />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Name, ID, GN division, condition"
            aria-label="Search students"
            autoComplete="off"
            enterKeyHint="search"
            className="min-h-touch w-full rounded-2xl border-0 bg-white pl-11 pr-12 text-base text-slate-900 shadow-sm ring-1 ring-slate-300 placeholder:text-slate-400 focus:ring-2 focus:ring-brand-600 [&::-webkit-search-cancel-button]:hidden"
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
      </div>

      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 pt-1" role="group" aria-label="Filters">
        {FILTERS.map((f) => {
          const active = filter === f.id;
          return (
            <button
              key={f.id}
              type="button"
              aria-pressed={active}
              onClick={() => setFilter(f.id)}
              className={cn(
                'flex min-h-touch shrink-0 items-center gap-2 rounded-full px-4 text-sm font-semibold ring-1 ring-inset transition',
                active
                  ? 'bg-brand-600 text-white ring-brand-600'
                  : 'bg-white text-slate-700 ring-slate-300 hover:bg-slate-100',
              )}
            >
              {f.label}
              <span
                className={cn(
                  'rounded-full px-1.5 text-xs tabular-nums',
                  active ? 'bg-white/25' : 'bg-slate-100 text-slate-500',
                )}
              >
                {counts[f.id]}
              </span>
            </button>
          );
        })}
      </div>

      <p className="mb-2 mt-2 text-xs text-slate-500" role="status">
        Showing {results.length} of {students.length} students
      </p>

      {results.length === 0 ? (
        <p className="mt-12 text-center text-slate-500">No students match your search.</p>
      ) : (
        <ul className="space-y-2.5">
          {results.map((child) => (
            <li key={child.childId}>
              <StudentCard child={child} onOpen={setSelected} />
            </li>
          ))}
        </ul>
      )}

      {selected && <StudentDetailModal child={selected} onClose={closeModal} />}
    </section>
  );
}
