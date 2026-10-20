// Phone formatting is country-aware: the dialing code and national number length come from
// the org's Settings (default: Sri Lanka, 94 / 9 digits). Sheets often turns "0771234567"
// into the number 771234567 and drops the leading zero, so both helpers repair that too.

export interface PhoneFormat {
  /** Dialing code, digits only, e.g. "94". */
  countryCode: string;
  /** Digit count of a national number once the country code is stripped, e.g. 9. */
  nationalLength: number;
}

export const DEFAULT_PHONE_FORMAT: PhoneFormat = { countryCode: '94', nationalLength: 9 };

const digitsOnly = (raw: string) => raw.replace(/\D/g, '');

/** National format for display and tel: links, e.g. "0771234567". */
export function localPhone(raw: string, format: PhoneFormat = DEFAULT_PHONE_FORMAT): string {
  const d = digitsOnly(raw);
  if (!d) return '';
  const { countryCode: cc, nationalLength: n } = format;
  if (d.startsWith(cc) && d.length === cc.length + n) return `0${d.slice(cc.length)}`;
  if (d.length === n) return `0${d}`;
  return d;
}

/** "0771234567" -> "077 123 4567" for display. Falls back to the national digits. */
export function prettyPhone(raw: string, format: PhoneFormat = DEFAULT_PHONE_FORMAT): string {
  const d = localPhone(raw, format);
  const n = format.nationalLength + 1; // +1 for the leading 0
  if (d.length !== n) return d;
  // Group as 3-3-rest, a reasonable default for most 9-10 digit national numbers.
  return `${d.slice(0, 3)} ${d.slice(3, 6)} ${d.slice(6)}`;
}

/** International digits for wa.me links, e.g. "94771234567". */
export function whatsappNumber(raw: string, format: PhoneFormat = DEFAULT_PHONE_FORMAT): string {
  const d = digitsOnly(raw);
  if (!d) return '';
  const { countryCode: cc, nationalLength: n } = format;
  if (d.startsWith(cc) && d.length === cc.length + n) return d;
  if (d.startsWith('0') && d.length === n + 1) return `${cc}${d.slice(1)}`;
  if (d.length === n) return `${cc}${d}`;
  return d;
}
