/** `YYYY-MM-DDTHH:mm:ssZ` (no milliseconds), the format the attendance_logs tab expects. */
export function isoNow(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/** Local calendar day of a timestamp, e.g. "2026-09-24". Marks are per local day. */
export function dayKey(input: string | Date): string {
  const d = typeof input === 'string' ? new Date(input) : input;
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

/** Local "HH:MM" for banners like "Already scanned at 08:14". */
export function clockTime(input: string | Date): string {
  const d = typeof input === 'string' ? new Date(input) : input;
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** "2016-06-17" -> "17 Jun 2016". Falls back to the raw value if it doesn't parse. */
export function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

/** Whole years between a birthday and today (or `asOf`, for tests). Undefined if unparseable. */
export function ageFromBirthday(iso: string, asOf: Date = new Date()): number | undefined {
  const dob = new Date(iso);
  if (Number.isNaN(dob.getTime())) return undefined;
  let age = asOf.getFullYear() - dob.getFullYear();
  const beforeBirthdayThisYear =
    asOf.getMonth() < dob.getMonth() || (asOf.getMonth() === dob.getMonth() && asOf.getDate() < dob.getDate());
  if (beforeBirthdayThisYear) age--;
  return age >= 0 && age < 120 ? age : undefined;
}

/**
 * Unique ID for an attendance log row. crypto.randomUUID only exists in secure contexts,
 * and the app is often opened over plain http on a LAN, so fall back to a random hash.
 */
export function newLogId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  const rand = () => Math.floor(Math.random() * 0x100000000).toString(16).padStart(8, '0');
  return `${Date.now().toString(36)}-${rand()}${rand()}`;
}
