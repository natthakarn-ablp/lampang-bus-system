'use strict';

// Phase 10.13B-8 — driver lifecycle & assignment wizard backend.
// Guided, audited admin actions (restore / reassign / deactivate / end) with
// preflight checks. Reuses the 10.13A-23C reactivation guard and the 10.13B-3
// DB unique (uq_dva_active_vehicle). No auto-restore; duplicates stay blocked.

const { logAudit } = require('../utils/audit');
const { detectDriverReactivationBlock } = require('../utils/driverReactivation');
const { maskPhone } = require('../utils/exportSecurity');

const err = (msg, code) => { const e = new Error(msg); e.statusCode = code; return e; };
const out = (allowed, severity, classification, message_th, extra = {}) => ({ allowed, severity, classification, message_th, ...extra });

async function getDriverUser(db, userId) {
  const [[u]] = await db.query("SELECT id, username, role, is_active, is_deleted, driver_id FROM users WHERE id = ? AND role = 'driver'", [userId]);
  return u || null;
}

// ── Preflight: explain what an action will do before it runs. ────────────────
async function preflightDriverAction(pool, { action, payload = {} }) {
  switch (action) {
    case 'RESTORE_DRIVER': {
      const u = await getDriverUser(pool, payload.user_id);
      if (!u) return out(false, 'BLOCKED', 'USER_NOT_FOUND', 'ไม่พบบัญชีคนขับ');
      if (u.is_active && !u.is_deleted) return out(false, 'WARNING', 'ALREADY_ACTIVE', 'บัญชีนี้ใช้งานอยู่แล้ว');
      const block = await detectDriverReactivationBlock(pool, u);
      if (block.blocked) return out(false, 'BLOCKED', block.reason, 'ไม่สามารถเปิดใช้งานบัญชีนี้ได้ เนื่องจากพบข้อมูลซ้ำกับคนขับที่ใช้งานอยู่', { canonical_user_id: block.canonicalUserId, recommended_action: 'BLOCK' });
      // Phase 10.13C — NO_ACTIVE_VEHICLE is a non-blocking warning: restore is
      // allowed, but prompt the operator to assign a vehicle afterwards.
      if (block.warning) return out(true, 'WARNING', block.reason, 'กู้คืนได้ แต่คนขับนี้ยังไม่มีรถที่ใช้งาน — ควรมอบหมายรถให้หลังกู้คืน', { recommended_action: 'RESTORE' });
      return out(true, 'CLEAR', 'RESTORABLE', 'พร้อมกู้คืนบัญชีคนขับนี้', { recommended_action: 'RESTORE' });
    }
    case 'REASSIGN_DRIVER_VEHICLE': {
      const u = await getDriverUser(pool, payload.user_id);
      if (!u) return out(false, 'BLOCKED', 'USER_NOT_FOUND', 'ไม่พบบัญชีคนขับ');
      if (!u.is_active || u.is_deleted) return out(false, 'BLOCKED', 'DRIVER_INACTIVE', 'บัญชีคนขับนี้ถูกปิดใช้งาน');
      if (!u.driver_id) return out(false, 'BLOCKED', 'NO_PROFILE', 'บัญชีคนขับนี้ยังไม่ได้ผูกกับโปรไฟล์คนขับ');
      const [[v]] = await pool.query('SELECT id, plate_no, is_deleted FROM vehicles WHERE id = ?', [payload.vehicle_id]);
      if (!v) return out(false, 'BLOCKED', 'VEHICLE_NOT_FOUND', 'ไม่พบรถปลายทาง');
      if (v.is_deleted) return out(false, 'BLOCKED', 'VEHICLE_SOFT_DELETED', 'รถปลายทางถูกปิดใช้งาน กรุณากู้คืนรถก่อน');
      const [[already]] = await pool.query('SELECT id FROM driver_vehicle_assignments WHERE driver_id = ? AND vehicle_id = ? AND is_active = TRUE LIMIT 1', [u.driver_id, v.id]);
      if (already) return out(false, 'WARNING', 'DRIVER_ALREADY_ASSIGNED', 'คนขับนี้ถูกมอบหมายให้รถคันนี้อยู่แล้ว');
      const [[targetDriver]] = await pool.query('SELECT driver_id FROM driver_vehicle_assignments WHERE vehicle_id = ? AND is_active = TRUE LIMIT 1', [v.id]);
      if (targetDriver) return out(true, 'WARNING', 'TARGET_VEHICLE_HAS_ACTIVE_DRIVER', 'รถคันนี้มีคนขับที่ใช้งานอยู่แล้ว · ระบบจะสิ้นสุดงานเดิมและสร้างงานใหม่ พร้อมบันทึกประวัติ', { existing_assignment: { driver_id: targetDriver.driver_id }, recommended_action: 'END_OLD_ASSIGNMENT' });
      return out(true, 'CLEAR', 'REASSIGNABLE', 'ระบบจะสิ้นสุดงานเดิมของคนขับและสร้างงานใหม่ พร้อมบันทึกประวัติ', { recommended_action: 'REASSIGN' });
    }
    case 'DEACTIVATE_DRIVER': {
      const u = await getDriverUser(pool, payload.user_id);
      if (!u) return out(false, 'BLOCKED', 'USER_NOT_FOUND', 'ไม่พบบัญชีคนขับ');
      if (!u.is_active) return out(false, 'WARNING', 'ALREADY_INACTIVE', 'บัญชีนี้ถูกปิดใช้งานอยู่แล้ว');
      return out(true, 'CLEAR', 'DEACTIVATABLE', 'ระบบจะปิดใช้งานบัญชีและสิ้นสุดงานที่ใช้งานอยู่ · จะไม่ลบประวัติการรับส่งเดิม', { recommended_action: 'DEACTIVATE' });
    }
    default:
      return out(false, 'BLOCKED', 'UNSUPPORTED_ACTION', 'ไม่รองรับการดำเนินการนี้');
  }
}

// ── Restore (23C-guarded): re-activate a canonical driver. ───────────────────
async function restoreDriver(pool, { userId, reason, actorId }) {
  const u = await getDriverUser(pool, userId);
  if (!u) throw err('ไม่พบบัญชีคนขับ', 404);
  if (u.is_active && !u.is_deleted) return { status: 'ALREADY_ACTIVE' };
  const block = await detectDriverReactivationBlock(pool, u);
  if (block.blocked) { const e = err('ไม่สามารถเปิดใช้งานบัญชีนี้ได้ เนื่องจากพบข้อมูลซ้ำกับคนขับที่ใช้งานอยู่', 409); e.errors = [{ code: block.reason, canonical_user_id: block.canonicalUserId }]; throw e; }
  await pool.query('UPDATE users SET is_active = TRUE, is_deleted = FALSE, deleted_at = NULL WHERE id = ?', [u.id]);
  // Phase 10.13C — keep the NO_ACTIVE_VEHICLE warning in the audit trail so a
  // restore-without-active-vehicle stays traceable even though it is allowed.
  await logAudit({ userId: actorId, action: 'UPDATE', entityType: 'user', entityId: String(u.id), oldValue: { is_active: false }, newValue: { is_active: true, restored: true, reason: String(reason || '').slice(0, 200), ...(block.warning ? { reactivation_warning: block.reason } : {}) } });
  return { status: 'RESTORED', user_id: u.id, ...(block.warning ? { warning: block.reason } : {}) };
}

// ── Deactivate: end active assignments + deactivate the user. ────────────────
async function deactivateDriver(pool, { userId, reason, actorId }) {
  const u = await getDriverUser(pool, userId);
  if (!u) throw err('ไม่พบบัญชีคนขับ', 404);
  if (!u.is_active) return { status: 'ALREADY_INACTIVE' };
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    if (u.driver_id) await conn.query('UPDATE driver_vehicle_assignments SET is_active = FALSE, end_date = CURDATE() WHERE driver_id = ? AND is_active = TRUE', [u.driver_id]);
    await conn.query('UPDATE users SET is_active = FALSE WHERE id = ?', [u.id]);
    await logAudit({ userId: actorId, action: 'UPDATE', entityType: 'user', entityId: String(u.id), conn, oldValue: { is_active: true }, newValue: { is_active: false, deactivated: true, reason: String(reason || '').slice(0, 200) } });
    await conn.commit();
    return { status: 'DEACTIVATED', user_id: u.id };
  } catch (e) { await conn.rollback(); throw e; } finally { conn.release(); }
}

// ── Reassign a driver to a vehicle (end old + create new). DB-guarded. ───────
async function reassignDriverVehicle(pool, { userId, vehicleId, endTargetExisting = false, reason, actorId }) {
  const u = await getDriverUser(pool, userId);
  if (!u) throw err('ไม่พบบัญชีคนขับ', 404);
  if (!u.is_active || u.is_deleted) throw err('บัญชีคนขับนี้ถูกปิดใช้งาน', 400);
  if (!u.driver_id) throw err('บัญชีคนขับนี้ยังไม่ได้ผูกกับโปรไฟล์คนขับ', 400);

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [[v]] = await conn.query('SELECT id, is_deleted FROM vehicles WHERE id = ? FOR UPDATE', [vehicleId]);
    if (!v) { await conn.rollback(); throw err('ไม่พบรถปลายทาง', 404); }
    if (v.is_deleted) { await conn.rollback(); throw err('รถปลายทางถูกปิดใช้งาน', 400); }
    const [[already]] = await conn.query('SELECT id FROM driver_vehicle_assignments WHERE driver_id = ? AND vehicle_id = ? AND is_active = TRUE LIMIT 1', [u.driver_id, v.id]);
    if (already) { await conn.commit(); return { status: 'DRIVER_ALREADY_ASSIGNED' }; }
    // Target vehicle already has a (different) active driver?
    const [[target]] = await conn.query('SELECT id, driver_id FROM driver_vehicle_assignments WHERE vehicle_id = ? AND is_active = TRUE LIMIT 1', [v.id]);
    if (target && !endTargetExisting) { await conn.commit(); return { status: 'TARGET_VEHICLE_HAS_ACTIVE_DRIVER', existing_driver_id: target.driver_id }; }
    if (target && endTargetExisting) {
      await conn.query('UPDATE driver_vehicle_assignments SET is_active = FALSE, end_date = CURDATE() WHERE id = ?', [target.id]);
      await logAudit({ userId: actorId, action: 'UPDATE', entityType: 'driver_vehicle_assignment', entityId: String(target.id), conn, oldValue: { is_active: true }, newValue: { is_active: false, ended_for_reassign: true } });
    }
    // End this driver's current active assignment(s).
    const [[old]] = await conn.query('SELECT id, vehicle_id FROM driver_vehicle_assignments WHERE driver_id = ? AND is_active = TRUE LIMIT 1', [u.driver_id]);
    if (old) {
      await conn.query('UPDATE driver_vehicle_assignments SET is_active = FALSE, end_date = CURDATE() WHERE driver_id = ? AND is_active = TRUE', [u.driver_id]);
    }
    try {
      await conn.query('INSERT INTO driver_vehicle_assignments (driver_id, vehicle_id, start_date, is_active) VALUES (?, ?, CURDATE(), TRUE)', [u.driver_id, v.id]);
    } catch (e) {
      if (e.code === 'ER_DUP_ENTRY' && /uq_dva_active_vehicle/.test(e.sqlMessage || e.message || '')) { await conn.rollback(); throw err('รถคันนี้มีคนขับที่ใช้งานอยู่แล้ว', 409); }
      throw e;
    }
    await logAudit({ userId: actorId, action: 'UPDATE', entityType: 'driver_vehicle_assignment', entityId: String(u.driver_id), conn,
      oldValue: { from_vehicle: old ? old.vehicle_id : null }, newValue: { reassigned: true, driver_id: u.driver_id, to_vehicle: v.id, reason: String(reason || '').slice(0, 200) } });
    await conn.commit();
    return { status: 'REASSIGNED', driver_id: u.driver_id, vehicle_id: v.id, ended_old: !!old };
  } catch (e) { await conn.rollback().catch(() => {}); throw e; } finally { conn.release(); }
}

// ── End a single assignment (idempotent). ────────────────────────────────────
async function endAssignment(pool, { assignmentId, reason, actorId }) {
  const [[a]] = await pool.query('SELECT id, is_active, driver_id, vehicle_id FROM driver_vehicle_assignments WHERE id = ?', [assignmentId]);
  if (!a) throw err('ไม่พบงานมอบหมาย', 404);
  if (!a.is_active) return { status: 'ALREADY_ENDED' };
  await pool.query('UPDATE driver_vehicle_assignments SET is_active = FALSE, end_date = CURDATE() WHERE id = ? AND is_active = TRUE', [assignmentId]);
  await logAudit({ userId: actorId, action: 'UPDATE', entityType: 'driver_vehicle_assignment', entityId: String(assignmentId), oldValue: { is_active: true }, newValue: { is_active: false, ended: true, reason: String(reason || '').slice(0, 200) } });
  return { status: 'ENDED', assignment_id: assignmentId };
}

// ── Integrity dashboard. ─────────────────────────────────────────────────────
async function getDriverIntegrity(pool) {
  const q = (s) => pool.query(s).then(([r]) => r);
  const [[vehNoDriver]] = await pool.query("SELECT COUNT(*) n FROM vehicles v WHERE v.is_deleted=0 AND NOT EXISTS (SELECT 1 FROM driver_vehicle_assignments d WHERE d.vehicle_id=v.id AND d.is_active=1)");
  const [[driverNoVehicle]] = await pool.query("SELECT COUNT(*) n FROM users u WHERE u.role='driver' AND COALESCE(u.is_active,1)=1 AND COALESCE(u.is_deleted,0)=0 AND u.driver_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM driver_vehicle_assignments d WHERE d.driver_id=u.driver_id AND d.is_active=1)");
  const [[inactiveDup]] = await pool.query("SELECT COUNT(*) n FROM users WHERE role='driver' AND COALESCE(is_active,1)=0 AND COALESCE(is_deleted,0)=0 AND must_change_password=1");
  const [[unlinked]] = await pool.query("SELECT COUNT(*) n FROM users WHERE role='driver' AND COALESCE(is_active,1)=1 AND COALESCE(is_deleted,0)=0 AND driver_id IS NULL");
  const [[orphanAsg]] = await pool.query("SELECT COUNT(*) n FROM driver_vehicle_assignments d JOIN vehicles v ON v.id=d.vehicle_id WHERE d.is_active=1 AND v.is_deleted=1");
  const multiVeh = await q("SELECT vehicle_id, COUNT(*) c FROM driver_vehicle_assignments WHERE is_active=1 GROUP BY vehicle_id HAVING c>1");
  const [[blockedRecent]] = await pool.query("SELECT COUNT(*) n FROM audit_logs WHERE entity_type='user' AND JSON_EXTRACT(new_value,'$.reactivation_blocked')=true AND created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)");
  const vehList = await q("SELECT v.id, v.plate_no FROM vehicles v WHERE v.is_deleted=0 AND NOT EXISTS (SELECT 1 FROM driver_vehicle_assignments d WHERE d.vehicle_id=v.id AND d.is_active=1) ORDER BY v.plate_no LIMIT 50");
  return {
    vehicles_no_active_driver: vehNoDriver.n,
    active_drivers_no_vehicle: driverNoVehicle.n,
    inactive_duplicate_candidates: inactiveDup.n,
    active_unlinked_drivers: unlinked.n,
    active_assignment_to_soft_deleted_vehicle: orphanAsg.n,
    vehicles_multiple_active_drivers: multiVeh.length,
    blocked_reactivations_30d: blockedRecent.n,
    vehicles_no_driver_list: vehList.map((v) => ({ id: v.id, plate_no: v.plate_no })),
  };
}

module.exports = { preflightDriverAction, restoreDriver, deactivateDriver, reassignDriverVehicle, endAssignment, getDriverIntegrity, maskPhone };
