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

// vehicle: null (no plate on the row) OR { matched, code, vehicle_id, display_plate }
//   matched=true  → resolved (exact/canonical/alias); code may be VEHICLE_PROVINCE_ALIAS_MATCH
//   matched=false → blocking; code ∈ VEHICLE_NOT_FOUND | VEHICLE_MISSING_PROVINCE | VEHICLE_SOFT_DELETED
// existing: null OR { id, is_deleted, parent_name }
function classifyImportRow({ row, schoolId, existing = null, crossSchool = false, vehicle = null }) {
  const code = String(row.student_code == null ? (row.id == null ? '' : row.id) : row.student_code).trim();
  const firstName = String(row.first_name || '').trim();
  const lastName = String(row.last_name || '').trim();
  const guardianInput = String(row.parent_name || '').trim();
  const phoneDigits = String(row.parent_phone || '').replace(/\D/g, '');

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
  const out = (classification, status, message_th, can_apply, action_required) =>
    ({ ...base, classification, status, message_th, can_apply: !!can_apply, action_required: action_required || null });

  // 1. Required-field validation.
  if (!code) return out('INVALID_STUDENT_CODE', 'ERROR', 'รหัสนักเรียนไม่ถูกต้อง', false, 'แก้ไขรหัสนักเรียนในไฟล์');
  if (!firstName || !lastName) return out('INVALID_REQUIRED_FIELD', 'ERROR', 'ไม่มีชื่อหรือนามสกุลนักเรียน', false, 'กรอกชื่อ-นามสกุลให้ครบ');
  if (phoneDigits && phoneDigits.length !== 10) return out('INVALID_GUARDIAN_PHONE', 'ERROR', 'เบอร์โทรผู้ปกครองต้องเป็นตัวเลข 10 หลัก', false, 'แก้ไขเบอร์โทรในไฟล์');

  // 2. Blocking vehicle issues (only when a plate is provided).
  if (row.plate_no && vehicle && !vehicle.matched) {
    if (vehicle.code === 'AMBIGUOUS_PLATE_NEEDS_PROVINCE')
      return out('VEHICLE_MISSING_PROVINCE', 'ERROR', 'ทะเบียนรถขาดจังหวัด กรุณาระบุจังหวัดให้ชัดเจน', false, 'ระบุจังหวัดของทะเบียนรถ');
    if (vehicle.code === 'SOFT_DELETED_VEHICLE_EXISTS')
      return out('VEHICLE_SOFT_DELETED', 'ERROR', `รถทะเบียนนี้ถูกปิดใช้งาน (${vehicle.display_plate || ''}) กรุณากู้คืนรถก่อนใช้งาน`, false, 'กู้คืนรถก่อนนำเข้า');
    return out('VEHICLE_NOT_FOUND', 'ERROR', `ไม่พบทะเบียนรถ "${row.plate_no}" ในระบบ กรุณาเพิ่มรถก่อนนำเข้านักเรียน`, false, 'เพิ่มรถก่อนนำเข้า');
  }

  // 3. Student identity (24B: school_id + student_code).
  if (existing && !existing.is_deleted) {
    if (guardianInput && existing.parent_name && guardianInput !== String(existing.parent_name).trim()) {
      return { ...out('GUARDIAN_MISMATCH', 'WARNING', 'พบข้อมูลผู้ปกครองไม่ตรงกับข้อมูลเดิม กรุณายืนยันก่อนอัปเดต', false, 'ยืนยันการอัปเดตผู้ปกครอง'), guardian_mismatch: true };
    }
    return out('SKIP_DUPLICATE_SAME_SCHOOL', 'SKIP', 'รหัสนักเรียนนี้มีอยู่แล้วในโรงเรียนนี้', false, null);
  }
  if (existing && existing.is_deleted) {
    return out('SOFT_DELETED_SAME_SCHOOL_REACTIVATE', 'WARNING', 'รหัสนักเรียนนี้เคยถูกลบในโรงเรียนนี้ กรุณายืนยันการกู้คืน', false, 'ยืนยันการกู้คืนนักเรียน');
  }
  if (crossSchool) {
    return out('CROSS_SCHOOL_SAME_CODE_ALLOWED', 'READY', 'รหัสนักเรียนนี้ซ้ำกับต่างโรงเรียน แต่สามารถนำเข้าได้เนื่องจากเป็นคนละโรงเรียน', true, null);
  }
  return out('INSERT_NEW', 'READY', 'พร้อมนำเข้า', true, null);
}

module.exports = { classifyImportRow, maskPhone };
