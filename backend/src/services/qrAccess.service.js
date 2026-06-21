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
    `SELECT id, plate_no, vehicle_type, insurance_status, insurance_expiry, is_deleted
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
  const [[row]] = await pool.query(
    `SELECT result, expiry_date FROM vehicle_inspections
      WHERE vehicle_id = ? ORDER BY inspection_date DESC LIMIT 1`,
    [vehicleId]
  );
  if (!row) return { status: 'PENDING', expired: false };
  const expired = row.expiry_date ? new Date(row.expiry_date) < new Date() : false;
  return { status: row.result, expired };
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
  } else if (source === 'school') {
    // School contact is not modelled as a single phone today → fall through to driver.
    // TODO: ตรวจสอบกับผู้เชี่ยวชาญ — confirm the canonical school emergency line.
  }
  return { source: 'driver', phone: driver ? driver.phone : null };
}

// ── Access level (credentials only — never the client) ───────────────────────
async function resolveAccessLevel(req, vehicleId) {
  if (req.user && STAFF_ROLES.has(req.user.role)) return 3;
  if (req.lineUserId && (await isParentLinkedToVehicle(req.lineUserId, vehicleId))) return 2;
  return 1;
}

// ── View builders — each returns ONLY its level's fields ─────────────────────
async function buildPublicView(vehicle) {
  const driver = await getActiveDriver(vehicle.id);
  const inspection = await getLatestInspectionStatus(vehicle.id);
  return {
    level: 1,
    plate_no: vehicle.plate_no,
    vehicle_type: vehicle.vehicle_type || null,
    inspection_status: inspection.status,
    inspection_expired: inspection.expired,
    insurance_status: deriveInsuranceStatus(vehicle),
    driver_status: await deriveDriverDisplayStatus(driver ? driver.id : null), // normal | suspended | no_driver
    // No driver name, no phone, no owner info, no history.
  };
}

async function buildParentView(vehicle) {
  const pub = await buildPublicView(vehicle);
  const driver = await getActiveDriver(vehicle.id);
  const emergency = await resolveEmergencyContact(vehicle, driver);
  return {
    ...pub,
    level: 2,
    driver_name: driver && pub.driver_status !== 'suspended' ? driver.name : null,
    emergency_contact: pub.driver_status !== 'suspended' ? emergency.phone : null,
    emergency_contact_source: emergency.source,
  };
}

async function buildStaffView(vehicle, req) {
  const parent = await buildParentView(vehicle);
  const driver = await getActiveDriver(vehicle.id);
  let riskHistory = [];
  let level3Enabled = env.features.qrLevel3;
  if (level3Enabled && driver) {
    const [rows] = await pool.query(
      `SELECT id, record_type, severity, description, occurred_on
         FROM driver_risk_records
        WHERE driver_id = ? AND COALESCE(is_deleted, FALSE) = FALSE
        ORDER BY occurred_on DESC LIMIT 100`,
      [driver.id]
    );
    riskHistory = rows;
    // Mandatory PDPA ม.26 sensitive-access audit — who/when/whose-data.
    await logAudit({
      userId: req.user.id,
      action: 'VIEW',
      entityType: 'driver_sensitive',
      entityId: String(driver.id),
      newValue: { vehicle_id: vehicle.id, viewed_fields: ['risk_history'], record_count: rows.length },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }
  return {
    ...parent,
    level: 3,
    // Full driver phone for staff (not just emergency contact).
    driver_phone: driver ? driver.phone : null,
    level3_enabled: level3Enabled,
    risk_history: riskHistory,
  };
}

async function buildViewForLevel(req, vehicle, level) {
  if (level === 3) return buildStaffView(vehicle, req);
  if (level === 2) return buildParentView(vehicle);
  return buildPublicView(vehicle);
}

module.exports = {
  getVehicleByQrToken, isParentLinkedToVehicle, resolveAccessLevel,
  buildPublicView, buildParentView, buildStaffView, buildViewForLevel,
  deriveDriverDisplayStatus, resolveEmergencyContact, getActiveDriver, getLatestInspectionStatus,
};
