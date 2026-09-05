'use strict';

const express = require('express');
const router = express.Router();
const ExcelJS = require('exceljs');
const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/roleGuard');
const { sendSuccess, sendError } = require('../utils/response');
const reportSvc = require('../services/report.service');
const { logAudit } = require('../utils/audit');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');
const { csvCell, neutralizeSpreadsheetCell } = require('../utils/exportSecurity');
const { abbreviateGrade } = require('../utils/gradeDisplay');
const { DECISION_LOG_ROLES, validateDecisionLog } = require('../utils/decisionLog');

// Reports accessible to school, affiliation, province, admin
router.use(authenticate, requireRole('school', 'affiliation', 'province', 'admin'));

// Moved to utils/calendarDate.js so admin, affiliation and province stop
// carrying a weaker shape-only copy of the same idea. Behaviour here is
// unchanged — this was the implementation the others are now adopting.
const { isCalendarDate: isValidDate, isCalendarMonth: isValidMonth } = require('../utils/calendarDate');

/**
 * Extract and validate common filter params from query string.
 */
function extractFilters(query) {
  const filters = {};
  if (query.date) {
    if (!isValidDate(query.date)) return { _error: 'date ต้องเป็นวันที่จริงรูปแบบ YYYY-MM-DD' };
    filters.date = query.date;
  }
  if (query.month) {
    if (!isValidMonth(query.month)) return { _error: 'month ต้องเป็นเดือนจริงรูปแบบ YYYY-MM' };
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

/**
 * GET /api/reports/policy — province-wide policy report (province/admin only;
 * enforced in the service). Totals + today's completion + per-affiliation rows.
 */
router.get('/policy', async (req, res, next) => {
  try {
    const data = await reportSvc.getPolicyReport(req.user, req.filters);
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

const MONTHLY_HEADERS = [
  'ส่วน', 'รายการ', 'นักเรียน',
  'ส่งเช้าแล้ว', 'ส่งเช้าคาดหวัง', 'KPI เช้า',
  'รับเย็นแล้ว', 'รับเย็นคาดหวัง', 'KPI เย็น',
  'วันที่มีข้อมูล', 'วันส่งเช้าครบ 100%', 'วันรับเย็นครบ 100%',
];

function toNumber(value) {
  return Number(value || 0);
}

function percentCell(value) {
  return `${toNumber(value).toFixed(2)}%`;
}

function monthlyExpected(perDay, days) {
  return toNumber(perDay) * toNumber(days);
}

function buildMonthlyExportRows(report) {
  const rows = [
    {
      section: 'ภาพรวม',
      name: report.month,
      student_count: report.total_students,
      morning_done: report.total_morning_done,
      morning_expected: report.total_morning_expected,
      morning_kpi: report.morning_kpi,
      evening_done: report.total_evening_done,
      evening_expected: report.total_evening_expected,
      evening_kpi: report.evening_kpi,
      days_with_data: report.days_with_data,
      days_morning_100: report.days_morning_100,
      days_evening_100: report.days_evening_100,
    },
  ];

  for (const s of report.schools || []) {
    rows.push({
      section: 'โรงเรียน',
      name: s.school_name,
      student_count: s.student_count,
      morning_done: s.total_morning_done,
      morning_expected: monthlyExpected(s.morning_expected, s.days_with_data),
      morning_kpi: s.morning_kpi,
      evening_done: s.total_evening_done,
      evening_expected: monthlyExpected(s.evening_expected, s.days_with_data),
      evening_kpi: s.evening_kpi,
      days_with_data: s.days_with_data,
      days_morning_100: s.days_morning_100,
      days_evening_100: s.days_evening_100,
    });
  }

  for (const v of report.vehicles || []) {
    rows.push({
      section: 'รถรับส่ง',
      name: v.plate_no || '-',
      student_count: v.student_count,
      morning_done: v.total_morning_done,
      morning_expected: monthlyExpected(v.student_count, v.days_with_data),
      morning_kpi: v.morning_kpi,
      evening_done: v.total_evening_done,
      evening_expected: monthlyExpected(v.student_count, v.days_with_data),
      evening_kpi: v.evening_kpi,
      days_with_data: v.days_with_data,
      days_morning_100: '',
      days_evening_100: '',
    });
  }

  return rows;
}

function monthlyRowValues(row) {
  return [
    row.section,
    row.name,
    row.student_count,
    row.morning_done,
    row.morning_expected,
    percentCell(row.morning_kpi),
    row.evening_done,
    row.evening_expected,
    percentCell(row.evening_kpi),
    row.days_with_data,
    row.days_morning_100,
    row.days_evening_100,
  ];
}

/**
 * GET /api/reports/export/csv
 */
/** One CSV line per row, in the column order of CSV_HEADERS. */
function csvLine(r) {
  // Phase 10.12G — every cell neutralised against CSV formula injection.
  return [
    csvCell(r.student_id),
    csvCell(r.student_name),
    csvCell(abbreviateGrade(r.grade)),
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
  ].join(',') + '\n';
}

/**
 * A failure after the first byte is on the wire cannot be answered with a JSON
 * error — the client is already receiving a file. Destroying the response
 * aborts the chunked body, which browsers and curl report as a failed download.
 * The alternative is worse: a 200 and a file that looks complete and is not.
 */
function abortStreamedExport(res, err, next) {
  if (res.headersSent) {
    // eslint-disable-next-line no-console
    console.error('[export] failed after headers were sent:', err && err.message);
    res.destroy(err);
    return;
  }
  next(err);
}

router.get('/export/csv', async (req, res, next) => {
  try {
    // Resolved before any header goes out, so a bad filter still answers JSON.
    const { date } = reportSvc.exportRowsQuery(req.user, req.filters);
    const filename = `report-${date}.csv`;

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    logAudit({ userId: req.user.id, action: 'EXPORT', entityType: 'report_csv', entityId: date,
      newValue: { format: 'csv', role: req.user.role, scope: req.user.scopeId },
      ipAddress: req.ip, userAgent: req.headers['user-agent'] }).catch(() => {});

    async function* body() {
      yield '\uFEFF' + CSV_HEADERS.join(',') + '\n';
      for await (const r of reportSvc.streamExportRows(req.user, req.filters)) {
        yield csvLine(r);
      }
    }

    // pipeline handles backpressure and, on failure, destroys both ends — which
    // is what closes the connection rather than sending a truncated file.
    await pipeline(Readable.from(body()), res);
  } catch (err) { abortStreamedExport(res, err, next); }
});

/**
 * GET /api/reports/export/excel
 */
router.get('/export/excel', async (req, res, next) => {
  try {
    const { date } = reportSvc.exportRowsQuery(req.user, req.filters);
    const filename = `report-${date}.xlsx`;

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    logAudit({ userId: req.user.id, action: 'EXPORT', entityType: 'report_excel', entityId: date,
      newValue: { format: 'excel', role: req.user.role, scope: req.user.scopeId },
      ipAddress: req.ip, userAgent: req.headers['user-agent'] }).catch(() => {});

    // WorkbookWriter writes each row to the response as it is committed, so the
    // whole workbook is never held in memory. useStyles keeps the header format
    // the buffered writer produced; shared strings stay off because they would
    // require holding every distinct string until the end, which is the thing
    // being avoided.
    const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({
      stream: res, useStyles: true, useSharedStrings: false,
    });
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

    headerRow.commit();

    // Data rows
    for await (const r of reportSvc.streamExportRows(req.user, req.filters)) {
      // Phase 10.12G — neutralise user-sourced text cells (defense-in-depth).
      sheet.addRow({
        col0: r.student_id,
        col1: neutralizeSpreadsheetCell(r.student_name),
        col2: neutralizeSpreadsheetCell(abbreviateGrade(r.grade)),
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
      }).commit();
    }

    await sheet.commit();
    await workbook.commit();
  } catch (err) { abortStreamedExport(res, err, next); }
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

/**
 * GET /api/reports/export/monthly/csv
 * Aggregate monthly export. Does not include student-level PII.
 */
router.get('/export/monthly/csv', async (req, res, next) => {
  try {
    const report = await reportSvc.getMonthlyReport(req.user, req.filters);
    const rows = buildMonthlyExportRows(report);
    const filename = `monthly-report-${report.month}.csv`;

    const BOM = '\uFEFF';
    let csv = BOM + MONTHLY_HEADERS.map(csvCell).join(',') + '\n';
    for (const row of rows) {
      csv += monthlyRowValues(row).map(csvCell).join(',') + '\n';
    }

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    logAudit({ userId: req.user.id, action: 'EXPORT', entityType: 'report_monthly_csv', entityId: report.month,
      newValue: { format: 'csv', report_type: 'monthly', role: req.user.role, scope: req.user.scopeId },
      ipAddress: req.ip, userAgent: req.headers['user-agent'] }).catch(() => {});
    return res.send(csv);
  } catch (err) { next(err); }
});

/**
 * GET /api/reports/export/monthly/excel
 * Aggregate monthly export. Does not include student-level PII.
 */
router.get('/export/monthly/excel', async (req, res, next) => {
  try {
    const report = await reportSvc.getMonthlyReport(req.user, req.filters);
    const rows = buildMonthlyExportRows(report);
    const filename = `monthly-report-${report.month}.xlsx`;

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'ระบบรถรับส่งนักเรียนจังหวัดลำปาง';
    const sheet = workbook.addWorksheet('รายงานรายเดือน');
    sheet.columns = MONTHLY_HEADERS.map((h, i) => ({
      header: h,
      key: `col${i}`,
      width: i <= 1 ? 28 : 16,
    }));

    const headerRow = sheet.getRow(1);
    headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4472C4' } };

    for (const row of rows) {
      const values = monthlyRowValues(row).map(neutralizeSpreadsheetCell);
      sheet.addRow(Object.fromEntries(values.map((v, i) => [`col${i}`, v])));
    }

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    logAudit({ userId: req.user.id, action: 'EXPORT', entityType: 'report_monthly_excel', entityId: report.month,
      newValue: { format: 'excel', report_type: 'monthly', role: req.user.role, scope: req.user.scopeId },
      ipAddress: req.ip, userAgent: req.headers['user-agent'] }).catch(() => {});
    await workbook.xlsx.write(res);
    res.end();
  } catch (err) { next(err); }
});

/**
 * GET /api/reports/export/monthly/pdf
 * Executive PDF summary for the selected month.
 */
router.get('/export/monthly/pdf', async (req, res, next) => {
  try {
    const report = await reportSvc.getMonthlyReport(req.user, req.filters);
    const rows = buildMonthlyExportRows(report);
    const monthLabel = new Date(`${report.month}-01`).toLocaleDateString('th-TH', {
      year: 'numeric', month: 'long', timeZone: 'Asia/Bangkok',
    });
    const filename = `monthly-report-${report.month}.pdf`;

    const PDFDocument = require('pdfkit');
    const doc = new PDFDocument({ size: 'A4', margin: 40 });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    doc.pipe(res);

    const env = require('../config/env');
    const fs = require('fs');
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

    doc.font(fontBold).fontSize(16).text('รายงานรายเดือนรถรับส่งนักเรียน', { align: 'center' });
    doc.font(fontName).fontSize(11).text('ระบบรถรับส่งนักเรียนจังหวัดลำปาง', { align: 'center' });
    doc.fontSize(11).text(`เดือน ${monthLabel}`, { align: 'center' });
    doc.moveDown(1.2);

    doc.font(fontBold).fontSize(13).text('สรุปภาพรวม');
    doc.moveDown(0.3);
    doc.font(fontName).fontSize(11);
    const summaryRows = [
      ['นักเรียนทั้งหมด', `${report.total_students} คน`],
      ['ข้อมูลที่มีในเดือน', `${report.days_with_data} วัน`],
      ['KPI ส่งเช้า', `${percentCell(report.morning_kpi)} (${report.total_morning_done}/${report.total_morning_expected})`],
      ['KPI รับเย็น', `${percentCell(report.evening_kpi)} (${report.total_evening_done}/${report.total_evening_expected})`],
      ['วันส่งเช้าครบ 100%', `${report.days_morning_100} วัน`],
      ['วันรับเย็นครบ 100%', `${report.days_evening_100} วัน`],
      ['เหตุฉุกเฉิน', `${report.emergency_count} รายการ`],
    ];
    for (const [label, value] of summaryRows) {
      const y = doc.y;
      doc.font(fontName).text(label, 60, y, { width: 180 });
      doc.font(fontBold).text(value, 240, y, { width: 260 });
      doc.y = y + 18;
    }
    doc.moveDown(0.8);

    const tableRows = rows.filter((row) => row.section === 'โรงเรียน').slice(0, 30);
    if (tableRows.length > 0) {
      doc.font(fontBold).fontSize(13).text('สรุปรายโรงเรียน');
      doc.moveDown(0.3);

      const cols = [
        { l: 'โรงเรียน', w: 220, a: 'left' },
        { l: 'นักเรียน', w: 55, a: 'center' },
        { l: 'KPI เช้า', w: 70, a: 'center' },
        { l: 'KPI เย็น', w: 70, a: 'center' },
        { l: 'วันข้อมูล', w: 65, a: 'center' },
      ];
      const pageW = doc.page.width - 80;
      let tx = 45;
      const hy = doc.y;
      doc.rect(40, hy - 2, pageW, 18).fill('#2563eb');
      doc.fill('#ffffff').font(fontBold).fontSize(9);
      for (const c of cols) { doc.text(c.l, tx, hy + 2, { width: c.w, align: c.a }); tx += c.w; }
      doc.y = hy + 20;
      doc.fill('#000000').font(fontName).fontSize(9);

      let alt = false;
      for (const row of tableRows) {
        if (doc.y > 750) doc.addPage();
        const rowY = doc.y;
        if (alt) doc.rect(40, rowY - 1, pageW, 16).fill('#f3f4f6').fill('#000000');
        alt = !alt;
        tx = 45;
        const vals = [
          { v: row.name || '-', a: 'left' },
          { v: `${row.student_count}`, a: 'center' },
          { v: percentCell(row.morning_kpi), a: 'center' },
          { v: percentCell(row.evening_kpi), a: 'center' },
          { v: `${row.days_with_data}`, a: 'center' },
        ];
        for (let i = 0; i < cols.length; i++) {
          doc.text(vals[i].v, tx, rowY + 1, { width: cols[i].w, align: vals[i].a });
          tx += cols[i].w;
        }
        doc.y = rowY + 17;
      }
      if (rows.filter((row) => row.section === 'โรงเรียน').length > tableRows.length) {
        doc.moveDown(0.3);
        doc.font(fontName).fontSize(8).fillColor('#666666')
          .text('หมายเหตุ: PDF แสดง 30 โรงเรียนแรก ดาวน์โหลด CSV/Excel เพื่อดูรายการทั้งหมด');
        doc.fillColor('#000000');
      }
    }

    doc.moveDown(1);
    doc.font(fontName).fontSize(8).fillColor('#999999')
      .text(`พิมพ์จากระบบรถรับส่งนักเรียนจังหวัดลำปาง — ${new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' })}`, { align: 'center' });

    logAudit({ userId: req.user.id, action: 'EXPORT', entityType: 'report_monthly_pdf', entityId: report.month,
      newValue: { format: 'pdf', report_type: 'monthly', role: req.user.role, scope: req.user.scopeId },
      ipAddress: req.ip, userAgent: req.headers['user-agent'] }).catch(() => {});
    doc.end();
  } catch (err) { next(err); }
});

// ─── POST /decision-log — Log province decision before export ────────────────
// Validation rules and rationale live in utils/decisionLog.js.
router.post('/decision-log', async (req, res, next) => {
  try {
    if (!DECISION_LOG_ROLES.includes(req.user.role)) {
      return sendError(res, 'บทบาทนี้ไม่มีสิทธิ์บันทึกการตัดสินใจ', [], 403);
    }

    const parsed = validateDecisionLog(req.body || {});
    if (parsed.error) return sendError(res, parsed.error, [], 400);
    const { decisionType, reportType, reportDate, note } = parsed.value;

    await logAudit({
      userId: req.user.id,
      action: 'CREATE',
      entityType: 'decision_log',
      entityId: `${reportType}_${reportDate}`,
      newValue: {
        decision_type: decisionType,
        decision_note: note,
        report_type: reportType,
        report_date: reportDate,
        role: req.user.role,
        scope_id: req.user.scopeId ?? null,
      },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return sendSuccess(res, { logged: true }, 'บันทึกการตัดสินใจสำเร็จ', null, 201);
  } catch (err) { next(err); }
});


module.exports = router;
