'use strict';

/**
 * provinceOverride.service.js — the province decides, on the affiliation's
 * behalf, a request the affiliation has left waiting ESCALATE days or more
 * (owner decision 2026-11-13). Two kinds only:
 *   - transfer: student transfer inside one affiliation (pendingQueue
 *     'transfer_internal')
 *   - vehicle:  vehicle request from a school in an affiliation
 *     (pendingQueue 'vehicle_requests')
 *
 * The age test reads the SAME queue SQL and threshold as the "งานรออนุมัติ"
 * page (pendingQueue.service), so the buttons appear exactly when the item is
 * shown as escalated. Younger items are refused with 409. The decision itself
 * runs the affiliation's guard and service unchanged (same side effects), with
 * the item's own affiliation as scope, and one extra audit row marks it an
 * override by the province.
 */

const { logAudit } = require('../utils/audit');
const pq = require('./pendingQueue.service');
const transfer = require('./studentTransfer.service');
const vr = require('./vehicleRequest.service');

const KINDS = {
  transfer: { queue: 'transfer_internal', entityType: 'student_transfer_request' },
  vehicle: { queue: 'vehicle_requests', entityType: 'vehicle_request' },
};

const err = (msg, status, code) => {
  const e = new Error(msg);
  e.statusCode = status;
  if (code) e.errors = [{ code }];
  return e;
};

/** Load the item through its pending queue and check it is escalated. */
async function loadEscalated(db, kind, requestId) {
  const def = KINDS[kind];
  if (!def) throw err('ประเภทคำขอไม่ถูกต้อง', 400);
  const queue = pq.QUEUES.find((q) => q.key === def.queue);
  const cfg = pq.thresholds();
  const [rows] = await db.query(`SELECT * FROM (${queue.sql}) x WHERE x.item_id = ? LIMIT 1`, [String(requestId)]);
  const row = rows && rows[0];
  if (!row) {
    throw err('คำขอนี้ไม่ได้รอสังกัดพิจารณาแล้ว (อาจได้รับการพิจารณาไปแล้ว หรือไม่ใช่คำขอที่สังกัดเป็นผู้อนุมัติ)', 409, 'NOT_PENDING_FOR_AFFILIATION');
  }
  const item = pq.toItem(queue, row, cfg);
  if (!item.escalated) {
    throw err(`คำขอนี้รอสังกัดพิจารณามา ${item.age_days} วัน จังหวัดพิจารณาแทนได้เมื่อรอครบ ${cfg.escalateDays} วันขึ้นไป`, 409, 'NOT_ESCALATED_YET');
  }
  if (!item.affiliation_id) {
    throw err('คำขอนี้ไม่มีสังกัดรับผิดชอบ ผู้ดูแลระบบเป็นผู้พิจารณา', 409, 'NO_AFFILIATION');
  }
  return { item, cfg };
}

/**
 * decision: 'approve' | 'reject'. note is required for reject.
 * Returns { out, message }.
 */
async function decide(pool, { kind, requestId, decision, note, actorId, actorRole, ipAddress = null, userAgent = null }) {
  if (!['approve', 'reject'].includes(decision)) throw err('คำสั่งไม่ถูกต้อง', 400);
  const why = String(note || '').trim();
  if (decision === 'reject' && !why) throw err('กรุณาระบุเหตุผลที่ไม่อนุมัติ', 400, 'REASON_REQUIRED');

  const { item, cfg } = await loadEscalated(pool, kind, requestId);
  const affiliationId = item.affiliation_id;
  const args = { requestId, adminUserId: actorId, adminNote: why };

  let out;
  let message;
  if (kind === 'transfer') {
    // Same guard as POST /api/affiliation/transfer-requests/:id/approve|reject.
    await transfer.assertAffiliationCanDecide(pool, { requestId, affiliationId });
    if (decision === 'approve') {
      out = await transfer.approveAndApply(pool, args);
      message = transfer.approveOutcomeMessage(out);
    } else {
      out = await transfer.reject(pool, args);
      message = 'ไม่อนุมัติคำขอแล้ว';
    }
  } else {
    // Same guard as POST /api/affiliation/vehicle-requests/:id/approve|reject.
    await vr.getDetailForAffiliation(pool, { requestId, affiliationId });
    if (decision === 'approve') {
      out = await vr.approveVehicleRequest(pool, args);
      message = vr.approveOutcomeMessage(out);
    } else {
      out = await vr.rejectVehicleRequest(pool, args);
      message = 'ไม่อนุมัติคำขอแล้ว';
    }
  }

  await logAudit({
    userId: actorId,
    action: decision === 'approve' ? 'APPROVE' : 'UPDATE',
    entityType: KINDS[kind].entityType,
    entityId: String(requestId),
    newValue: {
      result: out && out.status,
      override: true,
      by_role: actorRole,
      on_behalf_of: 'affiliation',
      affiliation_id: affiliationId,
      waited_days: item.age_days,
      escalate_days: cfg.escalateDays,
      reason: why ? why.slice(0, 500) : null,
    },
    ipAddress,
    userAgent,
  });
  return { out, message };
}

module.exports = { decide, loadEscalated, KINDS };
