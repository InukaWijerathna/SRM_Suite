/**
 * SRM Suite (Student Record Manager): Google Apps Script backend.
 *
 * Deploy as a web app (see README.md). It exposes two things to the PWA:
 *
 *   GET  ?action=roster[&key=..]
 *        -> { ok, master: [...children_master rows], health: [...health_and_conditions rows] }
 *
 *   POST { action: "appendAttendance", key?, entries: [{log_id, timestamp, child_id, attendance_status}] }
 *        -> { ok, appended, duplicates }
 *
 * Sheet tabs (header names in row 1; column ORDER does not matter, names do):
 *   children_master        Child_ID_LKA006XXXX_4_digits, Name_of_Child, Gender, Contact_Number,
 *                          Whatsapp_Number, Address, GN_Division, Father_s_Name, Mother_s_Name,
 *                          School_Grade, plus optional Birthday, Child_Name_In_BC, Office_Name,
 *                          Care_Giver, Religion, Picture_Ref, Status
 *   health_and_conditions  Child_ID_LKA006XXXX_4_digits, Weight_Kg, Height_cm, Body_Mass_Index_BMI,
 *                          then one TRUE/FALSE column per medical condition, e.g.
 *                          Health_Heart_Disease, Disability_Visual_Impairment
 *                          (this tab is optional: the same columns may live on children_master)
 *   attendance_logs        log_id, timestamp, child_id, attendance_status   (starts empty)
 *
 * The script does not interpret the roster columns. It returns every column as-is (header
 * lower-cased, TRUE/FALSE as booleans) and the app matches them by name, so older
 * snake_case headers (child_id, full_name, ...) keep working too.
 *
 * Optional Script Properties (Project Settings > Script properties):
 *   API_KEY          if set, every request must send the same key (?key=... / body.key)
 *   SPREADSHEET_ID   only needed when the script is NOT bound to the spreadsheet
 */

var SHEETS = {
  master: 'children_master',
  health: 'health_and_conditions',
  logs: 'attendance_logs',
};
var LOG_HEADERS = ['log_id', 'timestamp', 'child_id', 'attendance_status'];
var VALID_STATUSES = ['Present', 'Absent', 'Late'];
var MAX_ENTRIES_PER_REQUEST = 1000;

// ---- Web app entry points ------------------------------------------------------------

function doGet(e) {
  return respond_(function () {
    var params = (e && e.parameter) || {};
    requireKey_(params.key);
    var action = params.action || 'roster';

    if (action === 'roster') {
      return {
        ok: true,
        master: readRows_(SHEETS.master),
        health: readRows_(SHEETS.health, true),
        generatedAt: new Date().toISOString(),
      };
    }
    if (action === 'ping') return { ok: true };
    throw new Error('Unknown action: ' + action);
  });
}

function doPost(e) {
  return respond_(function () {
    var body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    requireKey_(body.key);
    if (body.action !== 'appendAttendance') throw new Error('Unknown action: ' + body.action);
    return appendAttendance_(body.entries);
  });
}

/** Run once from the editor to authorise the script and create the attendance_logs tab. */
function setup() {
  getLogSheet_();
}

// ---- Attendance ----------------------------------------------------------------------

function appendAttendance_(entries) {
  if (!Array.isArray(entries) || entries.length === 0) throw new Error('No entries to append');
  if (entries.length > MAX_ENTRIES_PER_REQUEST) {
    throw new Error('Too many entries in one request (max ' + MAX_ENTRIES_PER_REQUEST + ')');
  }
  var clean = entries.map(validateEntry_);

  // One writer at a time, so two devices syncing together cannot interleave or double-write.
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var sheet = getLogSheet_();
    var headers = readHeaders_(sheet);
    var idCol = headers.indexOf('log_id');
    if (idCol === -1) throw new Error('attendance_logs has no log_id column');

    // A retried batch (lost response) carries the same log_ids: skip anything already stored.
    var lastRow = sheet.getLastRow();
    var known = {};
    if (lastRow > 1) {
      sheet
        .getRange(2, idCol + 1, lastRow - 1, 1)
        .getValues()
        .forEach(function (r) {
          known[String(r[0])] = true;
        });
    }
    var fresh = clean.filter(function (entry) {
      if (known[entry.log_id]) return false;
      known[entry.log_id] = true;
      return true;
    });

    if (fresh.length > 0) {
      var rows = fresh.map(function (entry) {
        return headers.map(function (h) {
          return entry[h] === undefined ? '' : entry[h];
        });
      });
      var range = sheet.getRange(lastRow + 1, 1, rows.length, headers.length);
      // Plain text, so Sheets keeps "2026-09-24T08:14:05Z" instead of converting it to a date.
      range.setNumberFormat('@');
      range.setValues(rows);
    }
    return { ok: true, appended: fresh.length, duplicates: clean.length - fresh.length };
  } finally {
    lock.releaseLock();
  }
}

function validateEntry_(entry) {
  if (!entry || typeof entry !== 'object') throw new Error('Malformed entry');
  var logId = String(entry.log_id || '').trim();
  var childId = String(entry.child_id || '').trim();
  var status = String(entry.attendance_status || '').trim();
  var timestamp = String(entry.timestamp || '').trim();

  if (!logId || !childId) throw new Error('Every entry needs log_id and child_id');
  if (VALID_STATUSES.indexOf(status) === -1) throw new Error('Invalid attendance_status: ' + status);
  if (isNaN(Date.parse(timestamp))) throw new Error('Invalid timestamp: ' + timestamp);

  return { log_id: logId, timestamp: timestamp, child_id: childId, attendance_status: status };
}

/** Returns the attendance_logs tab, creating it (with headers) when missing or empty. */
function getLogSheet_() {
  var ss = getSpreadsheet_();
  var sheet = ss.getSheetByName(SHEETS.logs) || ss.insertSheet(SHEETS.logs);
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, LOG_HEADERS.length).setValues([LOG_HEADERS]).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function readHeaders_(sheet) {
  return sheet
    .getRange(1, 1, 1, Math.max(sheet.getLastColumn(), 1))
    .getValues()[0]
    .map(normalizeHeader_);
}

// ---- Roster --------------------------------------------------------------------------

/**
 * Reads a tab into [{header: value}], skipping blank rows. Header names are the row-1 cells.
 * A missing tab is an error unless `optional`, in which case it reads as no rows.
 */
function readRows_(tabName, optional) {
  var sheet = getSpreadsheet_().getSheetByName(tabName);
  if (!sheet) {
    if (optional) return [];
    throw new Error('Missing tab: ' + tabName);
  }

  var values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];

  var headers = values[0].map(normalizeHeader_);
  var rows = [];
  for (var r = 1; r < values.length; r++) {
    var row = {};
    var blank = true;
    for (var c = 0; c < headers.length; c++) {
      if (!headers[c]) continue;
      var value = values[r][c];
      if (value instanceof Date) value = value.toISOString();
      if (value !== '' && value !== null) blank = false;
      row[headers[c]] = value;
    }
    if (!blank) rows.push(row);
  }
  return rows;
}

// ---- Helpers -------------------------------------------------------------------------

function getSpreadsheet_() {
  var id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  return id ? SpreadsheetApp.openById(id) : SpreadsheetApp.getActiveSpreadsheet();
}

function normalizeHeader_(h) {
  return String(h).trim().toLowerCase();
}

function requireKey_(key) {
  var expected = PropertiesService.getScriptProperties().getProperty('API_KEY');
  if (expected && key !== expected) throw new Error('Unauthorized');
}

function respond_(fn) {
  var result;
  try {
    result = fn();
  } catch (err) {
    result = { ok: false, error: String((err && err.message) || err) };
  }
  return ContentService.createTextOutput(JSON.stringify(result)).setMimeType(ContentService.MimeType.JSON);
}
