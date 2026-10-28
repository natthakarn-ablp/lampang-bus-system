'use strict';

const { logAudit } = require('./audit');
const { sendError } = require('./response');

/**
 * Persist a required export audit row before setting download headers or
 * writing file bytes. Metadata must describe the export without containing
 * exported records or other student data.
 */
async function auditExportBeforeSend(req, res, { entityType, entityId, metadata = {} }) {
  try {
    await logAudit({
      userId: req.user.id,
      action: 'EXPORT',
      entityType,
      entityId: String(entityId),
      newValue: metadata,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      required: true,
    });
    return true;
  } catch (_err) {
    sendError(res, 'ไม่สามารถบันทึกประวัติการส่งออกได้ กรุณาลองใหม่', [
      { code: 'EXPORT_AUDIT_UNAVAILABLE' },
    ], 503);
    return false;
  }
}

module.exports = { auditExportBeforeSend };
