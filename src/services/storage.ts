import type { AttendanceEntry, AttendanceLogRow, AttendanceStatus, ChildRecord, OrgConfig, Session } from '../types';
import { dayKey } from '../lib/time';

// Everything the app needs to keep working with zero connectivity lives in localStorage:
// the joined roster (~400 KB for 553 students), the unsynced queue and today's synced marks.

const KEYS = {
  roster: 'sat.roster.v1',
  queue: 'sat.queue.v1',
  synced: 'sat.synced.v1',
  prefs: 'sat.prefs.v1',
  mockLogs: 'sat.mock.attendance_logs.v1',
  orgConfig: 'sat.org_config.v1',
  session: 'sat.session.v1',
} as const;

function read<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null; // storage blocked, or the JSON was corrupted: behave as "nothing saved"
  }
}

function write(key: string, value: unknown): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false; // quota exceeded / private mode: the app keeps working from memory
  }
}

// ---- Roster ---------------------------------------------------------------------------

export interface CachedRoster {
  students: ChildRecord[];
  fetchedAt: string;
}

export const loadRoster = (): CachedRoster | null => {
  const cached = read<CachedRoster>(KEYS.roster);
  return cached && Array.isArray(cached.students) ? cached : null;
};

export const saveRoster = (roster: CachedRoster) => write(KEYS.roster, roster);

// ---- Attendance queue (marks not yet posted to the sheet) -----------------------------

export const loadQueue = (): AttendanceEntry[] => {
  const queue = read<AttendanceEntry[]>(KEYS.queue);
  return Array.isArray(queue) ? queue : [];
};

export const saveQueue = (queue: AttendanceEntry[]) => write(KEYS.queue, queue);

// ---- Marks already synced today (so a re-scan after a sync is still flagged) ----------

export interface SyncedMark {
  status: AttendanceStatus;
  timestamp: string;
}
export type SyncedMarks = Record<string, SyncedMark>;

export const loadSyncedToday = (): SyncedMarks => {
  const saved = read<{ day: string; marks: SyncedMarks }>(KEYS.synced);
  return saved && saved.day === dayKey(new Date()) ? saved.marks : {};
};

export const saveSyncedToday = (marks: SyncedMarks) =>
  write(KEYS.synced, { day: dayKey(new Date()), marks });

// ---- Preferences ----------------------------------------------------------------------

export interface Prefs {
  autoSync: boolean;
  soundOn: boolean;
  /** True once the Settings screen's first-launch setup instructions have been shown. */
  setupSeen: boolean;
}
const DEFAULT_PREFS: Prefs = { autoSync: false, soundOn: true, setupSeen: false };

export const loadPrefs = (): Prefs => ({ ...DEFAULT_PREFS, ...read<Partial<Prefs>>(KEYS.prefs) });
export const savePrefs = (prefs: Prefs) => write(KEYS.prefs, prefs);

// ---- MOCK mode's stand-in for the attendance_logs tab ---------------------------------

export const loadMockLogs = (): AttendanceLogRow[] => read<AttendanceLogRow[]>(KEYS.mockLogs) ?? [];
export const saveMockLogs = (rows: AttendanceLogRow[]) => write(KEYS.mockLogs, rows);

// ---- Organization config (the Google Sheet connection) --------------------------------
// Kept on-device only, entered through the Settings screen — never built into the app
// binary, so the same install works for any organization and can be re-pointed or reset
// to demo data without a new build.

const EMPTY_CONFIG: OrgConfig = { orgName: '', scriptUrl: '', apiKey: '', countryCode: '94', nationalLength: 9 };

/**
 * `.env` (VITE_*) is a LOCAL DEVELOPMENT convenience only: it pre-fills the Settings screen
 * the first time the app runs on a device with nothing saved yet, so `npm run dev` keeps
 * working without re-typing credentials. It must be left blank in any build meant to be
 * installed by other organizations — see README "Configuring for your organization".
 */
function envSeed(): OrgConfig {
  return {
    orgName: '',
    scriptUrl: import.meta.env.VITE_APPS_SCRIPT_URL ?? '',
    apiKey: import.meta.env.VITE_API_KEY ?? '',
    countryCode: '94',
    nationalLength: 9,
  };
}

export const loadOrgConfig = (): OrgConfig => {
  const saved = read<Partial<OrgConfig>>(KEYS.orgConfig);
  return saved ? { ...EMPTY_CONFIG, ...saved } : envSeed();
};

export const saveOrgConfig = (config: OrgConfig) => write(KEYS.orgConfig, config);

/**
 * Wipes the cached roster, attendance queue, today's synced marks and the signed-in session
 * — called when the Sheet connection changes (a different organization, or switching to/from
 * demo data), so one organization's data (or login) can never linger into another's view or
 * get synced to the wrong sheet. Preferences and the MOCK sandbox log are left alone.
 */
export function clearOrgScopedData() {
  try {
    localStorage.removeItem(KEYS.roster);
    localStorage.removeItem(KEYS.queue);
    localStorage.removeItem(KEYS.synced);
    localStorage.removeItem(KEYS.session);
  } catch {
    /* storage blocked: nothing was cached to begin with */
  }
}

// ---- Session (who's logged in) ---------------------------------------------------------

const EMPTY_SESSION: Session = { username: null };

export const loadSession = (): Session => read<Session>(KEYS.session) ?? EMPTY_SESSION;
export const saveSession = (session: Session) => write(KEYS.session, session);
