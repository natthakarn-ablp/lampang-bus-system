'use strict';

// Phase 10.13B-7 — guarded vehicle restore / shared-fleet-use request workflow.
// Creating a request changes NO vehicle data. Approval applies only RESTORE
// (un-delete a soft-deleted vehicle, canonical-guarded). USE_EXISTING /
// ADD_MISSING / REVIEW are informational (audited, no vehicle mutation) — the
// fleet is already shared province-wide, and new vehicles use the add form.

const { logAudit } = require('../utils/audit');
const PI = require('../utils/plateIdentity');

const TYPES = ['RESTORE_SOFT_DELETED_VEHICLE', 'USE_EXISTING_SHARED_VEHICLE', 'ADD_MISSING_VEHICLE', 'REVIEW_VEHICLE_CONFLICT'];
const err = (msg, code) => { const e = new Error(msg); e.statusCode = code; return e; };

function buildPlate({ plate_prefix, plate_number, province, input_plate }) {
  if (input_plate) return String(input_plate).trim();
  return PI.buildDisplayPlate({ plate_prefix, plate_number, province }) || null;
}

// ── School: create a vehicle request. No vehicle mutation. ───────────────────
async function createVehicleRequest(pool, { schoolId, userId, requestType, vehicleId, platePrefix, plateNumber, province, inputPlate, reason, importBatchId, importRowId }) {
  if (!TYPES.includes(requestType)) throw err('ประเภทคำขอไม่ถูกต้อง', 400);
  if (!String(reason || '').trim()) throw err('กรุณาระบุเหตุผล', 400);

  let plate = buildPlate({ plate_prefix: platePrefix, plate_number: plateNumber, province, input_plate: inputPlate });
  let canonical = plate ? PI.canonicalPlateForStorage(plate) : null;

  let snapshot = null;
  let resolvedVehicleId = vehicleId || null;
  if (requestType === 'RESTORE_SOFT_DELETED_VEHICLE') {
    // Resolve the soft-deleted vehicle by id or by canonical (e.g. from import).
    let [[v]] = resolvedVehicleId
      ? await pool.query('SELECT id, plate_no, vehicle_type, is_deleted FROM vehicles WHERE id = ?', [resolvedVehicleId])
      : [[]];
    if (!v && canonical) { [[v]] = await pool.query('SELECT id, plate_no, vehicle_type, is_deleted FROM vehicles WHERE canonical_plate = ? AND is_deleted = TRUE LIMIT 1', [canonical]); }
    if (!v) throw err('ไม่พบรถที่ต้องการกู้คืน', 404);
    if (!v.is_deleted) throw err('รถคันนี้ใช้งานอยู่แล้ว ไม่จำเป็นต้องกู้คืน', 400);
    resolvedVehicleId = v.id;
    snapshot = { plate_no: v.plate_no, vehicle_type: v.vehicle_type };   // no owner phone
    // Derive canonical/plate from the resolved vehicle so the dedupe + storage
    // are meaningful even when only a vehicle_id was supplied.
    if (!plate) plate = v.plate_no;
    if (!canonical) canonical = PI.canonicalPlateForStorage(v.plate_no);
  } else if (requestType === 'USE_EXISTING_SHARED_VEHICLE' && resolvedVehicleId) {
    const [[v]] = await pool.query('SELECT id, plate_no, vehicle_type FROM vehicles WHERE id = ? AND is_deleted = FALSE', [resolvedVehicleId]);
    if (v) snapshot = { plate_no: v.plate_no, vehicle_type: v.vehicle_type };
  }

  // Block a duplicate PENDING for the same school + canonical + type.
  if (canonical) {
    const [[dup]] = await pool.query("SELECT id FROM vehicle_requests WHERE school_id = ? AND canonical_plate = ? AND request_type = ? AND status = 'PENDING' LIMIT 1", [schoolId, canonical, requestType]);
    if (dup) { const e = err('มีคำขอที่รออนุมัติสำหรับรถคันนี้อยู่แล้ว', 409); e.errors = [{ code: 'PENDING_REQUEST_EXISTS', request_id: dup.id }]; throw e; }
  }

  const [r] = await pool.query(
    `INSERT INTO vehicle_requests
       (request_type, status, requested_by, school_id, vehicle_id, plate_prefix, plate_number, province, input_plate, canonical_plate,
        existing_vehicle_snapshot_json, import_batch_id, import_row_id, reason)
     VALUES (?, 'PENDING', ?, ?, ?, ?, ?, ?, ?, ?, CAST(? AS JSON), ?, ?, ?)`,
    [requestType, userId, schoolId, resolvedVehicleId, platePrefix || null, plateNumber || null, province || null, plate, canonical,
     JSON.stringify(snapshot), importBatchId || null, importRowId || null, String(reason).slice(0, 500)]
  );
  await logAudit({ userId, action: 'CREATE', entityType: 'vehicle_request', entityId: String(r.insertId),
    newValue: { type: requestType, school_id: schoolId, vehicle_id: resolvedVehicleId, canonical } });
  return { id: r.insertId, status: 'PENDING', request_type: requestType, vehicle_id: resolvedVehicleId };
}

const pub = (q) => ({
  id: q.id, request_type: q.request_type, status: q.status, school_id: q.school_id, school_name: q.school_name,
  vehicle_id: q.vehicle_id, input_plate: q.input_plate, canonical_plate: q.canonical_plate,
  reason: q.reason, admin_note: q.admin_note, import_batch_id: q.import_batch_id, import_row_id: q.import_row_id,
  created_at: q.created_at, approved_at: q.approved_at, rejected_at: q.rejected_at, applied_at: q.applied_at,
});
const SEL = 'q.*, sc.name AS school_name';
const JOIN = 'LEFT JOIN schools sc ON sc.id = q.school_id';

async function listSchoolVehicleRequests(pool, { schoolId }) {
  const [rows] = await pool.query(`SELECT ${SEL} FROM vehicle_requests q ${JOIN} WHERE q.school_id = ? ORDER BY q.id DESC LIMIT 200`, [schoolId]);
  return rows.map(pub);
}
async function getSchoolVehicleRequest(pool, { requestId, schoolId }) {
  const [[q]] = await pool.query(`SELECT ${SEL} FROM vehicle_requests q ${JOIN} WHERE q.id = ?`, [requestId]);
  if (!q) throw err('ไม่พบคำขอ', 404);
  if (String(q.school_id) !== String(schoolId)) throw err('ไม่มีสิทธิ์เข้าถึงคำขอนี้', 403);
  return pub(q);
}
async function cancelVehicleRequest(pool, { requestId, schoolId, userId }) {
  const [[q]] = await pool.query('SELECT id, school_id, status FROM vehicle_requests WHERE id = ?', [requestId]);
  if (!q) throw err('ไม่พบคำขอ', 404);
  if (String(q.school_id) !== String(schoolId)) throw err('ไม่มีสิทธิ์ยกเลิกคำขอนี้', 403);
  if (q.status !== 'PENDING') throw err('ยกเลิกได้เฉพาะคำขอที่รออนุมัติเท่านั้น', 400);
  await pool.query("UPDATE vehicle_requests SET status='CANCELLED', updated_at=NOW() WHERE id=? AND status='PENDING'", [requestId]);
  await logAudit({ userId, action: 'UPDATE', entityType: 'vehicle_request', entityId: String(requestId), newValue: { status: 'CANCELLED' } });
  return { id: requestId, status: 'CANCELLED' };
}

// ── Admin ────────────────────────────────────────────────────────────────────
async function listAdminVehicleRequests(pool, { status }) {
  const where = status ? 'WHERE q.status = ?' : '';
  const params = status ? [status] : [];
  const [rows] = await pool.query(`SELECT ${SEL} FROM vehicle_requests q ${JOIN} ${where} ORDER BY q.status='PENDING' DESC, q.id DESC LIMIT 300`, params);
  return rows.map(pub);
}

async function countPendingForAdmin(pool) {
  const [[r]] = await pool.query("SELECT COUNT(*) n FROM vehicle_requests WHERE status = 'PENDING'");
  return r.n;
}
async function getAdminVehicleRequest(pool, { requestId }) {
  const [[q]] = await pool.query(`SELECT ${SEL} FROM vehicle_requests q ${JOIN} WHERE q.id = ?`, [requestId]);
  if (!q) throw err('ไม่พบคำขอ', 404);
  let vehicle = null, activeSiblingConflict = false;
  if (q.vehicle_id) { const [[v]] = await pool.query('SELECT id, plate_no, vehicle_type, is_deleted, canonical_plate FROM vehicles WHERE id = ?', [q.vehicle_id]); vehicle = v || null; }
  if (q.canonical_plate) { const [[sib]] = await pool.query('SELECT id FROM vehicles WHERE canonical_plate = ? AND is_deleted = FALSE LIMIT 1', [q.canonical_plate]); activeSiblingConflict = !!sib; }
  return {
    ...pub(q),
    current_vehicle: vehicle ? { plate_no: vehicle.plate_no, vehicle_type: vehicle.vehicle_type, is_deleted: !!vehicle.is_deleted } : null,
    active_canonical_conflict: activeSiblingConflict,
    can_approve: q.status === 'PENDING',
  };
}

// ── Apply on approve (Part F policy). Only RESTORE mutates a vehicle. ────────
async function approveVehicleRequest(pool, { requestId, adminUserId, adminNote }) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [[q]] = await conn.query('SELECT * FROM vehicle_requests WHERE id = ? FOR UPDATE', [requestId]);
    if (!q) throw err('ไม่พบคำขอ', 404);
    if (q.status === 'APPLIED') { await conn.commit(); return { status: 'ALREADY_APPLIED', vehicle_id: q.vehicle_id }; }
    if (q.status !== 'PENDING') { await conn.commit(); return { status: q.status }; }
    const note = String(adminNote || '').slice(0, 500);

    if (q.request_type === 'RESTORE_SOFT_DELETED_VEHICLE') {
      const [[v]] = await conn.query('SELECT id, plate_no, is_deleted FROM vehicles WHERE id = ? FOR UPDATE', [q.vehicle_id]);
      if (!v) { await conn.query("UPDATE vehicle_requests SET status='FAILED', admin_note=?, updated_at=NOW() WHERE id=?", ['vehicle missing', requestId]); await logAudit({ userId: adminUserId, action: 'UPDATE', entityType: 'vehicle_request', entityId: String(requestId), conn, newValue: { status: 'FAILED', reason: 'VEHICLE_MISSING' } }); await conn.commit(); return { status: 'FAILED', reason: 'VEHICLE_MISSING' }; }
      if (!v.is_deleted) { await conn.query("UPDATE vehicle_requests SET status='ALREADY_APPLIED', applied_at=NOW(), admin_note=?, updated_at=NOW() WHERE id=?", [note, requestId]); await logAudit({ userId: adminUserId, action: 'UPDATE', entityType: 'vehicle_request', entityId: String(requestId), conn, newValue: { status: 'ALREADY_APPLIED', reason: 'VEHICLE_ALREADY_ACTIVE' } }); await conn.commit(); return { status: 'ALREADY_APPLIED', vehicle_id: v.id }; }
      const canonical = PI.canonicalPlateForStorage(v.plate_no);
      if (canonical) {
        const [[sib]] = await conn.query('SELECT id FROM vehicles WHERE canonical_plate = ? AND is_deleted = FALSE AND id <> ? LIMIT 1', [canonical, v.id]);
        if (sib) { await conn.query("UPDATE vehicle_requests SET status='FAILED', admin_note=?, updated_at=NOW() WHERE id=?", ['active canonical sibling exists', requestId]); await logAudit({ userId: adminUserId, action: 'UPDATE', entityType: 'vehicle_request', entityId: String(requestId), conn, newValue: { status: 'FAILED', reason: 'ACTIVE_CANONICAL_CONFLICT' } }); await conn.commit(); return { status: 'FAILED', reason: 'ACTIVE_CANONICAL_CONFLICT' }; }
      }
      try {
        await conn.query('UPDATE vehicles SET is_deleted = FALSE, deleted_at = NULL, canonical_plate = ? WHERE id = ? AND is_deleted = TRUE', [canonical, v.id]);
      } catch (e) {
        if (e.code === 'ER_DUP_ENTRY') { await conn.rollback(); const [fr] = await pool.query("UPDATE vehicle_requests SET status='FAILED', admin_note='canonical race', updated_at=NOW() WHERE id=?", [requestId]); if (fr && fr.affectedRows > 0) await logAudit({ userId: adminUserId, action: 'UPDATE', entityType: 'vehicle_request', entityId: String(requestId), newValue: { status: 'FAILED', reason: 'ACTIVE_CANONICAL_CONFLICT' } }); return { status: 'FAILED', reason: 'ACTIVE_CANONICAL_CONFLICT' }; }
        throw e;
      }
      await logAudit({ userId: adminUserId, action: 'UPDATE', entityType: 'vehicle', entityId: String(v.id), conn,
        oldValue: { is_deleted: true }, newValue: { is_deleted: false, restored: true, request_id: requestId } });
      await conn.query("UPDATE vehicle_requests SET status='APPLIED', approved_by=?, approved_at=NOW(), applied_at=NOW(), admin_note=?, before_json=CAST(? AS JSON), after_json=CAST(? AS JSON), updated_at=NOW() WHERE id=?",
        [adminUserId, note, JSON.stringify({ is_deleted: true }), JSON.stringify({ is_deleted: false, vehicle_id: v.id }), requestId]);
      await conn.commit();
      return { status: 'APPLIED', vehicle_id: v.id };
    }

    // USE_EXISTING_SHARED_VEHICLE / ADD_MISSING_VEHICLE / REVIEW_VEHICLE_CONFLICT — informational, no vehicle mutation.
    await conn.query("UPDATE vehicle_requests SET status='APPLIED', approved_by=?, approved_at=NOW(), applied_at=NOW(), admin_note=?, updated_at=NOW() WHERE id=?", [adminUserId, note, requestId]);
    await logAudit({ userId: adminUserId, action: 'APPROVE', entityType: 'vehicle_request', entityId: String(requestId), conn, newValue: { type: q.request_type, result: 'approved (informational)' } });
    await conn.commit();
    return { status: 'APPLIED', informational: true };
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally { conn.release(); }
}

async function rejectVehicleRequest(pool, { requestId, adminUserId, adminNote }) {
  const [[q]] = await pool.query('SELECT id, status FROM vehicle_requests WHERE id = ?', [requestId]);
  if (!q) throw err('ไม่พบคำขอ', 404);
  if (q.status !== 'PENDING') throw err('ไม่อนุมัติได้เฉพาะคำขอที่รออนุมัติเท่านั้น', 400);
  await pool.query("UPDATE vehicle_requests SET status='REJECTED', rejected_by=?, rejected_at=NOW(), admin_note=?, updated_at=NOW() WHERE id=? AND status='PENDING'", [adminUserId, String(adminNote || '').slice(0, 500), requestId]);
  await logAudit({ userId: adminUserId, action: 'UPDATE', entityType: 'vehicle_request', entityId: String(requestId), newValue: { status: 'REJECTED' } });
  return { id: requestId, status: 'REJECTED' };
}


// ── Affiliation: list vehicle requests for schools in this affiliation ───────
async function listForAffiliation(pool, { affiliationId, status = null }) {
  const where = 'WHERE sc.affiliation_id = ?';
  const params = [affiliationId];
  if (status) { params.push(status); }
  const statusSql = status ? ' AND q.status = ?' : '';
  const [rows] = await pool.query(
    `SELECT ${SEL} FROM vehicle_requests q ${JOIN} WHERE sc.affiliation_id = ?${statusSql} ORDER BY q.status='PENDING' DESC, q.id DESC LIMIT 300`,
    params
  );
  return rows.map(pub);
}

async function getDetailForAffiliation(pool, { requestId, affiliationId }) {
  const [[q]] = await pool.query(
    `SELECT ${SEL} FROM vehicle_requests q ${JOIN} WHERE q.id = ? AND sc.affiliation_id = ?`,
    [requestId, affiliationId]
  );
  if (!q) throw err('ไม่พบคำขอ หรือคำขอนี้ไม่ได้อยู่ในสังกัดของคุณ', 404);
  let vehicle = null, activeSiblingConflict = false;
  if (q.vehicle_id) { const [[v]] = await pool.query('SELECT id, plate_no, vehicle_type, is_deleted, canonical_plate FROM vehicles WHERE id = ?', [q.vehicle_id]); vehicle = v || null; }
  if (q.canonical_plate) { const [[sib]] = await pool.query('SELECT id FROM vehicles WHERE canonical_plate = ? AND is_deleted = FALSE LIMIT 1', [q.canonical_plate]); activeSiblingConflict = !!sib; }
  return {
    ...pub(q),
    current_vehicle: vehicle ? { plate_no: vehicle.plate_no, vehicle_type: vehicle.vehicle_type, is_deleted: !!vehicle.is_deleted } : null,
    active_canonical_conflict: activeSiblingConflict,
  };
}


module.exports = {
  createVehicleRequest, listSchoolVehicleRequests, getSchoolVehicleRequest, cancelVehicleRequest,
  listAdminVehicleRequests, countPendingForAdmin, getAdminVehicleRequest, approveVehicleRequest, rejectVehicleRequest,
  listForAffiliation, getDetailForAffiliation,
  listForAffiliation, getDetailForAffiliation,
};
