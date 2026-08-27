/**
 * ข้อผิดพลาดฝั่งคนขับ — แปลเป็นภาษาที่คนขับอ่านออก และแยกแยะสาเหตุ
 *
 * ที่มา: การทดสอบบัญชีคนขับจริงบน production (27 ส.ค. 2569) พบว่าบัญชีที่
 * ยังไม่ผูกกับระเบียนคนขับ (`driver_id` ว่าง) ติดกับดัก — หน้าแรกเปิด
 * PretripModal ที่ปิดไม่ได้ แล้วทุกปุ่มในนั้นก็ล้มเหลวซ้ำด้วยเหตุเดียวกัน
 * ทำให้ออกจากหน้าไม่ได้เลย และข้อความที่โผล่คือ
 * "Vehicle not found for this driver account" ซึ่งคนขับรถโรงเรียนอ่านไม่ออก
 *
 * แก้ที่ frontend เท่านั้น — backend และ API contract ไม่ถูกแตะ
 */

/** ข้อความจาก backend ที่แปลว่า "บัญชีนี้ยังไม่ผูกกับคนขับ/รถ" */
const NOT_LINKED_PATTERNS = [
  /vehicle not found for this driver account/i,
  /ยังไม่เชื่อมกับข้อมูลคนขับ/,
];

/**
 * บัญชีคนขับยังไม่ผูกกับรถหรือไม่
 *
 * สำคัญ: ต้องแยกจาก "เน็ตหลุด" หรือ "เซิร์ฟเวอร์ล่ม" เพราะสองอย่างนั้น
 * ควรคงด่านตรวจสภาพรถไว้ (ปลอดภัยกว่า) ส่วนกรณีนี้ต้องปลดด่าน มิฉะนั้น
 * คนขับจะติดค้างในหน้าที่กดผ่านไม่ได้
 */
export function isDriverNotLinked(err) {
  const status = err?.response?.status;
  if (status !== 400 && status !== 409) return false;
  const msg = err?.response?.data?.message || '';
  return NOT_LINKED_PATTERNS.some((re) => re.test(msg));
}

/** ข้อความอังกฤษที่รู้จัก → ไทย
 *
 * รายการนี้มาจากการไล่ดู message ภาษาอังกฤษใน route และ service ฝั่งคนขับ
 * ทั้งหมด — ทุกข้อความในนี้คนขับมีโอกาสเห็นจริงบนหน้าจอ ไม่ใช่ข้อความภายใน
 */
const TH_BY_MESSAGE = {
  'Vehicle not found for this driver account': 'บัญชีของคุณยังไม่ได้ผูกกับรถ',
  // การตั้งชื่อจุดรับส่ง — คนขับเจอทันทีถ้าเว้นช่องชื่อไว้
  'label required': 'กรุณากรอกชื่อจุดรับส่ง',
  'label must be ≤ 100 chars': 'ชื่อจุดรับส่งต้องยาวไม่เกิน 100 ตัวอักษร',
  // ตำแหน่งบนแผนที่ — เกิดเมื่อพิกัดที่ส่งไปไม่ถูกต้อง
  'latitude must be a number in [-90, 90]': 'ตำแหน่งบนแผนที่ไม่ถูกต้อง กรุณาเลือกจุดใหม่',
  'longitude must be a number in [-180, 180]': 'ตำแหน่งบนแผนที่ไม่ถูกต้อง กรุณาเลือกจุดใหม่',
  'recorded_at must be ISO 8601': 'รูปแบบวันที่ไม่ถูกต้อง',
};

/** ข้อความตามรหัสสถานะ เมื่อไม่มีข้อความเฉพาะเจาะจง */
const TH_BY_STATUS = {
  401: 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่',
  403: 'บัญชีของคุณไม่มีสิทธิ์ใช้งานส่วนนี้',
  404: 'ไม่พบข้อมูลที่ต้องการ',
  408: 'เชื่อมต่อนานเกินไป กรุณาลองใหม่',
  429: 'ใช้งานถี่เกินไป กรุณารอสักครู่แล้วลองใหม่',
  500: 'ระบบขัดข้องชั่วคราว กรุณาลองใหม่อีกครั้ง',
  502: 'ระบบขัดข้องชั่วคราว กรุณาลองใหม่อีกครั้ง',
  503: 'ระบบปิดปรับปรุงชั่วคราว กรุณาลองใหม่ภายหลัง',
};

/**
 * ข้อความผิดพลาดที่พร้อมแสดงให้คนขับเห็น
 *
 * ลำดับ: ข้อความไทยที่ backend ส่งมา → คำแปลของข้อความอังกฤษที่รู้จัก →
 * ข้อความตามรหัสสถานะ → ข้อความสำรองที่ผู้เรียกกำหนด
 *
 * ข้อความอังกฤษที่ไม่รู้จักจะ **ไม่** ถูกส่งต่อให้ผู้ใช้เห็น เพราะกลุ่มผู้ใช้
 * หน้านี้คือคนขับรถ ไม่ใช่ผู้ดูแลระบบ
 */
export function driverErrorMessage(err, fallback = 'เกิดข้อผิดพลาด กรุณาลองใหม่') {
  const raw = err?.response?.data?.message;
  const status = err?.response?.status;

  if (raw && TH_BY_MESSAGE[raw]) return TH_BY_MESSAGE[raw];
  // ข้อความที่มีอักษรไทยอยู่แล้ว ใช้ได้ตามเดิม
  if (raw && /[฀-๿]/.test(raw)) return raw;
  if (!err?.response) return 'เชื่อมต่อระบบไม่ได้ กรุณาตรวจสอบสัญญาณอินเทอร์เน็ต';
  if (TH_BY_STATUS[status]) return TH_BY_STATUS[status];

  return fallback;
}

/**
 * รายการข้อผิดพลาดรายช่อง (errors array จาก backend) ที่แปลเป็นไทยแล้ว
 *
 * backend ส่ง `errors: [{ field, message }]` มาให้ตอน validate ไม่ผ่าน
 * และหน้าจอเดิมแสดง message นั้นตรง ๆ — คนขับที่เว้นช่องชื่อจุดรับส่งไว้
 * จึงเห็นคำว่า "label required" ซึ่งอ่านไม่ออก
 *
 * คืนรูปแบบเดิม ({field, message}) เพื่อให้แทนที่ได้โดยไม่ต้องแก้หน้าจอมาก
 */
export function driverFieldErrors(err, fallback = 'บันทึกไม่สำเร็จ') {
  const list = err?.response?.data?.errors;
  if (Array.isArray(list) && list.length) {
    return list.map((e) => ({
      ...e,
      message: TH_BY_MESSAGE[e?.message] || e?.message || fallback,
    }));
  }
  return [{ message: driverErrorMessage(err, fallback) }];
}
