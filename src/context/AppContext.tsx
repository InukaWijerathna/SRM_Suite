import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type {
  AttendanceEntry,
  AttendanceStatus,
  ChildRecord,
  ConditionColumn,
  OrgConfig,
  Role,
  RosterStatus,
  SheetRow,
  StudentEdit,
  SyncStatus,
} from '../types';
import {
  ApiError,
  checkLoginRequired,
  fetchRoster,
  login as apiLogin,
  submitAttendance,
  updateStudent as apiUpdateStudent,
} from '../services/api';
import { setSoundEnabled } from '../services/audio';
import {
  clearOrgScopedData,
  loadOrgConfig,
  loadPrefs,
  loadQueue,
  loadRoster,
  loadSession,
  loadSyncedToday,
  saveOrgConfig,
  savePrefs,
  saveQueue,
  saveRoster,
  saveSession,
  saveSyncedToday,
  type SyncedMarks,
} from '../services/storage';
import type { PhoneFormat } from '../lib/phone';
import { compareText, joinRoster, listConditionColumns, normalizeId } from '../lib/roster';
import { dayKey, isoNow, newLogId } from '../lib/time';

/** A child's effective attendance for today: either still queued (pending) or already synced. */
export interface Mark {
  status: AttendanceStatus;
  timestamp: string;
  pending: boolean;
}

export type ScanOutcome =
  | { kind: 'recorded'; child: ChildRecord; timestamp: string }
  | { kind: 'duplicate'; child: ChildRecord; timestamp: string }
  | { kind: 'inactive'; child: ChildRecord }
  | { kind: 'unknown'; id: string };

interface AppContextValue {
  // Roster
  students: ChildRecord[];
  studentsById: Map<string, ChildRecord>;
  rosterStatus: RosterStatus;
  refreshRoster: () => Promise<void>;
  /** Every medical-condition column the sheet currently tracks, for the edit screen. */
  conditionColumns: ConditionColumn[];
  /** Saves an edit to an existing child and reflects it locally immediately. Throws on failure. */
  updateStudent: (childId: string, edit: StudentEdit) => Promise<void>;
  // Attendance
  queue: AttendanceEntry[];
  marks: Map<string, Mark>;
  toggleMark: (childId: string, status: AttendanceStatus) => void;
  markAllPresent: (childIds: string[]) => number;
  /** Drops today's unsubmitted marks: for the given children, or everyone when omitted. */
  clearPending: (childIds?: string[]) => void;
  recordScan: (rawId: string) => ScanOutcome;
  // Sync
  syncStatus: SyncStatus;
  syncNow: () => Promise<void>;
  isOnline: boolean;
  autoSync: boolean;
  setAutoSync: (on: boolean) => void;
  soundOn: boolean;
  setSoundOn: (on: boolean) => void;
  /** False only until the Settings screen's first-launch setup instructions have been shown once. */
  setupSeen: boolean;
  markSetupSeen: () => void;
  // Organization: which Google Sheet this install is connected to, entered via Settings
  orgConfig: OrgConfig;
  /** Saves the config, and re-fetches the roster from whatever it now points at. */
  setOrgConfig: (config: OrgConfig) => void;
  isLive: boolean;
  phoneFormat: PhoneFormat;
  // Session: who's signed in on this device.
  /** True once a sheet is connected: that's when login starts being required. */
  requiresLogin: boolean;
  username: string | null;
  /** 'viewer' is read-only; null until signed in or when the sheet has no Role column (= editor). */
  role: Role | null;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
}

const AppContext = createContext<AppContextValue | null>(null);

// ---- Queue / synced-marks reducer -----------------------------------------------------

interface MarksState {
  queue: AttendanceEntry[];
  synced: SyncedMarks;
}

type MarksAction =
  | { type: 'upsert'; entries: AttendanceEntry[] }
  | { type: 'remove'; childId: string; day: string }
  | { type: 'clearDay'; day: string; childIds?: string[] }
  | { type: 'synced'; logIds: string[] }
  | { type: 'reset' };

const sameChildAndDay = (a: AttendanceEntry, childId: string, day: string) =>
  a.childId === childId && dayKey(a.timestamp) === day;

function marksReducer(state: MarksState, action: MarksAction): MarksState {
  switch (action.type) {
    case 'upsert': {
      // One pending mark per child per day: the latest tap wins.
      let queue = state.queue;
      for (const entry of action.entries) {
        const day = dayKey(entry.timestamp);
        queue = queue.filter((q) => !sameChildAndDay(q, entry.childId, day));
        queue.push(entry);
      }
      return { ...state, queue: [...queue] };
    }
    case 'remove':
      return {
        ...state,
        queue: state.queue.filter((q) => !sameChildAndDay(q, action.childId, action.day)),
      };
    case 'clearDay': {
      // Only today's pending marks: unsynced records from earlier days must not be lost.
      const only = action.childIds && new Set(action.childIds);
      return {
        ...state,
        queue: state.queue.filter(
          (q) => dayKey(q.timestamp) !== action.day || (only !== undefined && !only.has(q.childId)),
        ),
      };
    }
    case 'synced': {
      // Remove by log_id so marks made while the request was in flight stay queued.
      const done = new Set(action.logIds);
      const synced = { ...state.synced };
      for (const q of state.queue) {
        if (done.has(q.logId)) synced[q.childId] = { status: q.status, timestamp: q.timestamp };
      }
      return { queue: state.queue.filter((q) => !done.has(q.logId)), synced };
    }
    case 'reset':
      // The Sheet connection changed: this device's old queue/synced marks belong to a
      // different sheet now and must not linger or get synced to the new one.
      return { queue: [], synced: {} };
  }
}

function describeError(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.kind === 'offline') return "You're offline. Records are safe on this device.";
    return err.message;
  }
  return 'Something went wrong. Please try again.';
}

// ---- Provider -------------------------------------------------------------------------

export function AppProvider({ children }: { children: ReactNode }) {
  const [cachedRoster] = useState(loadRoster);
  const [students, setStudents] = useState<ChildRecord[]>(cachedRoster?.students ?? []);
  const [rosterStatus, setRosterStatus] = useState<RosterStatus>(
    cachedRoster ? { state: 'ready', fetchedAt: cachedRoster.fetchedAt } : { state: 'loading' },
  );
  // Recomputed on every roster fetch (not cached across reloads — cheap, and no stale
  // columns from a since-switched-away-from sheet lingering).
  const [conditionColumns, setConditionColumns] = useState<ConditionColumn[]>([]);
  const [marksState, dispatch] = useReducer(marksReducer, undefined, () => ({
    queue: loadQueue(),
    synced: loadSyncedToday(),
  }));
  const [syncStatus, setSyncStatus] = useState<SyncStatus>({ state: 'idle' });
  const [isOnline, setIsOnline] = useState(() => navigator.onLine);
  const [prefs, setPrefs] = useState(loadPrefs);
  const [orgConfig, setOrgConfigState] = useState(loadOrgConfig);
  const [session, setSession] = useState(loadSession);

  const studentsById = useMemo(() => new Map(students.map((s) => [s.childId, s])), [students]);

  // Today's effective mark per child: pending queue entries override already-synced ones.
  const today = dayKey(new Date());
  const marks = useMemo(() => {
    const map = new Map<string, Mark>();
    for (const [childId, s] of Object.entries(marksState.synced)) {
      if (dayKey(s.timestamp) === today) map.set(childId, { ...s, pending: false });
    }
    for (const q of marksState.queue) {
      if (dayKey(q.timestamp) === today) {
        map.set(q.childId, { status: q.status, timestamp: q.timestamp, pending: true });
      }
    }
    return map;
  }, [marksState, today]);

  // Latest values for callbacks that fire outside React (scanner frames, timers).
  const latest = useRef({ marks, queue: marksState.queue, studentsById, orgConfig });
  useLayoutEffect(() => {
    latest.current = { marks, queue: marksState.queue, studentsById, orgConfig };
  });

  // ---- persistence
  useEffect(() => void saveQueue(marksState.queue), [marksState.queue]);
  useEffect(() => void saveSyncedToday(marksState.synced), [marksState.synced]);
  useEffect(() => {
    savePrefs(prefs);
    setSoundEnabled(prefs.soundOn);
  }, [prefs]);

  // ---- connectivity
  useEffect(() => {
    const up = () => setIsOnline(true);
    const down = () => setIsOnline(false);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    return () => {
      window.removeEventListener('online', up);
      window.removeEventListener('offline', down);
    };
  }, []);

  // ---- roster
  const refreshingRoster = useRef(false);
  // Bumped whenever the sheet connection changes, so a slow response from the *previous*
  // sheet can never land after switching and overwrite the new one's (still-loading) data.
  const rosterGeneration = useRef(0);
  // Stable identity (reads the latest org config from the ref) so it only ever runs once on
  // mount; setOrgConfig below triggers an explicit extra refresh when the sheet changes,
  // passing the new config directly rather than waiting for the ref to catch up.
  const refreshRoster = useCallback(async (overrideConfig?: OrgConfig) => {
    // The busy-guard only dedupes *ambient* refreshes (mount, back-online, an idle Sync
    // tap) — it must never block an explicit config switch. Without this, a slow fetch
    // still in flight for the *old* sheet would hold the guard open, the new sheet's fetch
    // would be silently skipped, and the generation check below would then (correctly)
    // discard the stale old response, leaving nothing to ever resolve "loading".
    const forced = overrideConfig !== undefined;
    if (!forced && refreshingRoster.current) return;
    const config = overrideConfig ?? latest.current.orgConfig;
    if (!config.scriptUrl.trim()) {
      // Nothing to fetch yet — the first-launch Settings screen (or the gear icon) is how
      // this gets filled in, not a fallback dataset.
      setRosterStatus({ state: 'error', error: 'Connect your Google Sheet in Settings to get started.' });
      return;
    }
    refreshingRoster.current = true;
    const generation = rosterGeneration.current;
    setRosterStatus((s) => (s.state === 'ready' ? s : { state: 'loading' }));
    try {
      const { master, health } = await fetchRoster(config);
      if (generation !== rosterGeneration.current) return; // superseded by a sheet switch
      const joined = joinRoster(master, health);
      const fetchedAt = isoNow();
      setStudents(joined);
      setConditionColumns(listConditionColumns(master, health));
      saveRoster({ students: joined, fetchedAt });
      setRosterStatus({ state: 'ready', fetchedAt });
    } catch (err) {
      if (generation !== rosterGeneration.current) return;
      // Keep whatever is cached; the UI shows a non-blocking notice when data exists.
      setRosterStatus((s) => ({ ...s, state: s.fetchedAt ? 'ready' : 'error', error: describeError(err) }));
    } finally {
      refreshingRoster.current = false;
    }
  }, []);

  useEffect(() => {
    if (navigator.onLine) {
      void refreshRoster();
    } else {
      setRosterStatus((s) =>
        s.fetchedAt ? s : { state: 'error', error: 'Offline, and no saved student list on this device yet.' },
      );
    }
  }, [refreshRoster]);

  // Back online with no roster yet: load it without making anyone tap retry.
  useEffect(() => {
    if (isOnline && students.length === 0) void refreshRoster();
  }, [isOnline, students.length, refreshRoster]);

  // ---- editing a student
  const updateStudent = useCallback(async (childId: string, edit: StudentEdit) => {
    const weightKg = edit.weightKg.trim() === '' ? undefined : Number(edit.weightKg);
    const heightCm = edit.heightCm.trim() === '' ? undefined : Number(edit.heightCm);

    // Canonical Title_Case headers (see StudentPatch): matches our own templates and the
    // headers Settings tells an org to use, but not every possible alias roster.ts accepts.
    const master = {
      Name_of_Child: edit.fullName,
      Gender: edit.gender,
      School_Grade: edit.schoolGrade,
      Address: edit.address,
      GN_Division: edit.gnDivision,
      Contact_Number: edit.contactPrimary,
      Whatsapp_Number: edit.contactWhatsapp,
      Father_s_Name: edit.fatherName,
      Mother_s_Name: edit.motherName,
      Care_Giver: edit.careGiver,
      Religion: edit.religion,
      Status: edit.status,
      Birthday: edit.birthday,
      Child_Name_In_BC: edit.nameLocal,
      Office_Name: edit.officeName,
    };
    const health: SheetRow = { ...edit.conditionKeys };
    if (weightKg !== undefined) health.Weight_Kg = weightKg;
    if (heightCm !== undefined) health.Height_cm = heightCm;

    await apiUpdateStudent(childId, { master, health }, latest.current.orgConfig);

    // Reflect the edit locally right away rather than waiting on a full resync, avoiding a
    // round trip to re-fetch the whole roster just to see the one row we already know changed.
    const conditions = conditionColumns
      .filter((c) => edit.conditionKeys[c.key])
      .map((c) => c.label)
      .sort(compareText);
    const bmi = weightKg && heightCm ? Math.round((weightKg / (heightCm / 100) ** 2) * 10) / 10 : undefined;

    setStudents((prev) => {
      const next = prev.map((s): ChildRecord =>
        s.childId !== childId
          ? s
          : {
              ...s,
              fullName: edit.fullName.trim() || s.childId,
              gender: edit.gender,
              schoolGrade: edit.schoolGrade,
              address: edit.address,
              gnDivision: edit.gnDivision,
              contactPrimary: edit.contactPrimary,
              contactWhatsapp: edit.contactWhatsapp,
              fatherName: edit.fatherName,
              motherName: edit.motherName,
              careGiver: edit.careGiver,
              religion: edit.religion,
              status: edit.status,
              birthday: edit.birthday || undefined,
              nameLocal: edit.nameLocal || undefined,
              officeName: edit.officeName || undefined,
              weightKg,
              heightCm,
              bmi,
              conditions,
              medicalCondition: conditions.length ? conditions.join(', ') : undefined,
            },
      );
      saveRoster({ students: next, fetchedAt: isoNow() });
      return next;
    });
  }, [conditionColumns]);

  // ---- attendance actions
  const toggleMark = useCallback((childId: string, status: AttendanceStatus) => {
    const { marks: current } = latest.current;
    const existing = current.get(childId);
    const day = dayKey(new Date());
    if (existing?.status === status) {
      // Tapping the active button un-marks it, but only if it hasn't been submitted yet.
      if (existing.pending) dispatch({ type: 'remove', childId, day });
      return;
    }
    dispatch({
      type: 'upsert',
      entries: [{ logId: newLogId(), childId, timestamp: isoNow(), status }],
    });
  }, []);

  const markAllPresent = useCallback((childIds: string[]) => {
    const { marks: current } = latest.current;
    const timestamp = isoNow();
    const entries = childIds
      .filter((id) => current.get(id)?.status !== 'Present')
      .map((childId) => ({ logId: newLogId(), childId, timestamp, status: 'Present' as const }));
    if (entries.length) dispatch({ type: 'upsert', entries });
    return entries.length;
  }, []);

  const clearPending = useCallback((childIds?: string[]) => {
    dispatch({ type: 'clearDay', day: dayKey(new Date()), childIds });
  }, []);

  const recordScan = useCallback((rawId: string): ScanOutcome => {
    const { marks: current, studentsById: byId } = latest.current;
    const id = normalizeId(rawId);
    const child = byId.get(id);
    if (!child) return { kind: 'unknown', id };
    if (child.status !== 'active') return { kind: 'inactive', child };

    const existing = current.get(child.childId);
    if (existing && existing.status !== 'Absent') {
      return { kind: 'duplicate', child, timestamp: existing.timestamp };
    }
    const timestamp = isoNow();
    dispatch({
      type: 'upsert',
      entries: [{ logId: newLogId(), childId: child.childId, timestamp, status: 'Present' }],
    });
    return { kind: 'recorded', child, timestamp };
  }, []);

  // ---- sync
  const syncing = useRef(false);
  const syncNow = useCallback(async () => {
    if (syncing.current) return;
    const batch = latest.current.queue;
    if (batch.length === 0) {
      // Nothing to submit: the button doubles as "refresh the student list".
      await refreshRoster();
      return;
    }
    syncing.current = true;
    setSyncStatus((s) => ({ ...s, state: 'syncing', message: undefined }));
    try {
      await submitAttendance(batch, latest.current.orgConfig);
      dispatch({ type: 'synced', logIds: batch.map((e) => e.logId) });
      setSyncStatus({
        state: 'idle',
        lastSyncedAt: isoNow(),
        message: `Saved ${batch.length} record${batch.length === 1 ? '' : 's'} to the sheet`,
      });
    } catch (err) {
      setSyncStatus((s) => ({ ...s, state: 'error', message: describeError(err) }));
    } finally {
      syncing.current = false;
    }
  }, [refreshRoster]);

  // ---- organization config (the Sheet connection)
  const setOrgConfig = useCallback(
    (next: OrgConfig) => {
      setOrgConfigState((prev) => {
        const sheetChanged = next.scriptUrl.trim() !== prev.scriptUrl.trim();
        saveOrgConfig(next);
        if (sheetChanged) {
          // A different sheet: the previous one's roster, queue and synced marks are not
          // valid here and must never leak into the new view or get synced to the wrong place.
          rosterGeneration.current += 1;
          clearOrgScopedData();
          dispatch({ type: 'reset' });
          setStudents([]);
          setRosterStatus({ state: 'loading' });
          setSession({ username: null, role: null }); // a login for the old sheet must not carry over
          void refreshRoster(next);
        }
        return next;
      });
    },
    [refreshRoster],
  );

  const isLive = !!orgConfig.scriptUrl.trim();
  const phoneFormat = useMemo<PhoneFormat>(
    () => ({ countryCode: orgConfig.countryCode || '94', nationalLength: orgConfig.nationalLength || 9 }),
    [orgConfig.countryCode, orgConfig.nationalLength],
  );

  // ---- login_credentials is optional per-sheet: ask the sheet whether anyone's actually
  // registered there rather than assuming every connected sheet demands a login. Defaults to
  // false (no gate) until this resolves, so the app never gets stuck showing a login screen
  // nobody can pass for a sheet that was never meant to require one.
  const [loginRequired, setLoginRequired] = useState(false);
  useEffect(() => {
    if (!isLive) {
      setLoginRequired(false);
      return;
    }
    let cancelled = false;
    checkLoginRequired(orgConfig)
      .then((required) => {
        if (!cancelled) setLoginRequired(required);
      })
      .catch(() => {
        if (!cancelled) setLoginRequired(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isLive, orgConfig]);

  // ---- session (who's logged in)
  const login = useCallback(
    async (username: string, password: string) => {
      const role = await apiLogin(username, password, orgConfig);
      const next = { username: username.trim(), role };
      setSession(next);
      saveSession(next);
    },
    [orgConfig],
  );
  const logout = useCallback(() => {
    setSession({ username: null, role: null });
    saveSession({ username: null, role: null });
  }, []);

  // Auto-sync: wait for a burst of marks to settle, then post them in one batch.
  const queueLength = marksState.queue.length;
  useEffect(() => {
    if (!prefs.autoSync || !isOnline || queueLength === 0 || syncStatus.state === 'syncing') return;
    const delay = syncStatus.state === 'error' ? 60_000 : 15_000;
    const timer = setTimeout(() => void syncNow(), delay);
    return () => clearTimeout(timer);
  }, [prefs.autoSync, isOnline, marksState.queue, queueLength, syncStatus.state, syncNow]);

  const value = useMemo<AppContextValue>(
    () => ({
      students,
      studentsById,
      rosterStatus,
      refreshRoster,
      conditionColumns,
      updateStudent,
      queue: marksState.queue,
      marks,
      toggleMark,
      markAllPresent,
      clearPending,
      recordScan,
      syncStatus,
      syncNow,
      isOnline,
      autoSync: prefs.autoSync,
      setAutoSync: (autoSync) => setPrefs((p) => ({ ...p, autoSync })),
      soundOn: prefs.soundOn,
      setSoundOn: (soundOn) => setPrefs((p) => ({ ...p, soundOn })),
      setupSeen: prefs.setupSeen,
      markSetupSeen: () => setPrefs((p) => (p.setupSeen ? p : { ...p, setupSeen: true })),
      orgConfig,
      setOrgConfig,
      isLive,
      phoneFormat,
      requiresLogin: isLive && loginRequired,
      username: session.username,
      role: session.role,
      login,
      logout,
    }),
    [
      students,
      studentsById,
      rosterStatus,
      refreshRoster,
      conditionColumns,
      updateStudent,
      marksState.queue,
      marks,
      toggleMark,
      markAllPresent,
      clearPending,
      recordScan,
      syncStatus,
      syncNow,
      isOnline,
      prefs,
      orgConfig,
      setOrgConfig,
      isLive,
      phoneFormat,
      loginRequired,
      session,
      login,
      logout,
    ],
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used inside <AppProvider>');
  return ctx;
}
