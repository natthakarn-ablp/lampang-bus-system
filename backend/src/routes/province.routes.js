'use strict';

const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/roleGuard');
const { exportFormatLimiter } = require('../middleware/rateLimiters');
const { sendSuccess, sendError } = require('../utils/response');
const { readIdParam } = require('../utils/pathParams');
const { isCalendarDate } = require('../utils/calendarDate');
const { pool } = require('../config/database');
const provSvc = require('../services/province.service');
const tripSvc = require('../services/vehicleTrip.service');
const provAdminSvc = require('../services/provinceAdmin.service');
const orgSvc = require('../services/orgEntities.service');
const vllSvc = require('../services/vehicleLocation.service');
const { makeTrackHandlers } = require('./vehicleTrackHandlers');
const { trackingInfo } = require('../utils/gpsTrackingWindow');
const ppSvc = require('../services/pickupPoint.service');
const { csvCell, redactAuditValue } = require('../utils/exportSecurity');
const { auditExportBeforeSend } = require('../utils/exportAudit');
const { todayBangkok } = require('../utils/thaiTime');

// Shared CSV helper for audit export
function auditRowsToCsv(rows) {
  const ACTION_TH = { CREATE: 'สร้าง', UPDATE: 'แก้ไข', DELETE: 'ลบ', EXPORT: 'ส่งออก', LOGIN: 'เข้าสู่ระบบ', IMPORT: 'นำเข้า', APPROVE: 'อนุมัติ' };
  const ENTITY_TH = { student: 'นักเรียน', vehicle: 'รถรับส่ง', user: 'บัญชีผู้ใช้', roster_request: 'คำขอรายชื่อ', leave: 'การลา', checkin: 'เช็กอิน', checkin_override: 'ยืนยันแทนคนขับ', checkin_teacher: 'ครูเช็กชื่อ' };
  // Phase 10.12G — neutralise every cell + redact PII from audit values.
  const esc = csvCell;
  const header = 'วันเวลา,ผู้ดำเนินการ,บทบาท,การกระทำ,ประเภท,รหัส,ค่าเดิม,ค่าใหม่';
  const lines = rows.map(r => [
    esc(new Date(r.created_at).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' })),
    esc(r.actor_name || '-'), esc(r.actor_role || '-'),
    esc(ACTION_TH[r.action] || r.action), esc(ENTITY_TH[r.entity_type] || r.entity_type || '-'),
    esc(r.entity_id || '-'),
    esc(r.old_value ? redactAuditValue(r.old_value) : '-'),
    esc(r.new_value ? redactAuditValue(r.new_value) : '-'),
  ].join(','));
  return [header, ...lines].join('\n');
}

// Province routes: role 'province' or 'admin' (per RBAC matrix)
router.use(authenticate, requireRole('province', 'admin'));

// Requests waiting for this role (badge + งานรออนุมัติ page) — pendingQueue.service.js
router.get('/pending-summary', require('./pendingSummaryHandler').pendingSummaryHandler());

// ─── Decide on the affiliation's behalf after ESCALATE days (2026-11-13) ────
// POST /api/province/escalated/transfer-requests/:id/approve|reject
// POST /api/province/escalated/vehicle-requests/:id/approve|reject
// Refused (409 NOT_ESCALATED_YET) until the request has waited 7 days for the
// affiliation; then runs the affiliation's own guard + service and audits an
// override row (by_role). Reject needs a reason. provinceOverride.service.js
function escalatedDecision(kind, decision) {
  return async (req, res, next) => {
    try {
      const requestId = readIdParam(req, res, 'id');
      if (requestId === null) return;
      const b = req.body || {};
      const { out, message } = await require('../services/provinceOverride.service').decide(pool, {
        kind, requestId, decision,
        note: b.reason != null ? b.reason : b.admin_note,
        actorId: req.user.id, actorRole: req.user.role,
        ipAddress: req.ip, userAgent: req.headers['user-agent'],
      });
      return sendSuccess(res, out, message);
    } catch (err) { return next(err); }
  };
}
router.post('/escalated/transfer-requests/:id/approve', escalatedDecision('transfer', 'approve'));
router.post('/escalated/transfer-requests/:id/reject', escalatedDecision('transfer', 'reject'));
router.post('/escalated/vehicle-requests/:id/approve', escalatedDecision('vehicle', 'approve'));
router.post('/escalated/vehicle-requests/:id/reject', escalatedDecision('vehicle', 'reject'));


/**
 * GET /api/province/dashboard
 */
router.get('/dashboard', async (req, res, next) => {
  try {
    const data = await provSvc.getDashboard();
    return sendSuccess(res, data);
  } catch (err) { next(err); }
});

/**
 * GET /api/province/affiliations
 */
router.get('/affiliations', async (req, res, next) => {
  try {
    const data = await provSvc.getAffiliations();
    return sendSuccess(res, data);
  } catch (err) { next(err); }
});

/**
 * GET /api/province/schools
 * Query: affiliation_id, page, per_page
 */
router.get('/schools', async (req, res, next) => {
  try {
    const { affiliation_id } = req.query;
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const per_page = Math.min(200, Math.max(1, parseInt(req.query.per_page, 10) || 50));

    const result = await provSvc.getSchools({ affiliation_id, page, per_page });
    return sendSuccess(res, result.schools, 'OK', result.meta);
  } catch (err) { next(err); }
});

/**
 * GET /api/province/students
 * Query: search, grade, school_id, affiliation_id, page, per_page, sort, order
 */
router.get('/students', async (req, res, next) => {
  try {
    const { search, grade, school_id, affiliation_id, vehicle_id, has_vehicle, sort, order } = req.query;
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const per_page = Math.min(100, Math.max(1, parseInt(req.query.per_page, 10) || 20));

    const result = await provSvc.getStudents({
      search, grade, school_id, affiliation_id, vehicle_id, has_vehicle, page, per_page, sort, order,
    });
    return sendSuccess(res, result.students, 'OK', result.meta);
  } catch (err) { next(err); }
});

/**
 * GET /api/province/vehicles
 */
router.get('/vehicles', async (req, res, next) => {
  try {
    const data = await provSvc.getVehicles();
    // Province role: strip phone numbers (summary-level visibility)
    const sanitized = data.map(v => {
      const { driver_phone, attendant_phone, owner_phone, ...rest } = v;
      return rest;
    });
    return sendSuccess(res, sanitized);
  } catch (err) { next(err); }
});

/**
 * GET /api/province/vehicles-at-risk?limit=10
 * Returns top N vehicles needing attention, scored by inspection +
 * insurance state. Service intentionally does not select PII columns
 * (driver_phone / attendant_phone / owner_phone), so no extra sanitization
 * is needed at this handler.
 *
 * limit clamped to [1, 100] inside the service.
 */
router.get('/vehicles-at-risk', async (req, res, next) => {
  try {
    const data = await provSvc.getVehiclesAtRisk({ limit: req.query.limit });
    return sendSuccess(res, data);
  } catch (err) { next(err); }
});

/**
 * GET /api/province/status-today
 */
router.get('/status-today', async (req, res, next) => {
  try {
    const data = await provSvc.getStatusToday();
    return sendSuccess(res, data);
  } catch (err) { next(err); }
});

/**
 * GET /api/province/trend?days=7
 * Daily checkin trend for province dashboard chart.
 */
router.get('/trend', async (req, res, next) => {
  try {
    const days = Math.min(Math.max(parseInt(req.query.days, 10) || 7, 1), 30);

    const [rows] = await pool.query(
      `SELECT ds.check_date AS date,
              COUNT(DISTINCT CASE WHEN ds.morning_done = TRUE THEN ds.student_id END) AS morning_done,
              COUNT(DISTINCT CASE WHEN ds.evening_done = TRUE THEN ds.student_id END) AS evening_done
       FROM daily_status ds
       JOIN students s ON s.id = ds.student_id AND s.is_deleted = FALSE
       WHERE ds.check_date >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
       GROUP BY ds.check_date
       ORDER BY ds.check_date`,
      [days]
    );

    const [[{ morning_total }]] = await pool.query(
      'SELECT COUNT(*) AS morning_total FROM students WHERE is_deleted = FALSE AND morning_enabled = TRUE'
    );
    const [[{ evening_total }]] = await pool.query(
      'SELECT COUNT(*) AS evening_total FROM students WHERE is_deleted = FALSE AND evening_enabled = TRUE'
    );

    const trend = rows.map(r => ({
      date: r.date,
      morning_done: r.morning_done,
      evening_done: r.evening_done,
      morning_total,
      evening_total,
      morning_pct: morning_total > 0 ? Math.round((r.morning_done / morning_total) * 100) : 0,
      evening_pct: evening_total > 0 ? Math.round((r.evening_done / evening_total) * 100) : 0,
    }));

    return sendSuccess(res, trend);
  } catch (err) { next(err); }
});

/**
 * GET /api/province/emergencies
 * Query: page, per_page
 */
router.get('/emergencies', async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const per_page = Math.min(100, Math.max(1, parseInt(req.query.per_page, 10) || 20));

    const result = await provSvc.getEmergencies({ page, per_page });
    return sendSuccess(res, result.emergencies, 'OK', result.meta);
  } catch (err) { next(err); }
});

/**
 * POST /api/province/emergencies/:id/close
 * Province may close any emergency (owner decision 2026-11-13). Note required;
 * history kept in the emergency note + audit_logs.
 */
router.post('/emergencies/:id/close', async (req, res, next) => {
  try {
    const id = readIdParam(req, res, 'id');
    if (id === null) return;
    const emSvc = require('../services/emergencyAdmin.service');
    const b = req.body || {};
    const out = await emSvc.closeEmergencyScoped(pool, {
      id, result: b.result, note: b.note,
      actor: { id: req.user.id, role: req.user.role, name: req.user.displayName || req.user.username, ip: req.ip, userAgent: req.headers['user-agent'] },
      scope: { all: true },
    });
    return sendSuccess(res, out, 'ปิดเหตุฉุกเฉินแล้ว');
  } catch (err) { next(err); }
});

// ─── GET /audit-logs ─────────────────────────────────────────────────────────

router.get('/audit-logs', exportFormatLimiter, async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const per_page = Math.min(100, Math.max(1, parseInt(req.query.per_page, 10) || 30));
    const offset = (page - 1) * per_page;
    const { action, date_from, date_to } = req.query;

    // Shared with /api/reports and admin: a shape-only regex accepted
    // 2026-13-45. Ignore-if-invalid behaviour below is unchanged.
    const isValidDate = isCalendarDate;
    let where = '1=1';
    const params = [];
    if (action) { where += ' AND al.action = ?'; params.push(action); }
    if (date_from && isValidDate(date_from)) { where += ' AND al.created_at >= ?'; params.push(`${date_from} 00:00:00`); }
    if (date_to && isValidDate(date_to)) { where += ' AND al.created_at <= ?'; params.push(`${date_to} 23:59:59`); }

    // CSV export mode
    if (req.query.format === 'csv') {
      // Audit 2026-06-18 (limitations): +1 row to detect truncation.
      const [rows] = await pool.query(
        `SELECT al.id, al.action, al.entity_type, al.entity_id,
                al.old_value, al.new_value, al.created_at,
                u.display_name AS actor_name, u.role AS actor_role
         FROM audit_logs al LEFT JOIN users u ON u.id = al.user_id
         WHERE ${where} ORDER BY al.created_at DESC LIMIT 5001`, params
      );
      const truncated = rows.length > 5000;
      const csv = auditRowsToCsv(rows.slice(0, 5000));
      if (!await auditExportBeforeSend(req, res, {
        entityType: 'audit_csv', entityId: 'province',
        metadata: { role: req.user.role, truncated },
      })) return;
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename=audit_province_${todayBangkok()}.csv`);
      if (truncated) res.setHeader('X-Truncated', 'true');
      return res.send('\uFEFF' + csv +
        (truncated ? '\n"# \u0E41\u0E2A\u0E14\u0E07 5000 \u0E41\u0E16\u0E27\u0E25\u0E48\u0E32\u0E2A\u0E38\u0E14 \u2014 \u0E23\u0E30\u0E1A\u0E38\u0E0A\u0E48\u0E27\u0E07\u0E27\u0E31\u0E19\u0E17\u0E35\u0E48\u0E40\u0E1E\u0E37\u0E48\u0E2D\u0E14\u0E39\u0E17\u0E31\u0E49\u0E07\u0E2B\u0E21\u0E14"' : ''));
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

    // H1 fix: redact PII (parent phone, driver phone, line_user_id) from
    // old_value/new_value JSON before returning to the province viewer.
    // The CSV path already does this; the JSON path was leaking raw values.
    const redactedRows = rows.map((r) => ({
      ...r,
      old_value: r.old_value ? redactAuditValue(r.old_value) : null,
      new_value: r.new_value ? redactAuditValue(r.new_value) : null,
    }));

    return sendSuccess(res, redactedRows, 'OK', { page, per_page, total });
  } catch (err) { next(err); }
});

// ─── Phase 7.2 — GET /api/province/live-vehicles ────────────────────────────
// All vehicles in the province. Aggregate viewer: audited.
router.get('/live-vehicles', async (req, res, next) => {
  try {
    const vehicles = await vllSvc.listAll();
    vllSvc.maybeAuditView({
      userId: req.user.id, entityId: 'province',
      ipAddress: req.ip, userAgent: req.headers['user-agent'],
    });
    return sendSuccess(res, { vehicles, generated_at: new Date().toISOString(), tracking: trackingInfo() });
  } catch (err) { next(err); }
});

// GPS route history (replay) — every vehicle, same scope as /live-vehicles.
{
  const h = makeTrackHandlers(() => ({ all: true }));
  router.get('/vehicles/:vehicleId/track', h.track);
  router.get('/vehicles/:vehicleId/track-days', h.days);
}

// ─── Phase 7.12.2 — GET /api/province/pickup-map ────────────────────────────
// Read-only multi-role pickup-point map for province oversight. Aggregate-only
// rows: no student names / phones / addresses.
router.get('/pickup-map', async (req, res, next) => {
  try {
    const { affiliation_id, school_id, vehicle_id, session, grade, search } = req.query;

    if (!ppSvc.isValidSession(session || null)) {
      return sendError(res, 'session ต้องเป็น morning, evening หรือ both', [], 400);
    }
    if (!ppSvc.isValidGrade(grade || null)) {
      return sendError(res, 'ชั้นเรียนไม่ถูกต้อง', [], 400);
    }

    const data = await ppSvc.getReadOnlyPickupMap({
      filterAffiliationId: affiliation_id || null,
      filterSchoolId: school_id || null,
      filterVehicleId: vehicle_id || null,
      session: session || null,
      grade: grade || null,
      search: search || null,
    });

    ppSvc.maybeAuditPickupMapView({
      userId: req.user.id,
      entityType: 'province_pickup_map',
      entityId: 'province',
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return sendSuccess(res, data);
  } catch (err) { next(err); }
});

// ─── Account administration (2026-09-07) ─────────────────────────────────────
// The hierarchy was one level short: an affiliation resets its schools and a
// school resets its teachers, but an affiliation or transport account that
// forgot its password had only the single admin to turn to. These two
// endpoints close that gap. The service decides who is reachable — affiliation
// and transport only — so the rule lives in one place.

/** GET /api/province/unit-accounts — accounts this province may reset. */
router.get('/unit-accounts', async (req, res, next) => {
  try {
    const rows = await provAdminSvc.listManagedAccounts();
    return sendSuccess(res, rows, 'OK', { total: rows.length });
  } catch (err) { return next(err); }
});

/** POST /api/province/unit-accounts/:id/reset-password */
router.post('/unit-accounts/:id/reset-password', async (req, res, next) => {
  try {
    const accountId = readIdParam(req, res, 'id');
    if (accountId === null) return;
    const { password } = req.body || {};
    if (!password) return sendError(res, 'password จำเป็น', [], 400);

    const result = await provAdminSvc.resetUnitAccountPassword({
      accountId,
      newPassword: password,
      userId: req.user.id,
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
    return sendSuccess(res, result, 'รีเซ็ตรหัสผ่านสำเร็จ — ผู้ใช้ต้องตั้งรหัสใหม่เมื่อเข้าสู่ระบบครั้งถัดไป');
  } catch (err) { return next(err); }
});

// ─── Full unit-account management (2026-11-13) ───────────────────────────────
// Create / rename / deactivate / delete / restore affiliation and transport
// accounts. MANAGED_ROLES is enforced inside provinceAdmin.service on every
// query; anything else answers 404.

function actorCtx(req) {
  return { actorId: req.user.id, ip: req.ip, userAgent: req.headers['user-agent'] };
}

/** GET /api/province/unit-accounts/deleted — soft-deleted, restorable. */
router.get('/unit-accounts/deleted', async (req, res, next) => {
  try {
    const rows = await provAdminSvc.listDeletedManagedAccounts(pool);
    return sendSuccess(res, rows, 'OK', { total: rows.length });
  } catch (err) { return next(err); }
});

/** POST /api/province/unit-accounts { role, username, display_name?, scope_id? } */
router.post('/unit-accounts', async (req, res, next) => {
  try {
    const { role, username, display_name, scope_id } = req.body || {};
    if (!role || !username) return sendError(res, 'กรุณาเลือกประเภทบัญชีและกรอกชื่อผู้ใช้', [], 400);
    const result = await provAdminSvc.createUnitAccount(pool, {
      role: String(role), username, displayName: display_name, scopeId: scope_id, ...actorCtx(req),
    });
    return sendSuccess(res, result,
      'สร้างบัญชีสำเร็จ — จดรหัสผ่านชั่วคราวไว้ตอนนี้ ระบบจะไม่แสดงอีก ผู้ใช้ต้องเปลี่ยนรหัสเมื่อเข้าครั้งแรก', null, 201);
  } catch (err) { return next(err); }
});

/** PUT /api/province/unit-accounts/:id { display_name?, is_active? } */
router.put('/unit-accounts/:id', async (req, res, next) => {
  try {
    const accountId = readIdParam(req, res, 'id');
    if (accountId === null) return;
    const { display_name, is_active } = req.body || {};
    const result = await provAdminSvc.updateUnitAccount(pool, {
      accountId, displayName: display_name, isActive: is_active, ...actorCtx(req),
    });
    return sendSuccess(res, result, 'บันทึกแล้ว');
  } catch (err) { return next(err); }
});

/** DELETE /api/province/unit-accounts/:id — soft delete. */
router.delete('/unit-accounts/:id', async (req, res, next) => {
  try {
    const accountId = readIdParam(req, res, 'id');
    if (accountId === null) return;
    const result = await provAdminSvc.deleteUnitAccount(pool, { accountId, ...actorCtx(req) });
    return sendSuccess(res, result, 'ลบบัญชีแล้ว (กู้คืนได้ที่แท็บ "บัญชีที่ลบแล้ว")');
  } catch (err) { return next(err); }
});

/** POST /api/province/unit-accounts/:id/restore — comes back deactivated. */
router.post('/unit-accounts/:id/restore', async (req, res, next) => {
  try {
    const accountId = readIdParam(req, res, 'id');
    if (accountId === null) return;
    const result = await provAdminSvc.restoreUnitAccount(pool, { accountId, ...actorCtx(req) });
    return sendSuccess(res, result, 'กู้คืนบัญชีแล้ว บัญชียังปิดอยู่ กด "เปิดบัญชี" เมื่อพร้อมใช้งาน');
  } catch (err) { return next(err); }
});

// ─── Organisation tree: affiliations + schools (2026-11-13) ──────────────────
// Province and admin (router guard). Soft delete only; deactivating a school
// is blocked (409) while it has active students or open inspection requests.

/** POST /api/province/affiliations { id, name } */
router.post('/affiliations', async (req, res, next) => {
  try {
    const { id, name } = req.body || {};
    const result = await orgSvc.createAffiliation(pool, { id, name, ...actorCtx(req) });
    return sendSuccess(res, result, 'เพิ่มสังกัดแล้ว', null, 201);
  } catch (err) { return next(err); }
});

/** PUT /api/province/affiliations/:id { name } */
router.put('/affiliations/:id', async (req, res, next) => {
  try {
    const { name } = req.body || {};
    const result = await orgSvc.renameAffiliation(pool, { id: req.params.id, name, ...actorCtx(req) });
    return sendSuccess(res, result, 'บันทึกชื่อสังกัดแล้ว');
  } catch (err) { return next(err); }
});

/** GET /api/province/affiliations/deactivated — affiliations that can be restored. */
router.get('/affiliations/deactivated', async (req, res, next) => {
  try {
    const rows = await orgSvc.listDeactivatedAffiliations(pool);
    return sendSuccess(res, rows, 'OK', { total: rows.length });
  } catch (err) { return next(err); }
});

/**
 * POST /api/province/affiliations/:id/deactivate { reason? }
 * 409 while the affiliation still has active schools. Closes its affiliation
 * accounts in the same transaction.
 */
router.post('/affiliations/:id/deactivate', async (req, res, next) => {
  try {
    const { reason } = req.body || {};
    const result = await orgSvc.deactivateAffiliation(pool, { id: req.params.id, reason, ...actorCtx(req) });
    return sendSuccess(res, result, 'ปิดใช้งานสังกัดแล้ว และปิดบัญชีผู้ใช้ของสังกัดนี้แล้ว');
  } catch (err) { return next(err); }
});

/** POST /api/province/affiliations/:id/restore — accounts stay closed. */
router.post('/affiliations/:id/restore', async (req, res, next) => {
  try {
    const result = await orgSvc.restoreAffiliation(pool, { id: req.params.id, ...actorCtx(req) });
    return sendSuccess(res, result, 'กู้คืนสังกัดแล้ว บัญชีของสังกัดยังปิดอยู่ เปิดได้ที่เมนูบัญชีสังกัดและขนส่ง');
  } catch (err) { return next(err); }
});

/** GET /api/province/schools/deactivated — schools that can be restored. */
router.get('/schools/deactivated', async (req, res, next) => {
  try {
    const rows = await orgSvc.listDeactivatedSchools(pool);
    return sendSuccess(res, rows, 'OK', { total: rows.length });
  } catch (err) { return next(err); }
});

/** PUT /api/province/schools/:id { name?, affiliation_id? } — rename / move. */
router.put('/schools/:id', async (req, res, next) => {
  try {
    const { name, affiliation_id } = req.body || {};
    const result = await orgSvc.updateSchool(pool, {
      schoolId: req.params.id, name, affiliationId: affiliation_id, ...actorCtx(req),
    });
    return sendSuccess(res, result, result.changed ? 'บันทึกข้อมูลโรงเรียนแล้ว' : 'ไม่มีข้อมูลเปลี่ยนแปลง');
  } catch (err) { return next(err); }
});

/** POST /api/province/schools/:id/deactivate { reason? } */
router.post('/schools/:id/deactivate', async (req, res, next) => {
  try {
    const { reason } = req.body || {};
    const result = await orgSvc.deactivateSchool(pool, { schoolId: req.params.id, reason, ...actorCtx(req) });
    return sendSuccess(res, result, 'ปิดใช้งานโรงเรียนแล้ว และปิดบัญชีของโรงเรียนนี้แล้ว');
  } catch (err) { return next(err); }
});

/** POST /api/province/schools/:id/restore */
router.post('/schools/:id/restore', async (req, res, next) => {
  try {
    const result = await orgSvc.restoreSchool(pool, { schoolId: req.params.id, ...actorCtx(req) });
    return sendSuccess(res, result, 'กู้คืนโรงเรียนแล้ว บัญชีของโรงเรียนยังปิดอยู่ ให้สังกัดเปิดบัญชีเมื่อพร้อม');
  } catch (err) { return next(err); }
});

function tripsEnabled(res) {
  if (tripSvc.enabled()) return true;
  sendError(res, 'ยังไม่เปิดใช้การบันทึกหลายเที่ยว', [], 404);
  return false;
}

// GET /api/province/vehicle-trips?date_from&date_to — every bus in the province
// that ran extra trips, with reasons (FEATURE_MULTI_TRIP). No phone numbers (§5.5).
router.get('/vehicle-trips', async (req, res, next) => {
  try {
    if (!tripsEnabled(res)) return;
    const range = tripSvc.parseRange(req.query);
    const rows = await tripSvc.tripSummary(pool, {
      ...range, vehicleScopeSql: 'SELECT id FROM vehicles', vehicleScopeParams: [],
    });
    return sendSuccess(res, { ...range, rows });
  } catch (err) { next(err); }
});

module.exports = router;
