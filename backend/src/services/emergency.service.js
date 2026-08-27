'use strict';

/**
 * emergency.service.js — driver emergency creation with double-tap / idempotency
 * protection (#6).
 *
 * The emergency button is the most likely thing a panicking driver mashes, and
 * a flaky mobile connection retries the same POST. Previously each POST did an
 * unconditional INSERT, so a double-tap produced two emergency_logs rows, two
 * LINE Flex cards to the school group, and two audit rows. This service makes
 * creation idempotent within a short window: a second identical report from the
 * same driver (same vehicle + same detail) inside `dedupeWindowSeconds` returns
 * the FIRST report instead of inserting a new one, and the route uses the
 * returned `isDuplicate` flag to skip the duplicate push + audit.
 *
 * Injected-pool style (`db = pool`) so it is unit-testable with a fake pool,
 * exactly like transport.service.js.
 */

const { pool } = require('../config/database');

// A repeat within this many seconds is treated as the SAME emergency.
const DEFAULT_DEDUPE_WINDOW_SECONDS = 60;

/**
 * Insert an emergency report, unless an identical one from the same reporter
 * exists within the dedupe window — in which case return the existing row.
 *
 * @returns {Promise<{id:number, vehicleId:string|null, plateNo:string|null, isDuplicate:boolean}>}
 */
async function createEmergencyReport({
  reportedBy,
  vehicleId = null,
  plateNo = null,
  detail,
  note = null,
  latitude = null,
  longitude = null,
  accuracyM = null,
  dedupeWindowSeconds = DEFAULT_DEDUPE_WINDOW_SECONDS,
}, db = pool) {
  if (reportedBy == null) throw Object.assign(new Error('reportedBy is required'), { statusCode: 400 });
  if (!detail) throw Object.assign(new Error('detail is required'), { statusCode: 400, errors: [{ code: 'DETAIL_REQUIRED' }] });

  // Idempotency / double-tap guard. Match the same reporter + detail + vehicle
  // (NULL-safe) within the window; ignore soft-deleted rows.
  const vehicleClause = vehicleId == null ? 'vehicle_id IS NULL' : 'vehicle_id = ?';
  const dupParams = vehicleId == null
    ? [reportedBy, detail, dedupeWindowSeconds]
    : [reportedBy, detail, vehicleId, dedupeWindowSeconds];
  const [[dup]] = await db.query(
    `SELECT id, vehicle_id, plate_no
       FROM emergency_logs
      WHERE reported_by = ?
        AND detail = ?
        AND is_deleted = FALSE
        AND ${vehicleClause}
        AND reported_at >= DATE_SUB(NOW(), INTERVAL ? SECOND)
      ORDER BY id DESC
      LIMIT 1`,
    dupParams
  );
  if (dup) {
    return { id: dup.id, vehicleId: dup.vehicle_id, plateNo: dup.plate_no, isDuplicate: true };
  }

  const [result] = await db.query(
    `INSERT INTO emergency_logs
       (reported_by, channel, vehicle_id, plate_no, detail, note,
        latitude, longitude, location_accuracy_m)
     VALUES (?, 'web', ?, ?, ?, ?, ?, ?, ?)`,
    [reportedBy, vehicleId, plateNo, detail, note, latitude, longitude, accuracyM]
  );
  return { id: result.insertId, vehicleId, plateNo, isDuplicate: false };
}

module.exports = { createEmergencyReport, DEFAULT_DEDUPE_WINDOW_SECONDS };
