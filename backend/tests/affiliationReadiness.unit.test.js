'use strict';

/**
 * Training-readiness fixes for the affiliation role (QA round 1):
 *   affiliation-04  vehicles-at-risk drops score-0 vehicles (affiliation + province)
 *   affiliation-05  bulk school import treats soft-deleted usernames as taken
 *   affiliation-06  add-account-to-existing-school checks the username first
 *   affiliation-08  school-accounts list returns grade_scope / must_change_password, newest first
 *   affiliation-09  vehicle-request approve does not call a FAILED outcome "approved"
 */

let mockUser;
jest.mock('../src/middleware/auth', () => ({
  authenticate: (req, _res, next) => { req.user = mockUser; next(); },
}));
jest.mock('../src/config/database', () => ({ pool: { query: jest.fn(), getConnection: jest.fn() } }));
jest.mock('../src/utils/audit', () => ({ logAudit: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../src/services/vehicleRequest.service', () => ({
  getDetailForAffiliation: jest.fn(),
  approveVehicleRequest: jest.fn(),
}));

const express = require('express');
const request = require('supertest');
const { pool } = require('../src/config/database');
const affSvc = require('../src/services/affiliation.service');
const provSvc = require('../src/services/province.service');
const affAdmin = require('../src/services/affiliationAdmin.service');
const vr = require('../src/services/vehicleRequest.service');

beforeEach(() => {
  pool.query.mockReset();
  pool.getConnection.mockReset();
  mockUser = { id: 7, role: 'affiliation', scopeId: 'AFF001' };
});

function futureDate(days) {
  return new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
}

const CLEAN = { id: 'V-1', plate_no: 'กข 1', insurance_expiry: futureDate(200), latest_inspection_result: 'PASSED', latest_inspection_date: '2026-10-01', student_count: 3 };
const RISKY = { id: 'V-2', plate_no: 'กข 2', insurance_expiry: futureDate(200), latest_inspection_result: null, latest_inspection_date: null, student_count: 2 };

describe('affiliation-04: vehicles at risk', () => {
  test('affiliation scope returns only vehicles with a risk reason', async () => {
    pool.query.mockResolvedValueOnce([[CLEAN, RISKY]]);
    const out = await affSvc.getVehiclesAtRisk('AFF001', { limit: 10 });
    expect(out.map(v => v.id)).toEqual(['V-2']);
    expect(out[0].risk_score).toBeGreaterThan(0);
  });

  test('a clean fleet yields an empty list', async () => {
    pool.query.mockResolvedValueOnce([[CLEAN]]);
    expect(await affSvc.getVehiclesAtRisk('AFF001')).toEqual([]);
  });

  test('province twin applies the same filter', async () => {
    pool.query.mockResolvedValueOnce([[CLEAN, RISKY]]);
    const out = await provSvc.getVehiclesAtRisk({ limit: 10 });
    expect(out.map(v => v.id)).toEqual(['V-2']);
  });
});

describe('affiliation-05: bulk import vs soft-deleted usernames', () => {
  test('preview loads every username (no is_deleted filter) and flags the row', async () => {
    pool.query
      .mockResolvedValueOnce([[]]) // schools
      .mockResolvedValueOnce([[{ username: '123456' }]]); // users (incl. soft-deleted)
    const out = await affAdmin.previewSchoolImport(
      [{ rowNum: 2, school_code: '123456', school_name: 'โรงเรียนทดสอบ', initial_password: 'Lampang#2569x' }],
      'AFF001'
    );
    const usersSql = pool.query.mock.calls[1][0];
    expect(usersSql).toMatch(/SELECT username FROM users/);
    expect(usersSql).not.toMatch(/is_deleted/);
    expect(out.rows[0].status).toBe('error');
    expect(out.rows[0].errors.map(e => e.code)).toContain('USERNAME_EXISTS');
    expect(out.rows[0].errors.find(e => e.code === 'USERNAME_EXISTS').message).toMatch(/ถูกลบ/);
  });

  test('commit skips the row instead of failing the batch on the unique index', async () => {
    const conn = {
      beginTransaction: jest.fn(), commit: jest.fn(), rollback: jest.fn(), release: jest.fn(),
      query: jest.fn()
        .mockResolvedValueOnce([[]])
        .mockResolvedValueOnce([[{ username: '123456' }]]),
    };
    pool.getConnection.mockResolvedValueOnce(conn);
    const out = await affAdmin.commitSchoolImport(
      [{ rowNum: 2, school_code: '123456', school_name: 'โรงเรียนทดสอบ', initial_password: 'Lampang#2569x' }],
      'AFF001', 7
    );
    expect(conn.query.mock.calls[1][0]).not.toMatch(/is_deleted/);
    expect(conn.query).toHaveBeenCalledTimes(2); // no INSERT attempted
    expect(out.summary).toMatchObject({ created: 0, skipped: 1 });
    expect(conn.commit).toHaveBeenCalled();
  });
});

describe('affiliation-06: add account to existing school', () => {
  const school = { id: '520001', name: 'โรงเรียนหนึ่ง' };

  test('active duplicate username → Thai 409, no INSERT', async () => {
    pool.query
      .mockResolvedValueOnce([[school]])
      .mockResolvedValueOnce([[{ id: 3, is_deleted: 0 }]]);
    await expect(affAdmin.createSchoolAccount({ affiliationId: 'AFF001', schoolId: '520001', username: '520001', userId: 7 }))
      .rejects.toMatchObject({ statusCode: 409, message: expect.stringContaining('มีอยู่ในระบบแล้ว') });
    expect(pool.query).toHaveBeenCalledTimes(2);
  });

  test('soft-deleted duplicate username → 409 that names the deleted account', async () => {
    pool.query
      .mockResolvedValueOnce([[school]])
      .mockResolvedValueOnce([[{ id: 3, is_deleted: 1 }]]);
    await expect(affAdmin.createSchoolAccount({ affiliationId: 'AFF001', schoolId: '520001', username: '520001', userId: 7 }))
      .rejects.toMatchObject({ statusCode: 409, message: expect.stringContaining('ถูกลบไปแล้ว') });
  });
});

describe('affiliation-08: school accounts list', () => {
  test('selects grade_scope + must_change_password and sorts newest first', async () => {
    pool.query.mockResolvedValueOnce([[]]);
    await affAdmin.getSchoolAccounts('AFF001');
    const sql = pool.query.mock.calls[0][0];
    expect(sql).toMatch(/u\.grade_scope/);
    expect(sql).toMatch(/u\.must_change_password/);
    expect(sql).toMatch(/ORDER BY u\.created_at DESC/);
  });
});

describe('affiliation-09: vehicle request approve outcome wording', () => {
  const routes = require('../src/routes/affiliation.routes');
  const app = express();
  app.use(express.json());
  app.use('/api/affiliation', routes);
  app.use((err, _req, res, _next) => res.status(err.statusCode || 500).json({ success: false, message: err.message }));

  beforeEach(() => {
    vr.getDetailForAffiliation.mockReset().mockResolvedValue({ id: 5 });
    vr.approveVehicleRequest.mockReset();
  });

  test('FAILED conflict is not reported as approved', async () => {
    vr.approveVehicleRequest.mockResolvedValue({ status: 'FAILED', reason: 'ACTIVE_CANONICAL_CONFLICT' });
    const res = await request(app).post('/api/affiliation/vehicle-requests/5/approve').send({});
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('FAILED');
    expect(res.body.message).toBe('ไม่สามารถกู้คืนรถได้ เนื่องจากมีรถทะเบียนเดียวกันที่ใช้งานอยู่แล้ว');
  });

  test('APPLIED restore reports success', async () => {
    vr.approveVehicleRequest.mockResolvedValue({ status: 'APPLIED', vehicle_id: 'V-1' });
    const res = await request(app).post('/api/affiliation/vehicle-requests/5/approve').send({});
    expect(res.body.message).toBe('อนุมัติและกู้คืนรถสำเร็จ');
  });

  test('a request that is no longer pending says so', async () => {
    vr.approveVehicleRequest.mockResolvedValue({ status: 'REJECTED' });
    const res = await request(app).post('/api/affiliation/vehicle-requests/5/approve').send({});
    expect(res.body.message).not.toBe('อนุมัติคำขอแล้ว');
  });
});
