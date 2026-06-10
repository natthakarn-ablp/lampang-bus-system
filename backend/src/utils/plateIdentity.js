'use strict';

// Phase 10.13A-25 — permanent, deterministic vehicle plate identity with
// province-alias normalization. Pure (no DB) so it is fully testable; callers
// pass in the existing vehicle rows. Builds on the 10.13A-22 plate helpers but
// adds province-alias awareness (กทม ↔ กรุงเทพมหานคร) which whitespace-only
// normalization missed.

const { formatPlateDisplay } = require('./vehiclePlate');

// Bangkok aliases (and common variants) → the one canonical Thai province name.
// Keyed by normalizeThaiText(lowercased). Extend here as more aliases appear.
const PROVINCE_ALIASES = {
  'กทม': 'กรุงเทพมหานคร',
  'กทมฯ': 'กรุงเทพมหานคร',
  'กรุงเทพ': 'กรุงเทพมหานคร',
  'กรุงเทพฯ': 'กรุงเทพมหานคร',
  'กรุงเทพมหานคร': 'กรุงเทพมหานคร',
  'bangkok': 'กรุงเทพมหานคร',
  'bkk': 'กรุงเทพมหานคร',
};

// Strip whitespace (incl. Thai/zero-width/nbsp), dashes and dots.
function normalizeThaiText(input) {
  return String(input == null ? '' : input)
    .replace(/[\s ​　﻿]+/g, '')
    .replace(/[.\-‐-―]/g, '')
    .trim();
}

// Map a province (alias or canonical) to its canonical Thai name. Unknown
// provinces are returned in their cleaned form (never guessed/dropped).
function normalizeProvince(input) {
  const cleaned = normalizeThaiText(input);
  if (!cleaned) return '';
  const alias = PROVINCE_ALIASES[cleaned.toLowerCase()];
  return alias || cleaned;
}

function detectProvinceAlias(input) {
  const cleaned = normalizeThaiText(input).toLowerCase();
  const canonical = PROVINCE_ALIASES[cleaned];
  return canonical
    ? { isAlias: true, canonical }
    : { isAlias: false, canonical: normalizeThaiText(input) };
}

function normalizePlatePrefix(input) { return normalizeThaiText(input); }              // 'นข', '1นค'
function normalizePlateNumber(input) { return String(input == null ? '' : input).replace(/\D/g, ''); }

// Deterministic comparable identity key (province alias resolved, lowercased).
function buildCanonicalPlate({ plate_prefix, plate_number, province } = {}) {
  const p = normalizePlatePrefix(plate_prefix);
  const n = normalizePlateNumber(plate_number);
  const pr = normalizeProvince(province);
  return (p + n + pr).toLowerCase();
}

// Human display: 'นข 4031 ลำปาง' (province alias resolved to its canonical name).
function buildDisplayPlate({ plate_prefix, plate_number, province } = {}) {
  const p = String(plate_prefix == null ? '' : plate_prefix).trim();
  const n = String(plate_number == null ? '' : plate_number).trim();
  const pr = province ? normalizeProvince(province) : '';
  return [p, n, pr].filter(Boolean).join(' ');
}

// Best-effort split of a legacy free-text plate into structured parts.
function parseLegacyPlateText(plate_no) {
  const m = String(plate_no == null ? '' : plate_no)
    .match(/^\s*([0-9]?[฀-๿]{1,3})\s*([0-9]{1,4})\s*([฀-๿a-zA-Z][฀-๿a-zA-Z\s]*)?\s*$/);
  if (!m) return null;
  return { plate_prefix: m[1], plate_number: m[2], province: (m[3] || '').trim() };
}

function canonicalFromAny(input) {
  if (input && typeof input === 'object') return buildCanonicalPlate(input);
  const parsed = parseLegacyPlateText(input);
  return parsed ? buildCanonicalPlate(parsed) : normalizeThaiText(input).toLowerCase();
}

// True when two plates (structured or legacy strings) are the SAME identity
// (spacing/punctuation/province-alias insensitive).
function comparePlateIdentity(a, b) {
  const ca = canonicalFromAny(a);
  const cb = canonicalFromAny(b);
  return !!ca && ca === cb;
}

function baseKey({ plate_prefix, plate_number }) {
  return (normalizePlatePrefix(plate_prefix) + normalizePlateNumber(plate_number)).toLowerCase();
}

function conflict(code, message, v) {
  return {
    code, message,
    vehicle_id: v ? v.id : null,
    display_plate: v ? formatPlateDisplay(v.plate_no) : null,
    is_deleted: v ? !!v.is_deleted : null,
    school_id: v && v.school_id != null ? v.school_id : null,
    school_name: v && v.school_name != null ? v.school_name : null,
  };
}

/**
 * Classify an incoming plate against existing vehicles.
 * @param input  {plate_prefix, plate_number, province} | legacy plate_no string
 * @param existingVehicles [{id, plate_no, is_deleted, school_id?, school_name?}]
 * @param opts   { schoolId } — the school doing the add (for SAME vs OTHER school)
 * Returns { code, message, vehicle_id?, display_plate?, is_deleted?, school_id? }
 *   PLATE_FORMAT_INVALID, AMBIGUOUS_PLATE_NEEDS_PROVINCE,
 *   SAME_ACTIVE_VEHICLE_SAME_SCHOOL, SAME_ACTIVE_VEHICLE_OTHER_SCHOOL,
 *   SOFT_DELETED_VEHICLE_EXISTS, PROVINCE_ALIAS_DUPLICATE, VALID_NEW_VEHICLE
 */
function classifyVehiclePlateConflict(input, existingVehicles = [], opts = {}) {
  const s = (input && typeof input === 'object') ? input : parseLegacyPlateText(input);
  if (!s || !normalizePlatePrefix(s.plate_prefix) || !normalizePlateNumber(s.plate_number)) {
    return conflict('PLATE_FORMAT_INVALID', 'รูปแบบทะเบียนรถไม่ถูกต้อง กรุณากรอกหมวดอักษร เลขทะเบียน และจังหวัด');
  }
  const hasProvince = !!normalizeProvince(s.province);
  const inputCanon = buildCanonicalPlate(s);
  const inputBase = baseKey(s);

  let provinceVariant = null;
  for (const v of existingVehicles) {
    const vp = parseLegacyPlateText(v.plate_no);
    if (!vp) continue;
    if (buildCanonicalPlate(vp) === inputCanon) {
      if (v.is_deleted) {
        return conflict('SOFT_DELETED_VEHICLE_EXISTS', 'ทะเบียนรถนี้ตรงกับรถที่ถูกปิดใช้งานแล้ว กรุณาตรวจสอบก่อนกู้คืนหรือเพิ่มใหม่', v);
      }
      // alias-only difference (same canonical but the province text differs)
      if (normalizeThaiText(s.province).toLowerCase() !== normalizeThaiText(vp.province).toLowerCase()) {
        return conflict('PROVINCE_ALIAS_DUPLICATE', 'ทะเบียนรถนี้มีอยู่ในระบบแล้ว กรุณาตรวจสอบรถเดิมก่อนเพิ่มใหม่', v);
      }
      const sameSchool = opts.schoolId != null && v.school_id != null && String(v.school_id) === String(opts.schoolId);
      const code = sameSchool ? 'SAME_ACTIVE_VEHICLE_SAME_SCHOOL'
        : (v.school_id != null ? 'SAME_ACTIVE_VEHICLE_OTHER_SCHOOL' : 'SAME_ACTIVE_VEHICLE_SAME_SCHOOL');
      return conflict(code, 'ทะเบียนรถนี้มีอยู่ในระบบแล้ว กรุณาตรวจสอบรถเดิมก่อนเพิ่มใหม่', v);
    }
    // province-variant: same base (prefix+number) but exactly one carries a province
    if (!v.is_deleted && baseKey(vp) === inputBase && hasProvince !== !!normalizeProvince(vp.province)) {
      provinceVariant = v;
    }
  }

  // Province omitted on a plate that collides on the base → ask for province.
  if (!hasProvince && provinceVariant) {
    return conflict('AMBIGUOUS_PLATE_NEEDS_PROVINCE', 'กรุณาระบุจังหวัดของทะเบียนรถให้ชัดเจน เพื่อป้องกันข้อมูลซ้ำ', provinceVariant);
  }
  if (!hasProvince) {
    return conflict('AMBIGUOUS_PLATE_NEEDS_PROVINCE', 'กรุณาระบุจังหวัดของทะเบียนรถให้ชัดเจน เพื่อป้องกันข้อมูลซ้ำ');
  }
  return conflict('VALID_NEW_VEHICLE', null);
}

module.exports = {
  PROVINCE_ALIASES,
  normalizeThaiText,
  normalizeProvince,
  detectProvinceAlias,
  normalizePlatePrefix,
  normalizePlateNumber,
  buildCanonicalPlate,
  buildDisplayPlate,
  parseLegacyPlateText,
  comparePlateIdentity,
  classifyVehiclePlateConflict,
};
