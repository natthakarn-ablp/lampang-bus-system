'use strict';

// Phase 10.13A-23C — guard against silently re-activating a dedupe-disabled or
// broken DRIVER account (the user-management round-trip that resurrected 358/369/
// 408 after the dedupe). Call only when a role='driver' user is transitioning
// is_active FALSE → TRUE.
//
// A driver that was deactivated as a duplicate has driver_id = NULL, while the
// kept "canonical" driver is LINKED (driver_id set). So we block reactivation
// when a linked canonical sibling exists for the same plate — even if that
// canonical was itself soft-deleted (e.g. 408's canonical 407). That forces the
// operator to consciously use/restore the canonical instead of silently flipping
// the duplicate back on.
//
// Returns { blocked, reason, canonicalUserId }:
//   DUPLICATE_OF_LINKED_DRIVER        — another driver user with the SAME
//                                       normalized plate is linked (e.g. 369→368,
//                                       408→407).
//   PROVINCE_VARIANT_OF_LINKED_DRIVER — a linked driver user is a province-variant
//                                       of this plate (e.g. 358 'นข4031' → 363
//                                       'นข 4031 ลำปาง').
//   NO_ACTIVE_VEHICLE                 — this plate resolves to no active vehicle
//                                       (its vehicle is soft-deleted / missing).
// Not blocked → a legitimate, non-duplicate driver with an active vehicle.

const { normalizePlate, isProvinceVariant } = require('./vehiclePlate');

async function detectDriverReactivationBlock(pool, user) {
  const norm = normalizePlate(user.username || '');
  if (!norm) return { blocked: false, reason: null, canonicalUserId: null };

  // LINKED canonical siblings (driver_id set) for the same plate. Includes
  // soft-deleted ones — a linked sibling means THIS account is the duplicate.
  const [siblings] = await pool.query(
    `SELECT id, REPLACE(REPLACE(LOWER(username), ' ', ''), '-', '') AS n
     FROM users
     WHERE role = 'driver' AND id <> ? AND driver_id IS NOT NULL`,
    [user.id]
  );
  const exact = siblings.find((s) => s.n === norm);
  if (exact) return { blocked: true, reason: 'DUPLICATE_OF_LINKED_DRIVER', canonicalUserId: exact.id };
  const variant = siblings.find((s) => isProvinceVariant(s.n, norm));
  if (variant) return { blocked: true, reason: 'PROVINCE_VARIANT_OF_LINKED_DRIVER', canonicalUserId: variant.id };

  // No linked canonical sibling — block only if the plate resolves to no ACTIVE
  // (non-deleted) vehicle (a broken account pointing at a soft-deleted vehicle).
  const [active] = await pool.query(
    `SELECT id FROM vehicles WHERE is_deleted = FALSE AND (plate_no = ? OR normalized_plate = ?) LIMIT 1`,
    [user.username, norm]
  );
  if (active.length === 0) return { blocked: true, reason: 'NO_ACTIVE_VEHICLE', canonicalUserId: null };

  return { blocked: false, reason: null, canonicalUserId: null };
}

module.exports = { detectDriverReactivationBlock };
