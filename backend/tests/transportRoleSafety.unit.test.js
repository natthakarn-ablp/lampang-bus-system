'use strict';

const { COLUMNS, encodeSafetyCsv } = require('../src/utils/transportSafetyCsv');
const { startInspection } = require('../src/services/vehicleVerification.service');
const { getSafetyExportRows } = require('../src/services/transport.service');

test('transport CSV uses an allowlist and neutralizes spreadsheet formulas', () => {
  const keys = COLUMNS.map(([key]) => key);
  expect(keys).not.toEqual(expect.arrayContaining([
    'student_name', 'student_id', 'owner_phone', 'driver_phone', 'notes', 'evidence_url',
  ]));
  const csv = encodeSafetyCsv([{
    plate_no: '=1+1', vehicle_type: 'BUS', latest_inspection_result: 'PASSED',
    student_name: 'MUST_NOT_LEAK', owner_phone: 'MUST_NOT_LEAK', notes: 'MUST_NOT_LEAK',
  }]);
  expect(csv).toContain("\"'=1+1\"");
  expect(csv).not.toContain('MUST_NOT_LEAK');
  expect(csv).toContain('ทะเบียนรถ');
});

test('transport export queries only vehicle and inspection fields', async () => {
  const query = jest.fn().mockResolvedValue([[{ plate_no: 'กข 1234 ลำปาง',
    latest_inspection_result: 'NEEDS_FIX' }]]);
  const rows = await getSafetyExportRows({ query });
  expect(rows).toHaveLength(1);
  expect(rows[0].latest_inspection_result).toBe('NEEDS_FIX');
  const sql = query.mock.calls[0][0];
  expect(sql).toContain('inspection_attempts');
  expect(sql).toContain('vehicle_inspections');
  expect(sql).not.toMatch(/students|phone|notes|evidence|rider_summary/i);
});

test('an application with an open attempt refuses a second start', async () => {
  const conn = {
    beginTransaction: jest.fn(), commit: jest.fn(), rollback: jest.fn(), release: jest.fn(),
    query: jest.fn(async sql => {
      if (/FROM vehicle_inspection_applications/.test(sql)) return [[{ id: 77, status: 'INSPECTION_PENDING' }]];
      if (/FROM inspection_attempts/.test(sql)) return [[{ id: 91 }]];
      return [[]];
    }),
  };
  await expect(startInspection({ getConnection: async () => conn }, {
    applicationId: 77, inspectorUserId: 12,
  })).rejects.toMatchObject({ statusCode: 409,
    errors: expect.arrayContaining([expect.objectContaining({ code: 'INSPECTION_ALREADY_IN_PROGRESS' })]) });
  expect(conn.rollback).toHaveBeenCalled();
  expect(conn.commit).not.toHaveBeenCalled();
  expect(conn.query.mock.calls.some(([sql]) => /INSERT INTO inspection_attempts/.test(sql))).toBe(false);
});
