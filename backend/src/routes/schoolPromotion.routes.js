'use strict';

const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/roleGuard');
const { sendSuccess, sendError } = require('../utils/response');
const { pool } = require('../config/database');
const svc = require('../services/schoolPromotion.service');

// Yearly promotion is a school-wide action run by hand by the school admin:
// grade teachers (gradeScope) are refused; platform admin must name school_id.
router.use(authenticate, requireRole('school', 'admin'), (req, res, next) => {
  if (req.user.role === 'school' && req.user.gradeScope) {
    return sendError(res, 'บัญชีครูประจำสายชั้นไม่มีสิทธิ์ดำเนินการนี้', [], 403);
  }
  next();
});

function schoolIdOf(req, res) {
  const isAdmin = req.user.role === 'admin';
  const id = isAdmin ? (req.query.school_id || req.body?.school_id) : req.user.scopeId;
  if (!id) {
    sendError(res, isAdmin ? 'กรุณาระบุ school_id' : 'ไม่พบข้อมูลโรงเรียน', [], isAdmin ? 400 : 403);
    return null;
  }
  return String(id);
}

// Preview is read-only: it never writes to the database.
router.get('/preview', async (req, res, next) => {
  try {
    const schoolId = schoolIdOf(req, res);
    if (!schoolId) return undefined;
    return sendSuccess(res, await svc.previewPromotion(pool, { schoolId, academicYear: req.query.academic_year }));
  } catch (err) { return next(err); }
});

router.post('/apply', async (req, res, next) => {
  try {
    const schoolId = schoolIdOf(req, res);
    if (!schoolId) return undefined;
    const result = await svc.applyPromotion(pool, {
      schoolId, academicYear: req.body?.academic_year, excludedIds: req.body?.excluded_student_ids || [],
      actorId: req.user.id, ip: req.ip, userAgent: req.headers['user-agent'],
    });
    return sendSuccess(res, result, 'เลื่อนชั้นปีการศึกษาใหม่เรียบร้อยแล้ว');
  } catch (err) { return next(err); }
});

module.exports = router;
