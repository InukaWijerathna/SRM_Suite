/**
 * Student registration through a Google Form.
 *
 * Add this file to the SAME Apps Script project as Code.gs (it reuses its helpers).
 *
 *   1. Reload the spreadsheet: a "SRM Suite" menu appears.
 *      SRM Suite > Create registration form   (once; approve the permissions)
 *   2. Share the form's link with whoever registers students.
 *
 * Every submission then:
 *   - is appended to children_master and health_and_conditions (one TRUE/FALSE column per
 *     condition, BMI as a formula), so the tracker app sees the child on its next Sync;
 *   - gets a QR code that contains ONLY the child ID (what the scanner expects), saved as
 *     <ChildID>.png in the Drive folder "Student QR Codes", linked in the QR_Code_Link column
 *     and emailed to the registrar;
 *   - is marked in the Registration_Status column of the form's response tab. Duplicate or
 *     malformed IDs are rejected there and nothing is written to the roster.
 *
 * SRM Suite > Generate missing QR codes makes codes for children already in the sheet.
 *
 * Script properties (optional): REGISTRAR_EMAIL (default: the account that owns the script).
 *
 * Privacy: the QR image is drawn by quickchart.io (fallback api.qrserver.com). Only the child ID,
 * e.g. LKA0060410, is sent to them: no name, address or health data.
 */

var ID_PREFIX = 'LKA006';
var QR_HEADER = 'QR_Code_Link';
var STATUS_HEADER = 'Registration_Status';
var QR_FOLDER_NAME = 'Student QR Codes';
var TIME_BUDGET_MS = 5 * 60 * 1000; // Apps Script stops a run at 6 minutes

// Question titles are the sheet's column headers, so response columns line up with the roster.
var Q = {
  id: 'Child_ID_LKA006XXXX_4_digits',
  name: 'Name_of_Child',
  gender: 'Gender',
  contact: 'Contact_Number',
  whatsapp: 'Whatsapp_Number',
  address: 'Address',
  gn: 'GN_Division',
  father: 'Father_s_Name',
  mother: 'Mother_s_Name',
  grade: 'School_Grade',
  birthday: 'Birthday',
  nameLocal: 'Child_Name_In_BC',
  officeName: 'Office_Name',
  weight: 'Weight_Kg',
  height: 'Height_cm',
  careGiver: 'Care_Giver',
  religion: 'Religion',
  health: 'Health',
  disability: 'Disability',
};

// Ticking a choice sets the matching TRUE/FALSE column (Health_Heart_Disease ...). A new choice
// added to the form gets its own column automatically.
var HEALTH_CHOICES = ['Heart Disease', 'Kidney Failure', 'Respiratory', 'Under Weight', 'Over Weight'];
var DISABILITY_CHOICES = ['Visual Impairment', 'Brain Lesion'];
var GRADE_CHOICES = ['Preschool'].concat(
  [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13].map(function (n) {
    return 'Grade ' + n;
  })
);

// ---- Menu ----------------------------------------------------------------------------

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('SRM Suite')
    .addItem('Create registration form', 'createRegistrationForm')
    .addItem('Generate missing QR codes', 'generateMissingQrCodes')
    .addToUi();
}

// ---- Form ----------------------------------------------------------------------------

/** Builds the form, links it to this spreadsheet and installs the on-submit trigger. */
function createRegistrationForm() {
  var props = PropertiesService.getScriptProperties();
  var existing = props.getProperty('REGISTRATION_FORM_ID');
  if (existing) {
    try {
      var url = FormApp.openById(existing).getPublishedUrl();
      notify_('The registration form already exists:\n' + url);
      return url;
    } catch (err) {
      // The old form was deleted: fall through and build a new one.
    }
  }

  var ss = getSpreadsheet_();
  var form = FormApp.create('Student Registration')
    .setDescription('Register a student. A QR code is created automatically and the student is added to the tracker.')
    .setConfirmationMessage('Registered. The QR code has been saved to Drive and emailed to the registrar.')
    .setShowLinkToRespondAgain(true)
    .setCollectEmail(false);

  addQuestions_(form);
  form.setDestination(FormApp.DestinationType.SPREADSHEET, ss.getId());
  installSubmitTrigger_(ss);

  props.setProperty('REGISTRATION_FORM_ID', form.getId());
  var publishedUrl = form.getPublishedUrl();
  notify_('Registration form created.\n\nShare this link:\n' + publishedUrl + '\n\nEdit it here:\n' + form.getEditUrl());
  return publishedUrl;
}

function addQuestions_(form) {
  var idRule = FormApp.createTextValidation()
    .setHelpText('Enter the 4 digits (0410) or the full ID (LKA0060410).')
    .requireTextMatchesPattern('^([Ll][Kk][Aa]006)?[0-9]{4}$')
    .build();
  var phoneRule = FormApp.createTextValidation()
    .setHelpText('Digits only, e.g. 0771234567.')
    .requireTextMatchesPattern('^0?[0-9]{9}$')
    .build();
  var weightRule = FormApp.createTextValidation().requireNumberBetween(1, 200).build();
  var heightRule = FormApp.createTextValidation().requireNumberBetween(30, 220).build();

  form.addTextItem().setTitle(Q.id).setHelpText('The ID on the child\'s record.').setRequired(true).setValidation(idRule);
  form.addTextItem().setTitle(Q.name).setRequired(true);
  form.addTextItem().setTitle(Q.nameLocal).setHelpText('As on the birth certificate, if known.').setRequired(false);
  form.addMultipleChoiceItem().setTitle(Q.gender).setChoiceValues(['male', 'female']).setRequired(true);
  form.addDateItem().setTitle(Q.birthday).setRequired(true);
  form.addTextItem().setTitle(Q.contact).setRequired(true).setValidation(phoneRule);
  form.addTextItem().setTitle(Q.whatsapp).setRequired(false).setValidation(phoneRule);
  form.addParagraphTextItem().setTitle(Q.address).setRequired(true);
  form.addTextItem().setTitle(Q.gn).setRequired(true);
  form.addTextItem().setTitle(Q.officeName).setHelpText('Only needed if your programme runs more than one office/branch.').setRequired(false);
  form.addTextItem().setTitle(Q.father).setRequired(false);
  form.addTextItem().setTitle(Q.mother).setRequired(false);
  form.addListItem().setTitle(Q.grade).setChoiceValues(GRADE_CHOICES).setRequired(true);
  form.addTextItem().setTitle(Q.weight).setHelpText('kg').setRequired(true).setValidation(weightRule);
  form.addTextItem().setTitle(Q.height).setHelpText('cm').setRequired(true).setValidation(heightRule);
  form.addListItem().setTitle(Q.careGiver).setChoiceValues([
    'Both parents', 'Single parent (mother)', 'Single parent (father)', 'Guardian (grandparents)', 'Guardian (other)',
  ]).setRequired(false);
  form.addListItem().setTitle(Q.religion).setChoiceValues([
    'Buddhism', 'Catholicism', 'Christianity', 'Islam', 'Hinduism', 'Other',
  ]).setRequired(false);
  // Tick nothing when the child has none of these.
  form.addCheckboxItem().setTitle(Q.health).setHelpText('Tick every one that applies.').setChoiceValues(HEALTH_CHOICES).setRequired(false);
  form.addCheckboxItem().setTitle(Q.disability).setHelpText('Tick every one that applies.').setChoiceValues(DISABILITY_CHOICES).setRequired(false);
}

function installSubmitTrigger_(ss) {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'onRegistrationSubmit') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('onRegistrationSubmit').forSpreadsheet(ss).onFormSubmit().create();
}

// ---- Submission ----------------------------------------------------------------------

/** Installable spreadsheet trigger: runs once per form response. */
function onRegistrationSubmit(e) {
  var responses = e.range.getSheet();
  var row = e.range.getRow();

  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var result;
    try {
      result = registerStudent_(e.namedValues);
    } catch (err) {
      result = { ok: false, message: 'ERROR: ' + String((err && err.message) || err) };
      emailRegistrar_('Student registration failed', '<p>' + escapeHtml_(result.message) + '</p>', null);
    }
    setResponseStatus_(responses, row, result.message);
  } finally {
    lock.releaseLock();
  }
}

function registerStudent_(namedValues) {
  var a = flattenAnswers_(namedValues);
  var id = normalizeChildId_(a[key_(Q.id)]);
  if (!id) throw new Error('Invalid child ID "' + a[key_(Q.id)] + '"');
  var name = (a[key_(Q.name)] || '').trim();
  if (!name) throw new Error('Name is missing');

  var ss = getSpreadsheet_();
  var master = requireTab_(ss, SHEETS.master);
  var health = requireTab_(ss, SHEETS.health);
  var mHeaders = readHeaders_(master);
  var idCol = firstIndex_(mHeaders, function (h) { return h.indexOf('child_id') === 0; });
  if (idCol === -1) throw new Error('children_master has no child ID column');

  if (existingIds_(master, idCol)[id]) {
    return { ok: false, message: 'REJECTED: ' + id + ' is already registered' };
  }

  // Roster row
  var masterRow = mHeaders.map(function (h) {
    if (h.indexOf('child_id') === 0) return id;
    if (h === 'status') return 'active';
    if (h === key_(QR_HEADER)) return '';
    if (h === 'gender') return (a[h] || '').toLowerCase();
    if (h === 'contact_number' || h === 'whatsapp_number') return normalizePhone_(a[h]);
    return a[h] === undefined ? '' : a[h];
  });
  var masterRange = master.getRange(master.getLastRow() + 1, 1, 1, mHeaders.length);
  masterRange.setNumberFormat('@'); // text, so phone numbers keep their leading 0
  masterRange.setValues([masterRow]);
  var masterRowNumber = masterRange.getRow();

  // Health row: one TRUE/FALSE column per condition
  var selected = selectedConditions_(a);
  var hHeaders = readHeaders_(health);
  Object.keys(selected).forEach(function (columnKey) {
    if (hHeaders.indexOf(columnKey) === -1) {
      addConditionColumn_(health, hHeaders, columnKey, selected[columnKey]);
    }
  });
  var healthRowNumber = health.getLastRow() + 1;
  var healthRow = hHeaders.map(function (h) {
    if (h.indexOf('child_id') === 0) return id;
    if (h === 'weight_kg') return toNumber_(a[h]);
    if (h === 'height_cm') return toNumber_(a[h]);
    if (/^(health|disability)_/.test(h)) return !!selected[h];
    return '';
  });
  health.getRange(healthRowNumber, 1, 1, hHeaders.length).setValues([healthRow]);
  var bmiCol = hHeaders.indexOf('body_mass_index_bmi');
  var weightCol = hHeaders.indexOf('weight_kg');
  var heightCol = hHeaders.indexOf('height_cm');
  if (bmiCol !== -1 && weightCol !== -1 && heightCol !== -1) {
    var w = columnLetter_(weightCol + 1) + healthRowNumber;
    var h = columnLetter_(heightCol + 1) + healthRowNumber;
    health
      .getRange(healthRowNumber, bmiCol + 1)
      .setFormula('=IF(AND(ISNUMBER(' + w + '),ISNUMBER(' + h + '),' + h + '>0),ROUND(' + w + '/(' + h + '/100)^2,1),"")');
  }

  // QR code: the registration stands even if this part fails.
  try {
    var qr = fetchQrPng_(id);
    var file = getQrFolder_().createFile(qr.setName(id + '.png'));
    setQrLink_(master, mHeaders, masterRowNumber, file.getUrl());
    emailRegistrar_(
      'QR code for ' + name + ' (' + id + ')',
      '<p><b>' + escapeHtml_(name) + '</b> (' + id + ') is registered.</p><p><img src="cid:qr" width="240" height="240"></p>' +
        '<p>Print it, or open the PNG in the "' + QR_FOLDER_NAME + '" Drive folder.</p>',
      qr
    );
    return { ok: true, message: 'OK: registered, QR saved' };
  } catch (err) {
    return { ok: true, message: 'OK: registered, but the QR failed (' + String((err && err.message) || err) + '). Run SRM Suite > Generate missing QR codes.' };
  }
}

// ---- Bulk QR for children already in the sheet ---------------------------------------

function generateMissingQrCodes() {
  var started = Date.now();
  var master = requireTab_(getSpreadsheet_(), SHEETS.master);
  var headers = readHeaders_(master);
  var idCol = firstIndex_(headers, function (h) { return h.indexOf('child_id') === 0; });
  if (idCol === -1) throw new Error('children_master has no child ID column');

  var qrCol = headers.indexOf(key_(QR_HEADER));
  if (qrCol === -1) {
    qrCol = headers.length;
    master.getRange(1, qrCol + 1).setValue(QR_HEADER);
  }

  var lastRow = master.getLastRow();
  if (lastRow < 2) return notify_('No students yet.');
  var ids = master.getRange(2, idCol + 1, lastRow - 1, 1).getValues();
  var links = master.getRange(2, qrCol + 1, lastRow - 1, 1).getValues();

  var folder = getQrFolder_();
  var made = 0;
  var pending = 0;
  for (var i = 0; i < ids.length; i++) {
    var id = normalizeChildId_(ids[i][0]);
    if (!id || String(links[i][0]).trim() !== '') continue;
    if (Date.now() - started > TIME_BUDGET_MS) {
      pending++;
      continue;
    }
    try {
      var file = folder.createFile(fetchQrPng_(id).setName(id + '.png'));
      master.getRange(i + 2, qrCol + 1).setValue(file.getUrl());
      made++;
    } catch (err) {
      pending++;
    }
  }
  notify_('Created ' + made + ' QR code(s).' + (pending ? '\n' + pending + ' still to do: run it again.' : '\nAll students have a QR code.'));
}

// ---- QR + Drive + mail ---------------------------------------------------------------

function fetchQrPng_(text) {
  var urls = [
    'https://quickchart.io/qr?size=400&margin=2&text=' + encodeURIComponent(text),
    'https://api.qrserver.com/v1/create-qr-code/?size=400x400&margin=10&data=' + encodeURIComponent(text),
  ];
  for (var i = 0; i < urls.length; i++) {
    try {
      var res = UrlFetchApp.fetch(urls[i], { muteHttpExceptions: true });
      if (res.getResponseCode() === 200) {
        var blob = res.getBlob();
        if (/image\/png/.test(blob.getContentType() || '')) return blob;
      }
    } catch (err) {
      // try the next service
    }
  }
  throw new Error('no QR service reachable');
}

function getQrFolder_() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('QR_FOLDER_ID');
  if (id) {
    try {
      return DriveApp.getFolderById(id);
    } catch (err) {
      // folder was deleted: recreate below
    }
  }
  var found = DriveApp.getFoldersByName(QR_FOLDER_NAME);
  var folder = found.hasNext() ? found.next() : DriveApp.createFolder(QR_FOLDER_NAME);
  props.setProperty('QR_FOLDER_ID', folder.getId());
  return folder;
}

function setQrLink_(master, headers, row, url) {
  var col = headers.indexOf(key_(QR_HEADER));
  if (col === -1) {
    col = headers.length;
    master.getRange(1, col + 1).setValue(QR_HEADER);
  }
  master.getRange(row, col + 1).setValue(url);
}

function emailRegistrar_(subject, htmlBody, qrBlob) {
  try {
    var to = PropertiesService.getScriptProperties().getProperty('REGISTRAR_EMAIL') || Session.getEffectiveUser().getEmail();
    var options = { to: to, subject: subject, htmlBody: htmlBody };
    if (qrBlob) {
      options.attachments = [qrBlob];
      options.inlineImages = { qr: qrBlob };
    }
    MailApp.sendEmail(options);
  } catch (err) {
    // A mail problem (quota, no address) must never undo a registration.
  }
}

// ---- Sheet helpers -------------------------------------------------------------------

function requireTab_(ss, name) {
  var sheet = ss.getSheetByName(name);
  if (!sheet) throw new Error('Missing tab: ' + name);
  return sheet;
}

function existingIds_(sheet, idCol) {
  var seen = {};
  var lastRow = sheet.getLastRow();
  if (lastRow > 1) {
    sheet.getRange(2, idCol + 1, lastRow - 1, 1).getValues().forEach(function (r) {
      var id = normalizeChildId_(r[0]);
      if (id) seen[id] = true;
    });
  }
  return seen;
}

/** Adds a TRUE/FALSE column for a condition that has no column yet, FALSE for existing children. */
function addConditionColumn_(sheet, headers, columnKey, label) {
  var col = headers.length + 1;
  sheet.getRange(1, col).setValue(label.header);
  headers.push(columnKey);
  var existing = sheet.getLastRow() - 1;
  if (existing > 0) {
    var falses = [];
    for (var i = 0; i < existing; i++) falses.push([false]);
    sheet.getRange(2, col, existing, 1).setValues(falses);
  }
}

function setResponseStatus_(sheet, row, message) {
  var lastCol = Math.max(sheet.getLastColumn(), 1);
  var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(normalizeHeader_);
  var col = headers.indexOf(key_(STATUS_HEADER));
  if (col === -1) {
    col = headers.length;
    sheet.getRange(1, col + 1).setValue(STATUS_HEADER);
  }
  sheet.getRange(row, col + 1).setValue(message);
}

// ---- Value helpers -------------------------------------------------------------------

function key_(header) {
  return normalizeHeader_(header);
}

/** {Title: ["answer"]} from the form trigger -> {title_lowercase: "answer"} */
function flattenAnswers_(namedValues) {
  var out = {};
  Object.keys(namedValues || {}).forEach(function (title) {
    var value = namedValues[title];
    out[normalizeHeader_(title)] = String(Array.isArray(value) ? value[0] : value || '').trim();
  });
  return out;
}

/** "0410" / "lka0060410" -> "LKA0060410"; anything else -> null. */
function normalizeChildId_(raw) {
  var s = String(raw === undefined || raw === null ? '' : raw).trim().toUpperCase().replace(/\s+/g, '');
  if (/^[0-9]{4}$/.test(s)) return ID_PREFIX + s;
  if (/^LKA[0-9]{7}$/.test(s)) return s;
  return null;
}

/** 771234567 -> "0771234567" (Sheets drops the leading zero of numeric cells). */
function normalizePhone_(raw) {
  var d = String(raw || '').replace(/\D/g, '');
  if (!d) return '';
  return d.length === 9 ? '0' + d : d;
}

function toNumber_(raw) {
  var n = parseFloat(String(raw || '').replace(',', '.'));
  return isNaN(n) ? '' : n;
}

/** Ticked Health/Disability choices -> { "health_heart_disease": {header: "Health_Heart_Disease"} } */
function selectedConditions_(answers) {
  var out = {};
  [[Q.health, 'Health'], [Q.disability, 'Disability']].forEach(function (pair) {
    String(answers[key_(pair[0])] || '')
      .split(/\s*,\s*/)
      .forEach(function (label) {
        if (!label) return;
        var words = label.replace(/[^A-Za-z0-9]+/g, ' ').trim().split(/\s+/);
        var header = pair[1] + '_' + words.map(function (w) { return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase(); }).join('_');
        out[header.toLowerCase()] = { header: header };
      });
  });
  return out;
}

function firstIndex_(list, predicate) {
  for (var i = 0; i < list.length; i++) if (predicate(list[i])) return i;
  return -1;
}

function columnLetter_(n) {
  var s = '';
  while (n > 0) {
    var m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function escapeHtml_(s) {
  return String(s).replace(/[&<>"]/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
  });
}

function notify_(message) {
  try {
    SpreadsheetApp.getUi().alert(message);
  } catch (err) {
    Logger.log(message); // running from the editor or a trigger: no UI
  }
}
