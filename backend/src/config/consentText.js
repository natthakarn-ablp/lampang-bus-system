'use strict';

// Phase QR-1 — consent text + versions for the vehicle-QR PDPA flows.
//
// TODO: ตรวจสอบกับผู้เชี่ยวชาญกฎหมาย — the text below is a PLACEHOLDER scaffold so
// the flow is testable. ครูอร will supply the final approved Thai text + version
// strings (prompt §2.2) before go-live. The exact text shown is snapshotted into
// consent_records.consent_text_snapshot at grant/withdraw time, so updating a
// version here does not rewrite history.
//
// consent_type values must match those used by consent.service / the migration:
//   qr_public_notice   — Level-1 privacy notice (notice-only, public-interest basis)
//   qr_parent_optin    — Level-2 parent opt-in (explicit consent)
//   qr_driver_public   — driver consent to publish public-level info
//   qr_driver_parent   — driver consent to show name/contact to verified parents
//   qr_driver_sensitive— driver consent for Level-3 sensitive (PDPA ม.26)

const CONSENT_TEXT = {
  qr_public_notice: {
    version: 'placeholder-2569-01',
    required: false,
    title: 'ประกาศความเป็นส่วนตัว (ข้อมูลสาธารณะของรถรับส่ง)',
    body: 'TODO: ตรวจสอบกับผู้เชี่ยวชาญกฎหมาย — ข้อความแจ้งเพื่อทราบสำหรับการเปิดเผยข้อมูลรถระดับสาธารณะ (ทะเบียน สถานะตรวจสภาพ ประกันภัย สถานะคนขับ) ตามฐานประโยชน์สาธารณะ',
  },
  qr_parent_optin: {
    version: 'placeholder-2569-01',
    required: true,
    title: 'ความยินยอมสำหรับผู้ปกครอง',
    body: 'TODO: ตรวจสอบกับผู้เชี่ยวชาญกฎหมาย — ขอความยินยอมในการแสดงชื่อคนขับและช่องทางติดต่อฉุกเฉินแก่ผู้ปกครองที่ยืนยันตัวตน',
  },
  qr_driver_public: {
    version: 'placeholder-2569-01',
    required: true,
    title: 'ความยินยอมคนขับ — ข้อมูลระดับสาธารณะ',
    body: 'TODO: ตรวจสอบกับผู้เชี่ยวชาญกฎหมาย — ความยินยอมให้แสดงสถานะคนขับระดับสาธารณะ',
  },
  qr_driver_parent: {
    version: 'placeholder-2569-01',
    required: true,
    title: 'ความยินยอมคนขับ — แสดงต่อผู้ปกครอง',
    body: 'TODO: ตรวจสอบกับผู้เชี่ยวชาญกฎหมาย — ความยินยอมให้แสดงชื่อและช่องทางติดต่อแก่ผู้ปกครอง',
  },
  qr_driver_sensitive: {
    version: 'placeholder-2569-01',
    required: false,
    title: 'ความยินยอมคนขับ — ข้อมูลอ่อนไหว (PDPA ม.26)',
    body: 'TODO: ตรวจสอบกับผู้เชี่ยวชาญกฎหมาย — ความยินยอมโดยชัดแจ้งสำหรับข้อมูลอ่อนไหว (ประวัติการกระทำผิด/พฤติกรรมเสี่ยง) ที่แสดงต่อเจ้าหน้าที่',
  },
};

// Driver consents that, when WITHDRAWN, must suspend the public display.
const REQUIRED_DRIVER_CONSENTS = ['qr_driver_public', 'qr_driver_parent'];

const CONSENT_TYPES = Object.keys(CONSENT_TEXT);

function getConsentText(type) {
  return CONSENT_TEXT[type] || null;
}
function isValidConsentType(type) {
  return Object.prototype.hasOwnProperty.call(CONSENT_TEXT, type);
}

module.exports = { CONSENT_TEXT, CONSENT_TYPES, REQUIRED_DRIVER_CONSENTS, getConsentText, isValidConsentType };
