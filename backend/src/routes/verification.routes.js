'use strict';

const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/roleGuard');
const { sendSuccess, sendError } = require('../utils/response');
const { pool } = require('../config/database');
const verification = require('../services/vehicleVerification.service');
const driverShift = require('../services/driverShift.service');

router.use(authenticate);

function schoolIdFor(req) {
  if (req.user.role === 'admin') {
    return req.body.issuing_school_id || req.body.school_id || req.query.school_id || null;
  }
  return req.user.scopeId || null;
}

function requireFullSchoolScope(req, res, next) {
  if (req.user.role === 'school' && req.user.gradeScope) {
    return sendError(
      res,
      'บัญชีครูประจำสายชั้นไม่มีสิทธิ์สร้างหรือเปลี่ยนคำขอส่งตรวจรถ',
      [{ code: 'FULL_SCHOOL_SCOPE_REQUIRED' }],
      403
    );
  }
  return next();
}

router.post(
  '/school/applications',
  requireRole('school', 'admin'),
  requireFullSchoolScope,
  async (req, res, next) => {
    try {
      const schoolId = schoolIdFor(req);
      if (!schoolId) return sendError(res, 'กรุณาระบุโรงเรียน', [{ code: 'SCHOOL_SCOPE_REQUIRED' }], 400);
      const data = await verification.createApplication(pool, {
        vehicleId: req.body.vehicle_id,
        issuingSchoolId: schoolId,
        userId: req.user.id,
        currentTerm: req.body.current_term,
      });
      return sendSuccess(res, data, 'สร้างคำขอส่งตรวจรถเรียบร้อย', null, 201);
    } catch (error) { return next(error); }
  }
);

router.get('/school/applications', requireRole('school', 'admin'), async (req, res, next) => {
  try {
    const schoolId = schoolIdFor(req);
    if (!schoolId) return sendError(res, 'กรุณาระบุโรงเรียน', [{ code: 'SCHOOL_SCOPE_REQUIRED' }], 400);
    const data = await verification.listSchoolApplications(pool, {
      schoolId,
      status: req.query.status || null,
    });
    return sendSuccess(res, data);
  } catch (error) { return next(error); }
});

router.get(
  '/applications/:id',
  requireRole('school', 'transport', 'province', 'admin'),
  async (req, res, next) => {
    try {
      const data = await verification.getApplication(pool, {
        applicationId: Number(req.params.id),
        viewer: {
          role: req.user.role,
          schoolId: req.user.role === 'school' ? req.user.scopeId : null,
        },
      });
      return sendSuccess(res, data);
    } catch (error) { return next(error); }
  }
);

router.post(
  '/applications/:id/ready',
  requireRole('school', 'admin'),
  requireFullSchoolScope,
  async (req, res, next) => {
    try {
      const schoolId = schoolIdFor(req);
      if (!schoolId) return sendError(res, 'กรุณาระบุโรงเรียน', [{ code: 'SCHOOL_SCOPE_REQUIRED' }], 400);
      const data = await verification.markReadyToPrint(pool, {
        applicationId: Number(req.params.id), schoolId, userId: req.user.id,
      });
      return sendSuccess(res, data, 'คำขอพร้อมพิมพ์และนำรถเข้าตรวจ');
    } catch (error) { return next(error); }
  }
);

router.post(
  '/applications/:id/cancel',
  requireRole('school', 'admin'),
  requireFullSchoolScope,
  async (req, res, next) => {
    try {
      const schoolId = schoolIdFor(req);
      if (!schoolId) return sendError(res, 'กรุณาระบุโรงเรียน', [{ code: 'SCHOOL_SCOPE_REQUIRED' }], 400);
      const data = await verification.cancelApplication(pool, {
        applicationId: Number(req.params.id), schoolId, userId: req.user.id,
        reason: req.body.reason || null,
      });
      return sendSuccess(res, data, 'ยกเลิกคำขอแล้ว');
    } catch (error) { return next(error); }
  }
);

// ─── Role Inversion: School reviews driver-submitted application ────────────
router.post(
  '/applications/:id/review',
  requireRole('school', 'admin'),
  requireFullSchoolScope,
  async (req, res, next) => {
    try {
      const schoolId = schoolIdFor(req);
      if (!schoolId) return sendError(res, 'กรุณาระบุโรงเรียน', [{ code: 'SCHOOL_SCOPE_REQUIRED' }], 400);
      const data = await verification.reviewApplication(pool, {
        applicationId: Number(req.params.id),
        schoolId,
        userId: req.user.id,
        approved: req.body.approved !== false,
        notes: req.body.notes || null,
      });
      return sendSuccess(res, data, req.body.approved !== false ? 'ตรวจสอบถูกต้อง คำขอพร้อมดำเนินการต่อ' : 'ปฏิเสธคำขอแล้ว');
    } catch (error) { return next(error); }
  }
);

// ─── Timeline endpoint (all roles) ──────────────────────────────────────────
router.get(
  '/applications/:id/timeline',
  requireRole('school', 'transport', 'province', 'admin', 'driver'),
  async (req, res, next) => {
    try {
      const [rows] = await pool.query(
        `SELECT al.id, al.action, al.entity_type, al.old_value, al.new_value,
                al.created_at, u.display_name AS actor_name, u.role AS actor_role
           FROM audit_logs al
           JOIN users u ON u.id = al.user_id
          WHERE al.entity_type = 'vehicle_inspection_application'
            AND al.entity_id = ?
          ORDER BY al.created_at ASC`,
        [String(req.params.id)]
      );
      return sendSuccess(res, rows);
    } catch (error) { return next(error); }
  }
);

router.get('/transport/queue', requireRole('transport', 'admin'), async (req, res, next) => {
  try {
    const data = await verification.listTransportQueue(pool, {
      status: req.query.status || null,
      search: req.query.search || null,
    });
    return sendSuccess(res, data);
  } catch (error) { return next(error); }
});

router.get('/transport/drivers', requireRole('transport', 'admin'), async (req, res, next) => {
  try {
    return sendSuccess(res, await driverShift.listDrivers(pool, { search: req.query.search || null }));
  } catch (error) { return next(error); }
});

router.post(
  '/transport/vehicles/:id/drivers',
  requireRole('transport', 'admin'),
  async (req, res, next) => {
    try {
      const data = await driverShift.authorizeDriverForVehicle(pool, {
        driverId: Number(req.body.driver_id),
        vehicleId: req.params.id,
        assignmentRole: req.body.assignment_role || 'BACKUP',
        validFrom: req.body.valid_from || null,
        validUntil: req.body.valid_until || null,
        userId: req.user.id,
      });
      return sendSuccess(res, data, 'เพิ่มคนขับในกลุ่มรถแล้ว', null, 201);
    } catch (error) { return next(error); }
  }
);

router.post(
  '/transport/drivers/:id/qualification',
  requireRole('transport', 'admin'),
  async (req, res, next) => {
    try {
      const data = await driverShift.verifyDriverQualification(pool, {
        driverId: Number(req.params.id),
        licenseNo: req.body.license_no,
        licenseType: req.body.license_type || null,
        licenseExpiry: req.body.license_expiry,
        providerReference: req.body.provider_reference || null,
        providerType: req.body.provider_type || 'DLT_OFFICER',
        userId: req.user.id,
      });
      return sendSuccess(res, data, 'รับรองคุณสมบัติคนขับแล้ว', null, 201);
    } catch (error) { return next(error); }
  }
);

router.get('/transport/checklist', requireRole('transport', 'admin'), async (_req, res, next) => {
  try {
    return sendSuccess(res, await verification.listChecklistTemplates(pool));
  } catch (error) { return next(error); }
});

router.post(
  '/transport/applications/:id/start',
  requireRole('transport', 'admin'),
  async (req, res, next) => {
    try {
      const data = await verification.startInspection(pool, {
        applicationId: Number(req.params.id),
        inspectorUserId: req.user.id,
        inspectionDate: req.body.inspection_date,
        providerType: req.body.provider_type || 'DLT_OFFICER',
        providerReference: req.body.provider_reference || null,
      });
      return sendSuccess(res, data, 'เริ่มบันทึกการตรวจแล้ว', null, 201);
    } catch (error) { return next(error); }
  }
);

router.post(
  '/transport/attempts/:id/finalize',
  requireRole('transport', 'admin'),
  async (req, res, next) => {
    try {
      const data = await verification.finalizeInspection(pool, {
        attemptId: Number(req.params.id),
        inspectorUserId: req.user.id,
        result: req.body.result,
        inspectionDate: req.body.inspection_date || null,
        expiryDate: req.body.expiry_date || null,
        notes: req.body.notes || null,
        items: req.body.items,
        providerReference: req.body.provider_reference || null,
      });
      return sendSuccess(res, data, 'บันทึกผลตรวจเรียบร้อย');
    } catch (error) { return next(error); }
  }
);

module.exports = router;
