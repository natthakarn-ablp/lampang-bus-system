'use strict';

// Phase 10.13A-26A — pure (no DB) classification of a single student-import row.
// The service does the DB lookups (existing student by school_id+student_code,
// cross-school presence, canonical vehicle match) and passes the results here.
//
// Reuses the 24B identity rule (school_id + student_code) and the 25B canonical
// vehicle classification. Returns ONE primary classification (the action or the
// blocking reason) plus the vehicle/guardian detail in fields.

function maskPhone(p) {
  const d = String(p == null ? '' : p).replace(/\D/g, '');
  return d.length >= 6 ? d.slice(0, 3) + '****' + d.slice(-2) : (d ? '****' : '');
}

// Destination column widths for the students table. This module stays pure, so
// the service reads the widths from the live schema and passes them in as
// `limits` ({ column: max_chars }); when they are absent the length check is
// simply skipped. VARCHAR(n) counts characters, so count code points here.
const FIELD_LABEL_TH = {
  student_code: 'รหัสนักเรียน', prefix: 'คำนำหน้า', first_name: 'ชื่อ',
  last_name: 'นามสกุล', grade: 'ชั้น', classroom: 'ห้อง',
};
const charLen = (v) => Array.from(String(v == null ? '' : v).trim()).length;
function firstOverLimit(values, limits) {
  if (!limits) return null;
  for (const field of Object.keys(values)) {
    const max = Number(limits[field]);
    if (!Number.isInteger(max) || max <= 0) continue;
    const len = charLen(values[field]);
    if (len > max) return { field, len, max };
  }
  return null;
}

// vehicle: null (no plate on the row) OR { matched, code, vehicle_id, display_plate }
//   matched=true  → resolved (exact/canonical/alias); code may be VEHICLE_PROVINCE_ALIAS_MATCH
//   matched=false → blocking; code ∈ VEHICLE_NOT_FOUND | VEHICLE_MISSING_PROVINCE | VEHICLE_SOFT_DELETED | PLATE_FORMAT_INVALID
// existing: null OR { id, is_deleted, parent_name }
function classifyImportRow({ row, schoolId, existing = null, crossSchool = false, vehicle = null, limits = null }) {
  const code = String(row.student_code == null ? (row.id == null ? '' : row.id) : row.student_code).trim();
  const firstName = String(row.first_name || '').trim();
  const lastName = String(row.last_name || '').trim();
  const guardianInput = String(row.parent_name || '').trim();
  let phoneDigits = String(row.parent_phone || '').replace(/\D/g, '');
  // Thai mobile numbers exported from Excel often lose the leading zero and
  // become 9 digits (e.g. 909755785). Prepend 0 when exactly 9 digits so the
  // import can proceed without forcing every school to re-format the file.
  if (phoneDigits.length === 9 && !phoneDigits.startsWith('0')) phoneDigits = '0' + phoneDigits;

  const base = {
    row_number: row.rowNum,
    student_code: code,
    student_name: (firstName + ' ' + lastName).trim(),
    school_id: schoolId,
    grade: row.grade || null,
    classroom: row.classroom || null,
    input_vehicle_plate: row.plate_no || null,
    matched_vehicle_id: vehicle && vehicle.matched ? (vehicle.vehicle_id || null) : null,
    matched_display_plate: vehicle && vehicle.matched ? (vehicle.display_plate || null) : null,
    guardian_input: guardianInput || null,
    guardian_current: existing && existing.parent_name != null ? existing.parent_name : null,
    guardian_mismatch: false,
    error_detail: null,
  };
  const out = (classification, status, message_th, can_apply, action_required, confirm) =>
    ({
      ...base, classification, status, message_th, can_apply: !!can_apply, action_required: action_required || null,
      // Phase 10.13B-4 — confirm-ability flags for the two self-service apply modes.
      can_confirm_guardian_update: confirm === 'guardian',
      can_confirm_reactivate: confirm === 'reactivate',
    });

  // 1. Required-field validation.
  if (!code) return out('INVALID_STUDENT_CODE', 'ERROR', 'รหัสนักเรียนไม่ถูกต้อง', false, 'แก้ไขรหัสนักเรียนในไฟล์');
  if (!firstName || !lastName) return out('INVALID_REQUIRED_FIELD', 'ERROR', 'ไม่มีชื่อหรือนามสกุลนักเรียน', false, 'กรอกชื่อ-นามสกุลให้ครบ');
  if (phoneDigits && phoneDigits.length !== 10) return out('INVALID_GUARDIAN_PHONE', 'ERROR', 'เบอร์โทรผู้ปกครองต้องเป็นตัวเลข 10 หลัก', false, 'แก้ไขเบอร์โทรในไฟล์');

  // 1b. Destination column width. Without this a 150-character name previewed as
  //     READY and then died at apply with ER_DATA_TOO_LONG (MySQL runs in
  //     STRICT_TRANS_TABLES, so an over-long value is an error, not a truncation).
  //     Preview exists so that READY means the row will actually go in.
  const over = firstOverLimit({
    student_code: code, prefix: row.prefix, first_name: firstName, last_name: lastName,
    grade: row.grade, classroom: row.classroom,
  }, limits);
  if (over) {
    const label = FIELD_LABEL_TH[over.field] || over.field;
    return out('FIELD_TOO_LONG', 'ERROR',
      `${label}ยาวเกินที่ระบบรองรับ (${over.len} ตัวอักษร สูงสุด ${over.max})`,
      false, `แก้ไข${label}ในไฟล์ให้ไม่เกิน ${over.max} ตัวอักษร`);
  }

  // 2. Blocking vehicle issues (only when a plate is provided).
  if (row.plate_no && vehicle && !vehicle.matched) {
    if (vehicle.code === 'AMBIGUOUS_PLATE_NEEDS_PROVINCE')
      return out('VEHICLE_MISSING_PROVINCE', 'ERROR', 'ทะเบียนรถขาดจังหวัด กรุณาระบุจังหวัดให้ชัดเจน', false, 'ระบุจังหวัดของทะเบียนรถ');
    if (vehicle.code === 'PLATE_FORMAT_INVALID')
      return out('VEHICLE_PLATE_INVALID', 'ERROR', 'รูปแบบทะเบียนรถไม่ถูกต้อง กรุณากรอกหมวดอักษร เลขทะเบียน และจังหวัดให้ครบถ้วน', false, 'แก้ไขทะเบียนรถในไฟล์');
    if (vehicle.code === 'SOFT_DELETED_VEHICLE_EXISTS')
      return out('VEHICLE_SOFT_DELETED', 'ERROR', `รถทะเบียนนี้ถูกปิดใช้งาน (${vehicle.display_plate || ''}) กรุณากู้คืนรถก่อนใช้งาน`, false, 'กู้คืนรถก่อนนำเข้า');
    return out('VEHICLE_NOT_FOUND', 'ERROR', `ไม่พบทะเบียนรถ "${row.plate_no}" ในระบบ กรุณาเพิ่มรถก่อนนำเข้านักเรียน`, false, 'เพิ่มรถก่อนนำเข้า');
  }

  // 3. Student identity (24B: school_id + student_code).
  if (existing && !existing.is_deleted) {
    if (guardianInput && existing.parent_name && guardianInput !== String(existing.parent_name).trim()) {
      return { ...out('GUARDIAN_MISMATCH', 'WARNING', 'พบข้อมูลผู้ปกครองไม่ตรงกับข้อมูลเดิม กรุณายืนยันก่อนอัปเดต', false, 'ยืนยันอัปเดตข้อมูลผู้ปกครอง', 'guardian'), guardian_mismatch: true };
    }
    return out('SKIP_DUPLICATE_SAME_SCHOOL', 'SKIP', 'รหัสนักเรียนนี้มีอยู่แล้วในโรงเรียนนี้', false, null);
  }
  if (existing && existing.is_deleted) {
    return out('SOFT_DELETED_SAME_SCHOOL_REACTIVATE', 'WARNING', 'รหัสนักเรียนนี้เคยถูกลบในโรงเรียนนี้ กรุณายืนยันการกู้คืน', false, 'ยืนยันกู้คืนนักเรียนที่เคยถูกลบ', 'reactivate');
  }
  if (crossSchool) {
    return out('CROSS_SCHOOL_SAME_CODE_ALLOWED', 'READY', 'รหัสนักเรียนนี้ซ้ำกับต่างโรงเรียน แต่สามารถนำเข้าได้เนื่องจากเป็นคนละโรงเรียน', true, null);
  }
  return out('INSERT_NEW', 'READY', 'พร้อมนำเข้า', true, null);
}

module.exports = { classifyImportRow, maskPhone };
