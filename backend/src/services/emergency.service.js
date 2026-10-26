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
async function createEmergencyReport(params, db = pool) {
  const { reportedBy, detail } = params;
  if (reportedBy == null) throw Object.assign(new Error('reportedBy is required'), { statusCode: 400 });
  if (!detail) throw Object.assign(new Error('detail is required'), { statusCode: 400, errors: [{ code: 'DETAIL_REQUIRED' }] });

  // CS5-04 — the dedupe read and the INSERT that follows it must be serialised
  // per reporter. Three simultaneous taps (exactly the panicking-driver case
  // this service exists for) each read "no recent report" and each insert, so
  // one emergency became three rows, three LINE cards and three audit rows.
  // Run both statements inside ONE transaction and take an exclusive lock on the
  // reporter's own users row first: the second tap waits for the first to
  // commit, and its read then sees the committed row and returns it as a
  // duplicate. Sequential double-taps behave exactly as before.
  //
  // READ COMMITTED, for the same reason as the check-in path (see
  // checkin.service.js beginCheckinTransaction). users.id is the primary key, so
  // the mutex above is a single record lock and gap-lock-free — but the dedupe
  // read below matches nothing on the first tap, and under REPEATABLE READ a
  // locking read that matches nothing gap-locks, so DIFFERENT drivers pressing
  // the button at the same moment deadlock each other. Measured against the test
  // database with the guard alone: at 3 simultaneous reporters 2 of 15 emergency
  // reports were lost to ER_LOCK_DEADLOCK, and at 20 reporters 44 of 100 were.
  // A lost emergency report is the worst failure this file can produce, so the
  // dedupe read is left non-locking and the transaction reads fresh instead.
  // Bare SET TRANSACTION applies to the NEXT transaction only, so the pooled
  // connection is back at the server default as soon as this one ends.
  // A caller that injects something other than a pool (the DB-free unit double,
  // or a connection whose transaction it already owns) keeps the old shape.
  if (typeof db.getConnection === 'function') {
    const conn = await db.getConnection();
    try {
      await conn.query('SET TRANSACTION ISOLATION LEVEL READ COMMITTED');
      await conn.beginTransaction();
      try {
        await conn.query('SELECT id FROM users WHERE id = ? FOR UPDATE', [reportedBy]);
        const out = await insertOrReuse(params, conn);
        await conn.commit();
        return out;
      } catch (err) {
        await conn.rollback();
        throw err;
      }
    } finally {
      conn.release();
    }
  }
  return insertOrReuse(params, db);
}

/**
 * The dedupe read + INSERT pair. `db` is the transaction connection when the
 * caller passed a pool (see createEmergencyReport), otherwise whatever the
 * caller injected.
 */
async function insertOrReuse({
  reportedBy,
  vehicleId = null,
  plateNo = null,
  detail,
  note = null,
  latitude = null,
  longitude = null,
  accuracyM = null,
  dedupeWindowSeconds = DEFAULT_DEDUPE_WINDOW_SECONDS,
}, db) {
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
