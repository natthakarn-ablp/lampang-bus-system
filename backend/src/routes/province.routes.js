'use strict';

const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/roleGuard');
const { sendSuccess } = require('../utils/response');
const { pool } = require('../config/database');
const provSvc = require('../services/province.service');

// Shared CSV helper for audit export
function auditRowsToCsv(rows) {
  const ACTION_TH = { CREATE: 'สร้าง', UPDATE: 'แก้ไข', DELETE: 'ลบ', EXPORT: 'ส่งออก', LOGIN: 'เข้าสู่ระบบ', IMPORT: 'นำเข้า', APPROVE: 'อนุมัติ' };
  const ENTITY_TH = { student: 'นักเรียน', vehicle: 'รถรับส่ง', user: 'บัญชีผู้ใช้', roster_request: 'คำขอรายชื่อ', leave: 'การลา', checkin: 'เช็กอิน' };
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const header = 'วันเวลา,ผู้ดำเนินการ,บทบาท,การกระทำ,ประเภท,รหัส,ค่าเดิม,ค่าใหม่';
  const lines = rows.map(r => [
    esc(new Date(r.created_at).toLocaleString('th-TH')),
    esc(r.actor_name || '-'), esc(r.actor_role || '-'),
    esc(ACTION_TH[r.action] || r.action), esc(ENTITY_TH[r.entity_type] || r.entity_type || '-'),
    esc(r.entity_id || '-'),
    esc(r.old_value ? JSON.stringify(r.old_value) : '-'),
    esc(r.new_value ? JSON.stringify(r.new_value) : '-'),
  ].join(','));
  return [header, ...lines].join('\n');
}

// Province routes: role 'province' or 'admin' (per RBAC matrix)
router.use(authenticate, requireRole('province', 'admin'));

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
    const { search, grade, school_id, affiliation_id, vehicle_id, sort, order } = req.query;
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const per_page = Math.min(100, Math.max(1, parseInt(req.query.per_page, 10) || 20));

    const result = await provSvc.getStudents({
      search, grade, school_id, affiliation_id, vehicle_id, page, per_page, sort, order,
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

// ─── GET /audit-logs ─────────────────────────────────────────────────────────

router.get('/audit-logs', async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const per_page = Math.min(100, Math.max(1, parseInt(req.query.per_page, 10) || 30));
    const offset = (page - 1) * per_page;
    const { action, date_from, date_to } = req.query;

    let where = '1=1';
    const params = [];
    if (action) { where += ' AND al.action = ?'; params.push(action); }
    if (date_from) { where += ' AND al.created_at >= ?'; params.push(`${date_from} 00:00:00`); }
    if (date_to) { where += ' AND al.created_at <= ?'; params.push(`${date_to} 23:59:59`); }

    // CSV export mode
    if (req.query.format === 'csv') {
      const [rows] = await pool.query(
        `SELECT al.id, al.action, al.entity_type, al.entity_id,
                al.old_value, al.new_value, al.created_at,
                u.display_name AS actor_name, u.role AS actor_role
         FROM audit_logs al LEFT JOIN users u ON u.id = al.user_id
         WHERE ${where} ORDER BY al.created_at DESC LIMIT 5000`, params
      );
      const csv = auditRowsToCsv(rows);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename=audit_province_${new Date().toISOString().split('T')[0]}.csv`);
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

    return sendSuccess(res, rows, 'OK', { page, per_page, total });
  } catch (err) { next(err); }
});

module.exports = router;
