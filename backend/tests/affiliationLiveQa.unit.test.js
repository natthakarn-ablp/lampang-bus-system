'use strict';

/**
 * Affiliation fixes from live QA round 2 (12 Nov training):
 *   aff-01  vehicles-at-risk reports the full total, not the capped list length
 *   aff-02  student search matches student_code and "first last" full name
 *   aff-03  "schools with incomplete vehicle data" counts only schools whose
 *           pupils lack a vehicle, not schools with no pupils at all
 *   aff-04  dashboard flags Saturday/Sunday as not a school day
 *   aff-07  audit CSV shows Thai action / entity / role labels
 */

require('./loadTestEnv');

let mockUser;
jest.mock('../src/middleware/auth', () => ({
  authenticate: (req, _res, next) => { req.user = mockUser; next(); },
}));
const calls = [];
let mockResponder = () => [[{}]];
jest.mock('../src/config/database', () => ({
  pool: {
    query: jest.fn((sql, params) => {
      calls.push({ sql: String(sql), params: params || [] });
      return Promise.resolve(mockResponder(String(sql), params || []));
    }),
    getConnection: jest.fn(),
  },
}));
jest.mock('../src/utils/audit', () => ({ logAudit: jest.fn().mockResolvedValue(undefined) }));

const express = require('express');
const request = require('supertest');
const affSvc = require('../src/services/affiliation.service');
const { auditActionTh, auditEntityTh, roleTh } = require('../src/utils/auditLabels');

beforeAll(() => { jest.spyOn(console, 'warn').mockImplementation(() => {}); });
beforeEach(() => {
  calls.length = 0;
  mockResponder = () => [[{}]];
  mockUser = { id: 7, role: 'affiliation', scopeId: 'AFF001' };
});

function app() {
  const a = express();
  a.use(express.json());
  a.use('/api/affiliation', require('../src/routes/affiliation.routes'));
  a.use((err, _req, res, _next) => res.status(err.statusCode || 500).json({ success: false, message: err.message }));
  return a;
}

const risky = i => ({
  id: `V-${i}`, plate_no: `กข ${String(i).padStart(3, '0')}`, insurance_expiry: null,
  latest_inspection_result: null, latest_inspection_date: null, student_count: 1,
});

describe('aff-01: vehicles at risk total', () => {
  test('service returns the capped list and the full total', async () => {
    mockResponder = () => [Array.from({ length: 25 }, (_, i) => risky(i + 1))];
    const out = await affSvc.getVehiclesAtRiskWithTotal('AFF001', { limit: 10 });
    expect(out.items).toHaveLength(10);
    expect(out.total).toBe(25);
  });

  test('getVehiclesAtRisk still returns a plain array', async () => {
    mockResponder = () => [Array.from({ length: 12 }, (_, i) => risky(i + 1))];
    const out = await affSvc.getVehiclesAtRisk('AFF001', { limit: 10 });
    expect(Array.isArray(out)).toBe(true);
    expect(out).toHaveLength(10);
  });

  test('route sends meta.total beside the capped data', async () => {
    mockResponder = () => [Array.from({ length: 303 }, (_, i) => risky(i + 1))];
    const res = await request(app()).get('/api/affiliation/vehicles-at-risk?limit=10');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(10);
    expect(res.body.meta).toEqual({ total: 303 });
  });
});

describe('aff-02: student search', () => {
  test('matches student_code, full name and exact internal id', async () => {
    mockResponder = sql => (/COUNT\(\*\)/.test(sql) ? [[{ total: 0 }]] : [[]]);
    await affSvc.getStudents('AFF001', { search: '  ทดสอบ   QA-01 ' });
    const q = calls.find(c => /student_code LIKE/.test(c.sql));
    expect(q).toBeDefined();
    expect(q.sql).toMatch(/CONCAT\(s\.first_name, ' ', s\.last_name\) LIKE \?/);
    expect(q.sql).toMatch(/CAST\(s\.id AS CHAR\) = \?/);
    expect(q.sql).not.toMatch(/CAST\(s\.id AS CHAR\) LIKE/);
    expect(q.params).toEqual(expect.arrayContaining(['%ทดสอบ QA-01%', 'ทดสอบ   QA-01']));
  });
});

describe('aff-03 / aff-04: dashboard', () => {
  test('missing-vehicle count comes from pupils without a live vehicle', async () => {
    mockResponder = sql => {
      if (/AS schools_missing_vehicle_data/.test(sql)) return [[{ schools_missing_vehicle_data: 5 }]];
      if (/AS total_schools/.test(sql)) return [[{ total_schools: 300 }]];
      if (/AS schools_with_vehicle_data/.test(sql)) return [[{ schools_with_vehicle_data: 214 }]];
      return [[{}]];
    };
    const out = await affSvc.getDashboard('AFF001').catch(() => null);
    const q = calls.find(c => /AS schools_missing_vehicle_data/.test(c.sql));
    expect(q.sql).toMatch(/JOIN\s+students s ON s\.school_id = sc\.id AND s\.is_deleted = FALSE/);
    expect(q.sql).toMatch(/LEFT JOIN vehicles v ON v\.id = s\.vehicle_id AND v\.is_deleted = FALSE/);
    expect(q.sql).toMatch(/v\.id IS NULL/);
    if (out) {
      expect(out.schools_missing_vehicle_data).toBe(5);
      expect(typeof out.is_school_day).toBe('boolean');
    }
  });

  test('isWeekendDate: Saturday and Sunday only', () => {
    expect(affSvc.isWeekendDate('2026-11-07')).toBe(true);  // Saturday
    expect(affSvc.isWeekendDate('2026-11-08')).toBe(true);  // Sunday
    expect(affSvc.isWeekendDate('2026-11-09')).toBe(false); // Monday
    expect(affSvc.isWeekendDate('2026-11-13')).toBe(false); // Friday
  });
});

describe('aff-07: audit labels', () => {
  test('known codes map to Thai, unknown codes fall back to the code', () => {
    expect(auditActionTh('VIEW')).toBe('เปิดดู');
    expect(auditEntityTh('affiliation_pickup_map')).toBe('แผนที่จุดรับส่ง (สังกัด)');
    expect(auditEntityTh('report_pdf')).toBe('รายงาน (PDF)');
    expect(roleTh('school')).toBe('โรงเรียน');
    expect(auditActionTh('SOMETHING_NEW')).toBe('SOMETHING_NEW');
    expect(auditEntityTh(null)).toBeNull();
  });

  test('audit CSV export shows Thai role, action and entity', async () => {
    mockResponder = sql => {
      if (/COUNT\(\*\)/.test(sql)) return [[{ total: 1 }]];
      if (/FROM audit_logs/.test(sql)) {
        return [[{
          id: 1, created_at: '2026-11-07T08:33:36Z', actor_name: 'โรงเรียนทดสอบ QA', actor_role: 'school',
          action: 'EXPORT', entity_type: 'report_pdf', entity_id: '2026-11-07', old_value: null, new_value: null,
        }]];
      }
      return [[{}]];
    };
    const res = await request(app()).get('/api/affiliation/audit-logs?format=csv');
    expect(res.status).toBe(200);
    const line = res.text.split('\n')[1];
    expect(line).toContain('"โรงเรียน"');
    expect(line).toContain('"ส่งออก"');
    expect(line).toContain('"รายงาน (PDF)"');
    expect(line).not.toMatch(/"school"|report_pdf/);
  });
});
