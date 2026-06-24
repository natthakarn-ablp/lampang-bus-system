'use strict';

// Phase QR-1 — server-side resolution + view-building for the vehicle QR.
// The access level is computed ONLY from proven credentials (never the client),
// and each builder returns ONLY its level's fields, so a lower level can never
// receive higher-level data. Level-3 (sensitive) reads are audited.

const { pool } = require('../config/database');
const env = require('../config/env');
const { logAudit } = require('../utils/audit');

const STAFF_ROLES = new Set(['transport', 'admin', 'province']);

// ── Lookups ──────────────────────────────────────────────────────────────────
async function getVehicleByQrToken(qrToken) {
  if (!qrToken || typeof qrToken !== 'string') return null;
  const [[v]] = await pool.query(
    `SELECT id, plate_no, vehicle_type, insurance_status, insurance_expiry,
            registration_expiry, compulsory_insurance_expiry, tax_expiry,
            verification_status, verification_updated_at, is_deleted
       FROM vehicles
      WHERE qr_token = ? AND qr_revoked_at IS NULL AND COALESCE(is_deleted, FALSE) = FALSE
      LIMIT 1`,
    [qrToken]
  );
  return v || null;
}

// Is this verified LINE parent linked (approved) to a student on THIS vehicle?
// Mirrors line.service.getChildrenByBoundPhone, filtered to one vehicle.
async function isParentLinkedToVehicle(lineUserId, vehicleId) {
  if (!lineUserId || !vehicleId) return false;
  const [[row]] = await pool.query(
    `SELECT 1 AS ok
       FROM line_bindings lb
       JOIN parents p ON p.phone = lb.phone AND p.is_deleted = FALSE
       JOIN parent_student ps ON ps.parent_id = p.id AND ps.approved = TRUE
       JOIN students s ON s.id = ps.student_id AND s.is_deleted = FALSE
      WHERE lb.line_user_id = ? AND s.vehicle_id = ?
      LIMIT 1`,
    [lineUserId, vehicleId]
  );
  return !!row;
}

// L2 is a CONSENT-based disclosure (qr_parent_optin, requiresConsent:true). A
// linked parent only reaches L2 after granting that opt-in, and a withdrawal
// (latest row = 'withdrawn') immediately drops them back to L1 (PDPA ม.19).
async function hasGrantedParentConsent(lineUserId) {
  if (!lineUserId) return false;
  const [[row]] = await pool.query(
    `SELECT consent_status FROM consent_records
      WHERE line_user_id = ? AND consent_type = 'qr_parent_optin'
      ORDER BY id DESC LIMIT 1`,
    [lineUserId]
  );
  return !!row && row.consent_status === 'granted';
}

async function getActiveDriver(vehicleId) {
  const [[d]] = await pool.query(
    `SELECT d.id, d.name, d.phone
       FROM drivers d
       JOIN driver_vehicle_assignments dva ON dva.driver_id = d.id
      WHERE dva.vehicle_id = ? AND dva.is_active = TRUE AND d.is_deleted = FALSE
      LIMIT 1`,
    [vehicleId]
  );
  return d || null;
}

async function deriveDriverDisplayStatus(driverId) {
  if (!driverId) return 'no_driver';
  const [[row]] = await pool.query('SELECT display_status FROM driver_display_status WHERE driver_id = ? LIMIT 1', [driverId]);
  return row ? row.display_status : 'normal';
}

async function getLatestInspectionStatus(vehicleId) {
  // Deterministic tie-break on id DESC so two same-day inspections never let an
  // older same-day PASSED mask a newer FAILED (inspection_date is day-granularity).
  const [[shared]] = await pool.query(
    `SELECT ia.result, ia.inspection_date, ia.expiry_date
       FROM inspection_attempts ia
       JOIN vehicle_inspection_applications a ON a.id = ia.application_id
      WHERE a.vehicle_id = ? AND ia.result <> 'IN_PROGRESS' AND ia.finalized_at IS NOT NULL
      ORDER BY ia.inspection_date DESC, ia.finalized_at DESC
      LIMIT 1`,
    [vehicleId]
  );
  if (shared) {
    const expired = shared.expiry_date ? new Date(shared.expiry_date) < new Date() : false;
    return {
      status: shared.result,
      expired,
      inspection_date: shared.inspection_date || null,
      expiry_date: shared.expiry_date || null,
      source: 'SHARED_VERIFICATION',
    };
  }
  const [[row]] = await pool.query(
    `SELECT result, inspection_date, expiry_date FROM vehicle_inspections
      WHERE vehicle_id = ? ORDER BY inspection_date DESC, id DESC LIMIT 1`,
    [vehicleId]
  );
  if (!row) return { status: 'PENDING', expired: false };
  const expired = row.expiry_date ? new Date(row.expiry_date) < new Date() : false;
  return {
    status: row.result, expired,
    inspection_date: row.inspection_date || null,
    expiry_date: row.expiry_date || null,
    source: 'LEGACY_INSPECTION',
  };
}

function documentStatus(expiry, today = new Date()) {
  if (!expiry) return 'MISSING';
  const end = new Date(expiry);
  if (end < today) return 'EXPIRED';
  const days = Math.ceil((end - today) / 86400000);
  return days <= 30 ? 'EXPIRING' : 'VALID';
}

function buildDocumentStatus(vehicle) {
  return {
    insurance: documentStatus(vehicle.insurance_expiry),
    registration: documentStatus(vehicle.registration_expiry),
    compulsory_insurance: documentStatus(vehicle.compulsory_insurance_expiry),
    tax: documentStatus(vehicle.tax_expiry),
  };
}

function deriveInsuranceStatus(vehicle) {
  if (vehicle.insurance_expiry) {
    return new Date(vehicle.insurance_expiry) >= new Date() ? 'active' : 'expired';
  }
  const s = String(vehicle.insurance_status || '').trim().toLowerCase();
  if (!s || s === 'none' || s === 'ไม่มี') return 'none';
  return 'active';
}

// Config-keyed emergency contact (default = driver phone). Swappable without code.
async function resolveEmergencyContact(vehicle, driver) {
  const source = env.features.qrEmergencyContactSource;
  if (source === 'attendant') {
    const [[a]] = await pool.query('SELECT phone FROM vehicle_attendants WHERE vehicle_id = ? AND phone IS NOT NULL LIMIT 1', [vehicle.id]);
    if (a && a.phone) return { source: 'attendant', phone: a.phone };
    // No attendant phone on file → expose nothing rather than silently leaking
    // the driver's personal phone under an 'attendant' label.
    return { source: 'attendant', phone: null };
  }
  if (source === 'school') {
    // A single canonical school emergency line is not modelled yet. Do NOT fall
    // through to the driver's personal phone (that would defeat the operator's
    // data-minimization intent); return no contact and report the real source.
    // TODO: ตรวจสอบกับผู้เชี่ยวชาญ — model the school emergency line, then wire here.
    return { source: 'school', phone: null };
  }
  return { source: 'driver', phone: driver ? driver.phone : null };
}

// ── Access level (credentials only — never the client) ───────────────────────
async function resolveAccessLevel(req, vehicleId) {
  if (req.user && STAFF_ROLES.has(req.user.role)) return 3;
  if (req.lineUserId
      && (await isParentLinkedToVehicle(req.lineUserId, vehicleId))
      && (await hasGrantedParentConsent(req.lineUserId))) return 2;
  return 1;
}

// ── Shared per-request context — resolved ONCE so the driver identity + status
// in one response always describe the SAME driver (no torn multi-read). ────────
async function resolveContext(vehicle) {
  const driver = await getActiveDriver(vehicle.id);
  const driverStatus = await deriveDriverDisplayStatus(driver ? driver.id : null);
  const inspection = await getLatestInspectionStatus(vehicle.id);
  return { driver, driverStatus, inspection };
}

// ── View builders — each returns ONLY its level's fields ─────────────────────
async function buildPublicView(vehicle, ctx) {
  ctx = ctx || await resolveContext(vehicle);
  return {
    level: 1,
    plate_no: vehicle.plate_no,
    vehicle_type: vehicle.vehicle_type || null,
    inspection_status: ctx.inspection.status,
    inspection_expired: ctx.inspection.expired,
    last_inspection_date: ctx.inspection.inspection_date || null,
    inspection_expiry: ctx.inspection.expiry_date || null,
    eligibility_status: vehicle.verification_status || 'UNVERIFIED',
    document_status: buildDocumentStatus(vehicle),
    insurance_status: deriveInsuranceStatus(vehicle),
    driver_status: ctx.driverStatus, // normal | suspended | no_driver
    // No driver name, no phone, no owner info, no history.
  };
}

async function buildParentView(vehicle, ctx) {
  ctx = ctx || await resolveContext(vehicle);
  const pub = await buildPublicView(vehicle, ctx);
  const visible = !!ctx.driver && ctx.driverStatus !== 'suspended';
  const emergency = await resolveEmergencyContact(vehicle, ctx.driver);
  return {
    ...pub,
    level: 2,
    driver_name: visible ? ctx.driver.name : null,
    emergency_contact: visible ? emergency.phone : null,
    emergency_contact_source: emergency.source,
  };
}

async function buildStaffView(vehicle, req, ctx) {
  ctx = ctx || await resolveContext(vehicle);
  const parent = await buildParentView(vehicle, ctx);
  const driver = ctx.driver;
  const visible = !!driver && ctx.driverStatus !== 'suspended';
  const level3Enabled = env.features.qrLevel3;

  let riskHistory = [];
  let driverPhone = null;
  if (level3Enabled && driver) {
    // Full driver phone is an L3-sensitive field (distinct from the L2 emergency
    // contact): only disclosed when the L3 viewer is enabled, suspension-guarded.
    driverPhone = visible ? driver.phone : null;
    const [rows] = await pool.query(
      `SELECT id, record_type, severity, description, occurred_on
         FROM driver_risk_records
        WHERE driver_id = ? AND COALESCE(is_deleted, FALSE) = FALSE
        ORDER BY occurred_on DESC LIMIT 100`,
      [driver.id]
    );
    riskHistory = rows;
    // Mandatory PDPA ม.26 sensitive-access audit — fires for ANY L3 sensitive
    // disclosure (driver_phone and/or risk_history), not only when risk rows exist.
    await logAudit({
      userId: req.user.id,
      action: 'VIEW',
      entityType: 'driver_sensitive',
      entityId: String(driver.id),
      newValue: {
        vehicle_id: vehicle.id,
        viewed_fields: [...(driverPhone ? ['driver_phone'] : []), 'risk_history'],
        record_count: rows.length,
      },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }
  return {
    ...parent,
    level: 3,
    driver_phone: driverPhone,        // null unless FEATURE_QR_LEVEL3 + not suspended
    level3_enabled: level3Enabled,
    risk_history: riskHistory,
  };
}

async function buildViewForLevel(req, vehicle, level) {
  const ctx = await resolveContext(vehicle); // resolve once → consistent identity
  if (level === 3) return buildStaffView(vehicle, req, ctx);
  if (level === 2) return buildParentView(vehicle, ctx);
  return buildPublicView(vehicle, ctx);
}

module.exports = {
  getVehicleByQrToken, isParentLinkedToVehicle, hasGrantedParentConsent, resolveAccessLevel,
  buildPublicView, buildParentView, buildStaffView, buildViewForLevel,
  deriveDriverDisplayStatus, resolveEmergencyContact, getActiveDriver, getLatestInspectionStatus,
  buildDocumentStatus,
};
