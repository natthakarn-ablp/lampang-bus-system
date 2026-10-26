'use strict';

const { sendError } = require('./response');

/**
 * fieldLength.js — reject an over-long body field before MySQL does.
 *
 * MySQL runs in STRICT_TRANS_TABLES, so a value longer than its column is an
 * error rather than a truncation. The global error handler catches
 * ER_DATA_TOO_LONG and answers 400, which is the safety net; what it cannot do
 * is say WHICH field, because err.sqlMessage names the column but not the table
 * and echoing it would put schema detail in a client response.
 *
 * So the routes a person types into say it themselves. This is the third and
 * fourth copy of the same list, which is the point at which one shared copy
 * becomes the safer option.
 *
 * WHY CODE POINTS
 * ---------------
 * VARCHAR(n) counts characters. String(v).length counts UTF-16 units, so it
 * reports 2 for anything outside the BMP and would reject a 60-emoji display
 * name as 120 that MySQL would have stored without complaint.
 */

/**
 * Thai labels for the fields these limits cover. A field with no entry falls
 * back to its request key — worse to read, but never wrong.
 */
const FIELD_LABEL_TH = {
  prefix: 'คำนำหน้า',
  first_name: 'ชื่อ',
  last_name: 'นามสกุล',
  grade: 'ระดับชั้น',
  classroom: 'ห้อง',
  parent_name: 'ชื่อผู้ปกครอง',
  username: 'ชื่อผู้ใช้',
  display_name: 'ชื่อที่แสดง',
  scope_id: 'รหัสขอบเขต',
  vehicle_type: 'ประเภทรถ',
  plate_no: 'ทะเบียนรถ',
  owner_name: 'ชื่อผู้ครอบครอง',
  label: 'ชื่อจุดรับส่ง',
  notes: 'หมายเหตุ',
};

/** Character length, counting code points rather than UTF-16 units. */
function charLength(value) {
  return Array.from(String(value)).length;
}

/**
 * Answer 400 if any named field is longer than its column, and report whether
 * it did.
 *
 * The return value is the check, and it MUST be honoured before anything else
 * runs — the response has already been sent when it returns true:
 *
 *     if (rejectOverLongFields(res, req.body, { display_name: 200 })) return;
 *
 * Fields absent from the body are skipped, so the same limit map serves a POST
 * that requires them and a PATCH that does not.
 *
 * @param {import('express').Response} res
 * @param {object} body
 * @param {Record<string, number>} limits  field name -> maximum characters
 * @returns {boolean} true when a 400 was sent
 */
function rejectOverLongFields(res, body, limits) {
  for (const [field, max] of Object.entries(limits || {})) {
    const value = body ? body[field] : undefined;
    if (value === undefined || value === null) continue;
    if (charLength(value) <= max) continue;

    const label = FIELD_LABEL_TH[field] || field;
    sendError(
      res,
      `${label}ยาวเกินกำหนด (ไม่เกิน ${max} ตัวอักษร)`,
      [{ field, message: `ไม่เกิน ${max} ตัวอักษร` }],
      400
    );
    return true;
  }
  return false;
}

module.exports = { FIELD_LABEL_TH, charLength, rejectOverLongFields };
