'use strict';

const { logAudit } = require('../utils/audit');
const { refreshVehicleEligibility } = require('./vehicleVerification.service');

function shiftError(message, statusCode, code) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.errors = [{ code }];
  return error;
}

function dateOnly(value = new Date()) {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

function availability(row, at) {
  const reasons = [];
  if (!['ELIGIBLE', 'EXPIRING'].includes(row.verification_status)) reasons.push('VEHICLE_NOT_ELIGIBLE');
  if (row.qualification_status !== 'VERIFIED') reasons.push('DRIVER_QUALIFICATION_NOT_VERIFIED');
  if (!row.license_expiry || dateOnly(row.license_expiry) < at) reasons.push('DRIVER_LICENSE_EXPIRED');
  return { ...row, can_start: reasons.length === 0, blocking_reasons: reasons };
}

async function listAuthorizedVehicles(pool, { driverId, at = new Date() }) {
  if (!driverId) throw shiftError('บัญชีนี้ยังไม่เชื่อมกับข้อมูลคนขับ', 409, 'DRIVER_PROFILE_NOT_LINKED');
  const day = dateOnly(at);
  const [rows] = await pool.query(
    `SELECT dva.id AS assignment_id, dva.vehicle_id, v.plate_no, v.vehicle_type,
            dva.assignment_role, dva.authorization_status, dva.valid_from, dva.valid_until,
            v.verification_status, v.verification_reasons_json,
            dq.qualification_status, dq.license_expiry
       FROM driver_vehicle_assignments dva
       JOIN vehicles v ON v.id = dva.vehicle_id AND v.is_deleted = FALSE
       LEFT JOIN driver_qualifications dq ON dq.driver_id = dva.driver_id AND dq.is_current = TRUE
      WHERE dva.driver_id = ? AND dva.is_active = TRUE
        AND dva.authorization_status = 'AUTHORIZED'
        AND (dva.valid_from IS NULL OR dva.valid_from <= ?)
        AND (dva.valid_until IS NULL OR dva.valid_until >= ?)
      ORDER BY FIELD(dva.assignment_role, 'PRIMARY', 'BACKUP'), v.plate_no`,
    [driverId, day, day]
  );
  return rows.map((row) => availability(row, day));
}

async function startShift(pool, {
  driverId, vehicleId, session, userId, at = new Date(), note = null,
}) {
  if (!driverId) throw shiftError('บัญชีนี้ยังไม่เชื่อมกับข้อมูลคนขับ', 409, 'DRIVER_PROFILE_NOT_LINKED');
  if (!vehicleId || !['MORNING', 'EVENING', 'OTHER'].includes(session)) {
    throw shiftError('กรุณาเลือกรถและรอบการเดินรถ', 400, 'INVALID_SHIFT_INPUT');
  }
  const day = dateOnly(at);
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [[driver]] = await conn.query(
      `SELECT d.id, d.name FROM drivers d WHERE d.id = ? AND d.is_deleted = FALSE FOR UPDATE`,
      [driverId]
    );
    if (!driver) throw shiftError('ไม่พบข้อมูลคนขับ', 404, 'DRIVER_NOT_FOUND');
    const [[assignment]] = await conn.query(
      `SELECT dva.id, dva.driver_id, dva.vehicle_id, dva.assignment_role,
              dva.authorization_status, dva.valid_from, dva.valid_until,
              v.plate_no, v.verification_status
         FROM driver_vehicle_assignments dva
         JOIN vehicles v ON v.id = dva.vehicle_id AND v.is_deleted = FALSE
        WHERE dva.driver_id = ? AND dva.vehicle_id = ? AND dva.is_active = TRUE
          AND dva.authorization_status = 'AUTHORIZED'
          AND (dva.valid_from IS NULL OR dva.valid_from <= ?)
          AND (dva.valid_until IS NULL OR dva.valid_until >= ?)
        LIMIT 1 FOR UPDATE`,
      [driverId, vehicleId, day, day]
    );
    if (!assignment) throw shiftError('คนขับไม่ได้รับอนุญาตให้ขับรถคันนี้', 403, 'DRIVER_NOT_AUTHORIZED');
    if (!['ELIGIBLE', 'EXPIRING'].includes(assignment.verification_status)) {
      throw shiftError('รถคันนี้ยังไม่ผ่านเงื่อนไขความปลอดภัย', 409, 'VEHICLE_NOT_ELIGIBLE');
    }
    const [[qualification]] = await conn.query(
      `SELECT qualification_status, license_expiry
         FROM driver_qualifications
        WHERE driver_id = ? AND is_current = TRUE
        ORDER BY verified_at DESC, id DESC LIMIT 1 FOR UPDATE`,
      [driverId]
    );
    if (!qualification || qualification.qualification_status !== 'VERIFIED') {
      throw shiftError('คุณสมบัติคนขับยังไม่ได้รับการรับรอง', 409, 'DRIVER_QUALIFICATION_NOT_VERIFIED');
    }
    if (!qualification.license_expiry || dateOnly(qualification.license_expiry) < day) {
      throw shiftError('ใบอนุญาตขับรถหมดอายุ', 409, 'DRIVER_LICENSE_EXPIRED');
    }
    const [open] = await conn.query(
      `SELECT id, driver_id, vehicle_id
         FROM vehicle_operating_shifts
        WHERE (driver_id = ? OR vehicle_id = ?) AND status = 'OPEN' AND ended_at IS NULL
        FOR UPDATE`,
      [driverId, vehicleId]
    );
    if (open.some((shift) => String(shift.driver_id) === String(driverId))) {
      throw shiftError('คนขับมีรอบที่ยังไม่ปิดอยู่', 409, 'DRIVER_ALREADY_ON_SHIFT');
    }
    if (open.some((shift) => String(shift.vehicle_id) === String(vehicleId))) {
      throw shiftError('รถคันนี้มีคนขับกำลังปฏิบัติงานอยู่', 409, 'VEHICLE_ALREADY_ON_SHIFT');
    }
    let inserted;
    try {
      [inserted] = await conn.query(
        `INSERT INTO vehicle_operating_shifts
          (driver_id, vehicle_id, assignment_id, session, status, started_by, start_note)
         VALUES (?, ?, ?, ?, 'OPEN', ?, ?)`,
        [driverId, vehicleId, assignment.id, session, userId, note]
      );
    } catch (error) {
      if (error && error.code === 'ER_DUP_ENTRY') {
        throw shiftError('มีรอบปฏิบัติงานที่ชนกัน กรุณารีเฟรชข้อมูล', 409, 'OPEN_SHIFT_CONFLICT');
      }
      throw error;
    }
    await logAudit({
      userId, action: 'CREATE', entityType: 'vehicle_operating_shift', entityId: String(inserted.insertId),
      newValue: { driver_id: driverId, vehicle_id: vehicleId, session, assignment_role: assignment.assignment_role }, conn,
    });
    await conn.commit();
    return {
      shift_id: inserted.insertId, driver_id: Number(driverId), vehicle_id: vehicleId,
      assignment_role: assignment.assignment_role, session, status: 'OPEN',
    };
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally { conn.release(); }
}

async function getActiveShift(pool, { driverId }) {
  if (!driverId) throw shiftError('บัญชีนี้ยังไม่เชื่อมกับข้อมูลคนขับ', 409, 'DRIVER_PROFILE_NOT_LINKED');
  const [rows] = await pool.query(
    `SELECT vos.id, vos.driver_id, vos.vehicle_id, vos.session, vos.status, vos.started_at,
            v.plate_no, v.vehicle_type, dva.assignment_role
       FROM vehicle_operating_shifts vos
       JOIN vehicles v ON v.id = vos.vehicle_id
       JOIN driver_vehicle_assignments dva ON dva.id = vos.assignment_id
      WHERE vos.driver_id = ? AND vos.status = 'OPEN' AND vos.ended_at IS NULL
      LIMIT 1`,
    [driverId]
  );
  return rows[0] || null;
}

async function endShift(pool, { driverId, shiftId, userId, note = null }) {
  if (!driverId) throw shiftError('บัญชีนี้ยังไม่เชื่อมกับข้อมูลคนขับ', 409, 'DRIVER_PROFILE_NOT_LINKED');
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [[shift]] = await conn.query(
      `SELECT vos.id, vos.driver_id, vos.vehicle_id, vos.status, vos.ended_at
         FROM vehicle_operating_shifts vos
        WHERE vos.id = ? AND vos.driver_id = ?
        FOR UPDATE`,
      [shiftId, driverId]
    );
    if (!shift) throw shiftError('ไม่พบรอบปฏิบัติงาน', 404, 'SHIFT_NOT_FOUND');
    if (shift.status !== 'OPEN' || shift.ended_at) {
      await conn.commit();
      return { shift_id: Number(shiftId), status: shift.status, already_closed: true };
    }
    await conn.query(
      `UPDATE vehicle_operating_shifts
          SET status = 'CLOSED', ended_at = CURRENT_TIMESTAMP, ended_by = ?, end_note = ?
        WHERE id = ? AND status = 'OPEN'`,
      [userId, note, shiftId]
    );
    await logAudit({
      userId, action: 'UPDATE', entityType: 'vehicle_operating_shift', entityId: String(shiftId),
      oldValue: { status: 'OPEN' }, newValue: { status: 'CLOSED' }, conn,
    });
    await conn.commit();
    return { shift_id: Number(shiftId), status: 'CLOSED', already_closed: false };
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally { conn.release(); }
}

async function listDrivers(pool, { search = null } = {}) {
  const params = [];
  let where = 'd.is_deleted = FALSE';
  if (search && String(search).trim()) {
    where += ' AND d.name LIKE ?';
    params.push(`%${String(search).trim()}%`);
  }
  const [rows] = await pool.query(
    `SELECT d.id, d.name,
            dq.qualification_status, dq.license_type, dq.license_expiry,
            COUNT(DISTINCT CASE WHEN dva.is_active = TRUE
                 AND dva.authorization_status = 'AUTHORIZED' THEN dva.vehicle_id END) AS authorized_vehicle_count
       FROM drivers d
       LEFT JOIN driver_qualifications dq ON dq.driver_id = d.id AND dq.is_current = TRUE
       LEFT JOIN driver_vehicle_assignments dva ON dva.driver_id = d.id
      WHERE ${where}
      GROUP BY d.id, d.name, dq.qualification_status, dq.license_type, dq.license_expiry
      ORDER BY d.name
      LIMIT 200`,
    params
  );
  return rows.map((row) => ({ ...row, authorized_vehicle_count: Number(row.authorized_vehicle_count) || 0 }));
}

async function authorizeDriverForVehicle(pool, {
  driverId, vehicleId, assignmentRole = 'BACKUP', validFrom = null, validUntil = null, userId,
}) {
  if (!driverId || !vehicleId || !userId || !['PRIMARY', 'BACKUP'].includes(assignmentRole)) {
    throw shiftError('ข้อมูลการมอบหมายคนขับไม่ถูกต้อง', 400, 'INVALID_DRIVER_ASSIGNMENT');
  }
  const start = validFrom || dateOnly(new Date());
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [[driver]] = await conn.query(
      'SELECT id, name FROM drivers WHERE id = ? AND is_deleted = FALSE FOR UPDATE',
      [driverId]
    );
    if (!driver) throw shiftError('ไม่พบข้อมูลคนขับ', 404, 'DRIVER_NOT_FOUND');
    const [[vehicle]] = await conn.query(
      'SELECT id, plate_no FROM vehicles WHERE id = ? AND is_deleted = FALSE FOR UPDATE',
      [vehicleId]
    );
    if (!vehicle) throw shiftError('ไม่พบข้อมูลรถ', 404, 'VEHICLE_NOT_FOUND');
    const [[existing]] = await conn.query(
      `SELECT id
         FROM driver_vehicle_assignments
        WHERE driver_id = ? AND vehicle_id = ?
        ORDER BY id DESC LIMIT 1 FOR UPDATE`,
      [driverId, vehicleId]
    );
    let assignmentId;
    if (existing) {
      assignmentId = existing.id;
      await conn.query(
        `UPDATE driver_vehicle_assignments
            SET assignment_role = ?, authorization_status = 'AUTHORIZED',
                valid_from = ?, valid_until = ?, start_date = ?, end_date = NULL,
                is_active = TRUE, authorized_by = ?, authorized_at = CURRENT_TIMESTAMP
          WHERE id = ?`,
        [assignmentRole, start, validUntil, start, userId, existing.id]
      );
    } else {
      const [inserted] = await conn.query(
        `INSERT INTO driver_vehicle_assignments
          (driver_id, vehicle_id, assignment_role, authorization_status,
           valid_from, valid_until, start_date, is_active, authorized_by, authorized_at)
         VALUES (?, ?, ?, 'AUTHORIZED', ?, ?, ?, TRUE, ?, CURRENT_TIMESTAMP)`,
        [driverId, vehicleId, assignmentRole, start, validUntil, start, userId]
      );
      assignmentId = inserted.insertId;
    }
    await refreshVehicleEligibility(conn, vehicleId);
    await logAudit({
      userId, action: existing ? 'UPDATE' : 'CREATE', entityType: 'driver_vehicle_assignment',
      entityId: String(assignmentId),
      newValue: { driver_id: driverId, vehicle_id: vehicleId, assignment_role: assignmentRole, authorization_status: 'AUTHORIZED', valid_until: validUntil },
      conn,
    });
    await conn.commit();
    return {
      assignment_id: assignmentId, driver_id: Number(driverId), vehicle_id: vehicleId,
      assignment_role: assignmentRole, authorization_status: 'AUTHORIZED',
    };
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally { conn.release(); }
}

async function verifyDriverQualification(pool, {
  driverId, licenseNo, licenseType = null, licenseExpiry, providerReference = null,
  providerType = 'DLT_OFFICER', userId,
}) {
  if (!driverId || !licenseNo || !licenseExpiry || !userId) {
    throw shiftError('กรุณาระบุเลขใบอนุญาต วันหมดอายุ และคนขับ', 400, 'INVALID_QUALIFICATION_INPUT');
  }
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [[driver]] = await conn.query(
      'SELECT id, name FROM drivers WHERE id = ? AND is_deleted = FALSE FOR UPDATE',
      [driverId]
    );
    if (!driver) throw shiftError('ไม่พบข้อมูลคนขับ', 404, 'DRIVER_NOT_FOUND');
    await conn.query(
      'UPDATE driver_qualifications SET is_current = FALSE WHERE driver_id = ? AND is_current = TRUE',
      [driverId]
    );
    const [inserted] = await conn.query(
      `INSERT INTO driver_qualifications
        (driver_id, license_no, license_type, license_expiry, qualification_status,
         provider_type, provider_reference, verified_by, verified_at, is_current)
       VALUES (?, ?, ?, ?, 'VERIFIED', ?, ?, ?, CURRENT_TIMESTAMP, TRUE)`,
      [driverId, licenseNo, licenseType, licenseExpiry, providerType, providerReference, userId]
    );
    const [assignedVehicles] = await conn.query(
      `SELECT DISTINCT vehicle_id
         FROM driver_vehicle_assignments
        WHERE driver_id = ? AND is_active = TRUE AND authorization_status = 'AUTHORIZED'`,
      [driverId]
    );
    for (const assignment of assignedVehicles) {
      await refreshVehicleEligibility(conn, assignment.vehicle_id);
    }
    await logAudit({
      userId, action: 'CREATE', entityType: 'driver_qualification', entityId: String(inserted.insertId),
      newValue: { driver_id: driverId, license_type: licenseType, license_expiry: licenseExpiry, provider_type: providerType }, conn,
    });
    await conn.commit();
    return { qualification_id: inserted.insertId, driver_id: Number(driverId), status: 'VERIFIED' };
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally { conn.release(); }
}

module.exports = {
  listAuthorizedVehicles, startShift, getActiveShift, endShift,
  listDrivers, authorizeDriverForVehicle, verifyDriverQualification,
};
