'use strict';

const { pool } = require('../config/database');

/**
 * Transport role sees ALL vehicles + inspection data.
 * No school/affiliation scope — transport is cross-cutting.
 */

async function getDashboard() {
  const today = new Date().toISOString().slice(0, 10);

  const [[{ total_vehicles }]] = await pool.query(
    'SELECT COUNT(*) AS total_vehicles FROM vehicles WHERE is_deleted = FALSE'
  );

  const [[{ inspected_count }]] = await pool.query(
    'SELECT COUNT(DISTINCT vehicle_id) AS inspected_count FROM vehicle_inspections'
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
       INNER JOIN (
         SELECT vehicle_id, MAX(inspection_date) AS max_date
         FROM vehicle_inspections
         GROUP BY vehicle_id
       ) latest ON vi.vehicle_id = latest.vehicle_id AND vi.inspection_date = latest.max_date
     ) sub`
  );

  const [[{ expiring_insurance }]] = await pool.query(
    `SELECT COUNT(*) AS expiring_insurance FROM vehicles
     WHERE is_deleted = FALSE
       AND insurance_expiry IS NOT NULL
       AND insurance_expiry BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 30 DAY)`
  );

  const [[{ expired_insurance }]] = await pool.query(
    `SELECT COUNT(*) AS expired_insurance FROM vehicles
     WHERE is_deleted = FALSE
       AND insurance_expiry IS NOT NULL
       AND insurance_expiry < CURDATE()`
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
    expiring_insurance: expiring_insurance || 0,
    expired_insurance: expired_insurance || 0,
  };
}

async function getVehicles({ status, page = 1, per_page = 50 } = {}) {
  let where = 'v.is_deleted = FALSE';
  const params = [];

  if (status === 'expiring') {
    where += ' AND v.insurance_expiry BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 30 DAY)';
  } else if (status === 'expired') {
    where += ' AND v.insurance_expiry IS NOT NULL AND v.insurance_expiry < CURDATE()';
  }

  const [[{ total }]] = await pool.query(
    `SELECT COUNT(*) AS total FROM vehicles v WHERE ${where}`, params
  );

  const offset = (page - 1) * per_page;
  const [vehicles] = await pool.query(
    `SELECT v.id, v.plate_no, v.vehicle_type,
            v.owner_name, v.owner_phone,
            v.insurance_status, v.insurance_type, v.insurance_expiry,
            (SELECT d.name FROM driver_vehicle_assignments dva
             JOIN drivers d ON d.id = dva.driver_id AND d.is_deleted = FALSE
             WHERE dva.vehicle_id = v.id AND dva.is_active = TRUE LIMIT 1) AS driver_name,
            (SELECT d.phone FROM driver_vehicle_assignments dva
             JOIN drivers d ON d.id = dva.driver_id AND d.is_deleted = FALSE
             WHERE dva.vehicle_id = v.id AND dva.is_active = TRUE LIMIT 1) AS driver_phone,
            (SELECT COUNT(*) FROM students s
             WHERE s.vehicle_id = v.id AND s.is_deleted = FALSE) AS student_count,
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

async function createInspection({ vehicleId, inspectionDate, expiryDate, result, notes, userId }) {
  const [res] = await pool.query(
    `INSERT INTO vehicle_inspections (vehicle_id, inspected_by, inspection_date, expiry_date, result, notes)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [vehicleId, userId, inspectionDate, expiryDate || null, result, notes || null]
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
