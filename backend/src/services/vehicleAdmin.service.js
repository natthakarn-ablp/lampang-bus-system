'use strict';

// vehicleAdmin.service.js — admin-only vehicle lifecycle: soft-delete, plate
// correction, and merge-duplicate. Layered on the same canonical-identity guard
// the RESTORE_SOFT_DELETED_VEHICLE flow uses (vehicleRequest.service.js):
// vehicles carries UNIQUE(plate_no), UNIQUE(normalized_plate NOT NULL), and a
// STORED generated UNIQUE(active_canonical_plate). Every write goes through one
// transaction, locks rows FOR UPDATE, repoints FK children in FK-safe order,
// and audits old/new. No schema change — uses only existing columns
// (is_deleted, deleted_at, plate_no, normalized_plate, canonical_plate,
// vehicle_type, owner_name, owner_phone, insurance_*). pool is the 1st arg of
// every fn so the service is unit-testable with a mock pool/conn.

const { logAudit } = require('../utils/audit');
const { releaseRecoveryBinding } = require('../utils/recoveryBinding');
const PI = require('../utils/plateIdentity');
const { validatePlateNo, isProvinceVariant, normalizePlate } = require('../utils/vehiclePlate');

const err = (msg, code) => { const e = new Error(msg); e.statusCode = code; return e; };

// Live driver logins named after a plate. A driver's username IS the plate as
// typed at account creation, matched with the same space/dash/case-insensitive
// normalization fixPlate uses. `excludeNormalized` keeps a login that also
// matches another plate (the merge winner's) out of the result.
const DRIVER_LOGIN_SQL = `SELECT id, username, is_active FROM users
  WHERE role = 'driver' AND is_deleted = FALSE
    AND REPLACE(REPLACE(LOWER(username), ' ', ''), '-', '') = ?`;
function plateLoginFilter(plateNo, excludePlateNo) {
  const own = normalizePlate(plateNo);
  const other = excludePlateNo ? normalizePlate(excludePlateNo) : null;
  // If both plates normalize to the same string the login cannot be told apart
  // from the kept vehicle's → never touch it.
  return { own, skip: !own || (other !== null && other === own) };
}

// Tables whose vehicle_id is operational history/links we REPOINT to the winner.
// Order is irrelevant for plain UPDATEs (all RESTRICT FKs point at vehicles.id,
// not at each other) but we keep students + assignments first as the high-value
// rows. driver_vehicle_assignments has UNIQUE(active_vehicle_id) and
// vehicle_operating_shifts/route_baselines/eta_predictions/vehicle_latest_locations
// have their own per-vehicle UNIQUE keys — those are handled separately below.
const REPOINT_SIMPLE = [
  'students',
  'vehicle_attendants',
  'checkin_logs',
  'vehicle_inspections',
  'emergency_logs',
  'student_leaves',
  'roster_change_requests',
  'pickup_points',
  'vehicle_location_history',
  'geofences',
  'geofence_events',
  'route_deviations',
  'vehicle_inspection_applications',
  // no-FK denormalized refs (kept consistent for reporting):
  'daily_status',
  'vehicle_requests',
];

// Derived/transient per-vehicle rows with a UNIQUE key on vehicle_id (or a
// generated open_* key). Repointing the loser's rows could collide with the
// winner's, and the data is recomputed by background jobs — so we DELETE the
// loser's rows instead of repointing. Truly transient → safe hard-delete.
const TRANSIENT_DELETE = [
  'vehicle_latest_locations',     // PK = vehicle_id
  'route_baselines',              // UNIQUE (vehicle_id, session, day_of_week)
  'eta_predictions',              // UNIQUE (vehicle_id, pickup_point_id, session, eta_date)
  'vehicle_operating_shifts',     // UNIQUE generated open_vehicle_id (closed rows kept on loser as history)
];

function publicVehicle(v) {
  return {
    id: v.id, plate_no: v.plate_no, normalized_plate: v.normalized_plate,
    canonical_plate: v.canonical_plate, vehicle_type: v.vehicle_type,
    owner_name: v.owner_name, insurance_status: v.insurance_status,
    insurance_type: v.insurance_type, insurance_expiry: v.insurance_expiry,
    registration_expiry: v.registration_expiry,
    compulsory_insurance_expiry: v.compulsory_insurance_expiry,
    tax_expiry: v.tax_expiry, is_deleted: !!v.is_deleted, deleted_at: v.deleted_at,
  };
}

// Count what's still attached so the soft-delete GUARD and the merge audit can
// both reason about blast radius. Returns active (non-deleted) students and
// active driver assignments for a vehicle id.
async function vehicleAttachments(conn, vehicleId) {
  const [[s]] = await conn.query(
    'SELECT COUNT(*) AS n FROM students WHERE vehicle_id = ? AND is_deleted = FALSE', [vehicleId]);
  const [[a]] = await conn.query(
    'SELECT COUNT(*) AS n FROM driver_vehicle_assignments WHERE vehicle_id = ? AND is_active = TRUE', [vehicleId]);
  return { active_students: s.n, active_assignments: a.n };
}

// ── GOAL #3a — soft-delete a vehicle (guarded, force-overridable) ────────────
async function softDeleteVehicle(pool, { vehicleId, actorId, force = false, reason = null, ipAddress = null, userAgent = null }) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [[v]] = await conn.query('SELECT * FROM vehicles WHERE id = ? FOR UPDATE', [vehicleId]);
    if (!v) throw err('ไม่พบรถคันนี้', 404);
    if (v.is_deleted) { await conn.commit(); return { id: v.id, status: 'ALREADY_DELETED' }; }

    const att = await vehicleAttachments(conn, vehicleId);
    const blocked = att.active_students > 0 || att.active_assignments > 0;
    if (blocked && !force) {
      const e = err('รถคันนี้ยังมีนักเรียนหรือคนขับที่ใช้งานอยู่ ไม่สามารถลบได้ (ใช้ force พร้อมเหตุผลเพื่อยืนยัน)', 409);
      e.errors = [{ code: 'VEHICLE_IN_USE', active_students: att.active_students, active_assignments: att.active_assignments }];
      throw e;
    }
    if (blocked && force && !String(reason || '').trim()) {
      throw err('การลบรถที่ยังมีการใช้งานต้องระบุเหตุผล', 400);
    }

    // Bug fix (2026-07-07): when force-deleting a vehicle that still has active
    // driver_vehicle_assignments, close them now — BEFORE soft-deleting the
    // vehicle. Otherwise the assignment stays is_active=1 pointing at a row
    // whose is_deleted=1, which the integrity monitor flags as
    // orphan_assignment and can break driver vehicle resolution (the driver
    // would see a vehicle that no longer exists). End-date is set to today when
    // still open so the historical trail stays coherent.
    if (att.active_assignments > 0) {
      await conn.query(
        `UPDATE driver_vehicle_assignments
            SET is_active = FALSE, end_date = COALESCE(end_date, CURDATE())
          WHERE vehicle_id = ? AND is_active = TRUE`,
        [vehicleId]
      );
    }

    // Soft-delete only. is_deleted=TRUE auto-NULLs active_canonical_plate
    // (generated col) so the canonical frees for a future active vehicle — same
    // semantics the RESTORE flow relies on.
    await conn.query('UPDATE vehicles SET is_deleted = TRUE, deleted_at = NOW() WHERE id = ? AND is_deleted = FALSE', [vehicleId]);

    await logAudit({
      userId: actorId, action: 'DELETE', entityType: 'vehicle', entityId: String(v.id), conn,
      oldValue: { is_deleted: false, plate_no: v.plate_no },
      newValue: { is_deleted: true, forced: blocked && force, reason: reason || null,
                  active_students: att.active_students, active_assignments: att.active_assignments },
      ipAddress, userAgent,
    });
    await conn.commit();
    return { id: v.id, status: 'DELETED', forced: blocked && force, ...att };
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally { conn.release(); }
}

// Validate a new plate for vehicleId and run the dedup guards against OTHER
// active vehicles (normalized, canonical, province-variant). Used by the
// transport/admin plate-typo fix (fixPlate).
async function checkPlateChange(conn, vehicleId, rawPlate) {
  const validation = validatePlateNo(rawPlate);
  if (!validation.valid) { const e = err(validation.error, 400); e.errors = [{ code: 'VALIDATION_ERROR' }]; throw e; }
  const { trimmed, normalized } = validation;

  // normalized_plate collision (whitespace/dash variant) on another ACTIVE row.
  const [[dupNorm]] = await conn.query(
    'SELECT id, plate_no FROM vehicles WHERE normalized_plate = ? AND is_deleted = FALSE AND id <> ? LIMIT 1',
    [normalized, vehicleId]);
  if (dupNorm) { const e = err('ทะเบียนรถนี้ซ้ำกับรถที่ใช้งานอยู่ในระบบ', 409); e.errors = [{ code: 'DUPLICATE_ACTIVE_VEHICLE', vehicle_id: dupNorm.id, plate_no: dupNorm.plate_no }]; throw e; }

  // canonical (province-alias-aware) collision on another ACTIVE row.
  const canonical = PI.canonicalPlateForStorage(trimmed);
  if (canonical) {
    const [[dupCanon]] = await conn.query(
      'SELECT id, plate_no FROM vehicles WHERE canonical_plate = ? AND is_deleted = FALSE AND id <> ? LIMIT 1',
      [canonical, vehicleId]);
    if (dupCanon) { const e = err('ทะเบียนรถนี้ซ้ำกับรถที่ใช้งานอยู่ (จับคู่จากชื่อจังหวัด)', 409); e.errors = [{ code: 'DUPLICATE_ACTIVE_VEHICLE', vehicle_id: dupCanon.id, plate_no: dupCanon.plate_no }]; throw e; }
  }

  // province-omitted/variant guard (mirrors transport add + school onboarding).
  const [variantRows] = await conn.query(
    `SELECT plate_no, normalized_plate FROM vehicles
     WHERE is_deleted = FALSE AND id <> ?
       AND (normalized_plate LIKE CONCAT(?, '%') OR ? LIKE CONCAT(normalized_plate, '%'))`,
    [vehicleId, normalized, normalized]);
  const variants = variantRows.filter((c) => isProvinceVariant(c.normalized_plate, normalized));
  if (variants.length) {
    const e = err('พบทะเบียนรถใกล้เคียงในระบบ กรุณาตรวจสอบทะเบียนและจังหวัด', 409);
    e.errors = [{ code: 'DUPLICATE_OR_INCOMPLETE_PLATE', candidates: variants.map((c) => ({ plate_no: c.plate_no, duplicate_type: 'PROVINCE_VARIANT' })) }];
    throw e;
  }

  return { trimmed, normalized, canonical };
}

/**
 * Plate-typo fix (transport + admin), 2026-11-13.
 *
 * A driver's login username IS the plate as typed when the driver account was
 * created (driverProfile.service.js), and login matches username exactly. So a
 * plate fix that left the username alone would strand the driver on the old
 * typo. In ONE transaction this: validates the new plate with the same dedup
 * guards as the admin correction, renames the vehicle, renames every live
 * driver login whose username normalizes to the OLD plate, and writes one
 * audit row with both. If the new username is already taken by any account
 * (uq_users_username covers soft-deleted rows too) the whole fix is refused
 * with 409 and nothing changes. Sessions are NOT ended: a driver mid-route
 * keeps working and uses the new plate at the next login.
 */
async function fixPlate(pool, { vehicleId, newPlate, reason, actorId, actorRole = null, ipAddress = null, userAgent = null }) {
  const why = String(reason || '').trim();
  if (!why) throw err('กรุณาระบุเหตุผลในการแก้ทะเบียน', 400);
  if (!String(newPlate || '').trim()) throw err('กรุณากรอกทะเบียนใหม่', 400);
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [[v]] = await conn.query('SELECT * FROM vehicles WHERE id = ? FOR UPDATE', [vehicleId]);
    if (!v) throw err('ไม่พบรถคันนี้', 404);
    if (v.is_deleted) throw err('รถคันนี้ถูกลบแล้ว กรุณากู้คืนก่อนแก้ไข', 409);
    if (String(newPlate).trim() === v.plate_no) throw err('ทะเบียนใหม่เหมือนทะเบียนเดิม', 400);

    const { trimmed, normalized, canonical } = await checkPlateChange(conn, vehicleId, newPlate);
    const oldNormalized = normalizePlate(v.plate_no);

    // Driver logins named after the old plate (same normalization as
    // driverProfile.service.js uses to find them).
    const [drivers] = await conn.query(
      `SELECT id, username FROM users
        WHERE role = 'driver' AND is_deleted = FALSE
          AND REPLACE(REPLACE(LOWER(username), ' ', ''), '-', '') = ?
        FOR UPDATE`,
      [oldNormalized]);
    if (drivers.length) {
      const [[taken]] = await conn.query(
        'SELECT id FROM users WHERE username = ? AND id NOT IN (?) LIMIT 1',
        [trimmed, drivers.map((d) => d.id)]);
      if (taken) {
        const e = err('ชื่อผู้ใช้คนขับตามทะเบียนใหม่มีอยู่ในระบบแล้ว แก้ทะเบียนไม่ได้ กรุณาแจ้งผู้ดูแลระบบ', 409);
        e.errors = [{ code: 'DRIVER_USERNAME_TAKEN' }];
        throw e;
      }
      if (drivers.length > 1) {
        const e = err('พบบัญชีคนขับมากกว่าหนึ่งบัญชีที่ใช้ทะเบียนเดิม กรุณาแจ้งผู้ดูแลระบบตรวจสอบ', 409);
        e.errors = [{ code: 'DRIVER_USERNAME_AMBIGUOUS', count: drivers.length }];
        throw e;
      }
    }

    try {
      await conn.query(
        'UPDATE vehicles SET plate_no = ?, normalized_plate = ?, canonical_plate = ? WHERE id = ?',
        [trimmed, normalized, canonical, vehicleId]);
      for (const d of drivers) {
        await conn.query('UPDATE users SET username = ? WHERE id = ?', [trimmed, d.id]);
      }
    } catch (e) {
      if (e && e.code === 'ER_DUP_ENTRY') { const d = err('ทะเบียนรถหรือชื่อผู้ใช้คนขับนี้มีอยู่ในระบบแล้ว', 409); d.errors = [{ code: 'DUPLICATE_ACTIVE_VEHICLE' }]; throw d; }
      throw e;
    }

    const driverRenames = drivers.map((d) => ({ user_id: d.id, old_username: d.username, new_username: trimmed }));
    await logAudit({
      userId: actorId, action: 'UPDATE', entityType: 'vehicle', entityId: String(vehicleId), conn, required: true,
      oldValue: { plate_no: v.plate_no, normalized_plate: v.normalized_plate, canonical_plate: v.canonical_plate },
      newValue: { action: 'fix_plate', plate_no: trimmed, normalized_plate: normalized, canonical_plate: canonical,
                  reason: why.slice(0, 500), by_role: actorRole, driver_usernames: driverRenames },
      ipAddress, userAgent,
    });
    await conn.commit();
    return { id: vehicleId, old_plate_no: v.plate_no, plate_no: trimmed, driver_usernames: driverRenames };
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally { conn.release(); }
}

// ── GOAL #3b — editable vehicle fields (plate changes go through fixPlate) ────
async function correctVehicle(pool, { vehicleId, actorId, patch = {}, ipAddress = null, userAgent = null }) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [[v]] = await conn.query('SELECT * FROM vehicles WHERE id = ? FOR UPDATE', [vehicleId]);
    if (!v) throw err('ไม่พบรถคันนี้', 404);
    if (v.is_deleted) throw err('รถคันนี้ถูกลบแล้ว กรุณากู้คืนก่อนแก้ไข', 409);

    const sets = [];
    const params = [];
    const after = {};

    // Plate changes are NOT made here (2026-11-13). The driver login's username
    // IS the plate, so a plate edit that left the username alone stranded the
    // driver on the old plate. fixPlate() renames both in one transaction with
    // a required reason; this endpoint refuses and points there. Sending the
    // current plate unchanged is harmless and ignored.
    if (patch.plate_no != null && String(patch.plate_no).trim() !== v.plate_no) {
      const e = err('แก้ทะเบียนรถที่นี่ไม่ได้ กรุณาใช้ "แก้ทะเบียน" (POST /api/admin/vehicles/:id/fix-plate พร้อมเหตุผล) เพื่อให้ชื่อผู้ใช้คนขับเปลี่ยนตามทะเบียนใหม่ด้วย', 400);
      e.errors = [{ field: 'plate_no', code: 'USE_FIX_PLATE' }];
      throw e;
    }

    // Free-text / date fields — null-safe partial update.
    const SIMPLE = ['vehicle_type', 'owner_name', 'owner_phone', 'insurance_status', 'insurance_type'];
    for (const f of SIMPLE) {
      if (Object.prototype.hasOwnProperty.call(patch, f)) {
        const val = patch[f] === '' ? null : patch[f];
        sets.push(`${f} = ?`); params.push(val); after[f] = val;
      }
    }
    const DATES = ['insurance_expiry', 'registration_expiry', 'compulsory_insurance_expiry', 'tax_expiry'];
    for (const f of DATES) {
      if (Object.prototype.hasOwnProperty.call(patch, f)) {
        const val = patch[f] ? String(patch[f]).slice(0, 10) : null;
        sets.push(`${f} = ?`); params.push(val); after[f] = val;
      }
    }

    if (!sets.length) throw err('ไม่มีข้อมูลที่จะแก้ไข', 400);

    params.push(vehicleId);
    try {
      await conn.query(`UPDATE vehicles SET ${sets.join(', ')} WHERE id = ?`, params);
    } catch (e) {
      // DB unique race backstop (plate_no / normalized_plate / active_canonical).
      if (e && e.code === 'ER_DUP_ENTRY') { const d = err('ทะเบียนรถนี้มีอยู่ในระบบแล้ว กรุณาตรวจสอบรถเดิมก่อนแก้ไข', 409); d.errors = [{ code: 'DUPLICATE_ACTIVE_VEHICLE' }]; throw d; }
      throw e;
    }

    await logAudit({
      userId: actorId, action: 'UPDATE', entityType: 'vehicle', entityId: String(vehicleId), conn,
      oldValue: { plate_no: v.plate_no, vehicle_type: v.vehicle_type, owner_name: v.owner_name,
                  insurance_status: v.insurance_status, insurance_expiry: v.insurance_expiry },
      newValue: after, ipAddress, userAgent,
    });
    const [[updated]] = await conn.query('SELECT * FROM vehicles WHERE id = ?', [vehicleId]);
    await conn.commit();
    return publicVehicle(updated);
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally { conn.release(); }
}

// ── Read-only preview for the admin delete / merge dialogs ──────────────────
// What a delete would detach and what a merge would move: active students and
// driver assignment (the delete guard) plus row counts of every table
// mergeVehicles repoints or clears. No writes, no locks.
async function vehicleImpact(pool, vehicleId) {
  const [[v]] = await pool.query(
    'SELECT id, plate_no, vehicle_type, is_deleted FROM vehicles WHERE id = ?', [vehicleId]);
  if (!v) throw err('ไม่พบรถคันนี้', 404);
  const att = await vehicleAttachments(pool, vehicleId);
  const moves = {};
  for (const table of REPOINT_SIMPLE) {
    const [[r]] = await pool.query(`SELECT COUNT(*) AS n FROM ${table} WHERE vehicle_id = ?`, [vehicleId]);
    const n = Number(r && r.n) || 0;
    if (n) moves[table] = n;
  }
  {
    const [[r]] = await pool.query('SELECT COUNT(*) AS n FROM driver_vehicle_assignments WHERE vehicle_id = ?', [vehicleId]);
    const n = Number(r && r.n) || 0;
    if (n) moves.driver_vehicle_assignments = n;
  }
  const cleared = {};
  for (const table of TRANSIENT_DELETE) {
    const [[r]] = await pool.query(`SELECT COUNT(*) AS n FROM ${table} WHERE vehicle_id = ?`, [vehicleId]);
    const n = Number(r && r.n) || 0;
    if (n) cleared[table] = n;
  }
  const [[d]] = await pool.query(
    `SELECT d.name FROM driver_vehicle_assignments dva
       JOIN drivers d ON d.id = dva.driver_id
      WHERE dva.vehicle_id = ? AND dva.is_active = TRUE
      ORDER BY dva.id DESC LIMIT 1`, [vehicleId]);
  // Owner decision 2026-11-13: a merge closes the driver login named after
  // this (source) plate. Preview which login that would be.
  let driverLogin = null;
  const f = plateLoginFilter(v.plate_no);
  if (!f.skip) {
    const [logins] = await pool.query(`${DRIVER_LOGIN_SQL} ORDER BY id LIMIT 1`, [f.own]);
    const u = logins && logins[0];
    if (u) driverLogin = { id: u.id, username: u.username, is_active: !!u.is_active };
  }
  return {
    vehicle: { id: v.id, plate_no: v.plate_no, vehicle_type: v.vehicle_type, is_deleted: !!v.is_deleted },
    active_students: Number(att.active_students) || 0,
    active_assignments: Number(att.active_assignments) || 0,
    driver_name: d ? d.name : null,
    driver_login: driverLogin,
    moves,
    cleared,
  };
}

// ── GOAL #4 — merge a duplicate vehicle (loser :id) into the winner ──────────
// Callable by admin (/api/admin) and transport (/api/transport, owner decision
// 2026-11-13); actorRole lands in both audit rows as by_role.
async function mergeVehicles(pool, { vehicleId, intoVehicleId, actorId, actorRole = null, reason = null, ipAddress = null, userAgent = null }) {
  if (!intoVehicleId) throw err('กรุณาระบุรถปลายทาง (into_vehicle_id)', 400);
  if (String(vehicleId) === String(intoVehicleId)) throw err('ไม่สามารถรวมรถคันเดียวกันได้', 400);
  if (!String(reason || '').trim()) throw err('กรุณาระบุเหตุผลในการรวมรถ', 400);

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    // Lock both rows in a deterministic order to avoid deadlocks.
    const [first, second] = [vehicleId, intoVehicleId].sort();
    await conn.query('SELECT id FROM vehicles WHERE id IN (?, ?) ORDER BY id FOR UPDATE', [first, second]);

    const [[loser]] = await conn.query('SELECT * FROM vehicles WHERE id = ?', [vehicleId]);
    const [[winner]] = await conn.query('SELECT * FROM vehicles WHERE id = ?', [intoVehicleId]);
    if (!loser) throw err('ไม่พบรถต้นทางที่ต้องการรวม', 404);
    if (!winner) throw err('ไม่พบรถปลายทาง', 404);
    if (winner.is_deleted) throw err('รถปลายทางถูกลบแล้ว ไม่สามารถใช้เป็นปลายทางการรวมได้', 409);

    const counts = {};
    // 1) Repoint operational + history FK children loser → winner.
    for (const table of REPOINT_SIMPLE) {
      const [r] = await conn.query(`UPDATE ${table} SET vehicle_id = ? WHERE vehicle_id = ?`, [intoVehicleId, vehicleId]);
      if (r.affectedRows) counts[table] = r.affectedRows;
    }
    // import_batch_rows.matched_vehicle_id (no FK, denormalized preview ref).
    {
      const [r] = await conn.query('UPDATE import_batch_rows SET matched_vehicle_id = ? WHERE matched_vehicle_id = ?', [intoVehicleId, vehicleId]);
      if (r.affectedRows) counts.import_batch_rows = r.affectedRows;
    }
    // 2) driver_vehicle_assignments: UNIQUE(active_vehicle_id) means at most ONE
    //    active assignment per vehicle. If the loser has an active assignment and
    //    the winner already does, end the loser's (can't have two active on the
    //    winner); otherwise repoint it. Ended/historical rows repoint freely.
    const [[winActive]] = await conn.query('SELECT id FROM driver_vehicle_assignments WHERE active_vehicle_id = ? LIMIT 1', [intoVehicleId]);
    if (winActive) {
      const [r] = await conn.query(
        "UPDATE driver_vehicle_assignments SET is_active = FALSE, end_date = COALESCE(end_date, CURDATE()) WHERE vehicle_id = ? AND is_active = TRUE",
        [vehicleId]);
      if (r.affectedRows) counts.driver_vehicle_assignments_ended = r.affectedRows;
    }
    {
      const [r] = await conn.query('UPDATE driver_vehicle_assignments SET vehicle_id = ? WHERE vehicle_id = ?', [intoVehicleId, vehicleId]);
      if (r.affectedRows) counts.driver_vehicle_assignments = r.affectedRows;
    }
    // 3) Transient/derived per-vehicle rows with their own UNIQUE keys — delete
    //    the loser's rather than risk a key collision; jobs recompute them.
    for (const table of TRANSIENT_DELETE) {
      const [r] = await conn.query(`DELETE FROM ${table} WHERE vehicle_id = ?`, [vehicleId]);
      if (r.affectedRows) counts[`${table}_deleted`] = r.affectedRows;
    }

    // 4) Soft-delete the loser (frees its active_canonical_plate automatically).
    await conn.query('UPDATE vehicles SET is_deleted = TRUE, deleted_at = NOW() WHERE id = ? AND is_deleted = FALSE', [vehicleId]);

    // 5) Owner decision 2026-11-13: close the driver login named after the
    //    merged-away plate. Not deleted — deactivated, every existing token
    //    killed (password_changed_at), LINE recovery binding released. A login
    //    that also matches the kept plate is the kept vehicle's → untouched.
    const closedLogins = [];
    const f = plateLoginFilter(loser.plate_no, winner.plate_no);
    if (!f.skip) {
      const [logins] = await conn.query(`${DRIVER_LOGIN_SQL} FOR UPDATE`, [f.own]);
      for (const u of logins || []) {
        await conn.query('UPDATE users SET is_active = FALSE, password_changed_at = NOW() WHERE id = ?', [u.id]);
        const released = await releaseRecoveryBinding(conn, u.id);
        closedLogins.push({ user_id: u.id, username: u.username, was_active: !!u.is_active, recovery_channels_released: released });
        await logAudit({
          userId: actorId, action: 'UPDATE', entityType: 'user', entityId: String(u.id), conn,
          oldValue: { username: u.username, is_active: !!u.is_active },
          newValue: { is_active: false, reason: 'vehicle_merged', merged_vehicle_id: vehicleId,
                      merged_plate_no: loser.plate_no, into_vehicle_id: intoVehicleId,
                      recovery_channels_released: released, by_role: actorRole },
          ipAddress, userAgent,
        });
      }
    }

    await logAudit({
      userId: actorId, action: 'UPDATE', entityType: 'vehicle', entityId: String(vehicleId), conn,
      oldValue: { id: loser.id, plate_no: loser.plate_no, is_deleted: !!loser.is_deleted },
      newValue: { merged_into: intoVehicleId, into_plate_no: winner.plate_no, is_deleted: true,
                  reason: String(reason).slice(0, 500), by_role: actorRole,
                  repointed: counts, driver_logins_closed: closedLogins },
      ipAddress, userAgent,
    });
    await conn.commit();
    return { id: vehicleId, merged_into: intoVehicleId, status: 'MERGED', repointed: counts, driver_logins_closed: closedLogins };
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally { conn.release(); }
}

module.exports = { softDeleteVehicle, correctVehicle, mergeVehicles, vehicleAttachments, vehicleImpact, publicVehicle, checkPlateChange, fixPlate, REPOINT_SIMPLE, TRANSIENT_DELETE };
