'use strict';

/**
 * seed-uat-override-fixture.js (Phase 10.8E-1)
 *
 * Idempotent seeder for the "โรงเรียนยืนยันแทนคนขับ" (school check-in
 * override) UAT fixture. Creates a fully isolated `__UAT*`-marked
 * school, vehicle, student, and two users (one full-school, one
 * grade-scoped teacher) so the browser UAT can run without touching
 * any real production record.
 *
 * Safety rules baked in (Phase 10.8E-1):
 *   - Upserts ONLY rows that start with the project's __UAT* / UAT-
 *     markers below. Never mutates real production data.
 *   - Never hard-deletes anything.
 *   - Generates fresh random passwords on first creation, hashed with
 *     bcrypt cost 12 (matches BCRYPT_COST in auth.routes.js). On rerun
 *     when the user already exists, passwords are left untouched
 *     unless UAT_FORCE_RESET=1 is set in env (then a fresh password is
 *     generated and printed).
 *   - Never prints hashes. Only prints plaintext passwords for the
 *     two UAT user accounts, and only when they are created or
 *     explicitly rotated.
 *
 * Usage:
 *   cd backend && node scripts/seed-uat-override-fixture.js
 *   UAT_FORCE_RESET=1 node scripts/seed-uat-override-fixture.js
 *
 * Rollback (when UAT is over, run by hand under MySQL — NOT this script):
 *   DELETE FROM checkin_logs WHERE student_id = 987654;
 *   DELETE FROM daily_status WHERE student_id = 987654;
 *   DELETE FROM audit_logs   WHERE (entity_type='checkin_override' AND entity_id='987654');
 *   DELETE FROM students     WHERE id = 987654;
 *   DELETE FROM driver_vehicle_assignments WHERE vehicle_id = 'V-uat0000001';
 *   DELETE FROM drivers      WHERE name = 'คนขับทดสอบ ยืนยันแทน';
 *   DELETE FROM vehicles     WHERE id = 'V-uat0000001';
 *   DELETE FROM users        WHERE username IN ('__UAT_SCHOOL_OVERRIDE','__UAT_TEACHER_OVERRIDE','UAT-OVERRIDE-001');
 *   DELETE FROM schools      WHERE id = '__UATSCH';
 */

require('dotenv').config();
const mysql  = require('mysql2/promise');
const bcrypt = require('bcrypt');
const crypto = require('crypto');

const BCRYPT_COST = 12;

// ─── Fixture markers (all explicit, all __UAT* / UAT-) ───────────────────────
const FX = {
  affiliationId: 'AFF001',                                  // reuse, never modify
  schoolId:      '__UATSCH',
  schoolName:    'โรงเรียนทดสอบระบบยืนยันแทน',
  vehicleId:     'V-uat0000001',
  vehiclePlate:  'UAT-OVERRIDE-001',
  vehicleNorm:   'uatoverride001',
  vehicleType:   'รถทดสอบระบบ (UAT)',
  studentId:     987654,
  studentPrefix: 'เด็กชาย',
  studentFirst:  'นักเรียนทดสอบ',
  studentLast:   'ยืนยันแทนคนขับ',
  studentGrade:  'ป.1',
  studentRoom:   '1',
  termId:        '2568-2',
  userFull:      '__UAT_SCHOOL_OVERRIDE',
  userTeacher:   '__UAT_TEACHER_OVERRIDE',
  teacherGrade:  'ป.1',
  // Phase 10.8F-E — UAT driver tied to the same fixture vehicle.
  // Driver login uses vehicles.plate_no as username (see checkin.service.js
  // getDriverVehicle), so the user's username MUST be the plate string.
  driverUserName: 'UAT-OVERRIDE-001',
  driverName:     'คนขับทดสอบ ยืนยันแทน',
  driverPhone:    '0000000099',
};

function randomPassword(len = 16) {
  // base64url → strip non-alphanumeric for browser-friendly typing
  return crypto.randomBytes(24).toString('base64url').replace(/[^A-Za-z0-9]/g, '').slice(0, len);
}

async function ensureAffiliationExists(conn) {
  const [[row]] = await conn.query(
    'SELECT id FROM affiliations WHERE id = ? AND is_deleted = FALSE LIMIT 1',
    [FX.affiliationId]
  );
  if (!row) throw new Error(`Affiliation ${FX.affiliationId} not found — abort (would not modify real data)`);
}

async function upsertSchool(conn) {
  const [exists] = await conn.query('SELECT id, name, is_deleted FROM schools WHERE id = ?', [FX.schoolId]);
  if (exists.length === 0) {
    await conn.query(
      'INSERT INTO schools (id, name, affiliation_id, is_deleted) VALUES (?, ?, ?, FALSE)',
      [FX.schoolId, FX.schoolName, FX.affiliationId]
    );
    return { id: FX.schoolId, created: true };
  }
  const row = exists[0];
  if (row.is_deleted) {
    await conn.query(
      'UPDATE schools SET is_deleted = FALSE, deleted_at = NULL, name = ?, affiliation_id = ? WHERE id = ?',
      [FX.schoolName, FX.affiliationId, FX.schoolId]
    );
    return { id: FX.schoolId, reactivated: true };
  }
  return { id: FX.schoolId, existed: true };
}

async function upsertVehicle(conn) {
  const [exists] = await conn.query(
    'SELECT id, plate_no, normalized_plate, is_deleted FROM vehicles WHERE id = ? OR plate_no = ? OR normalized_plate = ? LIMIT 1',
    [FX.vehicleId, FX.vehiclePlate, FX.vehicleNorm]
  );
  if (exists.length === 0) {
    await conn.query(
      `INSERT INTO vehicles (id, plate_no, normalized_plate, vehicle_type, is_deleted)
       VALUES (?, ?, ?, ?, FALSE)`,
      [FX.vehicleId, FX.vehiclePlate, FX.vehicleNorm, FX.vehicleType]
    );
    return { id: FX.vehicleId, created: true };
  }
  const row = exists[0];
  if (row.id !== FX.vehicleId) {
    throw new Error(
      `Vehicle conflict: plate "${FX.vehiclePlate}" / norm "${FX.vehicleNorm}" already owned by vehicle id "${row.id}" — abort to protect real data`
    );
  }
  if (row.is_deleted) {
    await conn.query(
      'UPDATE vehicles SET is_deleted = FALSE, deleted_at = NULL, plate_no = ?, normalized_plate = ?, vehicle_type = ? WHERE id = ?',
      [FX.vehiclePlate, FX.vehicleNorm, FX.vehicleType, FX.vehicleId]
    );
    return { id: FX.vehicleId, reactivated: true };
  }
  return { id: FX.vehicleId, existed: true };
}

async function upsertStudent(conn) {
  // cid_hash must be NOT NULL — derive deterministically from the fixture
  // marker so reruns produce the same hash (no false-positive cid changes).
  const cidHash = crypto.createHash('sha256').update(`UAT_OVERRIDE_${FX.studentId}`).digest('hex');
  const [exists] = await conn.query('SELECT id, school_id, is_deleted FROM students WHERE id = ?', [FX.studentId]);
  if (exists.length === 0) {
    await conn.query(
      `INSERT INTO students
         (id, cid_hash, prefix, first_name, last_name, grade, classroom,
          school_id, vehicle_id, morning_enabled, evening_enabled, term_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, TRUE, TRUE, ?)`,
      [
        FX.studentId, cidHash, FX.studentPrefix, FX.studentFirst, FX.studentLast,
        FX.studentGrade, FX.studentRoom, FX.schoolId, FX.vehicleId, FX.termId,
      ]
    );
    return { id: FX.studentId, created: true };
  }
  const row = exists[0];
  if (row.school_id !== FX.schoolId) {
    throw new Error(
      `Student id ${FX.studentId} already exists with school_id="${row.school_id}" — abort to avoid clobbering a real student`
    );
  }
  // Re-affirm the vehicle/session/state in case anything drifted
  await conn.query(
    `UPDATE students SET
       prefix = ?, first_name = ?, last_name = ?, grade = ?, classroom = ?,
       school_id = ?, vehicle_id = ?, morning_enabled = TRUE, evening_enabled = TRUE,
       term_id = ?, is_deleted = FALSE, deleted_at = NULL
     WHERE id = ?`,
    [
      FX.studentPrefix, FX.studentFirst, FX.studentLast, FX.studentGrade, FX.studentRoom,
      FX.schoolId, FX.vehicleId, FX.termId, FX.studentId,
    ]
  );
  return { id: FX.studentId, existed: true };
}

async function upsertUatUser(conn, { username, gradeScope, displayName, force }) {
  const [exists] = await conn.query(
    'SELECT id, role, scope_id, grade_scope, is_deleted FROM users WHERE username = ?',
    [username]
  );

  if (exists.length === 0) {
    const password = randomPassword();
    const hash = await bcrypt.hash(password, BCRYPT_COST);
    const [ins] = await conn.query(
      `INSERT INTO users
         (username, password_hash, role, scope_type, scope_id, grade_scope,
          display_name, is_active, must_change_password)
       VALUES (?, ?, 'school', 'SCHOOL', ?, ?, ?, TRUE, FALSE)`,
      [username, hash, FX.schoolId, gradeScope, displayName]
    );
    return { id: ins.insertId, username, status: 'created', password };
  }

  const u = exists[0];
  if (u.role !== 'school' || u.scope_id !== FX.schoolId) {
    throw new Error(
      `User "${username}" exists with role="${u.role}" scope_id="${u.scope_id}" — abort to avoid clobbering real account`
    );
  }

  if (force) {
    const password = randomPassword();
    const hash = await bcrypt.hash(password, BCRYPT_COST);
    await conn.query(
      `UPDATE users SET password_hash = ?, grade_scope = ?, display_name = ?,
        is_active = TRUE, is_deleted = FALSE, deleted_at = NULL,
        must_change_password = FALSE
       WHERE id = ?`,
      [hash, gradeScope, displayName, u.id]
    );
    return { id: u.id, username, status: 'rotated', password };
  }

  if (u.is_deleted) {
    await conn.query(
      `UPDATE users SET is_deleted = FALSE, deleted_at = NULL, is_active = TRUE,
        grade_scope = ?, display_name = ? WHERE id = ?`,
      [gradeScope, displayName, u.id]
    );
    return { id: u.id, username, status: 'reactivated', password: null };
  }

  return { id: u.id, username, status: 'existed', password: null };
}

// ─── Phase 10.8F-E — UAT driver fixture ──────────────────────────────────────
// Three rows are involved:
//   1. drivers row (matched by exact UAT name; otherwise inserted)
//   2. users row (matched by username = vehicles.plate_no per the project's
//      driver-login convention — see backend/src/services/checkin.service.js
//      getDriverVehicle())
//   3. driver_vehicle_assignments linking #1 → V-uat0000001 for the current term

async function upsertUatDriver(conn) {
  const [exists] = await conn.query(
    'SELECT id, name, phone, is_deleted FROM drivers WHERE name = ? LIMIT 1',
    [FX.driverName]
  );
  if (exists.length === 0) {
    const [ins] = await conn.query(
      `INSERT INTO drivers (name, phone, is_deleted) VALUES (?, ?, FALSE)`,
      [FX.driverName, FX.driverPhone]
    );
    return { id: ins.insertId, created: true };
  }
  const d = exists[0];
  if (d.is_deleted) {
    await conn.query(
      `UPDATE drivers SET is_deleted = FALSE, deleted_at = NULL, phone = ? WHERE id = ?`,
      [FX.driverPhone, d.id]
    );
    return { id: d.id, reactivated: true };
  }
  return { id: d.id, existed: true };
}

async function upsertUatDriverUser(conn, { force }) {
  const [exists] = await conn.query(
    'SELECT id, role, is_deleted FROM users WHERE username = ?',
    [FX.driverUserName]
  );

  if (exists.length === 0) {
    const password = randomPassword();
    const hash = await bcrypt.hash(password, BCRYPT_COST);
    const [ins] = await conn.query(
      `INSERT INTO users
         (username, password_hash, role, scope_type, scope_id, display_name,
          is_active, must_change_password)
       VALUES (?, ?, 'driver', NULL, NULL, ?, TRUE, FALSE)`,
      [FX.driverUserName, hash, 'UAT Driver (Override Badge)']
    );
    return { id: ins.insertId, username: FX.driverUserName, status: 'created', password };
  }

  const u = exists[0];
  if (u.role !== 'driver') {
    throw new Error(
      `User "${FX.driverUserName}" exists with role="${u.role}" — abort to avoid clobbering non-driver account`
    );
  }

  if (force) {
    const password = randomPassword();
    const hash = await bcrypt.hash(password, BCRYPT_COST);
    await conn.query(
      `UPDATE users SET password_hash = ?, is_active = TRUE, is_deleted = FALSE,
        deleted_at = NULL, must_change_password = FALSE WHERE id = ?`,
      [hash, u.id]
    );
    return { id: u.id, username: FX.driverUserName, status: 'rotated', password };
  }

  if (u.is_deleted) {
    await conn.query(
      `UPDATE users SET is_deleted = FALSE, deleted_at = NULL, is_active = TRUE WHERE id = ?`,
      [u.id]
    );
    return { id: u.id, username: FX.driverUserName, status: 'reactivated', password: null };
  }

  return { id: u.id, username: FX.driverUserName, status: 'existed', password: null };
}

async function upsertUatDriverAssignment(conn, driverId) {
  const [exists] = await conn.query(
    `SELECT id, is_active FROM driver_vehicle_assignments
     WHERE driver_id = ? AND vehicle_id = ? AND term_id = ?
     LIMIT 1`,
    [driverId, FX.vehicleId, FX.termId]
  );
  if (exists.length === 0) {
    const [ins] = await conn.query(
      `INSERT INTO driver_vehicle_assignments
         (driver_id, vehicle_id, term_id, start_date, end_date, is_active)
       VALUES (?, ?, ?, CURDATE(), NULL, TRUE)`,
      [driverId, FX.vehicleId, FX.termId]
    );
    return { id: ins.insertId, created: true };
  }
  const a = exists[0];
  if (!a.is_active) {
    await conn.query(
      `UPDATE driver_vehicle_assignments SET is_active = TRUE, end_date = NULL WHERE id = ?`,
      [a.id]
    );
    return { id: a.id, reactivated: true };
  }
  return { id: a.id, existed: true };
}

async function reportTodayBlockers(conn, studentId) {
  const [ds] = await conn.query(
    'SELECT morning_done, morning_ts, evening_done, evening_ts FROM daily_status WHERE student_id = ? AND check_date = CURDATE() LIMIT 1',
    [studentId]
  );
  const [leaves] = await conn.query(
    `SELECT session FROM student_leaves WHERE student_id = ? AND leave_date = CURDATE() AND cancelled = FALSE`,
    [studentId]
  );
  const blocked = { morning: false, evening: false };
  if (ds.length) {
    if (ds[0].morning_done) blocked.morning = true;
    if (ds[0].evening_done) blocked.evening = true;
  }
  for (const r of leaves) {
    if (r.session === 'morning' || r.session === 'both') blocked.morning = true;
    if (r.session === 'evening' || r.session === 'both') blocked.evening = true;
  }
  return blocked;
}

async function main() {
  const force = process.env.UAT_FORCE_RESET === '1';

  const conn = await mysql.createConnection({
    host:     process.env.DB_HOST || '127.0.0.1',
    port:     parseInt(process.env.DB_PORT || '3306', 10),
    database: process.env.DB_NAME || 'lampang_bus',
    user:     process.env.DB_USER || 'lampang',
    password: process.env.DB_PASSWORD || '',
    charset:  'utf8mb4',
  });

  try {
    await ensureAffiliationExists(conn);

    const school  = await upsertSchool(conn);
    const vehicle = await upsertVehicle(conn);
    const student = await upsertStudent(conn);
    const fullUser    = await upsertUatUser(conn, {
      username:    FX.userFull,
      gradeScope:  null,
      displayName: 'UAT Full School Account (Override)',
      force,
    });
    const teacherUser = await upsertUatUser(conn, {
      username:    FX.userTeacher,
      gradeScope:  FX.teacherGrade,
      displayName: `UAT Teacher Account (Grade ${FX.teacherGrade})`,
      force,
    });

    // Phase 10.8F-E — UAT driver + login + assignment to V-uat0000001
    const driver     = await upsertUatDriver(conn);
    const driverUser = await upsertUatDriverUser(conn, { force });
    const assignment = await upsertUatDriverAssignment(conn, driver.id);

    const blockers = await reportTodayBlockers(conn, FX.studentId);
    const safeSessions = [];
    if (!blockers.morning) safeSessions.push('morning');
    if (!blockers.evening) safeSessions.push('evening');

    // ── Report ────────────────────────────────────────────────────────────
    console.log('');
    console.log('━━━ Phase 10.8E-1 UAT Fixture ━━━');
    console.log('');
    console.log('Affiliation (existing, untouched):', FX.affiliationId);
    console.log(`School:   id=${school.id}  name="${FX.schoolName}"  [${describe(school)}]`);
    console.log(`Vehicle:  id=${vehicle.id}  plate=${FX.vehiclePlate}  [${describe(vehicle)}]`);
    console.log(`Student:  id=${student.id}  name="${FX.studentPrefix}${FX.studentFirst} ${FX.studentLast}"  [${describe(student)}]`);
    console.log('');
    console.log(`Driver:   id=${driver.id}  name="${FX.driverName}"  [${describe(driver)}]`);
    console.log(`Assignment: id=${assignment.id}  vehicle=${FX.vehicleId} → driver=${driver.id}  [${describe(assignment)}]`);
    console.log('');
    console.log('Users (passwords are printed ONLY when created or rotated):');
    printUser(fullUser);
    printUser(teacherUser);
    printUser(driverUser);
    console.log('');
    console.log(`Today's blockers for student ${FX.studentId}:`);
    console.log(`  morning blocked: ${blockers.morning}`);
    console.log(`  evening blocked: ${blockers.evening}`);
    console.log(`  safe sessions to test: ${safeSessions.length ? safeSessions.join(', ') : '(none — both sessions already done or on leave)'}`);
    console.log('');
    console.log('To rotate passwords later:  UAT_FORCE_RESET=1 node backend/scripts/seed-uat-override-fixture.js');
    console.log('To remove fixture, see the SQL block at the top of this script.');
    console.log('');
  } catch (err) {
    console.error('ERROR:', err.message);
    process.exit(1);
  } finally {
    await conn.end();
  }
}

function describe(r) {
  if (r.created)     return 'created';
  if (r.reactivated) return 'reactivated';
  return 'existed';
}

function printUser({ id, username, status, password }) {
  if (password) {
    console.log(`  ${username}  id=${id}  [${status}]  password=${password}`);
  } else {
    console.log(`  ${username}  id=${id}  [${status}]  password=(unchanged — rerun with UAT_FORCE_RESET=1 to rotate)`);
  }
}

main();
