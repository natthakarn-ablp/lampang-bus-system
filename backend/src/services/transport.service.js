'use strict';

const { pool } = require('../config/database');
const { normalizePlate } = require('../utils/vehiclePlate');
const { logAudit } = require('../utils/audit');
const { validateInspectionDates } = require('../utils/inspectionDates');

// Thrown validation/authorization error carrying an HTTP status + machine code,
// surfaced by the global errorHandler in the standard response shape.
function svcError(message, statusCode = 400, code = null) {
  const err = new Error(message);
  err.statusCode = statusCode;
  if (code) err.errors = [{ code }];
  return err;
}

/**
 * Transport role sees ALL vehicles + inspection data, never student PII.
 * No school/affiliation scope — transport is cross-cutting safety, not a
 * roster view. Per Phase 10.6C PDPA cleanup: no roster-size aggregate, no
 * student names/IDs, no parent info — only vehicle, driver, inspection, insurance
 * fields. The dashboard KPIs filter `vehicles.is_deleted = FALSE` so soft-
 * deleted rows never inflate the inspection-coverage counts.
 */

async function getDashboard() {
  const today = new Date().toISOString().slice(0, 10);

  const [[{ total_vehicles }]] = await pool.query(
    'SELECT COUNT(*) AS total_vehicles FROM vehicles WHERE is_deleted = FALSE'
  );

  // Phase 10.6C — join vehicles and filter is_deleted so the inspection
  // coverage count doesn't include soft-deleted rows. Without this, a
  // retired bus that was last inspected last year would still bump
  // `inspected_count` above `total_vehicles`, breaking the dashboard math.
  const [[{ inspected_count }]] = await pool.query(
    `SELECT COUNT(DISTINCT vi.vehicle_id) AS inspected_count
     FROM   vehicle_inspections vi
     JOIN   vehicles v ON v.id = vi.vehicle_id AND v.is_deleted = FALSE`
  );

  const [[{ passed, failed, needs_fix, pending }]] = await pool.query(
    `SELECT
       SUM(latest_result = 'PASSED') AS passed,
       SUM(latest_result = 'FAILED') AS failed,
       SUM(latest_result = 'NEEDS_FIX') AS needs_fix,
       SUM(latest_result = 'PENDING') AS pending
     FROM (
       SELECT vi.vehicle_id,
              vi.result AS latest_result
       FROM vehicle_inspections vi
       JOIN vehicles v ON v.id = vi.vehicle_id AND v.is_deleted = FALSE
       INNER JOIN (
         SELECT vehicle_id, MAX(inspection_date) AS max_date
         FROM vehicle_inspections
         GROUP BY vehicle_id
       ) latest ON vi.vehicle_id = latest.vehicle_id AND vi.inspection_date = latest.max_date
     ) sub`
  );

  // Insurance breakdown
  const [[ins]] = await pool.query(
    `SELECT
       SUM(CASE WHEN insurance_expiry IS NOT NULL AND insurance_expiry >= DATE_ADD(CURDATE(), INTERVAL 30 DAY) THEN 1 ELSE 0 END) AS insurance_ok,
       SUM(CASE WHEN insurance_expiry IS NOT NULL AND insurance_expiry BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 30 DAY) THEN 1 ELSE 0 END) AS expiring_insurance,
       SUM(CASE WHEN insurance_expiry IS NOT NULL AND insurance_expiry < CURDATE() THEN 1 ELSE 0 END) AS expired_insurance,
       SUM(CASE WHEN insurance_expiry IS NULL THEN 1 ELSE 0 END) AS no_insurance_data
     FROM vehicles WHERE is_deleted = FALSE`
  );

  // Phase 10.7A — combined document expiry aggregate across the 4 dated
  // fields added in migration 023 (insurance / registration / พ.ร.บ. / tax).
  // A vehicle counts ONCE even if multiple documents are due in the window.
  const [[docs]] = await pool.query(
    `SELECT
       SUM(CASE WHEN
            (insurance_expiry            BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 30 DAY))
         OR (registration_expiry         BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 30 DAY))
         OR (compulsory_insurance_expiry BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 30 DAY))
         OR (tax_expiry                  BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 30 DAY))
       THEN 1 ELSE 0 END) AS expiring_docs_count,
       SUM(CASE WHEN
            (insurance_expiry            < CURDATE())
         OR (registration_expiry         < CURDATE())
         OR (compulsory_insurance_expiry < CURDATE())
         OR (tax_expiry                  < CURDATE())
       THEN 1 ELSE 0 END) AS expired_docs_count
     FROM vehicles WHERE is_deleted = FALSE`
  );

  return {
    date: today,
    total_vehicles: total_vehicles || 0,
    inspected_count: inspected_count || 0,
    not_inspected: (total_vehicles || 0) - (inspected_count || 0),
    passed: Number(passed) || 0,
    failed: Number(failed) || 0,
    needs_fix: Number(needs_fix) || 0,
    pending: Number(pending) || 0,
    insurance_ok: Number(ins.insurance_ok) || 0,
    expiring_insurance: Number(ins.expiring_insurance) || 0,
    expired_insurance: Number(ins.expired_insurance) || 0,
    no_insurance_data: Number(ins.no_insurance_data) || 0,
    // Phase 10.7A — combined-document expiry aggregates (4-field union)
    expiring_docs_count: Number(docs.expiring_docs_count) || 0,
    expired_docs_count:  Number(docs.expired_docs_count)  || 0,
  };
}

async function getVehicles({ status, search, page = 1, per_page = 50 } = {}) {
  let where = 'v.is_deleted = FALSE';
  const params = [];

  // Plate search (partial match) — matches the raw plate and the stored
  // normalized_plate (whitespace/dash-agnostic) so "นข4031" finds "นข 4031".
  // Pushed before the COUNT + SELECT so pagination/total stay consistent.
  if (search && String(search).trim()) {
    const raw = String(search).trim();
    where += ' AND (v.plate_no LIKE ? OR v.normalized_plate LIKE ?)';
    params.push(`%${raw}%`, `%${normalizePlate(raw)}%`);
  }

  if (status === 'expiring') {
    // Legacy: insurance-only "expiring" — kept for backward compat with
    // existing TransportVehicleList "ประกันใกล้หมด" dropdown option.
    where += ' AND v.insurance_expiry BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 30 DAY)';
  } else if (status === 'expired') {
    where += ' AND v.insurance_expiry IS NOT NULL AND v.insurance_expiry < CURDATE()';
  } else if (status === 'docs_expiring') {
    // Phase 10.7A — combined 4-field document expiry filter
    where += ` AND (
      (v.insurance_expiry            BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 30 DAY))
      OR (v.registration_expiry         BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 30 DAY))
      OR (v.compulsory_insurance_expiry BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 30 DAY))
      OR (v.tax_expiry                  BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 30 DAY))
    )`;
  } else if (status === 'docs_expired') {
    where += ` AND (
      v.insurance_expiry            < CURDATE()
      OR v.registration_expiry         < CURDATE()
      OR v.compulsory_insurance_expiry < CURDATE()
      OR v.tax_expiry                  < CURDATE()
    )`;
  }

  const [[{ total }]] = await pool.query(
    `SELECT COUNT(*) AS total FROM vehicles v WHERE ${where}`, params
  );

  const offset = (page - 1) * per_page;
  const [vehicles] = await pool.query(
    `SELECT v.id, v.plate_no, v.vehicle_type,
            v.owner_name, v.owner_phone,
            v.insurance_status, v.insurance_type,
            v.insurance_expiry,
            v.registration_expiry,
            v.compulsory_insurance_expiry,
            v.tax_expiry,
            v.certified_capacity,
            v.verification_status,
            v.verification_reasons_json,
            v.verification_updated_at,
            v.created_at,
            (SELECT d.name FROM driver_vehicle_assignments dva
             JOIN drivers d ON d.id = dva.driver_id AND d.is_deleted = FALSE
             WHERE dva.vehicle_id = v.id AND dva.is_active = TRUE LIMIT 1) AS driver_name,
            (SELECT d.phone FROM driver_vehicle_assignments dva
             JOIN drivers d ON d.id = dva.driver_id AND d.is_deleted = FALSE
             WHERE dva.vehicle_id = v.id AND dva.is_active = TRUE LIMIT 1) AS driver_phone,
            -- Phase 10.6C — roster-size aggregate intentionally NOT selected
            -- here. Transport is a cross-cutting vehicle-safety role and
            -- MUST NOT see student roster size. If a future safety need
            -- requires an aggregate (e.g. "max bus capacity vs assigned"),
            -- expose it from school/affiliation services, not transport.
            (SELECT vi2.result FROM vehicle_inspections vi2
             WHERE vi2.vehicle_id = v.id
             ORDER BY vi2.inspection_date DESC LIMIT 1) AS latest_inspection_result,
            (SELECT vi2.inspection_date FROM vehicle_inspections vi2
             WHERE vi2.vehicle_id = v.id
             ORDER BY vi2.inspection_date DESC LIMIT 1) AS latest_inspection_date,
            (SELECT vi2.expiry_date FROM vehicle_inspections vi2
             WHERE vi2.vehicle_id = v.id
             ORDER BY vi2.inspection_date DESC LIMIT 1) AS inspection_expiry
     FROM vehicles v
     WHERE ${where}
     ORDER BY v.plate_no
     LIMIT ? OFFSET ?`,
    [...params, per_page, offset]
  );

  return { vehicles, meta: { page, per_page, total } };
}

// ─── Phase 10.x — per-vehicle LIST endpoints backing the dashboard counts ────
// Both functions take an injectable `db` (defaults to the module pool) so they
// can be unit-tested with a mock pool, matching the safetyPolicy.service style.
// They are PII-free: they return the same vehicle/inspection/document columns
// as getVehicles() and never touch the students table.
//
// The SELECT column list is shared with getVehicles() so the list rows match
// the main "/vehicles" list shape (driver_name/phone, latest inspection, docs).
const VEHICLE_LIST_COLUMNS = `v.id, v.plate_no, v.vehicle_type,
            v.owner_name, v.owner_phone,
            v.insurance_status, v.insurance_type,
            v.insurance_expiry,
            v.registration_expiry,
            v.compulsory_insurance_expiry,
            v.tax_expiry,
            v.certified_capacity,
            v.verification_status,
            v.verification_reasons_json,
            v.verification_updated_at,
            v.created_at,
            (SELECT d.name FROM driver_vehicle_assignments dva
             JOIN drivers d ON d.id = dva.driver_id AND d.is_deleted = FALSE
             WHERE dva.vehicle_id = v.id AND dva.is_active = TRUE LIMIT 1) AS driver_name,
            (SELECT d.phone FROM driver_vehicle_assignments dva
             JOIN drivers d ON d.id = dva.driver_id AND d.is_deleted = FALSE
             WHERE dva.vehicle_id = v.id AND dva.is_active = TRUE LIMIT 1) AS driver_phone,
            (SELECT vi2.result FROM vehicle_inspections vi2
             WHERE vi2.vehicle_id = v.id
             ORDER BY vi2.inspection_date DESC LIMIT 1) AS latest_inspection_result,
            (SELECT vi2.inspection_date FROM vehicle_inspections vi2
             WHERE vi2.vehicle_id = v.id
             ORDER BY vi2.inspection_date DESC LIMIT 1) AS latest_inspection_date,
            (SELECT vi2.expiry_date FROM vehicle_inspections vi2
             WHERE vi2.vehicle_id = v.id
             ORDER BY vi2.inspection_date DESC LIMIT 1) AS inspection_expiry`;

/**
 * Vehicles that the dashboard counts under `not_inspected`
 * (= total_vehicles − inspected_count, where inspected_count is the number of
 * non-deleted vehicles that have at least one row in vehicle_inspections).
 *
 * Default ("ยังไม่ตรวจ"): vehicles with NO inspection row at all — this exactly
 * reproduces the dashboard's `not_inspected` set.
 *
 * With `includePending = true`: ALSO include vehicles whose LATEST inspection
 * result is 'PENDING' (the dashboard's separate `pending` KPI — "รอตรวจ").
 * Kept opt-in so the default list total stays equal to `not_inspected`.
 */
async function getPendingVehicles({ page = 1, per_page = 50, includePending = false } = {}, db = pool) {
  // NOT EXISTS → "no inspection ever recorded" == the not_inspected definition.
  let cond = `NOT EXISTS (SELECT 1 FROM vehicle_inspections vi WHERE vi.vehicle_id = v.id)`;
  if (includePending) {
    // OR latest inspection result is PENDING (matches dashboard `pending`).
    cond = `(${cond} OR (
      SELECT vi3.result FROM vehicle_inspections vi3
      WHERE vi3.vehicle_id = v.id
      ORDER BY vi3.inspection_date DESC LIMIT 1
    ) = 'PENDING')`;
  }
  const where = `v.is_deleted = FALSE AND ${cond}`;

  const [[{ total }]] = await db.query(
    `SELECT COUNT(*) AS total FROM vehicles v WHERE ${where}`
  );

  const offset = (page - 1) * per_page;
  const [vehicles] = await db.query(
    `SELECT ${VEHICLE_LIST_COLUMNS}
     FROM vehicles v
     WHERE ${where}
     ORDER BY v.plate_no
     LIMIT ? OFFSET ?`,
    [per_page, offset]
  );

  return { vehicles, meta: { page, per_page, total } };
}

/**
 * Vehicles with a document expiring soon / already expired. The default
 * (`expired = false`) reproduces the dashboard's `expiring_docs_count`
 * definition EXACTLY: any of the 4 dated documents (insurance / registration /
 * พ.ร.บ. / tax) falling in [today, today+30d]. A vehicle appears once even if
 * several documents are due.
 *
 * With `expired = true`: reproduces `expired_docs_count` — any of the 4 dated
 * documents already past CURDATE().
 */
async function getExpiringVehicles({ page = 1, per_page = 50, expired = false } = {}, db = pool) {
  const docCond = expired
    ? `(
        v.insurance_expiry            < CURDATE()
        OR v.registration_expiry         < CURDATE()
        OR v.compulsory_insurance_expiry < CURDATE()
        OR v.tax_expiry                  < CURDATE()
      )`
    : `(
        (v.insurance_expiry            BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 30 DAY))
        OR (v.registration_expiry         BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 30 DAY))
        OR (v.compulsory_insurance_expiry BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 30 DAY))
        OR (v.tax_expiry                  BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 30 DAY))
      )`;
  const where = `v.is_deleted = FALSE AND ${docCond}`;

  const [[{ total }]] = await db.query(
    `SELECT COUNT(*) AS total FROM vehicles v WHERE ${where}`
  );

  const offset = (page - 1) * per_page;
  const [vehicles] = await db.query(
    `SELECT ${VEHICLE_LIST_COLUMNS}
     FROM vehicles v
     WHERE ${where}
     ORDER BY v.plate_no
     LIMIT ? OFFSET ?`,
    [per_page, offset]
  );

  return { vehicles, meta: { page, per_page, total } };
}

async function getInspections({ vehicle_id, result, page = 1, per_page = 20 } = {}) {
  let where = '1=1';
  const params = [];

  if (vehicle_id) { where += ' AND vi.vehicle_id = ?'; params.push(vehicle_id); }
  if (result) { where += ' AND vi.result = ?'; params.push(result); }

  const [[{ total }]] = await pool.query(
    `SELECT COUNT(*) AS total FROM vehicle_inspections vi WHERE ${where}`, params
  );

  const offset = (page - 1) * per_page;
  const [inspections] = await pool.query(
    `SELECT vi.id, vi.vehicle_id, v.plate_no, vi.inspection_date, vi.expiry_date,
            vi.result, vi.notes, vi.created_at,
            u.display_name AS inspector_name
     FROM vehicle_inspections vi
     JOIN vehicles v ON v.id = vi.vehicle_id
     LEFT JOIN users u ON u.id = vi.inspected_by
     WHERE ${where}
     ORDER BY vi.inspection_date DESC
     LIMIT ? OFFSET ?`,
    [...params, per_page, offset]
  );

  return { inspections, meta: { page, per_page, total } };
}

/**
 * Record a legacy inspection result. Atomic (CLAUDE.md rule 7): verifies the
 * vehicle exists (and is not soft-deleted) under a row lock, INSERTs the row,
 * writes the audit log, and recomputes `vehicles.verification_status` — all in
 * ONE transaction. Date fields are bounds-checked so a mistaken/abusive expiry
 * (e.g. year 2099) or a future inspection date cannot slip through.
 */
async function createInspection(
  { vehicleId, inspectionDate, expiryDate, result, notes, certifyingSchoolId, userId, ip = null, userAgent = null },
  db = pool,
) {
  const dateErr = validateInspectionDates({ result, inspectionDate, expiryDate });
  if (dateErr) throw svcError(dateErr.message, 400, dateErr.code);

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const [[vehicle]] = await conn.query(
      `SELECT id FROM vehicles WHERE id = ? AND is_deleted = FALSE FOR UPDATE`,
      [vehicleId],
    );
    if (!vehicle) throw svcError('ไม่พบรถที่ระบุ', 404, 'VEHICLE_NOT_FOUND');

    const [res] = await conn.query(
      `INSERT INTO vehicle_inspections
        (vehicle_id, inspected_by, inspection_date, expiry_date, result, notes, certifying_school_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [vehicleId, userId, inspectionDate, expiryDate || null, result, notes || null, certifyingSchoolId || null],
    );

    await logAudit({
      userId, action: 'CREATE', entityType: 'vehicle_inspection', entityId: String(res.insertId),
      newValue: {
        vehicle_id: vehicleId, inspection_date: inspectionDate, expiry_date: expiryDate || null,
        result, notes: notes || null, certifying_school_id: certifyingSchoolId || null,
      },
      ipAddress: ip, userAgent, conn,
    });

    // eslint-disable-next-line global-require -- lazy to avoid a require cycle with vehicleVerification.service
    const { refreshVehicleEligibility } = require('./vehicleVerification.service');
    await refreshVehicleEligibility(conn, vehicleId);

    await conn.commit();
    return res.insertId;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

/**
 * Update a legacy inspection. Atomic (rule 7) and authorization-checked: loads
 * the row under a lock, 404s if missing, and enforces inspector ownership
 * (admins may edit any). Date bounds are re-validated against the row's own
 * inspection date, the audit log and eligibility recompute run in the same
 * transaction. Fixes the previous silent no-op (`WHERE id=? AND inspected_by=?`
 * matched 0 rows yet returned 200 and wrote a misleading audit row).
 */
async function updateInspection(
  { inspectionId, expiryDate, result, notes, userId, isAdmin = false, ip = null, userAgent = null },
  db = pool,
) {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const [[row]] = await conn.query(
      `SELECT id, vehicle_id, inspected_by, result, notes,
              DATE_FORMAT(inspection_date, '%Y-%m-%d') AS inspection_date,
              DATE_FORMAT(expiry_date, '%Y-%m-%d')     AS expiry_date
         FROM vehicle_inspections WHERE id = ? FOR UPDATE`,
      [inspectionId],
    );
    if (!row) throw svcError('ไม่พบผลตรวจ', 404, 'INSPECTION_NOT_FOUND');
    if (!isAdmin && row.inspected_by !== userId) {
      throw svcError('แก้ไขได้เฉพาะผลตรวจที่คุณเป็นผู้บันทึก', 403, 'NOT_INSPECTION_OWNER');
    }

    const dateErr = validateInspectionDates({ result, inspectionDate: row.inspection_date, expiryDate });
    if (dateErr) throw svcError(dateErr.message, 400, dateErr.code);

    await conn.query(
      `UPDATE vehicle_inspections SET expiry_date = ?, result = ?, notes = ? WHERE id = ?`,
      [expiryDate || null, result, notes || null, inspectionId],
    );

    await logAudit({
      userId, action: 'UPDATE', entityType: 'vehicle_inspection', entityId: String(inspectionId),
      oldValue: { result: row.result, expiry_date: row.expiry_date, notes: row.notes },
      newValue: { result, expiry_date: expiryDate || null, notes: notes || null },
      ipAddress: ip, userAgent, conn,
    });

    // eslint-disable-next-line global-require -- lazy to avoid a require cycle
    const { refreshVehicleEligibility } = require('./vehicleVerification.service');
    await refreshVehicleEligibility(conn, row.vehicle_id);

    await conn.commit();
    return row;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

/**
 * Fetch a single vehicle by id for the transport `GET /vehicles/:id` detail
 * view. Uses the curated, PII-free VEHICLE_LIST_COLUMNS list (NOT `SELECT v.*`)
 * so internal/sensitive columns — `qr_token`, `qr_revoked_at` and the
 * plate-normalization columns — are never shipped to the transport client.
 */
async function getVehicleById(id, db = pool) {
  const [[row]] = await db.query(
    `SELECT ${VEHICLE_LIST_COLUMNS}
       FROM vehicles v
      WHERE v.id = ? AND v.is_deleted = FALSE`,
    [id],
  );
  return row || null;
}

/**
 * Delete a wrongly-recorded inspection (self-correction). vehicle_inspections
 * has no soft-delete column, so this is a hard delete — the removed row is
 * preserved in audit_logs by the caller. Only the inspector who recorded it
 * (or an admin) may delete. Recomputes the vehicle's eligibility afterwards
 * because refreshVehicleEligibility falls back to vehicle_inspections.
 * @returns the deleted row (for the caller's audit oldValue)
 */
async function deleteInspection({ inspectionId, userId, isAdmin = false }) {
  const [[row]] = await pool.query(
    `SELECT id, vehicle_id, inspected_by, result, expiry_date, inspection_date, notes
       FROM vehicle_inspections WHERE id = ?`,
    [inspectionId]
  );
  if (!row) { const e = new Error('ไม่พบผลตรวจ'); e.statusCode = 404; throw e; }
  if (!isAdmin && row.inspected_by !== userId) {
    const e = new Error('ลบได้เฉพาะผลตรวจที่คุณเป็นผู้บันทึก'); e.statusCode = 403; throw e;
  }
  await pool.query(`DELETE FROM vehicle_inspections WHERE id = ?`, [inspectionId]);
  try {
    const { refreshVehicleEligibility } = require('./vehicleVerification.service');
    await refreshVehicleEligibility(pool, row.vehicle_id);
  } catch (e) { /* non-fatal: eligibility recompute is best-effort */ }
  return row;
}

module.exports = {
  getDashboard,
  getVehicles,
  getPendingVehicles,
  getExpiringVehicles,
  getInspections,
  getVehicleById,
  createInspection,
  updateInspection,
  deleteInspection,
};
