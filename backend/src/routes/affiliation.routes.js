'use strict';

const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/roleGuard');
const { sendSuccess, sendError } = require('../utils/response');
const { pool } = require('../config/database');
const affSvc = require('../services/affiliation.service');
const affAdminSvc = require('../services/affiliationAdmin.service');
const vllSvc = require('../services/vehicleLocation.service');
const ppSvc = require('../services/pickupPoint.service');
const { logAudit } = require('../utils/audit');

// Shared CSV helper for audit export
function auditRowsToCsv(rows) {
  const ACTION_TH = { CREATE: 'สร้าง', UPDATE: 'แก้ไข', DELETE: 'ลบ', EXPORT: 'ส่งออก', LOGIN: 'เข้าสู่ระบบ', IMPORT: 'นำเข้า', APPROVE: 'อนุมัติ' };
  const ENTITY_TH = { student: 'นักเรียน', vehicle: 'รถรับส่ง', user: 'บัญชีผู้ใช้', roster_request: 'คำขอรายชื่อ', leave: 'การลา', checkin: 'เช็กอิน' };
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const header = 'วันเวลา,ผู้ดำเนินการ,บทบาท,การกระทำ,ประเภท,รหัส,ค่าเดิม,ค่าใหม่';
  const lines = rows.map(r => [
    esc(new Date(r.created_at).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' })),
    esc(r.actor_name || '-'), esc(r.actor_role || '-'),
    esc(ACTION_TH[r.action] || r.action), esc(ENTITY_TH[r.entity_type] || r.entity_type || '-'),
    esc(r.entity_id || '-'),
    esc(r.old_value ? JSON.stringify(r.old_value) : '-'),
    esc(r.new_value ? JSON.stringify(r.new_value) : '-'),
  ].join(','));
  return [header, ...lines].join('\n');
}

// All affiliation routes require authentication + role 'affiliation' or 'admin'
router.use(authenticate, requireRole('affiliation', 'admin'));

function resolveAffiliationId(req) {
  if (req.user.role === 'admin') return req.query.affiliation_id || null;
  return req.user.scopeId;
}

/**
 * GET /api/affiliation/dashboard
 */
router.get('/dashboard', async (req, res, next) => {
  try {
    const affId = resolveAffiliationId(req);
    if (!affId) return sendError(res, 'ไม่พบข้อมูลเขตพื้นที่ที่ผูกกับบัญชีนี้', [], 403);

    const data = await affSvc.getDashboard(affId);
    return sendSuccess(res, data);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/affiliation/schools
 */
router.get('/schools', async (req, res, next) => {
  try {
    const affId = resolveAffiliationId(req);
    if (!affId) return sendError(res, 'ไม่พบข้อมูลเขตพื้นที่ที่ผูกกับบัญชีนี้', [], 403);

    const schools = await affSvc.getSchools(affId);
    return sendSuccess(res, schools);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/affiliation/students
 * Query: search, grade, school_id, page, per_page, sort, order
 */
router.get('/students', async (req, res, next) => {
  try {
    const affId = resolveAffiliationId(req);
    if (!affId) return sendError(res, 'ไม่พบข้อมูลเขตพื้นที่ที่ผูกกับบัญชีนี้', [], 403);

    const { search, grade, school_id, vehicle_id, sort, order } = req.query;
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const per_page = Math.min(100, Math.max(1, parseInt(req.query.per_page, 10) || 20));

    const result = await affSvc.getStudents(affId, {
      search, grade, school_id, vehicle_id, page, per_page, sort, order,
    });
    return sendSuccess(res, result.students, 'OK', result.meta);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/affiliation/vehicles
 */
router.get('/vehicles', async (req, res, next) => {
  try {
    const affId = resolveAffiliationId(req);
    if (!affId) return sendError(res, 'ไม่พบข้อมูลเขตพื้นที่ที่ผูกกับบัญชีนี้', [], 403);

    const vehicles = await affSvc.getVehicles(affId);
    return sendSuccess(res, vehicles);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/affiliation/status-today
 */
router.get('/status-today', async (req, res, next) => {
  try {
    const affId = resolveAffiliationId(req);
    if (!affId) return sendError(res, 'ไม่พบข้อมูลเขตพื้นที่ที่ผูกกับบัญชีนี้', [], 403);

    const data = await affSvc.getStatusToday(affId);
    return sendSuccess(res, data);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/affiliation/emergencies
 * Query: page, per_page
 */
router.get('/emergencies', async (req, res, next) => {
  try {
    const affId = resolveAffiliationId(req);
    if (!affId) return sendError(res, 'ไม่พบข้อมูลเขตพื้นที่ที่ผูกกับบัญชีนี้', [], 403);

    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const per_page = Math.min(100, Math.max(1, parseInt(req.query.per_page, 10) || 20));

    const result = await affSvc.getEmergencies(affId, { page, per_page });
    return sendSuccess(res, result.emergencies, 'OK', result.meta);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/affiliation/vehicles-at-risk?limit=10
 * Top N vehicles serving this affiliation, scored by inspection +
 * insurance state. Same scoring formula as /province/vehicles-at-risk.
 *
 * Service intentionally does not select PII columns
 * (driver_phone / attendant_phone / owner_phone), so no extra
 * sanitization is needed at this handler.
 *
 * limit clamped to [1, 100] inside the service.
 */
router.get('/vehicles-at-risk', async (req, res, next) => {
  try {
    const affId = resolveAffiliationId(req);
    if (!affId) return sendError(res, 'ไม่พบข้อมูลเขตพื้นที่ที่ผูกกับบัญชีนี้', [], 403);

    const data = await affSvc.getVehiclesAtRisk(affId, { limit: req.query.limit });
    return sendSuccess(res, data);
  } catch (err) { next(err); }
});

// ─── GET /missing ────────────────────────────────────────────────────────────

router.get('/missing', async (req, res, next) => {
  try {
    const affId = resolveAffiliationId(req);
    if (!affId) return sendError(res, 'ไม่พบข้อมูลเขตพื้นที่', [], 403);
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });
    const session = req.query.session;

    const [rows] = await pool.query(
      `SELECT s.id, CONCAT(IFNULL(s.prefix,''), s.first_name, ' ', s.last_name) AS student_name,
              s.grade, s.classroom, s.vehicle_id, v.plate_no,
              s.school_id, sc.name AS school_name,
              s.morning_enabled, s.evening_enabled,
              ds.morning_done, ds.evening_done
       FROM students s
       JOIN schools sc ON sc.id = s.school_id AND sc.affiliation_id = ?
       LEFT JOIN vehicles v ON v.id = s.vehicle_id
       LEFT JOIN daily_status ds ON ds.student_id = s.id AND ds.check_date = ?
       LEFT JOIN student_leaves sl ON sl.student_id = s.id AND sl.leave_date = ? AND sl.cancelled = FALSE
         AND (sl.session = 'both' OR sl.session = ?)
       WHERE s.is_deleted = FALSE AND sl.id IS NULL
         AND ((? = 'morning' AND s.morning_enabled = TRUE AND (ds.morning_done IS NULL OR ds.morning_done = FALSE))
           OR (? = 'evening' AND s.evening_enabled = TRUE AND (ds.evening_done IS NULL OR ds.evening_done = FALSE))
           OR (? IS NULL AND (
             (s.morning_enabled = TRUE AND (ds.morning_done IS NULL OR ds.morning_done = FALSE))
             OR (s.evening_enabled = TRUE AND (ds.evening_done IS NULL OR ds.evening_done = FALSE))
           )))
       ORDER BY sc.name, v.plate_no, s.first_name`,
      [affId, today, today, session || 'morning', session, session, session]
    );
    return sendSuccess(res, { date: today, session: session || 'all', students: rows });
  } catch (err) { next(err); }
});

// ─── School Account Management ───────────────────────────────────────────────

router.get('/school-accounts', async (req, res, next) => {
  try {
    const affId = resolveAffiliationId(req);
    if (!affId) return sendError(res, 'ไม่พบข้อมูลเขตพื้นที่', [], 403);
    const accounts = await affAdminSvc.getSchoolAccounts(affId);
    return sendSuccess(res, accounts);
  } catch (err) { next(err); }
});

router.post('/school-accounts', async (req, res, next) => {
  try {
    const affId = resolveAffiliationId(req);
    if (!affId) return sendError(res, 'ไม่พบข้อมูลเขตพื้นที่', [], 403);
    const { school_id, username, display_name } = req.body;
    if (!school_id || !username) return sendError(res, 'school_id และ username จำเป็น', [], 400);

    const result = await affAdminSvc.createSchoolAccount({
      affiliationId: affId, schoolId: school_id, username,
      displayName: display_name, userId: req.user.id,
    });
    return sendSuccess(res, result, 'สร้างบัญชีสำเร็จ', null, 201);
  } catch (err) { next(err); }
});

// Create new school + account in one step
router.post('/school-accounts/new-school', async (req, res, next) => {
  try {
    const affId = resolveAffiliationId(req);
    if (!affId) return sendError(res, 'ไม่พบข้อมูลเขตพื้นที่', [], 403);
    const { school_code, school_name, username } = req.body;
    if (!school_code || !school_name || !username) {
      return sendError(res, 'กรุณากรอก รหัสโรงเรียน, ชื่อโรงเรียน และชื่อผู้ใช้', [], 400);
    }

    const result = await affAdminSvc.createSchoolWithAccount({
      affiliationId: affId, schoolCode: school_code, schoolName: school_name,
      username, userId: req.user.id,
    });
    return sendSuccess(res, result, 'เพิ่มโรงเรียนและสร้างบัญชีสำเร็จ', null, 201);
  } catch (err) { next(err); }
});

router.post('/school-accounts/:id/reset-password', async (req, res, next) => {
  try {
    const affId = resolveAffiliationId(req);
    if (!affId) return sendError(res, 'ไม่พบข้อมูลเขตพื้นที่', [], 403);
    const { password } = req.body;
    if (!password) return sendError(res, 'password จำเป็น', [], 400);

    const result = await affAdminSvc.resetSchoolPassword({
      affiliationId: affId, accountId: parseInt(req.params.id, 10),
      newPassword: password, userId: req.user.id,
    });
    return sendSuccess(res, result, 'รีเซ็ตรหัสผ่านสำเร็จ');
  } catch (err) { next(err); }
});

router.put('/school-accounts/:id', async (req, res, next) => {
  try {
    const affId = resolveAffiliationId(req);
    if (!affId) return sendError(res, 'ไม่พบข้อมูลเขตพื้นที่', [], 403);
    const { is_active } = req.body;

    const result = await affAdminSvc.toggleSchoolAccount({
      affiliationId: affId, accountId: parseInt(req.params.id, 10),
      isActive: is_active, userId: req.user.id,
    });
    return sendSuccess(res, result, 'อัปเดตสำเร็จ');
  } catch (err) { next(err); }
});

// ─── GET /audit-logs ─────────────────────────────────────────────────────────

router.get('/audit-logs', async (req, res, next) => {
  try {
    const affId = resolveAffiliationId(req);
    if (!affId) return sendError(res, 'ไม่พบข้อมูลเขตพื้นที่', [], 403);

    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const per_page = Math.min(100, Math.max(1, parseInt(req.query.per_page, 10) || 30));
    const offset = (page - 1) * per_page;
    const { action, date_from, date_to } = req.query;

    let scopeWhere = `(
      (u.scope_id IN (SELECT sc.id FROM schools sc WHERE sc.affiliation_id = ?) AND u.scope_type = 'SCHOOL')
      OR (u.scope_id = ? AND u.scope_type = 'AFFILIATION')
      OR (al.entity_type IN ('student','roster_request') AND al.entity_id IN (
        SELECT CAST(s.id AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci FROM students s JOIN schools sc2 ON sc2.id = s.school_id WHERE sc2.affiliation_id = ?
      ))
    )`;
    const params = [affId, affId, affId];

    const isValidDate = (d) => /^\d{4}-\d{2}-\d{2}$/.test(d);
    if (action) { scopeWhere += ' AND al.action = ?'; params.push(action); }
    if (date_from && isValidDate(date_from)) { scopeWhere += ' AND al.created_at >= ?'; params.push(`${date_from} 00:00:00`); }
    if (date_to && isValidDate(date_to)) { scopeWhere += ' AND al.created_at <= ?'; params.push(`${date_to} 23:59:59`); }

    // CSV export mode
    if (req.query.format === 'csv') {
      const [rows] = await pool.query(
        `SELECT al.id, al.action, al.entity_type, al.entity_id,
                al.old_value, al.new_value, al.created_at,
                u.display_name AS actor_name, u.role AS actor_role
         FROM audit_logs al LEFT JOIN users u ON u.id = al.user_id
         WHERE ${scopeWhere} ORDER BY al.created_at DESC LIMIT 5000`, params
      );
      const csv = auditRowsToCsv(rows);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename=audit_affiliation_${new Date().toISOString().split('T')[0]}.csv`);
      logAudit({ userId: req.user.id, action: 'EXPORT', entityType: 'audit_csv', entityId: 'affiliation',
        newValue: { role: req.user.role }, ipAddress: req.ip, userAgent: req.headers['user-agent'] }).catch(() => {});
      return res.send('\uFEFF' + csv);
    }

    const [[{ total }]] = await pool.query(
      `SELECT COUNT(*) AS total FROM audit_logs al LEFT JOIN users u ON u.id = al.user_id WHERE ${scopeWhere}`, params
    );

    const [rows] = await pool.query(
      `SELECT al.id, al.user_id, al.action, al.entity_type, al.entity_id,
              al.old_value, al.new_value, al.created_at,
              u.display_name AS actor_name, u.role AS actor_role
       FROM audit_logs al
       LEFT JOIN users u ON u.id = al.user_id
       WHERE ${scopeWhere}
       ORDER BY al.created_at DESC
       LIMIT ? OFFSET ?`,
      [...params, per_page, offset]
    );

    return sendSuccess(res, rows, 'OK', { page, per_page, total });
  } catch (err) { next(err); }
});

// ─── POST /notify-school — Log notification sent to school ──────────────────
router.post('/notify-school', async (req, res, next) => {
  try {
    const { school_id, school_name, message, method } = req.body;
    if (!school_id) return sendError(res, 'กรุณาระบุ school_id', [], 400);

    await logAudit({
      userId: req.user.id,
      action: 'CREATE',
      entityType: 'school_notification',
      entityId: school_id,
      newValue: { school_id, school_name, message, method: method || 'copy', notified_at: new Date().toISOString() },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return sendSuccess(res, { school_id, notified_at: new Date().toISOString() }, 'บันทึกการแจ้งเตือนสำเร็จ', null, 201);
  } catch (err) { next(err); }
});

// ─── Phase 7.2 — GET /api/affiliation/live-vehicles ─────────────────────────
// Vehicles serving any school in this affiliation. Aggregate viewer:
// audited once per 5-minute window per user.
router.get('/live-vehicles', async (req, res, next) => {
  try {
    const affId = resolveAffiliationId(req);
    if (!affId) {
      return sendError(res,
        req.user.role === 'admin' ? 'กรุณาระบุ affiliation_id' : 'ไม่พบข้อมูลสังกัด',
        [], req.user.role === 'admin' ? 400 : 403);
    }
    const vehicles = await vllSvc.listForAffiliation(affId);
    vllSvc.maybeAuditView({
      userId: req.user.id, entityId: affId,
      ipAddress: req.ip, userAgent: req.headers['user-agent'],
    });
    return sendSuccess(res, { vehicles, generated_at: new Date().toISOString() });
  } catch (err) { next(err); }
});

// ─── Phase 7.12.2 — GET /api/affiliation/pickup-map ─────────────────────────
// Read-only multi-role pickup-point map. Returns aggregate-only rows
// (no student names/phones/addresses). Affiliation scope is JWT-locked;
// ?school_id outside this affiliation returns 403.
router.get('/pickup-map', async (req, res, next) => {
  try {
    const affId = resolveAffiliationId(req);
    if (!affId) {
      return sendError(res,
        req.user.role === 'admin' ? 'กรุณาระบุ affiliation_id' : 'ไม่พบข้อมูลเขตพื้นที่ที่ผูกกับบัญชีนี้',
        [], req.user.role === 'admin' ? 400 : 403);
    }

    const { school_id, vehicle_id, session, grade, search } = req.query;

    if (!ppSvc.isValidSession(session || null)) {
      return sendError(res, 'session ต้องเป็น morning, evening หรือ both', [], 400);
    }
    if (!ppSvc.isValidGrade(grade || null)) {
      return sendError(res, 'ชั้นเรียนไม่ถูกต้อง', [], 400);
    }

    // Cross-affiliation school_id → 403 (do not leak existence)
    if (school_id && !(await ppSvc.schoolBelongsToAffiliation(school_id, affId))) {
      return sendError(res, 'ไม่มีสิทธิ์เข้าถึงโรงเรียนนี้', [], 403);
    }

    const data = await ppSvc.getReadOnlyPickupMap({
      scopeAffiliationId: affId,
      filterSchoolId: school_id || null,
      filterVehicleId: vehicle_id || null,
      session: session || null,
      grade: grade || null,
      search: search || null,
    });

    ppSvc.maybeAuditPickupMapView({
      userId: req.user.id,
      entityType: 'affiliation_pickup_map',
      entityId: affId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return sendSuccess(res, data);
  } catch (err) { next(err); }
});

module.exports = router;
