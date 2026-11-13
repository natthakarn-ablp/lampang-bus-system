'use strict';

/**
 * driverAccountSelfService.service.js — school / affiliation self-service for
 * the driver login of a vehicle (owner decisions 2026-11-13).
 *
 * The driver account belongs to the VEHICLE (username = plate). There are no
 * person-owned accounts. For a shared vehicle, EVERY school that uses it may
 * reset the password and change the driver; an affiliation may do the same for
 * any vehicle used by a school in the affiliation.
 *
 * "Uses the vehicle" is the relationship the rest of the code already treats as
 * authoritative (pickupPoint.validateVehicleServesSchool, vehicleLocation
 * vehicleScopeSql, school.getVehicles, school.getEmergencies): at least one
 * non-deleted pupil of the school has students.vehicle_id = the vehicle.
 *
 * Three actions, all transactional and audited:
 *   resetDriverPassword  — new random one-time password, must change at next
 *                          login, password_changed_at = NOW() so every token
 *                          issued before is rejected (auth.js / refresh-token).
 *   updateDriverDetails  — fix the current driver's name/phone (same person).
 *   replaceDriver        — "เปลี่ยนคนขับ": a NEW driver profile for the new
 *                          person, the vehicle's active assignment moves to it,
 *                          the plate account is relinked and its password reset
 *                          so the previous driver loses access immediately.
 *
 * The plaintext temporary password is returned once to the caller and is never
 * stored or written to the audit log.
 */

const bcrypt = require('bcrypt');
const { logAudit } = require('../utils/audit');
const { normalizePlate } = require('../utils/vehiclePlate');
const { generateTemporaryPassword } = require('./driverProfile.service');

const BCRYPT_COST = 12;
const NAME_MAX = 100;   // drivers.name VARCHAR(100)
const PHONE_MAX = 20;   // drivers.phone VARCHAR(20)

function appError(message, statusCode, code = null) {
  const e = new Error(message);
  e.statusCode = statusCode;
  if (code) e.errors = [{ code }];
  return e;
}

/**
 * Scope predicate for one vehicle. `scope` is { schoolId } or { affiliationId }
 * or { all: true } (admin). Fails closed on an empty scope.
 */
async function vehicleInScope(db, vehicleId, scope = {}) {
  if (!vehicleId) return false;
  if (scope.all === true) return true;
  if (scope.schoolId) {
    const [[row]] = await db.query(
      `SELECT 1 AS ok FROM students
        WHERE vehicle_id = ? AND school_id = ? AND is_deleted = FALSE
        LIMIT 1`,
      [vehicleId, scope.schoolId]
    );
    return !!row;
  }
  if (scope.affiliationId) {
    const [[row]] = await db.query(
      `SELECT 1 AS ok FROM students s
         JOIN schools sc ON sc.id = s.school_id AND sc.is_deleted = FALSE
        WHERE s.vehicle_id = ? AND sc.affiliation_id = ? AND s.is_deleted = FALSE
        LIMIT 1`,
      [vehicleId, scope.affiliationId]
    );
    return !!row;
  }
  return false;
}

// Lock the vehicle row and prove scope. 404 (not 403) for out-of-scope, so a
// caller cannot probe which vehicle ids exist elsewhere.
async function lockScopedVehicle(conn, vehicleId, scope) {
  const [[vehicle]] = await conn.query(
    'SELECT id, plate_no FROM vehicles WHERE id = ? AND is_deleted = FALSE FOR UPDATE',
    [vehicleId]
  );
  if (!vehicle || !(await vehicleInScope(conn, vehicleId, scope))) {
    throw appError('ไม่พบรถคันนี้ในขอบเขตของท่าน', 404, 'VEHICLE_NOT_IN_SCOPE');
  }
  return vehicle;
}

// The vehicle's login: role=driver whose username is this plate (normalized,
// the same match linkOrCreateDriverForVehicle uses).
async function findPlateAccount(conn, vehicle, { lock = false } = {}) {
  const [rows] = await conn.query(
    `SELECT id, username, driver_id, is_active, display_name FROM users
      WHERE role = 'driver' AND is_deleted = FALSE
        AND REPLACE(REPLACE(LOWER(username), ' ', ''), '-', '') = ?
      ORDER BY id${lock ? ' FOR UPDATE' : ''}`,
    [normalizePlate(vehicle.plate_no)]
  );
  if (rows.length > 1) {
    throw appError('พบบัญชีคนขับของรถคันนี้มากกว่าหนึ่งบัญชี กรุณาติดต่อผู้ดูแลระบบ', 409, 'DUPLICATE_DRIVER_ACCOUNT');
  }
  return rows[0] || null;
}

function requireActive(account) {
  if (!account) throw appError('รถคันนี้ยังไม่มีบัญชีคนขับ กรุณาใช้ "เปลี่ยนคนขับ" เพื่อสร้างบัญชี', 404, 'DRIVER_ACCOUNT_NOT_FOUND');
  if (!account.is_active) {
    throw appError('บัญชีคนขับของรถคันนี้ถูกปิดใช้งาน กรุณาติดต่อผู้ดูแลระบบเพื่อเปิดใช้งาน', 409, 'DRIVER_ACCOUNT_INACTIVE');
  }
}

function cleanName(raw) {
  const name = String(raw == null ? '' : raw).trim();
  if (!name) throw appError('กรุณากรอกชื่อคนขับ', 400, 'DRIVER_NAME_REQUIRED');
  if (name.length > NAME_MAX) throw appError(`ชื่อคนขับยาวได้ไม่เกิน ${NAME_MAX} ตัวอักษร`, 400, 'DRIVER_NAME_TOO_LONG');
  return name;
}

function cleanPhone(raw) {
  if (raw === undefined) return undefined;
  const phone = String(raw == null ? '' : raw).trim();
  if (!phone) return null;
  if (phone.length > PHONE_MAX || !/^[0-9+\-\s]+$/.test(phone) || phone.replace(/\D/g, '').length < 9) {
    throw appError('เบอร์โทรคนขับไม่ถูกต้อง', 400, 'DRIVER_PHONE_INVALID');
  }
  return phone;
}

async function setTemporaryPassword(conn, userId) {
  const temporaryPassword = generateTemporaryPassword();
  const hash = await bcrypt.hash(temporaryPassword, BCRYPT_COST);
  // password_changed_at = NOW() trips the iat < password_changed_at guard in
  // middleware/auth.js and /refresh-token: every session issued before this
  // moment stops working (same rule as the admin / affiliation reset paths).
  await conn.query(
    `UPDATE users SET password_hash = ?, must_change_password = TRUE, password_changed_at = NOW()
      WHERE id = ?`,
    [hash, userId]
  );
  return temporaryPassword;
}

async function inTransaction(pool, fn) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const out = await fn(conn);
    await conn.commit();
    return out;
  } catch (e) {
    try { await conn.rollback(); } catch { /* keep the original error */ }
    throw e;
  } finally {
    conn.release();
  }
}

const auditCtx = (actor) => ({ userId: actor.id, ipAddress: actor.ip || null, userAgent: actor.userAgent || null });

/** Reset the vehicle's driver password; returns { username, temporary_password }. */
async function resetDriverPassword(pool, { vehicleId, scope, actor }) {
  return inTransaction(pool, async (conn) => {
    const vehicle = await lockScopedVehicle(conn, vehicleId, scope);
    const account = await findPlateAccount(conn, vehicle, { lock: true });
    requireActive(account);
    const temporaryPassword = await setTemporaryPassword(conn, account.id);
    await logAudit({
      ...auditCtx(actor), action: 'UPDATE', entityType: 'user', entityId: account.id, conn, required: true,
      newValue: {
        action: 'reset_password', account_type: 'driver', target_username: account.username,
        vehicle_id: vehicle.id, must_change_password: true, sessions_revoked: true,
        actor_role: actor.role, actor_scope: scope.schoolId ? { school_id: scope.schoolId } : scope.affiliationId ? { affiliation_id: scope.affiliationId } : 'all',
      },
    });
    return { vehicle_id: vehicle.id, plate_no: vehicle.plate_no, username: account.username, temporary_password: temporaryPassword };
  });
}

// Active driver profile of the vehicle, preferring the one linked to the plate account.
async function currentProfileId(conn, vehicleId, account) {
  if (account && account.driver_id) return Number(account.driver_id);
  const [[a]] = await conn.query(
    'SELECT driver_id FROM driver_vehicle_assignments WHERE vehicle_id = ? AND is_active = TRUE ORDER BY id DESC LIMIT 1',
    [vehicleId]
  );
  return a ? Number(a.driver_id) : null;
}

/** Correct the current driver's name / phone (same person, no password change). */
async function updateDriverDetails(pool, { vehicleId, scope, actor, name, phone }) {
  return inTransaction(pool, async (conn) => {
    const vehicle = await lockScopedVehicle(conn, vehicleId, scope);
    const account = await findPlateAccount(conn, vehicle, { lock: true });
    const driverId = await currentProfileId(conn, vehicle.id, account);
    if (!driverId) throw appError('รถคันนี้ยังไม่มีคนขับ กรุณาใช้ "เปลี่ยนคนขับ"', 404, 'DRIVER_NOT_FOUND');

    // A profile that also drives another vehicle is a different school's data
    // too; correcting it from here would rename that driver everywhere.
    const [[other]] = await conn.query(
      'SELECT 1 AS ok FROM driver_vehicle_assignments WHERE driver_id = ? AND is_active = TRUE AND vehicle_id <> ? LIMIT 1',
      [driverId, vehicle.id]
    );
    if (other) {
      throw appError('คนขับคนนี้ขับรถคันอื่นด้วย แก้ไขข้อมูลจากที่นี่ไม่ได้ หากเป็นคนขับคนใหม่ให้ใช้ "เปลี่ยนคนขับ"', 409, 'DRIVER_PROFILE_SHARED');
    }

    const [[old]] = await conn.query('SELECT id, name, phone FROM drivers WHERE id = ? AND is_deleted = FALSE FOR UPDATE', [driverId]);
    if (!old) throw appError('ไม่พบข้อมูลคนขับ', 404, 'DRIVER_NOT_FOUND');

    const sets = [];
    const params = [];
    const newValue = {};
    if (name !== undefined) { const n = cleanName(name); sets.push('name = ?'); params.push(n); newValue.name = n; }
    const p = cleanPhone(phone);
    if (p !== undefined) { sets.push('phone = ?'); params.push(p); newValue.phone = p; }
    if (!sets.length) throw appError('ไม่มีข้อมูลที่ต้องแก้ไข', 400, 'NOTHING_TO_UPDATE');

    params.push(driverId);
    await conn.query(`UPDATE drivers SET ${sets.join(', ')} WHERE id = ?`, params);
    if (newValue.name && account) {
      await conn.query('UPDATE users SET display_name = ? WHERE id = ?', [newValue.name, account.id]);
    }
    await logAudit({
      ...auditCtx(actor), action: 'UPDATE', entityType: 'driver', entityId: driverId, conn, required: true,
      oldValue: { name: old.name, phone: old.phone },
      newValue: { ...newValue, vehicle_id: vehicle.id, action: 'update_driver_details', actor_role: actor.role },
    });
    return { vehicle_id: vehicle.id, driver_id: driverId, name: newValue.name ?? old.name, phone: p !== undefined ? p : old.phone };
  });
}

/**
 * "เปลี่ยนคนขับ" — the vehicle gets a new driver. Creates a fresh driver profile
 * (the previous person's photo, documents and LINE link stay with the old
 * profile), ends the vehicle's active assignment(s) and closes any open shift
 * of the old driver on this vehicle, links the plate account to the new
 * profile and resets its password. Creates the plate account if the vehicle has
 * none yet. Returns the one-time temporary password.
 */
async function replaceDriver(pool, { vehicleId, scope, actor, name, phone, reason = null }) {
  const cleanNameValue = cleanName(name);
  const cleanPhoneValue = cleanPhone(phone) ?? null;
  return inTransaction(pool, async (conn) => {
    const vehicle = await lockScopedVehicle(conn, vehicleId, scope);
    const account = await findPlateAccount(conn, vehicle, { lock: true });
    if (account && !account.is_active) requireActive(account);

    const [oldAssignments] = await conn.query(
      'SELECT id, driver_id FROM driver_vehicle_assignments WHERE vehicle_id = ? AND is_active = TRUE FOR UPDATE',
      [vehicle.id]
    );
    const oldDriverIds = [...new Set(oldAssignments.map((a) => Number(a.driver_id)))];
    let oldDriver = null;
    if (oldDriverIds.length) {
      const [[d]] = await conn.query('SELECT id, name, phone FROM drivers WHERE id = ?', [oldDriverIds[0]]);
      oldDriver = d || null;
    }

    const [created] = await conn.query('INSERT INTO drivers (name, phone) VALUES (?, ?)', [cleanNameValue, cleanPhoneValue]);
    const newDriverId = created.insertId;

    if (oldAssignments.length) {
      await conn.query(
        'UPDATE driver_vehicle_assignments SET is_active = FALSE, end_date = CURDATE() WHERE vehicle_id = ? AND is_active = TRUE',
        [vehicle.id]
      );
      // Only matters when FEATURE_DRIVER_SHIFT_SELECTION is on; harmless otherwise.
      await conn.query(
        `UPDATE vehicle_operating_shifts
            SET status = 'CLOSED', ended_at = CURRENT_TIMESTAMP, ended_by = ?, end_note = ?
          WHERE vehicle_id = ? AND status = 'OPEN' AND driver_id IN (?)`,
        [actor.id, 'ปิดอัตโนมัติเมื่อเปลี่ยนคนขับ', vehicle.id, oldDriverIds]
      );
    }
    await conn.query(
      'INSERT INTO driver_vehicle_assignments (driver_id, vehicle_id, start_date, is_active) VALUES (?, ?, CURDATE(), TRUE)',
      [newDriverId, vehicle.id]
    );

    let username;
    let userId;
    const temporaryPassword = generateTemporaryPassword();
    const hash = await bcrypt.hash(temporaryPassword, BCRYPT_COST);
    if (account) {
      await conn.query(
        `UPDATE users SET driver_id = ?, display_name = ?, password_hash = ?, must_change_password = TRUE,
                          password_changed_at = NOW()
          WHERE id = ?`,
        [newDriverId, cleanNameValue, hash, account.id]
      );
      username = account.username;
      userId = account.id;
    } else {
      try {
        const [ins] = await conn.query(
          `INSERT INTO users (username, password_hash, role, display_name, driver_id, must_change_password)
           VALUES (?, ?, 'driver', ?, ?, TRUE)`,
          [vehicle.plate_no, hash, cleanNameValue, newDriverId]
        );
        userId = ins.insertId;
        username = vehicle.plate_no;
      } catch (e) {
        if (e && e.code === 'ER_DUP_ENTRY') {
          throw appError('มีบัญชีคนขับเดิมของทะเบียนนี้ที่ถูกลบไว้ กรุณาติดต่อผู้ดูแลระบบเพื่อกู้คืน', 409, 'DRIVER_ACCOUNT_DELETED');
        }
        throw e;
      }
    }

    await logAudit({
      ...auditCtx(actor), action: 'UPDATE', entityType: 'driver_vehicle_assignment', entityId: vehicle.id, conn, required: true,
      oldValue: {
        driver_ids: oldDriverIds,
        driver_name: oldDriver ? oldDriver.name : null,
        assignment_ids: oldAssignments.map((a) => a.id),
      },
      newValue: {
        action: 'replace_driver', vehicle_id: vehicle.id, driver_id: newDriverId, driver_name: cleanNameValue,
        driver_phone: cleanPhoneValue, user_id: userId, account_created: !account,
        password_reset: true, sessions_revoked: !!account, actor_role: actor.role,
        reason: reason ? String(reason).slice(0, 200) : null,
      },
    });

    return {
      vehicle_id: vehicle.id, plate_no: vehicle.plate_no, driver_id: newDriverId,
      username, temporary_password: temporaryPassword, account_created: !account,
    };
  });
}

module.exports = {
  vehicleInScope,
  resetDriverPassword,
  updateDriverDetails,
  replaceDriver,
};
