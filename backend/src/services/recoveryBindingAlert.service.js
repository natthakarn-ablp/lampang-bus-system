'use strict';

/**
 * recoveryBindingAlert.service.js — tell the school main account when one of
 * its grade teachers, or the driver of a vehicle its pupils ride, binds or
 * unbinds LINE for password recovery.
 *
 * Why: the main account is who resets those accounts (CLAUDE.md §8, กู้รหัสผ่าน
 * ตนเองผ่าน LINE), and a reset is the only way to revoke a binding. A binding
 * the school did not expect — or one that disappears — is exactly what it
 * should see without having to read the audit log.
 *
 * Storage follows pendingQueue.service (no migration): one audit_logs row per
 * target school, entity_type 'recovery_alert', entity_id = the school id. The
 * `notifications` table is NOT used (it is the LINE outbox) and nothing here
 * sends LINE.
 *
 * "Pupils ride the vehicle" is the same relationship the school's driver
 * self-service uses (driverAccountSelfService.vehicleInScope): a non-deleted
 * student of the school has students.vehicle_id = the vehicle. The driver
 * account belongs to the vehicle (username = plate), matched the way
 * findPlateAccount does.
 */

const { logAudit } = require('../utils/audit');
const { normalizePlate } = require('../utils/vehiclePlate');

const ENTITY = 'recovery_alert';
const KIND = { LINKED: 'LINE_RECOVERY_LINKED', UNLINKED: 'LINE_RECOVERY_UNLINKED' };
const MAX_SCHOOLS = 50;
const LIST_DAYS = 30;
const LIST_LIMIT = 20;

function firstRow(result) {
  const rows = Array.isArray(result) ? result[0] : null;
  return Array.isArray(rows) ? rows[0] || null : null;
}

function allRows(result) {
  const rows = Array.isArray(result) ? result[0] : null;
  return Array.isArray(rows) ? rows : [];
}

/**
 * Which school main accounts hear about this account's binding, and how the
 * account is described to them. [] for anyone else (main school account,
 * officers, admin).
 */
async function resolveTargets(db, userId) {
  const user = firstRow(await db.query(
    `SELECT id, role, username, display_name, scope_id, grade_scope
       FROM users WHERE id = ? AND is_deleted = FALSE LIMIT 1`,
    [userId]
  ));
  if (!user) return { user: null, targets: [] };

  if (user.role === 'school') {
    // The main account binding its own LINE is not news to itself.
    if (!user.grade_scope || !user.scope_id) return { user, targets: [] };
    return { user, targets: [{ schoolId: String(user.scope_id), plateNo: null }] };
  }

  if (user.role === 'driver') {
    const plate = normalizePlate(String(user.username || ''));
    if (!plate) return { user, targets: [] };
    const rows = allRows(await db.query(
      `SELECT DISTINCT s.school_id, v.plate_no
         FROM vehicles v
         JOIN students s ON s.vehicle_id = v.id AND s.is_deleted = FALSE
        WHERE v.is_deleted = FALSE
          AND REPLACE(REPLACE(LOWER(v.plate_no), ' ', ''), '-', '') = ?
        ORDER BY s.school_id
        LIMIT ${MAX_SCHOOLS}`,
      [plate]
    ));
    return {
      user,
      targets: rows.filter((r) => r.school_id).map((r) => ({ schoolId: String(r.school_id), plateNo: r.plate_no || null })),
    };
  }

  return { user, targets: [] };
}

/**
 * Record the alert rows. Called AFTER the binding transaction has committed
 * (with the pool), so an alert can never roll back or hold locks on the
 * user's own link/unlink, which is already audited inside that transaction.
 * Never throws: a missing alert is logged and the request still succeeds.
 *
 * @param {{ query: Function }} db
 * @param {{ userId: number, linked: boolean }} opts
 * @returns {Promise<string[]>} school ids alerted
 */
async function recordBindingChange(db, { userId, linked }) {
  try {
    const { user, targets } = await resolveTargets(db, userId);
    if (!user || !targets.length) return [];
    const kind = linked ? KIND.LINKED : KIND.UNLINKED;
    const done = [];
    for (const t of targets) {
      await logAudit({
        userId: user.id,
        action: 'CREATE',
        entityType: ENTITY,
        entityId: t.schoolId,
        newValue: {
          kind,
          target_role: 'school',
          target_scope_id: t.schoolId,
          subject_user_id: user.id,
          subject_role: user.role,
          subject_username: user.username,
          subject_name: user.display_name || user.username,
          grade_scope: user.role === 'school' ? user.grade_scope : null,
          plate_no: t.plateNo,
          provider: 'LINE',
        },
        userAgent: 'recovery-binding-alert',
        conn: db,
        required: true,
      });
      done.push(t.schoolId);
    }
    return done;
  } catch (err) {
    console.warn('[recoveryBindingAlert] alert not recorded:', err && err.message);
    return [];
  }
}

function safeJson(v) {
  if (v && typeof v === 'object') return v;
  try { return JSON.parse(v); } catch { return {}; }
}

/** Recent alerts for one school's main account (newest first). */
async function listForSchool(db, schoolId, { days = LIST_DAYS, limit = LIST_LIMIT } = {}) {
  if (!schoolId) return [];
  const [rows] = await db.query(
    `SELECT id, created_at, new_value
       FROM audit_logs
      WHERE entity_type = ? AND entity_id = ?
        AND created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
      ORDER BY id DESC
      LIMIT ?`,
    [ENTITY, String(schoolId), Number(days), Number(limit)]
  );
  return (rows || []).map((r) => {
    const v = safeJson(r.new_value);
    return {
      id: r.id,
      created_at: r.created_at,
      kind: v.kind,
      subject_role: v.subject_role,
      subject_name: v.subject_name || v.subject_username || null,
      grade_scope: v.grade_scope || null,
      plate_no: v.plate_no || null,
    };
  });
}

module.exports = { ENTITY, KIND, resolveTargets, recordBindingChange, listForSchool };
