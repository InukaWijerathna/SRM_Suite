export type Gender = 'male' | 'female' | 'unknown';
export type AttendanceStatus = 'Present' | 'Absent' | 'Late';
export type WeightCategory = 'underweight' | 'overweight' | 'healthy';
export type StudentStatus = 'active' | 'inactive';

/** A student: `children_master` row joined with its `health_and_conditions` row. */
export interface ChildRecord {
  childId: string;
  fullName: string;
  gender: Gender;
  schoolGrade: string;
  address: string;
  gnDivision: string;
  contactPrimary: string;
  contactWhatsapp: string;
  fatherName: string;
  motherName: string;
  careGiver: string;
  religion: string;
  pictureRef?: string;
  status: StudentStatus;
  /** ISO date (YYYY-MM-DD), when known. */
  birthday?: string;
  /** Name in the local script / as on the birth certificate, when known. */
  nameLocal?: string;
  /** Divisional office / branch running this child's programme, when the sheet tracks more than one. */
  officeName?: string;
  // Joined from health_and_conditions
  weightKg?: number;
  heightCm?: number;
  bmi?: number;
  weightCategory?: WeightCategory;
  /** Recorded conditions, comma-joined. Undefined when the sheet says "None" or is blank. */
  medicalCondition?: string;
  /** `medicalCondition` split into individual conditions (empty when none). */
  conditions: string[];
}

/**
 * One attendance marking. `logId` is generated when the mark is made and is the
 * idempotency key: retrying a sync after a lost response never double-logs.
 */
export interface AttendanceEntry {
  logId: string;
  childId: string;
  /** `YYYY-MM-DDTHH:mm:ssZ` */
  timestamp: string;
  status: AttendanceStatus;
}

/** A row exactly as it comes out of a sheet tab, keyed by the header names. */
export type SheetRow = Record<string, string | number | boolean | null | undefined>;

export interface RosterPayload {
  master: SheetRow[];
  health: SheetRow[];
}

/** `attendance_logs` row: log_id, timestamp, child_id, attendance_status. */
export interface AttendanceLogRow {
  log_id: string;
  timestamp: string;
  child_id: string;
  attendance_status: AttendanceStatus;
}

export interface SubmitResult {
  appended: number;
  duplicates: number;
}

export type TabId = 'directory' | 'attendance' | 'scanner';

export type SyncState = 'idle' | 'syncing' | 'error';

export interface SyncStatus {
  state: SyncState;
  message?: string;
  lastSyncedAt?: string;
}

export interface RosterStatus {
  state: 'loading' | 'ready' | 'error';
  fetchedAt?: string;
  error?: string;
}

/**
 * Per-install connection to one organization's Google Sheet, entered through the Settings
 * screen and kept on-device only — never built into the app binary, so the same install can
 * be re-pointed at a different sheet (or reset to demo data) without a new build.
 */
export interface OrgConfig {
  /** Shown in the header once set. Blank until the admin configures the app. */
  orgName: string;
  /** The Apps Script web app's /exec URL. Blank = demo data (MOCK mode). */
  scriptUrl: string;
  /** Optional: must match the API_KEY script property, if the deployment set one. */
  apiKey: string;
  /** Phone dialing code, digits only (e.g. "94" for Sri Lanka, "1" for the US/Canada). */
  countryCode: string;
  /** Digit count of a national number once the country code is stripped (e.g. 9, 10). */
  nationalLength: number;
}
