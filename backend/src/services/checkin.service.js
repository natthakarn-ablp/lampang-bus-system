'use strict';

/**
 * checkin.service.js
 *
 * Core business logic for the driver check-in / check-out flow.
 * Every write operation that touches more than one table uses a
 * MySQL transaction so the result is always consistent.
 *
 * Exported functions:
 *  getDriverVehicle(pool, username)
 *  getRoster(pool, vehicleId, session)
 *  processCheckin(pool, params)   ← CHECKED_IN
 *  processCheckout(pool, params)  ← CHECKED_OUT
 *  processCheckinAll(pool, params)
 *  getStatusToday(pool, vehicleId)
 */

const env = require('../config/env');

// ─── helpers ─────────────────────────────────────────────────────────────────

function makeError(message, statusCode = 400) {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
}

/**
 * Validate that session is 'morning' or 'evening'.
 */
function assertSession(session) {
  if (!['morning', 'evening'].includes(session)) {
    throw makeError("session must be 'morning' or 'evening'", 400);
  }
}

// ─── getDriverVehicle ─────────────────────────────────────────────────────────

/**
 * Resolve the active vehicle for a driver user.
 *
 * Resolution strategy (does NOT require users.driver_id):
 *   1. Look up vehicles.plate_no = username  (drivers login with their plate number)
 *   2. Confirm at least one active driver_vehicle_assignments row exists for
 *      this vehicle in the current term
 *   3. Return a single vehicle row — DISTINCT guards against multiple
 *      active assignment rows for the same vehicle
 *
 * @param {import('mysql2/promise').Pool} pool
 * @param {string} username  - req.user.username (equals vehicles.plate_no for drivers)
 * @returns {{ vehicle_id, plate_no }}
 * @throws 400 if vehicle not found or no active assignment exists
 */
async function getDriverVehicle(pool, username) {
  // Step 1: find the vehicle whose plate_no matches the driver's login username
  const [vehicles] = await pool.query(
    `SELECT id AS vehicle_id, plate_no
     FROM   vehicles
     WHERE  plate_no  = ?
       AND  is_deleted = FALSE
     LIMIT  1`,
    [username]
  );

  if (!vehicles.length) {
    throw makeError('Vehicle not found for this driver account', 400);
  }

  const { vehicle_id, plate_no } = vehicles[0];

  // Step 2: confirm at least one active assignment exists for this vehicle
  //         (validates the vehicle is still in-service this term)
  const [assignments] = await pool.query(
    `SELECT 1
     FROM   driver_vehicle_assignments
     WHERE  vehicle_id = ?
       AND  is_active  = TRUE
     LIMIT  1`,
    [vehicle_id]
  );

  if (!assignments.length) {
    throw makeError('No active driver assignment found for vehicle ' + plate_no, 400);
  }

  return { vehicle_id, plate_no };
}

// ─── getRoster ───────────────────────────────────────────────────────────────

/**
 * Return students for a vehicle with today's daily_status joined.
 *
 * @param {import('mysql2/promise').Pool} pool
 * @param {string} vehicleId
 * @param {string|undefined} session - 'morning' | 'evening' | undefined (all)
 * @returns {Array}
 */
async function getRoster(pool, vehicleId, session) {
  let sessionFilter = '';
  if (session === 'morning') sessionFilter = 'AND s.morning_enabled = TRUE';
  if (session === 'evening') sessionFilter = 'AND s.evening_enabled = TRUE';

  const [rows] = await pool.query(
    `SELECT s.id,
            s.prefix,
            s.first_name,
            s.last_name,
            s.grade,
            s.classroom,
            s.school_id,
            s.dropoff_address,
            s.morning_enabled,
            s.evening_enabled,
            COALESCE(ds.morning_done, FALSE) AS morning_done,
            ds.morning_ts,
            COALESCE(ds.evening_done, FALSE) AS evening_done,
            ds.evening_ts
     FROM   students s
     LEFT JOIN daily_status ds
               ON ds.student_id = s.id
               AND ds.check_date = CURDATE()
     WHERE  s.vehicle_id = ?
       AND  s.is_deleted = FALSE
       ${sessionFilter}
     ORDER BY s.first_name, s.last_name`,
    [vehicleId]
  );

  return rows;
}

// ─── _buildCheckinTransaction ─────────────────────────────────────────────────

/**
 * Inner function executed inside a transaction connection.
 * Handles: checkin_logs insert + daily_status upsert + notifications + audit.
 */
async function _buildCheckinTransaction(conn, {
  userId,
  vehicleId,
  plateNo,
  studentId,
  session,
  status,           // 'CHECKED_IN' | 'CHECKED_OUT'
  termId,
  source,
}) {
  // 1. Verify student belongs to this vehicle
  const [students] = await conn.query(
    `SELECT id, cid_hash, first_name, last_name
     FROM   students
     WHERE  id = ? AND vehicle_id = ? AND is_deleted = FALSE
     LIMIT  1`,
    [studentId, vehicleId]
  );
  if (!students.length) {
    throw makeError('Student not found in this vehicle', 404);
  }
  const student = students[0];
  const studentName = `${student.first_name} ${student.last_name}`;

  // 2. Insert checkin_log
  const [logResult] = await conn.query(
    `INSERT INTO checkin_logs
       (term_id, vehicle_id, plate_no, student_id, cid_hash,
        student_name, session, status, check_date, checked_by, source)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURDATE(), ?, ?)`,
    [termId, vehicleId, plateNo, student.id, student.cid_hash,
     studentName, session, status, userId, source]
  );

  // 3. Upsert daily_status
  //    morning session (CHECKED_IN = board, CHECKED_OUT = school dropoff) → morning_done
  //    evening session (CHECKED_IN = board, CHECKED_OUT = home dropoff)   → evening_done
  if (session === 'morning') {
    await conn.query(
      `INSERT INTO daily_status
         (check_date, vehicle_id, student_id, cid_hash, student_name, morning_done, morning_ts)
       VALUES (CURDATE(), ?, ?, ?, ?, TRUE, NOW())
       ON DUPLICATE KEY UPDATE morning_done = TRUE, morning_ts = NOW()`,
      [vehicleId, student.id, student.cid_hash, studentName]
    );
  } else {
    await conn.query(
      `INSERT INTO daily_status
         (check_date, vehicle_id, student_id, cid_hash, student_name, evening_done, evening_ts)
       VALUES (CURDATE(), ?, ?, ?, ?, TRUE, NOW())
       ON DUPLICATE KEY UPDATE evening_done = TRUE, evening_ts = NOW()`,
      [vehicleId, student.id, student.cid_hash, studentName]
    );
  }

  // 4. Insert notification records for linked + approved parents
  const notifType = status === 'CHECKED_IN' ? 'checkin' : 'checkout';
  const [linkedParents] = await conn.query(
    `SELECT lu.line_user_id
     FROM   parent_student ps
     JOIN   parents p ON p.id = ps.parent_id AND p.is_deleted = FALSE
     JOIN   line_users lu
              ON lu.parent_id  = p.id
              AND lu.user_type = 'parent'
              AND lu.verified  = TRUE
     WHERE  ps.student_id = ?
       AND  ps.approved   = TRUE`,
    [student.id]
  );

  for (const { line_user_id } of linkedParents) {
    await conn.query(
      `INSERT INTO notifications
         (target_line_user_id, notification_type, student_id, message_json, sent)
       VALUES (?, ?, ?, ?, FALSE)`,
      [
        line_user_id,
        notifType,
        student.id,
        JSON.stringify({
          studentName,
          status,
          session,
          plateNo,
          checkedAt: new Date().toISOString(),
        }),
      ]
    );
  }

  // 5. Audit log
  await conn.query(
    `INSERT INTO audit_logs
       (user_id, action, entity_type, entity_id, new_value)
     VALUES (?, 'CREATE', 'checkin', ?, ?)`,
    [
      userId,
      String(logResult.insertId),
      JSON.stringify({ studentId: student.id, studentName, session, status, vehicleId }),
    ]
  );

  return {
    log_id:       logResult.insertId,
    student_id:   student.id,
    student_name: studentName,
    session,
    status,
    checked_at:   new Date().toISOString(),
  };
}

// ─── processCheckin ───────────────────────────────────────────────────────────

/**
 * Checkin a single student (status = CHECKED_IN).
 * Fully atomic — uses a MySQL transaction.
 */
async function processCheckin(pool, { userId, vehicleId, plateNo, studentId, session, source = 'web' }) {
  assertSession(session);
  const termId = env.app.currentTerm;

  const conn = await pool.getConnection();
  await conn.beginTransaction();
  try {
    const result = await _buildCheckinTransaction(conn, {
      userId, vehicleId, plateNo, studentId, session,
      status: 'CHECKED_IN', termId, source,
    });
    await conn.commit();
    return result;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

// ─── processCheckout ──────────────────────────────────────────────────────────

/**
 * Checkout a single student (status = CHECKED_OUT).
 * Fully atomic — uses a MySQL transaction.
 */
async function processCheckout(pool, { userId, vehicleId, plateNo, studentId, session, source = 'web' }) {
  assertSession(session);
  const termId = env.app.currentTerm;

  const conn = await pool.getConnection();
  await conn.beginTransaction();
  try {
    const result = await _buildCheckinTransaction(conn, {
      userId, vehicleId, plateNo, studentId, session,
      status: 'CHECKED_OUT', termId, source,
    });
    await conn.commit();
    return result;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

// ─── processCheckinAll ────────────────────────────────────────────────────────

/**
 * Batch-checkin all students in the vehicle for a session.
 * Each student is wrapped in the same transaction.
 * Returns { success: [], failed: [] }.
 */
async function processCheckinAll(pool, { userId, vehicleId, plateNo, session, source = 'web' }) {
  assertSession(session);
  const termId = env.app.currentTerm;

  // Fetch all eligible students (not yet checked in for this session today)
  const sessionFilter = session === 'morning'
    ? 'AND s.morning_enabled = TRUE'
    : 'AND s.evening_enabled = TRUE';

  const doneColumn = session === 'morning' ? 'ds.morning_done' : 'ds.evening_done';

  const [students] = await pool.query(
    `SELECT s.id
     FROM   students s
     LEFT JOIN daily_status ds
               ON ds.student_id = s.id AND ds.check_date = CURDATE()
     WHERE  s.vehicle_id  = ?
       AND  s.is_deleted  = FALSE
       AND  (${doneColumn} IS NULL OR ${doneColumn} = FALSE)
       ${sessionFilter}`,
    [vehicleId]
  );

  const succeeded = [];
  const failed    = [];

  for (const { id: studentId } of students) {
    const conn = await pool.getConnection();
    await conn.beginTransaction();
    try {
      const result = await _buildCheckinTransaction(conn, {
        userId, vehicleId, plateNo, studentId, session,
        status: 'CHECKED_IN', termId, source,
      });
      await conn.commit();
      succeeded.push(result);
    } catch (err) {
      await conn.rollback();
      failed.push({ student_id: studentId, error: err.message });
    } finally {
      conn.release();
    }
  }

  return { succeeded, failed };
}

// ─── getStatusToday ───────────────────────────────────────────────────────────

/**
 * Summary of today's check-in status for a vehicle.
 *
 * Also returns `current_session` resolved server-side using Bangkok time and
 * the configured DRIVER_SESSION_SWITCH_HOUR — this is the source of truth
 * that the frontend should use instead of relying solely on browser clock.
 */
async function getStatusToday(pool, vehicleId) {
  const [[summary]] = await pool.query(
    `SELECT
       COUNT(*)                                                         AS total,
       SUM(COALESCE(ds.morning_done, 0))                               AS morning_done,
       SUM(COALESCE(ds.evening_done, 0))                               AS evening_done,
       SUM(s.morning_enabled = TRUE AND COALESCE(ds.morning_done,0)=0) AS morning_pending,
       SUM(s.evening_enabled = TRUE AND COALESCE(ds.evening_done,0)=0) AS evening_pending
     FROM   students s
     LEFT JOIN daily_status ds
               ON ds.student_id = s.id AND ds.check_date = CURDATE()
     WHERE  s.vehicle_id = ?
       AND  s.is_deleted = FALSE`,
    [vehicleId]
  );

  // Recent activity log (last 20 entries today)
  const [recent] = await pool.query(
    `SELECT cl.id, cl.student_name, cl.session, cl.status, cl.checked_at
     FROM   checkin_logs cl
     WHERE  cl.vehicle_id  = ?
       AND  cl.check_date  = CURDATE()
     ORDER BY cl.checked_at DESC
     LIMIT 20`,
    [vehicleId]
  );

  // Resolve current session server-side in Bangkok time (source of truth for frontend).
  // Uses DRIVER_SESSION_SWITCH_HOUR from env (default 12).
  const switchHour = env.app.driverSessionSwitchHour;
  const nowBangkok = new Date(
    new Date().toLocaleString('en-US', { timeZone: 'Asia/Bangkok' })
  );
  const current_session = nowBangkok.getHours() < switchHour ? 'morning' : 'evening';

  return { summary, recent, current_session, switch_hour: switchHour };
}

module.exports = {
  getDriverVehicle,
  getRoster,
  processCheckin,
  processCheckout,
  processCheckinAll,
  getStatusToday,
};
