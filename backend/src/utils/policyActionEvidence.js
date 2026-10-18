'use strict';

const crypto = require('crypto');
const { pool } = require('../config/database');
const { sendError } = require('./response');
const policyConfig = require('../config/policyNotices');

function tokenDigest(token) {
  return crypto.createHash('sha256').update(String(token || '')).digest('hex');
}

/**
 * Consume one server-issued confirmation token before a protected action.
 * When no reviewed policy is active this is deliberately a no-op, preserving
 * the existing production workflow. Once active, the token is actor, role,
 * context and subject bound and can be used only once.
 */
async function consumePolicyAction(req, res, { context, subjectType, subjectId }) {
  if (!policyConfig.APPROVED) return true;
  const policy = policyConfig.actionPolicyForRole(req.user.role, context);
  if (!policy || policy.subjectType !== subjectType) {
    sendError(res, 'บทบาทนี้ไม่มีสิทธิ์ยืนยันรายการดังกล่าว', [], 403);
    return false;
  }
  const token = req.get('X-Policy-Action-Token');
  if (!token || token.length > 200) {
    sendError(res, 'กรุณาอ่านและยืนยันข้อความก่อนดำเนินการ', [], 428);
    return false;
  }
  const [result] = await pool.query(
    `UPDATE policy_action_evidence
        SET consumed_at = CURRENT_TIMESTAMP
      WHERE action_token_sha256 = ? AND user_id = ? AND user_role = ?
        AND action_context = ? AND subject_type = ? AND subject_id = ?
        AND notice_key = ? AND notice_version = ? AND consumed_at IS NULL
        AND expires_at >= CURRENT_TIMESTAMP`,
    [tokenDigest(token), req.user.id, req.user.role, context, subjectType,
      String(subjectId), policy.key, policy.version]
  );
  if (result.affectedRows !== 1) {
    sendError(res, 'คำยืนยันไม่ถูกต้อง หมดอายุ หรือถูกใช้แล้ว กรุณายืนยันใหม่', [], 428);
    return false;
  }
  return true;
}

module.exports = { consumePolicyAction, tokenDigest };
