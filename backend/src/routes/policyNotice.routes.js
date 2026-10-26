'use strict';

const crypto = require('crypto');
const express = require('express');
const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/roleGuard');
const { pool } = require('../config/database');
const { logAudit } = require('../utils/audit');
const { sendSuccess, sendError } = require('../utils/response');
const { isCalendarDate, isCalendarMonth } = require('../utils/calendarDate');
const {
  APPROVED, REVIEW_MODE, noticesForRole, actionPolicyForRole, catalogForRole,
} = require('../config/policyNotices');
const { tokenDigest, consumePolicyAction } = require('../utils/policyActionEvidence');
const { requirePolicyEvidenceTables } = require('../utils/policyEvidenceTables');

const router = express.Router();
const STAFF_ROLES = ['school', 'driver', 'transport', 'affiliation', 'province', 'admin'];
router.use(authenticate);
// The migration 052/053 tables are only read or written once a policy is
// APPROVED; until then every route answers from config without touching the
// database, and keeps doing so. Once APPROVED, a missing table makes every
// route here answer 503 with a Thai message instead of ER_NO_SUCH_TABLE (see
// utils/policyEvidenceTables.js). Placed after authenticate so an anonymous
// caller still gets 401 and learns nothing about the schema.
router.use((req, res, next) => (APPROVED ? requirePolicyEvidenceTables(req, res, next) : next()));

function digest(notice) {
  return crypto.createHash('sha256').update(JSON.stringify(notice)).digest('hex');
}

function readSubject(value, max = 100) {
  const out = typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
  return out && out.length <= max ? out : null;
}

function count(value) {
  return Number.isInteger(value) && value >= 0 && value <= 100000 ? value : null;
}

// Claims are deliberately whitelisted. The evidence ledger needs counts and
// decision metadata, never pupil names, phone numbers, notes or uploaded rows.
function sanitizeClaim(context, input) {
  if (!input || Array.isArray(input) || typeof input !== 'object') return null;
  if (context === 'school.student_import_apply') {
    const keys = ['ready_count', 'guardian_update_count', 'reactivate_count', 'auto_vehicle_count', 'skipped_count', 'error_count'];
    const values = Object.fromEntries(keys.map((key) => [key, count(input[key])]));
    return Object.values(values).every((value) => value !== null) ? values : null;
  }
  if (context === 'transport.inspection_create' || context === 'transport.inspection_update') {
    if (!isCalendarDate(input.inspection_date)
      || (input.expiry_date !== null && input.expiry_date !== '' && !isCalendarDate(input.expiry_date))
      || !['PASSED', 'FAILED', 'NEEDS_FIX', 'PENDING'].includes(input.result)
      || typeof input.has_notes !== 'boolean') return null;
    return {
      inspection_date: input.inspection_date,
      expiry_date: input.expiry_date || null,
      result: input.result,
      has_notes: input.has_notes,
    };
  }
  if (context === 'transport.vehicle_export') {
    if (input.report !== 'vehicle_safety'
      || input.contains_students !== false || input.contains_phone_numbers !== false) return null;
    return { report: 'vehicle_safety', contains_students: false, contains_phone_numbers: false };
  }
  if (context === 'driver.shift_start') {
    if (!['MORNING', 'EVENING', 'OTHER'].includes(input.session)) return null;
    return { session: input.session };
  }
  if (context === 'report.export') {
    if (!['daily', 'monthly'].includes(input.report_type)
      || !['csv', 'excel', 'pdf'].includes(input.format)) return null;
    if (input.report_type === 'daily' && !isCalendarDate(input.date)) return null;
    if (input.report_type === 'monthly' && !isCalendarMonth(input.month)) return null;
    return {
      report_type: input.report_type,
      format: input.format,
      date: input.report_type === 'daily' ? input.date : null,
      month: input.report_type === 'monthly' ? input.month : null,
      contains_student_rows: input.report_type === 'daily' && input.format !== 'pdf',
    };
  }
  if (context === 'admin.research_export') {
    const allowed = ['snapshots', 'audit', 'exports', 'summary'];
    if (!isCalendarDate(input.from) || !isCalendarDate(input.to) || input.from > input.to
      || !['json', 'csv', 'excel'].includes(input.format)
      || !Array.isArray(input.include) || input.include.length === 0
      || input.include.length > allowed.length
      || input.include.some((value) => !allowed.includes(value))
      || new Set(input.include).size !== input.include.length) return null;
    return { from: input.from, to: input.to, format: input.format, include: [...input.include].sort() };
  }
  return null;
}

function claimMatchesSubject(context, subjectId, claim) {
  if (context === 'report.export') {
    const value = claim.report_type === 'daily' ? claim.date : claim.month;
    return subjectId === `${claim.report_type}:${value}:${claim.format}`;
  }
  if (context === 'admin.research_export') {
    return subjectId === `${claim.from}:${claim.to}:${claim.format}:${claim.include.join(',')}`;
  }
  return true;
}

async function subjectExistsForRole(req, action, subjectId) {
  if (action.context === 'transport.vehicle_export') return subjectId === 'vehicles';
  if (action.context === 'school.student_import_apply') {
    const sql = req.user.role === 'admin'
      ? 'SELECT id FROM import_batches WHERE id = ? LIMIT 1'
      : 'SELECT id FROM import_batches WHERE id = ? AND school_id = ? LIMIT 1';
    const params = req.user.role === 'admin' ? [subjectId] : [subjectId, req.user.scopeId];
    const [rows] = await pool.query(sql, params);
    return rows.length === 1;
  }
  if (action.context === 'transport.inspection_create') {
    const [rows] = await pool.query(
      'SELECT id FROM vehicles WHERE id = ? AND is_deleted = FALSE LIMIT 1', [subjectId]
    );
    return rows.length === 1;
  }
  if (action.context === 'transport.inspection_update') {
    const [rows] = await pool.query(
      'SELECT id FROM vehicle_inspections WHERE id = ? LIMIT 1', [subjectId]
    );
    return rows.length === 1;
  }
  if (action.context === 'driver.shift_start') {
    if (!req.user.driver_id) return false;
    const [rows] = await pool.query(
      `SELECT id FROM driver_vehicle_assignments
        WHERE driver_id = ? AND vehicle_id = ? AND is_active = TRUE
          AND authorization_status = 'AUTHORIZED'
          AND (valid_from IS NULL OR valid_from <= CURDATE())
          AND (valid_until IS NULL OR valid_until >= CURDATE())
        LIMIT 1`,
      [req.user.driver_id, subjectId]
    );
    return rows.length === 1;
  }
  if (action.context === 'report.export') {
    const [type, value, format, extra] = subjectId.split(':');
    return !extra && ['csv', 'excel', 'pdf'].includes(format)
      && ((type === 'daily' && isCalendarDate(value))
        || (type === 'monthly' && isCalendarMonth(value)));
  }
  if (action.context === 'admin.research_export') {
    const [from, to, format, includeCsv, extra] = subjectId.split(':');
    const allowed = ['snapshots', 'audit', 'exports', 'summary'];
    const include = (includeCsv || '').split(',').filter(Boolean);
    return !extra && isCalendarDate(from) && isCalendarDate(to) && from <= to
      && ['json', 'csv', 'excel'].includes(format)
      && include.length > 0 && include.length <= allowed.length
      && include.every((value) => allowed.includes(value))
      && new Set(include).size === include.length;
  }
  return false;
}

// Review drafts may be displayed only with explicit labels. They are never
// recorded as a lawful acknowledgement or action-evidence decision.
router.get('/current', requireRole(...STAFF_ROLES), async (req, res, next) => {
  if (!APPROVED && !REVIEW_MODE) return sendSuccess(res, { enabled: false, reviewMode: false, notices: [] });
  if (!APPROVED) {
    return sendSuccess(res, {
      enabled: true,
      reviewMode: true,
      notices: noticesForRole(req.user.role).map((notice) => ({ ...notice, acknowledged: false })),
    });
  }
  try {
    const notices = noticesForRole(req.user.role);
    const [rows] = await pool.query(
      'SELECT notice_key, notice_version FROM policy_acknowledgements WHERE user_id = ?',
      [req.user.id]
    );
    const acknowledged = new Set(rows.map((row) => `${row.notice_key}:${row.notice_version}`));
    return sendSuccess(res, {
      enabled: true, reviewMode: false,
      notices: notices.map((notice) => ({
        ...notice,
        acknowledged: acknowledged.has(`${notice.key}:${notice.version}`),
      })),
    });
  } catch (err) { return next(err); }
});

router.get('/action/:context', requireRole(...STAFF_ROLES), async (req, res) => {
  if (!APPROVED && !REVIEW_MODE) return sendSuccess(res, { enabled: false, reviewMode: false, action: null });
  const action = actionPolicyForRole(req.user.role, req.params.context);
  if (!action) return sendError(res, 'ไม่พบข้อความสำหรับบทบาทและรายการนี้', [], 404);
  return sendSuccess(res, { enabled: true, reviewMode: !APPROVED, action });
});

router.get('/catalog', requireRole(...STAFF_ROLES), async (req, res, next) => {
  if (!APPROVED && !REVIEW_MODE) return sendSuccess(res, { enabled: false, reviewMode: false, policies: [] });
  if (!APPROVED) {
    return sendSuccess(res, {
      enabled: true, reviewMode: true,
      policies: catalogForRole(req.user.role).map((policy) => ({ ...policy, acknowledgedAt: null })),
    });
  }
  try {
    const [rows] = await pool.query(
      'SELECT notice_key, notice_version, acknowledged_at FROM policy_acknowledgements WHERE user_id = ?',
      [req.user.id]
    );
    const acknowledged = new Map(rows.map((row) => [
      `${row.notice_key}:${row.notice_version}`, row.acknowledged_at,
    ]));
    const policies = catalogForRole(req.user.role).map((policy) => ({
      ...policy,
      acknowledgedAt: acknowledged.get(`${policy.key}:${policy.version}`) || null,
    }));
    return sendSuccess(res, { enabled: true, reviewMode: false, policies });
  } catch (err) { return next(err); }
});

router.post('/prepare-action', requireRole(...STAFF_ROLES), async (req, res, next) => {
  if (!APPROVED) return sendError(res, 'ยังไม่มีข้อความที่ผ่านการรับรอง', [], 404);
  const context = typeof req.body?.context === 'string' ? req.body.context : '';
  const action = actionPolicyForRole(req.user.role, context);
  if (!action) return sendError(res, 'บทบาทนี้ไม่มีสิทธิ์ยืนยันรายการดังกล่าว', [], 403);
  const subjectType = readSubject(req.body?.subject_type, 50);
  const subjectId = readSubject(req.body?.subject_id);
  if (subjectType !== action.subjectType || !subjectId) {
    return sendError(res, 'รายการอ้างอิงไม่ตรงกับข้อความยืนยัน', [], 400);
  }
  try {
    if (!await subjectExistsForRole(req, action, subjectId)) {
      return sendError(res, 'ไม่พบรายการในขอบเขตสิทธิ์ของบัญชีนี้', [], 404);
    }
  } catch (err) { return next(err); }
  const claim = sanitizeClaim(context, req.body?.claim);
  if (!claim) {
    return sendError(res, 'กรุณาระบุสรุปรายการที่ยืนยัน', [], 400);
  }
  if (!claimMatchesSubject(context, subjectId, claim)) {
    return sendError(res, 'สรุปรายการไม่ตรงกับรายการอ้างอิง', [], 400);
  }
  const claimSnapshot = JSON.stringify(claim);
  if (Buffer.byteLength(claimSnapshot, 'utf8') > 4096) {
    return sendError(res, 'รายละเอียดคำยืนยันยาวเกินกำหนด', [], 400);
  }

  const token = crypto.randomBytes(32).toString('base64url');
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [result] = await conn.query(
      `INSERT INTO policy_action_evidence
         (user_id, user_role, scope_type, scope_id, action_context, evidence_kind,
          subject_type, subject_id, notice_key, notice_version, notice_sha256,
          notice_text_snapshot, claim_snapshot, action_token_sha256, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, DATE_ADD(CURRENT_TIMESTAMP, INTERVAL 10 MINUTE))`,
      [req.user.id, req.user.role, req.user.scopeType, req.user.scopeId,
        context, action.kind, subjectType, subjectId, action.key, action.version,
        digest(action), JSON.stringify(action), claimSnapshot, tokenDigest(token)]
    );
    await logAudit({
      userId: req.user.id, action: 'CREATE', entityType: 'policy_action_evidence',
      entityId: String(result.insertId),
      newValue: {
        action_context: context, evidence_kind: action.kind,
        subject_type: subjectType, subject_id: subjectId,
        notice_key: action.key, notice_version: action.version,
        notice_sha256: digest(action),
      },
      conn, required: true,
    });
    await conn.commit();
    return sendSuccess(res, { token, context, subject_type: subjectType, subject_id: subjectId });
  } catch (err) {
    await conn.rollback();
    return next(err);
  } finally {
    conn.release();
  }
});

// Browser-generated PDF reports have no download route where the one-use
// token can be consumed. Consume it here immediately before opening print.
router.post('/consume-client-action', requireRole('school', 'affiliation', 'province', 'admin'), async (req, res) => {
  const context = typeof req.body?.context === 'string' ? req.body.context : '';
  const subjectType = readSubject(req.body?.subject_type, 50);
  const subjectId = readSubject(req.body?.subject_id);
  const action = actionPolicyForRole(req.user.role, context);
  if (context !== 'report.export' || subjectType !== 'report_export' || !subjectId
    || !action || action.subjectType !== subjectType || !subjectId.endsWith(':pdf')) {
    return sendError(res, 'รายการพิมพ์ไม่ตรงกับข้อความยืนยัน', [], 400);
  }
  if (!await consumePolicyAction(req, res, { context, subjectType, subjectId })) return undefined;
  return sendSuccess(res, { consumed: APPROVED, reviewMode: REVIEW_MODE && !APPROVED });
});

router.post('/acknowledge', requireRole(...STAFF_ROLES), async (req, res, next) => {
  if (!APPROVED) return sendError(res, 'ยังไม่มีประกาศที่ผ่านการรับรอง', [], 404);
  const key = typeof req.body?.key === 'string' ? req.body.key : '';
  const version = typeof req.body?.version === 'string' ? req.body.version : '';
  const notice = noticesForRole(req.user.role).find((item) => item.key === key && item.version === version);
  if (!notice) return sendError(res, 'หัวข้อหรือฉบับประกาศไม่ตรงกับบัญชีนี้', [], 400);

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    let result;
    try {
      [result] = await conn.query(
      `INSERT INTO policy_acknowledgements
         (user_id, user_role, scope_type, scope_id, notice_key, notice_version, notice_sha256, notice_text_snapshot)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [req.user.id, req.user.role, req.user.scopeType, req.user.scopeId, key, version, digest(notice), JSON.stringify(notice)]
      );
    } catch (err) {
      if (err.code !== 'ER_DUP_ENTRY') throw err;
      await conn.rollback();
      return sendSuccess(res, { key, version, acknowledged: true });
    }
    await logAudit({
      userId: req.user.id, action: 'CREATE', entityType: 'policy_acknowledgement',
      entityId: String(result.insertId),
      newValue: { notice_key: key, notice_version: version, notice_sha256: digest(notice) },
      conn, required: true,
    });
    await conn.commit();
    return sendSuccess(res, { key, version, acknowledged: true });
  } catch (err) {
    await conn.rollback();
    return next(err);
  } finally {
    conn.release();
  }
});

module.exports = router;
