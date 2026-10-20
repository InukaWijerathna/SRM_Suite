import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { CircleAlert, LoaderCircle, MapPin, MessageCircle, Pencil, Phone, Save, X } from 'lucide-react';
import type { ChildRecord, Gender, StudentEdit, StudentStatus, WeightCategory } from '../types';
import { humanize } from '../lib/roster';
import { localPhone, prettyPhone, whatsappNumber } from '../lib/phone';
import { ageFromBirthday, formatDate } from '../lib/time';
import { cn } from '../lib/cn';
import { useApp } from '../context/AppContext';
import { useBackHandler } from '../lib/backButton';
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
  const [editing, setEditing] = useState(false);
  // Android back button: close edit mode first if it's open, same as Cancel; otherwise close
  // the whole modal, same as the X button.
  useBackHandler(useCallback(() => (editing ? setEditing(false) : onClose()), [editing, onClose]));

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

  const { phoneFormat, students } = useApp();
  // Re-derive from live roster state (not just the prop) so a saved edit shows immediately.
  const current = students.find((s) => s.childId === child.childId) ?? child;
  const age = current.birthday ? ageFromBirthday(current.birthday) : undefined;
  const primary = localPhone(current.contactPrimary, phoneFormat);
  const whatsapp = whatsappNumber(current.contactWhatsapp, phoneFormat);
  const category = current.weightCategory ? CATEGORY_LABEL[current.weightCategory] : undefined;

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
          <Avatar child={current} size="lg" />
          <div className="min-w-0 flex-1">
            <h2 id="student-name" className="text-xl font-bold leading-snug text-slate-900">
              {current.fullName}
            </h2>
            {current.nameLocal && <p className="text-sm text-slate-500">{current.nameLocal}</p>}
            <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-slate-500">
              <span className="rounded-md bg-slate-100 px-1.5 py-0.5 font-mono text-xs font-medium text-slate-600">
                {current.childId}
              </span>
              {current.schoolGrade && <span>{humanize(current.schoolGrade)}</span>}
              {current.gender !== 'unknown' && <span className="capitalize">· {current.gender}</span>}
              {age !== undefined && <span>· {age} yrs</span>}
            </p>
            {current.status === 'inactive' && (
              <span className="mt-1.5 inline-block rounded-md bg-slate-200 px-2 py-0.5 text-xs font-semibold text-slate-600">
                Inactive
              </span>
            )}
          </div>
          {!editing && (
            <button
              type="button"
              onClick={() => setEditing(true)}
              aria-label="Edit student"
              className="-mt-2 flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-slate-500 hover:bg-slate-100"
            >
              <Pencil className="h-5 w-5" aria-hidden="true" />
            </button>
          )}
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

        {editing ? (
          <StudentEditForm child={current} onCancel={() => setEditing(false)} onSaved={() => setEditing(false)} />
        ) : (
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
                      {prettyPhone(current.contactPrimary, phoneFormat)}
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
                      WhatsApp{' '}
                      {whatsapp === whatsappNumber(current.contactPrimary, phoneFormat)
                        ? ''
                        : prettyPhone(current.contactWhatsapp, phoneFormat)}
                    </a>
                  )}
                </div>
              ) : (
                <p className="text-sm text-slate-500">No phone number on record.</p>
              )}
            </Section>

            <Section title="Health">
              <div className="grid grid-cols-4 gap-2">
                <Stat label="Height" value={current.heightCm?.toString()} unit="cm" />
                <Stat label="Weight" value={current.weightKg?.toString()} unit="kg" />
                <Stat label="BMI" value={current.bmi?.toFixed(1)} />
                <Stat label="Status" value={category?.label} className={cn('text-sm leading-7', category?.className)} />
              </div>

              <div
                className={cn(
                  'mt-3 rounded-xl p-3 ring-1 ring-inset',
                  current.conditions.length ? 'bg-rose-50 ring-rose-200' : 'bg-slate-50 ring-slate-200',
                )}
              >
                <p className="text-xs font-semibold text-slate-600">Medical conditions</p>
                {current.conditions.length ? (
                  <ul className="mt-1.5 list-inside list-disc text-sm font-medium text-slate-900">
                    {current.conditions.map((c) => (
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
                <Field label="Father">{current.fatherName}</Field>
                <Field label="Mother">{current.motherName}</Field>
                <Field label="Care giver">{humanize(current.careGiver)}</Field>
                <Field label="Religion">{humanize(current.religion)}</Field>
                <Field label="Birthday">
                  {current.birthday ? `${formatDate(current.birthday)}${age !== undefined ? ` (${age} yrs)` : ''}` : undefined}
                </Field>
              </dl>
            </Section>

            <Section title="Address">
              <p className="flex items-start gap-2 text-sm font-medium text-slate-900">
                <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
                <span>{current.address || '—'}</span>
              </p>
              <p className="mt-2 text-sm text-slate-500">
                GN Division: <span className="font-medium text-slate-900">{current.gnDivision || '—'}</span>
              </p>
              {current.officeName && (
                <p className="mt-1 text-sm text-slate-500">
                  Office: <span className="font-medium text-slate-900">{current.officeName}</span>
                </p>
              )}
            </Section>
          </div>
        )}
      </div>
    </div>
  );
}

// ---- Edit mode --------------------------------------------------------------------------

const inputClass =
  'mt-1 min-h-touch w-full rounded-xl border-0 bg-slate-50 px-3.5 text-base shadow-sm ring-1 ring-slate-300 placeholder:text-slate-400 focus:ring-2 focus:ring-brand-600';
const labelClass = 'block text-xs font-semibold text-slate-600';

function editStateFrom(child: ChildRecord, conditionKeys: Record<string, boolean>): StudentEdit {
  return {
    fullName: child.fullName,
    gender: child.gender,
    schoolGrade: child.schoolGrade,
    address: child.address,
    gnDivision: child.gnDivision,
    contactPrimary: child.contactPrimary,
    contactWhatsapp: child.contactWhatsapp,
    fatherName: child.fatherName,
    motherName: child.motherName,
    careGiver: child.careGiver,
    religion: child.religion,
    status: child.status,
    birthday: child.birthday ?? '',
    nameLocal: child.nameLocal ?? '',
    officeName: child.officeName ?? '',
    weightKg: child.weightKg?.toString() ?? '',
    heightCm: child.heightCm?.toString() ?? '',
    conditionKeys,
  };
}

function StudentEditForm({
  child,
  onCancel,
  onSaved,
}: {
  child: ChildRecord;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const { conditionColumns, updateStudent } = useApp();
  const initialKeys = Object.fromEntries(conditionColumns.map((c) => [c.key, child.conditions.includes(c.label)]));
  const [edit, setEdit] = useState<StudentEdit>(() => editStateFrom(child, initialKeys));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = <K extends keyof StudentEdit>(key: K, value: StudentEdit[K]) =>
    setEdit((prev) => ({ ...prev, [key]: value }));

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await updateStudent(child.childId, edit);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="overflow-y-auto overscroll-contain">
      <Section title="Identity">
        <div className="space-y-3">
          <label className="block">
            <span className={labelClass}>Full name</span>
            <input required value={edit.fullName} onChange={(e) => set('fullName', e.target.value)} className={inputClass} />
          </label>
          <label className="block">
            <span className={labelClass}>Name in local script</span>
            <input value={edit.nameLocal} onChange={(e) => set('nameLocal', e.target.value)} className={inputClass} />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className={labelClass}>Gender</span>
              <select value={edit.gender} onChange={(e) => set('gender', e.target.value as Gender)} className={inputClass}>
                <option value="male">Male</option>
                <option value="female">Female</option>
                <option value="unknown">Unknown</option>
              </select>
            </label>
            <label className="block">
              <span className={labelClass}>Birthday</span>
              <input
                type="date"
                value={edit.birthday}
                onChange={(e) => set('birthday', e.target.value)}
                className={inputClass}
              />
            </label>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className={labelClass}>Grade</span>
              <input value={edit.schoolGrade} onChange={(e) => set('schoolGrade', e.target.value)} className={inputClass} />
            </label>
            <label className="block">
              <span className={labelClass}>Status</span>
              <select
                value={edit.status}
                onChange={(e) => set('status', e.target.value as StudentStatus)}
                className={inputClass}
              >
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>
            </label>
          </div>
        </div>
      </Section>

      <Section title="Contact">
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className={labelClass}>Phone</span>
            <input
              type="tel"
              value={edit.contactPrimary}
              onChange={(e) => set('contactPrimary', e.target.value)}
              className={inputClass}
            />
          </label>
          <label className="block">
            <span className={labelClass}>WhatsApp</span>
            <input
              type="tel"
              value={edit.contactWhatsapp}
              onChange={(e) => set('contactWhatsapp', e.target.value)}
              className={inputClass}
            />
          </label>
        </div>
      </Section>

      <Section title="Health">
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className={labelClass}>Weight (kg)</span>
            <input
              type="number"
              inputMode="decimal"
              value={edit.weightKg}
              onChange={(e) => set('weightKg', e.target.value)}
              className={inputClass}
            />
          </label>
          <label className="block">
            <span className={labelClass}>Height (cm)</span>
            <input
              type="number"
              inputMode="decimal"
              value={edit.heightCm}
              onChange={(e) => set('heightCm', e.target.value)}
              className={inputClass}
            />
          </label>
        </div>
        {conditionColumns.length > 0 && (
          <div className="mt-3">
            <span className={labelClass}>Medical conditions</span>
            <div className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-2">
              {conditionColumns.map((c) => (
                <label key={c.key} className="flex min-h-touch items-center gap-2 text-sm text-slate-800">
                  <input
                    type="checkbox"
                    checked={!!edit.conditionKeys[c.key]}
                    onChange={(e) => set('conditionKeys', { ...edit.conditionKeys, [c.key]: e.target.checked })}
                    className="h-5 w-5 shrink-0 rounded border-slate-300 text-brand-600 focus:ring-brand-600"
                  />
                  {c.label}
                </label>
              ))}
            </div>
          </div>
        )}
      </Section>

      <Section title="Family">
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className={labelClass}>Father</span>
              <input value={edit.fatherName} onChange={(e) => set('fatherName', e.target.value)} className={inputClass} />
            </label>
            <label className="block">
              <span className={labelClass}>Mother</span>
              <input value={edit.motherName} onChange={(e) => set('motherName', e.target.value)} className={inputClass} />
            </label>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className={labelClass}>Care giver</span>
              <input value={edit.careGiver} onChange={(e) => set('careGiver', e.target.value)} className={inputClass} />
            </label>
            <label className="block">
              <span className={labelClass}>Religion</span>
              <input value={edit.religion} onChange={(e) => set('religion', e.target.value)} className={inputClass} />
            </label>
          </div>
        </div>
      </Section>

      <Section title="Address">
        <div className="space-y-3">
          <label className="block">
            <span className={labelClass}>Address</span>
            <input value={edit.address} onChange={(e) => set('address', e.target.value)} className={inputClass} />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className={labelClass}>GN Division</span>
              <input value={edit.gnDivision} onChange={(e) => set('gnDivision', e.target.value)} className={inputClass} />
            </label>
            <label className="block">
              <span className={labelClass}>Office</span>
              <input value={edit.officeName} onChange={(e) => set('officeName', e.target.value)} className={inputClass} />
            </label>
          </div>
        </div>
      </Section>

      <div className="border-t border-slate-100 px-5 py-4">
        {error && (
          <p className="mb-3 flex items-start gap-1.5 text-sm font-medium text-rose-700" role="alert">
            <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            {error}
          </p>
        )}
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={saving}
            className="flex-1 min-h-touch rounded-xl bg-white px-4 font-semibold text-slate-700 ring-1 ring-inset ring-slate-300 hover:bg-slate-50 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving}
            className="flex flex-1 min-h-touch items-center justify-center gap-2 rounded-xl bg-brand-600 px-4 font-bold text-white hover:bg-brand-700 disabled:opacity-60"
          >
            {saving ? (
              <LoaderCircle className="h-5 w-5 animate-spin" aria-hidden="true" />
            ) : (
              <Save className="h-5 w-5" aria-hidden="true" />
            )}
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </form>
  );
}
