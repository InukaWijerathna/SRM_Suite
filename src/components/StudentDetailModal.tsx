import { useEffect, useRef, type ReactNode } from 'react';
import { MapPin, MessageCircle, Phone, X } from 'lucide-react';
import type { ChildRecord, WeightCategory } from '../types';
import { humanize } from '../lib/roster';
import { localPhone, prettyPhone, whatsappNumber } from '../lib/phone';
import { ageFromBirthday, formatDate } from '../lib/time';
import { cn } from '../lib/cn';
import { Avatar } from './Avatar';

const CATEGORY_LABEL: Record<WeightCategory, { label: string; className: string }> = {
  underweight: { label: 'Underweight', className: 'text-orange-700' },
  overweight: { label: 'Overweight', className: 'text-orange-700' },
  healthy: { label: 'Healthy', className: 'text-emerald-700' },
};

const FOCUSABLE = 'a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])';

interface StudentDetailModalProps {
  child: ChildRecord;
  onClose: () => void;
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-t border-slate-100 px-5 py-4">
      <h3 className="mb-3 text-xs font-bold uppercase tracking-wider text-slate-500">{title}</h3>
      {children}
    </section>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="mt-0.5 break-words font-medium text-slate-900">{children || '—'}</dd>
    </div>
  );
}

function Stat({ label, value, unit, className }: { label: string; value?: string; unit?: string; className?: string }) {
  return (
    <div className="rounded-xl bg-slate-50 p-3 text-center ring-1 ring-slate-200">
      <p className="text-xs text-slate-500">{label}</p>
      <p className={cn('mt-0.5 text-lg font-bold tabular-nums text-slate-900', className)}>
        {value ?? '—'}
        {value && unit && <span className="ml-0.5 text-xs font-medium text-slate-500">{unit}</span>}
      </p>
    </div>
  );
}

export function StudentDetailModal({ child, onClose }: StudentDetailModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // Modal behaviour: focus in, Esc closes, Tab stays inside, page behind doesn't scroll,
  // and focus returns to the card that opened it.
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onCloseRef.current();
        return;
      }
      if (e.key !== 'Tab' || !dialogRef.current) return;
      const items = [...dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
      opener?.focus?.();
    };
  }, []);

  const age = child.birthday ? ageFromBirthday(child.birthday) : undefined;
  const primary = localPhone(child.contactPrimary);
  const whatsapp = whatsappNumber(child.contactWhatsapp);
  const category = child.weightCategory ? CATEGORY_LABEL[child.weightCategory] : undefined;

  const linkClass =
    'flex min-h-touch flex-1 items-center justify-center gap-2 rounded-xl px-4 font-semibold transition';

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4">
      <div
        className="absolute inset-0 animate-fade-in bg-slate-900/60"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="student-name"
        className="relative flex max-h-[92dvh] w-full max-w-lg animate-slide-up flex-col overflow-hidden rounded-t-3xl bg-white shadow-2xl sm:rounded-3xl"
      >
        <div className="flex items-start gap-4 px-5 pb-4 pt-5">
          <Avatar child={child} size="lg" />
          <div className="min-w-0 flex-1">
            <h2 id="student-name" className="text-xl font-bold leading-snug text-slate-900">
              {child.fullName}
            </h2>
            {child.nameLocal && <p className="text-sm text-slate-500">{child.nameLocal}</p>}
            <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-slate-500">
              <span className="rounded-md bg-slate-100 px-1.5 py-0.5 font-mono text-xs font-medium text-slate-600">
                {child.childId}
              </span>
              {child.schoolGrade && <span>{humanize(child.schoolGrade)}</span>}
              {child.gender !== 'unknown' && <span className="capitalize">· {child.gender}</span>}
              {age !== undefined && <span>· {age} yrs</span>}
            </p>
            {child.status === 'inactive' && (
              <span className="mt-1.5 inline-block rounded-md bg-slate-200 px-2 py-0.5 text-xs font-semibold text-slate-600">
                Inactive
              </span>
            )}
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="-mr-2 -mt-2 flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-slate-500 hover:bg-slate-100"
          >
            <X className="h-6 w-6" aria-hidden="true" />
          </button>
        </div>

        <div className="overflow-y-auto overscroll-contain">
          <Section title="Contact">
            {primary || whatsapp ? (
              <div className="flex flex-col gap-2 sm:flex-row">
                {primary && (
                  <a
                    href={`tel:${primary}`}
                    className={cn(linkClass, 'bg-brand-600 text-white hover:bg-brand-700')}
                  >
                    <Phone className="h-5 w-5" aria-hidden="true" />
                    {prettyPhone(child.contactPrimary)}
                  </a>
                )}
                {whatsapp && (
                  <a
                    href={`https://wa.me/${whatsapp}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={cn(linkClass, 'bg-emerald-600 text-white hover:bg-emerald-700')}
                  >
                    <MessageCircle className="h-5 w-5" aria-hidden="true" />
                    WhatsApp {whatsapp === whatsappNumber(child.contactPrimary) ? '' : prettyPhone(child.contactWhatsapp)}
                  </a>
                )}
              </div>
            ) : (
              <p className="text-sm text-slate-500">No phone number on record.</p>
            )}
          </Section>

          <Section title="Health">
            <div className="grid grid-cols-4 gap-2">
              <Stat label="Height" value={child.heightCm?.toString()} unit="cm" />
              <Stat label="Weight" value={child.weightKg?.toString()} unit="kg" />
              <Stat label="BMI" value={child.bmi?.toFixed(1)} />
              <Stat label="Status" value={category?.label} className={cn('text-sm leading-7', category?.className)} />
            </div>

            <div
              className={cn(
                'mt-3 rounded-xl p-3 ring-1 ring-inset',
                child.conditions.length ? 'bg-rose-50 ring-rose-200' : 'bg-slate-50 ring-slate-200',
              )}
            >
              <p className="text-xs font-semibold text-slate-600">Medical conditions</p>
              {child.conditions.length ? (
                <ul className="mt-1.5 list-inside list-disc text-sm font-medium text-slate-900">
                  {child.conditions.map((c) => (
                    <li key={c}>{c}</li>
                  ))}
                </ul>
              ) : (
                <p className="mt-1 text-sm text-slate-600">None recorded.</p>
              )}
            </div>
          </Section>

          <Section title="Family">
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
              <Field label="Father">{child.fatherName}</Field>
              <Field label="Mother">{child.motherName}</Field>
              <Field label="Care giver">{humanize(child.careGiver)}</Field>
              <Field label="Religion">{humanize(child.religion)}</Field>
              <Field label="Birthday">{child.birthday ? `${formatDate(child.birthday)}${age !== undefined ? ` (${age} yrs)` : ''}` : undefined}</Field>
            </dl>
          </Section>

          <Section title="Address">
            <p className="flex items-start gap-2 text-sm font-medium text-slate-900">
              <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
              <span>{child.address || '—'}</span>
            </p>
            <p className="mt-2 text-sm text-slate-500">
              GN Division: <span className="font-medium text-slate-900">{child.gnDivision || '—'}</span>
            </p>
            {child.officeName && (
              <p className="mt-1 text-sm text-slate-500">
                Office: <span className="font-medium text-slate-900">{child.officeName}</span>
              </p>
            )}
          </Section>
        </div>
      </div>
    </div>
  );
}
