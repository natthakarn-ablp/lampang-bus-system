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

module.exports = { normalizePlate, validatePlateNo, isProvinceVariant };
