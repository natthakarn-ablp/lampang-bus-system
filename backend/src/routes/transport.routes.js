'use strict';

const express = require('express');
const router = express.Router();

const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/roleGuard');
const { sendSuccess, sendError } = require('../utils/response');
const { logAudit } = require('../utils/audit');
const transportSvc = require('../services/transport.service');
const ppSvc = require('../services/pickupPoint.service');

// All routes require transport or admin role
router.use(authenticate, requireRole('transport', 'admin'));

// ─── GET /api/transport/vehicles/check-plate (Phase 10.13A-15) ──────────────
// Read-only duplicate preflight (warns before creating a duplicate). No writes.
router.get('/vehicles/check-plate', async (req, res, next) => {
  try {
    const { findPlateMatches } = require('../services/vehicleDedup.service');
    const result = await findPlateMatches(req.query.plate_no);
    return sendSuccess(res, result);
  } catch (err) { return next(err); }
});

// ─── POST /api/transport/vehicles (create new vehicle for inspection) ───────
// Phase 10.6B — duplicate check uses normalized_plate (whitespace + dash
// agnostic) so "นข 2210 ลำปาง" / "นข2210ลำปาง" / "นข-2210-ลำปาง" collide.
// Returns existing row on collision instead of erroring — transport flow is
// "use what's already there for inspection" rather than "must be unique here".
router.post('/vehicles', async (req, res, next) => {
  try {
    const { plate_no, vehicle_type } = req.body;
    const { validatePlateNo, isProvinceVariant } = require('../utils/vehiclePlate');
    const validation = validatePlateNo(plate_no);
    if (!validation.valid) return sendError(res, validation.error, [], 400);
    const { trimmed, normalized } = validation;

    const { pool } = require('../config/database');
    const { generateVehicleId } = require('../utils/hash');
    const { logAudit } = require('../utils/audit');

    // Check duplicate by normalized_plate — catches spacing/dash variants
    const [[existing]] = await pool.query(
      'SELECT id, plate_no FROM vehicles WHERE normalized_plate = ? AND is_deleted = FALSE',
      [normalized]
    );
    if (existing) {
      return sendSuccess(
        res,
        { id: existing.id, plate_no: existing.plate_no, existed: true },
        'รถคันนี้มีในระบบแล้ว'
      );
    }

    // Phase 10.13A-25B — canonical (province-alias-aware) reuse: an existing
    // active vehicle with the same canonical identity (e.g. 'ออ 7332 กทม' for an
    // input 'ออ 7332 กรุงเทพมหานคร') is the SAME bus → reuse it for inspection.
    const { classifyVehiclePlateConflict } = require('../utils/plateIdentity');
    const [activeForCanon] = await pool.query('SELECT id, plate_no, is_deleted FROM vehicles WHERE is_deleted = FALSE');
    const canon = classifyVehiclePlateConflict(trimmed, activeForCanon);
    if (canon.vehicle_id && ['SAME_ACTIVE_VEHICLE_SAME_SCHOOL', 'SAME_ACTIVE_VEHICLE_OTHER_SCHOOL', 'PROVINCE_ALIAS_DUPLICATE'].includes(canon.code)) {
      return sendSuccess(
        res,
        { id: canon.vehicle_id, plate_no: canon.display_plate, existed: true },
        'รถคันนี้มีในระบบแล้ว (จับคู่จากชื่อจังหวัดที่เขียนต่างกัน)'
      );
    }

    // Phase 10.13A-14 — reject province-omitted/variant duplicates (mirrors the
    // school onboarding guard). Only an active vehicle whose normalized plate
    // differs from this one by a trailing Thai province is flagged; different
    // plate numbers are never rejected. No INSERT/audit happens after this.
    const [variantCandidates] = await pool.query(
      `SELECT plate_no, normalized_plate FROM vehicles
       WHERE is_deleted = FALSE
         AND (normalized_plate LIKE CONCAT(?, '%') OR ? LIKE CONCAT(normalized_plate, '%'))`,
      [normalized, normalized]
    );
    const variantList = variantCandidates.filter((c) => isProvinceVariant(c.normalized_plate, normalized));
    if (variantList.length) {
      // Phase 10.13A-15 — include the conflicting plate(s) for the UI warning.
      return sendError(
        res,
        'พบทะเบียนรถนี้ในระบบแล้ว กรุณาตรวจสอบทะเบียนและจังหวัด',
        [{
          code: 'DUPLICATE_OR_INCOMPLETE_PLATE',
          candidates: variantList.map((c) => ({ plate_no: c.plate_no, duplicate_type: 'PROVINCE_VARIANT' })),
        }],
        409
      );
    }

    const id = generateVehicleId(trimmed);
    const { canonicalPlateForStorage } = require('../utils/plateIdentity');
    try {
      await pool.query(
        'INSERT INTO vehicles (id, plate_no, normalized_plate, canonical_plate, vehicle_type) VALUES (?, ?, ?, ?, ?)',
        [id, trimmed, normalized, canonicalPlateForStorage(trimmed), vehicle_type || null]
      );
    } catch (err) {
      // Phase 10.13B-3 — DB unique race backstop → clear Thai duplicate message.
      if (err && err.code === 'ER_DUP_ENTRY' && /uq_vehicles_active_canonical/.test(err.sqlMessage || err.message || '')) {
        return sendError(res, 'ทะเบียนรถนี้มีอยู่ในระบบแล้ว กรุณาตรวจสอบรถเดิมก่อนเพิ่มใหม่', [{ code: 'DUPLICATE_ACTIVE_VEHICLE' }], 409);
      }
      throw err;
    }

    await logAudit({
      userId: req.user.id, action: 'CREATE', entityType: 'vehicle', entityId: id,
      newValue: { plate_no: trimmed, normalized_plate: normalized, source: 'transport_inspection' },
      ipAddress: req.ip, userAgent: req.headers['user-agent'],
    });

    sendSuccess(res, { id, plate_no: trimmed, existed: false }, 'เพิ่มรถใหม่เรียบร้อย', null, 201);
  } catch (err) { next(err); }
});

// ─── GET /api/transport/schools (read-only list for dropdowns) ──────────────
router.get('/schools', async (req, res, next) => {
  try {
    const { pool } = require('../config/database');
    const [schools] = await pool.query(
      `SELECT id, name FROM schools WHERE is_deleted = FALSE ORDER BY name`
    );
    sendSuccess(res, schools);
  } catch (err) { next(err); }
});

// ─── GET /api/transport/dashboard ───────────────────────────────────────────
router.get('/dashboard', async (req, res, next) => {
  try {
    const data = await transportSvc.getDashboard();
    sendSuccess(res, data);
  } catch (err) { next(err); }
});

// ─── GET /api/transport/vehicles ────────────────────────────────────────────
router.get('/vehicles', async (req, res, next) => {
  try {
    const { status, search, page, per_page } = req.query;
    const data = await transportSvc.getVehicles({
      status,
      search,
      page: parseInt(page) || 1,
      per_page: parseInt(per_page) || 50,
    });
    sendSuccess(res, data.vehicles, 'OK', data.meta);
  } catch (err) { next(err); }
});

// ─── GET /api/transport/vehicles/pending (CLAUDE.md §5.6 — รถที่ยังไม่ตรวจ) ──
// MUST be declared BEFORE '/vehicles/:id' so Express does not capture
// "pending" as the :id param (which would 404 "Vehicle not found").
// Lists the vehicles the dashboard counts under `not_inspected` (vehicles with
// no inspection row). Pass ?include_pending=true to also include vehicles whose
// latest inspection result is PENDING (the dashboard's `pending` KPI).
router.get('/vehicles/pending', async (req, res, next) => {
  try {
    const { page, per_page, include_pending } = req.query;
    const data = await transportSvc.getPendingVehicles({
      page: parseInt(page) || 1,
      per_page: parseInt(per_page) || 50,
      includePending: include_pending === 'true' || include_pending === '1',
    });
    sendSuccess(res, data.vehicles, 'OK', data.meta);
  } catch (err) { next(err); }
});

// ─── GET /api/transport/vehicles/expiring (CLAUDE.md §5.6 — รถที่ใกล้หมดอายุ) ─
// MUST be declared BEFORE '/vehicles/:id' (same capture-collision reason).
// Default lists vehicles whose insurance/registration/พ.ร.บ./tax expires within
// 30 days (matches the dashboard `expiring_docs_count`). Pass ?expired=true to
// list already-expired documents instead (matches `expired_docs_count`).
router.get('/vehicles/expiring', async (req, res, next) => {
  try {
    const { page, per_page, expired } = req.query;
    const data = await transportSvc.getExpiringVehicles({
      page: parseInt(page) || 1,
      per_page: parseInt(per_page) || 50,
      expired: expired === 'true' || expired === '1',
    });
    sendSuccess(res, data.vehicles, 'OK', data.meta);
  } catch (err) { next(err); }
});

// ─── GET /api/transport/vehicles/:id ────────────────────────────────────────
router.get('/vehicles/:id', async (req, res, next) => {
  try {
    const data = await transportSvc.getVehicles({ page: 1, per_page: 1 });
    // Filter by id from full list — simple approach for MVP
    const { pool } = require('../config/database');
    const [rows] = await pool.query(
      `SELECT v.*,
              (SELECT d.name FROM driver_vehicle_assignments dva
               JOIN drivers d ON d.id = dva.driver_id AND d.is_deleted = FALSE
               WHERE dva.vehicle_id = v.id AND dva.is_active = TRUE LIMIT 1) AS driver_name,
              (SELECT d.phone FROM driver_vehicle_assignments dva
               JOIN drivers d ON d.id = dva.driver_id AND d.is_deleted = FALSE
               WHERE dva.vehicle_id = v.id AND dva.is_active = TRUE LIMIT 1) AS driver_phone
       FROM vehicles v WHERE v.id = ? AND v.is_deleted = FALSE`,
      [req.params.id]
    );
    if (rows.length === 0) return sendError(res, 'Vehicle not found', [], 404);
    sendSuccess(res, rows[0]);
  } catch (err) { next(err); }
});

// ─── GET /api/transport/inspections ─────────────────────────────────────────
router.get('/inspections', async (req, res, next) => {
  try {
    const { vehicle_id, result, page, per_page } = req.query;
    const data = await transportSvc.getInspections({
      vehicle_id, result,
      page: parseInt(page) || 1,
      per_page: parseInt(per_page) || 20,
    });
    sendSuccess(res, data.inspections, 'OK', data.meta);
  } catch (err) { next(err); }
});

// ─── POST /api/transport/inspections ────────────────────────────────────────
router.post('/inspections', async (req, res, next) => {
  try {
    const { vehicle_id, inspection_date, expiry_date, result, notes, certifying_school_id } = req.body;
    if (!vehicle_id || !inspection_date || !result) {
      return sendError(res, 'vehicle_id, inspection_date, and result are required', [], 400);
    }
    const validResults = ['PASSED', 'FAILED', 'NEEDS_FIX', 'PENDING'];
    if (!validResults.includes(result)) {
      return sendError(res, `result must be one of: ${validResults.join(', ')}`, [], 400);
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(inspection_date)) {
      return sendError(res, 'inspection_date must be YYYY-MM-DD format', [], 400);
    }
    if (expiry_date && !/^\d{4}-\d{2}-\d{2}$/.test(expiry_date)) {
      return sendError(res, 'expiry_date must be YYYY-MM-DD format', [], 400);
    }

    const id = await transportSvc.createInspection({
      vehicleId: vehicle_id,
      inspectionDate: inspection_date,
      expiryDate: expiry_date,
      result,
      notes,
      certifyingSchoolId: certifying_school_id || null,
      userId: req.user.id,
    });

    await logAudit({
      userId: req.user.id, action: 'CREATE', entityType: 'vehicle_inspection',
      entityId: id, newValue: req.body,
      ipAddress: req.ip, userAgent: req.headers['user-agent'],
    });

    sendSuccess(res, { id }, 'Inspection recorded', null, 201);
  } catch (err) { next(err); }
});

// ─── PUT /api/transport/inspections/:id ─────────────────────────────────────
router.put('/inspections/:id', async (req, res, next) => {
  try {
    const { expiry_date, result, notes } = req.body;
    if (!result) return sendError(res, 'result is required', [], 400);

    await transportSvc.updateInspection({
      inspectionId: req.params.id,
      expiryDate: expiry_date,
      result,
      notes,
      userId: req.user.id,
    });

    await logAudit({
      userId: req.user.id, action: 'UPDATE', entityType: 'vehicle_inspection',
      entityId: req.params.id, newValue: req.body,
      ipAddress: req.ip, userAgent: req.headers['user-agent'],
    });

    sendSuccess(res, null, 'Inspection updated');
  } catch (err) { next(err); }
});

// ─── Phase 7.12.2 — GET /api/transport/pickup-map ───────────────────────────
// Read-only multi-role pickup-point map for transport oversight. Aggregate-only
// rows: no student names / phones / addresses.
router.get('/pickup-map', async (req, res, next) => {
  try {
    const { affiliation_id, school_id, vehicle_id, session, grade, search } = req.query;

    if (!ppSvc.isValidSession(session || null)) {
      return sendError(res, 'session ต้องเป็น morning, evening หรือ both', [], 400);
    }
    if (!ppSvc.isValidGrade(grade || null)) {
      return sendError(res, 'ชั้นเรียนไม่ถูกต้อง', [], 400);
    }

    const data = await ppSvc.getReadOnlyPickupMap({
      filterAffiliationId: affiliation_id || null,
      filterSchoolId: school_id || null,
      filterVehicleId: vehicle_id || null,
      session: session || null,
      grade: grade || null,
      search: search || null,
    });

    ppSvc.maybeAuditPickupMapView({
      userId: req.user.id,
      entityType: 'transport_pickup_map',
      entityId: 'transport',
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    sendSuccess(res, data);
  } catch (err) { next(err); }
});

module.exports = router;
