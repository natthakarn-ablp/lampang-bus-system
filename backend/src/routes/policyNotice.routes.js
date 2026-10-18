'use strict';

const crypto = require('crypto');
const express = require('express');
const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/roleGuard');
const { pool } = require('../config/database');
const { logAudit } = require('../utils/audit');
const { sendSuccess, sendError } = require('../utils/response');
const { isCalendarDate } = require('../utils/calendarDate');
const { APPROVED, noticesForRole, actionPolicyForRole, catalogForRole } = require('../config/policyNotices');
const { tokenDigest } = require('../utils/policyActionEvidence');

const router = express.Router();
const STAFF_ROLES = ['school', 'driver', 'transport', 'affiliation', 'province', 'admin'];
router.use(authenticate, requireRole(...STAFF_ROLES));

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
  return null;
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
  return false;
}

// An unapproved draft is never displayed or recorded as a lawful notice.
router.get('/current', async (req, res, next) => {
  if (!APPROVED) return sendSuccess(res, { enabled: false, notices: [] });
  try {
    const notices = noticesForRole(req.user.role);
    const [rows] = await pool.query(
      'SELECT notice_key, notice_version FROM policy_acknowledgements WHERE user_id = ?',
      [req.user.id]
    );
    const acknowledged = new Set(rows.map((row) => `${row.notice_key}:${row.notice_version}`));
    return sendSuccess(res, {
      enabled: true,
      notices: notices.map((notice) => ({
        ...notice,
        acknowledged: acknowledged.has(`${notice.key}:${notice.version}`),
      })),
    });
  } catch (err) { return next(err); }
});

router.get('/action/:context', async (req, res) => {
  if (!APPROVED) return sendSuccess(res, { enabled: false, action: null });
  const action = actionPolicyForRole(req.user.role, req.params.context);
  if (!action) return sendError(res, 'ไม่พบข้อความสำหรับบทบาทและรายการนี้', [], 404);
  return sendSuccess(res, { enabled: true, action });
});

router.get('/catalog', async (req, res, next) => {
  if (!APPROVED) return sendSuccess(res, { enabled: false, policies: [] });
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
    return sendSuccess(res, { enabled: true, policies });
  } catch (err) { return next(err); }
});

router.post('/prepare-action', async (req, res, next) => {
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

router.post('/acknowledge', async (req, res, next) => {
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
