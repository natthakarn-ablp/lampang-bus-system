'use strict';

/**
 * driverProfile.service.js  (Phase 10.13A-18)
 *
 * Canonical driver onboarding link. Within an OPEN transaction `conn`, ensures:
 *   1. a single driver PROFILE row (drivers) — deduped by phone digits, else name
 *   2. a login USER (users) linked via users.driver_id (the missing link from
 *      Phase 10.13A-17), deduped by normalized username
 *   3. exactly one ACTIVE assignment for (driver, vehicle)
 *
 * Prevents the drift found in 10.13A-17 (driver_id NULL + duplicate drivers
 * rows). Does NOT backfill existing rows — only the user involved in THIS
 * onboarding request is linked. If the matched user is already linked to a
 * DIFFERENT profile, fails closed with 409 DRIVER_USER_PROFILE_CONFLICT.
 */

const bcrypt = require('bcrypt');

const BCRYPT_COST = 12;

async function linkOrCreateDriverForVehicle(conn, { driverName, driverPhone, normalizedPlate, plateNo, vehicleId }) {
  const name = String(driverName || '').trim();
  const phoneDigits = String(driverPhone || '').replace(/\D/g, '');

  // (1) Resolve or create the driver PROFILE — reuse instead of duplicating.
  let driverId = null;
  if (phoneDigits) {
    const [[byPhone]] = await conn.query(
      `SELECT id FROM drivers WHERE is_deleted = FALSE
         AND REGEXP_REPLACE(COALESCE(phone, ''), '[^0-9]', '') = ?
       ORDER BY id LIMIT 1`,
      [phoneDigits]
    );
    if (byPhone) driverId = byPhone.id;
  }
  if (!driverId) {
    const [[byName]] = await conn.query(
      `SELECT id FROM drivers WHERE is_deleted = FALSE AND TRIM(name) = ? ORDER BY id LIMIT 1`,
      [name]
    );
    if (byName) driverId = byName.id;
  }
  if (!driverId) {
    const [created] = await conn.query(
      `INSERT INTO drivers (name, phone) VALUES (?, ?)`,
      [name, driverPhone?.trim() || null]
    );
    driverId = created.insertId;
  }

  // (2) Resolve the login USER by normalized username and LINK it to the profile.
  const [[user]] = await conn.query(
    `SELECT id, driver_id FROM users
     WHERE role = 'driver' AND is_deleted = FALSE
       AND REPLACE(REPLACE(LOWER(username), ' ', ''), '-', '') = ?
     LIMIT 1`,
    [normalizedPlate]
  );

  let userCreated = false;
  if (user) {
    if (user.driver_id != null && Number(user.driver_id) !== Number(driverId)) {
      const e = new Error('บัญชีคนขับนี้เชื่อมกับข้อมูลคนขับอื่นแล้ว กรุณาตรวจสอบ');
      e.statusCode = 409;
      e.errors = [{ code: 'DRIVER_USER_PROFILE_CONFLICT' }];
      throw e;
    }
    if (user.driver_id == null) {
      await conn.query(`UPDATE users SET driver_id = ? WHERE id = ?`, [driverId, user.id]);
    }
  } else {
    const hash = await bcrypt.hash(plateNo, BCRYPT_COST);
    await conn.query(
      `INSERT INTO users (username, password_hash, role, display_name, driver_id, must_change_password)
       VALUES (?, ?, 'driver', ?, ?, TRUE)`,
      [plateNo, hash, name, driverId]
    );
    userCreated = true;
  }

  // (3) Ensure exactly one ACTIVE assignment for this driver+vehicle.
  const [[assignment]] = await conn.query(
    `SELECT id FROM driver_vehicle_assignments
     WHERE driver_id = ? AND vehicle_id = ? AND is_active = TRUE LIMIT 1`,
    [driverId, vehicleId]
  );
  if (!assignment) {
    try {
      await conn.query(
        `INSERT INTO driver_vehicle_assignments (driver_id, vehicle_id, start_date, is_active)
         VALUES (?, ?, CURDATE(), TRUE)`,
        [driverId, vehicleId]
      );
    } catch (err) {
      // Phase 10.13B-3 — DB enforces one active assignment per vehicle
      // (uq_dva_active_vehicle). A race that tries to add a second active driver
      // to the same vehicle surfaces as a clear conflict, not a raw SQL error.
      if (err && err.code === 'ER_DUP_ENTRY' && /uq_dva_active_vehicle/.test(err.sqlMessage || err.message || '')) {
        const e = new Error('รถคันนี้มีคนขับที่ใช้งานอยู่แล้ว');
        e.statusCode = 409;
        e.errors = [{ code: 'VEHICLE_ALREADY_HAS_ACTIVE_DRIVER' }];
        throw e;
      }
      throw err;
    }
  }

  return { driverId, userCreated };
}

module.exports = { linkOrCreateDriverForVehicle };
