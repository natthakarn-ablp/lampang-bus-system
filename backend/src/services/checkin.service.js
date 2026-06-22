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
const { logAudit } = require('../utils/audit');
const { normalizePlate } = require('../utils/vehiclePlate');

// ─── helpers ─────────────────────────────────────────────────────────────────

function makeError(message, statusCode = 400, code = null) {
  const err = new Error(message);
  err.statusCode = statusCode;
  if (code) err.errors = [{ code }];
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
 * Resolution order (Phase 10.13A-20):
 *   1. If the user is LINKED (users.driver_id set), resolve via the relational
 *      model: driver_vehicle_assignments.driver_id → vehicles (active). Exactly
 *      one active vehicle → return it; multiple → fail closed; zero → fall back.
 *   2. LEGACY fallback (also for unlinked YELLOW users with driver_id NULL):
 *      match the login username to vehicles.plate_no / normalized_plate
 *      (Phase 10.13A-8). normalized_plate is UNIQUE among active vehicles, so at
 *      most one matches — we never guess.
 *
 * Accepts either a user object { username, driver_id } or a bare username string
 * (legacy callers / tests → driver_id treated as NULL → legacy path).
 *
 * @param {import('mysql2/promise').Pool} pool
 * @param {{username:string, driver_id?:number}|string} userOrUsername
 * @returns {{ vehicle_id, plate_no }}
 * @throws 400 if no vehicle / no active assignment / ambiguous match
 */
async function getDriverVehicle(pool, userOrUsername) {
  const isObj = userOrUsername != null && typeof userOrUsername === 'object';
  const username = isObj ? (userOrUsername.username || '') : String(userOrUsername || '');
  const driverId = isObj ? (userOrUsername.driver_id ?? userOrUsername.driverId ?? null) : null;

  // 1) Linked drivers resolve via the relational model (authoritative — works
  //    even if the login username no longer matches the plate text).
  if (driverId != null) {
    const [linked] = await pool.query(
      `SELECT v.id AS vehicle_id, v.plate_no
       FROM   driver_vehicle_assignments dva
       JOIN   vehicles v ON v.id = dva.vehicle_id AND v.is_deleted = FALSE
       WHERE  dva.driver_id = ? AND dva.is_active = TRUE
       GROUP  BY v.id, v.plate_no
       LIMIT  2`,
      [driverId]
    );
    if (linked.length === 1) {
      return { vehicle_id: linked[0].vehicle_id, plate_no: linked[0].plate_no };
    }
    if (linked.length > 1) {
      // Never guess which vehicle — surface the misconfiguration.
      throw makeError(
        'Multiple active vehicles assigned to this driver — please contact admin',
        400, 'MULTIPLE_ACTIVE_DRIVER_ASSIGNMENTS'
      );
    }
    // zero active assigned vehicles → fall through to legacy plate resolution
  }

  // 2) Legacy plate / normalized-plate resolution.
  const normalized = normalizePlate(username);
  const [vehicles] = await pool.query(
    `SELECT id AS vehicle_id, plate_no
     FROM   vehicles
     WHERE  is_deleted = FALSE
       AND  (plate_no = ? OR normalized_plate = ?)
     LIMIT  2`,
    [username, normalized]
  );

  if (!vehicles.length) {
    throw makeError('Vehicle not found for this driver account', 400);
  }
  if (vehicles.length > 1) {
    // Defensive: unreachable while normalized_plate is unique among active
    // vehicles. Never pick one arbitrarily — surface the misconfiguration.
    throw makeError('Multiple vehicles match this driver account — please contact admin', 400);
  }

  const { vehicle_id, plate_no } = vehicles[0];

  // Confirm at least one active assignment exists for this vehicle (validates
  // the vehicle is still in-service this term).
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
            sc.name AS school_name,
            s.dropoff_address,
            s.morning_enabled,
            s.evening_enabled,
            COALESCE(ds.morning_done, FALSE) AS morning_done,
            ds.morning_ts,
            COALESCE(ds.evening_done, FALSE) AS evening_done,
            ds.evening_ts,
            (SELECT CASE
               WHEN COUNT(*) = 0 THEN NULL
               WHEN MAX(sl2.session = 'both') = 1 THEN 'both'
               WHEN COUNT(DISTINCT sl2.session) > 1 THEN 'both'
               ELSE MAX(sl2.session)
             END
             FROM student_leaves sl2
             WHERE sl2.student_id = s.id AND sl2.leave_date = CURDATE() AND sl2.cancelled = FALSE
            ) AS leave_session,
            (SELECT sl3.id FROM student_leaves sl3
             WHERE sl3.student_id = s.id AND sl3.leave_date = CURDATE() AND sl3.cancelled = FALSE
             ORDER BY sl3.id DESC LIMIT 1
            ) AS leave_id,
            COALESCE(ov.morning_override_by_school, 0) AS morning_override_by_school,
            COALESCE(ov.evening_override_by_school, 0) AS evening_override_by_school,
            ov.morning_override_at,
            ov.evening_override_at
     FROM   students s
     LEFT JOIN schools sc ON sc.id = s.school_id
     LEFT JOIN daily_status ds
               ON ds.student_id = s.id
               AND ds.check_date = CURDATE()
     LEFT JOIN (
       SELECT CAST(entity_id AS UNSIGNED) AS student_id,
              MAX(CASE WHEN JSON_UNQUOTE(JSON_EXTRACT(new_value, '$.session')) = 'morning'
                       THEN 1 ELSE 0 END) AS morning_override_by_school,
              MAX(CASE WHEN JSON_UNQUOTE(JSON_EXTRACT(new_value, '$.session')) = 'evening'
                       THEN 1 ELSE 0 END) AS evening_override_by_school,
              MAX(CASE WHEN JSON_UNQUOTE(JSON_EXTRACT(new_value, '$.session')) = 'morning'
                       THEN created_at END) AS morning_override_at,
              MAX(CASE WHEN JSON_UNQUOTE(JSON_EXTRACT(new_value, '$.session')) = 'evening'
                       THEN created_at END) AS evening_override_at
       FROM   audit_logs
       WHERE  entity_type = 'checkin_override'
         AND  DATE(created_at) = CURDATE()
       GROUP BY entity_id
     ) ov ON ov.student_id = s.id
     WHERE  s.vehicle_id = ?
       AND  s.is_deleted = FALSE
       ${sessionFilter}
     ORDER BY s.first_name, s.last_name`,
    [vehicleId]
  );

  // Phase 10.8F-B — cast TINYINT to boolean for the driver-side passive badge.
  // Reason/actor metadata stays in audit_logs and is intentionally NOT exposed
  // to the driver response (PDPA).
  return rows.map(r => ({
    ...r,
    morning_override_by_school: !!r.morning_override_by_school,
    evening_override_by_school: !!r.evening_override_by_school,
  }));
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

  // 1b. Idempotency guard (audit 2026-06-18, business-logic-txn). Reject an exact
  // duplicate of the same session+status for today so a double-tap or network
  // retry can't create duplicate checkin_logs AND duplicate parent notifications.
  // A different status (board CHECKED_IN → dropoff CHECKED_OUT) is still allowed.
  const [dupLog] = await conn.query(
    `SELECT id FROM checkin_logs
     WHERE student_id = ? AND session = ? AND status = ? AND check_date = CURDATE()
     LIMIT 1`,
    [student.id, session, status]
  );
  if (dupLog.length) {
    throw makeError('รายการนี้ถูกบันทึกไปแล้ว', 409);
  }

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
  //
  // Phase 10.9B — phone-based LINE recipient resolver (Round 2).
  // Old resolver (Round 0) joined line_users.parent_id which only matched
  // ONE parents row per LINE user — broken for multi-child families because
  // each child has its own parents row sharing the same phone (per-student
  // parents rows since refactor baf2cea). The new resolver follows the
  // phone path established by Round 1: parents.phone → line_bindings.phone
  // → line_users.line_user_id. line_users is still in the JOIN so we (a)
  // satisfy the notifications.target_line_user_id FK (FK→line_users), and
  // (b) filter to verified accounts only.
  const notifType = status === 'CHECKED_IN' ? 'checkin' : 'checkout';
  const [linkedParents] = await conn.query(
    `SELECT DISTINCT lu.line_user_id
     FROM   parent_student ps
     JOIN   parents p
            ON p.id = ps.parent_id
            AND p.is_deleted = FALSE
            AND p.phone IS NOT NULL
            AND TRIM(p.phone) <> ''
     JOIN   line_bindings lb
            ON lb.phone = p.phone
            AND lb.is_active = TRUE
     JOIN   line_users lu
            ON lu.line_user_id = lb.line_user_id
            AND lu.user_type = 'parent'
            AND lu.verified = TRUE
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

  const leaveExclude = session === 'morning'
    ? "AND NOT EXISTS (SELECT 1 FROM student_leaves sl WHERE sl.student_id = s.id AND sl.leave_date = CURDATE() AND sl.cancelled = FALSE AND (sl.session = 'morning' OR sl.session = 'both'))"
    : "AND NOT EXISTS (SELECT 1 FROM student_leaves sl WHERE sl.student_id = s.id AND sl.leave_date = CURDATE() AND sl.cancelled = FALSE AND (sl.session = 'evening' OR sl.session = 'both'))";

  const [students] = await pool.query(
    `SELECT s.id
     FROM   students s
     LEFT JOIN daily_status ds
               ON ds.student_id = s.id AND ds.check_date = CURDATE()
     WHERE  s.vehicle_id  = ?
       AND  s.is_deleted  = FALSE
       AND  (${doneColumn} IS NULL OR ${doneColumn} = FALSE)
       ${sessionFilter}
       ${leaveExclude}`,
    [vehicleId]
  );

  const succeeded = [];
  const failed    = [];

  // Audit 2026-06-18 (limitations-scalability): use ONE pooled connection for the
  // whole batch instead of getConnection()/commit() per student, which thrashed
  // the 10-slot pool when many buses ran "check-in all" at 07:00. Each student is
  // isolated with a SAVEPOINT so one failure doesn't abort the rest (preserving
  // the partial-success contract). studentId is an integer, safe to interpolate
  // into the savepoint name.
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    for (const { id: studentId } of students) {
      const sp = `ca_${studentId}`;
      try {
        await conn.query(`SAVEPOINT ${sp}`);
        const result = await _buildCheckinTransaction(conn, {
          userId, vehicleId, plateNo, studentId, session,
          status: 'CHECKED_IN', termId, source,
        });
        await conn.query(`RELEASE SAVEPOINT ${sp}`);
        succeeded.push(result);
      } catch (err) {
        try { await conn.query(`ROLLBACK TO SAVEPOINT ${sp}`); } catch { /* savepoint gone */ }
        failed.push({ student_id: studentId, error: err.message });
      }
    }
    await conn.commit();
  } catch (err) {
    try { await conn.rollback(); } catch { /* swallow */ }
    throw err;
  } finally {
    conn.release();
  }

  return { succeeded, failed };
}

// ─── processCheckoutAll ───────────────────────────────────────────────────────

/**
 * Batch-checkout (drop-off) all students who BOARDED this session but have not
 * yet been dropped. One-tap "ส่งครบทุกคน" at the end of a route so checkout is
 * actually recorded (real data showed checkout was scanned only ~11% of the time,
 * making a "left-behind" signal impossible). Eligibility is computed from
 * checkin_logs directly (CHECKED_IN without a matching CHECKED_OUT) — NOT from
 * daily_status.*_done, which is already TRUE after the morning board. A student
 * who never boarded is never dropped, so this cannot fabricate a checkout.
 * Returns { succeeded: [], failed: [] }.
 */
async function processCheckoutAll(pool, { userId, vehicleId, plateNo, session, source = 'web' }) {
  assertSession(session);
  const termId = env.app.currentTerm;

  const [students] = await pool.query(
    `SELECT DISTINCT ci.student_id AS id
       FROM checkin_logs ci
      WHERE ci.vehicle_id = ? AND ci.session = ? AND ci.check_date = CURDATE()
        AND ci.status = 'CHECKED_IN'
        AND NOT EXISTS (
          SELECT 1 FROM checkin_logs co
           WHERE co.student_id = ci.student_id AND co.session = ci.session
             AND co.check_date = CURDATE() AND co.status = 'CHECKED_OUT')`,
    [vehicleId, session]
  );

  const succeeded = [];
  const failed = [];
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    for (const { id: studentId } of students) {
      const sp = `co_${studentId}`;
      try {
        await conn.query(`SAVEPOINT ${sp}`);
        const result = await _buildCheckinTransaction(conn, {
          userId, vehicleId, plateNo, studentId, session,
          status: 'CHECKED_OUT', termId, source,
        });
        await conn.query(`RELEASE SAVEPOINT ${sp}`);
        succeeded.push(result);
      } catch (err) {
        try { await conn.query(`ROLLBACK TO SAVEPOINT ${sp}`); } catch { /* savepoint gone */ }
        failed.push({ student_id: studentId, error: err.message });
      }
    }
    await conn.commit();
  } catch (err) {
    try { await conn.rollback(); } catch { /* swallow */ }
    throw err;
  } finally {
    conn.release();
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
       SUM(
         s.morning_enabled = TRUE
         AND COALESCE(ds.morning_done, 0) = 0
         AND NOT EXISTS (
           SELECT 1 FROM student_leaves sl
           WHERE sl.student_id = s.id AND sl.leave_date = CURDATE() AND sl.cancelled = FALSE
             AND (sl.session = 'morning' OR sl.session = 'both')
         )
       ) AS morning_pending,
       SUM(
         s.evening_enabled = TRUE
         AND COALESCE(ds.evening_done, 0) = 0
         AND NOT EXISTS (
           SELECT 1 FROM student_leaves sl
           WHERE sl.student_id = s.id AND sl.leave_date = CURDATE() AND sl.cancelled = FALSE
             AND (sl.session = 'evening' OR sl.session = 'both')
         )
       ) AS evening_pending
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

// ─── processSchoolOverride ────────────────────────────────────────────────────

/**
 * Phase 10.8B — school confirms attendance on behalf of the driver.
 *
 * Reuses `_buildCheckinTransaction` to write checkin_logs + daily_status +
 * notifications + audit-CREATE-checkin exactly like the driver path, then
 * appends one extra audit row (entity_type='checkin_override') carrying the
 * actor / reason / prior daily_status snapshot. checkin_logs.source stays
 * 'web' — override semantics live in the audit row.
 *
 * Caller (route handler) maps thrown errors to HTTP status via err.statusCode.
 */
async function processSchoolOverride(pool, {
  userId,
  userRole,
  userDisplayName,
  ipAddress,
  userAgent,
  schoolId,
  studentId,
  session,
  status = 'CHECKED_IN',
  reason,
}) {
  assertSession(session);
  if (!['CHECKED_IN', 'CHECKED_OUT'].includes(status)) {
    throw makeError("status must be 'CHECKED_IN' or 'CHECKED_OUT'", 400);
  }
  const trimmedReason = typeof reason === 'string' ? reason.trim() : '';
  if (!trimmedReason) {
    throw makeError('กรุณาระบุเหตุผลการยืนยันแทน', 400);
  }
  if (trimmedReason.length > 500) {
    throw makeError('เหตุผลต้องไม่เกิน 500 ตัวอักษร', 400);
  }
  if (!schoolId) {
    throw makeError('ไม่พบข้อมูลโรงเรียน', 400);
  }

  // 1. Load student + vehicle plate (joined)
  const [[student]] = await pool.query(
    `SELECT s.id, s.school_id, s.vehicle_id, s.prefix, s.first_name, s.last_name,
            s.cid_hash, s.morning_enabled, s.evening_enabled, s.is_deleted,
            v.plate_no
     FROM   students s
     LEFT JOIN vehicles v ON v.id = s.vehicle_id
     WHERE  s.id = ?
     LIMIT  1`,
    [studentId]
  );
  if (!student || student.is_deleted || String(student.school_id) !== String(schoolId)) {
    throw makeError('ไม่พบนักเรียนในโรงเรียนนี้', 404);
  }
  if (session === 'morning' && !student.morning_enabled) {
    throw makeError('นักเรียนไม่ได้ใช้บริการรอบนี้', 400);
  }
  if (session === 'evening' && !student.evening_enabled) {
    throw makeError('นักเรียนไม่ได้ใช้บริการรอบนี้', 400);
  }
  if (!student.vehicle_id) {
    throw makeError('นักเรียนยังไม่ได้กำหนดรถรับ-ส่ง', 400);
  }

  // 2. Active non-cancelled leave for today + session
  const [[leaveHit]] = await pool.query(
    `SELECT id FROM student_leaves
     WHERE  student_id = ?
       AND  leave_date = CURDATE()
       AND  cancelled  = FALSE
       AND  (session = ? OR session = 'both')
     LIMIT 1`,
    [studentId, session]
  );
  if (leaveHit) {
    throw makeError('นักเรียนลาในรอบนี้ ไม่สามารถยืนยันแทนได้', 409);
  }

  // 3. Snapshot daily_status; reject if already done
  const [[prior]] = await pool.query(
    `SELECT morning_done, morning_ts, evening_done, evening_ts
     FROM   daily_status
     WHERE  check_date = CURDATE() AND student_id = ?
     LIMIT 1`,
    [studentId]
  );
  const priorDailyStatus = prior
    ? {
        morning_done: !!prior.morning_done,
        morning_ts:   prior.morning_ts ? new Date(prior.morning_ts).toISOString() : null,
        evening_done: !!prior.evening_done,
        evening_ts:   prior.evening_ts ? new Date(prior.evening_ts).toISOString() : null,
      }
    : { morning_done: false, morning_ts: null, evening_done: false, evening_ts: null };

  const sessionDoneKey = session === 'morning' ? 'morning_done' : 'evening_done';
  if (priorDailyStatus[sessionDoneKey]) {
    throw makeError('รอบนี้ได้รับการยืนยันแล้ว', 409);
  }

  // 4. Reuse driver transaction worker
  const conn = await pool.getConnection();
  await conn.beginTransaction();
  try {
    const result = await _buildCheckinTransaction(conn, {
      userId,
      vehicleId: student.vehicle_id,
      plateNo:   student.plate_no || null,
      studentId: student.id,
      session,
      status,
      termId:    env.app.currentTerm,
      source:    'web',
    });

    const studentName = `${student.first_name} ${student.last_name}`;
    const confirmedAt = new Date().toISOString();

    await logAudit({
      conn,
      userId,
      action:     'UPDATE',
      entityType: 'checkin_override',
      entityId:   String(student.id),
      oldValue:   priorDailyStatus,
      newValue: {
        school_id:                   schoolId,
        student_id:                  student.id,
        student_name:                studentName,
        vehicle_id:                  student.vehicle_id,
        plate_no:                    student.plate_no || null,
        session,
        status,
        reason:                      trimmedReason,
        confirmed_by_user_id:        userId,
        confirmed_by_role:           userRole || null,
        confirmed_by_display_name:   userDisplayName || null,
        override_checkin_log_id:     result.log_id,
        timestamp_utc:               confirmedAt,
      },
      ipAddress: ipAddress || null,
      userAgent: userAgent || null,
    });

    await conn.commit();
    return {
      checkin_log_id: result.log_id,
      student_id:     student.id,
      session,
      status,
      confirmed_at:   confirmedAt,
      confirmed_by:   userDisplayName || null,
      override:       true,
    };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

// ─── getNoShowStudents (roadmap A — no-show; checkout-independent) ─────────────
// Students who SHOULD have boarded (assigned to a bus + session-enabled) but have
// NO CHECKED_IN for the day/session, excluding those on leave. Built on CHECKED_IN
// (reliably recorded ~90%+) so it is trustworthy even though checkout is not.
async function getNoShowStudents(pool, { schoolId, session, date = null }) {
  assertSession(session);
  const enabledCol = session === 'morning' ? 's.morning_enabled' : 's.evening_enabled';
  const [rows] = await pool.query(
    `SELECT s.id, s.prefix, s.first_name, s.last_name, s.grade, s.classroom, s.vehicle_id, v.plate_no
       FROM students s
       LEFT JOIN vehicles v ON v.id = s.vehicle_id AND v.is_deleted = FALSE
      WHERE s.school_id = ? AND s.is_deleted = FALSE
        AND ${enabledCol} = TRUE
        AND s.vehicle_id IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM checkin_logs ci
                         WHERE ci.student_id = s.id AND ci.session = ?
                           AND ci.check_date = COALESCE(?, CURDATE()) AND ci.status = 'CHECKED_IN')
        AND NOT EXISTS (SELECT 1 FROM student_leaves sl
                         WHERE sl.student_id = s.id AND sl.leave_date = COALESCE(?, CURDATE())
                           AND sl.cancelled = FALSE AND (sl.session = ? OR sl.session = 'both'))
      ORDER BY s.grade, s.classroom, s.first_name`,
    [schoolId, session, date, date, session]
  );
  return rows;
}

module.exports = {
  getDriverVehicle,
  getRoster,
  processCheckin,
  processCheckout,
  processCheckinAll,
  processCheckoutAll,
  getStatusToday,
  getNoShowStudents,
  processSchoolOverride,
};
