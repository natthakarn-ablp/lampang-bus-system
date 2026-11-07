'use strict';

/**
 * Thai labels for audit-log codes, used by the audit CSV export. Codes stay
 * English in the database (CLAUDE.md §3.1); people reading the export see
 * Thai (QA aff-07). Unknown codes fall back to the code itself so nothing is
 * hidden. Keep in step with frontend/src/constants/auditLabels.js.
 */

const AUDIT_ACTION_TH = {
  CREATE: 'สร้าง', UPDATE: 'แก้ไข', DELETE: 'ลบ', EXPORT: 'ส่งออก',
  LOGIN: 'เข้าสู่ระบบ', LOGOUT: 'ออกจากระบบ', IMPORT: 'นำเข้า', APPROVE: 'อนุมัติ',
  VIEW: 'เปิดดู', RESTORE: 'กู้คืน', BLOCK: 'ระงับ', DEACTIVATE: 'ปิดใช้งาน',
  REASSIGN: 'เปลี่ยนการมอบหมาย', END_OLD_ASSIGNMENT: 'สิ้นสุดการมอบหมายเดิม',
  ROUTE_DEVIATION: 'ออกนอกเส้นทาง',
  LINE_BIND_SUCCESS: 'ผูก LINE สำเร็จ', LINE_BIND_LOCKED: 'ผูก LINE ถูกระงับชั่วคราว',
  LINE_BIND_DUPLICATE_OR_ALREADY_BOUND: 'ผูก LINE ซ้ำ',
  LINE_BIND_PREVIEW_FAILED: 'ผูก LINE ไม่สำเร็จ', LINE_BIND_CONFIRM_FAILED: 'ผูก LINE ไม่สำเร็จ',
};

const AUDIT_ENTITY_TH = {
  student: 'นักเรียน', vehicle: 'รถรับส่ง', user: 'บัญชีผู้ใช้', school: 'โรงเรียน', term: 'ภาคเรียน',
  roster_request: 'คำขอรายชื่อ', self_travel: 'เดินทางเอง', self_travel_time: 'เวลาเดินทางเอง',
  leave: 'การลา', checkin: 'เช็กอิน', checkin_time: 'เวลาเช็กอิน', checkin_backdated: 'เช็กชื่อย้อนหลัง',
  checkin_override: 'ยืนยันแทนคนขับ', checkin_override_batch: 'ยืนยันแทนคนขับ (ทั้งกลุ่ม)',
  checkin_teacher: 'ครูเช็กชื่อ',
  driver: 'คนขับ', driver_profile: 'ข้อมูลคนขับ', driver_document: 'เอกสารคนขับ',
  driver_qualification: 'คุณสมบัติคนขับ', driver_sensitive: 'ข้อมูลส่วนบุคคลคนขับ',
  driver_vehicle_assignment: 'การมอบหมายคนขับ-รถ',
  emergency: 'เหตุฉุกเฉิน', geofence: 'เขตพื้นที่รถ', geofence_event: 'เหตุการณ์เขตพื้นที่รถ',
  import_batch: 'ชุดนำเข้า', pickup_point: 'จุดรับส่ง', student_pickup_point: 'จุดรับส่งของนักเรียน',
  student_transfer_request: 'คำขอโอนย้ายนักเรียน', vehicle_request: 'คำขอเกี่ยวกับรถ',
  vehicle_document: 'เอกสารรถ', vehicle_inspection: 'ผลตรวจสภาพรถ',
  vehicle_inspection_application: 'คำขอตรวจสภาพรถ', inspection_attempt: 'การตรวจสภาพรถ',
  vehicle_operating_shift: 'ช่วงเวลาให้บริการรถ', vehicle_qr: 'QR รถ',
  vehicle_school_registration: 'การลงทะเบียนรถกับโรงเรียน', registration_roster_student: 'รายชื่อลงทะเบียนรถ',
  route_deviation: 'ออกนอกเส้นทาง', pretrip_checklist: 'ตรวจรถก่อนออกเดินทาง',
  report_csv: 'รายงาน (CSV)', report_excel: 'รายงาน (Excel)', report_pdf: 'รายงาน (PDF)',
  report_monthly_csv: 'รายงานรายเดือน (CSV)', report_monthly_excel: 'รายงานรายเดือน (Excel)',
  report_monthly_pdf: 'รายงานรายเดือน (PDF)', audit_csv: 'ประวัติการแก้ไข (CSV)',
  affiliation_schools_report: 'รายงานโรงเรียนในสังกัด', affiliation_pickup_map: 'แผนที่จุดรับส่ง (สังกัด)',
  province_pickup_map: 'แผนที่จุดรับส่ง (จังหวัด)', transport_pickup_map: 'แผนที่จุดรับส่ง (ขนส่ง)',
  live_vehicles: 'ตำแหน่งรถปัจจุบัน', school_notification: 'แจ้งเตือนโรงเรียน',
  daily_snapshot: 'สรุปรายวัน', decision_log: 'บันทึกการตัดสินใจ',
  password_reset_request: 'คำขอรีเซ็ตรหัสผ่าน', user_recovery_channel: 'ช่องทางกู้คืนบัญชี',
  user_recovery_code: 'รหัสกู้คืนบัญชี', refresh_token_replay: 'การใช้โทเค็นซ้ำ',
  consent_record: 'ความยินยอม', policy_acknowledgement: 'การรับทราบนโยบาย',
  policy_action_evidence: 'หลักฐานการดำเนินการ', safety_policy_decision: 'การตัดสินใจด้านความปลอดภัย',
  participation_case: 'กรณีติดตาม', participation_case_event: 'เหตุการณ์ในกรณีติดตาม',
  research_dataset: 'ชุดข้อมูลวิจัย', transport_incident_roster: 'รายชื่อในเหตุการณ์',
  transport_safety_report: 'รายงานความปลอดภัย',
};

const ROLE_TH = {
  driver: 'คนขับ', school: 'โรงเรียน', affiliation: 'สังกัด', province: 'ส่วนกลาง',
  transport: 'ขนส่ง', admin: 'ผู้ดูแลระบบ', parent: 'ผู้ปกครอง',
};

const auditActionTh = code => AUDIT_ACTION_TH[code] || code;
const auditEntityTh = code => (code ? AUDIT_ENTITY_TH[code] || code : null);
const roleTh = code => (code ? ROLE_TH[code] || code : null);

module.exports = { AUDIT_ACTION_TH, AUDIT_ENTITY_TH, ROLE_TH, auditActionTh, auditEntityTh, roleTh };
