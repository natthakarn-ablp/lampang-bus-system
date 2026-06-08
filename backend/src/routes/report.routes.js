'use strict';

const express = require('express');
const router = express.Router();
const ExcelJS = require('exceljs');
const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/roleGuard');
const { sendSuccess, sendError } = require('../utils/response');
const reportSvc = require('../services/report.service');
const { logAudit } = require('../utils/audit');
const { csvCell, neutralizeSpreadsheetCell } = require('../utils/exportSecurity');

// Reports accessible to school, affiliation, province, admin
router.use(authenticate, requireRole('school', 'affiliation', 'province', 'admin'));

const DATE_RE  = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_RE = /^\d{4}-\d{2}$/;

/**
 * Extract and validate common filter params from query string.
 */
function extractFilters(query) {
  const filters = {};
  if (query.date) {
    if (!DATE_RE.test(query.date)) return { _error: 'date ต้องเป็นรูปแบบ YYYY-MM-DD' };
    filters.date = query.date;
  }
  if (query.month) {
    if (!MONTH_RE.test(query.month)) return { _error: 'month ต้องเป็นรูปแบบ YYYY-MM' };
    filters.month = query.month;
  }
  if (query.school_id)      filters.school_id = query.school_id;
  if (query.affiliation_id) filters.affiliation_id = query.affiliation_id;
  if (query.vehicle_id)     filters.vehicle_id = query.vehicle_id;
  return filters;
}

/**
 * Middleware: parse and validate filters, attach to req.filters.
 */
router.use((req, res, next) => {
  const filters = extractFilters(req.query);
  if (filters._error) return sendError(res, filters._error, [], 400);
  req.filters = filters;
  next();
});

// ─── JSON report endpoints ──────────────────────────────────────────────────

/**
 * GET /api/reports/daily
 */
router.get('/daily', async (req, res, next) => {
  try {
    const data = await reportSvc.getDailyReport(req.user, req.filters);
    return sendSuccess(res, data);
  } catch (err) { next(err); }
});

/**
 * GET /api/reports/monthly
 */
router.get('/monthly', async (req, res, next) => {
  try {
    const data = await reportSvc.getMonthlyReport(req.user, req.filters);
    return sendSuccess(res, data);
  } catch (err) { next(err); }
});

/**
 * GET /api/reports/summary
 */
router.get('/summary', async (req, res, next) => {
  try {
    const data = await reportSvc.getSummaryReport(req.user, req.filters);
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
    const { date, rows } = await reportSvc.getExportRows(req.user, req.filters);
    const filename = `report-${date}.csv`;

    const BOM = '\uFEFF';
    let csv = BOM + CSV_HEADERS.join(',') + '\n';
    for (const r of rows) {
      // Phase 10.12G — every cell neutralised against CSV formula injection.
      const line = [
        csvCell(r.student_id),
        csvCell(r.student_name),
        csvCell(r.grade || ''),
        csvCell(r.classroom || ''),
        csvCell(r.school_name),
        csvCell(r.affiliation_name),
        csvCell(r.plate_no),
        csvCell(r.morning_service),
        csvCell(r.evening_service),
        csvCell(r.morning_status),
        csvCell(r.morning_time || ''),
        csvCell(r.evening_status),
        csvCell(r.evening_time || ''),
      ].join(',');
      csv += line + '\n';
    }

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    logAudit({ userId: req.user.id, action: 'EXPORT', entityType: 'report_csv', entityId: date,
      newValue: { format: 'csv', role: req.user.role, scope: req.user.scopeId },
      ipAddress: req.ip, userAgent: req.headers['user-agent'] }).catch(() => {});
    return res.send(csv);
  } catch (err) { next(err); }
});

/**
 * GET /api/reports/export/excel
 */
router.get('/export/excel', async (req, res, next) => {
  try {
    const { date, rows } = await reportSvc.getExportRows(req.user, req.filters);
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
      // Phase 10.12G — neutralise user-sourced text cells (defense-in-depth).
      sheet.addRow({
        col0: r.student_id,
        col1: neutralizeSpreadsheetCell(r.student_name),
        col2: neutralizeSpreadsheetCell(r.grade || ''),
        col3: neutralizeSpreadsheetCell(r.classroom || ''),
        col4: neutralizeSpreadsheetCell(r.school_name),
        col5: neutralizeSpreadsheetCell(r.affiliation_name),
        col6: neutralizeSpreadsheetCell(r.plate_no),
        col7: r.morning_service,
        col8: r.evening_service,
        col9: r.morning_status,
        col10: neutralizeSpreadsheetCell(r.morning_time || ''),
        col11: r.evening_status,
        col12: neutralizeSpreadsheetCell(r.evening_time || ''),
      });
    }

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    logAudit({ userId: req.user.id, action: 'EXPORT', entityType: 'report_excel', entityId: date,
      newValue: { format: 'excel', role: req.user.role, scope: req.user.scopeId },
      ipAddress: req.ip, userAgent: req.headers['user-agent'] }).catch(() => {});
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
    const report = await reportSvc.getDailyReport(req.user, req.filters);
    const thaiDate = new Date(report.date).toLocaleDateString('th-TH', {
      year: 'numeric', month: 'long', day: 'numeric', timeZone: 'Asia/Bangkok',
    });
    const filename = `report-${report.date}.pdf`;

    const PDFDocument = require('pdfkit');
    const doc = new PDFDocument({ size: 'A4', margin: 40 });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    doc.pipe(res);

    // Load Thai font
    const env = require('../config/env');
    const fs = require('fs');
    const path = require('path');
    let fontName = 'Helvetica';
    let fontBold = 'Helvetica-Bold';
    const fontPath = env.export.pdfFontPath;
    const boldPath = fontPath ? fontPath.replace('-Regular', '-Bold') : null;
    if (fontPath && fs.existsSync(fontPath)) {
      doc.registerFont('Thai', fontPath);
      fontName = 'Thai';
      fontBold = 'Thai';
      if (boldPath && fs.existsSync(boldPath)) {
        doc.registerFont('ThaiBold', boldPath);
        fontBold = 'ThaiBold';
      }
    }

    const pageW = doc.page.width - 80;

    // ── Header ──
    doc.font(fontBold).fontSize(16).text('รายงานสถานะรับ-ส่งนักเรียน', { align: 'center' });
    doc.font(fontName).fontSize(11).text(`ระบบรถรับส่งนักเรียนจังหวัดลำปาง`, { align: 'center' });
    doc.fontSize(11).text(`วันที่ ${thaiDate}`, { align: 'center' });
    doc.moveDown(1.2);

    // ── Summary box ──
    doc.font(fontBold).fontSize(13).text('สรุปภาพรวม');
    doc.moveDown(0.3);
    doc.font(fontName).fontSize(11);

    const sumData = [
      ['นักเรียนทั้งหมด', `${report.total_students} คน`],
      ['รถรับส่งทั้งหมด', `${report.total_vehicles} คัน`],
      ['ส่งเช้าแล้ว', `${report.morning_done} / ${report.morning_total} คน`],
      ['รอส่งเช้า', `${report.morning_pending} คน`],
      ['รับเย็นแล้ว', `${report.evening_done} / ${report.evening_total} คน`],
      ['รอรับเย็น', `${report.evening_pending} คน`],
      ['เหตุฉุกเฉิน', `${report.emergency_count} รายการ`],
    ];

    for (const [label, value] of sumData) {
      const y = doc.y;
      doc.font(fontName).text(label, 60, y, { width: 180 });
      doc.font(fontBold).text(value, 240, y, { width: 200 });
      doc.y = y + 18;
    }
    doc.moveDown(0.8);

    // ── Per-school ──
    if (report.schools && report.schools.length > 0) {
      doc.font(fontBold).fontSize(13).text('สรุปรายโรงเรียน');
      doc.moveDown(0.3);

      // Table header
      const cols = [{ l: 'โรงเรียน', w: 200 }, { l: 'นักเรียน', w: 60 }, { l: 'ส่งเช้า', w: 60 }, { l: 'รับเย็น', w: 60 }, { l: 'รอเช้า', w: 55 }, { l: 'รอเย็น', w: 55 }];
      let tx = 45;
      const hy = doc.y;
      doc.rect(40, hy - 2, pageW, 18).fill('#2563eb');
      doc.fill('#ffffff').font(fontBold).fontSize(9);
      for (const c of cols) { doc.text(c.l, tx, hy + 2, { width: c.w, align: 'center' }); tx += c.w; }
      doc.y = hy + 20;
      doc.fill('#000000');

      doc.font(fontName).fontSize(9);
      let alt = false;
      for (const s of report.schools) {
        const ry = doc.y;
        if (ry > 750) { doc.addPage(); }
        const rowY = doc.y;
        if (alt) doc.rect(40, rowY - 1, pageW, 16).fill('#f3f4f6').fill('#000000');
        alt = !alt;
        tx = 45;
        const vals = [
          { v: s.school_name || '-', a: 'left' },
          { v: `${s.student_count}`, a: 'center' },
          { v: `${s.morning_done}`, a: 'center' },
          { v: `${s.evening_done}`, a: 'center' },
          { v: `${(s.student_count || 0) - (s.morning_done || 0)}`, a: 'center' },
          { v: `${(s.student_count || 0) - (s.evening_done || 0)}`, a: 'center' },
        ];
        for (let i = 0; i < cols.length; i++) {
          doc.text(vals[i].v, tx, rowY + 1, { width: cols[i].w, align: vals[i].a });
          tx += cols[i].w;
        }
        doc.y = rowY + 17;
      }
      doc.moveDown(0.8);
    }

    // ── Per-vehicle ──
    if (report.vehicles && report.vehicles.length > 0) {
      if (doc.y > 650) doc.addPage();
      doc.font(fontBold).fontSize(13).text('สรุปรายคัน');
      doc.moveDown(0.3);

      const cols2 = [{ l: 'ทะเบียนรถ', w: 160 }, { l: 'นักเรียน', w: 60 }, { l: 'ส่งเช้า', w: 65 }, { l: 'รับเย็น', w: 65 }, { l: 'รอเช้า', w: 65 }, { l: 'รอเย็น', w: 65 }];
      let tx2 = 45;
      const hy2 = doc.y;
      doc.rect(40, hy2 - 2, pageW, 18).fill('#2563eb');
      doc.fill('#ffffff').font(fontBold).fontSize(9);
      for (const c of cols2) { doc.text(c.l, tx2, hy2 + 2, { width: c.w, align: 'center' }); tx2 += c.w; }
      doc.y = hy2 + 20;
      doc.fill('#000000');

      doc.font(fontName).fontSize(9);
      let alt2 = false;
      for (const v of report.vehicles) {
        if (doc.y > 750) doc.addPage();
        const rowY = doc.y;
        if (alt2) doc.rect(40, rowY - 1, pageW, 16).fill('#f3f4f6').fill('#000000');
        alt2 = !alt2;
        tx2 = 45;
        const vals = [
          { v: v.plate_no || '-', a: 'left' },
          { v: `${v.student_count}`, a: 'center' },
          { v: `${v.morning_done}`, a: 'center' },
          { v: `${v.evening_done}`, a: 'center' },
          { v: `${(v.student_count || 0) - (v.morning_done || 0)}`, a: 'center' },
          { v: `${(v.student_count || 0) - (v.evening_done || 0)}`, a: 'center' },
        ];
        for (let i = 0; i < cols2.length; i++) {
          doc.text(vals[i].v, tx2, rowY + 1, { width: cols2[i].w, align: vals[i].a });
          tx2 += cols2[i].w;
        }
        doc.y = rowY + 17;
      }
    }

    // ── Footer ──
    doc.moveDown(1);
    doc.font(fontName).fontSize(8).fillColor('#999999')
      .text(`พิมพ์จากระบบรถรับส่งนักเรียนจังหวัดลำปาง — ${new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' })}`, { align: 'center' });

    logAudit({ userId: req.user.id, action: 'EXPORT', entityType: 'report_pdf', entityId: report.date,
      newValue: { format: 'pdf', role: req.user.role, scope: req.user.scopeId },
      ipAddress: req.ip, userAgent: req.headers['user-agent'] }).catch(() => {});
    doc.end();
  } catch (err) { next(err); }
});

// ─── POST /decision-log — Log province decision before export ────────────────
router.post('/decision-log', async (req, res, next) => {
  try {
    const { decision_type, decision_note, report_type, report_date } = req.body;

    await logAudit({
      userId: req.user.id,
      action: 'CREATE',
      entityType: 'decision_log',
      entityId: `${report_type || 'report'}_${report_date || 'unknown'}`,
      newValue: { decision_type, decision_note, report_type, report_date, role: req.user.role },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return sendSuccess(res, { logged: true }, 'บันทึกการตัดสินใจสำเร็จ', null, 201);
  } catch (err) { next(err); }
});

module.exports = router;
