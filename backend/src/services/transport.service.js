'use strict';

const { pool } = require('../config/database');
const { normalizePlate } = require('../utils/vehiclePlate');
const { logAudit } = require('../utils/audit');
const { validateInspectionDates } = require('../utils/inspectionDates');
const { todayBangkok } = require('../utils/thaiTime');
const {
  VEHICLE_DATE_FIELDS, INSPECTION_DATE_FIELDS, withCalendarDates,
} = require('../utils/vehicleDates');

// Thrown validation/authorization error carrying an HTTP status + machine code,
// surfaced by the global errorHandler in the standard response shape.
function svcError(message, statusCode = 400, code = null) {
  const err = new Error(message);
  err.statusCode = statusCode;
  if (code) err.errors = [{ code }];
  return err;
}

// The certification calculation uses a finalized shared attempt before a
// legacy row. Keep transport lists and dashboard on that same source. A newer
// legacy row must never make a finalized shared result appear to change.
function checkedInspectionColumn(column) {
  const allowed = ['result', 'inspection_date', 'expiry_date'];
  if (!allowed.includes(column)) throw new Error('Invalid inspection column');
}
const HAS_SHARED_INSPECTION = `EXISTS (
    SELECT 1 FROM inspection_attempts ia
      JOIN vehicle_inspection_applications a ON a.id = ia.application_id
     WHERE a.vehicle_id = v.id AND ia.result <> 'IN_PROGRESS'
       AND ia.finalized_at IS NOT NULL
  )`;
function sharedInspectionColumn(column) {
  checkedInspectionColumn(column);
  return `(SELECT ia.${column} FROM inspection_attempts ia
       JOIN vehicle_inspection_applications a ON a.id = ia.application_id
      WHERE a.vehicle_id = v.id AND ia.result <> 'IN_PROGRESS'
        AND ia.finalized_at IS NOT NULL
      ORDER BY ia.inspection_date DESC, ia.finalized_at DESC, ia.id DESC LIMIT 1)`;
}
function legacyInspectionColumn(column) {
  checkedInspectionColumn(column);
  return `(SELECT vi.${column} FROM vehicle_inspections vi
      WHERE vi.vehicle_id = v.id
      ORDER BY vi.inspection_date DESC, vi.id DESC LIMIT 1)`;
}
function latestInspectionColumn(column) {
  return `CASE WHEN ${HAS_SHARED_INSPECTION} THEN ${sharedInspectionColumn(column)}
    ELSE ${legacyInspectionColumn(column)} END`;
}
function inspectionConflictSql() {
  return `(${HAS_SHARED_INSPECTION} AND NOT (
    ${sharedInspectionColumn('result')} <=> ${legacyInspectionColumn('result')}
    AND ${sharedInspectionColumn('inspection_date')} <=> ${legacyInspectionColumn('inspection_date')}
    AND ${sharedInspectionColumn('expiry_date')} <=> ${legacyInspectionColumn('expiry_date')}
  ))`;
}

async function assertLegacyWritable(conn, vehicleId) {
  const [[finalized]] = await conn.query(
    `SELECT ia.id FROM inspection_attempts ia
       JOIN vehicle_inspection_applications a ON a.id = ia.application_id
      WHERE a.vehicle_id = ? AND ia.result <> 'IN_PROGRESS'
        AND ia.finalized_at IS NOT NULL
      LIMIT 1 FOR UPDATE`,
    [vehicleId],
  );
  if (finalized) {
    throw svcError('รถคันนี้มีผลรับรองจากคิวแล้ว กรุณาส่งคำขอตรวจรอบใหม่แทนการแก้บันทึกเดิม', 409, 'SHARED_INSPECTION_IMMUTABLE');
  }
}

/**
 * Ordinary transport lists contain vehicle + inspection data, no pupil PII.
 * The separately audited incident read is in transportIncident.service.js.
 * No school/affiliation scope — transport is cross-cutting safety, not a
 * roster view. Per Phase 10.6C PDPA cleanup: no roster-size aggregate, no
 * student names/IDs, no parent info — only vehicle, driver, inspection, insurance
 * fields. The dashboard KPIs filter `vehicles.is_deleted = FALSE` so soft-
 * deleted rows never inflate the inspection-coverage counts.
 */

async function getDashboard() {
  const today = todayBangkok();

  const [[{ total_vehicles }]] = await pool.query(
    'SELECT COUNT(*) AS total_vehicles FROM vehicles WHERE is_deleted = FALSE'
  );

  // Phase 10.6C — join vehicles and filter is_deleted so the inspection
  // coverage count doesn't include soft-deleted rows. Without this, a
  // retired bus that was last inspected last year would still bump
  // `inspected_count` above `total_vehicles`, breaking the dashboard math.
  const [[{ inspected_count, passed, failed, needs_fix, pending }]] = await pool.query(
    `SELECT
       SUM(latest_result IS NOT NULL) AS inspected_count,
       SUM(latest_result = 'PASSED') AS passed,
       SUM(latest_result = 'FAILED') AS failed,
       SUM(latest_result = 'NEEDS_FIX') AS needs_fix,
       SUM(latest_result = 'PENDING') AS pending
     FROM (
       SELECT v.id, ${latestInspectionColumn('result')} AS latest_result
         FROM vehicles v WHERE v.is_deleted = FALSE
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

  // Conservative live-date check prevents a cached ELIGIBLE state from
  // labelling an expired certificate/document as ready on the dashboard.
  const [[{ ready_count }]] = await pool.query(
    `SELECT COUNT(*) AS ready_count FROM vehicles v
      WHERE v.is_deleted = FALSE AND v.verification_status = 'ELIGIBLE'
        AND NOT ${inspectionConflictSql()}
        AND ${latestInspectionColumn('result')} = 'PASSED'
        AND ${latestInspectionColumn('expiry_date')} >= CURDATE()
        AND v.insurance_expiry >= CURDATE()
        AND v.registration_expiry >= CURDATE()
        AND v.compulsory_insurance_expiry >= CURDATE()
        AND v.tax_expiry >= CURDATE()
        AND NOT EXISTS (SELECT 1 FROM inspection_attempts ia
          JOIN vehicle_inspection_applications a ON a.id = ia.application_id
          WHERE a.vehicle_id = v.id AND ia.result = 'IN_PROGRESS')`
  );
  const [[{ inspection_conflict_count }]] = await pool.query(
    `SELECT COUNT(*) AS inspection_conflict_count FROM vehicles v
      WHERE v.is_deleted = FALSE AND ${inspectionConflictSql()}`
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
    ready_count: Number(ready_count) || 0,
    inspection_conflict_count: Number(inspection_conflict_count) || 0,
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
            ${HAS_SHARED_INSPECTION} AS has_shared_inspection,
            ${inspectionConflictSql()} AS inspection_conflict,
            EXISTS (SELECT 1 FROM inspection_attempts ia
              JOIN vehicle_inspection_applications a ON a.id = ia.application_id
              WHERE a.vehicle_id = v.id AND ia.result = 'IN_PROGRESS') AS has_open_inspection,
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
            ${latestInspectionColumn('result')} AS latest_inspection_result,
            ${latestInspectionColumn('inspection_date')} AS latest_inspection_date,
            ${latestInspectionColumn('expiry_date')} AS inspection_expiry
     FROM vehicles v
     WHERE ${where}
     ORDER BY v.plate_no
     LIMIT ? OFFSET ?`,
    [...params, per_page, offset]
  );

  return {
    vehicles: vehicles.map((v) => withCalendarDates(v, VEHICLE_DATE_FIELDS)),
    meta: { page, per_page, total },
  };
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
            ${HAS_SHARED_INSPECTION} AS has_shared_inspection,
            ${inspectionConflictSql()} AS inspection_conflict,
            EXISTS (SELECT 1 FROM inspection_attempts ia
              JOIN vehicle_inspection_applications a ON a.id = ia.application_id
              WHERE a.vehicle_id = v.id AND ia.result = 'IN_PROGRESS') AS has_open_inspection,
            v.created_at,
            (SELECT d.name FROM driver_vehicle_assignments dva
             JOIN drivers d ON d.id = dva.driver_id AND d.is_deleted = FALSE
             WHERE dva.vehicle_id = v.id AND dva.is_active = TRUE LIMIT 1) AS driver_name,
            (SELECT d.phone FROM driver_vehicle_assignments dva
             JOIN drivers d ON d.id = dva.driver_id AND d.is_deleted = FALSE
             WHERE dva.vehicle_id = v.id AND dva.is_active = TRUE LIMIT 1) AS driver_phone,
            ${latestInspectionColumn('result')} AS latest_inspection_result,
            ${latestInspectionColumn('inspection_date')} AS latest_inspection_date,
            ${latestInspectionColumn('expiry_date')} AS inspection_expiry`;

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
  // NULL canonical result means neither a finalized shared attempt nor a legacy inspection exists.
  let cond = `${latestInspectionColumn('result')} IS NULL`;
  if (includePending) {
    // OR latest inspection result is PENDING (matches dashboard `pending`).
    cond = `(${cond} OR ${latestInspectionColumn('result')} = 'PENDING')`;
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

  return {
    vehicles: vehicles.map((v) => withCalendarDates(v, VEHICLE_DATE_FIELDS)),
    meta: { page, per_page, total },
  };
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

  return {
    vehicles: vehicles.map((v) => withCalendarDates(v, VEHICLE_DATE_FIELDS)),
    meta: { page, per_page, total },
  };
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
    `SELECT vi.id, vi.vehicle_id, vi.inspected_by, v.plate_no, vi.inspection_date, vi.expiry_date,
            vi.result, vi.notes, vi.created_at,
            EXISTS (SELECT 1 FROM inspection_attempts ia
              JOIN vehicle_inspection_applications a ON a.id = ia.application_id
              WHERE a.vehicle_id = vi.vehicle_id AND ia.result <> 'IN_PROGRESS'
                AND ia.finalized_at IS NOT NULL) AS locked_by_shared,
            u.display_name AS inspector_name
     FROM vehicle_inspections vi
     JOIN vehicles v ON v.id = vi.vehicle_id
     LEFT JOIN users u ON u.id = vi.inspected_by
     WHERE ${where}
     ORDER BY vi.inspection_date DESC
     LIMIT ? OFFSET ?`,
    [...params, per_page, offset]
  );

  return {
    inspections: inspections.map((i) => withCalendarDates(i, INSPECTION_DATE_FIELDS)),
    meta: { page, per_page, total },
  };
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
    await assertLegacyWritable(conn, vehicleId);

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
      required: true,
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
    await assertLegacyWritable(conn, row.vehicle_id);

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
      required: true,
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
  return row ? withCalendarDates(row, VEHICLE_DATE_FIELDS) : null;
}

// Dedicated export projection. Deliberately excludes names, phones, notes,
// riders, students, document files and any unrestricted report-service fields.
async function getSafetyExportRows(db = pool) {
  const [rows] = await db.query(
    `SELECT v.plate_no, v.vehicle_type,
            v.insurance_expiry, v.registration_expiry,
            v.compulsory_insurance_expiry, v.tax_expiry,
            ${latestInspectionColumn('result')} AS latest_inspection_result,
            ${latestInspectionColumn('inspection_date')} AS latest_inspection_date,
            ${latestInspectionColumn('expiry_date')} AS inspection_expiry
       FROM vehicles v WHERE v.is_deleted = FALSE
      ORDER BY v.plate_no LIMIT 10001`
  );
  if (rows.length > 10000) {
    throw svcError('จำนวนรถเกินขอบเขตรายงาน กรุณาติดต่อผู้ดูแล', 413, 'EXPORT_ROW_LIMIT');
  }
  return rows.map(row => withCalendarDates(row, [
    'insurance_expiry', 'registration_expiry', 'compulsory_insurance_expiry',
    'tax_expiry', 'latest_inspection_date', 'inspection_expiry',
  ]));
}

/**
 * Delete a wrongly-recorded inspection (self-correction). vehicle_inspections
 * has no soft-delete column, so this is a hard delete — the removed row is
 * preserved in audit_logs by the caller. Only the inspector who recorded it
 * (or an admin) may delete. Recomputes the vehicle's eligibility afterwards
 * because refreshVehicleEligibility falls back to vehicle_inspections.
 * @returns the deleted row (for the caller's audit oldValue)
 */
async function deleteInspection(
  { inspectionId, userId, isAdmin = false, ip = null, userAgent = null }, db = pool,
) {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const [[row]] = await conn.query(
      `SELECT id, vehicle_id, inspected_by, result, expiry_date, inspection_date, notes
         FROM vehicle_inspections WHERE id = ? FOR UPDATE`,
      [inspectionId],
    );
    if (!row) throw svcError('ไม่พบผลตรวจ', 404, 'INSPECTION_NOT_FOUND');
    if (!isAdmin && String(row.inspected_by) !== String(userId)) {
      throw svcError('ลบได้เฉพาะผลตรวจที่คุณเป็นผู้บันทึก', 403, 'NOT_INSPECTION_OWNER');
    }
    await assertLegacyWritable(conn, row.vehicle_id);
    const audited = withCalendarDates(row, INSPECTION_DATE_FIELDS);
    await conn.query('DELETE FROM vehicle_inspections WHERE id = ?', [inspectionId]);
    const { refreshVehicleEligibility } = require('./vehicleVerification.service');
    await refreshVehicleEligibility(conn, row.vehicle_id);
    await logAudit({
      userId, action: 'DELETE', entityType: 'vehicle_inspection', entityId: String(inspectionId),
      oldValue: {
        vehicle_id: row.vehicle_id, result: row.result, expiry_date: audited.expiry_date,
        inspection_date: audited.inspection_date, notes: row.notes,
      },
      ipAddress: ip, userAgent, conn, required: true,
    });
    await conn.commit();
    return audited;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

module.exports = {
  getDashboard,
  getVehicles,
  getPendingVehicles,
  getExpiringVehicles,
  getInspections,
  getVehicleById,
  getSafetyExportRows,
  createInspection,
  updateInspection,
  deleteInspection,
};
