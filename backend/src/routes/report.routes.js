'use strict';

const express = require('express');
const router = express.Router();
const ExcelJS = require('exceljs');
const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/roleGuard');
const { sendSuccess } = require('../utils/response');
const reportSvc = require('../services/report.service');

// Reports accessible to school, affiliation, province, admin
router.use(authenticate, requireRole('school', 'affiliation', 'province', 'admin'));

/**
 * Extract common filter params from query string.
 */
function extractFilters(query) {
  return {
    date: query.date || undefined,
    month: query.month || undefined,
    school_id: query.school_id || undefined,
    affiliation_id: query.affiliation_id || undefined,
    vehicle_id: query.vehicle_id || undefined,
  };
}

// ─── JSON report endpoints ──────────────────────────────────────────────────

/**
 * GET /api/reports/daily
 */
router.get('/daily', async (req, res, next) => {
  try {
    const data = await reportSvc.getDailyReport(req.user, extractFilters(req.query));
    return sendSuccess(res, data);
  } catch (err) { next(err); }
});

/**
 * GET /api/reports/monthly
 */
router.get('/monthly', async (req, res, next) => {
  try {
    const data = await reportSvc.getMonthlyReport(req.user, extractFilters(req.query));
    return sendSuccess(res, data);
  } catch (err) { next(err); }
});

/**
 * GET /api/reports/summary
 */
router.get('/summary', async (req, res, next) => {
  try {
    const data = await reportSvc.getSummaryReport(req.user, extractFilters(req.query));
    return sendSuccess(res, data);
  } catch (err) { next(err); }
});

// ─── Export endpoints ───────────────────────────────────────────────────────

const CSV_HEADERS = [
  'รหัสนักเรียน', 'ชื่อ-นามสกุล', 'ระดับชั้น', 'ห้อง',
  'โรงเรียน', 'เขตพื้นที่', 'ทะเบียนรถ',
  'บริการเช้า', 'บริการเย็น',
  'สถานะเช้า', 'เวลาเช้า', 'สถานะเย็น', 'เวลาเย็น',
];

/**
 * GET /api/reports/export/csv
 */
router.get('/export/csv', async (req, res, next) => {
  try {
    const { date, rows } = await reportSvc.getExportRows(req.user, extractFilters(req.query));
    const filename = `report-${date}.csv`;

    const BOM = '\uFEFF';
    let csv = BOM + CSV_HEADERS.join(',') + '\n';
    for (const r of rows) {
      const line = [
        r.student_id,
        `"${r.student_name}"`,
        r.grade || '',
        r.classroom || '',
        `"${r.school_name}"`,
        `"${r.affiliation_name}"`,
        `"${r.plate_no}"`,
        r.morning_service,
        r.evening_service,
        r.morning_status,
        r.morning_time ? `"${r.morning_time}"` : '',
        r.evening_status,
        r.evening_time ? `"${r.evening_time}"` : '',
      ].join(',');
      csv += line + '\n';
    }

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return res.send(csv);
  } catch (err) { next(err); }
});

/**
 * GET /api/reports/export/excel
 */
router.get('/export/excel', async (req, res, next) => {
  try {
    const { date, rows } = await reportSvc.getExportRows(req.user, extractFilters(req.query));
    const filename = `report-${date}.xlsx`;

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'ระบบรถรับส่งนักเรียนจังหวัดลำปาง';
    const sheet = workbook.addWorksheet('รายงานประจำวัน');

    // Header row
    sheet.columns = CSV_HEADERS.map((h, i) => ({
      header: h,
      key: `col${i}`,
      width: i <= 1 ? 30 : i <= 6 ? 25 : 12,
    }));

    // Style header
    const headerRow = sheet.getRow(1);
    headerRow.font = { bold: true };
    headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4472C4' } };
    headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };

    // Data rows
    for (const r of rows) {
      sheet.addRow({
        col0: r.student_id,
        col1: r.student_name,
        col2: r.grade || '',
        col3: r.classroom || '',
        col4: r.school_name,
        col5: r.affiliation_name,
        col6: r.plate_no,
        col7: r.morning_service,
        col8: r.evening_service,
        col9: r.morning_status,
        col10: r.morning_time || '',
        col11: r.evening_status,
        col12: r.evening_time || '',
      });
    }

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    await workbook.xlsx.write(res);
    res.end();
  } catch (err) { next(err); }
});

/**
 * GET /api/reports/export/pdf
 * Simple PDF summary (not full student list — that would be huge).
 */
router.get('/export/pdf', async (req, res, next) => {
  try {
    const filters = extractFilters(req.query);
    const report = await reportSvc.getDailyReport(req.user, filters);
    const filename = `report-${report.date}.pdf`;

    // Lazy-require pdfkit so tests can still run without the font file
    const PDFDocument = require('pdfkit');
    const doc = new PDFDocument({ size: 'A4', margin: 50 });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    doc.pipe(res);

    // Try to load Thai font, fall back to Helvetica
    const env = require('../config/env');
    const fs = require('fs');
    let fontName = 'Helvetica';
    if (env.app.pdfFontPath && fs.existsSync(env.app.pdfFontPath)) {
      doc.registerFont('ThaiFont', env.app.pdfFontPath);
      fontName = 'ThaiFont';
    }

    doc.font(fontName).fontSize(18).text('Report - ' + report.date, { align: 'center' });
    doc.moveDown();

    doc.fontSize(12);
    doc.text(`Total Students: ${report.total_students}`);
    doc.text(`Total Vehicles: ${report.total_vehicles}`);
    doc.moveDown(0.5);
    doc.text(`Morning Done: ${report.morning_done} / ${report.morning_total}`);
    doc.text(`Morning Pending: ${report.morning_pending}`);
    doc.text(`Evening Done: ${report.evening_done} / ${report.evening_total}`);
    doc.text(`Evening Pending: ${report.evening_pending}`);
    doc.text(`Emergencies: ${report.emergency_count}`);

    // Per-school table
    if (report.schools && report.schools.length > 0) {
      doc.moveDown();
      doc.fontSize(14).text('Per-School Summary', { underline: true });
      doc.moveDown(0.5);
      doc.fontSize(10);

      for (const s of report.schools) {
        doc.text(
          `${s.school_name}: ${s.student_count} students, ` +
          `Morning ${s.morning_done}/${s.student_count}, ` +
          `Evening ${s.evening_done}/${s.student_count}`
        );
      }
    }

    // Per-vehicle table
    if (report.vehicles && report.vehicles.length > 0) {
      doc.moveDown();
      doc.fontSize(14).text('Per-Vehicle Summary', { underline: true });
      doc.moveDown(0.5);
      doc.fontSize(10);

      for (const v of report.vehicles) {
        doc.text(
          `${v.plate_no}: ${v.student_count} students, ` +
          `Morning ${v.morning_done}/${v.student_count}, ` +
          `Evening ${v.evening_done}/${v.student_count}`
        );
      }
    }

    doc.end();
  } catch (err) { next(err); }
});

module.exports = router;
