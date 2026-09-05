'use strict';

const express = require('express');
const bcrypt = require('bcrypt');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/roleGuard');
const { sendSuccess, sendError } = require('../utils/response');
const { readIdParam } = require('../utils/pathParams');
const { pool } = require('../config/database');
const { logAudit } = require('../utils/audit');
const adminSvc = require('../services/admin.service');
const termSvc = require('../services/term.service');
const { importExportLimiter, exportFormatLimiter } = require('../middleware/rateLimiters');
const ppSvc = require('../services/pickupPoint.service');
const vllSvc = require('../services/vehicleLocation.service');
const ExcelJS = require('exceljs');
const { csvCell, neutralizeSpreadsheetCell, redactAuditValue } = require('../utils/exportSecurity');
const { rejectOverLongFields } = require('../utils/fieldLength');
const { isCalendarDate } = require('../utils/calendarDate');
const researchReadinessSvc = require('../services/researchReadiness.service');
const { RESEARCH_PROTOCOL, EXTERNAL_EVIDENCE_REGISTRY } = require('../config/researchProtocol');
const { METRICS: RESEARCH_METRICS } = require('../config/researchMetrics');
const { todayBangkok } = require('../utils/thaiTime');

/**
 * Audit entity types that stand in for the named events each metric requires.
 * Kept next to the query that reads them so a new required_event in the metric
 * registry fails loudly here instead of silently counting as "no evidence".
 */
const RESEARCH_EVENT_ENTITY_TYPES = [
  ...new Set(RESEARCH_METRICS.flatMap((m) => m.required_events || [])),
];

/**
 * Builds the evidence context for the readiness service from live data.
 * Read-only: it counts rows, it never asserts a readiness value itself.
 */
async function loadResearchEvidenceContext() {
  const [[snapAgg]] = await pool.query(
    `SELECT MAX(snapshot_date) AS latest_date,
            MAX(CASE WHEN is_baseline = TRUE THEN snapshot_date END) AS baseline_date,
            COUNT(*) AS snapshot_count
       FROM daily_snapshots`
  );

  let auditEventCounts = {};
  let auditEventLatestDate = {};
  if (RESEARCH_EVENT_ENTITY_TYPES.length) {
    const placeholders = RESEARCH_EVENT_ENTITY_TYPES.map(() => '?').join(',');
    const [eventRows] = await pool.query(
      `SELECT entity_type, COUNT(*) AS cnt, MAX(created_at) AS latest
         FROM audit_logs WHERE entity_type IN (${placeholders})
        GROUP BY entity_type`,
      RESEARCH_EVENT_ENTITY_TYPES
    );
    for (const row of eventRows) {
      auditEventCounts[row.entity_type] = Number(row.cnt) || 0;
      auditEventLatestDate[row.entity_type] = row.latest ? todayBangkok(row.latest) : null;
    }
  }

  const [roleTotals] = await pool.query(
    `SELECT u.role AS role, COUNT(*) AS cnt
       FROM audit_logs al LEFT JOIN users u ON u.id = al.user_id
      WHERE u.role IS NOT NULL
      GROUP BY u.role`
  );
  const roleActionTotals = {};
  for (const r of roleTotals) roleActionTotals[r.role] = Number(r.cnt) || 0;

  return {
    latestSnapshotDate: snapAgg?.latest_date || null,
    baselineSnapshotDate: snapAgg?.baseline_date || null,
    snapshotCount: Number(snapAgg?.snapshot_count) || 0,
    auditEventCounts,
    auditEventLatestDate,
    roleActionTotals,
    externalEvidence: EXTERNAL_EVIDENCE_REGISTRY,
    protocol: RESEARCH_PROTOCOL,
  };
}

function calcDelta(baseline, latest, numField, denField) {
  const bPct = baseline[denField] > 0 ? (baseline[numField] / baseline[denField]) * 100 : 0;
  const cPct = latest[denField] > 0 ? (latest[numField] / latest[denField]) * 100 : 0;
  return Math.round((cPct - bPct) * 100) / 100;
}

const BCRYPT_COST = 12;
const VALID_ROLES = ['driver', 'school', 'affiliation', 'province', 'transport', 'admin'];
const SCOPED_ROLES = { school: 'SCHOOL', affiliation: 'AFFILIATION', province: 'PROVINCE' };
const { VALID_GRADE_SCOPES, isValidGradeScope } = require('../utils/gradeScope');
const { validatePassword } = require('../utils/passwordPolicy');

// All admin routes require admin role
router.use(authenticate, requireRole('admin'));

// ─── GET /api/admin/users ───────────────────────────────────────────────────
router.get('/users', async (req, res, next) => {
  try {
    const { role, is_active, search } = req.query;
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const per_page = Math.min(100, Math.max(1, parseInt(req.query.per_page, 10) || 50));
    const offset = (page - 1) * per_page;

    // Soft-delete visibility (default: active accounts only — unchanged contract).
    // only_deleted powers the "restore a deleted account" picker; include_deleted shows both.
    const includeDeleted = req.query.include_deleted === '1' || req.query.include_deleted === 'true';
    const onlyDeleted = req.query.only_deleted === '1' || req.query.only_deleted === 'true';

    let where = onlyDeleted ? 'u.is_deleted = TRUE' : (includeDeleted ? '1=1' : 'u.is_deleted = FALSE');
    const params = [];
    if (role) { where += ' AND u.role = ?'; params.push(role); }
    if (is_active !== undefined) { where += ' AND u.is_active = ?'; params.push(is_active === 'true' ? 1 : 0); }
    if (search) { where += ' AND (u.username LIKE ? OR u.display_name LIKE ?)'; params.push(`%${search}%`, `%${search}%`); }

    const [rows] = await pool.query(
      `SELECT u.id, u.username, u.role, u.scope_type, u.scope_id, u.grade_scope, u.display_name,
              u.is_active, u.is_deleted, u.deleted_at, u.must_change_password, u.last_login, u.created_at,
              CASE WHEN u.scope_type = 'SCHOOL' THEN (SELECT name FROM schools WHERE id = u.scope_id)
                   WHEN u.scope_type = 'AFFILIATION' THEN (SELECT name FROM affiliations WHERE id = u.scope_id)
                   ELSE NULL END AS scope_name
       FROM users u WHERE ${where}
       ORDER BY u.role, u.username
       LIMIT ? OFFSET ?`,
      [...params, per_page, offset]
    );

    const [[{ total }]] = await pool.query(
      `SELECT COUNT(*) AS total FROM users u WHERE ${where}`, params
    );

    return sendSuccess(res, rows, 'OK', { page, per_page, total });
  } catch (err) { next(err); }
});

// ─── POST /api/admin/users ──────────────────────────────────────────────────
router.post('/users', async (req, res, next) => {
  try {
    const { username, password, role, scope_id, display_name, grade_scope } = req.body;

    if (!username || !password || !role) {
      return sendError(res, 'username, password, และ role จำเป็น', [], 400);
    }
    if (!VALID_ROLES.includes(role)) {
      return sendError(res, `role ไม่ถูกต้อง ต้องเป็น: ${VALID_ROLES.join(', ')}`, [], 400);
    }
    // users.username varchar(100), display_name varchar(200), scope_id varchar(20).
    if (rejectOverLongFields(res, req.body, {
      username: 100, display_name: 200, scope_id: 20,
    })) return;
    const pwCheck = validatePassword(password, { username: String(username).trim() });
    if (!pwCheck.ok) {
      return sendError(res, pwCheck.message, [], 400);
    }

    // Validate scope
    const scopeType = SCOPED_ROLES[role] || null;
    if (scopeType && !scope_id) {
      return sendError(res, `role "${role}" ต้องระบุ scope_id`, [], 400);
    }
    if (scopeType === 'SCHOOL') {
      const [[school]] = await pool.query('SELECT id FROM schools WHERE id = ? AND is_deleted = FALSE', [scope_id]);
      if (!school) return sendError(res, 'ไม่พบโรงเรียนที่ระบุ', [], 400);
    }
    if (scopeType === 'AFFILIATION') {
      const [[aff]] = await pool.query('SELECT id FROM affiliations WHERE id = ? AND is_deleted = FALSE', [scope_id]);
      if (!aff) return sendError(res, 'ไม่พบสังกัดที่ระบุ', [], 400);
    }

    // Phase 7.11.5 — optional grade_scope. Only valid on school role;
    // value must be one of the 15 canonical Thai grades (mirrors the
    // CHECK constraint defined in migration 018).
    let gradeScopeValue = null;
    if (grade_scope != null && String(grade_scope).trim() !== '') {
      if (role !== 'school') {
        return sendError(res, 'grade_scope ใช้ได้เฉพาะ role=school', [], 400);
      }
      if (!isValidGradeScope(grade_scope)) {
        return sendError(res, `grade_scope ต้องเป็นค่าใดค่าหนึ่งใน: ${VALID_GRADE_SCOPES.join(', ')}`, [], 400);
      }
      gradeScopeValue = String(grade_scope).trim();
    }

    // Check duplicate username
    const [[existing]] = await pool.query('SELECT id FROM users WHERE username = ? AND is_deleted = FALSE', [username.trim()]);
    if (existing) return sendError(res, 'ชื่อผู้ใช้นี้มีอยู่ในระบบแล้ว', [], 409);

    const hash = await bcrypt.hash(String(password), BCRYPT_COST);
    const [result] = await pool.query(
      `INSERT INTO users (username, password_hash, role, scope_type, scope_id, grade_scope, display_name, must_change_password)
       VALUES (?, ?, ?, ?, ?, ?, ?, TRUE)`,
      [username.trim(), hash, role, scopeType, scope_id || null, gradeScopeValue, display_name || username.trim()]
    );

    await logAudit({
      userId: req.user.id, action: 'CREATE', entityType: 'user', entityId: result.insertId,
      newValue: { username: username.trim(), role, scope_type: scopeType, scope_id, grade_scope: gradeScopeValue },
      ipAddress: req.ip, userAgent: req.headers['user-agent'],
    });

    return sendSuccess(res,
      { id: result.insertId, username: username.trim(), role, grade_scope: gradeScopeValue },
      'สร้างผู้ใช้สำเร็จ', null, 201);
  } catch (err) { next(err); }
});

// ─── PUT /api/admin/users/:id ───────────────────────────────────────────────
router.put('/users/:id', async (req, res, next) => {
  try {
    const userId = readIdParam(req, res, 'id');
    if (userId === null) return;
    const { display_name, is_active, role, scope_id } = req.body;
    if (rejectOverLongFields(res, req.body, { display_name: 200, scope_id: 20 })) return;

    const [[user]] = await pool.query('SELECT id, username, role, scope_type, scope_id, display_name, is_active, driver_id FROM users WHERE id = ? AND is_deleted = FALSE', [userId]);
    if (!user) return sendError(res, 'ไม่พบผู้ใช้', [], 404);

    // Phase 10.13A-23C — block re-activating a dedupe-disabled / broken driver
    // account (FALSE → TRUE for role='driver'). Runs BEFORE any write so the
    // user is never partially updated. Non-drivers and non-reactivations pass.
    const reactivating = is_active !== undefined && (is_active ? 1 : 0) === 1 && !user.is_active;
    let reactivationWarning = null;
    if (reactivating && user.role === 'driver') {
      const { detectDriverReactivationBlock } = require('../utils/driverReactivation');
      const block = await detectDriverReactivationBlock(pool, user);
      if (block.blocked) {
        // Phase 10.13A-27 — audit the blocked attempt so repeated reactivation
        // tries on a dedupe-disabled driver are traceable.
        await logAudit({
          userId: req.user.id, action: 'UPDATE', entityType: 'user', entityId: String(userId),
          oldValue: { is_active: false },
          newValue: { reactivation_blocked: true, reason: block.reason, canonical_user_id: block.canonicalUserId },
          ipAddress: req.ip, userAgent: req.headers['user-agent'],
        });
        return sendError(
          res,
          'ไม่สามารถเปิดใช้งานบัญชีคนขับนี้ได้ เนื่องจากเป็นบัญชีซ้ำหรือเชื่อมโยงกับรถที่ถูกปิดใช้งานแล้ว กรุณาใช้บัญชีหลักที่ถูกต้อง',
          [{ code: 'DRIVER_REACTIVATION_BLOCKED', reason: block.reason, canonical_user_id: block.canonicalUserId }],
          409
        );
      }
      // Phase 10.13C — NO_ACTIVE_VEHICLE no longer blocks reactivation; keep it on
      // the audit trail so a restore-without-active-vehicle stays traceable.
      if (block.warning) reactivationWarning = block.reason;
    }

    const updates = [];
    const params = [];
    if (display_name !== undefined) { updates.push('display_name = ?'); params.push(display_name); }
    if (is_active !== undefined) { updates.push('is_active = ?'); params.push(is_active ? 1 : 0); }
    if (role && VALID_ROLES.includes(role)) {
      const scopeType = SCOPED_ROLES[role] || null;
      updates.push('role = ?', 'scope_type = ?', 'scope_id = ?');
      params.push(role, scopeType, scope_id || null);
      // L6 — a role change away from 'school' must drop any stale grade_scope
      // (the create path already rejects grade_scope for non-school roles).
      if (role !== 'school') updates.push('grade_scope = NULL');
      // L1 — a role/scope change must invalidate the user's existing access AND
      // refresh tokens. Bumping password_changed_at trips the iat<password_changed_at
      // guard in auth.js and /refresh-token, forcing a re-login under the new
      // role/scope (otherwise the stale elevated role survives up to the token TTL).
      if (role !== user.role || (scope_id || null) !== (user.scope_id || null) || scopeType !== user.scope_type) {
        updates.push('password_changed_at = NOW()');
      }
    }

    if (updates.length === 0) return sendError(res, 'ไม่มีข้อมูลที่ต้องแก้ไข', [], 400);

    params.push(userId);
    await pool.query(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`, params);

    await logAudit({
      userId: req.user.id, action: 'UPDATE', entityType: 'user', entityId: userId,
      oldValue: { display_name: user.display_name, is_active: user.is_active, role: user.role },
      newValue: { display_name, is_active, role, ...(reactivationWarning ? { reactivation_warning: reactivationWarning } : {}) },
      ipAddress: req.ip, userAgent: req.headers['user-agent'],
    });

    return sendSuccess(res, null, reactivationWarning === 'NO_ACTIVE_VEHICLE'
      ? 'เปิดใช้งานบัญชีคนขับแล้ว · คนขับนี้ยังไม่มีรถที่ใช้งาน ควรมอบหมายรถให้'
      : 'อัปเดตผู้ใช้สำเร็จ');
  } catch (err) { next(err); }
});

// ─── POST /api/admin/users/:id/reset-password ───────────────────────────────
router.post('/users/:id/reset-password', async (req, res, next) => {
  try {
    const userId = readIdParam(req, res, 'id');
    if (userId === null) return;
    const { password } = req.body;

    if (!password) {
      return sendError(res, 'รหัสผ่านใหม่จำเป็น', [], 400);
    }

    const [[user]] = await pool.query('SELECT id, username FROM users WHERE id = ? AND is_deleted = FALSE', [userId]);
    if (!user) return sendError(res, 'ไม่พบผู้ใช้', [], 404);

    // Strength check after the lookup so the username-equality rule sees the
    // target user's username.
    const pwCheck = validatePassword(password, { username: user.username });
    if (!pwCheck.ok) {
      return sendError(res, pwCheck.message, [], 400);
    }

    const hash = await bcrypt.hash(String(password), BCRYPT_COST);
    await pool.query(
      // Phase 10.12D — set password_changed_at = NOW() so any refresh token
      // issued before the reset is rejected (H3 — invalidate old sessions).
      'UPDATE users SET password_hash = ?, must_change_password = TRUE, password_changed_at = NOW() WHERE id = ?',
      [hash, userId]
    );

    await logAudit({
      userId: req.user.id, action: 'UPDATE', entityType: 'user', entityId: userId,
      newValue: { action: 'reset_password', target_username: user.username },
      ipAddress: req.ip, userAgent: req.headers['user-agent'],
    });

    return sendSuccess(res, null, 'รีเซ็ตรหัสผ่านสำเร็จ — ผู้ใช้จะต้องเปลี่ยนรหัสผ่านเมื่อ login ครั้งถัดไป');
  } catch (err) { next(err); }
});

// ─── DELETE /api/admin/users/:id ────────────────────────────────────────────
router.delete('/users/:id', async (req, res, next) => {
  try {
    const userId = readIdParam(req, res, 'id');
    if (userId === null) return;
    if (userId === req.user.id) return sendError(res, 'ไม่สามารถลบตัวเองได้', [], 400);

    const [[user]] = await pool.query('SELECT id, username FROM users WHERE id = ? AND is_deleted = FALSE', [userId]);
    if (!user) return sendError(res, 'ไม่พบผู้ใช้', [], 404);

    await pool.query('UPDATE users SET is_deleted = TRUE, deleted_at = NOW() WHERE id = ?', [userId]);

    await logAudit({
      userId: req.user.id, action: 'DELETE', entityType: 'user', entityId: userId,
      oldValue: { username: user.username },
      ipAddress: req.ip, userAgent: req.headers['user-agent'],
    });

    return sendSuccess(res, null, 'ลบผู้ใช้สำเร็จ');
  } catch (err) { next(err); }
});

// ─── POST /api/admin/users/:id/restore ──────────────────────────────────────
// Reverses DELETE /users/:id (soft-delete). Restores generic accounts DEACTIVATED
// (admin re-enables login via PUT). Driver accounts are delegated to the
// 23C-guarded driver lifecycle restore (duplicate-reactivation guard).
router.post('/users/:id/restore', async (req, res, next) => {
  try {
    const userId = readIdParam(req, res, 'id');
    if (userId === null) return;

    const [[u]] = await pool.query('SELECT id, role FROM users WHERE id = ?', [userId]);
    if (!u) return sendError(res, 'ไม่พบผู้ใช้', [], 404);

    if (u.role === 'driver') {
      const dl = require('../services/driverLifecycle.service');
      const reason = (req.body || {}).reason;
      if (!String(reason || '').trim()) return sendError(res, 'กรุณาระบุเหตุผล', [], 400);
      const out = await dl.restoreDriver(pool, { userId, reason, actorId: req.user.id });
      return sendSuccess(res, out, out.status === 'RESTORED' ? 'กู้คืนบัญชีคนขับสำเร็จ' : 'บัญชีนี้ใช้งานอยู่แล้ว');
    }

    const out = await adminSvc.restoreUser(pool, {
      userId, actorId: req.user.id, ip: req.ip, userAgent: req.headers['user-agent'],
    });
    return sendSuccess(res, out, out.status === 'RESTORED'
      ? 'กู้คืนบัญชีผู้ใช้สำเร็จ (สถานะปิดใช้งาน — เปิดใช้งานได้ภายหลัง)'
      : 'บัญชีนี้ใช้งานอยู่แล้ว');
  } catch (err) { next(err); }
});

// ─── GET /api/admin/users-needing-action ────────────────────────────────────
// Top N users where is_active=FALSE OR must_change_password=TRUE.
// Returns { total, rows } so the Admin Attention Panel badge can show
// the true total count even when only a top-N preview is rendered.
// limit clamped to [1, 100] inside the service.
router.get('/users-needing-action', async (req, res, next) => {
  try {
    const data = await adminSvc.getUsersNeedingAction({ limit: req.query.limit });
    return sendSuccess(res, data);
  } catch (err) { next(err); }
});

// ─── GET /api/admin/roster-requests-pending ─────────────────────────────────
// Top N pending roster_change_requests across the whole system, oldest
// first to surface SLA risk. School-scope endpoints already exist for
// approvals; this is the admin's at-a-glance backlog visibility.
// Returns { total, rows }; limit clamped to [1, 100] inside the service.
router.get('/roster-requests-pending', async (req, res, next) => {
  try {
    const data = await adminSvc.getPendingRosterRequestsSystemWide({ limit: req.query.limit });
    return sendSuccess(res, data);
  } catch (err) { next(err); }
});

// ─── Pickup-point CRUD (Phase 6) ────────────────────────────────────────────
// Validation helper — shared by POST + PUT routes.
function validatePickupPointInput(input, { partial = false } = {}) {
  const errors = [];
  const isPresent = (k) => input[k] !== undefined && input[k] !== null && input[k] !== '';

  if (!partial && !isPresent('vehicle_id')) errors.push({ field: 'vehicle_id', message: 'vehicle_id required' });

  if (!partial || isPresent('label')) {
    if (!isPresent('label')) errors.push({ field: 'label', message: 'label required' });
    else if (String(input.label).length > 100) errors.push({ field: 'label', message: 'label must be ≤ 100 chars' });
  }

  if (!partial || isPresent('latitude')) {
    const lat = parseFloat(input.latitude);
    if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
      errors.push({ field: 'latitude', message: 'latitude must be a number in [-90, 90]' });
    }
  }
  if (!partial || isPresent('longitude')) {
    const lng = parseFloat(input.longitude);
    if (!Number.isFinite(lng) || lng < -180 || lng > 180) {
      errors.push({ field: 'longitude', message: 'longitude must be a number in [-180, 180]' });
    }
  }
  if (isPresent('session') && !['morning', 'evening', 'both'].includes(input.session)) {
    errors.push({ field: 'session', message: "session must be 'morning', 'evening', or 'both'" });
  }
  return errors;
}

// GET /api/admin/pickup-points?vehicle_id=&page=&per_page=
router.get('/pickup-points', async (req, res, next) => {
  try {
    const { vehicle_id, page, per_page } = req.query;
    const result = await ppSvc.listPickupPoints({ vehicle_id, page, per_page });
    return sendSuccess(res, result.rows, 'OK', result.meta);
  } catch (err) { next(err); }
});

// POST /api/admin/pickup-points
router.post('/pickup-points', async (req, res, next) => {
  try {
    const errors = validatePickupPointInput(req.body);
    if (errors.length > 0) return sendError(res, 'ข้อมูลจุดรับส่งไม่ถูกต้อง', errors, 400);

    if (!(await ppSvc.vehicleExists(req.body.vehicle_id))) {
      return sendError(res, 'ไม่พบรถที่ระบุ', [], 400);
    }

    const id = await ppSvc.createPickupPoint(req.body);
    await logAudit({
      userId: req.user.id, action: 'CREATE', entityType: 'pickup_point', entityId: id,
      newValue: {
        vehicle_id: req.body.vehicle_id,
        label: String(req.body.label).trim(),
        latitude: parseFloat(req.body.latitude),
        longitude: parseFloat(req.body.longitude),
        session: req.body.session || 'both',
      },
      ipAddress: req.ip, userAgent: req.headers['user-agent'],
    });
    return sendSuccess(res, { id }, 'สร้างจุดรับส่งสำเร็จ', null, 201);
  } catch (err) { next(err); }
});

// PUT /api/admin/pickup-points/:id
router.put('/pickup-points/:id', async (req, res, next) => {
  try {
    const id = readIdParam(req, res, 'id');
    if (id === null) return;

    const errors = validatePickupPointInput(req.body, { partial: true });
    if (errors.length > 0) return sendError(res, 'ข้อมูลจุดรับส่งไม่ถูกต้อง', errors, 400);

    const oldRow = await ppSvc.getPickupPointById(id);
    if (!oldRow) return sendError(res, 'ไม่พบจุดรับส่ง', [], 404);

    const ok = await ppSvc.updatePickupPoint(id, req.body);
    if (!ok) return sendError(res, 'ไม่มีข้อมูลที่ต้องแก้ไข', [], 400);

    const newRow = await ppSvc.getPickupPointById(id);
    await logAudit({
      userId: req.user.id, action: 'UPDATE', entityType: 'pickup_point', entityId: id,
      oldValue: { label: oldRow.label, latitude: oldRow.latitude, longitude: oldRow.longitude, session: oldRow.session, sequence: oldRow.sequence, notes: oldRow.notes },
      newValue: { label: newRow.label, latitude: newRow.latitude, longitude: newRow.longitude, session: newRow.session, sequence: newRow.sequence, notes: newRow.notes },
      ipAddress: req.ip, userAgent: req.headers['user-agent'],
    });
    return sendSuccess(res, null, 'อัปเดตจุดรับส่งสำเร็จ');
  } catch (err) { next(err); }
});

// DELETE /api/admin/pickup-points/:id (soft-delete)
router.delete('/pickup-points/:id', async (req, res, next) => {
  try {
    const id = readIdParam(req, res, 'id');
    if (id === null) return;

    const oldRow = await ppSvc.getPickupPointById(id);
    if (!oldRow) return sendError(res, 'ไม่พบจุดรับส่ง', [], 404);

    await ppSvc.softDeletePickupPoint(id);
    await logAudit({
      userId: req.user.id, action: 'DELETE', entityType: 'pickup_point', entityId: id,
      oldValue: { vehicle_id: oldRow.vehicle_id, label: oldRow.label, latitude: oldRow.latitude, longitude: oldRow.longitude },
      ipAddress: req.ip, userAgent: req.headers['user-agent'],
    });
    return sendSuccess(res, null, 'ลบจุดรับส่งสำเร็จ');
  } catch (err) { next(err); }
});

// POST /api/admin/pickup-points/:id/students  { student_id }
router.post('/pickup-points/:id/students', async (req, res, next) => {
  try {
    const pointId = readIdParam(req, res, 'id');
    if (pointId === null) return;
    const studentId = parseInt(req.body.student_id, 10);
    if (!Number.isInteger(studentId) || studentId <= 0) return sendError(res, 'invalid student_id', [], 400);

    const point = await ppSvc.getPickupPointById(pointId);
    if (!point) return sendError(res, 'ไม่พบจุดรับส่ง', [], 404);
    if (!(await ppSvc.studentExists(studentId))) return sendError(res, 'ไม่พบนักเรียน', [], 404);

    const inserted = await ppSvc.assignStudentToPoint(pointId, studentId);
    if (inserted) {
      await logAudit({
        userId: req.user.id, action: 'CREATE', entityType: 'student_pickup_point',
        entityId: `${pointId}:${studentId}`,
        newValue: { pickup_point_id: pointId, student_id: studentId },
        ipAddress: req.ip, userAgent: req.headers['user-agent'],
      });
    }
    return sendSuccess(res, null, inserted ? 'ผูกนักเรียนกับจุดรับส่งสำเร็จ' : 'ผูกอยู่แล้ว');
  } catch (err) { next(err); }
});

// DELETE /api/admin/pickup-points/:id/students/:studentId
router.delete('/pickup-points/:id/students/:studentId', async (req, res, next) => {
  try {
    const pointId = readIdParam(req, res, 'id');
    if (pointId === null) return;
    const studentId = readIdParam(req, res, 'studentId');
    if (studentId === null) return;

    const removed = await ppSvc.unassignStudentFromPoint(pointId, studentId);
    if (!removed) return sendError(res, 'ไม่พบการผูกนักเรียนกับจุดนี้', [], 404);

    await logAudit({
      userId: req.user.id, action: 'DELETE', entityType: 'student_pickup_point',
      entityId: `${pointId}:${studentId}`,
      oldValue: { pickup_point_id: pointId, student_id: studentId },
      ipAddress: req.ip, userAgent: req.headers['user-agent'],
    });
    return sendSuccess(res, null, 'ยกเลิกการผูกนักเรียนสำเร็จ');
  } catch (err) { next(err); }
});

// GET /api/admin/pickup-points/:id/assignable-students
// Phase 6.1 hotfix-8: parity with /driver/* and /school/* — feeds the
// shared PickupStudentsModal. No scope filter (admin sees all students
// on the point's vehicle); currently-assigned students are flagged so
// the modal pre-checks them.
router.get('/pickup-points/:id/assignable-students', async (req, res, next) => {
  try {
    const pointId = readIdParam(req, res, 'id');
    if (pointId === null) return;

    const point = await ppSvc.getPickupPointById(pointId);
    if (!point) return sendError(res, 'ไม่พบจุดรับส่ง', [], 404);

    const students = await ppSvc.getAssignableStudentsForPickupPoint(point);
    return sendSuccess(res, { point, students });
  } catch (err) { next(err); }
});

// PUT /api/admin/pickup-points/:id/students  { student_ids: [...] }
// Phase 6.1 hotfix-8: replace-the-whole-list workflow used by the shared
// PickupStudentsModal. Admin scope: every student must belong to the
// point's vehicle, no cross-point session conflicts (this point is
// excluded from the duplicate check).
router.put('/pickup-points/:id/students', async (req, res, next) => {
  try {
    const pointId = readIdParam(req, res, 'id');
    if (pointId === null) return;

    if (!Array.isArray(req.body.student_ids)) {
      return sendError(res, 'student_ids must be an array', [], 400);
    }
    const studentIds = req.body.student_ids.map(Number).filter(Number.isInteger);

    const point = await ppSvc.getPickupPointById(pointId);
    if (!point) return sendError(res, 'ไม่พบจุดรับส่ง', [], 404);

    if (studentIds.length > 0) {
      const ok = await ppSvc.validateStudentsBelongToVehicle(studentIds, point.vehicle_id);
      if (!ok) return sendError(res, 'นักเรียนบางรายไม่ใช่ของรถคันนี้', [], 400);

      const noDup = await ppSvc.validateNoDuplicateAssignmentsForVehicle(
        studentIds, point.vehicle_id, point.session, { excludePointId: pointId }
      );
      if (!noDup) return sendError(res, 'นักเรียนบางรายมีจุดรับส่งในรอบนี้แล้ว', [], 400);
    }

    const result = await ppSvc.replacePickupPointStudents(pointId, studentIds, {
      actorId: req.user.id,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return sendSuccess(res, result, 'อัปเดตรายชื่อนักเรียนสำเร็จ');
  } catch (err) { next(err); }
});

// ─── GET /api/admin/audit-logs ──────────────────────────────────────────────
router.get('/audit-logs', exportFormatLimiter, async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const per_page = Math.min(100, Math.max(1, parseInt(req.query.per_page, 10) || 30));
    const offset = (page - 1) * per_page;
    const { action, date_from, date_to } = req.query;

    // Was /^\d{4}-\d{2}-\d{2}$/, which accepts 2026-13-45. Same predicate as
     // /api/reports uses, so the four routers no longer disagree. The
     // ignore-if-invalid behaviour below is unchanged.
    const isValidDate = isCalendarDate;
    let where = '1=1';
    const params = [];
    if (action) { where += ' AND al.action = ?'; params.push(action); }
    if (date_from && isValidDate(date_from)) { where += ' AND al.created_at >= ?'; params.push(`${date_from} 00:00:00`); }
    if (date_to && isValidDate(date_to)) { where += ' AND al.created_at <= ?'; params.push(`${date_to} 23:59:59`); }

    // CSV export
    if (req.query.format === 'csv') {
      const [rows] = await pool.query(
        `SELECT al.id, al.action, al.entity_type, al.entity_id,
                al.old_value, al.new_value, al.created_at,
                u.display_name AS actor_name, u.role AS actor_role
         FROM audit_logs al LEFT JOIN users u ON u.id = al.user_id
         WHERE ${where} ORDER BY al.created_at DESC LIMIT 5001`, params
      );
      // Audit 2026-06-18 (limitations): detect truncation instead of silently capping.
      const truncated = rows.length > 5000;
      // Phase 10.12G — neutralise every cell + redact PII from audit values.
      const esc = csvCell;
      const header = 'วันเวลา,ผู้ดำเนินการ,บทบาท,การกระทำ,ประเภท,รหัส,ค่าเดิม,ค่าใหม่';
      const lines = rows.slice(0, 5000).map(r => [
        esc(new Date(r.created_at).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' })),
        esc(r.actor_name), esc(r.actor_role), esc(r.action),
        esc(r.entity_type), esc(r.entity_id),
        esc(r.old_value ? redactAuditValue(r.old_value) : ''),
        esc(r.new_value ? redactAuditValue(r.new_value) : ''),
      ].join(','));
      if (truncated) lines.push(esc('# \u0E41\u0E2A\u0E14\u0E07 5000 \u0E41\u0E16\u0E27\u0E25\u0E48\u0E32\u0E2A\u0E38\u0E14 \u2014 \u0E23\u0E30\u0E1A\u0E38\u0E0A\u0E48\u0E27\u0E07\u0E27\u0E31\u0E19\u0E17\u0E35\u0E48\u0E40\u0E1E\u0E37\u0E48\u0E2D\u0E14\u0E39\u0E17\u0E31\u0E49\u0E07\u0E2B\u0E21\u0E14'));
      const csv = [header, ...lines].join('\n');
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename=audit_admin_${todayBangkok()}.csv`);
      if (truncated) res.setHeader('X-Truncated', 'true');
      return res.send('\uFEFF' + csv);
    }

    const [[{ total }]] = await pool.query(
      `SELECT COUNT(*) AS total FROM audit_logs al WHERE ${where}`, params
    );

    const [rows] = await pool.query(
      `SELECT al.id, al.user_id, al.action, al.entity_type, al.entity_id,
              al.old_value, al.new_value, al.created_at,
              u.display_name AS actor_name, u.role AS actor_role
       FROM audit_logs al
       LEFT JOIN users u ON u.id = al.user_id
       WHERE ${where}
       ORDER BY al.created_at DESC
       LIMIT ? OFFSET ?`,
      [...params, per_page, offset]
    );

    // Phase 10.13B-1 — redact/mask PII (phones, LINE ids, secrets) in the
    // old/new audit values before returning JSON, matching the CSV export.
    // redactAuditValue is imported once at module scope (top of file). Do NOT
    // re-declare it here: a function-scoped `const` shadowed it across the whole
    // handler and put the CSV branch above in a temporal dead zone, throwing
    // "Cannot access 'redactAuditValue' before initialization" (500 on ?format=csv).
    const redactVal = (v) => {
      if (v === null || v === undefined) return v;
      const s = redactAuditValue(v);
      try { return JSON.parse(s); } catch { return s; }
    };
    const safeRows = rows.map((r) => ({ ...r, old_value: redactVal(r.old_value), new_value: redactVal(r.new_value) }));

    return sendSuccess(res, safeRows, 'OK', { page, per_page, total });
  } catch (err) { next(err); }
});

// ─── GET /api/admin/system-health ──────────────────────────────────────────
router.get('/system-health', async (req, res, next) => {
  try {
    // Active users (logged in within 30 days)
    const [[activeUsers]] = await pool.query(
      `SELECT COUNT(*) AS active_30d FROM users
       WHERE is_deleted = FALSE AND is_active = TRUE
         AND last_login >= DATE_SUB(NOW(), INTERVAL 30 DAY)`
    );
    const [[totalUsers]] = await pool.query(
      `SELECT COUNT(*) AS total FROM users WHERE is_deleted = FALSE`
    );

    // Password resets this month
    const [[pwResets]] = await pool.query(
      `SELECT COUNT(*) AS cnt FROM audit_logs
       WHERE action = 'UPDATE' AND entity_type = 'password'
         AND created_at >= DATE_FORMAT(NOW(), '%Y-%m-01')`
    );

    // Top 5 features used (by entity_type, last 30 days)
    const [topFeatures] = await pool.query(
      `SELECT entity_type, COUNT(*) AS cnt FROM audit_logs
       WHERE created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
         AND entity_type IS NOT NULL AND entity_type != ''
       GROUP BY entity_type ORDER BY cnt DESC LIMIT 5`
    );

    // Bottom 5 features (least used entity_types that have ever been used)
    const [bottomFeatures] = await pool.query(
      `SELECT entity_type, COUNT(*) AS cnt FROM audit_logs
       WHERE created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
         AND entity_type IS NOT NULL AND entity_type != ''
       GROUP BY entity_type ORDER BY cnt ASC LIMIT 5`
    );

    // Action breakdown (last 30 days)
    const [actionBreakdown] = await pool.query(
      `SELECT action, COUNT(*) AS cnt FROM audit_logs
       WHERE created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
       GROUP BY action ORDER BY cnt DESC`
    );

    // Daily activity (last 14 days)
    const [dailyActivity] = await pool.query(
      `SELECT DATE(created_at) AS date, COUNT(*) AS cnt FROM audit_logs
       WHERE created_at >= DATE_SUB(NOW(), INTERVAL 14 DAY)
       GROUP BY DATE(created_at) ORDER BY date`
    );

    // Role activity (last 30 days)
    const [roleActivity] = await pool.query(
      `SELECT u.role, COUNT(*) AS cnt FROM audit_logs al
       LEFT JOIN users u ON u.id = al.user_id
       WHERE al.created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
       GROUP BY u.role ORDER BY cnt DESC`
    );

    // Login count (last 30 days)
    const [[loginCount]] = await pool.query(
      `SELECT COUNT(*) AS cnt FROM audit_logs
       WHERE action = 'LOGIN' AND created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)`
    );

    // Error count: approximate from failed logins
    const [[errorApprox]] = await pool.query(
      `SELECT COUNT(*) AS cnt FROM audit_logs
       WHERE action = 'LOGIN' AND entity_type = 'auth_failure'
         AND created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)`
    );

    // Website visits — Bangkok-time daily aggregates
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });
    const [[visitsToday]] = await pool.query(
      `SELECT COALESCE(total_visits,0) AS total,
              COALESCE(public_visits,0) AS public_v,
              COALESCE(logged_in_visits,0) AS logged_v
       FROM daily_visits WHERE visit_date = ?`,
      [today]
    );
    const [[visits7d]] = await pool.query(
      `SELECT COALESCE(SUM(total_visits),0) AS total,
              COALESCE(SUM(public_visits),0) AS public_v,
              COALESCE(SUM(logged_in_visits),0) AS logged_v
       FROM daily_visits WHERE visit_date >= DATE_SUB(?, INTERVAL 6 DAY)`,
      [today]
    );
    const [[visits30d]] = await pool.query(
      `SELECT COALESCE(SUM(total_visits),0) AS total,
              COALESCE(SUM(public_visits),0) AS public_v,
              COALESCE(SUM(logged_in_visits),0) AS logged_v
       FROM daily_visits WHERE visit_date >= DATE_SUB(?, INTERVAL 29 DAY)`,
      [today]
    );

    return sendSuccess(res, {
      active_users_30d: activeUsers.active_30d,
      total_users: totalUsers.total,
      password_resets_this_month: pwResets.cnt,
      logins_30d: loginCount.cnt,
      login_failures_30d: errorApprox.cnt,
      top_features: topFeatures,
      bottom_features: bottomFeatures,
      action_breakdown: actionBreakdown,
      daily_activity: dailyActivity,
      role_activity: roleActivity,
      visits: {
        // Counted from an unauthenticated public endpoint deduped only by the
        // browser's sessionStorage. Useful as a rough traffic signal, but it is
        // not attributable to a person and can be inflated by anyone, so it
        // must never be used as a research or participation metric.
        evidence_class: 'non_attributable_traffic_counter',
        research_usable: false,
        today: { total: Number(visitsToday?.total || 0), public: Number(visitsToday?.public_v || 0), logged_in: Number(visitsToday?.logged_v || 0) },
        last_7d: { total: Number(visits7d?.total || 0), public: Number(visits7d?.public_v || 0), logged_in: Number(visits7d?.logged_v || 0) },
        last_30d: { total: Number(visits30d?.total || 0), public: Number(visits30d?.public_v || 0), logged_in: Number(visits30d?.logged_v || 0) },
      },
    });
  } catch (err) { next(err); }
});

// ─── POST /api/admin/snapshots/run ──────────────────────────────────────────
// Compute and store a daily snapshot for the current date (or specified date).
// Idempotent: uses REPLACE INTO with unique key on (date, scope_type, scope_id).
router.post('/snapshots/run', async (req, res, next) => {
  try {
    const snapshotDate = req.body.date || new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });
    const isBaseline = !!req.body.is_baseline;
    const baselineNote = req.body.baseline_note || null;
    const researchPhase = req.body.research_phase || null;
    const runType = isBaseline ? 'baseline' : 'manual';

    // Prevent duplicate baseline within 24 hours
    if (isBaseline) {
      const [[recent]] = await pool.query(
        `SELECT id, snapshot_date, baseline_note, research_phase FROM daily_snapshots
         WHERE is_baseline = TRUE AND created_at >= NOW() - INTERVAL 24 HOUR
         ORDER BY created_at DESC LIMIT 1`
      );
      if (recent) {
        return sendError(res, `มี baseline อยู่แล้วภายใน 24 ชั่วโมง (${recent.snapshot_date}${recent.research_phase ? ' — ' + recent.research_phase : ''}) กรุณารอก่อน`, 409);
      }
    }

    // Compute system-wide metrics
    const [[students]] = await pool.query(
      `SELECT COUNT(*) AS total,
              SUM(vehicle_id IS NOT NULL) AS with_vehicle
       FROM students WHERE is_deleted = FALSE`
    );

    const [[parentCoverage]] = await pool.query(
      `SELECT COUNT(DISTINCT ps.student_id) AS cnt
       FROM parent_student ps JOIN students s ON s.id = ps.student_id AND s.is_deleted = FALSE
       WHERE ps.approved = TRUE`
    );

    const [[vehicleStats]] = await pool.query(
      `SELECT COUNT(*) AS total,
              SUM(insurance_expiry IS NOT NULL AND insurance_expiry >= CURDATE()) AS with_insurance
       FROM vehicles WHERE is_deleted = FALSE`
    );

    const [[inspectionStats]] = await pool.query(
      `SELECT COUNT(DISTINCT sub.vehicle_id) AS inspected, SUM(sub.result = 'PASSED') AS passed
       FROM (
         SELECT vi.vehicle_id, vi.result FROM vehicle_inspections vi
         INNER JOIN (SELECT vehicle_id, MAX(inspection_date) AS md FROM vehicle_inspections GROUP BY vehicle_id) lat
         ON vi.vehicle_id = lat.vehicle_id AND vi.inspection_date = lat.md
       ) sub`
    );

    const [[completion]] = await pool.query(
      `SELECT
         (SELECT COUNT(*) FROM students WHERE is_deleted=FALSE AND morning_enabled=TRUE) AS m_total,
         (SELECT COUNT(DISTINCT student_id) FROM daily_status WHERE check_date=? AND morning_done=TRUE) AS m_done,
         (SELECT COUNT(*) FROM students WHERE is_deleted=FALSE AND evening_enabled=TRUE) AS e_total,
         (SELECT COUNT(DISTINCT student_id) FROM daily_status WHERE check_date=? AND evening_done=TRUE) AS e_done`,
      [snapshotDate, snapshotDate]
    );

    const [[userStats]] = await pool.query(
      `SELECT COUNT(*) AS total, SUM(is_active AND last_login IS NOT NULL) AS active
       FROM users WHERE is_deleted = FALSE`
    );

    const [[emergencyStats]] = await pool.query(
      `SELECT COUNT(*) AS cnt FROM emergency_logs
       WHERE DATE(reported_at) = ? AND is_deleted = FALSE`, [snapshotDate]
    );

    // Upsert snapshot
    await pool.query(
      `REPLACE INTO daily_snapshots
       (snapshot_date, scope_type, scope_id,
        total_students, students_with_vehicle, students_with_parent,
        total_vehicles, vehicles_with_insurance, vehicles_inspected, vehicles_passed,
        morning_total, morning_done, evening_total, evening_done,
        emergency_count, active_users, total_users,
        is_baseline, baseline_note, run_type, research_phase, created_by)
       VALUES (?, 'system', NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        snapshotDate,
        students.total, students.with_vehicle, parentCoverage.cnt,
        vehicleStats.total, vehicleStats.with_insurance || 0,
        inspectionStats.inspected || 0, inspectionStats.passed || 0,
        completion.m_total, completion.m_done, completion.e_total, completion.e_done,
        emergencyStats.cnt, userStats.active || 0, userStats.total,
        isBaseline, baselineNote, runType, researchPhase, req.user.id,
      ]
    );

    await logAudit({
      userId: req.user.id, action: 'CREATE', entityType: 'daily_snapshot', entityId: snapshotDate,
      newValue: { date: snapshotDate, run_type: runType, is_baseline: isBaseline, research_phase: researchPhase },
      ipAddress: req.ip, userAgent: req.headers['user-agent'],
    });

    return sendSuccess(res, { snapshot_date: snapshotDate, run_type: runType, is_baseline: isBaseline, research_phase: researchPhase }, 'บันทึก snapshot สำเร็จ', null, 201);
  } catch (err) { next(err); }
});

// ─── GET /api/admin/snapshots ───────────────────────────────────────────────
router.get('/snapshots', async (req, res, next) => {
  try {
    const { limit = 30, baseline_only } = req.query;
    let where = '1=1';
    const params = [];
    if (baseline_only === 'true') { where += ' AND is_baseline = TRUE'; }

    const [rows] = await pool.query(
      `SELECT * FROM daily_snapshots WHERE ${where} ORDER BY snapshot_date DESC LIMIT ?`,
      [...params, parseInt(limit) || 30]
    );
    return sendSuccess(res, rows);
  } catch (err) { next(err); }
});

// ─── GET /api/admin/evaluation-summary ──────────────────────────────────────
// Returns per-role evaluation data: action counts, snapshot metrics, evidence coverage.
router.get('/evaluation-summary', async (req, res, next) => {
  try {
    // Get baseline + latest snapshots
    const [snaps] = await pool.query('SELECT * FROM daily_snapshots ORDER BY snapshot_date DESC, id DESC LIMIT 50');
    const baseline = snaps.find(s => s.is_baseline) || null;
    const latest = snaps.find(s => !s.is_baseline) || snaps[0] || null;

    // Get action counts by role
    const [roleActions] = await pool.query(
      `SELECT u.role, al.action, COUNT(*) as cnt
       FROM audit_logs al LEFT JOIN users u ON u.id = al.user_id
       GROUP BY u.role, al.action`
    );

    // Build per-role summary
    const roleMap = {};
    for (const r of roleActions) {
      const role = r.role || 'unknown';
      if (!roleMap[role]) roleMap[role] = { actions: {}, total: 0 };
      roleMap[role].actions[r.action] = r.cnt;
      roleMap[role].total += r.cnt;
    }

    // Export counts by role
    const [exportsByRole] = await pool.query(
      `SELECT u.role, COUNT(*) as cnt FROM audit_logs al
       LEFT JOIN users u ON u.id = al.user_id
       WHERE al.action = 'EXPORT' GROUP BY u.role`
    );
    const exportMap = {};
    for (const e of exportsByRole) exportMap[e.role || 'unknown'] = e.cnt;

    // Evidence coverage is computed here so no client can re-derive readiness
    // from action volume. `role_actions` stays for the usage breakdown the
    // dashboard still shows, but it no longer decides any status.
    const evidenceCtx = await loadResearchEvidenceContext();
    const evidenceReadiness = researchReadinessSvc.buildEvidenceReadiness(evidenceCtx);

    return sendSuccess(res, {
      baseline: baseline ? { id: baseline.id, date: baseline.snapshot_date, note: baseline.baseline_note, research_phase: baseline.research_phase, data: baseline } : null,
      latest: latest ? { id: latest.id, date: latest.snapshot_date, data: latest } : null,
      snapshot_count: snaps.length,
      role_actions: roleMap,
      role_exports: exportMap,
      evidence_readiness: {
        schema_version: evidenceReadiness.schema_version,
        snapshot_freshness: evidenceReadiness.snapshot_freshness,
        baseline_pair: evidenceReadiness.baseline_pair,
        protocol: evidenceReadiness.protocol,
        summary: evidenceReadiness.summary,
        roles: evidenceReadiness.roles,
        metrics: evidenceReadiness.metrics.map((m) => ({
          key: m.key, role: m.role, title_th: m.title_th, category: m.category,
          status: m.status, status_label_th: m.status_label_th,
          blocking_reasons: m.blocking_reasons, latest_evidence_date: m.latest_evidence_date,
        })),
        research_claims_allowed: evidenceReadiness.research_claims_allowed,
        blocking_reasons: evidenceReadiness.blocking_reasons,
      },
    });
  } catch (err) { next(err); }
});

// ─── GET /api/admin/research-export ─────────────────────────────────────────
// Returns a JSON research dataset package with snapshots + audit logs + summary.
// Privacy: excludes ip_address, user_agent, old_value; includes user_id (admin-only access).
router.get('/research-export', importExportLimiter, async (req, res, next) => {
  try {
    // A1-11 S6. These two values are not only filters: they are written into
    // the dataset's own meta.date_range, into the entity_id of the EXPORT
    // audit row (`${from}_to_${to}`) that the dataset later cites as evidence
    // of its own export, and into the Content-Disposition filename. An
    // unchecked value therefore makes the dataset and its audit trail
    // impossible to reconcile, and a value containing a quote malforms the
    // header. /api/reports has validated its dates since it was written; this
    // route was the one that did not.
    const from = req.query.from || '2020-01-01';
    const to = req.query.to || new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });
    for (const [field, value] of [['from', from], ['to', to]]) {
      if (!isCalendarDate(value)) {
        return sendError(res, 'รูปแบบวันที่ไม่ถูกต้อง',
          [{ field, message: 'ต้องเป็นรูปแบบ YYYY-MM-DD และเป็นวันที่ที่มีอยู่จริง' }], 400);
      }
    }
    if (from > to) {
      return sendError(res, 'ช่วงวันที่ไม่ถูกต้อง',
        [{ field: 'from', message: 'วันเริ่มต้นต้องไม่อยู่หลังวันสิ้นสุด' }], 400);
    }
    const include = (req.query.include || 'snapshots,audit,exports,summary').split(',');

    // Evidence readiness is derived per metric from data that exists. The old
    // `dme_mie_ready: true` constant is gone: it asserted the dataset was fit
    // for evaluation while 11 of 24 metrics still had no evidence at all.
    const evidenceCtx = await loadResearchEvidenceContext();
    const evidenceReadiness = researchReadinessSvc.buildEvidenceReadiness(evidenceCtx);

    const result = { meta: {
      generated_at: new Date().toISOString(),
      generated_by: req.user.username,
      date_range: { from, to },
      included: include,
      format_version: '3.0',
      evidence_readiness: evidenceReadiness,
      research_claims_allowed: evidenceReadiness.research_claims_allowed,
      readiness_note: 'ชุดข้อมูลนี้เป็นหลักฐานเชิงระบบ ไม่ใช่ผลการวิจัย และยังไม่ผ่านการรับรองโดย Research lead',
    }};

    if (include.includes('snapshots')) {
      const [rows] = await pool.query(
        `SELECT id, snapshot_date, scope_type, scope_id,
                total_students, students_with_vehicle, students_with_parent,
                total_vehicles, vehicles_with_insurance, vehicles_inspected, vehicles_passed,
                morning_total, morning_done, evening_total, evening_done,
                emergency_count, active_users, total_users,
                is_baseline, baseline_note, run_type, research_phase, created_at
         FROM daily_snapshots WHERE snapshot_date BETWEEN ? AND ? ORDER BY snapshot_date`,
        [from, to]
      );
      result.snapshots = rows;
    }

    if (include.includes('audit')) {
      const [rows] = await pool.query(
        `SELECT al.id, al.user_id, u.role AS user_role, al.action, al.entity_type, al.entity_id,
                al.new_value, al.created_at
         FROM audit_logs al
         LEFT JOIN users u ON u.id = al.user_id
         WHERE al.created_at BETWEEN ? AND DATE_ADD(?, INTERVAL 1 DAY)
         ORDER BY al.created_at`,
        [from, to]
      );
      result.audit_logs = rows.map((r) => ({ ...r, new_value: r.new_value ? redactAuditValue(r.new_value) : null }));
    }

    if (include.includes('exports')) {
      const [rows] = await pool.query(
        `SELECT al.id, al.user_id, u.role AS user_role, al.entity_type, al.entity_id,
                al.new_value, al.created_at
         FROM audit_logs al
         LEFT JOIN users u ON u.id = al.user_id
         WHERE al.action = 'EXPORT' AND al.created_at BETWEEN ? AND DATE_ADD(?, INTERVAL 1 DAY)
         ORDER BY al.created_at`,
        [from, to]
      );
      result.export_evidence = rows.map((r) => ({ ...r, new_value: r.new_value ? redactAuditValue(r.new_value) : null }));
    }

    if (include.includes('summary')) {
      const [[counts]] = await pool.query(
        `SELECT
           (SELECT COUNT(*) FROM daily_snapshots WHERE snapshot_date BETWEEN ? AND ?) AS snapshot_count,
           (SELECT COUNT(*) FROM daily_snapshots WHERE is_baseline = TRUE) AS baseline_count,
           (SELECT COUNT(*) FROM audit_logs WHERE created_at BETWEEN ? AND DATE_ADD(?, INTERVAL 1 DAY)) AS audit_count,
           (SELECT COUNT(*) FROM audit_logs WHERE action='EXPORT' AND created_at BETWEEN ? AND DATE_ADD(?, INTERVAL 1 DAY)) AS export_count`,
        [from, to, from, to, from, to]
      );

      const [[actionBreakdown]] = await pool.query(
        `SELECT
           SUM(action='LOGIN') AS logins,
           SUM(action='CREATE') AS creates,
           SUM(action='UPDATE') AS updates,
           SUM(action='DELETE') AS deletes,
           SUM(action='EXPORT') AS exports,
           SUM(action='IMPORT') AS imports
         FROM audit_logs WHERE created_at BETWEEN ? AND DATE_ADD(?, INTERVAL 1 DAY)`,
        [from, to]
      );

      const [[roleBreakdown]] = await pool.query(
        `SELECT
           SUM(u.role='driver') AS driver_actions,
           SUM(u.role='school') AS school_actions,
           SUM(u.role='affiliation') AS affiliation_actions,
           SUM(u.role='province') AS province_actions,
           SUM(u.role='transport') AS transport_actions,
           SUM(u.role='admin') AS admin_actions
         FROM audit_logs al LEFT JOIN users u ON u.id = al.user_id
         WHERE al.created_at BETWEEN ? AND DATE_ADD(?, INTERVAL 1 DAY)`,
        [from, to]
      );

      // DME/MIE-ready computed fields
      const baselineSnap = result.snapshots?.find(s => s.is_baseline) || null;
      const latestSnap = result.snapshots?.filter(s => !s.is_baseline).sort((a, b) => b.snapshot_date > a.snapshot_date ? 1 : -1)[0] || null;

      const dmeFields = {
        // DME: Digital Maturity Evaluation — system-derivable
        data_completeness_pct: latestSnap && latestSnap.total_students > 0 ? Math.round((latestSnap.students_with_vehicle / latestSnap.total_students) * 10000) / 100 : null,
        parent_coverage_pct: latestSnap && latestSnap.total_students > 0 ? Math.round((latestSnap.students_with_parent / latestSnap.total_students) * 10000) / 100 : null,
        insurance_coverage_pct: latestSnap && latestSnap.total_vehicles > 0 ? Math.round((latestSnap.vehicles_with_insurance / latestSnap.total_vehicles) * 10000) / 100 : null,
        inspection_coverage_pct: latestSnap && latestSnap.total_vehicles > 0 ? Math.round((latestSnap.vehicles_inspected / latestSnap.total_vehicles) * 10000) / 100 : null,
        inspection_pass_pct: latestSnap && latestSnap.total_vehicles > 0 ? Math.round((latestSnap.vehicles_passed / latestSnap.total_vehicles) * 10000) / 100 : null,
        morning_completion_pct: latestSnap && latestSnap.morning_total > 0 ? Math.round((latestSnap.morning_done / latestSnap.morning_total) * 10000) / 100 : null,
        evening_completion_pct: latestSnap && latestSnap.evening_total > 0 ? Math.round((latestSnap.evening_done / latestSnap.evening_total) * 10000) / 100 : null,
        active_user_pct: latestSnap && latestSnap.total_users > 0 ? Math.round((latestSnap.active_users / latestSnap.total_users) * 10000) / 100 : null,
        total_audit_actions: Number(counts.audit_count) || 0,
        total_exports: Number(counts.export_count) || 0,
        role_adoption: roleBreakdown,

        // MIE: Management Impact Evaluation — needs external data
        stakeholder_satisfaction: null, // requires survey (pending)
        decision_quality_score: null,   // requires interview (pending)
        response_time_improvement: null, // requires pre-post comparison (pending)
        cost_reduction_estimate: null,   // requires financial data (pending)

        // Baseline reference
        baseline_snapshot_id: baselineSnap?.id || null,
        baseline_date: baselineSnap?.snapshot_date || null,
        baseline_research_phase: baselineSnap?.research_phase || null,
        current_snapshot_id: latestSnap?.id || null,
        current_date: latestSnap?.snapshot_date || null,

        // Delta from baseline (if both exist)
        delta: baselineSnap && latestSnap ? {
          data_completeness: calcDelta(baselineSnap, latestSnap, 'students_with_vehicle', 'total_students'),
          parent_coverage: calcDelta(baselineSnap, latestSnap, 'students_with_parent', 'total_students'),
          insurance_coverage: calcDelta(baselineSnap, latestSnap, 'vehicles_with_insurance', 'total_vehicles'),
          inspection_coverage: calcDelta(baselineSnap, latestSnap, 'vehicles_inspected', 'total_vehicles'),
          morning_completion: calcDelta(baselineSnap, latestSnap, 'morning_done', 'morning_total'),
          evening_completion: calcDelta(baselineSnap, latestSnap, 'evening_done', 'evening_total'),
        } : null,

        // Snapshot age travels with the numbers it qualifies. Percentages
        // computed from a stale snapshot describe the day it was taken, not
        // today, and the reader has no way to know that from the value alone.
        snapshot_freshness: evidenceReadiness.snapshot_freshness,
        baseline_pair: evidenceReadiness.baseline_pair,

        _notes: {
          dme: 'DME fields are computed from system snapshots and audit logs — fully automated',
          mie: 'MIE fields require external evidence (surveys, interviews, financial data) — return null until collected',
          delta: 'Delta values show percentage point change from baseline to current snapshot',
          freshness: `ค่าที่คำนวณจาก snapshot ใช้ได้เมื่อ snapshot ใหม่กว่า ${evidenceReadiness.snapshot_freshness.max_age_days} วัน; ปัจจุบันอายุ ${evidenceReadiness.snapshot_freshness.age_days ?? 'ไม่ทราบ'} วัน`,
          delta_validity: evidenceReadiness.baseline_pair.usable
            ? 'baseline/post pair อยู่ในช่วง protocol ที่ freeze แล้ว'
            : `ห้ามตีความ delta เป็นผลวิจัย เหตุผล: ${evidenceReadiness.baseline_pair.reason}`,
        },
      };

      result.summary = { counts, action_breakdown: actionBreakdown, role_breakdown: roleBreakdown, dme_mie: dmeFields };

      // Data dictionary ships with the dataset so every metric can be traced to
      // its formula, denominator and missing-data rule without a second file.
      result.data_dictionary = {
        schema_version: '1.0',
        categories: {
          operational_kpi: 'ตัวชี้วัดการดำเนินงาน คำนวณจากระบบได้โดยตรง',
          participation_kpi: 'ตัวชี้วัดการมีส่วนร่วม ต้องมีเหตุการณ์เสนอ/พิจารณา/มติ/แจ้งผลกลับ',
          research_outcome: 'ผลลัพธ์เชิงวิจัย ต้องมี protocol, baseline และช่วงสังเกตที่กำหนด',
          external_evidence: 'ต้องใช้เครื่องมือภายนอก เช่น แบบสอบถาม สัมภาษณ์ บันทึกประชุม',
        },
        metrics: evidenceReadiness.metrics.map((m) => ({
          key: m.key, role: m.role, title: m.title, title_th: m.title_th,
          category: m.category, formula: m.formula,
          numerator: m.numerator, denominator: m.denominator,
          missing_data_rule: m.missing_data_rule, sources: m.sources,
          instrument: m.instrument, evidence_status: m.status,
          blocking_reasons: m.blocking_reasons,
          latest_evidence_date: m.latest_evidence_date,
        })),
      };
    }

    const format = (req.query.format || 'json').toLowerCase();

    // Log this export action
    await logAudit({
      userId: req.user.id, action: 'EXPORT', entityType: 'research_dataset',
      entityId: `${from}_to_${to}`,
      newValue: { from, to, included: include, format },
      ipAddress: req.ip, userAgent: req.headers['user-agent'],
    });

    // ── CSV format ──────────────────────────────────────────────────────────
    if (format === 'csv') {
      const BOM = '\uFEFF';
      const esc = (v) => {
        if (v == null) return '';
        // Phase 10.12G — neutralise against CSV formula injection.
        const s = neutralizeSpreadsheetCell(v);
        return s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r') ? `"${s.replace(/"/g, '""')}"` : s;
      };
      let csv = BOM;

      if (result.snapshots?.length) {
        const cols = ['snapshot_date','total_students','students_with_vehicle','students_with_parent',
          'total_vehicles','vehicles_with_insurance','vehicles_inspected','vehicles_passed',
          'morning_total','morning_done','evening_total','evening_done',
          'emergency_count','active_users','total_users','is_baseline','run_type','research_phase'];
        csv += '=== Snapshots ===\n';
        csv += cols.join(',') + '\n';
        for (const r of result.snapshots) csv += cols.map(c => esc(r[c])).join(',') + '\n';
        csv += '\n';
      }

      if (result.audit_logs?.length) {
        const cols = ['id','user_id','user_role','action','entity_type','entity_id','created_at'];
        csv += '=== Audit Logs ===\n';
        csv += cols.join(',') + '\n';
        for (const r of result.audit_logs) csv += cols.map(c => esc(r[c])).join(',') + '\n';
        csv += '\n';
      }

      if (result.export_evidence?.length) {
        const cols = ['id','user_id','user_role','entity_type','entity_id','created_at'];
        csv += '=== Export Evidence ===\n';
        csv += cols.join(',') + '\n';
        for (const r of result.export_evidence) csv += cols.map(c => esc(r[c])).join(',') + '\n';
        csv += '\n';
      }

      if (result.summary) {
        csv += '=== Summary ===\n';
        const s = result.summary;
        csv += `snapshot_count,${s.counts?.snapshot_count || 0}\n`;
        csv += `baseline_count,${s.counts?.baseline_count || 0}\n`;
        csv += `audit_count,${s.counts?.audit_count || 0}\n`;
        csv += `export_count,${s.counts?.export_count || 0}\n`;
        if (s.dme_mie) {
          csv += '\n=== DME Metrics ===\n';
          csv += 'metric,value\n';
          // Nested objects would serialise as "[object Object]"; they get their
          // own sections below instead of a meaningless cell.
          const NESTED = new Set(['_notes', 'delta', 'role_adoption', 'snapshot_freshness', 'baseline_pair']);
          for (const [k, v] of Object.entries(s.dme_mie)) {
            if (NESTED.has(k)) continue;
            csv += `${esc(k)},${esc(v)}\n`;
          }
        }
      }

      // Readiness travels with the CSV so a spreadsheet copy cannot be read as
      // a clean dataset when 11 of 24 metrics still lack evidence.
      if (result.meta?.evidence_readiness) {
        const er = result.meta.evidence_readiness;
        csv += '\n=== Evidence Readiness ===\n';
        csv += `research_claims_allowed,${esc(er.research_claims_allowed)}\n`;
        csv += `blocking_reasons,${esc((er.blocking_reasons || []).join(' | '))}\n`;
        csv += `snapshot_latest,${esc(er.snapshot_freshness?.latest_snapshot_date)}\n`;
        csv += `snapshot_age_days,${esc(er.snapshot_freshness?.age_days)}\n`;
        csv += `snapshot_fresh,${esc(er.snapshot_freshness?.fresh)}\n`;
        csv += `protocol_frozen,${esc(er.protocol?.frozen)}\n`;
        csv += '\nmetric_key,category,evidence_status,blocking_reasons,latest_evidence_date\n';
        for (const m of er.metrics || []) {
          csv += [m.key, m.category, m.status, (m.blocking_reasons || []).join(' | '), m.latest_evidence_date]
            .map(esc).join(',') + '\n';
        }
      }

      const filename = `research-dataset-${from.replace(/-/g, '')}-${to.replace(/-/g, '')}.csv`;
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      return res.send(csv);
    }

    // ── Excel format ────────────────────────────────────────────────────────
    if (format === 'excel') {
      const wb = new ExcelJS.Workbook();
      wb.creator = 'ระบบรถรับส่งนักเรียนจังหวัดลำปาง';

      function styleHeader(sheet) {
        const row = sheet.getRow(1);
        row.font = { bold: true, color: { argb: 'FFFFFFFF' } };
        row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4472C4' } };
      }

      if (result.snapshots?.length) {
        const ws = wb.addWorksheet('Snapshots');
        const cols = [
          { header: 'วันที่', key: 'snapshot_date', width: 14 },
          { header: 'นักเรียนทั้งหมด', key: 'total_students', width: 14 },
          { header: 'มีรถ', key: 'students_with_vehicle', width: 10 },
          { header: 'มีผู้ปกครอง', key: 'students_with_parent', width: 12 },
          { header: 'รถทั้งหมด', key: 'total_vehicles', width: 12 },
          { header: 'มีประกัน', key: 'vehicles_with_insurance', width: 10 },
          { header: 'ตรวจแล้ว', key: 'vehicles_inspected', width: 10 },
          { header: 'ผ่านตรวจ', key: 'vehicles_passed', width: 10 },
          { header: 'เช้า(ทั้งหมด)', key: 'morning_total', width: 12 },
          { header: 'เช้า(เสร็จ)', key: 'morning_done', width: 10 },
          { header: 'เย็น(ทั้งหมด)', key: 'evening_total', width: 12 },
          { header: 'เย็น(เสร็จ)', key: 'evening_done', width: 10 },
          { header: 'ฉุกเฉิน', key: 'emergency_count', width: 10 },
          { header: 'ผู้ใช้ active', key: 'active_users', width: 12 },
          { header: 'ผู้ใช้ทั้งหมด', key: 'total_users', width: 12 },
          { header: 'Baseline', key: 'is_baseline', width: 10 },
          { header: 'ประเภท', key: 'run_type', width: 10 },
          { header: 'Research Phase', key: 'research_phase', width: 14 },
        ];
        ws.columns = cols;
        for (const r of result.snapshots) {
          ws.addRow({ ...r, snapshot_date: r.snapshot_date ? String(r.snapshot_date).slice(0, 10) : '', is_baseline: r.is_baseline ? 'Yes' : '' });
        }
        styleHeader(ws);
      }

      if (result.audit_logs?.length) {
        const ws = wb.addWorksheet('Audit Logs');
        ws.columns = [
          { header: 'ID', key: 'id', width: 8 },
          { header: 'User ID', key: 'user_id', width: 8 },
          { header: 'สิทธิ์', key: 'user_role', width: 12 },
          { header: 'Action', key: 'action', width: 12 },
          { header: 'Entity Type', key: 'entity_type', width: 18 },
          { header: 'Entity ID', key: 'entity_id', width: 18 },
          { header: 'วันเวลา', key: 'created_at', width: 20 },
        ];
        for (const r of result.audit_logs) ws.addRow(r);
        styleHeader(ws);
      }

      if (result.export_evidence?.length) {
        const ws = wb.addWorksheet('Export Evidence');
        ws.columns = [
          { header: 'ID', key: 'id', width: 8 },
          { header: 'User ID', key: 'user_id', width: 8 },
          { header: 'สิทธิ์', key: 'user_role', width: 12 },
          { header: 'Entity Type', key: 'entity_type', width: 18 },
          { header: 'Entity ID', key: 'entity_id', width: 18 },
          { header: 'วันเวลา', key: 'created_at', width: 20 },
        ];
        for (const r of result.export_evidence) ws.addRow(r);
        styleHeader(ws);
      }

      if (result.summary) {
        const ws = wb.addWorksheet('Summary');
        ws.columns = [
          { header: 'รายการ', key: 'label', width: 30 },
          { header: 'ค่า', key: 'value', width: 20 },
        ];
        const s = result.summary;
        ws.addRow({ label: 'จำนวน Snapshots', value: s.counts?.snapshot_count || 0 });
        ws.addRow({ label: 'จำนวน Baselines', value: s.counts?.baseline_count || 0 });
        ws.addRow({ label: 'จำนวน Audit Logs', value: s.counts?.audit_count || 0 });
        ws.addRow({ label: 'จำนวน Exports', value: s.counts?.export_count || 0 });
        ws.addRow({ label: '', value: '' });
        ws.addRow({ label: '--- DME Metrics ---', value: '' });
        if (s.dme_mie) {
          for (const [k, v] of Object.entries(s.dme_mie)) {
            if (k === '_notes' || k === 'delta' || k === 'role_adoption') continue;
            ws.addRow({ label: k, value: v != null ? v : 'pending' });
          }
        }
        styleHeader(ws);
      }

      const filename = `research-dataset-${from.replace(/-/g, '')}-${to.replace(/-/g, '')}.xlsx`;
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      await wb.xlsx.write(res);
      return res.end();
    }

    // ── JSON format (default) ───────────────────────────────────────────────
    if (req.query.download === 'true') {
      const filename = `research-dataset-${from.replace(/-/g, '')}-${to.replace(/-/g, '')}.json`;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    }

    return sendSuccess(res, result);
  } catch (err) { next(err); }
});

// ─── GET /api/admin/research-export/preview ─────────────────────────────────
router.get('/research-export/preview', async (req, res, next) => {
  try {
    const from = req.query.from || '2020-01-01';
    const to = req.query.to || new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });

    const [[counts]] = await pool.query(
      `SELECT
         (SELECT COUNT(*) FROM daily_snapshots WHERE snapshot_date BETWEEN ? AND ?) AS snapshots,
         (SELECT COUNT(*) FROM daily_snapshots WHERE is_baseline = TRUE AND snapshot_date BETWEEN ? AND ?) AS baselines,
         (SELECT COUNT(*) FROM audit_logs WHERE created_at BETWEEN ? AND DATE_ADD(?, INTERVAL 1 DAY)) AS audit_logs,
         (SELECT COUNT(*) FROM audit_logs WHERE action='EXPORT' AND created_at BETWEEN ? AND DATE_ADD(?, INTERVAL 1 DAY)) AS export_logs,
         (SELECT MIN(snapshot_date) FROM daily_snapshots) AS earliest_snapshot,
         (SELECT MAX(snapshot_date) FROM daily_snapshots) AS latest_snapshot`,
      [from, to, from, to, from, to, from, to]
    );

    // Row counts alone read as "the dataset is this big"; the limits belong in
    // the same answer so nobody exports first and reads the caveats later.
    const evidenceCtx = await loadResearchEvidenceContext();
    const readiness = researchReadinessSvc.buildEvidenceReadiness(evidenceCtx);

    return sendSuccess(res, {
      from,
      to,
      ...counts,
      evidence_readiness: {
        snapshot_freshness: readiness.snapshot_freshness,
        baseline_pair: readiness.baseline_pair,
        protocol: readiness.protocol,
        summary: readiness.summary,
        research_claims_allowed: readiness.research_claims_allowed,
        blocking_reasons: readiness.blocking_reasons,
      },
    });
  } catch (err) { next(err); }
});

// ─── Phase 7.2 — GET /api/admin/live-vehicles ───────────────────────────────
// All vehicles. Aggregate viewer (admin support tool): audited.
router.get('/live-vehicles', async (req, res, next) => {
  try {
    const vehicles = await vllSvc.listAll();
    vllSvc.maybeAuditView({
      userId: req.user.id, entityId: 'admin-all',
      ipAddress: req.ip, userAgent: req.headers['user-agent'],
    });
    return sendSuccess(res, { vehicles, generated_at: new Date().toISOString() });
  } catch (err) { next(err); }
});

// ─── Pending-requests count (bell badge) — aggregates the 3 admin queues ─────
router.get('/pending-requests-count', async (req, res, next) => {
  try {
    const tr = require('../services/studentTransfer.service');
    const vr = require('../services/vehicleRequest.service');
    const [student_transfer, vehicle, rosterRes] = await Promise.all([
      tr.countPendingForAdmin(pool),
      vr.countPendingForAdmin(pool),
      pool.query("SELECT COUNT(*) n FROM roster_change_requests WHERE status = 'pending'"),
    ]);
    const roster = rosterRes[0][0].n;
    return sendSuccess(res, { total: student_transfer + vehicle + roster, student_transfer, vehicle, roster });
  } catch (err) { next(err); }
});

// ─── Phase 10.13B-6 — Student Transfer / Wrong-School approval queue ─────────
// All admin-only (router.use(requireRole('admin')) above).
router.get('/student-transfer-requests', async (req, res, next) => {
  try {
    const transfer = require('../services/studentTransfer.service');
    const out = await transfer.listForAdmin(pool, { status: req.query.status });
    return sendSuccess(res, out);
  } catch (err) { next(err); }
});

router.get('/student-transfer-requests/:id', async (req, res, next) => {
  try {
    const requestId = readIdParam(req, res, 'id');
    if (requestId === null) return;
    const transfer = require('../services/studentTransfer.service');
    const out = await transfer.getDetailForAdmin(pool, { requestId });
    return sendSuccess(res, out);
  } catch (err) { next(err); }
});

router.post('/student-transfer-requests/:id/approve', async (req, res, next) => {
  try {
    const requestId = readIdParam(req, res, 'id');
    if (requestId === null) return;
    const transfer = require('../services/studentTransfer.service');
    const out = await transfer.approveAndApply(pool, { requestId, adminUserId: req.user.id, adminNote: (req.body || {}).admin_note });
    await logAudit({ userId: req.user.id, action: 'APPROVE', entityType: 'student_transfer_request', entityId: String(requestId),
      newValue: { result: out.status, applied_student_id: out.applied_student_id || null }, ipAddress: req.ip, userAgent: req.headers['user-agent'] });
    const msg = out.status === 'APPLIED' ? 'อนุมัติและดำเนินการโอนย้ายสำเร็จ'
      : out.status === 'ALREADY_APPLIED' ? 'คำขอนี้ดำเนินการไปแล้ว'
      : out.status === 'FAILED' ? 'ไม่สามารถดำเนินการได้ (พบรหัสนักเรียนซ้ำในโรงเรียนปลายทางหรือข้อมูลไม่ครบ)'
      : out.status === 'STALE_NEEDS_REVIEW' ? 'ข้อมูลนักเรียนเปลี่ยนแปลงตั้งแต่ส่งคำขอ กรุณาตรวจสอบใหม่' : 'ดำเนินการแล้ว';
    return sendSuccess(res, out, msg);
  } catch (err) { next(err); }
});

router.post('/student-transfer-requests/:id/reject', async (req, res, next) => {
  try {
    const requestId = readIdParam(req, res, 'id');
    if (requestId === null) return;
    const transfer = require('../services/studentTransfer.service');
    const out = await transfer.reject(pool, { requestId, adminUserId: req.user.id, adminNote: (req.body || {}).admin_note });
    await logAudit({ userId: req.user.id, action: 'UPDATE', entityType: 'student_transfer_request', entityId: String(requestId), newValue: { result: 'REJECTED' }, ipAddress: req.ip, userAgent: req.headers['user-agent'] });
    return sendSuccess(res, out, 'ไม่อนุมัติคำขอแล้ว');
  } catch (err) { next(err); }
});

// ─── Phase 10.13B-7 — Vehicle restore / shared-fleet approval queue ──────────
router.get('/vehicle-requests', async (req, res, next) => {
  try {
    const vr = require('../services/vehicleRequest.service');
    return sendSuccess(res, await vr.listAdminVehicleRequests(pool, { status: req.query.status }));
  } catch (err) { next(err); }
});
router.get('/vehicle-requests/:id', async (req, res, next) => {
  try {
    const requestId = readIdParam(req, res, 'id');
    if (requestId === null) return;
    const vr = require('../services/vehicleRequest.service');
    return sendSuccess(res, await vr.getAdminVehicleRequest(pool, { requestId }));
  } catch (err) { next(err); }
});
router.post('/vehicle-requests/:id/approve', async (req, res, next) => {
  try {
    const requestId = readIdParam(req, res, 'id');
    if (requestId === null) return;
    const vr = require('../services/vehicleRequest.service');
    const out = await vr.approveVehicleRequest(pool, { requestId, adminUserId: req.user.id, adminNote: (req.body || {}).admin_note });
    await logAudit({ userId: req.user.id, action: 'APPROVE', entityType: 'vehicle_request', entityId: String(requestId),
      newValue: { result: out.status, vehicle_id: out.vehicle_id || null }, ipAddress: req.ip, userAgent: req.headers['user-agent'] });
    const msg = out.status === 'APPLIED' ? (out.informational ? 'อนุมัติคำขอแล้ว' : 'อนุมัติและกู้คืนรถสำเร็จ')
      : out.status === 'ALREADY_APPLIED' ? 'คำขอนี้ดำเนินการไปแล้ว'
      : out.status === 'FAILED' && out.reason === 'ACTIVE_CANONICAL_CONFLICT' ? 'ไม่สามารถกู้คืนรถได้ เนื่องจากมีรถทะเบียนเดียวกันที่ใช้งานอยู่แล้ว'
      : out.status === 'FAILED' ? 'ไม่สามารถดำเนินการได้' : 'ดำเนินการแล้ว';
    return sendSuccess(res, out, msg);
  } catch (err) { next(err); }
});
router.post('/vehicle-requests/:id/reject', async (req, res, next) => {
  try {
    const requestId = readIdParam(req, res, 'id');
    if (requestId === null) return;
    const vr = require('../services/vehicleRequest.service');
    const out = await vr.rejectVehicleRequest(pool, { requestId, adminUserId: req.user.id, adminNote: (req.body || {}).admin_note });
    await logAudit({ userId: req.user.id, action: 'UPDATE', entityType: 'vehicle_request', entityId: String(requestId), newValue: { result: 'REJECTED' }, ipAddress: req.ip, userAgent: req.headers['user-agent'] });
    return sendSuccess(res, out, 'ไม่อนุมัติคำขอแล้ว');
  } catch (err) { next(err); }
});

// ─── Phase 10.13B-9 — Operations health (admin-only, read-only, no PII) ──────
router.get('/operations/health', async (req, res, next) => {
  try {
    const { computeOperationsHealth } = require('../services/operationsHealth.service');
    return sendSuccess(res, await computeOperationsHealth(pool));
  } catch (err) { next(err); }
});

// ─── Phase 10.13B-8 — Driver lifecycle & assignment wizard (admin-only) ──────
router.get('/driver-integrity', async (req, res, next) => {
  try {
    const dl = require('../services/driverLifecycle.service');
    return sendSuccess(res, await dl.getDriverIntegrity(pool));
  } catch (err) { next(err); }
});
router.post('/drivers/preflight', async (req, res, next) => {
  try {
    const dl = require('../services/driverLifecycle.service');
    const { action, payload } = req.body || {};
    return sendSuccess(res, await dl.preflightDriverAction(pool, { action, payload: payload || {} }));
  } catch (err) { next(err); }
});
router.post('/drivers/:userId/restore', async (req, res, next) => {
  try {
    const driverUserId = readIdParam(req, res, 'userId');
    if (driverUserId === null) return;
    const reason = (req.body || {}).reason;
    if (!String(reason || '').trim()) return sendError(res, 'กรุณาระบุเหตุผล', [], 400);
    const dl = require('../services/driverLifecycle.service');
    const out = await dl.restoreDriver(pool, { userId: driverUserId, reason, actorId: req.user.id });
    return sendSuccess(res, out, out.status === 'RESTORED' ? 'กู้คืนบัญชีคนขับสำเร็จ' : 'บัญชีนี้ใช้งานอยู่แล้ว');
  } catch (err) { next(err); }
});
router.post('/drivers/:userId/deactivate', async (req, res, next) => {
  try {
    const driverUserId = readIdParam(req, res, 'userId');
    if (driverUserId === null) return;
    const reason = (req.body || {}).reason;
    if (!String(reason || '').trim()) return sendError(res, 'กรุณาระบุเหตุผล', [], 400);
    const dl = require('../services/driverLifecycle.service');
    const out = await dl.deactivateDriver(pool, { userId: driverUserId, reason, actorId: req.user.id });
    return sendSuccess(res, out, out.status === 'DEACTIVATED' ? 'ปิดใช้งานบัญชีคนขับแล้ว' : 'บัญชีนี้ถูกปิดใช้งานอยู่แล้ว');
  } catch (err) { next(err); }
});
router.post('/drivers/:userId/reassign-vehicle', async (req, res, next) => {
  try {
    const driverUserId = readIdParam(req, res, 'userId');
    if (driverUserId === null) return;
    const b = req.body || {};
    if (!b.vehicle_id) return sendError(res, 'กรุณาระบุรถปลายทาง', [], 400);
    if (!String(b.reason || '').trim()) return sendError(res, 'กรุณาระบุเหตุผล', [], 400);
    const dl = require('../services/driverLifecycle.service');
    const out = await dl.reassignDriverVehicle(pool, { userId: driverUserId, vehicleId: b.vehicle_id, endTargetExisting: !!b.end_target_existing, reason: b.reason, actorId: req.user.id });
    const msg = out.status === 'REASSIGNED' ? 'ย้ายคนขับไปยังรถใหม่สำเร็จ'
      : out.status === 'TARGET_VEHICLE_HAS_ACTIVE_DRIVER' ? 'รถคันนี้มีคนขับที่ใช้งานอยู่แล้ว กรุณายืนยันการสิ้นสุดงานเดิม'
      : out.status === 'DRIVER_ALREADY_ASSIGNED' ? 'คนขับนี้อยู่กับรถคันนี้อยู่แล้ว' : 'ดำเนินการแล้ว';
    return sendSuccess(res, out, msg);
  } catch (err) { next(err); }
});
router.post('/driver-assignments/:assignmentId/end', async (req, res, next) => {
  try {
    const assignmentId = readIdParam(req, res, 'assignmentId');
    if (assignmentId === null) return;
    const dl = require('../services/driverLifecycle.service');
    const out = await dl.endAssignment(pool, { assignmentId, reason: (req.body || {}).reason, actorId: req.user.id });
    return sendSuccess(res, out, out.status === 'ENDED' ? 'สิ้นสุดงานมอบหมายแล้ว' : 'งานนี้สิ้นสุดไปแล้ว');
  } catch (err) { next(err); }
});

// ─── Admin override: cancel ANY vehicle-inspection application (cross-scope) ──
// Reuses the verification service's cancelApplication with isAdmin to bypass the
// issuing-school check; the service aborts any IN_PROGRESS inspection attempt and
// frees active_request_key in the same transaction, and audits the cancel.
// Operators previously had to hand-edit the DB to clear a stuck application.
router.post('/verification/applications/:id/cancel', async (req, res, next) => {
  try {
    const applicationId = readIdParam(req, res, 'id');
    if (applicationId === null) return;
    const verification = require('../services/vehicleVerification.service');
    const data = await verification.cancelApplication(pool, {
      applicationId,
      schoolId: null,
      userId: req.user.id,
      reason: (req.body || {}).reason || null,
      isAdmin: true,
    });
    return sendSuccess(res, data, 'ยกเลิกคำขอ (สิทธิ์ผู้ดูแลระบบ) แล้ว');
  } catch (err) { next(err); }
});

// ─── Admin vehicle lifecycle: soft-delete / plate-correct / merge-duplicate ──
// Operators previously had to hand-edit the DB to delete a bad vehicle, fix a
// mistyped plate, or collapse a duplicate. All three are transactional, dedup-
// guarded (canonical/normalized plate uniqueness), and fully audited. Admin-only
// via the file-level requireRole('admin'); vehicles are province-shared.
router.delete('/vehicles/:id', async (req, res, next) => {
  try {
    const vehicleAdmin = require('../services/vehicleAdmin.service');
    const b = req.body || {};
    const out = await vehicleAdmin.softDeleteVehicle(pool, {
      vehicleId: req.params.id,
      actorId: req.user.id,
      force: b.force === true,
      reason: b.reason || null,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
    const msg = out.status === 'ALREADY_DELETED' ? 'รถคันนี้ถูกลบไปแล้ว'
      : out.forced ? 'ลบรถ (ยืนยันการลบทั้งที่ยังมีการใช้งาน) แล้ว' : 'ลบรถเรียบร้อย';
    return sendSuccess(res, out, msg);
  } catch (err) { next(err); }
});

router.put('/vehicles/:id', async (req, res, next) => {
  try {
    const vehicleAdmin = require('../services/vehicleAdmin.service');
    const b = req.body || {};
    const patch = {};
    for (const f of ['plate_no', 'vehicle_type', 'owner_name', 'owner_phone',
                     'insurance_status', 'insurance_type', 'insurance_expiry',
                     'registration_expiry', 'compulsory_insurance_expiry', 'tax_expiry']) {
      if (Object.prototype.hasOwnProperty.call(b, f)) patch[f] = b[f];
    }
    const data = await vehicleAdmin.correctVehicle(pool, {
      vehicleId: req.params.id,
      actorId: req.user.id,
      patch,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
    return sendSuccess(res, data, 'แก้ไขข้อมูลรถเรียบร้อย');
  } catch (err) { next(err); }
});

router.post('/vehicles/:id/merge', async (req, res, next) => {
  try {
    const b = req.body || {};
    if (!b.into_vehicle_id) return sendError(res, 'กรุณาระบุรถปลายทาง (into_vehicle_id)', [], 400);
    if (!String(b.reason || '').trim()) return sendError(res, 'กรุณาระบุเหตุผลในการรวมรถ', [], 400);
    const vehicleAdmin = require('../services/vehicleAdmin.service');
    const data = await vehicleAdmin.mergeVehicles(pool, {
      vehicleId: req.params.id,
      intoVehicleId: b.into_vehicle_id,
      actorId: req.user.id,
      reason: b.reason,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
    return sendSuccess(res, data, 'รวมรถซ้ำเรียบร้อย');
  } catch (err) { next(err); }
});

// ─── POST /api/admin/checkin/:logId/void ─────────────────────────────────────
// Admin override: reverse a wrong check-in / check-out. Writes a CANCELLED
// compensating checkin_logs row + resets daily_status for that student/session/
// date, in one transaction. Reason required; never hard-deletes the original log.
router.post('/checkin/:logId/void', async (req, res, next) => {
  try {
    const logId = readIdParam(req, res, 'logId');
    if (logId === null) return;
    const checkinSvc = require('../services/checkin.service');
    const reason = (req.body || {}).reason;
    if (!String(reason || '').trim()) return sendError(res, 'กรุณาระบุเหตุผล', [], 400);

    const result = await checkinSvc.voidCheckin(pool, {
      userId:          req.user.id,
      userRole:        req.user.role,
      userDisplayName: req.user.displayName || req.user.username || null,
      ipAddress:       req.ip,
      userAgent:       req.headers['user-agent'],
      logId,
      reason,
      scope:           { kind: 'admin' },
    });

    return sendSuccess(res, result, 'ยกเลิกรายการเช็กอินสำเร็จ', null, 201);
  } catch (err) { next(err); }
});

// ─── Emergency alert triage (admin: list / resolve / soft-delete) ────────────
// emergency_logs has no status/closed column (only result, note, is_deleted).
// "Resolve/close" writes a structured result + note; reads across the system
// already filter is_deleted=FALSE so a soft-deleted alert disappears. No migration.
const VALID_EMERGENCY_RESULTS = ['ACKNOWLEDGED', 'RESOLVED', 'FALSE_ALARM', 'CLOSED'];

router.get('/emergencies', async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const per_page = Math.min(100, Math.max(1, parseInt(req.query.per_page, 10) || 20));
    const includeDeleted = req.query.include_deleted === '1' || req.query.include_deleted === 'true';
    const where = includeDeleted ? '1=1' : 'el.is_deleted = FALSE';
    const offset = (page - 1) * per_page;

    const [[{ total }]] = await pool.query(
      `SELECT COUNT(*) AS total FROM emergency_logs el WHERE ${where}`
    );
    const [rows] = await pool.query(
      `SELECT el.id, el.vehicle_id, el.plate_no, el.detail, el.note, el.result,
              el.channel, el.reported_at, el.is_deleted, el.deleted_at,
              u.display_name AS reported_by_name
       FROM emergency_logs el
       LEFT JOIN users u ON u.id = el.reported_by
       WHERE ${where}
       ORDER BY el.reported_at DESC
       LIMIT ? OFFSET ?`,
      [per_page, offset]
    );
    return sendSuccess(res, rows, 'OK', { page, per_page, total });
  } catch (err) { next(err); }
});

router.patch('/emergencies/:id', async (req, res, next) => {
  try {
    const id = readIdParam(req, res, 'id');
    if (id === null) return;
    const { result, note } = req.body || {};
    if (result !== undefined && result !== null && !VALID_EMERGENCY_RESULTS.includes(result)) {
      return sendError(res, `result ต้องเป็นค่าใดค่าหนึ่งใน: ${VALID_EMERGENCY_RESULTS.join(', ')}`, [], 400);
    }
    if (result === undefined && note === undefined) {
      return sendError(res, 'ต้องระบุ result หรือ note อย่างน้อยหนึ่งอย่าง', [], 400);
    }

    const emSvc = require('../services/emergencyAdmin.service');
    const out = await emSvc.resolveEmergency(pool, {
      id, result: result ?? null, note: note ?? null,
      actorId: req.user.id, ip: req.ip, userAgent: req.headers['user-agent'],
    });
    return sendSuccess(res, out, 'อัปเดตสถานะเหตุฉุกเฉินสำเร็จ');
  } catch (err) { next(err); }
});

router.delete('/emergencies/:id', async (req, res, next) => {
  try {
    const id = readIdParam(req, res, 'id');
    if (id === null) return;
    const emSvc = require('../services/emergencyAdmin.service');
    const out = await emSvc.softDeleteEmergency(pool, {
      id, reason: (req.body || {}).reason || null,
      actorId: req.user.id, ip: req.ip, userAgent: req.headers['user-agent'],
    });
    return sendSuccess(res, out, out.status === 'DELETED' ? 'ลบเหตุฉุกเฉิน (ซ่อนจากรายงาน) แล้ว' : 'เหตุฉุกเฉินนี้ถูกลบไปแล้ว');
  } catch (err) { next(err); }
});

// ─── Terms (academic semester) — dynamic current term, no restart ────────────
// Roll the current term over from the UI (terms.is_current) instead of editing
// .env + pm2 restart every semester. Admin-only (router-level guard above).
router.get('/terms', async (_req, res, next) => {
  try {
    return sendSuccess(res, await termSvc.listTerms(pool));
  } catch (err) { next(err); }
});

router.post('/terms', async (req, res, next) => {
  try {
    const actor = { userId: req.user.id, ip: req.ip, ua: req.headers['user-agent'] };
    const out = await termSvc.createTerm(pool, {
      id: req.body.id, name: req.body.name,
      startDate: req.body.start_date, endDate: req.body.end_date,
    }, actor);
    return sendSuccess(res, out, 'เพิ่มภาคเรียนแล้ว', null, 201);
  } catch (err) { next(err); }
});

router.post('/terms/:id/current', async (req, res, next) => {
  try {
    const actor = { userId: req.user.id, ip: req.ip, ua: req.headers['user-agent'] };
    const out = await termSvc.setCurrentTerm(pool, req.params.id, actor);
    return sendSuccess(res, out, 'ตั้งเป็นภาคเรียนปัจจุบันแล้ว');
  } catch (err) { next(err); }
});

module.exports = router;
