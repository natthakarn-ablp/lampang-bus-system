'use strict';

const { pool } = require('../config/database');

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

async function getVehicles({ status, page = 1, per_page = 50 } = {}) {
  let where = 'v.is_deleted = FALSE';
  const params = [];

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

async function createInspection({ vehicleId, inspectionDate, expiryDate, result, notes, certifyingSchoolId, userId }) {
  const [res] = await pool.query(
    `INSERT INTO vehicle_inspections (vehicle_id, inspected_by, inspection_date, expiry_date, result, notes, certifying_school_id)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [vehicleId, userId, inspectionDate, expiryDate || null, result, notes || null, certifyingSchoolId || null]
  );
  return res.insertId;
}

async function updateInspection({ inspectionId, expiryDate, result, notes, userId }) {
  await pool.query(
    `UPDATE vehicle_inspections SET expiry_date = ?, result = ?, notes = ? WHERE id = ? AND inspected_by = ?`,
    [expiryDate || null, result, notes || null, inspectionId, userId]
  );
}

module.exports = {
  getDashboard,
  getVehicles,
  getInspections,
  createInspection,
  updateInspection,
};
