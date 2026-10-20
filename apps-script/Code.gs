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
 *   POST { action: "updateStudent", key?, childId, master?: {header: value}, health?: {header: value} }
 *        -> { ok, updatedMaster, updatedHealth }
 *        Edits an existing child's record (e.g. from the app's "Edit" screen). `master` and
 *        `health` are partial {header_name: value} objects; only columns that already exist
 *        on that tab are written (an unknown header name is silently ignored, never adds a
 *        new column) and only a row that already exists for `childId` is updated — this
 *        action never creates a new student. To set a TRUE/FALSE condition, use that
 *        column's own header, e.g. {"Health_Heart_Disease": true}.
 *
 *   POST { action: "login", key?, username, password }
 *        -> { ok: true } or { ok: false, error }
 *        Checks `username`/`password` (plain text, sent once over HTTPS) against the SHA-256
 *        hash stored for that user on login_credentials — the sheet never holds a plain-text
 *        password. See "Setting a user's password" below for how an admin creates an account.
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
 *   login_credentials      Username, Password_Hash, Status (active/inactive, blank = active),
 *                          Role (viewer/editor, blank = editor — a dropdown is added automatically
 *                          by the "Set a user's password" menu item)
 *                          Only needed once you've connected the app to this sheet, which is
 *                          when it starts requiring login. Missing this tab (or having no
 *                          active user in it) makes every login attempt fail — it is never
 *                          treated as "no login needed". See "Setting a user's password" below
 *                          for how an admin creates the first account.
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
  logins: 'login_credentials',
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
    if (body.action === 'appendAttendance') return appendAttendance_(body.entries);
    if (body.action === 'updateStudent') return updateStudent_(body.childId, body.master, body.health);
    if (body.action === 'login') return login_(body.username, body.password);
    throw new Error('Unknown action: ' + body.action);
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

// ---- Editing a student -----------------------------------------------------------------

/** Writes `master`/`health` patches onto an EXISTING child's rows. Never creates a student. */
function updateStudent_(childId, masterPatch, healthPatch) {
  var id = String(childId || '').trim().toUpperCase();
  if (!id) throw new Error('childId is required');

  // Same lock as attendance: an edit must not interleave with a registration or another edit.
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    // The roster tab is the source of truth for "does this child exist" — a missing or
    // patch-free health tab is never itself an error, only children_master is mandatory.
    var masterSheet = getSpreadsheet_().getSheetByName(SHEETS.master);
    if (!masterSheet) throw new Error('Missing tab: ' + SHEETS.master);
    var masterRow = findRow_(masterSheet, id);
    if (masterRow === -1) throw new Error('No existing record for ' + id + ' on ' + SHEETS.master);
    var updatedMaster = writePatch_(masterSheet, masterRow, masterPatch);

    var updatedHealth = false;
    var healthSheet = getSpreadsheet_().getSheetByName(SHEETS.health);
    if (healthSheet) {
      var healthRow = findRow_(healthSheet, id);
      if (healthRow !== -1) updatedHealth = writePatch_(healthSheet, healthRow, healthPatch);
    }
    return { ok: true, updatedMaster: updatedMaster, updatedHealth: updatedHealth };
  } finally {
    lock.releaseLock();
  }
}

/** Row number (1-based) of `id` on `sheet`, by its child-ID-like column, or -1 if absent. */
function findRow_(sheet, id) {
  var headers = readHeaders_(sheet);
  var idCol = firstIndex_(headers, function (h) { return h.indexOf('child_id') === 0; });
  if (idCol === -1) throw new Error(sheet.getName() + ' has no child ID column');
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return -1;
  var ids = sheet.getRange(2, idCol + 1, lastRow - 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) {
    if (String(ids[i][0]).trim().toUpperCase() === id) return i + 2;
  }
  return -1;
}

/**
 * Overwrites the given columns of `rowIndex` by header name. Returns whether anything was
 * actually written — false for an empty/missing patch, or one whose headers don't match any
 * column (ignored rather than creating a new one: editing a student never changes the schema).
 */
function writePatch_(sheet, rowIndex, patch) {
  if (!patch || typeof patch !== 'object') return false;
  var headers = readHeaders_(sheet);
  var applied = false;
  Object.keys(patch).forEach(function (rawHeader) {
    var col = headers.indexOf(normalizeHeader_(rawHeader));
    if (col === -1) return; // unknown column: ignore rather than invent one
    var value = patch[rawHeader];
    var cell = sheet.getRange(rowIndex, col + 1);
    if (typeof value === 'string' && /^0\d+$/.test(value)) cell.setNumberFormat('@'); // keep a leading 0
    cell.setValue(value === null || value === undefined ? '' : value);
    applied = true;
  });
  return applied;
}

function firstIndex_(list, predicate) {
  for (var i = 0; i < list.length; i++) if (predicate(list[i])) return i;
  return -1;
}

// ---- Login ------------------------------------------------------------------------------
//
// Setting a user's password (do this once per user, from the Apps Script editor):
//   1. Open this project's editor (Extensions > Apps Script from the spreadsheet).
//   2. Select the "setUserPassword" function in the dropdown next to Run, then click Run.
//   3. It will prompt for a username and a new password, hash the password, and write the
//      hash to login_credentials (creating the tab and the row if they don't exist yet).
// The sheet only ever stores the hash — the password you type is never written anywhere.

/** Checks a username/password against login_credentials. Never reveals which part was wrong. */
function login_(username, password) {
  var name = String(username || '').trim();
  var pass = String(password || '');
  if (!name || !pass) throw new Error('Username and password are required');

  var sheet = getSpreadsheet_().getSheetByName(SHEETS.logins);
  if (!sheet) throw new Error('Invalid username or password'); // no login_credentials tab yet

  var headers = readHeaders_(sheet);
  var userCol = headers.indexOf('username');
  var hashCol = headers.indexOf('password_hash');
  var statusCol = headers.indexOf('status');
  var roleCol = headers.indexOf('role');
  if (userCol === -1 || hashCol === -1) throw new Error('login_credentials is missing Username/Password_Hash columns');

  var lastRow = sheet.getLastRow();
  if (lastRow < 2) throw new Error('Invalid username or password');
  var rows = sheet.getRange(2, 1, lastRow - 1, headers.length).getValues();
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i][userCol]).trim().toLowerCase() !== name.toLowerCase()) continue;
    var status = statusCol === -1 ? 'active' : String(rows[i][statusCol] || 'active').trim().toLowerCase();
    if (status === 'inactive') throw new Error('Invalid username or password');
    if (String(rows[i][hashCol]) === sha256Hex_(pass)) {
      // No Role column, or the cell is blank, means full access — matches every account's
      // behaviour before roles existed, so adding the column never silently locks anyone out.
      var role = roleCol === -1 ? 'editor' : String(rows[i][roleCol] || 'editor').trim().toLowerCase();
      if (role !== 'viewer' && role !== 'editor') role = 'editor';
      return { ok: true, role: role };
    }
    throw new Error('Invalid username or password');
  }
  throw new Error('Invalid username or password'); // same message as a wrong password: don't reveal which
}

/** Prompts for a username + new password (Apps Script editor only) and stores its hash. */
function setUserPassword() {
  var ui = SpreadsheetApp.getUi();
  var userResponse = ui.prompt('Set a user\'s password', 'Username:', ui.ButtonSet.OK_CANCEL);
  if (userResponse.getSelectedButton() !== ui.Button.OK) return;
  var username = userResponse.getResponseText().trim();
  if (!username) return ui.alert('Username cannot be blank.');

  // Apps Script's prompt box is NOT masked (it shows as plain text while typing) — there is
  // no password-style input available server-side. The value is still never written to the
  // sheet; only its hash is stored.
  var passResponse = ui.prompt('Set a user\'s password', 'New password for "' + username + '" (typed in plain view, but never saved as plain text):', ui.ButtonSet.OK_CANCEL);
  if (passResponse.getSelectedButton() !== ui.Button.OK) return;
  var password = passResponse.getResponseText();
  if (!password) return ui.alert('Password cannot be blank.');

  var roleResponse = ui.prompt(
    'Set a user\'s password',
    'Role for "' + username + '" — type "viewer" (read-only) or "editor" (can edit records). Leave blank for editor:',
    ui.ButtonSet.OK_CANCEL,
  );
  if (roleResponse.getSelectedButton() !== ui.Button.OK) return;
  var roleInput = roleResponse.getResponseText().trim().toLowerCase();
  var role = roleInput === 'viewer' ? 'viewer' : 'editor';

  var ss = getSpreadsheet_();
  var sheet = ss.getSheetByName(SHEETS.logins) || ss.insertSheet(SHEETS.logins);
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, 4).setValues([['Username', 'Password_Hash', 'Status', 'Role']]).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  var headers = readHeaders_(sheet);
  var userCol = headers.indexOf('username');
  var hashCol = headers.indexOf('password_hash');
  var statusCol = headers.indexOf('status');
  var roleCol = headers.indexOf('role');
  if (roleCol === -1) {
    roleCol = headers.length;
    sheet.getRange(1, roleCol + 1).setValue('Role').setFontWeight('bold');
  }

  // Dropdown (viewer/editor) on the Role column, covering plenty of future rows so anyone
  // adding a user directly on the sheet gets the same two choices instead of free-typing it.
  var validation = SpreadsheetApp.newDataValidation().requireValueInList(['viewer', 'editor'], true).setAllowInvalid(false).build();
  sheet.getRange(2, roleCol + 1, 998, 1).setDataValidation(validation);

  var lastRow = sheet.getLastRow();
  var rowIndex = -1;
  if (lastRow > 1) {
    var ids = sheet.getRange(2, userCol + 1, lastRow - 1, 1).getValues();
    for (var i = 0; i < ids.length; i++) {
      if (String(ids[i][0]).trim().toLowerCase() === username.toLowerCase()) {
        rowIndex = i + 2;
        break;
      }
    }
  }
  if (rowIndex === -1) rowIndex = lastRow + 1;

  sheet.getRange(rowIndex, userCol + 1).setValue(username);
  sheet.getRange(rowIndex, hashCol + 1).setValue(sha256Hex_(password));
  if (statusCol !== -1 && !sheet.getRange(rowIndex, statusCol + 1).getValue()) {
    sheet.getRange(rowIndex, statusCol + 1).setValue('active');
  }
  sheet.getRange(rowIndex, roleCol + 1).setValue(role);
  ui.alert('Password set for "' + username + '" (role: ' + role + ').');
}

/** SHA-256 of `s`, as lowercase hex — matches the hash in login_credentials. */
function sha256Hex_(s) {
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, s, Utilities.Charset.UTF_8);
  return bytes
    .map(function (b) {
      var v = (b + 256) % 256; // Apps Script bytes are signed (-128..127)
      return (v < 16 ? '0' : '') + v.toString(16);
    })
    .join('');
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
