'use strict';

/**
 * Shared validation for the date fields of a vehicle-inspection write. Used by
 * both the legacy `POST/PUT /api/transport/inspections` path and the hardened
 * attempt-finalize path (`finalizeInspection`) so that neither can record an
 * inspection with an out-of-bounds expiry (e.g. year 2099) or a future/absurdly
 * back-dated inspection date — both of which feed `vehicles.verification_status`
 * via `refreshVehicleEligibility` and could otherwise keep a bus ELIGIBLE well
 * past a real certification window.
 *
 * Pure function: no DB, no side effects. Returns `null` when valid, otherwise
 * `{ code, message }` so each caller can surface it its own way (route →
 * `sendError`, service → thrown appError).
 */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// A certification is valid at most this long after the inspection date. ~2 yr.
const MAX_CERT_VALIDITY_DAYS = 731;
// An inspection may be back-dated at most this far (data-entry lag). ~1 yr.
const MAX_BACKDATE_DAYS = 366;

/**
 * Bangkok-local today (YYYY-MM-DD). Matches term.service.bangkokToday() so an
 * inspection recorded "today" in Thailand is never rejected as future-dated
 * because of a UTC skew in the evening (Bangkok is UTC+7).
 */
function bangkokToday() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });
}

function toEpochDay(d) {
  const ms = Date.parse(`${d}T00:00:00Z`);
  return Number.isFinite(ms) ? Math.floor(ms / 86400000) : null;
}

/**
 * @param {object} opts
 * @param {string}      opts.result         PASSED/FAILED/NEEDS_FIX/PENDING
 * @param {string}      opts.inspectionDate effective inspection date (YYYY-MM-DD, required)
 * @param {string|null} opts.expiryDate     YYYY-MM-DD or null/empty
 * @param {string}      [opts.today]        YYYY-MM-DD override (defaults to Bangkok today)
 * @returns {{code: string, message: string}|null}
 */
function validateInspectionDates({
  result, inspectionDate, expiryDate = null, today = bangkokToday(),
} = {}) {
  if (!inspectionDate || !DATE_RE.test(inspectionDate)) {
    return { code: 'INSPECTION_DATE_INVALID', message: 'วันที่ตรวจต้องอยู่ในรูปแบบ YYYY-MM-DD' };
  }
  const insp = toEpochDay(inspectionDate);
  const now = toEpochDay(today);
  if (insp === null || now === null) {
    return { code: 'INSPECTION_DATE_INVALID', message: 'วันที่ตรวจไม่ถูกต้อง' };
  }
  if (insp > now) {
    return { code: 'INSPECTION_DATE_IN_FUTURE', message: 'วันที่ตรวจต้องไม่เป็นวันในอนาคต' };
  }
  if (now - insp > MAX_BACKDATE_DAYS) {
    return { code: 'INSPECTION_DATE_TOO_OLD', message: 'วันที่ตรวจย้อนหลังเกินกำหนด (ไม่เกิน 1 ปี)' };
  }

  const hasExpiry = expiryDate != null && expiryDate !== '';
  if (result === 'PASSED' && !hasExpiry) {
    return { code: 'EXPIRY_DATE_REQUIRED', message: 'ผลผ่านต้องระบุวันหมดอายุการรับรอง' };
  }
  if (hasExpiry) {
    if (!DATE_RE.test(expiryDate)) {
      return { code: 'EXPIRY_DATE_INVALID', message: 'วันหมดอายุต้องอยู่ในรูปแบบ YYYY-MM-DD' };
    }
    const exp = toEpochDay(expiryDate);
    if (exp === null) {
      return { code: 'EXPIRY_DATE_INVALID', message: 'วันหมดอายุไม่ถูกต้อง' };
    }
    if (exp <= insp) {
      return { code: 'EXPIRY_BEFORE_INSPECTION', message: 'วันหมดอายุต้องอยู่หลังวันที่ตรวจ' };
    }
    if (exp - insp > MAX_CERT_VALIDITY_DAYS) {
      return { code: 'EXPIRY_TOO_FAR', message: 'วันหมดอายุห่างจากวันที่ตรวจเกินกำหนด (ไม่เกิน 2 ปี)' };
    }
  }
  return null;
}

module.exports = {
  validateInspectionDates,
  bangkokToday,
  MAX_CERT_VALIDITY_DAYS,
  MAX_BACKDATE_DAYS,
};
