'use strict';

/**
 * vehicleDocumentExpiry.service.js — registration / พ.ร.บ. / tax expiry dates.
 *
 * vehicleVerification and the transport/province readiness views READ
 * vehicles.registration_expiry, compulsory_insurance_expiry and tax_expiry,
 * but until 2026-11-13 only the admin PUT /api/admin/vehicles/:id wrote them,
 * so every renewal waited on the admin. This lets the transport office (any
 * vehicle — transport is province-wide) keep them current. Schools do NOT
 * write them: a shared vehicle's value would feed eligibility for every school
 * that rides it (same reasoning as SCH-VEH-3).
 *
 * Only these three DATE columns. insurance_* stays with the vehicle
 * owner/driver (SCH-VEH-3), plate_no has its own audited fix path.
 * Every change is audited with old and new values in the same transaction.
 */

const { logAudit } = require('../utils/audit');
const { isCalendarDate } = require('../utils/calendarDate');
const { toBangkokDate } = require('../utils/thaiTime');

const DOCUMENT_EXPIRY_FIELDS = Object.freeze([
  'registration_expiry',
  'compulsory_insurance_expiry',
  'tax_expiry',
]);

const err = (msg, code, errors) => { const e = new Error(msg); e.statusCode = code; if (errors) e.errors = errors; return e; };

/** Pick + validate the expiry fields from a request body. '' / null clears. */
function parseExpiryPatch(body) {
  const b = body || {};
  const patch = {};
  const errors = [];
  for (const f of DOCUMENT_EXPIRY_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(b, f)) continue;
    const raw = b[f];
    if (raw === null || raw === '') { patch[f] = null; continue; }
    const val = String(raw).slice(0, 10);
    if (!isCalendarDate(val)) { errors.push({ field: f, message: 'วันที่ไม่ถูกต้อง (รูปแบบ YYYY-MM-DD)' }); continue; }
    patch[f] = val;
  }
  if (errors.length) throw err('วันที่ไม่ถูกต้อง', 400, errors);
  if (!Object.keys(patch).length) throw err('ไม่มีข้อมูลที่ต้องแก้ไข', 400);
  return patch;
}

async function updateDocumentExpiry(pool, { vehicleId, body, actorId, actorRole, ipAddress = null, userAgent = null }) {
  const patch = parseExpiryPatch(body);
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [[v]] = await conn.query(
      `SELECT id, plate_no, registration_expiry, compulsory_insurance_expiry, tax_expiry
         FROM vehicles WHERE id = ? AND is_deleted = FALSE FOR UPDATE`,
      [vehicleId]);
    if (!v) throw err('ไม่พบรถคันนี้', 404);

    const fields = Object.keys(patch);
    await conn.query(
      `UPDATE vehicles SET ${fields.map((f) => `${f} = ?`).join(', ')} WHERE id = ?`,
      [...fields.map((f) => patch[f]), vehicleId]);

    // Readiness reads verification_status; recompute it from the new dates.
    const { refreshVehicleEligibility } = require('./vehicleVerification.service');
    const eligibility = await refreshVehicleEligibility(conn, vehicleId);

    const before = {};
    for (const f of fields) before[f] = toBangkokDate(v[f]);
    await logAudit({
      userId: actorId, action: 'UPDATE', entityType: 'vehicle', entityId: String(vehicleId), conn, required: true,
      oldValue: before,
      newValue: { action: 'document_expiry', ...patch, by_role: actorRole || null },
      ipAddress, userAgent,
    });
    await conn.commit();
    return { id: vehicleId, plate_no: v.plate_no, ...patch, verification_status: eligibility.status };
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally { conn.release(); }
}

module.exports = { DOCUMENT_EXPIRY_FIELDS, parseExpiryPatch, updateDocumentExpiry };
