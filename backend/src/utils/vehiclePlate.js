'use strict';

// Phase 10.6B — single source of truth for plate-number normalization.
// The same rule MUST be used by:
//   - the SQL backfill in migration 023 / 024 (kept in sync via the
//     spec in migration headers — DB only does TRIM + REPLACE spaces and
//     ASCII hyphens, while the JS helper additionally strips en/em dashes
//     and full-width spaces. Migration 024 backfill is updated to match.)
//   - every JS write path that touches vehicles.plate_no
//
// Rationale: Thai plates entered through different UIs (web, import, LIFF)
// drift on whitespace and hyphens. Without normalization, "นข 2210 ลำปาง",
// "นข2210ลำปาง", and "นข-2210-ลำปาง" all create distinct rows. We keep the
// original `plate_no` for display and use `normalized_plate` (lowercased,
// whitespace-and-dash-free) as the uniqueness key.

const WHITESPACE_RE = /[\s   -​  　﻿]+/g;
const DASH_RE       = /[-‐-―]/g;  // ASCII hyphen, hyphen, non-breaking hyphen, figure dash, en dash, em dash, horizontal bar

function normalizePlate(plateNo) {
  if (typeof plateNo !== 'string') return '';
  return plateNo
    .replace(WHITESPACE_RE, '')
    .replace(DASH_RE, '')
    .toLowerCase();
}

/**
 * Validate + normalize in one step. Returns either:
 *   { valid: true,  trimmed: '<plate after .trim()>', normalized: '<normalized>' }
 *   { valid: false, error: '<thai user-facing message>' }
 *
 * Routes should call validatePlateNo() and surface `error` via sendError().
 */
function validatePlateNo(plateNo) {
  if (typeof plateNo !== 'string') {
    return { valid: false, error: 'กรุณาระบุทะเบียนรถ' };
  }
  const trimmed = plateNo.trim();
  if (!trimmed) {
    return { valid: false, error: 'กรุณาระบุทะเบียนรถ' };
  }
  const normalized = normalizePlate(trimmed);
  if (!normalized) {
    return { valid: false, error: 'ทะเบียนรถไม่ถูกต้อง' };
  }
  return { valid: true, trimmed, normalized };
}

// Phase 10.13A-13 — detect province-omitted duplicates at onboarding.
// True when two NORMALIZED plates differ only by a trailing province token,
// e.g. 'นข4337' vs 'นข4337ลำปาง'. One must be a strict prefix of the other and
// the differing suffix must be all Thai letters (a province) — so genuinely
// different plate numbers ('นข433' vs 'นข4337', suffix '7') are NOT flagged.
const THAI_LETTERS_RE = /^[฀-๿]+$/; // Thai Unicode block (letters/vowels)

function isProvinceVariant(normA, normB) {
  if (!normA || !normB || normA === normB) return false;
  const [shortP, longP] = normA.length < normB.length ? [normA, normB] : [normB, normA];
  if (!longP.startsWith(shortP)) return false;
  return THAI_LETTERS_RE.test(longP.slice(shortP.length));
}

// Phase 10.13A-22 — build a canonical display plate from structured parts so
// operators can't free-type spacing/province variants. prefix = 1–3 Thai
// letters (optional leading digit, e.g. "1นค"); number = 1–4 digits; province
// = non-empty (chosen from a dropdown). Returns the human display plate
// (`นข 4337 ลำปาง`) plus its normalized key; the route still re-normalizes and
// runs the duplicate guard — backend stays the source of truth.
const PLATE_PREFIX_RE = /^[0-9]?[฀-๿]{1,3}$/;
const PLATE_NUMBER_RE = /^[0-9]{1,4}$/;

function buildStructuredPlate({ prefix, number, province } = {}) {
  const p = String(prefix == null ? '' : prefix).trim();
  const n = String(number == null ? '' : number).trim();
  const prov = String(province == null ? '' : province).trim();
  if (!p || !n || !prov) {
    return { valid: false, code: 'PLATE_FIELDS_REQUIRED', error: 'กรุณากรอกหมวดอักษร เลขทะเบียน และจังหวัดให้ครบถ้วน' };
  }
  if (!PLATE_PREFIX_RE.test(p) || !PLATE_NUMBER_RE.test(n)) {
    return { valid: false, code: 'PLATE_FORMAT_INVALID', error: 'รูปแบบทะเบียนรถไม่ถูกต้อง กรุณาตรวจสอบหมวดอักษรและเลขทะเบียน' };
  }
  const plateNo = `${p} ${n} ${prov}`;
  return { valid: true, plateNo, normalized: normalizePlate(plateNo) };
}

// Phase 10.13A-22A — canonical human display for a stored plate_no. Splits
// prefix / number / province and rejoins with single spaces ('นข4337ลำปาง' →
// 'นข 4337 ลำปาง'). Never invents a missing province; returns the original
// string unchanged if it can't be parsed.
function formatPlateDisplay(plateNo) {
  const s = String(plateNo == null ? '' : plateNo).trim();
  if (!s) return s;
  const m = s.match(/^([0-9]?[฀-๿]{1,3})\s*([0-9]{1,4})\s*([฀-๿].*)?$/);
  if (!m) return s;
  const prefix = m[1];
  const number = m[2];
  const province = (m[3] || '').trim();
  return province ? `${prefix} ${number} ${province}` : `${prefix} ${number}`;
}

module.exports = { normalizePlate, validatePlateNo, isProvinceVariant, buildStructuredPlate, formatPlateDisplay };
