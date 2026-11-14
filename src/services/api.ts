import { loadSession } from './storage';
import type { AttendanceEntry, AttendanceLogRow, OrgConfig, Session, RosterPayload, StudentPatch, SubmitResult } from '../types';

/**
 * Data access for the Google Sheet. The `OrgConfig` the caller passes in (read from the
 * Settings screen, not a build-time env var) is what makes the same app build serve any
 * organization — GET/POST against the Google Apps Script web app in /apps-script/Code.gs,
 * which keeps the Google credentials server-side instead of in the browser bundle.
 *
 * Wire format (both directions use the sheet's own column names):
 *   POST { action: "roster", token, key? } -> { ok, master: Row[], health: Row[] }
 *   POST { action: "appendAttendance", token, key?, entries: AttendanceLogRow[] }
 *                                 ->  { ok, appended, duplicates }
 */

const REQUEST_TIMEOUT_MS = 30_000;

export class ApiError extends Error {
  constructor(
    message: string,
    readonly kind: 'offline' | 'config' | 'network' | 'server' | 'auth' | 'forbidden',
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

function assertOnline() {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    throw new ApiError('No internet connection', 'offline');
  }
}

/** Entries -> the four attendance_logs columns. There is deliberately no recorded_by. */
const toLogRow = (e: AttendanceEntry): AttendanceLogRow => ({
  log_id: e.logId,
  timestamp: e.timestamp,
  child_id: e.childId,
  attendance_status: e.status,
});

// ---- Google Apps Script web app --------------------------------------------------------

async function callScript<T>(
  scriptUrl: string,
  init: RequestInit,
  query = '',
  sessionToken?: string,
): Promise<T> {
  assertOnline();

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(`${scriptUrl}${query}`, { ...init, signal: controller.signal });
    if (!res.ok) throw new ApiError(`Server responded ${res.status}`, 'server');
    let body: (T & { ok?: boolean; error?: string; code?: string }) | undefined;
    try {
      body = await res.json();
    } catch {
      throw new ApiError('Server returned an unreadable response', 'server');
    }
    if (!body || body.ok !== true) {
      if (body?.code === 'AUTH_REQUIRED') {
        const current = loadSession();
        // A delayed failure from an old request must not sign out a newer session.
        if (sessionToken && current.token === sessionToken && current.scriptUrl === scriptUrl) {
          window.dispatchEvent(new CustomEvent('srm:session-expired', { detail: scriptUrl }));
        }
        throw new ApiError(body.error ?? 'Please sign in again.', 'auth');
      }
      throw new ApiError(body?.error ?? 'Server rejected the request', body?.code === 'FORBIDDEN' ? 'forbidden' : 'server');
    }
    return body;
  } catch (err) {
    if (err instanceof ApiError) throw err;
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new ApiError('The server took too long to respond', 'network');
    }
    throw new ApiError('Could not reach the server', 'network');
  } finally {
    clearTimeout(timer);
  }
}

function authRequest<T>(config: OrgConfig, action: string, data: object = {}): Promise<T> {
  const session = loadSession();
  if (!session.token || session.scriptUrl !== config.scriptUrl || !session.expiresAt || session.expiresAt <= Date.now()) {
    throw new ApiError('Your session has expired. Please sign in again.', 'auth');
  }
  return callScript<T>(config.scriptUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ ...data, action, key: config.apiKey || undefined, token: session.token }),
  }, '', session.token);
}

async function liveFetchRoster(config: OrgConfig): Promise<RosterPayload> {
  const body = await authRequest<RosterPayload>(config, 'roster');
  if (!Array.isArray(body.master) || !Array.isArray(body.health)) {
    throw new ApiError('Roster response is missing the master/health tabs', 'server');
  }
  return { master: body.master, health: body.health };
}

async function liveSubmit(config: OrgConfig, rows: AttendanceLogRow[]): Promise<SubmitResult> {
  return authRequest<SubmitResult>(config, 'appendAttendance', { entries: rows });
}

async function liveUpdateStudent(config: OrgConfig, childId: string, patch: StudentPatch): Promise<void> {
  const body = await authRequest<{ updatedMaster?: boolean; updatedHealth?: boolean }>(config, 'updateStudent', { childId, ...patch });
  if (!body.updatedMaster && !body.updatedHealth) {
    throw new ApiError("No matching columns changed on the sheet. Check its column names.", 'server');
  }
}

async function liveLogin(config: OrgConfig, username: string, password: string): Promise<Session> {
  const res = await callScript<Session>(config.scriptUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ action: 'login', key: config.apiKey || undefined, username, password }),
  });
  if (typeof res.token !== 'string' || !/^[a-f0-9]{64}$/.test(res.token) || typeof res.username !== 'string' || !res.username.trim() || typeof res.expiresAt !== 'number' || !Number.isFinite(res.expiresAt) || res.expiresAt <= Date.now() || !['viewer', 'editor'].includes(res.role ?? '')) {
    throw new ApiError('Update the Apps Script deployment to enable secure sign-in.', 'config');
  }
  return { ...res, scriptUrl: config.scriptUrl };
}

export async function validateSession(config: OrgConfig): Promise<Pick<Session, 'username' | 'role' | 'expiresAt'>> {
  const verified = await authRequest<Pick<Session, 'username' | 'role' | 'expiresAt'>>(config, 'session');
  if (verified.username !== loadSession().username || !['viewer', 'editor'].includes(verified.role ?? '') || typeof verified.expiresAt !== 'number' || !Number.isFinite(verified.expiresAt) || verified.expiresAt <= Date.now()) {
    throw new ApiError('The server could not verify your session. Please sign in again.', 'auth');
  }
  return verified;
}
export const revokeSession = (config: OrgConfig): Promise<unknown> => authRequest(config, 'logout');

// ---- Public API -----------------------------------------------------------------------

/** children_master!A2:N and health_and_conditions!A2:F in a single request. */
export const fetchRoster = (config: OrgConfig): Promise<RosterPayload> => liveFetchRoster(config);

/** Appends every entry to attendance_logs in one batch. Safe to retry (log_id is de-duplicated). */
export const submitAttendance = (entries: AttendanceEntry[], config: OrgConfig): Promise<SubmitResult> =>
  liveSubmit(config, entries.map(toLogRow));

/** Writes an edit to an existing child's record on the sheet. */
export const updateStudent = (childId: string, patch: StudentPatch, config: OrgConfig): Promise<void> =>
  liveUpdateStudent(config, childId, patch);

/**
 * Checks a username/password against the sheet's login_credentials tab. Throws ApiError with
 * a user-facing message on any failure (wrong credentials, no such tab, inactive account —
 * the server deliberately doesn't say which).
 */
export const login = (username: string, password: string, config: OrgConfig): Promise<Session> =>
  liveLogin(config, username, password);

/**
 * Tests a Sheet connection without touching the roster, for the Settings screen's
 * "Test connection" button. Throws ApiError on anything wrong; resolves on success.
 */
export async function pingScript(scriptUrl: string, apiKey: string): Promise<void> {
  const url = scriptUrl.trim();
  if (!url) throw new ApiError('Enter the Apps Script web app URL first', 'config');
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new ApiError('That doesn’t look like a valid URL', 'config');
  }
  // https is required (an Apps Script /exec URL always is); localhost is exempted so a
  // self-hosted stand-in for testing isn't blocked by this check.
  if (parsed.protocol !== 'https:' && parsed.hostname !== 'localhost') {
    throw new ApiError('The URL must start with https://', 'config');
  }
  await checkLoginRequired({ scriptUrl: url, apiKey, orgName: '', countryCode: '94', nationalLength: 9 });
}

/**
 * Require the authenticated backend protocol. Legacy or failed checks never unlock data.
 */
export async function checkLoginRequired(config: OrgConfig): Promise<boolean> {
  const params = new URLSearchParams({ action: 'ping' });
  if (config.apiKey) params.set('key', config.apiKey);
  const body = await callScript<{ ok: boolean; loginRequired?: boolean; authVersion?: number }>(config.scriptUrl, { method: 'GET' }, `?${params}`);
  if (body.authVersion !== 2 || body.loginRequired !== true) {
    throw new ApiError('Update the Apps Script deployment to enable secure sign-in.', 'config');
  }
  return true;
}
