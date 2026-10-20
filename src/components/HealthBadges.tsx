import { HeartPulse, TriangleAlert } from 'lucide-react';
import type { ChildRecord } from '../types';
import { healthBadges, type BadgeTone } from '../lib/health';
import { cn } from '../lib/cn';

const TONE: Record<BadgeTone, string> = {
  critical: 'bg-rose-100 text-rose-800 ring-rose-300',
  warning: 'bg-orange-100 text-orange-800 ring-orange-300',
  info: 'bg-violet-100 text-violet-800 ring-violet-300',
};

interface HealthBadgesProps {
  child: ChildRecord;
  className?: string;
}

/** Pill badges: red for serious conditions (Heart Disease), orange for Under Weight etc. */
export function HealthBadges({ child, className }: HealthBadgesProps) {
  const badges = healthBadges(child);
  if (badges.length === 0) return null;

  return (
    <ul className={cn('flex flex-wrap gap-1.5', className)} aria-label="Health alerts">
      {badges.map((b) => (
        <li
          key={b.key}
          className={cn(
            'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ring-inset',
            TONE[b.tone],
          )}
        >
          {b.tone === 'critical' ? (
            <HeartPulse className="h-3 w-3" aria-hidden="true" />
          ) : (
            <TriangleAlert className="h-3 w-3" aria-hidden="true" />
          )}
          {b.label}
        </li>
      ))}
    </ul>
  );
}
