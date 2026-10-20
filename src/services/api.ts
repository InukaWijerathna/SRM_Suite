import type { AttendanceEntry, AttendanceLogRow, OrgConfig, RosterPayload, SubmitResult } from '../types';
import { loadMockLogs, saveMockLogs } from './storage';

/**
 * Data access for the Google Sheet. Which mode is used is decided per call from the
 * `OrgConfig` the caller passes in (itself read from the Settings screen, not a build-time
 * env var) — so the same app build serves any organization, and switching sheets or
 * resetting to demo data never needs a rebuild.
 *
 *  - mock (no scriptUrl configured): simulated latency; attendance is written to
 *    localStorage, standing in for the attendance_logs tab.
 *  - live (scriptUrl configured): GET/POST against the Google Apps Script web app in
 *    /apps-script/Code.gs, which keeps the Google credentials server-side instead of in the
 *    browser bundle.
 *
 * Wire format (both directions use the sheet's own column names):
 *   GET  ?action=roster[&key=..]  ->  { ok, master: Row[], health: Row[] }
 *   POST { action: "appendAttendance", key?, entries: AttendanceLogRow[] }
 *                                 ->  { ok, appended, duplicates }
 */

export type ApiMode = 'mock' | 'live';

export const apiModeOf = (config: Pick<OrgConfig, 'scriptUrl'>): ApiMode =>
  config.scriptUrl.trim() ? 'live' : 'mock';

const REQUEST_TIMEOUT_MS = 30_000;
const MOCK_LATENCY_MS = { roster: 900, submit: 700 };

export class ApiError extends Error {
  constructor(
    message: string,
    readonly kind: 'offline' | 'config' | 'network' | 'server',
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

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

// ---- MOCK -----------------------------------------------------------------------------

async function mockFetchRoster(): Promise<RosterPayload> {
  await sleep(MOCK_LATENCY_MS.roster);
  assertOnline();
  const { mockMasterRows, mockHealthRows } = await import('../data/mockData');
  return { master: mockMasterRows, health: mockHealthRows };
}

async function mockSubmit(rows: AttendanceLogRow[]): Promise<SubmitResult> {
  await sleep(MOCK_LATENCY_MS.submit);
  assertOnline();
  const existing = loadMockLogs();
  const seen = new Set(existing.map((r) => r.log_id));
  const fresh = rows.filter((r) => !seen.has(r.log_id));
  if (!saveMockLogs([...existing, ...fresh])) {
    throw new ApiError('Browser storage is full', 'server');
  }
  return { appended: fresh.length, duplicates: rows.length - fresh.length };
}

// ---- LIVE (Google Apps Script web app) ------------------------------------------------

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

// ---- Public API -----------------------------------------------------------------------

/** children_master!A2:N and health_and_conditions!A2:F in a single request. */
export const fetchRoster = (config: OrgConfig): Promise<RosterPayload> =>
  apiModeOf(config) === 'live' ? liveFetchRoster(config) : mockFetchRoster();

/** Appends every entry to attendance_logs in one batch. Safe to retry (log_id is de-duplicated). */
export const submitAttendance = (entries: AttendanceEntry[], config: OrgConfig): Promise<SubmitResult> => {
  const rows = entries.map(toLogRow);
  return apiModeOf(config) === 'live' ? liveSubmit(config, rows) : mockSubmit(rows);
};

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
