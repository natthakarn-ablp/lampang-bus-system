/**
 * consentText.js — ข้อความแจ้งและขอความยินยอม (PDPA พ.ศ. 2562)
 * ระบบบริหารจัดการรถรับส่งนักเรียนจังหวัดลำปาง (Lampang Bus System)
 *
 * วิธีใช้: วางไฟล์นี้ที่ backend/src/config/consentText.js
 * consent_text_snapshot ในตาราง consent_records ต้องเก็บค่า text ของเวอร์ชัน
 * ที่ผู้ใช้เห็น ณ เวลาที่ให้ความยินยอม (เพื่อพิสูจน์ได้ตามกฎหมาย)
 *
 * ⚠️ TODO: ตรวจสอบกับผู้เชี่ยวชาญกฎหมาย/DPO ก่อนเปิดใช้งานจริง
 * เมื่อแก้ไขข้อความ ให้เพิ่มเลขเวอร์ชันใหม่เสมอ (ห้ามแก้ของเดิมที่ใช้ไปแล้ว)
 */

const CONSENT_TEXT = {
  // ระดับที่ 1 — สาธารณะ (แจ้งอย่างเดียว ไม่ขอความยินยอม)
  // ฐานทางกฎหมาย: ประโยชน์สาธารณะ — บันทึกเป็น "รับทราบ" ไม่ใช่ "ยินยอม"
  qr_public_notice: {
    version: "v1.0",
    title: "การแสดงข้อมูลเพื่อความปลอดภัย",
    text:
      "ข้อมูลที่ท่านกำลังเข้าดูนี้ จังหวัดลำปางเปิดเผยเพื่อความปลอดภัยสาธารณะ" +
      "ของนักเรียน ภายใต้พระราชบัญญัติคุ้มครองข้อมูลส่วนบุคคล พ.ศ. 2562\n\n" +
      "ข้อมูลที่แสดงในระดับนี้: หมายเลขทะเบียนรถ สถานะการตรวจสภาพรถ " +
      "สถานะการทำประกันภัย และสถานะผู้ขับรถ (ปกติ/ระงับ)\n\n" +
      "หากท่านเป็นผู้ปกครองของนักเรียนที่ใช้บริการรถคันนี้ และต้องการดู" +
      "ข้อมูลเพิ่มเติม กรุณายืนยันตัวตนผ่าน LINE",
    requiresConsent: false,
    acknowledgeLabel: "รับทราบ",
  },

  // ระดับที่ 2 — ผู้ปกครองยืนยันตัวตน (ขอความยินยอม)
  qr_parent_optin: {
    version: "v1.0",
    title: "แจ้งการเก็บและใช้ข้อมูลส่วนบุคคล (สำหรับผู้ปกครอง)",
    text:
      "เพื่อให้ท่านเข้าถึงข้อมูลรถรับส่งนักเรียนของบุตรหลาน ระบบบริหารจัดการ" +
      "รถรับส่งนักเรียนจังหวัดลำปางจำเป็นต้องเก็บและใช้ข้อมูลของท่าน ดังนี้\n\n" +
      "ข้อมูลที่ระบบเก็บ: บัญชี LINE ความสัมพันธ์กับนักเรียน และประวัติการเข้าดูข้อมูล\n" +
      "ข้อมูลที่ท่านจะเห็นเพิ่มเติม: ชื่อผู้ขับรถ และช่องทางติดต่อในกรณีฉุกเฉิน\n" +
      "วัตถุประสงค์: เพื่อความปลอดภัยและการติดต่อสื่อสารระหว่างผู้ปกครองกับ" +
      "ผู้ให้บริการรถรับส่งนักเรียน\n" +
      "ระยะเวลาเก็บข้อมูล: ตลอดปีการศึกษาที่บุตรหลานใช้บริการ\n\n" +
      "ท่านมีสิทธิ์ขอเข้าถึง แก้ไข หรือถอนความยินยอมได้ โดยติดต่อผู้ดูแลระบบ",
    requiresConsent: true,
    consentLabel:
      "ข้าพเจ้าได้อ่านและยินยอมให้เก็บและใช้ข้อมูลตามรายละเอียดข้างต้น",
    confirmLabel: "ยืนยัน",
  },

  // ระดับที่ 3 — คนขับ: แยกความยินยอม 3 ส่วน (มาตรา 19 ห้ามมัดรวม)
  // ส่วน sensitive = ข้อมูลอ่อนไหวตามมาตรา 26 ต้องยินยอมโดยชัดแจ้งแยกต่างหาก
  qr_driver_public: {
    version: "v1.0",
    title: "ส่วนที่ 1 — ข้อมูลที่แสดงต่อสาธารณะ (ผ่าน QR code)",
    text:
      "ระบบจะแสดงต่อผู้ที่สแกน QR code เฉพาะสถานะการขึ้นทะเบียนผู้ขับ " +
      "(ปกติ/ระงับ) โดยไม่แสดงชื่อ-นามสกุลเต็มของท่านต่อสาธารณะ",
    requiresConsent: true,
    consentLabel: "ข้าพเจ้ายินยอม",
    isRequiredForService: true,
  },
  qr_driver_parent: {
    version: "v1.0",
    title: "ส่วนที่ 2 — ข้อมูลที่แสดงต่อผู้ปกครองที่ยืนยันตัวตน",
    text:
      "ระบบจะแสดงต่อผู้ปกครองของนักเรียนที่ใช้บริการรถของท่าน: ชื่อผู้ขับ " +
      "และช่องทางติดต่อฉุกเฉิน",
    requiresConsent: true,
    consentLabel: "ข้าพเจ้ายินยอม",
    isRequiredForService: true,
  },
  qr_driver_sensitive: {
    version: "v1.0",
    title: "ส่วนที่ 3 — ข้อมูลที่แสดงต่อเจ้าหน้าที่ผู้มีอำนาจ (ข้อมูลอ่อนไหว)",
    text:
      "เจ้าหน้าที่สำนักงานขนส่ง ตำรวจ และผู้ดูแลระบบที่ได้รับมอบหมาย สามารถ" +
      "เข้าถึงประวัติการกระทำผิดกฎจราจรและบันทึกพฤติกรรมเสี่ยงของท่าน เพื่อการ" +
      "กำกับดูแลความปลอดภัยตามกฎหมาย\n\n" +
      "ข้อมูลนี้เป็นข้อมูลส่วนบุคคลที่มีความอ่อนไหวตามมาตรา 26 แห่งพระราชบัญญัติ" +
      "คุ้มครองข้อมูลส่วนบุคคล พ.ศ. 2562",
    requiresConsent: true,
    consentLabel: "ข้าพเจ้ายินยอม",
    isRequiredForService: false,
  },

  _driverFormFooter:
    "ท่านมีสิทธิ์ขอเข้าถึง แก้ไข คัดค้าน หรือถอนความยินยอมในแต่ละส่วนได้ " +
    "โดยการถอนความยินยอมส่วนที่ 1 หรือ 2 อาจส่งผลให้ไม่สามารถปฏิบัติหน้าที่" +
    "ผู้ขับรถรับส่งนักเรียนในระบบได้",
};

// ── Contract adapter ─────────────────────────────────────────────────────────
// The Thai content above is authoritative and must not be altered. The helpers
// below expose it to the services in the shape they expect (getConsentText →
// { version, title, body, required, … }) without rewriting any text.
const CONSENT_TYPES = Object.keys(CONSENT_TEXT).filter((k) => !k.startsWith('_'));

function isValidConsentType(type) {
  return CONSENT_TYPES.includes(type);
}

function getConsentText(type) {
  const e = CONSENT_TEXT[type];
  if (!e) return null;
  return {
    version: e.version,
    title: e.title,
    body: e.text,                                   // consent_text_snapshot source
    required: !!e.requiresConsent,
    isRequiredForService: !!e.isRequiredForService,
    consentLabel: e.consentLabel || null,
    confirmLabel: e.confirmLabel || null,
    acknowledgeLabel: e.acknowledgeLabel || null,
  };
}

// Driver consents whose WITHDRAWAL must suspend the public display (มาตรา 19:
// service-required parts — ส่วนที่ 1 และ 2).
const REQUIRED_DRIVER_CONSENTS = CONSENT_TYPES.filter((k) => CONSENT_TEXT[k].isRequiredForService);

const DRIVER_FORM_FOOTER = CONSENT_TEXT._driverFormFooter;

module.exports = { CONSENT_TEXT, CONSENT_TYPES, REQUIRED_DRIVER_CONSENTS, DRIVER_FORM_FOOTER, getConsentText, isValidConsentType };
