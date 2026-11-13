'use strict';

/**
 * /api/certification — school transport certification (มพบ. 2564 "ล้อที่ 3",
 * migration 063, FEATURE_SCHOOL_CERTIFICATION). Every path answers 404 while
 * the flag is off, so mounting it unconditionally changes nothing.
 *
 * school (main account only — grade teachers 403): intake window, document
 *   checklist, issue/revoke certificates, inspection-day appointment requests.
 * driver: own vehicle's caretaker + certificates.
 * transport (admin too): see / confirm / complete inspection-day appointments.
 * Printing a certificate: school (own), driver (own vehicle), transport, admin.
 * Business rules + scope checks live in services/schoolCertification.service.js.
 */

const fs = require('fs');
const express = require('express');
const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/roleGuard');
const { sendSuccess, sendError } = require('../utils/response');
const { readIdParam } = require('../utils/pathParams');
const { auditExportBeforeSend } = require('../utils/exportAudit');
const { pool } = require('../config/database');
const env = require('../config/env');
const svc = require('../services/schoolCertification.service');
const checkinSvc = require('../services/checkin.service');

const router = express.Router();

function requireFeature(_req, res, next) {
  if (!svc.enabled()) {
    return res.status(404).json({ success: false, message: 'Not found', errors: [], data: null });
  }
  return next();
}

function requireFullSchoolScope(req, res, next) {
  if (req.user.role === 'school' && (req.user.gradeScope || req.user.grade_scope)) {
    return sendError(res, 'งานรับรองรถใช้บัญชีหลักของโรงเรียน',
      [{ code: 'FULL_SCHOOL_SCOPE_REQUIRED' }], 403);
  }
  return next();
}

router.use(requireFeature, authenticate, requireFullSchoolScope);

function schoolScope(req, res) {
  const schoolId = req.user.scopeId || null;
  if (!schoolId) {
    sendError(res, 'ไม่พบขอบเขตโรงเรียน', [{ code: 'SCHOOL_SCOPE_REQUIRED' }], 403);
    return null;
  }
  return schoolId;
}

async function driverVehicleId(req) {
  try {
    const v = await checkinSvc.getDriverVehicle(pool, req.user);
    return v ? v.vehicle_id : null;
  } catch { return null; }
}

// ─── School ─────────────────────────────────────────────────────────────────
const school = requireRole('school');

router.get('/school/window', school, async (req, res, next) => {
  try {
    const schoolId = schoolScope(req, res); if (!schoolId) return undefined;
    return sendSuccess(res, await svc.getWindowSummary(pool, schoolId));
  } catch (e) { return next(e); }
});

router.put('/school/window', school, async (req, res, next) => {
  try {
    const schoolId = schoolScope(req, res); if (!schoolId) return undefined;
    const data = await svc.setWindow(pool, {
      schoolId, userId: req.user.id,
      opensOn: req.body.opens_on || null,
      closesOn: req.body.closes_on || null,
      criteriaNote: req.body.criteria_note ?? null,
      requireCompulsoryInsurance: req.body.require_compulsory_insurance === true,
    });
    return sendSuccess(res, data, 'บันทึกช่วงเวลารับเอกสารแล้ว');
  } catch (e) { return next(e); }
});

router.get('/school/applications/:id/checklist', school, async (req, res, next) => {
  try {
    const schoolId = schoolScope(req, res); if (!schoolId) return undefined;
    const applicationId = readIdParam(req, res, 'id'); if (applicationId === null) return undefined;
    return sendSuccess(res, await svc.getDocumentChecklist(pool, { applicationId, schoolId }));
  } catch (e) { return next(e); }
});

router.post('/school/applications/:id/certificate', school, async (req, res, next) => {
  try {
    const schoolId = schoolScope(req, res); if (!schoolId) return undefined;
    const applicationId = readIdParam(req, res, 'id'); if (applicationId === null) return undefined;
    const data = await svc.issueCertificate(pool, { applicationId, schoolId, userId: req.user.id });
    return sendSuccess(res, data, data.created ? 'ออกหนังสือรับรองแล้ว' : 'มีหนังสือรับรองที่ยังมีผลอยู่แล้ว', null,
      data.created ? 201 : 200);
  } catch (e) { return next(e); }
});

router.get('/school/certificates', school, async (req, res, next) => {
  try {
    const schoolId = schoolScope(req, res); if (!schoolId) return undefined;
    return sendSuccess(res, await svc.listSchoolCertificates(pool, { schoolId }));
  } catch (e) { return next(e); }
});

router.post('/school/certificates/:id/revoke', school, async (req, res, next) => {
  try {
    const schoolId = schoolScope(req, res); if (!schoolId) return undefined;
    const certificateId = readIdParam(req, res, 'id'); if (certificateId === null) return undefined;
    const data = await svc.revokeCertificate(pool, {
      certificateId, schoolId, userId: req.user.id, reason: req.body.reason,
    });
    return sendSuccess(res, data, 'เพิกถอนหนังสือรับรองแล้ว');
  } catch (e) { return next(e); }
});

router.get('/school/appointments', school, async (req, res, next) => {
  try {
    const schoolId = schoolScope(req, res); if (!schoolId) return undefined;
    return sendSuccess(res, await svc.listAppointments(pool, { schoolId }));
  } catch (e) { return next(e); }
});

router.post('/school/appointments', school, async (req, res, next) => {
  try {
    const schoolId = schoolScope(req, res); if (!schoolId) return undefined;
    const data = await svc.createAppointment(pool, {
      schoolId, userId: req.user.id,
      proposedDate: req.body.proposed_date,
      note: req.body.note || null,
      applicationIds: req.body.application_ids,
    });
    return sendSuccess(res, data, 'ส่งคำขอนัดตรวจรถที่โรงเรียนแล้ว', null, 201);
  } catch (e) { return next(e); }
});

router.post('/school/appointments/:id/cancel', school, async (req, res, next) => {
  try {
    const schoolId = schoolScope(req, res); if (!schoolId) return undefined;
    const appointmentId = readIdParam(req, res, 'id'); if (appointmentId === null) return undefined;
    return sendSuccess(res, await svc.cancelAppointment(pool, { appointmentId, schoolId, userId: req.user.id }),
      'ยกเลิกการนัดแล้ว');
  } catch (e) { return next(e); }
});

// ─── Driver ─────────────────────────────────────────────────────────────────
router.get('/driver/overview', requireRole('driver'), async (req, res, next) => {
  try {
    const vehicleId = await driverVehicleId(req);
    if (!vehicleId) return sendSuccess(res, { vehicle_id: null, caretaker: null, certificates: [] });
    return sendSuccess(res, {
      vehicle_id: vehicleId,
      caretaker: await svc.getCaretaker(pool, vehicleId),
      certificates: await svc.listVehicleCertificates(pool, { vehicleId }),
    });
  } catch (e) { return next(e); }
});

router.put('/driver/caretaker', requireRole('driver'), async (req, res, next) => {
  try {
    const vehicleId = await driverVehicleId(req);
    if (!vehicleId) return sendError(res, 'ไม่พบรถที่ผูกกับบัญชีคนขับ', [{ code: 'NO_VEHICLE' }], 400);
    const data = await svc.setCaretaker(pool, {
      vehicleId, userId: req.user.id, name: req.body.name, phone: req.body.phone,
    });
    return sendSuccess(res, data, 'บันทึกผู้ดูแลนักเรียนแล้ว');
  } catch (e) { return next(e); }
});

// ─── Transport ──────────────────────────────────────────────────────────────
const transport = requireRole('transport', 'admin');

router.get('/transport/appointments', transport, async (req, res, next) => {
  try {
    const status = ['REQUESTED', 'CONFIRMED', 'DONE', 'CANCELLED'].includes(req.query.status) ? req.query.status : null;
    return sendSuccess(res, await svc.listAppointments(pool, { status }));
  } catch (e) { return next(e); }
});

router.post('/transport/appointments/:id/confirm', transport, async (req, res, next) => {
  try {
    const appointmentId = readIdParam(req, res, 'id'); if (appointmentId === null) return undefined;
    const data = await svc.confirmAppointment(pool, {
      appointmentId, userId: req.user.id, confirmedDate: req.body.confirmed_date,
    });
    return sendSuccess(res, data, 'ยืนยันวันตรวจแล้ว');
  } catch (e) { return next(e); }
});

router.post('/transport/appointments/:id/done', transport, async (req, res, next) => {
  try {
    const appointmentId = readIdParam(req, res, 'id'); if (appointmentId === null) return undefined;
    return sendSuccess(res, await svc.markAppointmentDone(pool, { appointmentId, userId: req.user.id }),
      'บันทึกว่าตรวจเสร็จแล้ว');
  } catch (e) { return next(e); }
});

// ─── Certificate PDF ────────────────────────────────────────────────────────
function thaiDate(iso) {
  if (!iso) return '-';
  const d = new Date(`${String(iso).slice(0, 10)}T00:00:00+07:00`);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleDateString('th-TH', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'Asia/Bangkok' });
}

function renderCertificatePdf(doc, c) {
  let fontName = 'Helvetica';
  let fontBold = 'Helvetica-Bold';
  const fontPath = env.export.pdfFontPath;
  const boldPath = fontPath ? fontPath.replace('-Regular', '-Bold') : null;
  if (fontPath && fs.existsSync(fontPath)) {
    doc.registerFont('Thai', fontPath);
    fontName = 'Thai'; fontBold = 'Thai';
    if (boldPath && boldPath !== fontPath && fs.existsSync(boldPath)) {
      doc.registerFont('ThaiBold', boldPath);
      fontBold = 'ThaiBold';
    }
  }
  const snap = c.snapshot || {};
  doc.font(fontBold).fontSize(20).text('หนังสือรับรองการรับส่งนักเรียน', { align: 'center' });
  doc.font(fontName).fontSize(14).text(c.school_name || snap.school_name || '', { align: 'center' });
  doc.moveDown(0.3);
  doc.fontSize(13).text(`เลขที่ ${c.cert_no}`, { align: 'right' });
  doc.text(`ออกให้ ณ วันที่ ${thaiDate(c.issued_at ? new Date(c.issued_at).toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' }) : null)}`, { align: 'right' });
  doc.moveDown(1);
  doc.fontSize(15).text(
    `${c.school_name || snap.school_name || 'โรงเรียน'} รับรองว่ารถตามรายละเอียดด้านล่าง ได้ยื่นเอกสารประกอบ`
    + 'และได้รับความเห็นชอบจากโรงเรียนให้ใช้รับส่งนักเรียน เพื่อนำไปยื่นขอรับการตรวจสภาพและอนุญาต'
    + 'ต่อนายทะเบียนสำนักงานขนส่งจังหวัด',
    { align: 'left', lineGap: 4 }
  );
  doc.moveDown(0.8);
  const rows = [
    ['ทะเบียนรถ', c.plate_no || snap.plate_no || '-'],
    ['ประเภทรถ', c.vehicle_type || snap.vehicle_type || '-'],
    ['ชื่อผู้ขับรถ', c.driver_name || snap.driver_name || '-'],
    ['จำนวนนักเรียนที่รับส่ง', `${Number(snap.pupil_count) || 0} คน`],
    ['ผู้ดูแลนักเรียนประจำรถ', snap.caretaker_name
      ? `${snap.caretaker_name}${snap.caretaker_phone ? ` (โทร ${snap.caretaker_phone})` : ''}` : '-'],
    ['ภาคเรียน', c.term_id || '-'],
    ['มีผลถึงวันที่', thaiDate(c.valid_until)],
    ['เลขที่คำขอ', c.request_no || '-'],
  ];
  for (const [k, v] of rows) {
    doc.font(fontBold).fontSize(14).text(`${k}: `, { continued: true }).font(fontName).text(String(v));
  }
  if (c.revoked_at) {
    doc.moveDown(0.6);
    doc.font(fontBold).fontSize(16).fillColor('#b91c1c')
      .text(`เพิกถอนแล้ว — ${c.revoke_reason || ''}`).fillColor('#000000');
  }
  doc.moveDown(3);
  doc.font(fontName).fontSize(14);
  doc.text('ลงชื่อ ........................................................', { align: 'right' });
  doc.text('(........................................................)', { align: 'right' });
  doc.text(`ผู้อำนวยการ${c.school_name || 'โรงเรียน'}`, { align: 'right' });
  doc.moveDown(2);
  doc.fontSize(11).fillColor('#555555').text(
    'ตามแนวทาง "ล้อที่ 3 ระบบการรับรองรถโรงเรียน" คู่มือการจัดระบบรถโรงเรียนให้ปลอดภัยและเป็นธรรม (มพบ. 2564) '
    + '— หนังสือนี้ไม่ใช่ใบอนุญาตจากกรมการขนส่งทางบก',
    { align: 'left' }
  ).fillColor('#000000');
}

router.get('/certificates/:id/pdf', requireRole('school', 'driver', 'transport', 'admin'), async (req, res, next) => {
  try {
    const certificateId = readIdParam(req, res, 'id'); if (certificateId === null) return undefined;
    const viewer = {
      role: req.user.role, userId: req.user.id,
      schoolId: req.user.scopeId || null, gradeScope: req.user.gradeScope || null,
    };
    const c = await svc.getCertificateForViewer(pool, {
      certificateId, viewer,
      driverVehicleId: req.user.role === 'driver' ? await driverVehicleId(req) : null,
    });
    if (!await auditExportBeforeSend(req, res, {
      entityType: 'school_transport_certificate', entityId: certificateId,
      metadata: { format: 'pdf', cert_no: c.cert_no, role: req.user.role },
    })) return undefined;
    const PDFDocument = require('pdfkit');
    const doc = new PDFDocument({ size: 'A4', margin: 56 });
    const safe = String(c.cert_no).replace(/[^A-Za-z0-9-]+/g, '_');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="certificate-${safe}.pdf"`);
    res.setHeader('Cache-Control', 'private, no-store');
    doc.pipe(res);
    renderCertificatePdf(doc, c);
    doc.end();
    return undefined;
  } catch (e) { return next(e); }
});

module.exports = router;
module.exports.renderCertificatePdf = renderCertificatePdf;
