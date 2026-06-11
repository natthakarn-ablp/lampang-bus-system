'use strict';

// Phase 10.13A-26A — student import preview / apply / report.
// Additive: persists batches + row-level results so imports are transparent,
// re-checkable and auditable, WITHOUT touching the existing legacy importer.

const fs = require('fs');
const crypto = require('crypto');
const ExcelJS = require('exceljs');
const env = require('../config/env');
const { classifyImportRow, maskPhone } = require('../utils/studentImportClassifier');
const plateId = require('../utils/plateIdentity');
const { classifyStudentImport } = require('../utils/studentImport');
const { allocateStudentId } = require('./idAllocator.service');
const { logAudit } = require('../utils/audit');

const TERM = env.app.currentTerm;
const canonOf = (plate) => { const p = plateId.parseLegacyPlateText(plate); return p ? plateId.buildCanonicalPlate(p) : ''; };
const normalizePhone = (p) => String(p == null ? '' : p).replace(/\D/g, '');

// ── Parse a CSV/XLS(X) import file into normalized rows. ─────────────────────
async function parseImportFile(filePath, originalName) {
  const rows = [];
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
    await wb.xlsx.readFile(filePath);
    const ws = wb.worksheets[0];
    const headers = (ws.getRow(1).values || []).slice(1).map((v) => (v == null ? '' : String(v)));
    const map = buildMap(headers);
    for (let i = 2; i <= ws.rowCount; i++) {
      const cells = (ws.getRow(i).values || []).slice(1).map((v) => (v == null ? '' : String(v)));
      if (cells.every((c) => !String(c).trim())) continue;
      rows.push(toRow(cells, map, i));
    }
  } else {
    const raw = fs.readFileSync(filePath, 'utf-8').replace(/^﻿/, '');
    const lines = raw.split(/\r?\n/).filter((l) => l.trim());
    const headers = (lines[0] || '').split(',').map((h) => h.trim());
    const map = buildMap(headers);
    for (let i = 1; i < lines.length; i++) {
      const cells = lines[i].split(',').map((c) => c.trim());
      rows.push(toRow(cells, map, i + 1));
    }
  }
  return rows;
}

// ── Per-row analysis (DB lookups + pure classifier). Read-only. ──────────────
async function analyzeRows(db, schoolId, rows) {
  const [allVehicles] = await db.query('SELECT id, plate_no, is_deleted FROM vehicles');
  const canonicalMap = {};
  for (const v of allVehicles) { if (!v.is_deleted) { const c = canonOf(v.plate_no); if (c) canonicalMap[c] = v; } }

  const matchVehicle = (plate_no) => {
    if (!plate_no || !String(plate_no).trim()) return null;
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

  const results = [];
  for (const row of rows) {
    const code = String(row.student_code || '').trim();
    let existing = null;
    let crossSchool = false;
    if (code) {
      const [[ex]] = await db.query(
        `SELECT st.id, st.is_deleted, (SELECT p.name FROM parent_student ps JOIN parents p ON p.id = ps.parent_id WHERE ps.student_id = st.id LIMIT 1) AS parent_name
         FROM students st WHERE st.school_id = ? AND st.student_code = ? LIMIT 1`, [schoolId, code]);
      existing = ex || null;
      if (!existing) {
        const [[cs]] = await db.query(
          'SELECT 1 AS x FROM students WHERE student_code = ? AND school_id <> ? AND COALESCE(is_deleted, FALSE) = FALSE LIMIT 1', [code, schoolId]);
        crossSchool = !!cs;
      }
    }
    const vehicle = matchVehicle(row.plate_no);
    const r = classifyImportRow({ row, schoolId, existing, crossSchool, vehicle });
    r.existing_student_id = existing ? existing.id : null;
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
async function runPreview(pool, { schoolId, importedBy, filePath, originalName }) {
  const rows = await parseImportFile(filePath, originalName);
  const results = await analyzeRows(pool, schoolId, rows);
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
         JSON.stringify({ prefix: norm.prefix || null, first_name: norm.first_name, last_name: norm.last_name, grade: norm.grade || null, classroom: norm.classroom || null, parent_name: norm.parent_name || null, parent_phone: norm.parent_phone || null }),
         r.classification, r.status, r.message_th, r.student_code, r.existing_student_id || null,
         r.matched_vehicle_id, r.matched_display_plate,
         JSON.stringify(r.guardian_mismatch ? { current: r.guardian_current, input: r.guardian_input } : null),
         r.can_apply ? 1 : 0, r.error_detail]
      );
    }
    await conn.commit();
    return { batch_id: batchId, summary, rows: results.map(publicRow) };
  } catch (e) { await conn.rollback(); throw e; } finally { conn.release(); }
}

const normOf = (row) => (typeof row.normalized_json === 'string' ? JSON.parse(row.normalized_json) : (row.normalized_json || {}));

// Dedupe-or-create a parent by phone, then link to the student (idempotent).
async function linkParent(conn, studentId, name, phone, userId) {
  if (!name && !phone) return;
  let parentId;
  if (phone) { const [[ep]] = await conn.query('SELECT id FROM parents WHERE phone = ? AND is_deleted = FALSE LIMIT 1', [phone]); parentId = ep && ep.id; }
  if (!parentId) { const [pr] = await conn.query('INSERT INTO parents (name, phone) VALUES (?, ?)', [name || null, phone || null]); parentId = pr.insertId; }
  await conn.query('INSERT INTO parent_student (parent_id, student_id, approved, approved_by, approved_at) VALUES (?, ?, TRUE, ?, NOW()) ON DUPLICATE KEY UPDATE approved = TRUE', [parentId, studentId, userId]);
}

// ── insert_ready row (INSERT_NEW / CROSS_SCHOOL) — atomic id, idempotent. ────
async function applyInsertRow(pool, { row, schoolId, userId, r }) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [[exist]] = await conn.query('SELECT id, is_deleted FROM students WHERE school_id = ? AND student_code = ? LIMIT 1', [schoolId, row.student_code]);
    if (classifyStudentImport(exist) !== 'INSERT') {
      await conn.query("UPDATE import_batch_rows SET status='ALREADY_APPLIED', applied_at=NOW() WHERE id=?", [row.id]);
      await conn.commit(); r.already_applied++; r.details.push({ row: row.row_no, status: 'ALREADY_APPLIED' }); return;
    }
    const n = normOf(row);
    const cid = crypto.createHash('sha256').update(`import-${schoolId}-${row.student_code}`).digest('hex');
    const newId = await allocateStudentId(conn);
    await conn.query(
      `INSERT INTO students (id, student_code, cid_hash, prefix, first_name, last_name, grade, classroom, school_id, vehicle_id, morning_enabled, evening_enabled, term_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1, ?)`,
      [newId, row.student_code, cid, n.prefix || null, n.first_name || '-', n.last_name || '-', n.grade || null, n.classroom || null, schoolId, row.matched_vehicle_id || null, TERM]
    );
    await linkParent(conn, newId, n.parent_name, n.parent_phone, userId);
    await conn.query("UPDATE import_batch_rows SET status='APPLIED', new_student_id=?, applied_at=NOW() WHERE id=?", [newId, row.id]);
    await conn.commit(); r.applied++; r.details.push({ row: row.row_no, status: 'APPLIED', student_id: newId });
  } catch (e) {
    await conn.rollback();
    await pool.query("UPDATE import_batch_rows SET status='APPLY_FAILED', error_detail=? WHERE id=?", [String(e.code || e.message).slice(0, 500), row.id]);
    r.failed++; r.details.push({ row: row.row_no, status: 'APPLY_FAILED' });
  } finally { conn.release(); }
}

// ── update_guardian_confirmed row — updates ONLY the selected student's guardian.
async function applyGuardianRow(pool, { row, schoolId, userId, batchId, r }) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [[st]] = await conn.query('SELECT id FROM students WHERE school_id = ? AND student_code = ? AND COALESCE(is_deleted, FALSE) = FALSE LIMIT 1', [schoolId, row.student_code]);
    if (!st) {  // student gone / deleted / code reassigned since preview
      await conn.query("UPDATE import_batch_rows SET status='STALE_NEEDS_REPREVIEW' WHERE id=?", [row.id]);
      await conn.commit(); r.stale++; r.details.push({ row: row.row_no, status: 'STALE_NEEDS_REPREVIEW' }); return;
    }
    const n = normOf(row);
    const newName = n.parent_name || null, newPhone = n.parent_phone || null;
    const [[cur]] = await conn.query('SELECT p.id, p.name AS old_name, p.phone AS old_phone FROM parent_student ps JOIN parents p ON p.id = ps.parent_id WHERE ps.student_id = ? LIMIT 1', [st.id]);
    let parentId;
    if (newPhone) { const [[ep]] = await conn.query('SELECT id FROM parents WHERE phone = ? AND is_deleted = FALSE LIMIT 1', [newPhone]); parentId = ep && ep.id; }
    if (parentId) {                                   // reuse the parent that already owns this phone (no dup)
      await conn.query('UPDATE parents SET name = ? WHERE id = ?', [newName, parentId]);
      await conn.query('INSERT INTO parent_student (parent_id, student_id, approved, approved_by, approved_at) VALUES (?, ?, TRUE, ?, NOW()) ON DUPLICATE KEY UPDATE approved = TRUE', [parentId, st.id, userId]);
      if (cur && String(cur.id) !== String(parentId)) await conn.query('DELETE FROM parent_student WHERE student_id = ? AND parent_id = ?', [st.id, cur.id]);
    } else if (cur) {                                 // update the student's current parent in place
      parentId = cur.id;
      await conn.query('UPDATE parents SET name = ?, phone = ? WHERE id = ?', [newName, newPhone, cur.id]);
    } else {                                          // no parent yet → create + link
      await linkParent(conn, st.id, newName, newPhone, userId);
    }
    await logAudit({
      userId, action: 'UPDATE', entityType: 'student', entityId: String(st.id), conn,
      oldValue: { guardian_name: cur ? cur.old_name : null, guardian_phone: maskPhone(cur ? cur.old_phone : null) },
      newValue: { guardian_name: newName, guardian_phone: maskPhone(newPhone), batch_id: batchId, row_no: row.row_no, mode: 'update_guardian_confirmed' },
    });
    await conn.query("UPDATE import_batch_rows SET status='GUARDIAN_UPDATED', new_student_id=?, applied_at=NOW() WHERE id=?", [st.id, row.id]);
    await conn.commit(); r.guardian_updated++; r.details.push({ row: row.row_no, status: 'GUARDIAN_UPDATED', student_id: st.id });
  } catch (e) {
    await conn.rollback();
    await pool.query("UPDATE import_batch_rows SET status='APPLY_FAILED', error_detail=? WHERE id=?", [String(e.code || e.message).slice(0, 500), row.id]);
    r.failed++; r.details.push({ row: row.row_no, status: 'APPLY_FAILED' });
  } finally { conn.release(); }
}

// ── reactivate_student_confirmed row — restores the SAME-school soft-deleted student.
async function applyReactivateRow(pool, { row, schoolId, userId, batchId, r }) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [[st]] = await conn.query('SELECT id, is_deleted FROM students WHERE school_id = ? AND student_code = ? LIMIT 1', [schoolId, row.student_code]);
    if (!st) {
      await conn.query("UPDATE import_batch_rows SET status='STALE_NEEDS_REPREVIEW' WHERE id=?", [row.id]);
      await conn.commit(); r.stale++; r.details.push({ row: row.row_no, status: 'STALE_NEEDS_REPREVIEW' }); return;
    }
    if (!st.is_deleted) {  // already active (restored or re-inserted since preview)
      await conn.query("UPDATE import_batch_rows SET status='ALREADY_APPLIED', applied_at=NOW() WHERE id=?", [row.id]);
      await conn.commit(); r.already_applied++; r.details.push({ row: row.row_no, status: 'ALREADY_APPLIED' }); return;
    }
    // Vehicle re-check: never reactivate onto a missing/soft-deleted vehicle.
    let vehicleId = row.matched_vehicle_id || null;
    if (vehicleId) {
      const [[v]] = await conn.query('SELECT id FROM vehicles WHERE id = ? AND is_deleted = FALSE LIMIT 1', [vehicleId]);
      if (!v) {
        await conn.query("UPDATE import_batch_rows SET status='VEHICLE_BLOCKED' WHERE id=?", [row.id]);
        await conn.commit(); r.vehicle_blocked++; r.details.push({ row: row.row_no, status: 'VEHICLE_BLOCKED' }); return;
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
    await conn.query("UPDATE import_batch_rows SET status='REACTIVATED', new_student_id=?, applied_at=NOW() WHERE id=?", [st.id, row.id]);
    await conn.commit(); r.reactivated++; r.details.push({ row: row.row_no, status: 'REACTIVATED', student_id: st.id });
  } catch (e) {
    await conn.rollback();
    await pool.query("UPDATE import_batch_rows SET status='APPLY_FAILED', error_detail=? WHERE id=?", [String(e.code || e.message).slice(0, 500), row.id]);
    r.failed++; r.details.push({ row: row.row_no, status: 'APPLY_FAILED' });
  } finally { conn.release(); }
}

// ── Apply with explicit modes (Phase 10.13B-4). insert_ready is the default and
//    preserves prior behavior; risky modes act ONLY on explicitly selected rows.
const RISKY_GUARDIAN = new Set(['update_guardian_confirmed', 'mixed_confirmed']);
const RISKY_REACTIVATE = new Set(['reactivate_student_confirmed', 'mixed_confirmed']);
const DOES_INSERT = new Set(['insert_ready', 'mixed_confirmed']);

async function applyBatch(pool, { batchId, schoolId, userId, mode = 'insert_ready', selectedRowIds = [], confirmGuardianUpdate = false, confirmReactivate = false }) {
  const [[batch]] = await pool.query('SELECT id, school_id FROM import_batches WHERE id = ?', [batchId]);
  if (!batch) { const e = new Error('ไม่พบชุดข้อมูลนำเข้า'); e.statusCode = 404; throw e; }
  if (String(batch.school_id) !== String(schoolId)) { const e = new Error('ไม่มีสิทธิ์เข้าถึงชุดข้อมูลนี้'); e.statusCode = 403; throw e; }

  const sel = new Set((Array.isArray(selectedRowIds) ? selectedRowIds : []).map(Number));
  const r = { mode, applied: 0, already_applied: 0, guardian_updated: 0, reactivated: 0, stale: 0, vehicle_blocked: 0, failed: 0, details: [] };

  if (DOES_INSERT.has(mode)) {
    const [rows] = await pool.query(
      `SELECT * FROM import_batch_rows WHERE batch_id = ? AND can_apply = TRUE AND applied_at IS NULL
         AND classification IN ('INSERT_NEW', 'CROSS_SCHOOL_SAME_CODE_ALLOWED') ORDER BY row_no`, [batchId]);
    for (const row of rows) await applyInsertRow(pool, { row, schoolId, userId, r });
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

  const status = r.failed > 0 ? 'APPLIED_PARTIAL' : 'APPLIED';
  await pool.query('UPDATE import_batches SET status = ?, applied_at = NOW() WHERE id = ?', [status, batchId]);
  return r;
}

// ── Report: row-level results (phones never included; PII-safe). ─────────────
async function getReport(pool, { batchId, schoolId }) {
  const [[batch]] = await pool.query('SELECT id, school_id, filename, status, total_rows, created_at FROM import_batches WHERE id = ?', [batchId]);
  if (!batch) { const e = new Error('ไม่พบชุดข้อมูลนำเข้า'); e.statusCode = 404; throw e; }
  if (String(batch.school_id) !== String(schoolId)) { const e = new Error('ไม่มีสิทธิ์เข้าถึงชุดข้อมูลนี้'); e.statusCode = 403; throw e; }
  const [rows] = await pool.query(
    `SELECT row_no, student_code, classification, status, message_th, matched_display_plate,
            (guardian_diff_json IS NOT NULL) AS guardian_mismatch,
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
    })),
  };
}

module.exports = { parseImportFile, analyzeRows, runPreview, applyBatch, getReport, classifyImportRow, maskPhone };
