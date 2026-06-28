'use strict';

/**
 * driverDocuments.service.js — Phase 10.14 (supporting evidence)
 *
 * Vehicle + driver document uploads (PDF/image). Metadata only — the bytes live
 * on disk under uploads/documents/ (written by the route's multer config); this
 * service stores storage_key/sha256/etc., the human review decision, and the
 * SECURITY-CRITICAL scoped resolution that serves a file to a viewer.
 *
 * review_status is set ONLY by a reviewer (issuing school / transport / admin)
 * and NEVER auto-touches vehicles.verification_status or registration
 * eligibility — these documents are advisory supporting evidence.
 *
 * pool is the 1st arg (DB-free / unit-testable); each mutation is one
 * transaction with FOR UPDATE + logAudit({ conn }). Gated at the router layer
 * behind FEATURE_DRIVER_REGISTRATION (dark by default).
 */

const path = require('path');
const { logAudit } = require('../utils/audit');

const VEHICLE_DOC_TYPES = ['VEHICLE_REGISTRATION', 'COMPULSORY_INSURANCE', 'TAX', 'INSURANCE', 'OTHER'];
const DRIVER_DOC_TYPES = ['DRIVER_LICENCE', 'OTHER'];
const DOC_TYPE_TH = {
  VEHICLE_REGISTRATION: 'เล่มทะเบียนรถ', COMPULSORY_INSURANCE: 'พ.ร.บ.', TAX: 'ป้ายภาษีรถ',
  INSURANCE: 'ประกันภัยรถ', DRIVER_LICENCE: 'ใบขับขี่', OTHER: 'เอกสารอื่น ๆ',
};
const REVIEW_DECISIONS = ['APPROVED', 'REJECTED'];

// Fixed base dir — files live flat under uploads/documents/. The write side
// stores ONLY a basename in storage_key; we never trust a path from the row or
// the URL. Mirrors scripts/cleanup-expired-imports.js insideImportDir guard.
const DOC_BASE_DIR = path.resolve(path.join(__dirname, '../../uploads/documents'));

function appError(message, statusCode = 400, code = null, extra = null) {
  const error = new Error(message);
  error.statusCode = statusCode;
  if (code) error.errors = [{ code, ...(extra || {}) }];
  return error;
}

function notFound() {
  return appError('ไม่พบเอกสาร หรือคุณไม่มีสิทธิ์เข้าถึง', 404, 'DOCUMENT_NOT_FOUND');
}

function normExpiry(value) {
  if (value == null || value === '') return null;
  const s = String(value).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw appError('รูปแบบวันหมดอายุไม่ถูกต้อง (YYYY-MM-DD)', 400, 'BAD_EXPIRY');
  return s;
}

/**
 * Validate storage_key is a single safe filename and join it under the fixed
 * uploads/documents dir. Rejects any separator, "..", NUL, or escape. Returns
 * the absolute path, or null if unsafe.
 */
function safeResolveStorageKey(storageKey) {
  if (!storageKey || typeof storageKey !== 'string') return null;
  if (storageKey.includes('\0')) return null;
  const base = path.basename(storageKey);
  if (base !== storageKey || base === '.' || base === '..' || base === '') return null;
  const resolved = path.resolve(path.join(DOC_BASE_DIR, base));
  if (resolved !== path.join(DOC_BASE_DIR, base) ||
      !(resolved === DOC_BASE_DIR || resolved.startsWith(DOC_BASE_DIR + path.sep))) {
    return null;
  }
  return resolved;
}

// ─── Scope helpers (SELECT-only; used by the review/list routes) ───────────────

/** A school "owns" a vehicle when a non-deleted student of that school rides it
 *  OR the school is on this vehicle's registration (inspection_application_schools). */
async function schoolOwnsVehicle(pool, { schoolId, vehicleId }) {
  const [[r]] = await pool.query(
    `SELECT 1 AS ok
       FROM vehicles v
      WHERE v.id = ? AND v.is_deleted = FALSE
        AND (
          EXISTS (SELECT 1 FROM students s
                   WHERE s.vehicle_id = v.id AND s.school_id = ? AND s.is_deleted = FALSE)
          OR EXISTS (SELECT 1 FROM inspection_application_schools aps
                       JOIN vehicle_inspection_applications a ON a.id = aps.application_id
                      WHERE a.vehicle_id = v.id AND aps.school_id = ?)
        )
      LIMIT 1`,
    [vehicleId, schoolId, schoolId]
  );
  return Boolean(r);
}

/** A school "owns" a driver when the driver is on a vehicle the school owns. */
async function schoolOwnsDriver(pool, { schoolId, driverId }) {
  const [[r]] = await pool.query(
    `SELECT 1 AS ok
       FROM driver_vehicle_assignments dva
       JOIN vehicles v ON v.id = dva.vehicle_id AND v.is_deleted = FALSE
      WHERE dva.driver_id = ? AND dva.is_active = TRUE
        AND EXISTS (SELECT 1 FROM students s
                     WHERE s.vehicle_id = v.id AND s.school_id = ? AND s.is_deleted = FALSE)
      LIMIT 1`,
    [driverId, schoolId]
  );
  return Boolean(r);
}

/** Resolve the driver_id behind a vehicle's single active assignment (or null). */
async function driverIdForVehicle(pool, vehicleId) {
  const [[r]] = await pool.query(
    `SELECT driver_id FROM driver_vehicle_assignments
      WHERE vehicle_id = ? AND is_active = TRUE LIMIT 1`,
    [vehicleId]
  );
  return r ? r.driver_id : null;
}

// ─── Add (metadata persisted after the route stores + sniffs the file) ─────────

async function addVehicleDocument(pool, {
  vehicleId, docType, storageKey, originalName, mimeType, sha256, fileSize, expiryDate, uploadedBy,
}) {
  if (!vehicleId) throw appError('ไม่พบรถ', 400, 'VEHICLE_REQUIRED');
  if (!VEHICLE_DOC_TYPES.includes(docType)) throw appError('ประเภทเอกสารไม่ถูกต้อง', 400, 'BAD_DOC_TYPE');
  if (!storageKey || !sha256) throw appError('ไฟล์ไม่สมบูรณ์', 400, 'FILE_REQUIRED');
  const expiry = normExpiry(expiryDate);

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [[veh]] = await conn.query(
      'SELECT id FROM vehicles WHERE id = ? AND is_deleted = FALSE FOR UPDATE', [vehicleId]);
    if (!veh) throw appError('ไม่พบรถ', 404, 'VEHICLE_NOT_FOUND');

    const [ins] = await conn.query(
      `INSERT INTO vehicle_documents
         (vehicle_id, doc_type, storage_key, original_name, mime_type, sha256,
          file_size, expiry_date, uploaded_by, review_status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING')`,
      [vehicleId, docType, storageKey, String(originalName || '').slice(0, 255),
        mimeType ? String(mimeType).slice(0, 120) : null, sha256, fileSize, expiry, uploadedBy]);
    await logAudit({
      userId: uploadedBy, action: 'CREATE', entityType: 'vehicle_document', entityId: String(ins.insertId),
      newValue: { vehicle_id: vehicleId, doc_type: docType, sha256, file_size: fileSize, expiry_date: expiry }, conn });
    await conn.commit();
    return { id: ins.insertId, vehicle_id: vehicleId, doc_type: docType, review_status: 'PENDING' };
  } catch (error) { await conn.rollback(); throw error; } finally { conn.release(); }
}

async function addDriverDocument(pool, {
  driverId, docType, storageKey, originalName, mimeType, sha256, fileSize, expiryDate, uploadedBy,
}) {
  if (!driverId) throw appError('ไม่พบคนขับ', 400, 'DRIVER_REQUIRED');
  if (!DRIVER_DOC_TYPES.includes(docType)) throw appError('ประเภทเอกสารไม่ถูกต้อง', 400, 'BAD_DOC_TYPE');
  if (!storageKey || !sha256) throw appError('ไฟล์ไม่สมบูรณ์', 400, 'FILE_REQUIRED');
  const expiry = normExpiry(expiryDate);

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [[drv]] = await conn.query(
      'SELECT id FROM drivers WHERE id = ? AND is_deleted = FALSE FOR UPDATE', [driverId]);
    if (!drv) throw appError('ไม่พบคนขับ', 404, 'DRIVER_NOT_FOUND');

    const [ins] = await conn.query(
      `INSERT INTO driver_documents
         (driver_id, doc_type, storage_key, original_name, mime_type, sha256,
          file_size, expiry_date, uploaded_by, review_status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING')`,
      [driverId, docType, storageKey, String(originalName || '').slice(0, 255),
        mimeType ? String(mimeType).slice(0, 120) : null, sha256, fileSize, expiry, uploadedBy]);
    await logAudit({
      userId: uploadedBy, action: 'CREATE', entityType: 'driver_document', entityId: String(ins.insertId),
      newValue: { driver_id: driverId, doc_type: docType, sha256, file_size: fileSize, expiry_date: expiry }, conn });
    await conn.commit();
    return { id: ins.insertId, driver_id: driverId, doc_type: docType, review_status: 'PENDING' };
  } catch (error) { await conn.rollback(); throw error; } finally { conn.release(); }
}

// ─── List (SELECT-only; metadata, never storage_key to clients) ────────────────

async function listVehicleDocuments(pool, vehicleId) {
  const [rows] = await pool.query(
    `SELECT id, vehicle_id, doc_type, original_name, mime_type, sha256, file_size,
            expiry_date, uploaded_by, review_status, reviewed_by, reviewed_at,
            review_note, created_at, updated_at
       FROM vehicle_documents
      WHERE vehicle_id = ? AND is_deleted = FALSE
      ORDER BY created_at DESC`, [vehicleId]);
  return rows;
}

async function listDriverDocuments(pool, driverId) {
  const [rows] = await pool.query(
    `SELECT id, driver_id, doc_type, original_name, mime_type, sha256, file_size,
            expiry_date, uploaded_by, review_status, reviewed_by, reviewed_at,
            review_note, created_at, updated_at
       FROM driver_documents
      WHERE driver_id = ? AND is_deleted = FALSE
      ORDER BY created_at DESC`, [driverId]);
  return rows;
}

/** Fetch one document row (vehicle|driver) for review-route scope checks. */
async function getDocument(pool, { kind, id }) {
  const table = kind === 'driver' ? 'driver_documents' : 'vehicle_documents';
  const ownerCol = kind === 'driver' ? 'driver_id' : 'vehicle_id';
  const [[row]] = await pool.query(
    `SELECT id, ${ownerCol} AS owner_id, doc_type, storage_key, original_name,
            mime_type, sha256, file_size, uploaded_by, review_status, is_deleted
       FROM ${table} WHERE id = ? AND is_deleted = FALSE LIMIT 1`, [id]);
  return row || null;
}

// ─── Review (human reviewer: school that owns / transport / admin) ─────────────

// Best-effort LINE nudge to the driver who UPLOADED a now-REJECTED document, so
// they learn the result without opening the app. Resolves the uploader's verified
// LINE id (line_users source of truth, drivers shortcut fallback) and sends a plain
// text message. NEVER throws — a notification failure must not affect the review.
// LINE Messaging API free tier; no added cost.
async function notifyUploaderRejected(pool, { uploadedBy, docType, note }) {
  try {
    if (!uploadedBy) return;
    const [[row]] = await pool.query(
      `SELECT COALESCE(lu.line_user_id, d.line_user_id) AS line_user_id
         FROM users u
         LEFT JOIN drivers d ON d.id = u.driver_id
         LEFT JOIN line_users lu ON lu.driver_id = u.driver_id
              AND lu.user_type = 'driver' AND lu.verified = TRUE AND lu.line_user_id IS NOT NULL
        WHERE u.id = ?`,
      [uploadedBy]
    );
    const lineUserId = row && row.line_user_id;
    if (!lineUserId) return;
    const label = DOC_TYPE_TH[docType] || 'เอกสาร';
    const text = `เอกสาร "${label}" ของคุณไม่ผ่านการตรวจ\nเหตุผล: ${note || '-'}\nกรุณาแนบเอกสารใหม่ในระบบ`;
    await require('./line.service').sendTextMessage(lineUserId, text);
  } catch { /* best-effort — never affects the review */ }
}

async function reviewDocument(pool, { kind, id, decision, note, reviewerUserId }) {
  if (!REVIEW_DECISIONS.includes(decision)) throw appError('ผลการตรวจไม่ถูกต้อง', 400, 'BAD_DECISION');
  const trimmedNote = note != null ? String(note).trim().slice(0, 500) : null;
  if (decision === 'REJECTED' && !trimmedNote) throw appError('กรุณาระบุเหตุผลที่ไม่อนุมัติ', 400, 'NOTE_REQUIRED');
  const table = kind === 'driver' ? 'driver_documents' : 'vehicle_documents';
  const entityType = kind === 'driver' ? 'driver_document' : 'vehicle_document';

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [[doc]] = await conn.query(
      `SELECT id, review_status, doc_type, uploaded_by FROM ${table} WHERE id = ? AND is_deleted = FALSE FOR UPDATE`, [id]);
    if (!doc) throw appError('ไม่พบเอกสาร', 404, 'DOC_NOT_FOUND');

    await conn.query(
      `UPDATE ${table}
          SET review_status = ?, reviewed_by = ?, reviewed_at = CURRENT_TIMESTAMP, review_note = ?
        WHERE id = ?`, [decision, reviewerUserId, trimmedNote, id]);
    await logAudit({
      userId: reviewerUserId, action: decision === 'APPROVED' ? 'APPROVE' : 'UPDATE',
      entityType, entityId: String(id),
      oldValue: { review_status: doc.review_status },
      newValue: { review_status: decision, review_note: trimmedNote }, conn });
    await conn.commit();
    if (decision === 'REJECTED') {
      await notifyUploaderRejected(pool, { uploadedBy: doc.uploaded_by, docType: doc.doc_type, note: trimmedNote });
    }
    return { id: Number(id), review_status: decision, review_note: trimmedNote };
  } catch (error) { await conn.rollback(); throw error; } finally { conn.release(); }
}

// ─── Soft delete (owner: the uploader; or admin) ───────────────────────────────

async function softDeleteDocument(pool, { kind, id, userId, isAdmin = false }) {
  const table = kind === 'driver' ? 'driver_documents' : 'vehicle_documents';
  const entityType = kind === 'driver' ? 'driver_document' : 'vehicle_document';

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [[doc]] = await conn.query(
      `SELECT id, uploaded_by, review_status, is_deleted FROM ${table} WHERE id = ? FOR UPDATE`, [id]);
    if (!doc || doc.is_deleted) throw appError('ไม่พบเอกสาร', 404, 'DOC_NOT_FOUND');
    if (!isAdmin && Number(doc.uploaded_by) !== Number(userId)) {
      throw appError('ลบได้เฉพาะเอกสารที่คุณอัปโหลด', 403, 'NOT_OWNER');
    }
    // Evidence a reviewer already APPROVED is locked from owner deletion —
    // removing it would erase the reviewed audit trail. Admin can still override.
    if (!isAdmin && doc.review_status === 'APPROVED') {
      throw appError('เอกสารที่ผ่านการตรวจแล้วลบไม่ได้ หากต้องแก้ไขโปรดติดต่อผู้ดูแล', 403, 'APPROVED_LOCKED');
    }
    await conn.query(
      `UPDATE ${table} SET is_deleted = TRUE, deleted_at = CURRENT_TIMESTAMP WHERE id = ?`, [id]);
    await logAudit({ userId, action: 'DELETE', entityType, entityId: String(id), conn });
    await conn.commit();
    return { id: Number(id), deleted: true };
  } catch (error) { await conn.rollback(); throw error; } finally { conn.release(); }
}

// ─── SECURITY-CRITICAL: scoped resolution for the file-serving route ───────────
// Each loader returns the document row ONLY when the viewer is in scope. The
// scope is part of the WHERE/JOIN, so an out-of-scope id yields zero rows (404)
// — never a forbidden-but-leaked hit. driver: own upload OR their single active
// vehicle. school: the doc's vehicle/driver must be linked to THIS school via the
// active application's per-school access table (same table getApplication uses)
// → a school cannot read another school's driver's licence by id. transport/admin:
// no scope predicate.

async function loadVehicleDoc(pool, { id, viewer, driverVehicleId }) {
  const role = viewer.role;
  if (role === 'transport' || role === 'admin') {
    const [[row]] = await pool.query(
      'SELECT vd.* FROM vehicle_documents vd WHERE vd.id = ? AND vd.is_deleted = FALSE LIMIT 1', [id]);
    return row || null;
  }
  if (role === 'driver') {
    const [[row]] = await pool.query(
      `SELECT vd.* FROM vehicle_documents vd
        WHERE vd.id = ? AND vd.is_deleted = FALSE
          AND (vd.uploaded_by = ? OR vd.vehicle_id = ?) LIMIT 1`,
      [id, viewer.userId, driverVehicleId || '\0no-vehicle\0']);
    return row || null;
  }
  if (role === 'school') {
    if (!viewer.schoolId) throw appError('ไม่พบขอบเขตโรงเรียน', 403, 'SCHOOL_SCOPE_REQUIRED');
    const [[row]] = await pool.query(
      `SELECT vd.* FROM vehicle_documents vd
         JOIN vehicle_inspection_applications a
           ON a.vehicle_id = vd.vehicle_id AND a.status NOT IN ('CANCELLED','SUPERSEDED','EXPIRED')
         JOIN inspection_application_schools aps
           ON aps.application_id = a.id AND aps.school_id = ?
        WHERE vd.id = ? AND vd.is_deleted = FALSE LIMIT 1`,
      [viewer.schoolId, id]);
    return row || null;
  }
  return null;
}

async function loadDriverDoc(pool, { id, viewer, driverVehicleId }) {
  const role = viewer.role;
  if (role === 'transport' || role === 'admin') {
    const [[row]] = await pool.query(
      'SELECT dd.* FROM driver_documents dd WHERE dd.id = ? AND dd.is_deleted = FALSE LIMIT 1', [id]);
    return row || null;
  }
  if (role === 'driver') {
    const [[row]] = await pool.query(
      `SELECT dd.* FROM driver_documents dd
        WHERE dd.id = ? AND dd.is_deleted = FALSE
          AND ( dd.uploaded_by = ?
             OR EXISTS (SELECT 1 FROM driver_vehicle_assignments dva
                         WHERE dva.driver_id = dd.driver_id
                           AND dva.vehicle_id = ? AND dva.is_active = TRUE) ) LIMIT 1`,
      [id, viewer.userId, driverVehicleId || '\0no-vehicle\0']);
    return row || null;
  }
  if (role === 'school') {
    if (!viewer.schoolId) throw appError('ไม่พบขอบเขตโรงเรียน', 403, 'SCHOOL_SCOPE_REQUIRED');
    const [[row]] = await pool.query(
      `SELECT dd.* FROM driver_documents dd
         JOIN driver_vehicle_assignments dva
           ON dva.driver_id = dd.driver_id AND dva.is_active = TRUE
         JOIN vehicle_inspection_applications a
           ON a.vehicle_id = dva.vehicle_id AND a.status NOT IN ('CANCELLED','SUPERSEDED','EXPIRED')
         JOIN inspection_application_schools aps
           ON aps.application_id = a.id AND aps.school_id = ?
        WHERE dd.id = ? AND dd.is_deleted = FALSE LIMIT 1`,
      [viewer.schoolId, id]);
    return row || null;
  }
  return null;
}

/**
 * Resolve a document to a safe absolute path for a viewer, or throw 404.
 * @returns {Promise<{row:object, absPath:string}>}
 */
async function resolveDocumentForViewer(pool, { docType, id, viewer, driverVehicleId = null }) {
  if (docType !== 'vehicle' && docType !== 'driver') throw notFound();
  if (!Number.isInteger(id) || id <= 0) throw notFound();
  if (!viewer || !viewer.role) throw appError('ข้อมูลผู้ดูไม่ครบถ้วน', 400, 'INVALID_VIEWER');

  const row = docType === 'vehicle'
    ? await loadVehicleDoc(pool, { id, viewer, driverVehicleId })
    : await loadDriverDoc(pool, { id, viewer, driverVehicleId });

  if (!row) throw notFound();
  const absPath = safeResolveStorageKey(row.storage_key);
  if (!absPath) throw notFound();
  return { row, absPath };
}

module.exports = {
  appError,
  VEHICLE_DOC_TYPES,
  DRIVER_DOC_TYPES,
  DOC_BASE_DIR,
  safeResolveStorageKey,
  schoolOwnsVehicle,
  schoolOwnsDriver,
  driverIdForVehicle,
  addVehicleDocument,
  addDriverDocument,
  listVehicleDocuments,
  listDriverDocuments,
  getDocument,
  reviewDocument,
  softDeleteDocument,
  resolveDocumentForViewer,
};
