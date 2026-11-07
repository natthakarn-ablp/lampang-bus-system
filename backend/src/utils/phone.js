'use strict';

// Shared parent-phone normalization (QA readiness parent-02, 2026-11).
//
// Every path that writes parents.phone (preview importer, legacy importer,
// student edit, roster request) and every path that looks a parent up by phone
// (LIFF bind, LINE chat bind) must agree on ONE canonical form, because the
// bind lookup and the notification join are exact matches on parents.phone.
//
// The canonical form is 10 digits starting with 0 (Thai mobile, the only kind
// a parent can link to LINE with). Excel stores a number-formatted cell such as
// 0812345678 as the number 812345678, so a 9-digit value starting with 6, 8 or
// 9 is a mobile that lost its leading zero and gets it back. No Thai landline
// area code starts with 6, 8 or 9, so that rule is unambiguous. A +66 prefix is
// rewritten to 0 for the same reason.

const PHONE_ERROR_TH = 'เบอร์โทรผู้ปกครองต้องเป็นเบอร์มือถือ 10 หลัก ขึ้นต้นด้วย 0 (เช่น 0812345678)';

/**
 * Digits-only phone with a lost leading zero restored. Returns '' for an empty
 * value. The result is NOT guaranteed valid — check isValidPhone().
 */
function normalizePhone(raw) {
  if (raw == null) return '';
  let d = String(raw).replace(/\D/g, '');
  if (/^66[689]\d{8}$/.test(d)) d = `0${d.slice(2)}`; // +66 8x xxx xxxx
  else if (/^[689]\d{8}$/.test(d)) d = `0${d}`;      // Excel dropped the 0
  return d;
}

/** True for a canonical 10-digit phone starting with 0. */
function isValidPhone(phone) {
  return typeof phone === 'string' && /^0\d{9}$/.test(phone);
}

module.exports = { normalizePhone, isValidPhone, PHONE_ERROR_TH };
