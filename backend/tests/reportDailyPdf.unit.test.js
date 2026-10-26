'use strict';

jest.mock('../src/middleware/auth', () => ({
  authenticate: (req, _res, next) => {
    req.user = { id: 99, role: 'school', scopeId: 'SCHOOL_TEST' };
    next();
  },
}));
const mockDailyReport = jest.fn();
jest.mock('../src/services/report.service', () => ({ getDailyReport: mockDailyReport }));
const mockLogAudit = jest.fn().mockResolvedValue(undefined);
jest.mock('../src/utils/audit', () => ({ logAudit: mockLogAudit }));

const express = require('express');
const request = require('supertest');
const PDFDocument = require('pdfkit');
const reportRoutes = require('../src/routes/report.routes');

function binaryParser(response, callback) {
  const chunks = [];
  response.on('data', chunk => chunks.push(chunk));
  response.on('end', () => callback(null, Buffer.concat(chunks)));
}

afterEach(() => jest.restoreAllMocks());

test.each([
  ['different morning and evening riders', { morning_expected: 3, evening_expected: 1 }, ['0', '0']],
  ['no evening riders', { morning_expected: 3, evening_expected: 0, evening_done: 0 }, ['0', '0']],
  ['older service without expected counts', {}, ['1', '3']],
])('daily PDF pending columns match session riders: %s', async (_name, session, pending) => {
  // A pupil riding only in the morning must not become a pending evening ride.
  // Inspect the values passed to the real PDF writer, not just its file magic.
  const row = { student_count: 4, morning_done: 3, evening_done: 1, ...session };
  mockDailyReport.mockResolvedValue({
    date: '2026-10-15', total_students: 4, total_vehicles: 1,
    morning_total: session.morning_expected ?? 4,
    evening_total: session.evening_expected ?? 4,
    morning_done: row.morning_done, evening_done: row.evening_done,
    morning_pending: Number(pending[0]), evening_pending: Number(pending[1]), emergency_count: 0,
    schools: [{ school_name: 'SCHOOL_TEST_ROW', ...row }],
    vehicles: [{ plate_no: 'VEHICLE_TEST_ROW', ...row }],
  });
  const text = jest.spyOn(PDFDocument.prototype, 'text');
  const app = express();
  app.use('/api/reports', reportRoutes);
  const res = await request(app).get('/api/reports/export/pdf?date=2026-10-15')
    .buffer(true).parse(binaryParser);
  expect(res.status).toBe(200);
  expect(res.body.subarray(0, 4).toString()).toBe('%PDF');
  const values = text.mock.calls.map(call => call[0]);
  for (const label of ['SCHOOL_TEST_ROW', 'VEHICLE_TEST_ROW']) {
    const start = values.indexOf(label);
    expect(start).toBeGreaterThan(-1);
    expect(values.slice(start, start + 6)).toEqual([
      label, '4', String(row.morning_done), String(row.evening_done), ...pending,
    ]);
  }
  expect(mockLogAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'EXPORT', entityType: 'report_pdf' }));
});
