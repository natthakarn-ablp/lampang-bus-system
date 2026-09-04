'use strict';

const { toBangkokDate, todayBangkok } = require('../utils/thaiTime');

const EXPLICIT_VEHICLE_BLOCKERS = new Set([
  'VEHICLE_SUSPENDED',
  'INSPECTION_FAILED',
  'INSPECTION_NEEDS_FIX',
  'INSPECTION_EXPIRED',
  'CAPACITY_EXCEEDED',
  'INSURANCE_EXPIRED',
  'REGISTRATION_EXPIRED',
  'COMPULSORY_INSURANCE_EXPIRED',
  'TAX_EXPIRED',
]);

const EXPLICIT_QUALIFICATION_BLOCKERS = new Set(['EXPIRED', 'SUSPENDED', 'REVOKED']);
const EXPLICIT_AUTHORIZATION_BLOCKERS = new Set(['SUSPENDED', 'REVOKED']);

// Vehicle statuses that hard-fail by status alone, even when the reasons array
// is empty/NULL (e.g. a SUSPENDED vehicle with no verification_reasons_json).
const HARD_FAIL_VEHICLE_STATUSES = new Set(['SUSPENDED']);

function evaluateSafetyPolicy(input = {}) {
  const mode = String(input.mode || 'OBSERVE').toUpperCase();
  if (!['OBSERVE', 'ENFORCE'].includes(mode)) throw new Error('Invalid safety policy mode');

  const reasons = [];
  const vehicleReasons = Array.isArray(input.vehicleReasons) ? input.vehicleReasons : [];
  const explicit = vehicleReasons.filter((reason) => EXPLICIT_VEHICLE_BLOCKERS.has(reason));

  if (HARD_FAIL_VEHICLE_STATUSES.has(input.vehicleStatus)) {
    explicit.push(`VEHICLE_${input.vehicleStatus}`);
  }

  if (EXPLICIT_QUALIFICATION_BLOCKERS.has(input.qualificationStatus)) {
    explicit.push(`DRIVER_${input.qualificationStatus}`);
  }
  if (EXPLICIT_AUTHORIZATION_BLOCKERS.has(input.authorizationStatus)) {
    explicit.push(`ASSIGNMENT_${input.authorizationStatus}`);
  }

  if (explicit.length) {
    return {
      decision: 'BLOCK',
      policy_mode: mode,
      reasons: [...new Set(explicit)],
      audit_required: true,
    };
  }

  if (!['ELIGIBLE', 'EXPIRING'].includes(input.vehicleStatus)) reasons.push('VEHICLE_UNVERIFIED');
  if (input.qualificationStatus !== 'VERIFIED') reasons.push('DRIVER_QUALIFICATION_MISSING');
  if (input.authorizationStatus !== 'AUTHORIZED') reasons.push('DRIVER_ASSIGNMENT_MISSING');
  if (input.requireActiveShift && !input.hasActiveShift) reasons.push('ACTIVE_SHIFT_MISSING');

  if (!reasons.length) {
    return { decision: 'ALLOW', policy_mode: mode, reasons: [], audit_required: false };
  }

  return {
    decision: mode === 'OBSERVE' ? 'ALLOW_WITH_WARNING' : 'BLOCK',
    policy_mode: mode,
    reasons: [...new Set(reasons)],
    audit_required: true,
  };
}

// Bangkok calendar date, consistent with driverShift.service.js dateOnly().
// No default, for the reason given there.
function dateOnly(value) {
  return toBangkokDate(value);
}

// Derive the effective qualification status: a VERIFIED license that is missing
// or expired (license_expiry < today, date-only) is treated as EXPIRED so it
// hard-BLOCKs in both OBSERVE and ENFORCE — matching driverShift.startShift.
function effectiveQualificationStatus(qualificationStatus, licenseExpiry, today = todayBangkok()) {
  if (qualificationStatus !== 'VERIFIED') return qualificationStatus;
  if (!licenseExpiry || dateOnly(licenseExpiry) < today) return 'EXPIRED';
  return qualificationStatus;
}

function parseReasons(rawReasons) {
  if (Array.isArray(rawReasons)) return rawReasons;
  if (!rawReasons) return [];
  if (typeof rawReasons === 'string') {
    try {
      const parsed = JSON.parse(rawReasons);
      return Array.isArray(parsed) ? parsed : [];
    } catch { return []; }
  }
  return [];
}

async function assessDriverOperation(pool, {
  vehicleId, driverId, mode, requireActiveShift = false,
}) {
  const [[vehicle]] = await pool.query(
    `SELECT verification_status, verification_reasons_json
       FROM vehicles WHERE id=? AND COALESCE(is_deleted,0)=0 LIMIT 1`,
    [vehicleId]
  );
  const [[qualification]] = driverId ? await pool.query(
    `SELECT qualification_status, license_expiry
       FROM driver_qualifications
      WHERE driver_id=? AND is_current=1
      ORDER BY verified_at DESC, id DESC LIMIT 1`,
    [driverId]
  ) : [[null]];
  const [[assignment]] = driverId && vehicleId ? await pool.query(
    `SELECT authorization_status
       FROM driver_vehicle_assignments
      WHERE driver_id=? AND vehicle_id=? AND is_active=1
      ORDER BY id DESC LIMIT 1`,
    [driverId, vehicleId]
  ) : [[null]];
  const [[shift]] = requireActiveShift && driverId && vehicleId ? await pool.query(
    `SELECT id FROM vehicle_operating_shifts
      WHERE driver_id=? AND vehicle_id=? AND status='OPEN' AND ended_at IS NULL LIMIT 1`,
    [driverId, vehicleId]
  ) : [[null]];

  return evaluateSafetyPolicy({
    mode,
    vehicleStatus: vehicle?.verification_status || 'UNVERIFIED',
    vehicleReasons: parseReasons(vehicle?.verification_reasons_json),
    qualificationStatus: effectiveQualificationStatus(
      qualification?.qualification_status || null,
      qualification?.license_expiry
    ),
    authorizationStatus: assignment?.authorization_status || null,
    requireActiveShift,
    hasActiveShift: Boolean(shift),
  });
}

module.exports = {
  evaluateSafetyPolicy,
  assessDriverOperation,
  effectiveQualificationStatus,
  EXPLICIT_VEHICLE_BLOCKERS,
  HARD_FAIL_VEHICLE_STATUSES,
};
