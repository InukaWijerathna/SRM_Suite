import type { AttendanceEntry, AttendanceLogRow, OrgConfig, Role, RosterPayload, StudentPatch, SubmitResult } from '../types';

/**
 * Data access for the Google Sheet. The `OrgConfig` the caller passes in (read from the
 * Settings screen, not a build-time env var) is what makes the same app build serve any
 * organization — GET/POST against the Google Apps Script web app in /apps-script/Code.gs,
 * which keeps the Google credentials server-side instead of in the browser bundle.
 *
 * Wire format (both directions use the sheet's own column names):
 *   GET  ?action=roster[&key=..]  ->  { ok, master: Row[], health: Row[] }
 *   POST { action: "appendAttendance", key?, entries: AttendanceLogRow[] }
 *                                 ->  { ok, appended, duplicates }
 */

const REQUEST_TIMEOUT_MS = 30_000;

export class ApiError extends Error {
  constructor(
    message: string,
    readonly kind: 'offline' | 'config' | 'network' | 'server',
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
): Promise<T> {
  assertOnline();

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(`${scriptUrl}${query}`, { ...init, signal: controller.signal });
    if (!res.ok) throw new ApiError(`Server responded ${res.status}`, 'server');
    let body: (T & { ok?: boolean; error?: string }) | undefined;
    try {
      body = await res.json();
    } catch {
      throw new ApiError('Server returned an unreadable response', 'server');
    }
    if (!body || body.ok === false) {
      throw new ApiError(body?.error ?? 'Server rejected the request', 'server');
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

async function liveFetchRoster(config: OrgConfig): Promise<RosterPayload> {
  const params = new URLSearchParams({ action: 'roster' });
  if (config.apiKey) params.set('key', config.apiKey);
  const body = await callScript<RosterPayload>(config.scriptUrl, { method: 'GET' }, `?${params}`);
  if (!Array.isArray(body.master) || !Array.isArray(body.health)) {
    throw new ApiError('Roster response is missing the master/health tabs', 'server');
  }
  return { master: body.master, health: body.health };
}

async function liveSubmit(config: OrgConfig, rows: AttendanceLogRow[]): Promise<SubmitResult> {
  const body = await callScript<Partial<SubmitResult>>(config.scriptUrl, {
    method: 'POST',
    // text/plain keeps this a "simple" CORS request: Apps Script cannot answer preflights.
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ action: 'appendAttendance', key: config.apiKey || undefined, entries: rows }),
  });
  return { appended: body.appended ?? rows.length, duplicates: body.duplicates ?? 0 };
}

async function liveUpdateStudent(config: OrgConfig, childId: string, patch: StudentPatch): Promise<void> {
  const body = await callScript<{ updatedMaster?: boolean; updatedHealth?: boolean }>(config.scriptUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({
      action: 'updateStudent',
      key: config.apiKey || undefined,
      childId,
      master: patch.master,
      health: patch.health,
    }),
  });
  if (!body.updatedMaster && !body.updatedHealth) {
    // The call succeeded but nothing matched a real column — almost always a header-name
    // mismatch (see StudentPatch), not a transient failure, so say so plainly.
    throw new ApiError(
      "Saved, but nothing changed on the sheet — its column names may not match the app's (see README).",
      'server',
    );
  }
}

async function liveLogin(config: OrgConfig, username: string, password: string): Promise<Role> {
  const res = await callScript<{ ok: boolean; role?: string }>(config.scriptUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ action: 'login', key: config.apiKey || undefined, username, password }),
  });
  return res.role === 'viewer' ? 'viewer' : 'editor';
}

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
export const login = (username: string, password: string, config: OrgConfig): Promise<Role> =>
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
  const params = new URLSearchParams({ action: 'ping' });
  if (apiKey) params.set('key', apiKey);
  await callScript<{ ok: boolean }>(url, { method: 'GET' }, `?${params}`);
}

/**
 * Whether this sheet actually has a login set up. login_credentials is optional — defaults
 * to false (no login) when the field is missing entirely, so a sheet running an older
 * Code.gs (deployed before the login feature existed) keeps working without a redeploy.
 */
export async function checkLoginRequired(config: OrgConfig): Promise<boolean> {
  const params = new URLSearchParams({ action: 'ping' });
  if (config.apiKey) params.set('key', config.apiKey);
  const body = await callScript<{ ok: boolean; loginRequired?: boolean }>(config.scriptUrl, { method: 'GET' }, `?${params}`);
  return body.loginRequired === true;
}
