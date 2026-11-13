'use strict';

/**
 * orgEntities.service.js — province/admin management of the organisation
 * tree: create and rename an affiliation (สังกัด), rename a school, move a
 * school to another affiliation, deactivate and restore a school.
 *
 * Until 2026-11-13 none of this had an endpoint; every new สังกัด or renamed
 * school was a database edit by the admin. Callers are /api/province/* (role
 * province or admin — the province router guard).
 *
 * Rules:
 *   - Soft delete only (§12.10). A school is deactivated with is_deleted=TRUE,
 *     never removed, and restore brings it back.
 *   - Deactivation is BLOCKED (409) while the school still has active students
 *     (and therefore vehicles in use through them) or an open vehicle
 *     inspection application it issued. Those rows hold RESTRICT foreign keys
 *     and live operational meaning; the school must move or close them first.
 *   - Deactivating closes the school's own login accounts (is_active=FALSE) in
 *     the same transaction, so nobody is left signed in to a school that is no
 *     longer in the tree. Restore does NOT reopen them — the affiliation
 *     reopens what it wants from its "จัดการผู้ใช้งาน" page.
 *   - Every write is audited inside its transaction (required: true).
 *   - No schema change: affiliations/schools columns as in migration 001.
 */

const { logAudit } = require('../utils/audit');

const AFFILIATION_ID_RE = /^[A-Za-z0-9_-]{1,10}$/;
const NAME_MAX = 200;

/** Inspection applications that are still in progress. */
const OPEN_APPLICATION_STATUSES = Object.freeze([
  'DRAFT', 'READY_TO_PRINT', 'SUBMITTED', 'INSPECTION_PENDING', 'NEEDS_FIX',
]);

function httpError(message, statusCode, errors) {
  const e = new Error(message);
  e.statusCode = statusCode;
  if (errors) e.errors = errors;
  return e;
}

function cleanName(raw, label) {
  const name = String(raw ?? '').trim();
  if (!name) throw httpError(`กรุณากรอกชื่อ${label}`, 400);
  if (name.length > NAME_MAX) throw httpError(`ชื่อ${label}ยาวได้ไม่เกิน ${NAME_MAX} ตัวอักษร`, 400);
  return name;
}

async function withTx(db, fn) {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const out = await fn(conn);
    await conn.commit();
    return out;
  } catch (err) {
    try { await conn.rollback(); } catch { /* keep the original error */ }
    throw err;
  } finally {
    conn.release();
  }
}

// ─── Affiliations ────────────────────────────────────────────────────────────

async function createAffiliation(db, { id, name, actorId, ip = null, userAgent = null }) {
  const affId = String(id ?? '').trim();
  if (!AFFILIATION_ID_RE.test(affId)) {
    throw httpError('รหัสสังกัดต้องเป็นอักษรอังกฤษ ตัวเลข _ หรือ - ยาวไม่เกิน 10 ตัวอักษร', 400);
  }
  const affName = cleanName(name, 'สังกัด');
  return withTx(db, async (conn) => {
    const [[dup]] = await conn.query('SELECT id, is_deleted FROM affiliations WHERE id = ? FOR UPDATE', [affId]);
    if (dup) {
      throw httpError(dup.is_deleted
        ? `รหัสสังกัด ${affId} เคยใช้กับสังกัดที่ปิดไปแล้ว กรุณาใช้รหัสอื่น`
        : `รหัสสังกัด ${affId} มีอยู่ในระบบแล้ว`, 409);
    }
    await conn.query('INSERT INTO affiliations (id, name) VALUES (?, ?)', [affId, affName]);
    await logAudit({
      userId: actorId, action: 'CREATE', entityType: 'affiliation', entityId: affId,
      newValue: { id: affId, name: affName }, ipAddress: ip, userAgent, conn, required: true,
    });
    return { id: affId, name: affName };
  });
}

async function renameAffiliation(db, { id, name, actorId, ip = null, userAgent = null }) {
  const affName = cleanName(name, 'สังกัด');
  return withTx(db, async (conn) => {
    const [[aff]] = await conn.query(
      'SELECT id, name FROM affiliations WHERE id = ? AND is_deleted = FALSE FOR UPDATE', [String(id)]
    );
    if (!aff) throw httpError('ไม่พบสังกัดนี้', 404);
    await conn.query('UPDATE affiliations SET name = ? WHERE id = ?', [affName, aff.id]);
    await logAudit({
      userId: actorId, action: 'UPDATE', entityType: 'affiliation', entityId: aff.id,
      oldValue: { name: aff.name }, newValue: { name: affName },
      ipAddress: ip, userAgent, conn, required: true,
    });
    return { id: aff.id, name: affName };
  });
}

// ─── Schools ─────────────────────────────────────────────────────────────────

/** Rename and/or move to another (live) affiliation. */
async function updateSchool(db, { schoolId, name, affiliationId, actorId, ip = null, userAgent = null }) {
  if (name === undefined && affiliationId === undefined) throw httpError('ไม่มีข้อมูลที่ต้องแก้ไข', 400);
  const newName = name === undefined ? undefined : cleanName(name, 'โรงเรียน');
  return withTx(db, async (conn) => {
    const [[school]] = await conn.query(
      'SELECT id, name, affiliation_id FROM schools WHERE id = ? AND is_deleted = FALSE FOR UPDATE', [String(schoolId)]
    );
    if (!school) throw httpError('ไม่พบโรงเรียนนี้ หรือโรงเรียนถูกปิดใช้งานแล้ว', 404);
    const sets = [];
    const params = [];
    const after = {};
    if (newName !== undefined && newName !== school.name) {
      sets.push('name = ?'); params.push(newName); after.name = newName;
    }
    if (affiliationId !== undefined) {
      const target = String(affiliationId ?? '').trim();
      if (!target) throw httpError('กรุณาเลือกสังกัดปลายทาง', 400);
      if (target !== school.affiliation_id) {
        const [[aff]] = await conn.query(
          'SELECT id, name FROM affiliations WHERE id = ? AND is_deleted = FALSE', [target]
        );
        if (!aff) throw httpError('ไม่พบสังกัดปลายทาง หรือสังกัดถูกปิดใช้งานแล้ว', 400);
        sets.push('affiliation_id = ?'); params.push(aff.id); after.affiliation_id = aff.id;
      }
    }
    if (!sets.length) return { id: school.id, name: school.name, affiliation_id: school.affiliation_id, changed: false };
    await conn.query(`UPDATE schools SET ${sets.join(', ')} WHERE id = ?`, [...params, school.id]);
    await logAudit({
      userId: actorId, action: 'UPDATE', entityType: 'school', entityId: school.id,
      oldValue: { name: school.name, affiliation_id: school.affiliation_id },
      newValue: after, ipAddress: ip, userAgent, conn, required: true,
    });
    return {
      id: school.id,
      name: after.name ?? school.name,
      affiliation_id: after.affiliation_id ?? school.affiliation_id,
      changed: true,
    };
  });
}

/** What still depends on a school. Exported for the guard tests. */
async function schoolDependencies(conn, schoolId) {
  const [[s]] = await conn.query(
    `SELECT COUNT(*) AS students, COUNT(DISTINCT vehicle_id) AS vehicles
       FROM students WHERE school_id = ? AND is_deleted = FALSE`,
    [schoolId]
  );
  const [[a]] = await conn.query(
    `SELECT COUNT(*) AS n FROM vehicle_inspection_applications
      WHERE issuing_school_id = ? AND status IN (?)`,
    [schoolId, OPEN_APPLICATION_STATUSES]
  );
  return {
    active_students: Number(s.students) || 0,
    vehicles_in_use: Number(s.vehicles) || 0,
    open_inspection_applications: Number(a.n) || 0,
  };
}

async function deactivateSchool(db, { schoolId, reason = null, actorId, ip = null, userAgent = null }) {
  return withTx(db, async (conn) => {
    const [[school]] = await conn.query(
      'SELECT id, name, affiliation_id FROM schools WHERE id = ? AND is_deleted = FALSE FOR UPDATE', [String(schoolId)]
    );
    if (!school) throw httpError('ไม่พบโรงเรียนนี้ หรือโรงเรียนถูกปิดใช้งานแล้ว', 404);

    const deps = await schoolDependencies(conn, school.id);
    if (deps.active_students > 0 || deps.open_inspection_applications > 0) {
      const parts = [];
      if (deps.active_students > 0) parts.push(`นักเรียนที่ยังใช้งาน ${deps.active_students} คน (รถที่ใช้อยู่ ${deps.vehicles_in_use} คัน)`);
      if (deps.open_inspection_applications > 0) parts.push(`คำขอตรวจสภาพรถที่ยังไม่เสร็จ ${deps.open_inspection_applications} รายการ`);
      throw httpError(
        `ปิดใช้งานโรงเรียนไม่ได้ เพราะยังมี${parts.join(' และ ')} — ให้โรงเรียนย้ายหรือนำนักเรียนออก และปิดคำขอให้เรียบร้อยก่อน`,
        409,
        [{ code: 'SCHOOL_IN_USE', ...deps }],
      );
    }

    const [accounts] = await conn.query(
      `SELECT id FROM users
        WHERE role = 'school' AND scope_type = 'SCHOOL' AND scope_id = ?
          AND is_deleted = FALSE AND is_active = TRUE`,
      [school.id]
    );
    const accountIds = accounts.map((r) => r.id);
    if (accountIds.length) {
      await conn.query('UPDATE users SET is_active = FALSE WHERE id IN (?)', [accountIds]);
    }
    await conn.query('UPDATE schools SET is_deleted = TRUE, deleted_at = NOW() WHERE id = ?', [school.id]);
    await logAudit({
      userId: actorId, action: 'DELETE', entityType: 'school', entityId: school.id,
      oldValue: { name: school.name, affiliation_id: school.affiliation_id, is_deleted: false },
      newValue: {
        is_deleted: true, reason: reason ? String(reason).slice(0, 500) : null,
        accounts_deactivated: accountIds,
      },
      ipAddress: ip, userAgent, conn, required: true,
    });
    return { id: school.id, name: school.name, is_deleted: true, accounts_deactivated: accountIds.length };
  });
}

async function restoreSchool(db, { schoolId, actorId, ip = null, userAgent = null }) {
  return withTx(db, async (conn) => {
    const [[school]] = await conn.query(
      'SELECT id, name, affiliation_id FROM schools WHERE id = ? AND is_deleted = TRUE FOR UPDATE', [String(schoolId)]
    );
    if (!school) throw httpError('ไม่พบโรงเรียนที่ถูกปิดใช้งานนี้', 404);
    if (school.affiliation_id) {
      const [[aff]] = await conn.query(
        'SELECT id FROM affiliations WHERE id = ? AND is_deleted = FALSE', [school.affiliation_id]
      );
      if (!aff) throw httpError('สังกัดของโรงเรียนนี้ถูกปิดใช้งานแล้ว กรุณาย้ายสังกัดก่อนกู้คืน', 409);
    }
    await conn.query('UPDATE schools SET is_deleted = FALSE, deleted_at = NULL WHERE id = ?', [school.id]);
    await logAudit({
      userId: actorId, action: 'UPDATE', entityType: 'school', entityId: school.id,
      oldValue: { is_deleted: true },
      newValue: { action: 'restore', is_deleted: false, name: school.name },
      ipAddress: ip, userAgent, conn, required: true,
    });
    return { id: school.id, name: school.name, is_deleted: false };
  });
}

async function listDeactivatedSchools(db) {
  const [rows] = await db.query(
    `SELECT sc.id, sc.name, sc.affiliation_id, a.name AS affiliation_name, sc.deleted_at
       FROM schools sc
       LEFT JOIN affiliations a ON a.id = sc.affiliation_id
      WHERE sc.is_deleted = TRUE
      ORDER BY sc.deleted_at DESC, sc.name
      LIMIT 500`
  );
  return rows;
}

module.exports = {
  AFFILIATION_ID_RE,
  OPEN_APPLICATION_STATUSES,
  createAffiliation,
  renameAffiliation,
  updateSchool,
  schoolDependencies,
  deactivateSchool,
  restoreSchool,
  listDeactivatedSchools,
};
