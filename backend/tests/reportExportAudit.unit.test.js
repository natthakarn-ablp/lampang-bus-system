'use strict';

require('./loadTestEnv');

jest.mock('../src/middleware/auth', () => ({
  authenticate: (req, _res, next) => {
    req.user = { id: 17, role: 'admin', scopeId: null };
    req.filters = { month: '2026-09' };
    next();
  },
}));
jest.mock('../src/middleware/roleGuard', () => ({
  requireRole: () => (_req, _res, next) => next(),
}));
jest.mock('../src/utils/audit', () => ({ logAudit: jest.fn() }));
jest.mock('../src/utils/policyActionEvidence', () => ({ consumePolicyAction: jest.fn().mockResolvedValue(true) }));
jest.mock('../src/services/report.service', () => ({
  getMonthlyReport: jest.fn().mockResolvedValue({
    month: '2026-09', total_students: 1, total_morning_done: 1, total_morning_expected: 1,
    morning_kpi: 100, total_evening_done: 1, total_evening_expected: 1, evening_kpi: 100,
    days_with_data: 1, days_morning_100: 1, days_evening_100: 1, emergency_count: 0,
    schools: [], vehicles: [],
  }),
}));

const express = require('express');
const request = require('supertest');
const { logAudit } = require('../src/utils/audit');
const reports = require('../src/routes/report.routes');
const syntheticAuditRows = [];

function app() {
  const instance = express();
  instance.use('/api/reports', reports);
  return instance;
}

beforeEach(() => {
  jest.clearAllMocks();
  syntheticAuditRows.length = 0;
  logAudit.mockImplementation(async (entry) => {
    syntheticAuditRows.push({ ...entry });
    return true;
  });
});

test('monthly CSV waits for a required audit and returns the export after it succeeds', async () => {
  const response = await request(app()).get('/api/reports/export/monthly/csv');

  expect(response.status).toBe(200);
  expect(response.headers['content-disposition']).toContain('monthly-report-2026-09.csv');
  expect(response.text).toContain('2026-09');
  expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({
    action: 'EXPORT', entityType: 'report_monthly_csv', entityId: '2026-09', required: true,
  }));
  expect(syntheticAuditRows).toContainEqual(expect.objectContaining({
    action: 'EXPORT', entityType: 'report_monthly_csv', entityId: '2026-09', required: true,
  }));
});

test('audit storage failure returns 503 and releases no download headers or file body', async () => {
  logAudit.mockRejectedValueOnce(new Error('synthetic audit outage'));

  const response = await request(app()).get('/api/reports/export/monthly/csv');

  expect(response.status).toBe(503);
  expect(response.headers['content-disposition']).toBeUndefined();
  expect(response.text).not.toContain('2026-09');
  expect(response.body.errors[0].code).toBe('EXPORT_AUDIT_UNAVAILABLE');
});
