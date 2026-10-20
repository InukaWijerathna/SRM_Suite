import { memo } from 'react';
import { ChevronRight } from 'lucide-react';
import type { ChildRecord } from '../types';
import { humanize } from '../lib/roster';
import { cn } from '../lib/cn';
import { Avatar } from './Avatar';
import { HealthBadges } from './HealthBadges';

interface StudentCardProps {
  child: ChildRecord;
  onOpen: (child: ChildRecord) => void;
}

export const StudentCard = memo(function StudentCard({ child, onOpen }: StudentCardProps) {
  return (
    <button
      type="button"
      onClick={() => onOpen(child)}
      // content-visibility lets the browser skip layout/paint for off-screen cards (553 rows).
      className={cn(
        'flex min-h-[72px] w-full items-center gap-3 rounded-2xl bg-white p-3 text-left shadow-sm ring-1 ring-slate-200',
        'transition active:scale-[0.99] active:bg-slate-50 hover:ring-brand-500/40',
        '[contain-intrinsic-size:auto_92px] [content-visibility:auto]',
        child.status === 'inactive' && 'opacity-60',
      )}
    >
      <Avatar child={child} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <span className="truncate text-base font-semibold text-slate-900">{child.fullName}</span>
          <span className="rounded-md bg-slate-100 px-1.5 py-0.5 font-mono text-xs font-medium text-slate-600">
            {child.childId}
          </span>
          {child.status === 'inactive' && (
            <span className="rounded-md bg-slate-200 px-1.5 py-0.5 text-xs font-medium text-slate-600">
              Inactive
            </span>
          )}
        </div>
        <p className="mt-0.5 truncate text-sm text-slate-500">
          {[humanize(child.schoolGrade), child.gnDivision].filter(Boolean).join(' · ')}
        </p>
        <HealthBadges child={child} className="mt-1.5" />
      </div>
      <ChevronRight className="h-5 w-5 shrink-0 text-slate-300" aria-hidden="true" />
    </button>
  );
});
