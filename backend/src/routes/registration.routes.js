'use strict';

/**
 * registration.routes.js — Phase 10.14
 *
 * Driver-initiated vehicle registration roster + per-school approval. Exposes
 * two routers (driver-facing and school-facing) mounted ONLY when
 * FEATURE_DRIVER_REGISTRATION=true (dark by default). Existing /api/driver and
 * /api/school routers are untouched.
 */

const express = require('express');
const multer  = require('multer');
const path    = require('path');
const fs      = require('fs');
const crypto  = require('crypto');
const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/roleGuard');
const { sendSuccess, sendError } = require('../utils/response');
const { pool } = require('../config/database');
const { isAllowedDocument } = require('../utils/fileType');
const checkinSvc = require('../services/checkin.service');
const reg = require('../services/vehicleRegistration.service');
const docSvc = require('../services/driverDocuments.service');

const SCOPE_ERR = [{ code: 'SCHOOL_SCOPE_REQUIRED' }];

// ─── Document upload config (mirrors driver.routes.js POST /profile/photo,
//     but allows PDF + image and 5MB) ──────────────────────────────────────────
const docUploadDir = path.join(__dirname, '../../uploads/documents');
if (!fs.existsSync(docUploadDir)) fs.mkdirSync(docUploadDir, { recursive: true });
const docUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, docUploadDir),
    filename: (req, file, cb) => cb(null, `${req.user.id}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${path.extname(file.originalname).toLowerCase()}`),
  }),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (_req, file, cb) => {
    const allowed = ['.pdf', '.jpg', '.jpeg', '.png', '.webp'];
    cb(null, allowed.includes(path.extname(file.originalname).toLowerCase()));
  },
});

// Validate magic bytes of the just-written file, unlink on reject, else return
// { sha256, size }. Mirrors the sniff-then-unlink guard in driver.routes.js.
function validateStoredDocument(req, res) {
  if (!req.file) { sendError(res, 'กรุณาเลือกไฟล์เอกสาร (PDF, .jpg, .png, .webp ขนาดไม่เกิน 5MB)', [], 400); return null; }
  let buf;
  try { buf = fs.readFileSync(req.file.path); }
  catch { fs.unlink(req.file.path, () => {}); sendError(res, 'ไม่สามารถอ่านไฟล์ที่อัปโหลดได้', [], 400); return null; }
  if (!isAllowedDocument(buf.subarray(0, 16))) {
    fs.unlink(req.file.path, () => {});
    sendError(res, 'ไฟล์ที่อัปโหลดไม่ใช่เอกสารที่รองรับ (PDF, .jpg, .png, .webp)', [], 400);
    return null;
  }
  return { sha256: crypto.createHash('sha256').update(buf).digest('hex'), size: buf.length };
}

async function resolveDriverVehicleId(req) {
  const vehicle = await checkinSvc.getDriverVehicle(pool, req.user);
  return vehicle ? vehicle.vehicle_id : null;
}

function schoolScope(req) {
  if (req.user.role === 'admin') return req.query.school_id || (req.body && req.body.school_id) || null;
  return req.user.scopeId || null;
}

// ─── Driver-facing — mounted at /api/driver/registrations ────────────────────
const driverRouter = express.Router();
driverRouter.use(authenticate, requireRole('driver'));

driverRouter.post('/students', async (req, res, next) => {
  try {
    const vehicleId = await resolveDriverVehicleId(req);
    if (!vehicleId) return sendError(res, 'ไม่พบรถที่ผูกกับบัญชีคนขับ', [{ code: 'NO_VEHICLE' }], 400);
    const out = await reg.addRosterStudent(pool, {
      vehicleId,
      driverUserId: req.user.id,
      raw_student_name: req.body.raw_student_name,
      raw_grade: req.body.raw_grade,
      raw_student_code: req.body.raw_student_code,
      school_id: req.body.school_id,
      pickup_type: req.body.pickup_type,
    });
    return sendSuccess(res, out, 'เพิ่มรายชื่อนักเรียนแล้ว', null, 201);
  } catch (error) { return next(error); }
});

driverRouter.get('/', async (req, res, next) => {
  try {
    const vehicleId = await resolveDriverVehicleId(req);
    if (!vehicleId) return sendSuccess(res, { vehicle_id: null, eligible: false, schools: [] });
    return sendSuccess(res, await reg.listDriverRegistrations(pool, { vehicleId }));
  } catch (error) { return next(error); }
});

driverRouter.delete('/students/:id', async (req, res, next) => {
  try {
    const vehicleId = await resolveDriverVehicleId(req);
    if (!vehicleId) return sendError(res, 'ไม่พบรถที่ผูกกับบัญชีคนขับ', [{ code: 'NO_VEHICLE' }], 400);
    const out = await reg.deleteRosterStudent(pool, {
      rosterId: Number(req.params.id), driverUserId: req.user.id, vehicleId,
    });
    return sendSuccess(res, out, 'ลบรายการแล้ว');
  } catch (error) { return next(error); }
});

// ─── Documents (vehicle + driver evidence) ───────────────────────────────────

// POST /documents/vehicle — upload a vehicle doc for the driver's OWN active
// vehicle (server-trusted; never from the body).
driverRouter.post('/documents/vehicle', docUpload.single('file'), async (req, res, next) => {
  try {
    const checked = validateStoredDocument(req, res);
    if (!checked) return undefined; // response already sent + file unlinked
    const vehicleId = await resolveDriverVehicleId(req);
    if (!vehicleId) { fs.unlink(req.file.path, () => {}); return sendError(res, 'ไม่พบรถที่ผูกกับบัญชีคนขับ', [{ code: 'NO_VEHICLE' }], 400); }
    const out = await docSvc.addVehicleDocument(pool, {
      vehicleId, docType: req.body.doc_type, storageKey: req.file.filename,
      originalName: req.file.originalname, mimeType: req.file.mimetype,
      sha256: checked.sha256, fileSize: checked.size, expiryDate: req.body.expiry_date, uploadedBy: req.user.id,
    });
    return sendSuccess(res, out, 'อัปโหลดเอกสารรถแล้ว', null, 201);
  } catch (error) { if (req.file) fs.unlink(req.file.path, () => {}); return next(error); }
});

// POST /documents/driver — upload a driver doc for the driver themselves.
driverRouter.post('/documents/driver', docUpload.single('file'), async (req, res, next) => {
  try {
    const checked = validateStoredDocument(req, res);
    if (!checked) return undefined;
    const vehicleId = await resolveDriverVehicleId(req);
    const driverId = vehicleId ? await docSvc.driverIdForVehicle(pool, vehicleId) : null;
    if (!driverId) { fs.unlink(req.file.path, () => {}); return sendError(res, 'ไม่พบข้อมูลคนขับ', [{ code: 'NO_DRIVER' }], 400); }
    const out = await docSvc.addDriverDocument(pool, {
      driverId, docType: req.body.doc_type, storageKey: req.file.filename,
      originalName: req.file.originalname, mimeType: req.file.mimetype,
      sha256: checked.sha256, fileSize: checked.size, expiryDate: req.body.expiry_date, uploadedBy: req.user.id,
    });
    return sendSuccess(res, out, 'อัปโหลดเอกสารคนขับแล้ว', null, 201);
  } catch (error) { if (req.file) fs.unlink(req.file.path, () => {}); return next(error); }
});

// GET /documents — list own vehicle + driver docs.
driverRouter.get('/documents', async (req, res, next) => {
  try {
    const vehicleId = await resolveDriverVehicleId(req);
    if (!vehicleId) return sendSuccess(res, { vehicle_id: null, vehicle_documents: [], driver_documents: [] });
    const driverId = await docSvc.driverIdForVehicle(pool, vehicleId);
    return sendSuccess(res, {
      vehicle_id: vehicleId,
      vehicle_documents: await docSvc.listVehicleDocuments(pool, vehicleId),
      driver_documents: driverId ? await docSvc.listDriverDocuments(pool, driverId) : [],
    });
  } catch (error) { return next(error); }
});

// DELETE /documents/:kind/:id — soft-delete own doc.
driverRouter.delete('/documents/:kind/:id', async (req, res, next) => {
  try {
    const kind = req.params.kind === 'driver' ? 'driver' : 'vehicle';
    const out = await docSvc.softDeleteDocument(pool, { kind, id: Number(req.params.id), userId: req.user.id, isAdmin: false });
    return sendSuccess(res, out, 'ลบเอกสารแล้ว');
  } catch (error) { return next(error); }
});

// ─── School-facing — mounted at /api/school/registrations ────────────────────
const schoolRouter = express.Router();
schoolRouter.use(authenticate, requireRole('school', 'admin'));

// Grade-teacher (sub-role) accounts are blocked from this module entirely.
//
// They were read-only here: allowed to VIEW the roster and documents, blocked
// from match/approve/reject/review. But the thing on view is a driver's rider
// list for a whole bus, plus that application's school-wide rider totals — so a
// teacher pinned to ป.4 was reading every grade's names, which contradicts the
// rule that a teacher sees only their own grade (owner decision, 28 ส.ค. 2569).
//
// Filtering was the alternative and was rejected: the roster is reviewed as one
// document, a partial one cannot be judged, the aps.*_rider_count totals have no
// grade dimension to filter by at all, and a teacher can take no action here
// anyway. Blocking matches how /school/audit-logs already treats this account —
// and that page holds strictly less about the children than this one does.
//
// Enforced at the backend so the frontend `!isTeacher` gate is not the only line
// of defence (CLAUDE.md §12.9). admin has no gradeScope, full-school accounts
// have a falsy one — both pass.
function requireFullSchoolScope(req, res, next) {
  if (req.user.role === 'school' && req.user.gradeScope) {
    return sendError(res, 'บัญชีครูประจำสายชั้นดูได้อย่างเดียว ไม่มีสิทธิ์ดำเนินการนี้',
      [{ code: 'FULL_SCHOOL_SCOPE_REQUIRED' }], 403);
  }
  return next();
}

// Applied to the whole school-facing router rather than route by route: this
// module has no grade dimension anywhere, so there is no read here a grade
// teacher should reach, and a route added later inherits the guard instead of
// having to remember it.
schoolRouter.use(requireFullSchoolScope);

// ─── Documents (school reviews evidence for vehicles/drivers in its scope) ────
schoolRouter.get('/documents/vehicle/:vehicleId', async (req, res, next) => {
  try {
    const schoolId = schoolScope(req);
    if (!schoolId) return sendError(res, 'กรุณาระบุโรงเรียน', SCOPE_ERR, 400);
    const vehicleId = req.params.vehicleId;
    if (req.user.role !== 'admin' && !(await docSvc.schoolOwnsVehicle(pool, { schoolId, vehicleId }))) {
      return sendError(res, 'ไม่มีสิทธิ์เข้าถึงเอกสารของรถคันนี้', [{ code: 'OUT_OF_SCOPE' }], 403);
    }
    return sendSuccess(res, await docSvc.listVehicleDocuments(pool, vehicleId));
  } catch (error) { return next(error); }
});

schoolRouter.get('/documents/driver/:driverId', async (req, res, next) => {
  try {
    const schoolId = schoolScope(req);
    if (!schoolId) return sendError(res, 'กรุณาระบุโรงเรียน', SCOPE_ERR, 400);
    const driverId = Number(req.params.driverId);
    if (req.user.role !== 'admin' && !(await docSvc.schoolOwnsDriver(pool, { schoolId, driverId }))) {
      return sendError(res, 'ไม่มีสิทธิ์เข้าถึงเอกสารของคนขับรายนี้', [{ code: 'OUT_OF_SCOPE' }], 403);
    }
    return sendSuccess(res, await docSvc.listDriverDocuments(pool, driverId));
  } catch (error) { return next(error); }
});

schoolRouter.post('/documents/:kind/:id/review', requireFullSchoolScope, async (req, res, next) => {
  try {
    const schoolId = schoolScope(req);
    if (!schoolId) return sendError(res, 'กรุณาระบุโรงเรียน', SCOPE_ERR, 400);
    const kind = req.params.kind === 'driver' ? 'driver' : 'vehicle';
    const doc = await docSvc.getDocument(pool, { kind, id: Number(req.params.id) });
    if (!doc) return sendError(res, 'ไม่พบเอกสาร', [{ code: 'DOC_NOT_FOUND' }], 404);
    const inScope = req.user.role === 'admin' || (kind === 'driver'
      ? await docSvc.schoolOwnsDriver(pool, { schoolId, driverId: doc.owner_id })
      : await docSvc.schoolOwnsVehicle(pool, { schoolId, vehicleId: doc.owner_id }));
    if (!inScope) return sendError(res, 'ไม่มีสิทธิ์ตรวจเอกสารนี้', [{ code: 'OUT_OF_SCOPE' }], 403);
    return sendSuccess(res, await docSvc.reviewDocument(pool, {
      kind, id: Number(req.params.id),
      decision: req.body.decision, note: req.body.note, reviewerUserId: req.user.id,
    }), 'บันทึกผลการตรวจเอกสารแล้ว');
  } catch (error) { return next(error); }
});

schoolRouter.get('/', async (req, res, next) => {
  try {
    const schoolId = schoolScope(req);
    if (!schoolId) return sendError(res, 'กรุณาระบุโรงเรียน', SCOPE_ERR, 400);
    return sendSuccess(res, await reg.listSchoolRegistrations(pool, { schoolId, status: req.query.status || null }));
  } catch (error) { return next(error); }
});

schoolRouter.get('/:applicationId', async (req, res, next) => {
  try {
    const schoolId = schoolScope(req);
    if (!schoolId) return sendError(res, 'กรุณาระบุโรงเรียน', SCOPE_ERR, 400);
    return sendSuccess(res, await reg.getSchoolRegistrationDetail(pool, {
      applicationId: Number(req.params.applicationId), schoolId,
    }));
  } catch (error) { return next(error); }
});

schoolRouter.post('/:applicationId/students/:rosterId/match', requireFullSchoolScope, async (req, res, next) => {
  try {
    const schoolId = schoolScope(req);
    if (!schoolId) return sendError(res, 'กรุณาระบุโรงเรียน', SCOPE_ERR, 400);
    return sendSuccess(res, await reg.matchRosterStudent(pool, {
      applicationId: Number(req.params.applicationId),
      schoolId,
      rosterId: Number(req.params.rosterId),
      matchedStudentId: Number(req.body.matched_student_id),
      userId: req.user.id,
    }), 'จับคู่นักเรียนแล้ว');
  } catch (error) { return next(error); }
});

schoolRouter.patch('/:applicationId/students/:rosterId', requireFullSchoolScope, async (req, res, next) => {
  try {
    const schoolId = schoolScope(req);
    if (!schoolId) return sendError(res, 'กรุณาระบุโรงเรียน', SCOPE_ERR, 400);
    return sendSuccess(res, await reg.patchRosterStudent(pool, {
      applicationId: Number(req.params.applicationId),
      schoolId,
      rosterId: Number(req.params.rosterId),
      fields: req.body || {},
      userId: req.user.id,
    }), 'แก้ไขรายการแล้ว');
  } catch (error) { return next(error); }
});

schoolRouter.post('/:applicationId/approve', requireFullSchoolScope, async (req, res, next) => {
  try {
    const schoolId = schoolScope(req);
    if (!schoolId) return sendError(res, 'กรุณาระบุโรงเรียน', SCOPE_ERR, 400);
    return sendSuccess(res, await reg.approveRegistration(pool, {
      applicationId: Number(req.params.applicationId), schoolId, userId: req.user.id,
    }), 'อนุมัติคำขอแล้ว');
  } catch (error) { return next(error); }
});

schoolRouter.post('/:applicationId/reject', requireFullSchoolScope, async (req, res, next) => {
  try {
    const schoolId = schoolScope(req);
    if (!schoolId) return sendError(res, 'กรุณาระบุโรงเรียน', SCOPE_ERR, 400);
    return sendSuccess(res, await reg.rejectRegistration(pool, {
      applicationId: Number(req.params.applicationId), schoolId, userId: req.user.id, reason: req.body.reason,
    }), 'ส่งกลับให้แก้ไขแล้ว');
  } catch (error) { return next(error); }
});

module.exports = { driverRouter, schoolRouter };
