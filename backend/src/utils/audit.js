'use strict';

const { pool } = require('../config/database');

/**
 * Valid audit actions as defined in the schema.
 */
const AUDIT_ACTIONS = ['CREATE', 'UPDATE', 'DELETE', 'EXPORT', 'LOGIN', 'IMPORT', 'APPROVE'];

/**
 * Write a record to audit_logs.
 * Failures are logged to stderr but never throw — auditing must not break the main flow.
 *
 * @param {object} opts
 * @param {number|null}  opts.userId      - users.id of the actor (null for unauthenticated)
 * @param {string}       opts.action      - One of AUDIT_ACTIONS
 * @param {string}       opts.entityType  - e.g. 'student', 'vehicle', 'checkin'
 * @param {string|null}  opts.entityId    - String form of the entity PK
 * @param {object|null}  opts.oldValue    - Snapshot before change
 * @param {object|null}  opts.newValue    - Snapshot after change
 * @param {string|null}  opts.ipAddress   - req.ip
 * @param {string|null}  opts.userAgent   - req.headers['user-agent']
 * @param {object|null}  opts.conn        - Optional existing mysql2 connection (for transactions)
 */
async function logAudit({
  userId = null,
  action,
  entityType = null,
  entityId = null,
  oldValue = null,
  newValue = null,
  ipAddress = null,
  userAgent = null,
  conn = null,
}) {
  if (!AUDIT_ACTIONS.includes(action)) {
    console.error(`[audit] Unknown action: ${action}`);
    return;
  }

  const sql = `
    INSERT INTO audit_logs
      (user_id, action, entity_type, entity_id, old_value, new_value, ip_address, user_agent)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `;
  const params = [
    userId,
    action,
    entityType,
    entityId !== null ? String(entityId) : null,
    oldValue !== null ? JSON.stringify(oldValue) : null,
    newValue !== null ? JSON.stringify(newValue) : null,
    ipAddress,
    userAgent ? userAgent.substring(0, 255) : null,
  ];

  try {
    const executor = conn || pool;
    await executor.query(sql, params);
  } catch (err) {
    console.error('[audit] Failed to write audit log:', err.message);
  }
}

module.exports = { logAudit, AUDIT_ACTIONS };
