'use strict';

const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const ExcelJS = require('exceljs');
const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/roleGuard');
const { sendSuccess, sendError } = require('../utils/response');
const { pool } = require('../config/database');
const affSvc = require('../services/affiliation.service');
const affAdminSvc = require('../services/affiliationAdmin.service');
const vllSvc = require('../services/vehicleLocation.service');
const ppSvc = require('../services/pickupPoint.service');
const { logAudit } = require('../utils/audit');

// ─── Bulk-import upload (Phase 10.2A) ────────────────────────────────────────
// Disk-backed multer config mirroring backend/src/routes/school.routes.js.
// Files are written to uploads/imports/, then read once by the handler and
// deleted in `finally`. 5 MB cap is generous for a ~100-row Excel.
const importUploadDir = path.join(__dirname, '../../uploads/imports');
if (!fs.existsSync(importUploadDir)) fs.mkdirSync(importUploadDir, { recursive: true });
const importUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, importUploadDir),
    filename: (_req, file, cb) => cb(null, `aff-import-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${path.extname(file.originalname).toLowerCase()}`),
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ext === '.xlsx' || ext === '.csv') cb(null, true);
    else cb(new Error('รองรับเฉพาะไฟล์ .xlsx หรือ .csv'), false);
  },
});

/**
 * Parse the uploaded import file into raw rows for the service layer.
 * Returns Array<{ rowNum, school_code, school_name, username, initial_password }>.
 * Tolerant of column ordering when the header row uses Thai-or-English keys.
 */
async function parseSchoolImportFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const rows = [];

  // Match a column header (case- and accent-tolerant) to one of our 4 keys.
  function matchHeader(h) {
    const s = String(h || '').trim().toLowerCase().replace(/\s+/g, '');
    if (!s) return null;
    if (s.includes('school_code') || s.includes('รหัสโรงเรียน') || s.includes('schoolcode')) return 'school_code';
    if (s.includes('school_name') || s.includes('ชื่อโรงเรียน') || s.includes('schoolname')) return 'school_name';
    if (s.includes('username')    || s.includes('ชื่อผู้ใช้'))                                 return 'username';
    if (s.includes('initial_password') || s.includes('รหัสผ่าน') || s.includes('password'))   return 'initial_password';
    return null;
  }

  if (ext === '.csv') {
    const raw = fs.readFileSync(filePath, 'utf-8').replace(/^﻿/, '');
    const lines = raw.split(/\r?\n/).filter(l => l.trim().length);
    if (lines.length < 2) return [];
    const header = lines[0].split(',').map(c => c.trim());
    const colMap = {};
    header.forEach((h, i) => { const k = matchHeader(h); if (k) colMap[k] = i; });
    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(',');
      rows.push({
        rowNum: i + 1,
        school_code:      (cols[colMap.school_code]      ?? '').trim().replace(/^"|"$/g, ''),
        school_name:      (cols[colMap.school_name]      ?? '').trim().replace(/^"|"$/g, ''),
        username:         (cols[colMap.username]         ?? '').trim().replace(/^"|"$/g, ''),
        initial_password: (cols[colMap.initial_password] ?? '').trim().replace(/^"|"$/g, ''),
      });
    }
    return rows;
  }

  // .xlsx via ExcelJS
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(filePath);
  const ws = wb.getWorksheet(1) || wb.worksheets[0];
  if (!ws) return [];

  const colMap = {};
  const headerRow = ws.getRow(1);
  headerRow.eachCell((cell, col) => {
    const k = matchHeader(cell.value);
    if (k) colMap[k] = col;
  });

  ws.eachRow((row, rowNum) => {
    if (rowNum === 1) return;
    const get = (key) => {
      const idx = colMap[key];
      if (!idx) return '';
      const cell = row.getCell(idx);
      const v = cell.value;
      if (v === null || v === undefined) return '';
      if (typeof v === 'object' && v.text)   return String(v.text).trim();
      if (typeof v === 'object' && v.result) return String(v.result).trim();
      return String(v).trim();
    };
    const r = {
      rowNum,
      school_code:      get('school_code'),
      school_name:      get('school_name'),
      username:         get('username'),
      initial_password: get('initial_password'),
    };
    // Skip fully-empty rows so trailing blank rows in Excel aren't reported.
    if (r.school_code || r.school_name || r.username || r.initial_password) rows.push(r);
  });

  return rows;
}

const { csvCell, redactAuditValue } = require('../utils/exportSecurity');

// Shared CSV helper for audit export
function auditRowsToCsv(rows) {
  const ACTION_TH = { CREATE: 'สร้าง', UPDATE: 'แก้ไข', DELETE: 'ลบ', EXPORT: 'ส่งออก', LOGIN: 'เข้าสู่ระบบ', IMPORT: 'นำเข้า', APPROVE: 'อนุมัติ' };
  const ENTITY_TH = { student: 'นักเรียน', vehicle: 'รถรับส่ง', user: 'บัญชีผู้ใช้', roster_request: 'คำขอรายชื่อ', leave: 'การลา', checkin: 'เช็กอิน', checkin_override: 'ยืนยันแทนคนขับ' };
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

// ─── School-Account Bulk Import (Phase 10.2A) ───────────────────────────────
// Two-phase flow: preview (read-only validation) → commit (transactional
// insert). Both endpoints accept the same .xlsx/.csv upload; the frontend
// re-uploads on commit so we re-validate against current DB state and never
// trust a stale client-side preview.
//
// Security:
//   - Affiliation scope comes from JWT via resolveAffiliationId(req); the
//     caller cannot override it from the body or query.
//   - The plaintext initial_password (operator-supplied or defaulted) is
//     consumed inline by bcrypt.hash() in the service layer and is NEVER
//     returned in any API response.
//   - Multer disk-storage files are deleted in `finally`.

/**
 * GET /api/affiliation/school-accounts/import-template
 *
 * Streams a freshly-generated .xlsx with the 4 import columns plus a small
 * sample row and an "instructions" sheet. No DB read; safe to call any
 * time.
 */
router.get('/school-accounts/import-template', async (_req, res, next) => {
  try {
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Lampang Bus System';
    wb.created = new Date();

    // Sheet 1: data — the columns the parser keys off.
    const ws = wb.addWorksheet('schools');
    ws.columns = [
      { header: 'school_code',      key: 'school_code',      width: 14 },
      { header: 'school_name',      key: 'school_name',      width: 40 },
      { header: 'username',         key: 'username',         width: 14 },
      { header: 'initial_password', key: 'initial_password', width: 18 },
    ];
    // Bold + colored header.
    ws.getRow(1).font = { bold: true };
    ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8F0FE' } };
    // One sample row so operators can see the format. Delete before upload.
    ws.addRow({
      school_code: '101010',
      school_name: 'โรงเรียนตัวอย่าง',
      username: '101010',
      initial_password: '',  // blank → defaults to school_code at commit time
    });

    // Sheet 2: instructions
    const guide = wb.addWorksheet('คำอธิบาย');
    guide.getColumn(1).width = 90;
    const lines = [
      ['คำอธิบายการนำเข้าโรงเรียนแบบหลายรายการ', true],
      ['', false],
      ['คอลัมน์ที่ใช้ในชีท "schools":', false],
      ['• school_code (จำเป็น) — รหัสโรงเรียน 6-10 หลัก', false],
      ['• school_name (จำเป็น) — ชื่อโรงเรียน', false],
      ['• username (ไม่บังคับ) — รหัส OBEC 6 หลัก ถ้าไม่ระบุ ระบบจะใช้ school_code (กรณี 6 หลัก) เป็นค่าเริ่มต้น', false],
      ['• initial_password (ไม่บังคับ) — รหัสผ่านเริ่มต้น ถ้าไม่ระบุ ระบบจะใช้ school_code เป็นค่าเริ่มต้น', false],
      ['', false],
      ['ข้อปฏิบัติ:', false],
      ['• ลบแถวตัวอย่างก่อนกรอกข้อมูลจริง', false],
      ['• ระบบจะเพิ่มเฉพาะโรงเรียนในสังกัดของท่านเท่านั้น (กำหนดจากบัญชีผู้ใช้ที่ล็อกอิน)', false],
      ['• รหัสโรงเรียนหรือชื่อผู้ใช้ที่ซ้ำกับในระบบ จะถูกข้ามและรายงานผลให้ทราบ', false],
      ['• รหัสผ่านเริ่มต้นจะถูกเข้ารหัสด้วย bcrypt และผู้ใช้ต้องเปลี่ยนรหัสผ่านเมื่อเข้าสู่ระบบครั้งแรก', false],
      ['• ระบบจะไม่บันทึกหรือส่งคืนรหัสผ่านในรูปแบบ plaintext หลังนำเข้า', false],
    ];
    lines.forEach(([text, bold], i) => {
      const r = guide.getRow(i + 1);
      r.getCell(1).value = text;
      if (bold) r.getCell(1).font = { bold: true, size: 14 };
    });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename=school_account_import_template.xlsx');
    await wb.xlsx.write(res);
    res.end();
  } catch (err) { next(err); }
});

/**
 * POST /api/affiliation/school-accounts/import/preview
 *
 * Multipart upload, field name "file". Returns validation results without
 * touching the DB. Frontend uses this to populate the preview table.
 */
router.post('/school-accounts/import/preview', importUpload.single('file'), async (req, res, next) => {
  let filePath = null;
  try {
    const affId = resolveAffiliationId(req);
    if (!affId) return sendError(res, 'ไม่พบข้อมูลเขตพื้นที่', [], 403);
    if (!req.file) return sendError(res, 'กรุณาเลือกไฟล์ (.xlsx หรือ .csv)', [], 400);
    filePath = req.file.path;

    const rawRows = await parseSchoolImportFile(filePath);
    if (!rawRows.length) return sendError(res, 'ไม่พบข้อมูลในไฟล์ (ไม่มีแถวข้อมูล)', [], 400);

    const result = await affAdminSvc.previewSchoolImport(rawRows, affId);
    return sendSuccess(res, result);
  } catch (err) {
    next(err);
  } finally {
    if (filePath) { try { fs.unlinkSync(filePath); } catch { /* ignore */ } }
  }
});

/**
 * POST /api/affiliation/school-accounts/import/commit
 *
 * Multipart upload, field name "file". Same parse logic as preview, then
 * one transactional commit that inserts only the valid rows. Invalid rows
 * are reported and skipped, not rolled-back. Returns row-by-row status.
 * NEVER returns plaintext passwords.
 */
router.post('/school-accounts/import/commit', importUpload.single('file'), async (req, res, next) => {
  let filePath = null;
  try {
    const affId = resolveAffiliationId(req);
    if (!affId) return sendError(res, 'ไม่พบข้อมูลเขตพื้นที่', [], 403);
    if (!req.file) return sendError(res, 'กรุณาเลือกไฟล์ (.xlsx หรือ .csv)', [], 400);
    filePath = req.file.path;

    const rawRows = await parseSchoolImportFile(filePath);
    if (!rawRows.length) return sendError(res, 'ไม่พบข้อมูลในไฟล์ (ไม่มีแถวข้อมูล)', [], 400);

    const result = await affAdminSvc.commitSchoolImport(rawRows, affId, req.user.id);
    const msg = `นำเข้าสำเร็จ ${result.summary.created} โรงเรียน, ข้าม ${result.summary.skipped} แถว`;
    return sendSuccess(res, result, msg);
  } catch (err) {
    next(err);
  } finally {
    if (filePath) { try { fs.unlinkSync(filePath); } catch { /* ignore */ } }
  }
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
      // Audit 2026-06-18 (limitations): fetch one extra row to detect truncation
      // and tell the caller, instead of silently dropping older records.
      const [rows] = await pool.query(
        `SELECT al.id, al.action, al.entity_type, al.entity_id,
                al.old_value, al.new_value, al.created_at,
                u.display_name AS actor_name, u.role AS actor_role
         FROM audit_logs al LEFT JOIN users u ON u.id = al.user_id
         WHERE ${scopeWhere} ORDER BY al.created_at DESC LIMIT 5001`, params
      );
      const truncated = rows.length > 5000;
      const csv = auditRowsToCsv(rows.slice(0, 5000));
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename=audit_affiliation_${new Date().toISOString().split('T')[0]}.csv`);
      if (truncated) res.setHeader('X-Truncated', 'true');
      logAudit({ userId: req.user.id, action: 'EXPORT', entityType: 'audit_csv', entityId: 'affiliation',
        newValue: { role: req.user.role, truncated }, ipAddress: req.ip, userAgent: req.headers['user-agent'] }).catch(() => {});
      return res.send('\uFEFF' + csv +
        (truncated ? '\n"# \u0E41\u0E2A\u0E14\u0E07 5000 \u0E41\u0E16\u0E27\u0E25\u0E48\u0E32\u0E2A\u0E38\u0E14 \u2014 \u0E01\u0E23\u0E38\u0E13\u0E32\u0E23\u0E30\u0E1A\u0E38\u0E0A\u0E48\u0E27\u0E07\u0E27\u0E31\u0E19\u0E17\u0E35\u0E48 (date_from/date_to) \u0E40\u0E1E\u0E37\u0E48\u0E2D\u0E14\u0E39\u0E17\u0E31\u0E49\u0E07\u0E2B\u0E21\u0E14"' : ''));
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

    // Audit 2026-06-18 (limitations): the CSV path already redacts, but the JSON
    // list returned raw old_value/new_value to the affiliation role — apply the
    // same PII redaction here.
    const safeRows = rows.map((r) => ({
      ...r,
      old_value: r.old_value ? redactAuditValue(r.old_value) : null,
      new_value: r.new_value ? redactAuditValue(r.new_value) : null,
    }));

    return sendSuccess(res, safeRows, 'OK', { page, per_page, total });
  } catch (err) { next(err); }
});

// ─── POST /notify-school — Log notification sent to school ──────────────────
router.post('/notify-school', async (req, res, next) => {
  try {
    const { school_id, school_name, message, method } = req.body;
    if (!school_id) return sendError(res, 'กรุณาระบุ school_id', [], 400);

    // Phase 10.13A-27 — only allow notifying a school within the caller's own
    // affiliation (admins may notify any). Prevents out-of-scope notifications.
    if (req.user.role !== 'admin') {
      const affId = resolveAffiliationId(req);
      const [[sch]] = await pool.query(
        'SELECT id FROM schools WHERE id = ? AND affiliation_id = ? AND is_deleted = FALSE',
        [school_id, affId]
      );
      if (!sch) return sendError(res, 'ไม่สามารถแจ้งเตือนโรงเรียนนอกเขตพื้นที่ของท่านได้', [], 403);
    }

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


// ─── Tier 3: Affiliation-managed approval queues ─────────────────────────────

// Student transfer requests
router.get('/transfer-requests', async (req, res, next) => {
  try {
    const transfer = require('../services/studentTransfer.service');
    const affId = affiliationId(req);
    if (!affId) return sendError(res, 'กรุณาระบุสังกัด', [{ code: 'AFFILIATION_SCOPE_REQUIRED' }], 400);
    const data = await transfer.listForAffiliation(pool, { affiliationId: affId, status: req.query.status || null });
    return sendSuccess(res, data);
  } catch (err) { next(err); }
});

router.get('/transfer-requests/:id', async (req, res, next) => {
  try {
    const transfer = require('../services/studentTransfer.service');
    const affId = affiliationId(req);
    if (!affId) return sendError(res, 'กรุณาระบุสังกัด', [{ code: 'AFFILIATION_SCOPE_REQUIRED' }], 400);
    const data = await transfer.getDetailForAffiliation(pool, { requestId: parseInt(req.params.id, 10), affiliationId: affId });
    return sendSuccess(res, data);
  } catch (err) { next(err); }
});

router.post('/transfer-requests/:id/approve', async (req, res, next) => {
  try {
    const transfer = require('../services/studentTransfer.service');
    const affId = affiliationId(req);
    if (!affId) return sendError(res, 'กรุณาระบุสังกัด', [{ code: 'AFFILIATION_SCOPE_REQUIRED' }], 400);
    // Verify the request belongs to this affiliation
    await transfer.getDetailForAffiliation(pool, { requestId: parseInt(req.params.id, 10), affiliationId: affId });
    const out = await transfer.approveAndApply(pool, { requestId: parseInt(req.params.id, 10), adminUserId: req.user.id, adminNote: (req.body || {}).admin_note });
    await logAudit({ userId: req.user.id, action: 'APPROVE', entityType: 'student_transfer_request', entityId: String(req.params.id),
      newValue: { result: out.status, approved_by_affiliation: true }, ipAddress: req.ip, userAgent: req.headers['user-agent'] });
    const msg = out.status === 'APPLIED' ? 'อนุมัติและดำเนินการโอนย้ายสำเร็จ'
      : out.status === 'ALREADY_APPLIED' ? 'คำขอนี้ดำเนินการไปแล้ว'
      : out.status === 'FAILED' ? 'ไม่สามารถดำเนินการได้'
      : out.status === 'STALE_NEEDS_REVIEW' ? 'ข้อมูลนักเรียนเปลี่ยนแปลงตั้งแต่ส่งคำขอ กรุณาตรวจสอบใหม่' : 'ดำเนินการแล้ว';
    return sendSuccess(res, out, msg);
  } catch (err) { next(err); }
});

router.post('/transfer-requests/:id/reject', async (req, res, next) => {
  try {
    const transfer = require('../services/studentTransfer.service');
    const affId = affiliationId(req);
    if (!affId) return sendError(res, 'กรุณาระบุสังกัด', [{ code: 'AFFILIATION_SCOPE_REQUIRED' }], 400);
    await transfer.getDetailForAffiliation(pool, { requestId: parseInt(req.params.id, 10), affiliationId: affId });
    const out = await transfer.reject(pool, { requestId: parseInt(req.params.id, 10), adminUserId: req.user.id, adminNote: (req.body || {}).admin_note });
    await logAudit({ userId: req.user.id, action: 'UPDATE', entityType: 'student_transfer_request', entityId: String(req.params.id),
      newValue: { result: 'REJECTED', rejected_by_affiliation: true }, ipAddress: req.ip, userAgent: req.headers['user-agent'] });
    return sendSuccess(res, out, 'ไม่อนุมัติคำขอแล้ว');
  } catch (err) { next(err); }
});

// Vehicle requests
router.get('/vehicle-requests', async (req, res, next) => {
  try {
    const vr = require('../services/vehicleRequest.service');
    const affId = affiliationId(req);
    if (!affId) return sendError(res, 'กรุณาระบุสังกัด', [{ code: 'AFFILIATION_SCOPE_REQUIRED' }], 400);
    const data = await vr.listForAffiliation(pool, { affiliationId: affId, status: req.query.status || null });
    return sendSuccess(res, data);
  } catch (err) { next(err); }
});

router.get('/vehicle-requests/:id', async (req, res, next) => {
  try {
    const vr = require('../services/vehicleRequest.service');
    const affId = affiliationId(req);
    if (!affId) return sendError(res, 'กรุณาระบุสังกัด', [{ code: 'AFFILIATION_SCOPE_REQUIRED' }], 400);
    const data = await vr.getDetailForAffiliation(pool, { requestId: parseInt(req.params.id, 10), affiliationId: affId });
    return sendSuccess(res, data);
  } catch (err) { next(err); }
});

router.post('/vehicle-requests/:id/approve', async (req, res, next) => {
  try {
    const vr = require('../services/vehicleRequest.service');
    const affId = affiliationId(req);
    if (!affId) return sendError(res, 'กรุณาระบุสังกัด', [{ code: 'AFFILIATION_SCOPE_REQUIRED' }], 400);
    await vr.getDetailForAffiliation(pool, { requestId: parseInt(req.params.id, 10), affiliationId: affId });
    const out = await vr.approveVehicleRequest(pool, { requestId: parseInt(req.params.id, 10), adminUserId: req.user.id, adminNote: (req.body || {}).admin_note });
    await logAudit({ userId: req.user.id, action: 'APPROVE', entityType: 'vehicle_request', entityId: String(req.params.id),
      newValue: { result: out.status, approved_by_affiliation: true }, ipAddress: req.ip, userAgent: req.headers['user-agent'] });
    return sendSuccess(res, out, 'อนุมัติคำขอแล้ว');
  } catch (err) { next(err); }
});

router.post('/vehicle-requests/:id/reject', async (req, res, next) => {
  try {
    const vr = require('../services/vehicleRequest.service');
    const affId = affiliationId(req);
    if (!affId) return sendError(res, 'กรุณาระบุสังกัด', [{ code: 'AFFILIATION_SCOPE_REQUIRED' }], 400);
    await vr.getDetailForAffiliation(pool, { requestId: parseInt(req.params.id, 10), affiliationId: affId });
    const out = await vr.rejectVehicleRequest(pool, { requestId: parseInt(req.params.id, 10), adminUserId: req.user.id, adminNote: (req.body || {}).admin_note });
    await logAudit({ userId: req.user.id, action: 'UPDATE', entityType: 'vehicle_request', entityId: String(req.params.id),
      newValue: { result: 'REJECTED', rejected_by_affiliation: true }, ipAddress: req.ip, userAgent: req.headers['user-agent'] });
    return sendSuccess(res, out, 'ไม่อนุมัติคำขอแล้ว');
  } catch (err) { next(err); }
});


module.exports = router;
