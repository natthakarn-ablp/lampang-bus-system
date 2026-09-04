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
 *  resolveVehicleForEmergency(pool, user)  ← shift-independent (emergency path)
 *  getRoster(pool, vehicleId, session)
 *  processCheckin(pool, params)   ← CHECKED_IN
 *  processCheckout(pool, params)  ← CHECKED_OUT
 *  processCheckinAll(pool, params)
 *  getStatusToday(pool, vehicleId)
 */

const env = require('../config/env');
const { getCurrentTerm } = require('./term.service');
const { logAudit } = require('../utils/audit');
const { normalizePlate } = require('../utils/vehiclePlate');
const { gradeEquivalents } = require('../utils/gradeScope');

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

  // Optional rollout gate for the multi-vehicle driver pool. Once enabled,
  // every operational endpoint that resolves a vehicle uses the driver's
  // explicitly opened shift, so check-in/location/emergency writes are always
  // attributed to the actual vehicle and driver for that round.
  if (env.features.driverShiftSelection) {
    if (driverId == null) {
      throw makeError('Driver profile is not linked to this account', 409, 'DRIVER_PROFILE_NOT_LINKED');
    }
    const [activeShifts] = await pool.query(
      `SELECT vos.id AS shift_id, v.id AS vehicle_id, v.plate_no
         FROM vehicle_operating_shifts vos
         JOIN vehicles v ON v.id = vos.vehicle_id AND v.is_deleted = FALSE
        WHERE vos.driver_id = ? AND vos.status = 'OPEN' AND vos.ended_at IS NULL
        LIMIT 2`,
      [driverId]
    );
    if (activeShifts.length === 1) {
      return {
        vehicle_id: activeShifts[0].vehicle_id,
        plate_no: activeShifts[0].plate_no,
        driver_id: Number(driverId),
        shift_id: activeShifts[0].shift_id ?? null,
      };
    }
    if (activeShifts.length > 1) {
      throw makeError('Multiple open shifts found for this driver', 409, 'MULTIPLE_OPEN_SHIFTS');
    }
    throw makeError('กรุณาเลือกรถและเริ่มรอบก่อนปฏิบัติงาน', 409, 'ACTIVE_SHIFT_REQUIRED');
  }

  // Shift feature OFF — resolve via relational link / legacy plate.
  return resolveVehicleShiftIndependent(pool, { username, driverId });
}

// ─── resolveVehicleShiftIndependent ───────────────────────────────────────────

/**
 * Resolve a driver's vehicle WITHOUT requiring an open operating shift.
 *
 * This is exactly the resolution getDriverVehicle uses when the shift feature is
 * OFF: prefer the relational path (driver_id → single active assignment → linked
 * vehicle), else the legacy plate / normalized-plate path. Extracted so the
 * emergency path (FIX 1) can reuse it even while FEATURE_DRIVER_SHIFT_SELECTION
 * is ON — an emergency must never be gated on having opened a shift.
 *
 * @param {import('mysql2/promise').Pool} pool
 * @param {{username:string, driverId:number|null}} ident
 * @returns {{ vehicle_id, plate_no, driver_id, shift_id }}
 * @throws 400 if no vehicle / no active assignment / ambiguous match
 */
async function resolveVehicleShiftIndependent(pool, { username = '', driverId = null } = {}) {
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
      return { vehicle_id: linked[0].vehicle_id, plate_no: linked[0].plate_no, driver_id: Number(driverId), shift_id: null };
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
    `SELECT driver_id
     FROM   driver_vehicle_assignments
     WHERE  vehicle_id = ?
       AND  is_active  = TRUE
     LIMIT  2`,
    [vehicle_id]
  );

  if (!assignments.length) {
    throw makeError('No active driver assignment found for vehicle ' + plate_no, 400);
  }

  const assignmentDriverId = assignments.length === 1 && assignments[0].driver_id != null
    ? Number(assignments[0].driver_id)
    : null;

  return {
    vehicle_id,
    plate_no,
    driver_id: Number.isFinite(assignmentDriverId) ? assignmentDriverId : null,
    shift_id: null,
  };
}

// ─── resolveVehicleForEmergency ───────────────────────────────────────────────

/**
 * Resolve a driver's vehicle for the EMERGENCY path (FIX 1, HIGH).
 *
 * Emergency reporting must NEVER be gated on having opened a shift. This resolver
 * ignores FEATURE_DRIVER_SHIFT_SELECTION entirely and always uses the
 * shift-independent resolution (relational link first, then legacy plate) — i.e.
 * the same logic getDriverVehicle uses when the shift feature is OFF. This lets
 * an emergency be filed even when the driver has no open shift (which otherwise
 * makes getDriverVehicle throw ACTIVE_SHIFT_REQUIRED / MULTIPLE_OPEN_SHIFTS).
 *
 * @param {import('mysql2/promise').Pool} pool
 * @param {{username:string, driver_id?:number}|string} userOrUsername
 * @returns {{ vehicle_id, plate_no, driver_id, shift_id }}
 */
async function resolveVehicleForEmergency(pool, userOrUsername) {
  const isObj = userOrUsername != null && typeof userOrUsername === 'object';
  const username = isObj ? (userOrUsername.username || '') : String(userOrUsername || '');
  const driverId = isObj ? (userOrUsername.driver_id ?? userOrUsername.driverId ?? null) : null;
  return resolveVehicleShiftIndependent(pool, { username, driverId });
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

// ─── beginCheckinTransaction ─────────────────────────────────────────────────

/**
 * Open a check-in transaction at READ COMMITTED.
 *
 * CS5-04. The duplicate guard in _buildCheckinTransaction needs two things: a
 * per-student mutex (the students row, locked FOR UPDATE) and a read of
 * checkin_logs that is no older than that mutex. Under the server default
 * REPEATABLE READ the second is only obtainable with a locking read, and a
 * locking read that matches no row takes a gap lock — which is what turned one
 * busload of simultaneous check-ins into deadlock 500s and lost boardings.
 *
 * READ COMMITTED gives the freshness without the gap locks: no gap locking, and
 * every statement gets its own read view, so a waiter sees the winner's row and
 * a long batch transaction no longer answers this check from a snapshot taken at
 * its first student. Bare SET TRANSACTION (no SESSION/GLOBAL) applies to the
 * NEXT transaction only, so the pooled connection reverts to the server default
 * as soon as this transaction ends and no other code path changes behaviour.
 *
 * The cost is real and deliberate: inside these transactions a repeated read can
 * now see another transaction's commit. Nothing on this path re-reads a row it
 * has already read, and every write is keyed by the student row it holds locked,
 * so the non-repeatable read is unobservable today — but any statement added
 * here later must not assume a stable snapshot.
 */
async function beginCheckinTransaction(conn) {
  await conn.query('SET TRANSACTION ISOLATION LEVEL READ COMMITTED');
  await conn.beginTransaction();
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
  // CS5-04 — FOR UPDATE makes this row the per-student mutex for the whole
  // check-in transaction. Without it the guard below is a bare read-then-write:
  // three simultaneous taps all read "no log yet" and all insert, producing
  // three checkin_logs rows and three parent notifications for one boarding.
  const [students] = await conn.query(
    `SELECT id, cid_hash, first_name, last_name
     FROM   students
     WHERE  id = ? AND vehicle_id = ? AND is_deleted = FALSE
     LIMIT  1
     FOR    UPDATE`,
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
  // CS5-04 — this read must stay a PLAIN read. Under REPEATABLE READ a
  // SELECT ... FOR UPDATE that matches nothing takes a gap lock, and when a whole
  // bus checks in at once every student's gap lock lands in the same empty range
  // of idx_cl_date_student; the INSERT below then wants an insert-intention lock
  // inside a gap another transaction is already holding. Measured against the
  // test database: 33 of 40 concurrent taps across 20 students died with
  // ER_LOCK_DEADLOCK — HTTP 500 to the driver — and 14 of the 20 children ended
  // the run with no boarding row at all. A duplicate is visible and correctable;
  // a lost boarding is silent, so that trade was the wrong way round.
  // The lock this guard actually needs is the students row above. What the
  // locking read was additionally buying — a CURRENT read, so a caller that
  // waited on the student row sees the winner's committed row instead of a stale
  // snapshot — is supplied instead by running the transaction at READ COMMITTED
  // (see beginCheckinTransaction), where every statement reads fresh. That also
  // fixes the batch paths, whose snapshot was taken at their FIRST student.
  const [dupLog] = await conn.query(
    `SELECT id, status FROM checkin_logs
     WHERE student_id = ? AND session = ? AND check_date = CURDATE()
     ORDER BY id DESC
     LIMIT 1`,
    [student.id, session]
  );
  if (dupLog.length) {
    const lastStatus = dupLog[0].status;
    if (lastStatus === status) {
      // Exact duplicate — same status as the most recent log for today.
      throw makeError('รายการนี้ถูกบันทึกไปแล้ว', 409);
    }
    // Phase 11A audit fix H2: reject invalid state transitions.
    // CHECKED_OUT → CHECKED_IN is not allowed (student already dropped off).
    // CHECKED_IN → CHECKED_IN is caught above. Only CHECKED_IN → CHECKED_OUT
    // is a valid forward transition.
    if (lastStatus === 'CHECKED_OUT' && status === 'CHECKED_IN') {
      throw makeError('นักเรียนถูกส่งแล้วในรอบนี้ — ไม่สามารถเช็กอินซ้ำได้', 409);
    }
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
  const termId = await getCurrentTerm(pool);

  const conn = await pool.getConnection();
  await beginCheckinTransaction(conn);
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
  const termId = await getCurrentTerm(pool);

  const conn = await pool.getConnection();
  await beginCheckinTransaction(conn);
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
  const termId = await getCurrentTerm(pool);

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
    await beginCheckinTransaction(conn);
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
 * daily_status.*_done, which is already TRUE after the morning board; the
 * daily_status flag is consulted only to drop a board that was VOIDED (CS5-01).
 * A student who never boarded is never dropped, so this cannot fabricate a
 * checkout.
 * Returns { succeeded: [], failed: [] }.
 */
async function processCheckoutAll(pool, { userId, vehicleId, plateNo, session, source = 'web' }) {
  assertSession(session);
  const termId = await getCurrentTerm(pool);

  // CS5-01 — a board that was voided must never be droppable. voidCheckin keeps
  // the original CHECKED_IN row (history is append-only) and records the reversal
  // as a CANCELLED row plus a reset of daily_status.<session>_done. Reading
  // checkin_logs alone therefore still saw a child whose boarding was cancelled as
  // "on the bus", and wrote a CHECKED_OUT row plus a checkout notification to the
  // parent of a child who never rode. Honour the state the void writer resets —
  // the same state the sibling path processCheckinAll reads. Only a session we
  // positively know was reset is excluded, so a day with no daily_status row
  // behaves exactly as before.
  const doneColumn = session === 'morning' ? 'ds.morning_done' : 'ds.evening_done';

  const [students] = await pool.query(
    `SELECT DISTINCT ci.student_id AS id
       FROM checkin_logs ci
      WHERE ci.vehicle_id = ? AND ci.session = ? AND ci.check_date = CURDATE()
        AND ci.status = 'CHECKED_IN'
        AND NOT EXISTS (
          SELECT 1 FROM checkin_logs co
           WHERE co.student_id = ci.student_id AND co.session = ci.session
             AND co.check_date = CURDATE() AND co.status = 'CHECKED_OUT')
        AND NOT EXISTS (
          SELECT 1 FROM daily_status ds
           WHERE ds.student_id = ci.student_id AND ds.check_date = ci.check_date
             AND ${doneColumn} = FALSE)`,
    [vehicleId, session]
  );

  const succeeded = [];
  const failed = [];
  const conn = await pool.getConnection();
  try {
    await beginCheckinTransaction(conn);
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
  await beginCheckinTransaction(conn);
  try {
    const result = await _buildCheckinTransaction(conn, {
      userId,
      vehicleId: student.vehicle_id,
      plateNo:   student.plate_no || null,
      studentId: student.id,
      session,
      status,
      termId:    await getCurrentTerm(pool),
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

// ─── processSchoolOverrideAll ─────────────────────────────────────────────────

/**
 * School confirms a whole session on behalf of the driver, marking only the
 * exceptions.
 *
 * The single-student override (processSchoolOverride) required the school to
 * pick pupils one at a time, which does not match how the day actually works:
 * the driver ran the route and almost everyone boarded. The school knows the
 * short list of who did not. So the selection is inverted — the caller sends
 * `absentStudentIds`, and every other eligible pupil is confirmed present.
 *
 * Eligibility mirrors processCheckinAll (the driver's own bulk path) so the two
 * cannot disagree about who counts:
 *   - assigned to a vehicle
 *   - session enabled for that pupil
 *   - not already done for the session today
 *   - no active leave record for today + session
 * A pupil on recorded leave is therefore never confirmed present even if the
 * caller forgets to tick them — the leave record wins, matching the 409 the
 * single-student path raises.
 *
 * Transaction shape follows processCheckinAll: one pooled connection for the
 * whole batch (a per-pupil getConnection() thrashed the 10-slot pool at 07:00),
 * with a SAVEPOINT per pupil so one failure does not discard the rest.
 *
 * Each confirmed pupil gets the same checkin_override audit row the
 * single-student path writes, plus one batch-level row recording the whole
 * decision — including who was left out and why the school says so.
 */
async function processSchoolOverrideAll(pool, {
  userId,
  userRole,
  userDisplayName,
  ipAddress,
  userAgent,
  schoolId,
  session,
  status = 'CHECKED_IN',
  reason,
  absentStudentIds = [],
  gradeFilter = null,
}) {
  assertSession(session);
  if (!['CHECKED_IN', 'CHECKED_OUT'].includes(status)) {
    throw makeError("status must be 'CHECKED_IN' or 'CHECKED_OUT'", 400);
  }
  const trimmedReason = typeof reason === 'string' ? reason.trim() : '';
  if (!trimmedReason) throw makeError('กรุณาระบุเหตุผลการยืนยันแทน', 400);
  if (trimmedReason.length > 500) throw makeError('เหตุผลต้องไม่เกิน 500 ตัวอักษร', 400);
  if (!schoolId) throw makeError('ไม่พบข้อมูลโรงเรียน', 400);

  // Absent ids arrive from a form; keep only positive integers so a malformed
  // entry cannot silently widen the set that gets confirmed present.
  const absentSet = new Set(
    (Array.isArray(absentStudentIds) ? absentStudentIds : [])
      .map(n => Number.parseInt(n, 10))
      .filter(n => Number.isInteger(n) && n > 0)
  );

  const sessionFilter = session === 'morning'
    ? 'AND s.morning_enabled = TRUE'
    : 'AND s.evening_enabled = TRUE';
  const doneColumn = session === 'morning' ? 'ds.morning_done' : 'ds.evening_done';
  // Tolerant grade match, not `= ?`. The route in front of this currently blocks
  // grade teachers outright, so gradeFilter is null today — but an exact match is
  // the bug gradeScopeCounts.test.js was written for (variant spellings like
  // 'ประถมศึกษาปีที่ 4' silently match nothing), and leaving it here would hand
  // that bug to whoever wires the parameter up later.
  const eqGrades = gradeFilter ? gradeEquivalents(gradeFilter) : null;
  const gradeAnd = eqGrades ? ` AND s.grade IN (${eqGrades.map(() => '?').join(',')})` : '';

  const params = [schoolId];
  if (eqGrades) params.push(...eqGrades);
  params.push(session);

  const [eligible] = await pool.query(
    `SELECT s.id, s.vehicle_id, s.first_name, s.last_name, v.plate_no
       FROM students s
       LEFT JOIN vehicles v ON v.id = s.vehicle_id
       LEFT JOIN daily_status ds
              ON ds.student_id = s.id AND ds.check_date = CURDATE()
      WHERE s.school_id = ?
        AND s.is_deleted = FALSE
        AND s.vehicle_id IS NOT NULL
        AND (${doneColumn} IS NULL OR ${doneColumn} = FALSE)
        ${sessionFilter}${gradeAnd}
        AND NOT EXISTS (
          SELECT 1 FROM student_leaves sl
           WHERE sl.student_id = s.id
             AND sl.leave_date = CURDATE()
             AND sl.cancelled = FALSE
             AND (sl.session = ? OR sl.session = 'both'))`,
    params
  );

  const toConfirm = eligible.filter(s => !absentSet.has(Number(s.id)));
  const skipped = eligible
    .filter(s => absentSet.has(Number(s.id)))
    .map(s => ({ student_id: s.id, reason: 'marked_absent' }));

  const succeeded = [];
  const failed = [];
  const confirmedAt = new Date().toISOString();
  const termId = await getCurrentTerm(pool);

  const conn = await pool.getConnection();
  try {
    await beginCheckinTransaction(conn);

    for (const student of toConfirm) {
      const sp = `sov_${student.id}`;
      try {
        await conn.query(`SAVEPOINT ${sp}`);

        const [[prior]] = await conn.query(
          `SELECT morning_done, morning_ts, evening_done, evening_ts
             FROM daily_status WHERE check_date = CURDATE() AND student_id = ? LIMIT 1`,
          [student.id]
        );
        const priorDailyStatus = prior
          ? {
            morning_done: !!prior.morning_done,
            morning_ts: prior.morning_ts ? new Date(prior.morning_ts).toISOString() : null,
            evening_done: !!prior.evening_done,
            evening_ts: prior.evening_ts ? new Date(prior.evening_ts).toISOString() : null,
          }
          : { morning_done: false, morning_ts: null, evening_done: false, evening_ts: null };

        const result = await _buildCheckinTransaction(conn, {
          userId,
          vehicleId: student.vehicle_id,
          plateNo: student.plate_no || null,
          studentId: student.id,
          session,
          status,
          termId,
          source: 'web',
        });

        await logAudit({
          conn,
          userId,
          action: 'UPDATE',
          entityType: 'checkin_override',
          entityId: String(student.id),
          oldValue: priorDailyStatus,
          newValue: {
            school_id: schoolId,
            student_id: student.id,
            student_name: `${student.first_name} ${student.last_name}`,
            vehicle_id: student.vehicle_id,
            plate_no: student.plate_no || null,
            session,
            status,
            reason: trimmedReason,
            confirmed_by_user_id: userId,
            confirmed_by_role: userRole || null,
            confirmed_by_display_name: userDisplayName || null,
            override_checkin_log_id: result.log_id,
            timestamp_utc: confirmedAt,
            batch: true,
          },
          ipAddress: ipAddress || null,
          userAgent: userAgent || null,
        });

        await conn.query(`RELEASE SAVEPOINT ${sp}`);
        succeeded.push({ student_id: student.id, checkin_log_id: result.log_id });
      } catch (err) {
        try { await conn.query(`ROLLBACK TO SAVEPOINT ${sp}`); } catch { /* savepoint gone */ }
        failed.push({ student_id: student.id, error: err.message });
      }
    }

    // One row describing the whole decision. Without it the audit trail shows a
    // burst of individual confirmations with no record of who was deliberately
    // left out — which is the half a complaint would actually ask about.
    await logAudit({
      conn,
      userId,
      action: 'UPDATE',
      entityType: 'checkin_override_batch',
      entityId: String(schoolId),
      oldValue: null,
      newValue: {
        school_id: schoolId,
        session,
        status,
        reason: trimmedReason,
        grade_scope: gradeFilter || null,
        eligible_count: eligible.length,
        confirmed_count: succeeded.length,
        absent_marked_count: skipped.length,
        failed_count: failed.length,
        absent_student_ids: skipped.map(s => s.student_id),
        confirmed_by_user_id: userId,
        confirmed_by_role: userRole || null,
        confirmed_by_display_name: userDisplayName || null,
        timestamp_utc: confirmedAt,
      },
      ipAddress: ipAddress || null,
      userAgent: userAgent || null,
    });

    await conn.commit();
  } catch (err) {
    try { await conn.rollback(); } catch { /* swallow */ }
    throw err;
  } finally {
    conn.release();
  }

  return {
    session,
    status,
    eligible_count: eligible.length,
    confirmed_count: succeeded.length,
    absent_marked_count: skipped.length,
    failed_count: failed.length,
    confirmed_at: confirmedAt,
    confirmed_by: userDisplayName || null,
    succeeded,
    skipped,
    failed,
  };
}

// ─── getNoShowStudents (roadmap A — no-show; checkout-independent) ─────────────
// Students who SHOULD have boarded (assigned to a bus + session-enabled) but have
// NO CHECKED_IN for the day/session, excluding those on leave. Built on CHECKED_IN
// (reliably recorded ~90%+) so it is trustworthy even though checkout is not.
// AUD-004 — `gradeFilter` pins the result to one grade for a teacher sub-account.
// This read names children who did NOT board, with their classroom and bus, for any
// date the caller asks for; it is the most sensitive roster on the school router, so
// it follows the same grade boundary as every other /api/school read rather than
// being the one exception. Matched tolerantly (gradeEquivalents) because
// students.grade is stored inconsistently — an exact match would hide a teacher's
// own missing pupils, which is the failure that matters here.
async function getNoShowStudents(pool, { schoolId, session, date = null, gradeFilter = null }) {
  assertSession(session);
  const enabledCol = session === 'morning' ? 's.morning_enabled' : 's.evening_enabled';
  // CS5-01 (same root cause as processCheckoutAll): a CHECKED_IN row that was
  // voided still sits in checkin_logs, so a child whose boarding was cancelled
  // dropped out of the no-show list while GET /api/school/missing (which reads
  // daily_status) correctly listed them. Ignore a board whose session flag was
  // positively reset by the void.
  //
  // Known consequence, measured and documented in
  // docs/audit/core-scope-defect-hunt-2026-09-04.md §10.7: checkin_logs has no
  // column linking a CANCELLED row to the row it reverses, so "was this boarding
  // voided" has to be inferred from daily_status.<session>_done — and that one
  // flag covers BOTH the board and the drop-off. Voiding a CHECK-OUT therefore
  // resets it too, and this query then lists a pupil who demonstrably did board.
  // It goes away only when that linkage column exists (§10.4 option B).
  const doneCol = session === 'morning' ? 'ds.morning_done' : 'ds.evening_done';
  const eq = gradeFilter ? gradeEquivalents(gradeFilter) : null;
  const gradeAnd = eq ? ` AND s.grade IN (${eq.map(() => '?').join(',')})` : '';
  const [rows] = await pool.query(
    `SELECT s.id, s.prefix, s.first_name, s.last_name, s.grade, s.classroom, s.vehicle_id, v.plate_no
       FROM students s
       LEFT JOIN vehicles v ON v.id = s.vehicle_id AND v.is_deleted = FALSE
      WHERE s.school_id = ? AND s.is_deleted = FALSE${gradeAnd}
        AND ${enabledCol} = TRUE
        AND s.vehicle_id IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM checkin_logs ci
                         WHERE ci.student_id = s.id AND ci.session = ?
                           AND ci.check_date = COALESCE(?, CURDATE()) AND ci.status = 'CHECKED_IN'
                           AND NOT EXISTS (SELECT 1 FROM daily_status ds
                                            WHERE ds.student_id = ci.student_id
                                              AND ds.check_date = ci.check_date
                                              AND ${doneCol} = FALSE))
        AND NOT EXISTS (SELECT 1 FROM student_leaves sl
                         WHERE sl.student_id = s.id AND sl.leave_date = COALESCE(?, CURDATE())
                           AND sl.cancelled = FALSE AND (sl.session = ? OR sl.session = 'both'))
      ORDER BY s.grade, s.classroom, s.first_name`,
    eq ? [schoolId, ...eq, session, date, date, session]
       : [schoolId, session, date, date, session]
  );
  return rows;
}

// ─── voidCheckin (GOAL #6 — reverse a wrong check-in / check-out) ─────────────
//
// Writes a COMPENSATING checkin_logs row (status='CANCELLED') for the SAME
// student/session/check_date/vehicle as an existing log, then resets that
// session's daily_status flag (morning_done/evening_done → FALSE, *_ts → NULL).
// The original log is NEVER hard-deleted — history is preserved; the CANCELLED
// row is the audit-grade reversal record. Fully atomic (one transaction), the
// original row is locked FOR UPDATE, and ownership is enforced INSIDE the txn
// after the lock so concurrent callers can't race a stale scope check.
//
// scope:
//   { kind: 'admin' }              — no ownership constraint
//   { kind: 'driver', vehicleId }  — log.vehicle_id must equal vehicleId
//   { kind: 'school', schoolId }   — student.school_id must equal schoolId
async function voidCheckin(pool, {
  userId,
  userRole = null,
  userDisplayName = null,
  ipAddress = null,
  userAgent = null,
  logId,
  reason,
  scope = { kind: 'admin' },
}) {
  const id = Number.parseInt(logId, 10);
  if (!Number.isInteger(id) || id <= 0) {
    throw makeError('logId ไม่ถูกต้อง', 400);
  }
  const trimmedReason = typeof reason === 'string' ? reason.trim() : '';
  if (!trimmedReason) {
    throw makeError('กรุณาระบุเหตุผลการยกเลิกรายการ', 400);
  }
  if (trimmedReason.length > 500) {
    throw makeError('เหตุผลต้องไม่เกิน 500 ตัวอักษร', 400);
  }

  const conn = await pool.getConnection();
  await conn.beginTransaction();
  try {
    // 1. Lock the target log row FOR UPDATE.
    const [logs] = await conn.query(
      `SELECT id, term_id, vehicle_id, plate_no, student_id, cid_hash,
              student_name, session, status, check_date
         FROM checkin_logs
        WHERE id = ?
        FOR UPDATE`,
      [id]
    );
    if (!logs.length) {
      throw makeError('ไม่พบรายการเช็กอินที่ต้องการยกเลิก', 404);
    }
    const log = logs[0];

    // 1b. A CANCELLED row cannot itself be voided.
    if (log.status === 'CANCELLED') {
      throw makeError('รายการนี้เป็นรายการยกเลิกอยู่แล้ว', 409, 'ALREADY_CANCELLED');
    }
    if (!['CHECKED_IN', 'CHECKED_OUT'].includes(log.status)) {
      throw makeError('สถานะรายการนี้ไม่สามารถยกเลิกได้', 409);
    }

    // 2. Scope enforcement (inside the lock — authoritative).
    if (scope.kind === 'driver') {
      if (!scope.vehicleId || String(log.vehicle_id) !== String(scope.vehicleId)) {
        throw makeError('รายการนี้ไม่ใช่ของรถคุณ', 403);
      }
    } else if (scope.kind === 'school') {
      const [[stu]] = await conn.query(
        `SELECT school_id FROM students WHERE id = ? AND is_deleted = FALSE LIMIT 1`,
        [log.student_id]
      );
      if (!stu || String(stu.school_id) !== String(scope.schoolId)) {
        throw makeError('ไม่พบนักเรียนในโรงเรียนนี้', 404);
      }
    }

    // 3. Idempotency: reject if a CANCELLED compensating row for this
    //    student/session/date was already written AFTER the target log.
    const [dupVoid] = await conn.query(
      `SELECT id FROM checkin_logs
        WHERE student_id = ? AND session = ? AND check_date = ?
          AND status = 'CANCELLED' AND id > ?
        LIMIT 1`,
      [log.student_id, log.session, log.check_date, log.id]
    );
    if (dupVoid.length) {
      throw makeError('รายการนี้ถูกยกเลิกไปแล้ว', 409, 'ALREADY_VOIDED');
    }

    // 4. Snapshot daily_status BEFORE reset (old_value for audit).
    const [[priorDs]] = await conn.query(
      `SELECT morning_done, morning_ts, evening_done, evening_ts
         FROM daily_status
        WHERE check_date = ? AND student_id = ?
        LIMIT 1`,
      [log.check_date, log.student_id]
    );

    // 5. Write the COMPENSATING checkin_logs row (status='CANCELLED').
    const [voidResult] = await conn.query(
      `INSERT INTO checkin_logs
         (term_id, vehicle_id, plate_no, student_id, cid_hash,
          student_name, session, status, check_date, checked_by, source)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'CANCELLED', ?, ?, ?)`,
      [log.term_id, log.vehicle_id, log.plate_no, log.student_id, log.cid_hash,
       log.student_name, log.session, log.check_date, userId, 'web']
    );

    // 6. Reset the matching daily_status session flag (only the row's session).
    const doneCol = log.session === 'morning' ? 'morning_done' : 'evening_done';
    const tsCol   = log.session === 'morning' ? 'morning_ts'   : 'evening_ts';
    await conn.query(
      `UPDATE daily_status
          SET ${doneCol} = FALSE, ${tsCol} = NULL
        WHERE check_date = ? AND student_id = ?`,
      [log.check_date, log.student_id]
    );

    // 7. Audit (DELETE = the business reversal). conn-scoped so it commits atomically.
    await logAudit({
      conn,
      userId,
      action:     'DELETE',
      entityType: 'checkin',
      entityId:   String(log.id),
      oldValue: {
        original_log_id: log.id,
        student_id:      log.student_id,
        student_name:    log.student_name,
        session:         log.session,
        status:          log.status,
        vehicle_id:      log.vehicle_id,
        check_date:      log.check_date,
        daily_status: priorDs
          ? { morning_done: !!priorDs.morning_done, evening_done: !!priorDs.evening_done }
          : null,
      },
      newValue: {
        action:               'void_checkin',
        compensating_log_id:  voidResult.insertId,
        status:               'CANCELLED',
        reason:               trimmedReason,
        voided_by_user_id:    userId,
        voided_by_role:       userRole,
        voided_by_display_name: userDisplayName,
        scope:                scope.kind,
      },
      ipAddress,
      userAgent,
    });

    await conn.commit();
    return {
      original_log_id:     log.id,
      compensating_log_id: voidResult.insertId,
      student_id:          log.student_id,
      student_name:        log.student_name,
      session:             log.session,
      voided_status:       log.status,
      status:              'CANCELLED',
    };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

module.exports = {
  getDriverVehicle,
  resolveVehicleForEmergency,
  getRoster,
  processCheckin,
  processCheckout,
  processCheckinAll,
  processCheckoutAll,
  getStatusToday,
  getNoShowStudents,
  processSchoolOverride,
  processSchoolOverrideAll,
  voidCheckin,
};
