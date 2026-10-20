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
  OrgConfig,
  RosterStatus,
  SyncStatus,
} from '../types';
import { ApiError, apiModeOf, fetchRoster, submitAttendance } from '../services/api';
import { setSoundEnabled } from '../services/audio';
import {
  clearOrgScopedData,
  loadOrgConfig,
  loadPrefs,
  loadQueue,
  loadRoster,
  loadSyncedToday,
  saveOrgConfig,
  savePrefs,
  saveQueue,
  saveRoster,
  saveSyncedToday,
  type SyncedMarks,
} from '../services/storage';
import type { PhoneFormat } from '../lib/phone';
import { joinRoster, normalizeId } from '../lib/roster';
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
  // Organization: which Google Sheet this install is connected to, entered via Settings
  orgConfig: OrgConfig;
  /** Saves the config, and re-fetches the roster from whatever it now points at. */
  setOrgConfig: (config: OrgConfig) => void;
  isLive: boolean;
  phoneFormat: PhoneFormat;
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
  const [marksState, dispatch] = useReducer(marksReducer, undefined, () => ({
    queue: loadQueue(),
    synced: loadSyncedToday(),
  }));
  const [syncStatus, setSyncStatus] = useState<SyncStatus>({ state: 'idle' });
  const [isOnline, setIsOnline] = useState(() => navigator.onLine);
  const [prefs, setPrefs] = useState(loadPrefs);
  const [orgConfig, setOrgConfigState] = useState(loadOrgConfig);

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
    if (refreshingRoster.current) return;
    refreshingRoster.current = true;
    const config = overrideConfig ?? latest.current.orgConfig;
    const generation = rosterGeneration.current;
    setRosterStatus((s) => (s.state === 'ready' ? s : { state: 'loading' }));
    try {
      const { master, health } = await fetchRoster(config);
      if (generation !== rosterGeneration.current) return; // superseded by a sheet switch
      const joined = joinRoster(master, health);
      const fetchedAt = isoNow();
      setStudents(joined);
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
          // A different sheet (or switching to/from demo data): the previous one's roster,
          // queue and synced marks are not valid here and must never leak into the new view
          // or get synced to the wrong place.
          rosterGeneration.current += 1;
          clearOrgScopedData();
          dispatch({ type: 'reset' });
          setStudents([]);
          setRosterStatus({ state: 'loading' });
          void refreshRoster(next);
        }
        return next;
      });
    },
    [refreshRoster],
  );

  const isLive = apiModeOf(orgConfig) === 'live';
  const phoneFormat = useMemo<PhoneFormat>(
    () => ({ countryCode: orgConfig.countryCode || '94', nationalLength: orgConfig.nationalLength || 9 }),
    [orgConfig.countryCode, orgConfig.nationalLength],
  );

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
      orgConfig,
      setOrgConfig,
      isLive,
      phoneFormat,
    }),
    [
      students,
      studentsById,
      rosterStatus,
      refreshRoster,
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
    ],
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used inside <AppProvider>');
  return ctx;
}
