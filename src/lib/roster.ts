import type { ChildRecord, Gender, SheetRow, WeightCategory } from '../types';

const text = (v: unknown): string => (v == null ? '' : String(v).trim());

const isBlank = (v: unknown): boolean => v == null || (typeof v === 'string' && v.trim() === '');

const num = (v: unknown): number | undefined => {
  const s = text(v).replace(',', '.');
  if (!s) return undefined;
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
};

/** "LKA0060410 " / "lka0060410" -> "LKA0060410". Used for every ID comparison. */
export const normalizeId = (v: unknown): string => text(v).toUpperCase().replace(/\s+/g, '');

/** The sheet has used "Underweight", "Under Weight", "under_weight", "healthy_weight"... */
export function normalizeWeightCategory(raw: unknown): WeightCategory | undefined {
  const key = text(raw).toLowerCase().replace(/[^a-z]/g, '');
  if (key.startsWith('under')) return 'underweight';
  if (key.startsWith('over')) return 'overweight';
  if (key.startsWith('healthy') || key.startsWith('normal')) return 'healthy';
  return undefined;
}

// ---- Header names ---------------------------------------------------------------------
// The sheet's headers are Title_Case ("Name_of_Child", "Father_s_Name", "Height_cm"), older
// ones were snake_case ("full_name"). Both work: every header is reduced to a lowercase,
// underscore-separated key and matched against these aliases.

const ALIASES: Record<string, string[]> = {
  full_name: ['full_name', 'name_of_child', 'child_name', 'child_name_english', 'name'],
  gender: ['gender', 'sex'],
  school_grade: ['school_grade', 'grade'],
  address: ['address'],
  gn_division: ['gn_division', 'gn'],
  contact_primary: ['contact_primary', 'contact_number', 'contact', 'phone', 'phone_number'],
  contact_whatsapp: ['contact_whatsapp', 'whatsapp_number', 'whatsapp'],
  father_name: ['father_name', 'father_s_name', 'fathers_name', 'father'],
  mother_name: ['mother_name', 'mother_s_name', 'mothers_name', 'mother'],
  care_giver: ['care_giver', 'caregiver'],
  religion: ['religion'],
  picture_ref: ['picture_ref', 'picture', 'photo'],
  status: ['status'],
  office_name: ['office_name', 'office'],
  birthday: ['birthday', 'date_of_birth', 'dob', 'birth_date'],
  // "In B.C" in the source register: the child's name as on the Birth Certificate, usually
  // in the local script. Often blank; shown alongside the English name when present.
  name_local: [
    'child_name_in_bc', 'child_name_in_b_c', 'name_in_bc', 'name_in_b_c',
    'child_name_local', 'local_name', 'name_local',
  ],
  weight_kg: ['weight_kg', 'weight'],
  height_cm: ['height_cm', 'height'],
  bmi: ['bmi', 'body_mass_index_bmi', 'body_mass_index'],
  weight_category: ['weight_category'],
  // Free-text condition lists ("Heart Disease, Respiratory"). Optional next to the
  // TRUE/FALSE condition columns.
  medical_condition: ['medical_condition', 'medical_conditions'],
  health: ['health'],
  disability: ['disability', 'disabilities'],
};

const CONDITION_TEXT_FIELDS = ['medical_condition', 'health', 'disability'] as const;

const ALIAS_TO_FIELD = new Map<string, string>();
for (const [field, names] of Object.entries(ALIASES)) {
  for (const name of names) ALIAS_TO_FIELD.set(name, field);
}
const KNOWN_FIELDS = new Set(['child_id', ...Object.keys(ALIASES)]);

const normalizeKey = (header: string) =>
  header.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');

// Matches "child_id", "childid", "chid_id" (a typo seen in a real register) and
// "Child_ID_LKA006XXXX_4_digits"-style headers with a suffix.
const ID_HEADER = /^chi?l?d?_id/;

function canonicalKey(header: string): string {
  const key = normalizeKey(header);
  if (ID_HEADER.test(key)) return 'child_id';
  return ALIAS_TO_FIELD.get(key) ?? key;
}

type Row = Record<string, unknown>;

function canonicalizeRow(row: SheetRow): Row {
  const out: Row = {};
  for (const [header, value] of Object.entries(row)) {
    const key = canonicalKey(header);
    if (isBlank(out[key])) out[key] = value; // two headers for one field: first non-blank wins
  }
  return out;
}

// ---- Medical conditions ---------------------------------------------------------------
// A condition is a column of TRUE/FALSE, one column per condition, so a child can have
// several. Any column that is not a known field and holds only TRUE/FALSE (blank = FALSE)
// counts, so adding a condition is just adding a column: no code change.

const NONE_VALUES = new Set(['none', 'n/a', 'na', 'nil', 'no', '-', '--', 'null']);

/** Real booleans (Sheets/Excel) and the strings "TRUE"/"FALSE"; deliberately not 1/0. */
function asBool(v: unknown): boolean | undefined {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'string') {
    const t = v.trim().toLowerCase();
    if (t === 'true') return true;
    if (t === 'false') return false;
  }
  return undefined;
}

function detectFlagKeys(rows: Row[]): string[] {
  const state = new Map<string, boolean>(); // key -> still looks like a TRUE/FALSE column
  for (const row of rows) {
    for (const [key, value] of Object.entries(row)) {
      if (KNOWN_FIELDS.has(key) || isBlank(value)) continue;
      state.set(key, (state.get(key) ?? true) && asBool(value) !== undefined);
    }
  }
  return [...state].filter(([, ok]) => ok).map(([key]) => key);
}

const squash = (s: string) => s.toLowerCase().replace(/[^a-z]/g, '');

/** "Health_Heart_Disease" -> "Heart Disease"; "under_weight" -> "Under Weight". */
function flagLabel(key: string): string {
  return key
    .replace(/^(health|disability|condition|medical)_/, '')
    .split('_')
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/** Under/over weight is a weight status, not a medical condition: it never counts as an alert. */
function weightStatusOf(label: string): WeightCategory | undefined {
  const key = squash(label);
  if (key === 'underweight') return 'underweight';
  if (key === 'overweight') return 'overweight';
  if (key === 'healthy' || key === 'healthyweight' || key === 'normalweight') return 'healthy';
  return undefined;
}

/**
 * Joins `children_master` with `health_and_conditions` on the child ID.
 *
 * - Works with one roster tab or two: health columns on the master tab are used when the
 *   child has no value on the health tab (health-tab values win where both exist).
 * - Rows without a child ID are ignored. If an ID repeats, the later row wins.
 */
export function joinRoster(master: SheetRow[], health: SheetRow[]): ChildRecord[] {
  const combined = new Map<string, Row>();
  for (const raw of master) {
    const row = canonicalizeRow(raw);
    const id = normalizeId(row.child_id);
    if (id) combined.set(id, row);
  }
  for (const raw of health) {
    const row = canonicalizeRow(raw);
    const base = combined.get(normalizeId(row.child_id));
    if (!base) continue;
    for (const [key, value] of Object.entries(row)) {
      if (!isBlank(value)) base[key] = value; // `false` is a value, so an explicit FALSE overrides
    }
  }

  const rows = [...combined.entries()];
  const flagKeys = detectFlagKeys(rows.map(([, row]) => row));
  // The sheet tracks weight status with TRUE/FALSE columns: a child with neither ticked is healthy.
  const trackedWeightFlags = flagKeys.some((k) => weightStatusOf(flagLabel(k)) !== undefined);

  const students: ChildRecord[] = [];
  for (const [childId, m] of rows) {
    const weightKg = num(m.weight_kg);
    const heightCm = num(m.height_cm);
    let bmi = num(m.bmi);
    if (bmi === undefined && weightKg && heightCm) {
      bmi = Math.round((weightKg / (heightCm / 100) ** 2) * 10) / 10;
    }

    // Collect labels from free-text lists and from TRUE columns.
    const labels: string[] = [];
    for (const field of CONDITION_TEXT_FIELDS) {
      for (const part of text(m[field]).split(/[,;\n]+/)) labels.push(part);
    }
    for (const key of flagKeys) {
      if (asBool(m[key]) === true) labels.push(flagLabel(key));
    }

    const conditions: string[] = [];
    const seen = new Set<string>();
    let weightStatus: WeightCategory | undefined;
    for (const part of labels) {
      const label = part.trim().replace(/\s+/g, ' ');
      const key = label.toLowerCase();
      if (!label || NONE_VALUES.has(key) || seen.has(key)) continue;
      seen.add(key);
      const weight = weightStatusOf(label);
      if (weight) weightStatus ??= weight;
      else conditions.push(label);
    }

    let weightCategory = normalizeWeightCategory(m.weight_category) ?? weightStatus;
    if (!weightCategory && trackedWeightFlags && (weightKg !== undefined || bmi !== undefined)) {
      weightCategory = 'healthy';
    }

    students.push({
      childId,
      fullName: text(m.full_name) || childId,
      gender: normalizeGender(m.gender),
      schoolGrade: text(m.school_grade),
      address: text(m.address),
      gnDivision: text(m.gn_division),
      contactPrimary: text(m.contact_primary),
      contactWhatsapp: text(m.contact_whatsapp),
      fatherName: text(m.father_name),
      motherName: text(m.mother_name),
      careGiver: text(m.care_giver),
      religion: text(m.religion),
      pictureRef: text(m.picture_ref) || undefined,
      // Blank means active; only an explicit "inactive" switches a child off.
      status: text(m.status).toLowerCase() === 'inactive' ? 'inactive' : 'active',
      birthday: normalizeBirthday(m.birthday),
      nameLocal: text(m.name_local) || undefined,
      officeName: text(m.office_name) || undefined,
      weightKg,
      heightCm,
      bmi,
      weightCategory,
      medicalCondition: conditions.length ? conditions.join(', ') : undefined,
      conditions,
    });
  }
  return students;
}

/** A Date (from the sheet API), or a date-ish string ("2016-06-17", "17/06/2016") -> ISO date. */
function normalizeBirthday(raw: unknown): string | undefined {
  if (raw instanceof Date) return Number.isNaN(raw.getTime()) ? undefined : raw.toISOString().slice(0, 10);
  const s = text(raw);
  if (!s) return undefined;
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10); // already ISO (or ISO datetime)
  const dmy = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (dmy) {
    const [, d, mo, y] = dmy;
    return `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }
  const parsed = new Date(s);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString().slice(0, 10);
}

function normalizeGender(raw: unknown): Gender {
  const g = text(raw).toLowerCase();
  if (g.startsWith('f') || g === 'girl') return 'female';
  if (g.startsWith('m') || g === 'boy') return 'male';
  return 'unknown';
}

/** "grade_4" -> "Grade 4", "single_parent__mother" -> "Single parent (mother)". */
export function humanize(value: string): string {
  if (!value) return '';
  const [head, ...rest] = value.split('__');
  const words = head.replace(/_/g, ' ').trim();
  const label = words.charAt(0).toUpperCase() + words.slice(1);
  const extra = rest.map((r) => r.replace(/_/g, ' ').trim()).filter(Boolean);
  return extra.length ? `${label} (${extra.join(', ')})` : label;
}

const collator = new Intl.Collator('en', { sensitivity: 'base', numeric: true });
export const compareText = (a: string, b: string) => collator.compare(a, b);

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
  return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
}
