'use strict';

/**
 * DB-free route tests for monthly report exports. The report service is mocked
 * so these tests prove routing, RBAC, aggregate export shape, and audit calls
 * without touching MySQL or production data.
 */

jest.mock('../src/middleware/auth', () => ({
  authenticate: (req, _res, next) => {
    req.user = {
      id: 99,
      role: req.headers['x-test-role'] || 'province',
      scopeId: req.headers['x-test-scope'] || 'AFF001',
    };
    next();
  },
}));

const mockGetMonthlyReport = jest.fn();
const mockGetExportRows = jest.fn();
jest.mock('../src/services/report.service', () => ({
  getDailyReport: jest.fn(),
  getMonthlyReport: mockGetMonthlyReport,
  getSummaryReport: jest.fn(),
  getExportRows: mockGetExportRows,
  getPolicyReport: jest.fn(),
}));

const mockLogAudit = jest.fn().mockResolvedValue(undefined);
jest.mock('../src/utils/audit', () => ({ logAudit: mockLogAudit }));

const express = require('express');
const request = require('supertest');
const reportRoutes = require('../src/routes/report.routes');

function appOf() {
  const app = express();
  app.use('/api/reports', reportRoutes);
  app.use((err, _req, res, _next) => {
    res.status(err.statusCode || 500).json({ success: false, message: err.message });
  });
  return app;
}

function monthlyReport() {
  return {
    month: '2026-08',
    total_students: 10,
    total_morning_done: 18,
    total_evening_done: 17,
    total_morning_expected: 20,
    total_evening_expected: 20,
    morning_kpi: 90,
    evening_kpi: 85,
    days_with_data: 2,
    days_morning_100: 1,
    days_evening_100: 0,
    emergency_count: 1,
    schools: [{
      school_id: 'SCH1',
      school_name: 'โรงเรียนทดสอบ',
      student_count: 10,
      morning_expected: 10,
      evening_expected: 10,
      total_morning_done: 18,
      total_evening_done: 17,
      morning_kpi: 90,
      evening_kpi: 85,
      days_with_data: 2,
      days_morning_100: 1,
      days_evening_100: 0,
    }],
    vehicles: [{
      vehicle_id: 'V1',
      plate_no: 'นข 1 ลำปาง',
      student_count: 10,
      total_morning_done: 18,
      total_evening_done: 17,
      morning_kpi: 90,
      evening_kpi: 85,
      days_with_data: 2,
    }],
  };
}

function binaryParser(response, callback) {
  const chunks = [];
  response.on('data', (chunk) => chunks.push(chunk));
  response.on('end', () => callback(null, Buffer.concat(chunks)));
}

beforeEach(() => {
  jest.clearAllMocks();
  mockGetMonthlyReport.mockResolvedValue(monthlyReport());
});

describe('monthly report exports', () => {
  test('CSV uses monthly aggregate data, not daily student rows', async () => {
    const res = await request(appOf())
      .get('/api/reports/export/monthly/csv?month=2026-08')
      .set('x-test-role', 'province');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/csv/);
    expect(res.headers['content-disposition']).toContain('monthly-report-2026-08.csv');
    expect(mockGetMonthlyReport).toHaveBeenCalledWith(expect.objectContaining({ role: 'province' }), expect.objectContaining({ month: '2026-08' }));
    expect(mockGetExportRows).not.toHaveBeenCalled();
    expect(res.text).toContain('ภาพรวม');
    expect(res.text).toContain('โรงเรียนทดสอบ');
    expect(res.text).toContain('นข 1 ลำปาง');
    expect(res.text).not.toContain('รหัสนักเรียน');
    expect(mockLogAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: 'EXPORT',
      entityType: 'report_monthly_csv',
      entityId: '2026-08',
    }));
  });

  test('Excel monthly export streams an XLSX file', async () => {
    const res = await request(appOf())
      .get('/api/reports/export/monthly/excel?month=2026-08')
      .set('x-test-role', 'affiliation')
      .buffer(true)
      .parse(binaryParser);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/spreadsheetml|openxml/);
    expect(res.headers['content-disposition']).toContain('monthly-report-2026-08.xlsx');
    expect(Buffer.isBuffer(res.body)).toBe(true);
    expect(res.body.subarray(0, 2).toString()).toBe('PK');
    expect(mockLogAudit).toHaveBeenCalledWith(expect.objectContaining({
      entityType: 'report_monthly_excel',
      entityId: '2026-08',
    }));
  });

  test('PDF monthly export streams a PDF summary', async () => {
    const res = await request(appOf())
      .get('/api/reports/export/monthly/pdf?month=2026-08')
      .set('x-test-role', 'school')
      .buffer(true)
      .parse(binaryParser);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/pdf/);
    expect(res.headers['content-disposition']).toContain('monthly-report-2026-08.pdf');
    expect(Buffer.isBuffer(res.body)).toBe(true);
    expect(res.body.subarray(0, 4).toString()).toBe('%PDF');
    expect(mockLogAudit).toHaveBeenCalledWith(expect.objectContaining({
      entityType: 'report_monthly_pdf',
      entityId: '2026-08',
    }));
  });

  test('driver role is blocked before monthly export service access', async () => {
    const res = await request(appOf())
      .get('/api/reports/export/monthly/csv?month=2026-08')
      .set('x-test-role', 'driver');

    expect(res.status).toBe(403);
    expect(mockGetMonthlyReport).not.toHaveBeenCalled();
  });

  test('invalid month is rejected before monthly export service access', async () => {
    const res = await request(appOf())
      .get('/api/reports/export/monthly/csv?month=2026-99')
      .set('x-test-role', 'province');

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toContain('month');
    expect(mockGetMonthlyReport).not.toHaveBeenCalled();
    expect(mockLogAudit).not.toHaveBeenCalled();
  });

  test('impossible daily date is rejected before export service access', async () => {
    const res = await request(appOf())
      .get('/api/reports/export/csv?date=2026-02-31')
      .set('x-test-role', 'province');

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toContain('date');
    expect(mockGetExportRows).not.toHaveBeenCalled();
    expect(mockLogAudit).not.toHaveBeenCalled();
  });
});
