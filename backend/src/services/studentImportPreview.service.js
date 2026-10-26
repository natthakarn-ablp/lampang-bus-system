'use strict';

// Phase 10.13A-26A — student import preview / apply / report.
// Additive: persists batches + row-level results so imports are transparent,
// re-checkable and auditable, WITHOUT touching the existing legacy importer.

const fs = require('fs');
const crypto = require('crypto');
const ExcelJS = require('exceljs');
const { classifyImportRow, maskPhone } = require('../utils/studentImportClassifier');
const plateId = require('../utils/plateIdentity');
const { classifyStudentImport } = require('../utils/studentImport');
const { isOle2, isAllowedImport } = require('../utils/fileType');
const { decodeCsvBuffer } = require('../utils/readCsvWithEncoding');
const { parseCsvRecords } = require('../utils/csv');
const { readWorkbookSafely } = require('../utils/xlsxPreflight');
const { allocateStudentId } = require('./idAllocator.service');
const { logAudit } = require('../utils/audit');
const { getCurrentTerm } = require('./term.service');
const { generateVehicleId } = require('../utils/hash');
const { validatePlateNo } = require('../utils/vehiclePlate');

/**
 * Minimal RFC 4180 CSV parser — handles quoted fields with embedded commas
 * and escaped double-quotes. Replaces split(',') which broke on fields
 * containing commas (e.g. parent names).
 */
function parseCsvRow(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else { inQuotes = false; }
      } else { field += ch; }
    } else {
      if (ch === '"') { inQuotes = true; }
      else if (ch === ',') { row.push(field); field = ''; }
      else if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
      else if (ch === '\r') { /* skip */ }
      else { field += ch; }
    }
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

// Upper bound on rows a single import file may contain — mirrors the legacy
// POST /students/import cap (school.routes.js). Rejected before any per-row DB
// work so a (possibly decompression-bombed) file can't amplify into the DB.
const MAX_IMPORT_ROWS = 5000;
const canonOf = (plate) => { const p = plateId.parseLegacyPlateText(plate); return p ? plateId.buildCanonicalPlate(p) : ''; };
const normalizePhone = (p) => String(p == null ? '' : p).replace(/\D/g, '');

// ── Parse a CSV/XLS(X) import file into normalized rows. ─────────────────────
async function parseImportFile(filePath, originalName) {
  const rows = [];

  // Sniff the real first bytes before parsing so a renamed .xls (OLE2) or
  // spoofed/corrupt binary can't reach ExcelJS and trigger an unhandled 500.
  // The legacy POST /students/import already does this; the preview path
  // (/students/import/preview) reaches here and needs the same guard.
  let head;
  try { head = fs.readFileSync(filePath).subarray(0, 16); } catch { head = Buffer.alloc(0); }
  if (isOle2(head)) {
    const e = new Error('ไฟล์ .xls (รุ่นเก่า) ไม่รองรับ กรุณาบันทึกเป็น .xlsx หรือ .csv');
    e.statusCode = 400;
    throw e;
  }
  if (!isAllowedImport(head)) {
    const e = new Error('ไฟล์ไม่ถูกต้อง รองรับเฉพาะ .xlsx หรือ .csv');
    e.statusCode = 400;
    throw e;
  }

  const isExcel = /\.xlsx?$/i.test(originalName || filePath);
  const pick = (cells, map, key) => (map[key] != null ? String(cells[map[key]] ?? '').trim() : '');
  const buildMap = (headers) => {
    const m = {};
    headers.forEach((h, i) => {
      const hh = String(h || '').replace(/\*/g, '').trim();
      if (hh.includes('รหัสนักเรียน')) m.id = i;
      else if (hh.includes('คำนำหน้า')) m.prefix = i;
      else if (hh === 'ชื่อ') m.first_name = i;
      else if (hh.includes('นามสกุล')) m.last_name = i;
      else if (hh === 'ชั้น' || hh.includes('ระดับ')) m.grade = i;
      else if (hh === 'ห้อง') m.classroom = i;
      else if (hh.includes('ทะเบียนรถ')) m.plate_no = i;
      else if (hh.includes('ผู้ปกครอง') && !hh.includes('เบอร์')) m.parent_name = i;
      else if (hh.includes('เบอร์')) m.parent_phone = i;
    });
    return m;
  };
  const toRow = (cells, map, rowNum) => ({
    rowNum,
    student_code: pick(cells, map, 'id'),
    prefix: pick(cells, map, 'prefix'),
    first_name: pick(cells, map, 'first_name'),
    last_name: pick(cells, map, 'last_name'),
    grade: pick(cells, map, 'grade'),
    classroom: pick(cells, map, 'classroom'),
    plate_no: pick(cells, map, 'plate_no'),
    parent_name: pick(cells, map, 'parent_name'),
    parent_phone: normalizePhone(pick(cells, map, 'parent_phone')),
  });

  if (isExcel) {
    const wb = new ExcelJS.Workbook();
    await readWorkbookSafely(wb, filePath);
    const ws = wb.worksheets[0];
    const headers = (ws.getRow(1).values || []).slice(1).map((v) => (v == null ? '' : String(v)));
    const map = buildMap(headers);
    for (let i = 2; i <= ws.rowCount; i++) {
      const cells = (ws.getRow(i).values || []).slice(1).map((v) => (v == null ? '' : String(v)));
      if (cells.every((c) => !String(c).trim())) continue;
      rows.push(toRow(cells, map, i));
    }
  } else {
    const raw = decodeCsvBuffer(fs.readFileSync(filePath)).replace(/^﻿/, '');
    const csvRows = parseCsvRecords(raw);
    const headers = (csvRows[0] || []).map((h) => h.trim());
    const map = buildMap(headers);
    for (let i = 1; i < csvRows.length; i++) {
      const cells = csvRows[i].map((c) => c.trim());
      rows.push(toRow(cells, map, i + 1));
    }
  }
  return rows;
}

// ── Destination column widths, read from the live schema. ───────────────────
// Preview must not call a row READY that the INSERT cannot store: MySQL runs in
// STRICT_TRANS_TABLES, so an over-long value is ER_DATA_TOO_LONG at apply, not a
// truncation. Reading the widths back from the table the migrations built keeps
// one source of truth instead of a second copy of the schema in JS.
const LENGTH_CHECKED_COLUMNS = ['student_code', 'prefix', 'first_name', 'last_name', 'grade', 'classroom'];
async function studentColumnLimits(db) {
  try {
    const [rows] = await db.query(
      `SELECT COLUMN_NAME AS name, CHARACTER_MAXIMUM_LENGTH AS max_len
         FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'students' AND COLUMN_NAME IN (?)`,
      [LENGTH_CHECKED_COLUMNS]
    );
    const limits = {};
    for (const c of Array.isArray(rows) ? rows : []) {
      const max = Number(c && c.max_len);
      if (Number.isInteger(max) && max > 0) limits[String(c.name)] = max;
    }
    return limits;
  } catch {
    return null;   // schema unreadable → skip the width check, never fail a preview over it
  }
}

// parents.name is written by linkParent during apply, from the same file row, but
// it is not one of the students columns the classifier checks — so a 150-character
// ผู้ปกครอง previewed READY and then died at apply with ER_DATA_TOO_LONG, exactly
// the defect the students-column check closed. Same check, different table.
async function parentNameLimit(db) {
  try {
    const [[c]] = await db.query(
      `SELECT CHARACTER_MAXIMUM_LENGTH AS max_len
         FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'parents' AND COLUMN_NAME = 'name'`
    );
    const max = Number(c && c.max_len);
    return Number.isInteger(max) && max > 0 ? max : null;
  } catch {
    return null;   // schema unreadable → skip the width check, as above
  }
}
const charLength = (v) => Array.from(String(v == null ? '' : v).trim()).length;

// ── Per-row analysis (DB lookups + pure classifier). Read-only. ──────────────
async function analyzeRows(db, schoolId, rows, autoCreateVehicle = false) {
  const [allVehicles] = await db.query('SELECT id, plate_no, is_deleted FROM vehicles');
  const canonicalMap = {};
  for (const v of allVehicles) { if (!v.is_deleted) { const c = canonOf(v.plate_no); if (c) canonicalMap[c] = v; } }

  const matchVehicle = (plate_no) => {
    if (!plate_no || !String(plate_no).trim()) return null;
    const plateValidation = validatePlateNo(plate_no);
    if (!plateValidation.valid) {
      return {
        matched: false,
        code: plateValidation.code === 'PLATE_PROVINCE_REQUIRED' ? 'AMBIGUOUS_PLATE_NEEDS_PROVINCE' : 'PLATE_FORMAT_INVALID',
        vehicle_id: null,
        display_plate: null,
      };
    }
    plate_no = plateValidation.trimmed;
    const hit = canonicalMap[canonOf(plate_no)];
    if (hit) {
      const ip = plateId.parseLegacyPlateText(plate_no);
      const hp = plateId.parseLegacyPlateText(hit.plate_no);
      const alias = ip && hp && plateId.normalizeThaiText(ip.province).toLowerCase() !== plateId.normalizeThaiText(hp.province).toLowerCase();
      return { matched: true, code: alias ? 'VEHICLE_PROVINCE_ALIAS_MATCH' : 'VEHICLE_MATCHED_CANONICAL', vehicle_id: hit.id, display_plate: plateId.buildDisplayPlate(hp || {}) };
    }
    const c = plateId.classifyVehiclePlateConflict(plate_no, allVehicles);
    return { matched: false, code: c.code, vehicle_id: c.vehicle_id, display_plate: c.display_plate };
  };

  const limits = await studentColumnLimits(db);
  const parentMax = await parentNameLimit(db);
  const results = [];
  const seenInFile = new Map();   // 10.13B-5 Part F — first row_no per student_code in this file
  for (const row of rows) {
    const code = String(row.student_code || '').trim();
    let existing = null;
    let crossSchool = false;
    if (code) {
      const [[ex]] = await db.query(
        `SELECT st.id, st.is_deleted, (SELECT p.name FROM parent_student ps JOIN parents p ON p.id = ps.parent_id WHERE ps.student_id = st.id AND ps.approved = TRUE LIMIT 1) AS parent_name
         FROM students st WHERE st.school_id = ? AND st.student_code = ? LIMIT 1`, [schoolId, code]);
      existing = ex || null;
      if (!existing) {
        const [[cs]] = await db.query(
          'SELECT 1 AS x FROM students WHERE student_code = ? AND school_id <> ? AND COALESCE(is_deleted, FALSE) = FALSE LIMIT 1', [code, schoolId]);
        crossSchool = !!cs;
      }
    }
    const vehicle = matchVehicle(row.plate_no);
    const r = classifyImportRow({ row, schoolId, existing, crossSchool, vehicle, limits });
    // Phase 10.15A — if the caller opts in to auto-create vehicles, rows that are
    // only blocked by a missing vehicle become READY. The vehicle will be created
    // at apply time, so the school does not need to pre-register every plate.
    // Phase 10.15A-1: only plates with a province are auto-created; province-less
    // plates remain blocked to avoid ambiguous duplicate registrations.
    if (autoCreateVehicle && r.classification === 'VEHICLE_NOT_FOUND' && hasPlateProvince(row.plate_no)) {
      r.classification = 'INSERT_NEW_AUTO_VEHICLE';
      r.status = 'READY';
      r.can_apply = true;
      r.message_th = 'พร้อมนำเข้า (ระบบจะสร้างรถอัตโนมัติตอนนำเข้า)';
      r.action_required = null;
    }
    r.existing_student_id = existing ? existing.id : null;
    // Guardian-name width. Checked here, not in the classifier, because it is the
    // parents table and only the service knows its width. Applies to every row
    // that would write a parent (insert / guardian update / reactivate) — those
    // are the three paths that reach linkParent or the parents INSERT.
    const parentLen = charLength(row.parent_name);
    if (parentMax && parentLen > parentMax && (r.can_apply || r.can_confirm_guardian_update || r.can_confirm_reactivate)) {
      r.classification = 'FIELD_TOO_LONG';
      r.status = 'ERROR';
      r.can_apply = false;
      r.can_confirm_guardian_update = false;
      r.can_confirm_reactivate = false;
      r.message_th = `ชื่อผู้ปกครองยาวเกินที่ระบบรองรับ (${parentLen} ตัวอักษร สูงสุด ${parentMax})`;
      r.action_required = `แก้ไขชื่อผู้ปกครองในไฟล์ให้ไม่เกิน ${parentMax} ตัวอักษร`;
    }
    // Phase 10.13B-5 Part F — a student_code repeated within the same file: the
    // 2nd+ occurrence is flagged so it cannot silently double-import.
    if (code && seenInFile.has(code)) {
      r.classification = 'DUPLICATE_ROW_IN_FILE';
      r.status = 'ERROR';
      r.can_apply = false;
      r.can_confirm_guardian_update = false;
      r.can_confirm_reactivate = false;
      r.message_th = `พบรหัสนักเรียนซ้ำในไฟล์เดียวกัน (แถวแรกคือแถวที่ ${seenInFile.get(code)}) กรุณาตรวจสอบก่อนนำเข้า`;
      r.action_required = 'แก้ไขรหัสซ้ำในไฟล์';
    } else if (code) {
      seenInFile.set(code, row.rowNum);
    }
    r._normalized = row;   // full normalized row for apply (server-side only)
    results.push(r);
  }
  return results;
}

const STATUS_KEY = { ERROR: 'error', WARNING: 'warning', SKIP: 'skip', READY: 'ready' };
function summarize(results) {
  const s = { total: results.length, ready: 0, warning: 0, skip: 0, error: 0, can_apply: 0 };
  for (const r of results) { s[STATUS_KEY[r.status] || 'error']++; if (r.can_apply) s.can_apply++; }
  return s;
}
function publicRow(r) {
  return {
    row_number: r.row_number, status: r.status, classification: r.classification,
    student_code: r.student_code, student_name: r.student_name,
    input_vehicle_plate: r.input_vehicle_plate, matched_vehicle_id: r.matched_vehicle_id,
    matched_display_plate: r.matched_display_plate,
    guardian_current: r.guardian_current, guardian_input: r.guardian_input, guardian_mismatch: r.guardian_mismatch,
    message_th: r.message_th, action_required: r.action_required, can_apply: r.can_apply,
    can_confirm_guardian_update: !!r.can_confirm_guardian_update, can_confirm_reactivate: !!r.can_confirm_reactivate,
  };
}

// ── Preview: persist batch + rows. No student/vehicle/parent writes. ─────────
async function runPreview(pool, { schoolId, importedBy, filePath, originalName, autoCreateVehicle = false }) {
  const rows = await parseImportFile(filePath, originalName);
  if (rows.length > MAX_IMPORT_ROWS) {
    const e = new Error('ไฟล์มีจำนวนแถวมากเกินไป (เกิน 5000 แถว) กรุณาแบ่งไฟล์');
    e.statusCode = 400;
    throw e;
  }
  const results = await analyzeRows(pool, schoolId, rows, autoCreateVehicle);
  const summary = summarize(results);
  const sha = crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [b] = await conn.query(
      `INSERT INTO import_batches (school_id, imported_by, filename, stored_file_path, file_sha256,
         total_rows, success_rows, insert_count, update_count, skip_count, error_rows, status, mode, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 0, ?, 0, ?, ?, 'PREVIEWED', 'preview', DATE_ADD(NOW(), INTERVAL 14 DAY), NOW())`,
      [schoolId, importedBy, originalName, filePath, sha, summary.total, summary.can_apply, summary.skip, summary.error]
    );
    const batchId = b.insertId;
    for (const r of results) {
      const norm = r._normalized;
      await conn.query(
        `INSERT INTO import_batch_rows (batch_id, row_no, raw_json, normalized_json, classification, status, message_th,
           student_code, existing_student_id, matched_vehicle_id, matched_display_plate, guardian_diff_json, can_apply, error_detail)
         VALUES (?, ?, CAST(? AS JSON), CAST(? AS JSON), ?, ?, ?, ?, ?, ?, ?, CAST(? AS JSON), ?, ?)`,
        [batchId, r.row_number,
         JSON.stringify({ student_name: r.student_name, grade: r.grade, classroom: r.classroom, plate: r.input_vehicle_plate, guardian: r.guardian_input || null }),
         JSON.stringify({ prefix: norm.prefix || null, first_name: norm.first_name, last_name: norm.last_name, grade: norm.grade || null, classroom: norm.classroom || null, plate_no: norm.plate_no || null, parent_name: norm.parent_name || null, parent_phone: norm.parent_phone || null }),
         r.classification, r.status, r.message_th, r.student_code, r.existing_student_id || null,
         r.matched_vehicle_id, r.matched_display_plate,
         // JSON.stringify(null) is the string 'null', which CAST(? AS JSON) stores as the
         // JSON literal null — NOT SQL NULL — so `guardian_diff_json IS NOT NULL` was true
         // for every row ever written and every student looked like a guardian change.
         r.guardian_mismatch ? JSON.stringify({ current: r.guardian_current, input: r.guardian_input }) : null,
         r.can_apply ? 1 : 0, r.error_detail]
      );
    }
    await conn.commit();
    return { batch_id: batchId, summary, rows: results.map(publicRow) };
  } catch (e) { await conn.rollback(); throw e; } finally { conn.release(); }
}

function jsonOf(value) {
  if (!value) return {};
  if (typeof value === 'string') {
    try { return JSON.parse(value) || {}; } catch { return {}; }
  }
  return typeof value === 'object' ? value : {};
}
const normOf = (row) => jsonOf(row.normalized_json);
const rawOf = (row) => jsonOf(row.raw_json);
function inputVehiclePlateOf(row) {
  const raw = rawOf(row);
  const norm = normOf(row);
  return row.input_vehicle_plate || raw.plate || raw.input_vehicle_plate || norm.plate_no || norm.vehicle_plate || null;
}

// Dedupe-or-create a parent by phone, then link to the student (idempotent).
async function linkParent(conn, studentId, name, phone, userId) {
  if (!name && !phone) return;
  let parentId;
  if (phone) {
    const [[ep]] = await conn.query(
      'SELECT id FROM parents WHERE phone = ? AND is_deleted = FALSE LIMIT 1', [phone]
    );
    parentId = ep && ep.id;
  }
  if (!parentId) {
    try {
      const [pr] = await conn.query(
        'INSERT INTO parents (name, phone) VALUES (?, ?)', [name || null, phone || null]
      );
      parentId = pr.insertId;
    } catch (dupErr) {
      // Medium fix: concurrent imports can race past the SELECT above and
      // both INSERT. The unique index (migration 042) makes the second
      // INSERT fail with ER_DUP_ENTRY — re-fetch the winning row.
      if (dupErr.code === 'ER_DUP_ENTRY') {
        const [[ep2]] = await conn.query(
          'SELECT id FROM parents WHERE phone = ? AND is_deleted = FALSE LIMIT 1', [phone]
        );
        parentId = ep2 && ep2.id;
        if (!parentId) throw dupErr; // shouldn't happen, but fail loudly
      } else {
        throw dupErr;
      }
    }
  }
  await conn.query('INSERT INTO parent_student (parent_id, student_id, approved, approved_by, approved_at) VALUES (?, ?, TRUE, ?, NOW()) ON DUPLICATE KEY UPDATE approved = TRUE', [parentId, studentId, userId]);
}

// Helper: a plate is only eligible for auto-create if it includes a province.
// Province-less plates ('นข2210') are ambiguous and would create duplicates.
function hasPlateProvince(plateNo) {
  if (!plateNo) return false;
  const p = plateId.parseLegacyPlateText(String(plateNo));
  return !!(p && plateId.normalizeProvince(p.province));
}

// ── Auto-create a missing vehicle during student import (Phase 10.15A). ───────
// Returns the existing vehicle id if it already exists, otherwise creates a new
// UNVERIFIED vehicle with a generated id. Creation is audited. Only used when
// the school explicitly opts in via auto_create_vehicle on the apply endpoint.
// Phase 10.15A-1: province-less plates are NOT auto-created to avoid duplicates.
async function createVehicleForImport(conn, plateNo, userId) {
  if (!plateNo || !String(plateNo).trim()) return null;
  if (!hasPlateProvince(plateNo)) return null;
  const validation = validatePlateNo(plateNo);
  if (!validation.valid) return null;

  const { trimmed, normalized } = validation;
  const canonical = plateId.canonicalPlateForStorage(trimmed);
  const [[existing]] = await conn.query(
    `SELECT id, is_deleted FROM vehicles
     WHERE plate_no = ? OR normalized_plate = ? OR canonical_plate = ?
     ORDER BY is_deleted ASC LIMIT 1 FOR UPDATE`,
    [trimmed, normalized, canonical]
  );
  if (existing) {
    if (existing.is_deleted) {
      const e = new Error('รถทะเบียนนี้ถูกปิดใช้งาน กรุณากู้คืนรถก่อนนำเข้า');
      e.code = 'VEHICLE_BLOCKED';
      e.statusCode = 409;
      throw e;
    }
    return existing.id;
  }

  const id = generateVehicleId(trimmed);
  await conn.query(
    `INSERT INTO vehicles (id, plate_no, normalized_plate, canonical_plate, vehicle_type, verification_status)
     VALUES (?, ?, ?, ?, ?, 'UNVERIFIED')`,
    [id, trimmed, normalized, canonical, 'รถตู้']
  );
  await logAudit({
    userId, action: 'CREATE', entityType: 'vehicle', entityId: id, conn,
    newValue: { plate_no: trimmed, normalized_plate: normalized, source: 'student_import_auto_create' },
  });
  return id;
}

async function lockPendingImportRow(conn, row, r) {
  const [[locked]] = await conn.query('SELECT * FROM import_batch_rows WHERE id = ? FOR UPDATE', [row.id]);
  if (!locked) {
    r.stale++;
    r.details.push({ row: row.row_no, status: 'STALE_NEEDS_REPREVIEW' });
    return null;
  }
  if (locked.applied_at) {
    r.already_applied++;
    r.details.push({ row: locked.row_no || row.row_no, status: 'ALREADY_APPLIED' });
    return null;
  }
  return { ...row, ...locked };
}

// A status that replaces a failure must replace the failure's reason too. Both
// message_th and error_detail were cleared only on SUCCESS, so a row that failed
// once and was then blocked or staled on a retry kept showing the PREVIOUS
// failure's text and code under its new status ("VEHICLE_BLOCKED · ER_DATA_TOO_LONG").
// These two statuses are outcomes of the retry, so they carry their own reason.
const VEHICLE_BLOCKED_TH = 'ยังนำเข้าไม่ได้ เพราะไม่พบรถทะเบียนนี้ที่ใช้งานอยู่ในระบบ กรุณาตรวจสอบข้อมูลรถแล้วนำเข้าใหม่';
const STALE_TH = 'ข้อมูลนักเรียนเปลี่ยนไปหลังจากตรวจสอบไฟล์ กรุณาตรวจสอบไฟล์อีกครั้งก่อนนำเข้า';

async function markVehicleBlocked(conn, row, r) {
  await conn.query(
    "UPDATE import_batch_rows SET status='VEHICLE_BLOCKED', message_th=?, error_detail=NULL WHERE id=?",
    [VEHICLE_BLOCKED_TH, row.id]
  );
  r.vehicle_blocked++;
  r.details.push({ row: row.row_no, status: 'VEHICLE_BLOCKED' });
}

async function markStale(conn, row, r) {
  await conn.query(
    "UPDATE import_batch_rows SET status='STALE_NEEDS_REPREVIEW', message_th=?, error_detail=NULL WHERE id=?",
    [STALE_TH, row.id]
  );
  r.stale++;
  r.details.push({ row: row.row_no, status: 'STALE_NEEDS_REPREVIEW' });
}

// ── A row that died inside apply. It used to keep the preview's message_th
//    ("พร้อมนำเข้า") while its status said APPLY_FAILED, and neither the detail nor
//    the report endpoint selected error_detail — the school saw a failure with no
//    cause and no next step. error_detail keeps the raw code for whoever debugs it.
const APPLY_FAILURE_TH = {
  ER_DATA_TOO_LONG: 'นำเข้าไม่สำเร็จ เพราะข้อมูลบางช่องยาวเกินที่ระบบรองรับ กรุณาแก้ไขไฟล์แล้วนำเข้าใหม่',
  ER_DUP_ENTRY: 'นำเข้าไม่สำเร็จ เพราะข้อมูลซ้ำกับที่มีอยู่แล้วในระบบ กรุณาตรวจสอบไฟล์แล้วนำเข้าใหม่',
  ER_NO_REFERENCED_ROW_2: 'นำเข้าไม่สำเร็จ เพราะอ้างถึงข้อมูลที่ไม่มีในระบบ (เช่น รถหรือโรงเรียน) กรุณาตรวจสอบแล้วนำเข้าใหม่',
};
// A row that failed a previous apply and succeeds on a retry must not keep the
// failure text and reason. MySQL assigns left to right, so error_detail still
// holds its old value inside the IF: a row that never failed is left exactly as
// it was, and only a row that did gets its message corrected.
const CLEARS_FAILURE = "message_th = IF(error_detail IS NULL, message_th, 'นำเข้าสำเร็จหลังจากลองใหม่'), error_detail = NULL";

// error_detail is shown to the school and returned by /report, an endpoint
// documented as PII-safe, so only a code from the map above may be stored: a
// mysql2 `code` is a fixed identifier, but the `message` this used to fall back
// to carries row content (ER_DUP_ENTRY's text quotes the duplicated key, i.e. a
// student_code). Anything unmapped becomes UNKNOWN_ERROR here and keeps its raw
// text server-side in the log, where whoever debugs it can still read it.
async function markRowApplyFailed(pool, rowId, e) {
  const code = e && e.code;
  const known = Object.prototype.hasOwnProperty.call(APPLY_FAILURE_TH, code);
  const detail = known ? code : 'UNKNOWN_ERROR';
  if (!known) console.error('[IMPORT_APPLY_FAILED]', { row_id: rowId, code: code || null, error: e && e.message });
  const messageTh = (known && APPLY_FAILURE_TH[code]) || 'นำเข้าไม่สำเร็จ กรุณาตรวจสอบข้อมูลของแถวนี้ในไฟล์แล้วลองใหม่';
  await pool.query(
    "UPDATE import_batch_rows SET status='APPLY_FAILED', message_th=?, error_detail=? WHERE id=?",
    [messageTh.slice(0, 300), detail, rowId]
  );
}

// ── insert_ready row (INSERT_NEW / CROSS_SCHOOL) — atomic id, idempotent. ────
async function applyInsertRow(pool, { row, schoolId, userId, r, autoCreateVehicle = false }) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    row = await lockPendingImportRow(conn, row, r);
    if (!row) { await conn.commit(); return; }

    const [[exist]] = await conn.query('SELECT id, is_deleted FROM students WHERE school_id = ? AND student_code = ? LIMIT 1 FOR UPDATE', [schoolId, row.student_code]);
    if (classifyStudentImport(exist) !== 'INSERT') {
      await conn.query(`UPDATE import_batch_rows SET status='ALREADY_APPLIED', applied_at=NOW(), ${CLEARS_FAILURE} WHERE id=?`, [row.id]);
      await conn.commit(); r.already_applied++; r.details.push({ row: row.row_no, status: 'ALREADY_APPLIED' }); return;
    }

    let vehicleId = row.matched_vehicle_id || null;
    if (vehicleId) {
      const [[v]] = await conn.query('SELECT id FROM vehicles WHERE id = ? AND is_deleted = FALSE LIMIT 1 FOR UPDATE', [vehicleId]);
      if (!v) {
        await markVehicleBlocked(conn, row, r);
        await conn.commit();
        return;
      }
    }

    const inputPlate = inputVehiclePlateOf(row);
    if (autoCreateVehicle && !vehicleId && inputPlate) {
      try {
        vehicleId = await createVehicleForImport(conn, inputPlate, userId);
      } catch (vehicleErr) {
        if (vehicleErr.code === 'VEHICLE_BLOCKED') {
          await markVehicleBlocked(conn, row, r);
          await conn.commit();
          return;
        }
        throw vehicleErr;
      }
    }
    if (row.classification === 'INSERT_NEW_AUTO_VEHICLE' && !vehicleId) {
      await markVehicleBlocked(conn, row, r);
      await conn.commit();
      return;
    }

    const TERM = await getCurrentTerm(pool);
    const n = normOf(row);
    // Synthetic marker for import-created students. This is not a hash of a Thai national ID.
    const cid = crypto.createHash('sha256').update(`import-${schoolId}-${row.student_code}`).digest('hex');
    const newId = await allocateStudentId(conn);
    await conn.query(
      `INSERT INTO students (id, student_code, cid_hash, prefix, first_name, last_name, grade, classroom, school_id, vehicle_id, morning_enabled, evening_enabled, term_id, import_batch_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1, ?, ?)`,
      [newId, row.student_code, cid, n.prefix || null, n.first_name || '-', n.last_name || '-', n.grade || null, n.classroom || null, schoolId, vehicleId, TERM, row.batch_id]
    );
    await linkParent(conn, newId, n.parent_name, n.parent_phone, userId);
    await logAudit({
      userId, action: 'CREATE', entityType: 'student', entityId: String(newId), conn,
      newValue: {
        student_code: row.student_code, first_name: n.first_name, last_name: n.last_name,
        school_id: schoolId, vehicle_id: vehicleId,
        source: 'import_apply', row_no: row.row_no, auto_created_vehicle: autoCreateVehicle && !row.matched_vehicle_id && !!vehicleId,
      },
    });
    await conn.query(`UPDATE import_batch_rows SET status='APPLIED', new_student_id=?, applied_at=NOW(), ${CLEARS_FAILURE} WHERE id=?`, [newId, row.id]);
    await conn.commit(); r.applied++; r.details.push({ row: row.row_no, status: 'APPLIED', student_id: newId });
  } catch (e) {
    await conn.rollback();
    await markRowApplyFailed(pool, row.id, e);
    r.failed++; r.details.push({ row: row.row_no, status: 'APPLY_FAILED' });
  } finally { conn.release(); }
}

// ── update_guardian_confirmed row — updates ONLY the selected student's guardian.
async function applyGuardianRow(pool, { row, schoolId, userId, batchId, r }) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    row = await lockPendingImportRow(conn, row, r);
    if (!row) { await conn.commit(); return; }
    const [[st]] = await conn.query('SELECT id FROM students WHERE school_id = ? AND student_code = ? AND COALESCE(is_deleted, FALSE) = FALSE LIMIT 1 FOR UPDATE', [schoolId, row.student_code]);
    if (!st) {  // student gone / deleted / code reassigned since preview
      await markStale(conn, row, r);
      await conn.commit(); return;
    }
    const n = normOf(row);
    const newName = n.parent_name || null, newPhone = n.parent_phone || null;
    const [[cur]] = await conn.query('SELECT p.id, p.name AS old_name, p.phone AS old_phone FROM parent_student ps JOIN parents p ON p.id = ps.parent_id WHERE ps.student_id = ? AND ps.approved = TRUE LIMIT 1', [st.id]);
    let parentId;
    const curPhone = cur && cur.old_phone ? String(cur.old_phone).replace(/\D/g, '') : '';
    const phoneChanged = !!newPhone && newPhone !== curPhone;
    if (phoneChanged) {
      const [[ep]] = await conn.query('SELECT id FROM parents WHERE phone = ? AND is_deleted = FALSE LIMIT 1', [newPhone]);
      parentId = ep && ep.id;
      if (parentId) {
        if (newName) await conn.query('UPDATE parents SET name = ? WHERE id = ?', [newName, parentId]);
      } else {
        const [pr] = await conn.query('INSERT INTO parents (name, phone) VALUES (?, ?)', [newName, newPhone]);
        parentId = pr.insertId;
      }
      await conn.query('INSERT INTO parent_student (parent_id, student_id, approved, approved_by, approved_at) VALUES (?, ?, TRUE, ?, NOW()) ON DUPLICATE KEY UPDATE approved = TRUE, approved_by = VALUES(approved_by), approved_at = VALUES(approved_at)', [parentId, st.id, userId]);
      if (cur && String(cur.id) !== String(parentId)) {
        await conn.query('UPDATE parent_student SET approved = FALSE WHERE student_id = ? AND parent_id = ?', [st.id, cur.id]);
      }
    } else if (cur) {
      parentId = cur.id;
      if (newName) await conn.query('UPDATE parents SET name = ? WHERE id = ?', [newName, cur.id]);
    } else {
      await linkParent(conn, st.id, newName, newPhone, userId);
    }
    await logAudit({
      userId, action: 'UPDATE', entityType: 'student', entityId: String(st.id), conn,
      oldValue: { guardian_name: cur ? cur.old_name : null, guardian_phone: maskPhone(cur ? cur.old_phone : null) },
      newValue: { guardian_name: newName, guardian_phone: maskPhone(newPhone), batch_id: batchId, row_no: row.row_no, mode: 'update_guardian_confirmed' },
    });
    await conn.query(`UPDATE import_batch_rows SET status='GUARDIAN_UPDATED', new_student_id=?, applied_at=NOW(), ${CLEARS_FAILURE} WHERE id=?`, [st.id, row.id]);
    await conn.commit(); r.guardian_updated++; r.details.push({ row: row.row_no, status: 'GUARDIAN_UPDATED', student_id: st.id });
  } catch (e) {
    await conn.rollback();
    await markRowApplyFailed(pool, row.id, e);
    r.failed++; r.details.push({ row: row.row_no, status: 'APPLY_FAILED' });
  } finally { conn.release(); }
}

// ── reactivate_student_confirmed row — restores the SAME-school soft-deleted student.
async function applyReactivateRow(pool, { row, schoolId, userId, batchId, r }) {
  const TERM = await getCurrentTerm(pool);
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    row = await lockPendingImportRow(conn, row, r);
    if (!row) { await conn.commit(); return; }
    const [[st]] = await conn.query('SELECT id, is_deleted FROM students WHERE school_id = ? AND student_code = ? LIMIT 1 FOR UPDATE', [schoolId, row.student_code]);
    if (!st) {
      await markStale(conn, row, r);
      await conn.commit(); return;
    }
    if (!st.is_deleted) {  // already active (restored or re-inserted since preview)
      await conn.query(`UPDATE import_batch_rows SET status='ALREADY_APPLIED', applied_at=NOW(), ${CLEARS_FAILURE} WHERE id=?`, [row.id]);
      await conn.commit(); r.already_applied++; r.details.push({ row: row.row_no, status: 'ALREADY_APPLIED' }); return;
    }
    // Vehicle re-check: never reactivate onto a missing/soft-deleted vehicle.
    let vehicleId = row.matched_vehicle_id || null;
    if (vehicleId) {
      const [[v]] = await conn.query('SELECT id FROM vehicles WHERE id = ? AND is_deleted = FALSE LIMIT 1', [vehicleId]);
      if (!v) {
        await markVehicleBlocked(conn, row, r);
        await conn.commit(); return;
      }
    }
    const n = normOf(row);
    await conn.query(
      `UPDATE students SET is_deleted = FALSE, deleted_at = NULL, prefix = ?, first_name = ?, last_name = ?, grade = ?, classroom = ?, vehicle_id = ?, term_id = ?
       WHERE id = ?`,
      [n.prefix || null, n.first_name || '-', n.last_name || '-', n.grade || null, n.classroom || null, vehicleId, TERM, st.id]
    );
    await linkParent(conn, st.id, n.parent_name, n.parent_phone, userId);
    await logAudit({
      userId, action: 'UPDATE', entityType: 'student', entityId: String(st.id), conn,
      oldValue: { is_deleted: true },
      newValue: { is_deleted: false, vehicle_id: vehicleId, batch_id: batchId, row_no: row.row_no, mode: 'reactivate_student_confirmed' },
    });
    await conn.query(`UPDATE import_batch_rows SET status='REACTIVATED', new_student_id=?, applied_at=NOW(), ${CLEARS_FAILURE} WHERE id=?`, [st.id, row.id]);
    await conn.commit(); r.reactivated++; r.details.push({ row: row.row_no, status: 'REACTIVATED', student_id: st.id });
  } catch (e) {
    await conn.rollback();
    await markRowApplyFailed(pool, row.id, e);
    r.failed++; r.details.push({ row: row.row_no, status: 'APPLY_FAILED' });
  } finally { conn.release(); }
}

// ── Apply with explicit modes (Phase 10.13B-4). insert_ready is the default and
//    preserves prior behavior; risky modes act ONLY on explicitly selected rows.
// The row statuses every batch counter is derived from. A row either went in
// (four ways), was skipped, or is UNRESOLVED — and an unresolved row must stay
// visible: VEHICLE_BLOCKED and STALE_NEEDS_REPREVIEW were counted nowhere, so a
// row whose vehicle disappeared between preview and apply vanished from the
// history counts and left the batch reading APPLIED.
const SUCCESS_ROW_STATUSES = ['APPLIED', 'GUARDIAN_UPDATED', 'REACTIVATED', 'ALREADY_APPLIED'];
const UNRESOLVED_ROW_STATUSES = ['ERROR', 'APPLY_FAILED', 'VEHICLE_BLOCKED', 'STALE_NEEDS_REPREVIEW'];

const RISKY_GUARDIAN = new Set(['update_guardian_confirmed', 'mixed_confirmed']);
const RISKY_REACTIVATE = new Set(['reactivate_student_confirmed', 'mixed_confirmed']);
const DOES_INSERT = new Set(['insert_ready', 'mixed_confirmed']);

async function applyBatch(pool, { batchId, schoolId, userId, mode = 'insert_ready', selectedRowIds = [], confirmGuardianUpdate = false, confirmReactivate = false, autoCreateVehicle = false }) {
  const [[batch]] = await pool.query('SELECT id, school_id FROM import_batches WHERE id = ?', [batchId]);
  if (!batch) { const e = new Error('ไม่พบชุดข้อมูลนำเข้า'); e.statusCode = 404; throw e; }
  if (String(batch.school_id) !== String(schoolId)) { const e = new Error('ไม่มีสิทธิ์เข้าถึงชุดข้อมูลนี้'); e.statusCode = 403; throw e; }

  const sel = new Set((Array.isArray(selectedRowIds) ? selectedRowIds : []).map(Number));
  const r = { mode, applied: 0, already_applied: 0, guardian_updated: 0, reactivated: 0, stale: 0, vehicle_blocked: 0, failed: 0, details: [] };

  if (DOES_INSERT.has(mode)) {
    const [rows] = await pool.query(
      `SELECT * FROM import_batch_rows WHERE batch_id = ? AND can_apply = TRUE AND applied_at IS NULL
         AND classification IN ('INSERT_NEW', 'INSERT_NEW_AUTO_VEHICLE', 'CROSS_SCHOOL_SAME_CODE_ALLOWED') ORDER BY row_no`, [batchId]);
    for (const row of rows) await applyInsertRow(pool, { row, schoolId, userId, r, autoCreateVehicle });
  }
  if (RISKY_GUARDIAN.has(mode) && confirmGuardianUpdate) {
    const [rows] = await pool.query(
      "SELECT * FROM import_batch_rows WHERE batch_id = ? AND classification = 'GUARDIAN_MISMATCH' AND applied_at IS NULL ORDER BY row_no", [batchId]);
    for (const row of rows) if (sel.has(Number(row.row_no))) await applyGuardianRow(pool, { row, schoolId, userId, batchId, r });
  }
  if (RISKY_REACTIVATE.has(mode) && confirmReactivate) {
    const [rows] = await pool.query(
      "SELECT * FROM import_batch_rows WHERE batch_id = ? AND classification = 'SOFT_DELETED_SAME_SCHOOL_REACTIVATE' AND applied_at IS NULL ORDER BY row_no", [batchId]);
    for (const row of rows) if (sel.has(Number(row.row_no))) await applyReactivateRow(pool, { row, schoolId, userId, batchId, r });
  }

  const successRows = r.applied + r.guardian_updated + r.reactivated + r.already_applied;
  // insert_count / skip_count / error_rows were written once at preview and never
  // touched again, so the history screen kept reporting the preview's optimism
  // (3 ready, 0 errors) for a batch that had actually failed a row, contradicting
  // the detail screen. EVERY counter — b.status and success_rows included — is now
  // derived from the rows, the same place getBatchDetail derives its summary from.
  // Those last two came from THIS pass's tallies, so a second pass that imported
  // nothing reset a batch that had already reported a success and a failure: a
  // history screen that forgets a failure it has shown is worse than one that
  // never showed it. Derived counters can only move when the rows move.
  await pool.query(
    `UPDATE import_batches b
        SET b.status = IF((SELECT COUNT(*) FROM import_batch_rows r WHERE r.batch_id = b.id
                             AND r.status IN (?)) > 0, 'APPLIED_PARTIAL', 'APPLIED'),
            b.applied_at = NOW(), b.completed_at = NOW(),
            b.success_rows = (SELECT COUNT(*) FROM import_batch_rows r WHERE r.batch_id = b.id
                                AND r.status IN (?)),
            b.insert_count = (SELECT COUNT(*) FROM import_batch_rows r WHERE r.batch_id = b.id
                                AND r.status IN (?)),
            b.skip_count   = (SELECT COUNT(*) FROM import_batch_rows r WHERE r.batch_id = b.id
                                AND r.status = 'SKIP'),
            b.error_rows   = (SELECT COUNT(*) FROM import_batch_rows r WHERE r.batch_id = b.id
                                AND r.status IN (?))
      WHERE b.id = ?`,
    [UNRESOLVED_ROW_STATUSES, SUCCESS_ROW_STATUSES, SUCCESS_ROW_STATUSES, UNRESOLVED_ROW_STATUSES, batchId]
  );
  return { ...r, success_rows: successRows };
}

// Rows written before the guardian_diff_json fix hold the JSON literal null, for
// which `IS NOT NULL` is true. Both shapes must read as "no guardian change", or
// every batch already imported keeps showing "ผู้ปกครองเปลี่ยน" on every row.
const GUARDIAN_CHANGED_SQL = "(guardian_diff_json IS NOT NULL AND JSON_TYPE(guardian_diff_json) <> 'NULL')";

// ── Report: row-level results (phones never included; PII-safe). ─────────────
async function getReport(pool, { batchId, schoolId }) {
  const [[batch]] = await pool.query('SELECT id, school_id, filename, status, total_rows, created_at FROM import_batches WHERE id = ?', [batchId]);
  if (!batch) { const e = new Error('ไม่พบชุดข้อมูลนำเข้า'); e.statusCode = 404; throw e; }
  if (String(batch.school_id) !== String(schoolId)) { const e = new Error('ไม่มีสิทธิ์เข้าถึงชุดข้อมูลนี้'); e.statusCode = 403; throw e; }
  const [rows] = await pool.query(
    `SELECT row_no, student_code, classification, status, message_th, matched_display_plate, error_detail,
            ${GUARDIAN_CHANGED_SQL} AS guardian_mismatch,
            JSON_UNQUOTE(JSON_EXTRACT(raw_json,'$.student_name')) AS student_name,
            JSON_UNQUOTE(JSON_EXTRACT(raw_json,'$.plate')) AS input_vehicle_plate
     FROM import_batch_rows WHERE batch_id = ? ORDER BY row_no`, [batchId]);
  return {
    batch: { id: batch.id, filename: batch.filename, status: batch.status, total_rows: batch.total_rows, created_at: batch.created_at },
    rows: rows.map((r) => ({
      row_number: r.row_no, student_code: r.student_code, student_name: r.student_name,
      classification: r.classification, status: r.status, message_th: r.message_th,
      input_vehicle_plate: r.input_vehicle_plate, matched_display_plate: r.matched_display_plate,
      guardian_mismatch: r.guardian_mismatch ? 'yes' : 'no',
      error_detail: r.error_detail || null,
    })),
  };
}

// ── Import history (Phase 10.13B-5) ──────────────────────────────────────────
async function listBatches(pool, { schoolId, page = 1, perPage = 30 }) {
  const limit = Math.min(100, Math.max(1, perPage));
  const offset = (Math.max(1, page) - 1) * limit;
  const [[{ total }]] = await pool.query('SELECT COUNT(*) AS total FROM import_batches WHERE school_id = ?', [schoolId]);
  const [rows] = await pool.query(
    `SELECT b.id AS batch_id, b.filename, b.status, b.mode, b.total_rows, b.success_rows,
            b.insert_count, b.update_count, b.skip_count, b.error_rows, b.rollback_status,
            b.created_at, b.applied_at, b.expires_at,
            (SELECT COUNT(*) FROM import_batch_rows r WHERE r.batch_id = b.id AND r.applied_at IS NULL AND r.can_apply = TRUE) AS pending_ready,
            (SELECT COUNT(*) FROM import_batch_rows r WHERE r.batch_id = b.id AND r.status = 'APPLIED' AND r.rollback_status IS NULL) AS rollbackable
     FROM import_batches b WHERE b.school_id = ? ORDER BY b.id DESC LIMIT ? OFFSET ?`,
    [schoolId, limit, offset]
  );
  return {
    batches: rows.map((b) => ({
      batch_id: b.batch_id, filename: b.filename, status: b.status, mode: b.mode,
      total_rows: b.total_rows, insert_count: b.insert_count, update_count: b.update_count,
      skip_count: b.skip_count, error_count: b.error_rows, rollback_status: b.rollback_status,
      created_at: b.created_at, applied_at: b.applied_at, expires_at: b.expires_at,
      can_continue_apply: b.pending_ready > 0, can_download_report: true, can_rollback: b.rollbackable > 0,
    })),
    meta: { page: Math.max(1, page), per_page: limit, total },
  };
}

// Batch detail = metadata + row-level results (no phone, no raw file path).
async function getBatchDetail(pool, { batchId, schoolId }) {
  const [[batch]] = await pool.query(
    'SELECT id, school_id, filename, status, mode, total_rows, insert_count, update_count, skip_count, error_rows, rollback_status, created_at, applied_at, expires_at FROM import_batches WHERE id = ?',
    [batchId]
  );
  if (!batch) { const e = new Error('ไม่พบชุดข้อมูลนำเข้า'); e.statusCode = 404; throw e; }
  if (String(batch.school_id) !== String(schoolId)) { const e = new Error('ไม่มีสิทธิ์เข้าถึงชุดข้อมูลนี้'); e.statusCode = 403; throw e; }
  const [rows] = await pool.query(
    `SELECT row_no, student_code, classification, status, rollback_status, message_th, matched_display_plate, matched_vehicle_id,
            ${GUARDIAN_CHANGED_SQL} AS guardian_mismatch, (new_student_id IS NOT NULL) AS has_new_student, can_apply, applied_at, error_detail,
            JSON_UNQUOTE(JSON_EXTRACT(raw_json, '$.student_name')) AS student_name,
            JSON_UNQUOTE(JSON_EXTRACT(raw_json, '$.plate')) AS input_vehicle_plate,
            JSON_UNQUOTE(JSON_EXTRACT(guardian_diff_json, '$.current')) AS guardian_current,
            JSON_UNQUOTE(JSON_EXTRACT(guardian_diff_json, '$.input')) AS guardian_input
     FROM import_batch_rows WHERE batch_id = ? ORDER BY row_no`, [batchId]);
  const summary = { total: rows.length, ready: 0, warning: 0, skip: 0, error: 0, applied: 0, rolled_back: 0 };
  const out = rows.map((r) => {
    if (SUCCESS_ROW_STATUSES.includes(r.status)) summary.applied++;
    if (r.rollback_status === 'ROLLED_BACK') summary.rolled_back++;
    // Same set the batch counters use — a blocked or staled row is not "ready",
    // it is a row that did not go in, and both screens have to say so.
    if (UNRESOLVED_ROW_STATUSES.includes(r.status)) summary.error++;
    else if (r.status === 'WARNING') summary.warning++;
    else if (r.status === 'SKIP') summary.skip++;
    else if (r.can_apply && !r.applied_at) summary.ready++;
    return {
      row_number: r.row_no, student_code: r.student_code, student_name: r.student_name,
      classification: r.classification, status: r.status, rollback_status: r.rollback_status,
      message_th: r.message_th, error_detail: r.error_detail || null,
      input_vehicle_plate: r.input_vehicle_plate, matched_display_plate: r.matched_display_plate,
      guardian_mismatch: !!r.guardian_mismatch, guardian_current: r.guardian_current, guardian_input: r.guardian_input,
      can_apply: !!r.can_apply && !r.applied_at,
      can_confirm_guardian_update: r.classification === 'GUARDIAN_MISMATCH' && !r.applied_at,
      can_confirm_reactivate: r.classification === 'SOFT_DELETED_SAME_SCHOOL_REACTIVATE' && !r.applied_at,
      can_rollback: r.status === 'APPLIED' && !r.rollback_status && !!r.has_new_student,
    };
  });
  return {
    batch: { id: batch.id, filename: batch.filename, status: batch.status, mode: batch.mode, total_rows: batch.total_rows,
      insert_count: batch.insert_count, update_count: batch.update_count, skip_count: batch.skip_count, error_count: batch.error_rows,
      rollback_status: batch.rollback_status, created_at: batch.created_at, applied_at: batch.applied_at, expires_at: batch.expires_at },
    summary, rows: out,
  };
}

// ── Rollback: soft-delete ONLY students inserted by this batch. ──────────────
async function rollbackRow(pool, { row, schoolId, userId, batchId, reason, r }) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    if (row.rollback_status === 'ROLLED_BACK') { await conn.commit(); r.already_rolled_back++; r.details.push({ row: row.row_no, status: 'ALREADY_ROLLED_BACK' }); return; }
    if (row.status !== 'APPLIED' || !row.new_student_id) {  // only batch-inserted rows; never guardian/reactivate
      await conn.query("UPDATE import_batch_rows SET rollback_status='NOT_ELIGIBLE_FOR_ROLLBACK' WHERE id=?", [row.id]);
      await conn.commit(); r.skipped++; r.details.push({ row: row.row_no, status: 'NOT_ELIGIBLE_FOR_ROLLBACK' }); return;
    }
    const [[st]] = await conn.query('SELECT id, school_id, student_code, is_deleted, cid_hash FROM students WHERE id = ? FOR UPDATE', [row.new_student_id]);
    if (!st) { await conn.query("UPDATE import_batch_rows SET rollback_status='STALE_NEEDS_REVIEW' WHERE id=?", [row.id]); await conn.commit(); r.skipped++; r.details.push({ row: row.row_no, status: 'STALE_NEEDS_REVIEW' }); return; }
    if (st.is_deleted) { await conn.query("UPDATE import_batch_rows SET rollback_status='ROLLED_BACK', rolled_back_at=NOW() WHERE id=?", [row.id]); await conn.commit(); r.already_rolled_back++; r.details.push({ row: row.row_no, status: 'ALREADY_ROLLED_BACK' }); return; }
    // Guards: same school + code, and identity created by THIS import (cid match).
    const expectedCid = crypto.createHash('sha256').update(`import-${schoolId}-${row.student_code}`).digest('hex');
    if (String(st.school_id) !== String(schoolId) || String(st.student_code) !== String(row.student_code)) {
      await conn.query("UPDATE import_batch_rows SET rollback_status='NOT_ELIGIBLE_FOR_ROLLBACK' WHERE id=?", [row.id]); await conn.commit(); r.skipped++; r.details.push({ row: row.row_no, status: 'NOT_ELIGIBLE_FOR_ROLLBACK' }); return;
    }
    if (st.cid_hash !== expectedCid) {  // student was replaced/created by another means → unsafe
      await conn.query("UPDATE import_batch_rows SET rollback_status='NOT_SAFE_TO_ROLLBACK' WHERE id=?", [row.id]); await conn.commit(); r.skipped++; r.details.push({ row: row.row_no, status: 'NOT_SAFE_TO_ROLLBACK' }); return;
    }
    await conn.query('UPDATE students SET is_deleted = TRUE, deleted_at = NOW(), vehicle_id = NULL WHERE id = ? AND is_deleted = FALSE', [st.id]);
    await logAudit({ userId, action: 'DELETE', entityType: 'student', entityId: String(st.id), conn,
      oldValue: { is_deleted: false }, newValue: { is_deleted: true, rollback: true, batch_id: batchId, row_no: row.row_no, reason: String(reason || '').slice(0, 200) } });
    await conn.query("UPDATE import_batch_rows SET rollback_status='ROLLED_BACK', rolled_back_at=NOW() WHERE id=?", [row.id]);
    await conn.commit(); r.rolled_back++; r.details.push({ row: row.row_no, status: 'ROLLED_BACK', student_id: st.id });
  } catch (e) {
    await conn.rollback();
    await pool.query("UPDATE import_batch_rows SET rollback_status='ROLLBACK_FAILED', rollback_error=? WHERE id=?", [String(e.code || e.message).slice(0, 500), row.id]);
    r.failed++; r.details.push({ row: row.row_no, status: 'ROLLBACK_FAILED' });
  } finally { conn.release(); }
}

async function rollbackBatch(pool, { batchId, schoolId, userId, selectedRowIds = [], reason = '' }) {
  const [[batch]] = await pool.query('SELECT id, school_id FROM import_batches WHERE id = ?', [batchId]);
  if (!batch) { const e = new Error('ไม่พบชุดข้อมูลนำเข้า'); e.statusCode = 404; throw e; }
  if (String(batch.school_id) !== String(schoolId)) { const e = new Error('ไม่มีสิทธิ์เข้าถึงชุดข้อมูลนี้'); e.statusCode = 403; throw e; }
  const sel = new Set((Array.isArray(selectedRowIds) ? selectedRowIds : []).map(Number));
  if (sel.size === 0) { const e = new Error('กรุณาเลือกรายการที่ต้องการย้อนกลับ'); e.statusCode = 400; throw e; }
  const [rows] = await pool.query(
    "SELECT id, row_no, status, rollback_status, new_student_id, student_code FROM import_batch_rows WHERE batch_id = ? ORDER BY row_no", [batchId]);
  const r = { rolled_back: 0, already_rolled_back: 0, skipped: 0, failed: 0, details: [] };
  for (const row of rows) if (sel.has(Number(row.row_no))) await rollbackRow(pool, { row, schoolId, userId, batchId, reason, r });
  const anyActive = (await pool.query("SELECT COUNT(*) n FROM import_batch_rows WHERE batch_id=? AND status='APPLIED' AND rollback_status IS NULL", [batchId]))[0][0].n;
  await pool.query('UPDATE import_batches SET rollback_status = ?, rolled_back_at = NOW() WHERE id = ?', [anyActive > 0 ? 'ROLLED_BACK_PARTIAL' : 'ROLLED_BACK', batchId]);
  return r;
}

module.exports = { parseImportFile, analyzeRows, runPreview, applyBatch, getReport, listBatches, getBatchDetail, rollbackBatch, classifyImportRow, maskPhone };
