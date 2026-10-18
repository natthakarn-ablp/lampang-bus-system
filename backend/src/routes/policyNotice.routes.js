'use strict';

const crypto = require('crypto');
const express = require('express');
const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/roleGuard');
const { pool } = require('../config/database');
const { logAudit } = require('../utils/audit');
const { sendSuccess, sendError } = require('../utils/response');
const { APPROVED, noticesForRole } = require('../config/policyNotices');

const router = express.Router();
const STAFF_ROLES = ['school', 'driver', 'transport', 'affiliation', 'province', 'admin'];
router.use(authenticate, requireRole(...STAFF_ROLES));

function digest(notice) {
  return crypto.createHash('sha256').update(JSON.stringify(notice)).digest('hex');
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
